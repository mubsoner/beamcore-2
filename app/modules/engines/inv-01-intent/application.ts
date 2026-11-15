import {
  createOperationError,
  createOperationResult,
  isObjectRef,
  isRequestContext,
  type DomainEventEnvelope,
  type EngineTransaction,
  type EngineUnitOfWorkPort,
  type IdempotencyRecord,
  type ObjectRef,
  type OperationErrorCode,
  type OperationResult,
  type RequestContext,
  type Timestamp,
} from "../shared";
import {
  applyOutcomeAcceptanceReceipt,
  createClarificationRequest,
  createDecisionRecord,
  createOutcomeProposal,
  createRouteProposal,
  normalizeIntent,
  transitionIntent,
  type AcceptanceCriterion,
  type ClarificationRequest,
  type DecisionDisposition,
  type DecisionRecord,
  type IntentEvaluationResult,
  type NormalizedIntent,
  type OutcomeProposal,
  type RouteProposal,
  type NormalizeIntentInput,
  type DomainIssue,
} from "./domain";

export interface ClarificationProposalInput {
  clarification_ref: ObjectRef;
  question: string;
  decision_impact: string;
  required_field_ids: string[];
  expires_at?: Timestamp;
}

export interface OutcomeProposalInput {
  proposal_ref: ObjectRef;
  proposal_revision: number;
  desired_effect: string;
  acceptance_criteria: AcceptanceCriterion[];
  assumption_refs: ObjectRef[];
  unresolved_criterion_refs: ObjectRef[];
  supersedes_proposal_ref?: ObjectRef;
}

export interface RouteProposalInput {
  route_ref: ObjectRef;
  target_engine_id?: "INV-02" | "INV-03" | "INV-06" | "INV-07" | "INV-08" | "INV-13";
  target_operation?: string;
  input_refs: ObjectRef[];
  required_authority_check: boolean;
}

export interface IntentEventReferences {
  intent_normalized: ObjectRef;
  decision_recorded: ObjectRef;
  clarification_requested?: ObjectRef;
  outcome_proposal_created?: ObjectRef;
  route_selected?: ObjectRef;
}

