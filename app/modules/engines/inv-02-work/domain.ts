import {
  isObjectRef,
  isPrincipalRef,
  isRequestContext,
  isRevisionNumber,
  isTimestamp,
  type ID,
  type ObjectRef,
  type PrincipalRef,
  type RequestContext,
  type RevisionNumber,
  type Timestamp,
} from "../shared";
import type {
  AcceptanceCriterion,
  OutcomeProposal,
  OutcomeAcceptanceReceipt,
} from "../inv-01-intent/domain";

export type WorkLifecycleState =
  | "PROPOSED" | "READY" | "IN_PROGRESS" | "WAITING" | "BLOCKED"
  | "PAUSED" | "RECOVERING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type WorkPhase =
  | "INTAKE" | "UNDERSTANDING" | "RESEARCH" | "DESIGNING" | "PLANNING"
  | "CREATION" | "EXECUTION" | "VERIFICATION" | "OUTCOME_ASSESSMENT"
  | "ADAPTATION" | "OPERATION" | "OTHER";
export type WorkBlockerKind =
  | "NEEDS_INFORMATION" | "NEEDS_APPROVAL" | "DEPENDENCY"
  | "CAPABILITY_UNAVAILABLE" | "RESOURCE_LIMIT"
  | "AUTHORIZATION_UNAVAILABLE" | "EXTERNAL_STATE_UNCERTAIN" | "OTHER";
export type WorkBlockerState = "OPEN" | "RESOLVED" | "SUPERSEDED";
export type WorkClosureDisposition =
  | "NORMAL_FINISH" | "TERMINAL_FAILURE" | "CANCELLED_BY_AUTHORIZED_ACTOR"
  | "SUPERSEDED" | "OUT_OF_SCOPE";
export type OutcomeAcceptanceBasis =
  | "EXPLICIT_USER_CONFIRMATION"
  | "POLICY_PERMITTED_INTERPRETATION"
  | "EXISTING_APPROVED_REQUIREMENT";

export interface WorkRecord {
  work_ref: ObjectRef;
  scope_ref: RequestContext["scope_ref"];
  title: string;
  summary: string;
  origin_intent_ref: ObjectRef;
  owner_ref: ObjectRef;
  custodian_ref?: PrincipalRef;
  lifecycle_state: WorkLifecycleState;
  current_phase: WorkPhase;
  current_revision: RevisionNumber;
  current_desired_outcome_ref?: ObjectRef;
  current_plan_ref?: ObjectRef;
  current_work_graph_ref?: ObjectRef;
  relationship_refs: ObjectRef[];
  blocker_refs: ObjectRef[];
  latest_outcome_assessment_ref?: ObjectRef;
  created_by: PrincipalRef;
  created_at: Timestamp;
  updated_at: Timestamp;
  closed_at?: Timestamp;
  closure_disposition?: WorkClosureDisposition;
  closure_reason?: string;
}

export interface WorkRevision {
  revision_ref: ObjectRef;
  work_ref: ObjectRef;
  revision_number: RevisionNumber;
  prior_revision_ref?: ObjectRef;
  changed_field_paths: string[];
  intent_ref?: ObjectRef;
  desired_outcome_revision_ref?: ObjectRef;
  plan_ref?: ObjectRef;
  work_graph_ref?: ObjectRef;
  changed_by: PrincipalRef;
  change_reason: string;
  created_at: Timestamp;
}

export interface WorkDesiredOutcomeRevision {
  desired_outcome_ref: ObjectRef;
  work_ref: ObjectRef;
  revision_number: RevisionNumber;
  source_proposal_ref: ObjectRef;
  source_intent_ref: ObjectRef;
  desired_effect: string;
  acceptance_criteria: AcceptanceCriterion[];
  unresolved_criterion_refs: ObjectRef[];
  acceptance_basis: OutcomeAcceptanceBasis;
  acceptance_basis_ref: ObjectRef;
  accepted_by?: PrincipalRef;
  accepted_at: Timestamp;
  supersedes_ref?: ObjectRef;
  state: "ACTIVE" | "SUPERSEDED";
}

export interface WorkBlocker {
  blocker_ref: ObjectRef;
  work_ref: ObjectRef;
  kind: WorkBlockerKind;
  state: WorkBlockerState;
  summary: string;
  source_ref?: ObjectRef;
  opened_by: PrincipalRef;
  opened_at: Timestamp;
  resolution_condition: string;
  resolved_by?: PrincipalRef;
  resolved_at?: Timestamp;
  resolution_ref?: ObjectRef;
}

