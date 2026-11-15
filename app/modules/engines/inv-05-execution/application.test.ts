import { describe, expect, it } from "vitest";
import type { ClockPort, ObjectRef, RequestContext } from "../shared";
import {
  submitExecution,
  validateExecutionAdmission,
  type ExecutionAdmissionReaderPort,
  type ExecutionAdmissionSnapshot,
} from "./application";
import type { EngineUnitOfWorkPort } from "../shared";
import type { ExecutionRequest, RuntimeProfile } from "./domain";

const scope = { scope_id: "scope-1", scope_kind: "WORK" as const };
const otherScope = { scope_id: "scope-2", scope_kind: "WORK" as const };
const context: RequestContext = {
  request_id: "request-1",
  correlation_id: "correlation-1",
  actor_ref: { principal_id: "user-1", principal_kind: "USER" },
  scope_ref: scope,
  issued_at: "2026-11-15T08:00:00Z",
  idempotency_key: "execution-idem-1",
};
const ref = (object_kind: string, object_id: string, object_version = "1", refScope = scope): ObjectRef => ({
  object_kind, object_id, object_version, scope_ref: refScope,
});
const profile = (): RuntimeProfile => ({
  profile_ref: ref("RUNTIME_PROFILE", "profile-1"),
  profile_version: "1",
  profile_status: "APPROVED",
  trust_class: "TRUSTED_INTERNAL_TASK",
  isolation_requirement: "APPROVED_INTERNAL_ISOLATION_V1",
  cpu_limit: { value: 1, unit: "vCPU" },
  memory_limit: { value: 512, unit: "MiB" },
  wall_time_limit: { value: 60, unit: "seconds" },
  storage_limit: { value: 128, unit: "MiB" },
  process_limit: 1,
  output_size_limit: { value: 2, unit: "MiB" },
  concurrency_limit: 1,
  network_egress_policy_ref: ref("NETWORK_EGRESS_POLICY", "egress-1"),
  filesystem_policy_ref: ref("FILESYSTEM_POLICY", "filesystem-1"),
  allowed_capability_refs: [ref("CAPABILITY", "capability-1", "1")],
  permitted_output_kinds: ["TEXT", "JSON"],
  created_at: "2026-11-15T07:59:00Z",
});
const request = (): ExecutionRequest => ({
  execution_ref: ref("EXECUTION", "execution-1"),
  work_ref: ref("WORK", "work-1"),
  orchestration_run_ref: ref("ORCHESTRATION_RUN", "run-1"),
  graph_revision_ref: ref("WORK_GRAPH_REVISION", "graph-revision-1"),
  graph_node_ref: ref("GRAPH_NODE", "node-1"),
  dispatch_ref: ref("DISPATCH_ATTEMPT", "dispatch-1"),
  capability_ref: ref("CAPABILITY", "capability-1", "1"),
  capability_version: "1",
  actor_ref: context.actor_ref,
  authorization_decision_ref: ref("AUTHORITY_DECISION", "authority-1"),
  runtime_profile: profile(),
  input_refs: [ref("ARTIFACT", "input-1")],
  input_digests: ["sha256-input-1"],
  request_digest: "sha256-request-1",
  idempotency_key: "execution-idem-1",
  side_effect_class: "NON_IDEMPOTENT",
  deadline: "2026-11-15T08:01:00Z",
});
const admission = (overrides: Partial<ExecutionAdmissionSnapshot> = {}): ExecutionAdmissionSnapshot => ({
  checked_at: "2026-11-15T08:00:05Z",
  authorization: {
    decision_ref: ref("AUTHORITY_DECISION", "authority-1"),
    disposition: "ALLOWED",
    current: true,
    valid_until: "2026-11-15T08:05:00Z",
  },
  capability: {
    capability_ref: ref("CAPABILITY", "capability-1", "1"),
    version: "1",
    eligible: true,
    current: true,
  },
  resource: {
    admission_ref: ref("RESOURCE_ADMISSION", "resource-admission-1"),
    state: "ADMITTED",
    current: true,
  },
  environment: {
    environment_ref: ref("ENVIRONMENT", "environment-1"),
    permitted: true,
    current: true,
  },
  ...overrides,
});

