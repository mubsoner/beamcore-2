import {
  createOperationError,
  createOperationResult,
  isObjectRef,
  isRequestContext,
  isTimestamp,
  sameObjectRef,
  sameScopeRef,
  type ClockPort,
  type EngineUnitOfWorkPort,
  type IdempotencyRecord,
  type ObjectRef,
  type OperationErrorCode,
  type OperationResult,
  type RequestContext,
  type Timestamp,
} from "../shared";
import {
  createExecutionEvent,
  createExecutionRecord,
  validateExecutionRequest,
  type ExecutionRecord,
  validateTrustedRuntimeAssurance,
  type ExecutionRequest,
  type RuntimeAdmission,
  type RuntimeProfile,
  type TrustedRuntimeAssurance,
} from "./domain";
import type { DispatchAttempt } from "../inv-04-orchestration/domain";

export interface ExecutionAdmissionSnapshot {
  checked_at: Timestamp;
  authorization: {
    decision_ref: ObjectRef;
    disposition: "ALLOWED" | "DENIED" | "REQUIRES_APPROVAL" | "UNKNOWN";
    current: boolean;
    valid_until: Timestamp;
  };
  capability: {
    capability_ref: ObjectRef;
    version: string;
    eligible: boolean;
    current: boolean;
  };
  resource: {
    admission_ref: ObjectRef;
    state: RuntimeAdmission;
    current: boolean;
  };
  environment: {
    environment_ref: ObjectRef;
    permitted: boolean;
    current: boolean;
  };
}

/**
 * Trusted read boundary over INV-06, INV-07, INV-19 and INV-21.
 * Implementations must retrieve authoritative current facts; request payload
 * flags are not accepted as substitutes for these reads.
 */
export interface ExecutionAdmissionReaderPort {
  /** Read the authoritative INV-05-owned profile by exact versioned reference. */
  readRuntimeProfile(
    context: RequestContext,
    profile_ref: ObjectRef,
  ): Promise<OperationResult<RuntimeProfile>>;
  /** Read the authoritative INV-04 dispatch record; do not trust a caller-built copy. */
  readDispatchAttempt(
    context: RequestContext,
    dispatch_ref: ObjectRef,
  ): Promise<OperationResult<DispatchAttempt>>;
  readCurrentAdmission(
    context: RequestContext,
    request: ExecutionRequest,
    checked_at: Timestamp,
  ): Promise<OperationResult<ExecutionAdmissionSnapshot>>;
  /**
   * Must be backed by a trusted attestation verifier, not caller-supplied
   * readiness booleans. Required for UNTRUSTED_GENERATED_CODE.
   */
  readTrustedRuntimeAssurance?(
    context: RequestContext,
    profile: RuntimeProfile,
    checked_at: Timestamp,
  ): Promise<OperationResult<TrustedRuntimeAssurance>>;
}

export interface SubmitExecutionCommand {
  context: RequestContext;
  request: ExecutionRequest;
  execution_event_ref: ObjectRef;
  created_at: Timestamp;
}

function rejected<T>(
  context: RequestContext,
  code: OperationErrorCode,
  safe_message: string,
): OperationResult<T> {
  return createOperationResult({
    status: "REJECTED",
    correlation_id: context?.correlation_id ?? "unknown",
    errors: [createOperationError(code, safe_message, false)],
  });
}

function propagateFailure<T>(source: OperationResult<unknown>): OperationResult<T> {
  const unexpectedSuccess = source.status === "OK";
  return createOperationResult<T>({
    status: unexpectedSuccess ? "UNKNOWN" : source.status,
    correlation_id: source.correlation_id,
    errors: unexpectedSuccess
      ? [createOperationError(
          "INTERNAL_ERROR",
          "A dependency returned success without the required execution record",
          false,
        )]
      : source.errors,
    warnings: source.warnings,
    ...(source.object_version !== undefined ? { object_version: source.object_version } : {}),
  });
}

function sameExactObjectRef(a: ObjectRef, b: ObjectRef): boolean {
  return sameObjectRef(a, b) && a.object_version === b.object_version;
}

