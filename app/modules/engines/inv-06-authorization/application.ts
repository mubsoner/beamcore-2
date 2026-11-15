import {
  createOperationError,
  createOperationResult,
  isRequestContext,
  sameObjectRef,
  sameScopeRef,
  type ClockPort,
  type ObjectRef,
  type OperationResult,
  type PrincipalRef,
  type RequestContext,
  type Timestamp,
  type Version,
} from "../shared";
import {
  buildAuthorityFingerprintMaterial,
  buildCanonicalRequestFingerprint,
  createPendingApproval,
  createSafeDecisionExplanation,
  decideApproval,
  evaluateAuthorizationDecision,
  transitionApproval,
  transitionDelegation,
  transitionPolicyRelease,
  validateApprovalUse,
  validateAuthenticationRequest,
  validateAuthenticationResult,
  validateAuthorizationRequest,
  validateAuthorityFacts,
  validateDelegationRequest,
  validatePolicyEvaluation,
  validatePrincipalContext,
  type ApprovalDecisionInput,
  type ApprovalRecord,
  type AuthenticationRequest,
  type AuthenticationResult,
  type AuthorityRevocationRequest,
  type AuthorityFacts,
  type AuthorizationDecision,
  type AuthorizationRequest,
  type DelegationGrantAuthority,
  type DelegationRecord,
  type DelegationRequest,
  type PolicyEvaluation,
  type PolicyEvaluationAudit,
  type PolicyRelease,
  type PolicyReleaseOperationContext,
  type PolicyReleaseState,
  type RevocationRecord,
  type PrincipalContext,
  type SafeDecisionExplanation,
} from "./domain";

export interface AuthorizationIdPort {
  next(kind: string, scope_ref: RequestContext["scope_ref"]): string;
}

export interface AuthorizationSourcePort {
  resolvePrincipal(context: RequestContext): Promise<OperationResult<PrincipalContext>>;
  readAuthorityFacts(context: RequestContext, request: AuthorizationRequest): Promise<OperationResult<AuthorityFacts>>;
  evaluatePolicy(context: RequestContext, request: AuthorizationRequest, principal: PrincipalContext, facts: AuthorityFacts): Promise<OperationResult<PolicyEvaluation>>;
  readApproval(context: RequestContext, ref: ObjectRef): Promise<OperationResult<ApprovalRecord>>;
  readDelegation(context: RequestContext, ref: ObjectRef): Promise<OperationResult<DelegationRecord>>;
  /** Verify the approver's current permission and independence against live membership and policy sources. */
  verifyApprover(context: RequestContext, approval: ApprovalRecord, approver: PrincipalRef): Promise<OperationResult<{ authorized: boolean; independent_required: boolean }>>;
  /** Resolve grantor powers from authoritative identity, membership, policy and delegation sources. */
  resolveDelegationGrantAuthority(context: RequestContext, request: DelegationRequest): Promise<OperationResult<DelegationGrantAuthority>>;
  /** Verify the cited decision is current, ALLOW, exact-request-bound and sufficient for this grant. */
  verifyDelegationDecision(context: RequestContext, request: DelegationRequest): Promise<OperationResult<{ valid: boolean }>>;
  /** Check the caller's current authority to suspend or revoke this delegation. */
  verifyDelegationRevoker(context: RequestContext, delegation: DelegationRecord): Promise<OperationResult<{ authorized: boolean }>>;
  verifyDelegationLifecycleOperator(context: RequestContext, delegation: DelegationRecord, targetState: DelegationRecord["state"]): Promise<OperationResult<{ authorized: boolean }>>;
  verifyApprovalRevoker(context: RequestContext, approval: ApprovalRecord): Promise<OperationResult<{ authorized: boolean }>>;
  verifyApprovalLifecycleOperator(context: RequestContext, approval: ApprovalRecord, targetState: ApprovalRecord["state"]): Promise<OperationResult<{ authorized: boolean }>>;
  authenticatePrincipal(context: RequestContext, request: AuthenticationRequest): Promise<OperationResult<AuthenticationResult>>;
  /** Must check current source authority, including membership, scope and revoker permission. */
  verifyAuthorityRevoker(context: RequestContext, request: AuthorityRevocationRequest): Promise<OperationResult<{ authorized: boolean; source_version?: Version }>>;
  readPolicyRelease(context: RequestContext, ref: ObjectRef): Promise<OperationResult<PolicyRelease>>;
  verifyPolicyReleaseOperator(context: RequestContext, release: PolicyRelease, targetState: PolicyReleaseState, operation: PolicyReleaseOperationContext): Promise<OperationResult<{ authorized: boolean }>>;
}

export interface ApprovalClaimCommand {
  approval_ref: ObjectRef;
  authorization_request_ref: ObjectRef;
  expected_version: Version;
  idempotency_key: string;
  claimed_at: Timestamp;
}

export interface DecisionCommitCommand {
  idempotency_key: string;
  request_fingerprint: string;
  /** When present, approval consumption MUST commit atomically with decision, audit and local Outbox append. */
  approval_claim?: ApprovalClaimCommand;
}

