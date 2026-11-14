import {
  isObjectRef,
  isRequestContext,
  isRevisionNumber,
  isTimestamp,
  type ObjectRef,
  type PrincipalRef,
  type RequestContext,
  type RevisionNumber,
  type Timestamp,
} from "../shared";

export type PlanRevisionState = "PROPOSED" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED" | "SUPERSEDED" | "WITHDRAWN";
export type WorkGraphRevisionState = "DRAFTED" | "VALIDATING" | "VALIDATED" | "REJECTED" | "SUPERSEDED" | "WITHDRAWN";
export type GraphValidationStatus = "VALID" | "VALID_WITH_WARNINGS" | "INVALID" | "NEEDS_INPUT" | "DEPENDENCY_UNAVAILABLE";
export type GraphFindingSeverity = "ERROR" | "BLOCKER" | "WARNING" | "INFO";
export type GraphNodeKind = "WORK_STEP" | "TASK_REFERENCE" | "CAPABILITY_OPERATION" | "HUMAN_GATE" | "APPROVAL_GATE" | "VERIFICATION_GATE" | "ARTIFACT_OUTPUT" | "WAIT_FOR_CONDITION" | "OTHER";
export type DependencyKind = "COMPLETION" | "SUCCESS" | "OUTPUT_AVAILABLE" | "APPROVAL_GRANTED" | "CONDITION_SATISFIED" | "ORDERING";
export type ChangeImpactKind = "AFFECTED" | "PRESERVABLE" | "INVALIDATED" | "REVALIDATION_REQUIRED";

export interface PlanStepProposal {
  step_proposal_ref: ObjectRef;
  title: string;
  purpose: string;
  requirement_refs: ObjectRef[];
  input_refs: ObjectRef[];
  capability_requirement_refs: ObjectRef[];
  expected_output_refs: ObjectRef[];
  dependency_step_refs: ObjectRef[];
  acceptance_criteria_refs: ObjectRef[];
  constraint_refs: ObjectRef[];
}

export interface PlanRecord {
  plan_ref: ObjectRef;
  work_ref: ObjectRef;
  created_by: PrincipalRef;
  created_at: Timestamp;
  latest_revision_ref: ObjectRef;
}

export interface PlanRevision {
  plan_revision_ref: ObjectRef;
  plan_ref: ObjectRef;
  work_ref: ObjectRef;
  revision_number: RevisionNumber;
  prior_revision_ref?: ObjectRef;
  intent_ref: ObjectRef;
  desired_outcome_ref: ObjectRef;
  strategy_summary: string;
  step_proposals: PlanStepProposal[];
  assumptions: unknown[];
  non_goals: string[];
  constraint_refs: ObjectRef[];
  capability_requirement_refs: ObjectRef[];
  proposed_by: PrincipalRef;
  state: PlanRevisionState;
  review_decision_ref?: ObjectRef;
  change_reason?: string;
  created_at: Timestamp;
}

export interface GraphNode {
  node_ref: ObjectRef;
  graph_ref: ObjectRef;
  node_kind: GraphNodeKind;
  title: string;
  description: string;
  plan_step_proposal_ref?: ObjectRef;
  requirement_refs: ObjectRef[];
  input_refs: ObjectRef[];
  capability_requirement_refs: ObjectRef[];
  expected_output_refs: ObjectRef[];
  acceptance_criteria_refs: ObjectRef[];
  constraint_refs: ObjectRef[];
  linked_task_ref?: ObjectRef;
}

export interface DependencyEdge {
  edge_ref: ObjectRef;
  from_node_ref: ObjectRef;
  to_node_ref: ObjectRef;
  dependency_kind: DependencyKind;
  condition_ref?: ObjectRef;
  required_output_ref?: ObjectRef;
  created_at: Timestamp;
}

export interface WorkGraphRecord {
  graph_ref: ObjectRef;
  work_ref: ObjectRef;
  created_by: PrincipalRef;
  created_at: Timestamp;
  latest_revision_ref: ObjectRef;
}

export interface WorkGraphRevision {
  graph_revision_ref: ObjectRef;
  graph_ref: ObjectRef;
  work_ref: ObjectRef;
  revision_number: RevisionNumber;
  base_graph_revision_ref?: ObjectRef;
  source_plan_revision_ref: ObjectRef;
  prior_revision_ref?: ObjectRef;
  nodes: GraphNode[];
  edges: DependencyEdge[];
  change_reason: string;
  affected_node_refs: ObjectRef[];
  preserved_node_refs: ObjectRef[];
  invalidated_node_refs: ObjectRef[];
  revalidation_required_node_refs: ObjectRef[];
  state: WorkGraphRevisionState;
  validation_result_ref?: ObjectRef;
  approval_decision_ref?: ObjectRef;
  author_ref: PrincipalRef;
  created_at: Timestamp;
}

