import {
  createOperationError,
  createOperationResult,
  isObjectRef,
  isPrincipalRef,
  isRequestContext,
  isScopeRef,
  isTimestamp,
  isVersion,
  sameObjectRef,
  sameScopeRef,
  type ObjectRef,
  type OperationResult,
  type PrincipalRef,
  type RequestContext,
  type ScopeRef,
  type Timestamp,
  type Version,
} from "../shared";

export const AUTHORIZATION_RESULTS = [
  "ALLOW", "DENY", "REQUIRE_APPROVAL", "REQUIRE_REAUTH",
  "RESTRICT", "QUARANTINE", "DEFER", "INDETERMINATE",
] as const;
export type AuthorizationResult = (typeof AUTHORIZATION_RESULTS)[number];

export const AUTHENTICATION_STATES = [
  "AUTHENTICATED", "UNAUTHENTICATED", "STEP_UP_REQUIRED",
  "EXPIRED", "REVOKED", "INDETERMINATE",
] as const;
export type AuthenticationState = (typeof AUTHENTICATION_STATES)[number];

export const POLICY_EFFECTS = [
  "ALLOW", "DENY", "REQUIRE_APPROVAL", "REQUIRE_REAUTH",
  "RESTRICT", "QUARANTINE", "DEFER", "UNKNOWN",
] as const;
export type PolicyEffect = (typeof POLICY_EFFECTS)[number];

export const APPROVAL_STATES = [
  "PENDING", "APPROVED", "REJECTED", "EXPIRED", "REVOKED", "CONSUMED",
] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];
export type ApprovalUseMode = "ONE_TIME" | "REUSABLE_WITHIN_SCOPE";

export const DELEGATION_STATES = [
  "PENDING_APPROVAL", "SCHEDULED", "ACTIVE", "SUSPENDED", "REVOKED", "EXPIRED",
] as const;
export type DelegationState = (typeof DELEGATION_STATES)[number];

export const POLICY_RELEASE_STATES = [
  "DRAFT", "VALIDATED", "STATIC_ANALYSIS_PASSED", "SCENARIO_TESTED",
  "CONFLICT_TESTED", "REGRESSION_TESTED", "IMPACT_REVIEWED", "APPROVED",
  "RELEASED", "MONITORING", "SUSPENDED", "RETIRED",
] as const;
export type PolicyReleaseState = (typeof POLICY_RELEASE_STATES)[number];

export const TRUST_STATES = [
  "UNKNOWN", "OBSERVED", "EVALUATED", "TRUSTED_FOR_SCOPE",
  "MONITORED", "RESTRICTED", "SUSPENDED", "REVOKED",
] as const;
export type TrustState = (typeof TRUST_STATES)[number];
export type RiskAssessmentState = "NOT_ASSESSED" | "ASSESSED" | "INDETERMINATE";
export type MembershipState = "ACTIVE" | "SUSPENDED" | "REVOKED" | "UNKNOWN";
export type EntitlementState = "ELIGIBLE" | "INELIGIBLE" | "NOT_REQUIRED" | "UNKNOWN";
export type PermissionState = "GRANTED" | "NOT_GRANTED" | "UNKNOWN";
export type ExternalAuthorizationState = "AUTHORIZED" | "DENIED" | "NOT_REQUIRED" | "UNKNOWN";

export interface AuthoritySourceRef {
  source_kind: string;
  object_ref: ObjectRef;
  source_version?: Version;
  observed_at: Timestamp;
}

export interface PrincipalContext {
  principal_ref: PrincipalRef;
  /** Verified service identity acting alongside the human/agent principal, when present. */
  service_identity_ref?: PrincipalRef;
  authentication_state: AuthenticationState;
  session_ref?: ObjectRef;
  assurance_context_ref?: ObjectRef;
  organization_membership_refs: ObjectRef[];
  role_binding_refs: ObjectRef[];
  delegation_refs: ObjectRef[];
  trust_assessment_refs: ObjectRef[];
  authority_source_refs: AuthoritySourceRef[];
  resolved_at: Timestamp;
  valid_until?: Timestamp;
}

export interface RiskContext {
  assessment_state: RiskAssessmentState;
  impact_dimensions: string[];
  reversibility?: string;
  sensitivity_refs: ObjectRef[];
  uncertainty_flags: string[];
  scope_blast_radius_refs: ObjectRef[];
  risk_assessment_ref?: ObjectRef;
  assessed_at?: Timestamp;
  valid_until?: Timestamp;
}

export interface AuthorizationRequest {
  authorization_request_id: string;
  actor_ref: PrincipalRef;
  service_identity_ref?: PrincipalRef;
  action: string;
  resource_ref: ObjectRef;
  scope_ref: ScopeRef;
  environment_ref: ObjectRef;
  work_ref?: ObjectRef;
  plan_revision_ref?: ObjectRef;
  graph_revision_ref?: ObjectRef;
  execution_ref?: ObjectRef;
  capability_ref?: ObjectRef;
  delegation_ref?: ObjectRef;
  approval_ref?: ObjectRef;
  risk_context: RiskContext;
  action_arguments_digest?: string;
  requested_at: Timestamp;
  deadline?: Timestamp;
  expected_resource_version?: Version;
  policy_context_refs: ObjectRef[];
  correlation_id: string;
  causation_id?: string;
  idempotency_key?: string;
}

export interface DecisionCondition {
  condition_id: string;
  condition_kind: string;
  parameters_ref?: ObjectRef;
  must_hold_at_enforcement: boolean;
}

export interface AuthenticationRequest {
  authentication_request_id: string;
  proof_ref: ObjectRef;
  requested_audience: string;
  requested_scope_ref: ScopeRef;
  client_or_service_ref?: PrincipalRef;
  requested_at: Timestamp;
  correlation_id: string;
}

export interface AuthenticationResult {
  authentication_result_id: string;
  state: AuthenticationState;
  principal_ref?: PrincipalRef;
  session_ref?: ObjectRef;
  assurance_context_ref?: ObjectRef;
  authenticated_at?: Timestamp;
  expires_at?: Timestamp;
  reason_code?: string;
  authority_source_ref?: AuthoritySourceRef;
}

export interface PolicyReleaseOperationContext {
  requested_by_ref: PrincipalRef;
  change_ref: ObjectRef;
  impact_report_ref?: ObjectRef;
  approval_ref?: ObjectRef;
  reason_code?: string;
  expected_version?: Version;
  correlation_id: string;
  idempotency_key: string;
}

export interface AuthorityRevocationRequest {
  subject_ref: ObjectRef;
  reason_code: string;
  scope_ref: ScopeRef;
  expected_version?: Version;
  idempotency_key: string;
  effective_at?: Timestamp;
}

export interface RevocationRecord {
  revocation_ref: ObjectRef;
  subject_ref: ObjectRef;
  reason_code: string;
  requested_by_ref: PrincipalRef;
  effective_at: Timestamp;
  source_version?: Version;
  affected_scope_refs: ScopeRef[];
  correlation_id: string;
}

export interface PolicyRelease {
  policy_release_id: string;
  policy_family_id: string;
  policy_release_ref: ObjectRef;
  version: Version;
  state: PolicyReleaseState;
  ruleset_digest: string;
  evaluator_contract_version: string;
  effective_from?: Timestamp;
  valid_until?: Timestamp;
  suspended_at?: Timestamp;
  retired_at?: Timestamp;
}

export interface ApprovalRecord {
  approval_id: string;
  approval_ref: ObjectRef;
  request_ref: ObjectRef;
  /** Canonical fingerprint of the original action request, excluding the approval_ref itself. */
  request_binding_fingerprint: string;
  requested_by_ref: PrincipalRef;
  approver_ref?: PrincipalRef;
  required_approver_constraints: string[];
  action: string;
  resource_ref: ObjectRef;
  scope_ref: ScopeRef;
  environment_ref: ObjectRef;
  work_ref?: ObjectRef;
  context_version_refs: ObjectRef[];
  policy_release_ref: ObjectRef;
  approval_use_mode: ApprovalUseMode;
  state: ApprovalState;
  reason_ref?: ObjectRef;
  evidence_method_ref?: ObjectRef;
  created_at: Timestamp;
  decided_at?: Timestamp;
  valid_from?: Timestamp;
  expires_at?: Timestamp;
  revoked_at?: Timestamp;
  consumed_at?: Timestamp;
  consumed_by_request_ref?: ObjectRef;
}

export interface DelegationRecord {
  delegation_id: string;
  delegation_ref: ObjectRef;
  grantor_ref: PrincipalRef;
  delegate_ref: PrincipalRef;
  purpose: string;
  scope_ref: ScopeRef;
  allowed_actions: string[];
  resource_constraints: ObjectRef[];
  limits: string[];
  conditions: DecisionCondition[];
  not_before: Timestamp;
  expires_at: Timestamp;
  allow_subdelegation: boolean;
  parent_delegation_ref?: ObjectRef;
  authorized_by_decision_ref: ObjectRef;
  state: DelegationState;
  created_at: Timestamp;
  revoked_at?: Timestamp;
}

export interface TrustAssessment {
  trust_assessment_ref: ObjectRef;
  subject_ref: ObjectRef;
  trust_state: TrustState;
  trusted_scope_ref?: ScopeRef;
  basis_refs: ObjectRef[];
  restrictions: string[];
  assessed_at: Timestamp;
  valid_until?: Timestamp;
}

export interface AuthorityFacts {
  membership_state: MembershipState;
  entitlement_state: EntitlementState;
  permission_state: PermissionState;
  delegation_state: "VALID" | "INVALID" | "NOT_REQUIRED" | "UNKNOWN";
  trust_assessment_state: "VALID" | "INVALID" | "NOT_REQUIRED" | "UNKNOWN";
  external_authorization_state: ExternalAuthorizationState;
  verified_resource_scope_ref: ScopeRef;
  verified_delegation_ref?: ObjectRef;
  source_refs: AuthoritySourceRef[];
  observed_at: Timestamp;
  valid_until?: Timestamp;
  current_resource_version?: Version;
}

export interface PolicyEvaluation {
  effect: PolicyEffect;
  policy_release: PolicyRelease;
  evaluator_version: string;
  reason_codes: string[];
  safe_message?: string;
  conditions: DecisionCondition[];
  obligations: string[];
  valid_until?: Timestamp;
  approval_required: boolean;
  approval_use_mode?: ApprovalUseMode;
  approval_expires_at?: Timestamp;
  independent_approver_required: boolean;
  risk_assessment_required: boolean;
  trust_required: boolean;
  constrained_action?: string;
  constrained_resource_ref?: ObjectRef;
  constrained_environment_ref?: ObjectRef;
}

