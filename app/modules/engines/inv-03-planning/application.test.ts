import { describe, expect, it } from "vitest";
import {
  createOperationError,
  createOperationResult,
  type AppendOnlyRepository,
  type DomainEventEnvelope,
  type EngineTransaction,
  type EngineUnitOfWorkPort,
  type IdempotencyRecord,
  type ObjectRef,
  type OperationResult,
  type RequestContext,
  type VersionedRepository,
} from "../shared";
import {
  requestGraphActivation,
  reviewPlanRevision,
  submitGraphRevision,
  submitPlanRevision,
  validateAndRecordGraph,
} from "./application";
import type {
  PlanRecord,
  PlanRevision,
  WorkGraphRecord,
  WorkGraphRevision,
} from "./domain";

const scope = { scope_id: "scope-1", scope_kind: "WORK" as const };
const context = (request_id: string, idempotency_key: string, correlation_id: string): RequestContext => ({
  request_id,
  correlation_id,
  actor_ref: { principal_id: "user-1", principal_kind: "USER" },
  scope_ref: scope,
  issued_at: "2026-11-14T01:00:00Z",
  idempotency_key,
});
const ref = (object_kind: string, object_id: string, object_version = "1"): ObjectRef => ({
  object_kind,
  object_id,
  object_version,
  scope_ref: scope,
});
const workRef = ref("WORK", "work-1");
const planRef = ref("PLAN", "plan-1");
const planRevisionRef = ref("PLAN_REVISION", "plan-r1");
const stepRef = ref("PLAN_STEP_PROPOSAL", "step-1");
const graphRef = ref("WORK_GRAPH", "graph-1");
const graphRevisionRef = ref("WORK_GRAPH_REVISION", "graph-r1");
const fingerprint = (value: string) => value.repeat(64).slice(0, 64);

