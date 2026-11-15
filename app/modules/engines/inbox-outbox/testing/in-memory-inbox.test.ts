import { describe, expect, it } from "vitest";
import type { InboxEventEnvelope, RequestContext } from "../../shared";
import { createInMemoryEventInbox } from "./in-memory-inbox";

const scope = { scope_id: "tenant-a", scope_kind: "ORGANIZATION" as const };
const context: RequestContext = {
  request_id: "request-1",
  correlation_id: "correlation-1",
  actor_ref: { principal_id: "user-1", principal_kind: "USER" },
  scope_ref: scope,
  issued_at: "2026-11-15T10:00:00Z",
};

const event = (
  event_id: string,
  aggregate_version = 7,
  event_type = "inventory.stock-adjusted",
): InboxEventEnvelope => ({
  event_id,
  event_type,
  schema_version: 1,
  occurred_at: "2026-11-15T10:00:00Z",
  producer_engine: "INV-02",
  object_ref: {
    object_kind: "STOCK_ITEM",
    object_id: "item-1",
    object_version: String(aggregate_version),
    scope_ref: scope,
  },
  aggregate_ref: {
    object_kind: "INVENTORY",
    object_id: "inventory-1",
    object_version: String(aggregate_version),
    scope_ref: scope,
  },
  aggregate_version,
  scope_ref: scope,
  correlation_id: "correlation-1",
  payload: { quantity_delta: 3, sku: "SKU-1" },
});

describe("In-memory Inbox reference conformance", () => {
  it("accepts a new event and deduplicates the same event_id/fingerprint", async () => {
    const inbox = createInMemoryEventInbox();
    const first = event("event-1");
    const accepted = await inbox.accept(context, "inventory-projection-v1", first, "a".repeat(64));
    const replay = await inbox.accept(context, "inventory-projection-v1", first, "a".repeat(64));

    expect(accepted.status).toBe("OK");
    expect(accepted.data?.disposition).toBe("ACCEPTED");
    expect(replay.status).toBe("OK");
    expect(replay.data?.disposition).toBe("DUPLICATE");
    expect(replay.data?.received_at).toBe(accepted.data?.received_at);
  });

  it("rejects event_id reuse with a different envelope fingerprint", async () => {
    const inbox = createInMemoryEventInbox();
    await inbox.accept(context, "inventory-projection-v1", event("event-1"), "a".repeat(64));
    const replay = await inbox.accept(context, "inventory-projection-v1", event("event-1"), "b".repeat(64));

    expect(replay.status).toBe("REJECTED");
    expect(replay.errors[0]?.code).toBe("EVENT_ID_REUSED_WITH_DIFFERENT_PAYLOAD");
  });

  it("rejects an older aggregate version after a newer version was accepted", async () => {
    const inbox = createInMemoryEventInbox();
    await inbox.accept(context, "inventory-projection-v1", event("event-7", 7), "a".repeat(64));
    const stale = await inbox.accept(context, "inventory-projection-v1", event("event-6", 6), "b".repeat(64));

    expect(stale.status).toBe("REJECTED");
    expect(stale.errors[0]?.code).toBe("VERSION_CONFLICT");
  });

  it("allows distinct fact types to share the same aggregate version", async () => {
    const inbox = createInMemoryEventInbox();
    const first = await inbox.accept(
      context,
      "inventory-projection-v1",
      event("event-1", 7, "inventory.stock-adjusted"),
      "a".repeat(64),
    );
    const second = await inbox.accept(
      context,
      "inventory-projection-v1",
      event("event-2", 7, "inventory.item-counted"),
      "b".repeat(64),
    );

    expect(first.status).toBe("OK");
    expect(second.status).toBe("OK");
    expect(second.data?.disposition).toBe("ACCEPTED");
  });

  it("isolates event IDs between consumers", async () => {
    const inbox = createInMemoryEventInbox();
    const first = await inbox.accept(context, "inventory-projection-v1", event("event-1"), "a".repeat(64));
    const second = await inbox.accept(context, "stock-alert-projection-v1", event("event-1"), "a".repeat(64));

    expect(first.data?.disposition).toBe("ACCEPTED");
    expect(second.data?.disposition).toBe("ACCEPTED");
  });

  it("keeps the same event ID independent across tenant scopes", async () => {
    const inbox = createInMemoryEventInbox();
    const first = await inbox.accept(context, "inventory-projection-v1", event("event-1"), "a".repeat(64));
    const otherScope = { scope_id: "tenant-b", scope_kind: "ORGANIZATION" as const };
    const otherContext: RequestContext = {
      ...context,
      scope_ref: otherScope,
    };
    const otherEvent = {
      ...event("event-1"),
      scope_ref: otherScope,
      object_ref: {
        object_kind: "STOCK_ITEM",
        object_id: "item-1",
        object_version: "7",
        scope_ref: otherScope,
      },
      aggregate_ref: {
        object_kind: "INVENTORY",
        object_id: "inventory-1",
        object_version: "7",
        scope_ref: otherScope,
      },
    };
    const second = await inbox.accept(
      otherContext,
      "inventory-projection-v1",
      otherEvent,
      "b".repeat(64),
    );

    expect(first.data?.disposition).toBe("ACCEPTED");
    expect(second.data?.disposition).toBe("ACCEPTED");
  });
});