function validateCreatedDispatchBinding(
  context: RequestContext,
  request: ExecutionRequest,
  dispatch: DispatchAttempt,
): OperationResult<void> {
  const refs: Array<[ObjectRef, string]> = [
    [dispatch.dispatch_ref, "DISPATCH_ATTEMPT"],
    [dispatch.orchestration_ref, "ORCHESTRATION_RUN"],
    [dispatch.node_coordination_ref, "NODE_COORDINATION"],
    [dispatch.work_ref, "WORK"],
    [dispatch.graph_revision_ref, "WORK_GRAPH_REVISION"],
    [dispatch.graph_node_ref, "GRAPH_NODE"],
    [dispatch.target_capability_ref, "CAPABILITY"],
    [dispatch.authorization_decision_ref, "AUTHORITY_DECISION"],
    [dispatch.resource_admission_ref, "RESOURCE_ADMISSION"],
  ];
  if (refs.some(([ref, kind]) =>
      !isObjectRef(ref) ||
      ref.object_kind !== kind ||
      !sameScopeRef(ref.scope_ref, context.scope_ref))) {
    return rejected(context, "FORBIDDEN", "Authoritative dispatch references must use canonical kinds and the authenticated scope");
  }
  if (
    !sameExactObjectRef(dispatch.dispatch_ref, request.dispatch_ref) ||
    !sameExactObjectRef(dispatch.orchestration_ref, request.orchestration_run_ref) ||
    !sameExactObjectRef(dispatch.work_ref, request.work_ref) ||
    !sameExactObjectRef(dispatch.graph_revision_ref, request.graph_revision_ref) ||
    !sameExactObjectRef(dispatch.graph_node_ref, request.graph_node_ref) ||
    !sameExactObjectRef(dispatch.target_capability_ref, request.capability_ref) ||
    dispatch.target_capability_version !== request.capability_version ||
    !sameExactObjectRef(dispatch.authorization_decision_ref, request.authorization_decision_ref)
  ) {
    return rejected(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Execution request does not match the exact references and versions of the authoritative INV-04 dispatch");
  }
  if (
    dispatch.state !== "CREATED" ||
    dispatch.execution_ref !== undefined ||
    !Number.isSafeInteger(dispatch.attempt_number) ||
    dispatch.attempt_number < 1 ||
    dispatch.idempotency_key !== request.idempotency_key ||
    dispatch.idempotency_key !== context.idempotency_key ||
    dispatch.request_correlation_id !== context.correlation_id
  ) {
    return rejected(context, "VALIDATION_ERROR", "Dispatch must be an unconsumed CREATED attempt bound to this idempotency key and request correlation");
  }
  return createOperationResult({
    status: "OK",
    correlation_id: context.correlation_id,
  });
}

function validateSubmissionEnvelope(command: SubmitExecutionCommand): string | undefined {
  if (!command || typeof command !== "object" || !command.request || typeof command.request !== "object" ||
      !isObjectRef(command.request.execution_ref)) {
    return "Execution submission requires a complete request envelope";
  }
  if (!isRequestContext(command.context) || !command.context.idempotency_key?.trim()) {
    return "Execution submission requires a valid authenticated request context and idempotency key";
  }
  if (!isTimestamp(command.created_at)) {
    return "Execution creation timestamp must be a valid offset-aware timestamp";
  }
  if (
    !isObjectRef(command.request.dispatch_ref) ||
    command.request.dispatch_ref.object_kind !== "DISPATCH_ATTEMPT" ||
    !sameScopeRef(command.request.dispatch_ref.scope_ref, command.context.scope_ref)
  ) {
    return "Execution submission requires an in-scope INV-04 dispatch reference";
  }
  if (
    !isObjectRef(command.execution_event_ref) ||
    command.execution_event_ref.object_kind !== "DOMAIN_EVENT" ||
    !sameScopeRef(command.execution_event_ref.scope_ref, command.context.scope_ref)
  ) {
    return "Execution submission requires an in-scope DOMAIN_EVENT reference";
  }
  return undefined;
}

/**
 * Checks fresh, source-owned admission facts immediately before persisting an
 * accepted Execution. It does not create authorization, capability, resource,
 * or deployment decisions and it does not start a process.
 */
export function validateExecutionAdmission(
  context: RequestContext,
  request: ExecutionRequest,
  snapshot: ExecutionAdmissionSnapshot,
  now: Timestamp,
): OperationResult<void> {
  if (!isRequestContext(context) || !isTimestamp(now) || !snapshot ||
      typeof snapshot !== "object" || !snapshot.authorization || !snapshot.capability ||
      !snapshot.resource || !snapshot.environment || !isTimestamp(snapshot.checked_at)) {
    return rejected(context, "VALIDATION_ERROR", "A valid context, clock value and admission snapshot are required");
  }
  if (Date.parse(snapshot.checked_at) > Date.parse(now)) {
    return rejected(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Admission snapshot is dated in the future");
  }

  const requiredRefs: Array<[ObjectRef, string]> = [
    [snapshot.authorization.decision_ref, "AUTHORITY_DECISION"],
    [snapshot.capability.capability_ref, "CAPABILITY"],
    [snapshot.resource.admission_ref, "RESOURCE_ADMISSION"],
  ];
  if (
    requiredRefs.some(([ref, kind]) => !isObjectRef(ref) || ref.object_kind !== kind) ||
    !isObjectRef(snapshot.environment.environment_ref) ||
    !requiredRefs.every(([ref]) => sameScopeRef(ref.scope_ref, context.scope_ref)) ||
    !sameScopeRef(snapshot.environment.environment_ref.scope_ref, context.scope_ref) ||
    !sameExactObjectRef(snapshot.authorization.decision_ref, request.authorization_decision_ref) ||
    !sameExactObjectRef(snapshot.capability.capability_ref, request.capability_ref) ||
    snapshot.capability.version !== request.capability_version
  ) {
    return rejected(context, "FORBIDDEN", "Admission evidence must bind exact in-scope authorization, capability and environment references");
  }
  if (!snapshot.authorization.current ||
      snapshot.authorization.disposition !== "ALLOWED" ||
      !isTimestamp(snapshot.authorization.valid_until) ||
      Date.parse(snapshot.authorization.valid_until) <= Date.parse(now)) {
    const code: OperationErrorCode =
      snapshot.authorization.disposition === "REQUIRES_APPROVAL"
        ? "APPROVAL_REQUIRED"
        : "FORBIDDEN";
    return rejected(context, code, "Current action-time authorization is absent, expired, or not ALLOWED");
  }
  if (!snapshot.capability.current || !snapshot.capability.eligible) {
    return rejected(context, "CAPABILITY_UNAVAILABLE", "The exact capability version is not currently eligible");
  }
  if (!snapshot.resource.current || snapshot.resource.state !== "ADMITTED") {
    return rejected(context, "RESOURCE_LIMIT", "Current resource admission is not ADMITTED");
  }
  if (!snapshot.environment.current || !snapshot.environment.permitted) {
    return rejected(context, "POLICY_DENIED", "The target execution environment is not currently permitted");
  }
  return createOperationResult({
    status: "OK",
    correlation_id: context.correlation_id,
  });
}

async function persistExecution(
  unitOfWork: EngineUnitOfWorkPort,
  command: SubmitExecutionCommand,
  execution: ExecutionRecord,
): Promise<OperationResult<ExecutionRecord>> {
  return unitOfWork.execute(command.context, async (transaction) => {
    const idempotencyKey = command.context.idempotency_key!;
    const prior = await transaction.idempotency.get<ExecutionRecord>(command.context, idempotencyKey);
    if (prior.status !== "OK") return propagateFailure<ExecutionRecord>(prior);
    if (prior.data) {
      if (prior.data.request_fingerprint !== execution.request_digest) {
        return rejected(
          command.context,
          "IDEMPOTENCY_CONFLICT",
          "Execution idempotency key was already used with a different request digest",
        );
      }
      return prior.data.result;
    }

    const saved = await transaction.repository<ExecutionRecord>("inv-05.executions")
      .create(command.context, execution.execution_ref, execution);
    if (saved.status !== "OK" || !saved.data) return propagateFailure<ExecutionRecord>(saved);
    if (!sameExactObjectRef(saved.data.execution_ref, execution.execution_ref) || !saved.object_version) {
      return rejected(
        command.context,
        "INTEGRITY_OR_UNTRUSTED_INPUT",
        "Execution repository did not confirm the persisted identity and version",
      );
    }

    const eventResult = createExecutionEvent(command.context, saved.data, {
      event_id: command.execution_event_ref.object_id,
      event_type: "execution.accepted",
      schema_version: 1,
      occurred_at: command.created_at,
      payload: {
        execution_ref: saved.data.execution_ref,
        dispatch_ref: saved.data.dispatch_ref,
        runtime_profile_ref: saved.data.runtime_profile_ref,
        runtime_profile_version: saved.data.runtime_profile_version,
        request_digest: saved.data.request_digest,
      },
    });
    if (eventResult.status !== "OK" || !eventResult.data) return propagateFailure<ExecutionRecord>(eventResult);
    const emitted = await transaction.outbox.append(command.context, eventResult.data);
    if (emitted.status !== "OK" || emitted.data?.event_id !== command.execution_event_ref.object_id) {
      return propagateFailure<ExecutionRecord>(emitted);
    }

    const result = createOperationResult({
      status: "OK",
      correlation_id: command.context.correlation_id,
      data: saved.data,
      object_version: saved.object_version,
      warnings: saved.warnings,
    });
    const recorded = await transaction.idempotency.record(command.context, {
      idempotency_key: idempotencyKey,
      request_fingerprint: execution.request_digest,
      result,
      recorded_at: command.created_at,
    } satisfies IdempotencyRecord<ExecutionRecord>);
    if (recorded.status !== "OK") return propagateFailure<ExecutionRecord>(recorded);
    return result;
  });
}

/**
 * Persists a version-pinned Execution and its accepted event atomically.
 * It does not place work on a queue or start a runtime. A runtime adapter
 * remains separately gated on the approved isolation and enforcement binding.
 */
export async function submitExecution(
  unitOfWork: EngineUnitOfWorkPort,
  admissionReader: ExecutionAdmissionReaderPort,
  clock: ClockPort,
  command: SubmitExecutionCommand,
): Promise<OperationResult<ExecutionRecord>> {
  const envelopeIssue = validateSubmissionEnvelope(command);
  if (envelopeIssue) return rejected(command.context, "VALIDATION_ERROR", envelopeIssue);

  const now = clock.now();
  if (!isTimestamp(now)) {
    return rejected(command.context, "INTERNAL_ERROR", "Execution clock returned an invalid timestamp");
  }
  if (command.request.deadline && Date.parse(command.request.deadline) <= Date.parse(now)) {
    return rejected(command.context, "TIMEOUT", "Execution deadline elapsed before submission");
  }
  if (
    !isObjectRef(command.request.runtime_profile?.profile_ref) ||
    command.request.runtime_profile.profile_ref.object_kind !== "RUNTIME_PROFILE" ||
    !sameScopeRef(command.request.runtime_profile.profile_ref.scope_ref, command.context.scope_ref) ||
    typeof command.request.runtime_profile.profile_version !== "string" ||
    !command.request.runtime_profile.profile_version.trim()
  ) {
    return rejected(command.context, "VALIDATION_ERROR", "Execution must identify an in-scope versioned INV-05 runtime profile");
  }

  let authoritativeProfileResult: OperationResult<RuntimeProfile>;
  try {
    authoritativeProfileResult = await admissionReader.readRuntimeProfile(
      command.context,
      command.request.runtime_profile.profile_ref,
    );
  } catch {
    return rejected(command.context, "DEPENDENCY_UNAVAILABLE", "The authoritative INV-05 runtime profile could not be read");
  }
  if (authoritativeProfileResult.status !== "OK" || !authoritativeProfileResult.data) {
    return propagateFailure<ExecutionRecord>(authoritativeProfileResult);
  }
  const authoritativeProfile = authoritativeProfileResult.data;
  if (
    !sameExactObjectRef(authoritativeProfile.profile_ref, command.request.runtime_profile.profile_ref) ||
    authoritativeProfile.profile_version !== command.request.runtime_profile.profile_version
  ) {
    return rejected(command.context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Caller profile locator does not match the exact authoritative INV-05 profile version");
  }
  const trustedRequest: ExecutionRequest = {
    ...command.request,
    runtime_profile: authoritativeProfile,
  };

  let dispatchResult: OperationResult<DispatchAttempt>;
  try {
    dispatchResult = await admissionReader.readDispatchAttempt(
      command.context,
      trustedRequest.dispatch_ref,
    );
  } catch {
    return rejected(command.context, "DEPENDENCY_UNAVAILABLE", "The authoritative INV-04 dispatch could not be read");
  }
  if (dispatchResult.status !== "OK" || !dispatchResult.data) {
    return propagateFailure<ExecutionRecord>(dispatchResult);
  }
  const dispatchValidation = validateCreatedDispatchBinding(
    command.context,
    trustedRequest,
    dispatchResult.data,
  );
  if (dispatchValidation.status !== "OK") {
    return propagateFailure<ExecutionRecord>(dispatchValidation);
  }

  const requestValidation = validateExecutionRequest(command.context, trustedRequest);
  if (requestValidation.status !== "OK") return propagateFailure<ExecutionRecord>(requestValidation);

  let admission: OperationResult<ExecutionAdmissionSnapshot>;
  try {
    admission = await admissionReader.readCurrentAdmission(command.context, trustedRequest, now);
  } catch {
    return rejected(command.context, "DEPENDENCY_UNAVAILABLE", "Current admission evidence could not be read");
  }
  if (admission.status !== "OK" || !admission.data) return propagateFailure<ExecutionRecord>(admission);

  const admissionValidation = validateExecutionAdmission(
    command.context,
    trustedRequest,
    admission.data,
    now,
  );
  if (admissionValidation.status !== "OK") {
    return propagateFailure<ExecutionRecord>(admissionValidation);
  }
  if (!sameExactObjectRef(
        dispatchResult.data.resource_admission_ref,
        admission.data.resource.admission_ref,
      ) ||
      !sameExactObjectRef(
        dispatchResult.data.authorization_decision_ref,
        admission.data.authorization.decision_ref,
      )) {
    return rejected(command.context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Current authorization and resource admission do not match the exact decisions bound to the INV-04 dispatch");
  }

  if (trustedRequest.runtime_profile.trust_class === "UNTRUSTED_GENERATED_CODE") {
    if (!admissionReader.readTrustedRuntimeAssurance) {
      return rejected(
        command.context,
        "POLICY_DENIED",
        "Untrusted generated code is hard-disabled until a trusted runtime-attestation verifier is configured",
      );
    }
    let assurance: OperationResult<TrustedRuntimeAssurance>;
    try {
      assurance = await admissionReader.readTrustedRuntimeAssurance(
        command.context,
        trustedRequest.runtime_profile,
        now,
      );
    } catch {
      return rejected(command.context, "DEPENDENCY_UNAVAILABLE", "Trusted runtime assurance could not be verified");
    }
    if (assurance.status !== "OK" || !assurance.data) {
      return propagateFailure<ExecutionRecord>(assurance);
    }
    const assuranceValidation = validateTrustedRuntimeAssurance(
      command.context,
      trustedRequest.runtime_profile,
      assurance.data,
      now,
    );
    if (assuranceValidation.status !== "OK") {
      return propagateFailure<ExecutionRecord>(assuranceValidation);
    }
  }

  const execution = createExecutionRecord(command.context, trustedRequest, command.created_at);
  if (execution.status !== "OK" || !execution.data) return propagateFailure<ExecutionRecord>(execution);

  try {
    return await persistExecution(unitOfWork, command, execution.data);
  } catch {
    return rejected(
      command.context,
      "INTERNAL_ERROR",
      "Execution persistence failed; the caller must reconcile using the same idempotency key",
    );
  }
}
