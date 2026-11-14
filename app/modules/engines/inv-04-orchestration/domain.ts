import {
  isObjectRef,
  isPrincipalRef,
  isRequestContext,
  isRevisionNumber,
  isTimestamp,
  type ObjectRef,
  type PrincipalRef,
  type RequestContext,
  type RevisionNumber,
  type Timestamp,
} from "../shared";
import type { WorkRecord } from "../inv-02-work/domain";
import type {
  GraphNode,
  DependencyEdge,
  WorkGraphRevision,
  GraphActivationReceipt,
} from "../inv-03-planning/domain";

export type OrchestrationRunState = "CREATED" | "EVALUATING" | "RUNNING" | "WAITING" | "PAUSED" | "RECOVERING" | "CANCELLING" | "COMPLETED" | "FAILED" | "UNKNOWN" | "CANCELLED";
export type NodeCoordinationState = "PENDING" | "EVALUATING" | "READY" | "DISPATCH_REQUESTED" | "WAITING" | "BLOCKED" | "RUNNING" | "COMPLETED" | "FAILED" | "UNKNOWN" | "CANCELLED" | "INVALIDATED" | "REVALIDATION_REQUIRED" | "RECONCILIATION_REQUIRED";
export type DependencyGateResult = "SATISFIED" | "UNSATISFIED" | "WAITING" | "BLOCKED" | "UNKNOWN";
export type RetryDisposition = "RETRY_ALLOWED" | "NO_RETRY" | "RECONCILE_FIRST" | "WAIT_FOR_DEPENDENCY" | "ESCALATE";
export type SideEffectClass = "IDEMPOTENT" | "DEDUPLICATED" | "REVERSIBLE" | "NON_IDEMPOTENT" | "UNKNOWN";
export type ResourceAdmissionState = "ADMITTED" | "DENIED" | "DEFERRED" | "UNKNOWN";
export type DispatchAttemptState = "CREATED" | "AUTHORIZING" | "RESOURCE_CHECK" | "SUBMITTED" | "ACCEPTED" | "RUNNING" | "COMPLETED" | "REJECTED" | "FAILED" | "UNKNOWN" | "CANCEL_REQUESTED" | "CANCELLED" | "RECONCILING";
export type CoordinationDisposition = "CONTINUE" | "WAIT" | "RETRY" | "RECONCILE" | "STOP_BRANCH" | "STOP_RUN" | "ESCALATE";

export interface OrchestrationRun {
  orchestration_ref: ObjectRef;
  work_ref: ObjectRef;
  work_version_at_start: string;
  plan_revision_ref: ObjectRef;
  graph_revision_ref: ObjectRef;
  graph_activation_receipt_ref: ObjectRef;
  state: OrchestrationRunState;
  state_version: RevisionNumber;
  scope_ref: RequestContext["scope_ref"];
  request_ref: ObjectRef;
  activation_request_ref: ObjectRef;
  started_by: PrincipalRef;
  created_at: Timestamp;
  started_at?: Timestamp;
  updated_at: Timestamp;
  ended_at?: Timestamp;
  terminal_disposition?: CoordinationDisposition;
  error_refs: ObjectRef[];
}

export interface NodeCoordinationRecord {
  node_coordination_ref: ObjectRef;
  orchestration_ref: ObjectRef;
  work_ref: ObjectRef;
  graph_revision_ref: ObjectRef;
  graph_node_ref: ObjectRef;
  state: NodeCoordinationState;
  state_version: RevisionNumber;
  dependency_gate_ref?: ObjectRef;
  current_dispatch_ref?: ObjectRef;
  execution_refs: ObjectRef[];
  last_transition_at: Timestamp;
  updated_at: Timestamp;
  error_refs: ObjectRef[];
}

export interface OrchestrationCheckpoint {
  checkpoint_ref: ObjectRef;
  orchestration_ref: ObjectRef;
  work_ref: ObjectRef;
  graph_revision_ref: ObjectRef;
  checkpoint_sequence: number;
  kind: "NODE_BOUNDARY" | "SAFE_POINT" | "RECOVERY_SNAPSHOT";
  node_state_refs: ObjectRef[];
  active_dispatch_refs: ObjectRef[];
  unresolved_wait_refs: ObjectRef[];
  reconciliation_refs: ObjectRef[];
  durable_state_version: RevisionNumber;
  created_at: Timestamp;
  created_by: PrincipalRef;
  integrity_digest?: string;
  recovery_constraints: string[];
}

export interface CancellationReport {
  cancellation_ref: ObjectRef;
  orchestration_ref: ObjectRef;
  status: "REQUESTED" | "PROPAGATED" | "PARTIAL" | "COMPLETED" | "UNKNOWN";
  requested_at: Timestamp;
  requested_by: PrincipalRef;
  dispatches_not_started: ObjectRef[];
  execution_cancel_requests: ObjectRef[];
  completed_execution_refs: ObjectRef[];
  unresolved_execution_refs: ObjectRef[];
  world_state_reconciliation_refs: ObjectRef[];
  irreversible_or_unknown_effect_refs: ObjectRef[];
  completed_at?: Timestamp;
}