export interface AuthorizationDecision {
  decision_ref: ObjectRef;
  decision_id: string;
  request_ref: ObjectRef;
  result: AuthorizationResult;
  policy_release_ref?: ObjectRef;
  policy_version?: Version;
  evaluator_version?: string;
  authority_fingerprint: string;
  request_fingerprint: string;
  approval_use_mode?: ApprovalUseMode;
  applicable_scope_ref: ScopeRef;
  constrained_action?: string;
  constrained_resource_ref?: ObjectRef;
  constrained_environment_ref?: ObjectRef;
  conditions: DecisionCondition[];
  obligations: string[];
  reason_codes: string[];
  related_approval_refs: ObjectRef[];
  authority_source_refs: AuthoritySourceRef[];
  evaluated_at: Timestamp;
  valid_until?: Timestamp;
  recheck_before_effect: boolean;
  audit_ref: ObjectRef;
}

export interface PolicyEvaluationAudit {
  audit_ref: ObjectRef;
  request_ref: ObjectRef;
  decision_ref: ObjectRef;
  actor_ref: PrincipalRef;
  service_identity_ref?: PrincipalRef;
  action: string;
  target_ref: ObjectRef;
  resource_version?: Version;
  environment_ref: ObjectRef;
  scope_ref: ScopeRef;
  work_ref?: ObjectRef;
  plan_revision_ref?: ObjectRef;
  graph_revision_ref?: ObjectRef;
  execution_ref?: ObjectRef;
  capability_ref?: ObjectRef;
  delegation_ref?: ObjectRef;
  approval_refs: ObjectRef[];
  risk_assessment_ref?: ObjectRef;
  policy_release_ref?: ObjectRef;
  authority_fingerprint: string;
  reason_codes: string[];
  source_version_refs: ObjectRef[];
  evaluated_at: Timestamp;
  correlation_id: string;
  causation_id?: string;
}

export interface ApprovalUseResult {
  approval_ref: ObjectRef;
  authorization_request_ref: ObjectRef;
  use_mode: ApprovalUseMode;
  claim_status: "CLAIMED" | "ALREADY_CLAIMED" | "REJECTED" | "UNKNOWN";
  claimed_at?: Timestamp;
  consumed_at?: Timestamp;
  version?: Version;
}

export interface ApprovalDecisionInput {
  approval_ref: ObjectRef;
  approver_ref: PrincipalRef;
  decision: "APPROVE" | "REJECT";
  reason_ref?: ObjectRef;
  evidence_method_ref?: ObjectRef;
  expected_version: Version;
  idempotency_key: string;
  decided_at: Timestamp;
}

export interface DelegationRequest {
  delegation_ref: ObjectRef;
  grantor_ref: PrincipalRef;
  delegate_ref: PrincipalRef;
  purpose: string;
  scope_ref: ScopeRef;
  allowed_actions: string[];
  resource_constraints: ObjectRef[];
  limits: string[];
  conditions: DecisionCondition[];
  not_before: Timestamp;
  expires_at: Timestamp;
  allow_subdelegation: boolean;
  parent_delegation_ref?: ObjectRef;
  authorized_by_decision_ref: ObjectRef;
}

export interface DelegationGrantAuthority {
  grantor_authenticated: boolean;
  grantor_may_delegate: boolean;
  grantor_may_subdelegate: boolean;
  grantor_allowed_actions: string[];
  grantor_scope_ref: ScopeRef;
  grantor_resource_constraints: ObjectRef[];
  /** Every inherited grantor limit must remain attached to the child delegation. */
  grantor_limits: string[];
  /** Every inherited must-hold condition must remain attached to the child delegation. */
  grantor_conditions: DecisionCondition[];
  grantor_valid_from?: Timestamp;
  valid_until?: Timestamp;
}

export interface SafeDecisionExplanation {
  decision_ref: ObjectRef;
  result: AuthorizationResult;
  safe_message: string;
  visible_reason_codes: string[];
  permitted_next_step:
    | "NONE" | "REAUTHENTICATE" | "REQUEST_APPROVAL"
    | "NARROW_REQUEST" | "WAIT_AND_RECHECK" | "CONTACT_ADMIN";
  user_visible_refs: ObjectRef[];
}

export function isAuthorizationResult(value: unknown): value is AuthorizationResult {
  return typeof value === "string" &&
    (AUTHORIZATION_RESULTS as readonly string[]).includes(value);
}