export interface AuthorizationRepositoryPort {
  /**
   * One database transaction must persist the immutable decision, audit, idempotency
   * result and Outbox event. If approval_claim is supplied, compare-and-set the
   * ONE_TIME approval for this exact request in the same transaction or commit none.
   */
  commitDecision(
    context: RequestContext,
    decision: AuthorizationDecision,
    audit: PolicyEvaluationAudit,
    command: DecisionCommitCommand,
  ): Promise<OperationResult<AuthorizationDecision>>;
  /** Persist approval plus its Outbox event and idempotency result atomically. */
  createApprovalWithEvent(
    context: RequestContext,
    approval: ApprovalRecord,
    idempotency: { key: string; request_fingerprint: string },
  ): Promise<OperationResult<ApprovalRecord>>;
  /** Compare-and-set approval state and append its event atomically. */
  updateApprovalWithEvent(
    context: RequestContext,
    approval: ApprovalRecord,
    expectedVersion: Version,
    idempotency: { key: string; request_fingerprint: string },
  ): Promise<OperationResult<ApprovalRecord>>;
  /** Compare-and-set delegation state and append its event atomically. */
  createDelegationWithEvent(
    context: RequestContext,
    delegation: DelegationRecord,
    idempotency: { key: string; request_fingerprint: string },
  ): Promise<OperationResult<DelegationRecord>>;
  updateDelegationWithEvent(
    context: RequestContext,
    delegation: DelegationRecord,
    expectedVersion: Version,
    idempotency: { key: string; request_fingerprint: string },
  ): Promise<OperationResult<DelegationRecord>>;
  /** Access-filtered read: cross-scope records must be indistinguishable from not-found. */
  readDecision(context: RequestContext, decisionRef: ObjectRef): Promise<OperationResult<AuthorizationDecision>>;
  /** Commit immutable revocation record and authority.revoked Outbox event atomically. */
  createRevocationWithEvent(
    context: RequestContext,
    revocation: RevocationRecord,
    idempotency: { key: string; request_fingerprint: string },
  ): Promise<OperationResult<RevocationRecord>>;
  /** Compare-and-set approval lifecycle, idempotency and corresponding Outbox event atomically. */
  updateApprovalLifecycleWithEvent(
    context: RequestContext,
    approval: ApprovalRecord,
    expectedVersion: Version,
    eventType: string,
    idempotency: { key: string; request_fingerprint: string },
  ): Promise<OperationResult<ApprovalRecord>>;
  /** Compare-and-set policy lifecycle state, idempotency and corresponding Outbox event atomically. */
  updatePolicyReleaseWithEvent(
    context: RequestContext,
    release: PolicyRelease,
    expectedVersion: Version,
    eventType: string,
    idempotency: { key: string; request_fingerprint: string },
    operation: PolicyReleaseOperationContext,
  ): Promise<OperationResult<PolicyRelease>>;
}

export interface AuthorizationDependencies {
  sources: AuthorizationSourcePort;
  repository: AuthorizationRepositoryPort;
  ids: AuthorizationIdPort;
  clock: ClockPort;
}

function fail<T>(
  context: RequestContext,
  code: Parameters<typeof createOperationError>[0],
  message: string,
): OperationResult<T> {
  return createOperationResult({
    status: "REJECTED",
    correlation_id: context.correlation_id,
    errors: [createOperationError(code, message)],
  });
}

function propagate<T>(context: RequestContext, source: OperationResult<unknown>): OperationResult<T> {
  return createOperationResult({
    status: source.status,
    correlation_id: context.correlation_id,
    errors: source.errors,
    warnings: source.warnings,
  });
}

function operationIdempotencyKey(
  context: RequestContext,
  requestKey?: string,
): string | undefined {
  if (context.idempotency_key && requestKey && context.idempotency_key !== requestKey) return undefined;
  return context.idempotency_key ?? requestKey;
}

function samePrincipal(a: PrincipalRef, b: PrincipalRef): boolean {
  return a.principal_id === b.principal_id && a.principal_kind === b.principal_kind;
}