export interface DispatchAttempt {
  dispatch_ref: ObjectRef;
  orchestration_ref: ObjectRef;
  node_coordination_ref: ObjectRef;
  work_ref: ObjectRef;
  graph_revision_ref: ObjectRef;
  graph_node_ref: ObjectRef;
  target_capability_ref: ObjectRef;
  target_capability_version: string;
  state: DispatchAttemptState;
  attempt_number: number;
  idempotency_key: string;
  request_correlation_id: string;
  authorization_decision_ref: ObjectRef;
  resource_admission_ref: ObjectRef;
  execution_ref?: ObjectRef;
  submitted_at?: Timestamp;
  accepted_at?: Timestamp;
  completed_at?: Timestamp;
  reconciliation_ref?: ObjectRef;
  error_refs: ObjectRef[];
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DependencyGate {
  gate_ref: ObjectRef;
  orchestration_ref: ObjectRef;
  graph_revision_ref: ObjectRef;
  graph_node_ref: ObjectRef;
  result: DependencyGateResult;
  prerequisite_node_refs: ObjectRef[];
  unsatisfied_prerequisite_refs: ObjectRef[];
  source_state_refs: ObjectRef[];
  evaluated_at: Timestamp;
  reason_codes: string[];
  error_refs: ObjectRef[];
}

export interface PrerequisiteState {
  node_ref: ObjectRef;
  coordination_state: NodeCoordinationState;
  execution_result?: "SUCCESS" | "FAILURE" | "PARTIAL" | "UNKNOWN";
  output_refs: ObjectRef[];
  approval_state?: "GRANTED" | "DENIED" | "PENDING" | "UNKNOWN";
  condition_state?: "SATISFIED" | "UNSATISFIED" | "UNKNOWN";
  source_state_ref?: ObjectRef;
}

export interface ReadinessEvaluation {
  state: NodeCoordinationState;
  gate: DependencyGate;
}

export interface RetryDecision {
  retry_decision_ref: ObjectRef;
  dispatch_ref: ObjectRef;
  disposition: RetryDisposition;
  reason_code: string;
  failure_classification: string;
  side_effect_class: SideEffectClass;
  next_attempt_number?: number;
  reconciliation_ref?: ObjectRef;
  decided_at: Timestamp;
}

export interface DispatchGateInput {
  node_state: NodeCoordinationState;
  authorization: { decision_ref: ObjectRef; disposition: "ALLOWED" | "DENIED" | "REQUIRES_APPROVAL" | "UNKNOWN" };
  capability: { capability_ref: ObjectRef; version: string; eligible: boolean };
  resource: { admission_ref: ObjectRef; state: ResourceAdmissionState };
}

export type OrchestrationIssue = {
  code: "VALIDATION_ERROR" | "VERSION_CONFLICT" | "INVALID_TRANSITION" |
    "FORBIDDEN" | "APPROVAL_REQUIRED" | "DEPENDENCY_UNAVAILABLE" |
    "RESOURCE_LIMIT" | "OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED";
  safe_message: string;
};
export type OrchestrationResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; issues: OrchestrationIssue[] };

const ok = <T>(value: T, warnings: string[] = []): OrchestrationResult<T> => ({ ok: true, value, warnings });
const fail = <T = never>(code: OrchestrationIssue["code"], safe_message: string): OrchestrationResult<T> => ({
  ok: false, issues: [{ code, safe_message }],
});
const sameRef = (a: ObjectRef, b: ObjectRef) =>
  a.object_kind === b.object_kind &&
  a.object_id === b.object_id &&
  a.object_version === b.object_version &&
  a.scope_ref.scope_id === b.scope_ref.scope_id &&
  a.scope_ref.scope_kind === b.scope_ref.scope_kind;
const sameScopeRef = (
  a: RequestContext["scope_ref"],
  b: RequestContext["scope_ref"],
) => a.scope_id === b.scope_id && a.scope_kind === b.scope_kind;