export interface WorkAuthorityEvidence {
  decision_ref: ObjectRef;
  disposition: "ALLOWED" | "DENIED" | "REQUIRES_APPROVAL" | "UNKNOWN";
}

export interface WorkTransitionGuards {
  active_blocker_count: number;
  prerequisites_satisfied: boolean;
  orchestrator_eligible: boolean;
  reconciliation_complete: boolean;
}

export interface WorkTransitionCommand {
  expected_version: RevisionNumber;
  target_state: WorkLifecycleState;
  reason_ref: ObjectRef;
  occurred_at: Timestamp;
  authority: WorkAuthorityEvidence;
  guards: WorkTransitionGuards;
  closure_disposition?: WorkClosureDisposition;
  closure_reason?: string;
}

export interface WorkTransitionResult {
  work: WorkRecord;
  revision: WorkRevision;
}

export interface AcceptOutcomeProposalCommand {
  context: RequestContext;
  work: WorkRecord;
  proposal: OutcomeProposal;
  desired_outcome_ref: ObjectRef;
  receipt_ref: ObjectRef;
  acceptance_basis: OutcomeAcceptanceBasis;
  acceptance_basis_ref: ObjectRef;
  accepted_by?: PrincipalRef;
  accepted_at: Timestamp;
  expected_work_version: RevisionNumber;
  authority: WorkAuthorityEvidence;
  has_material_unresolved_unknowns: boolean;
  policy_interpretation_permitted?: boolean;
  current_target_revision?: RevisionNumber;
}

export interface AcceptOutcomeProposalResult {
  desired_outcome: WorkDesiredOutcomeRevision;
  receipt: OutcomeAcceptanceReceipt;
  work: WorkRecord;
  revision: WorkRevision;
}

export interface PlanGraphActivationBindingReceipt {
  receipt_ref: ObjectRef;
  request_ref: ObjectRef;
  work_ref: ObjectRef;
  plan_revision_ref: ObjectRef;
  graph_revision_ref: ObjectRef;
  expected_work_revision: RevisionNumber;
  resulting_work_revision: RevisionNumber;
  receipt_state: "ACCEPTED" | "REJECTED" | "UNKNOWN";
  received_at: Timestamp;
  reason_ref?: ObjectRef;
}

export type WorkDomainIssue = {
  code: "VALIDATION_ERROR" | "VERSION_CONFLICT" | "INVALID_TRANSITION" |
    "FORBIDDEN" | "APPROVAL_REQUIRED" | "INTEGRITY_OR_UNTRUSTED_INPUT" |
    "OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED";
  safe_message: string;
  field?: string;
};
export type WorkDomainResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; issues: WorkDomainIssue[] };

const ok = <T>(value: T, warnings: string[] = []): WorkDomainResult<T> => ({ ok: true, value, warnings });
const fail = <T = never>(code: WorkDomainIssue["code"], safe_message: string, field?: string): WorkDomainResult<T> => ({
  ok: false,
  issues: [{ code, safe_message, ...(field ? { field } : {}) }],
});
const sameScope = (a: ObjectRef, b: ObjectRef) =>
  a.scope_ref.scope_id === b.scope_ref.scope_id && a.scope_ref.scope_kind === b.scope_ref.scope_kind;
const sameRef = (a: ObjectRef, b: ObjectRef) =>
  a.object_kind === b.object_kind &&
  a.object_id === b.object_id &&
  a.object_version === b.object_version &&
  sameScope(a, b);
