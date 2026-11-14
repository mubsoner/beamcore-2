import {
  createOperationError,
  createOperationResult,
  isObjectRef,
  isRequestContext,
  isTimestamp,
  type DomainEventEnvelope,
  type EngineUnitOfWorkPort,
  type IdempotencyRecord,
  type ObjectRef,
  type OperationErrorCode,
  type OperationResult,
  type RequestContext,
} from "../shared";
import type { WorkRecord } from "../inv-02-work/domain";
import type { GraphActivationReceipt, WorkGraphRevision } from "../inv-03-planning/domain";
import {
  createNodeCoordination,
  createOrchestrationRun,
  type NodeCoordinationRecord,
  type OrchestrationIssue,
  type OrchestrationRun,
} from "./domain";

export interface NodeCoordinationAllocation {
  graph_node_ref: ObjectRef;
  node_coordination_ref: ObjectRef;
}

export interface SubmitPlanCommand {
  context: RequestContext;
  work_ref: ObjectRef;
  expected_work_version: string;
  graph_revision_ref: ObjectRef;
  activation_request_ref: ObjectRef;
  activation_receipt_ref: ObjectRef;
  orchestration_ref: ObjectRef;
  request_ref: ObjectRef;
  node_coordination_allocations: NodeCoordinationAllocation[];
  created_at: string;
  request_fingerprint: string;
  event_ref: ObjectRef;
}

function rejected<T>(
  code: OperationErrorCode,
  safe_message: string,
  correlation_id: string,
): OperationResult<T> {
  return createOperationResult({
    status: "REJECTED",
    correlation_id,
    errors: [createOperationError(code, safe_message, false)],
  });
}

function propagateFailure<T>(source: OperationResult<unknown>): OperationResult<T> {
  const unexpectedSuccess = source.status === "OK";
  return createOperationResult<T>({
    status: unexpectedSuccess ? "UNKNOWN" : source.status,
    correlation_id: source.correlation_id,
    errors: unexpectedSuccess
      ? [createOperationError("INTERNAL_ERROR", "A dependency returned success without the required record", false)]
      : source.errors,
    warnings: source.warnings,
    ...(source.object_version !== undefined ? { object_version: source.object_version } : {}),
  });
}

function sameObjectRef(a: ObjectRef, b: ObjectRef): boolean {
  return a.object_kind === b.object_kind &&
    a.object_id === b.object_id &&
    a.object_version === b.object_version &&
    a.scope_ref.scope_id === b.scope_ref.scope_id &&
    a.scope_ref.scope_kind === b.scope_ref.scope_kind;
}

function mapDomainCode(code: OrchestrationIssue["code"]): OperationErrorCode {
  switch (code) {
    case "VALIDATION_ERROR":
    case "INVALID_TRANSITION":
      return "VALIDATION_ERROR";
    case "VERSION_CONFLICT":
      return "VERSION_CONFLICT";
    case "FORBIDDEN":
      return "FORBIDDEN";
    case "APPROVAL_REQUIRED":
      return "APPROVAL_REQUIRED";
    case "DEPENDENCY_UNAVAILABLE":
      return "DEPENDENCY_UNAVAILABLE";
    case "RESOURCE_LIMIT":
      return "RESOURCE_LIMIT";
    case "OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED":
      return "OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED";
  }
}

function validateEnvelope(command: SubmitPlanCommand): string | undefined {
  const { context, event_ref, request_fingerprint } = command;
  if (!isRequestContext(context) || !context.idempotency_key?.trim()) {
    return "Orchestration submission requires a valid request context and idempotency key";
  }
  if (!isObjectRef(event_ref) || event_ref.object_kind !== "DOMAIN_EVENT" ||
      event_ref.scope_ref.scope_id !== context.scope_ref.scope_id ||
      event_ref.scope_ref.scope_kind !== context.scope_ref.scope_kind) {
    return "Orchestration submission requires an in-scope DOMAIN_EVENT reference";
  }
  if (!/^[a-f0-9]{64}$/i.test(request_fingerprint)) {
    return "request_fingerprint must be a SHA-256 hex digest";
  }
  if (!isTimestamp(command.created_at)) {
    return "Orchestration creation timestamp is invalid";
  }
  if (!command.expected_work_version?.trim()) {
    return "Orchestration submission requires expected_work_version";
  }
  return undefined;
}

function validateCommandReferences(command: SubmitPlanCommand): string | undefined {
  const { context } = command;
  const expectedKinds: Array<[ObjectRef, string]> = [
    [command.work_ref, "WORK"],
    [command.graph_revision_ref, "WORK_GRAPH_REVISION"],
    [command.activation_request_ref, "GRAPH_ACTIVATION_REQUEST"],
    [command.activation_receipt_ref, "PLAN_GRAPH_ACTIVATION_RECEIPT"],
    [command.orchestration_ref, "ORCHESTRATION_RUN"],
    [command.request_ref, "ORCHESTRATION_REQUEST"],
  ];
  for (const [ref, kind] of expectedKinds) {
    if (!isObjectRef(ref) || ref.object_kind !== kind ||
        ref.scope_ref.scope_id !== context.scope_ref.scope_id ||
        ref.scope_ref.scope_kind !== context.scope_ref.scope_kind) {
      return "Orchestration references must use their canonical kinds and the authenticated request scope";
    }
  }
  if (!Array.isArray(command.node_coordination_allocations)) {
    return "Node coordination allocations are required";
  }
  return undefined;
}

