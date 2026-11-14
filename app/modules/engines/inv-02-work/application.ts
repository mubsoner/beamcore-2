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
import {
  acceptOutcomeProposal as acceptOutcomeProposalDomain,
  applyPlanGraphActivation,
  createWork,
  transitionWork,
  type AcceptOutcomeProposalCommand,
  type AcceptOutcomeProposalResult,
  type WorkDesiredOutcomeRevision,
  type WorkRecord,
  type WorkRevision,
  type WorkTransitionCommand,
  type WorkDomainIssue,
  type PlanGraphActivationBindingReceipt,
} from "./domain";
import type { GraphActivationCandidateReaderPort } from "../inv-03-planning/application";

export interface CreateWorkCommand {
  context: RequestContext;
  work_ref: ObjectRef;
  origin_intent_ref: ObjectRef;
  owner_ref: ObjectRef;
  title: string;
  summary: string;
  created_at: string;
  request_fingerprint: string;
  event_ref: ObjectRef;
}

export interface TransitionWorkApplicationCommand {
  context: RequestContext;
  work_ref: ObjectRef;
  transition: WorkTransitionCommand;
  request_fingerprint: string;
  event_ref: ObjectRef;
}

export interface AcceptWorkOutcomeApplicationCommand
  extends Omit<AcceptOutcomeProposalCommand, "context" | "work"> {
  context: RequestContext;
  work_ref: ObjectRef;
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
  const isUnexpectedSuccess = source.status === "OK";
  return createOperationResult<T>({
    status: isUnexpectedSuccess ? "UNKNOWN" : source.status,
    correlation_id: source.correlation_id,
    errors: isUnexpectedSuccess
      ? [createOperationError("INTERNAL_ERROR", "A dependency returned success without the required record", false)]
      : source.errors,
    warnings: source.warnings,
    ...(source.object_version !== undefined ? { object_version: source.object_version } : {}),
  });
}

function mapDomainCode(code: WorkDomainIssue["code"]): OperationErrorCode {
  switch (code) {
    case "VALIDATION_ERROR":
      return "VALIDATION_ERROR";
    case "VERSION_CONFLICT":
      return "VERSION_CONFLICT";
    case "FORBIDDEN":
      return "FORBIDDEN";
    case "APPROVAL_REQUIRED":
      return "APPROVAL_REQUIRED";
    case "INTEGRITY_OR_UNTRUSTED_INPUT":
      return "INTEGRITY_OR_UNTRUSTED_INPUT";
    case "OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED":
      return "OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED";
    case "INVALID_TRANSITION":
      return "VALIDATION_ERROR";
  }
}

function validateCommandEnvelope(
  context: RequestContext,
  request_fingerprint: string,
  event_ref: ObjectRef,
): string | undefined {
  if (!isRequestContext(context)) {
    return "Work mutation requires a valid canonical request context";
  }
  if (!context.idempotency_key?.trim()) {
    return "Work mutation requires an idempotency key";
  }
  if (!isObjectRef(event_ref) || event_ref.object_kind !== "DOMAIN_EVENT") {
    return "Work mutation requires a valid DOMAIN_EVENT reference";
  }
  if (
    event_ref.scope_ref.scope_id !== context.scope_ref.scope_id ||
    event_ref.scope_ref.scope_kind !== context.scope_ref.scope_kind
  ) {
    return "Domain event reference must be in the request scope";
  }
  if (!/^[a-f0-9]{64}$/i.test(request_fingerprint)) {
    return "request_fingerprint must be a SHA-256 hex digest";
  }
  return undefined;
}

/**
 * Creates Work, its first immutable revision, an outbox event and the
 * idempotency result in one atomic unit of work.
 */
