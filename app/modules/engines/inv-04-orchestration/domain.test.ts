import { describe, expect, it } from "vitest";
import {
  authorizeDispatch,
  createDispatchAttempt,
  createOrchestrationRun,
  decideRetry,
  evaluateNodeReadiness,
  transitionNodeCoordination,
  transitionOrchestrationRun,
  type NodeCoordinationRecord,
  type OrchestrationRun,
} from "./domain";
import { createWork, type WorkRecord } from "../inv-02-work/domain";
import { createPlanRevision, createGraphRevision, validateGraphRevision, applyGraphValidation, transitionPlanRevision } from "../inv-03-planning/domain";
import type { ObjectRef, RequestContext } from "../shared";
import type { GraphNode, WorkGraphRevision, PlanRevision } from "../inv-03-planning/domain";

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

const makeFixtures = () => {
  const workResult = createWork({
    context, work_ref: ref("WORK", "work-1"), origin_intent_ref: ref("INTENT", "intent-1"),
    owner_ref: ref("USER", "user-1"), title: "Work", summary: "Test Work",
    created_at: "2026-11-13T03:00:01Z",
  });
  if (!workResult.ok) throw new Error(workResult.issues[0].safe_message);
  let work = workResult.value;
  // A minimal READY state fixture; this is a domain test setup, not a persistence claim.
  work = { ...work, lifecycle_state: "READY", current_revision: 3 };

  const planResult = createPlanRevision({
    context, plan_ref: ref("PLAN", "plan-1"), plan_revision_ref: ref("PLAN_REVISION", "plan-r1"),
    work_ref: work.work_ref, intent_ref: work.origin_intent_ref,
    desired_outcome_ref: ref("WORK_DESIRED_OUTCOME_REVISION", "target-1"),
    revision_number: 1, strategy_summary: "Test plan",
    step_proposals: [{
      step_proposal_ref: ref("PLAN_STEP_PROPOSAL", "step-1"), title: "Step", purpose: "Test",
      requirement_refs: [], input_refs: [], capability_requirement_refs: [], expected_output_refs: [],
      dependency_step_refs: [], acceptance_criteria_refs: [], constraint_refs: [],
    }],
    assumptions: [], non_goals: [], constraint_refs: [], capability_requirement_refs: [],
    created_at: "2026-11-13T03:00:02Z",
  });
  if (!planResult.ok) throw new Error(planResult.issues[0].safe_message);
  const underReview = transitionPlanRevision(planResult.value, "UNDER_REVIEW");
  if (!underReview.ok) throw new Error(underReview.issues[0].safe_message);
  const accepted = transitionPlanRevision(underReview.value, "ACCEPTED", ref("PLAN_REVIEW_DECISION", "review-1"));
  if (!accepted.ok) throw new Error(accepted.issues[0].safe_message);
  const plan = accepted.value;

  const graphRef = ref("WORK_GRAPH", "graph-1");
  const nodeA: GraphNode = {
    node_ref: ref("GRAPH_NODE", "node-a"), graph_ref: graphRef, node_kind: "WORK_STEP",
    title: "A", description: "A", requirement_refs: [], input_refs: [], capability_requirement_refs: [],
    expected_output_refs: [], acceptance_criteria_refs: [], constraint_refs: [],
  };
  const nodeB: GraphNode = {
    ...nodeA, node_ref: ref("GRAPH_NODE", "node-b"), title: "B",
  };
  const graphResult = createGraphRevision({
    context, graph_ref: graphRef, graph_revision_ref: ref("WORK_GRAPH_REVISION", "graph-r1"),
    work_ref: work.work_ref, source_plan_revision_ref: plan.plan_revision_ref, revision_number: 1,
    nodes: [nodeA, nodeB], edges: [{
      edge_ref: ref("DEPENDENCY_EDGE", "edge-a-b"), from_node_ref: nodeA.node_ref,
      to_node_ref: nodeB.node_ref, dependency_kind: "SUCCESS", created_at: "2026-11-13T03:00:03Z",
    }],
    change_reason: "Test graph", created_at: "2026-11-13T03:00:03Z",
  });
  if (!graphResult.ok) throw new Error(graphResult.issues[0].safe_message);
  const graph = graphResult.value;
  const validation = validateGraphRevision({
    revision: graph, validation_ref: ref("GRAPH_VALIDATION_RESULT", "validation-1"),
    validated_at: "2026-11-13T03:00:04Z", validator_version: "test",
  });
  if (!validation.ok) throw new Error(validation.issues[0].safe_message);
  const validated = applyGraphValidation(graph, validation.value);
  if (!validated.ok) throw new Error(validated.issues[0].safe_message);
  work = {
    ...work,
    current_plan_ref: plan.plan_revision_ref,
    current_work_graph_ref: graph.graph_revision_ref,
  };
  const receipt = {
    receipt_ref: ref("PLAN_GRAPH_ACTIVATION_RECEIPT", "activation-1"),
    request_ref: ref("GRAPH_ACTIVATION_REQUEST", "activation-request-1"),
    work_ref: work.work_ref,
    plan_revision_ref: plan.plan_revision_ref,
    graph_revision_ref: graph.graph_revision_ref,
    expected_work_revision: 2,
    resulting_work_revision: 3,
    receipt_state: "ACCEPTED" as const,
    received_at: "2026-11-13T03:00:05Z",
  };
  return { work, plan, graph: validated.value, nodeA, nodeB, receipt };
};

