import { describe, expect, it } from "vitest";
import type { ObjectRef, RequestContext } from "../shared";
import {
  checkExecutionIdempotency,
  confirmExecutionAttemptStarted,
  createExecutionEvent,
  createExecutionRecord,
  createReconciliationRecord,
  createResourceMeasurement,
  createRuntimeCheckpoint,
  captureExecutionOutput,
  transitionExecutionAttempt,
  transitionExecutionCleanup,
  requestExecutionCancellation,
  startExecutionAttempt,
  transitionExecution,
  validateExecutionRequest,
  validateTrustedRuntimeAssurance,
  validateRuntimeProfile,
  type ExecutionRecord,
  type ExecutionRequest,
  type RuntimeProfile,
  type TrustedRuntimeAssurance,
} from "./domain";

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
  object_kind,
  object_id,
  object_version,
  scope_ref: refScope,
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

function createRecord(): ExecutionRecord {
  const result = createExecutionRecord(context, request(), "2026-11-15T08:00:01Z");
  expect(result.status).toBe("OK");
  if (!result.data) throw new Error("Execution fixture could not be created");
  return result.data;
}

function queueRecord(execution = createRecord()): ExecutionRecord {
  const result = transitionExecution(context, execution, {
    expected_state_version: execution.state_version,
    to_state: "QUEUED",
    changed_at: "2026-11-15T08:00:02Z",
  });
  expect(result.status).toBe("OK");
  if (!result.data) throw new Error("Execution fixture could not be queued");
  return result.data;
}

function startRecord() {
  const execution = queueRecord();
  const started = startExecutionAttempt(context, execution, {
    expected_execution_version: execution.state_version,
    attempt_ref: ref("EXECUTION_ATTEMPT", "attempt-1"),
    invocation_digest: "sha256-invocation-1",
    input_digest: "sha256-input-set-1",
    created_at: "2026-11-15T08:00:03Z",
  });
  expect(started.status).toBe("OK");
  if (!started.data) throw new Error("Attempt fixture could not be started");
  const runtimeStarted = confirmExecutionAttemptStarted(context, started.data.execution, started.data.attempt, {
    expected_execution_version: started.data.execution.state_version,
    expected_attempt_version: started.data.attempt.state_version,
    runtime_instance_ref: ref("RUNTIME_INSTANCE", "runtime-1"),
    started_at: "2026-11-15T08:00:04Z",
  });
  expect(runtimeStarted.status).toBe("OK");
  if (!runtimeStarted.data) throw new Error("Runtime start could not be confirmed");
  return runtimeStarted.data;
}