export async function submitWork(
  unitOfWork: EngineUnitOfWorkPort,
  command: CreateWorkCommand,
): Promise<OperationResult<WorkRecord>> {
  const correlation_id = command.context.correlation_id;
  const envelopeIssue = validateCommandEnvelope(
    command.context,
    command.request_fingerprint,
    command.event_ref,
  );
  if (envelopeIssue) {
    return rejected("VALIDATION_ERROR", envelopeIssue, correlation_id);
  }

  const created = createWork(command);
  if (!created.ok) {
    return rejected(
      mapDomainCode(created.issues[0].code),
      created.issues.map((issue) => issue.safe_message).join("; "),
      correlation_id,
    );
  }

  const work = created.value;
  const revision: WorkRevision = {
    revision_ref: {
      object_kind: "WORK_REVISION",
      object_id: `${work.work_ref.object_id}:r1`,
      object_version: "1",
      scope_ref: work.work_ref.scope_ref,
    },
    work_ref: work.work_ref,
    revision_number: 1,
    changed_field_paths: ["created"],
    intent_ref: work.origin_intent_ref,
    changed_by: command.context.actor_ref,
    change_reason: "Work created from accepted intent context",
    created_at: work.created_at,
  };

  return unitOfWork.execute(command.context, async (transaction) => {
    const prior = await transaction.idempotency.get<WorkRecord>(
      command.context,
      command.context.idempotency_key!,
    );
    if (prior.status !== "OK") return propagateFailure<WorkRecord>(prior);
    if (prior.data) {
      if (prior.data.request_fingerprint !== command.request_fingerprint) {
        return rejected(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was already used for a different Work submission",
          correlation_id,
        );
      }
      return prior.data.result;
    }

    const persisted = await transaction.repository<WorkRecord>("inv-02.works")
      .create(command.context, work.work_ref, work);
    if (persisted.status !== "OK" || !persisted.data) {
      return propagateFailure<WorkRecord>(persisted);
    }

    const revisionResult = await transaction.appendOnly<WorkRevision>("inv-02.work-revisions")
      .append(command.context, revision);
    if (revisionResult.status !== "OK") {
      return propagateFailure<WorkRecord>(revisionResult);
    }

    const event: DomainEventEnvelope = {
      event_id: command.event_ref.object_id,
      event_type: "work.created",
      schema_version: 1,
      occurred_at: work.created_at,
      producer_engine: "INV-02",
      object_ref: work.work_ref,
      scope_ref: work.scope_ref,
      correlation_id,
      actor_ref: command.context.actor_ref,
      payload: {
        work_revision_ref: revision.revision_ref,
        origin_intent_ref: work.origin_intent_ref,
        lifecycle_state: work.lifecycle_state,
      },
    };
    const emitted = await transaction.outbox.append(command.context, event);
    if (emitted.status !== "OK") return propagateFailure<WorkRecord>(emitted);

    const result = createOperationResult({
      status: "OK",
      correlation_id,
      data: persisted.data,
      object_version: String(persisted.data.current_revision),
    });
    const recorded = await transaction.idempotency.record(command.context, {
      idempotency_key: command.context.idempotency_key!,
      request_fingerprint: command.request_fingerprint,
      result,
      recorded_at: work.created_at,
    });
    if (recorded.status !== "OK") return propagateFailure<WorkRecord>(recorded);
    return result;
  });
}

/**
 * Applies a guarded lifecycle transition using an optimistic repository
 * version, then stores its immutable revision and event in the same unit of work.
 */
export async function changeWorkState(
  unitOfWork: EngineUnitOfWorkPort,
  command: TransitionWorkApplicationCommand,
): Promise<OperationResult<WorkRecord>> {
  const correlation_id = command.context.correlation_id;
  const envelopeIssue = validateCommandEnvelope(
    command.context,
    command.request_fingerprint,
    command.event_ref,
  );
  if (envelopeIssue) {
    return rejected("VALIDATION_ERROR", envelopeIssue, correlation_id);
  }
  if (
    !isObjectRef(command.work_ref) ||
    command.work_ref.object_kind !== "WORK" ||
    command.work_ref.scope_ref.scope_id !== command.context.scope_ref.scope_id ||
    command.work_ref.scope_ref.scope_kind !== command.context.scope_ref.scope_kind
  ) {
    return rejected("VALIDATION_ERROR", "work_ref must identify a WORK object in the request scope", correlation_id);
  }

  return unitOfWork.execute(command.context, async (transaction) => {
    const prior = await transaction.idempotency.get<WorkRecord>(
      command.context,
      command.context.idempotency_key!,
    );
    if (prior.status !== "OK") return propagateFailure<WorkRecord>(prior);
    if (prior.data) {
      if (prior.data.request_fingerprint !== command.request_fingerprint) {
        return rejected(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was already used for a different Work transition",
          correlation_id,
        );
      }
      return prior.data.result;
    }

    const current = await transaction.repository<WorkRecord>("inv-02.works")
      .get(command.context, command.work_ref);
    if (current.status !== "OK" || !current.data) {
      return propagateFailure<WorkRecord>(current);
    }
    if (
      current.data.work_ref.object_kind !== command.work_ref.object_kind ||
      current.data.work_ref.object_id !== command.work_ref.object_id ||
      current.data.work_ref.scope_ref.scope_id !== command.work_ref.scope_ref.scope_id ||
      current.data.work_ref.scope_ref.scope_kind !== command.work_ref.scope_ref.scope_kind
    ) {
      return rejected("INTEGRITY_OR_UNTRUSTED_INPUT", "Repository returned a Work object that does not match the requested identity", correlation_id);
    }

    const transitioned = transitionWork(current.data, command.transition, command.context);
    if (!transitioned.ok) {
      return rejected(
        mapDomainCode(transitioned.issues[0].code),
        transitioned.issues.map((issue) => issue.safe_message).join("; "),
        correlation_id,
      );
    }

    const updated = await transaction.repository<WorkRecord>("inv-02.works")
      .update(
        command.context,
        command.work_ref,
        String(command.transition.expected_version),
        transitioned.value.work,
      );
    if (updated.status !== "OK" || !updated.data) {
      return propagateFailure<WorkRecord>(updated);
    }

    const revisionResult = await transaction.appendOnly<WorkRevision>("inv-02.work-revisions")
      .append(command.context, transitioned.value.revision);
    if (revisionResult.status !== "OK") {
      return propagateFailure<WorkRecord>(revisionResult);
    }

    const event: DomainEventEnvelope = {
      event_id: command.event_ref.object_id,
      event_type: "work.lifecycle_changed",
      schema_version: 1,
      occurred_at: command.transition.occurred_at,
      producer_engine: "INV-02",
      object_ref: updated.data.work_ref,
      scope_ref: updated.data.scope_ref,
      correlation_id,
      actor_ref: command.context.actor_ref,
      payload: {
        work_revision_ref: transitioned.value.revision.revision_ref,
        prior_state: current.data.lifecycle_state,
        lifecycle_state: updated.data.lifecycle_state,
        authority_decision_ref: command.transition.authority.decision_ref,
        reason_ref: command.transition.reason_ref,
      },
    };
    const emitted = await transaction.outbox.append(command.context, event);
    if (emitted.status !== "OK") return propagateFailure<WorkRecord>(emitted);

    const result = createOperationResult({
      status: "OK",
      correlation_id,
      data: updated.data,
      object_version: String(updated.data.current_revision),
    });
    const recorded = await transaction.idempotency.record(command.context, {
      idempotency_key: command.context.idempotency_key!,
      request_fingerprint: command.request_fingerprint,
      result,
      recorded_at: command.transition.occurred_at,
    } satisfies IdempotencyRecord<WorkRecord>);
    if (recorded.status !== "OK") return propagateFailure<WorkRecord>(recorded);
    return result;
  });
}


