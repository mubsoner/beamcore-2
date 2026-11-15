import { describe, expect, it, vi } from "vitest";
import { createOperationResult, type ObjectRef, type PrincipalRef, type RequestContext, type ScopeRef } from "../shared";
import {
  activateDelegation,
  advancePolicyReleaseReviewStage,
  beginPolicyReleaseMonitoring,
  authenticatePrincipal,
  decideApprovalRequest,
  explainDenialSafe,
  getAuthorityDecision,
  grantDelegation,
  publishPolicyRelease,
  requestApproval,
  revokeApproval,
  expireApproval,
  revokeAuthority,
  suspendPolicyRelease,
  recheckAuthorizationAtActionBoundary,
  suspendDelegation,
  type AuthorizationDependencies,
  type AuthorizationRepositoryPort,
  type AuthorizationSourcePort,
  type DecisionCommitCommand,
} from "./application";
import { buildApprovalBindingFingerprint, buildCanonicalRequestFingerprint } from "./domain";
import type {
  ApprovalRecord,
  AuthorizationDecision,
  AuthorizationRequest,
  AuthorityFacts,
  DelegationGrantAuthority,
  DelegationRecord,
  DelegationRequest,
  PolicyEvaluation,
  PolicyRelease,
  PrincipalContext,
} from "./domain";

const scope: ScopeRef = { scope_id: "org-1", scope_kind: "ORGANIZATION" };
const actor: PrincipalRef = { principal_id: "user-1", principal_kind: "USER" };
const ref = (kind: string, id: string, version = "1"): ObjectRef => ({
  object_kind: kind, object_id: id, object_version: version, scope_ref: scope,
});
const context: RequestContext = {
  request_id: "req-app-1",
  correlation_id: "corr-app-1",
  actor_ref: actor,
  scope_ref: scope,
  issued_at: "2026-11-15T10:00:00Z",
  idempotency_key: "auth-app-1",
};
const authorizationRequest = (overrides: Partial<AuthorizationRequest> = {}): AuthorizationRequest => ({
  authorization_request_id: "authorization-request-1",
  actor_ref: actor,
  action: "artifact.publish",
  resource_ref: ref("ARTIFACT", "artifact-1"),
  expected_resource_version: "1",
  scope_ref: scope,
  environment_ref: ref("ENVIRONMENT", "production"),
  risk_context: {
    assessment_state: "ASSESSED",
    impact_dimensions: ["external-effect"],
    sensitivity_refs: [],
    uncertainty_flags: [],
    scope_blast_radius_refs: [],
    assessed_at: "2026-11-15T09:59:00Z",
    valid_until: "2026-11-15T10:05:00Z",
  },
  requested_at: "2026-11-15T10:00:00Z",
  policy_context_refs: [],
  correlation_id: context.correlation_id,
  idempotency_key: context.idempotency_key,
  ...overrides,
});
const principal: PrincipalContext = {
  principal_ref: actor,
  authentication_state: "AUTHENTICATED",
  organization_membership_refs: [ref("MEMBERSHIP", "membership-1")],
  role_binding_refs: [ref("ROLE_BINDING", "role-1")],
  delegation_refs: [],
  trust_assessment_refs: [],
  authority_source_refs: [{
    source_kind: "membership",
    object_ref: ref("MEMBERSHIP", "membership-1"),
    source_version: "3",
    observed_at: "2026-11-15T09:59:30Z",
  }],
  resolved_at: "2026-11-15T09:59:30Z",
  valid_until: "2026-11-15T10:05:00Z",
};
const facts: AuthorityFacts = {
  membership_state: "ACTIVE",
  entitlement_state: "ELIGIBLE",
  permission_state: "GRANTED",
  delegation_state: "NOT_REQUIRED",
  trust_assessment_state: "NOT_REQUIRED",
  external_authorization_state: "NOT_REQUIRED",
  verified_resource_scope_ref: scope,
  source_refs: [{
    source_kind: "membership",
    object_ref: ref("MEMBERSHIP", "membership-1"),
    source_version: "3",
    observed_at: "2026-11-15T09:59:30Z",
  }],
  observed_at: "2026-11-15T09:59:30Z",
  valid_until: "2026-11-15T10:05:00Z",
  current_resource_version: "1",
};
const policy: PolicyEvaluation = {
  effect: "ALLOW",
  policy_release: {
    policy_release_id: "policy-1",
    policy_family_id: "artifact-policy",
    policy_release_ref: ref("POLICY_RELEASE", "policy-1"),
    version: "1",
    state: "RELEASED",
    ruleset_digest: "sha256:policy",
    evaluator_contract_version: "1",
    effective_from: "2026-11-15T09:00:00Z",
    valid_until: "2026-11-15T10:10:00Z",
  },
  evaluator_version: "evaluator-1",
  reason_codes: ["POLICY_MATCHED"],
  conditions: [],
  obligations: [],
  valid_until: "2026-11-15T10:05:00Z",
  approval_required: true,
  approval_use_mode: "ONE_TIME",
  approval_expires_at: "2026-11-15T10:04:00Z",
  independent_approver_required: true,
  risk_assessment_required: true,
  trust_required: false,
};
const approval: ApprovalRecord = {
  approval_id: "approval-1",
  approval_ref: ref("APPROVAL", "approval-1"),
  request_ref: ref("AUTHORIZATION_REQUEST", "authorization-request-1"),
  request_binding_fingerprint: buildApprovalBindingFingerprint(authorizationRequest(), "ONE_TIME"),
  requested_by_ref: actor,
  approver_ref: { principal_id: "admin-1", principal_kind: "USER" },
  required_approver_constraints: ["INDEPENDENT_APPROVER"],
  action: "artifact.publish",
  resource_ref: ref("ARTIFACT", "artifact-1"),
  scope_ref: scope,
  environment_ref: ref("ENVIRONMENT", "production"),
  context_version_refs: [],
  policy_release_ref: ref("POLICY_RELEASE", "policy-1"),
  approval_use_mode: "ONE_TIME",
  state: "APPROVED",
  created_at: "2026-11-15T09:50:00Z",
  decided_at: "2026-11-15T09:55:00Z",
  expires_at: "2026-11-15T10:04:00Z",
};

