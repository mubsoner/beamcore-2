import { describe, expect, it, vi } from "vitest";
import { createOperationResult, type ObjectRef, type PrincipalRef, type RequestContext, type ScopeRef } from "../shared";
import {
  recheckAuthorizationAtActionBoundary,
  type AuthorizationDependencies,
  type AuthorizationRepositoryPort,
  type AuthorizationSourcePort,
  type DecisionCommitCommand,
} from "./application";
import type {
  ApprovalRecord,
  AuthorizationDecision,
  AuthorizationRequest,
  AuthorityFacts,
  DelegationGrantAuthority,
  DelegationRecord,
  DelegationRequest,
  PolicyEvaluation,
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
    readApproval: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: approval })),
    readDelegation: vi.fn(async () => createOperationResult<DelegationRecord>({ status: "REJECTED", correlation_id: context.correlation_id })),
    verifyApprover: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { authorized: true, independent_required: true } })),
    resolveDelegationGrantAuthority: vi.fn(async () => createOperationResult<DelegationGrantAuthority>({ status: "REJECTED", correlation_id: context.correlation_id })),
    verifyDelegationDecision: vi.fn(async (_ctx: RequestContext, _request: DelegationRequest) => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { valid: false } })),
    verifyDelegationRevoker: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { authorized: false } })),
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
    expect(harness.commitCalls[0].command.approval_claim).toEqual({
      approval_ref: approval.approval_ref,
      authorization_request_ref: ref("AUTHORIZATION_REQUEST", request.authorization_request_id),
      expected_version: "1",
      idempotency_key: context.idempotency_key,
      claimed_at: "2026-11-15T10:00:30Z",
    });
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
      createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { authorized: true, independent_required: false } }),
    );
    const request = authorizationRequest({ approval_ref: approval.approval_ref });
    const result = await recheckAuthorizationAtActionBoundary(harness.deps, context, request);
    expect(result.status).toBe("REJECTED");
    expect(harness.commitCalls[0].decision.result).toBe("DENY");
    expect(harness.commitCalls[0].command.approval_claim).toBeUndefined();
  });

  it("rejects request idempotency mismatch before consulting authority providers", async () => {
    const harness = makeDependencies();
    const request = authorizationRequest({ idempotency_key: "different-key" });
    const result = await recheckAuthorizationAtActionBoundary(harness.deps, context, request);
    expect(result.status).toBe("REJECTED");
    expect(harness.sources.resolvePrincipal).not.toHaveBeenCalled();
  });
});
