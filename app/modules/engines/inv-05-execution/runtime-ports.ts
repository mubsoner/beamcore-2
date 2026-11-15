import type {
  ExecutionAttempt,
  ExecutionRecord,
  ResourceMeasurement,
  RuntimeCheckpoint,
  RuntimeProfile,
  RuntimeAdmission,
  TerminationKnowledge,
  EffectKnowledge,
  CleanupState,
  OutputCompleteness,
  TrustedRuntimeAssurance,
} from "./domain";
import type {
  ObjectRef,
  OperationResult,
  RequestContext,
  Timestamp,
} from "../shared";

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
