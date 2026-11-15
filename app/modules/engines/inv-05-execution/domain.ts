import {
  createOperationError,
  createOperationResult,
  isObjectRef,
  isPrincipalRef,
  isRequestContext,
  isTimestamp,
  isVersion,
  sameObjectRef,
  sameScopeRef,
  type DomainEventEnvelope,
  type ObjectRef,
  type OperationErrorCode,
  type OperationResult,
  type PrincipalRef,
  type RequestContext,
  type RevisionNumber,
  type Timestamp,
} from "../shared";

export const EXECUTION_STATES = [
  "CREATED",
  "QUEUED",
  "STARTING",
  "RUNNING",
  "CANCELLATION_REQUESTED",
  "CANCELLING",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
  "UNKNOWN",
] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

export const ATTEMPT_STATES = [
  "QUEUED",
  "STARTING",
  "RUNNING",
  "CANCELLATION_REQUESTED",
  "CANCELLING",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
  "UNKNOWN",
] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];

export const EFFECT_KNOWLEDGE = [
  "NOT_APPLICABLE",
  "NOT_STARTED",
  "IN_PROGRESS",
  "CONFIRMED_APPLIED",
  "CONFIRMED_NOT_APPLIED",
  "UNKNOWN",
  "RECONCILIATION_REQUIRED",
] as const;
export type EffectKnowledge = (typeof EFFECT_KNOWLEDGE)[number];

export const CLEANUP_STATES = [
  "NOT_STARTED",
  "PENDING",
  "CLEANING",
  "SUCCEEDED",
  "FAILED",
  "UNKNOWN",
] as const;
export type CleanupState = (typeof CLEANUP_STATES)[number];

export const CHECKPOINT_STATES = [
  "REQUESTED",
  "CAPTURING",
  "AVAILABLE",
  "REJECTED",
  "EXPIRED",
  "INVALID",
  "UNKNOWN",
] as const;
export type CheckpointState = (typeof CHECKPOINT_STATES)[number];

export const RESUME_DISPOSITIONS = [
  "RESUME_ALLOWED",
  "RESUME_DENIED",
  "RESTART_REQUIRED",
  "RECONCILIATION_REQUIRED",
  "UNKNOWN",
] as const;
export type ResumeDisposition = (typeof RESUME_DISPOSITIONS)[number];

export const RUNTIME_ADMISSIONS = [
  "ADMITTED",
  "DENIED",
  "DEFERRED",
  "UNKNOWN",
] as const;
export type RuntimeAdmission = (typeof RUNTIME_ADMISSIONS)[number];

export const TERMINATION_KNOWLEDGE = [
  "NOT_REQUESTED",
  "REQUESTED",
  "CONFIRMED_TERMINATED",
  "CONFIRMED_STILL_RUNNING",
  "UNKNOWN",
] as const;
export type TerminationKnowledge = (typeof TERMINATION_KNOWLEDGE)[number];

export const OUTPUT_COMPLETENESS = ["NONE", "PARTIAL", "COMPLETE", "UNKNOWN"] as const;
export type OutputCompleteness = (typeof OUTPUT_COMPLETENESS)[number];

export const USAGE_MEASUREMENT_KINDS = [
  "CPU_TIME",
  "WALL_TIME",
  "PEAK_MEMORY",
  "STORAGE_BYTES",
  "PROCESS_COUNT",
  "NETWORK_BYTES_IN",
  "NETWORK_BYTES_OUT",
  "OUTPUT_BYTES",
  "OTHER",
] as const;
export type UsageMeasurementKind = (typeof USAGE_MEASUREMENT_KINDS)[number];

export const MEASUREMENT_QUALITIES = [
  "OBSERVED",
  "ESTIMATED",
  "PARTIAL",
  "UNKNOWN",
] as const;
export type MeasurementQuality = (typeof MEASUREMENT_QUALITIES)[number];

export const RUNTIME_PROFILE_STATUSES = [
  "DRAFT",
  "VALIDATED",
  "APPROVED",
  "SUSPENDED",
  "RETIRED",
] as const;
export type RuntimeProfileStatus = (typeof RUNTIME_PROFILE_STATUSES)[number];

export const RUNTIME_TRUST_CLASSES = [
  "TRUSTED_INTERNAL_TASK",
  "UNTRUSTED_GENERATED_CODE",
  "EXTERNAL_TOOL_ACTION",
  "SENSITIVE_DATA_PROCESSING",
] as const;
export type RuntimeTrustClass = (typeof RUNTIME_TRUST_CLASSES)[number];

export type ExecutionEffectClass =
  | "IDEMPOTENT"
  | "DEDUPLICATED"
  | "REVERSIBLE"
  | "NON_IDEMPOTENT"
  | "UNKNOWN";

export interface Quantity {
  value: number;
  unit: string;
}

export interface Duration {
  value: number;
  unit: string;
}

export interface RuntimeProfile {
  profile_ref: ObjectRef;
  profile_version: string;
  profile_status: RuntimeProfileStatus;
  trust_class: RuntimeTrustClass;
  isolation_requirement: string;
  cpu_limit?: Quantity;
  memory_limit?: Quantity;
  wall_time_limit?: Duration;
  storage_limit?: Quantity;
  process_limit?: number;
  output_size_limit?: Quantity;
  concurrency_limit?: number;
  network_egress_policy_ref: ObjectRef;
  filesystem_policy_ref: ObjectRef;
  secret_injection_policy_ref?: ObjectRef;
  allowed_capability_refs: ObjectRef[];
  permitted_output_kinds: string[];
  resumability_policy_ref?: ObjectRef;
  created_at: Timestamp;
  approved_by?: PrincipalRef;
  approval_ref?: ObjectRef;
}

export type RuntimeLimitField =
  | "cpu_limit"
  | "memory_limit"
  | "wall_time_limit"
  | "storage_limit"
  | "process_limit"
  | "output_size_limit"
  | "concurrency_limit";