export function validateAuthorizationRequest(
  context: RequestContext,
  request: AuthorizationRequest,
): string[] {
  const issues: string[] = [];
  if (!isRequestContext(context)) issues.push("request context is invalid");
  if (!request || typeof request !== "object") return [...issues, "authorization request is required"];
  if (!request.authorization_request_id?.trim()) issues.push("authorization_request_id is required");
  if (!isPrincipalRef(request.actor_ref)) issues.push("actor_ref is invalid");
  else if (request.actor_ref.principal_id !== context.actor_ref.principal_id ||
    request.actor_ref.principal_kind !== context.actor_ref.principal_kind) {
    issues.push("actor_ref must match the authenticated request actor");
  }
  if (!request.action?.trim()) issues.push("action is required");
  if (!isObjectRef(request.resource_ref)) issues.push("resource_ref is invalid");
  if (!isScopeRef(request.scope_ref)) issues.push("scope_ref is invalid");
  if (isScopeRef(request.scope_ref) && !sameScopeRef(request.scope_ref, context.scope_ref)) {
    issues.push("authorization scope must match the authenticated request scope");
  }
  if (isObjectRef(request.resource_ref) && isScopeRef(request.scope_ref) &&
    !sameScopeRef(request.resource_ref.scope_ref, request.scope_ref)) {
    issues.push("resource scope does not match the requested scope");
  }
  if (!isObjectRef(request.environment_ref)) issues.push("environment_ref is invalid");
  if (isObjectRef(request.environment_ref) && isScopeRef(request.scope_ref) &&
    !sameScopeRef(request.environment_ref.scope_ref, request.scope_ref)) {
    issues.push("environment scope does not match the requested scope");
  }
  if (!isTimestamp(request.requested_at)) issues.push("requested_at is invalid");
  if (request.deadline !== undefined && !isTimestamp(request.deadline)) issues.push("deadline is invalid");
  else if (request.deadline && Date.parse(request.deadline) <= Date.parse(request.requested_at)) {
    issues.push("deadline must be later than requested_at");
  }
  if (request.expected_resource_version !== undefined && !isVersion(request.expected_resource_version)) {
    issues.push("expected_resource_version is invalid");
  }
  if (request.expected_resource_version !== undefined &&
    request.resource_ref.object_version !== undefined &&
    request.expected_resource_version !== request.resource_ref.object_version) {
    issues.push("expected_resource_version does not match resource_ref version");
  }
  if (!Array.isArray(request.policy_context_refs) ||
    !request.policy_context_refs.every(ref => isObjectRef(ref) && isScopeWithin(ref.scope_ref, request.scope_ref))) {
    issues.push("policy_context_refs are invalid or outside the request scope");
  }
  if (!request.correlation_id?.trim() || request.correlation_id !== context.correlation_id) {
    issues.push("correlation_id must match the request context");
  }
  if (request.causation_id !== undefined && !request.causation_id.trim()) issues.push("causation_id is invalid");
  if (request.idempotency_key !== undefined && !request.idempotency_key.trim()) issues.push("idempotency_key is invalid");
  if (request.service_identity_ref !== undefined && !isPrincipalRef(request.service_identity_ref)) {
    issues.push("service_identity_ref is invalid");
  }
  for (const [name, value] of Object.entries({
    work_ref: request.work_ref,
    plan_revision_ref: request.plan_revision_ref,
    graph_revision_ref: request.graph_revision_ref,
    execution_ref: request.execution_ref,
    capability_ref: request.capability_ref,
    delegation_ref: request.delegation_ref,
    approval_ref: request.approval_ref,
  })) {
    if (value !== undefined && !isObjectRef(value)) issues.push(`${name} is invalid`);
    else if (value && isObjectRef(value) && !sameScopeRef(value.scope_ref, request.scope_ref)) {
      issues.push(`${name} is outside the authorization scope`);
    }
  }
  if (!request.risk_context ||
    !["NOT_ASSESSED", "ASSESSED", "INDETERMINATE"].includes(request.risk_context.assessment_state) ||
    !Array.isArray(request.risk_context.impact_dimensions) ||
    !Array.isArray(request.risk_context.sensitivity_refs) ||
    !request.risk_context.sensitivity_refs.every(ref => isObjectRef(ref) && isScopeWithin(ref.scope_ref, request.scope_ref)) ||
    !Array.isArray(request.risk_context.uncertainty_flags) ||
    !Array.isArray(request.risk_context.scope_blast_radius_refs) ||
    !request.risk_context.scope_blast_radius_refs.every(ref => isObjectRef(ref) && isScopeWithin(ref.scope_ref, request.scope_ref)) ||
    (request.risk_context.risk_assessment_ref !== undefined &&
      (!isObjectRef(request.risk_context.risk_assessment_ref) ||
       !isScopeWithin(request.risk_context.risk_assessment_ref.scope_ref, request.scope_ref))) {
    issues.push("risk_context is invalid");
  } else {
    if (request.risk_context.assessment_state === "ASSESSED" &&
      (!isTimestamp(request.risk_context.assessed_at) ||
       (request.risk_context.valid_until !== undefined && !isTimestamp(request.risk_context.valid_until)))) {
      issues.push("assessed risk context must include valid assessment timestamps");
    }
  }
  if (request.action_arguments_digest !== undefined &&
    !/^sha256:[a-f0-9]{64}$/i.test(request.action_arguments_digest)) {
    issues.push("action_arguments_digest must be a SHA-256 digest");
  }
  return issues;
}

export function validateAuthenticationRequest(request: AuthenticationRequest): string[] {
  const issues: string[] = [];
  if (!request || typeof request !== "object") return ["authentication request is required"];
  if (!request.authentication_request_id?.trim() ||
      !isObjectRef(request.proof_ref) ||
      !request.requested_audience?.trim() ||
      !isScopeRef(request.requested_scope_ref) ||
      !isTimestamp(request.requested_at) ||
      !request.correlation_id?.trim() ||
      (request.client_or_service_ref !== undefined && !isPrincipalRef(request.client_or_service_ref))) {
    issues.push("authentication request is malformed");
  }
  return issues;
}

export function validateAuthenticationResult(
  request: AuthenticationRequest,
  result: AuthenticationResult,
): string[] {
  const issues: string[] = validateAuthenticationRequest(request);
  if (!result || typeof result !== "object") {
    return [...issues, "authentication result is required"];
  }
  if (!result.authentication_result_id?.trim() ||
      !(AUTHENTICATION_STATES as readonly string[]).includes(result.state)) {
    issues.push("authentication result identity or state is invalid");
  }
  if (result.state === "AUTHENTICATED") {
    if (!isPrincipalRef(result.principal_ref) ||
        !isObjectRef(result.session_ref) ||
        !isScopeWithin(result.session_ref.scope_ref, request.requested_scope_ref) ||
        !isTimestamp(result.authenticated_at) ||
        !isTimestamp(result.expires_at) ||
        Date.parse(result.expires_at) <= Date.parse(result.authenticated_at)) {
      issues.push("successful authentication requires principal, session and bounded validity");
    }
  }
  if (result.state !== "AUTHENTICATED" && result.principal_ref !== undefined) {
    issues.push("non-authenticated result cannot assert an authenticated principal");
  }
  if (result.assurance_context_ref !== undefined &&
      (!isObjectRef(result.assurance_context_ref) ||
       !isScopeWithin(result.assurance_context_ref.scope_ref, request.requested_scope_ref))) {
    issues.push("authentication assurance reference is invalid or outside the requested scope");
  }
  if (result.authority_source_ref !== undefined &&
      (!result.authority_source_ref.source_kind?.trim() ||
       !isObjectRef(result.authority_source_ref.object_ref) ||
       !isScopeWithin(result.authority_source_ref.object_ref.scope_ref, request.requested_scope_ref) ||
       !isTimestamp(result.authority_source_ref.observed_at))) {
    issues.push("authentication source provenance is invalid");
  }
  return issues;
}

export function validatePrincipalContext(
  context: RequestContext,
  principal: PrincipalContext,
  now: Timestamp,
): string[] {
  const issues: string[] = [];
  if (!principal || !isPrincipalRef(principal.principal_ref)) return ["principal context is invalid"];
  if (principal.principal_ref.principal_id !== context.actor_ref.principal_id ||
    principal.principal_ref.principal_kind !== context.actor_ref.principal_kind) {
    issues.push("resolved principal does not match authenticated request actor");
  }
  if (principal.service_identity_ref !== undefined && !isPrincipalRef(principal.service_identity_ref)) {
    issues.push("verified service identity reference is invalid");
  }
  if (!(AUTHENTICATION_STATES as readonly string[]).includes(principal.authentication_state)) {
    issues.push("authentication_state is invalid");
  }
  if (!isTimestamp(principal.resolved_at) || Date.parse(principal.resolved_at) > Date.parse(now)) {
    issues.push("principal resolution timestamp is invalid");
  }
  if (!isTimestamp(principal.valid_until)) {
    issues.push("principal context must have a bounded validity timestamp");
  }
  for (const group of [
    principal.organization_membership_refs,
    principal.role_binding_refs,
    principal.delegation_refs,
    principal.trust_assessment_refs,
  ]) {
    if (!Array.isArray(group) ||
        !group.every(ref => isObjectRef(ref) && isScopeWithin(ref.scope_ref, context.scope_ref))) {
      issues.push("principal authority references are invalid or outside the authenticated scope");
    }
  }
  if (!Array.isArray(principal.authority_source_refs) ||
    !principal.authority_source_refs.every(source =>
      !!source && typeof source.source_kind === "string" && !!source.source_kind.trim() &&
      isObjectRef(source.object_ref) && isScopeWithin(source.object_ref.scope_ref, context.scope_ref) &&
      isTimestamp(source.observed_at) &&
      (source.source_version === undefined || isVersion(source.source_version)))) {
    issues.push("principal authority source references are invalid");
  }
  if (principal.session_ref && (!isObjectRef(principal.session_ref) ||
      !isScopeWithin(principal.session_ref.scope_ref, context.scope_ref))) {
    issues.push("session_ref is invalid or outside the authenticated scope");
  }
  if (principal.assurance_context_ref && (!isObjectRef(principal.assurance_context_ref) ||
      !isScopeWithin(principal.assurance_context_ref.scope_ref, context.scope_ref))) {
    issues.push("assurance_context_ref is invalid or outside the authenticated scope");
  }
  return issues;
}

function isScopeWithin(ancestor: ScopeRef, descendant: ScopeRef): boolean {
  let current: ScopeRef | undefined = descendant;
  while (current) {
    if (sameScopeRef(ancestor, current)) return true;
    current = current.parent_scope_ref;
  }
  return false;
}

export function validateAuthorityFacts(
  facts: AuthorityFacts,
  request: AuthorizationRequest,
  now: Timestamp,
): string[] {
  const issues: string[] = [];
  if (!facts || typeof facts !== "object") return ["authority facts are required"];
  if (!isScopeRef(facts.verified_resource_scope_ref) ||
      !sameScopeRef(facts.verified_resource_scope_ref, request.resource_ref.scope_ref) ||
      !sameScopeRef(facts.verified_resource_scope_ref, request.scope_ref)) {
    issues.push("authoritative resource scope does not match request scope");
  }
  if (!isTimestamp(facts.observed_at) || Date.parse(facts.observed_at) > Date.parse(now)) {
    issues.push("authority observation timestamp is invalid");
  }
  if (!isTimestamp(facts.valid_until)) {
    issues.push("authority facts must have a bounded validity timestamp");
  }
  if (!Array.isArray(facts.source_refs) || facts.source_refs.length === 0 ||
      !facts.source_refs.every(source =>
        !!source && typeof source.source_kind === "string" && !!source.source_kind.trim() &&
        isObjectRef(source.object_ref) && isScopeWithin(source.object_ref.scope_ref, request.scope_ref) &&
        isTimestamp(source.observed_at) &&
        (source.source_version === undefined || isVersion(source.source_version)))) {
    issues.push("authority source lineage is invalid or outside the request scope");
  }
  const allowedMembership: readonly string[] = ["ACTIVE", "SUSPENDED", "REVOKED", "UNKNOWN"];
  const allowedEntitlement: readonly string[] = ["ELIGIBLE", "INELIGIBLE", "NOT_REQUIRED", "UNKNOWN"];
  const allowedPermission: readonly string[] = ["GRANTED", "NOT_GRANTED", "UNKNOWN"];
  const allowedDelegation: readonly string[] = ["VALID", "INVALID", "NOT_REQUIRED", "UNKNOWN"];
  const allowedTrust: readonly string[] = ["VALID", "INVALID", "NOT_REQUIRED", "UNKNOWN"];
  const allowedExternal: readonly string[] = ["AUTHORIZED", "DENIED", "NOT_REQUIRED", "UNKNOWN"];
  if (!allowedMembership.includes(facts.membership_state) ||
      !allowedEntitlement.includes(facts.entitlement_state) ||
      !allowedPermission.includes(facts.permission_state) ||
      !allowedDelegation.includes(facts.delegation_state) ||
      !allowedTrust.includes(facts.trust_assessment_state) ||
      !allowedExternal.includes(facts.external_authorization_state)) {
    issues.push("authority fact state contains an unsupported value");
  }
  const expectedResourceVersion =
    request.expected_resource_version ?? request.resource_ref.object_version;
  if (expectedResourceVersion !== undefined &&
      (!facts.current_resource_version || !isVersion(facts.current_resource_version))) {
    issues.push("current resource version is required to validate a version-bound request");
  }
  return issues;
}

export function validatePolicyEvaluation(
  policy: PolicyEvaluation,
  request: AuthorizationRequest,
): string[] {
  const issues: string[] = [];
  if (!policy || typeof policy !== "object") return ["policy evaluation is required"];
  if (!(POLICY_EFFECTS as readonly string[]).includes(policy.effect)) issues.push("policy effect is invalid");
  const release = policy.policy_release;
  if (!release || !isObjectRef(release.policy_release_ref) ||
      release.policy_release_ref.object_kind !== "POLICY_RELEASE" ||
      !isScopeWithin(release.policy_release_ref.scope_ref, request.scope_ref) ||
      !release.policy_release_id?.trim() || !release.policy_family_id?.trim() ||
      !isVersion(release.version) ||
      (release.policy_release_ref.object_version !== undefined &&
        release.policy_release_ref.object_version !== release.version) ||
      !release.ruleset_digest?.trim() || !release.evaluator_contract_version?.trim() ||
      !isTimestamp(release.effective_from) || !isTimestamp(release.valid_until) ||
      Date.parse(release.valid_until) <= Date.parse(release.effective_from)) {
    issues.push("policy release identity, version or digest is invalid");
  }
  if (!policy.evaluator_version?.trim() ||
      !Array.isArray(policy.reason_codes) || !policy.reason_codes.every(code => typeof code === "string" && !!code.trim()) ||
      !Array.isArray(policy.conditions) ||
      !Array.isArray(policy.obligations) || !policy.obligations.every(item => typeof item === "string" && !!item.trim()) ||
      !policy.conditions.every(condition =>
        !!condition && !!condition.condition_id?.trim() &&
        !!condition.condition_kind?.trim() &&
        typeof condition.must_hold_at_enforcement === "boolean" &&
        (condition.parameters_ref === undefined ||
          (isObjectRef(condition.parameters_ref) &&
            isScopeWithin(condition.parameters_ref.scope_ref, request.scope_ref))))) {
    issues.push("policy evaluator output is malformed");
  }
  if (policy.valid_until !== undefined && !isTimestamp(policy.valid_until)) {
    issues.push("policy evaluation validity timestamp is invalid");
  }
  if (policy.approval_required &&
      policy.approval_use_mode !== "ONE_TIME" &&
      policy.approval_use_mode !== "REUSABLE_WITHIN_SCOPE") {
    issues.push("approval-required policy must explicitly declare an approval use mode");
  }
  if (policy.effect === "REQUIRE_APPROVAL" && !policy.approval_required) {
    issues.push("REQUIRE_APPROVAL effect must declare approval_required");
  }
  if (policy.approval_required &&
      (!isTimestamp(policy.approval_expires_at) ||
        Date.parse(policy.approval_expires_at) <= Date.parse(request.requested_at))) {
    issues.push("approval-required policy must provide a future policy-derived approval expiry");
  }
  if (policy.constrained_resource_ref &&
      (!isObjectRef(policy.constrained_resource_ref) ||
        !sameScopeRef(policy.constrained_resource_ref.scope_ref, request.scope_ref))) {
    issues.push("policy constrained resource is outside the request scope");
  }
  if (policy.constrained_environment_ref &&
      (!isObjectRef(policy.constrained_environment_ref) ||
        !sameScopeRef(policy.constrained_environment_ref.scope_ref, request.scope_ref))) {
    issues.push("policy constrained environment is outside the request scope");
  }
  return issues;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, canonicalize(record[key])]));
  }
  return value;
}

