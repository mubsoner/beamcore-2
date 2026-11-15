import {
  createOperationError,
  createOperationResult,
  type EventInboxPort,
  type InboxAcceptance,
  type InboxEventEnvelope,
  type RequestContext,
  type ScopeRef,
} from "../../shared";
import { fingerprintInboxEvent, validateInboxEvent } from "../domain";

export interface InMemoryEventInboxOptions {
  /** Injectable clock for deterministic tests. Defaults to the local runtime clock. */
  now?: () => string;
  /**
   * Same-version distinct fact types are permitted only when the owning
   * aggregate/consumer contract explicitly opts in.
   */
  allowSameVersionFact?: (
    existing_event_types: readonly string[],
    incoming_event_type: string,
  ) => boolean;
}

interface AggregateCursor {
  version: number;
  event_types: Set<string>;
}

function copyScopeRef(scope: ScopeRef): ScopeRef {
  return {
    scope_id: scope.scope_id,
    scope_kind: scope.scope_kind,
    ...(scope.parent_scope_ref
      ? { parent_scope_ref: copyScopeRef(scope.parent_scope_ref) }
      : {}),
  };
}

/**
 * Test/reference adapter only. This store is intentionally process-local and
 * is not durable; production adapters must enforce the same rules inside the
 * owning database transaction.
 */
export function createInMemoryEventInbox(
  options: InMemoryEventInboxOptions = {},
): EventInboxPort {
  const now = options.now ?? (() => new Date().toISOString());
  const events = new Map<string, {
    fingerprint: string;
    acceptance: InboxAcceptance;
  }>();
  const aggregateCursors = new Map<string, AggregateCursor>();

  return {
    accept: async (
      context: RequestContext,
      consumer_id: string,
      event: InboxEventEnvelope,
      fingerprint: string,
    ) => {
      const issues = validateInboxEvent(context, consumer_id, event);
      if (issues.length > 0 || !/^[a-f0-9]{64}$/.test(fingerprint)) {
        return createOperationResult<InboxAcceptance>({
          status: "REJECTED",
          correlation_id: context.correlation_id,
          errors: [createOperationError(
            "VALIDATION_ERROR",
            issues.join("; ") || "fingerprint must be a lowercase SHA-256 digest",
          )],
        });
      }

      // Never trust a caller-supplied digest as proof of the event contents.
      const verifiedFingerprint = await fingerprintInboxEvent(context, consumer_id, event);
      if (
        verifiedFingerprint.status !== "OK" ||
        !verifiedFingerprint.data ||
        verifiedFingerprint.data !== fingerprint
      ) {
        return createOperationResult<InboxAcceptance>({
          status: "REJECTED",
          correlation_id: context.correlation_id,
          errors: [createOperationError(
            "INTEGRITY_OR_UNTRUSTED_INPUT",
            "Supplied Inbox fingerprint does not match the canonical event envelope",
          )],
        });
      }

      const scopeKey = JSON.stringify(context.scope_ref);
      const eventKey = JSON.stringify([scopeKey, consumer_id, event.event_id]);
      const aggregateKey = JSON.stringify([
        scopeKey,
        consumer_id,
        event.aggregate_ref.object_kind,
        event.aggregate_ref.object_id,
      ]);

      const prior = events.get(eventKey);
      if (prior) {
        if (prior.fingerprint !== fingerprint) {
          return createOperationResult<InboxAcceptance>({
            status: "REJECTED",
            correlation_id: context.correlation_id,
            errors: [createOperationError(
              "EVENT_ID_REUSED_WITH_DIFFERENT_PAYLOAD",
              "This consumer has already received the event_id with a different envelope fingerprint",
            )],
          });
        }

        return createOperationResult({
          status: "OK",
          correlation_id: context.correlation_id,
          data: { ...prior.acceptance, disposition: "DUPLICATE" },
        });
      }

      const cursor = aggregateCursors.get(aggregateKey);
      if (cursor && event.aggregate_version < cursor.version) {
        return createOperationResult<InboxAcceptance>({
          status: "REJECTED",
          correlation_id: context.correlation_id,
          errors: [createOperationError(
            "VERSION_CONFLICT",
            "The incoming event has a stale aggregate_version",
          )],
        });
      }

      if (cursor && event.aggregate_version === cursor.version) {
        if (cursor.event_types.has(event.event_type)) {
          return createOperationResult<InboxAcceptance>({
            status: "REJECTED",
            correlation_id: context.correlation_id,
            errors: [createOperationError(
              "VERSION_CONFLICT",
              "A fact of this event_type was already accepted for this aggregate_version",
            )],
          });
        }

        const existingTypes = [...cursor.event_types].sort();
        if (!options.allowSameVersionFact?.(existingTypes, event.event_type)) {
          return createOperationResult<InboxAcceptance>({
            status: "REJECTED",
            correlation_id: context.correlation_id,
            errors: [createOperationError(
              "VERSION_CONFLICT",
              "A distinct fact at the same aggregate_version is not enabled by this consumer contract",
            )],
          });
        }
      } else if (cursor && event.aggregate_version > cursor.version + 1) {
        return createOperationResult<InboxAcceptance>({
          status: "REJECTED",
          correlation_id: context.correlation_id,
          errors: [createOperationError(
            "VERSION_CONFLICT",
            "An aggregate version gap requires reconciliation before this event can be applied",
          )],
        });
      }

      const acceptance: InboxAcceptance = {
        event_id: event.event_id,
        consumer_id,
        aggregate_ref: {
          ...event.aggregate_ref,
          scope_ref: copyScopeRef(event.aggregate_ref.scope_ref),
        },
        aggregate_version: event.aggregate_version,
        disposition: "ACCEPTED",
        received_at: now(),
      };

      events.set(eventKey, { fingerprint, acceptance });
      if (!cursor || event.aggregate_version > cursor.version) {
        aggregateCursors.set(aggregateKey, {
          version: event.aggregate_version,
          event_types: new Set([event.event_type]),
        });
      } else {
        cursor.event_types.add(event.event_type);
      }

      return createOperationResult({
        status: "OK",
        correlation_id: context.correlation_id,
        data: acceptance,
      });
    },
  };
}
