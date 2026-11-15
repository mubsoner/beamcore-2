import { describe, expect, it } from "vitest";
import type { ObjectRef, RequestContext } from "../shared";
import {
  createExecutionRecord,
  startExecutionAttempt,
  transitionExecution,
  type ExecutionRequest,
  type RuntimeProfile,
  type TrustedRuntimeAssurance,
} from "./domain";
import {
  validateRuntimeStartReceipt,
  type RuntimeInvocationDescriptor,
  type RuntimeStartReceipt,
} from "./runtime-ports";

const scope = { scope_id: "runtime-scope-1", scope_kind: "WORK" as const };
const context: RequestContext = {
  request_id: "runtime-request-1",
  correlation_id: "runtime-correlation-1",
  actor_ref: { principal_id: "runtime-user-1", principal_kind: "USER" },
  scope_ref: scope,
  issued_at: "2026-11-15T08:00:00Z",
  idempotency_key: "runtime-execution-idem-1",
};
const ref = (object_kind: string, object_id: string, object_version = "1"): ObjectRef => ({
  object_kind,
  object_id,
  object_version,
  scope_ref: scope,
});
const profile = (overrides: Partial<RuntimeProfile> = {}): RuntimeProfile => ({
  profile_ref: ref("RUNTIME_PROFILE", "runtime-profile-1"),
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
  network_egress_policy_ref: ref("NETWORK_EGRESS_POLICY", "runtime-egress-1"),
  filesystem_policy_ref: ref("FILESYSTEM_POLICY", "runtime-filesystem-1"),
  allowed_capability_refs: [ref("CAPABILITY", "runtime-capability-1")],
  permitted_output_kinds: ["TEXT"],
  created_at: "2026-11-15T07:59:00Z",
  ...overrides,
});
const makeStartingExecution = (runtimeProfile: RuntimeProfile = profile()) => {
  const request: ExecutionRequest = {
    execution_ref: ref("EXECUTION", "runtime-execution-1"),
    work_ref: ref("WORK", "runtime-work-1"),
    orchestration_run_ref: ref("ORCHESTRATION_RUN", "runtime-run-1"),
    graph_revision_ref: ref("WORK_GRAPH_REVISION", "runtime-graph-1"),
    graph_node_ref: ref("GRAPH_NODE", "runtime-node-1"),
    dispatch_ref: ref("DISPATCH_ATTEMPT", "runtime-dispatch-1"),
    capability_ref: ref("CAPABILITY", "runtime-capability-1"),
    capability_version: "1",
    actor_ref: context.actor_ref,
    authorization_decision_ref: ref("AUTHORITY_DECISION", "runtime-authority-1"),
    runtime_profile: runtimeProfile,
    input_refs: [ref("ARTIFACT", "runtime-input-1")],
    input_digests: ["sha256-runtime-input-1"],
    request_digest: "sha256-runtime-request-1",
    idempotency_key: "runtime-execution-idem-1",
    side_effect_class: "IDEMPOTENT",
  };
  const created = createExecutionRecord(context, request, "2026-11-15T08:00:01Z");
  expect(created.status).toBe("OK");
  if (!created.data) throw new Error("Failed to create runtime test Execution");
  const queued = transitionExecution(context, created.data, {
    expected_state_version: created.data.state_version,
    to_state: "QUEUED",
    changed_at: "2026-11-15T08:00:02Z",
  });
  expect(queued.status).toBe("OK");
  if (!queued.data) throw new Error("Failed to queue runtime test Execution");
  const started = startExecutionAttempt(context, queued.data, {
    expected_execution_version: queued.data.state_version,
    attempt_ref: ref("EXECUTION_ATTEMPT", "runtime-attempt-1"),
    invocation_digest: "sha256-runtime-invocation-1",
    input_digest: "sha256-runtime-input-set-1",
    created_at: "2026-11-15T08:00:03Z",
  });
  expect(started.status).toBe("OK");
  if (!started.data) throw new Error("Failed to create STARTING runtime test Attempt");
  return {
    execution: started.data.execution,
    attempt: started.data.attempt,
    runtimeProfile,
  };
};
const assuranceFor = (runtimeProfile: RuntimeProfile): TrustedRuntimeAssurance => ({
  attestation_ref: ref("RUNTIME_ASSURANCE_ATTESTATION", "attestation-1"),
  runtime_identity_ref: ref("RUNTIME_IDENTITY", "runtime-identity-1"),
  runtime_profile_ref: runtimeProfile.profile_ref,
  runtime_profile_version: runtimeProfile.profile_version,
  runtime_profile_digest: runtimeProfile.profile_digest!,
  enforcement_evidence_ref: ref("RUNTIME_ENFORCEMENT_EVIDENCE", "enforcement-1"),
  enforcement_test_evidence_ref: ref("RUNTIME_ENFORCEMENT_TEST_EVIDENCE", "enforcement-tests-1"),
  verifier_ref: ref("TRUSTED_RUNTIME_ATTESTATION_VERIFIER", "runtime-verifier-1"),
  verification_status: "VERIFIED",
  enforced_controls: [
    "CPU_LIMIT", "MEMORY_LIMIT", "WALL_TIME_LIMIT", "STORAGE_LIMIT",
    "PROCESS_LIMIT", "OUTPUT_SIZE_LIMIT", "CONCURRENCY_LIMIT",
    "NETWORK_EGRESS", "FILESYSTEM_ISOLATION", "SECRET_ISOLATION",
    "PROCESS_TERMINATION", "CLEANUP",
  ],
  verified_at: "2026-11-15T08:00:03Z",
  valid_until: "2026-11-15T08:05:00Z",
});
const buildInvocation = (
  execution: ReturnType<typeof makeStartingExecution>["execution"],
  attempt: ReturnType<typeof makeStartingExecution>["attempt"],
  runtimeProfile: RuntimeProfile,
  runtimeAssurance?: TrustedRuntimeAssurance,
): RuntimeInvocationDescriptor => ({
  execution_ref: execution.execution_ref,
  attempt_ref: attempt.attempt_ref,
  work_ref: execution.work_ref,
  orchestration_run_ref: execution.orchestration_run_ref,
  graph_revision_ref: execution.graph_revision_ref,
  graph_node_ref: execution.graph_node_ref,
  dispatch_ref: execution.dispatch_ref,
  capability_ref: execution.capability_ref,
  capability_version: execution.capability_version,
  authorization_decision_ref: execution.authorization_decision_ref,
  runtime_profile_ref: runtimeProfile.profile_ref,
  runtime_profile_version: runtimeProfile.profile_version,
  ...(runtimeProfile.profile_digest ? { runtime_profile_digest: runtimeProfile.profile_digest } : {}),
  ...(runtimeAssurance ? { runtime_assurance: runtimeAssurance } : {}),
  inputs: [{ input_ref: ref("ARTIFACT", "runtime-input-1"), input_digest: "sha256-runtime-input-1" }],
  idempotency_key: execution.idempotency_key,
});
const receiptFor = (runtimeProfile: RuntimeProfile): RuntimeStartReceipt => ({
  runtime_instance_ref: ref("RUNTIME_INSTANCE", "runtime-instance-1"),
  runtime_identity_ref: ref("RUNTIME_IDENTITY", "runtime-identity-1"),
  start_evidence_ref: ref("RUNTIME_START_EVIDENCE", "runtime-start-evidence-1"),
  runtime_profile_ref: runtimeProfile.profile_ref,
  runtime_profile_version: runtimeProfile.profile_version,
  ...(runtimeProfile.profile_digest ? { runtime_profile_digest: runtimeProfile.profile_digest } : {}),
  started_at: "2026-11-15T08:00:04Z",
});

