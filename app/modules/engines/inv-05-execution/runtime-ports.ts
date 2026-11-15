import {
  createOperationError,
  createOperationResult,
  isObjectRef,
  isRequestContext,
  isTimestamp,
  isVersion,
  sameObjectRef,
  sameScopeRef,
  type ObjectRef,
  type OperationErrorCode,
  type OperationResult,
  type RequestContext,
  type Timestamp,
} from "../shared";
import {
  validateRuntimeProfile,
  validateTrustedRuntimeAssurance,
  type ExecutionAttempt,
  type ExecutionRecord,
  type ResourceMeasurement,
  type RuntimeCheckpoint,
  type RuntimeProfile,
  type RuntimeAdmission,
  type TerminationKnowledge,
  type EffectKnowledge,
  type CleanupState,
  type OutputCompleteness,
  type TrustedRuntimeAssurance,
} from "./domain";

/** Inputs are references/digests only; adapters materialize them inside the governed boundary. */
export interface RuntimeInputDescriptor {
  input_ref: ObjectRef;
  input_digest: string;
}

export interface RuntimeInvocationDescriptor {
  execution_ref: ObjectRef;
  attempt_ref: ObjectRef;
  work_ref: ObjectRef;
  orchestration_run_ref: ObjectRef;
  graph_revision_ref: ObjectRef;
  graph_node_ref: ObjectRef;
  dispatch_ref: ObjectRef;
  capability_ref: ObjectRef;
  capability_version: string;
  authorization_decision_ref: ObjectRef;
  runtime_profile_ref: ObjectRef;
  runtime_profile_version: string;
  runtime_profile_digest?: string;
  runtime_assurance?: TrustedRuntimeAssurance;
  inputs: RuntimeInputDescriptor[];
  idempotency_key: string;
  deadline?: Timestamp;
}

export interface RuntimeStartReceipt {
  runtime_instance_ref: ObjectRef;
  runtime_identity_ref: ObjectRef;
  start_evidence_ref: ObjectRef;
  runtime_profile_ref: ObjectRef;
  runtime_profile_version: string;
  runtime_profile_digest?: string;
  started_at: Timestamp;
}

export type RuntimeObservedState =
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMED_OUT"
  | "CANCELLED"
  | "UNKNOWN";

export interface RuntimeObservation {
  runtime_instance_ref: ObjectRef;
  execution_ref: ObjectRef;
  attempt_ref: ObjectRef;
  observed_state: RuntimeObservedState;
  observed_at: Timestamp;
  termination_knowledge: TerminationKnowledge;
  effect_knowledge: EffectKnowledge;
  output_completeness: OutputCompleteness;
  process_exit_code?: number;
  termination_reason?: string;
  stdout_ref?: ObjectRef;
  stderr_ref?: ObjectRef;
  output_refs: ObjectRef[];
  measurement_refs: ObjectRef[];
  evidence_refs: ObjectRef[];
  error_refs: ObjectRef[];
}

export interface RuntimeCancellationReceipt {
  runtime_instance_ref: ObjectRef;
  cancellation_ref: ObjectRef;
  requested_at: Timestamp;
  termination_knowledge: TerminationKnowledge;
  observed_at: Timestamp;
  evidence_refs: ObjectRef[];
  error_refs: ObjectRef[];
}

export interface RuntimeCleanupReceipt {
  runtime_instance_ref: ObjectRef;
  cleanup_state: CleanupState;
  observed_at: Timestamp;
  cleaned_at?: Timestamp;
  evidence_refs: ObjectRef[];
  error_refs: ObjectRef[];
}

export interface RuntimeCheckpointRequest {
  execution_ref: ObjectRef;
  attempt_ref: ObjectRef;
  checkpoint_ref: ObjectRef;
  resumability_contract_ref: ObjectRef;
  expected_execution_version: number;
  requested_at: Timestamp;
}

export interface RuntimeResumeRequest {
  execution_ref: ObjectRef;
  source_checkpoint: RuntimeCheckpoint;
  continuation_attempt_ref: ObjectRef;
  invocation: RuntimeInvocationDescriptor;
  current_authorization_decision_ref: ObjectRef;
  requested_at: Timestamp;
}

export interface RuntimeResumeReceipt {
  execution_ref: ObjectRef;
  source_checkpoint_ref: ObjectRef;
  continuation_attempt_ref: ObjectRef;
  runtime_instance_ref: ObjectRef;
  started_at: Timestamp;
  evidence_refs: ObjectRef[];
}

/**
 * Provider-neutral runtime boundary. An adapter may only return RUNNING/started
 * after it has observed a real process start. Ambiguous transport/runtime errors
 * must be surfaced as UNKNOWN and reconciled, not translated to FAILED.
 */
export interface RuntimeProviderPort {
  start(
    context: RequestContext,
    execution: ExecutionRecord,
    attempt: ExecutionAttempt,
    profile: RuntimeProfile,
    invocation: RuntimeInvocationDescriptor,
  ): Promise<OperationResult<RuntimeStartReceipt>>;

  inspect(
    context: RequestContext,
    runtime_instance_ref: ObjectRef,
  ): Promise<OperationResult<RuntimeObservation>>;