export function buildCanonicalRequestFingerprint(request: AuthorizationRequest): string {
  return JSON.stringify(canonicalize({
    actor: request.actor_ref,
    service_identity: request.service_identity_ref ?? null,
    action: request.action,
    resource: request.resource_ref,
    requested_at: request.requested_at,
    deadline: request.deadline ?? null,
    scope: request.scope_ref,
    environment: request.environment_ref,
    work: request.work_ref ?? null,
    plan_revision: request.plan_revision_ref ?? null,
    graph_revision: request.graph_revision_ref ?? null,
    execution: request.execution_ref ?? null,
    capability: request.capability_ref ?? null,
    delegation: request.delegation_ref ?? null,
    risk: request.risk_context,
    arguments_digest: request.action_arguments_digest ?? null,
    expected_resource_version: request.expected_resource_version ?? null,
    policy_context_refs: [...request.policy_context_refs].sort((a, b) =>
      JSON.stringify(canonicalize(a)).localeCompare(JSON.stringify(canonicalize(b)))),
  }));
}

/**
 * ONE_TIME approvals bind to one canonical request. REUSABLE_WITHIN_SCOPE
 * approvals bind to the stable action basis and may cover equivalent requests
 * only while every scoped/context/risk/policy constraint remains identical.
 */
export function buildApprovalBindingFingerprint(
  request: AuthorizationRequest,
  useMode: ApprovalUseMode,
): string {
  if (useMode === "ONE_TIME") return buildCanonicalRequestFingerprint(request);
  return JSON.stringify(canonicalize({
    actor: request.actor_ref,
    service_identity: request.service_identity_ref ?? null,
    action: request.action,
    resource: request.resource_ref,
    scope: request.scope_ref,
    environment: request.environment_ref,
    work: request.work_ref ?? null,
    plan_revision: request.plan_revision_ref ?? null,
    graph_revision: request.graph_revision_ref ?? null,
    execution: request.execution_ref ?? null,
    capability: request.capability_ref ?? null,
    delegation: request.delegation_ref ?? null,
    risk: request.risk_context,
    arguments_digest: request.action_arguments_digest ?? null,
    expected_resource_version: request.expected_resource_version ?? null,
    policy_context_refs: [...request.policy_context_refs].sort((a, b) =>
      JSON.stringify(canonicalize(a)).localeCompare(JSON.stringify(canonicalize(b)))),
  }));
}

export function buildAuthorityFingerprintMaterial(input: {
  request: AuthorizationRequest;
  principal: PrincipalContext;
  facts: AuthorityFacts;
  policy: PolicyEvaluation;
  approval?: ApprovalRecord;
}): string {
  const sources = (items: AuthoritySourceRef[]) => items.map(source => ({
    source_kind: source.source_kind,
    object_ref: source.object_ref,
    source_version: source.source_version ?? null,
    observed_at: source.observed_at,
  })).sort((a, b) =>
    JSON.stringify(canonicalize(a)).localeCompare(JSON.stringify(canonicalize(b))));
  return JSON.stringify(canonicalize({
    request: buildCanonicalRequestFingerprint(input.request),
    principal: {
      principal_ref: input.principal.principal_ref,
      service_identity_ref: input.principal.service_identity_ref ?? null,
      authentication_state: input.principal.authentication_state,
      session_ref: input.principal.session_ref ?? null,
      assurance_context_ref: input.principal.assurance_context_ref ?? null,
      organization_membership_refs: input.principal.organization_membership_refs,
      role_binding_refs: input.principal.role_binding_refs,
      delegation_refs: input.principal.delegation_refs,
      trust_assessment_refs: input.principal.trust_assessment_refs,
      authority_sources: sources(input.principal.authority_source_refs),
      resolved_at: input.principal.resolved_at,
      valid_until: input.principal.valid_until ?? null,
    },
    authority: {
      membership_state: input.facts.membership_state,
      entitlement_state: input.facts.entitlement_state,
      permission_state: input.facts.permission_state,
      delegation_state: input.facts.delegation_state,
      trust_assessment_state: input.facts.trust_assessment_state,
      external_authorization_state: input.facts.external_authorization_state,
      verified_resource_scope_ref: input.facts.verified_resource_scope_ref,
      current_resource_version: input.facts.current_resource_version ?? null,
      observed_at: input.facts.observed_at,
      valid_until: input.facts.valid_until ?? null,
      verified_delegation_ref: input.facts.verified_delegation_ref ?? null,
      sources: sources(input.facts.source_refs),
    },
    policy: {
      release_ref: input.policy.policy_release.policy_release_ref,
      version: input.policy.policy_release.version,
      state: input.policy.policy_release.state,
      ruleset_digest: input.policy.policy_release.ruleset_digest,
      evaluator_contract_version: input.policy.policy_release.evaluator_contract_version,
      evaluator_version: input.policy.evaluator_version,
      effect: input.policy.effect,
      approval_required: input.policy.approval_required,
      approval_use_mode: input.policy.approval_use_mode ?? null,
      independent_approver_required: input.policy.independent_approver_required,
      risk_assessment_required: input.policy.risk_assessment_required,
      trust_required: input.policy.trust_required,
      conditions: input.policy.conditions,
      obligations: input.policy.obligations,
      valid_until: input.policy.valid_until ?? null,
      approval_expires_at: input.policy.approval_expires_at ?? null,
    },
    approval: input.approval ? {
      approval_ref: input.approval.approval_ref,
      request_ref: input.approval.request_ref,
      request_binding_fingerprint: input.approval.request_binding_fingerprint,
      requested_by_ref: input.approval.requested_by_ref,
      approver_ref: input.approval.approver_ref ?? null,
      action: input.approval.action,
      resource_ref: input.approval.resource_ref,
      scope_ref: input.approval.scope_ref,
      environment_ref: input.approval.environment_ref,
      context_version_refs: input.approval.context_version_refs,
      policy_release_ref: input.approval.policy_release_ref ?? null,
      use_mode: input.approval.approval_use_mode,
      state: input.approval.state,
      expires_at: input.approval.expires_at ?? null,
      revoked_at: input.approval.revoked_at ?? null,
      consumed_at: input.approval.consumed_at ?? null,
      consumed_by_request_ref: input.approval.consumed_by_request_ref ?? null,
    } : null,
  }));
}

function isExactObjectRef(a: ObjectRef, b: ObjectRef): boolean {
  return sameObjectRef(a, b) && a.object_version === b.object_version;
}

function isApprovalForRequest(
  approval: ApprovalRecord,
  request: AuthorizationRequest,
  policyReleaseRef: ObjectRef,
  now: Timestamp,
  useMode?: ApprovalUseMode,
): boolean {
  return validateApprovalUse(approval, request, now, policyReleaseRef).length === 0 &&
    (useMode === undefined || approval.approval_use_mode === useMode);
}