export function createOrchestrationRun(input: {
  context: RequestContext;
  orchestration_ref: ObjectRef;
  request_ref: ObjectRef;
  activation_request_ref: ObjectRef;
  work: WorkRecord;
  graph: WorkGraphRevision;
  activation_receipt: GraphActivationReceipt;
  created_at: Timestamp;
}): OrchestrationResult<OrchestrationRun> {
  const { context, work, graph, activation_receipt } = input;
  if (!isRequestContext(context) || !context.idempotency_key ||
      !isTimestamp(input.created_at) || !isObjectRef(input.orchestration_ref) ||
      input.orchestration_ref.object_kind !== "ORCHESTRATION_RUN" ||
      !isObjectRef(input.request_ref) ||
      input.request_ref.object_kind !== "ORCHESTRATION_REQUEST" ||
      !isObjectRef(input.activation_request_ref) ||
      input.activation_request_ref.object_kind !== "GRAPH_ACTIVATION_REQUEST") {
    return fail("VALIDATION_ERROR", "Orchestration run requires trusted context, idempotency and valid run/request references");
  }
  if (!isObjectRef(work.work_ref) || work.lifecycle_state !== "READY") {
    return fail("VALIDATION_ERROR", "A new orchestration run requires Work in READY state");
  }
  if (work.scope_ref.scope_id !== context.scope_ref.scope_id ||
      work.scope_ref.scope_kind !== context.scope_ref.scope_kind ||
      !sameScopeRef(input.request_ref.scope_ref, work.scope_ref) ||
      !sameScopeRef(input.activation_request_ref.scope_ref, work.scope_ref) ||
      !sameScopeRef(input.orchestration_ref.scope_ref, work.scope_ref)) {
    return fail("FORBIDDEN", "Orchestration request scope does not match Work scope");
  }
  if (graph.state !== "VALIDATED" || !sameRef(graph.work_ref, work.work_ref) ||
      !work.current_plan_ref || !work.current_work_graph_ref ||
      !sameRef(work.current_plan_ref, graph.source_plan_revision_ref) ||
      !sameRef(work.current_work_graph_ref, graph.graph_revision_ref)) {
    return fail("VALIDATION_ERROR", "Work must point to this exact accepted Plan and validated Graph before orchestration starts");
  }
  if (activation_receipt.receipt_state === "UNKNOWN") {
    return fail("OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED", "Graph activation is unknown; reconcile Work binding before orchestration");
  }
  if (!isObjectRef(activation_receipt.receipt_ref) ||
      activation_receipt.receipt_ref.object_kind !== "PLAN_GRAPH_ACTIVATION_RECEIPT" ||
      activation_receipt.receipt_ref.scope_ref.scope_id !== work.scope_ref.scope_id ||
      activation_receipt.receipt_ref.scope_ref.scope_kind !== work.scope_ref.scope_kind ||
      !isObjectRef(activation_receipt.request_ref) ||
      activation_receipt.request_ref.object_kind !== "GRAPH_ACTIVATION_REQUEST" ||
      !sameScopeRef(activation_receipt.request_ref.scope_ref, work.scope_ref) ||
      !sameRef(activation_receipt.request_ref, input.activation_request_ref) ||
      !isRevisionNumber(activation_receipt.expected_work_revision) ||
      !isRevisionNumber(activation_receipt.resulting_work_revision) ||
      !isTimestamp(activation_receipt.received_at) ||
      activation_receipt.receipt_state !== "ACCEPTED" ||
      !sameRef(activation_receipt.work_ref, work.work_ref) ||
      !sameRef(activation_receipt.plan_revision_ref, graph.source_plan_revision_ref) ||
      !sameRef(activation_receipt.graph_revision_ref, graph.graph_revision_ref) ||
      activation_receipt.resulting_work_revision !== work.current_revision ||
      activation_receipt.resulting_work_revision !== activation_receipt.expected_work_revision + 1 ||
      Date.parse(input.created_at) < Date.parse(activation_receipt.received_at)) {
    return fail("VALIDATION_ERROR", "Activation receipt does not confirm the exact current Work/Plan/Graph binding");
  }
  return ok({
    orchestration_ref: input.orchestration_ref,
    work_ref: work.work_ref,
    work_version_at_start: String(work.current_revision),
    plan_revision_ref: graph.source_plan_revision_ref,
    graph_revision_ref: graph.graph_revision_ref,
    graph_activation_receipt_ref: activation_receipt.receipt_ref,
    state: "CREATED",
    state_version: 1,
    scope_ref: work.scope_ref,
    request_ref: input.request_ref,
    activation_request_ref: input.activation_request_ref,
    started_by: context.actor_ref,
    created_at: input.created_at,
    updated_at: input.created_at,
    error_refs: [],
  });
}

const runTransitions: Record<OrchestrationRunState, readonly OrchestrationRunState[]> = {
  CREATED: ["EVALUATING", "FAILED", "UNKNOWN"],
  EVALUATING: ["RUNNING", "WAITING", "FAILED", "UNKNOWN"],
  RUNNING: ["WAITING", "PAUSED", "RECOVERING", "CANCELLING", "COMPLETED", "FAILED", "UNKNOWN"],
  WAITING: ["EVALUATING", "PAUSED", "RECOVERING", "CANCELLING", "FAILED", "UNKNOWN"],
  PAUSED: ["EVALUATING", "RECOVERING", "CANCELLING"],
  RECOVERING: ["EVALUATING", "UNKNOWN", "FAILED", "CANCELLING"],
  CANCELLING: ["CANCELLED", "UNKNOWN"],
  COMPLETED: [],
  FAILED: [],
  UNKNOWN: [],
  CANCELLED: [],
};

