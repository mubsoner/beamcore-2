import {
  isObjectRef,
  isRequestContext,
  isRevisionNumber,
  isSourceRef,
  isTimestamp,
  type ID,
  type ObjectRef,
  type PrincipalRef,
  type OperationError,
  type RequestContext,
  type RevisionNumber,
  type SourceRef,
  type Timestamp,
} from "../shared";

export type RequirementKind = "MUST" | "SHOULD" | "PREFERENCE";
export type Materiality = "LOW" | "MATERIAL" | "CRITICAL";
export type AssumptionState = "ACTIVE" | "CONFIRMED" | "REJECTED" | "SUPERSEDED";
export type IntentLifecycleState =
  | "RECEIVED"
  | "NORMALIZED"
  | "AWAITING_CLARIFICATION"
  | "READY_FOR_DECISION"
  | "SUPERSEDED"
  | "WITHDRAWN";
export type RequestedWorkKind =
  | "INFORMATIONAL"
  | "RESEARCH"
  | "CREATION"
  | "AUTOMATION"
  | "INTEGRATION"
  | "EXISTING_WORK"
  | "UNDETERMINED";
export type CriterionImportance = "MUST" | "SHOULD" | "MAY";
export type EvaluationKind =
  | "AUTOMATED_TEST"
  | "METRIC_THRESHOLD"
  | "EXTERNAL_STATE_CHECK"
  | "HUMAN_REVIEW"
  | "CONTENT_REVIEW"
  | "OTHER";
export type OutcomeProposalState =
  | "DRAFT"
  | "SUBMITTED"
  | "ACCEPTED_BY_WORK"
  | "REJECTED_BY_WORK"
  | "SUPERSEDED"
  | "WITHDRAWN";
export type ClarificationState =
  | "OPEN"
  | "ANSWERED"
  | "EXPIRED"
  | "CANCELLED"
  | "SUPERSEDED";
export type DecisionDisposition =
  | "ANSWER_DIRECTLY"
  | "CLARIFY"
  | "RESEARCH"
  | "CREATE"
  | "AUTOMATE"
  | "CONNECT"
  | "CONTINUE_EXISTING_WORK"
  | "REQUEST_AUTHORIZATION"
  | "REQUEST_APPROVAL"
  | "STOP"
  | "DECLINE"
  | "ESCALATE_TO_HUMAN"
  | "UNSUPPORTED";
export type DecisionState =
  | "RECORDED"
  | "AWAITING_CLARIFICATION"
  | "ROUTE_SELECTED"
  | "HANDOFF_REQUESTED"
  | "HANDOFF_CONFIRMED"
  | "COMPLETED"
  | "DECLINED"
  | "STOPPED"
  | "BLOCKED"
  | "FAILED"
  | "UNKNOWN";

export interface Constraint {
  constraint_id: ID;
  kind: "SCOPE" | "COST" | "TIME" | "PRIVACY" | "SECURITY" | "QUALITY" | "TECHNICAL" | "RESOURCE" | "LEGAL" | "OTHER";
  operator: "EQ" | "NE" | "LT" | "LTE" | "GT" | "GTE" | "IN" | "NOT_IN" | "CONTAINS" | "BEFORE" | "AFTER";
  /** Decimal quantities are represented as exact decimal strings, never binary floats. */
  value: string | boolean | ObjectRef | string[];
  source_kind: "USER_STATED" | "TRUSTED_CONTEXT" | "POLICY" | "DERIVED_ASSUMPTION" | "EXISTING_WORK";
  mandatory: boolean;
  source_ref?: SourceRef;
}

export interface IntentRequest {
  raw_input: string;
  input_source_refs: SourceRef[];
  requested_context_refs: ObjectRef[];
  explicit_constraints: Constraint[];
  prior_intent_ref?: ObjectRef;
  related_work_ref?: ObjectRef;
  received_at: Timestamp;
}

export interface ExplicitRequirement {
  requirement_id: ID;
  statement: string;
  kind: RequirementKind;
  source_ref?: SourceRef;
  testable: boolean;
  acceptance_criterion_refs: ObjectRef[];
}