export interface ExecutionRequest {
  execution_ref: ObjectRef;
  work_ref: ObjectRef;
  orchestration_run_ref: ObjectRef;
  graph_revision_ref: ObjectRef;
  graph_node_ref: ObjectRef;
  dispatch_ref: ObjectRef;
  capability_ref: ObjectRef;
  capability_version: string;
  actor_ref: PrincipalRef;
  authorization_decision_ref: ObjectRef;
  runtime_profile: RuntimeProfile;
  input_refs: ObjectRef[];
  input_digests: string[];
  request_digest: string;
  idempotency_key: string;
  side_effect_class: ExecutionEffectClass;
  deadline?: Timestamp;
}

export interface ExecutionRecord {
  execution_ref: ObjectRef;
  scope_ref: RequestContext["scope_ref"];
  work_ref: ObjectRef;
  orchestration_run_ref: ObjectRef;
  graph_revision_ref: ObjectRef;
  graph_node_ref: ObjectRef;
  dispatch_ref: ObjectRef;
  capability_ref: ObjectRef;
  capability_version: string;
  actor_ref: PrincipalRef;
  authorization_decision_ref: ObjectRef;
  runtime_profile_ref: ObjectRef;
  runtime_profile_version: string;
  request_digest: string;
  idempotency_key: string;
  state: ExecutionState;
  state_version: RevisionNumber;
  effect_knowledge: EffectKnowledge;
  output_completeness: OutputCompleteness;
  attempt_refs: ObjectRef[];
  output_refs: ObjectRef[];
  measurement_refs: ObjectRef[];
  checkpoint_refs: ObjectRef[];
  error_refs: ObjectRef[];
  cleanup_state: CleanupState;
  termination_knowledge: TerminationKnowledge;
  created_at: Timestamp;
  queued_at?: Timestamp;
  started_at?: Timestamp;
  ended_at?: Timestamp;
  cleaned_at?: Timestamp;
  last_reconciliation_ref?: ObjectRef;
  audit_ref?: ObjectRef;
}

export interface ExecutionAttempt {
  attempt_ref: ObjectRef;
  execution_ref: ObjectRef;
  attempt_number: number;
  invocation_digest: string;
  runtime_profile_ref: ObjectRef;
  runtime_profile_version: string;
  state: AttemptState;
  state_version: RevisionNumber;
  runtime_instance_ref?: ObjectRef;
  process_exit_code?: number;
  termination_reason?: string;
  output_completeness: OutputCompleteness;
  stdout_ref?: ObjectRef;
  stderr_ref?: ObjectRef;
  result_payload_ref?: ObjectRef;
  input_digest: string;
  output_digest?: string;
  started_at?: Timestamp;
  ended_at?: Timestamp;
  termination_knowledge: TerminationKnowledge;
  error_refs: ObjectRef[];
  audit_ref?: ObjectRef;
}

export interface ResourceMeasurement {
  measurement_ref: ObjectRef;
  execution_ref: ObjectRef;
  attempt_ref: ObjectRef;
  kind: UsageMeasurementKind;
  value: number;
  unit: string;
  measured_at: Timestamp;
  measurement_source: string;
  confidence: MeasurementQuality;
  source_digest?: string;
}

export interface RuntimeCheckpoint {
  checkpoint_ref: ObjectRef;
  execution_ref: ObjectRef;
  attempt_ref: ObjectRef;
  runtime_profile_ref: ObjectRef;
  runtime_profile_version: string;
  checkpoint_version: RevisionNumber;
  state: CheckpointState;
  resumability_contract_ref: ObjectRef;
  snapshot_digest?: string;
  created_at: Timestamp;
  expires_at?: Timestamp;
  invalidation_reason?: string;
}

export interface CancellationOperation {
  cancellation_ref: ObjectRef;
  execution_ref: ObjectRef;
  requested_by: PrincipalRef;
  reason_ref?: ObjectRef;
  requested_at: Timestamp;
  termination_knowledge: TerminationKnowledge;
  completed_at?: Timestamp;
  error_refs: ObjectRef[];
}

export interface ReconciliationRecord {
  reconciliation_ref: ObjectRef;
  execution_ref: ObjectRef;
  attempt_ref?: ObjectRef;
  prior_state: ExecutionState;
  prior_effect_knowledge: EffectKnowledge;
  evidence_refs: ObjectRef[];
  method_ref: ObjectRef;
  resulting_state: ExecutionState;
  resulting_effect_knowledge: EffectKnowledge;
  assessed_by: PrincipalRef;
  assessed_at: Timestamp;
  limitations: string[];
}

export type ExecutionEventType =
  | "execution.accepted"
  | "execution.queued"
  | "execution.starting"
  | "execution.started"
  | "execution.output_captured"
  | "execution.cancel_requested"
  | "execution.cancelling"
  | "execution.succeeded"
  | "execution.failed"
  | "execution.timed_out"
  | "execution.cancelled"
  | "execution.unknown"
  | "execution.reconciliation_required"
  | "execution.checkpoint_available"
  | "execution.resource_limit_reached"
  | "execution.cleanup_started"
  | "execution.cleaned_up"
  | "execution.cleanup_failed";

const REQUIRED_UNTRUSTED_LIMITS: RuntimeLimitField[] = [
  "cpu_limit",
  "memory_limit",
  "wall_time_limit",
  "storage_limit",
  "process_limit",
  "output_size_limit",
  "concurrency_limit",
];