async function authorizeActionCore(
  deps: AuthorizationDependencies,
  context: RequestContext,
  request: AuthorizationRequest,
  enforceActionBoundary: boolean,
): Promise<OperationResult<{ decision: AuthorizationDecision; explanation: SafeDecisionExplanation }>> {
  const requestIssues = validateAuthorizationRequest(context, request);
  if (requestIssues.length) {
    return fail(context, "VALIDATION_ERROR", "Authorization request failed canonical validation");
  }

  const idempotencyKey = operationIdempotencyKey(context, request.idempotency_key);
  if (!idempotencyKey) {
    return fail(context, "IDEMPOTENCY_CONFLICT", "Authorization requires one consistent idempotency key");
  }

  const principalResult = await deps.sources.resolvePrincipal(context);
  if (principalResult.status !== "OK" || !principalResult.data) {
    return fail(context, "UNAUTHENTICATED", "The authenticated principal could not be verified");
  }

  const factsResult = await deps.sources.readAuthorityFacts(context, request);
  if (factsResult.status !== "OK" || !factsResult.data) {
    return fail(context, "DEPENDENCY_UNAVAILABLE", "Current authority facts are unavailable; protected action is blocked");
  }
  const factIssues = validateAuthorityFacts(factsResult.data, request, deps.clock.now());
  if (factIssues.length) {
    return fail(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Authoritative resource and membership facts failed validation");
  }

  const policyResult = await deps.sources.evaluatePolicy(context, request, principalResult.data, factsResult.data);
  if (policyResult.status !== "OK" || !policyResult.data) {
    return fail(context, "DEPENDENCY_UNAVAILABLE", "Current policy could not be evaluated; protected action is blocked");
  }
  const policyIssues = validatePolicyEvaluation(policyResult.data, request);
  if (policyIssues.length) {
    return fail(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Policy evaluator output failed canonical validation");
  }

  let approval: ApprovalRecord | undefined;
  let approvalAuthorityVerified = false;
  if (request.approval_ref) {
    const approvalResult = await deps.sources.readApproval(context, request.approval_ref);
    if (approvalResult.status !== "OK" || !approvalResult.data) {
      return fail(context, "APPROVAL_REQUIRED", "The referenced approval is unavailable or not visible");
    }
    approval = approvalResult.data;
    if (!sameObjectRef(approval.approval_ref, request.approval_ref) ||
        !sameScopeRef(approval.approval_ref.scope_ref, context.scope_ref)) {
      return fail(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Approval source returned a different or out-of-scope record");
    }

    if (approval.state === "APPROVED") {
      if (!approval.approver_ref) {
        approvalAuthorityVerified = false;
      } else {
        const approverResult = await deps.sources.verifyApprover(context, approval, approval.approver_ref);
        if (approverResult.status !== "OK" || !approverResult.data) {
          return fail(context, "DEPENDENCY_UNAVAILABLE", "Current approver authority could not be verified");
        }
        approvalAuthorityVerified =
          approverResult.data.authorized &&
          (!policyResult.data.independent_approver_required || approverResult.data.independent_required) &&
          (!policyResult.data.independent_approver_required ||
            !samePrincipal(approval.approver_ref, approval.requested_by_ref));
      }
    }
  }

  const decisionRef: ObjectRef = {
    object_kind: "AUTHORIZATION_DECISION",
    object_id: deps.ids.next("AUTHORIZATION_DECISION", context.scope_ref),
    object_version: "1",
    scope_ref: context.scope_ref,
  };
  const requestRef: ObjectRef = {
    object_kind: "AUTHORIZATION_REQUEST",
    object_id: request.authorization_request_id,
    object_version: "1",
    scope_ref: context.scope_ref,
  };
  const auditRef: ObjectRef = {
    object_kind: "AUTHORIZATION_AUDIT",
    object_id: deps.ids.next("AUTHORIZATION_AUDIT", context.scope_ref),
    object_version: "1",
    scope_ref: context.scope_ref,
  };

  const fingerprintMaterial = buildAuthorityFingerprintMaterial({
    request,
    principal: principalResult.data,
    facts: factsResult.data,
    policy: policyResult.data,
    approval,
  });
  const fingerprint = await digestSha256(fingerprintMaterial);
  const evaluatedAt = deps.clock.now();
  const evaluated = evaluateAuthorizationDecision({
    context,
    request,
    principal: principalResult.data,
    facts: factsResult.data,
    policy: policyResult.data,
    approval,
    approval_authority_verified: approvalAuthorityVerified,
    decision_ref: decisionRef,
    decision_id: decisionRef.object_id,
    request_ref: requestRef,
    audit_ref: auditRef,
    evaluated_at: evaluatedAt,
    authority_fingerprint: fingerprint,
  });
  if (evaluated.status !== "OK" || !evaluated.data) return propagate(context, evaluated);

  const audit: PolicyEvaluationAudit = {
    audit_ref: auditRef,
    request_ref: requestRef,
    decision_ref: decisionRef,
    actor_ref: request.actor_ref,
    target_ref: request.resource_ref,
    scope_ref: request.scope_ref,
    policy_release_ref: policyResult.data.policy_release.policy_release_ref,
    authority_fingerprint: fingerprint,
    reason_codes: evaluated.data.reason_codes,
    source_version_refs: [
      ...principalResult.data.authority_source_refs.map(source => source.object_ref),
      ...factsResult.data.source_refs.map(source => source.object_ref),
    ],
    evaluated_at: evaluated.data.evaluated_at,
    correlation_id: context.correlation_id,
    ...(request.causation_id ? { causation_id: request.causation_id } : {}),
  };

  let approvalClaim: ApprovalClaimCommand | undefined;
  if (enforceActionBoundary &&
      evaluated.data.result === "ALLOW" &&
      evaluated.data.approval_use_mode === "ONE_TIME") {
    if (!approval || !request.approval_ref ||
        approval.approval_use_mode !== "ONE_TIME" ||
        !approval.approval_ref.object_version) {
      return fail(context, "APPROVAL_REQUIRED", "One-time approval cannot be consumed without its current version");
    }
    approvalClaim = {
      approval_ref: approval.approval_ref,
      authorization_request_ref: requestRef,
      expected_version: approval.approval_ref.object_version,
      idempotency_key: idempotencyKey,
      claimed_at: evaluatedAt,
    };
  }

  const saved = await deps.repository.commitDecision(context, evaluated.data, audit, {
    idempotency_key: idempotencyKey,
    request_fingerprint: buildCanonicalRequestFingerprint(request),
    ...(approvalClaim ? { approval_claim: approvalClaim } : {}),
  });
  if (saved.status !== "OK" || !saved.data) return propagate(context, saved);

  return createOperationResult({
    status: "OK",
    correlation_id: context.correlation_id,
    data: {
      decision: saved.data,
      explanation: createSafeDecisionExplanation(saved.data),
    },
  });
}

/** Evaluate and persist a decision. This operation never executes the requested action. */
export async function authorizeAction(
  deps: AuthorizationDependencies,
  context: RequestContext,
  request: AuthorizationRequest,
): Promise<OperationResult<{ decision: AuthorizationDecision; explanation: SafeDecisionExplanation }>> {
  return authorizeActionCore(deps, context, request, false);
}

/**
 * The protected action boundary always re-resolves principal, membership,
 * entitlement, delegation, policy, resource version and approval. A ONE_TIME
 * approval is atomically consumed with decision/audit/outbox persistence.
 * A caller must still perform the side effect only after this operation returns OK.
 */
export async function recheckAuthorizationAtActionBoundary(
  deps: AuthorizationDependencies,
  context: RequestContext,
  request: AuthorizationRequest,
): Promise<OperationResult<AuthorizationDecision>> {
  const result = await authorizeActionCore(deps, context, request, true);
  if (result.status !== "OK" || !result.data) return propagate(context, result);
  if (result.data.decision.result !== "ALLOW") {
    return fail(
      context,
      result.data.decision.result === "DENY" ? "FORBIDDEN" :
        result.data.decision.result === "REQUIRE_APPROVAL" ? "APPROVAL_REQUIRED" :
          result.data.decision.result === "REQUIRE_REAUTH" ? "UNAUTHENTICATED" : "POLICY_DENIED",
      "Current action-time authorization did not allow this protected action",
    );
  }
  return createOperationResult({
    status: "OK",
    correlation_id: context.correlation_id,
    data: result.data.decision,
  });
}

/** Create an approval only after current policy and authority confirm it is required. */
export async function requestApproval(
  deps: AuthorizationDependencies,
  context: RequestContext,
  request: AuthorizationRequest,
): Promise<OperationResult<ApprovalRecord>> {
  const requestIssues = validateAuthorizationRequest(context, request);
  if (requestIssues.length || request.approval_ref) {
    return fail(context, "VALIDATION_ERROR", "Approval request must be a valid new request without an existing approval reference");
  }
  const idempotencyKey = operationIdempotencyKey(context, request.idempotency_key);
  if (!idempotencyKey) return fail(context, "IDEMPOTENCY_CONFLICT", "Approval request requires one consistent idempotency key");

  const preflight = await authorizeAction(deps, context, request);
  if (preflight.status !== "OK" || !preflight.data) return propagate(context, preflight);
  if (preflight.data.decision.result !== "REQUIRE_APPROVAL") {
    return fail(context, "POLICY_DENIED", "Current authorization policy does not require an approval for this request");
  }

  const principal = await deps.sources.resolvePrincipal(context);
  if (principal.status !== "OK" || !principal.data) return fail(context, "UNAUTHENTICATED", "Requester could not be authenticated");
  const principalIssues = validatePrincipalContext(context, principal.data, deps.clock.now());
  if (principalIssues.length) return fail(context, "UNAUTHENTICATED", "Current requester authentication context is invalid");
  const facts = await deps.sources.readAuthorityFacts(context, request);
  if (facts.status !== "OK" || !facts.data) return fail(context, "DEPENDENCY_UNAVAILABLE", "Current requester authority is unavailable");
  const factIssues = validateAuthorityFacts(facts.data, request, deps.clock.now());
  if (factIssues.length) return fail(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Current requester authority facts failed validation");
  const policy = await deps.sources.evaluatePolicy(context, request, principal.data, facts.data);
  if (policy.status !== "OK" || !policy.data) return fail(context, "DEPENDENCY_UNAVAILABLE", "Current policy could not be evaluated");
  const policyIssues = validatePolicyEvaluation(policy.data, request);
  if (policyIssues.length) return fail(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Policy evaluator output failed validation");
  if (!policy.data.approval_required || !policy.data.approval_use_mode || !policy.data.approval_expires_at) {
    return fail(context, "POLICY_DENIED", "Current policy does not require or define this approval");
  }
  const now = deps.clock.now();
  const expiryBounds = [
    principal.data.valid_until,
    facts.data.valid_until,
    policy.data.valid_until,
    policy.data.policy_release.valid_until,
    request.deadline,
  ].filter((value): value is Timestamp => value !== undefined);
  if (Date.parse(policy.data.approval_expires_at) <= Date.parse(now) ||
      expiryBounds.some(bound => Date.parse(policy.data.approval_expires_at!) > Date.parse(bound))) {
    return fail(context, "POLICY_DENIED", "Policy-derived approval expiry exceeds a current authority, policy or request validity bound");
  }

  const contextRefs = [
    request.work_ref, request.plan_revision_ref, request.graph_revision_ref,
    request.execution_ref, request.capability_ref,
  ].filter((ref): ref is ObjectRef => ref !== undefined);
  const constraints = policy.data.independent_approver_required
    ? ["INDEPENDENT_APPROVER"]
    : [];
  const created = createPendingApproval({
    approval_ref: {
      object_kind: "APPROVAL",
      object_id: deps.ids.next("APPROVAL", context.scope_ref),
      object_version: "1",
      scope_ref: context.scope_ref,
    },
    approval_id: deps.ids.next("APPROVAL_ID", context.scope_ref),
    request_ref: {
      object_kind: "AUTHORIZATION_REQUEST",
      object_id: request.authorization_request_id,
      object_version: "1",
      scope_ref: context.scope_ref,
    },
    requested_by_ref: request.actor_ref,
    required_approver_constraints: constraints,
    action: request.action,
    resource_ref: request.resource_ref,
    scope_ref: request.scope_ref,
    environment_ref: request.environment_ref,
    ...(request.work_ref ? { work_ref: request.work_ref } : {}),
    context_version_refs: contextRefs,
    policy_release_ref: policy.data.policy_release.policy_release_ref,
    approval_use_mode: policy.data.approval_use_mode,
    created_at: now,
    expires_at: policy.data.approval_expires_at,
  });
  if (created.status !== "OK" || !created.data) return propagate(context, created);

  return deps.repository.createApprovalWithEvent(context, created.data, {
    key: "approval.create:" + idempotencyKey,
    request_fingerprint: buildCanonicalRequestFingerprint(request),
  });
}

/** Record an approver decision only after re-verifying the authenticated approver's current authority. */
export async function decideApprovalRequest(
  deps: AuthorizationDependencies,
  context: RequestContext,
  approvalRef: ObjectRef,
  input: ApprovalDecisionInput,
  expectedVersion: Version,
): Promise<OperationResult<ApprovalRecord>> {
  if (!samePrincipal(input.approver_ref, context.actor_ref) ||
      !context.idempotency_key ||
      input.idempotency_key !== context.idempotency_key ||
      input.expected_version !== expectedVersion) {
    return fail(context, "FORBIDDEN", "Approver identity, idempotency key or expected version does not match the authenticated request");
  }

  const current = await deps.sources.readApproval(context, approvalRef);
  if (current.status !== "OK" || !current.data) {
    return fail(context, "NOT_FOUND_OR_NOT_VISIBLE", "Approval was not found or is not visible");
  }
  if (!sameObjectRef(current.data.approval_ref, approvalRef) ||
      !sameScopeRef(current.data.scope_ref, context.scope_ref)) {
    return fail(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Approval source returned a different or out-of-scope record");
  }
  const version = current.object_version ?? current.data.approval_ref.object_version;
  if (!version || version !== expectedVersion) {
    return fail(context, "VERSION_CONFLICT", "Approval version changed before the decision");
  }

  const approver = await deps.sources.verifyApprover(context, current.data, input.approver_ref);
  if (approver.status !== "OK" || !approver.data) {
    return fail(context, "DEPENDENCY_UNAVAILABLE", "Current approver authority could not be verified");
  }
  const transitioned = decideApproval({
    approval: current.data,
    decision: input,
    expected_current_version: expectedVersion,
    approver_is_authorized: approver.data.authorized,
    independent_approval_required: approver.data.independent_required,
    now: deps.clock.now(),
  });
  if (transitioned.status !== "OK" || !transitioned.data) return propagate(context, transitioned);
  return deps.repository.updateApprovalWithEvent(context, transitioned.data, expectedVersion, {
    key: context.idempotency_key,
    request_fingerprint: await digestSha256(JSON.stringify({
      approval_ref: approvalRef,
      approver_ref: input.approver_ref,
      decision: input.decision,
      expected_version: expectedVersion,
      reason_ref: input.reason_ref ?? null,
      evidence_method_ref: input.evidence_method_ref ?? null,
    })),
  });
}

/** Approval revocation uses a current authority check, optimistic version and atomic event append. */
async function transitionApprovalLifecycle(
  deps: AuthorizationDependencies,
  context: RequestContext,
  approvalRef: ObjectRef,
  expectedVersion: Version,
  targetState: "EXPIRED" | "REVOKED",
): Promise<OperationResult<ApprovalRecord>> {
  if (!context.idempotency_key || !isRequestContext(context) ||
      !sameScopeRef(approvalRef.scope_ref, context.scope_ref)) {
    return fail(context, "VALIDATION_ERROR", "Approval lifecycle request is invalid or cross-scope");
  }
  const current = await deps.sources.readApproval(context, approvalRef);
  if (current.status !== "OK" || !current.data) {
    return fail(context, "NOT_FOUND_OR_NOT_VISIBLE", "Approval was not found or is not visible");
  }
  if (!sameObjectRef(current.data.approval_ref, approvalRef) ||
      !sameScopeRef(current.data.scope_ref, context.scope_ref)) {
    return fail(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Approval source returned a different or out-of-scope record");
  }
  const version = current.object_version ?? current.data.approval_ref.object_version;
  if (!version || version !== expectedVersion) return fail(context, "VERSION_CONFLICT", "Approval version changed before lifecycle transition");
  const operator = await deps.sources.verifyApprovalLifecycleOperator(context, current.data, targetState);
  if (operator.status !== "OK" || !operator.data) {
    return fail(context, "DEPENDENCY_UNAVAILABLE", "Current authority for approval lifecycle transition could not be verified");
  }
  if (!operator.data.authorized) return fail(context, "FORBIDDEN", "Caller is not authorized for this approval lifecycle transition");
  const transitioned = transitionApproval(current.data, targetState, deps.clock.now());
  if (transitioned.status !== "OK" || !transitioned.data) return propagate(context, transitioned);
  return deps.repository.updateApprovalLifecycleWithEvent(
    context,
    transitioned.data,
    expectedVersion,
    targetState === "EXPIRED" ? "approval.expired" : "approval.revoked",
    {
      key: "approval." + targetState.toLowerCase() + ":" + context.idempotency_key,
      request_fingerprint: await digestSha256(JSON.stringify({
        approval_ref: approvalRef,
        expected_version: expectedVersion,
        target_state: targetState,
      })),
    },
  );
}

export function revokeApproval(
  deps: AuthorizationDependencies,
  context: RequestContext,
  approvalRef: ObjectRef,
  expectedVersion: Version,
): Promise<OperationResult<ApprovalRecord>> {
  return transitionApprovalLifecycle(deps, context, approvalRef, expectedVersion, "REVOKED");
}

export function expireApproval(
  deps: AuthorizationDependencies,
  context: RequestContext,
  approvalRef: ObjectRef,
  expectedVersion: Version,
): Promise<OperationResult<ApprovalRecord>> {
  return transitionApprovalLifecycle(deps, context, approvalRef, expectedVersion, "EXPIRED");
}

/** Grantor authority and the cited allow decision are resolved from trusted sources, never caller booleans. */
export async function grantDelegation(
  deps: AuthorizationDependencies,
  context: RequestContext,
  request: DelegationRequest,
): Promise<OperationResult<DelegationRecord>> {
  if (!samePrincipal(request.grantor_ref, context.actor_ref) ||
      !sameScopeRef(request.scope_ref, context.scope_ref) ||
      !context.idempotency_key) {
    return fail(context, "FORBIDDEN", "Delegation grantor, scope or idempotency context is invalid");
  }

  const [authorityResult, decisionResult] = await Promise.all([
    deps.sources.resolveDelegationGrantAuthority(context, request),
    deps.sources.verifyDelegationDecision(context, request),
  ]);
  if (authorityResult.status !== "OK" || !authorityResult.data ||
      decisionResult.status !== "OK" || !decisionResult.data) {
    return fail(context, "DEPENDENCY_UNAVAILABLE", "Current grantor authority and authorization decision could not be verified");
  }
  if (!decisionResult.data.valid) {
    return fail(context, "FORBIDDEN", "The cited authorization decision is not current or does not authorize this delegation");
  }

  let parent: DelegationRecord | undefined;
  if (request.parent_delegation_ref) {
    const parentResult = await deps.sources.readDelegation(context, request.parent_delegation_ref);
    if (parentResult.status !== "OK" || !parentResult.data) {
      return fail(context, "FORBIDDEN", "Parent delegation is unavailable or not visible");
    }
    parent = parentResult.data;
  }

  const now = deps.clock.now();
  const issues = validateDelegationRequest(request, authorityResult.data, parent, now);
  if (issues.length) return fail(context, "FORBIDDEN", "Delegation exceeds current grantor authority or scope");

  const state = Date.parse(request.not_before) > Date.parse(now) ? "SCHEDULED" : "ACTIVE";
  const record: DelegationRecord = {
    delegation_id: request.delegation_ref.object_id,
    delegation_ref: request.delegation_ref,
    grantor_ref: request.grantor_ref,
    delegate_ref: request.delegate_ref,
    purpose: request.purpose,
    scope_ref: request.scope_ref,
    allowed_actions: [...request.allowed_actions],
    resource_constraints: [...request.resource_constraints],
    limits: [...request.limits],
    conditions: [...request.conditions],
    not_before: request.not_before,
    expires_at: request.expires_at,
    allow_subdelegation: request.allow_subdelegation,
    ...(request.parent_delegation_ref ? { parent_delegation_ref: request.parent_delegation_ref } : {}),
    authorized_by_decision_ref: request.authorized_by_decision_ref,
    state,
    created_at: now,
  };
  return deps.repository.createDelegationWithEvent(context, record, {
    key: context.idempotency_key,
    request_fingerprint: await digestSha256(JSON.stringify(request)),
  });
}

/** Revocation re-reads current state and re-verifies the caller's authority before CAS. */
export async function revokeDelegation(
  deps: AuthorizationDependencies,
  context: RequestContext,
  delegationRef: ObjectRef,
  expectedVersion: Version,
): Promise<OperationResult<DelegationRecord>> {
  if (!context.idempotency_key) return fail(context, "VALIDATION_ERROR", "Delegation revocation requires an idempotency key");
  const current = await deps.sources.readDelegation(context, delegationRef);
  if (current.status !== "OK" || !current.data) return fail(context, "NOT_FOUND_OR_NOT_VISIBLE", "Delegation was not found or is not visible");
  if (!sameObjectRef(current.data.delegation_ref, delegationRef) ||
      !sameScopeRef(current.data.scope_ref, context.scope_ref)) {
    return fail(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Delegation source returned a different or out-of-scope record");
  }
  const currentVersion = current.object_version ?? current.data.delegation_ref.object_version;
  if (!currentVersion || currentVersion !== expectedVersion) {
    return fail(context, "VERSION_CONFLICT", "Delegation version changed before revocation");
  }
  const authority = await deps.sources.verifyDelegationRevoker(context, current.data);
  if (authority.status !== "OK" || !authority.data) return fail(context, "DEPENDENCY_UNAVAILABLE", "Revocation authority could not be verified");
  if (!authority.data.authorized) return fail(context, "FORBIDDEN", "Caller is not authorized to revoke this delegation");

  const transitioned = transitionDelegation(current.data, "REVOKED", deps.clock.now());
  if (transitioned.status !== "OK" || !transitioned.data) return propagate(context, transitioned);
  return deps.repository.updateDelegationWithEvent(context, transitioned.data, expectedVersion, {
    key: context.idempotency_key,
    request_fingerprint: await digestSha256(JSON.stringify({
      delegation_ref: delegationRef,
      expected_version: expectedVersion,
      target_state: "REVOKED",
    })),
  });
}

/** Authenticate through the configured identity adapter; caller-supplied claims are never accepted as proof. */
export async function authenticatePrincipal(
  deps: AuthorizationDependencies,
  context: RequestContext,
  request: AuthenticationRequest,
): Promise<OperationResult<AuthenticationResult>> {
  if (!isRequestContext(context) ||
      validateAuthenticationRequest(request).length > 0 ||
      request.correlation_id !== context.correlation_id ||
      !sameScopeRef(request.requested_scope_ref, context.scope_ref) ||
      Date.parse(request.requested_at) > Date.parse(deps.clock.now())) {
    return fail(context, "VALIDATION_ERROR", "Authentication request is invalid or outside the authenticated scope");
  }
  const result = await deps.sources.authenticatePrincipal(context, request);
  if (result.status !== "OK" || !result.data) return propagate(context, result);
  const issues = validateAuthenticationResult(request, result.data);
  if (issues.length) return fail(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Authentication adapter returned an invalid result");
  if (result.data.state === "AUTHENTICATED" &&
      (!samePrincipal(result.data.principal_ref!, context.actor_ref) ||
       !sameScopeRef(result.data.session_ref!.scope_ref, context.scope_ref))) {
    return fail(context, "UNAUTHENTICATED", "Authentication result does not match the requested principal or scope");
  }
  return result;
}

/** Revoke an authority subject through the source-system revoker and persist an invalidation event. */
export async function revokeAuthority(
  deps: AuthorizationDependencies,
  context: RequestContext,
  request: AuthorityRevocationRequest,
): Promise<OperationResult<RevocationRecord>> {
  const idempotencyKey = operationIdempotencyKey(context, request.idempotency_key);
  if (!idempotencyKey || !isObjectRef(request.subject_ref) ||
      !request.reason_code?.trim() ||
      !sameScopeRef(request.scope_ref, context.scope_ref) ||
      !sameScopeRef(request.subject_ref.scope_ref, request.scope_ref) ||
      (request.expected_version !== undefined && request.subject_ref.object_version !== request.expected_version)) {
    return fail(context, "VALIDATION_ERROR", "Authority revocation request is invalid or cross-scope");
  }
  const now = deps.clock.now();
  const effectiveAt = request.effective_at ?? now;
  if (effectiveAt > now) return fail(context, "VALIDATION_ERROR", "Future-dated revocation requires a separately scheduled lifecycle operation");
  const authorization = await deps.sources.verifyAuthorityRevoker(context, request);
  if (authorization.status !== "OK" || !authorization.data) {
    return fail(context, "DEPENDENCY_UNAVAILABLE", "Current authority to revoke this subject could not be verified");
  }
  if (!authorization.data.authorized) return fail(context, "FORBIDDEN", "Caller is not authorized to revoke this authority");
  if (request.expected_version && authorization.data.source_version &&
      request.expected_version !== authorization.data.source_version) {
    return fail(context, "VERSION_CONFLICT", "Authority source changed before revocation");
  }

  const record: RevocationRecord = {
    revocation_ref: {
      object_kind: "AUTHORITY_REVOCATION",
      object_id: deps.ids.next("AUTHORITY_REVOCATION", context.scope_ref),
      object_version: "1",
      scope_ref: context.scope_ref,
    },
    subject_ref: request.subject_ref,
    reason_code: request.reason_code,
    requested_by_ref: context.actor_ref,
    effective_at: effectiveAt,
    ...(authorization.data.source_version ? { source_version: authorization.data.source_version } : {}),
    affected_scope_refs: [request.scope_ref],
    correlation_id: context.correlation_id,
  };
  return deps.repository.createRevocationWithEvent(context, record, {
    key: "authority.revoke:" + idempotencyKey,
    request_fingerprint: await digestSha256(JSON.stringify({
      subject_ref: request.subject_ref,
      reason_code: request.reason_code,
      scope_ref: request.scope_ref,
      expected_version: request.expected_version ?? null,
      effective_at: effectiveAt,
    })),
  });
}

async function transitionDelegationLifecycle(
  deps: AuthorizationDependencies,
  context: RequestContext,
  delegationRef: ObjectRef,
  expectedVersion: Version,
  targetState: DelegationRecord["state"],
): Promise<OperationResult<DelegationRecord>> {
  if (!context.idempotency_key || !isObjectRef(delegationRef) ||
      delegationRef.object_kind !== "DELEGATION" ||
      !sameScopeRef(delegationRef.scope_ref, context.scope_ref)) {
    return fail(context, "VALIDATION_ERROR", "Delegation lifecycle request is invalid or cross-scope");
  }
  const current = await deps.sources.readDelegation(context, delegationRef);
  if (current.status !== "OK" || !current.data) {
    return fail(context, "NOT_FOUND_OR_NOT_VISIBLE", "Delegation was not found or is not visible");
  }
  if (!sameObjectRef(current.data.delegation_ref, delegationRef) ||
      !sameScopeRef(current.data.scope_ref, context.scope_ref)) {
    return fail(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Delegation source returned a different or out-of-scope record");
  }
  const version = current.object_version ?? current.data.delegation_ref.object_version;
  if (!version || version !== expectedVersion) {
    return fail(context, "VERSION_CONFLICT", "Delegation version changed before lifecycle transition");
  }
  const operator = await deps.sources.verifyDelegationLifecycleOperator(context, current.data, targetState);
  if (operator.status !== "OK" || !operator.data) {
    return fail(context, "DEPENDENCY_UNAVAILABLE", "Current authority for delegation lifecycle transition could not be verified");
  }
  if (!operator.data.authorized) return fail(context, "FORBIDDEN", "Caller is not authorized for this delegation lifecycle transition");

  const transitioned = transitionDelegation(current.data, targetState, deps.clock.now());
  if (transitioned.status !== "OK" || !transitioned.data) return propagate(context, transitioned);
  const eventType = targetState === "ACTIVE" ? "delegation.activated" :
    targetState === "SUSPENDED" ? "delegation.suspended" :
      targetState === "EXPIRED" ? "delegation.expired" : "delegation.revoked";
  return deps.repository.updateDelegationWithEvent(context, transitioned.data, expectedVersion, {
    key: "delegation." + targetState.toLowerCase() + ":" + context.idempotency_key,
    request_fingerprint: await digestSha256(JSON.stringify({
      delegation_ref: delegationRef,
      expected_version: expectedVersion,
      target_state: targetState,
    })),
  });
}

export function suspendDelegation(
  deps: AuthorizationDependencies,
  context: RequestContext,
  delegationRef: ObjectRef,
  expectedVersion: Version,
): Promise<OperationResult<DelegationRecord>> {
  return transitionDelegationLifecycle(deps, context, delegationRef, expectedVersion, "SUSPENDED");
}

export function activateDelegation(
  deps: AuthorizationDependencies,
  context: RequestContext,
  delegationRef: ObjectRef,
  expectedVersion: Version,
): Promise<OperationResult<DelegationRecord>> {
  return transitionDelegationLifecycle(deps, context, delegationRef, expectedVersion, "ACTIVE");
}

export function expireDelegation(
  deps: AuthorizationDependencies,
  context: RequestContext,
  delegationRef: ObjectRef,
  expectedVersion: Version,
): Promise<OperationResult<DelegationRecord>> {
  return transitionDelegationLifecycle(deps, context, delegationRef, expectedVersion, "EXPIRED");
}

/** Policy release mutations are version-checked, authority-gated and committed with their Outbox event. */
async function transitionPolicyReleaseLifecycle(
  deps: AuthorizationDependencies,
  context: RequestContext,
  policyRef: ObjectRef,
  targetState: PolicyReleaseState,
  operation: PolicyReleaseOperationContext,
): Promise<OperationResult<PolicyRelease>> {
  const idempotencyKey = operationIdempotencyKey(context, operation.idempotency_key);
  if (!idempotencyKey ||
      !samePrincipal(operation.requested_by_ref, context.actor_ref) ||
      !sameScopeRef(operation.change_ref.scope_ref, context.scope_ref) ||
      operation.correlation_id !== context.correlation_id ||
      !sameScopeRef(policyRef.scope_ref, context.scope_ref) ||
      (operation.impact_report_ref && !sameScopeRef(operation.impact_report_ref.scope_ref, context.scope_ref)) ||
      (operation.approval_ref && !sameScopeRef(operation.approval_ref.scope_ref, context.scope_ref))) {
    return fail(context, "VALIDATION_ERROR", "Policy release operation context is invalid or cross-scope");
  }
  if (targetState === "RELEASED" && !operation.approval_ref) {
    return fail(context, "APPROVAL_REQUIRED", "Policy release requires an explicit approval reference");
  }
  if ((targetState === "SUSPENDED" || targetState === "RETIRED") && !operation.reason_code?.trim()) {
    return fail(context, "VALIDATION_ERROR", "Policy suspension or retirement requires a reason code");
  }
  if (targetState === "RELEASED" && !operation.impact_report_ref) {
    return fail(context, "VALIDATION_ERROR", "Policy release requires an impact report reference");
  }

  const current = await deps.sources.readPolicyRelease(context, policyRef);
  if (current.status !== "OK" || !current.data) {
    return fail(context, "NOT_FOUND_OR_NOT_VISIBLE", "Policy release was not found or is not visible");
  }
  if (!sameObjectRef(current.data.policy_release_ref, policyRef) ||
      !sameScopeRef(current.data.policy_release_ref.scope_ref, context.scope_ref)) {
    return fail(context, "INTEGRITY_OR_UNTRUSTED_INPUT", "Policy source returned a different or out-of-scope release");
  }
  const version = current.object_version ?? current.data.version;
  if (!version || version !== operation.expected_version) {
    return fail(context, "VERSION_CONFLICT", "Policy release version changed before lifecycle transition");
  }
  const authority = await deps.sources.verifyPolicyReleaseOperator(context, current.data, targetState, operation);
  if (authority.status !== "OK" || !authority.data) {
    return fail(context, "DEPENDENCY_UNAVAILABLE", "Current policy release authority could not be verified");
  }
  if (!authority.data.authorized) return fail(context, "FORBIDDEN", "Caller is not authorized for this policy release transition");

  const transitioned = transitionPolicyRelease(current.data, targetState, deps.clock.now());
  if (transitioned.status !== "OK" || !transitioned.data) return propagate(context, transitioned);
  const eventType = targetState === "RELEASED" ? "policy.version_released" :
    targetState === "SUSPENDED" ? "policy.version_suspended" : "policy.version_retired";
  return deps.repository.updatePolicyReleaseWithEvent(context, transitioned.data, version, eventType, {
    key: "policy." + targetState.toLowerCase() + ":" + idempotencyKey,
    request_fingerprint: await digestSha256(JSON.stringify({
      policy_ref: policyRef,
      target_state: targetState,
      expected_version: version,
      change_ref: operation.change_ref,
      impact_report_ref: operation.impact_report_ref ?? null,
      approval_ref: operation.approval_ref ?? null,
      reason_code: operation.reason_code ?? null,
    })),
  }, operation);
}

export function publishPolicyRelease(
  deps: AuthorizationDependencies,
  context: RequestContext,
  policyRef: ObjectRef,
  operation: PolicyReleaseOperationContext,
): Promise<OperationResult<PolicyRelease>> {
  return transitionPolicyReleaseLifecycle(deps, context, policyRef, "RELEASED", operation);
}

export function suspendPolicyRelease(
  deps: AuthorizationDependencies,
  context: RequestContext,
  policyRef: ObjectRef,
  operation: PolicyReleaseOperationContext,
): Promise<OperationResult<PolicyRelease>> {
  return transitionPolicyReleaseLifecycle(deps, context, policyRef, "SUSPENDED", operation);
}

export function retirePolicyRelease(
  deps: AuthorizationDependencies,
  context: RequestContext,
  policyRef: ObjectRef,
  operation: PolicyReleaseOperationContext,
): Promise<OperationResult<PolicyRelease>> {
  return transitionPolicyReleaseLifecycle(deps, context, policyRef, "RETIRED", operation);
}

/** Access-filtered decision read; out-of-scope and absent records share the same safe response. */
export async function getAuthorityDecision(
  deps: AuthorizationDependencies,
  context: RequestContext,
  decisionRef: ObjectRef,
): Promise<OperationResult<AuthorizationDecision>> {
  if (!isObjectRef(decisionRef) || decisionRef.object_kind !== "AUTHORIZATION_DECISION" ||
      !sameScopeRef(decisionRef.scope_ref, context.scope_ref)) {
    return fail(context, "NOT_FOUND_OR_NOT_VISIBLE", "Authorization decision was not found or is not visible");
  }
  const result = await deps.repository.readDecision(context, decisionRef);
  if (result.status !== "OK" || !result.data ||
      !sameObjectRef(result.data.decision_ref, decisionRef) ||
      !sameScopeRef(result.data.applicable_scope_ref, context.scope_ref)) {
    return fail(context, "NOT_FOUND_OR_NOT_VISIBLE", "Authorization decision was not found or is not visible");
  }
  return result;
}

export async function explainDenialSafe(
  deps: AuthorizationDependencies,
  context: RequestContext,
  decisionRef: ObjectRef,
): Promise<OperationResult<SafeDecisionExplanation>> {
  const current = await getAuthorityDecision(deps, context, decisionRef);
  if (current.status !== "OK" || !current.data) return propagate(context, current);
  if (current.data.result === "ALLOW") {
    return fail(context, "FORBIDDEN", "A denial explanation is not available for an allowed decision");
  }
  return createOperationResult({
    status: "OK",
    correlation_id: context.correlation_id,
    data: createSafeDecisionExplanation(current.data),
  });
}

async function digestSha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return "sha256:" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