function makeDependencies(currentFacts: AuthorityFacts = facts) {
  const commitCalls: Array<{ decision: AuthorizationDecision; command: DecisionCommitCommand }> = [];
  const sources: AuthorizationSourcePort = {
    resolvePrincipal: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: principal })),
    readAuthorityFacts: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: currentFacts })),
    evaluatePolicy: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: policy })),
    readApproval: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: approval, object_version: "1" })),
    readDelegation: vi.fn(async () => createOperationResult<DelegationRecord>({ status: "REJECTED", correlation_id: context.correlation_id })),
    readDelegationLineage: vi.fn(async () => createOperationResult<DelegationRecord[]>({ status: "REJECTED", correlation_id: context.correlation_id })),
    verifyApprover: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { authorized: true, independent_required: true, satisfied_constraints: ["INDEPENDENT_APPROVER"] } })),
    resolveDelegationGrantAuthority: vi.fn(async () => createOperationResult<DelegationGrantAuthority>({ status: "REJECTED", correlation_id: context.correlation_id })),
    verifyDelegationDecision: vi.fn(async (_ctx: RequestContext, _request: DelegationRequest) => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { valid: false } })),
    verifyDelegationRevoker: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { authorized: false } })),
    verifyDelegationLifecycleOperator: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { authorized: true } })),
    verifyApprovalRevoker: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { authorized: true } })),
    verifyApprovalLifecycleOperator: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { authorized: true } })),
    authenticatePrincipal: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: {
      authentication_result_id: "authn-1", state: "AUTHENTICATED" as const, principal_ref: actor,
      session_ref: ref("SESSION", "session-1"), authenticated_at: "2026-11-15T09:59:00Z",
      expires_at: "2026-11-15T10:10:00Z",
    } })),
    verifyAuthorityRevoker: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { authorized: true, source_version: "4" } })),
    readPolicyRelease: vi.fn(async (_ctx, policyRef) => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: {
      ...policy.policy_release, state: "APPROVED" as const, policy_release_ref: policyRef,
    } })),
    verifyPolicyReleaseOperator: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { authorized: true } })),
    checkEnforcementConditions: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { satisfied: true, unresolved_condition_ids: [] } })),
  };
  const repository: AuthorizationRepositoryPort = {
    commitDecision: vi.fn(async (_ctx, decision, _audit, command) => {
      commitCalls.push({ decision, command });
      return createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: decision });
    }),
    createApprovalWithEvent: vi.fn(async (_ctx, value) => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: value })),
    updateApprovalWithEvent: vi.fn(async (_ctx, value) => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: value })),
    createDelegationWithEvent: vi.fn(async (_ctx, value) => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: value })),
    updateDelegationWithEvent: vi.fn(async (_ctx, value) => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: value })),
    readDecision: vi.fn(async () => createOperationResult<AuthorizationDecision>({ status: "REJECTED", correlation_id: context.correlation_id, errors: [{ code: "NOT_FOUND_OR_NOT_VISIBLE", safe_message: "Not visible", retryable: false }] })),
    createRevocationWithEvent: vi.fn(async (_ctx, value) => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: value })),
    updateApprovalLifecycleWithEvent: vi.fn(async (_ctx, value) => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: value })),
    updatePolicyReleaseWithEvent: vi.fn(async (_ctx, value) => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: value })),
  };
  let nextId = 0;
  const deps: AuthorizationDependencies = {
    sources,
    repository,
    ids: { next: kind => kind + "-" + (++nextId) },
    clock: { now: () => "2026-11-15T10:00:30Z" },
  };
  return { deps, sources, repository, commitCalls };
}