const EXECUTION_TRANSITIONS: Record<ExecutionState, readonly ExecutionState[]> = {
  CREATED: ["QUEUED", "FAILED", "CANCELLED"],
  QUEUED: ["STARTING", "FAILED", "CANCELLED"],
  STARTING: ["RUNNING", "FAILED", "TIMED_OUT", "CANCELLED", "UNKNOWN"],
  RUNNING: [
    "CANCELLATION_REQUESTED",
    "SUCCEEDED",
    "FAILED",
    "TIMED_OUT",
    "UNKNOWN",
  ],
  CANCELLATION_REQUESTED: [
    "CANCELLING",
    "SUCCEEDED",
    "FAILED",
    "TIMED_OUT",
    "CANCELLED",
    "UNKNOWN",
  ],
  CANCELLING: ["CANCELLED", "SUCCEEDED", "FAILED", "TIMED_OUT", "UNKNOWN"],
  SUCCEEDED: [],
  FAILED: [],
  TIMED_OUT: [],
  CANCELLED: [],
  UNKNOWN: ["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED", "UNKNOWN"],
};

function correlationId(context: RequestContext): string {
  return typeof context?.correlation_id === "string" && context.correlation_id.trim()
    ? context.correlation_id
    : "unknown-correlation";
}

function rejected<T>(
  context: RequestContext,
  code: OperationErrorCode,
  message: string,
): OperationResult<T> {
  return createOperationResult<T>({
    status: "REJECTED",
    correlation_id: correlationId(context),
    errors: [createOperationError(code, message)],
  });
}

function succeeded<T>(
  context: RequestContext,
  data: T,
  object_version?: string,
): OperationResult<T> {
  return createOperationResult<T>({
    status: "OK",
    correlation_id: correlationId(context),
    data,
    object_version,
  });
}

function isRefKind(value: unknown, kind: string): value is ObjectRef {
  return isObjectRef(value) && value.object_kind === kind;
}

function samePrincipal(a: PrincipalRef, b: PrincipalRef): boolean {
  return (
    a.principal_id === b.principal_id &&
    a.principal_kind === b.principal_kind
  );
}

function isPositiveQuantity(value: Quantity | undefined): boolean {
  return (
    value !== undefined &&
    Number.isFinite(value.value) &&
    value.value > 0 &&
    typeof value.unit === "string" &&
    value.unit.trim().length > 0
  );
}

function isPositiveDuration(value: Duration | undefined): boolean {
  return (
    value !== undefined &&
    Number.isFinite(value.value) &&
    value.value > 0 &&
    typeof value.unit === "string" &&
    value.unit.trim().length > 0
  );
}

function isPositiveInteger(value: number | undefined): boolean {
  return value !== undefined && Number.isSafeInteger(value) && value > 0;
}

function hasSameScope(refs: readonly ObjectRef[], scope: RequestContext["scope_ref"]): boolean {
  return refs.every((ref) => isObjectRef(ref) && sameScopeRef(ref.scope_ref, scope));
}

function requiredRuntimeLimits(profile: RuntimeProfile): RuntimeLimitField[] {
  if (
    profile.trust_class === "UNTRUSTED_GENERATED_CODE" ||
    profile.trust_class === "SENSITIVE_DATA_PROCESSING"
  ) {
    return REQUIRED_UNTRUSTED_LIMITS;
  }
  return [];
}

/**
 * Validates only the provider-neutral RuntimeProfile contract. The runtime adapter
 * must still prove that the referenced controls are enforced by the real boundary.
 */
export function validateRuntimeProfile(
  context: RequestContext,
  profile: RuntimeProfile,
  requiredLimits: readonly RuntimeLimitField[] = requiredRuntimeLimits(profile),
): OperationResult<RuntimeProfile> {
  if (!isRequestContext(context)) {
    return rejected(context, "VALIDATION_ERROR", "A valid request context is required");
  }
  if (
    !profile ||
    !isRefKind(profile.profile_ref, "RUNTIME_PROFILE") ||
    !isVersion(profile.profile_version) ||
    !RUNTIME_PROFILE_STATUSES.includes(profile.profile_status) ||
    !RUNTIME_TRUST_CLASSES.includes(profile.trust_class) ||
    !isTimestamp(profile.created_at) ||
    !profile.isolation_requirement.trim()
  ) {
    return rejected(context, "VALIDATION_ERROR", "Runtime profile identity or required metadata is invalid");
  }
  if (!sameScopeRef(profile.profile_ref.scope_ref, context.scope_ref)) {
    return rejected(context, "FORBIDDEN", "Runtime profile is outside the authenticated scope");
  }
  if (profile.profile_status !== "APPROVED") {
    return rejected(context, "POLICY_DENIED", "Runtime profile is not currently approved");
  }
  if (
    !isRefKind(profile.network_egress_policy_ref, "NETWORK_EGRESS_POLICY") ||
    !isRefKind(profile.filesystem_policy_ref, "FILESYSTEM_POLICY") ||
    !sameScopeRef(profile.network_egress_policy_ref.scope_ref, context.scope_ref) ||
    !sameScopeRef(profile.filesystem_policy_ref.scope_ref, context.scope_ref)
  ) {
    return rejected(context, "VALIDATION_ERROR", "Runtime profile requires scoped network and filesystem policies");
  }

  const limitChecks: Record<RuntimeLimitField, boolean> = {
    cpu_limit: isPositiveQuantity(profile.cpu_limit),
    memory_limit: isPositiveQuantity(profile.memory_limit),
    wall_time_limit: isPositiveDuration(profile.wall_time_limit),
    storage_limit: isPositiveQuantity(profile.storage_limit),
    process_limit: isPositiveInteger(profile.process_limit),
    output_size_limit: isPositiveQuantity(profile.output_size_limit),
    concurrency_limit: isPositiveInteger(profile.concurrency_limit),
  };
  for (const field of requiredLimits) {
    if (!limitChecks[field]) {
      return rejected(
        context,
        "RESOURCE_LIMIT",
        "Runtime profile is missing a finite positive required limit: " + field,
      );
    }
  }
  for (const field of Object.keys(limitChecks) as RuntimeLimitField[]) {
    const value = profile[field];
    if (value !== undefined && !limitChecks[field]) {
      return rejected(context, "VALIDATION_ERROR", "Runtime profile contains an invalid limit: " + field);
    }
  }

  if (
    !Array.isArray(profile.allowed_capability_refs) ||
    profile.allowed_capability_refs.some((ref) => !isRefKind(ref, "CAPABILITY")) ||
    !hasSameScope(profile.allowed_capability_refs, context.scope_ref) ||
    !Array.isArray(profile.permitted_output_kinds) ||
    profile.permitted_output_kinds.some((kind) => typeof kind !== "string" || !kind.trim())
  ) {
    return rejected(context, "VALIDATION_ERROR", "Runtime profile capability or output restrictions are invalid");
  }
  if (
    profile.secret_injection_policy_ref !== undefined &&
    (!isRefKind(profile.secret_injection_policy_ref, "SECRET_INJECTION_POLICY") ||
      !sameScopeRef(profile.secret_injection_policy_ref.scope_ref, context.scope_ref))
  ) {
    return rejected(context, "VALIDATION_ERROR", "Secret injection policy reference is invalid or out of scope");
  }
  if (
    profile.resumability_policy_ref !== undefined &&
    (!isRefKind(profile.resumability_policy_ref, "RESUMABILITY_POLICY") ||
      !sameScopeRef(profile.resumability_policy_ref.scope_ref, context.scope_ref))
  ) {
    return rejected(context, "VALIDATION_ERROR", "Resumability policy reference is invalid or out of scope");
  }
  if (
    profile.approved_by !== undefined &&
    (!isPrincipalRef(profile.approved_by) || !samePrincipal(profile.approved_by, context.actor_ref) &&
      profile.approved_by.principal_id.trim().length === 0)
  ) {
    return rejected(context, "VALIDATION_ERROR", "Runtime profile approver reference is invalid");
  }
  if (
    profile.approval_ref !== undefined &&
    (!isObjectRef(profile.approval_ref) || !sameScopeRef(profile.approval_ref.scope_ref, context.scope_ref))
  ) {
    return rejected(context, "VALIDATION_ERROR", "Runtime profile approval reference is invalid or out of scope");
  }
  if (profile.trust_class === "UNTRUSTED_GENERATED_CODE" &&
      (!profile.approved_by || !profile.approval_ref || !profile.secret_injection_policy_ref)) {
    return rejected(context, "POLICY_DENIED", "Untrusted generated code requires an approved profile, approval provenance and secret policy");
  }
  return succeeded(context, profile, profile.profile_version);
}