export function evaluateAuthorizationDecision(input: {
  context: RequestContext;
  request: AuthorizationRequest;
  principal: PrincipalContext;
  facts: AuthorityFacts;
  policy: PolicyEvaluation;
  approval?: ApprovalRecord;
  decision_ref: ObjectRef;
  decision_id: string;
  request_ref: ObjectRef;
  audit_ref: ObjectRef;
  evaluated_at: Timestamp;
  authority_fingerprint: string;
  approval_authority_verified?: boolean;
}): OperationResult<AuthorizationDecision> {
  const correlation_id = input.context.correlation_id;
  const requestIssues = validateAuthorizationRequest(input.context, input.request);
  const principalIssues = validatePrincipalContext(input.context, input.principal, input.evaluated_at);
  const authorityIssues = validateAuthorityFacts(input.facts, input.request, input.evaluated_at);
  const policyIssues = validatePolicyEvaluation(input.policy, input.request);
  if (requestIssues.length || principalIssues.length || authorityIssues.length || policyIssues.length ||
    !isObjectRef(input.decision_ref) || input.decision_ref.object_kind !== "AUTHORIZATION_DECISION" ||
    !sameScopeRef(input.decision_ref.scope_ref, input.context.scope_ref) ||
    !isObjectRef(input.request_ref) || input.request_ref.object_kind !== "AUTHORIZATION_REQUEST" ||
    !sameScopeRef(input.request_ref.scope_ref, input.context.scope_ref) ||
    !isObjectRef(input.audit_ref) || input.audit_ref.object_kind !== "AUTHORIZATION_AUDIT" ||
    !sameScopeRef(input.audit_ref.scope_ref, input.context.scope_ref) ||
    !input.decision_id?.trim() || !input.authority_fingerprint?.trim() ||
    !isTimestamp(input.evaluated_at)) {
    return createOperationResult({
      status: "REJECTED",
      correlation_id,
      errors: [createOperationError("VALIDATION_ERROR", "Authorization decision input is invalid")],
    });
  }

  const { request, principal, facts, policy } = input;
  let result: AuthorizationResult = "INDETERMINATE";
  const reasons: string[] = [];
  const validUntil: string[] = [];

  if (request.service_identity_ref &&
      (!principal.service_identity_ref ||
        !samePrincipal(request.service_identity_ref, principal.service_identity_ref))) {
    result = "DENY"; reasons.push("SERVICE_IDENTITY_NOT_VERIFIED");
  } else if (request.service_identity_ref &&
      !samePrincipal(request.service_identity_ref, request.actor_ref) &&
      !request.delegation_ref) {
    result = "DENY"; reasons.push("SERVICE_DELEGATION_REQUIRED");
  } else if (request.delegation_ref &&
      (!principal.delegation_refs.some(ref => isExactObjectRef(ref, request.delegation_ref!)) ||
       !facts.verified_delegation_ref ||
       !isExactObjectRef(facts.verified_delegation_ref, request.delegation_ref))) {
    result = "DENY"; reasons.push("DELEGATION_REFERENCE_NOT_VERIFIED");
  } else if (principal.authentication_state === "UNAUTHENTICATED" ||
      principal.authentication_state === "REVOKED") {
    result = "DENY"; reasons.push("AUTHENTICATION_NOT_VALID");
  } else if (principal.authentication_state === "STEP_UP_REQUIRED" ||
      principal.authentication_state === "EXPIRED") {
    result = "REQUIRE_REAUTH"; reasons.push("REAUTHENTICATION_REQUIRED");
  } else if (principal.authentication_state === "INDETERMINATE") {
    result = "INDETERMINATE"; reasons.push("AUTHENTICATION_STATE_UNKNOWN");
  } else if (!sameScopeRef(facts.verified_resource_scope_ref, request.resource_ref.scope_ref) ||
      !sameScopeRef(facts.verified_resource_scope_ref, request.scope_ref)) {
    result = "DENY"; reasons.push("SCOPE_MISMATCH");
  } else if ((request.expected_resource_version ?? request.resource_ref.object_version) !== undefined &&
      facts.current_resource_version !== (request.expected_resource_version ?? request.resource_ref.object_version)) {
    result = "INDETERMINATE"; reasons.push("RESOURCE_VERSION_STALE");
  } else if (request.delegation_ref &&
      (!facts.verified_delegation_ref || !isExactObjectRef(facts.verified_delegation_ref, request.delegation_ref))) {
    result = "DENY"; reasons.push("DELEGATION_REFERENCE_NOT_VERIFIED");
  } else if (facts.membership_state === "SUSPENDED" || facts.membership_state === "REVOKED" ||
      facts.entitlement_state === "INELIGIBLE" || facts.permission_state === "NOT_GRANTED" ||
      facts.delegation_state === "INVALID" || facts.external_authorization_state === "DENIED" ||
      facts.trust_assessment_state === "INVALID") {
    result = "DENY"; reasons.push("AUTHORITY_CONSTRAINT_NOT_SATISFIED");
  } else if (facts.membership_state === "UNKNOWN" || facts.entitlement_state === "UNKNOWN" ||
      facts.permission_state === "UNKNOWN" || facts.delegation_state === "UNKNOWN" ||
      facts.external_authorization_state === "UNKNOWN" || facts.trust_assessment_state === "UNKNOWN") {
    result = "INDETERMINATE"; reasons.push("AUTHORITY_FACTS_UNAVAILABLE");
  } else if (principal.valid_until && Date.parse(principal.valid_until) <= Date.parse(input.evaluated_at)) {
    result = "REQUIRE_REAUTH"; reasons.push("PRINCIPAL_CONTEXT_EXPIRED");
  } else if (facts.valid_until && Date.parse(facts.valid_until) <= Date.parse(input.evaluated_at)) {
    result = "INDETERMINATE"; reasons.push("AUTHORITY_FACTS_EXPIRED");
  } else if (request.risk_context.assessment_state === "INDETERMINATE" ||
      (request.risk_context.assessment_state === "ASSESSED" &&
       request.risk_context.valid_until !== undefined &&
       Date.parse(request.risk_context.valid_until) <= Date.parse(input.evaluated_at))) {
    result = "INDETERMINATE"; reasons.push("RISK_CONTEXT_NOT_CURRENT");
  } else if (!policy || !policy.policy_release ||
      !["RELEASED", "MONITORING"].includes(policy.policy_release.state) ||
      (policy.policy_release.effective_from && Date.parse(policy.policy_release.effective_from) > Date.parse(input.evaluated_at)) ||
      (policy.policy_release.valid_until && Date.parse(policy.policy_release.valid_until) <= Date.parse(input.evaluated_at))) {
    result = "INDETERMINATE"; reasons.push("CURRENT_POLICY_UNAVAILABLE");
  } else {
    switch (policy.effect) {
      case "DENY": result = "DENY"; break;
      case "REQUIRE_REAUTH": result = "REQUIRE_REAUTH"; break;
      case "REQUIRE_APPROVAL": result = "REQUIRE_APPROVAL"; break;
      case "RESTRICT": result = "RESTRICT"; break;
      case "QUARANTINE": result = "QUARANTINE"; break;
      case "DEFER": result = "DEFER"; break;
      case "UNKNOWN": result = "INDETERMINATE"; break;
      case "ALLOW": result = "ALLOW"; break;
    }
    reasons.push(...policy.reason_codes);
    if (policy.risk_assessment_required && request.risk_context.assessment_state !== "ASSESSED") {
      result = "INDETERMINATE"; reasons.push("RISK_ASSESSMENT_REQUIRED");
    }
    if (policy.trust_required && facts.trust_assessment_state !== "VALID") {
      result = "INDETERMINATE"; reasons.push("SCOPED_TRUST_ASSESSMENT_REQUIRED");
    }
    if (policy.approval_required) {
      if (!input.approval || input.approval.state === "PENDING") {
        result = "REQUIRE_APPROVAL"; reasons.push("SCOPED_APPROVAL_REQUIRED");
      } else if (!isApprovalForRequest(input.approval, request,
          policy.policy_release.policy_release_ref, input.evaluated_at, policy.approval_use_mode)) {
        result = "DENY"; reasons.push("APPROVAL_INVALID_OR_MISMATCHED");
      } else if (input.approval_authority_verified !== true) {
        result = "DENY"; reasons.push("APPROVER_AUTHORITY_NOT_CURRENT");
      } else if (policy.independent_approver_required &&
          samePrincipal(input.approval.approver_ref!, input.approval.requested_by_ref)) {
        result = "DENY"; reasons.push("INDEPENDENT_APPROVER_REQUIRED");
      }
    }
    if (policy.effect === "ALLOW" && facts.entitlement_state === "NOT_REQUIRED") {
      // No entitlement is required by the authoritative source for this action.
    }
    if (facts.delegation_state === "NOT_REQUIRED" && request.delegation_ref) {
      result = "DENY"; reasons.push("DELEGATION_NOT_VALIDATED");
    }
  }

  if (request.deadline) validUntil.push(request.deadline);
  if (principal.valid_until) validUntil.push(principal.valid_until);
  if (facts.valid_until) validUntil.push(facts.valid_until);
  if (request.risk_context.valid_until) validUntil.push(request.risk_context.valid_until);
  if (policy?.valid_until) validUntil.push(policy.valid_until);
  if (policy?.policy_release?.valid_until) validUntil.push(policy.policy_release.valid_until);
  if (input.approval?.expires_at && result === "ALLOW") validUntil.push(input.approval.expires_at);
  const valid_until = validUntil.length
    ? validUntil.sort((a, b) => Date.parse(a) - Date.parse(b))[0]
    : undefined;

  const decision: AuthorizationDecision = {
    decision_ref: input.decision_ref,
    decision_id: input.decision_id,
    request_ref: input.request_ref,
    result,
    ...(policy?.policy_release ? { policy_release_ref: policy.policy_release.policy_release_ref } : {}),
    ...(policy?.policy_release?.version ? { policy_version: policy.policy_release.version } : {}),
    ...(policy?.evaluator_version ? { evaluator_version: policy.evaluator_version } : {}),
    authority_fingerprint: input.authority_fingerprint,
    request_fingerprint: buildCanonicalRequestFingerprint(request),
    ...(policy?.approval_required && policy.approval_use_mode ? { approval_use_mode: policy.approval_use_mode } : {}),
    applicable_scope_ref: request.scope_ref,
    ...(result === "RESTRICT" && policy.constrained_action ? { constrained_action: policy.constrained_action } : {}),
    ...(result === "RESTRICT" && policy.constrained_resource_ref ? { constrained_resource_ref: policy.constrained_resource_ref } : {}),
    ...(result === "RESTRICT" && policy.constrained_environment_ref ? { constrained_environment_ref: policy.constrained_environment_ref } : {}),
    conditions: policy?.conditions ?? [],
    obligations: policy?.obligations ?? [],
    reason_codes: [...new Set(reasons.length ? reasons : [`POLICY_${result}`])],
    related_approval_refs: input.approval ? [input.approval.approval_ref] : [],
    authority_source_refs: [...principal.authority_source_refs, ...facts.source_refs],
    evaluated_at: input.evaluated_at,
    ...(valid_until ? { valid_until } : {}),
    recheck_before_effect: true,
    audit_ref: input.audit_ref,
  };
  return createOperationResult({ status: "OK", correlation_id, data: decision });
}

export function isDecisionCurrentForRequest(
  decision: AuthorizationDecision,
  request: AuthorizationRequest,
  now: Timestamp,
  currentAuthorityFingerprint: string,
): boolean {
  return decision.result === "ALLOW" &&
    isTimestamp(now) &&
    (!decision.valid_until || Date.parse(decision.valid_until) > Date.parse(now)) &&
    decision.authority_fingerprint === currentAuthorityFingerprint &&
    decision.request_ref.object_kind === "AUTHORIZATION_REQUEST" &&
    decision.request_ref.object_id === request.authorization_request_id &&
    decision.request_ref.object_version !== undefined &&
    sameScopeRef(decision.applicable_scope_ref, request.scope_ref) &&
    decision.decision_ref.scope_ref && sameScopeRef(decision.decision_ref.scope_ref, request.scope_ref) &&
    decision.request_fingerprint === buildCanonicalRequestFingerprint(request) &&
    decision.reason_codes.length > 0;
}

const SAFE_PUBLIC_REASON_CODES = new Set([
  "AUTHENTICATION_NOT_VALID", "REAUTHENTICATION_REQUIRED", "AUTHENTICATION_STATE_UNKNOWN",
  "SCOPE_MISMATCH", "AUTHORITY_CONSTRAINT_NOT_SATISFIED", "AUTHORITY_FACTS_UNAVAILABLE",
  "PRINCIPAL_CONTEXT_EXPIRED", "AUTHORITY_FACTS_EXPIRED", "RISK_CONTEXT_NOT_CURRENT",
  "CURRENT_POLICY_UNAVAILABLE", "RISK_ASSESSMENT_REQUIRED", "SCOPED_TRUST_ASSESSMENT_REQUIRED",
  "SCOPED_APPROVAL_REQUIRED", "APPROVAL_INVALID_OR_MISMATCHED", "APPROVER_AUTHORITY_NOT_CURRENT",
  "INDEPENDENT_APPROVER_REQUIRED", "DELEGATION_NOT_VALIDATED", "RESOURCE_VERSION_STALE",
  "DELEGATION_REFERENCE_NOT_VERIFIED", "SERVICE_IDENTITY_NOT_VERIFIED", "SERVICE_DELEGATION_REQUIRED",
]);