export interface ApplyPlanGraphActivationCommand {
  context: RequestContext;
  request_ref: ObjectRef;
  receipt_ref: ObjectRef;
  received_at: string;
  request_fingerprint: string;
  event_ref: ObjectRef;
}

export interface ActivePlanGraphBinding {
  work_ref: ObjectRef;
  work_revision: number;
  binding_state: "UNBOUND" | "BOUND";
  plan_revision_ref?: ObjectRef;
  graph_revision_ref?: ObjectRef;
}

function sameObjectRef(a: ObjectRef, b: ObjectRef): boolean {
  return a.object_kind === b.object_kind &&
    a.object_id === b.object_id &&
    a.object_version === b.object_version &&
    a.scope_ref.scope_id === b.scope_ref.scope_id &&
    a.scope_ref.scope_kind === b.scope_ref.scope_kind;
}

/**
 * Consumes an INV-03 activation request. INV-02 remains the sole owner of
 * Work's active Plan/Graph pointers and commits the Work revision, activation
 * receipt, outbox event and idempotency result in one unit of work.
 *
 * Approval references are deliberately fail-closed until an INV-06 approval
 * decision reader is wired into this transaction boundary.
 */
export async function applyRequestedPlanGraphActivation(
  unitOfWork: EngineUnitOfWorkPort,
  activationReader: GraphActivationCandidateReaderPort,
  command: ApplyPlanGraphActivationCommand,
): Promise<OperationResult<WorkRecord>> {
  const correlation_id = command.context.correlation_id;
  const envelopeIssue = validateCommandEnvelope(
    command.context,
    command.request_fingerprint,
    command.event_ref,
  );
  if (envelopeIssue) {
    return rejected("VALIDATION_ERROR", envelopeIssue, correlation_id);
  }
  if (
    !isObjectRef(command.request_ref) ||
    command.request_ref.object_kind !== "GRAPH_ACTIVATION_REQUEST" ||
    !isObjectRef(command.receipt_ref) ||
    command.receipt_ref.object_kind !== "PLAN_GRAPH_ACTIVATION_RECEIPT" ||
    !isTimestamp(command.received_at) ||
    command.request_ref.scope_ref.scope_id !== command.context.scope_ref.scope_id ||
    command.request_ref.scope_ref.scope_kind !== command.context.scope_ref.scope_kind ||
    command.receipt_ref.scope_ref.scope_id !== command.context.scope_ref.scope_id ||
    command.receipt_ref.scope_ref.scope_kind !== command.context.scope_ref.scope_kind
  ) {
    return rejected(
      "VALIDATION_ERROR",
      "Activation requires in-scope request and receipt references and a valid receipt timestamp",
      correlation_id,
    );
  }

  const priorResult = await unitOfWork.execute(command.context, (transaction) =>
    transaction.idempotency.get<WorkRecord>(command.context, command.context.idempotency_key!),
  );
  if (priorResult.status !== "OK" || priorResult.data === undefined) {
    return propagateFailure<WorkRecord>(priorResult);
  }
  if (priorResult.data) {
    if (priorResult.data.request_fingerprint !== command.request_fingerprint) {
      return rejected(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was already used for a different Plan/Graph activation",
        correlation_id,
      );
    }
    return priorResult.data.result;
  }

  // INV-03 reads through its own owner-managed Unit of Work. The caller's
  // transaction never crosses the engine boundary.
  const candidateResult = await activationReader.readCandidate(command.context, command.request_ref);
  if (candidateResult.status !== "OK" || !candidateResult.data) {
    return propagateFailure<WorkRecord>(candidateResult);
  }

  return unitOfWork.execute(command.context, async (transaction) => {
    const prior = await transaction.idempotency.get<WorkRecord>(
      command.context,
      command.context.idempotency_key!,
    );
    if (prior.status !== "OK") return propagateFailure<WorkRecord>(prior);
    if (prior.data) {
      if (prior.data.request_fingerprint !== command.request_fingerprint) {
        return rejected(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was already used for a different Plan/Graph activation",
          correlation_id,
        );
      }
      return prior.data.result;
    }

    const { request, plan, plan_record: planRecord, graph, graph_record: graphRecord } = candidateResult.data;
    if (
      !sameObjectRef(request.request_ref, command.request_ref) ||
      !isObjectRef(request.work_ref) ||
      request.work_ref.object_kind !== "WORK" ||
      !isObjectRef(request.plan_revision_ref) ||
      request.plan_revision_ref.object_kind !== "PLAN_REVISION" ||
      !isObjectRef(request.graph_revision_ref) ||
      request.graph_revision_ref.object_kind !== "WORK_GRAPH_REVISION" ||
      !Number.isSafeInteger(request.expected_work_revision) ||
      request.expected_work_revision < 1 ||
      !Array.isArray(request.approval_refs) ||
      !request.approval_refs.every((approval_ref) =>
        isObjectRef(approval_ref) &&
        approval_ref.scope_ref.scope_id === request.work_ref.scope_ref.scope_id &&
        approval_ref.scope_ref.scope_kind === request.work_ref.scope_ref.scope_kind
      ) ||
      request.work_ref.scope_ref.scope_id !== command.context.scope_ref.scope_id ||
      request.work_ref.scope_ref.scope_kind !== command.context.scope_ref.scope_kind ||
      !isTimestamp(request.requested_at) ||
      Date.parse(command.received_at) <= Date.parse(request.requested_at)
    ) {
      return rejected(
        "INTEGRITY_OR_UNTRUSTED_INPUT",
        "Stored activation request is invalid, out of scope, or does not match its reference",
        correlation_id,
      );
    }

    if (request.approval_refs.length > 0) {
      return rejected(
        "APPROVAL_REQUIRED",
        "Activation references approval evidence that INV-06 has not yet verified; Work binding was not changed",
        correlation_id,
      );
    }

    const current = await transaction.repository<WorkRecord>("inv-02.works")
      .get(command.context, request.work_ref);
    if (current.status !== "OK" || !current.data) {
      return propagateFailure<WorkRecord>(current);
    }
    if (!current.object_version) {
      return rejected(
        "INTERNAL_ERROR",
        "Work repository did not provide the storage version required for a safe activation update",
        correlation_id,
      );
    }
    if (
      !sameObjectRef(current.data.work_ref, request.work_ref) ||
      current.data.current_revision !== request.expected_work_revision ||
      current.object_version !== String(request.expected_work_revision)
    ) {
      return rejected(
        "VERSION_CONFLICT",
        "Work identity or revision changed after the Plan/Graph activation request",
        correlation_id,
      );
    }

    if (
      !sameObjectRef(plan.plan_revision_ref, request.plan_revision_ref) ||
      !sameObjectRef(plan.work_ref, request.work_ref) ||
      plan.state !== "ACCEPTED" ||
      !sameObjectRef(planRecord.plan_ref, plan.plan_ref) ||
      !sameObjectRef(planRecord.work_ref, request.work_ref) ||
      !sameObjectRef(planRecord.latest_revision_ref, plan.plan_revision_ref) ||
      !sameObjectRef(graph.graph_revision_ref, request.graph_revision_ref) ||
      !sameObjectRef(graph.work_ref, request.work_ref) ||
      graph.state !== "VALIDATED" ||
      !sameObjectRef(graph.source_plan_revision_ref, plan.plan_revision_ref) ||
      !sameObjectRef(graphRecord.graph_ref, graph.graph_ref) ||
      !sameObjectRef(graphRecord.work_ref, request.work_ref) ||
      !sameObjectRef(graphRecord.latest_revision_ref, graph.graph_revision_ref)
    ) {
      return rejected(
        "VERSION_CONFLICT",
        "Activation no longer references the latest accepted Plan and validated Graph for this Work",
        correlation_id,
      );
    }

    const receipt: PlanGraphActivationBindingReceipt = {
      receipt_ref: command.receipt_ref,
      request_ref: request.request_ref,
      work_ref: request.work_ref,
      plan_revision_ref: request.plan_revision_ref,
      graph_revision_ref: request.graph_revision_ref,
      expected_work_revision: request.expected_work_revision,
      resulting_work_revision: request.expected_work_revision + 1,
      receipt_state: "ACCEPTED",
      received_at: command.received_at,
    };
    const applied = applyPlanGraphActivation(
      current.data,
      receipt,
      request.expected_work_revision,
    );
    if (!applied.ok) {
      return rejected(
        mapDomainCode(applied.issues[0].code),
        applied.issues.map((issue) => issue.safe_message).join("; "),
        correlation_id,
      );
    }

    const updated = await transaction.repository<WorkRecord>("inv-02.works")
      .update(
        command.context,
        request.work_ref,
        current.object_version,
        applied.value,
      );
    if (updated.status !== "OK" || !updated.data) {
      return propagateFailure<WorkRecord>(updated);
    }
    if (
      !sameObjectRef(updated.data.work_ref, request.work_ref) ||
      updated.data.current_revision !== receipt.resulting_work_revision ||
      !updated.data.current_plan_ref ||
      !sameObjectRef(updated.data.current_plan_ref, request.plan_revision_ref) ||
      !updated.data.current_work_graph_ref ||
      !sameObjectRef(updated.data.current_work_graph_ref, request.graph_revision_ref)
    ) {
      return rejected(
        "INTEGRITY_OR_UNTRUSTED_INPUT",
        "Work repository did not confirm the exact activated Plan/Graph binding",
        correlation_id,
      );
    }

    const revision: WorkRevision = {
      revision_ref: {
        object_kind: "WORK_REVISION",
        object_id: `${request.work_ref.object_id}:r${receipt.resulting_work_revision}`,
        object_version: String(receipt.resulting_work_revision),
        scope_ref: request.work_ref.scope_ref,
      },
      work_ref: request.work_ref,
      revision_number: receipt.resulting_work_revision,
      prior_revision_ref: {
        object_kind: "WORK_REVISION",
        object_id: `${request.work_ref.object_id}:r${request.expected_work_revision}`,
        object_version: String(request.expected_work_revision),
        scope_ref: request.work_ref.scope_ref,
      },
      changed_field_paths: ["current_plan_ref", "current_work_graph_ref"],
      plan_ref: request.plan_revision_ref,
      work_graph_ref: request.graph_revision_ref,
      changed_by: command.context.actor_ref,
      change_reason: "Accepted the requested Plan/Work Graph activation binding",
      created_at: command.received_at,
    };
    const revisionResult = await transaction
      .appendOnly<WorkRevision>("inv-02.work-revisions")
      .append(command.context, revision);
    if (revisionResult.status !== "OK") {
      return propagateFailure<WorkRecord>(revisionResult);
    }

    const receiptResult = await transaction
      .appendOnly<PlanGraphActivationBindingReceipt>("inv-02.plan-graph-activation-receipts")
      .append(command.context, receipt);
    if (receiptResult.status !== "OK") {
      return propagateFailure<WorkRecord>(receiptResult);
    }

    const event: DomainEventEnvelope = {
      event_id: command.event_ref.object_id,
      event_type: "work.plan_graph_binding_activated",
      schema_version: 1,
      occurred_at: command.received_at,
      producer_engine: "INV-02",
      object_ref: updated.data.work_ref,
      scope_ref: updated.data.scope_ref,
      correlation_id,
      actor_ref: command.context.actor_ref,
      payload: {
        request_ref: request.request_ref,
        receipt_ref: receipt.receipt_ref,
        work_revision_ref: revision.revision_ref,
        plan_revision_ref: request.plan_revision_ref,
        graph_revision_ref: request.graph_revision_ref,
        prior_work_revision: request.expected_work_revision,
        resulting_work_revision: receipt.resulting_work_revision,
      },
    };
    const emitted = await transaction.outbox.append(command.context, event);
    if (emitted.status !== "OK") return propagateFailure<WorkRecord>(emitted);

    const result = createOperationResult({
      status: "OK",
      correlation_id,
      data: updated.data,
      object_version: String(updated.data.current_revision),
    });
    const recorded = await transaction.idempotency.record(command.context, {
      idempotency_key: command.context.idempotency_key!,
      request_fingerprint: command.request_fingerprint,
      result,
      recorded_at: command.received_at,
    } satisfies IdempotencyRecord<WorkRecord>);
    if (recorded.status !== "OK") return propagateFailure<WorkRecord>(recorded);
    return result;
  });
}