export function transitionOrchestrationRun(input: {
  run: OrchestrationRun;
  expected_state_version: RevisionNumber;
  target_state: OrchestrationRunState;
  occurred_at: Timestamp;
  disposition?: CoordinationDisposition;
}): OrchestrationResult<OrchestrationRun> {
  if (input.expected_state_version !== input.run.state_version) return fail("VERSION_CONFLICT", "Orchestration run state version is stale");
  if (!isTimestamp(input.occurred_at)) return fail("VALIDATION_ERROR", "Transition timestamp is invalid");
  if (!runTransitions[input.run.state].includes(input.target_state)) {
    return fail("INVALID_TRANSITION", `Orchestration run cannot transition from ${input.run.state} to ${input.target_state}`);
  }
  const terminal = ["COMPLETED", "FAILED", "UNKNOWN", "CANCELLED"].includes(input.target_state);
  return ok({
    ...input.run,
    state: input.target_state,
    state_version: input.run.state_version + 1,
    updated_at: input.occurred_at,
    ...(input.target_state === "RUNNING" && !input.run.started_at ? { started_at: input.occurred_at } : {}),
    ...(terminal ? { ended_at: input.occurred_at } : {}),
    ...(input.disposition ? { terminal_disposition: input.disposition } : {}),
  });
}

export function createNodeCoordination(input: {
  context: RequestContext;
  run: OrchestrationRun;
  graph: WorkGraphRevision;
  node: GraphNode;
  node_coordination_ref: ObjectRef;
  created_at: Timestamp;
}): OrchestrationResult<NodeCoordinationRecord> {
  if (!isRequestContext(input.context) ||
      !isObjectRef(input.node_coordination_ref) ||
      input.node_coordination_ref.object_kind !== "NODE_COORDINATION" ||
      !isTimestamp(input.created_at) ||
      !sameScopeRef(input.node_coordination_ref.scope_ref, input.run.scope_ref) ||
      !sameRef(input.run.graph_revision_ref, input.graph.graph_revision_ref) ||
      !sameRef(input.run.work_ref, input.graph.work_ref) ||
      !sameRef(input.node.graph_ref, input.graph.graph_ref) ||
      !input.graph.nodes.some((candidate) => sameRef(candidate.node_ref, input.node.node_ref))) {
    return fail("VALIDATION_ERROR", "Node coordination must be created for a node in the exact pinned Work Graph revision");
  }
  if (input.context.scope_ref.scope_id !== input.run.scope_ref.scope_id ||
      input.context.scope_ref.scope_kind !== input.run.scope_ref.scope_kind) {
    return fail("FORBIDDEN", "Node coordination request is outside the orchestration scope");
  }
  return ok({
    node_coordination_ref: input.node_coordination_ref,
    orchestration_ref: input.run.orchestration_ref,
    work_ref: input.run.work_ref,
    graph_revision_ref: input.run.graph_revision_ref,
    graph_node_ref: input.node.node_ref,
    state: "PENDING",
    state_version: 1,
    execution_refs: [],
    last_transition_at: input.created_at,
    updated_at: input.created_at,
    error_refs: [],
  });
}

export function createOrchestrationCheckpoint(input: {
  checkpoint_ref: ObjectRef;
  run: OrchestrationRun;
  checkpoint_sequence: number;
  kind: OrchestrationCheckpoint["kind"];
  node_state_refs: ObjectRef[];
  active_dispatch_refs: ObjectRef[];
  unresolved_wait_refs: ObjectRef[];
  reconciliation_refs: ObjectRef[];
  durable_state_version: RevisionNumber;
  created_at: Timestamp;
  created_by: PrincipalRef;
  integrity_digest?: string;
  recovery_constraints: string[];
}): OrchestrationResult<OrchestrationCheckpoint> {
  if (!isObjectRef(input.checkpoint_ref) || input.checkpoint_ref.object_kind !== "ORCHESTRATION_CHECKPOINT" ||
      !Number.isSafeInteger(input.checkpoint_sequence) || input.checkpoint_sequence < 1 ||
      !isRevisionNumber(input.durable_state_version) || !isTimestamp(input.created_at) ||
      ![...input.node_state_refs, ...input.active_dispatch_refs, ...input.unresolved_wait_refs, ...input.reconciliation_refs].every(isObjectRef) ||
      (input.integrity_digest !== undefined && !/^[a-f0-9]{32,128}$/i.test(input.integrity_digest))) {
    return fail("VALIDATION_ERROR", "Checkpoint identity, sequence, version, timestamp or references are invalid");
  }
  return ok({
    checkpoint_ref: input.checkpoint_ref,
    orchestration_ref: input.run.orchestration_ref,
    work_ref: input.run.work_ref,
    graph_revision_ref: input.run.graph_revision_ref,
    checkpoint_sequence: input.checkpoint_sequence,
    kind: input.kind,
    node_state_refs: [...input.node_state_refs],
    active_dispatch_refs: [...input.active_dispatch_refs],
    unresolved_wait_refs: [...input.unresolved_wait_refs],
    reconciliation_refs: [...input.reconciliation_refs],
    durable_state_version: input.durable_state_version,
    created_at: input.created_at,
    created_by: input.created_by,
    ...(input.integrity_digest ? { integrity_digest: input.integrity_digest } : {}),
    recovery_constraints: [...input.recovery_constraints],
  });
}

