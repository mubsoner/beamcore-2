import { describe, expect, it } from "vitest";
import type { InboxEventEnvelope, RequestContext } from "../../shared";
import { fingerprintInboxEvent } from "../domain";
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

async function accept(
  inbox: ReturnType<typeof createInMemoryEventInbox>,
  consumer_id: string,
  incoming: InboxEventEnvelope,
) {
  const fingerprint = await fingerprintInboxEvent(context, consumer_id, incoming);
  if (fingerprint.status !== "OK" || !fingerprint.data) {
    throw new Error("Test event fingerprint could not be computed");
  }
  return inbox.accept(context, consumer_id, incoming, fingerprint.data);
}

describe("In-memory Inbox reference conformance", () => {
  it("accepts a new event and deduplicates the same event_id/fingerprint", async () => {
    const inbox = createInMemoryEventInbox({ now: () => "2026-11-15T10:01:00Z" });
    const first = event("event-1");
    const accepted = await accept(inbox, "inventory-projection-v1", first);
    const replay = await accept(inbox, "inventory-projection-v1", first);

    expect(accepted.status).toBe("OK");
    expect(accepted.data?.disposition).toBe("ACCEPTED");
    expect(replay.status).toBe("OK");
    expect(replay.data?.disposition).toBe("DUPLICATE");
    expect(replay.data?.received_at).toBe("2026-11-15T10:01:00Z");
  });

  it("rejects event_id reuse with a different envelope fingerprint", async () => {
    const inbox = createInMemoryEventInbox();
    await accept(inbox, "inventory-projection-v1", event("event-1"));
    const altered = event("event-1");
    altered.payload = { quantity_delta: 99, sku: "SKU-1" };
    const replay = await accept(inbox, "inventory-projection-v1", altered);

    expect(replay.status).toBe("REJECTED");
    expect(replay.errors[0]?.code).toBe("EVENT_ID_REUSED_WITH_DIFFERENT_PAYLOAD");
  });

  it("rejects an older aggregate version after a newer version was accepted", async () => {
    const inbox = createInMemoryEventInbox();
    await accept(inbox, "inventory-projection-v1", event("event-7", 7));
    const stale = await accept(inbox, "inventory-projection-v1", event("event-6", 6));

    expect(stale.status).toBe("REJECTED");
    expect(stale.errors[0]?.code).toBe("VERSION_CONFLICT");
  });

  it("requires explicit reconciliation when an aggregate version is skipped", async () => {
    const inbox = createInMemoryEventInbox();
    await accept(inbox, "inventory-projection-v1", event("event-7", 7));
    const gap = await accept(inbox, "inventory-projection-v1", event("event-9", 9));

    expect(gap.status).toBe("REJECTED");
    expect(gap.errors[0]?.code).toBe("VERSION_CONFLICT");
    expect(gap.errors[0]?.safe_message).toContain("version gap");
  });

  it("rejects two facts of the same type at one aggregate version", async () => {
    const inbox = createInMemoryEventInbox();
    await accept(inbox, "inventory-projection-v1", event("event-1", 7));
    const duplicateType = await accept(inbox, "inventory-projection-v1", event("event-2", 7));

    expect(duplicateType.status).toBe("REJECTED");
    expect(duplicateType.errors[0]?.code).toBe("VERSION_CONFLICT");
  });

  it("allows distinct fact types at one version only when the consumer opts in", async () => {
    const inbox = createInMemoryEventInbox({
      allowSameVersionFact: () => true,
    });
    const first = await accept(
      inbox,
      "inventory-projection-v1",
      event("event-1", 7, "inventory.stock-adjusted"),
    );
    const second = await accept(
      inbox,
      "inventory-projection-v1",
      event("event-2", 7, "inventory.item-counted"),
    );

    expect(first.status).toBe("OK");
    expect(second.status).toBe("OK");
    expect(second.data?.disposition).toBe("ACCEPTED");
  });

  it("rejects a forged fingerprint", async () => {
    const inbox = createInMemoryEventInbox();
    const result = await inbox.accept(
      context,
      "inventory-projection-v1",
      event("event-1"),
      "a".repeat(64),
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errors[0]?.code).toBe("INTEGRITY_OR_UNTRUSTED_INPUT");
  });

  it("isolates event IDs between consumers", async () => {
    const inbox = createInMemoryEventInbox();
    const first = await accept(inbox, "inventory-projection-v1", event("event-1"));
    const second = await accept(inbox, "stock-alert-projection-v1", event("event-1"));

    expect(first.data?.disposition).toBe("ACCEPTED");
    expect(second.data?.disposition).toBe("ACCEPTED");
  });

  it("keeps the same event ID independent across tenant scopes", async () => {
    const inbox = createInMemoryEventInbox();
    const first = await accept(inbox, "inventory-projection-v1", event("event-1"));
    const otherScope = { scope_id: "tenant-b", scope_kind: "ORGANIZATION" as const };
    const otherContext: RequestContext = { ...context, scope_ref: otherScope };
    const otherEvent: InboxEventEnvelope = {
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
    const fingerprint = await fingerprintInboxEvent(
      otherContext,
      "inventory-projection-v1",
      otherEvent,
    );
    if (fingerprint.status !== "OK" || !fingerprint.data) {
      throw new Error("Tenant B event fingerprint could not be computed");
    }
    const second = await inbox.accept(
      otherContext,
      "inventory-projection-v1",
      otherEvent,
      fingerprint.data,
    );

    expect(first.data?.disposition).toBe("ACCEPTED");
    expect(second.data?.disposition).toBe("ACCEPTED");
  });
});
