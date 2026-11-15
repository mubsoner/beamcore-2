import {
  createOperationError,
  createOperationResult,
  isObjectRef,
  isRequestContext,
  isTimestamp,
  type DomainEventEnvelope,
  type EngineTransaction,
  type EngineUnitOfWorkPort,
  type IdempotencyRecord,
  type ObjectRef,
  type OperationResult,
  type RequestContext,
  type Timestamp,
} from "../shared";
import {
  transitionDecision,
  type DecisionRecord,
  type RouteProposal,
} from "./domain";

/** The recipient's authoritative response; submission alone is never acceptance. */
export interface HandoffReceipt {
  route_proposal_ref: ObjectRef;
  recipient_engine_id: string;
  recipient_request_ref?: ObjectRef;
  receipt_state: "ACCEPTED" | "REJECTED" | "UNKNOWN";
  received_at?: Timestamp;
  rejection_error?: {
    code: string;
    safe_message: string;
    retryable: boolean;
  };
}

export interface HandoffLookupResult {
  /** NOT_SUBMITTED is authoritative proof that the recipient has not accepted this handoff key. */
  state: "NOT_SUBMITTED" | "RECEIPT_AVAILABLE" | "UNKNOWN";
  receipt?: HandoffReceipt;
}

/**
 * The adapter calls the owning engine's interface. It must enforce the recipient's
 * scope/visibility and current INV-06/INV-07 gates. It must not execute the target
 * operation locally or claim acceptance from an HTTP/RPC submission alone.
 */
export interface RouteHandoffPort {
  lookup(
    context: RequestContext,
    route_proposal: RouteProposal,
    handoff_idempotency_key: string,
  ): Promise<OperationResult<HandoffLookupResult>>;
  submit(
    context: RequestContext,
    route_proposal: RouteProposal,
    handoff_idempotency_key: string,
  ): Promise<OperationResult<HandoffReceipt>>;
}

export interface StoredHandoffReceipt {
  route_proposal_ref: ObjectRef;
  decision_ref: ObjectRef;
  receipt: HandoffReceipt;
  recorded_at: Timestamp;
}

export interface RequestRouteHandoffCommand {
  context: RequestContext;
  route_proposal_ref: ObjectRef;
  decision_ref: ObjectRef;
  request_fingerprint: string;
  requested_at: Timestamp;
  requested_event_ref: ObjectRef;
  result_event_ref: ObjectRef;
}

interface StagedHandoff {
  route: RouteProposal;
  decision: DecisionRecord;
  decision_version: string;
  should_emit_request: boolean;
  prior_receipt?: StoredHandoffReceipt;
}

function rejected<T>(context: RequestContext, code: string, message: string): OperationResult<T> {
  return createOperationResult({
    status: "REJECTED",
    correlation_id: context.correlation_id,
    errors: [createOperationError(code as never, message, false)],
  });
}

function propagated<T>(context: RequestContext, source: OperationResult<unknown>): OperationResult<T> {
  const unexpectedSuccess = source.status === "OK";
  return createOperationResult({
    status: unexpectedSuccess ? "UNKNOWN" : source.status,
    correlation_id: context.correlation_id,
    errors: unexpectedSuccess
      ? [createOperationError("INTERNAL_ERROR", "A handoff dependency returned success without its required record", false)]
      : source.errors,
    warnings: source.warnings,
    ...(source.object_version ? { object_version: source.object_version } : {}),
  });
}

function sameRef(a: ObjectRef, b: ObjectRef): boolean {
  return a.object_kind === b.object_kind &&
    a.object_id === b.object_id &&
    a.object_version === b.object_version &&
    a.scope_ref.scope_id === b.scope_ref.scope_id &&
    a.scope_ref.scope_kind === b.scope_ref.scope_kind;
}

function inScope(value: unknown, context: RequestContext): value is ObjectRef {
  return isObjectRef(value) &&
    value.scope_ref.scope_id === context.scope_ref.scope_id &&
    value.scope_ref.scope_kind === context.scope_ref.scope_kind;
}

function event(
  context: RequestContext,
  eventRef: ObjectRef,
  eventType: string,
  decisionRef: ObjectRef,
  occurredAt: Timestamp,
  payload: Record<string, unknown>,
): DomainEventEnvelope {
  return {
    event_id: eventRef.object_id,
    event_type: eventType,
    schema_version: 1,
    occurred_at: occurredAt,
    producer_engine: "INV-01",
    object_ref: decisionRef,
    scope_ref: context.scope_ref,
    correlation_id: context.correlation_id,
    actor_ref: context.actor_ref,
    payload,
  };
}