export function createCancellationReport(input: {
  cancellation_ref: ObjectRef;
  run: OrchestrationRun;
  requested_at: Timestamp;
  requested_by: PrincipalRef;
  dispatches_not_started: ObjectRef[];
  execution_cancel_requests: ObjectRef[];
  completed_execution_refs: ObjectRef[];
  unresolved_execution_refs: ObjectRef[];
  world_state_reconciliation_refs: ObjectRef[];
  irreversible_or_unknown_effect_refs: ObjectRef[];
  /** True only when INV-05 has confirmed every execution is stopped or terminal. */
  execution_states_confirmed?: boolean;
  /** Must be the timestamp returned with the authoritative completion confirmation. */
  completed_at?: Timestamp;
}): OrchestrationResult<CancellationReport> {
  if (!isObjectRef(input.cancellation_ref) || input.cancellation_ref.object_kind !== "CANCELLATION_REPORT" ||
      !isTimestamp(input.requested_at) || !isObjectRef(input.run.orchestration_ref) ||
      !isPrincipalRef(input.requested_by) ||
      ![...input.dispatches_not_started, ...input.execution_cancel_requests,
        ...input.completed_execution_refs, ...input.unresolved_execution_refs,
        ...input.world_state_reconciliation_refs, ...input.irreversible_or_unknown_effect_refs].every(isObjectRef) ||
      (input.completed_at !== undefined && !isTimestamp(input.completed_at))) {
    return fail("VALIDATION_ERROR", "Cancellation report contains invalid identity, timestamp or references");
  }
  if (input.execution_states_confirmed === true && (
      !input.completed_at ||
      input.unresolved_execution_refs.length > 0 ||
      input.irreversible_or_unknown_effect_refs.length > 0
  )) {
    return fail("VALIDATION_ERROR", "Confirmed cancellation requires a completion timestamp and no unresolved or unknown effects");
  }
  if (input.completed_at !== undefined && Date.parse(input.completed_at) <= Date.parse(input.requested_at)) {
    return fail("VALIDATION_ERROR", "Cancellation completion must occur after the request");
  }
  if (input.execution_states_confirmed !== true && input.completed_at !== undefined) {
    return fail("VALIDATION_ERROR", "Completion timestamp cannot be supplied without authoritative execution confirmation");
  }

  const unresolved = input.unresolved_execution_refs.length > 0 ||
    input.irreversible_or_unknown_effect_refs.length > 0;
  const propagated = input.execution_cancel_requests.length > 0;
  const status: CancellationReport["status"] = unresolved ? "UNKNOWN" :
    input.execution_states_confirmed === true ? "COMPLETED" :
    propagated ? "PROPAGATED" : "REQUESTED";

  return ok({
    cancellation_ref: input.cancellation_ref,
    orchestration_ref: input.run.orchestration_ref,
    status,
    requested_at: input.requested_at,
    requested_by: input.requested_by,
    dispatches_not_started: [...input.dispatches_not_started],
    execution_cancel_requests: [...input.execution_cancel_requests],
    completed_execution_refs: [...input.completed_execution_refs],
    unresolved_execution_refs: [...input.unresolved_execution_refs],
    world_state_reconciliation_refs: [...input.world_state_reconciliation_refs],
    irreversible_or_unknown_effect_refs: [...input.irreversible_or_unknown_effect_refs],
    ...(status === "COMPLETED" ? { completed_at: input.completed_at } : {}),
  });
}