/**
 * Starts an orchestration record only from INV-02's persisted, accepted
 * activation receipt. Work and Plan/Graph remain owned by INV-02/INV-03.
 *
 * This creates the run and its initial PENDING node-coordination records in
 * one unit of work. It does not evaluate readiness, authorize dispatch, start
 * an Execution, or select a scheduler/queue provider.
 */
export async function submitPlan(
  unitOfWork: EngineUnitOfWorkPort,
  command: SubmitPlanCommand,
): Promise<OperationResult<OrchestrationRun>> {
  const correlation_id = command.context.correlation_id;
  const envelopeIssue = validateEnvelope(command);
  if (envelopeIssue) {
    return rejected("VALIDATION_ERROR", envelopeIssue, correlation_id);
  }
  const referenceIssue = validateCommandReferences(command);
  if (referenceIssue) {
    return rejected("VALIDATION_ERROR", referenceIssue, correlation_id);
  }

  return unitOfWork.execute(command.context, async (transaction) => {
    const prior = await transaction.idempotency.get<OrchestrationRun>(
      command.context,
      command.context.idempotency_key!,
    );
    if (prior.status !== "OK") return propagateFailure<OrchestrationRun>(prior);
    if (prior.data) {
      if (prior.data.request_fingerprint !== command.request_fingerprint) {
        return rejected(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was already used for a different orchestration submission",
          correlation_id,
        );
      }
      return prior.data.result;
    }

    const workResult = await transaction.repository<WorkRecord>("inv-02.works")
      .get(command.context, command.work_ref);
    if (workResult.status !== "OK" || !workResult.data) {
      return propagateFailure<OrchestrationRun>(workResult);
    }
    if (!sameObjectRef(workResult.data.work_ref, command.work_ref)) {
      return rejected(
        "INTEGRITY_OR_UNTRUSTED_INPUT",
        "Work repository returned a different Work identity than requested",
        correlation_id,
      );
    }
    if (!workResult.object_version ||
        workResult.object_version !== command.expected_work_version ||
        String(workResult.data.current_revision) !== command.expected_work_version) {
      return rejected(
        "VERSION_CONFLICT",
        "Work version changed before orchestration submission; reload the active binding",
        correlation_id,
      );
    }

    const graphResult = await transaction.repository<WorkGraphRevision>("inv-03.graph-revisions")
      .get(command.context, command.graph_revision_ref);
    if (graphResult.status !== "OK" || !graphResult.data) {
      return propagateFailure<OrchestrationRun>(graphResult);
    }
    if (!sameObjectRef(graphResult.data.graph_revision_ref, command.graph_revision_ref)) {
      return rejected(
        "INTEGRITY_OR_UNTRUSTED_INPUT",
        "Graph repository returned a different Graph revision than requested",
        correlation_id,
      );
    }

    const receiptResult = await transaction
      .appendOnly<GraphActivationReceipt>("inv-02.plan-graph-activation-receipts")
      .get(command.context, command.activation_receipt_ref);
    if (receiptResult.status !== "OK" || !receiptResult.data) {
      return propagateFailure<OrchestrationRun>(receiptResult);
    }
    if (!sameObjectRef(receiptResult.data.receipt_ref, command.activation_receipt_ref)) {
      return rejected(
        "INTEGRITY_OR_UNTRUSTED_INPUT",
        "Activation receipt repository returned a different receipt than requested",
        correlation_id,
      );
    }

    const created = createOrchestrationRun({
      context: command.context,
      orchestration_ref: command.orchestration_ref,
      request_ref: command.request_ref,
      activation_request_ref: command.activation_request_ref,
      work: workResult.data,
      graph: graphResult.data,
      activation_receipt: receiptResult.data,
      created_at: command.created_at,
    });
    if (!created.ok) {
      return rejected(
        mapDomainCode(created.issues[0].code),
        created.issues.map((issue) => issue.safe_message).join("; "),
        correlation_id,
      );
    }

    const allocations = command.node_coordination_allocations;
    if (allocations.length !== graphResult.data.nodes.length) {
      return rejected(
        "VALIDATION_ERROR",
        "Exactly one node-coordination reference is required for every node in the pinned Graph revision",
        correlation_id,
      );
    }
    const allocationByNode = new Map<string, NodeCoordinationAllocation>();
    const coordinationIds = new Set<string>();
    for (const allocation of allocations) {
      if (!isObjectRef(allocation.graph_node_ref) ||
          allocation.graph_node_ref.object_kind !== "GRAPH_NODE" ||
          !isObjectRef(allocation.node_coordination_ref) ||
          allocation.node_coordination_ref.object_kind !== "NODE_COORDINATION" ||
          allocation.graph_node_ref.scope_ref.scope_id !== command.context.scope_ref.scope_id ||
          allocation.graph_node_ref.scope_ref.scope_kind !== command.context.scope_ref.scope_kind ||
          allocation.node_coordination_ref.scope_ref.scope_id !== command.context.scope_ref.scope_id ||
          allocation.node_coordination_ref.scope_ref.scope_kind !== command.context.scope_ref.scope_kind) {
        return rejected(
          "VALIDATION_ERROR",
          "Node-coordination allocations must be valid, in-scope GRAPH_NODE and NODE_COORDINATION references",
          correlation_id,
        );
      }
      const key = allocation.graph_node_ref.object_kind + ":" + allocation.graph_node_ref.object_id;
      const coordKey = allocation.node_coordination_ref.object_kind + ":" + allocation.node_coordination_ref.object_id;
      if (allocationByNode.has(key) || coordinationIds.has(coordKey)) {
        return rejected(
          "VALIDATION_ERROR",
          "Node-coordination allocations must not duplicate graph nodes or coordination identities",
          correlation_id,
        );
      }
      allocationByNode.set(key, allocation);
      coordinationIds.add(coordKey);
    }

    const nodeRecords: NodeCoordinationRecord[] = [];
    for (const graphNode of graphResult.data.nodes) {
      const key = graphNode.node_ref.object_kind + ":" + graphNode.node_ref.object_id;
      const allocation = allocationByNode.get(key);
      if (!allocation || !sameObjectRef(allocation.graph_node_ref, graphNode.node_ref)) {
        return rejected(
          "VALIDATION_ERROR",
          "Every initial node-coordination record must pin an exact node reference from the activated Graph revision",
          correlation_id,
        );
      }
      const nodeResult = createNodeCoordination({
        context: command.context,
        run: created.value,
        graph: graphResult.data,
        node: graphNode,
        node_coordination_ref: allocation.node_coordination_ref,
        created_at: command.created_at,
      });
      if (!nodeResult.ok) {
        return rejected(
          mapDomainCode(nodeResult.issues[0].code),
          nodeResult.issues.map((issue) => issue.safe_message).join("; "),
          correlation_id,
        );
      }
      nodeRecords.push(nodeResult.value);
    }

    const runs = transaction.repository<OrchestrationRun>("inv-04.orchestration-runs");
    const savedRun = await runs.create(
      command.context,
      command.orchestration_ref,
      created.value,
    );
    if (savedRun.status !== "OK" || !savedRun.data) {
      return propagateFailure<OrchestrationRun>(savedRun);
    }
    if (!sameObjectRef(savedRun.data.orchestration_ref, command.orchestration_ref) ||
        !savedRun.object_version) {
      return rejected(
        "INTEGRITY_OR_UNTRUSTED_INPUT",
        "Orchestration repository did not confirm the created run identity and storage version",
        correlation_id,
      );
    }

    const nodeRepository = transaction.repository<NodeCoordinationRecord>("inv-04.node-coordination");
    for (const nodeRecord of nodeRecords) {
      const persistedNode = await nodeRepository.create(
        command.context,
        nodeRecord.node_coordination_ref,
        nodeRecord,
      );
      if (persistedNode.status !== "OK" || !persistedNode.data) {
        return propagateFailure<OrchestrationRun>(persistedNode);
      }
      if (!sameObjectRef(persistedNode.data.node_coordination_ref, nodeRecord.node_coordination_ref)) {
        return rejected(
          "INTEGRITY_OR_UNTRUSTED_INPUT",
          "Node-coordination repository returned a different record identity",
          correlation_id,
        );
      }
    }

    const event: DomainEventEnvelope = {
      event_id: command.event_ref.object_id,
      event_type: "orchestration.started",
      schema_version: 1,
      occurred_at: command.created_at,
      producer_engine: "INV-04",
      object_ref: savedRun.data.orchestration_ref,
      scope_ref: savedRun.data.scope_ref,
      correlation_id,
      actor_ref: command.context.actor_ref,
      payload: {
        work_ref: savedRun.data.work_ref,
        plan_revision_ref: savedRun.data.plan_revision_ref,
        graph_revision_ref: savedRun.data.graph_revision_ref,
        activation_request_ref: savedRun.data.activation_request_ref,
        activation_receipt_ref: savedRun.data.graph_activation_receipt_ref,
        node_coordination_refs: nodeRecords.map((record) => record.node_coordination_ref),
        initial_state: savedRun.data.state,
      },
    };
    const emitted = await transaction.outbox.append(command.context, event);
    if (emitted.status !== "OK") return propagateFailure<OrchestrationRun>(emitted);

    const result = createOperationResult({
      status: "OK",
      correlation_id,
      data: savedRun.data,
      object_version: savedRun.object_version,
    });
    const recorded = await transaction.idempotency.record(command.context, {
      idempotency_key: command.context.idempotency_key!,
      request_fingerprint: command.request_fingerprint,
      result,
      recorded_at: command.created_at,
    } satisfies IdempotencyRecord<OrchestrationRun>);
    if (recorded.status !== "OK") return propagateFailure<OrchestrationRun>(recorded);
    return result;
  });
}