function validateReceipt(
  receipt: HandoffReceipt,
  route: RouteProposal,
  context: RequestContext,
): string | undefined {
  if (
    !receipt || !inScope(receipt.route_proposal_ref, context) ||
    !sameRef(receipt.route_proposal_ref, route.route_ref) ||
    receipt.recipient_engine_id !== route.target_engine_id ||
    !["ACCEPTED", "REJECTED", "UNKNOWN"].includes(receipt.receipt_state)
  ) {
    return "Recipient receipt does not match the exact scoped RouteProposal and target engine";
  }
  if (receipt.recipient_request_ref && !inScope(receipt.recipient_request_ref, context)) {
    return "Recipient request reference is outside the authenticated scope";
  }
  if (receipt.received_at && !isTimestamp(receipt.received_at)) {
    return "Recipient receipt timestamp is invalid";
  }
  if (receipt.rejection_error &&
      (!receipt.rejection_error.code.trim() || !receipt.rejection_error.safe_message.trim())) {
    return "Recipient rejection details are malformed";
  }
  return undefined;
}

function decisionAfterReceipt(
  decision: DecisionRecord,
  receipt: HandoffReceipt,
): DecisionRecord | undefined {
  if (!decision.route_proposal_ref ||
      !sameRef(decision.route_proposal_ref, receipt.route_proposal_ref) ||
      (decision.state !== "HANDOFF_REQUESTED" && decision.state !== "UNKNOWN")) return undefined;
  const state: DecisionRecord["state"] =
    receipt.receipt_state === "ACCEPTED" ? "HANDOFF_CONFIRMED" :
    receipt.receipt_state === "REJECTED" ? "BLOCKED" : "UNKNOWN";
  return { ...decision, state };
}

/**
 * Durable two-phase handoff.
 * 1) Commit HANDOFF_REQUESTED + outbox before the external call.
 * 2) Lookup the recipient's authoritative state before deciding whether it is safe
 *    to submit. An unresolved lookup never causes blind re-submission.
 * 3) Persist the receipt and decision transition in a separate local unit of work.
 */