export function createSafeDecisionExplanation(
  decision: AuthorizationDecision,
): SafeDecisionExplanation {
  const copy: Record<AuthorizationResult, { message: string; next: SafeDecisionExplanation["permitted_next_step"] }> = {
    ALLOW: { message: "This action is currently authorized, subject to enforcement-time rechecks.", next: "NONE" },
    DENY: { message: "This action is not permitted in the current context.", next: "CONTACT_ADMIN" },
    REQUIRE_APPROVAL: { message: "This action needs an authorized approval before it can proceed.", next: "REQUEST_APPROVAL" },
    REQUIRE_REAUTH: { message: "Please re-authenticate before requesting this action again.", next: "REAUTHENTICATE" },
    RESTRICT: { message: "The requested action is broader than the currently permitted scope. Submit a narrower request.", next: "NARROW_REQUEST" },
    QUARANTINE: { message: "This action is blocked while the relevant item or authority is under review.", next: "CONTACT_ADMIN" },
    DEFER: { message: "This action is waiting for a required condition to become current.", next: "WAIT_AND_RECHECK" },
    INDETERMINATE: { message: "Current authority could not be verified, so the action has been blocked.", next: "WAIT_AND_RECHECK" },
  };
  return {
    decision_ref: decision.decision_ref,
    result: decision.result,
    safe_message: copy[decision.result].message,
    visible_reason_codes: decision.reason_codes.filter(code => SAFE_PUBLIC_REASON_CODES.has(code)),
    permitted_next_step: copy[decision.result].next,
    // Object-level visibility belongs to the access-filtered read adapter; the
    // pure explanation helper does not trust caller-supplied references.
    user_visible_refs: [],
  };
}

export function createPendingApproval(input: {
  approval_ref: ObjectRef;
  approval_id: string;
  request_ref: ObjectRef;
  request_binding_fingerprint: string;
  requested_by_ref: PrincipalRef;
  required_approver_constraints: string[];
  action: string;
  resource_ref: ObjectRef;
  scope_ref: ScopeRef;
  environment_ref: ObjectRef;
  work_ref?: ObjectRef;
  context_version_refs: ObjectRef[];
  policy_release_ref: ObjectRef;
  approval_use_mode: ApprovalUseMode;
  created_at: Timestamp;
  expires_at: Timestamp;
}): OperationResult<ApprovalRecord> {
  if (!input.approval_id?.trim() ||
    !["ONE_TIME", "REUSABLE_WITHIN_SCOPE"].includes(input.approval_use_mode) ||
    !isObjectRef(input.approval_ref) || input.approval_ref.object_kind !== "APPROVAL" ||
    !sameScopeRef(input.approval_ref.scope_ref, input.scope_ref) ||
    !isObjectRef(input.request_ref) || input.request_ref.object_kind !== "AUTHORIZATION_REQUEST" ||
    !sameScopeRef(input.request_ref.scope_ref, input.scope_ref) ||
    !input.request_binding_fingerprint?.trim() ||
    !isPrincipalRef(input.requested_by_ref) || !input.action.trim() ||
    !isObjectRef(input.resource_ref) || !sameScopeRef(input.resource_ref.scope_ref, input.scope_ref) ||
    !isObjectRef(input.environment_ref) || !sameScopeRef(input.environment_ref.scope_ref, input.scope_ref) ||
    !Array.isArray(input.required_approver_constraints) ||
    !input.required_approver_constraints.every(value => typeof value === "string" && !!value.trim()) ||
    !Array.isArray(input.context_version_refs) || !input.context_version_refs.every(isObjectRef) ||
    !isObjectRef(input.policy_release_ref) || input.policy_release_ref.object_kind !== "POLICY_RELEASE" ||
    !sameScopeRef(input.policy_release_ref.scope_ref, input.scope_ref) ||
    !isTimestamp(input.created_at) ||
    !isTimestamp(input.expires_at) ||
    Date.parse(input.expires_at) <= Date.parse(input.created_at)) {
    return createOperationResult({
      status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("VALIDATION_ERROR", "Approval request is invalid or cross-scope")],
    });
  }
  return createOperationResult({
    status: "OK", correlation_id: "authorization",
    data: {
      approval_id: input.approval_id,
      approval_ref: input.approval_ref,
      request_ref: input.request_ref,
      request_binding_fingerprint: input.request_binding_fingerprint,
      requested_by_ref: input.requested_by_ref,
      required_approver_constraints: [...input.required_approver_constraints],
      action: input.action,
      resource_ref: input.resource_ref,
      scope_ref: input.scope_ref,
      environment_ref: input.environment_ref,
      ...(input.work_ref ? { work_ref: input.work_ref } : {}),
      context_version_refs: [...input.context_version_refs],
      policy_release_ref: input.policy_release_ref,
      approval_use_mode: input.approval_use_mode,
      state: "PENDING",
      created_at: input.created_at,
      expires_at: input.expires_at,
    },
  });
}

export function decideApproval(input: {
  approval: ApprovalRecord;
  decision: ApprovalDecisionInput;
  expected_current_version: Version;
  approver_is_authorized: boolean;
  independent_approval_required: boolean;
  now: Timestamp;
}): OperationResult<ApprovalRecord> {
  const { approval, decision } = input;
  if (!isObjectRef(decision.approval_ref) ||
    !isExactObjectRef(decision.approval_ref, approval.approval_ref) ||
    !sameScopeRef(decision.approval_ref.scope_ref, approval.scope_ref) ||
    decision.expected_version !== input.expected_current_version ||
    !isVersion(input.expected_current_version) ||
    !decision.idempotency_key?.trim() ||
    !isPrincipalRef(decision.approver_ref) || !isTimestamp(decision.decided_at) ||
    !isTimestamp(input.now) || Date.parse(decision.decided_at) > Date.parse(input.now) ||
      Date.parse(decision.decided_at) < Date.parse(approval.created_at)) {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("VERSION_CONFLICT", "Approval identity, version or timestamp is invalid")] });
  }
  if (approval.state !== "PENDING") {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("VERSION_CONFLICT", "Only a pending approval can be decided")] });
  }
  if (!input.approver_is_authorized ||
    (input.independent_approval_required &&
      samePrincipal(decision.approver_ref, approval.requested_by_ref))) {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("FORBIDDEN", "Approver does not hold the required independent approval authority")] });
  }
  if (!approval.expires_at || !isTimestamp(approval.expires_at) ||
      Date.parse(approval.expires_at) <= Date.parse(input.now)) {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("APPROVAL_REQUIRED", "Approval has already expired")] });
  }
  const updated: ApprovalRecord = {
    ...approval,
    state: decision.decision === "APPROVE" ? "APPROVED" : "REJECTED",
    approver_ref: decision.approver_ref,
    decided_at: decision.decided_at,
    ...(decision.reason_ref ? { reason_ref: decision.reason_ref } : {}),
    ...(decision.evidence_method_ref ? { evidence_method_ref: decision.evidence_method_ref } : {}),
  };
  return createOperationResult({ status: "OK", correlation_id: "authorization", data: updated });
}

/** Expiry/revocation lifecycle; terminal approval states cannot be reopened. */
export function transitionApproval(
  approval: ApprovalRecord,
  to: "EXPIRED" | "REVOKED",
  now: Timestamp,
): OperationResult<ApprovalRecord> {
  if (!approval || typeof approval !== "object" ||
      !isObjectRef(approval.approval_ref) ||
      !isTimestamp(approval.created_at) ||
      !(APPROVAL_STATES as readonly string[]).includes(approval.state) ||
      !isTimestamp(now)) {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("VALIDATION_ERROR", "Approval lifecycle input is invalid")] });
  }
  const allowed: Record<ApprovalState, readonly string[]> = {
    PENDING: ["EXPIRED", "REVOKED"],
    APPROVED: ["EXPIRED", "REVOKED"],
    REJECTED: [],
    EXPIRED: [],
    REVOKED: [],
    CONSUMED: [],
  };
  if (!allowed[approval.state].includes(to)) {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("VERSION_CONFLICT", "Approval lifecycle transition is not permitted")] });
  }
  if (to === "EXPIRED" && (!approval.expires_at || Date.parse(approval.expires_at) > Date.parse(now))) {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("POLICY_DENIED", "Approval has not reached its expiry time")] });
  }
  return createOperationResult({ status: "OK", correlation_id: "authorization",
    data: {
      ...approval,
      state: to,
      ...(to === "REVOKED" ? { revoked_at: now } : {}),
    } });
}

/**
 * Pure transition used by the repository's atomic compare-and-set adapter.
 * A ONE_TIME claim is valid only for the exact authorization request and version.
 */
export function claimOneTimeApprovalRecord(input: {
  approval: ApprovalRecord;
  authorization_request_ref: ObjectRef;
  current_version: Version;
  expected_version: Version;
  idempotency_key: string;
  now: Timestamp;
}): OperationResult<ApprovalRecord> {
  const { approval, authorization_request_ref, current_version, expected_version, idempotency_key, now } = input;
  if (!isObjectRef(authorization_request_ref) ||
      authorization_request_ref.object_kind !== "AUTHORIZATION_REQUEST" ||
      !sameScopeRef(authorization_request_ref.scope_ref, approval.scope_ref) ||
      !isVersion(current_version) || !isVersion(expected_version) ||
      current_version !== expected_version ||
      !idempotency_key.trim() || !isTimestamp(now)) {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("VALIDATION_ERROR", "One-time approval claim input is invalid")] });
  }
  if (approval.approval_use_mode !== "ONE_TIME" || approval.state !== "APPROVED") {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("APPROVAL_REQUIRED", "Approval is not an available one-time approval")] });
  }
  if (!sameObjectRef(approval.request_ref, authorization_request_ref)) {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("APPROVAL_REQUIRED", "Approval is bound to a different authorization request")] });
  }
  if (!approval.expires_at || Date.parse(approval.expires_at) <= Date.parse(now) ||
      (approval.valid_from && Date.parse(approval.valid_from) > Date.parse(now)) ||
      approval.revoked_at !== undefined || approval.consumed_at !== undefined) {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("APPROVAL_REQUIRED", "Approval is expired, revoked or already consumed")] });
  }
  return createOperationResult({ status: "OK", correlation_id: "authorization",
    data: {
      ...approval,
      state: "CONSUMED",
      consumed_at: now,
      consumed_by_request_ref: authorization_request_ref,
    } });
}