export interface Assumption {
  assumption_id: ID;
  statement: string;
  basis_refs: SourceRef[];
  materiality: Materiality;
  user_visible: boolean;
  must_resolve_before: "NONE" | "PROTECTED_ACTION" | "OUTCOME_ASSESSMENT" | "CONTINUATION";
  state: AssumptionState;
}

export interface UnknownItem {
  unknown_id: ID;
  description: string;
  impact: string;
  affected_requirement_refs: ObjectRef[];
  resolution_required: boolean;
}

export interface AmbiguityItem {
  ambiguity_id: ID;
  description: string;
  plausible_interpretations: string[];
  materiality: Materiality;
  clarification_required: boolean;
}

export interface ContextFact {
  fact_id: ID;
  permitted_summary: string;
  source_ref: SourceRef;
  freshness_status: "CURRENT" | "STALE" | "UNKNOWN";
}

export interface NormalizedIntent {
  intent_ref: ObjectRef;
  revision_number: RevisionNumber;
  lifecycle_state: IntentLifecycleState;
  prior_revision_ref?: ObjectRef;
  user_goal_summary: string;
  requested_work_kind: RequestedWorkKind;
  desired_effect_summary: string;
  explicit_requirements: ExplicitRequirement[];
  contextual_facts: ContextFact[];
  assumptions: Assumption[];
  unknowns: UnknownItem[];
  ambiguity_items: AmbiguityItem[];
  constraints: Constraint[];
  source_refs: SourceRef[];
  created_at: Timestamp;
}

export interface AcceptanceCriterion {
  criterion_id: ID;
  description: string;
  evaluation_kind: EvaluationKind;
  evaluation_method: string;
  expected_result: string;
  evidence_required: boolean;
  importance: CriterionImportance;
  source_ref?: SourceRef;
}

export interface OutcomeProposal {
  proposal_ref: ObjectRef;
  intent_ref: ObjectRef;
  proposal_revision: RevisionNumber;
  desired_effect: string;
  acceptance_criteria: AcceptanceCriterion[];
  assumption_refs: ObjectRef[];
  unresolved_criterion_refs: ObjectRef[];
  state: OutcomeProposalState;
  created_at: Timestamp;
  supersedes_proposal_ref?: ObjectRef;
  acceptance_receipt_ref?: ObjectRef;
}

export interface OutcomeAcceptanceReceipt {
  receipt_ref: ObjectRef;
  proposal_ref: ObjectRef;
  work_ref: ObjectRef;
  acceptance_state: "ACCEPTED" | "REJECTED" | "UNKNOWN";
  acceptance_basis?: "EXPLICIT_USER_CONFIRMATION" | "POLICY_PERMITTED_INTERPRETATION" | "EXISTING_APPROVED_REQUIREMENT";
  accepted_target_ref?: ObjectRef;
  accepted_target_revision?: RevisionNumber;
  received_at?: Timestamp;
  error?: OperationError;
}

export interface ClarificationRequest {
  clarification_ref: ObjectRef;
  intent_ref: ObjectRef;
  question: string;
  decision_impact: string;
  required_field_ids: string[];
  state: ClarificationState;
  created_at: Timestamp;
  expires_at?: Timestamp;
  answered_by_ref?: PrincipalRef;
  answer_source_ref?: SourceRef;
}

export interface RouteProposal {
  route_ref: ObjectRef;
  disposition: DecisionDisposition;
  target_engine_id?: "INV-02" | "INV-03" | "INV-06" | "INV-07" | "INV-08" | "INV-13";
  target_operation?: string;
  input_refs: ObjectRef[];
  required_authority_check: boolean;
  created_at: Timestamp;
}

export interface DecisionLineageSummary {
  source_refs: SourceRef[];
  requirement_refs: ObjectRef[];
  contextual_fact_refs: ObjectRef[];
  assumption_refs: ObjectRef[];
  constraint_refs: ObjectRef[];
  policy_decision_refs: ObjectRef[];
  authority_decision_refs: ObjectRef[];
  capability_refs: ObjectRef[];
  uncertainty_summary: string[];
  rationale_summary: string;
}