const transitionMap: Record<WorkLifecycleState, readonly WorkLifecycleState[]> = {
  PROPOSED: ["READY", "WAITING", "BLOCKED", "PAUSED", "CANCELLED"],
  READY: ["IN_PROGRESS", "WAITING", "BLOCKED", "PAUSED", "CANCELLED"],
  IN_PROGRESS: ["WAITING", "BLOCKED", "PAUSED", "RECOVERING", "COMPLETED", "FAILED", "CANCELLED"],
  WAITING: ["READY", "IN_PROGRESS", "BLOCKED", "PAUSED", "RECOVERING", "CANCELLED"],
  BLOCKED: ["READY", "PAUSED", "RECOVERING", "FAILED", "CANCELLED"],
  PAUSED: ["READY", "BLOCKED", "RECOVERING", "CANCELLED"],
  RECOVERING: ["READY", "IN_PROGRESS", "WAITING", "BLOCKED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function createWork(input: {
  context: RequestContext;
  work_ref: ObjectRef;
  origin_intent_ref: ObjectRef;
  owner_ref: ObjectRef;
  title: string;
  summary: string;
  created_at: Timestamp;
}): WorkDomainResult<WorkRecord> {
  if (!isRequestContext(input.context) || !input.context.idempotency_key) {
    return fail("VALIDATION_ERROR", "Creating Work requires a valid request context and idempotency key");
  }
  if (!isObjectRef(input.work_ref) || input.work_ref.object_kind !== "WORK" ||
      !isObjectRef(input.origin_intent_ref) || input.origin_intent_ref.object_kind !== "INTENT" ||
      !isObjectRef(input.owner_ref)) {
    return fail("VALIDATION_ERROR", "Work, origin intent and owner references must be canonical ObjectRefs");
  }
  if (input.owner_ref.object_kind !== "USER" && input.owner_ref.object_kind !== "ORGANIZATION") {
    return fail("VALIDATION_ERROR", "Work owner must reference a USER or ORGANIZATION");
  }
  if (!sameScope(input.work_ref, input.origin_intent_ref) ||
      !sameScope(input.work_ref, input.owner_ref) ||
      !sameScope(input.work_ref, { object_kind: "SCOPE", object_id: input.context.scope_ref.scope_id, scope_ref: input.context.scope_ref })) {
    return fail("VALIDATION_ERROR", "Work, intent, owner and request context must share the same scope");
  }
  if (!input.title.trim() || !input.summary.trim() || !isTimestamp(input.created_at)) {
    return fail("VALIDATION_ERROR", "Work title, summary and valid creation timestamp are required");
  }
  return ok({
    work_ref: input.work_ref,
    scope_ref: input.context.scope_ref,
    title: input.title,
    summary: input.summary,
    origin_intent_ref: input.origin_intent_ref,
    owner_ref: input.owner_ref,
    lifecycle_state: "PROPOSED",
    current_phase: "INTAKE",
    current_revision: 1,
    relationship_refs: [],
    blocker_refs: [],
    created_by: input.context.actor_ref,
    created_at: input.created_at,
    updated_at: input.created_at,
  });
}

