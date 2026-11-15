import { describe, expect, it } from "vitest";
import type { ObjectRef, RequestContext, ScopeRef } from "../shared";
import {
  buildAuthorityFingerprintMaterial,
  buildCanonicalRequestFingerprint,
  claimOneTimeApprovalRecord,
  createPendingApproval,
  decideApproval,
  evaluateAuthorizationDecision,
  isDecisionCurrentForRequest,
  transitionApproval,
  transitionDelegation,
  transitionPolicyRelease,
  createSafeDecisionExplanation,
  validateApprovalUse,
  validateDelegationRequest,
  validateDelegationLineage,
  validateAuthorizationRequest,
  validateAuthorityFacts,
  validatePolicyEvaluation,
  type ApprovalRecord,
  type AuthorizationRequest,
  type AuthorityFacts,
  type DelegationRecord,
  type DelegationRequest,
  type PolicyEvaluation,
  type PrincipalContext,
} from "./domain";

const scope: ScopeRef = { scope_id: "org-1", scope_kind: "ORGANIZATION" };
const context: RequestContext = {
  request_id: "req-1", correlation_id: "corr-1",
  actor_ref: { principal_id: "user-1", principal_kind: "USER" },
  scope_ref: scope, issued_at: "2026-11-15T10:00:00Z",
};
const ref = (kind: string, id: string, objectScope = scope): ObjectRef => ({
  object_kind: kind, object_id: id, object_version: "1", scope_ref: objectScope,
});
const request = (overrides: Partial<AuthorizationRequest> = {}): AuthorizationRequest => ({
  authorization_request_id: "auth-req-1",
  actor_ref: context.actor_ref,
  action: "artifact.publish",
  resource_ref: ref("ARTIFACT", "artifact-1"),
  scope_ref: scope,
  environment_ref: ref("ENVIRONMENT", "production"),
  risk_context: {
    assessment_state: "ASSESSED", impact_dimensions: ["external-effect"],
    sensitivity_refs: [], uncertainty_flags: [], scope_blast_radius_refs: [],
    assessed_at: "2026-11-15T09:59:00Z", valid_until: "2026-11-15T10:10:00Z",
  },
  requested_at: "2026-11-15T10:00:00Z",
  policy_context_refs: [], correlation_id: context.correlation_id,
  ...overrides,
});
const principal = (overrides: Partial<PrincipalContext> = {}): PrincipalContext => ({
  principal_ref: context.actor_ref,
  authentication_state: "AUTHENTICATED",
  organization_membership_refs: [ref("MEMBERSHIP", "membership-1")],
  role_binding_refs: [ref("ROLE_BINDING", "role-1")],
  delegation_refs: [], trust_assessment_refs: [],
  authority_source_refs: [{
    source_kind: "membership", object_ref: ref("MEMBERSHIP", "membership-1"),
    source_version: "3", observed_at: "2026-11-15T09:59:30Z",
  }],
  resolved_at: "2026-11-15T09:59:30Z", valid_until: "2026-11-15T10:05:00Z",
  ...overrides,
});
const facts = (overrides: Partial<AuthorityFacts> = {}): AuthorityFacts => ({
  membership_state: "ACTIVE", entitlement_state: "ELIGIBLE",
  permission_state: "GRANTED", delegation_state: "NOT_REQUIRED", trust_assessment_state: "NOT_REQUIRED",
  external_authorization_state: "NOT_REQUIRED",
  verified_resource_scope_ref: scope,
  source_refs: [{
    source_kind: "membership", object_ref: ref("MEMBERSHIP", "membership-1"),
    source_version: "3", observed_at: "2026-11-15T09:59:30Z",
  }],
  observed_at: "2026-11-15T09:59:30Z", valid_until: "2026-11-15T10:05:00Z",
  current_resource_version: "1",
  ...overrides,
});
const policy = (overrides: Partial<PolicyEvaluation> = {}): PolicyEvaluation => ({
  effect: "ALLOW",
  policy_release: {
    policy_release_id: "policy-1", policy_family_id: "artifact-policy",
    policy_release_ref: { ...ref("POLICY_RELEASE", "policy-1"), object_version: "7" },
    version: "7", state: "RELEASED", ruleset_digest: "sha256:policy",
    evaluator_contract_version: "1", effective_from: "2026-11-15T09:00:00Z",
    valid_until: "2026-11-15T11:00:00Z",
  },
  evaluator_version: "evaluator-1", reason_codes: ["POLICY_MATCHED"],
  conditions: [], obligations: [], valid_until: "2026-11-15T10:04:00Z",
  approval_required: false, approval_expires_at: "2026-11-15T10:08:00Z",
  independent_approver_required: false,
  risk_assessment_required: true, trust_required: false,
  ...overrides,
});
function evaluate(overrides: {
  req?: Partial<AuthorizationRequest>;
  principal?: Partial<PrincipalContext>;
  facts?: Partial<AuthorityFacts>;
  policy?: Partial<PolicyEvaluation>;
  approval?: ApprovalRecord;
} = {}) {
  const req = request(overrides.req);
  const principalCtx = principal(overrides.principal);
  const policyEval = policy(overrides.policy);
  return evaluateAuthorizationDecision({
    context, request: req, principal: principalCtx, facts: facts(overrides.facts),
    policy: policyEval, approval: overrides.approval,
    decision_ref: ref("AUTHORIZATION_DECISION", "decision-1"),
    decision_id: "decision-1",
    request_ref: ref("AUTHORIZATION_REQUEST", req.authorization_request_id),
    audit_ref: ref("AUTHORIZATION_AUDIT", "audit-1"),
    evaluated_at: "2026-11-15T10:00:00Z",
    authority_fingerprint: "sha256:fingerprint",
  });
}