export interface DecisionRecord {
  decision_ref: ObjectRef;
  intent_ref: ObjectRef;
  intent_revision: RevisionNumber;
  state: DecisionState;
  disposition: DecisionDisposition;
  route_proposal_ref?: ObjectRef;
  outcome_proposal_ref?: ObjectRef;
  clarification_ref?: ObjectRef;
  lineage: DecisionLineageSummary;
  created_at: Timestamp;
  correlation_id: ID;
  supersedes_decision_ref?: ObjectRef;
}

export interface IntentEvaluationResult {
  normalized_intent: NormalizedIntent;
  decision_record: DecisionRecord;
  outcome_proposal?: OutcomeProposal;
  clarification_request?: ClarificationRequest;
  route_proposal?: RouteProposal;
}

export interface NormalizeIntentInput {
  context: RequestContext;
  request: IntentRequest;
  intent_ref: ObjectRef;
  revision_number: RevisionNumber;
  user_goal_summary: string;
  requested_work_kind: RequestedWorkKind;
  desired_effect_summary: string;
  explicit_requirements: ExplicitRequirement[];
  contextual_facts: ContextFact[];
  assumptions: Assumption[];
  unknowns: UnknownItem[];
  ambiguity_items: AmbiguityItem[];
  created_at: Timestamp;
}

export interface DomainIssue {
  code: "VALIDATION_ERROR" | "VERSION_CONFLICT" | "INVALID_TRANSITION" | "INTEGRITY_OR_UNTRUSTED_INPUT";
  safe_message: string;
  field?: string;
}

export type DomainResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; issues: DomainIssue[] };

const ok = <T>(value: T, warnings: string[] = []): DomainResult<T> => ({
  ok: true,
  value,
  warnings,
});
const fail = <T = never>(code: DomainIssue["code"], safe_message: string, field?: string): DomainResult<T> => ({
  ok: false,
  issues: [{ code, safe_message, ...(field ? { field } : {}) }],
});

function allObjectRefs(values: readonly ObjectRef[]): boolean {
  return values.every(isObjectRef);
}
function allSourceRefs(values: readonly SourceRef[]): boolean {
  return values.every(isSourceRef);
}
function scopeMatches(ref: ObjectRef, context: RequestContext): boolean {
  return ref.scope_ref.scope_id === context.scope_ref.scope_id &&
    ref.scope_ref.scope_kind === context.scope_ref.scope_kind;
}

export function normalizeIntent(input: NormalizeIntentInput): DomainResult<NormalizedIntent> {
  const { context, request, intent_ref } = input;
  if (!isRequestContext(context)) return fail("VALIDATION_ERROR", "Canonical request context is invalid", "context");
  if (!isObjectRef(intent_ref) || intent_ref.object_kind !== "INTENT" || !scopeMatches(intent_ref, context)) {
    return fail("VALIDATION_ERROR", "Intent reference must be a scoped INTENT ObjectRef", "intent_ref");
  }
  if (!isTimestamp(request.received_at) || !isTimestamp(input.created_at)) {
    return fail("VALIDATION_ERROR", "Intent timestamps must be offset-aware RFC 3339 values");
  }
  if (!request.raw_input.trim() || !input.user_goal_summary.trim() || !input.desired_effect_summary.trim()) {
    return fail("VALIDATION_ERROR", "Raw input, goal summary and desired effect are required");
  }
  if (!isRevisionNumber(input.revision_number)) return fail("VALIDATION_ERROR", "revision_number must be a positive integer");
  if (!allSourceRefs(request.input_source_refs) || !allObjectRefs(request.requested_context_refs) ||
      !allSourceRefs(input.contextual_facts.map((fact) => fact.source_ref)) ||
      !allSourceRefs(input.assumptions.flatMap((assumption) => assumption.basis_refs)) ||
      !allSourceRefs(input.explicit_requirements.flatMap((requirement) => requirement.source_ref ? [requirement.source_ref] : []))) {
    return fail("INTEGRITY_OR_UNTRUSTED_INPUT", "Intent contains an invalid or untrusted reference shape");
  }
  if (request.prior_intent_ref && !isObjectRef(request.prior_intent_ref)) return fail("VALIDATION_ERROR", "prior_intent_ref is invalid");
  if (request.related_work_ref && (!isObjectRef(request.related_work_ref) || request.related_work_ref.object_kind !== "WORK")) {
    return fail("VALIDATION_ERROR", "related_work_ref must reference a WORK object");
  }

  const hasRequiredClarification =
    input.ambiguity_items.some((item) => item.clarification_required && item.materiality !== "LOW") ||
    input.assumptions.some((item) => item.state === "ACTIVE" && item.materiality === "CRITICAL" && item.must_resolve_before !== "NONE") ||
    input.unknowns.some((item) => item.resolution_required);
  const lifecycle_state: IntentLifecycleState = hasRequiredClarification
    ? "AWAITING_CLARIFICATION"
    : "NORMALIZED";

  return ok({
    intent_ref,
    revision_number: input.revision_number,
    lifecycle_state,
    ...(request.prior_intent_ref ? { prior_revision_ref: request.prior_intent_ref } : {}),
    user_goal_summary: input.user_goal_summary,
    requested_work_kind: input.requested_work_kind,
    desired_effect_summary: input.desired_effect_summary,
    explicit_requirements: [...input.explicit_requirements],
    contextual_facts: [...input.contextual_facts],
    assumptions: [...input.assumptions],
    unknowns: [...input.unknowns],
    ambiguity_items: [...input.ambiguity_items],
    constraints: [...request.explicit_constraints],
    source_refs: [...request.input_source_refs],
    created_at: input.created_at,
  });
}

