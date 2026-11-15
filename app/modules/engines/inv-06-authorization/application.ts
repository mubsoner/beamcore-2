import {
  createOperationError,
  createOperationResult,
  type ClockPort,
  type ObjectRef,
  type OperationResult,
  type PrincipalRef,
  type RequestContext,
} from "../shared";
import {
  buildAuthorityFingerprintMaterial,
  createSafeDecisionExplanation,
  evaluateAuthorizationDecision,
  type ApprovalDecisionInput,
  type ApprovalRecord,
  type AuthorityFacts,
  type AuthorizationDecision,
  type AuthorizationRequest,
  type DelegationRecord,
  type DelegationRequest,
  type PolicyEvaluation,
  type PolicyEvaluationAudit,
  type PrincipalContext,
  type SafeDecisionExplanation,
  type TrustAssessment,
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
  verifyApprover(context: RequestContext, approval: ApprovalRecord, approver: PrincipalRef): Promise<OperationResult<{ authorized: boolean; independent_required: boolean }>>;
}

export interface AuthorizationRepositoryPort {
  createDecision(context: RequestContext, decision: AuthorizationDecision): Promise<OperationResult<AuthorizationDecision>>;
  createAudit(context: RequestContext, audit: PolicyEvaluationAudit): Promise<OperationResult<PolicyEvaluationAudit>>;
  createApproval(context: RequestContext, approval: ApprovalRecord): Promise<OperationResult<ApprovalRecord>>;
  updateApproval(context: RequestContext, approval: ApprovalRecord, expectedVersion: string): Promise<OperationResult<ApprovalRecord>>;
  claimOneTimeApproval(context: RequestContext, approvalRef: ObjectRef, requestRef: ObjectRef, expectedVersion: string): Promise<OperationResult<ApprovalRecord>>;
  createDelegation(context: RequestContext, delegation: DelegationRecord): Promise<OperationResult<DelegationRecord>>;
  updateDelegation(context: RequestContext, delegation: DelegationRecord, expectedVersion: string): Promise<OperationResult<DelegationRecord>>;
}

export interface AuthorizationEventPort {
  publish(context: RequestContext, eventType: string, objectRef: ObjectRef, payload: Record<string, unknown>): Promise<OperationResult<{ event_id: string }>>;
}

export interface AuthorizationDependencies {
  sources: AuthorizationSourcePort;
  repository: AuthorizationRepositoryPort;
  events: AuthorizationEventPort;
  ids: AuthorizationIdPort;
  clock: ClockPort;
}

function fail<T>(context: RequestContext, code: Parameters<typeof createOperationError>[0], message: string): OperationResult<T> {
  return createOperationResult({ status: "REJECTED", correlation_id: context.correlation_id,
    errors: [createOperationError(code, message)] });
}

function propagate<T>(context: RequestContext, result: OperationResult<unknown>): OperationResult<T> {
  return createOperationResult({ status: result.status, correlation_id: context.correlation_id,
    errors: result.errors, warnings: result.warnings });
}