export interface GraphValidationFinding {
  finding_ref: ObjectRef;
  code: string;
  severity: GraphFindingSeverity;
  summary: string;
  affected_refs: ObjectRef[];
  resolution_requirement?: string;
}

export interface GraphValidationResult {
  validation_ref: ObjectRef;
  graph_revision_ref: ObjectRef;
  status: GraphValidationStatus;
  findings: GraphValidationFinding[];
  validated_at: Timestamp;
  validator_version: string;
}

export interface ChangeImpactEntry {
  target_ref: ObjectRef;
  impact_kind: ChangeImpactKind;
  reason_refs: ObjectRef[];
  required_action: string;
}

export interface ChangeImpactReport {
  impact_report_ref: ObjectRef;
  work_ref: ObjectRef;
  base_graph_revision_ref?: ObjectRef;
  changed_input_refs: ObjectRef[];
  entries: ChangeImpactEntry[];
  created_at: Timestamp;
  created_by: PrincipalRef;
}

export interface GraphActivationRequest {
  request_ref: ObjectRef;
  work_ref: ObjectRef;
  plan_revision_ref: ObjectRef;
  graph_revision_ref: ObjectRef;
  expected_work_revision: RevisionNumber;
  approval_refs: ObjectRef[];
  review_decision_ref?: ObjectRef;
  idempotency_key: string;
  requested_at: Timestamp;
}

export interface GraphActivationReceipt {
  receipt_ref: ObjectRef;
  request_ref: ObjectRef;
  work_ref: ObjectRef;
  plan_revision_ref: ObjectRef;
  graph_revision_ref: ObjectRef;
  expected_work_revision: RevisionNumber;
  resulting_work_revision?: RevisionNumber;
  receipt_state: "ACCEPTED" | "REJECTED" | "UNKNOWN";
  reason_ref?: ObjectRef;
  received_at: Timestamp;
}

export type PlanningIssue = {
  code: "VALIDATION_ERROR" | "VERSION_CONFLICT" | "INVALID_TRANSITION" |
    "DEPENDENCY_UNAVAILABLE" | "OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED";
  safe_message: string;
};
export type PlanningResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; issues: PlanningIssue[] };

const ok = <T>(value: T, warnings: string[] = []): PlanningResult<T> => ({ ok: true, value, warnings });
const fail = <T = never>(code: PlanningIssue["code"], safe_message: string): PlanningResult<T> => ({
  ok: false,
  issues: [{ code, safe_message }],
});
const sameScope = (a: ObjectRef, b: ObjectRef) =>
  a.scope_ref.scope_id === b.scope_ref.scope_id && a.scope_ref.scope_kind === b.scope_ref.scope_kind;
const sameRef = (a: ObjectRef, b: ObjectRef) =>
  a.object_kind === b.object_kind &&
  a.object_id === b.object_id &&
  a.object_version === b.object_version &&
  sameScope(a, b);
const allRefsValid = (refs: readonly ObjectRef[]) => refs.every(isObjectRef);
const allRefsInScope = (refs: readonly ObjectRef[], owner: ObjectRef) =>
  refs.every((ref) => isObjectRef(ref) && sameScope(ref, owner));