export function transitionWork(
  current: WorkRecord,
  command: WorkTransitionCommand,
  context: RequestContext,
): WorkDomainResult<WorkTransitionResult> {
  if (!isRequestContext(context) || !context.idempotency_key || !isRevisionNumber(command.expected_version)) {
    return fail("VALIDATION_ERROR", "Work transitions require a valid request context, idempotency key and expected version");
  }
  if (!sameScope(current.work_ref, { object_kind: "WORK", object_id: current.work_ref.object_id, scope_ref: context.scope_ref })) {
    return fail("FORBIDDEN", "Request scope does not match Work scope");
  }
  if (command.expected_version !== current.current_revision) {
    return fail("VERSION_CONFLICT", "Work changed since it was read; reload before retrying");
  }
  if (!isObjectRef(command.reason_ref) || !sameScope(command.reason_ref, current.work_ref) ||
      !isObjectRef(command.authority.decision_ref) ||
      command.authority.decision_ref.object_kind !== "AUTHORITY_DECISION" ||
      !sameScope(command.authority.decision_ref, current.work_ref) ||
      !isTimestamp(command.occurred_at)) {
    return fail("VALIDATION_ERROR", "A reason reference, authority decision reference and valid timestamp are required");
  }
  if (command.authority.disposition === "DENIED" || command.authority.disposition === "UNKNOWN" ||
      command.authority.disposition !== "ALLOWED") {
    return fail("FORBIDDEN", "The authoritative decision does not explicitly permit this Work transition");
  }
  if (!transitionMap[current.lifecycle_state].includes(command.target_state)) {
    return fail("INVALID_TRANSITION", `Work cannot transition from ${current.lifecycle_state} to ${command.target_state}`);
  }
  if (!Number.isSafeInteger(command.guards.active_blocker_count) || command.guards.active_blocker_count < 0) {
    return fail("VALIDATION_ERROR", "active_blocker_count must be a non-negative integer");
  }
  if (command.target_state === "READY" &&
      (command.guards.active_blocker_count > 0 || !command.guards.prerequisites_satisfied ||
       ((current.lifecycle_state === "PAUSED" || current.lifecycle_state === "RECOVERING") && !command.guards.reconciliation_complete))) {
    return fail("INVALID_TRANSITION", "Work cannot become READY while blockers or unmet prerequisites remain");
  }
  if (command.target_state === "IN_PROGRESS" && !command.guards.orchestrator_eligible) {
    return fail("INVALID_TRANSITION", "Orchestration has not confirmed that the next step is eligible");
  }
  if (command.target_state === "RECOVERING" && command.guards.reconciliation_complete) {
    return fail("INVALID_TRANSITION", "Recovery state is not appropriate when reconciliation is already complete");
  }
  if (command.target_state === "COMPLETED" || command.target_state === "FAILED" || command.target_state === "CANCELLED") {
    const expectedDisposition: Record<"COMPLETED" | "FAILED" | "CANCELLED", WorkClosureDisposition[]> = {
      COMPLETED: ["NORMAL_FINISH", "SUPERSEDED"],
      FAILED: ["TERMINAL_FAILURE"],
      CANCELLED: ["CANCELLED_BY_AUTHORIZED_ACTOR", "OUT_OF_SCOPE"],
    };
    if (!command.closure_disposition || !expectedDisposition[command.target_state].includes(command.closure_disposition) ||
        !command.closure_reason?.trim()) {
      return fail("VALIDATION_ERROR", "Terminal Work state requires a matching closure disposition and reason");
    }
  } else if (command.closure_disposition !== undefined) {
    return fail("VALIDATION_ERROR", "Closure disposition is valid only for a terminal Work state");
  }

  const nextRevision = current.current_revision + 1;
  const work: WorkRecord = {
    ...current,
    lifecycle_state: command.target_state,
    current_revision: nextRevision,
    updated_at: command.occurred_at,
    ...(command.target_state === "COMPLETED" || command.target_state === "FAILED" || command.target_state === "CANCELLED"
      ? { closed_at: command.occurred_at, closure_disposition: command.closure_disposition, closure_reason: command.closure_reason }
      : {}),
  };
  const revision: WorkRevision = {
    revision_ref: { object_kind: "WORK_REVISION", object_id: `${current.work_ref.object_id}:r${nextRevision}`, object_version: String(nextRevision), scope_ref: current.work_ref.scope_ref },
    work_ref: current.work_ref,
    revision_number: nextRevision,
    prior_revision_ref: { object_kind: "WORK_REVISION", object_id: `${current.work_ref.object_id}:r${current.current_revision}`, object_version: String(current.current_revision), scope_ref: current.work_ref.scope_ref },
    changed_field_paths: ["lifecycle_state"],
    changed_by: context.actor_ref,
    change_reason: command.closure_reason ?? command.reason_ref.object_id,
    created_at: command.occurred_at,
  };
  return ok({ work, revision });
}