describe("INV-06 authorization application boundary", () => {
  it("atomically includes a one-time approval claim with the decision, audit and outbox commit", async () => {
    const harness = makeDependencies();
    const request = authorizationRequest({ approval_ref: approval.approval_ref });
    const result = await recheckAuthorizationAtActionBoundary(harness.deps, context, request);
    expect(result.status).toBe("OK");
    expect(result.data?.result).toBe("ALLOW");
    expect(harness.commitCalls).toHaveLength(1);
    expect(harness.commitCalls[0].decision.audit_ref.object_kind).toBe("AUTHORIZATION_AUDIT");
    expect(harness.commitCalls[0].command.approval_claim).toEqual({
      approval_ref: approval.approval_ref,
      authorization_request_ref: ref("AUTHORIZATION_REQUEST", request.authorization_request_id),
      expected_version: "1",
      idempotency_key: context.idempotency_key,
      claimed_at: "2026-11-15T10:00:30Z",
    });
  });

  it("defers a protected action when a required enforcement condition is unsatisfied", async () => {
    const harness = makeDependencies();
    vi.mocked(harness.sources.evaluatePolicy).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: {
        ...policy,
        approval_required: false,
        conditions: [{ condition_id: "human-review", condition_kind: "HUMAN_REVIEW", must_hold_at_enforcement: true }],
      } }),
    );
    vi.mocked(harness.sources.checkEnforcementConditions).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: {
        satisfied: false, unresolved_condition_ids: ["human-review"],
      } }),
    );
    const result = await recheckAuthorizationAtActionBoundary(harness.deps, context, authorizationRequest());
    expect(result.status).toBe("REJECTED");
    expect(harness.commitCalls[0].decision.result).toBe("DEFER");
    expect(harness.commitCalls[0].decision.reason_codes).toContain("ENFORCEMENT_CONDITIONS_UNSATISFIED");
  });

  it("fails closed when an approval adapter omits the current concurrency version", async () => {
    const harness = makeDependencies();
    vi.mocked(harness.sources.readApproval).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: approval }),
    );
    const result = await recheckAuthorizationAtActionBoundary(
      harness.deps, context, authorizationRequest({ approval_ref: approval.approval_ref }),
    );
    expect(result.status).toBe("REJECTED");
    expect(harness.repository.commitDecision).not.toHaveBeenCalled();
  });

  it("uses the repository's current approval row version, not the stable reference version", async () => {
    const harness = makeDependencies();
    vi.mocked(harness.sources.readApproval).mockResolvedValue(
      createOperationResult({
        status: "OK",
        correlation_id: context.correlation_id,
        data: approval,
        object_version: "3",
      }),
    );
    const request = authorizationRequest({ approval_ref: approval.approval_ref });
    const result = await recheckAuthorizationAtActionBoundary(harness.deps, context, request);
    expect(result.status).toBe("OK");
    expect(approval.approval_ref.object_version).toBe("1");
    expect(harness.commitCalls[0].command.approval_claim?.expected_version).toBe("3");
  });

  it("does not claim a one-time approval when the resource version has changed", async () => {
    const harness = makeDependencies({ ...facts, current_resource_version: "2" });
    const request = authorizationRequest({ approval_ref: approval.approval_ref });
    const result = await recheckAuthorizationAtActionBoundary(harness.deps, context, request);
    expect(result.status).toBe("REJECTED");
    expect(harness.commitCalls).toHaveLength(1);
    expect(harness.commitCalls[0].decision.result).toBe("INDETERMINATE");
    expect(harness.commitCalls[0].command.approval_claim).toBeUndefined();
  });

  it("fails closed when current approver authority cannot be verified", async () => {
    const harness = makeDependencies();
    vi.mocked(harness.sources.verifyApprover).mockResolvedValue(
      createOperationResult({ status: "REJECTED", correlation_id: context.correlation_id }),
    );
    const request = authorizationRequest({ approval_ref: approval.approval_ref });
    const result = await recheckAuthorizationAtActionBoundary(harness.deps, context, request);
    expect(result.status).toBe("REJECTED");
    expect(harness.repository.commitDecision).not.toHaveBeenCalled();
  });

  it("fails closed on approval without independent approver proof when policy requires it", async () => {
    const harness = makeDependencies();
    vi.mocked(harness.sources.verifyApprover).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { authorized: true, independent_required: false, satisfied_constraints: [] } }),
    );
    const request = authorizationRequest({ approval_ref: approval.approval_ref });
    const result = await recheckAuthorizationAtActionBoundary(harness.deps, context, request);
    expect(result.status).toBe("REJECTED");
    expect(harness.commitCalls[0].decision.result).toBe("DENY");
    expect(harness.commitCalls[0].command.approval_claim).toBeUndefined();
  });

  it("rejects an authentication result whose session has already expired", async () => {
    const harness = makeDependencies();
    vi.mocked(harness.sources.authenticatePrincipal).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: {
        authentication_result_id: "authn-expired", state: "AUTHENTICATED" as const,
        principal_ref: actor, session_ref: ref("SESSION", "expired-session"),
        authenticated_at: "2026-11-15T09:00:00Z", expires_at: "2026-11-15T09:59:00Z",
      } }),
    );
    const authRequest = {
      authentication_request_id: "authn-request-expired",
      proof_ref: ref("AUTH_PROOF", "proof-expired"),
      requested_audience: "beamcore-api",
      requested_scope_ref: scope,
      requested_at: "2026-11-15T10:00:00Z",
      correlation_id: context.correlation_id,
    };
    expect((await authenticatePrincipal(harness.deps, context, authRequest)).status).toBe("REJECTED");
  });

  it("authenticates through the source adapter and rejects principal substitution", async () => {
    const harness = makeDependencies();
    const authRequest = {
      authentication_request_id: "authn-request-1",
      proof_ref: ref("AUTH_PROOF", "proof-1"),
      requested_audience: "beamcore-api",
      requested_scope_ref: scope,
      requested_at: "2026-11-15T10:00:00Z",
      correlation_id: context.correlation_id,
    };
    expect((await authenticatePrincipal(harness.deps, context, authRequest)).status).toBe("OK");
    vi.mocked(harness.sources.authenticatePrincipal).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: {
        authentication_result_id: "authn-2", state: "AUTHENTICATED",
        principal_ref: { principal_id: "intruder", principal_kind: "USER" },
        session_ref: ref("SESSION", "session-2"),
        authenticated_at: "2026-11-15T09:59:00Z", expires_at: "2026-11-15T10:10:00Z",
      } }),
    );
    expect((await authenticatePrincipal(harness.deps, context, authRequest)).status).toBe("REJECTED");
  });

  it("revokes authority only after verifying revoker authority and commits its event", async () => {
    const harness = makeDependencies();
    const result = await revokeAuthority(harness.deps, context, {
      subject_ref: ref("PRINCIPAL", "user-1", "4"),
      reason_code: "SECURITY_REVIEW",
      scope_ref: scope,
      expected_version: "4",
      idempotency_key: context.idempotency_key!,
    });
    expect(result.status).toBe("OK");
    expect(result.data?.source_version).toBe("4");
    expect(harness.repository.createRevocationWithEvent).toHaveBeenCalledTimes(1);

    vi.mocked(harness.sources.verifyAuthorityRevoker).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { authorized: false } }),
    );
    const denied = await revokeAuthority(harness.deps, context, {
      subject_ref: ref("PRINCIPAL", "user-1", "4"),
      reason_code: "SECURITY_REVIEW",
      scope_ref: scope,
      idempotency_key: "revocation-2",
    });
    expect(denied.status).toBe("REJECTED");
  });

  it("refuses a child delegation when its complete ancestor lineage cannot be verified", async () => {
    const harness = makeDependencies();
    const parentRef = ref("DELEGATION", "parent-delegation");
    const request: DelegationRequest = {
      delegation_ref: ref("DELEGATION", "child-delegation"),
      grantor_ref: actor,
      delegate_ref: { principal_id: "agent-child", principal_kind: "AGENT" },
      purpose: "read one artifact under inherited constraints",
      scope_ref: scope,
      allowed_actions: ["artifact.read"],
      resource_constraints: [ref("ARTIFACT", "artifact-1")],
      limits: ["daily-5"],
      conditions: [],
      not_before: "2026-11-15T10:00:30Z",
      expires_at: "2026-11-15T10:04:00Z",
      allow_subdelegation: false,
      parent_delegation_ref: parentRef,
      authorized_by_decision_ref: ref("AUTHORIZATION_DECISION", "child-grant"),
    };
    vi.mocked(harness.sources.resolveDelegationGrantAuthority).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: {
        grantor_authenticated: true,
        grantor_may_delegate: true,
        grantor_may_subdelegate: true,
        grantor_allowed_actions: ["artifact.read"],
        grantor_scope_ref: scope,
        grantor_resource_constraints: [ref("ARTIFACT", "artifact-1")],
        grantor_limits: ["daily-5"],
        grantor_conditions: [],
        valid_until: "2026-11-15T10:10:00Z",
      } }),
    );
    vi.mocked(harness.sources.verifyDelegationDecision).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { valid: true } }),
    );
    const result = await grantDelegation(harness.deps, context, request);
    expect(result.status).toBe("REJECTED");
    expect(harness.sources.readDelegationLineage).toHaveBeenCalledWith(context, parentRef);
    expect(harness.repository.createDelegationWithEvent).not.toHaveBeenCalled();
  });

  it("suspends a delegation only with current authority and expected version", async () => {
    const harness = makeDependencies();
    const delegation: DelegationRecord = {
      delegation_id: "delegation-1", delegation_ref: ref("DELEGATION", "delegation-1"),
      grantor_ref: actor, delegate_ref: { principal_id: "agent-1", principal_kind: "AGENT" },
      purpose: "read artifact", scope_ref: scope, allowed_actions: ["artifact.read"],
      resource_constraints: [ref("ARTIFACT", "artifact-1")], limits: [], conditions: [],
      not_before: "2026-11-15T09:00:00Z", expires_at: "2026-11-15T10:10:00Z",
      allow_subdelegation: false, authorized_by_decision_ref: ref("AUTHORIZATION_DECISION", "grant-decision"),
      state: "ACTIVE", created_at: "2026-11-15T09:00:00Z",
    };
    vi.mocked(harness.sources.readDelegation).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: delegation, object_version: "1" }),
    );
    const suspended = await suspendDelegation(harness.deps, context, delegation.delegation_ref, "1");
    expect(suspended.status).toBe("OK");
    expect(suspended.data?.state).toBe("SUSPENDED");
    expect(harness.repository.updateDelegationWithEvent).toHaveBeenCalledTimes(1);
  });

  it("reactivates a suspended delegation only after current grantor and cited decision revalidation", async () => {
    const harness = makeDependencies();
    const delegation: DelegationRecord = {
      delegation_id: "delegation-reactivate",
      delegation_ref: ref("DELEGATION", "delegation-reactivate"),
      grantor_ref: actor,
      delegate_ref: { principal_id: "agent-1", principal_kind: "AGENT" },
      purpose: "read artifact",
      scope_ref: scope,
      allowed_actions: ["artifact.read"],
      resource_constraints: [ref("ARTIFACT", "artifact-1")],
      limits: [],
      conditions: [],
      not_before: "2026-11-15T09:00:00Z",
      expires_at: "2026-11-15T10:10:00Z",
      allow_subdelegation: false,
      authorized_by_decision_ref: ref("AUTHORIZATION_DECISION", "delegation-grant"),
      state: "SUSPENDED",
      created_at: "2026-11-15T09:00:00Z",
    };
    vi.mocked(harness.sources.readDelegation).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: delegation, object_version: "2" }),
    );
    vi.mocked(harness.sources.resolveDelegationGrantAuthority).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: {
        grantor_authenticated: true,
        grantor_may_delegate: true,
        grantor_may_subdelegate: false,
        grantor_allowed_actions: ["artifact.read"],
        grantor_scope_ref: scope,
        grantor_resource_constraints: [ref("ARTIFACT", "artifact-1")],
        grantor_limits: [],
        grantor_conditions: [],
        valid_until: "2026-11-15T10:30:00Z",
      } }),
    );
    vi.mocked(harness.sources.verifyDelegationDecision).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { valid: true } }),
    );
    const result = await activateDelegation(harness.deps, context, delegation.delegation_ref, "2");
    expect(result.status).toBe("OK");
    expect(result.data?.state).toBe("ACTIVE");
    expect(harness.sources.resolveDelegationGrantAuthority).toHaveBeenCalledTimes(1);
    expect(harness.sources.verifyDelegationDecision).toHaveBeenCalledTimes(1);
  });

  it("refuses delegation reactivation when grantor no longer holds the delegated action", async () => {
    const harness = makeDependencies();
    const delegation: DelegationRecord = {
      delegation_id: "delegation-no-longer-authorized",
      delegation_ref: ref("DELEGATION", "delegation-no-longer-authorized"),
      grantor_ref: actor,
      delegate_ref: { principal_id: "agent-1", principal_kind: "AGENT" },
      purpose: "read artifact",
      scope_ref: scope,
      allowed_actions: ["artifact.read"],
      resource_constraints: [ref("ARTIFACT", "artifact-1")],
      limits: [],
      conditions: [],
      not_before: "2026-11-15T09:00:00Z",
      expires_at: "2026-11-15T10:10:00Z",
      allow_subdelegation: false,
      authorized_by_decision_ref: ref("AUTHORIZATION_DECISION", "delegation-grant"),
      state: "SUSPENDED",
      created_at: "2026-11-15T09:00:00Z",
    };
    vi.mocked(harness.sources.readDelegation).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: delegation, object_version: "2" }),
    );
    vi.mocked(harness.sources.resolveDelegationGrantAuthority).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: {
        grantor_authenticated: true,
        grantor_may_delegate: true,
        grantor_may_subdelegate: false,
        grantor_allowed_actions: [],
        grantor_scope_ref: scope,
        grantor_resource_constraints: [],
        grantor_limits: [],
        grantor_conditions: [],
        valid_until: "2026-11-15T10:30:00Z",
      } }),
    );
    vi.mocked(harness.sources.verifyDelegationDecision).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { valid: true } }),
    );
    const result = await activateDelegation(harness.deps, context, delegation.delegation_ref, "2");
    expect(result.status).toBe("REJECTED");
    expect(harness.repository.updateDelegationWithEvent).not.toHaveBeenCalled();
  });

  it("advances policy review only one verified stage at a time", async () => {
    const harness = makeDependencies();
    vi.mocked(harness.sources.readPolicyRelease).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id,
        data: { ...policy.policy_release, state: "VALIDATED" },
        object_version: "4" }),
    );
    const policyRef = { ...ref("POLICY_RELEASE", "policy-1"), object_version: "1" };
    const operation = {
      requested_by_ref: actor,
      change_ref: ref("POLICY_CHANGE", "change-review"),
      expected_version: "4",
      correlation_id: context.correlation_id,
      idempotency_key: context.idempotency_key!,
    };
    const result = await advancePolicyReleaseReviewStage(
      harness.deps, context, policyRef, "STATIC_ANALYSIS_PASSED", operation,
    );
    expect(result.status).toBe("OK");
    expect(result.data?.state).toBe("STATIC_ANALYSIS_PASSED");
    expect(harness.repository.updatePolicyReleaseWithEvent).toHaveBeenCalledWith(
      context, expect.objectContaining({ state: "STATIC_ANALYSIS_PASSED" }), "4",
      "policy.review_stage_static_analysis_passed", expect.any(Object), operation,
    );
  });

  it("rejects skipped policy review stages", async () => {
    const harness = makeDependencies();
    vi.mocked(harness.sources.readPolicyRelease).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id,
        data: { ...policy.policy_release, state: "VALIDATED" },
        object_version: "4" }),
    );
    const operation = {
      requested_by_ref: actor,
      change_ref: ref("POLICY_CHANGE", "change-skip"),
      expected_version: "4",
      correlation_id: context.correlation_id,
      idempotency_key: context.idempotency_key!,
    };
    const result = await advancePolicyReleaseReviewStage(
      harness.deps, context, { ...ref("POLICY_RELEASE", "policy-1"), object_version: "1" },
      "SCENARIO_TESTED", operation,
    );
    expect(result.status).toBe("REJECTED");
    expect(harness.repository.updatePolicyReleaseWithEvent).not.toHaveBeenCalled();
  });

  it("publishes a policy release only when impact and approval references are provided", async () => {
    const harness = makeDependencies();
    const policyRef = { ...ref("POLICY_RELEASE", "policy-1"), object_version: "1" };
    const operation = {
      requested_by_ref: actor, change_ref: ref("POLICY_CHANGE", "change-1"),
      impact_report_ref: ref("POLICY_IMPACT_REPORT", "impact-1"),
      approval_ref: ref("APPROVAL", "policy-approval-1"),
      expected_version: "1", correlation_id: context.correlation_id,
      idempotency_key: context.idempotency_key!,
    };
    const published = await publishPolicyRelease(harness.deps, context, policyRef, operation);
    expect(published.status).toBe("OK");
    expect(published.data?.state).toBe("RELEASED");
    expect(harness.repository.updatePolicyReleaseWithEvent).toHaveBeenCalledWith(
      context, expect.objectContaining({ state: "RELEASED" }), "1", "policy.version_released", expect.any(Object), operation,
    );
    const missingImpact = await publishPolicyRelease(harness.deps, context, policyRef, {
      ...operation, impact_report_ref: undefined,
    });
    expect(missingImpact.status).toBe("REJECTED");
  });

  it("creates an approval with the canonical binding of the exact reviewed request", async () => {
    const harness = makeDependencies();
    const request = authorizationRequest();
    const result = await requestApproval(harness.deps, context, request);
    expect(result.status).toBe("OK");
    expect(result.data?.request_binding_fingerprint).toBe(buildApprovalBindingFingerprint(request, "ONE_TIME"));
    expect(harness.repository.createApprovalWithEvent).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        request_binding_fingerprint: buildApprovalBindingFingerprint(request, "ONE_TIME"),
        action: request.action,
        resource_ref: request.resource_ref,
        environment_ref: request.environment_ref,
      }),
      expect.objectContaining({ request_fingerprint: buildCanonicalRequestFingerprint(request) }),
    );
  });

  it("does not create an approval when policy changes after the preflight decision", async () => {
    const harness = makeDependencies();
    let evaluationCount = 0;
    vi.mocked(harness.sources.evaluatePolicy).mockImplementation(async () => {
      evaluationCount += 1;
      const selectedPolicy = evaluationCount === 1 ? policy : {
        ...policy,
        policy_release: {
          ...policy.policy_release,
          policy_release_ref: ref("POLICY_RELEASE", "policy-1", "2"),
          version: "2",
          ruleset_digest: "sha256:policy-v2",
        },
      };
      return createOperationResult({
        status: "OK",
        correlation_id: context.correlation_id,
        data: selectedPolicy,
      });
    });
    const result = await requestApproval(harness.deps, context, authorizationRequest());
    expect(result.status).toBe("REJECTED");
    expect(result.errors[0]?.code).toBe("VERSION_CONFLICT");
    expect(harness.repository.createApprovalWithEvent).not.toHaveBeenCalled();
  });

  it("does not create an approval when current policy does not require one", async () => {
    const harness = makeDependencies();
    vi.mocked(harness.sources.evaluatePolicy).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: {
        ...policy, approval_required: false,
      } }),
    );
    const result = await requestApproval(harness.deps, context, authorizationRequest());
    expect(result.status).toBe("REJECTED");
    expect(harness.repository.createApprovalWithEvent).not.toHaveBeenCalled();
  });

  it("rejects an approval decision when the approver's current authority is stale or revoked", async () => {
    const harness = makeDependencies();
    const pending = { ...approval, state: "PENDING" as const };
    vi.mocked(harness.sources.readApproval).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: pending, object_version: "2" }),
    );
    vi.mocked(harness.sources.verifyApprover).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: {
        authorized: false, independent_required: true, satisfied_constraints: [],
      } }),
    );
    const approverContext = {
      ...context,
      actor_ref: approval.approver_ref!,
      idempotency_key: "approval-decision-stale",
    };
    const input = {
      approval_ref: approval.approval_ref,
      approver_ref: approval.approver_ref!,
      decision: "APPROVE" as const,
      expected_version: "2",
      idempotency_key: approverContext.idempotency_key!,
      decided_at: "2026-11-15T10:00:20Z",
    };
    const result = await decideApprovalRequest(
      harness.deps, approverContext, approval.approval_ref, input, "2",
    );
    expect(result.status).toBe("REJECTED");
    expect(harness.repository.updateApprovalWithEvent).not.toHaveBeenCalled();
  });

  it("records an approval decision only when every required approver constraint is proven", async () => {
    const harness = makeDependencies();
    const pending = { ...approval, state: "PENDING" as const };
    vi.mocked(harness.sources.readApproval).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: pending, object_version: "2" }),
    );
    vi.mocked(harness.sources.verifyApprover).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: {
        authorized: true,
        independent_required: true,
        satisfied_constraints: ["INDEPENDENT_APPROVER"],
      } }),
    );
    const approverContext = {
      ...context,
      actor_ref: approval.approver_ref!,
      idempotency_key: "approval-decision-valid",
    };
    const input = {
      approval_ref: approval.approval_ref,
      approver_ref: approval.approver_ref!,
      decision: "APPROVE" as const,
      expected_version: "2",
      idempotency_key: approverContext.idempotency_key!,
      decided_at: "2026-11-15T10:01:00Z",
    };
    const result = await decideApprovalRequest(
      harness.deps, approverContext, approval.approval_ref, input, "2",
    );
    expect(result.status, JSON.stringify(result.errors)).toBe("OK");
    expect(result.data?.state).toBe("APPROVED");
    expect(harness.repository.updateApprovalWithEvent).toHaveBeenCalledTimes(1);
  });

  it("revokes an approval only after lifecycle authority is verified", async () => {
    const harness = makeDependencies();
    const result = await revokeApproval(harness.deps, context, approval.approval_ref, "1");
    expect(result.status).toBe("OK");
    expect(result.data?.state).toBe("REVOKED");
    expect(harness.repository.updateApprovalLifecycleWithEvent).toHaveBeenCalledWith(
      context, expect.objectContaining({ state: "REVOKED" }), "1", "approval.revoked", expect.any(Object),
    );
  });

  it("expires an approval only after its policy-derived expiry has passed", async () => {
    const harness = makeDependencies();
    vi.mocked(harness.sources.readApproval).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id,
        data: { ...approval, expires_at: "2026-11-15T10:00:00Z" }, object_version: "1" }),
    );
    const result = await expireApproval(harness.deps, context, approval.approval_ref, "1");
    expect(result.status).toBe("OK");
    expect(result.data?.state).toBe("EXPIRED");
  });

  it("moves a released policy into monitoring with a dedicated lifecycle event", async () => {
    const harness = makeDependencies();
    vi.mocked(harness.sources.readPolicyRelease).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id,
        data: { ...policy.policy_release, state: "RELEASED" },
        object_version: "2" }),
    );
    const policyRef = { ...ref("POLICY_RELEASE", "policy-1"), object_version: "1" };
    const operation = {
      requested_by_ref: actor,
      change_ref: ref("POLICY_CHANGE", "monitor-change"),
      expected_version: "2",
      correlation_id: context.correlation_id,
      idempotency_key: context.idempotency_key!,
    };
    const result = await beginPolicyReleaseMonitoring(harness.deps, context, policyRef, operation);
    expect(result.status).toBe("OK");
    expect(result.data?.state).toBe("MONITORING");
    expect(harness.repository.updatePolicyReleaseWithEvent).toHaveBeenCalledWith(
      context, expect.objectContaining({ state: "MONITORING" }), "2",
      "policy.version_monitoring", expect.any(Object), operation,
    );
  });

  it("suspends a monitoring policy release under current authority with a reason", async () => {
    const harness = makeDependencies();
    vi.mocked(harness.sources.readPolicyRelease).mockResolvedValue(
      createOperationResult({ status: "OK", correlation_id: context.correlation_id,
        data: { ...policy.policy_release, state: "MONITORING" },
        object_version: "1" }),
    );
    const policyRef = { ...ref("POLICY_RELEASE", "policy-1"), object_version: "1" };
    const operation = {
      requested_by_ref: actor,
      change_ref: ref("POLICY_CHANGE", "change-suspend"),
      reason_code: "POLICY_CONFLICT",
      expected_version: "1",
      correlation_id: context.correlation_id,
      idempotency_key: context.idempotency_key!,
    };
    const result = await suspendPolicyRelease(harness.deps, context, policyRef, operation);
    expect(result.status).toBe("OK");
    expect(result.data?.state).toBe("SUSPENDED");
    expect(harness.repository.updatePolicyReleaseWithEvent).toHaveBeenCalledWith(
      context, expect.objectContaining({ state: "SUSPENDED" }), "1",
      "policy.version_suspended", expect.any(Object), operation,
    );
  });

  it("masks unavailable and out-of-scope decision reads with the same response", async () => {
    const harness = makeDependencies();
    const hidden = await getAuthorityDecision(harness.deps, context, {
      ...ref("AUTHORIZATION_DECISION", "another-tenant"), scope_ref: { scope_id: "other", scope_kind: "ORGANIZATION" },
    });
    expect(hidden.status).toBe("REJECTED");
    expect(harness.repository.readDecision).not.toHaveBeenCalled();
    const explanation = await explainDenialSafe(harness.deps, context, ref("AUTHORIZATION_DECISION", "missing"));
    expect(explanation.status).toBe("REJECTED");
  });

  it("rejects request idempotency mismatch before consulting authority providers", async () => {
    const harness = makeDependencies();
    const request = authorizationRequest({ idempotency_key: "different-key" });
    const result = await recheckAuthorizationAtActionBoundary(harness.deps, context, request);
    expect(result.status).toBe("REJECTED");
    expect(harness.sources.resolvePrincipal).not.toHaveBeenCalled();
  });
});