function makeUnitOfWork() {
  type Stored = { value: unknown; version: string };
  const versioned = new Map<string, Map<string, Stored>>();
  const appendOnly = new Map<string, unknown[]>();
  const idempotency = new Map<string, IdempotencyRecord<unknown>>();
  const events: DomainEventEnvelope[] = [];

  const recordsFor = (key: string) => {
    let records = versioned.get(key);
    if (!records) {
      records = new Map<string, Stored>();
      versioned.set(key, records);
    }
    return records;
  };
  const appendOnlyFor = (key: string) => {
    let records = appendOnly.get(key);
    if (!records) {
      records = [];
      appendOnly.set(key, records);
    }
    return records;
  };

  const repository = <T>(key: string): VersionedRepository<T> => ({
    get: async (_ctx, objectRef) => {
      const stored = recordsFor(key).get(objectRef.object_id);
      return stored
        ? createOperationResult({
            status: "OK",
            correlation_id: "corr-test",
            data: stored.value as T,
            object_version: stored.version,
          })
        : createOperationResult<T>({
            status: "REJECTED",
            correlation_id: "corr-test",
            errors: [createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Record was not found")],
          });
    },
    create: async (_ctx, objectRef, value) => {
      const records = recordsFor(key);
      if (records.has(objectRef.object_id)) {
        return createOperationResult<T>({
          status: "REJECTED",
          correlation_id: "corr-test",
          errors: [createOperationError("VERSION_CONFLICT", "Record already exists")],
        });
      }
      const version = objectRef.object_version ?? "1";
      records.set(objectRef.object_id, { value, version });
      return createOperationResult({
        status: "OK",
        correlation_id: "corr-test",
        data: value,
        object_version: version,
      });
    },
    update: async (_ctx, objectRef, expectedVersion, value) => {
      const records = recordsFor(key);
      const current = records.get(objectRef.object_id);
      if (!current) {
        return createOperationResult<T>({
          status: "REJECTED",
          correlation_id: "corr-test",
          errors: [createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Record was not found")],
        });
      }
      if (current.version !== expectedVersion) {
        return createOperationResult<T>({
          status: "REJECTED",
          correlation_id: "corr-test",
          errors: [createOperationError("VERSION_CONFLICT", "Record version changed")],
        });
      }
      const nextVersion = String(Number(current.version) + 1);
      records.set(objectRef.object_id, { value, version: nextVersion });
      return createOperationResult({
        status: "OK",
        correlation_id: "corr-test",
        data: value,
        object_version: nextVersion,
      });
    },
  });

  const appendRepository = <T>(key: string): AppendOnlyRepository<T> => ({
    append: async (_ctx, value) => {
      appendOnlyFor(key).push(value);
      return createOperationResult({
        status: "OK",
        correlation_id: "corr-test",
        data: value,
      });
    },
    get: async () =>
      createOperationResult<T>({
        status: "REJECTED",
        correlation_id: "corr-test",
        errors: [createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Append-only record was not found")],
      }),
  });

  const transaction: EngineTransaction = {
    repository: <T>(key: string) => repository<T>(key),
    appendOnly: <T>(key: string) => appendRepository<T>(key),
    idempotency: {
      get: async <T>(_ctx: RequestContext, key: string) => {
        const value = idempotency.get(key) as IdempotencyRecord<T> | undefined;
        return createOperationResult({
          status: "OK",
          correlation_id: "corr-test",
          data: value ?? null,
        });
      },
      record: async <T>(_ctx: RequestContext, record: IdempotencyRecord<T>) => {
        idempotency.set(record.idempotency_key, record as IdempotencyRecord<unknown>);
        return createOperationResult({
          status: "OK",
          correlation_id: "corr-test",
          data: record,
        });
      },
    },
    outbox: {
      append: async (_ctx, event) => {
        events.push(event);
        return createOperationResult({
          status: "OK",
          correlation_id: "corr-test",
          data: { event_id: event.event_id },
        });
      },
    },
  };

  const unitOfWork: EngineUnitOfWorkPort = {
    execute: async <T>(
      _ctx: RequestContext,
      operation: (transaction: EngineTransaction) => Promise<OperationResult<T>>,
    ) => operation(transaction),
  };

  return {
    unitOfWork,
    events,
    idempotency,
    read<T>(key: string, object_id: string): T | undefined {
      return recordsFor(key).get(object_id)?.value as T | undefined;
    },
    version(key: string, object_id: string): string | undefined {
      return recordsFor(key).get(object_id)?.version;
    },
    seed<T>(key: string, object_id: string, value: T, version = "1") {
      recordsFor(key).set(object_id, { value, version });
    },
    appended<T>(key: string): T[] {
      return appendOnlyFor(key) as T[];
    },
  };
}

const planInput = {
  plan_ref: planRef,
  plan_revision_ref: planRevisionRef,
  work_ref: workRef,
  intent_ref: ref("INTENT", "intent-1"),
  desired_outcome_ref: ref("WORK_DESIRED_OUTCOME_REVISION", "target-1"),
  revision_number: 1,
  strategy_summary: "Build and verify a customer portal",
  step_proposals: [{
    step_proposal_ref: stepRef,
    title: "Build the portal",
    purpose: "Create the user-facing portal",
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
  created_at: "2026-11-14T01:00:01Z",
};

async function acceptPlan(
  state: ReturnType<typeof makeUnitOfWork>,
  revision: PlanRevision,
  suffix: string,
) {
  const underReview = await reviewPlanRevision(state.unitOfWork, {
    context: context(`req-${suffix}-review`, `idem-${suffix}-review`, `corr-${suffix}-review`),
    plan_revision_ref: revision.plan_revision_ref,
    expected_revision_version: "1",
    target_state: "UNDER_REVIEW",
    occurred_at: "2026-11-14T01:00:02Z",
    request_fingerprint: fingerprint("7"),
    event_ref: ref("DOMAIN_EVENT", `event-${suffix}-review`),
  });
  if (underReview.status !== "OK" || !underReview.object_version) {
    throw new Error(underReview.errors[0]?.safe_message ?? "Plan did not enter review");
  }

  return reviewPlanRevision(state.unitOfWork, {
    context: context(`req-${suffix}-accept`, `idem-${suffix}-accept`, `corr-${suffix}-accept`),
    plan_revision_ref: revision.plan_revision_ref,
    expected_revision_version: underReview.object_version,
    target_state: "ACCEPTED",
    review_decision_ref: ref("PLAN_REVIEW_DECISION", `decision-${suffix}`),
    occurred_at: "2026-11-14T01:00:03Z",
    request_fingerprint: fingerprint("8"),
    event_ref: ref("DOMAIN_EVENT", `event-${suffix}-accept`),
  });
}

const graphNode = {
  node_ref: ref("GRAPH_NODE", "node-1"),
  graph_ref: graphRef,
  node_kind: "WORK_STEP" as const,
  title: "Build portal",
  description: "Implement the portal",
  plan_step_proposal_ref: stepRef,
  requirement_refs: [],
  input_refs: [],
  capability_requirement_refs: [],
  expected_output_refs: [],
  acceptance_criteria_refs: [],
  constraint_refs: [],
};

describe("INV-03 Planning application services", () => {
  it("submits a Plan revision, advances the Plan pointer and supersedes its prior revision", async () => {
    const state = makeUnitOfWork();
    const first = await submitPlanRevision(state.unitOfWork, {
      ...planInput,
      context: context("req-plan-1", "idem-plan-1", "corr-plan-1"),
      request_fingerprint: fingerprint("a"),
      event_ref: ref("DOMAIN_EVENT", "event-plan-1"),
    });
    expect(first.status).toBe("OK");
    expect(state.version("inv-03.plans", "plan-1")).toBe("1");

    const accepted = await acceptPlan(state, first.data!, "prior-plan");
    expect(accepted.status).toBe("OK");
    expect(state.read<PlanRevision>("inv-03.plan-revisions", "plan-r1")?.state).toBe("ACCEPTED");
    // Review transitions increment the stored version while the revision
    // reference itself continues to identify the same immutable Plan revision.
    expect(state.version("inv-03.plan-revisions", "plan-r1")).toBe("3");

    const second = await submitPlanRevision(state.unitOfWork, {
      ...planInput,
      context: context("req-plan-2", "idem-plan-2", "corr-plan-2"),
      plan_revision_ref: ref("PLAN_REVISION", "plan-r2"),
      revision_number: 2,
      prior_revision_ref: planRevisionRef,
      change_reason: "Refine delivery sequence",
      expected_plan_version: "1",
      request_fingerprint: fingerprint("b"),
      event_ref: ref("DOMAIN_EVENT", "event-plan-2"),
    });

    expect(second.status).toBe("OK");
    expect(second.data?.revision_number).toBe(2);
    expect(state.read<PlanRevision>("inv-03.plan-revisions", "plan-r1")?.state).toBe("SUPERSEDED");
    expect(state.read<PlanRecord>("inv-03.plans", "plan-1")?.latest_revision_ref.object_id).toBe("plan-r2");
    expect(state.version("inv-03.plans", "plan-1")).toBe("2");
    expect(state.events.map((event) => event.event_type)).toEqual([
      "planning.plan_revision_submitted",
      "planning.plan_revision_state_changed",
      "planning.plan_revision_state_changed",
      "planning.plan_revision_submitted",
    ]);
  });

  it("submits, validates and requests activation of a Graph using latest accepted Plan lineage", async () => {
    const state = makeUnitOfWork();
    const planResult = await submitPlanRevision(state.unitOfWork, {
      ...planInput,
      context: context("req-plan", "idem-plan", "corr-plan"),
      request_fingerprint: fingerprint("c"),
      event_ref: ref("DOMAIN_EVENT", "event-plan"),
    });
    expect(planResult.status).toBe("OK");
    const accepted = await acceptPlan(state, planResult.data!, "activation-plan");
    expect(accepted.status).toBe("OK");
    const acceptedPlan = state.read<PlanRevision>("inv-03.plan-revisions", "plan-r1")!;
    const graphResult = await submitGraphRevision(state.unitOfWork, {
      context: context("req-graph", "idem-graph", "corr-graph"),
      graph_ref: graphRef,
      graph_revision_ref: graphRevisionRef,
      work_ref: workRef,
      source_plan_revision_ref: planRevisionRef,
      revision_number: 1,
      nodes: [graphNode],
      edges: [],
      change_reason: "Create initial execution graph",
      created_at: "2026-11-14T01:00:02Z",
      expected_plan_version: "1",
      request_fingerprint: fingerprint("d"),
      event_ref: ref("DOMAIN_EVENT", "event-graph"),
    });
    expect(graphResult.status).toBe("OK");

    const validationResult = await validateAndRecordGraph(state.unitOfWork, {
      context: context("req-validate", "idem-validate", "corr-validate"),
      graph_revision_ref: graphRevisionRef,
      expected_graph_version: "1",
      validation_ref: ref("GRAPH_VALIDATION_RESULT", "validation-1"),
      validator_version: "1.0.0",
      max_nodes: 100,
      max_edges: 100,
      validated_at: "2026-11-14T01:00:03Z",
      request_fingerprint: fingerprint("e"),
      event_ref: ref("DOMAIN_EVENT", "event-validated"),
    });
    expect(validationResult.status).toBe("OK");
    expect(validationResult.data?.activation_eligible).toBe(true);
    expect(validationResult.data?.graph_revision.state).toBe("VALIDATED");
    expect(state.appended("inv-03.graph-validation-results")).toHaveLength(1);

    const activation = await requestGraphActivation(state.unitOfWork, {
      context: context("req-activate", "idem-activate", "corr-activate"),
      request_ref: ref("GRAPH_ACTIVATION_REQUEST", "activation-1"),
      work_ref: workRef,
      plan_revision: acceptedPlan,
      graph_revision: validationResult.data!.graph_revision,
      expected_work_revision: 3,
      approval_refs: [],
      requested_at: "2026-11-14T01:00:04Z",
      expected_plan_version: "1",
      expected_graph_version: "1",
      request_fingerprint: fingerprint("f"),
      event_ref: ref("DOMAIN_EVENT", "event-activation"),
    });

    expect(activation.status).toBe("OK");
    expect(activation.data?.plan_revision_ref.object_id).toBe("plan-r1");
    expect(activation.data?.graph_revision_ref.object_id).toBe("graph-r1");
    expect(state.appended("inv-03.graph-activation-requests")).toHaveLength(1);
    expect(state.events.at(-1)?.event_type).toBe("planning.graph_activation_requested");
  });

  it("rejects a graph whose source Plan is no longer current", async () => {
    const state = makeUnitOfWork();
    const planResult = await submitPlanRevision(state.unitOfWork, {
      ...planInput,
      context: context("req-plan", "idem-plan-current", "corr-plan"),
      request_fingerprint: fingerprint("1"),
      event_ref: ref("DOMAIN_EVENT", "event-plan-current"),
    });
    expect(planResult.status).toBe("OK");

    const graphResult = await submitGraphRevision(state.unitOfWork, {
      context: context("req-graph", "idem-graph-stale", "corr-graph"),
      graph_ref: graphRef,
      graph_revision_ref: graphRevisionRef,
      work_ref: workRef,
      source_plan_revision_ref: planRevisionRef,
      revision_number: 1,
      nodes: [graphNode],
      edges: [],
      change_reason: "Use an outdated draft Plan",
      created_at: "2026-11-14T01:00:02Z",
      expected_plan_version: "1",
      request_fingerprint: fingerprint("2"),
      event_ref: ref("DOMAIN_EVENT", "event-graph-stale"),
    });

    expect(graphResult.status).toBe("REJECTED");
    expect(state.read<WorkGraphRecord>("inv-03.work-graphs", "graph-1")).toBeUndefined();
    expect(state.events).toHaveLength(1);
  });
});