export function createPlanRevision(input: {
  context: RequestContext;
  plan_ref: ObjectRef;
  plan_revision_ref: ObjectRef;
  work_ref: ObjectRef;
  intent_ref: ObjectRef;
  desired_outcome_ref: ObjectRef;
  revision_number: RevisionNumber;
  prior_revision_ref?: ObjectRef;
  strategy_summary: string;
  step_proposals: PlanStepProposal[];
  assumptions: unknown[];
  non_goals: string[];
  constraint_refs: ObjectRef[];
  capability_requirement_refs: ObjectRef[];
  change_reason?: string;
  created_at: Timestamp;
}): PlanningResult<PlanRevision> {
  if (!isRequestContext(input.context) || !input.context.idempotency_key) {
    return fail("VALIDATION_ERROR", "Plan revision requires a trusted request context and idempotency key");
  }
  if (!isRevisionNumber(input.revision_number) || !isTimestamp(input.created_at) ||
      !input.strategy_summary.trim() || !input.step_proposals.length) {
    return fail("VALIDATION_ERROR", "Plan revision needs a positive revision, timestamp, strategy and at least one step");
  }
  if (!isObjectRef(input.plan_ref) || input.plan_ref.object_kind !== "PLAN" ||
      !isObjectRef(input.plan_revision_ref) || input.plan_revision_ref.object_kind !== "PLAN_REVISION" ||
      !isObjectRef(input.work_ref) || input.work_ref.object_kind !== "WORK" ||
      !isObjectRef(input.intent_ref) || input.intent_ref.object_kind !== "INTENT" ||
      !isObjectRef(input.desired_outcome_ref) || input.desired_outcome_ref.object_kind !== "WORK_DESIRED_OUTCOME_REVISION") {
    return fail("VALIDATION_ERROR", "Plan, revision, Work, intent and accepted outcome references must have canonical object kinds");
  }
  if (![input.plan_ref, input.plan_revision_ref, input.intent_ref, input.desired_outcome_ref].every((ref) => sameScope(ref, input.work_ref)) ||
      !sameScope(input.work_ref, { object_kind: "WORK", object_id: input.work_ref.object_id, scope_ref: input.context.scope_ref })) {
    return fail("VALIDATION_ERROR", "Plan, revision, intent, outcome and Work must share the request scope");
  }
  if (
    !allRefsInScope(input.constraint_refs, input.work_ref) ||
    !allRefsInScope(input.capability_requirement_refs, input.work_ref) ||
    (input.prior_revision_ref !== undefined && (
      !isObjectRef(input.prior_revision_ref) ||
      input.prior_revision_ref.object_kind !== "PLAN_REVISION" ||
      !sameScope(input.prior_revision_ref, input.work_ref)
    ))
  ) {
    return fail("VALIDATION_ERROR", "Plan contains invalid, cross-scope or unbound revision references");
  }
  for (const step of input.step_proposals) {
    if (
      !isObjectRef(step.step_proposal_ref) ||
      step.step_proposal_ref.object_kind !== "PLAN_STEP_PROPOSAL" ||
      !sameScope(step.step_proposal_ref, input.work_ref) ||
      !step.title.trim() ||
      !step.purpose.trim() ||
      !allRefsInScope([
        ...step.requirement_refs,
        ...step.input_refs,
        ...step.capability_requirement_refs,
        ...step.expected_output_refs,
        ...step.dependency_step_refs,
        ...step.acceptance_criteria_refs,
        ...step.constraint_refs,
      ], input.work_ref)
    ) {
      return fail("VALIDATION_ERROR", "Plan contains an invalid, cross-scope or incomplete step proposal");
    }
  }
  if (input.revision_number === 1 && input.prior_revision_ref) {
    return fail("VALIDATION_ERROR", "Initial Plan revision cannot have a prior revision");
  }
  if (input.revision_number > 1 && (!input.prior_revision_ref || !isObjectRef(input.prior_revision_ref) ||
      input.prior_revision_ref.object_kind !== "PLAN_REVISION")) {
    return fail("VALIDATION_ERROR", "Subsequent Plan revision must preserve its prior revision reference");
  }
  return ok({
    plan_revision_ref: input.plan_revision_ref,
    plan_ref: input.plan_ref,
    work_ref: input.work_ref,
    revision_number: input.revision_number,
    ...(input.prior_revision_ref ? { prior_revision_ref: input.prior_revision_ref } : {}),
    intent_ref: input.intent_ref,
    desired_outcome_ref: input.desired_outcome_ref,
    strategy_summary: input.strategy_summary,
    step_proposals: [...input.step_proposals],
    assumptions: [...input.assumptions],
    non_goals: [...input.non_goals],
    constraint_refs: [...input.constraint_refs],
    capability_requirement_refs: [...input.capability_requirement_refs],
    proposed_by: input.context.actor_ref,
    state: "PROPOSED",
    ...(input.change_reason ? { change_reason: input.change_reason } : {}),
    created_at: input.created_at,
  });
}

export function transitionPlanRevision(
  revision: PlanRevision,
  target: PlanRevisionState,
  review_decision_ref?: ObjectRef,
): PlanningResult<PlanRevision> {
  const allowed: Record<PlanRevisionState, readonly PlanRevisionState[]> = {
    PROPOSED: ["UNDER_REVIEW", "WITHDRAWN"],
    UNDER_REVIEW: ["ACCEPTED", "REJECTED", "WITHDRAWN"],
    ACCEPTED: ["SUPERSEDED"],
    REJECTED: [],
    SUPERSEDED: [],
    WITHDRAWN: [],
  };
  if (!allowed[revision.state].includes(target)) return fail("INVALID_TRANSITION", `Plan revision cannot transition from ${revision.state} to ${target}`);
  if ((target === "ACCEPTED" || target === "REJECTED") &&
      (!review_decision_ref ||
       !isObjectRef(review_decision_ref) ||
       review_decision_ref.object_kind !== "PLAN_REVIEW_DECISION" ||
       !sameScope(review_decision_ref, revision.work_ref))) {
    return fail("VALIDATION_ERROR", "Plan review outcome requires a PLAN_REVIEW_DECISION reference");
  }
  return ok({
    ...revision,
    state: target,
    ...(review_decision_ref ? { review_decision_ref } : {}),
  });
}

