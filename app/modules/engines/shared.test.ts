import { describe, expect, it } from "vitest";
import {
  createOperationResult,
  isObjectRef,
  isDomainEventEnvelope,
  isOperationStatus,
  isPrincipalRef,
  isRequestContext,
  isScopeRef,
  isSourceRef,
  isTimestamp,
  validateMutationContext,
  validateRequestContext,
  type RequestContext,
} from "./shared";

const scope = {
  scope_id: "scope-123",
  scope_kind: "WORK",
} as const;

const actor = {
  principal_id: "user-123",
  principal_kind: "USER",
} as const;

const context: RequestContext = {
  request_id: "request-123",
  correlation_id: "correlation-123",
  actor_ref: actor,
  scope_ref: scope,
  issued_at: "2026-11-13T03:00:00Z",
  idempotency_key: "idem-123",
  expected_version: "7",
};

describe("canonical shared reference contracts", () => {
  it("accepts valid scope, principal and object references", () => {
    expect(isScopeRef(scope)).toBe(true);
    expect(isPrincipalRef(actor)).toBe(true);
    expect(
      isObjectRef({
        object_kind: "WORK",
        object_id: "work-123",
        object_version: "7",
        scope_ref: scope,
      }),
    ).toBe(true);
  });

  it("rejects legacy reference field names and unknown enum values", () => {
    expect(isScopeRef({ id: "scope-123", kind: "WORK" })).toBe(false);
    expect(isPrincipalRef({ id: "user-123", kind: "HUMAN" })).toBe(false);
    expect(
      isObjectRef({
        engineId: "INV-02",
        kind: "WORK",
        id: "work-123",
        scope: scope,
      }),
    ).toBe(false);
    expect(isScopeRef({ scope_id: "x", scope_kind: "WORKSPACE" })).toBe(false);
  });

  it("rejects cyclic parent scope references", () => {
    const cyclic: Record<string, unknown> = {
      scope_id: "scope-cycle",
      scope_kind: "WORK",
    };
    cyclic.parent_scope_ref = cyclic;
    expect(isScopeRef(cyclic)).toBe(false);
  });

  it("validates SourceRef against the canonical ObjectRef", () => {
    const source = {
      object_ref: {
        object_kind: "ARTIFACT",
        object_id: "artifact-123",
        scope_ref: scope,
      },
      source_version: "sha-1",
      observed_at: "2026-11-13T03:00:00+01:00",
      trust_status: "UNASSESSED",
      freshness_status: "CURRENT",
    };
    expect(isSourceRef(source)).toBe(true);
    expect(isSourceRef({ ...source, trust_status: "TRUSTED" })).toBe(false);
  });
});

describe("canonical request context contracts", () => {
  it("accepts a valid context", () => {
    expect(isRequestContext(context)).toBe(true);
    expect(validateRequestContext(context)).toEqual([]);
  });

  it("requires an offset-aware RFC 3339 timestamp", () => {
    expect(isTimestamp("2026-11-13T03:00:00")).toBe(false);
    expect(isTimestamp("2026-11-13T03:00:00Z")).toBe(true);
    expect(isTimestamp("2026-11-13T03:00:00+01:00")).toBe(true);
    expect(isTimestamp("2026-02-29T03:00:00Z")).toBe(false);
    expect(isTimestamp("2024-02-29T03:00:00Z")).toBe(true);
    expect(isTimestamp("2026-04-31T03:00:00Z")).toBe(false);
    expect(isTimestamp("2026-11-13T24:00:00Z")).toBe(false);
    expect(isTimestamp("2026-11-13T03:00:60Z")).toBe(false);
    expect(isTimestamp("2026-11-13T03:00:00+14:01")).toBe(false);
    expect(isTimestamp("2026-11-13T03:00:00+14:00")).toBe(true);
  });

  it("rejects malformed contexts before mutation", () => {
    expect(
      validateRequestContext({
        ...context,
        actor_ref: { principal_id: "", principal_kind: "USER" },
      }),
    ).toContain("actor_ref is invalid");
  });

  it("requires idempotency for mutations and version for guarded updates", () => {
    const { idempotency_key: _idempotency, ...withoutKey } = context;
    expect(validateMutationContext(withoutKey)).toContain(
      "Mutations require idempotency_key",
    );
    const { expected_version: _version, ...withoutVersion } = context;
    expect(
      validateMutationContext(withoutVersion, {
        requireExpectedVersion: true,
      }),
    ).toContain("This mutation requires expected_version");
  });

  it("requires deadline to be later than issued_at", () => {
    expect(
      validateRequestContext({
        ...context,
        deadline: "2026-11-13T02:59:59Z",
      }),
    ).toContain("deadline must be later than issued_at");
  });
});

describe("canonical cross-engine event envelope", () => {
  it("accepts a scoped, correlated versioned event", () => {
    expect(isDomainEventEnvelope({
      event_id: "event-1",
      event_type: "work.created",
      schema_version: 1,
      occurred_at: "2026-11-13T03:00:00Z",
      producer_engine: "INV-02",
      object_ref: {
        object_kind: "WORK",
        object_id: "work-1",
        object_version: "1",
        scope_ref: scope,
      },
      scope_ref: scope,
      correlation_id: "corr-1",
      actor_ref: actor,
      payload: { title: "A Work item" },
    })).toBe(true);
  });

  it("rejects an event with a mismatched scope or unknown producer", () => {
    const event = {
      event_id: "event-1",
      event_type: "work.created",
      schema_version: 1,
      occurred_at: "2026-11-13T03:00:00Z",
      producer_engine: "INV-02",
      object_ref: {
        object_kind: "WORK",
        object_id: "work-1",
        object_version: "1",
        scope_ref: scope,
      },
      scope_ref: scope,
      correlation_id: "corr-1",
      payload: {},
    };
    expect(isDomainEventEnvelope({ ...event, producer_engine: "INV-22" })).toBe(false);
    expect(isDomainEventEnvelope({
      ...event,
      scope_ref: { scope_id: "other", scope_kind: "WORK" },
    })).toBe(false);
  });
});

describe("canonical operation result envelope", () => {
  it("uses only canonical statuses and includes stable envelope fields", () => {
    expect(
      createOperationResult({
        status: "PARTIAL",
        correlation_id: "correlation-123",
        data: { accepted: true },
        warnings: ["One optional step was skipped"],
        object_version: "8",
      }),
    ).toEqual({
      status: "PARTIAL",
      data: { accepted: true },
      errors: [],
      warnings: ["One optional step was skipped"],
      correlation_id: "correlation-123",
      object_version: "8",
    });
  });

  it("keeps domain outcomes outside the operation status vocabulary", () => {
    expect(isOperationStatus("PASS")).toBe(false);
    expect(isOperationStatus("COMPLETED")).toBe(false);
    expect(isOperationStatus("UNKNOWN")).toBe(true);
    expect(
      createOperationResult({
        status: "UNKNOWN",
        correlation_id: "correlation-123",
      }).status,
    ).toBe("UNKNOWN");
  });
});