export async function authorizeAction(
  deps: AuthorizationDependencies,
  context: RequestContext,
  request: AuthorizationRequest,
): Promise<OperationResult<{ decision: AuthorizationDecision; explanation: SafeDecisionExplanation }>> {
  const principalResult = await deps.sources.resolvePrincipal(context);
  if (principalResult.status !== "OK" || !principalResult.data) {
    return fail(context, "UNAUTHENTICATED", "The authenticated principal could not be verified");
  }
  const factsResult = await deps.sources.readAuthorityFacts(context, request);
  if (factsResult.status !== "OK" || !factsResult.data) {
    return fail(context, "DEPENDENCY_UNAVAILABLE", "Current authority facts are unavailable; protected action is blocked");
  }
  const policyResult = await deps.sources.evaluatePolicy(context, request, principalResult.data, factsResult.data);
  if (policyResult.status !== "OK" || !policyResult.data) {
    return fail(context, "DEPENDENCY_UNAVAILABLE", "Current policy could not be evaluated; protected action is blocked");
  }
  let approval: ApprovalRecord | undefined;
  if (request.approval_ref) {
    const approvalResult = await deps.sources.readApproval(context, request.approval_ref);
    if (approvalResult.status !== "OK" || !approvalResult.data) {
      return fail(context, "APPROVAL_REQUIRED", "The referenced approval is unavailable or not visible");
    }
    approval = approvalResult.data;
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
    request, principal: principalResult.data, facts: factsResult.data, policy: policyResult.data,
  });
  const fingerprint = await digestSha256(fingerprintMaterial);
  const evaluated = evaluateAuthorizationDecision({
    context, request, principal: principalResult.data, facts: factsResult.data,
    policy: policyResult.data, approval, decision_ref: decisionRef,
    decision_id: decisionRef.object_id, request_ref: requestRef, audit_ref: auditRef,
    evaluated_at: deps.clock.now(), authority_fingerprint: fingerprint,
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
  const saved = await deps.repository.createDecision(context, evaluated.data);
  if (saved.status !== "OK" || !saved.data) return propagate(context, saved);
  const audited = await deps.repository.createAudit(context, audit);
  if (audited.status !== "OK") {
    return fail(context, "INTERNAL_ERROR", "Authorization audit could not be durably recorded");
  }
  const event = await deps.events.publish(context, "authorization.evaluated", decisionRef, {
    result: saved.data.result,
    request_ref: requestRef,
    authority_fingerprint: fingerprint,
    policy_release_ref: policyResult.data.policy_release.policy_release_ref,
  });
  if (event.status !== "OK") {
    return createOperationResult({ status: "PARTIAL", correlation_id: context.correlation_id,
      data: { decision: saved.data, explanation: createSafeDecisionExplanation(saved.data) },
      warnings: ["Decision and audit were saved, but the authority event could not be published"] });
  }
  return createOperationResult({ status: "OK", correlation_id: context.correlation_id,
    data: { decision: saved.data, explanation: createSafeDecisionExplanation(saved.data) } });
}

export async function recheckAuthorizationAtActionBoundary(
  deps: AuthorizationDependencies,
  context: RequestContext,
  request: AuthorizationRequest,
): Promise<OperationResult<AuthorizationDecision>> {
  const result = await authorizeAction(deps, context, request);
  if (result.status !== "OK" && result.status !== "PARTIAL") return propagate(context, result);
  if (!result.data || result.data.decision.result !== "ALLOW") {
    return createOperationResult({ status: "REJECTED", correlation_id: context.correlation_id,
      errors: [createOperationError(
        result.data?.decision.result === "DENY" ? "FORBIDDEN" :
        result.data?.decision.result === "REQUIRE_APPROVAL" ? "APPROVAL_REQUIRED" :
        result.data?.decision.result === "REQUIRE_REAUTH" ? "UNAUTHENTICATED" : "POLICY_DENIED",
        "Current action-time authorization did not allow this protected action",
      )] });
  }
  return createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: result.data.decision });
}

export async function requestApproval(
  deps: AuthorizationDependencies,
  context: RequestContext,
  input: Parameters<typeof import("./domain").createPendingApproval>[0],
): Promise<OperationResult<ApprovalRecord>> {
  const { createPendingApproval } = await import("./domain");
  const created = createPendingApproval(input);
  if (created.status !== "OK" || !created.data) return propagate(context, created);
  const saved = await deps.repository.createApproval(context, created.data);
  if (saved.status !== "OK" || !saved.data) return propagate(context, saved);
  const event = await deps.events.publish(context, "approval.required", saved.data.approval_ref, {
    request_ref: saved.data.request_ref, action: saved.data.action,
  });
  return event.status === "OK" ? saved : createOperationResult({
    status: "PARTIAL", correlation_id: context.correlation_id, data: saved.data,
    warnings: ["Approval request saved, but notification event publication failed"],
  });
}