export function createGraphRevision(input: {
  context: RequestContext;
  graph_ref: ObjectRef;
  graph_revision_ref: ObjectRef;
  work_ref: ObjectRef;
  source_plan_revision_ref: ObjectRef;
  revision_number: RevisionNumber;
  base_graph_revision_ref?: ObjectRef;
  prior_revision_ref?: ObjectRef;
  nodes: GraphNode[];
  edges: DependencyEdge[];
  change_reason: string;
  affected_node_refs?: ObjectRef[];
  preserved_node_refs?: ObjectRef[];
  invalidated_node_refs?: ObjectRef[];
  revalidation_required_node_refs?: ObjectRef[];
  created_at: Timestamp;
}): PlanningResult<WorkGraphRevision> {
  if (!isRequestContext(input.context) || !input.context.idempotency_key ||
      !isRevisionNumber(input.revision_number) || !isTimestamp(input.created_at) ||
      !input.change_reason.trim()) {
    return fail("VALIDATION_ERROR", "Graph revision requires a valid context, idempotency key, revision and change reason");
  }
  if (!isObjectRef(input.graph_ref) || input.graph_ref.object_kind !== "WORK_GRAPH" ||
      !isObjectRef(input.graph_revision_ref) || input.graph_revision_ref.object_kind !== "WORK_GRAPH_REVISION" ||
      !isObjectRef(input.work_ref) || input.work_ref.object_kind !== "WORK" ||
      !isObjectRef(input.source_plan_revision_ref) || input.source_plan_revision_ref.object_kind !== "PLAN_REVISION" ||
      !sameScope(input.work_ref, input.graph_ref) || !sameScope(input.work_ref, input.graph_revision_ref) ||
      !sameScope(input.work_ref, input.source_plan_revision_ref) ||
      !sameScope(input.work_ref, { object_kind: "WORK", object_id: input.work_ref.object_id, scope_ref: input.context.scope_ref })) {
    return fail("VALIDATION_ERROR", "Graph, graph revision, Work, Plan revision and request must share a valid scope");
  }
  if (input.revision_number === 1 && (input.base_graph_revision_ref || input.prior_revision_ref)) {
    return fail("VALIDATION_ERROR", "Initial graph revision cannot specify a base or prior revision");
  }
  if (input.revision_number > 1 && (!input.base_graph_revision_ref || !input.prior_revision_ref ||
      !isObjectRef(input.base_graph_revision_ref) || !isObjectRef(input.prior_revision_ref) ||
      input.base_graph_revision_ref.object_kind !== "WORK_GRAPH_REVISION" ||
      input.prior_revision_ref.object_kind !== "WORK_GRAPH_REVISION" ||
      !sameScope(input.base_graph_revision_ref, input.work_ref) ||
      !sameScope(input.prior_revision_ref, input.work_ref))) {
    return fail("VALIDATION_ERROR", "Graph revision must pin its base and prior revision");
  }
  const nodes = input.nodes.map((node) => ({ ...node }));
  const edges = input.edges.map((edge) => ({ ...edge }));
  for (const node of nodes) {
    if (!isObjectRef(node.node_ref) || !isObjectRef(node.graph_ref) ||
        node.node_ref.object_kind !== "GRAPH_NODE" || node.graph_ref.object_kind !== "WORK_GRAPH" ||
        !sameRef(node.graph_ref, input.graph_ref) ||
        !sameScope(node.node_ref, input.work_ref) || !node.title.trim() ||
        (node.plan_step_proposal_ref !== undefined && (
          !isObjectRef(node.plan_step_proposal_ref) ||
          node.plan_step_proposal_ref.object_kind !== "PLAN_STEP_PROPOSAL" ||
          !sameScope(node.plan_step_proposal_ref, input.work_ref)
        )) ||
        (node.linked_task_ref !== undefined && (
          !isObjectRef(node.linked_task_ref) ||
          !sameScope(node.linked_task_ref, input.work_ref)
        )) ||
        !allRefsInScope([
          ...node.requirement_refs,
          ...node.input_refs,
          ...node.capability_requirement_refs,
          ...node.expected_output_refs,
          ...node.acceptance_criteria_refs,
          ...node.constraint_refs,
        ], input.work_ref)) {
      return fail("VALIDATION_ERROR", "Graph contains an invalid node or cross-scope reference");
    }
  }
  for (const edge of edges) {
    if (!isObjectRef(edge.edge_ref) || edge.edge_ref.object_kind !== "DEPENDENCY_EDGE" ||
        !isObjectRef(edge.from_node_ref) || edge.from_node_ref.object_kind !== "GRAPH_NODE" ||
        !isObjectRef(edge.to_node_ref) || edge.to_node_ref.object_kind !== "GRAPH_NODE" ||
        !sameScope(edge.edge_ref, input.work_ref) ||
        !sameScope(edge.from_node_ref, input.work_ref) ||
        !sameScope(edge.to_node_ref, input.work_ref) ||
        !isTimestamp(edge.created_at) ||
        (edge.condition_ref !== undefined && (
          !isObjectRef(edge.condition_ref) || !sameScope(edge.condition_ref, input.work_ref)
        )) ||
        (edge.required_output_ref !== undefined && (
          !isObjectRef(edge.required_output_ref) || !sameScope(edge.required_output_ref, input.work_ref)
        ))) {
      return fail("VALIDATION_ERROR", "Graph contains an invalid dependency edge");
    }
  }
  return ok({
    graph_revision_ref: input.graph_revision_ref,
    graph_ref: input.graph_ref,
    work_ref: input.work_ref,
    revision_number: input.revision_number,
    ...(input.base_graph_revision_ref ? { base_graph_revision_ref: input.base_graph_revision_ref } : {}),
    source_plan_revision_ref: input.source_plan_revision_ref,
    ...(input.prior_revision_ref ? { prior_revision_ref: input.prior_revision_ref } : {}),
    nodes,
    edges,
    change_reason: input.change_reason,
    affected_node_refs: [...(input.affected_node_refs ?? [])],
    preserved_node_refs: [...(input.preserved_node_refs ?? [])],
    invalidated_node_refs: [...(input.invalidated_node_refs ?? [])],
    revalidation_required_node_refs: [...(input.revalidation_required_node_refs ?? [])],
    state: "DRAFTED",
    author_ref: input.context.actor_ref,
    created_at: input.created_at,
  });
}