export function validateExecutionRequest(
  context: RequestContext,
  request: ExecutionRequest,
): OperationResult<ExecutionRequest> {
  if (!isRequestContext(context)) {
    return rejected(context, "VALIDATION_ERROR", "A valid request context is required");
  }
  const requiredRefs: Array<[ObjectRef, string]> = [
    [request.execution_ref, "EXECUTION"],
    [request.work_ref, "WORK"],
    [request.orchestration_run_ref, "ORCHESTRATION_RUN"],
    [request.graph_revision_ref, "WORK_GRAPH_REVISION"],
    [request.graph_node_ref, "GRAPH_NODE"],
    [request.dispatch_ref, "DISPATCH_ATTEMPT"],
    [request.capability_ref, "CAPABILITY"],
    [request.authorization_decision_ref, "AUTHORITY_DECISION"],
  ];
  if (
    !request ||
    requiredRefs.some(([ref, kind]) => !isRefKind(ref, kind)) ||
    !isPrincipalRef(request.actor_ref) ||
    !samePrincipal(request.actor_ref, context.actor_ref) ||
    !sameScopeRef(request.execution_ref.scope_ref, context.scope_ref) ||
    !requiredRefs.every(([ref]) => sameScopeRef(ref.scope_ref, context.scope_ref))
  ) {
    return rejected(context, "FORBIDDEN", "Execution references, actor and scope must match the authenticated request");
  }
  if (
    !isVersion(request.capability_version) ||
    (request.capability_ref.object_version !== undefined &&
      request.capability_ref.object_version !== request.capability_version) ||
    !isVersion(request.request_digest) ||
    !isVersion(request.idempotency_key) ||
    context.idempotency_key !== request.idempotency_key ||
    !Array.isArray(request.input_refs) ||
    !Array.isArray(request.input_digests) ||
    request.input_refs.length !== request.input_digests.length ||
    request.input_refs.some((ref) => !isObjectRef(ref)) ||
    !hasSameScope(request.input_refs, context.scope_ref) ||
    request.input_digests.some((digest) => !isVersion(digest)) ||
    (request.deadline !== undefined &&
      (!isTimestamp(request.deadline) || Date.parse(request.deadline) <= Date.parse(context.issued_at)))
  ) {
    return rejected(context, "VALIDATION_ERROR", "Execution digest, idempotency, input or deadline contract is invalid");
  }
  if (
    !["IDEMPOTENT", "DEDUPLICATED", "REVERSIBLE", "NON_IDEMPOTENT", "UNKNOWN"].includes(request.side_effect_class)
  ) {
    return rejected(context, "VALIDATION_ERROR", "Execution side-effect classification is invalid");
  }

  const profileResult = validateRuntimeProfile(context, request.runtime_profile);
  if (profileResult.status !== "OK" || !profileResult.data) {
    const issue = profileResult.errors[0];
    return rejected(
      context,
      issue?.code ?? "POLICY_DENIED",
      issue?.safe_message ?? "Runtime profile validation failed",
    );
  }
  if (
    !sameObjectRef(request.runtime_profile.profile_ref, request.execution_ref.scope_ref.scope_kind === "SYSTEM"
      ? request.runtime_profile.profile_ref
      : request.runtime_profile.profile_ref) ||
    !request.runtime_profile.allowed_capability_refs.some((ref) => sameObjectRef(ref, request.capability_ref))
  ) {
    return rejected(context, "CAPABILITY_UNAVAILABLE", "Runtime profile does not allow the exact capability reference");
  }
  return succeeded(context, request);
}

