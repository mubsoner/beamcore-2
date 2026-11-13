import { describe, expect, it } from "vitest";
import {
  applyGraphValidation,
  createGraphActivationRequest,
  createGraphRevision,
  createPlanRevision,
  reconcileGraphActivation,
  transitionPlanRevision,
  validateGraphRevision,
  type GraphNode,
  type PlanRevision,
  type WorkGraphRevision,
} from "./domain";
import type { ObjectRef, RequestContext } from "../shared";

const scope = { scope_id: "scope-1", scope_kind: "WORK" as const };
const context: RequestContext = {
  request_id: "req-1",
  correlation_id: "corr-1",
  actor_ref: { principal_id: "user-1", principal_kind: "USER" },
  scope_ref: scope,
  issued_at: "2026-11-13T03:00:00Z",
  idempotency_key: "idem-1",
};
const ref = (object_kind: string, object_id: string): ObjectRef => ({
  object_kind, object_id, object_version: "1", scope_ref: scope,
});
const workRef = ref("WORK", "work-1");
const planRef = ref("PLAN", "plan-1");
const planRevisionRef = ref("PLAN_REVISION", "plan-r1");
const graphRef = ref("WORK_GRAPH", "graph-1");
const graphRevisionRef = ref("WORK_GRAPH_REVISION", "graph-r1");

const makePlan = (): PlanRevision => {
  const result = createPlanRevision({
    context,
    plan_ref: planRef,
    plan_revision_ref: planRevisionRef,
    work_ref: workRef,
    intent_ref: ref("INTENT", "intent-1"),
    desired_outcome_ref: ref("WORK_DESIRED_OUTCOME_REVISION", "target-1"),
    revision_number: 1,
    strategy_summary: "Build, verify and deploy",
    step_proposals: [{
      step_proposal_ref: ref("PLAN_STEP_PROPOSAL", "step-1"),
      title: "Build",
      purpose: "Create the website",
      requirement_refs: [],
      input_refs: [],
      capability_requirement_refs: [],
      expected_output_refs: [],
      dependency_step_refs: [],
      acceptance_criteria_refs: [],
      constraint_refs: [],
    }],
    assumptions: [],
    non_goals: [],
    constraint_refs: [],
    capability_requirement_refs: [],
    created_at: "2026-11-13T03:00:01Z",
  });
  if (!result.ok) throw new Error(result.issues[0].safe_message);
  const underReview = transitionPlanRevision(result.value, "UNDER_REVIEW");
  if (!underReview.ok) throw new Error(underReview.issues[0].safe_message);
  const accepted = transitionPlanRevision(underReview.value, "ACCEPTED", ref("PLAN_REVIEW_DECISION", "review-1"));
  if (!accepted.ok) throw new Error(accepted.issues[0].safe_message);
  return accepted.value;
};

const node = (id: string): GraphNode => ({
  node_ref: ref("GRAPH_NODE", id),
  graph_ref: graphRef,
  node_kind: "WORK_STEP",
  title: id,
  description: "A governed work step",
  requirement_refs: [],
  input_refs: [],
  capability_requirement_refs: [],
  expected_output_refs: [],
  acceptance_criteria_refs: [],
  constraint_refs: [],
});

const makeGraph = (nodes = [node("node-a"), node("node-b")], edges: WorkGraphRevision["edges"] = []) => {
  const result = createGraphRevision({
    context,
    graph_ref: graphRef,
    graph_revision_ref: graphRevisionRef,
    work_ref: workRef,
    source_plan_revision_ref: planRevisionRef,
    revision_number: 1,
    nodes,
    edges,
    change_reason: "Initial graph",
    created_at: "2026-11-13T03:00:02Z",
  });
  if (!result.ok) throw new Error(result.issues[0].safe_message);
  return result.value;
};

