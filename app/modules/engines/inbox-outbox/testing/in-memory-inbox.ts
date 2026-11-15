import {
  createOperationError,
  createOperationResult,
  type EventInboxPort,
  type InboxAcceptance,
  type InboxEventEnvelope,
  type RequestContext,
} from "../../shared";
import { validateInboxEvent } from "../domain";

/**
 * Test/reference adapter only. This store is intentionally process-local and
 * is not durable; production adapters must enforce the same rules inside the
 * owning database transaction.
 */
export function createInMemoryEventInbox(): EventInboxPort {
  const events = new Map<string, {
    fingerprint: string;
    acceptance: InboxAcceptance;
  }>();
  const aggregateVersions = new Map<string, number>();

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

      const scopeKey = `${context.scope_ref.scope_kind}:${context.scope_ref.scope_id}`;
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

      const currentVersion = aggregateVersions.get(aggregateKey);
      if (currentVersion !== undefined && event.aggregate_version < currentVersion) {
        return createOperationResult<InboxAcceptance>({
          status: "REJECTED",
          correlation_id: context.correlation_id,
          errors: [createOperationError(
            "VERSION_CONFLICT",
            "The incoming event has a stale aggregate_version",
          )],
        });
      }

      const acceptance: InboxAcceptance = {
        event_id: event.event_id,
        consumer_id,
        aggregate_ref: event.aggregate_ref,
        aggregate_version: event.aggregate_version,
        disposition: "ACCEPTED",
        received_at: context.issued_at,
      };

      events.set(eventKey, { fingerprint, acceptance });
      aggregateVersions.set(
        aggregateKey,
        Math.max(currentVersion ?? 0, event.aggregate_version),
      );

      return createOperationResult({
        status: "OK",
        correlation_id: context.correlation_id,
        data: acceptance,
      });
    },
  };
}