export function evaluateNodeReadiness(input: {
  run: OrchestrationRun;
  graph: WorkGraphRevision;
  node: GraphNode;
  prerequisite_states: PrerequisiteState[];
  gate_ref: ObjectRef;
  evaluated_at: Timestamp;
}): OrchestrationResult<ReadinessEvaluation> {
  if (!isObjectRef(input.gate_ref) || input.gate_ref.object_kind !== "DEPENDENCY_GATE" ||
      !isTimestamp(input.evaluated_at) ||
      !sameRef(input.run.graph_revision_ref, input.graph.graph_revision_ref) ||
      !sameRef(input.node.graph_ref, input.graph.graph_ref)) {
    return fail("VALIDATION_ERROR", "Readiness evaluation must use the exact pinned graph and valid gate reference");
  }
  const nodeExists = input.graph.nodes.some((node) => sameRef(node.node_ref, input.node.node_ref));
  if (!nodeExists) return fail("VALIDATION_ERROR", "Node is not part of the pinned graph revision");

  const incoming = input.graph.edges.filter((edge) => edge.to_node_ref.object_id === input.node.node_ref.object_id);
  const prerequisiteRefs = incoming.map((edge) => edge.from_node_ref);
  const states = new Map(input.prerequisite_states.map((state) => [state.node_ref.object_id, state]));
  const unsatisfied: ObjectRef[] = [];
  const sourceRefs: ObjectRef[] = [];
  const reasons: string[] = [];
  let gate: DependencyGateResult = "SATISFIED";

  for (const edge of incoming) {
    const prerequisite = states.get(edge.from_node_ref.object_id);
    if (!prerequisite) {
      gate = "UNKNOWN";
      unsatisfied.push(edge.from_node_ref);
      reasons.push("PREREQUISITE_STATE_MISSING");
      continue;
    }
    if (prerequisite.source_state_ref) sourceRefs.push(prerequisite.source_state_ref);
    let satisfied = false;
    let waiting = false;
    let blocked = false;
    switch (edge.dependency_kind) {
      case "COMPLETION":
      case "ORDERING":
        satisfied = prerequisite.coordination_state === "COMPLETED";
        waiting = ["PENDING", "EVALUATING", "READY", "DISPATCH_REQUESTED", "RUNNING", "WAITING"].includes(prerequisite.coordination_state);
        blocked = ["BLOCKED", "FAILED", "CANCELLED", "INVALIDATED", "REVALIDATION_REQUIRED"].includes(prerequisite.coordination_state);
        break;
      case "SUCCESS":
        satisfied = prerequisite.coordination_state === "COMPLETED" && prerequisite.execution_result === "SUCCESS";
        waiting = prerequisite.coordination_state !== "COMPLETED" && !["FAILED", "CANCELLED", "BLOCKED"].includes(prerequisite.coordination_state);
        blocked = prerequisite.coordination_state === "FAILED" || prerequisite.coordination_state === "CANCELLED" || prerequisite.execution_result === "FAILURE";
        break;
      case "OUTPUT_AVAILABLE":
        satisfied = prerequisite.output_refs.length > 0;
        waiting = !satisfied && ["PENDING", "EVALUATING", "READY", "RUNNING", "WAITING"].includes(prerequisite.coordination_state);
        blocked = !satisfied && ["FAILED", "CANCELLED", "BLOCKED"].includes(prerequisite.coordination_state);
        break;
      case "APPROVAL_GRANTED":
        satisfied = prerequisite.approval_state === "GRANTED";
        waiting = prerequisite.approval_state === "PENDING" || prerequisite.approval_state === undefined;
        blocked = prerequisite.approval_state === "DENIED";
        break;
      case "CONDITION_SATISFIED":
        satisfied = prerequisite.condition_state === "SATISFIED";
        waiting = prerequisite.condition_state === undefined || prerequisite.condition_state === "UNKNOWN";
        blocked = prerequisite.condition_state === "UNSATISFIED";
        break;
    }
    if (!satisfied) {
      unsatisfied.push(edge.from_node_ref);
      if (blocked) {
        gate = "BLOCKED";
        reasons.push(`PREREQUISITE_BLOCKED:${edge.from_node_ref.object_id}`);
      } else if (waiting && gate !== "BLOCKED" && gate !== "UNKNOWN") {
        gate = "WAITING";
        reasons.push(`PREREQUISITE_PENDING:${edge.from_node_ref.object_id}`);
      } else if (!waiting && !blocked) {
        gate = "UNKNOWN";
        reasons.push(`PREREQUISITE_UNKNOWN:${edge.from_node_ref.object_id}`);
      }
    }
  }

  const state: NodeCoordinationState =
    gate === "SATISFIED" ? "READY" :
    gate === "WAITING" ? "WAITING" :
    gate === "BLOCKED" ? "BLOCKED" : "UNKNOWN";
  return ok({
    state,
    gate: {
      gate_ref: input.gate_ref,
      orchestration_ref: input.run.orchestration_ref,
      graph_revision_ref: input.run.graph_revision_ref,
      graph_node_ref: input.node.node_ref,
      result: gate,
      prerequisite_node_refs: prerequisiteRefs,
      unsatisfied_prerequisite_refs: unsatisfied,
      source_state_refs: sourceRefs,
      evaluated_at: input.evaluated_at,
      reason_codes: reasons,
      error_refs: [],
    },
  });
}

