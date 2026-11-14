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
  applyRequestedPlanGraphActivation,
  getActivePlanGraphBinding,
} from "./application";
import { graphActivationCandidateReader } from "../inv-03-planning/application";
import { createWork, type WorkRecord } from "./domain";
import type {
  GraphActivationRequest,
  PlanRecord,
  PlanRevision,
  WorkGraphRecord,
  WorkGraphRevision,
} from "../inv-03-planning/domain";

const scope = { scope_id: "scope-activation", scope_kind: "WORK" as const };
const ref = (object_kind: string, object_id: string, object_version = "1"): ObjectRef => ({
  object_kind,
  object_id,
  object_version,
  scope_ref: scope,
});
const context = (idempotency_key?: string): RequestContext => ({
  request_id: "req-bind-1",
  correlation_id: "corr-bind-1",
  actor_ref: { principal_id: "user-1", principal_kind: "USER" },
  scope_ref: scope,
  issued_at: "2026-11-14T02:00:00Z",
  ...(idempotency_key ? { idempotency_key } : {}),
});
const fingerprint = "a".repeat(64);

function makeState() {
  type Stored = { value: unknown; version: string };
  const versioned = new Map<string, Map<string, Stored>>();
  const appendOnly = new Map<string, Map<string, unknown>>();
  const idempotency = new Map<string, IdempotencyRecord<unknown>>();
  const events: DomainEventEnvelope[] = [];
  let failurePoint: string | undefined;
  const maybeFail = <T>(point: string): OperationResult<T> | undefined => {
    if (failurePoint !== point) return undefined;
    failurePoint = undefined;
    return createOperationResult<T>({status:"REJECTED",correlation_id:"corr-bind-1",errors:[createOperationError("INTERNAL_ERROR","Injected transactional failure")]});
  };

  const versionedRecords = (key: string) => {
    let values = versioned.get(key);
    if (!values) {
      values = new Map<string, Stored>();
      versioned.set(key, values);
    }
    return values;
  };
  const appendRecords = (key: string) => {
    let values = appendOnly.get(key);
    if (!values) {
      values = new Map<string, unknown>();
      appendOnly.set(key, values);
    }
    return values;
  };
  const repository = <T>(key: string): VersionedRepository<T> => ({
    get: async (_ctx, object_ref) => {
      const stored = versionedRecords(key).get(object_ref.object_id);
      return stored
        ? createOperationResult({
            status: "OK",
            correlation_id: "corr-bind-1",
            data: stored.value as T,
            object_version: stored.version,
          })
        : createOperationResult<T>({
            status: "REJECTED",
            correlation_id: "corr-bind-1",
            errors: [createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Record was not found")],
          });
    },
    create: async (_ctx, object_ref, value) => {
      const records = versionedRecords(key);
      if (records.has(object_ref.object_id)) {
        return createOperationResult<T>({
          status: "REJECTED",
          correlation_id: "corr-bind-1",
          errors: [createOperationError("VERSION_CONFLICT", "Record already exists")],
        });
      }
      const version = object_ref.object_version ?? "1";
      records.set(object_ref.object_id, { value, version });
      return createOperationResult({
        status: "OK",
        correlation_id: "corr-bind-1",
        data: value,
        object_version: version,
      });
    },
    update: async (_ctx, object_ref, expected_version, value) => {
      const records = versionedRecords(key);
      const stored = records.get(object_ref.object_id);
      if (!stored) {
        return createOperationResult<T>({
          status: "REJECTED",
          correlation_id: "corr-bind-1",
          errors: [createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Record was not found")],
        });
      }
      if (stored.version !== expected_version) {
        return createOperationResult<T>({
          status: "REJECTED",
          correlation_id: "corr-bind-1",
          errors: [createOperationError("VERSION_CONFLICT", "Record version changed")],
        });
      }
      const next_version = String(Number(stored.version) + 1);
      records.set(object_ref.object_id, { value, version: next_version });
      return createOperationResult({
        status: "OK",
        correlation_id: "corr-bind-1",
        data: value,
        object_version: next_version,
      });
    },
  });

  const appendOnlyRepository = <T>(key: string): AppendOnlyRepository<T> => ({
    append: async (_ctx, value) => {
      const injected = maybeFail<T>(`append:${key}`);
      if (injected) return injected;
      const item = value as unknown as Record<string, unknown>;
      const object_ref = (item.request_ref ?? item.receipt_ref ?? item.revision_ref) as ObjectRef | undefined;
      if (!object_ref) throw new Error(`Append-only item for ${key} has no stable object reference`);
      const records = appendRecords(key);
      if (records.has(object_ref.object_id)) {
        return createOperationResult<T>({
          status: "REJECTED",
          correlation_id: "corr-bind-1",
          errors: [createOperationError("VERSION_CONFLICT", "Append-only record already exists")],
        });
      }
      records.set(object_ref.object_id, value);
      return createOperationResult({
        status: "OK",
        correlation_id: "corr-bind-1",
        data: value,
      });
    },
    get: async (_ctx, object_ref) => {
      const stored = appendRecords(key).get(object_ref.object_id);
      return stored
        ? createOperationResult({
            status: "OK",
            correlation_id: "corr-bind-1",
            data: stored as T,
          })
        : createOperationResult<T>({
            status: "REJECTED",
            correlation_id: "corr-bind-1",
            errors: [createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Append-only record was not found")],
          });
    },
  });

  const transaction: EngineTransaction = {
    repository: <T>(key: string) => repository<T>(key),
    appendOnly: <T>(key: string) => appendOnlyRepository<T>(key),
    idempotency: {
      get: async <T>(_ctx: RequestContext, key: string) => {
        const value = idempotency.get(key) as IdempotencyRecord<T> | undefined;
        return createOperationResult({
          status: "OK",
          correlation_id: "corr-bind-1",
          data: value ?? null,
        });
      },
      record: async <T>(_ctx: RequestContext, value: IdempotencyRecord<T>) => {
        const injected = maybeFail<IdempotencyRecord<T>>("idempotency.record");
        if (injected) return injected;
        idempotency.set(value.idempotency_key, value as IdempotencyRecord<unknown>);
        return createOperationResult({
          status: "OK",
          correlation_id: "corr-bind-1",
          data: value,
        });
      },
    },
    outbox: {
      append: async (_ctx, event) => {
        const injected = maybeFail<{ event_id: string }>("outbox.append");
        if (injected) return injected;
        events.push(event);
        return createOperationResult({
          status: "OK",
          correlation_id: "corr-bind-1",
          data: { event_id: event.event_id },
        });
      },
    },
  };
  const cloneNestedMap = <T>(source: Map<string, Map<string, T>>) => new Map([...source.entries()].map(([key, records]) => [key, new Map(records)]));
  const restoreNestedMap = <T>(target: Map<string, Map<string, T>>, snapshot: Map<string, Map<string, T>>) => {
    target.clear();
    for (const [key, records] of snapshot) target.set(key, new Map(records));
  };
  const unitOfWork: EngineUnitOfWorkPort = {
    execute: async <T>(_ctx: RequestContext, operation: (tx: EngineTransaction) => Promise<OperationResult<T>>) => {
      const versionedSnapshot=cloneNestedMap(versioned), appendOnlySnapshot=cloneNestedMap(appendOnly);
      const idempotencySnapshot=new Map(idempotency), eventsSnapshot=[...events];
      const rollback=()=>{
        restoreNestedMap(versioned,versionedSnapshot); restoreNestedMap(appendOnly,appendOnlySnapshot);
        idempotency.clear(); for(const [key,value] of idempotencySnapshot) idempotency.set(key,value);
        events.splice(0,events.length,...eventsSnapshot);
      };
      try {
        const result=await operation(transaction);
        if(result.status==="REJECTED"||result.status==="UNKNOWN") rollback();
        return result;
      } catch(error) { rollback(); throw error; }
    },
  };

  return {
    unitOfWork,
    events,
    failAt(point: string) { failurePoint = point; },
    idempotencyCount() { return idempotency.size; },
    versionedRecords,
    appendRecords,
    seed<T>(key: string, object_id: string, value: T, version = "1") {
      versionedRecords(key).set(object_id, { value, version });
    },
    seedAppend<T>(key: string, object_id: string, value: T) {
      appendRecords(key).set(object_id, value);
    },
    read<T>(key: string, object_id: string): T | undefined {
      return versionedRecords(key).get(object_id)?.value as T | undefined;
    },
    appended<T>(key: string): T[] {
      return [...appendRecords(key).values()] as T[];
    },
  };
}

function makeFixture(approval_refs: ObjectRef[] = []) {
  const state = makeState();
  const requestContext = context("idem-work-created");
  const created = createWork({
    context: requestContext,
    work_ref: ref("WORK", "work-1"),
    origin_intent_ref: ref("INTENT", "intent-1"),
    owner_ref: ref("USER", "user-1"),
    title: "Build a customer portal",
    summary: "Create and verify a customer-facing portal",
    created_at: "2026-11-14T02:00:01Z",
  });
  if (!created.ok) throw new Error(created.issues[0].safe_message);
  const work: WorkRecord = created.value;

  const plan_ref = ref("PLAN", "plan-1");
  const plan_revision_ref = ref("PLAN_REVISION", "plan-r1");
  const graph_ref = ref("WORK_GRAPH", "graph-1");
  const graph_revision_ref = ref("WORK_GRAPH_REVISION", "graph-r1");
  const request_ref = ref("GRAPH_ACTIVATION_REQUEST", "activation-request-1");

  const plan_revision: PlanRevision = {
    plan_revision_ref,
    plan_ref,
    work_ref: work.work_ref,
    revision_number: 1,
    intent_ref: work.origin_intent_ref,
    desired_outcome_ref: ref("WORK_DESIRED_OUTCOME_REVISION", "target-1"),
    strategy_summary: "Build and verify the portal",
    step_proposals: [],
    assumptions: [],
    non_goals: [],
    constraint_refs: [],
    capability_requirement_refs: [],
    proposed_by: requestContext.actor_ref,
    state: "ACCEPTED",
    review_decision_ref: ref("PLAN_REVIEW_DECISION", "plan-review-1"),
    created_at: "2026-11-14T02:00:02Z",
  };
  const plan_record: PlanRecord = {
    plan_ref,
    work_ref: work.work_ref,
    created_by: requestContext.actor_ref,
    created_at: "2026-11-14T02:00:02Z",
    latest_revision_ref: plan_revision_ref,
  };
  const graph_revision: WorkGraphRevision = {
    graph_revision_ref,
    graph_ref,
    work_ref: work.work_ref,
    revision_number: 1,
    source_plan_revision_ref: plan_revision_ref,
    nodes: [],
    edges: [],
    change_reason: "Initial graph",
    affected_node_refs: [],
    preserved_node_refs: [],
    invalidated_node_refs: [],
    revalidation_required_node_refs: [],
    state: "VALIDATED",
    validation_result_ref: ref("GRAPH_VALIDATION_RESULT", "graph-validation-1"),
    author_ref: requestContext.actor_ref,
    created_at: "2026-11-14T02:00:03Z",
  };
  const graph_record: WorkGraphRecord = {
    graph_ref,
    work_ref: work.work_ref,
    created_by: requestContext.actor_ref,
    created_at: "2026-11-14T02:00:03Z",
    latest_revision_ref: graph_revision_ref,
  };
  const activation_request: GraphActivationRequest = {
    request_ref,
    work_ref: work.work_ref,
    plan_revision_ref,
    graph_revision_ref,
    expected_work_revision: 1,
    approval_refs,
    idempotency_key: "idem-planning-activation",
    requested_at: "2026-11-14T02:00:04Z",
  };

  state.seed("inv-02.works", "work-1", work, "1");
  state.seed("inv-03.plan-revisions", "plan-r1", plan_revision, "1");
  state.seed("inv-03.plans", "plan-1", plan_record, "1");
  state.seed("inv-03.graph-revisions", "graph-r1", graph_revision, "1");
  state.seed("inv-03.work-graphs", "graph-1", graph_record, "1");
  state.seedAppend("inv-03.graph-activation-requests", "activation-request-1", activation_request);

  const command = {
    context: context("idem-bind-1"),
    request_ref,
    receipt_ref: ref("PLAN_GRAPH_ACTIVATION_RECEIPT", "activation-receipt-1"),
    received_at: "2026-11-14T02:00:05Z",
    request_fingerprint: fingerprint,
    event_ref: ref("DOMAIN_EVENT", "event-binding-1"),
  };
  return { state, work, activation_request, command };
}

describe("INV-02 Plan/Graph activation application", () => {
  it("consumes an INV-03 request and atomically records the authoritative Work binding", async () => {
    const { state, command } = makeFixture();
    const result = await applyRequestedPlanGraphActivation(state.unitOfWork, graphActivationCandidateReader, command);

    expect(result.status).toBe("OK");
    expect(result.data?.current_revision).toBe(2);
    expect(result.data?.current_plan_ref?.object_id).toBe("plan-r1");
    expect(result.data?.current_work_graph_ref?.object_id).toBe("graph-r1");
    expect(state.read<WorkRecord>("inv-02.works", "work-1")?.current_revision).toBe(2);
    expect(state.appended("inv-02.work-revisions")).toHaveLength(1);
    const receipts = state.appended<{
      request_ref: ObjectRef;
      resulting_work_revision: number;
      receipt_state: string;
    }>("inv-02.plan-graph-activation-receipts");
    expect(receipts).toHaveLength(1);
    expect(receipts[0].request_ref.object_id).toBe("activation-request-1");
    expect(receipts[0].resulting_work_revision).toBe(2);
    expect(receipts[0].receipt_state).toBe("ACCEPTED");
    expect(state.events.map((event) => event.event_type)).toEqual([
      "work.plan_graph_binding_activated",
    ]);

    const replay = await applyRequestedPlanGraphActivation(state.unitOfWork, graphActivationCandidateReader, command);
    expect(replay.status).toBe("OK");
    expect(state.appended("inv-02.work-revisions")).toHaveLength(1);
    expect(state.appended("inv-02.plan-graph-activation-receipts")).toHaveLength(1);
    expect(state.events).toHaveLength(1);
  });


  it.each(["append:inv-02.work-revisions","append:inv-02.plan-graph-activation-receipts","outbox.append","idempotency.record"])(
    "rolls back every Work/receipt/event/idempotency write when %s fails",
    async (failurePoint) => {
      const {state,command}=makeFixture();
      state.failAt(failurePoint);
      const result=await applyRequestedPlanGraphActivation(state.unitOfWork,graphActivationCandidateReader,command);
      expect(result.status).toBe("REJECTED");
      expect(state.read<WorkRecord>("inv-02.works","work-1")?.current_revision).toBe(1);
      expect(state.appended("inv-02.work-revisions")).toHaveLength(0);
      expect(state.appended("inv-02.plan-graph-activation-receipts")).toHaveLength(0);
      expect(state.events).toHaveLength(0);
      expect(state.idempotencyCount()).toBe(0);
    },
  );

  it("does not bind a request that carries unverified approval references", async () => {
    const { state, command } = makeFixture([ref("APPROVAL", "approval-1")]);
    const result = await applyRequestedPlanGraphActivation(state.unitOfWork, graphActivationCandidateReader, command);

    expect(result.status).toBe("REJECTED");
    expect(result.errors[0]?.code).toBe("APPROVAL_REQUIRED");
    expect(state.read<WorkRecord>("inv-02.works", "work-1")?.current_revision).toBe(1);
    expect(state.appended("inv-02.work-revisions")).toHaveLength(0);
    expect(state.appended("inv-02.plan-graph-activation-receipts")).toHaveLength(0);
  });

  it("does not activate a Graph after its latest-revision pointer has moved", async () => {
    const { state, command } = makeFixture();
    const currentGraphRecord = state.read<WorkGraphRecord>("inv-03.work-graphs", "graph-1")!;
    state.seed("inv-03.work-graphs", "graph-1", {
      ...currentGraphRecord,
      latest_revision_ref: ref("WORK_GRAPH_REVISION", "graph-r2"),
    }, "2");

    const result = await applyRequestedPlanGraphActivation(state.unitOfWork, graphActivationCandidateReader, command);
    expect(result.status).toBe("REJECTED");
    expect(result.errors[0]?.code).toBe("VERSION_CONFLICT");
    expect(state.read<WorkRecord>("inv-02.works", "work-1")?.current_revision).toBe(1);
    expect(state.appended("inv-02.work-revisions")).toHaveLength(0);
  });

  it("reads the current active binding from Work rather than inferring it from readiness", async () => {
    const { state, command } = makeFixture();
    const before = await getActivePlanGraphBinding(
      state.unitOfWork,
      graphActivationCandidateReader,
      context(),
      ref("WORK", "work-1"),
    );
    expect(before.status).toBe("OK");
    expect(before.data?.binding_state).toBe("UNBOUND");

    await applyRequestedPlanGraphActivation(state.unitOfWork, graphActivationCandidateReader, command);
    const after = await getActivePlanGraphBinding(
      state.unitOfWork,
      graphActivationCandidateReader,
      context(),
      ref("WORK", "work-1"),
    );
    expect(after.status).toBe("OK");
    expect(after.data?.binding_state).toBe("BOUND");
    expect(after.data?.work_revision).toBe(2);
    expect(after.data?.plan_revision_ref?.object_id).toBe("plan-r1");
    expect(after.data?.graph_revision_ref?.object_id).toBe("graph-r1");
  });

  it("keeps the Work binding authoritative when a later planning revision is prepared", async () => {
    const { state, command } = makeFixture();
    await applyRequestedPlanGraphActivation(state.unitOfWork, graphActivationCandidateReader, command);
    const plan = state.read<PlanRevision>("inv-03.plan-revisions", "plan-r1")!;
    const graph = state.read<WorkGraphRevision>("inv-03.graph-revisions", "graph-r1")!;
    state.seed("inv-03.plan-revisions", "plan-r1", { ...plan, state: "SUPERSEDED" }, "2");
    state.seed("inv-03.graph-revisions", "graph-r1", { ...graph, state: "SUPERSEDED" }, "2");

    const binding = await getActivePlanGraphBinding(
      state.unitOfWork,
      graphActivationCandidateReader,
      context(),
      ref("WORK", "work-1"),
    );
    expect(binding.status).toBe("OK");
    expect(binding.data?.binding_state).toBe("BOUND");
  });
});