export function reviseIntent(
  current: NormalizedIntent,
  next: Omit<NormalizeIntentInput, "context" | "request"> & { context: RequestContext; request: IntentRequest },
): DomainResult<NormalizedIntent> {
  if (next.revision_number !== current.revision_number + 1) {
    return fail("VERSION_CONFLICT", "A new intent revision must increment the current revision by exactly one");
  }
  if (next.request.prior_intent_ref &&
      (next.request.prior_intent_ref.object_id !== current.intent_ref.object_id ||
       next.request.prior_intent_ref.object_kind !== current.intent_ref.object_kind)) {
    return fail("VALIDATION_ERROR", "prior_intent_ref must identify the intent being revised");
  }
  if (next.intent_ref.object_id === current.intent_ref.object_id &&
      next.intent_ref.object_version === current.intent_ref.object_version) {
    return fail("VALIDATION_ERROR", "A revised intent must have a new object version");
  }
  return normalizeIntent({
    ...next,
    request: { ...next.request, prior_intent_ref: current.intent_ref },
  });
}

export function createOutcomeProposal(input: {
  proposal_ref: ObjectRef;
  intent: NormalizedIntent;
  proposal_revision: RevisionNumber;
  desired_effect: string;
  acceptance_criteria: AcceptanceCriterion[];
  assumption_refs: ObjectRef[];
  unresolved_criterion_refs: ObjectRef[];
  created_at: Timestamp;
  supersedes_proposal_ref?: ObjectRef;
}): DomainResult<OutcomeProposal> {
  if (!isObjectRef(input.proposal_ref) || input.proposal_ref.object_kind !== "OUTCOME_PROPOSAL") {
    return fail("VALIDATION_ERROR", "proposal_ref must identify an OUTCOME_PROPOSAL");
  }
  if (!isObjectRef(input.intent.intent_ref) || !input.desired_effect.trim() || !isRevisionNumber(input.proposal_revision)) {
    return fail("VALIDATION_ERROR", "A valid intent, desired effect and positive proposal revision are required");
  }
  if (!isTimestamp(input.created_at) || !allObjectRefs(input.assumption_refs) || !allObjectRefs(input.unresolved_criterion_refs)) {
    return fail("VALIDATION_ERROR", "Proposal timestamp or references are invalid");
  }
  if (input.acceptance_criteria.some((criterion) =>
    !criterion.criterion_id.trim() ||
    !criterion.description.trim() ||
    !criterion.evaluation_method.trim() ||
    !criterion.expected_result.trim()
  )) {
    return fail("VALIDATION_ERROR", "Acceptance criteria must have descriptions, methods and expected results");
  }
  const state: OutcomeProposalState =
    input.intent.lifecycle_state === "READY_FOR_DECISION" &&
    input.acceptance_criteria.length > 0 &&
    input.unresolved_criterion_refs.length === 0
      ? "SUBMITTED"
      : "DRAFT";
  return ok({
    proposal_ref: input.proposal_ref,
    intent_ref: input.intent.intent_ref,
    proposal_revision: input.proposal_revision,
    desired_effect: input.desired_effect,
    acceptance_criteria: [...input.acceptance_criteria],
    assumption_refs: [...input.assumption_refs],
    unresolved_criterion_refs: [...input.unresolved_criterion_refs],
    state,
    created_at: input.created_at,
    ...(input.supersedes_proposal_ref ? { supersedes_proposal_ref: input.supersedes_proposal_ref } : {}),
  });
}