export function acceptOutcomeProposal(
  command: AcceptOutcomeProposalCommand,
): WorkDomainResult<AcceptOutcomeProposalResult> {
  const { context, work, proposal } = command;
  if (!isRequestContext(context) || !context.idempotency_key) {
    return fail("VALIDATION_ERROR", "Outcome acceptance requires a valid request context and idempotency key");
  }
  if (command.expected_work_version !== work.current_revision) {
    return fail("VERSION_CONFLICT", "Work changed before the outcome proposal could be accepted");
  }
  if (!sameScope(work.work_ref, { object_kind: "WORK", object_id: work.work_ref.object_id, scope_ref: context.scope_ref }) ||
      !isObjectRef(proposal.proposal_ref) || proposal.proposal_ref.object_kind !== "OUTCOME_PROPOSAL" ||
      !sameScope(proposal.proposal_ref, work.work_ref) ||
      !isObjectRef(proposal.intent_ref) || !sameRef(proposal.intent_ref, work.origin_intent_ref) ||
      proposal.state !== "SUBMITTED" || proposal.acceptance_criteria.length === 0) {
    return fail("VALIDATION_ERROR", "Proposal, Work and request context are not eligible for acceptance");
  }
  if (!isObjectRef(command.desired_outcome_ref) ||
      command.desired_outcome_ref.object_kind !== "WORK_DESIRED_OUTCOME_REVISION" ||
      !sameScope(command.desired_outcome_ref, work.work_ref) ||
      !isObjectRef(command.receipt_ref) ||
      command.receipt_ref.object_kind !== "OUTCOME_ACCEPTANCE_RECEIPT" ||
      !sameScope(command.receipt_ref, work.work_ref) ||
      !isObjectRef(command.acceptance_basis_ref) ||
      !sameScope(command.acceptance_basis_ref, work.work_ref) ||
      !isObjectRef(command.authority.decision_ref) ||
      command.authority.decision_ref.object_kind !== "AUTHORITY_DECISION" ||
      !sameScope(command.authority.decision_ref, work.work_ref) ||
      (command.accepted_by !== undefined && !isPrincipalRef(command.accepted_by)) ||
      !isTimestamp(command.accepted_at)) {
    return fail("VALIDATION_ERROR", "Acceptance target, receipt, basis and authority references must be valid");
  }
  if (command.authority.disposition !== "ALLOWED") {
    return command.authority.disposition === "REQUIRES_APPROVAL"
      ? fail("APPROVAL_REQUIRED", "Outcome acceptance requires an outstanding approval")
      : fail("FORBIDDEN", "INV-06 authority evidence does not explicitly permit outcome acceptance");
  }
  if (proposal.unresolved_criterion_refs.length > 0 || command.has_material_unresolved_unknowns) {
    return fail("VALIDATION_ERROR", "Material unresolved criteria or unknowns prevent outcome acceptance");
  }
  const expectedBasisKind = {
    EXPLICIT_USER_CONFIRMATION: "USER_CONFIRMATION",
    POLICY_PERMITTED_INTERPRETATION: "POLICY_DECISION",
    EXISTING_APPROVED_REQUIREMENT: "APPROVED_REQUIREMENT",
  } as const;
  if (command.acceptance_basis_ref.object_kind !== expectedBasisKind[command.acceptance_basis]) {
    return fail("VALIDATION_ERROR", "Acceptance basis reference does not match the declared acceptance basis");
  }
  if (command.acceptance_basis === "POLICY_PERMITTED_INTERPRETATION" &&
      (!command.policy_interpretation_permitted || command.has_material_unresolved_unknowns)) {
    return fail("VALIDATION_ERROR", "Policy-permitted interpretation requires an explicit policy allowance and no material unresolved uncertainty");
  }
  if (command.acceptance_basis === "EXPLICIT_USER_CONFIRMATION" &&
      (!command.accepted_by || command.accepted_by.principal_id !== context.actor_ref.principal_id ||
       command.accepted_by.principal_kind !== context.actor_ref.principal_kind)) {
    return fail("VALIDATION_ERROR", "Explicit user confirmation must be attributable to the authenticated actor");
  }
  const nextTargetRevision = work.current_desired_outcome_ref
    ? command.current_target_revision
    : 1;
  if (!isRevisionNumber(nextTargetRevision)) {
    return fail("VALIDATION_ERROR", "Replacing an existing desired outcome requires its current revision number");
  }
  const desired_outcome: WorkDesiredOutcomeRevision = {
    desired_outcome_ref: command.desired_outcome_ref,
    work_ref: work.work_ref,
    revision_number: nextTargetRevision,
    source_proposal_ref: proposal.proposal_ref,
    source_intent_ref: proposal.intent_ref,
    desired_effect: proposal.desired_effect,
    acceptance_criteria: [...proposal.acceptance_criteria],
    unresolved_criterion_refs: [],
    acceptance_basis: command.acceptance_basis,
    acceptance_basis_ref: command.acceptance_basis_ref,
    ...(command.accepted_by ? { accepted_by: command.accepted_by } : {}),
    accepted_at: command.accepted_at,
    ...(work.current_desired_outcome_ref ? { supersedes_ref: work.current_desired_outcome_ref } : {}),
    state: "ACTIVE",
  };
  const nextWork: WorkRecord = {
    ...work,
    current_desired_outcome_ref: desired_outcome.desired_outcome_ref,
    current_revision: work.current_revision + 1,
    updated_at: command.accepted_at,
  };
  const revision: WorkRevision = {
    revision_ref: { object_kind: "WORK_REVISION", object_id: `${work.work_ref.object_id}:r${nextWork.current_revision}`, object_version: String(nextWork.current_revision), scope_ref: work.work_ref.scope_ref },
    work_ref: work.work_ref,
    revision_number: nextWork.current_revision,
    prior_revision_ref: { object_kind: "WORK_REVISION", object_id: `${work.work_ref.object_id}:r${work.current_revision}`, object_version: String(work.current_revision), scope_ref: work.work_ref.scope_ref },
    changed_field_paths: ["current_desired_outcome_ref"],
    desired_outcome_revision_ref: desired_outcome.desired_outcome_ref,
    changed_by: context.actor_ref,
    change_reason: "Accepted outcome proposal",
    created_at: command.accepted_at,
  };
  const receipt: OutcomeAcceptanceReceipt = {
    receipt_ref: command.receipt_ref,
    proposal_ref: proposal.proposal_ref,
    work_ref: work.work_ref,
    acceptance_state: "ACCEPTED",
    acceptance_basis: command.acceptance_basis,
    accepted_target_ref: desired_outcome.desired_outcome_ref,
    accepted_target_revision: desired_outcome.revision_number,
    received_at: command.accepted_at,
  };
  return ok({ desired_outcome, receipt, work: nextWork, revision });
}