export async function requestRouteHandoff(
  unitOfWork: EngineUnitOfWorkPort,
  handoffPort: RouteHandoffPort,
  command: RequestRouteHandoffCommand,
): Promise<OperationResult<HandoffReceipt>> {
  const context = command.context;
  if (
    !isRequestContext(context) || !context.idempotency_key?.trim() ||
    !/^[a-f0-9]{64}$/i.test(command.request_fingerprint) ||
    !isTimestamp(command.requested_at) ||
    !inScope(command.route_proposal_ref, context) ||
    command.route_proposal_ref.object_kind !== "ROUTE_PROPOSAL" ||
    !inScope(command.decision_ref, context) ||
    command.decision_ref.object_kind !== "DECISION_RECORD" ||
    !inScope(command.requested_event_ref, context) ||
    command.requested_event_ref.object_kind !== "DOMAIN_EVENT" ||
    !inScope(command.result_event_ref, context) ||
    command.result_event_ref.object_kind !== "DOMAIN_EVENT" ||
    command.requested_event_ref.object_id === command.result_event_ref.object_id
  ) {
    return rejected(context, "VALIDATION_ERROR", "Route handoff requires valid context, idempotency, scoped records and distinct event references");
  }

  const staged = await unitOfWork.execute<StagedHandoff>(context, async (transaction) => {
    const prior = await transaction.idempotency.get<HandoffReceipt>(context, context.idempotency_key!);
    if (prior.status !== "OK") return propagated<StagedHandoff>(context, prior);
    if (prior.data) {
      if (prior.data.request_fingerprint !== command.request_fingerprint) {
        return rejected(context, "IDEMPOTENCY_CONFLICT", "Handoff idempotency key was reused with a different payload");
      }
      if (prior.data.result.data?.receipt_state !== "UNKNOWN") {
        return createOperationResult({
          status: "OK",
          correlation_id: context.correlation_id,
          data: {
            route: {} as RouteProposal,
            decision: {} as DecisionRecord,
            decision_version: "1",
            should_emit_request: false,
            prior_receipt: {
              route_proposal_ref: command.route_proposal_ref,
              decision_ref: command.decision_ref,
              receipt: prior.data.result.data!,
              recorded_at: command.requested_at,
            },
          },
        });
      }
    }

    const routeResult = await transaction.repository<RouteProposal>("inv-01.route-proposals")
      .get(context, command.route_proposal_ref);
    if (routeResult.status !== "OK" || !routeResult.data) return propagated<StagedHandoff>(context, routeResult);
    if (!sameRef(routeResult.data.route_ref, command.route_proposal_ref) ||
        !routeResult.data.target_engine_id || !routeResult.data.target_operation) {
      return rejected(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Stored RouteProposal identity or target operation is invalid");
    }

    const decisionResult = await transaction.repository<DecisionRecord>("inv-01.decisions")
      .get(context, command.decision_ref);
    if (decisionResult.status !== "OK" || !decisionResult.data) return propagated<StagedHandoff>(context, decisionResult);
    if (!decisionResult.object_version ||
        !sameRef(decisionResult.data.decision_ref, command.decision_ref) ||
        !decisionResult.data.route_proposal_ref ||
        !sameRef(decisionResult.data.route_proposal_ref, routeResult.data.route_ref)) {
      return rejected(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Decision does not reference the exact stored RouteProposal");
    }

    const receiptRead = await transaction.appendOnly<StoredHandoffReceipt>("inv-01.handoff-receipts")
      .get(context, command.route_proposal_ref);
    let priorReceipt: StoredHandoffReceipt | undefined;
    if (receiptRead.status === "OK" && receiptRead.data) {
      if (!sameRef(receiptRead.data.route_proposal_ref, command.route_proposal_ref) ||
          !sameRef(receiptRead.data.decision_ref, command.decision_ref)) {
        return rejected(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Stored handoff receipt is bound to another route or decision");
      }
      priorReceipt = receiptRead.data;
      if (priorReceipt.receipt.receipt_state !== "UNKNOWN") {
        return createOperationResult({
          status: "OK", correlation_id: context.correlation_id,
          data: {
            route: routeResult.data, decision: decisionResult.data,
            decision_version: decisionResult.object_version,
            should_emit_request: false, prior_receipt: priorReceipt,
          },
        });
      }
    } else if (
      receiptRead.status !== "REJECTED" ||
      receiptRead.errors[0]?.code !== "NOT_FOUND_OR_NOT_VISIBLE"
    ) {
      return propagated<StagedHandoff>(context, receiptRead);
    }

    let decision = decisionResult.data;
    let shouldEmitRequest = false;
    if (decision.state === "ROUTE_SELECTED") {
      const transitioned = transitionDecision(decision, "HANDOFF_REQUESTED");
      if (!transitioned.ok) {
        return rejected(context, "VALIDATION_ERROR", transitioned.issues[0].safe_message);
      }
      const saved = await transaction.repository<DecisionRecord>("inv-01.decisions")
        .update(context, command.decision_ref, decisionResult.object_version, transitioned.value);
      if (saved.status !== "OK" || !saved.data) return propagated<StagedHandoff>(context, saved);
      decision = saved.data;
      shouldEmitRequest = true;
      const emitted = await transaction.outbox.append(context, event(
        context, command.requested_event_ref, "decision.handoff_requested",
        decision.decision_ref, command.requested_at,
        { route_proposal_ref: routeResult.data.route_ref, target_engine_id: routeResult.data.target_engine_id },
      ));
      if (emitted.status !== "OK" || emitted.data?.event_id !== command.requested_event_ref.object_id) {
        return propagated<StagedHandoff>(context, emitted);
      }
    } else if (decision.state !== "HANDOFF_REQUESTED" && decision.state !== "UNKNOWN") {
      return rejected(context, "VALIDATION_ERROR", "Decision is not eligible for a route handoff");
    }
    return createOperationResult({
      status: "OK",
      correlation_id: context.correlation_id,
      data: {
        route: routeResult.data,
        decision,
        decision_version: decisionResult.object_version,
        should_emit_request: shouldEmitRequest,
        ...(priorReceipt ? { prior_receipt: priorReceipt } : {}),
      },
    });
  });

  if (staged.status !== "OK" || !staged.data) return propagated<HandoffReceipt>(context, staged);
  if (staged.data.prior_receipt && staged.data.prior_receipt.receipt.receipt_state !== "UNKNOWN") {
    return createOperationResult({
      status: staged.data.prior_receipt.receipt.receipt_state === "ACCEPTED" ? "OK" : "REJECTED",
      correlation_id: context.correlation_id,
      data: staged.data.prior_receipt.receipt,
      ...(staged.data.prior_receipt.receipt.rejection_error ? {
        errors: [createOperationError(
          "DEPENDENCY_UNAVAILABLE",
          staged.data.prior_receipt.receipt.rejection_error.safe_message,
          staged.data.prior_receipt.receipt.rejection_error.retryable,
        )],
      } : {}),
    });
  }

  const route = staged.data.route;
  const decision = staged.data.decision;
  const handoffKey = context.idempotency_key!;
  let receipt: HandoffReceipt;
  const lookup = await handoffPort.lookup(context, route, handoffKey);
  if (lookup.status === "OK" && lookup.data?.state === "RECEIPT_AVAILABLE" && lookup.data.receipt) {
    receipt = lookup.data.receipt;
  } else if (lookup.status === "OK" && lookup.data?.state === "NOT_SUBMITTED") {
    const submitted = await handoffPort.submit(context, route, handoffKey);
    if (submitted.status === "OK" && submitted.data) {
      receipt = submitted.data;
    } else {
      receipt = {
        route_proposal_ref: route.route_ref,
        recipient_engine_id: route.target_engine_id!,
        receipt_state: "UNKNOWN",
      };
    }
  } else {
    receipt = lookup.data?.receipt ?? {
      route_proposal_ref: route.route_ref,
      recipient_engine_id: route.target_engine_id!,
      receipt_state: "UNKNOWN",
    };
  }

  const receiptIssue = validateReceipt(receipt, route, context);
  if (receiptIssue) {
    receipt = {
      route_proposal_ref: route.route_ref,
      recipient_engine_id: route.target_engine_id!,
      receipt_state: "UNKNOWN",
      rejection_error: {
        code: "INTEGRITY_OR_UNTRUSTED_INPUT",
        safe_message: receiptIssue,
        retryable: false,
      },
    };
  }

  const completed = await unitOfWork.execute<HandoffReceipt>(context, async (transaction) => {
    const prior = await transaction.idempotency.get<HandoffReceipt>(context, context.idempotency_key!);
    if (prior.status !== "OK") return propagated<HandoffReceipt>(context, prior);
    if (prior.data) {
      if (prior.data.request_fingerprint !== command.request_fingerprint) {
        return rejected(context, "IDEMPOTENCY_CONFLICT", "Handoff idempotency key was reused with a different payload");
      }
      if (prior.data.result.data?.receipt_state !== "UNKNOWN") return prior.data.result;
    }

    const current = await transaction.repository<DecisionRecord>("inv-01.decisions")
      .get(context, command.decision_ref);
    if (current.status !== "OK" || !current.data || !current.object_version) {
      return propagated<HandoffReceipt>(context, current);
    }
    const nextDecision = decisionAfterReceipt(current.data, receipt);
    if (!nextDecision) {
      if (current.data.state === "HANDOFF_CONFIRMED" && receipt.receipt_state === "ACCEPTED") {
        // An idempotent duplicate receipt is already reflected in the authoritative decision.
      } else {
        return rejected(context, "VERSION_CONFLICT", "Decision changed before the authoritative handoff receipt was applied");
      }
    } else if (nextDecision.state !== current.data.state) {
      const updated = await transaction.repository<DecisionRecord>("inv-01.decisions")
        .update(context, command.decision_ref, current.object_version, nextDecision);
      if (updated.status !== "OK" || !updated.data) return propagated<HandoffReceipt>(context, updated);
    }

    const stored: StoredHandoffReceipt = {
      route_proposal_ref: route.route_ref,
      decision_ref: decision.decision_ref,
      receipt,
      recorded_at: command.requested_at,
    };
    const appended = await transaction.appendOnly<StoredHandoffReceipt>("inv-01.handoff-receipts")
      .append(context, stored);
    if (appended.status !== "OK") return propagated<HandoffReceipt>(context, appended);

    const type =
      receipt.receipt_state === "ACCEPTED" ? "decision.handoff_confirmed" :
      receipt.receipt_state === "REJECTED" ? "decision.blocked" : "decision.handoff_unknown";
    const emitted = await transaction.outbox.append(context, event(
      context, command.result_event_ref, type, command.decision_ref, command.requested_at,
      {
        route_proposal_ref: route.route_ref,
        recipient_engine_id: receipt.recipient_engine_id,
        receipt_state: receipt.receipt_state,
        recipient_request_ref: receipt.recipient_request_ref,
      },
    ));
    if (emitted.status !== "OK" || emitted.data?.event_id !== command.result_event_ref.object_id) {
      return propagated<HandoffReceipt>(context, emitted);
    }

    const result = createOperationResult({
      status: receipt.receipt_state === "ACCEPTED" ? "OK" :
        receipt.receipt_state === "REJECTED" ? "REJECTED" : "UNKNOWN",
      correlation_id: context.correlation_id,
      data: receipt,
      ...(receipt.receipt_state === "UNKNOWN" ? {
        errors: [createOperationError(
          "OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED",
          "The recipient's handoff outcome is still unknown; reconcile before another submission",
          true,
        )],
      } : receipt.rejection_error ? {
        errors: [createOperationError(
          "DEPENDENCY_UNAVAILABLE",
          receipt.rejection_error.safe_message,
          receipt.rejection_error.retryable,
        )],
      } : {}),
    });
    if (receipt.receipt_state !== "UNKNOWN") {
      const recorded = await transaction.idempotency.record(context, {
        idempotency_key: context.idempotency_key!,
        request_fingerprint: command.request_fingerprint,
        result,
        recorded_at: command.requested_at,
      } satisfies IdempotencyRecord<HandoffReceipt>);
      if (recorded.status !== "OK") return propagated<HandoffReceipt>(context, recorded);
    }
    return result;
  });
  return completed;
}