describe("INV-05 execution application admission boundary", () => {
  it("accepts only fresh, exact, source-owned admission references", () => {
    const result = validateExecutionAdmission(
      context, request(), admission(), "2026-11-15T08:00:06Z",
    );
    expect(result.status).toBe("OK");
  });

  it("fails closed when current authorization is denied, unknown, expired or stale", () => {
    for (const disposition of ["DENIED", "UNKNOWN", "REQUIRES_APPROVAL"] as const) {
      const result = validateExecutionAdmission(
        context,
        request(),
        admission({ authorization: {
          ...admission().authorization,
          disposition,
        } }),
        "2026-11-15T08:00:06Z",
      );
      expect(result.status).toBe("REJECTED");
    }

    const expired = validateExecutionAdmission(
      context,
      request(),
      admission({ authorization: {
        ...admission().authorization,
        valid_until: "2026-11-15T08:00:05Z",
      } }),
      "2026-11-15T08:00:06Z",
    );
    expect(expired.status).toBe("REJECTED");

    const stale = validateExecutionAdmission(
      context,
      request(),
      admission({ authorization: {
        ...admission().authorization,
        current: false,
      } }),
      "2026-11-15T08:00:06Z",
    );
    expect(stale.status).toBe("REJECTED");
  });

  it("rejects capability substitution and deferred or unknown resource admission", () => {
    const capabilityMismatch = validateExecutionAdmission(
      context,
      request(),
      admission({ capability: {
        ...admission().capability,
        capability_ref: ref("CAPABILITY", "other-capability", "1"),
      } }),
      "2026-11-15T08:00:06Z",
    );
    expect(capabilityMismatch.status).toBe("REJECTED");

    for (const state of ["DENIED", "DEFERRED", "UNKNOWN"] as const) {
      const result = validateExecutionAdmission(
        context,
        request(),
        admission({ resource: { ...admission().resource, state } }),
        "2026-11-15T08:00:06Z",
      );
      expect(result.status).toBe("REJECTED");
      expect(result.errors[0]?.code).toBe("RESOURCE_LIMIT");
    }
  });

  it("rejects a blocked deployment environment and any cross-scope admission ref", () => {
    const environmentBlocked = validateExecutionAdmission(
      context,
      request(),
      admission({ environment: { ...admission().environment, permitted: false } }),
      "2026-11-15T08:00:06Z",
    );
    expect(environmentBlocked.status).toBe("REJECTED");

    const foreignResource = validateExecutionAdmission(
      context,
      request(),
      admission({ resource: {
        ...admission().resource,
        admission_ref: ref("RESOURCE_ADMISSION", "foreign", "1", otherScope),
      } }),
      "2026-11-15T08:00:06Z",
    );
    expect(foreignResource.status).toBe("REJECTED");
  });

  it("does not persist or enqueue an Execution when admission is denied", async () => {
    let unitOfWorkCalled = false;
    const unitOfWork = {
      execute: async () => {
        unitOfWorkCalled = true;
        throw new Error("Persistence must not be reached");
      },
    } as unknown as EngineUnitOfWorkPort;
    const reader: ExecutionAdmissionReaderPort = {
      readCurrentAdmission: async () => ({
        status: "OK",
        correlation_id: context.correlation_id,
        data: admission({ authorization: {
          ...admission().authorization,
          disposition: "DENIED",
        } }),
        errors: [],
        warnings: [],
      }),
    };
    const clock: ClockPort = { now: () => "2026-11-15T08:00:06Z" };

    const result = await submitExecution(unitOfWork, reader, clock, {
      context,
      request: request(),
      execution_event_ref: ref("DOMAIN_EVENT", "event-accepted-1"),
      created_at: "2026-11-15T08:00:06Z",
    });
    expect(result.status).toBe("REJECTED");
    expect(unitOfWorkCalled).toBe(false);
  });

  it("reports an unavailable admission source without assuming permission", async () => {
    const unitOfWork = { execute: async () => { throw new Error("Must not run"); } } as unknown as EngineUnitOfWorkPort;
    const reader: ExecutionAdmissionReaderPort = {
      readCurrentAdmission: async () => {
        throw new Error("authorization dependency unavailable");
      },
    };
    const clock: ClockPort = { now: () => "2026-11-15T08:00:06Z" };
    const result = await submitExecution(unitOfWork, reader, clock, {
      context,
      request: request(),
      execution_event_ref: ref("DOMAIN_EVENT", "event-accepted-2"),
      created_at: "2026-11-15T08:00:06Z",
    });
    expect(result.status).toBe("REJECTED");
    expect(result.errors[0]?.code).toBe("DEPENDENCY_UNAVAILABLE");
  });
});