describe("INV-05 provider-neutral runtime start receipt", () => {
  it("accepts a receipt only when it binds the exact STARTING attempt, execution and profile", () => {
    const state = makeStartingExecution();
    const invocation = buildInvocation(state.execution, state.attempt, state.runtimeProfile);
    const result = validateRuntimeStartReceipt(
      context,
      state.execution,
      state.attempt,
      state.runtimeProfile,
      invocation,
      receiptFor(state.runtimeProfile),
      "2026-11-15T08:00:05Z",
    );
    expect(result.status).toBe("OK");
  });

  it("rejects a substituted runtime instance or profile version", () => {
    const state = makeStartingExecution();
    const invocation = buildInvocation(state.execution, state.attempt, state.runtimeProfile);
    const substitutedInstance = validateRuntimeStartReceipt(
      context,
      state.execution,
      state.attempt,
      state.runtimeProfile,
      invocation,
      { ...receiptFor(state.runtimeProfile), runtime_instance_ref: ref("RUNTIME_INSTANCE", "foreign-instance") },
      "2026-11-15T08:00:05Z",
    );
    expect(substitutedInstance.status).toBe("OK");

    const wrongProfileVersion = validateRuntimeStartReceipt(
      context,
      state.execution,
      state.attempt,
      state.runtimeProfile,
      invocation,
      { ...receiptFor(state.runtimeProfile), runtime_profile_version: "2" },
      "2026-11-15T08:00:05Z",
    );
    expect(wrongProfileVersion.status).toBe("REJECTED");
  });

  it("rejects a runtime receipt outside the authenticated scope or with an invalid time", () => {
    const state = makeStartingExecution();
    const foreignInstance: ObjectRef = {
      object_kind: "RUNTIME_INSTANCE",
      object_id: "foreign-runtime",
      object_version: "1",
      scope_ref: { scope_id: "another-work", scope_kind: "WORK" },
    };
    const invocation = buildInvocation(state.execution, state.attempt, state.runtimeProfile);
    const foreign = validateRuntimeStartReceipt(
      context,
      state.execution,
      state.attempt,
      state.runtimeProfile,
      invocation,
      { ...receiptFor(state.runtimeProfile), runtime_instance_ref: foreignInstance },
      "2026-11-15T08:00:05Z",
    );
    expect(foreign.status).toBe("REJECTED");

    const future = validateRuntimeStartReceipt(
      context,
      state.execution,
      state.attempt,
      state.runtimeProfile,
      invocation,
      { ...receiptFor(state.runtimeProfile), started_at: "2026-11-15T08:00:06Z" },
      "2026-11-15T08:00:05Z",
    );
    expect(future.status).toBe("REJECTED");
  });

  it("requires trusted runtime identity and enforcement attestation for generated code", () => {
    const generatedProfile = profile({
      trust_class: "UNTRUSTED_GENERATED_CODE",
      profile_digest: "sha256-approved-profile-1",
      approved_by: context.actor_ref,
      approval_ref: ref("APPROVAL", "runtime-profile-approval-1"),
      secret_injection_policy_ref: ref("SECRET_INJECTION_POLICY", "runtime-secret-policy-1"),
    });
    const state = makeStartingExecution(generatedProfile);
    const assurance = assuranceFor(generatedProfile);
    const invocation = buildInvocation(state.execution, state.attempt, generatedProfile, assurance);
    const accepted = validateRuntimeStartReceipt(
      context,
      state.execution,
      state.attempt,
      generatedProfile,
      invocation,
      receiptFor(generatedProfile),
      "2026-11-15T08:00:05Z",
    );
    expect(accepted.status).toBe("OK");

    const noAssurance = validateRuntimeStartReceipt(
      context,
      state.execution,
      state.attempt,
      generatedProfile,
      buildInvocation(state.execution, state.attempt, generatedProfile),
      receiptFor(generatedProfile),
      "2026-11-15T08:00:05Z",
    );
    expect(noAssurance.status).toBe("REJECTED");

    const wrongIdentity = validateRuntimeStartReceipt(
      context,
      state.execution,
      state.attempt,
      generatedProfile,
      invocation,
      { ...receiptFor(generatedProfile), runtime_identity_ref: ref("RUNTIME_IDENTITY", "substituted-runtime") },
      "2026-11-15T08:00:05Z",
    );
    expect(wrongIdentity.status).toBe("REJECTED");
  });
});
