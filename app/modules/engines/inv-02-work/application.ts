import {
  createOperationError,
  createOperationResult,
  isObjectRef,
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
  createWork,
  transitionWork,
  type AcceptOutcomeProposalCommand,
  type AcceptOutcomeProposalResult,
  type WorkDesiredOutcomeRevision,
  type WorkRecord,
  type WorkRevision,
  type WorkTransitionCommand,
  type WorkDomainIssue,
} from "./domain";

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
  if (!context.idempotency_key?.trim()) {
    return "Work mutation requires an idempotency key";
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
  if (!isObjectRef(event_ref) || event_ref.object_kind !== "DOMAIN_EVENT") {
    return "Work mutation requires a valid DOMAIN_EVENT reference";
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
    if (prior.status !== "OK") return prior as OperationResult<WorkRecord>;
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
      return persisted as OperationResult<WorkRecord>;
    }

    const revisionResult = await transaction.appendOnly<WorkRevision>("inv-02.work-revisions")
      .append(command.context, revision);
    if (revisionResult.status !== "OK") {
      return revisionResult as OperationResult<WorkRecord>;
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
    if (emitted.status !== "OK") return emitted as OperationResult<WorkRecord>;

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
    if (recorded.status !== "OK") return recorded as OperationResult<WorkRecord>;
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
    if (prior.status !== "OK") return prior as OperationResult<WorkRecord>;
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
      return current as OperationResult<WorkRecord>;
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
      return updated as OperationResult<WorkRecord>;
    }

    const revisionResult = await transaction.appendOnly<WorkRevision>("inv-02.work-revisions")
      .append(command.context, transitioned.value.revision);
    if (revisionResult.status !== "OK") {
      return revisionResult as OperationResult<WorkRecord>;
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
    if (emitted.status !== "OK") return emitted as OperationResult<WorkRecord>;

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
    if (recorded.status !== "OK") return recorded as OperationResult<WorkRecord>;
    return result;
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
    if (prior.status !== "OK") return prior as OperationResult<WorkRecord>;
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
      return current as OperationResult<WorkRecord>;
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
      ...command,
      work: current.data,
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
        return existing as OperationResult<WorkRecord>;
      }
      const oldTarget = existing.data;
      if (
        oldTarget.desired_outcome_ref.object_kind !== current.data.current_desired_outcome_ref.object_kind ||
        oldTarget.desired_outcome_ref.object_id !== current.data.current_desired_outcome_ref.object_id ||
        oldTarget.desired_outcome_ref.scope_ref.scope_id !== current.data.current_desired_outcome_ref.scope_ref.scope_id ||
        oldTarget.desired_outcome_ref.scope_ref.scope_kind !== current.data.current_desired_outcome_ref.scope_ref.scope_kind ||
        oldTarget.state !== "ACTIVE" ||
        oldTarget.work_ref.object_id !== current.data.work_ref.object_id
      ) {
        return rejected("INTEGRITY_OR_UNTRUSTED_INPUT", "Current Desired Outcome pointer does not match its active stored revision", correlation_id);
      }
      const superseded = await outcomeRepository.update(
        command.context,
        oldTarget.desired_outcome_ref,
        oldTarget.desired_outcome_ref.object_version ?? String(oldTarget.revision_number),
        { ...oldTarget, state: "SUPERSEDED" },
      );
      if (superseded.status !== "OK") {
        return superseded as OperationResult<WorkRecord>;
      }
    }

    const savedTarget = await outcomeRepository.create(
      command.context,
      accepted.value.desired_outcome.desired_outcome_ref,
      accepted.value.desired_outcome,
    );
    if (savedTarget.status !== "OK" || !savedTarget.data) {
      return savedTarget as OperationResult<WorkRecord>;
    }

    const updated = await transaction.repository<WorkRecord>("inv-02.works")
      .update(
        command.context,
        command.work_ref,
        String(command.expected_work_version),
        accepted.value.work,
      );
    if (updated.status !== "OK" || !updated.data) {
      return updated as OperationResult<WorkRecord>;
    }

    const revisionResult = await transaction.appendOnly<WorkRevision>("inv-02.work-revisions")
      .append(command.context, accepted.value.revision);
    if (revisionResult.status !== "OK") {
      return revisionResult as OperationResult<WorkRecord>;
    }

    const receiptResult = await transaction.appendOnly<AcceptOutcomeProposalResult["receipt"]>(
      "inv-02.outcome-acceptance-receipts",
    ).append(command.context, accepted.value.receipt);
    if (receiptResult.status !== "OK") {
      return receiptResult as OperationResult<WorkRecord>;
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
    if (emitted.status !== "OK") return emitted as OperationResult<WorkRecord>;

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
    if (recorded.status !== "OK") return recorded as OperationResult<WorkRecord>;
    return result;
  });
}