const makeRun = (fixtures = makeFixtures()): OrchestrationRun => {
  const result = createOrchestrationRun({
    context,
    orchestration_ref: ref("ORCHESTRATION_RUN", "run-1"),
    request_ref: ref("ORCHESTRATION_REQUEST", "request-1"),
    work: fixtures.work,
    graph: fixtures.graph,
    activation_receipt: fixtures.receipt,
    created_at: "2026-11-13T03:00:06Z",
  });
  if (!result.ok) throw new Error(result.issues[0].safe_message);
  return result.value;
};

const makeRunningRun = (): OrchestrationRun => {
  const created = makeRun();
  const evaluating = transitionOrchestrationRun({
    run: created, expected_state_version: 1, target_state: "EVALUATING",
    occurred_at: "2026-11-13T03:00:07Z",
  });
  if (!evaluating.ok) throw new Error(evaluating.issues[0].safe_message);
  const running = transitionOrchestrationRun({
    run: evaluating.value, expected_state_version: 2, target_state: "RUNNING",
    occurred_at: "2026-11-13T03:00:08Z",
  });
  if (!running.ok) throw new Error(running.issues[0].safe_message);
  return running.value;
};

const makeNodeCoordination = (run: OrchestrationRun, nodeRef: ObjectRef, state: NodeCoordinationRecord["state"] = "READY"): NodeCoordinationRecord => ({
  node_coordination_ref: ref("NODE_COORDINATION", `coord-${nodeRef.object_id}`),
  orchestration_ref: run.orchestration_ref,
  work_ref: run.work_ref,
  graph_revision_ref: run.graph_revision_ref,
  graph_node_ref: nodeRef,
  state,
  state_version: 1,
  execution_refs: [],
  last_transition_at: "2026-11-13T03:00:06Z",
  updated_at: "2026-11-13T03:00:06Z",
  error_refs: [],
});