  requestCancellation(
    context: RequestContext,
    runtime_instance_ref: ObjectRef,
    cancellation_ref: ObjectRef,
    requested_at: Timestamp,
  ): Promise<OperationResult<RuntimeCancellationReceipt>>;

  captureCheckpoint(
    context: RequestContext,
    request: RuntimeCheckpointRequest,
  ): Promise<OperationResult<RuntimeCheckpoint>>;

  resume(
    context: RequestContext,
    request: RuntimeResumeRequest,
  ): Promise<OperationResult<RuntimeResumeReceipt>>;

  cleanup(
    context: RequestContext,
    runtime_instance_ref: ObjectRef,
  ): Promise<OperationResult<RuntimeCleanupReceipt>>;

  readMeasurements(
    context: RequestContext,
    execution_ref: ObjectRef,
    attempt_ref: ObjectRef,
  ): Promise<OperationResult<ResourceMeasurement[]>>;
}

export interface RuntimeOutputCandidate {
  candidate_ref: ObjectRef;
  execution_ref: ObjectRef;
  attempt_ref: ObjectRef;
  digest: string;
  media_type: string;
  size_bytes: number;
  captured_at: Timestamp;
}

/** INV-10 remains the authority for durable Artifact identity, version and retention. */
export interface ArtifactHandoffPort {
  registerOutputCandidate(
    context: RequestContext,
    candidate: RuntimeOutputCandidate,
  ): Promise<OperationResult<ObjectRef>>;
}

/** INV-19 remains the authority for usage ledger, aggregation and spend decisions. */
export interface UsageMeasurementHandoffPort {
  recordRawMeasurements(
    context: RequestContext,
    execution_ref: ObjectRef,
    measurements: ResourceMeasurement[],
  ): Promise<OperationResult<ObjectRef[]>>;
}

export interface SecretLeaseDescriptor {
  lease_ref: ObjectRef;
  execution_ref: ObjectRef;
  runtime_profile_ref: ObjectRef;
  secret_refs: ObjectRef[];
  issued_at: Timestamp;
  expires_at: Timestamp;
}

/**
 * Secrets cross this port as governed references only. Implementations must
 * never return secret material or copy it into ordinary execution records/logs.
 */
export interface SecretInjectionPort {
  createEphemeralLease(
    context: RequestContext,
    execution_ref: ObjectRef,
    runtime_profile_ref: ObjectRef,
    secret_refs: ObjectRef[],
    expires_at: Timestamp,
  ): Promise<OperationResult<SecretLeaseDescriptor>>;

  revokeLease(
    context: RequestContext,
    lease_ref: ObjectRef,
    revoked_at: Timestamp,
  ): Promise<OperationResult<void>>;
}

/** A readiness result is advisory until the real runtime adapter enforces it. */
export interface RuntimeAdmissionProbePort {
  probe(
    context: RequestContext,
    profile: RuntimeProfile,
    execution: ExecutionRecord,
    checked_at: Timestamp,
  ): Promise<OperationResult<RuntimeAdmission>>;
}

function sameExactObjectRef(a: ObjectRef, b: ObjectRef): boolean {
  return sameObjectRef(a, b) && a.object_version === b.object_version;
}

function rejectStartReceipt(
  context: RequestContext,
  code: OperationErrorCode,
  message: string,
): OperationResult<void> {
  return createOperationResult({
    status: "REJECTED",
    correlation_id: context?.correlation_id ?? "unknown",
    errors: [createOperationError(code, message, false)],
  });
}

/**
 * Validates the adapter's observed start receipt before INV-05 records RUNNING.
 * A receipt cannot substitute a different runtime profile, capability, attempt,
 * execution, scope, or runtime identity than the one admitted for this start.
 */
