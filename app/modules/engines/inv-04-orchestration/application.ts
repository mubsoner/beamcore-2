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
  type Timestamp,
} from "../shared";
import type { WorkRecord } from "../inv-02-work/domain";
import type { GraphActivationReceipt, WorkGraphRevision } from "../inv-03-planning/domain";
import {
  createNodeCoordination,
  createOrchestrationRun,
  decideRetry,
  type DispatchAttempt,
  type NodeCoordinationRecord,
  type OrchestrationIssue,
  type OrchestrationRun,
  type RetryDecision,
  type SideEffectClass,
} from "./domain";

export interface NodeCoordinationAllocation {
  graph_node_ref: ObjectRef;
  node_coordination_ref: ObjectRef;
}

export interface OrchestrationStartSnapshot {
  work: WorkRecord;
  work_storage_version: string;
  graph: WorkGraphRevision;
  activation_receipt: GraphActivationReceipt;
  observed_at: string;
}

/** Read-only boundary to INV-02/INV-03; adapters may use authenticated service APIs. */
export interface OrchestrationStartReaderPort {
  readStartSnapshot(
    context: RequestContext,
    refs: {
      work_ref: ObjectRef;
      graph_revision_ref: ObjectRef;
      activation_receipt_ref: ObjectRef;
    },
  ): Promise<OperationResult<OrchestrationStartSnapshot>>;
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
  reader: OrchestrationStartReaderPort,
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

  const readIdempotency = await unitOfWork.execute(command.context, async (transaction) => {
    const prior = await transaction.idempotency.get<OrchestrationRun>(
      command.context,
      command.context.idempotency_key!,
    );
    if (prior.status !== "OK") return propagateFailure<IdempotencyRecord<OrchestrationRun> | null>(prior);
    return createOperationResult({
      status: "OK",
      correlation_id,
      data: prior.data,
    });
  });
  if (readIdempotency.status !== "OK") return propagateFailure<OrchestrationRun>(readIdempotency);
  if (readIdempotency.data) {
    if (readIdempotency.data.request_fingerprint !== command.request_fingerprint) {
      return rejected(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was already used for a different orchestration submission",
        correlation_id,
      );
    }
    return readIdempotency.data.result;
  }

  // Read INV-02/INV-03 source-of-truth records before opening INV-04's write transaction.
  const snapshotResult = await reader.readStartSnapshot(command.context, {
    work_ref: command.work_ref,
    graph_revision_ref: command.graph_revision_ref,
    activation_receipt_ref: command.activation_receipt_ref,
  });
  if (snapshotResult.status !== "OK" || !snapshotResult.data) {
    return propagateFailure<OrchestrationRun>(snapshotResult);
  }
  const snapshot = snapshotResult.data;
  if (!isTimestamp(snapshot.observed_at) ||
      Date.parse(snapshot.observed_at) > Date.parse(command.created_at) ||
      !sameObjectRef(snapshot.work.work_ref, command.work_ref) ||
      !sameObjectRef(snapshot.graph.graph_revision_ref, command.graph_revision_ref) ||
      !sameObjectRef(snapshot.activation_receipt.receipt_ref, command.activation_receipt_ref)) {
    return rejected(
      "INTEGRITY_OR_UNTRUSTED_INPUT",
      "Cross-engine start snapshot is invalid or does not match the requested references",
      correlation_id,
    );
  }
  if (!snapshot.work_storage_version ||
      snapshot.work_storage_version !== command.expected_work_version ||
      String(snapshot.work.current_revision) !== command.expected_work_version) {
    return rejected(
      "VERSION_CONFLICT",
      "Work version changed before orchestration submission; reload the active binding",
      correlation_id,
    );
  }