export function validateGraphRevision(input: {
  revision: WorkGraphRevision;
  validation_ref: ObjectRef;
  validated_at: Timestamp;
  validator_version: string;
  max_nodes?: number;
  max_edges?: number;
}): PlanningResult<GraphValidationResult> {
  const { revision } = input;
  if (!isObjectRef(input.validation_ref) || input.validation_ref.object_kind !== "GRAPH_VALIDATION_RESULT" ||
      !isTimestamp(input.validated_at) || !input.validator_version.trim()) {
    return fail("VALIDATION_ERROR", "Graph validation requires a valid result reference, timestamp and validator version");
  }
  if (revision.state !== "DRAFTED" && revision.state !== "VALIDATING") {
    return fail("INVALID_TRANSITION", "Only a drafted or validating graph revision can be validated");
  }

  const findings: GraphValidationFinding[] = [];
  const add = (code: string, severity: GraphFindingSeverity, summary: string, refs: ObjectRef[] = []) => {
    findings.push({
      finding_ref: {
        object_kind: "GRAPH_VALIDATION_FINDING",
        object_id: `${input.validation_ref.object_id}:${findings.length + 1}`,
        object_version: "1",
        scope_ref: input.validation_ref.scope_ref,
      },
      code, severity, summary, affected_refs: refs,
    });
  };

  if (input.max_nodes !== undefined && (!Number.isSafeInteger(input.max_nodes) || input.max_nodes < 1)) {
    return fail("VALIDATION_ERROR", "Configured max_nodes must be a positive integer");
  }
  if (input.max_edges !== undefined && (!Number.isSafeInteger(input.max_edges) || input.max_edges < 0)) {
    return fail("VALIDATION_ERROR", "Configured max_edges must be a non-negative integer");
  }
  if (revision.nodes.length === 0) {
    add("GRAPH_HAS_NO_NODES", "BLOCKER", "A Work Graph revision must contain at least one governed node", [revision.graph_revision_ref]);
  }
  if (input.max_nodes !== undefined && revision.nodes.length > input.max_nodes) {
    add("GRAPH_NODE_LIMIT_EXCEEDED", "BLOCKER", "Graph exceeds the configured node limit", [revision.graph_revision_ref]);
  }
  if (input.max_edges !== undefined && revision.edges.length > input.max_edges) {
    add("GRAPH_EDGE_LIMIT_EXCEEDED", "BLOCKER", "Graph exceeds the configured edge limit", [revision.graph_revision_ref]);
  }

  const nodeById = new Map<string, GraphNode>();
  for (const node of revision.nodes) {
    const key = node.node_ref.object_id;
    if (nodeById.has(key)) add("DUPLICATE_NODE_ID", "ERROR", "Graph node identity is duplicated", [node.node_ref]);
    else nodeById.set(key, node);
  }
  const edgeIds = new Set<string>();
  const adjacency = new Map<string, string[]>();
  for (const node of revision.nodes) adjacency.set(node.node_ref.object_id, []);
  for (const edge of revision.edges) {
    if (edgeIds.has(edge.edge_ref.object_id)) add("DUPLICATE_EDGE_ID", "ERROR", "Dependency edge identity is duplicated", [edge.edge_ref]);
    edgeIds.add(edge.edge_ref.object_id);
    const from = nodeById.get(edge.from_node_ref.object_id);
    const to = nodeById.get(edge.to_node_ref.object_id);
    if (!from || !to) {
      add("MISSING_EDGE_ENDPOINT", "ERROR", "Dependency edge must reference two nodes in this graph revision", [edge.edge_ref]);
      continue;
    }
    if (from.node_ref.object_id === to.node_ref.object_id) {
      add("SELF_DEPENDENCY", "ERROR", "A graph node cannot depend on itself", [edge.edge_ref, from.node_ref]);
      continue;
    }
    if (!sameScope(edge.from_node_ref, revision.work_ref) || !sameScope(edge.to_node_ref, revision.work_ref)) {
      add("CROSS_SCOPE_EDGE", "ERROR", "Dependency endpoints must share the Work scope", [edge.edge_ref]);
      continue;
    }
    adjacency.get(from.node_ref.object_id)?.push(to.node_ref.object_id);
  }

  // Kahn's topological traversal is iterative and O(V + E). Avoid recursive
  // DFS here: user-authored Work Graphs can be deep enough to exhaust the JS
  // call stack even when the graph is otherwise valid.
  const indegree = new Map<string, number>();
  for (const id of adjacency.keys()) indegree.set(id, 0);
  for (const targets of adjacency.values()) {
    for (const target of targets) {
      indegree.set(target, (indegree.get(target) ?? 0) + 1);
    }
  }

  const ready: string[] = [];
  for (const [id, degree] of indegree) {
    if (degree === 0) ready.push(id);
  }

  let processed = 0;
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const id = ready[cursor];
    processed += 1;
    for (const next of adjacency.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }

  if (processed !== indegree.size) {
    add("DEPENDENCY_CYCLE", "ERROR", "Work Graph contains a dependency cycle");
  }

  const blocking = findings.some((finding) => finding.severity === "ERROR" || finding.severity === "BLOCKER");
  const warnings = findings.some((finding) => finding.severity === "WARNING");
  const status: GraphValidationStatus = blocking ? "INVALID" : warnings ? "VALID_WITH_WARNINGS" : "VALID";
  return ok({
    validation_ref: input.validation_ref,
    graph_revision_ref: revision.graph_revision_ref,
    status,
    findings,
    validated_at: input.validated_at,
    validator_version: input.validator_version,
  });
}