export function validateApprovalUse(
  approval: ApprovalRecord,
  request: AuthorizationRequest,
  now: Timestamp,
  policyReleaseRef: ObjectRef,
): string[] {
  const issues: string[] = [];
  if (!approval || typeof approval !== "object" ||
      !isObjectRef(approval.approval_ref) || !isObjectRef(approval.request_ref) ||
      !isPrincipalRef(approval.requested_by_ref) || !isObjectRef(approval.resource_ref) ||
      !isScopeRef(approval.scope_ref) || !isObjectRef(approval.environment_ref) ||
      !isObjectRef(approval.policy_release_ref) ||
      !Array.isArray(approval.required_approver_constraints) ||
      !approval.required_approver_constraints.every(value => typeof value === "string" && !!value.trim()) ||
      !Array.isArray(approval.context_version_refs) ||
      !approval.context_version_refs.every(isObjectRef)) {
    return ["approval record is malformed"];
  }
  if (approval.state !== "APPROVED") issues.push("approval is not approved");
  if (!approval.approver_ref || !isPrincipalRef(approval.approver_ref) ||
      !approval.decided_at || !isTimestamp(approval.decided_at)) {
    issues.push("approval decision provenance is missing or invalid");
  }
  if (approval.revoked_at !== undefined) issues.push("approval has been revoked");
  if (!request.approval_ref || !isExactObjectRef(approval.approval_ref, request.approval_ref)) {
    issues.push("approval reference does not match the request");
  }
  if (approval.request_ref.object_kind !== "AUTHORIZATION_REQUEST" ||
    !sameScopeRef(approval.request_ref.scope_ref, request.scope_ref) ||
    (approval.approval_use_mode === "ONE_TIME" &&
      approval.request_ref.object_id !== request.authorization_request_id)) {
    issues.push("approval request identity does not match");
  }
  if (!approval.request_binding_fingerprint ||
      approval.request_binding_fingerprint !== buildApprovalBindingFingerprint(request, approval.approval_use_mode)) {
    issues.push("approval is bound to a different canonical request payload");
  }
  if (!samePrincipal(approval.requested_by_ref, request.actor_ref)) {
    issues.push("approval requester does not match the requesting actor");
  }
  if (approval.action !== request.action) issues.push("approval action does not match");
  if (!isExactObjectRef(approval.resource_ref, request.resource_ref)) issues.push("approval resource does not match");
  if (!sameScopeRef(approval.scope_ref, request.scope_ref)) issues.push("approval scope does not match");
  if (!isExactObjectRef(approval.environment_ref, request.environment_ref)) issues.push("approval environment does not match");
  if (approval.work_ref && (!request.work_ref || !isExactObjectRef(approval.work_ref, request.work_ref))) {
    issues.push("approval Work context does not match");
  }
  if (!approval.policy_release_ref || !isExactObjectRef(approval.policy_release_ref, policyReleaseRef)) {
    issues.push("approval policy release does not match");
  }
  const expectedContextRefs = [
    request.work_ref, request.plan_revision_ref, request.graph_revision_ref,
    request.execution_ref, request.capability_ref,
  ].filter((ref): ref is ObjectRef => ref !== undefined);
  const sameContextRefs = expectedContextRefs.length === approval.context_version_refs.length &&
    expectedContextRefs.every(expected => approval.context_version_refs.some(actual => isExactObjectRef(actual, expected)));
  if (!sameContextRefs) issues.push("approval context versions do not match the current request");
  if (approval.valid_from && (!isTimestamp(approval.valid_from) || Date.parse(approval.valid_from) > Date.parse(now))) {
    issues.push("approval is not yet valid");
  }
  if (!isTimestamp(approval.created_at) || Date.parse(approval.created_at) > Date.parse(now) ||
      !isTimestamp(approval.decided_at) || Date.parse(approval.decided_at) > Date.parse(now)) {
    issues.push("approval creation or decision timestamp is invalid");
  }
  if (!approval.expires_at || !isTimestamp(approval.expires_at) || Date.parse(approval.expires_at) <= Date.parse(now)) {
    issues.push("approval is expired or has no enforceable expiry");
  }
  if (approval.approval_use_mode === "ONE_TIME" &&
    (approval.consumed_at !== undefined || approval.consumed_by_request_ref !== undefined)) {
    issues.push("one-time approval has already been consumed");
  }
  return issues;
}

export function validateDelegationRequest(
  request: DelegationRequest,
  authority: DelegationGrantAuthority,
  parent?: DelegationRecord,
  now?: Timestamp,
): string[] {
  const issues: string[] = [];
  if (!request || typeof request !== "object" || !authority || typeof authority !== "object") {
    return ["delegation request and current grantor authority are required"];
  }
  if (!Array.isArray(request.allowed_actions) || !Array.isArray(request.resource_constraints) ||
      !Array.isArray(request.limits) || !Array.isArray(request.conditions) ||
      !Array.isArray(authority.grantor_allowed_actions) ||
      !authority.grantor_allowed_actions.every(action => typeof action === "string" && !!action.trim()) ||
      !Array.isArray(authority.grantor_resource_constraints) ||
      !authority.grantor_resource_constraints.every(isObjectRef) ||
      !Array.isArray(authority.grantor_limits) ||
      !authority.grantor_limits.every(limit => typeof limit === "string" && !!limit.trim()) ||
      !Array.isArray(authority.grantor_conditions) ||
      !authority.grantor_conditions.every(condition => !!condition &&
        !!condition.condition_id?.trim() && !!condition.condition_kind?.trim() &&
        typeof condition.must_hold_at_enforcement === "boolean") ||
      (authority.grantor_valid_from !== undefined && !isTimestamp(authority.grantor_valid_from)) ||
      (authority.valid_until !== undefined && !isTimestamp(authority.valid_until))) {
    return ["delegation action, resource, limit or condition collections are invalid"];
  }
  if (!isObjectRef(request.delegation_ref) || request.delegation_ref.object_kind !== "DELEGATION" ||
    !sameScopeRef(request.delegation_ref.scope_ref, request.scope_ref) ||
    !isPrincipalRef(request.grantor_ref) || !isPrincipalRef(request.delegate_ref) ||
    samePrincipal(request.grantor_ref, request.delegate_ref)) {
    issues.push("delegation identity or actor references are invalid");
  }
  if (typeof request.allow_subdelegation !== "boolean" ||
    !request.purpose?.trim() || !request.allowed_actions.length ||
    request.allowed_actions.some(action => typeof action !== "string" || !action.trim()) ||
    new Set(request.allowed_actions).size !== request.allowed_actions.length ||
    request.limits.some(limit => typeof limit !== "string" || !limit.trim()) ||
    request.conditions.some(condition =>
      !condition || !condition.condition_id?.trim() || !condition.condition_kind?.trim() ||
      typeof condition.must_hold_at_enforcement !== "boolean")) {
    issues.push("delegation purpose and unique allowed actions are required");
  }
  if (!isScopeRef(request.scope_ref) || !sameScopeRef(request.scope_ref, authority.grantor_scope_ref)) {
    issues.push("delegation scope exceeds the grantor's current scope");
  }
  if (!isTimestamp(request.not_before) || !isTimestamp(request.expires_at) ||
    Date.parse(request.expires_at) <= Date.parse(request.not_before)) {
    issues.push("delegation validity window is invalid");
  }
  if (!authority.grantor_authenticated || !authority.grantor_may_delegate ||
      !isScopeRef(authority.grantor_scope_ref) ||
      !isTimestamp(now ?? request.not_before)) {
    issues.push("grantor is not currently authorized to delegate");
  }
  if (request.allow_subdelegation && !authority.grantor_may_subdelegate) {
    issues.push("subdelegation is not explicitly authorized by the current grantor");
  }
  if (request.allowed_actions.some(action => !authority.grantor_allowed_actions.includes(action))) {
    issues.push("delegation cannot grant actions the grantor does not hold");
  }
  if (authority.grantor_limits.some(limit => !request.limits.includes(limit))) {
    issues.push("delegation omits a limit that already constrains the grantor");
  }
  if (authority.grantor_conditions.some(condition => !request.conditions.some(child =>
    child.condition_id === condition.condition_id &&
    child.condition_kind === condition.condition_kind &&
    child.must_hold_at_enforcement === condition.must_hold_at_enforcement &&
    JSON.stringify(child.parameters_ref ?? null) === JSON.stringify(condition.parameters_ref ?? null)))) {
    issues.push("delegation omits a condition that already constrains the grantor");
  }
  for (const resource of request.resource_constraints) {
    if (!isObjectRef(resource) || !sameScopeRef(resource.scope_ref, request.scope_ref) ||
      !authority.grantor_resource_constraints.some(allowed => sameObjectRef(allowed, resource))) {
      issues.push("delegation resource constraints exceed current grantor authority");
    }
  }
  if (!isObjectRef(request.authorized_by_decision_ref) ||
    request.authorized_by_decision_ref.object_kind !== "AUTHORIZATION_DECISION" ||
    !sameScopeRef(request.authorized_by_decision_ref.scope_ref, request.scope_ref)) {
    issues.push("delegation must cite an in-scope authorization decision");
  }
  if (request.parent_delegation_ref) {
    if (!parent || typeof parent !== "object" ||
      !isObjectRef(parent.delegation_ref) ||
      !Array.isArray(parent.allowed_actions) ||
      !Array.isArray(parent.resource_constraints) ||
      !Array.isArray(parent.limits) ||
      !Array.isArray(parent.conditions) ||
      !isTimestamp(parent.not_before) ||
      !isTimestamp(parent.expires_at) ||
      !parent.allow_subdelegation || parent.state !== "ACTIVE" ||
      !sameObjectRef(parent.delegation_ref, request.parent_delegation_ref) ||
      sameObjectRef(parent.delegation_ref, request.delegation_ref) ||
      !sameScopeRef(parent.scope_ref, request.scope_ref) ||
      (now !== undefined && (!isTimestamp(parent.expires_at) || Date.parse(parent.expires_at) <= Date.parse(now))) ||
      request.allowed_actions.some(action => !parent.allowed_actions.includes(action)) ||
      request.resource_constraints.some(resource => !parent.resource_constraints.some(allowed => isExactObjectRef(allowed, resource))) ||
      request.limits.some(limit => !parent.limits.includes(limit)) ||
      parent.limits.some(limit => !request.limits.includes(limit)) ||
      parent.conditions.some(parentCondition => !request.conditions.some(condition =>
        condition.condition_id === parentCondition.condition_id &&
        condition.condition_kind === parentCondition.condition_kind &&
        condition.must_hold_at_enforcement === parentCondition.must_hold_at_enforcement &&
        JSON.stringify(condition.parameters_ref ?? null) === JSON.stringify(parentCondition.parameters_ref ?? null))) ||
      request.conditions.some(condition => !parent.conditions.some(parentCondition =>
        parentCondition.condition_id === condition.condition_id &&
        parentCondition.condition_kind === condition.condition_kind &&
        parentCondition.must_hold_at_enforcement === condition.must_hold_at_enforcement &&
        JSON.stringify(parentCondition.parameters_ref ?? null) === JSON.stringify(condition.parameters_ref ?? null))) ||
      Date.parse(request.expires_at) > Date.parse(parent.expires_at) ||
      Date.parse(request.not_before) < Date.parse(parent.not_before) ||
      !samePrincipal(request.grantor_ref, parent.delegate_ref)) {
      issues.push("child delegation exceeds or is not authorized by the parent delegation");
    }
  } else if (request.allow_subdelegation && !authority.grantor_may_subdelegate) {
    issues.push("subdelegation is not explicitly authorized");
  }
  if (now !== undefined && Date.parse(request.expires_at) <= Date.parse(now)) {
    issues.push("delegation is already expired");
  }
  if (authority.grantor_valid_from && Date.parse(request.not_before) < Date.parse(authority.grantor_valid_from)) {
    issues.push("delegation begins before the grantor's own authority");
  }
  if (authority.valid_until && Date.parse(request.expires_at) > Date.parse(authority.valid_until)) {
    issues.push("delegation outlives the grantor's current authority");
  }
  return issues;
}