describe("INV-03 planning and graph domain", () => {
  it("creates a proposed Plan revision without implying acceptance", () => {
    const plan = makePlan();
    expect(plan.state).toBe("ACCEPTED");
    expect(plan.plan_revision_ref.object_kind).toBe("PLAN_REVISION");
  });

  it("requires review decision before accepting a Plan revision", () => {
    const result = createPlanRevision({
      context, plan_ref: planRef, plan_revision_ref: planRevisionRef,
      work_ref: workRef, intent_ref: ref("INTENT", "intent-1"),
      desired_outcome_ref: ref("WORK_DESIRED_OUTCOME_REVISION", "target-1"),
      revision_number: 1, strategy_summary: "Plan",
      step_proposals: [{
        step_proposal_ref: ref("PLAN_STEP_PROPOSAL", "step-1"),
        title: "Build", purpose: "Build it", requirement_refs: [], input_refs: [],
        capability_requirement_refs: [], expected_output_refs: [], dependency_step_refs: [],
        acceptance_criteria_refs: [], constraint_refs: [],
      }],
      assumptions: [], non_goals: [], constraint_refs: [], capability_requirement_refs: [],
      created_at: "2026-11-13T03:00:01Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const underReview = transitionPlanRevision(result.value, "UNDER_REVIEW");
    if (!underReview.ok) return;
    expect(transitionPlanRevision(underReview.value, "ACCEPTED").ok).toBe(false);
  });

  it("validates an acyclic graph and leaves activation as a separate operation", () => {
    const graph = makeGraph();
    const validation = validateGraphRevision({
      revision: graph,
      validation_ref: ref("GRAPH_VALIDATION_RESULT", "validation-1"),
      validated_at: "2026-11-13T03:00:03Z",
      validator_version: "1.0.0",
    });
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.value.status).toBe("VALID");
    expect(graph.state).toBe("DRAFTED");
    const validated = applyGraphValidation(graph, validation.value);
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.value.state).toBe("VALIDATED");
  });

  it("detects cycles, duplicate nodes and missing edge endpoints", () => {
    const a = node("node-a");
    const b = node("node-b");
    const graph = makeGraph([a, b], [
      {
        edge_ref: ref("DEPENDENCY_EDGE", "edge-1"),
        from_node_ref: a.node_ref,
        to_node_ref: b.node_ref,
        dependency_kind: "COMPLETION",
        created_at: "2026-11-13T03:00:02Z",
      },
      {
        edge_ref: ref("DEPENDENCY_EDGE", "edge-2"),
        from_node_ref: b.node_ref,
        to_node_ref: a.node_ref,
        dependency_kind: "SUCCESS",
        created_at: "2026-11-13T03:00:02Z",
      },
    ]);
    const validation = validateGraphRevision({
      revision: graph,
      validation_ref: ref("GRAPH_VALIDATION_RESULT", "validation-cycle"),
      validated_at: "2026-11-13T03:00:03Z",
      validator_version: "1.0.0",
    });
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.value.status).toBe("INVALID");
    expect(validation.value.findings.some((f) => f.code === "DEPENDENCY_CYCLE")).toBe(true);

    const duplicate = makeGraph([a, a]);
    const duplicateValidation = validateGraphRevision({
      revision: duplicate,
      validation_ref: ref("GRAPH_VALIDATION_RESULT", "validation-duplicate"),
      validated_at: "2026-11-13T03:00:03Z",
      validator_version: "1.0.0",
    });
    expect(duplicateValidation.ok).toBe(true);
    if (duplicateValidation.ok) expect(duplicateValidation.value.status).toBe("INVALID");
  });

  it("enforces configured graph limits", () => {
    const graph = makeGraph();
    const result = validateGraphRevision({
      revision: graph,
      validation_ref: ref("GRAPH_VALIDATION_RESULT", "validation-limit"),
      validated_at: "2026-11-13T03:00:03Z",
      validator_version: "1.0.0",
      max_nodes: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("INVALID");
  });

  it("does not allow warning-bearing graph to validate without review decision", () => {
    const graph = makeGraph();
    const validation = {
      validation_ref: ref("GRAPH_VALIDATION_RESULT", "validation-warn"),
      graph_revision_ref: graph.graph_revision_ref,
      status: "VALID_WITH_WARNINGS" as const,
      findings: [{
        finding_ref: ref("GRAPH_VALIDATION_FINDING", "finding-1"),
        code: "NON_BLOCKING_WARNING",
        severity: "WARNING" as const,
        summary: "Review this condition",
        affected_refs: [],
      }],
      validated_at: "2026-11-13T03:00:03Z",
      validator_version: "1.0.0",
    };
    expect(applyGraphValidation(graph, validation).ok).toBe(false);
    expect(applyGraphValidation(graph, validation, ref("GRAPH_REVIEW_DECISION", "review-graph")).ok).toBe(true);
  });

  it("requests activation only for exact accepted Plan and validated Graph revisions", () => {
    const plan = makePlan();
    const graph = makeGraph();
    const validation = validateGraphRevision({
      revision: graph,
      validation_ref: ref("GRAPH_VALIDATION_RESULT", "validation-activation"),
      validated_at: "2026-11-13T03:00:03Z",
      validator_version: "1.0.0",
    });
    if (!validation.ok) return;
    const validatedGraph = applyGraphValidation(graph, validation.value);
    if (!validatedGraph.ok) return;
    const request = createGraphActivationRequest({
      context,
      request_ref: ref("GRAPH_ACTIVATION_REQUEST", "activation-request-1"),
      work_ref: workRef,
      plan_revision: plan,
      graph_revision: validatedGraph.value,
      expected_work_revision: 4,
      approval_refs: [],
      requested_at: "2026-11-13T03:00:04Z",
    });
    expect(request.ok).toBe(true);
    if (!request.ok) return;
    const receipt = {
      receipt_ref: ref("PLAN_GRAPH_ACTIVATION_RECEIPT", "receipt-1"),
      request_ref: request.value.request_ref,
      work_ref: workRef,
      plan_revision_ref: planRevisionRef,
      graph_revision_ref: graphRevisionRef,
      expected_work_revision: 4,
      resulting_work_revision: 5,
      receipt_state: "ACCEPTED" as const,
      received_at: "2026-11-13T03:00:05Z",
    };
    const accepted = reconcileGraphActivation(request.value, receipt);
    const unknown = reconcileGraphActivation(request.value, { ...receipt, receipt_state: "UNKNOWN" });
    expect(accepted.ok && accepted.value).toBe("ACTIVATED");
    expect(unknown.ok && unknown.value).toBe("RECONCILE");
  });

  it("rejects stale or mismatched activation receipts", () => {
    const request = {
      request_ref: ref("GRAPH_ACTIVATION_REQUEST", "request-1"),
      work_ref: workRef,
      plan_revision_ref: planRevisionRef,
      graph_revision_ref: graphRevisionRef,
      expected_work_revision: 4,
      approval_refs: [],
      idempotency_key: "idem-1",
      requested_at: "2026-11-13T03:00:04Z",
    };
    const receipt = {
      receipt_ref: ref("PLAN_GRAPH_ACTIVATION_RECEIPT", "receipt-1"),
      request_ref: request.request_ref,
      work_ref: workRef,
      plan_revision_ref: planRevisionRef,
      graph_revision_ref: ref("WORK_GRAPH_REVISION", "different-graph"),
      expected_work_revision: 4,
      resulting_work_revision: 5,
      receipt_state: "ACCEPTED" as const,
      received_at: "2026-11-13T03:00:05Z",
    };
    expect(reconcileGraphActivation(request, receipt).ok).toBe(false);
  });
});