export function applyGraphValidation(
  revision: WorkGraphRevision,
  result: GraphValidationResult,
  review_decision_ref?: ObjectRef,
): PlanningResult<WorkGraphRevision> {
  const allowedStatuses: readonly GraphValidationStatus[] = [
    "VALID",
    "VALID_WITH_WARNINGS",
    "INVALID",
    "NEEDS_INPUT",
    "DEPENDENCY_UNAVAILABLE",
  ];
  const allowedSeverities: readonly GraphFindingSeverity[] = [
    "ERROR",
    "BLOCKER",
    "WARNING",
    "INFO",
  ];
  if (
    !isObjectRef(result.validation_ref) ||
    result.validation_ref.object_kind !== "GRAPH_VALIDATION_RESULT" ||
    !sameScope(result.validation_ref, revision.work_ref) ||
    !isObjectRef(result.graph_revision_ref) ||
    !sameRef(result.graph_revision_ref, revision.graph_revision_ref) ||
    !isTimestamp(result.validated_at) ||
    !result.validator_version.trim() ||
    !allowedStatuses.includes(result.status) ||
    !Array.isArray(result.findings) ||
    result.findings.some((finding) =>
      !finding ||
      typeof finding !== "object" ||
      !isObjectRef(finding.finding_ref) ||
      finding.finding_ref.object_kind !== "GRAPH_VALIDATION_FINDING" ||
      !sameScope(finding.finding_ref, revision.work_ref) ||
      !allowedSeverities.includes(finding.severity) ||
      !Array.isArray(finding.affected_refs) ||
      !allRefsValid(finding.affected_refs)
    )
  ) {
    return fail("VALIDATION_ERROR", "Validation result identity, graph binding, status, timestamp or findings are invalid");
  }
  if (result.status !== "VALID" && result.status !== "VALID_WITH_WARNINGS") {
    return fail("VALIDATION_ERROR", "Graph validation did not permit activation");
  }
  if (result.findings.some((finding) => finding.severity === "ERROR" || finding.severity === "BLOCKER")) {
    return fail("VALIDATION_ERROR", "Graph validation contains blocking findings");
  }
  if ((result.status === "VALID_WITH_WARNINGS" || result.findings.some((finding) => finding.severity === "WARNING")) &&
      (!review_decision_ref || !isObjectRef(review_decision_ref) ||
       review_decision_ref.object_kind !== "GRAPH_REVIEW_DECISION" ||
       !sameScope(review_decision_ref, revision.work_ref))) {
    return fail("VALIDATION_ERROR", "A graph review decision is required to accept validation warnings");
  }
  return ok({
    ...revision,
    state: "VALIDATED",
    validation_result_ref: result.validation_ref,
    ...(review_decision_ref ? { approval_decision_ref: review_decision_ref } : {}),
  });
}