export interface SubmitIntentCommand extends NormalizeIntentInput {
  decision_ref: ObjectRef;
  disposition: DecisionDisposition;
  rationale_summary: string;
  event_refs: IntentEventReferences;
  request_fingerprint: string;
  clarification?: ClarificationProposalInput;
  outcome_proposal?: OutcomeProposalInput;
  route_proposal?: RouteProposalInput;
  policy_decision_refs?: ObjectRef[];
  authority_decision_refs?: ObjectRef[];
  capability_refs?: ObjectRef[];
  assumption_refs?: ObjectRef[];
  constraint_refs?: ObjectRef[];
  supersedes_decision_ref?: ObjectRef;
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

function sameObjectRef(a: ObjectRef, b: ObjectRef): boolean {
  return a.object_kind === b.object_kind &&
    a.object_id === b.object_id &&
    a.object_version === b.object_version &&
    a.scope_ref.scope_id === b.scope_ref.scope_id &&
    a.scope_ref.scope_kind === b.scope_ref.scope_kind;
}

function isInScope(ref: unknown, context: RequestContext): ref is ObjectRef {
  return isObjectRef(ref) &&
    ref.scope_ref.scope_id === context.scope_ref.scope_id &&
    ref.scope_ref.scope_kind === context.scope_ref.scope_kind;
}

function validateCommand(command: SubmitIntentCommand): string | undefined {
  const { context, request_fingerprint, event_refs } = command;
  if (!isRequestContext(context) || !context.idempotency_key?.trim()) {
    return "Intent submission requires a valid authenticated context and idempotency key";
  }
  if (!/^[a-f0-9]{64}$/i.test(request_fingerprint)) {
    return "request_fingerprint must be a SHA-256 hex digest";
  }
  if (!isInScope(command.decision_ref, context) || command.decision_ref.object_kind !== "DECISION_RECORD") {
    return "Intent submission requires an in-scope DECISION_RECORD reference";
  }
  if (!event_refs || typeof event_refs !== "object") {
    return "Intent submission requires the canonical event references for its decision records";
  }
  const requiredEvents: Array<[ObjectRef | undefined, string]> = [
    [event_refs.intent_normalized, "intent.normalized"],
    [event_refs.decision_recorded, "decision.recorded"],
  ];
  const optionalEvents: Array<[ObjectRef | undefined, boolean, string]> = [
    [event_refs.clarification_requested, Boolean(command.clarification), "clarification.requested"],
    [event_refs.outcome_proposal_created, Boolean(command.outcome_proposal), "outcome.proposal_created"],
    [event_refs.route_selected, Boolean(command.route_proposal), "decision.route_selected"],
  ];
  for (const [ref, eventName] of requiredEvents) {
    if (!isInScope(ref, context) || ref.object_kind !== "DOMAIN_EVENT") {
      return `Intent submission requires an in-scope event reference for ${eventName}`;
    }
  }
  for (const [ref, expected, eventName] of optionalEvents) {
    if (expected && (!isInScope(ref, context) || ref.object_kind !== "DOMAIN_EVENT")) {
      return `Intent submission requires an in-scope event reference for ${eventName}`;
    }
    if (!expected && ref !== undefined) {
      return `An unused event reference was supplied for ${eventName}`;
    }
  }
  const eventIds = [
    event_refs.intent_normalized.object_id,
    event_refs.decision_recorded.object_id,
    ...(event_refs.clarification_requested ? [event_refs.clarification_requested.object_id] : []),
    ...(event_refs.outcome_proposal_created ? [event_refs.outcome_proposal_created.object_id] : []),
    ...(event_refs.route_selected ? [event_refs.route_selected.object_id] : []),
  ];
  if (new Set(eventIds).size !== eventIds.length) {
    return "Every emitted Intent event must have a unique event identity";
  }
  const handoffDispositions = new Set<DecisionDisposition>([
    "RESEARCH", "CREATE", "AUTOMATE", "CONNECT", "CONTINUE_EXISTING_WORK",
    "REQUEST_AUTHORIZATION", "REQUEST_APPROVAL",
  ]);
  if (handoffDispositions.has(command.disposition) && !command.route_proposal) {
    return "A routed disposition requires a typed RouteProposal";
  }
  if (command.disposition === "CLARIFY" && !command.clarification) {
    return "A clarification disposition requires a ClarificationRequest";
  }
  if (command.disposition !== "CLARIFY" && command.clarification) {
    return "A ClarificationRequest is only valid with a CLARIFY disposition";
  }
  if (!command.rationale_summary?.trim()) {
    return "A redacted decision rationale summary is required";
  }
  return undefined;
}

function recordRef(record: unknown, field: string): ObjectRef | undefined {
  if (typeof record !== "object" || record === null) return undefined;
  const value = (record as Record<string, unknown>)[field];
  return isObjectRef(value) ? value : undefined;
}

async function persistRecord<T>(
  transaction: EngineTransaction,
  context: RequestContext,
  repositoryKey: string,
  ref: ObjectRef,
  value: T,
  identityField: string,
): Promise<OperationResult<T>> {
  const saved = await transaction.repository<T>(repositoryKey).create(context, ref, value);
  if (saved.status !== "OK" || !saved.data) return propagateFailure<T>(saved);
  const persistedRef = recordRef(saved.data, identityField);
  if (!persistedRef || !sameObjectRef(persistedRef, ref) || !saved.object_version) {
    return rejected(
      "INTEGRITY_OR_UNTRUSTED_INPUT",
      `${repositoryKey} did not confirm the persisted object identity and version`,
      context.correlation_id,
    );
  }
  return createOperationResult({
    status: "OK",
    correlation_id: context.correlation_id,
    data: saved.data,
    object_version: saved.object_version,
    warnings: saved.warnings,
  });
}

function eventEnvelope(
  context: RequestContext,
  eventRef: ObjectRef,
  eventType: string,
  objectRef: ObjectRef,
  occurredAt: Timestamp,
  payload: Record<string, unknown>,
): DomainEventEnvelope {
  return {
    event_id: eventRef.object_id,
    event_type: eventType,
    schema_version: 1,
    occurred_at: occurredAt,
    producer_engine: "INV-01",
    object_ref: objectRef,
    scope_ref: context.scope_ref,
    correlation_id: context.correlation_id,
    actor_ref: context.actor_ref,
    payload,
  };
}

/**
 * Complete INV-01 submission boundary.
 *
 * The caller supplies the normalized interpretation and bounded semantic
 * disposition; this use case validates them, constructs the canonical
 * DecisionRecord and optional owned proposal records, then atomically stores
 * the records, outbox facts and idempotency result. It never executes a route
 * or writes an authoritative Work target.
 */
export async function submitIntent(
  unitOfWork: EngineUnitOfWorkPort,
  command: SubmitIntentCommand,
): Promise<OperationResult<IntentEvaluationResult>> {
  const correlationId = command.context?.correlation_id ?? "unknown";
  const envelopeIssue = validateCommand(command);
  if (envelopeIssue) return rejected("VALIDATION_ERROR", envelopeIssue, correlationId);

  const normalizedResult = normalizeIntent(command);
  if (!normalizedResult.ok) {
    return rejected(
      mapDomainCode(normalizedResult.issues[0].code),
      normalizedResult.issues.map((issue) => issue.safe_message).join("; "),
      correlationId,
    );
  }

  let normalizedIntent: NormalizedIntent = normalizedResult.value;
  if (command.disposition === "CLARIFY" && normalizedIntent.lifecycle_state !== "AWAITING_CLARIFICATION") {
    const awaiting = transitionIntent(normalizedIntent, "AWAITING_CLARIFICATION");
    if (!awaiting.ok) {
      return rejected(mapDomainCode(awaiting.issues[0].code), awaiting.issues[0].safe_message, correlationId);
    }
    normalizedIntent = awaiting.value;
  } else if (
    normalizedIntent.lifecycle_state === "NORMALIZED" &&
    command.disposition !== "CLARIFY"
  ) {
    const ready = transitionIntent(normalizedIntent, "READY_FOR_DECISION");
    if (!ready.ok) {
      return rejected(mapDomainCode(ready.issues[0].code), ready.issues[0].safe_message, correlationId);
    }
    normalizedIntent = ready.value;
  }

  const clarificationResult = command.clarification
    ? createClarificationRequest({
        ...command.clarification,
        intent: normalizedIntent,
        created_at: command.created_at,
      })
    : undefined;
  if (clarificationResult && !clarificationResult.ok) {
    return rejected(
      mapDomainCode(clarificationResult.issues[0].code),
      clarificationResult.issues.map((issue) => issue.safe_message).join("; "),
      correlationId,
    );
  }

  const outcomeResult = command.outcome_proposal
    ? createOutcomeProposal({
        ...command.outcome_proposal,
        intent: normalizedIntent,
        created_at: command.created_at,
      })
    : undefined;
  if (outcomeResult && !outcomeResult.ok) {
    return rejected(
      mapDomainCode(outcomeResult.issues[0].code),
      outcomeResult.issues.map((issue) => issue.safe_message).join("; "),
      correlationId,
    );
  }

  const routeResult = command.route_proposal
    ? createRouteProposal({
        ...command.route_proposal,
        intent: normalizedIntent,
        disposition: command.disposition,
        created_at: command.created_at,
      })
    : undefined;
  if (routeResult && !routeResult.ok) {
    return rejected(
      mapDomainCode(routeResult.issues[0].code),
      routeResult.issues.map((issue) => issue.safe_message).join("; "),
      correlationId,
    );
  }

  const clarification: ClarificationRequest | undefined =
    clarificationResult?.ok ? clarificationResult.value : undefined;
  const outcomeProposal: OutcomeProposal | undefined =
    outcomeResult?.ok ? outcomeResult.value : undefined;
  const routeProposal: RouteProposal | undefined =
    routeResult?.ok ? routeResult.value : undefined;

  const decisionResult = createDecisionRecord({
    context: command.context,
    decision_ref: command.decision_ref,
    intent: normalizedIntent,
    disposition: command.disposition,
    ...(routeProposal ? { route_proposal: routeProposal } : {}),
    ...(outcomeProposal ? { outcome_proposal: outcomeProposal } : {}),
    ...(clarification ? { clarification } : {}),
    policy_decision_refs: command.policy_decision_refs,
    authority_decision_refs: command.authority_decision_refs,
    capability_refs: command.capability_refs,
    assumption_refs: command.assumption_refs,
    constraint_refs: command.constraint_refs,
    rationale_summary: command.rationale_summary,
    created_at: command.created_at,
    supersedes_decision_ref: command.supersedes_decision_ref,
  });
  if (!decisionResult.ok) {
    return rejected(
      mapDomainCode(decisionResult.issues[0].code),
      decisionResult.issues.map((issue) => issue.safe_message).join("; "),
      correlationId,
    );
  }

  const resultData: IntentEvaluationResult = {
    normalized_intent: normalizedIntent,
    decision_record: decisionResult.value,
    ...(outcomeProposal ? { outcome_proposal: outcomeProposal } : {}),
    ...(clarification ? { clarification_request: clarification } : {}),
    ...(routeProposal ? { route_proposal: routeProposal } : {}),
  };
  const events: DomainEventEnvelope[] = [
    eventEnvelope(
      command.context,
      command.event_refs.intent_normalized,
      "intent.normalized",
      normalizedIntent.intent_ref,
      command.created_at,
      {
        intent_revision: normalizedIntent.revision_number,
        lifecycle_state: normalizedIntent.lifecycle_state,
        requested_work_kind: normalizedIntent.requested_work_kind,
      },
    ),
    eventEnvelope(
      command.context,
      command.event_refs.decision_recorded,
      "decision.recorded",
      decisionResult.value.decision_ref,
      command.created_at,
      {
        intent_ref: normalizedIntent.intent_ref,
        intent_revision: normalizedIntent.revision_number,
        disposition: decisionResult.value.disposition,
        decision_state: decisionResult.value.state,
        route_proposal_ref: routeProposal?.route_ref,
        outcome_proposal_ref: outcomeProposal?.proposal_ref,
        clarification_ref: clarification?.clarification_ref,
      },
    ),
  ];
  if (clarification) {
    events.push(eventEnvelope(
      command.context,
      command.event_refs.clarification_requested!,
      "clarification.requested",
      clarification.clarification_ref,
      command.created_at,
      { intent_ref: normalizedIntent.intent_ref, decision_ref: decisionResult.value.decision_ref },
    ));
  }
  if (outcomeProposal) {
    events.push(eventEnvelope(
      command.context,
      command.event_refs.outcome_proposal_created!,
      "outcome.proposal_created",
      outcomeProposal.proposal_ref,
      command.created_at,
      {
        intent_ref: normalizedIntent.intent_ref,
        proposal_revision: outcomeProposal.proposal_revision,
        unresolved_criterion_refs: outcomeProposal.unresolved_criterion_refs,
        proposal_state: outcomeProposal.state,
      },
    ));
  }
  if (routeProposal) {
    events.push(eventEnvelope(
      command.context,
      command.event_refs.route_selected!,
      "decision.route_selected",
      decisionResult.value.decision_ref,
      command.created_at,
      {
        route_proposal_ref: routeProposal.route_ref,
        disposition: routeProposal.disposition,
        target_engine_id: routeProposal.target_engine_id,
        target_operation: routeProposal.target_operation,
      },
    ));
  }

  return unitOfWork.execute(command.context, async (transaction) => {
    const prior = await transaction.idempotency.get<IntentEvaluationResult>(
      command.context,
      command.context.idempotency_key!,
    );
    if (prior.status !== "OK") return propagateFailure<IntentEvaluationResult>(prior);
    if (prior.data) {
      if (prior.data.request_fingerprint !== command.request_fingerprint) {
        return rejected(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was already used for a different intent submission",
          correlationId,
        );
      }
      return prior.data.result;
    }

    const persistedIntent = await persistRecord(
      transaction, command.context, "inv-01.normalized-intents",
      normalizedIntent.intent_ref, normalizedIntent, "intent_ref",
    );
    if (persistedIntent.status !== "OK" || !persistedIntent.data) {
      return propagateFailure<IntentEvaluationResult>(persistedIntent);
    }
    if (clarification) {
      const persisted = await persistRecord(
        transaction, command.context, "inv-01.clarification-requests",
        clarification.clarification_ref, clarification, "clarification_ref",
      );
      if (persisted.status !== "OK" || !persisted.data) return propagateFailure<IntentEvaluationResult>(persisted);
    }
    if (outcomeProposal) {
      const persisted = await persistRecord(
        transaction, command.context, "inv-01.outcome-proposals",
        outcomeProposal.proposal_ref, outcomeProposal, "proposal_ref",
      );
      if (persisted.status !== "OK" || !persisted.data) return propagateFailure<IntentEvaluationResult>(persisted);
    }
    if (routeProposal) {
      const persisted = await persistRecord(
        transaction, command.context, "inv-01.route-proposals",
        routeProposal.route_ref, routeProposal, "route_ref",
      );
      if (persisted.status !== "OK" || !persisted.data) return propagateFailure<IntentEvaluationResult>(persisted);
    }
    const persistedDecision = await persistRecord(
      transaction, command.context, "inv-01.decisions",
      decisionResult.value.decision_ref, decisionResult.value, "decision_ref",
    );
    if (persistedDecision.status !== "OK" || !persistedDecision.data) {
      return propagateFailure<IntentEvaluationResult>(persistedDecision);
    }

    for (const event of events) {
      const emitted = await transaction.outbox.append(command.context, event);
      if (emitted.status !== "OK" || emitted.data?.event_id !== event.event_id) {
        return propagateFailure<IntentEvaluationResult>(emitted);
      }
    }

    const result = createOperationResult({
      status: "OK",
      correlation_id: correlationId,
      data: resultData,
      object_version: normalizedIntent.intent_ref.object_version,
    });
    const recorded = await transaction.idempotency.record(command.context, {
      idempotency_key: command.context.idempotency_key!,
      request_fingerprint: command.request_fingerprint,
      result,
      recorded_at: command.created_at,
    } satisfies IdempotencyRecord<IntentEvaluationResult>);
    if (recorded.status !== "OK") return propagateFailure<IntentEvaluationResult>(recorded);
    return result;
  });
}


/**
 * Read an INV-01-owned record through its scoped repository boundary.
 * Reads are version-aware and never infer visibility from a client-side cache.
 */
async function readOwnedRecord<T>(
  unitOfWork: EngineUnitOfWorkPort,
  context: RequestContext,
  ref: ObjectRef,
  expectedKind: "INTENT" | "DECISION_RECORD",
  repositoryKey: string,
  identityField: "intent_ref" | "decision_ref",
): Promise<OperationResult<T>> {
  const correlationId = context?.correlation_id ?? "unknown";
  if (
    !isRequestContext(context) ||
    !isObjectRef(ref) ||
    !isInScope(ref, context) ||
    ref.object_kind !== expectedKind
  ) {
    return rejected(
      "VALIDATION_ERROR",
      `Read requires an in-scope ${expectedKind} reference and valid request context`,
      correlationId,
    );
  }

  return unitOfWork.execute(context, async (transaction) => {
    const read = await transaction.repository<T>(repositoryKey).get(context, ref);
    if (read.status !== "OK" || !read.data) return propagateFailure<T>(read);

    const storedRef = recordRef(read.data, identityField);
    const requestedVersionMatches =
      ref.object_version === undefined || storedRef?.object_version === ref.object_version;
    const resultVersionMatches =
      read.object_version !== undefined &&
      (ref.object_version === undefined || read.object_version === ref.object_version) &&
      (storedRef?.object_version === undefined || storedRef.object_version === read.object_version);

    if (
      !storedRef ||
      storedRef.object_kind !== expectedKind ||
      storedRef.object_id !== ref.object_id ||
      storedRef.scope_ref.scope_id !== context.scope_ref.scope_id ||
      storedRef.scope_ref.scope_kind !== context.scope_ref.scope_kind ||
      !requestedVersionMatches ||
      !resultVersionMatches
    ) {
      return rejected(
        "INTEGRITY_OR_UNTRUSTED_INPUT",
        `${repositoryKey} returned a record with mismatched identity, scope or version`,
        correlationId,
      );
    }

    return createOperationResult({
      status: "OK",
      correlation_id: correlationId,
      data: read.data,
      object_version: read.object_version,
      warnings: read.warnings,
    });
  });
}

/** Canonical INV-01 operation: get_normalized_intent(context, intent_ref). */
export function getNormalizedIntent(
  unitOfWork: EngineUnitOfWorkPort,
  context: RequestContext,
  intentRef: ObjectRef,
): Promise<OperationResult<NormalizedIntent>> {
  return readOwnedRecord<NormalizedIntent>(
    unitOfWork,
    context,
    intentRef,
    "INTENT",
    "inv-01.normalized-intents",
    "intent_ref",
  );
}

/** Canonical INV-01 operation: get_decision(context, decision_ref). */
export function getDecision(
  unitOfWork: EngineUnitOfWorkPort,
  context: RequestContext,
  decisionRef: ObjectRef,
): Promise<OperationResult<DecisionRecord>> {
  return readOwnedRecord<DecisionRecord>(
    unitOfWork,
    context,
    decisionRef,
    "DECISION_RECORD",
    "inv-01.decisions",
    "decision_ref",
  );
}