/**
 * Reads the active Plan/Graph pointers from the authoritative INV-02 Work
 * record. A newer draft may exist, but it does not replace this binding until
 * INV-02 accepts and applies a later activation request.
 */
export async function getActivePlanGraphBinding(
  unitOfWork: EngineUnitOfWorkPort,
  activationReader: GraphActivationCandidateReaderPort,
  context: RequestContext,
  work_ref: ObjectRef,
): Promise<OperationResult<ActivePlanGraphBinding>> {
  const correlation_id = context.correlation_id;
  if (
    !isRequestContext(context) ||
    !isObjectRef(work_ref) ||
    work_ref.object_kind !== "WORK" ||
    work_ref.scope_ref.scope_id !== context.scope_ref.scope_id ||
    work_ref.scope_ref.scope_kind !== context.scope_ref.scope_kind
  ) {
    return rejected(
      "VALIDATION_ERROR",
      "Active Plan/Graph binding lookup requires an in-scope Work reference",
      correlation_id,
    );
  }

  const current = await unitOfWork.execute(context, (transaction) =>
    transaction.repository<WorkRecord>("inv-02.works").get(context, work_ref),
  );
  if (current.status !== "OK" || !current.data) {
    return propagateFailure<ActivePlanGraphBinding>(current);
  }
  if (!sameObjectRef(current.data.work_ref, work_ref)) {
    return rejected(
      "INTEGRITY_OR_UNTRUSTED_INPUT",
      "Work repository returned a different identity than the requested Work",
      correlation_id,
    );
  }

  const plan = current.data.current_plan_ref;
  const graph = current.data.current_work_graph_ref;
  if (!plan && !graph) {
    return createOperationResult<ActivePlanGraphBinding>({
      status: "OK",
      correlation_id,
      data: {
        work_ref: current.data.work_ref,
        work_revision: current.data.current_revision,
        binding_state: "UNBOUND",
      },
      object_version: current.object_version,
    });
  }
  if (
    !plan ||
    !graph ||
    !isObjectRef(plan) ||
    plan.object_kind !== "PLAN_REVISION" ||
    !isObjectRef(graph) ||
    graph.object_kind !== "WORK_GRAPH_REVISION" ||
    plan.scope_ref.scope_id !== current.data.scope_ref.scope_id ||
    plan.scope_ref.scope_kind !== current.data.scope_ref.scope_kind ||
    graph.scope_ref.scope_id !== current.data.scope_ref.scope_id ||
    graph.scope_ref.scope_kind !== current.data.scope_ref.scope_kind
  ) {
    return rejected(
      "INTEGRITY_OR_UNTRUSTED_INPUT",
      "Work contains an incomplete or invalid active Plan/Graph binding",
      correlation_id,
    );
  }

  const revisionsResult = await activationReader.readRevisions(context, plan, graph);
  if (revisionsResult.status !== "OK" || !revisionsResult.data) {
    return propagateFailure<ActivePlanGraphBinding>(revisionsResult);
  }
  const { plan: planRevision, graph: graphRevision } = revisionsResult.data;
  if (
    !sameObjectRef(planRevision.plan_revision_ref, plan) ||
    !sameObjectRef(planRevision.work_ref, work_ref) ||
    !sameObjectRef(graphRevision.graph_revision_ref, graph) ||
    !sameObjectRef(graphRevision.work_ref, work_ref) ||
    !sameObjectRef(graphRevision.source_plan_revision_ref, plan)
  ) {
    return rejected(
      "INTEGRITY_OR_UNTRUSTED_INPUT",
      "Active Work pointers do not resolve to a consistent Plan/Graph revision pair",
      correlation_id,
    );
  }

  return createOperationResult<ActivePlanGraphBinding>({
    status: "OK",
    correlation_id,
    data: {
      work_ref: current.data.work_ref,
      work_revision: current.data.current_revision,
      binding_state: "BOUND",
      plan_revision_ref: plan,
      graph_revision_ref: graph,
    },
    object_version: current.object_version,
  });
}
/**
 * Accepts an INV-01 outcome proposal and atomically updates the Work target.
 * When replacing a target, the old target is first marked SUPERSEDED in the
 * same unit of work; the new target, Work revision, receipt, event and
 * idempotency result commit together.
 */
