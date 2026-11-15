import { describe, expect, it } from "vitest";
import type { ClockPort, EngineTransaction, ObjectRef, OperationResult, RequestContext } from "../shared";
import {
  submitExecution,
  readExecutionSnapshot,
  readExecutionInvocationManifest,
  validateExecutionAdmission,
  type ExecutionAdmissionReaderPort,
  type ExecutionAdmissionSnapshot,
  type ExecutionInvocationManifest,
  type ExecutionReadPort,
} from "./application";
import type { EngineUnitOfWorkPort } from "../shared";
import {
  createExecutionRecord,
  startExecutionAttempt,
  transitionExecution,
  type ExecutionRequest,
  type RuntimeProfile,
} from "./domain";
import type { DispatchAttempt } from "../inv-04-orchestration/domain";

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
const profile = (overrides: Partial<RuntimeProfile> = {}): RuntimeProfile => ({
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
  ...overrides,
});
const request = (overrides: Partial<ExecutionRequest> = {}): ExecutionRequest => ({
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
  ...overrides,
});
const dispatchAttempt = (overrides: Partial<DispatchAttempt> = {}): DispatchAttempt => ({
  dispatch_ref: ref("DISPATCH_ATTEMPT", "dispatch-1"),
  orchestration_ref: ref("ORCHESTRATION_RUN", "run-1"),
  node_coordination_ref: ref("NODE_COORDINATION", "coordination-1"),
  work_ref: ref("WORK", "work-1"),
  graph_revision_ref: ref("WORK_GRAPH_REVISION", "graph-revision-1"),
  graph_node_ref: ref("GRAPH_NODE", "node-1"),
  target_capability_ref: ref("CAPABILITY", "capability-1", "1"),
  target_capability_version: "1",
  state: "CREATED",
  attempt_number: 1,
  idempotency_key: "execution-idem-1",
  request_correlation_id: context.correlation_id,
  authorization_decision_ref: ref("AUTHORITY_DECISION", "authority-1"),
  resource_admission_ref: ref("RESOURCE_ADMISSION", "resource-admission-1"),
  error_refs: [],
  created_at: "2026-11-15T08:00:04Z",
  updated_at: "2026-11-15T08:00:04Z",
  ...overrides,
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

function executionFixture() {
  const result = createExecutionRecord(context, request(), "2026-11-15T08:00:01Z");
  if (result.status !== "OK" || !result.data) throw new Error("Execution fixture failed");
  return result.data;
}

const admissionReader = (
  overrides: Partial<ExecutionAdmissionReaderPort> = {},
  sourceProfile: RuntimeProfile = profile(),
): ExecutionAdmissionReaderPort => ({
  readRuntimeProfile: async () => ({
    status: "OK",
    correlation_id: context.correlation_id,
    data: sourceProfile,
    errors: [],
    warnings: [],
  }),
  readDispatchAttempt: async () => ({
    status: "OK",
    correlation_id: context.correlation_id,
    data: dispatchAttempt(),
    errors: [],
    warnings: [],
  }),
  readCurrentAdmission: async () => ({
    status: "OK",
    correlation_id: context.correlation_id,
    data: admission(),
    errors: [],
    warnings: [],
  }),
  ...overrides,
});

describe("INV-05 execution application admission boundary", () => {
  it("reads Execution state and complete attempt history without changing separate status dimensions", async () => {
    const created = createExecutionRecord(context, request(), "2026-11-15T08:00:01Z");
    if (!created.data) throw new Error("Execution fixture missing");
    const reader: ExecutionReadPort = {
      readExecution: async () => ({
        status: "OK", correlation_id: context.correlation_id,
        data: { ...created.data!, state: "UNKNOWN", effect_knowledge: "UNKNOWN", cleanup_state: "FAILED" },
        errors: [], warnings: [],
      }),
      readAttempts: async () => ({ status: "OK", correlation_id: context.correlation_id, data: [], errors: [], warnings: [] }),
      readInvocationManifest: async () => { throw new Error("Not used"); },
    };
    const result = await readExecutionSnapshot(reader, context, created.data.execution_ref);
    expect(result.status).toBe("OK");
    expect(result.data?.execution.state).toBe("UNKNOWN");
    expect(result.data?.execution.effect_knowledge).toBe("UNKNOWN");
    expect(result.data?.execution.cleanup_state).toBe("FAILED");
    expect(result.data?.attempts).toEqual([]);
  });

  it("rejects incomplete, reordered or cross-Execution attempt history", async () => {
    const execution = executionFixture();
    const queued = transitionExecution(context, execution, {
      expected_state_version: execution.state_version,
      to_state: "QUEUED",
      changed_at: "2026-11-15T08:00:02Z",
    });
    if (!queued.data) throw new Error("Queue fixture failed");
    const started = startExecutionAttempt(context, queued.data, {
      expected_execution_version: queued.data.state_version,
      attempt_ref: ref("EXECUTION_ATTEMPT", "attempt-read-1"),
      invocation_digest: "sha256-invocation-read-1",
      input_digest: "sha256-input-read-1",
      created_at: "2026-11-15T08:00:03Z",
    });
    if (!started.data) throw new Error("Attempt fixture failed");
    const reader: ExecutionReadPort = {
      readExecution: async () => ({ status: "OK", correlation_id: context.correlation_id, data: started.data!.execution, errors: [], warnings: [] }),
      readAttempts: async () => ({ status: "OK", correlation_id: context.correlation_id, data: [], errors: [], warnings: [] }),
      readInvocationManifest: async () => { throw new Error("Not used"); },
    };
    const incomplete = await readExecutionSnapshot(reader, context, execution.execution_ref);
    expect(incomplete.status).toBe("REJECTED");
    expect(incomplete.errors[0]?.code).toBe("INTEGRITY_OR_UNTRUSTED_INPUT");

    const foreign = await readExecutionSnapshot(reader, context, ref("EXECUTION", "foreign-execution", "1", otherScope));
    expect(foreign.status).toBe("REJECTED");
    expect(foreign.errors[0]?.code).toBe("FORBIDDEN");
  });

  it("reads only the exact immutable invocation manifest accepted for an Execution", async () => {
    const execution = executionFixture();
    const acceptedRequest = request();
    const manifest: ExecutionInvocationManifest = {
      execution_ref: execution.execution_ref,
      request_digest: execution.request_digest,
      capability_ref: execution.capability_ref,
      capability_version: execution.capability_version,
      runtime_profile_ref: execution.runtime_profile_ref,
      runtime_profile_version: execution.runtime_profile_version,
      input_refs: [...acceptedRequest.input_refs],
      input_digests: [...acceptedRequest.input_digests],
      side_effect_class: acceptedRequest.side_effect_class,
      request: acceptedRequest,
      created_at: "2026-11-15T08:00:01Z",
    };
    const reader: ExecutionReadPort = {
      readExecution: async () => ({ status: "OK", correlation_id: context.correlation_id, data: execution, errors: [], warnings: [] }),
      readAttempts: async () => ({ status: "OK", correlation_id: context.correlation_id, data: [], errors: [], warnings: [] }),
      readInvocationManifest: async () => ({ status: "OK", correlation_id: context.correlation_id, data: manifest, errors: [], warnings: [] }),
    };
    const valid = await readExecutionInvocationManifest(reader, context, execution);
    expect(valid.status).toBe("OK");
    expect(valid.data?.input_refs).toEqual(acceptedRequest.input_refs);

    const tamperedReader: ExecutionReadPort = {
      ...reader,
      readInvocationManifest: async () => ({
        status: "OK", correlation_id: context.correlation_id,
        data: { ...manifest, input_digests: ["sha256-tampered-input"] },
        errors: [], warnings: [],
      }),
    };
    const tampered = await readExecutionInvocationManifest(tamperedReader, context, execution);
    expect(tampered.status).toBe("REJECTED");
    expect(tampered.errors[0]?.code).toBe("INTEGRITY_OR_UNTRUSTED_INPUT");
  });

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

  it("requires exact object versions in current authorization and capability evidence", () => {
    const wrongAuthorizationVersion = validateExecutionAdmission(
      context,
      request(),
      admission({ authorization: {
        ...admission().authorization,
        decision_ref: ref("AUTHORITY_DECISION", "authority-1", "2"),
      } }),
      "2026-11-15T08:00:06Z",
    );
    expect(wrongAuthorizationVersion.status).toBe("REJECTED");

    const wrongCapabilityVersion = validateExecutionAdmission(
      context,
      request(),
      admission({ capability: {
        ...admission().capability,
        capability_ref: ref("CAPABILITY", "capability-1", "2"),
      } }),
      "2026-11-15T08:00:06Z",
    );
    expect(wrongCapabilityVersion.status).toBe("REJECTED");
  });

  it("rejects a caller-supplied approved profile when the INV-05 repository says it is suspended", async () => {
    let unitOfWorkCalled = false;
    const unitOfWork = {
      execute: async () => {
        unitOfWorkCalled = true;
        throw new Error("Suspended profile must not be persisted");
      },
    } as unknown as EngineUnitOfWorkPort;
    const reader = admissionReader({}, profile({ profile_status: "SUSPENDED" }));
    const result = await submitExecution(unitOfWork, reader, {
      now: () => "2026-11-15T08:00:06Z",
    }, {
      context,
      request: request({ runtime_profile: profile({ profile_status: "APPROVED" }) }),
      execution_event_ref: ref("DOMAIN_EVENT", "event-forged-profile"),
      created_at: "2026-11-15T08:00:06Z",
    });
    expect(result.status).toBe("REJECTED");
    expect(result.errors[0]?.code).toBe("POLICY_DENIED");
    expect(unitOfWorkCalled).toBe(false);
  });

  it("rejects a dispatch whose pinned Work, graph, node or capability differs from the request", async () => {
    let admissionRead = false;
    const reader = admissionReader({
      readDispatchAttempt: async () => ({
        status: "OK",
        correlation_id: context.correlation_id,
        data: dispatchAttempt({ graph_node_ref: ref("GRAPH_NODE", "different-node") }),
        errors: [],
        warnings: [],
      }),
      readCurrentAdmission: async () => {
        admissionRead = true;
        return {
          status: "OK",
          correlation_id: context.correlation_id,
          data: admission(),
          errors: [],
          warnings: [],
        };
      },
    });
    const unitOfWork = { execute: async () => { throw new Error("Must not persist"); } } as unknown as EngineUnitOfWorkPort;
    const result = await submitExecution(unitOfWork, reader, {
      now: () => "2026-11-15T08:00:06Z",
    }, {
      context,
      request: request(),
      execution_event_ref: ref("DOMAIN_EVENT", "event-dispatch-mismatch"),
      created_at: "2026-11-15T08:00:06Z",
    });
    expect(result.status).toBe("REJECTED");
    expect(result.errors[0]?.code).toBe("INTEGRITY_OR_UNTRUSTED_INPUT");
    expect(admissionRead).toBe(false);
  });

  it("rejects terminal, unknown, or already-consumed INV-04 dispatch attempts", async () => {
    for (const override of [
      { state: "FAILED" as const },
      { state: "UNKNOWN" as const },
      { execution_ref: ref("EXECUTION", "another-execution") },
    ]) {
      const reader = admissionReader({
        readDispatchAttempt: async () => ({
          status: "OK",
          correlation_id: context.correlation_id,
          data: dispatchAttempt(override),
          errors: [],
          warnings: [],
        }),
      });
      const unitOfWork = { execute: async () => { throw new Error("Must not persist"); } } as unknown as EngineUnitOfWorkPort;
      const result = await submitExecution(unitOfWork, reader, {
        now: () => "2026-11-15T08:00:06Z",
      }, {
        context,
        request: request(),
        execution_event_ref: ref("DOMAIN_EVENT", "event-dispatch-terminal"),
        created_at: "2026-11-15T08:00:06Z",
      });
      expect(result.status).toBe("REJECTED");
    }
  });

  it("rejects dispatch when its authorization or resource-admission receipt is not the current one", async () => {
    const reader = admissionReader({
      readCurrentAdmission: async () => ({
        status: "OK",
        correlation_id: context.correlation_id,
        data: admission({
          resource: {
            ...admission().resource,
            admission_ref: ref("RESOURCE_ADMISSION", "resource-other"),
          },
        }),
        errors: [],
        warnings: [],
      }),
    });
    const unitOfWork = { execute: async () => { throw new Error("Must not persist"); } } as unknown as EngineUnitOfWorkPort;
    const result = await submitExecution(unitOfWork, reader, {
      now: () => "2026-11-15T08:00:06Z",
    }, {
      context,
      request: request(),
      execution_event_ref: ref("DOMAIN_EVENT", "event-admission-mismatch"),
      created_at: "2026-11-15T08:00:06Z",
    });
    expect(result.status).toBe("REJECTED");
    expect(result.errors[0]?.code).toBe("INTEGRITY_OR_UNTRUSTED_INPUT");
  });

  it("hard-disables untrusted generated code when no trusted attestation verifier exists", async () => {
    let unitOfWorkCalled = false;
    const unitOfWork = {
      execute: async () => {
        unitOfWorkCalled = true;
        throw new Error("Untrusted runtime must not be persisted");
      },
    } as unknown as EngineUnitOfWorkPort;
    const untrustedProfile = profile({
      trust_class: "UNTRUSTED_GENERATED_CODE",
      profile_digest: "sha256-profile-1",
      approved_by: context.actor_ref,
      approval_ref: ref("APPROVAL", "approval-1"),
      secret_injection_policy_ref: ref("SECRET_INJECTION_POLICY", "secret-policy-1"),
    });
    const reader = admissionReader({}, untrustedProfile);
    const clock: ClockPort = { now: () => "2026-11-15T08:00:06Z" };

    const result = await submitExecution(unitOfWork, reader, clock, {
      context,
      request: request({ runtime_profile: untrustedProfile }),
      execution_event_ref: ref("DOMAIN_EVENT", "event-untrusted-1"),
      created_at: "2026-11-15T08:00:06Z",
    });
    expect(result.status).toBe("REJECTED");
    expect(result.errors[0]?.code).toBe("POLICY_DENIED");
    expect(unitOfWorkCalled).toBe(false);
  });

  it("persists an Execution only after source-owned profile, dispatch and admission reads", async () => {
    const authoritativeProfile = profile({
      memory_limit: { value: 1024, unit: "MiB" },
    });
    let admissionSawAuthoritativeProfile = false;
    const persistedRecords: Array<{ key: string; value: unknown }> = [];
    let outboxEventId: string | undefined;
    let idempotencyRecorded = false;

    const reader = admissionReader({
      readCurrentAdmission: async (_context, trustedRequest) => {
        admissionSawAuthoritativeProfile =
          trustedRequest.runtime_profile.memory_limit?.value === 1024;
        return {
          status: "OK",
          correlation_id: context.correlation_id,
          data: admission(),
          errors: [],
          warnings: [],
        };
      },
    }, authoritativeProfile);

    const transaction = {
      repository: <T,>() => ({
        get: async () => {
          throw new Error("Unexpected repository read");
        },
        create: async (_context: RequestContext, _ref: ObjectRef, value: T): Promise<OperationResult<T>> => {
          persistedRecords.push({ key: _ref.object_kind, value });
          return {
            status: "OK",
            correlation_id: context.correlation_id,
            data: value,
            object_version: "1",
            errors: [],
            warnings: [],
          };
        },
        update: async () => {
          throw new Error("Unexpected repository update");
        },
      }),
      appendOnly: <T,>() => ({
        append: async (_context: RequestContext, value: T): Promise<OperationResult<T>> => ({
          status: "OK",
          correlation_id: context.correlation_id,
          data: value,
          errors: [],
          warnings: [],
        }),
        get: async () => {
          throw new Error("Unexpected append-only read");
        },
      }),
      idempotency: {
        get: async <T,>() => ({
          status: "OK",
          correlation_id: context.correlation_id,
          data: null,
          errors: [],
          warnings: [],
        }),
        record: async <T,>(_context: RequestContext, value: {
          idempotency_key: string;
          request_fingerprint: string;
          result: OperationResult<T>;
          recorded_at: string;
        }): Promise<OperationResult<typeof value>> => {
          idempotencyRecorded = true;
          return {
            status: "OK",
            correlation_id: context.correlation_id,
            data: value,
            errors: [],
            warnings: [],
          };
        },
      },
      outbox: {
        append: async (_context: RequestContext, event: { event_id: string }): Promise<OperationResult<{ event_id: string }>> => {
          outboxEventId = event.event_id;
          return {
            status: "OK",
            correlation_id: context.correlation_id,
            data: { event_id: event.event_id },
            errors: [],
            warnings: [],
          };
        },
      },
    } as unknown as EngineTransaction;

    const unitOfWork: EngineUnitOfWorkPort = {
      execute: async <T,>(
        _context: RequestContext,
        operation: (transaction: EngineTransaction) => Promise<OperationResult<T>>,
      ) => operation(transaction),
    };
    const result = await submitExecution(unitOfWork, reader, {
      now: () => "2026-11-15T08:00:06Z",
    }, {
      context,
      request: request({
        runtime_profile: profile({
          memory_limit: { value: 1, unit: "MiB" },
        }),
      }),
      execution_event_ref: ref("DOMAIN_EVENT", "event-accepted-success"),
      created_at: "2026-11-15T08:00:06Z",
    });

    expect(result.status).toBe("OK");
    expect(result.data?.state).toBe("CREATED");
    expect(result.data?.runtime_profile_version).toBe("1");
    expect(admissionSawAuthoritativeProfile).toBe(true);
    expect(persistedRecords).toHaveLength(2);
    const manifest = persistedRecords[1]?.value as ExecutionInvocationManifest;
    expect(manifest.request_digest).toBe(result.data?.request_digest);
    expect(manifest.input_refs).toEqual(request().input_refs);
    expect(manifest.input_digests).toEqual(request().input_digests);
    expect(outboxEventId).toBe("event-accepted-success");
    expect(idempotencyRecorded).toBe(true);
  });

  it("does not persist or enqueue an Execution when admission is denied", async () => {
    let unitOfWorkCalled = false;
    const unitOfWork = {
      execute: async () => {
        unitOfWorkCalled = true;
        throw new Error("Persistence must not be reached");
      },
    } as unknown as EngineUnitOfWorkPort;
    const reader = admissionReader({
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
    });
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
    const reader = admissionReader({
      readCurrentAdmission: async () => {
        throw new Error("authorization dependency unavailable");
      },
    });
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