export function applyOutcomeAcceptanceReceipt(
  proposal: OutcomeProposal,
  receipt: OutcomeAcceptanceReceipt,
): DomainResult<OutcomeProposal> {
  if (!isObjectRef(receipt.receipt_ref) || receipt.receipt_ref.object_kind !== "OUTCOME_ACCEPTANCE_RECEIPT" ||
      !isObjectRef(receipt.proposal_ref) || receipt.proposal_ref.object_id !== proposal.proposal_ref.object_id ||
      receipt.proposal_ref.scope_ref.scope_id !== proposal.proposal_ref.scope_ref.scope_id) {
    return fail("VALIDATION_ERROR", "Acceptance receipt does not belong to this proposal");
  }
  if (receipt.received_at && !isTimestamp(receipt.received_at)) return fail("VALIDATION_ERROR", "Receipt timestamp is invalid");
  if (receipt.acceptance_state === "ACCEPTED" &&
      (!receipt.accepted_target_ref || !isObjectRef(receipt.accepted_target_ref) ||
       receipt.accepted_target_ref.object_kind !== "WORK_DESIRED_OUTCOME_REVISION" ||
       !isRevisionNumber(receipt.accepted_target_revision))) {
    return fail("VALIDATION_ERROR", "An accepted receipt must reference the authoritative Work target revision");
  }
  const state: OutcomeProposalState =
    receipt.acceptance_state === "ACCEPTED" ? "ACCEPTED_BY_WORK" :
    receipt.acceptance_state === "REJECTED" ? "REJECTED_BY_WORK" : proposal.state;
  return ok({
    ...proposal,
    state,
    acceptance_receipt_ref: receipt.receipt_ref,
  });
}

export function transitionIntent(
  intent: NormalizedIntent,
  target: IntentLifecycleState,
): DomainResult<NormalizedIntent> {
  const allowed: Record<IntentLifecycleState, readonly IntentLifecycleState[]> = {
    RECEIVED: ["NORMALIZED", "AWAITING_CLARIFICATION", "WITHDRAWN"],
    NORMALIZED: ["AWAITING_CLARIFICATION", "READY_FOR_DECISION", "SUPERSEDED", "WITHDRAWN"],
    AWAITING_CLARIFICATION: ["NORMALIZED", "READY_FOR_DECISION", "SUPERSEDED", "WITHDRAWN"],
    READY_FOR_DECISION: ["SUPERSEDED", "WITHDRAWN"],
    SUPERSEDED: [],
    WITHDRAWN: [],
  };
  if (!allowed[intent.lifecycle_state].includes(target)) {
    return fail("INVALID_TRANSITION", `Intent cannot transition from ${intent.lifecycle_state} to ${target}`);
  }
  return ok({ ...intent, lifecycle_state: target });
}

