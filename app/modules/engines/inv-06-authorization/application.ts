import {
  createOperationError,
  createOperationResult,
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
  authenticatePrincipal(context: RequestContext, request: AuthenticationRequest): Promise<OperationResult<AuthenticationResult>>;
  /** Must check current source authority, including membership, scope and revoker permission. */
  verifyAuthorityRevoker(context: RequestContext, request: AuthorityRevocationRequest): Promise<OperationResult<{ authorized: boolean; source_version?: Version }>>;
  readPolicyRelease(context: RequestContext, ref: ObjectRef): Promise<OperationResult<PolicyRelease>>;
  verifyAuthorityRevoker(context: RequestContext, request: AuthorityRevocationRequest): Promise<OperationResult<{ authorized: boolean; source_version?: Version }>>;
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
  if (Date.parse(policy.data.approval_expires_at) <= Date.parse(now) ||
      (request.deadline && Date.parse(policy.data.approval_expires_at) > Date.parse(request.deadline))) {
    return fail(context, "POLICY_DENIED", "Policy-derived approval expiry is invalid for this request");
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

async function digestSha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return "sha256:" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