describe("INV-05 execution runtime domain", () => {
  it("accepts a scoped, approved runtime profile with explicit resource limits", () => {
    const result = validateRuntimeProfile(context, profile());
    expect(result.status).toBe("OK");
    expect(result.data?.profile_ref).toEqual(ref("RUNTIME_PROFILE", "profile-1"));
  });

  it("fails closed for unapproved profiles and missing untrusted-code limits", () => {
    const unapproved = validateRuntimeProfile(context, profile({ profile_status: "VALIDATED" }));
    expect(unapproved.status).toBe("REJECTED");
    expect(unapproved.errors[0]?.code).toBe("POLICY_DENIED");

    const untrusted = profile({
      trust_class: "UNTRUSTED_GENERATED_CODE",
      cpu_limit: undefined,
      approved_by: context.actor_ref,
      approval_ref: ref("APPROVAL", "approval-1"),
      secret_injection_policy_ref: ref("SECRET_INJECTION_POLICY", "secret-policy-1"),
    });
    const missingLimit = validateRuntimeProfile(context, untrusted);
    expect(missingLimit.status).toBe("REJECTED");
    expect(missingLimit.errors[0]?.code).toBe("RESOURCE_LIMIT");
  });

  it("rejects cross-scope runtime policies and capability substitutions", () => {
    const outsideScope = validateRuntimeProfile(context, profile({
      filesystem_policy_ref: ref("FILESYSTEM_POLICY", "fs-foreign", "1", otherScope),
    }));
    expect(outsideScope.status).toBe("REJECTED");
    expect(outsideScope.errors[0]?.code).toBe("VALIDATION_ERROR");

    const wrongCapability = validateExecutionRequest(context, request({
      capability_ref: ref("CAPABILITY", "different-capability", "1"),
    }));
    expect(wrongCapability.status).toBe("REJECTED");
    expect(wrongCapability.errors[0]?.code).toBe("CAPABILITY_UNAVAILABLE");
  });

  it("requires trusted runtime attestation bound to the exact profile digest and hard controls", () => {
    const untrustedProfile = profile({
      trust_class: "UNTRUSTED_GENERATED_CODE",
      profile_digest: "sha256-profile-1",
      approved_by: context.actor_ref,
      approval_ref: ref("APPROVAL", "approval-1"),
      secret_injection_policy_ref: ref("SECRET_INJECTION_POLICY", "secret-policy-1"),
    });
    expect(validateRuntimeProfile(context, untrustedProfile).status).toBe("OK");

    const assurance: TrustedRuntimeAssurance = {
      attestation_ref: ref("RUNTIME_ASSURANCE_ATTESTATION", "attestation-1"),
      runtime_identity_ref: ref("RUNTIME_IDENTITY", "runtime-identity-1"),
      runtime_profile_ref: untrustedProfile.profile_ref,
      runtime_profile_version: untrustedProfile.profile_version,
      runtime_profile_digest: "sha256-profile-1",
      enforcement_evidence_ref: ref("RUNTIME_ENFORCEMENT_EVIDENCE", "enforcement-1"),
      enforcement_test_evidence_ref: ref("RUNTIME_ENFORCEMENT_TEST_EVIDENCE", "enforcement-tests-1"),
      verifier_ref: ref("TRUSTED_RUNTIME_ATTESTATION_VERIFIER", "verifier-1"),
      verification_status: "VERIFIED" as const,
      enforced_controls: [
        "CPU_LIMIT", "MEMORY_LIMIT", "WALL_TIME_LIMIT", "STORAGE_LIMIT",
        "PROCESS_LIMIT", "OUTPUT_SIZE_LIMIT", "CONCURRENCY_LIMIT",
        "NETWORK_EGRESS", "FILESYSTEM_ISOLATION", "SECRET_ISOLATION",
        "PROCESS_TERMINATION", "CLEANUP",
      ],
      verified_at: "2026-11-15T08:00:04Z",
      valid_until: "2026-11-15T08:05:00Z",
    };
    expect(validateTrustedRuntimeAssurance(
      context, untrustedProfile, assurance, "2026-11-15T08:00:05Z",
    ).status).toBe("OK");

    const wrongProfileDigest = validateTrustedRuntimeAssurance(
      context,
      untrustedProfile,
      { ...assurance, runtime_profile_digest: "sha256-different-profile" },
      "2026-11-15T08:00:05Z",
    );
    expect(wrongProfileDigest.status).toBe("REJECTED");

    const expired = validateTrustedRuntimeAssurance(
      context,
      untrustedProfile,
      { ...assurance, valid_until: "2026-11-15T08:00:04Z" },
      "2026-11-15T08:00:05Z",
    );
    expect(expired.status).toBe("REJECTED");

    const missingControl = validateTrustedRuntimeAssurance(
      context,
      untrustedProfile,
      { ...assurance, enforced_controls: ["CPU_LIMIT"] },
      "2026-11-15T08:00:05Z",
    );
    expect(missingControl.status).toBe("REJECTED");
  });

  it("creates a durable logical Execution without claiming that a process started", () => {
    const result = createExecutionRecord(context, request(), "2026-11-15T08:00:01Z");
    expect(result.status).toBe("OK");
    expect(result.data?.state).toBe("CREATED");
    expect(result.data?.attempt_refs).toEqual([]);
    expect(result.data?.effect_knowledge).toBe("NOT_STARTED");
    expect(result.data?.termination_knowledge).toBe("NOT_REQUESTED");
  });

  it("deduplicates identical submissions and rejects key reuse with a different digest", () => {
    const execution = createRecord();
    const duplicate = checkExecutionIdempotency(context, execution, "execution-idem-1", "sha256-request-1");
    expect(duplicate.status).toBe("OK");
    expect(duplicate.data?.disposition).toBe("DEDUPLICATED");

    const conflict = checkExecutionIdempotency(context, execution, "execution-idem-1", "sha256-request-2");
    expect(conflict.status).toBe("REJECTED");
    expect(conflict.errors[0]?.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("creates a new immutable attempt identity only after queue acceptance", () => {
    const created = createRecord();
    const beforeQueue = startExecutionAttempt(context, created, {
      expected_execution_version: created.state_version,
      attempt_ref: ref("EXECUTION_ATTEMPT", "attempt-1"),
      invocation_digest: "sha256-invocation-1",
      input_digest: "sha256-input-set-1",
      created_at: "2026-11-15T08:00:03Z",
    });
    expect(beforeQueue.status).toBe("REJECTED");

    const queued = queueRecord(created);
    const started = startExecutionAttempt(context, queued, {
      expected_execution_version: queued.state_version,
      attempt_ref: ref("EXECUTION_ATTEMPT", "attempt-1"),
      invocation_digest: "sha256-invocation-1",
      input_digest: "sha256-input-set-1",
      created_at: "2026-11-15T08:00:03Z",
    });
    expect(started.status).toBe("OK");
    expect(started.data?.execution.state).toBe("STARTING");
    expect(started.data?.attempt.state).toBe("STARTING");
    expect(started.data?.attempt.attempt_number).toBe(1);

    if (!started.data) return;
    const duplicateAttempt = startExecutionAttempt(context, started.data.execution, {
      expected_execution_version: started.data.execution.state_version,
      attempt_ref: ref("EXECUTION_ATTEMPT", "attempt-1"),
      invocation_digest: "sha256-invocation-2",
      input_digest: "sha256-input-set-2",
      created_at: "2026-11-15T08:00:04Z",
    });
    expect(duplicateAttempt.status).toBe("REJECTED");
    expect(duplicateAttempt.errors[0]?.code).toBe("VALIDATION_ERROR");
  });

  it("does not mark an attempt RUNNING until the runtime start is observed", () => {
    const execution = queueRecord();
    const started = startExecutionAttempt(context, execution, {
      expected_execution_version: execution.state_version,
      attempt_ref: ref("EXECUTION_ATTEMPT", "attempt-1"),
      invocation_digest: "sha256-invocation-1",
      input_digest: "sha256-input-set-1",
      created_at: "2026-11-15T08:00:03Z",
    });
    expect(started.status).toBe("OK");
    if (!started.data) return;

    const unconfirmed = transitionExecution(context, started.data.execution, {
      expected_state_version: started.data.execution.state_version,
      to_state: "RUNNING",
      changed_at: "2026-11-15T08:00:04Z",
    });
    expect(unconfirmed.status).toBe("REJECTED");
  });

  it("uses optimistic versions and requires termination proof for terminal runtime states", () => {
    const { execution } = startRecord();
    const stale = transitionExecution(context, execution, {
      expected_state_version: execution.state_version - 1,
      to_state: "SUCCEEDED",
      changed_at: "2026-11-15T08:00:05Z",
      termination_knowledge: "CONFIRMED_TERMINATED",
    });
    expect(stale.status).toBe("REJECTED");
    expect(stale.errors[0]?.code).toBe("VERSION_CONFLICT");

    const noTerminationProof = transitionExecution(context, execution, {
      expected_state_version: execution.state_version,
      to_state: "SUCCEEDED",
      changed_at: "2026-11-15T08:00:05Z",
      effect_knowledge: "CONFIRMED_APPLIED",
    });
    expect(noTerminationProof.status).toBe("REJECTED");
    expect(noTerminationProof.errors[0]?.code).toBe("OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED");

    const completed = transitionExecution(context, execution, {
      expected_state_version: execution.state_version,
      to_state: "SUCCEEDED",
      changed_at: "2026-11-15T08:00:05Z",
      termination_knowledge: "CONFIRMED_TERMINATED",
      effect_knowledge: "CONFIRMED_APPLIED",
      output_completeness: "COMPLETE",
    });
    expect(completed.status).toBe("OK");
    expect(completed.data?.state).toBe("SUCCEEDED");
    expect(completed.data?.effect_knowledge).toBe("CONFIRMED_APPLIED");
  });

  it("records cancellation as requested, not as confirmed termination", () => {
    const { execution } = startRecord();
    const result = requestExecutionCancellation(context, execution, {
      cancellation_ref: ref("EXECUTION_CANCELLATION", "cancel-1"),
      expected_state_version: execution.state_version,
      requested_at: "2026-11-15T08:00:05Z",
    });
    expect(result.status).toBe("OK");
    expect(result.data?.execution.state).toBe("CANCELLATION_REQUESTED");
    expect(result.data?.execution.termination_knowledge).toBe("REQUESTED");
    expect(result.data?.cancellation.termination_knowledge).toBe("REQUESTED");
  });

  it("keeps pre-start cancellation distinct from process termination", () => {
    const execution = queueRecord();
    const result = requestExecutionCancellation(context, execution, {
      cancellation_ref: ref("EXECUTION_CANCELLATION", "cancel-before-start"),
      expected_state_version: execution.state_version,
      requested_at: "2026-11-15T08:00:03Z",
    });
    expect(result.status).toBe("OK");
    expect(result.data?.execution.state).toBe("CANCELLED");
    expect(result.data?.execution.termination_knowledge).toBe("NOT_REQUESTED");
  });

  it("keeps runtime UNKNOWN until scoped evidence is supplied", () => {
    const { execution } = startRecord();
    const unknown = transitionExecution(context, execution, {
      expected_state_version: execution.state_version,
      to_state: "UNKNOWN",
      changed_at: "2026-11-15T08:00:05Z",
      termination_knowledge: "UNKNOWN",
      effect_knowledge: "UNKNOWN",
    });
    expect(unknown.status).toBe("OK");
    if (!unknown.data) return;

    const unsupportedResolution = transitionExecution(context, unknown.data, {
      expected_state_version: unknown.data.state_version,
      to_state: "CANCELLED",
      changed_at: "2026-11-15T08:00:06Z",
      termination_knowledge: "CONFIRMED_TERMINATED",
    });
    expect(unsupportedResolution.status).toBe("REJECTED");

    const reconciliation = createReconciliationRecord(context, unknown.data, {
      reconciliation_ref: ref("EXECUTION_RECONCILIATION", "reconciliation-1"),
      execution_ref: unknown.data.execution_ref,
      attempt_ref: unknown.data.attempt_refs[0],
      prior_state: "UNKNOWN",
      prior_effect_knowledge: "UNKNOWN",
      evidence_refs: [ref("RUNTIME_EVIDENCE", "termination-evidence-1")],
      method_ref: ref("RECONCILIATION_METHOD", "runtime-query-v1"),
      resulting_state: "CANCELLED",
      resulting_effect_knowledge: "CONFIRMED_NOT_APPLIED",
      assessed_by: context.actor_ref,
      assessed_at: "2026-11-15T08:00:06Z",
      limitations: ["Runtime status was recovered from an authoritative runtime query"],
    });
    expect(reconciliation.status).toBe("OK");
  });

  it("preserves measurement source and quality without turning it into billing truth", () => {
    const { execution, attempt } = startRecord();
    const measurement = createResourceMeasurement(context, execution, attempt, {
      measurement_ref: ref("RESOURCE_MEASUREMENT", "measurement-1"),
      kind: "CPU_TIME",
      value: 120,
      unit: "milliseconds",
      measured_at: "2026-11-15T08:00:05Z",
      measurement_source: "approved-runtime-meter",
      confidence: "ESTIMATED",
      source_digest: "sha256-measurement-1",
    });
    expect(measurement.status).toBe("OK");
    expect(measurement.data?.confidence).toBe("ESTIMATED");
    expect(measurement.data?.value).toBe(120);
  });

  it("rejects checkpoints with incompatible profiles or missing integrity digest", () => {
    const { execution, attempt } = startRecord();
    const invalid = createRuntimeCheckpoint(context, execution, attempt, {
      checkpoint_ref: ref("RUNTIME_CHECKPOINT", "checkpoint-1"),
      execution_ref: execution.execution_ref,
      attempt_ref: attempt.attempt_ref,
      runtime_profile_ref: execution.runtime_profile_ref,
      runtime_profile_version: "2",
      checkpoint_version: 1,
      state: "AVAILABLE",
      resumability_contract_ref: ref("RESUMABILITY_CONTRACT", "resume-1"),
      created_at: "2026-11-15T08:00:05Z",
    });
    expect(invalid.status).toBe("REJECTED");
  });

  it("updates the immutable attempt state only with observed termination evidence", () => {
    const { execution, attempt } = startRecord();
    const missingProof = transitionExecutionAttempt(context, execution, attempt, {
      expected_state_version: attempt.state_version,
      to_state: "SUCCEEDED",
      changed_at: "2026-11-15T08:00:05Z",
      process_exit_code: 0,
    });
    expect(missingProof.status).toBe("REJECTED");
    expect(missingProof.errors[0]?.code).toBe("OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED");

    const completed = transitionExecutionAttempt(context, execution, attempt, {
      expected_state_version: attempt.state_version,
      to_state: "SUCCEEDED",
      changed_at: "2026-11-15T08:00:05Z",
      termination_knowledge: "CONFIRMED_TERMINATED",
      process_exit_code: 0,
      output_completeness: "COMPLETE",
      output_digest: "sha256-final-output",
    });
    expect(completed.status).toBe("OK");
    expect(completed.data?.state).toBe("SUCCEEDED");
    expect(completed.data?.termination_knowledge).toBe("CONFIRMED_TERMINATED");
  });

  it("captures output with attempt lineage and does not call partial output complete", () => {
    const { execution, attempt } = startRecord();
    const completeWhileRunning = captureExecutionOutput(context, execution, attempt, {
      expected_execution_version: execution.state_version,
      expected_attempt_version: attempt.state_version,
      output_ref: ref("ARTIFACT", "output-1"),
      output_digest: "sha256-output-1",
      output_completeness: "COMPLETE",
      captured_at: "2026-11-15T08:00:05Z",
    });
    expect(completeWhileRunning.status).toBe("REJECTED");

    const partial = captureExecutionOutput(context, execution, attempt, {
      expected_execution_version: execution.state_version,
      expected_attempt_version: attempt.state_version,
      output_ref: ref("ARTIFACT", "output-partial-1"),
      output_digest: "sha256-output-partial",
      output_completeness: "PARTIAL",
      captured_at: "2026-11-15T08:00:05Z",
    });
    expect(partial.status).toBe("OK");
    expect(partial.data?.execution.output_refs).toEqual([ref("ARTIFACT", "output-partial-1")]);
    expect(partial.data?.attempt.output_completeness).toBe("PARTIAL");
  });

  it("tracks cleanup independently from the runtime execution result", () => {
    const { execution } = startRecord();
    const failed = transitionExecution(context, execution, {
      expected_state_version: execution.state_version,
      to_state: "FAILED",
      changed_at: "2026-11-15T08:00:05Z",
      termination_knowledge: "CONFIRMED_TERMINATED",
      effect_knowledge: "UNKNOWN",
      output_completeness: "PARTIAL",
    });
    expect(failed.status).toBe("OK");
    if (!failed.data) return;

    const pending = transitionExecutionCleanup(context, failed.data, {
      expected_state_version: failed.data.state_version,
      to_state: "PENDING",
      changed_at: "2026-11-15T08:00:06Z",
    });
    expect(pending.status).toBe("OK");
    if (!pending.data) return;

    const cleaning = transitionExecutionCleanup(context, pending.data, {
      expected_state_version: pending.data.state_version,
      to_state: "CLEANING",
      changed_at: "2026-11-15T08:00:07Z",
    });
    expect(cleaning.status).toBe("OK");
    if (!cleaning.data) return;

    const cleanupFailed = transitionExecutionCleanup(context, cleaning.data, {
      expected_state_version: cleaning.data.state_version,
      to_state: "FAILED",
      changed_at: "2026-11-15T08:00:08Z",
      error_refs: [ref("RUNTIME_CLEANUP_ERROR", "cleanup-error-1")],
    });
    expect(cleanupFailed.status).toBe("OK");
    expect(cleanupFailed.data?.state).toBe("FAILED");
    expect(cleanupFailed.data?.cleanup_state).toBe("FAILED");
    expect(cleanupFailed.data?.error_refs).toEqual([ref("RUNTIME_CLEANUP_ERROR", "cleanup-error-1")]);
  });

  it("emits a canonical INV-05 event with the exact execution and scope references", () => {
    const execution = createRecord();
    const event = createExecutionEvent(context, execution, {
      event_id: "event-1",
      event_type: "execution.accepted",
      schema_version: 1,
      occurred_at: "2026-11-15T08:00:02Z",
      payload: { state: "CREATED" },
    });
    expect(event.status).toBe("OK");
    expect(event.data?.producer_engine).toBe("INV-05");
    expect(event.data?.object_ref).toEqual(execution.execution_ref);
    expect(event.data?.scope_ref).toEqual(scope);
  });
});