export function createExecutionRecord(
  context: RequestContext,
  request: ExecutionRequest,
  createdAt: Timestamp,
): OperationResult<ExecutionRecord> {
  const validation = validateExecutionRequest(context, request);
  if (validation.status !== "OK" || !validation.data) {
    const issue = validation.errors[0];
    return rejected(context, issue?.code ?? "VALIDATION_ERROR", issue?.safe_message ?? "Execution request is invalid");
  }
  if (!isTimestamp(createdAt)) {
    return rejected(context, "VALIDATION_ERROR", "Execution creation timestamp is invalid");
  }

  const execution: ExecutionRecord = {
    execution_ref: request.execution_ref,
    scope_ref: context.scope_ref,
    work_ref: request.work_ref,
    orchestration_run_ref: request.orchestration_run_ref,
    graph_revision_ref: request.graph_revision_ref,
    graph_node_ref: request.graph_node_ref,
    dispatch_ref: request.dispatch_ref,
    capability_ref: request.capability_ref,
    capability_version: request.capability_version,
    actor_ref: request.actor_ref,
    authorization_decision_ref: request.authorization_decision_ref,
    runtime_profile_ref: request.runtime_profile.profile_ref,
    runtime_profile_version: request.runtime_profile.profile_version,
    request_digest: request.request_digest,
    idempotency_key: request.idempotency_key,
    state: "CREATED",
    state_version: 1,
    effect_knowledge: "NOT_STARTED",
    output_completeness: "NONE",
    attempt_refs: [],
    output_refs: [],
    measurement_refs: [],
    checkpoint_refs: [],
    error_refs: [],
    cleanup_state: "NOT_STARTED",
    termination_knowledge: "NOT_REQUESTED",
    created_at: createdAt,
  };
  return succeeded(context, execution, "1");
}

export type IdempotencyDisposition =
  | { disposition: "NEW" }
  | { disposition: "DEDUPLICATED"; execution: ExecutionRecord };