export function authorizeDispatch(input: DispatchGateInput): OrchestrationResult<void> {
  if (input.node_state !== "READY") return fail("INVALID_TRANSITION", "Only a READY node can be dispatched");
  if (!isObjectRef(input.authorization.decision_ref) || input.authorization.decision_ref.object_kind !== "AUTHORITY_DECISION") {
    return fail("VALIDATION_ERROR", "Dispatch requires an authoritative decision reference");
  }
  if (input.authorization.disposition === "DENIED" || input.authorization.disposition === "UNKNOWN") {
    return fail("FORBIDDEN", "Current action-time authorization does not permit dispatch");
  }
  if (input.authorization.disposition === "REQUIRES_APPROVAL") return fail("APPROVAL_REQUIRED", "Dispatch requires approval");
  if (input.authorization.disposition !== "ALLOWED") return fail("FORBIDDEN", "Dispatch requires an explicit ALLOWED authorization decision");
  if (!isObjectRef(input.capability.capability_ref) || typeof input.capability.version !== "string" ||
      !input.capability.version.trim() || !input.capability.eligible) {
    return fail("DEPENDENCY_UNAVAILABLE", "Target capability is unavailable or incompatible");
  }
  if (!isObjectRef(input.resource.admission_ref) || input.resource.admission_ref.object_kind !== "RESOURCE_ADMISSION") {
    return fail("VALIDATION_ERROR", "Dispatch requires a resource admission reference");
  }
  if (input.resource.state === "DENIED") return fail("RESOURCE_LIMIT", "Resource admission denied dispatch");
  if (input.resource.state === "DEFERRED" || input.resource.state === "UNKNOWN") {
    return fail("DEPENDENCY_UNAVAILABLE", "Resource admission is not yet confirmed");
  }
  if (input.resource.state !== "ADMITTED") return fail("DEPENDENCY_UNAVAILABLE", "Dispatch requires an explicit ADMITTED resource decision");
  return ok(undefined);
}

export function createDispatchAttempt(input: {
  context: RequestContext;
  run: OrchestrationRun;
  node: NodeCoordinationRecord;
  attempt_ref: ObjectRef;
  capability_ref: ObjectRef;
  capability_version: string;
  authorization_decision_ref: ObjectRef;
  resource_admission_ref: ObjectRef;
  authorization_disposition: "ALLOWED" | "DENIED" | "REQUIRES_APPROVAL" | "UNKNOWN";
  capability_eligible: boolean;
  resource_admission_state: ResourceAdmissionState;
  attempt_number: number;
  submitted_at: Timestamp;
}): OrchestrationResult<DispatchAttempt> {
  const dispatchGate = authorizeDispatch({
    node_state: input.node.state,
    authorization: {
      decision_ref: input.authorization_decision_ref,
      disposition: input.authorization_disposition,
    },
    capability: {
      capability_ref: input.capability_ref,
      version: input.capability_version,
      eligible: input.capability_eligible,
    },
    resource: {
      admission_ref: input.resource_admission_ref,
      state: input.resource_admission_state,
    },
  });
  if (!dispatchGate.ok) return { ok: false, issues: dispatchGate.issues };
  if (!isRequestContext(input.context) || !input.context.idempotency_key ||
      !isObjectRef(input.attempt_ref) || input.attempt_ref.object_kind !== "DISPATCH_ATTEMPT" ||
      !isObjectRef(input.capability_ref) || !isObjectRef(input.authorization_decision_ref) ||
      !isObjectRef(input.resource_admission_ref) || input.resource_admission_ref.object_kind !== "RESOURCE_ADMISSION" ||
      !Number.isSafeInteger(input.attempt_number) || input.attempt_number < 1 ||
      !input.capability_version.trim() || !isTimestamp(input.submitted_at)) {
    return fail("VALIDATION_ERROR", "Dispatch attempt identity, capability, gates, attempt number or timestamp is invalid");
  }
  if (input.run.state !== "RUNNING" || input.node.state !== "READY" ||
      !sameRef(input.node.orchestration_ref, input.run.orchestration_ref) ||
      !sameRef(input.node.graph_revision_ref, input.run.graph_revision_ref)) {
    return fail("INVALID_TRANSITION", "Dispatch must target a READY node in a RUNNING run pinned to this graph");
  }
  return ok({
    dispatch_ref: input.attempt_ref,
    orchestration_ref: input.run.orchestration_ref,
    node_coordination_ref: input.node.node_coordination_ref,
    work_ref: input.run.work_ref,
    graph_revision_ref: input.run.graph_revision_ref,
    graph_node_ref: input.node.graph_node_ref,
    target_capability_ref: input.capability_ref,
    target_capability_version: input.capability_version,
    state: "CREATED",
    attempt_number: input.attempt_number,
    idempotency_key: input.context.idempotency_key,
    request_correlation_id: input.context.correlation_id,
    authorization_decision_ref: input.authorization_decision_ref,
    resource_admission_ref: input.resource_admission_ref,
    error_refs: [],
    created_at: input.submitted_at,
    updated_at: input.submitted_at,
  });
}