  const created = createOrchestrationRun({
    context: command.context,
    orchestration_ref: command.orchestration_ref,
    request_ref: command.request_ref,
    activation_request_ref: command.activation_request_ref,
    work: snapshot.work,
    graph: snapshot.graph,
    activation_receipt: snapshot.activation_receipt,
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
  if (allocations.length !== snapshot.graph.nodes.length) {
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
  for (const graphNode of snapshot.graph.nodes) {
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
      graph: snapshot.graph,
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


/**
 * A read-only, provider-neutral boundary for resolving the evidence and current
 * governed retry policy. Its adapter must verify the supplied evidence refs
 * against their owning sources (including INV-05 execution facts and, where
 * required, INV-12 reconciliation facts); callers cannot supply classifications
 * or retry allowances directly to requestRetry.
 */
export interface RetryAssessment {
  evidence_refs: ObjectRef[];
  failure_classification: string;
  side_effect_class: SideEffectClass;
  retryable_failure: boolean;
  next_attempt_number: number;
  eligibility_expires_at?: Timestamp;
  policy_decision_ref?: ObjectRef;
  reconciliation_ref?: ObjectRef;
}

export interface RetryAssessmentReaderPort {
  readRetryAssessment(
    context: RequestContext,
    input: {
      dispatch: DispatchAttempt;
      failure_evidence_refs: ObjectRef[];
    },
  ): Promise<OperationResult<RetryAssessment>>;
}

export interface RequestRetryCommand {
  context: RequestContext;
  dispatch_ref: ObjectRef;
  failure_evidence_refs: ObjectRef[];
  retry_decision_ref: ObjectRef;
  /** Required only when the authoritative decision requires reconciliation. */
  event_ref?: ObjectRef;
  decided_at: Timestamp;
  request_fingerprint: string;
}

function refIdentity(ref: ObjectRef): string {
  return [
    ref.object_kind,
    ref.object_id,
    ref.object_version ?? "",
    ref.scope_ref.scope_kind,
    ref.scope_ref.scope_id,
  ].join("\\u0000");
}

function sameRefSet(expected: ObjectRef[], actual: ObjectRef[]): boolean {
  if (expected.length !== actual.length) return false;
  const expectedKeys = expected.map(refIdentity).sort();
  const actualKeys = actual.map(refIdentity).sort();
  return expectedKeys.every((key, index) => key === actualKeys[index]);
}

function validateRetryCommand(command: RequestRetryCommand): string | undefined {
  if (!isRequestContext(command.context) || !command.context.idempotency_key?.trim()) {
    return "Retry request requires a valid request context and idempotency key";
  }
  const scope = command.context.scope_ref;
  const scoped = (ref: ObjectRef, kind: string) =>
    isObjectRef(ref) &&
    ref.object_kind === kind &&
    ref.scope_ref.scope_id === scope.scope_id &&
    ref.scope_ref.scope_kind === scope.scope_kind;
  if (!scoped(command.dispatch_ref, "DISPATCH_ATTEMPT") ||
      !scoped(command.retry_decision_ref, "RETRY_DECISION") ||
      !isTimestamp(command.decided_at) ||
      !/^[a-f0-9]{64}$/i.test(command.request_fingerprint)) {
    return "Retry request references, timestamp or request fingerprint are invalid";
  }
  if (!Array.isArray(command.failure_evidence_refs) || command.failure_evidence_refs.length === 0 ||
      !command.failure_evidence_refs.every((ref) =>
        isObjectRef(ref) &&
        ref.scope_ref.scope_id === scope.scope_id &&
        ref.scope_ref.scope_kind === scope.scope_kind)) {
    return "Retry requires one or more valid, in-scope failure evidence references";
  }
  const evidenceKeys = command.failure_evidence_refs.map(refIdentity);
  if (new Set(evidenceKeys).size !== evidenceKeys.length) {
    return "Retry failure evidence references must not contain duplicates";
  }
  if (command.event_ref !== undefined && !scoped(command.event_ref, "DOMAIN_EVENT")) {
    return "Retry reconciliation event reference must be an in-scope DOMAIN_EVENT";
  }
  return undefined;
}

/**
 * Persists an INV-04 retry decision; it never starts an INV-05 execution.
 * Dispatch state is re-read in the commit transaction so stale evidence cannot
 * authorize a retry after the underlying attempt has changed.
 */
export async function requestRetry(
  unitOfWork: EngineUnitOfWorkPort,
  assessmentReader: RetryAssessmentReaderPort,
  command: RequestRetryCommand,
): Promise<OperationResult<RetryDecision>> {
  const correlation_id = command.context.correlation_id;
  const commandIssue = validateRetryCommand(command);
  if (commandIssue) return rejected("VALIDATION_ERROR", commandIssue, correlation_id);

  const idempotencyRead = await unitOfWork.execute(command.context, async (transaction) => {
    const prior = await transaction.idempotency.get<RetryDecision>(
      command.context,
      command.context.idempotency_key!,
    );
    if (prior.status !== "OK") {
      return propagateFailure<IdempotencyRecord<RetryDecision> | null>(prior);
    }
    return createOperationResult({
      status: "OK",
      correlation_id,
      data: prior.data,
    });
  });
  if (idempotencyRead.status !== "OK") return propagateFailure<RetryDecision>(idempotencyRead);
  if (idempotencyRead.data) {
    if (idempotencyRead.data.request_fingerprint !== command.request_fingerprint) {
      return rejected(
        "IDEMPOTENCY_CONFLICT",
        "Retry idempotency key was already used for a different request",
        correlation_id,
      );
    }
    return idempotencyRead.data.result;
  }

  const dispatchRead = await unitOfWork.execute(command.context, async (transaction) =>
    transaction.repository<DispatchAttempt>("inv-04.dispatch-attempts").get(
      command.context,
      command.dispatch_ref,
    ),
  );
  if (dispatchRead.status !== "OK" || !dispatchRead.data || !dispatchRead.object_version) {
    return propagateFailure<RetryDecision>(dispatchRead);
  }
  const dispatch = dispatchRead.data;
  if (!sameObjectRef(dispatch.dispatch_ref, command.dispatch_ref) ||
      dispatch.dispatch_ref.object_kind !== "DISPATCH_ATTEMPT" ||
      dispatch.dispatch_ref.scope_ref.scope_id !== command.context.scope_ref.scope_id ||
      dispatch.dispatch_ref.scope_ref.scope_kind !== command.context.scope_ref.scope_kind) {
    return rejected(
      "INTEGRITY_OR_UNTRUSTED_INPUT",
      "Stored dispatch identity does not match the retry request",
      correlation_id,
    );
  }

  const assessmentResult = await assessmentReader.readRetryAssessment(command.context, {
    dispatch,
    failure_evidence_refs: command.failure_evidence_refs,
  });
  if (assessmentResult.status !== "OK" || !assessmentResult.data) {
    return propagateFailure<RetryDecision>(assessmentResult);
  }
  const assessment = assessmentResult.data;
  if (!Array.isArray(assessment.evidence_refs) ||
      !sameRefSet(command.failure_evidence_refs, assessment.evidence_refs)) {
    return rejected(
      "INTEGRITY_OR_UNTRUSTED_INPUT",
      "Retry assessment did not verify the exact supplied failure evidence references",
      correlation_id,
    );
  }

  const decisionResult = decideRetry({
    retry_decision_ref: command.retry_decision_ref,
    dispatch,
    failure_classification: assessment.failure_classification,
    side_effect_class: assessment.side_effect_class,
    retryable_failure: assessment.retryable_failure,
    next_attempt_number: assessment.next_attempt_number,
    eligibility_expires_at: assessment.eligibility_expires_at,
    policy_decision_ref: assessment.policy_decision_ref,
    reconciliation_ref: assessment.reconciliation_ref,
    decided_at: command.decided_at,
  });
  if (!decisionResult.ok) {
    return rejected(
      mapDomainCode(decisionResult.issues[0].code),
      decisionResult.issues.map((issue) => issue.safe_message).join("; "),
      correlation_id,
    );
  }
  const decision = decisionResult.value;
  if (decision.disposition === "RECONCILE_FIRST" && !command.event_ref) {
    return rejected(
      "VALIDATION_ERROR",
      "A reconciliation-required retry decision needs an outbox event reference",
      correlation_id,
    );
  }
  if (decision.disposition !== "RECONCILE_FIRST" && command.event_ref) {
    return rejected(
      "VALIDATION_ERROR",
      "A reconciliation outbox event is only valid for a RECONCILE_FIRST decision",
      correlation_id,
    );
  }

  return unitOfWork.execute(command.context, async (transaction) => {
    const prior = await transaction.idempotency.get<RetryDecision>(
      command.context,
      command.context.idempotency_key!,
    );
    if (prior.status !== "OK") return propagateFailure<RetryDecision>(prior);
    if (prior.data) {
      if (prior.data.request_fingerprint !== command.request_fingerprint) {
        return rejected(
          "IDEMPOTENCY_CONFLICT",
          "Retry idempotency key was already used for a different request",
          correlation_id,
        );
      }
      return prior.data.result;
    }

    const currentDispatch = await transaction.repository<DispatchAttempt>(
      "inv-04.dispatch-attempts",
    ).get(command.context, command.dispatch_ref);
    if (currentDispatch.status !== "OK" || !currentDispatch.data) {
      return propagateFailure<RetryDecision>(currentDispatch);
    }
    if (!currentDispatch.object_version ||
        currentDispatch.object_version !== dispatchRead.object_version ||
        !sameObjectRef(currentDispatch.data.dispatch_ref, command.dispatch_ref) ||
        currentDispatch.data.state !== dispatch.state) {
      return rejected(
        "VERSION_CONFLICT",
        "Dispatch changed while retry evidence was being assessed; reload before deciding",
        correlation_id,
      );
    }

    const decisions = transaction.appendOnly<RetryDecision>("inv-04.retry-decisions");
    const existing = await decisions.get(command.context, command.retry_decision_ref);
    if (existing.status === "OK" && existing.data) {
      return rejected(
        "VERSION_CONFLICT",
        "Retry decision reference already identifies an immutable decision",
        correlation_id,
      );
    }
    if (existing.status !== "REJECTED" ||
        !existing.errors.some((error) => error.code === "NOT_FOUND_OR_NOT_VISIBLE")) {
      return propagateFailure<RetryDecision>(existing);
    }

    const saved = await decisions.append(command.context, decision);
    if (saved.status !== "OK" || !saved.data) return propagateFailure<RetryDecision>(saved);
    if (!sameObjectRef(saved.data.retry_decision_ref, decision.retry_decision_ref)) {
      return rejected(
        "INTEGRITY_OR_UNTRUSTED_INPUT",
        "Retry decision repository returned a different immutable record identity",
        correlation_id,
      );
    }

    if (decision.disposition === "RECONCILE_FIRST") {
      const event: DomainEventEnvelope = {
        event_id: command.event_ref!.object_id,
        event_type: "orchestration.reconciliation_required",
        schema_version: 1,
        occurred_at: command.decided_at,
        producer_engine: "INV-04",
        object_ref: dispatch.orchestration_ref,
        scope_ref: dispatch.dispatch_ref.scope_ref,
        correlation_id,
        actor_ref: command.context.actor_ref,
        payload: {
          retry_decision_ref: decision.retry_decision_ref,
          dispatch_ref: decision.dispatch_ref,
          failure_evidence_refs: command.failure_evidence_refs,
          reconciliation_ref: decision.reconciliation_ref,
          disposition: decision.disposition,
          reason_code: decision.reason_code,
        },
      };
      const emitted = await transaction.outbox.append(command.context, event);
      if (emitted.status !== "OK") return propagateFailure<RetryDecision>(emitted);
    }

    const result = createOperationResult({
      status: "OK",
      correlation_id,
      data: decision,
    });
    const recorded = await transaction.idempotency.record(command.context, {
      idempotency_key: command.context.idempotency_key!,
      request_fingerprint: command.request_fingerprint,
      result,
      recorded_at: command.decided_at,
    } satisfies IdempotencyRecord<RetryDecision>);
    if (recorded.status !== "OK") return propagateFailure<RetryDecision>(recorded);
    return result;
  });
}