describe("INV-06 authorization domain", () => {
  it("allows only when authenticated, in-scope, current authority and released policy agree", () => {
    expect(evaluate().data?.result).toBe("ALLOW");
  });
  it("blocks a stale resource version instead of authorizing the old version", () => {
    expect(evaluate({ facts: { current_resource_version: "2" } }).data?.result).toBe("INDETERMINATE");
    expect(evaluate({ facts: { current_resource_version: "2" } }).data?.reason_codes).toContain("RESOURCE_VERSION_STALE");
  });
  it("rejects malformed authority snapshots and policy releases", () => {
    expect(validateAuthorityFacts(facts({ source_refs: [] }), request(), "2026-11-15T10:00:00Z").length).toBeGreaterThan(0);
    expect(validatePolicyEvaluation(policy({ approval_required: true }), request()).length).toBeGreaterThan(0);
  });
  it("canonicalizes object key order but changes the request fingerprint for material changes", () => {
    const first = request();
    const reordered = { ...first, risk_context: {
      valid_until: first.risk_context.valid_until,
      assessed_at: first.risk_context.assessed_at,
      scope_blast_radius_refs: first.risk_context.scope_blast_radius_refs,
      uncertainty_flags: first.risk_context.uncertainty_flags,
      sensitivity_refs: first.risk_context.sensitivity_refs,
      impact_dimensions: first.risk_context.impact_dimensions,
      assessment_state: first.risk_context.assessment_state,
    } };
    expect(buildCanonicalRequestFingerprint(first)).toBe(buildCanonicalRequestFingerprint(reordered));
    expect(buildCanonicalRequestFingerprint(first)).not.toBe(buildCanonicalRequestFingerprint(request({ action: "artifact.delete" })));
  });
  it("changes the authority fingerprint when source versions, policy release or approvals change", () => {
    const first = {
      request: request(), principal: principal(), facts: facts(), policy: policy(),
    };
    const a = buildAuthorityFingerprintMaterial(first);
    const membershipChanged = buildAuthorityFingerprintMaterial({
      ...first, facts: facts({ source_refs: [{
        source_kind: "membership", object_ref: ref("MEMBERSHIP", "membership-1"),
        source_version: "4", observed_at: "2026-11-15T09:59:30Z",
      }] }),
    });
    expect(membershipChanged).not.toBe(a);
  });
  it("rejects actor spoofing and mismatched scope before evaluation", () => {
    expect(validateAuthorizationRequest(context, request({
      actor_ref: { principal_id: "attacker", principal_kind: "USER" },
    }))).toContain("actor_ref must match the authenticated request actor");
    expect(validateAuthorizationRequest(context, request({
      scope_ref: { scope_id: "other", scope_kind: "ORGANIZATION" },
    })).length).toBeGreaterThan(0);
  });
  it("requires a separately resolved service identity when a service identity is asserted", () => {
    const service = { principal_id: "service-1", principal_kind: "SERVICE" as const };
    expect(evaluate({ req: { service_identity_ref: service } }).data?.result).toBe("DENY");
    expect(evaluate({ req: { service_identity_ref: service }, principal: { service_identity_ref: service } }).data?.result).toBe("DENY");
    const delegationRef = ref("DELEGATION", "service-delegation");
    expect(evaluate({
      req: { service_identity_ref: service, delegation_ref: delegationRef },
      principal: { service_identity_ref: service, delegation_refs: [delegationRef] },
      facts: { delegation_state: "VALID", verified_delegation_ref: delegationRef },
    }).data?.result).toBe("ALLOW");
  });
  it("fails closed for unauthenticated, revoked, unknown and stale authority", () => {
    expect(evaluate({ principal: { authentication_state: "UNAUTHENTICATED" } }).data?.result).toBe("DENY");
    expect(evaluate({ facts: { membership_state: "REVOKED" } }).data?.result).toBe("DENY");
    expect(evaluate({ facts: { permission_state: "UNKNOWN" } }).data?.result).toBe("INDETERMINATE");
    expect(evaluate({ facts: { valid_until: "2026-11-15T09:59:59Z" } }).data?.result).toBe("INDETERMINATE");
  });
  it("fails closed when a required scoped trust assessment is missing or invalid", () => {
    expect(evaluate({ policy: { trust_required: true } }).data?.result).toBe("INDETERMINATE");
    expect(evaluate({ policy: { trust_required: true }, facts: { trust_assessment_state: "INVALID" } }).data?.result).toBe("DENY");
  });
  it("does not turn UNKNOWN or suspended policy into ALLOW", () => {
    expect(evaluate({ policy: { effect: "UNKNOWN" } }).data?.result).toBe("INDETERMINATE");
    expect(evaluate({ policy: { policy_release: { ...policy().policy_release, state: "SUSPENDED" } } }).data?.result).toBe("INDETERMINATE");
  });
  it("requires approval as a separate, exact-scope input", () => {
    const result = evaluate({ policy: { approval_required: true, approval_use_mode: "ONE_TIME" } });
    expect(result.data?.result).toBe("REQUIRE_APPROVAL");
  });
  it("creates pending approvals and rejects self-approval when independent approval is required", () => {
    const created = createPendingApproval({
      approval_ref: ref("APPROVAL", "approval-1"),
      approval_id: "approval-1",
      request_ref: ref("AUTHORIZATION_REQUEST", "auth-req-1"),
      request_binding_fingerprint: buildCanonicalRequestFingerprint(request()),
      requested_by_ref: context.actor_ref,
      required_approver_constraints: ["independent"],
      action: "artifact.publish", resource_ref: ref("ARTIFACT", "artifact-1"),
      scope_ref: scope, environment_ref: ref("ENVIRONMENT", "production"),
      context_version_refs: [], approval_use_mode: "ONE_TIME",
      created_at: "2026-11-15T10:00:00Z", expires_at: "2026-11-15T10:10:00Z",
    });
    expect(created.status).toBe("OK");
    const approval = created.data!;
    const rejected = decideApproval({
      approval,
      decision: {
        approval_ref: approval.approval_ref, approver_ref: context.actor_ref,
        decision: "APPROVE", expected_version: "1", idempotency_key: "approval-decision-1",
        decided_at: "2026-11-15T10:01:00Z",
      },
      expected_current_version: "1", approver_is_authorized: true,
      independent_approval_required: true, now: "2026-11-15T10:01:00Z",
    });
    expect(rejected.status).toBe("REJECTED");
  });
  it("consumes a one-time approval only for its exact request and current version", () => {
    const created = createPendingApproval({
      approval_ref: ref("APPROVAL", "approval-consume"),
      approval_id: "approval-consume",
      request_ref: ref("AUTHORIZATION_REQUEST", "auth-req-1"),
      request_binding_fingerprint: buildCanonicalRequestFingerprint(request()),
      requested_by_ref: context.actor_ref,
      required_approver_constraints: [],
      action: "artifact.publish",
      resource_ref: ref("ARTIFACT", "artifact-1"),
      scope_ref: scope,
      environment_ref: ref("ENVIRONMENT", "production"),
      context_version_refs: [],
      policy_release_ref: { ...ref("POLICY_RELEASE", "policy-1"), object_version: "7" },
      approval_use_mode: "ONE_TIME",
      created_at: "2026-11-15T10:00:00Z",
      expires_at: "2026-11-15T10:10:00Z",
    });
    const approval = {
      ...created.data!,
      state: "APPROVED" as const,
      approver_ref: { principal_id: "admin-1", principal_kind: "USER" as const },
      decided_at: "2026-11-15T10:01:00Z",
    };
    const requestRef = ref("AUTHORIZATION_REQUEST", "auth-req-1");
    const claimed = claimOneTimeApprovalRecord({
      approval, authorization_request_ref: requestRef,
      expected_version: "1", idempotency_key: "claim-1", now: "2026-11-15T10:02:00Z",
    });
    expect(claimed.data?.state).toBe("CONSUMED");
    expect(claimed.data?.consumed_by_request_ref).toEqual(requestRef);
    expect(claimOneTimeApprovalRecord({
      approval: claimed.data!, authorization_request_ref: requestRef,
      expected_version: "1", idempotency_key: "claim-2", now: "2026-11-15T10:03:00Z",
    }).status).toBe("REJECTED");
    expect(claimOneTimeApprovalRecord({
      approval, authorization_request_ref: ref("AUTHORIZATION_REQUEST", "different"),
      expected_version: "1", idempotency_key: "claim-3", now: "2026-11-15T10:03:00Z",
    }).status).toBe("REJECTED");
  });
  it("rejects approvals with a different action, target, environment, tenant or expiry", () => {
    const approval: ApprovalRecord = {
      approval_id: "approval-1", approval_ref: ref("APPROVAL", "approval-1"),
      request_ref: ref("AUTHORIZATION_REQUEST", "auth-req-1"),
      request_binding_fingerprint: buildCanonicalRequestFingerprint(request()),
      requested_by_ref: context.actor_ref, required_approver_constraints: [],
      approver_ref: { principal_id: "admin-1", principal_kind: "USER" },
      action: "artifact.delete", resource_ref: ref("ARTIFACT", "artifact-1"),
      scope_ref: scope, environment_ref: ref("ENVIRONMENT", "production"),
      context_version_refs: [], approval_use_mode: "ONE_TIME",
      state: "APPROVED", created_at: "2026-11-15T09:00:00Z",
      decided_at: "2026-11-15T09:01:00Z", expires_at: "2026-11-15T11:00:00Z",
    };
    const policyRef = { ...ref("POLICY_RELEASE", "policy-1"), object_version: "7" };
    const currentRequest = request({ approval_ref: ref("APPROVAL", "approval-1") });
    expect(validateApprovalUse(approval, currentRequest, "2026-11-15T10:00:00Z", policyRef).length).toBeGreaterThan(0);
    expect(validateApprovalUse({
      ...approval, action: currentRequest.action, approval_ref: currentRequest.approval_ref!,
      policy_release_ref: policyRef,
      request_ref: ref("AUTHORIZATION_REQUEST", "different-request"),
    }, currentRequest, "2026-11-15T10:00:00Z", policyRef)).toContain("approval request identity does not match");
    expect(validateApprovalUse({
      ...approval, approval_ref: currentRequest.approval_ref!, action: currentRequest.action,
      policy_release_ref: policyRef, request_ref: ref("AUTHORIZATION_REQUEST", "auth-req-1"),
      requested_by_ref: { principal_id: "other-user", principal_kind: "USER" },
    }, currentRequest, "2026-11-15T10:00:00Z", policyRef)).toContain("approval requester does not match the requesting actor");
    expect(validateApprovalUse({
      ...approval, approval_ref: currentRequest.approval_ref!, action: currentRequest.action,
      policy_release_ref: ref("POLICY_RELEASE", "old-policy"),
      request_ref: ref("AUTHORIZATION_REQUEST", "auth-req-1"),
    }, currentRequest, "2026-11-15T10:00:00Z", policyRef)).toContain("approval policy release does not match");
    expect(validateApprovalUse({
      ...approval, approval_ref: currentRequest.approval_ref!, action: currentRequest.action,
      request_binding_fingerprint: buildCanonicalRequestFingerprint(currentRequest),
    }, request({ ...currentRequest, risk_context: { ...currentRequest.risk_context, impact_dimensions: ["changed-impact"] } }),
    "2026-11-15T10:00:00Z", policyRef)).toContain("approval is bound to a different canonical request payload");
  });
  it("prevents delegation from exceeding grantor actions, resources, scope or expiry", () => {
    const delegationRequest: DelegationRequest = {
      delegation_ref: ref("DELEGATION", "delegation-1"),
      grantor_ref: context.actor_ref,
      delegate_ref: { principal_id: "agent-1", principal_kind: "AGENT" },
      purpose: "publish approved artifact",
      scope_ref: scope, allowed_actions: ["artifact.publish"],
      resource_constraints: [ref("ARTIFACT", "artifact-1")],
      limits: [], conditions: [],
      not_before: "2026-11-15T10:00:00Z",
      expires_at: "2026-11-15T10:30:00Z",
      allow_subdelegation: false,
      authorized_by_decision_ref: ref("AUTHORIZATION_DECISION", "grant-decision"),
    };
    const grantor = {
      grantor_authenticated: true, grantor_may_delegate: true, grantor_may_subdelegate: false,
      grantor_allowed_actions: ["artifact.read"],
      grantor_scope_ref: scope,
      grantor_resource_constraints: [ref("ARTIFACT", "artifact-1")],
    };
    expect(validateDelegationRequest(delegationRequest, grantor).length).toBeGreaterThan(0);
    expect(validateDelegationRequest({
      ...delegationRequest, allow_subdelegation: true,
    }, { ...grantor, grantor_allowed_actions: ["artifact.publish"] })).toContain("subdelegation is not explicitly authorized");
  });
  it("requires a complete non-circular parent delegation lineage", () => {
    const parent: DelegationRecord = {
      delegation_id: "parent-1",
      delegation_ref: ref("DELEGATION", "parent-1"),
      grantor_ref: { principal_id: "root-user", principal_kind: "USER" },
      delegate_ref: context.actor_ref,
      purpose: "delegate read access",
      scope_ref: scope,
      allowed_actions: ["artifact.read", "artifact.publish"],
      resource_constraints: [ref("ARTIFACT", "artifact-1")],
      limits: ["daily-10"],
      conditions: [],
      not_before: "2026-11-15T09:00:00Z",
      expires_at: "2026-11-15T11:00:00Z",
      allow_subdelegation: true,
      authorized_by_decision_ref: ref("AUTHORIZATION_DECISION", "parent-grant"),
      state: "ACTIVE",
      created_at: "2026-11-15T09:00:00Z",
    };
    const child: DelegationRequest = {
      delegation_ref: ref("DELEGATION", "child-1"),
      grantor_ref: context.actor_ref,
      delegate_ref: { principal_id: "agent-1", principal_kind: "AGENT" },
      purpose: "read one artifact",
      scope_ref: scope,
      allowed_actions: ["artifact.read"],
      resource_constraints: [ref("ARTIFACT", "artifact-1")],
      limits: ["daily-10"],
      conditions: [],
      not_before: "2026-11-15T09:01:00Z",
      expires_at: "2026-11-15T10:30:00Z",
      allow_subdelegation: false,
      parent_delegation_ref: parent.delegation_ref,
      authorized_by_decision_ref: ref("AUTHORIZATION_DECISION", "child-grant"),
    };
    expect(validateDelegationLineage(child, [parent], "2026-11-15T10:00:00Z")).toEqual([]);
    const cyclic = { ...child, delegation_ref: parent.delegation_ref };
    expect(validateDelegationLineage(cyclic, [parent], "2026-11-15T10:00:00Z")).toContain("delegation cycle or self-reference detected");
    const broken = { ...parent, parent_delegation_ref: ref("DELEGATION", "missing-grandparent") };
    expect(validateDelegationLineage(child, [broken], "2026-11-15T10:00:00Z")).toContain("delegation ancestry is incomplete or incorrectly ordered");
  });
  it("prevents delegation reactivation after its expiry", () => {
    const delegation: DelegationRecord = {
      delegation_id: "delegation-expired",
      delegation_ref: ref("DELEGATION", "delegation-expired"),
      grantor_ref: context.actor_ref,
      delegate_ref: { principal_id: "agent-2", principal_kind: "AGENT" },
      purpose: "read",
      scope_ref: scope,
      allowed_actions: ["artifact.read"],
      resource_constraints: [ref("ARTIFACT", "artifact-1")],
      limits: [],
      conditions: [],
      not_before: "2026-11-15T09:00:00Z",
      expires_at: "2026-11-15T09:59:00Z",
      allow_subdelegation: false,
      authorized_by_decision_ref: ref("AUTHORIZATION_DECISION", "decision-expired"),
      state: "SUSPENDED",
      created_at: "2026-11-15T09:00:00Z",
    };
    expect(transitionDelegation(delegation, "ACTIVE", "2026-11-15T10:00:00Z").status).toBe("REJECTED");
  });
  it("keeps delegation terminal after revocation", () => {
    const delegation: DelegationRecord = {
      delegation_id: "delegation-1", delegation_ref: ref("DELEGATION", "delegation-1"),
      grantor_ref: context.actor_ref, delegate_ref: { principal_id: "agent-1", principal_kind: "AGENT" },
      purpose: "read", scope_ref: scope, allowed_actions: ["artifact.read"],
      resource_constraints: [], limits: [], conditions: [],
      not_before: "2026-11-15T09:00:00Z", expires_at: "2026-11-15T12:00:00Z",
      allow_subdelegation: false, authorized_by_decision_ref: ref("AUTHORIZATION_DECISION", "decision-1"),
      state: "ACTIVE", created_at: "2026-11-15T09:00:00Z",
    };
    const revoked = transitionDelegation(delegation, "REVOKED", "2026-11-15T10:00:00Z");
    expect(revoked.data?.state).toBe("REVOKED");
    expect(transitionDelegation(revoked.data!, "ACTIVE", "2026-11-15T10:01:00Z").status).toBe("REJECTED");
  });
  it("does not reuse a released policy version for edits", () => {
    const released = policy().policy_release;
    expect(transitionPolicyRelease(released, "MONITORING", "2026-11-15T10:00:00Z").data?.state).toBe("MONITORING");
    expect(transitionPolicyRelease(released, "SUSPENDED", "2026-11-15T10:00:00Z").data?.state).toBe("SUSPENDED");
    expect(transitionPolicyRelease(released, "RETIRED", "2026-11-15T10:00:00Z").status).toBe("REJECTED");
  });
  it("allows approval expiry and revocation only through valid lifecycle transitions", () => {
    const pending = createPendingApproval({
      approval_ref: ref("APPROVAL", "approval-lifecycle"), approval_id: "approval-lifecycle",
      request_ref: ref("AUTHORIZATION_REQUEST", "auth-req-1"),
      request_binding_fingerprint: buildCanonicalRequestFingerprint(request()),
      requested_by_ref: context.actor_ref, required_approver_constraints: [],
      action: "artifact.publish", resource_ref: ref("ARTIFACT", "artifact-1"),
      scope_ref: scope, environment_ref: ref("ENVIRONMENT", "production"),
      context_version_refs: [], approval_use_mode: "ONE_TIME",
      created_at: "2026-11-15T10:00:00Z", expires_at: "2026-11-15T10:10:00Z",
    }).data!;
    expect(transitionApproval(pending, "EXPIRED", "2026-11-15T10:05:00Z").status).toBe("REJECTED");
    const revoked = transitionApproval(pending, "REVOKED", "2026-11-15T10:05:00Z");
    expect(revoked.data?.state).toBe("REVOKED");
    expect(transitionApproval(revoked.data!, "REVOKED", "2026-11-15T10:06:00Z").status).toBe("REJECTED");
  });
  it("filters private policy reason codes from user-facing explanations", () => {
    const decision = evaluate({ policy: { reason_codes: ["PRIVATE_RULE_SECRET", "POLICY_MATCHED"] } }).data!;
    const explanation = createSafeDecisionExplanation(decision);
    expect(explanation.visible_reason_codes).not.toContain("PRIVATE_RULE_SECRET");
    expect(explanation.user_visible_refs).toEqual([]);
  });
  it("rejects stale or mismatched decisions at the enforcement boundary", () => {
    const decision = evaluate().data!;
    expect(isDecisionCurrentForRequest(decision, request(), "2026-11-15T10:01:00Z", "sha256:fingerprint")).toBe(true);
    expect(isDecisionCurrentForRequest(decision, request(), "2026-11-15T10:05:00Z", "sha256:fingerprint")).toBe(false);
    expect(isDecisionCurrentForRequest(decision, request({ action: "artifact.delete" }), "2026-11-15T10:01:00Z", "sha256:fingerprint")).toBe(false);
  });
});