export function createRouteProposal(input: {
  route_ref: ObjectRef;
  intent: NormalizedIntent;
  disposition: DecisionDisposition;
  target_engine_id?: "INV-02" | "INV-03" | "INV-06" | "INV-07" | "INV-08" | "INV-13";
  target_operation?: string;
  input_refs: ObjectRef[];
  required_authority_check: boolean;
  created_at: Timestamp;
}): DomainResult<RouteProposal> {
  const allowed = canSelectRoute(input.disposition, input.intent);
  if (!allowed.ok) return allowed;
  if (!isObjectRef(input.route_ref) || input.route_ref.object_kind !== "ROUTE_PROPOSAL" ||
      !isTimestamp(input.created_at) || !allObjectRefs(input.input_refs)) {
    return fail("VALIDATION_ERROR", "Route proposal reference, input refs or timestamp are invalid");
  }
  const targetByDisposition: Partial<Record<DecisionDisposition, readonly string[]>> = {
    RESEARCH: ["INV-13"],
    CREATE: ["INV-02", "INV-03"],
    AUTOMATE: ["INV-02", "INV-03"],
    CONNECT: ["INV-07"],
    CONTINUE_EXISTING_WORK: ["INV-02"],
    REQUEST_AUTHORIZATION: ["INV-06"],
    REQUEST_APPROVAL: ["INV-06"],
  };
  const permittedTargets = targetByDisposition[input.disposition];
  if (permittedTargets && (!input.target_engine_id || !permittedTargets.includes(input.target_engine_id))) {
    return fail("VALIDATION_ERROR", "Route target engine is not valid for the selected disposition");
  }
  if (!permittedTargets && input.target_engine_id !== undefined) {
    return fail("VALIDATION_ERROR", "This disposition must not dispatch to a target engine");
  }
  if (input.target_engine_id && (!input.target_operation?.trim() || input.input_refs.length === 0)) {
    return fail("VALIDATION_ERROR", "A handoff route requires an operation and typed input references");
  }
  return ok({
    route_ref: input.route_ref,
    disposition: input.disposition,
    ...(input.target_engine_id ? { target_engine_id: input.target_engine_id } : {}),
    ...(input.target_operation ? { target_operation: input.target_operation } : {}),
    input_refs: [...input.input_refs],
    required_authority_check: input.required_authority_check,
    created_at: input.created_at,
  });
}

export function createDecisionRecord(input: {
  context: RequestContext;
  decision_ref: ObjectRef;
  intent: NormalizedIntent;
  disposition: DecisionDisposition;
  route_proposal?: RouteProposal;
  outcome_proposal?: OutcomeProposal;
  clarification?: ClarificationRequest;
  policy_decision_refs?: ObjectRef[];
  authority_decision_refs?: ObjectRef[];
  capability_refs?: ObjectRef[];
  rationale_summary: string;
  assumption_refs?: ObjectRef[];
  constraint_refs?: ObjectRef[];
  created_at: Timestamp;
  supersedes_decision_ref?: ObjectRef;
}): DomainResult<DecisionRecord> {
  const allowed = canSelectRoute(input.disposition, input.intent);
  if (!allowed.ok) return allowed;
  if (!isRequestContext(input.context) ||
      input.context.scope_ref.scope_id !== input.intent.intent_ref.scope_ref.scope_id ||
      input.context.scope_ref.scope_kind !== input.intent.intent_ref.scope_ref.scope_kind ||
      !isObjectRef(input.decision_ref) || input.decision_ref.object_kind !== "DECISION_RECORD" ||
      !isTimestamp(input.created_at) || !input.rationale_summary.trim() ||
      !allObjectRefs(input.assumption_refs ?? []) || !allObjectRefs(input.constraint_refs ?? [])) {
    return fail("VALIDATION_ERROR", "Decision record reference, timestamp and redacted rationale are required");
  }
  if (input.route_proposal && input.route_proposal.disposition !== input.disposition) {
    return fail("VALIDATION_ERROR", "Decision disposition must match its route proposal");
  }
  if (input.outcome_proposal && input.outcome_proposal.intent_ref.object_id !== input.intent.intent_ref.object_id) {
    return fail("VALIDATION_ERROR", "Outcome proposal must belong to the normalized intent");
  }
  if (input.clarification && input.clarification.intent_ref.object_id !== input.intent.intent_ref.object_id) {
    return fail("VALIDATION_ERROR", "Clarification request must belong to the normalized intent");
  }
  const state: DecisionState =
    input.disposition === "CLARIFY" ? "AWAITING_CLARIFICATION" :
    input.disposition === "STOP" ? "STOPPED" :
    input.disposition === "DECLINE" || input.disposition === "UNSUPPORTED" ? "DECLINED" :
    input.disposition === "ESCALATE_TO_HUMAN" ? "BLOCKED" :
    input.disposition === "REQUEST_AUTHORIZATION" || input.disposition === "REQUEST_APPROVAL" ? "BLOCKED" :
    input.route_proposal ? "ROUTE_SELECTED" : "RECORDED";
  return ok({
    decision_ref: input.decision_ref,
    intent_ref: input.intent.intent_ref,
    intent_revision: input.intent.revision_number,
    state,
    disposition: input.disposition,
    ...(input.route_proposal ? { route_proposal_ref: input.route_proposal.route_ref } : {}),
    ...(input.outcome_proposal ? { outcome_proposal_ref: input.outcome_proposal.proposal_ref } : {}),
    ...(input.clarification ? { clarification_ref: input.clarification.clarification_ref } : {}),
    lineage: {
      source_refs: [...input.intent.source_refs],
      requirement_refs: input.intent.explicit_requirements.flatMap((item) => item.acceptance_criterion_refs),
      contextual_fact_refs: input.intent.contextual_facts.map((item) => item.source_ref.object_ref),
      assumption_refs: [...(input.assumption_refs ?? [])],
      constraint_refs: [...(input.constraint_refs ?? [])],
      policy_decision_refs: [...(input.policy_decision_refs ?? [])],
      authority_decision_refs: [...(input.authority_decision_refs ?? [])],
      capability_refs: [...(input.capability_refs ?? [])],
      uncertainty_summary: [
        ...input.intent.unknowns.map((item) => item.description),
        ...input.intent.ambiguity_items.map((item) => item.description),
      ],
      rationale_summary: input.rationale_summary,
    },
    created_at: input.created_at,
    correlation_id: input.context.correlation_id,
    ...(input.supersedes_decision_ref ? { supersedes_decision_ref: input.supersedes_decision_ref } : {}),
  });
}