export async function decideApprovalRequest(
  deps: AuthorizationDependencies,
  context: RequestContext,
  approvalRef: ObjectRef,
  input: ApprovalDecisionInput,
  expectedVersion: string,
): Promise<OperationResult<ApprovalRecord>> {
  const current = await deps.sources.readApproval(context, approvalRef);
  if (current.status !== "OK" || !current.data) return fail(context, "NOT_FOUND_OR_NOT_VISIBLE", "Approval was not found or is not visible");
  const approver = await deps.sources.verifyApprover(context, current.data, input.approver_ref);
  if (approver.status !== "OK" || !approver.data) return fail(context, "DEPENDENCY_UNAVAILABLE", "Current approver authority could not be verified");
  const { decideApproval } = await import("./domain");
  const transitioned = decideApproval({
    approval: current.data, decision: input, expected_current_version: expectedVersion,
    approver_is_authorized: approver.data.authorized,
    independent_approval_required: approver.data.independent_required, now: deps.clock.now(),
  });
  if (transitioned.status !== "OK" || !transitioned.data) return propagate(context, transitioned);
  const saved = await deps.repository.updateApproval(context, transitioned.data, expectedVersion);
  if (saved.status !== "OK" || !saved.data) return propagate(context, saved);
  const event = await deps.events.publish(context, "approval.decided", approvalRef, {
    state: saved.data.state, approver_ref: input.approver_ref,
  });
  return event.status === "OK" ? saved : createOperationResult({
    status: "PARTIAL", correlation_id: context.correlation_id, data: saved.data,
    warnings: ["Approval decision saved, but authority event publication failed"],
  });
}

export async function claimApprovalForAction(
  deps: AuthorizationDependencies,
  context: RequestContext,
  approvalRef: ObjectRef,
  requestRef: ObjectRef,
  expectedVersion: string,
): Promise<OperationResult<ApprovalRecord>> {
  // The persistence adapter MUST implement this as one atomic compare-and-set.
  return deps.repository.claimOneTimeApproval(context, approvalRef, requestRef, expectedVersion);
}

export async function grantDelegation(
  deps: AuthorizationDependencies,
  context: RequestContext,
  request: DelegationRequest,
  authority: Parameters<typeof import("./domain").validateDelegationRequest>[1],
  parent?: DelegationRecord,
): Promise<OperationResult<DelegationRecord>> {
  const { validateDelegationRequest } = await import("./domain");
  const issues = validateDelegationRequest(request, authority, parent);
  if (issues.length) return fail(context, "FORBIDDEN", "Delegation exceeds current grantor authority or scope");
  const now = deps.clock.now();
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
  const saved = await deps.repository.createDelegation(context, record);
  if (saved.status !== "OK" || !saved.data) return propagate(context, saved);
  const event = await deps.events.publish(context, "delegation.created", saved.data.delegation_ref, {
    grantor_ref: saved.data.grantor_ref, delegate_ref: saved.data.delegate_ref,
    scope_ref: saved.data.scope_ref, expires_at: saved.data.expires_at,
  });
  return event.status === "OK" ? saved : createOperationResult({
    status: "PARTIAL", correlation_id: context.correlation_id, data: saved.data,
    warnings: ["Delegation saved, but authority event publication failed"],
  });
}

export async function revokeDelegation(
  deps: AuthorizationDependencies,
  context: RequestContext,
  delegation: DelegationRecord,
  expectedVersion: string,
): Promise<OperationResult<DelegationRecord>> {
  const { transitionDelegation } = await import("./domain");
  const transitioned = transitionDelegation(delegation, "REVOKED", deps.clock.now());
  if (transitioned.status !== "OK" || !transitioned.data) return propagate(context, transitioned);
  const saved = await deps.repository.updateDelegation(context, transitioned.data, expectedVersion);
  if (saved.status !== "OK" || !saved.data) return propagate(context, saved);
  const event = await deps.events.publish(context, "delegation.revoked", saved.data.delegation_ref, {
    grantor_ref: saved.data.grantor_ref, delegate_ref: saved.data.delegate_ref,
  });
  return event.status === "OK" ? saved : createOperationResult({
    status: "PARTIAL", correlation_id: context.correlation_id, data: saved.data,
    warnings: ["Delegation revoked, but authority event publication failed"],
  });
}

async function digestSha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return "sha256:" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