/**
 * The adapter returns the complete current delegation ancestry, immediate parent first,
 * followed by its parent, until the root. Missing, duplicate or reordered links fail closed.
 */
export function validateDelegationLineage(
  request: DelegationRequest,
  ancestry: DelegationRecord[],
  now: Timestamp,
): string[] {
  const issues: string[] = [];
  if (!isTimestamp(now) || !Array.isArray(ancestry)) return ["delegation ancestry is unavailable or malformed"];
  if (!request.parent_delegation_ref) {
    if (ancestry.length) issues.push("root delegation cannot carry an unexpected parent chain");
    return issues;
  }
  if (!ancestry.length) return ["complete parent delegation lineage is required"];

  const seen = new Set<string>();
  const key = (ref: ObjectRef) => JSON.stringify([
    ref.scope_ref.scope_kind, ref.scope_ref.scope_id, ref.object_kind, ref.object_id,
  ]);
  for (let i = 0; i < ancestry.length; i++) {
    const current = ancestry[i];
    if (!current || !isObjectRef(current.delegation_ref) ||
        current.delegation_ref.object_kind !== "DELEGATION" ||
        !isScopeRef(current.scope_ref) ||
        !sameScopeRef(current.scope_ref, request.scope_ref) ||
        !sameScopeRef(current.delegation_ref.scope_ref, request.scope_ref) ||
        !isPrincipalRef(current.grantor_ref) || !isPrincipalRef(current.delegate_ref) ||
        !isTimestamp(current.not_before) || !isTimestamp(current.expires_at) ||
        !Array.isArray(current.allowed_actions) ||
        !Array.isArray(current.resource_constraints) ||
        !Array.isArray(current.limits) || !Array.isArray(current.conditions)) {
      issues.push("parent delegation ancestry contains a malformed or cross-scope record");
      continue;
    }
    const currentKey = key(current.delegation_ref);
    if (seen.has(currentKey) || currentKey === key(request.delegation_ref)) {
      issues.push("delegation cycle or self-reference detected");
    }
    seen.add(currentKey);
    if (current.state !== "ACTIVE" || Date.parse(current.not_before) > Date.parse(now) ||
        Date.parse(current.expires_at) <= Date.parse(now)) {
      issues.push("every ancestor delegation must remain active and current");
    }
    if (!current.allow_subdelegation) issues.push("an ancestor does not permit subdelegation");
    if (request.allowed_actions.some(action => !current.allowed_actions.includes(action)) ||
        request.resource_constraints.some(resource =>
          !current.resource_constraints.some(allowed => isExactObjectRef(allowed, resource))) ||
        request.limits.some(limit => !current.limits.includes(limit)) ||
        Date.parse(request.not_before) < Date.parse(current.not_before) ||
        Date.parse(request.expires_at) > Date.parse(current.expires_at)) {
      issues.push("child delegation exceeds an ancestor's effective authority");
    }
    if (request.conditions.some(condition => !current.conditions.some(parentCondition =>
      parentCondition.condition_id === condition.condition_id &&
      parentCondition.condition_kind === condition.condition_kind &&
      parentCondition.must_hold_at_enforcement === condition.must_hold_at_enforcement &&
      JSON.stringify(parentCondition.parameters_ref ?? null) === JSON.stringify(condition.parameters_ref ?? null)))) {
      issues.push("child delegation weakens or changes an ancestor condition");
    }
    const next = ancestry[i + 1];
    if (current.parent_delegation_ref) {
      if (!next || !sameObjectRef(current.parent_delegation_ref, next.delegation_ref)) {
        issues.push("delegation ancestry is incomplete or incorrectly ordered");
      } else if (!samePrincipal(current.grantor_ref, next.delegate_ref)) {
        issues.push("delegation ancestry actor lineage is broken");
      }
    } else if (next) {
      issues.push("delegation ancestry contains records beyond its root");
    }
  }
  if (!sameObjectRef(ancestry[0].delegation_ref, request.parent_delegation_ref) ||
      !samePrincipal(request.grantor_ref, ancestry[0].delegate_ref)) {
    issues.push("grantor is not the delegate of the exact parent delegation");
  }
  return [...new Set(issues)];
}

function samePrincipal(a: PrincipalRef, b: PrincipalRef): boolean {
  return a.principal_id === b.principal_id && a.principal_kind === b.principal_kind;
}

export function activateDelegation(
  delegation: DelegationRecord,
  now: Timestamp,
): OperationResult<DelegationRecord> {
  if (!isTimestamp(now)) return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
    errors: [createOperationError("VALIDATION_ERROR", "Activation timestamp is invalid")] });
  if (delegation.state !== "SCHEDULED" && delegation.state !== "PENDING_APPROVAL") {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("VERSION_CONFLICT", "Delegation cannot be activated from its current state")] });
  }
  if (Date.parse(delegation.not_before) > Date.parse(now) || Date.parse(delegation.expires_at) <= Date.parse(now)) {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("POLICY_DENIED", "Delegation is outside its validity window")] });
  }
  return createOperationResult({ status: "OK", correlation_id: "authorization",
    data: { ...delegation, state: "ACTIVE" } });
}

export function transitionDelegation(
  delegation: DelegationRecord,
  to: DelegationState,
  now: Timestamp,
): OperationResult<DelegationRecord> {
  if (!delegation || typeof delegation !== "object" ||
      !isObjectRef(delegation.delegation_ref) ||
      delegation.delegation_ref.object_kind !== "DELEGATION" ||
      !isScopeRef(delegation.scope_ref) ||
      !sameScopeRef(delegation.delegation_ref.scope_ref, delegation.scope_ref) ||
      !isTimestamp(delegation.not_before) ||
      !isTimestamp(delegation.expires_at) ||
      !(DELEGATION_STATES as readonly string[]).includes(delegation.state)) {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("VALIDATION_ERROR", "Delegation record is malformed")] });
  }
  if (!isTimestamp(now)) return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
    errors: [createOperationError("VALIDATION_ERROR", "Delegation transition timestamp is invalid")] });
  const allowed: Record<DelegationState, DelegationState[]> = {
    PENDING_APPROVAL: ["SCHEDULED", "ACTIVE", "REVOKED", "EXPIRED"],
    SCHEDULED: ["ACTIVE", "REVOKED", "EXPIRED"],
    ACTIVE: ["SUSPENDED", "REVOKED", "EXPIRED"],
    SUSPENDED: ["ACTIVE", "REVOKED", "EXPIRED"],
    REVOKED: [],
    EXPIRED: [],
  };
  if (!allowed[delegation.state].includes(to)) {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("VERSION_CONFLICT", "Delegation state transition is not permitted")] });
  }
  if (to === "ACTIVE" && (
    Date.parse(delegation.not_before) > Date.parse(now) ||
    Date.parse(delegation.expires_at) <= Date.parse(now)
  )) {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("POLICY_DENIED", "Delegation is not within its validity window")] });
  }
  if (to === "EXPIRED" && Date.parse(delegation.expires_at) > Date.parse(now)) {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("POLICY_DENIED", "Delegation has not yet expired")] });
  }
  return createOperationResult({ status: "OK", correlation_id: "authorization",
    data: { ...delegation, state: to, ...(to === "REVOKED" ? { revoked_at: now } : {}) } });
}

export function transitionPolicyRelease(
  release: PolicyRelease,
  to: PolicyReleaseState,
  now: Timestamp,
): OperationResult<PolicyRelease> {
  if (!release || typeof release !== "object" ||
      !isObjectRef(release.policy_release_ref) ||
      release.policy_release_ref.object_kind !== "POLICY_RELEASE" ||
      !isVersion(release.version) ||
      release.policy_release_ref.object_version !== release.version ||
      !release.ruleset_digest?.trim() ||
      !(POLICY_RELEASE_STATES as readonly string[]).includes(release.state)) {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("VALIDATION_ERROR", "Policy release record is malformed")] });
  }
  const sequence: PolicyReleaseState[] = [
    "DRAFT", "VALIDATED", "STATIC_ANALYSIS_PASSED", "SCENARIO_TESTED",
    "CONFLICT_TESTED", "REGRESSION_TESTED", "IMPACT_REVIEWED", "APPROVED",
    "RELEASED", "MONITORING",
  ];
  const currentIndex = sequence.indexOf(release.state);
  const nextIndex = sequence.indexOf(to);
  const allowed = (nextIndex === currentIndex + 1) ||
    ((release.state === "RELEASED" || release.state === "MONITORING") && to === "SUSPENDED") ||
    ((release.state === "MONITORING" || release.state === "SUSPENDED") && to === "RETIRED");
  if (!release || !isObjectRef(release.policy_release_ref) ||
      release.policy_release_ref.object_kind !== "POLICY_RELEASE" ||
      !isVersion(release.version) ||
      release.policy_release_ref.object_version !== release.version ||
      !release.ruleset_digest?.trim() ||
      !allowed || !isTimestamp(now)) {
    return createOperationResult({ status: "REJECTED", correlation_id: "authorization",
      errors: [createOperationError("VERSION_CONFLICT", "Policy release identity or transition is invalid")] });
  }
  return createOperationResult({ status: "OK", correlation_id: "authorization",
    data: {
      ...release,
      state: to,
      ...(to === "RELEASED" ? { effective_from: now } : {}),
      ...(to === "SUSPENDED" ? { suspended_at: now } : {}),
      ...(to === "RETIRED" ? { retired_at: now } : {}),
    } });
}

export function isTrustAssessmentUsable(
  trust: TrustAssessment,
  scope: ScopeRef,
  now: Timestamp,
): boolean {
  return trust.trust_state === "TRUSTED_FOR_SCOPE" &&
    !!trust.trusted_scope_ref &&
    sameScopeRef(trust.trusted_scope_ref, scope) &&
    Date.parse(trust.assessed_at) <= Date.parse(now) &&
    (!trust.valid_until || Date.parse(trust.valid_until) > Date.parse(now));
}