export function decideRetry(input: {
  retry_decision_ref: ObjectRef;
  dispatch: DispatchAttempt;
  failure_classification: string;
  side_effect_class: SideEffectClass;
  retryable_failure: boolean;
  next_attempt_number: number;
  reconciliation_ref?: ObjectRef;
  decided_at: Timestamp;
}): OrchestrationResult<RetryDecision> {
  if (!isObjectRef(input.retry_decision_ref) || input.retry_decision_ref.object_kind !== "RETRY_DECISION" ||
      !isTimestamp(input.decided_at) || !input.failure_classification.trim()) {
    return fail("VALIDATION_ERROR", "Retry decision requires a valid reference, failure class and timestamp");
  }
  let disposition: RetryDisposition;
  let reason_code: string;
  if (input.side_effect_class === "UNKNOWN" || input.side_effect_class === "NON_IDEMPOTENT" || input.side_effect_class === "REVERSIBLE") {
    disposition = "RECONCILE_FIRST";
    reason_code = "SIDE_EFFECT_REQUIRES_RECONCILIATION";
  } else if (!input.retryable_failure) {
    disposition = "NO_RETRY";
    reason_code = "FAILURE_NOT_RETRYABLE";
  } else if (!Number.isSafeInteger(input.next_attempt_number) || input.next_attempt_number <= input.dispatch.attempt_number) {
    return fail("VALIDATION_ERROR", "Next attempt number must increase monotonically");
  } else {
    disposition = "RETRY_ALLOWED";
    reason_code = "RETRY_SAFE_UNDER_IDEMPOTENCY_CONTRACT";
  }
  return ok({
    retry_decision_ref: input.retry_decision_ref,
    dispatch_ref: input.dispatch.dispatch_ref,
    disposition,
    reason_code,
    failure_classification: input.failure_classification,
    side_effect_class: input.side_effect_class,
    ...(disposition === "RETRY_ALLOWED" ? { next_attempt_number: input.next_attempt_number } : {}),
    ...(input.reconciliation_ref ? { reconciliation_ref: input.reconciliation_ref } : {}),
    decided_at: input.decided_at,
  });
}

export function transitionNodeCoordination(input: {
  node: NodeCoordinationRecord;
  expected_state_version: RevisionNumber;
  target_state: NodeCoordinationState;
  occurred_at: Timestamp;
}): OrchestrationResult<NodeCoordinationRecord> {
  if (input.expected_state_version !== input.node.state_version) return fail("VERSION_CONFLICT", "Node coordination version is stale");
  if (!isTimestamp(input.occurred_at)) return fail("VALIDATION_ERROR", "Node transition timestamp is invalid");
  const allowed: Record<NodeCoordinationState, readonly NodeCoordinationState[]> = {
    PENDING: ["EVALUATING", "CANCELLED", "INVALIDATED", "REVALIDATION_REQUIRED"],
    EVALUATING: ["READY", "WAITING", "BLOCKED", "UNKNOWN", "CANCELLED"],
    READY: ["DISPATCH_REQUESTED", "WAITING", "BLOCKED", "CANCELLED", "INVALIDATED"],
    DISPATCH_REQUESTED: ["RUNNING", "WAITING", "FAILED", "UNKNOWN", "RECONCILIATION_REQUIRED", "CANCELLED"],
    WAITING: ["EVALUATING", "READY", "BLOCKED", "CANCELLED", "RECONCILIATION_REQUIRED"],
    BLOCKED: ["EVALUATING", "READY", "CANCELLED", "INVALIDATED"],
    RUNNING: ["COMPLETED", "FAILED", "UNKNOWN", "CANCELLED", "RECONCILIATION_REQUIRED"],
    COMPLETED: ["INVALIDATED", "REVALIDATION_REQUIRED"],
    FAILED: ["RECONCILIATION_REQUIRED", "INVALIDATED"],
    UNKNOWN: ["RECONCILIATION_REQUIRED", "CANCELLED"],
    CANCELLED: [],
    INVALIDATED: ["REVALIDATION_REQUIRED"],
    REVALIDATION_REQUIRED: ["EVALUATING", "CANCELLED"],
    RECONCILIATION_REQUIRED: ["EVALUATING", "WAITING", "FAILED", "UNKNOWN", "CANCELLED"],
  };
  if (!allowed[input.node.state].includes(input.target_state)) {
    return fail("INVALID_TRANSITION", `Node cannot transition from ${input.node.state} to ${input.target_state}`);
  }
  return ok({
    ...input.node,
    state: input.target_state,
    state_version: input.node.state_version + 1,
    last_transition_at: input.occurred_at,
    updated_at: input.occurred_at,
  });
}
