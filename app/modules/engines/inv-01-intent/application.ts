import {
  createOperationError,
  createOperationResult,
  isObjectRef,
  type EngineUnitOfWorkPort,
  type DomainEventEnvelope,
  type ObjectRef,
  type OperationErrorCode,
  type OperationResult,
} from "../shared";
import {
  normalizeIntent,
  type NormalizeIntentInput,
  type NormalizedIntent,
  type DomainIssue,
} from "./domain";

export interface SubmitIntentCommand extends NormalizeIntentInput {
  request_fingerprint: string;
  event_ref: ObjectRef;
}

function mapDomainCode(code: DomainIssue["code"]): OperationErrorCode {
  switch (code) {
    case "INVALID_TRANSITION":
      return "VALIDATION_ERROR";
    case "VALIDATION_ERROR":
    case "VERSION_CONFLICT":
    case "INTEGRITY_OR_UNTRUSTED_INPUT":
      return code;
  }
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

/**
 * INV-01 submit use case.
 *
 * Normalization remains a pure domain operation. Persistence, idempotency and
 * event publication are coordinated by one atomic unit of work. No downstream
 * engine is invoked here; the returned route/decision remains a proposal.
 */
export async function submitIntent(
  unitOfWork: EngineUnitOfWorkPort,
  command: SubmitIntentCommand,
): Promise<OperationResult<NormalizedIntent>> {
  const context = command.context;
  const correlationId = context.correlation_id;
  if (!context.idempotency_key) {
    return rejected("VALIDATION_ERROR", "Intent submission requires an idempotency key", correlationId);
  }
  if (!/^[a-f0-9]{64}$/i.test(command.request_fingerprint)) {
    return rejected("VALIDATION_ERROR", "request_fingerprint must be a SHA-256 hex digest", correlationId);
  }
  if (!isObjectRef(command.event_ref) || command.event_ref.object_kind !== "DOMAIN_EVENT") {
    return rejected("VALIDATION_ERROR", "Intent submission requires a DOMAIN_EVENT reference", correlationId);
  }

  const normalized = normalizeIntent(command);
  if (!normalized.ok) {
    return rejected(
      mapDomainCode(normalized.issues[0].code),
      normalized.issues.map((issue) => issue.safe_message).join("; "),
      correlationId,
    );
  }

  return unitOfWork.execute(context, async (transaction) => {
    const prior = await transaction.idempotency.get<NormalizedIntent>(
      context,
      context.idempotency_key!,
    );
    if (prior.status !== "OK") return propagateFailure<NormalizedIntent>(prior);
    if (prior.data) {
      if (prior.data.request_fingerprint !== command.request_fingerprint) {
        return rejected("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different intent submission", correlationId);
      }
      return prior.data.result;
    }

    const created = await transaction.repository<NormalizedIntent>("inv-01.normalized-intents")
      .create(context, normalized.value.intent_ref, normalized.value);
    if (created.status !== "OK" || !created.data) {
      return propagateFailure<NormalizedIntent>(created);
    }

    const event: DomainEventEnvelope = {
      event_id: command.event_ref.object_id,
      event_type: "intent.normalized",
      schema_version: 1,
      occurred_at: normalized.value.created_at,
      producer_engine: "INV-01",
      object_ref: normalized.value.intent_ref,
      scope_ref: context.scope_ref,
      correlation_id: context.correlation_id,
      actor_ref: context.actor_ref,
      payload: {
        intent_revision: normalized.value.revision_number,
        lifecycle_state: normalized.value.lifecycle_state,
        requested_work_kind: normalized.value.requested_work_kind,
      },
    };
    const emitted = await transaction.outbox.append(context, event);
    if (emitted.status !== "OK") return propagateFailure<NormalizedIntent>(emitted);

    const result = createOperationResult({
      status: "OK",
      correlation_id: correlationId,
      data: created.data,
      object_version: created.data.intent_ref.object_version,
    });
    const recorded = await transaction.idempotency.record(context, {
      idempotency_key: context.idempotency_key!,
      request_fingerprint: command.request_fingerprint,
      result,
      recorded_at: normalized.value.created_at,
    });
    if (recorded.status !== "OK") return propagateFailure<NormalizedIntent>(recorded);
    return result;
  });
}