export async function acceptWorkOutcome(
  unitOfWork: EngineUnitOfWorkPort,
  command: AcceptWorkOutcomeApplicationCommand,
): Promise<OperationResult<WorkRecord>> {
  const correlation_id = command.context.correlation_id;
  const envelopeIssue = validateCommandEnvelope(
    command.context,
    command.request_fingerprint,
    command.event_ref,
  );
  if (envelopeIssue) {
    return rejected("VALIDATION_ERROR", envelopeIssue, correlation_id);
  }
  if (
    !isObjectRef(command.work_ref) ||
    command.work_ref.object_kind !== "WORK" ||
    command.work_ref.scope_ref.scope_id !== command.context.scope_ref.scope_id ||
    command.work_ref.scope_ref.scope_kind !== command.context.scope_ref.scope_kind
  ) {
    return rejected("VALIDATION_ERROR", "work_ref must identify a WORK object in the request scope", correlation_id);
  }

  return unitOfWork.execute(command.context, async (transaction) => {
    const prior = await transaction.idempotency.get<WorkRecord>(
      command.context,
      command.context.idempotency_key!,
    );
    if (prior.status !== "OK") return propagateFailure<WorkRecord>(prior);
    if (prior.data) {
      if (prior.data.request_fingerprint !== command.request_fingerprint) {
        return rejected(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was already used for a different outcome acceptance",
          correlation_id,
        );
      }
      return prior.data.result;
    }

    const current = await transaction.repository<WorkRecord>("inv-02.works")
      .get(command.context, command.work_ref);
    if (current.status !== "OK" || !current.data) {
      return propagateFailure<WorkRecord>(current);
    }
    if (
      current.data.work_ref.object_kind !== command.work_ref.object_kind ||
      current.data.work_ref.object_id !== command.work_ref.object_id ||
      current.data.work_ref.scope_ref.scope_id !== command.work_ref.scope_ref.scope_id ||
      current.data.work_ref.scope_ref.scope_kind !== command.work_ref.scope_ref.scope_kind
    ) {
      return rejected("INTEGRITY_OR_UNTRUSTED_INPUT", "Repository returned a Work object that does not match the requested identity", correlation_id);
    }

    const accepted = acceptOutcomeProposalDomain({
      context: command.context,
      work: current.data,
      proposal: command.proposal,
      desired_outcome_ref: command.desired_outcome_ref,
      receipt_ref: command.receipt_ref,
      acceptance_basis: command.acceptance_basis,
      acceptance_basis_ref: command.acceptance_basis_ref,
      accepted_by: command.accepted_by,
      accepted_at: command.accepted_at,
      expected_work_version: command.expected_work_version,
      authority: command.authority,
      has_material_unresolved_unknowns: command.has_material_unresolved_unknowns,
      policy_interpretation_permitted: command.policy_interpretation_permitted,
      current_target_revision: command.current_target_revision,
    });
    if (!accepted.ok) {
      return rejected(
        mapDomainCode(accepted.issues[0].code),
        accepted.issues.map((issue) => issue.safe_message).join("; "),
        correlation_id,
      );
    }

    const outcomeRepository = transaction.repository<WorkDesiredOutcomeRevision>("inv-02.desired-outcomes");
    if (current.data.current_desired_outcome_ref) {
      const existing = await outcomeRepository.get(
        command.context,
        current.data.current_desired_outcome_ref,
      );
      if (existing.status !== "OK" || !existing.data) {
        return propagateFailure<WorkRecord>(existing);
      }
      const oldTarget = existing.data;
      if (
        oldTarget.desired_outcome_ref.object_kind !== current.data.current_desired_outcome_ref.object_kind ||
        oldTarget.desired_outcome_ref.object_id !== current.data.current_desired_outcome_ref.object_id ||
        oldTarget.desired_outcome_ref.object_version !== current.data.current_desired_outcome_ref.object_version ||
        oldTarget.desired_outcome_ref.scope_ref.scope_id !== current.data.current_desired_outcome_ref.scope_ref.scope_id ||
        oldTarget.desired_outcome_ref.scope_ref.scope_kind !== current.data.current_desired_outcome_ref.scope_ref.scope_kind ||
        oldTarget.state !== "ACTIVE" ||
        oldTarget.work_ref.object_kind !== current.data.work_ref.object_kind ||
        oldTarget.work_ref.object_id !== current.data.work_ref.object_id ||
        oldTarget.work_ref.scope_ref.scope_id !== current.data.work_ref.scope_ref.scope_id ||
        oldTarget.work_ref.scope_ref.scope_kind !== current.data.work_ref.scope_ref.scope_kind
      ) {
        return rejected("INTEGRITY_OR_UNTRUSTED_INPUT", "Current Desired Outcome pointer does not match its active stored revision", correlation_id);
      }
      if (command.current_target_revision !== oldTarget.revision_number + 1) {
        return rejected("VERSION_CONFLICT", "Desired Outcome revision changed; reload the current target before replacing it", correlation_id);
      }
      if (accepted.value.desired_outcome.desired_outcome_ref.object_id === oldTarget.desired_outcome_ref.object_id) {
        return rejected("VALIDATION_ERROR", "A replacement must create a new Desired Outcome revision reference", correlation_id);
      }
      const superseded = await outcomeRepository.update(
        command.context,
        oldTarget.desired_outcome_ref,
        oldTarget.desired_outcome_ref.object_version ?? String(oldTarget.revision_number),
        { ...oldTarget, state: "SUPERSEDED" },
      );
      if (superseded.status !== "OK" || superseded.data?.state !== "SUPERSEDED") {
        return superseded.status !== "OK"
          ? propagateFailure<WorkRecord>(superseded)
          : rejected("INTEGRITY_OR_UNTRUSTED_INPUT", "Repository did not confirm Desired Outcome supersession", correlation_id);
      }
    }

    const savedTarget = await outcomeRepository.create(
      command.context,
      accepted.value.desired_outcome.desired_outcome_ref,
      accepted.value.desired_outcome,
    );
    if (savedTarget.status !== "OK" || !savedTarget.data) {
      return propagateFailure<WorkRecord>(savedTarget);
    }
    if (
      savedTarget.data.desired_outcome_ref.object_id !== accepted.value.desired_outcome.desired_outcome_ref.object_id ||
      savedTarget.data.revision_number !== accepted.value.desired_outcome.revision_number ||
      savedTarget.data.state !== "ACTIVE"
    ) {
      return rejected("INTEGRITY_OR_UNTRUSTED_INPUT", "Repository returned a different Desired Outcome revision than the one accepted", correlation_id);
    }

    const updated = await transaction.repository<WorkRecord>("inv-02.works")
      .update(
        command.context,
        command.work_ref,
        String(command.expected_work_version),
        accepted.value.work,
      );
    if (updated.status !== "OK" || !updated.data) {
      return propagateFailure<WorkRecord>(updated);
    }
    if (
      updated.data.work_ref.object_id !== current.data.work_ref.object_id ||
      updated.data.current_revision !== accepted.value.work.current_revision ||
      updated.data.current_desired_outcome_ref?.object_id !== accepted.value.desired_outcome.desired_outcome_ref.object_id
    ) {
      return rejected("INTEGRITY_OR_UNTRUSTED_INPUT", "Repository did not confirm the accepted Work revision and Desired Outcome pointer", correlation_id);
    }

    const revisionResult = await transaction.appendOnly<WorkRevision>("inv-02.work-revisions")
      .append(command.context, accepted.value.revision);
    if (revisionResult.status !== "OK") {
      return propagateFailure<WorkRecord>(revisionResult);
    }

    const receiptResult = await transaction.appendOnly<AcceptOutcomeProposalResult["receipt"]>(
      "inv-02.outcome-acceptance-receipts",
    ).append(command.context, accepted.value.receipt);
    if (receiptResult.status !== "OK") {
      return propagateFailure<WorkRecord>(receiptResult);
    }

    const event: DomainEventEnvelope = {
      event_id: command.event_ref.object_id,
      event_type: "work.outcome_accepted",
      schema_version: 1,
      occurred_at: command.accepted_at,
      producer_engine: "INV-02",
      object_ref: updated.data.work_ref,
      scope_ref: updated.data.scope_ref,
      correlation_id,
      actor_ref: command.context.actor_ref,
      payload: {
        desired_outcome_ref: accepted.value.desired_outcome.desired_outcome_ref,
        acceptance_receipt_ref: accepted.value.receipt.receipt_ref,
        source_proposal_ref: accepted.value.receipt.proposal_ref,
        acceptance_basis: accepted.value.receipt.acceptance_basis,
        work_revision_ref: accepted.value.revision.revision_ref,
      },
    };
    const emitted = await transaction.outbox.append(command.context, event);
    if (emitted.status !== "OK") return propagateFailure<WorkRecord>(emitted);

    const result = createOperationResult({
      status: "OK",
      correlation_id,
      data: updated.data,
      object_version: String(updated.data.current_revision),
    });
    const recorded = await transaction.idempotency.record(command.context, {
      idempotency_key: command.context.idempotency_key!,
      request_fingerprint: command.request_fingerprint,
      result,
      recorded_at: command.accepted_at,
    });
    if (recorded.status !== "OK") return propagateFailure<WorkRecord>(recorded);
    return result;
  });
}
