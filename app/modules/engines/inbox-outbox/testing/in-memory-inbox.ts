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
  /** Shared test state when Inbox must participate in an enclosing Unit of Work. */
  state?: InMemoryInboxState;
  /**
   * Same-version distinct fact types are permitted only when the owning
   * aggregate/consumer contract explicitly opts in.
   */
  allowSameVersionFact?: (
    existing_event_types: readonly string[],
    incoming_event_type: string,
  ) => boolean;
}

export interface InMemoryAggregateCursor {
  version: number;
  event_types: Set<string>;
}

export interface InMemoryInboxEventRecord {
  fingerprint: string;
  acceptance: InboxAcceptance;
}

/** Injectable state lets the test Unit of Work roll Inbox writes back with other writes. */
export interface InMemoryInboxState {
  events: Map<string, InMemoryInboxEventRecord>;
  aggregateCursors: Map<string, InMemoryAggregateCursor>;
}

export function createInMemoryInboxState(): InMemoryInboxState {
  return {
    events: new Map(),
    aggregateCursors: new Map(),
  };
}

export function cloneInMemoryInboxState(state: InMemoryInboxState): InMemoryInboxState {
  return {
    events: new Map([...state.events].map(([key, record]) => [
      key,
      {
        fingerprint: record.fingerprint,
        acceptance: structuredClone(record.acceptance),
      },
    ])),
    aggregateCursors: new Map([...state.aggregateCursors].map(([key, cursor]) => [
      key,
      { version: cursor.version, event_types: new Set(cursor.event_types) },
    ])),
  };
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

function scopeKey(scope: ScopeRef): string {
  return JSON.stringify([
    scope.scope_kind,
    scope.scope_id,
    scope.parent_scope_ref ? scopeKey(scope.parent_scope_ref) : null,
  ]);
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
  const state = options.state ?? createInMemoryInboxState();
  const { events, aggregateCursors } = state;

  return {
    accept: async (
      context: RequestContext,
      consumer_id: string,
      event: InboxEventEnvelope,
    ) => {
      const issues = validateInboxEvent(context, consumer_id, event);
      if (issues.length > 0) {
        return createOperationResult<InboxAcceptance>({
          status: "REJECTED",
          correlation_id: context.correlation_id,
          errors: [createOperationError(
            "VALIDATION_ERROR",
            issues.join("; "),
          )],
        });
      }

      // The adapter owns fingerprint calculation; callers cannot supply or forge it.
      const verifiedFingerprint = await fingerprintInboxEvent(context, consumer_id, event);
      if (verifiedFingerprint.status !== "OK" || !verifiedFingerprint.data) {
        return createOperationResult<InboxAcceptance>({
          status: "REJECTED",
          correlation_id: context.correlation_id,
          errors: verifiedFingerprint.errors,
          warnings: verifiedFingerprint.warnings,
        });
      }
      const fingerprint = verifiedFingerprint.data;

      const scopedIdentity = scopeKey(context.scope_ref);
      const eventKey = JSON.stringify([scopedIdentity, consumer_id, event.event_id]);
      const aggregateKey = JSON.stringify([
        scopedIdentity,
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