export function validateRuntimeStartReceipt(
  context: RequestContext,
  execution: ExecutionRecord,
  attempt: ExecutionAttempt,
  profile: RuntimeProfile,
  invocation: RuntimeInvocationDescriptor,
  receipt: RuntimeStartReceipt,
  now: Timestamp,
): OperationResult<void> {
  if (!isRequestContext(context) || !isTimestamp(now) || !execution || !attempt ||
      !profile || !receipt || !invocation ||
      !isTimestamp(receipt.started_at) || !Array.isArray(invocation.inputs) ||
      !Array.isArray(execution.attempt_refs)) {
    return rejectStartReceipt(context, "VALIDATION_ERROR", "Runtime start receipt or invocation inputs are incomplete or invalid");
  }
  const profileCheck = validateRuntimeProfile(context, profile);
  if (profileCheck.status !== "OK") {
    return rejectStartReceipt(context, "POLICY_DENIED", "Runtime profile is not currently approved for execution");
  }
  if (
    execution.state !== "STARTING" ||
    attempt.state !== "STARTING" ||
    !isObjectRef(execution.execution_ref) ||
    !isObjectRef(attempt.attempt_ref) ||
    !isObjectRef(attempt.execution_ref) ||
    !isTimestamp(execution.created_at) ||
    !sameScopeRef(execution.scope_ref, context.scope_ref) ||
    !sameObjectRef(attempt.execution_ref, execution.execution_ref) ||
    !sameExactObjectRef(attempt.runtime_profile_ref, execution.runtime_profile_ref) ||
    attempt.runtime_profile_version !== execution.runtime_profile_version ||
    !execution.attempt_refs.some((ref) => sameExactObjectRef(ref, attempt.attempt_ref))
  ) {
    return rejectStartReceipt(context, "FORBIDDEN", "Start receipt must resolve the exact scoped STARTING execution and attempt");
  }

  const expectedBindings: Array<[ObjectRef, ObjectRef]> = [
    [invocation.execution_ref, execution.execution_ref],
    [invocation.attempt_ref, attempt.attempt_ref],
    [invocation.work_ref, execution.work_ref],
    [invocation.orchestration_run_ref, execution.orchestration_run_ref],
    [invocation.graph_revision_ref, execution.graph_revision_ref],
    [invocation.graph_node_ref, execution.graph_node_ref],
    [invocation.dispatch_ref, execution.dispatch_ref],
    [invocation.capability_ref, execution.capability_ref],
    [invocation.authorization_decision_ref, execution.authorization_decision_ref],
    [invocation.runtime_profile_ref, execution.runtime_profile_ref],
    [profile.profile_ref, execution.runtime_profile_ref],
  ];
  if (
    expectedBindings.some(([provided, authoritative]) =>
      !isObjectRef(provided) ||
      !isObjectRef(authoritative) ||
      !sameExactObjectRef(provided, authoritative)) ||
    invocation.capability_version !== execution.capability_version ||
    invocation.runtime_profile_version !== execution.runtime_profile_version ||
    invocation.runtime_profile_version !== profile.profile_version ||
    (profile.profile_digest !== undefined &&
      invocation.runtime_profile_digest !== profile.profile_digest) ||
    !isVersion(invocation.idempotency_key) ||
    invocation.idempotency_key !== execution.idempotency_key ||
    !isObjectRef(receipt.runtime_instance_ref) ||
    receipt.runtime_instance_ref.object_kind !== "RUNTIME_INSTANCE" ||
    !isObjectRef(receipt.runtime_identity_ref) ||
    receipt.runtime_identity_ref.object_kind !== "RUNTIME_IDENTITY" ||
    !isObjectRef(receipt.start_evidence_ref) ||
    receipt.start_evidence_ref.object_kind !== "RUNTIME_START_EVIDENCE" ||
    !isObjectRef(receipt.runtime_profile_ref) ||
    !sameExactObjectRef(receipt.runtime_profile_ref, profile.profile_ref) ||
    receipt.runtime_profile_version !== profile.profile_version
  ) {
    return rejectStartReceipt(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Runtime start receipt does not bind the exact admitted invocation, profile and runtime identity");
  }

  if (invocation.inputs.some((input) =>
      !input || !isObjectRef(input.input_ref) || !isVersion(input.input_digest))) {
    return rejectStartReceipt(context, "VALIDATION_ERROR", "Runtime invocation contains an invalid input reference or digest");
  }
  const allRefs = [
    receipt.runtime_instance_ref,
    receipt.runtime_identity_ref,
    receipt.start_evidence_ref,
    receipt.runtime_profile_ref,
    ...invocation.inputs.map((input) => input.input_ref),
  ];
  if (allRefs.some((ref) => !isObjectRef(ref) || !sameScopeRef(ref.scope_ref, context.scope_ref))) {
    return rejectStartReceipt(context, "FORBIDDEN", "Runtime start receipt and invocation inputs must remain inside the authenticated scope");
  }
  if (
    invocation.inputs.some((input) => !isVersion(input.input_digest)) ||
    Date.parse(receipt.started_at) > Date.parse(now) ||
    Date.parse(receipt.started_at) < Date.parse(execution.created_at)
  ) {
    return rejectStartReceipt(context, "VALIDATION_ERROR", "Runtime start time or invocation input digest is invalid");
  }
  if (
    profile.profile_digest !== undefined &&
    receipt.runtime_profile_digest !== profile.profile_digest
  ) {
    return rejectStartReceipt(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Runtime started with a different profile digest than the approved profile");
  }

  if (profile.trust_class === "UNTRUSTED_GENERATED_CODE") {
    if (!invocation.runtime_assurance) {
      return rejectStartReceipt(context, "POLICY_DENIED", "Untrusted generated code requires trusted runtime assurance at the start boundary");
    }
    const assurance = validateTrustedRuntimeAssurance(
      context,
      profile,
      invocation.runtime_assurance,
      now,
    );
    if (
      assurance.status !== "OK" ||
      !sameExactObjectRef(receipt.runtime_identity_ref, invocation.runtime_assurance.runtime_identity_ref) ||
      receipt.runtime_profile_digest !== invocation.runtime_assurance.runtime_profile_digest
    ) {
      return rejectStartReceipt(context, "POLICY_DENIED", "Actual runtime identity does not match the trusted attestation");
    }
  }
  return createOperationResult({
    status: "OK",
    correlation_id: context.correlation_id,
  });
}