/**
 * Computes conservative graph impact from explicit changed references.
 * Unaffected nodes are marked PRESERVABLE; any directly dependent node is
 * REVALIDATION_REQUIRED unless an authoritative invalidation decision says
 * it cannot be reused. This function never claims an output is reusable.
 */
export function computeChangeImpactReport(input: {
  report_ref: ObjectRef;
  work_ref: ObjectRef;
  base_graph: WorkGraphRevision;
  changed_input_refs: ObjectRef[];
  invalidated_node_refs?: ObjectRef[];
  created_by: PrincipalRef;
  created_at: Timestamp;
}): PlanningResult<ChangeImpactReport> {
  if (!isObjectRef(input.report_ref) || input.report_ref.object_kind !== "CHANGE_IMPACT_REPORT" ||
      !isObjectRef(input.work_ref) || input.work_ref.object_kind !== "WORK" ||
      !sameScope(input.report_ref, input.work_ref) ||
      input.base_graph.work_ref.object_id !== input.work_ref.object_id ||
      !isTimestamp(input.created_at) ||
      !allRefsValid(input.changed_input_refs) ||
      !allRefsValid(input.invalidated_node_refs ?? [])) {
    return fail("VALIDATION_ERROR", "Change-impact request references, scope or timestamp are invalid");
  }
  const changedKeys = new Set(input.changed_input_refs.map((ref) =>
    `${ref.object_kind}:${ref.object_id}:${ref.scope_ref.scope_id}`
  ));
  const invalidatedIds = new Set((input.invalidated_node_refs ?? []).map((ref) => ref.object_id));
  const entries: ChangeImpactEntry[] = input.base_graph.nodes.map((node) => {
    const dependencies = [
      ...node.input_refs,
      ...node.requirement_refs,
      ...node.capability_requirement_refs,
      ...node.constraint_refs,
      ...node.expected_output_refs,
      ...(node.plan_step_proposal_ref ? [node.plan_step_proposal_ref] : []),
    ];
    const affectedRefs = dependencies.filter((ref) =>
      changedKeys.has(`${ref.object_kind}:${ref.object_id}:${ref.scope_ref.scope_id}`)
    );
    if (invalidatedIds.has(node.node_ref.object_id)) {
      return {
        target_ref: node.node_ref,
        impact_kind: "INVALIDATED",
        reason_refs: [...input.changed_input_refs],
        required_action: "Do not reuse prior output; create a replacement node or output under a new graph revision",
      };
    }
    if (affectedRefs.length > 0) {
      return {
        target_ref: node.node_ref,
        impact_kind: "REVALIDATION_REQUIRED",
        reason_refs: affectedRefs,
        required_action: "Revalidate node inputs, constraints, capability compatibility and prior output lineage",
      };
    }
    return {
      target_ref: node.node_ref,
      impact_kind: "PRESERVABLE",
      reason_refs: [],
      required_action: "Preserve prior node lineage; verify pinned source versions remain current before reuse",
    };
  });
  return ok({
    impact_report_ref: input.report_ref,
    work_ref: input.work_ref,
    base_graph_revision_ref: input.base_graph.graph_revision_ref,
    changed_input_refs: [...input.changed_input_refs],
    entries,
    created_at: input.created_at,
    created_by: input.created_by,
  });
}