export function checkExecutionIdempotency(
  context: RequestContext,
  existing: ExecutionRecord | null,
  idempotencyKey: string,
  requestDigest: string,
): OperationResult<IdempotencyDisposition> {
  if (!isVersion(idempotencyKey) || !isVersion(requestDigest)) {
    return rejected(context, "VALIDATION_ERROR", "A non-empty idempotency key and request digest are required");
  }
  if (!existing) return succeeded(context, { disposition: "NEW" });
  if (!sameScopeRef(existing.scope_ref, context.scope_ref)) {
    return rejected(context, "FORBIDDEN", "Existing execution is outside the authenticated scope");
  }
  if (existing.idempotency_key !== idempotencyKey) {
    return rejected(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Idempotency lookup returned a different key");
  }
  if (existing.request_digest !== requestDigest) {
    return rejected(context, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used with a different request digest");
  }
  return succeeded(context, { disposition: "DEDUPLICATED", execution: existing }, String(existing.state_version));
}

export interface StartAttemptInput {
  expected_execution_version: RevisionNumber;
  attempt_ref: ObjectRef;
  invocation_digest: string;
  input_digest: string;
  created_at: Timestamp;
}

export function startExecutionAttempt(
  context: RequestContext,
  execution: ExecutionRecord,
  input: StartAttemptInput,
): OperationResult<{ execution: ExecutionRecord; attempt: ExecutionAttempt }> {
  if (!isRequestContext(context) || !isObjectRef(execution.execution_ref)) {
    return rejected(context, "VALIDATION_ERROR", "Execution start requires a valid context and execution");
  }
  if (!sameScopeRef(execution.scope_ref, context.scope_ref) ||
      !sameScopeRef(execution.execution_ref.scope_ref, context.scope_ref)) {
    return rejected(context, "FORBIDDEN", "Execution is outside the authenticated scope");
  }
  if (execution.state_version !== input.expected_execution_version) {
    return rejected(context, "VERSION_CONFLICT", "Execution changed before the attempt could start");
  }
  if (execution.state !== "QUEUED" || !isRefKind(input.attempt_ref, "EXECUTION_ATTEMPT") ||
      !sameScopeRef(input.attempt_ref.scope_ref, context.scope_ref) ||
      !isVersion(input.invocation_digest) || !isVersion(input.input_digest) ||
      !isTimestamp(input.created_at)) {
    return rejected(context, "VALIDATION_ERROR", "Attempt identity, digest, timestamp or execution state is invalid");
  }

  const nextAttemptNumber = execution.attempt_refs.length + 1;
  if (execution.attempt_refs.some((ref) => sameObjectRef(ref, input.attempt_ref))) {
    return rejected(context, "IDEMPOTENCY_CONFLICT", "Attempt reference already exists for this Execution");
  }

  const attempt: ExecutionAttempt = {
    attempt_ref: input.attempt_ref,
    execution_ref: execution.execution_ref,
    attempt_number: nextAttemptNumber,
    invocation_digest: input.invocation_digest,
    runtime_profile_ref: execution.runtime_profile_ref,
    runtime_profile_version: execution.runtime_profile_version,
    state: "STARTING",
    state_version: 1,
    output_completeness: "NONE",
    input_digest: input.input_digest,
    termination_knowledge: "NOT_REQUESTED",
    error_refs: [],
  };
  const updatedExecution: ExecutionRecord = {
    ...execution,
    state: "STARTING",
    state_version: execution.state_version + 1,
    attempt_refs: [...execution.attempt_refs, input.attempt_ref],
    termination_knowledge: "NOT_REQUESTED",
  };
  return succeeded(context, { execution: updatedExecution, attempt }, String(updatedExecution.state_version));
}

export interface ConfirmAttemptStartedInput {
  expected_execution_version: RevisionNumber;
  expected_attempt_version: RevisionNumber;
  runtime_instance_ref: ObjectRef;
  started_at: Timestamp;
}

export function confirmExecutionAttemptStarted(
  context: RequestContext,
  execution: ExecutionRecord,
  attempt: ExecutionAttempt,
  input: ConfirmAttemptStartedInput,
): OperationResult<{ execution: ExecutionRecord; attempt: ExecutionAttempt }> {
  if (!sameScopeRef(execution.scope_ref, context.scope_ref) ||
      !sameObjectRef(attempt.execution_ref, execution.execution_ref) ||
      !execution.attempt_refs.some((ref) => sameObjectRef(ref, attempt.attempt_ref)) ||
      !sameScopeRef(input.runtime_instance_ref.scope_ref, context.scope_ref)) {
    return rejected(context, "FORBIDDEN", "Attempt, runtime instance and execution must share the authenticated scope");
  }
  if (execution.state_version !== input.expected_execution_version ||
      attempt.state_version !== input.expected_attempt_version) {
    return rejected(context, "VERSION_CONFLICT", "Execution or attempt changed before runtime start was confirmed");
  }
  if (execution.state !== "STARTING" || attempt.state !== "STARTING" ||
      !isTimestamp(input.started_at) || !isObjectRef(input.runtime_instance_ref)) {
    return rejected(context, "VALIDATION_ERROR", "Only a starting attempt can be confirmed as running");
  }

  const updatedAttempt: ExecutionAttempt = {
    ...attempt,
    state: "RUNNING",
    state_version: attempt.state_version + 1,
    runtime_instance_ref: input.runtime_instance_ref,
    started_at: input.started_at,
    termination_knowledge: "NOT_REQUESTED",
  };
  const updatedExecution: ExecutionRecord = {
    ...execution,
    state: "RUNNING",
    state_version: execution.state_version + 1,
    started_at: input.started_at,
    termination_knowledge: "NOT_REQUESTED",
    effect_knowledge: "IN_PROGRESS",
  };
  return succeeded(context, { execution: updatedExecution, attempt: updatedAttempt }, String(updatedExecution.state_version));
}

export interface TransitionExecutionInput {
  expected_state_version: RevisionNumber;
  to_state: ExecutionState;
  changed_at: Timestamp;
  termination_knowledge?: TerminationKnowledge;
  effect_knowledge?: EffectKnowledge;
  output_completeness?: OutputCompleteness;
  error_refs?: ObjectRef[];
  resolution_evidence_refs?: ObjectRef[];
  last_reconciliation_ref?: ObjectRef;
  audit_ref?: ObjectRef;
}

export function transitionExecution(
  context: RequestContext,
  execution: ExecutionRecord,
  input: TransitionExecutionInput,
): OperationResult<ExecutionRecord> {
  if (!isRequestContext(context) || !isObjectRef(execution.execution_ref)) {
    return rejected(context, "VALIDATION_ERROR", "Execution transition requires a valid context and execution");
  }
  if (!sameScopeRef(execution.scope_ref, context.scope_ref) ||
      !sameScopeRef(execution.execution_ref.scope_ref, context.scope_ref)) {
    return rejected(context, "FORBIDDEN", "Execution is outside the authenticated scope");
  }
  if (execution.state_version !== input.expected_state_version) {
    return rejected(context, "VERSION_CONFLICT", "Execution state version is stale");
  }
  if (!isTimestamp(input.changed_at) ||
      !EXECUTION_STATES.includes(input.to_state) ||
      !EXECUTION_TRANSITIONS[execution.state].includes(input.to_state)) {
    return rejected(context, "VALIDATION_ERROR", "Execution state transition is not permitted");
  }
  const termination = input.termination_knowledge ?? execution.termination_knowledge;
  const hasStarted = execution.started_at !== undefined;

  if (input.to_state === "RUNNING" &&
      (!hasStarted || execution.attempt_refs.length === 0)) {
    return rejected(context, "VALIDATION_ERROR", "RUNNING requires an observed process start and an immutable attempt reference");
  }
  if (["SUCCEEDED", "FAILED", "TIMED_OUT"].includes(input.to_state)) {
    if (!isTimestamp(input.changed_at)) {
      return rejected(context, "VALIDATION_ERROR", "A terminal runtime state requires an observed end timestamp");
    }
    if (hasStarted && termination !== "CONFIRMED_TERMINATED") {
      return rejected(context, "OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED", "A terminal runtime result requires confirmed process termination");
    }
    if (!hasStarted && termination !== "NOT_REQUESTED" && termination !== "CONFIRMED_TERMINATED") {
      return rejected(context, "OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED", "Pre-start failure requires evidence that no process ran");
    }
  }
  if (input.to_state === "CANCELLED") {
    if (hasStarted && termination !== "CONFIRMED_TERMINATED") {
      return rejected(context, "OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED", "Cancellation is not confirmed until process termination is observed");
    }
    if (!hasStarted && termination !== "NOT_REQUESTED") {
      return rejected(context, "OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED", "Pre-start cancellation must confirm that no process started");
    }
  }
  if (input.to_state === "CANCELLATION_REQUESTED" && termination !== "REQUESTED") {
    return rejected(context, "VALIDATION_ERROR", "Cancellation request must retain REQUESTED termination knowledge");
  }
  if (input.to_state === "CANCELLING" &&
      termination !== "REQUESTED" && termination !== "CONFIRMED_STILL_RUNNING") {
    return rejected(context, "VALIDATION_ERROR", "CANCELLING requires a recorded runtime cancellation request");
  }
  if (input.to_state === "UNKNOWN" && hasStarted && input.effect_knowledge === undefined &&
      execution.effect_knowledge === "NOT_STARTED") {
    return rejected(context, "OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED", "Unknown runtime state must also express unknown side-effect knowledge");
  }
  if (execution.state === "UNKNOWN" && input.to_state !== "UNKNOWN") {
    if (!input.resolution_evidence_refs?.length ||
        !input.resolution_evidence_refs.every((ref) =>
          isObjectRef(ref) && sameScopeRef(ref.scope_ref, context.scope_ref))) {
      return rejected(context, "OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED", "Resolving UNKNOWN requires scoped authoritative evidence");
    }
    if (input.last_reconciliation_ref &&
        !isRefKind(input.last_reconciliation_ref, "EXECUTION_RECONCILIATION")) {
      return rejected(context, "VALIDATION_ERROR", "Reconciliation reference has the wrong object kind");
    }
    if (input.to_state === "CANCELLED" && termination !== "CONFIRMED_TERMINATED") {
      return rejected(context, "OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED", "UNKNOWN can become CANCELLED only with confirmed termination");
    }
  }

  const refs = [
    ...(input.error_refs ?? []),
    ...(input.resolution_evidence_refs ?? []),
    ...(input.last_reconciliation_ref ? [input.last_reconciliation_ref] : []),
    ...(input.audit_ref ? [input.audit_ref] : []),
  ];
  if (!hasSameScope(refs, context.scope_ref)) {
    return rejected(context, "FORBIDDEN", "Transition evidence and diagnostics must match the authenticated scope");
  }

  const effectKnowledge =
    input.effect_knowledge ??
    (input.to_state === "UNKNOWN" && hasStarted ? "UNKNOWN" : execution.effect_knowledge);
  const updated: ExecutionRecord = {
    ...execution,
    state: input.to_state,
    state_version: execution.state_version + 1,
    effect_knowledge: effectKnowledge,
    output_completeness: input.output_completeness ?? execution.output_completeness,
    termination_knowledge: termination,
    error_refs: input.error_refs ? [...execution.error_refs, ...input.error_refs] : execution.error_refs,
    ...(input.to_state === "UNKNOWN" && input.last_reconciliation_ref
      ? { last_reconciliation_ref: input.last_reconciliation_ref }
      : {}),
    ...(input.last_reconciliation_ref ? { last_reconciliation_ref: input.last_reconciliation_ref } : {}),
    ...(input.audit_ref ? { audit_ref: input.audit_ref } : {}),
    ...(["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"].includes(input.to_state)
      ? { ended_at: input.changed_at }
      : {}),
  };
  return succeeded(context, updated, String(updated.state_version));
}

export interface RequestCancellationInput {
  cancellation_ref: ObjectRef;
  expected_state_version: RevisionNumber;
  requested_at: Timestamp;
  reason_ref?: ObjectRef;
}

export function requestExecutionCancellation(
  context: RequestContext,
  execution: ExecutionRecord,
  input: RequestCancellationInput,
): OperationResult<{ execution: ExecutionRecord; cancellation: CancellationOperation }> {
  if (!isRefKind(input.cancellation_ref, "EXECUTION_CANCELLATION") ||
      !sameScopeRef(input.cancellation_ref.scope_ref, context.scope_ref) ||
      !isTimestamp(input.requested_at) ||
      (input.reason_ref !== undefined &&
        (!isObjectRef(input.reason_ref) || !sameScopeRef(input.reason_ref.scope_ref, context.scope_ref)))) {
    return rejected(context, "VALIDATION_ERROR", "Cancellation identity, reason or timestamp is invalid");
  }
  if (execution.state_version !== input.expected_state_version) {
    return rejected(context, "VERSION_CONFLICT", "Execution changed before cancellation was requested");
  }
  if (!["CREATED", "QUEUED", "RUNNING"].includes(execution.state)) {
    return rejected(context, "VALIDATION_ERROR", "Execution cannot accept cancellation in its current state");
  }

  const beforeStart = execution.state === "CREATED" || execution.state === "QUEUED";
  const transition = transitionExecution(context, execution, {
    expected_state_version: input.expected_state_version,
    to_state: beforeStart ? "CANCELLED" : "CANCELLATION_REQUESTED",
    changed_at: input.requested_at,
    termination_knowledge: beforeStart ? "NOT_REQUESTED" : "REQUESTED",
  });
  if (transition.status !== "OK" || !transition.data) {
    const issue = transition.errors[0];
    return rejected(context, issue?.code ?? "VALIDATION_ERROR", issue?.safe_message ?? "Cancellation transition failed");
  }
  const cancellation: CancellationOperation = {
    cancellation_ref: input.cancellation_ref,
    execution_ref: execution.execution_ref,
    requested_by: context.actor_ref,
    ...(input.reason_ref ? { reason_ref: input.reason_ref } : {}),
    requested_at: input.requested_at,
    termination_knowledge: beforeStart ? "NOT_REQUESTED" : "REQUESTED",
    ...(beforeStart ? { completed_at: input.requested_at } : {}),
    error_refs: [],
  };
  return succeeded(context, { execution: transition.data, cancellation }, String(transition.data.state_version));
}

export function createResourceMeasurement(
  context: RequestContext,
  execution: ExecutionRecord,
  attempt: ExecutionAttempt,
  input: Omit<ResourceMeasurement, "execution_ref" | "attempt_ref">,
): OperationResult<ResourceMeasurement> {
  if (!sameScopeRef(execution.scope_ref, context.scope_ref) ||
      !sameObjectRef(attempt.execution_ref, execution.execution_ref) ||
      !execution.attempt_refs.some((ref) => sameObjectRef(ref, attempt.attempt_ref))) {
    return rejected(context, "FORBIDDEN", "Measurement must reference an attempt in the scoped Execution");
  }
  if (!isRefKind(input.measurement_ref, "RESOURCE_MEASUREMENT") ||
      !sameScopeRef(input.measurement_ref.scope_ref, context.scope_ref) ||
      !USAGE_MEASUREMENT_KINDS.includes(input.kind) ||
      !MEASUREMENT_QUALITIES.includes(input.confidence) ||
      !Number.isFinite(input.value) || input.value < 0 ||
      !input.unit.trim() || !input.measurement_source.trim() ||
      !isTimestamp(input.measured_at) ||
      (input.source_digest !== undefined && !isVersion(input.source_digest))) {
    return rejected(context, "VALIDATION_ERROR", "Resource measurement identity, quantity, quality or provenance is invalid");
  }
  const measurement: ResourceMeasurement = {
    ...input,
    execution_ref: execution.execution_ref,
    attempt_ref: attempt.attempt_ref,
  };
  return succeeded(context, measurement);
}

export function createRuntimeCheckpoint(
  context: RequestContext,
  execution: ExecutionRecord,
  attempt: ExecutionAttempt,
  checkpoint: RuntimeCheckpoint,
): OperationResult<RuntimeCheckpoint> {
  if (!sameScopeRef(execution.scope_ref, context.scope_ref) ||
      !sameObjectRef(attempt.execution_ref, execution.execution_ref) ||
      !execution.attempt_refs.some((ref) => sameObjectRef(ref, attempt.attempt_ref))) {
    return rejected(context, "FORBIDDEN", "Checkpoint must reference an attempt in the scoped Execution");
  }
  if (!isRefKind(checkpoint.checkpoint_ref, "RUNTIME_CHECKPOINT") ||
      !isRefKind(checkpoint.resumability_contract_ref, "RESUMABILITY_CONTRACT") ||
      !sameScopeRef(checkpoint.checkpoint_ref.scope_ref, context.scope_ref) ||
      !sameScopeRef(checkpoint.resumability_contract_ref.scope_ref, context.scope_ref) ||
      !sameObjectRef(checkpoint.execution_ref, execution.execution_ref) ||
      !sameObjectRef(checkpoint.attempt_ref, attempt.attempt_ref) ||
      !sameObjectRef(checkpoint.runtime_profile_ref, execution.runtime_profile_ref) ||
      checkpoint.runtime_profile_version !== execution.runtime_profile_version ||
      !Number.isSafeInteger(checkpoint.checkpoint_version) || checkpoint.checkpoint_version < 1 ||
      !CHECKPOINT_STATES.includes(checkpoint.state) ||
      !isTimestamp(checkpoint.created_at) ||
      (checkpoint.expires_at !== undefined &&
        (!isTimestamp(checkpoint.expires_at) ||
          Date.parse(checkpoint.expires_at) <= Date.parse(checkpoint.created_at))) ||
      (checkpoint.state === "AVAILABLE" && !isVersion(checkpoint.snapshot_digest))) {
    return rejected(context, "VALIDATION_ERROR", "Checkpoint identity, integrity or resumability contract is invalid");
  }
  return succeeded(context, checkpoint, String(checkpoint.checkpoint_version));
}

export function createReconciliationRecord(
  context: RequestContext,
  execution: ExecutionRecord,
  input: ReconciliationRecord,
): OperationResult<ReconciliationRecord> {
  if (!sameScopeRef(execution.scope_ref, context.scope_ref) ||
      !sameObjectRef(input.execution_ref, execution.execution_ref)) {
    return rejected(context, "FORBIDDEN", "Reconciliation must target the scoped Execution");
  }
  const refs = [
    input.reconciliation_ref,
    input.method_ref,
    ...input.evidence_refs,
    ...(input.attempt_ref ? [input.attempt_ref] : []),
  ];
  if (!isRefKind(input.reconciliation_ref, "EXECUTION_RECONCILIATION") ||
      !isPrincipalRef(input.assessed_by) ||
      !samePrincipal(input.assessed_by, context.actor_ref) ||
      !refs.every((ref) => isObjectRef(ref) && sameScopeRef(ref.scope_ref, context.scope_ref)) ||
      !isTimestamp(input.assessed_at) ||
      !input.evidence_refs.length ||
      !input.limitations.every((item) => typeof item === "string") ||
      !EXECUTION_STATES.includes(input.prior_state) ||
      !EXECUTION_STATES.includes(input.resulting_state) ||
      !EFFECT_KNOWLEDGE.includes(input.prior_effect_knowledge) ||
      !EFFECT_KNOWLEDGE.includes(input.resulting_effect_knowledge)) {
    return rejected(context, "VALIDATION_ERROR", "Reconciliation evidence, assessor, states or scope is invalid");
  }
  if (execution.state !== input.prior_state ||
      execution.effect_knowledge !== input.prior_effect_knowledge) {
    return rejected(context, "VERSION_CONFLICT", "Reconciliation no longer matches the current Execution facts");
  }
  return succeeded(context, input);
}

export function createExecutionEvent<T>(
  context: RequestContext,
  execution: ExecutionRecord,
  input: {
    event_id: string;
    event_type: ExecutionEventType;
    schema_version: RevisionNumber;
    occurred_at: Timestamp;
    causation_id?: string;
    payload: T;
  },
): OperationResult<DomainEventEnvelope<T>> {
  if (!sameScopeRef(execution.scope_ref, context.scope_ref) ||
      !sameScopeRef(execution.execution_ref.scope_ref, context.scope_ref)) {
    return rejected(context, "FORBIDDEN", "Execution event is outside the authenticated scope");
  }
  if (!isVersion(input.event_id) ||
      !isTimestamp(input.occurred_at) ||
      !Number.isSafeInteger(input.schema_version) || input.schema_version < 1 ||
      (input.causation_id !== undefined && !isVersion(input.causation_id))) {
    return rejected(context, "VALIDATION_ERROR", "Execution event envelope is invalid");
  }
  const event: DomainEventEnvelope<T> = {
    event_id: input.event_id,
    event_type: input.event_type,
    schema_version: input.schema_version,
    occurred_at: input.occurred_at,
    producer_engine: "INV-05",
    object_ref: execution.execution_ref,
    scope_ref: execution.scope_ref,
    correlation_id: context.correlation_id,
    actor_ref: context.actor_ref,
    ...(input.causation_id ? { causation_id: input.causation_id } : {}),
    payload: input.payload,
  };
  return succeeded(context, event, String(event.schema_version));
}