export function applyPlanGraphActivation(
  work: WorkRecord,
  receipt: PlanGraphActivationBindingReceipt,
  expectedWorkVersion: RevisionNumber,
): WorkDomainResult<WorkRecord> {
  if (expectedWorkVersion !== work.current_revision || receipt.expected_work_revision !== expectedWorkVersion) {
    return fail("VERSION_CONFLICT", "Work version changed before graph activation was applied");
  }
  if (!isRevisionNumber(expectedWorkVersion) ||
      !isRevisionNumber(receipt.expected_work_revision) ||
      !isRevisionNumber(receipt.resulting_work_revision) ||
      !isObjectRef(receipt.receipt_ref) ||
      receipt.receipt_ref.object_kind !== "PLAN_GRAPH_ACTIVATION_RECEIPT" ||
      !sameScope(receipt.receipt_ref, work.work_ref) ||
      !isObjectRef(receipt.request_ref) ||
      receipt.request_ref.object_kind !== "GRAPH_ACTIVATION_REQUEST" ||
      !sameScope(receipt.request_ref, work.work_ref) ||
      !isObjectRef(receipt.work_ref) ||
      !sameRef(receipt.work_ref, work.work_ref) ||
      !isObjectRef(receipt.plan_revision_ref) ||
      receipt.plan_revision_ref.object_kind !== "PLAN_REVISION" ||
      !sameScope(receipt.plan_revision_ref, work.work_ref) ||
      !isObjectRef(receipt.graph_revision_ref) ||
      receipt.graph_revision_ref.object_kind !== "WORK_GRAPH_REVISION" ||
      !sameScope(receipt.graph_revision_ref, work.work_ref) ||
      !isTimestamp(receipt.received_at) ||
      Date.parse(receipt.received_at) <= Date.parse(work.updated_at)) {
    return fail("VALIDATION_ERROR", "Plan/Graph activation receipt is invalid or not bound to this Work");
  }
  if (receipt.receipt_state !== "ACCEPTED" &&
      receipt.receipt_state !== "REJECTED" &&
      receipt.receipt_state !== "UNKNOWN") {
    return fail("VALIDATION_ERROR", "Plan/Graph activation receipt has an unknown state");
  }
  if (receipt.receipt_state === "UNKNOWN") {
    return fail("OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED", "Activation result is unknown; reconcile the active Work binding before retrying");
  }
  if (receipt.receipt_state === "REJECTED") return fail("VALIDATION_ERROR", "Work Engine rejected the Plan/Graph activation");
  if (receipt.resulting_work_revision !== expectedWorkVersion + 1) {
    return fail("VERSION_CONFLICT", "Activation receipt resulting Work revision is not the expected next revision");
  }
  return ok({
    ...work,
    current_plan_ref: receipt.plan_revision_ref,
    current_work_graph_ref: receipt.graph_revision_ref,
    current_revision: receipt.resulting_work_revision,
    updated_at: receipt.received_at,
  });
}

export function validateWorkClosure(
  state: WorkLifecycleState,
  disposition: WorkClosureDisposition,
): boolean {
  const valid: Record<WorkClosureDisposition, WorkLifecycleState> = {
    NORMAL_FINISH: "COMPLETED",
    TERMINAL_FAILURE: "FAILED",
    CANCELLED_BY_AUTHORIZED_ACTOR: "CANCELLED",
    SUPERSEDED: "COMPLETED",
    OUT_OF_SCOPE: "CANCELLED",
  };
  return valid[disposition] === state;
}