export function transitionDecision(
  decision: DecisionRecord,
  target: DecisionState,
): DomainResult<DecisionRecord> {
  const allowed: Record<DecisionState, readonly DecisionState[]> = {
    RECORDED: ["AWAITING_CLARIFICATION", "ROUTE_SELECTED", "BLOCKED", "DECLINED", "STOPPED"],
    AWAITING_CLARIFICATION: ["RECORDED", "ROUTE_SELECTED", "BLOCKED", "STOPPED", "DECLINED"],
    ROUTE_SELECTED: ["HANDOFF_REQUESTED", "BLOCKED", "STOPPED", "FAILED", "UNKNOWN"],
    HANDOFF_REQUESTED: ["HANDOFF_CONFIRMED", "BLOCKED", "FAILED", "UNKNOWN"],
    HANDOFF_CONFIRMED: ["COMPLETED", "FAILED", "UNKNOWN"],
    COMPLETED: [],
    DECLINED: [],
    STOPPED: [],
    BLOCKED: ["RECORDED", "ROUTE_SELECTED", "STOPPED", "DECLINED", "FAILED", "UNKNOWN"],
    FAILED: [],
    UNKNOWN: [],
  };
  if (!allowed[decision.state].includes(target)) {
    return fail("INVALID_TRANSITION", `Decision cannot transition from ${decision.state} to ${target}`);
  }
  return ok({ ...decision, state: target });
}

export function canSelectRoute(
  disposition: DecisionDisposition,
  intent: NormalizedIntent,
): DomainResult<void> {
  if (intent.lifecycle_state === "AWAITING_CLARIFICATION" &&
      disposition !== "CLARIFY" && disposition !== "STOP" && disposition !== "ESCALATE_TO_HUMAN") {
    return fail("INVALID_TRANSITION", "A material clarification must be resolved before selecting this route");
  }
  if (intent.lifecycle_state !== "READY_FOR_DECISION" &&
      disposition !== "CLARIFY" && disposition !== "STOP" &&
      disposition !== "DECLINE" && disposition !== "ESCALATE_TO_HUMAN") {
    return fail("INVALID_TRANSITION", "Intent must reach READY_FOR_DECISION before a route is selected");
  }
  return ok(undefined);
}
