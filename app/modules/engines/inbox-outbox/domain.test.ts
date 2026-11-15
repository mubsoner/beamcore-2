import { describe, expect, it } from "vitest";
import type { InboxEventEnvelope, RequestContext } from "../shared";
import {
  buildInboxFingerprintMaterial,
  fingerprintInboxEvent,
  validateInboxEvent,
} from "./domain";

const scope = { scope_id: "tenant-a", scope_kind: "ORGANIZATION" as const };
const context: RequestContext = {
  request_id: "request-1",
  correlation_id: "correlation-1",
  actor_ref: { principal_id: "user-1", principal_kind: "USER" },
  scope_ref: scope,
  issued_at: "2026-11-15T10:00:00Z",
};

const event = (overrides: Partial<InboxEventEnvelope> = {}): InboxEventEnvelope => ({
  event_id: "event-1",
  event_type: "inventory.stock-adjusted",
  schema_version: 1,
  occurred_at: "2026-11-15T10:00:00Z",
  producer_engine: "INV-02",
  object_ref: {
    object_kind: "STOCK_ITEM",
    object_id: "item-1",
    object_version: "7",
    scope_ref: scope,
  },
  aggregate_ref: {
    object_kind: "INVENTORY",
    object_id: "inventory-1",
    object_version: "7",
    scope_ref: scope,
  },
  aggregate_version: 7,
  scope_ref: scope,
  correlation_id: "correlation-1",
  payload: { quantity_delta: 3, sku: "SKU-1" },
  ...overrides,
});

describe("Inbox event contract", () => {
  it("requires authenticated scope and matching aggregate scope", () => {
    expect(validateInboxEvent(context, "inventory-projection-v1", event())).toEqual([]);

    const mismatched = event({
      aggregate_ref: {
        object_kind: "INVENTORY",
        object_id: "inventory-1",
        object_version: "7",
        scope_ref: { scope_id: "tenant-b", scope_kind: "ORGANIZATION" },
      },
    });
    expect(validateInboxEvent(context, "inventory-projection-v1", mismatched)).toContain(
      "aggregate_ref scope must match event scope_ref",
    );
  });

  it("compares the complete hierarchical tenant scope path", () => {
    const parentA = { scope_id: "org-a", scope_kind: "ORGANIZATION" as const };
    const parentB = { scope_id: "org-b", scope_kind: "ORGANIZATION" as const };
    const childScope = {
      scope_id: "project-1",
      scope_kind: "PROJECT" as const,
      parent_scope_ref: parentA,
    };
    const childContext: RequestContext = { ...context, scope_ref: childScope };
    const foreignParentEvent = event({
      scope_ref: {
        scope_id: "project-1",
        scope_kind: "PROJECT",
        parent_scope_ref: parentB,
      },
      object_ref: {
        object_kind: "STOCK_ITEM",
        object_id: "item-1",
        object_version: "7",
        scope_ref: {
          scope_id: "project-1",
          scope_kind: "PROJECT",
          parent_scope_ref: parentB,
        },
      },
      aggregate_ref: {
        object_kind: "INVENTORY",
        object_id: "inventory-1",
        object_version: "7",
        scope_ref: {
          scope_id: "project-1",
          scope_kind: "PROJECT",
          parent_scope_ref: parentB,
        },
      },
    });

    expect(validateInboxEvent(
      childContext,
      "inventory-projection-v1",
      foreignParentEvent,
    )).toContain("event scope_ref must match the authenticated request scope");
  });

  it("rejects an event outside the authenticated request scope", () => {
    const foreign = event({
      scope_ref: { scope_id: "tenant-b", scope_kind: "ORGANIZATION" },
      object_ref: {
        object_kind: "STOCK_ITEM",
        object_id: "item-1",
        object_version: "7",
        scope_ref: { scope_id: "tenant-b", scope_kind: "ORGANIZATION" },
      },
      aggregate_ref: {
        object_kind: "INVENTORY",
        object_id: "inventory-1",
        object_version: "7",
        scope_ref: { scope_id: "tenant-b", scope_kind: "ORGANIZATION" },
      },
    });
    expect(validateInboxEvent(context, "inventory-projection-v1", foreign)).toContain(
      "event scope_ref must match the authenticated request scope",
    );
  });

  it("requires the aggregate reference version to match the monotonic version", () => {
    expect(validateInboxEvent(
      context,
      "inventory-projection-v1",
      event({ aggregate_version: 8 }),
    )).toContain("aggregate_ref.object_version must match aggregate_version");
  });

  it("normalizes object key order before fingerprinting", async () => {
    const first = event({ payload: { sku: "SKU-1", dimensions: { width: 3, height: 4 } } });
    const second = event({ payload: { dimensions: { height: 4, width: 3 }, sku: "SKU-1" } });
    const firstFingerprint = await fingerprintInboxEvent(context, "inventory-projection-v1", first);
    const secondFingerprint = await fingerprintInboxEvent(context, "inventory-projection-v1", second);

    expect(firstFingerprint.status).toBe("OK");
    expect(secondFingerprint.status).toBe("OK");
    expect(firstFingerprint.data).toBe(secondFingerprint.data);
    expect(firstFingerprint.data).toMatch(/^[a-f0-9]{64}$/);
  });

  it("binds the fingerprint to scope, aggregate, version, event type and payload", () => {
    const baseline = buildInboxFingerprintMaterial(context, "inventory-projection-v1", event());
    const changedPayload = buildInboxFingerprintMaterial(
      context,
      "inventory-projection-v1",
      event({ payload: { quantity_delta: 4, sku: "SKU-1" } }),
    );
    const changedVersion = buildInboxFingerprintMaterial(
      context,
      "inventory-projection-v1",
      event({
        aggregate_version: 8,
        aggregate_ref: {
          object_kind: "INVENTORY",
          object_id: "inventory-1",
          object_version: "8",
          scope_ref: scope,
        },
      }),
    );
    const changedType = buildInboxFingerprintMaterial(
      context,
      "inventory-projection-v1",
      event({ event_type: "inventory.item-renamed" }),
    );

    expect(baseline.status).toBe("OK");
    expect(changedPayload.data).not.toBe(baseline.data);
    expect(changedVersion.data).not.toBe(baseline.data);
    expect(changedType.data).not.toBe(baseline.data);
  });

  it("rejects non-JSON payload values rather than silently normalizing them", () => {
    const invalid = event({ payload: { value: undefined } });
    const result = buildInboxFingerprintMaterial(context, "inventory-projection-v1", invalid);
    expect(result.status).toBe("REJECTED");
    expect(result.errors[0]?.code).toBe("INTEGRITY_OR_UNTRUSTED_INPUT");
  });

  it("does not include event_id in the semantic fingerprint material", () => {
    const first = buildInboxFingerprintMaterial(context, "inventory-projection-v1", event());
    const redelivery = buildInboxFingerprintMaterial(
      context,
      "inventory-projection-v1",
      event({ event_id: "event-redelivery" }),
    );
    expect(first.data).toBe(redelivery.data);
  });
});