export function createGraphActivationRequest(input: {
  context: RequestContext;
  request_ref: ObjectRef;
  work_ref: ObjectRef;
  plan_revision: PlanRevision;
  graph_revision: WorkGraphRevision;
  expected_work_revision: RevisionNumber;
  approval_refs: ObjectRef[];
  review_decision_ref?: ObjectRef;
  requested_at: Timestamp;
}): PlanningResult<GraphActivationRequest> {
  if (!isRequestContext(input.context) || !input.context.idempotency_key ||
      !isRevisionNumber(input.expected_work_revision) || !isTimestamp(input.requested_at)) {
    return fail("VALIDATION_ERROR", "Activation request requires trusted context, idempotency, expected Work version and timestamp");
  }
  if (!isObjectRef(input.request_ref) || input.request_ref.object_kind !== "GRAPH_ACTIVATION_REQUEST" ||
      !isObjectRef(input.work_ref) || input.work_ref.object_kind !== "WORK" ||
      !sameScope(input.request_ref, input.work_ref) ||
      input.plan_revision.state !== "ACCEPTED" ||
      input.graph_revision.state !== "VALIDATED" ||
      !sameRef(input.plan_revision.work_ref, input.work_ref) ||
      !sameRef(input.graph_revision.work_ref, input.work_ref) ||
      !sameRef(input.graph_revision.source_plan_revision_ref, input.plan_revision.plan_revision_ref) ||
      !sameScope(input.work_ref, { object_kind: "WORK", object_id: input.work_ref.object_id, scope_ref: input.context.scope_ref })) {
    return fail("VALIDATION_ERROR", "Activation requires an accepted Plan and validated Graph bound to the same Work and exact Plan revision");
  }
  if (
    !isObjectRef(input.graph_revision.validation_result_ref) ||
    input.graph_revision.validation_result_ref.object_kind !== "GRAPH_VALIDATION_RESULT" ||
    !sameScope(input.graph_revision.validation_result_ref, input.work_ref)
  ) {
    return fail("VALIDATION_ERROR", "Graph revision has no valid in-scope validation result");
  }
  if (input.review_decision_ref && (
      !isObjectRef(input.review_decision_ref) ||
      input.review_decision_ref.object_kind !== "GRAPH_REVIEW_DECISION" ||
      !sameScope(input.review_decision_ref, input.work_ref)
  )) {
    return fail("VALIDATION_ERROR", "review_decision_ref must be a GRAPH_REVIEW_DECISION in the Work scope");
  }
  if (!allRefsValid(input.approval_refs) ||
      input.approval_refs.some((ref) => !sameScope(ref, input.work_ref))) {
    return fail("VALIDATION_ERROR", "Activation approval references must be valid and in the Work scope");
  }
  return ok({
    request_ref: input.request_ref,
    work_ref: input.work_ref,
    plan_revision_ref: input.plan_revision.plan_revision_ref,
    graph_revision_ref: input.graph_revision.graph_revision_ref,
    expected_work_revision: input.expected_work_revision,
    approval_refs: [...input.approval_refs],
    ...(input.review_decision_ref ? { review_decision_ref: input.review_decision_ref } : {}),
    idempotency_key: input.context.idempotency_key,
    requested_at: input.requested_at,
  });
}

export function reconcileGraphActivation(
  request: GraphActivationRequest,
  receipt: GraphActivationReceipt,
): PlanningResult<"ACTIVATED" | "REJECTED" | "RECONCILE"> {
  if (!isObjectRef(request.request_ref) || request.request_ref.object_kind !== "GRAPH_ACTIVATION_REQUEST" ||
      !isObjectRef(request.work_ref) || request.work_ref.object_kind !== "WORK" ||
      !isObjectRef(request.plan_revision_ref) || request.plan_revision_ref.object_kind !== "PLAN_REVISION" ||
      !isObjectRef(request.graph_revision_ref) || request.graph_revision_ref.object_kind !== "WORK_GRAPH_REVISION" ||
      !sameScope(request.request_ref, request.work_ref) ||
      !sameScope(request.plan_revision_ref, request.work_ref) ||
      !sameScope(request.graph_revision_ref, request.work_ref) ||
      !isRevisionNumber(request.expected_work_revision) ||
      !isObjectRef(receipt.receipt_ref) || receipt.receipt_ref.object_kind !== "PLAN_GRAPH_ACTIVATION_RECEIPT" ||
      !sameScope(receipt.receipt_ref, request.work_ref) ||
      !isObjectRef(receipt.request_ref) || !sameRef(receipt.request_ref, request.request_ref) ||
      !isObjectRef(receipt.work_ref) || !sameRef(receipt.work_ref, request.work_ref) ||
      !isObjectRef(receipt.plan_revision_ref) || !sameRef(receipt.plan_revision_ref, request.plan_revision_ref) ||
      !isObjectRef(receipt.graph_revision_ref) || !sameRef(receipt.graph_revision_ref, request.graph_revision_ref) ||
      receipt.expected_work_revision !== request.expected_work_revision ||
      (receipt.receipt_state !== "ACCEPTED" && receipt.receipt_state !== "REJECTED" && receipt.receipt_state !== "UNKNOWN") ||
      !isTimestamp(request.requested_at) ||
      !isTimestamp(receipt.received_at) ||
      Date.parse(receipt.received_at) <= Date.parse(request.requested_at)) {
    return fail("VALIDATION_ERROR", "Activation receipt does not match the exact request, Work, Plan and Graph revisions");
  }
  if (receipt.receipt_state === "UNKNOWN") return ok("RECONCILE", ["Query INV-02 active binding before any retry"]);
  if (receipt.receipt_state === "REJECTED") return ok("REJECTED");
  if (receipt.resulting_work_revision !== request.expected_work_revision + 1) {
    return fail("VERSION_CONFLICT", "Accepted activation receipt has an unexpected resulting Work revision");
  }
  return ok("ACTIVATED");
}