describe("INV-04 orchestration domain", () => {
  it("creates a run pinned to exact Work, Plan, Graph and activation receipt", () => {
    const fixtures = makeFixtures();
    const run = makeRun(fixtures);
    expect(run.state).toBe("CREATED");
    expect(run.graph_revision_ref).toEqual(fixtures.graph.graph_revision_ref);
    expect(run.plan_revision_ref).toEqual(fixtures.plan.plan_revision_ref);
    expect(run.graph_activation_receipt_ref).toEqual(fixtures.receipt.receipt_ref);
  });

  it("blocks run creation when activation is unknown or the graph pointer differs", () => {
    const fixtures = makeFixtures();
    expect(createOrchestrationRun({
      context, orchestration_ref: ref("ORCHESTRATION_RUN", "run-unknown"),
      request_ref: ref("ORCHESTRATION_REQUEST", "request-unknown"),
      work: fixtures.work, graph: fixtures.graph,
      activation_receipt: { ...fixtures.receipt, receipt_state: "UNKNOWN" },
      created_at: "2026-11-13T03:00:06Z",
    }).ok).toBe(false);
    expect(createOrchestrationRun({
      context, orchestration_ref: ref("ORCHESTRATION_RUN", "run-mismatch"),
      request_ref: ref("ORCHESTRATION_REQUEST", "request-mismatch"),
      work: { ...fixtures.work, current_work_graph_ref: ref("WORK_GRAPH_REVISION", "other") },
      graph: fixtures.graph, activation_receipt: fixtures.receipt,
      created_at: "2026-11-13T03:00:06Z",
    }).ok).toBe(false);
  });

  it("enforces orchestration run state transitions and version checks", () => {
    const run = makeRun();
    const evaluating = transitionOrchestrationRun({
      run, expected_state_version: 1, target_state: "EVALUATING",
      occurred_at: "2026-11-13T03:00:07Z",
    });
    expect(evaluating.ok).toBe(true);
    if (!evaluating.ok) return;
    expect(transitionOrchestrationRun({
      run: evaluating.value, expected_state_version: 1, target_state: "RUNNING",
      occurred_at: "2026-11-13T03:00:08Z",
    }).ok).toBe(false);
  });

  it("evaluates dependency gates according to their typed meaning", () => {
    const fixtures = makeFixtures();
    const run = makeRun(fixtures);
    const ready = evaluateNodeReadiness({
      run, graph: fixtures.graph, node: fixtures.nodeB,
      prerequisite_states: [{
        node_ref: fixtures.nodeA.node_ref, coordination_state: "COMPLETED",
        execution_result: "SUCCESS", output_refs: [],
      }],
      gate_ref: ref("DEPENDENCY_GATE", "gate-1"),
      evaluated_at: "2026-11-13T03:00:08Z",
    });
    expect(ready.ok).toBe(true);
    if (ready.ok) expect(ready.value.state).toBe("READY");

    const unknown = evaluateNodeReadiness({
      run, graph: fixtures.graph, node: fixtures.nodeB,
      prerequisite_states: [],
      gate_ref: ref("DEPENDENCY_GATE", "gate-2"),
      evaluated_at: "2026-11-13T03:00:08Z",
    });
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.value.gate.result).toBe("UNKNOWN");

    const failure = evaluateNodeReadiness({
      run, graph: fixtures.graph, node: fixtures.nodeB,
      prerequisite_states: [{
        node_ref: fixtures.nodeA.node_ref, coordination_state: "COMPLETED",
        execution_result: "FAILURE", output_refs: [],
      }],
      gate_ref: ref("DEPENDENCY_GATE", "gate-3"),
      evaluated_at: "2026-11-13T03:00:08Z",
    });
    expect(failure.ok).toBe(true);
    if (failure.ok) expect(failure.value.gate.result).toBe("BLOCKED");
  });

  it("requires READY, current authorization, capability and resource admission before dispatch", () => {
    const allowed = authorizeDispatch({
      node_state: "READY",
      authorization: { decision_ref: ref("AUTHORITY_DECISION", "auth-1"), disposition: "ALLOWED" },
      capability: { capability_ref: ref("CAPABILITY", "cap-1"), version: "v1", eligible: true },
      resource: { admission_ref: ref("RESOURCE_ADMISSION", "admit-1"), state: "ADMITTED" },
    });
    expect(allowed.ok).toBe(true);
    expect(authorizeDispatch({
      node_state: "READY",
      authorization: { decision_ref: ref("AUTHORITY_DECISION", "auth-2"), disposition: "REQUIRES_APPROVAL" },
      capability: { capability_ref: ref("CAPABILITY", "cap-1"), version: "v1", eligible: true },
      resource: { admission_ref: ref("RESOURCE_ADMISSION", "admit-1"), state: "ADMITTED" },
    }).ok).toBe(false);

    const run = makeRunningRun();
    const node = makeNodeCoordination(run, ref("GRAPH_NODE", "node-a"));
    const attempt = createDispatchAttempt({
      context, run, node,
      attempt_ref: ref("DISPATCH_ATTEMPT", "dispatch-1"),
      capability_ref: ref("CAPABILITY", "cap-1"), capability_version: "v1",
      authorization_decision_ref: ref("AUTHORITY_DECISION", "auth-1"),
      resource_admission_ref: ref("RESOURCE_ADMISSION", "admit-1"),
      authorization_disposition: "ALLOWED",
      capability_eligible: true,
      resource_admission_state: "ADMITTED",
      attempt_number: 1, submitted_at: "2026-11-13T03:00:09Z",
    });
    expect(attempt.ok).toBe(true);
  });

  it("never blindly retries uncertain or non-idempotent side effects", () => {
    const run = makeRunningRun();
    const node = makeNodeCoordination(run, ref("GRAPH_NODE", "node-a"));
    const attempt = createDispatchAttempt({
      context, run, node, attempt_ref: ref("DISPATCH_ATTEMPT", "dispatch-1"),
      capability_ref: ref("CAPABILITY", "cap-1"), capability_version: "v1",
      authorization_decision_ref: ref("AUTHORITY_DECISION", "auth-1"),
      resource_admission_ref: ref("RESOURCE_ADMISSION", "admit-1"),
      authorization_disposition: "ALLOWED",
      capability_eligible: true,
      resource_admission_state: "ADMITTED",
      attempt_number: 1, submitted_at: "2026-11-13T03:00:09Z",
    });
    if (!attempt.ok) return;
    const unsafe = decideRetry({
      retry_decision_ref: ref("RETRY_DECISION", "retry-1"),
      dispatch: attempt.value, failure_classification: "timeout",
      side_effect_class: "UNKNOWN", retryable_failure: true,
      next_attempt_number: 2, decided_at: "2026-11-13T03:00:10Z",
    });
    expect(unsafe.ok).toBe(true);
    if (unsafe.ok) expect(unsafe.value.disposition).toBe("RECONCILE_FIRST");
    const safe = decideRetry({
      retry_decision_ref: ref("RETRY_DECISION", "retry-2"),
      dispatch: attempt.value, failure_classification: "transient-read",
      side_effect_class: "IDEMPOTENT", retryable_failure: true,
      next_attempt_number: 2, decided_at: "2026-11-13T03:00:10Z",
    });
    expect(safe.ok).toBe(true);
    if (safe.ok) expect(safe.value.disposition).toBe("RETRY_ALLOWED");
  });

  it("guards node state transitions with optimistic versioning", () => {
    const run = makeRun();
    const node = makeNodeCoordination(run, ref("GRAPH_NODE", "node-a"), "PENDING");
    const evaluating = transitionNodeCoordination({
      node, expected_state_version: 1, target_state: "EVALUATING",
      occurred_at: "2026-11-13T03:00:10Z",
    });
    expect(evaluating.ok).toBe(true);
    expect(transitionNodeCoordination({
      node, expected_state_version: 2, target_state: "READY",
      occurred_at: "2026-11-13T03:00:11Z",
    }).ok).toBe(false);
  });
});
