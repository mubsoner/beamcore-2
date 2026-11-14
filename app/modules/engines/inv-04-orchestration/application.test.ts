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
import type { WorkRecord } from "../inv-02-work/domain";
import type { GraphActivationReceipt, GraphNode, WorkGraphRevision } from "../inv-03-planning/domain";
import { submitPlan, type SubmitPlanCommand } from "./application";

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
const fingerprint = (value: string) => value.repeat(64).slice(0, 64);

function makeFixtures() {
  const work_ref = ref("WORK", "work-1");
  const plan_revision_ref = ref("PLAN_REVISION", "plan-r1");
  const graph_ref = ref("WORK_GRAPH", "graph-1");
  const graph_revision_ref = ref("WORK_GRAPH_REVISION", "graph-r1");
  const nodeA: GraphNode = {
    node_ref: ref("GRAPH_NODE", "node-a"),
    graph_ref,
    node_kind: "WORK_STEP",
    title: "A",
    description: "First step",
    requirement_refs: [],
    input_refs: [],
    capability_requirement_refs: [],
    expected_output_refs: [],
    acceptance_criteria_refs: [],
    constraint_refs: [],
  };
  const nodeB: GraphNode = {
    ...nodeA,
    node_ref: ref("GRAPH_NODE", "node-b"),
    title: "B",
    description: "Second step",
  };
  const graph: WorkGraphRevision = {
    graph_revision_ref,
    graph_ref,
    work_ref,
    revision_number: 1,
    source_plan_revision_ref: plan_revision_ref,
    nodes: [nodeA, nodeB],
    edges: [],
    change_reason: "Initial approved structure",
    affected_node_refs: [],
    preserved_node_refs: [],
    invalidated_node_refs: [],
    revalidation_required_node_refs: [],
    state: "VALIDATED",
    validation_result_ref: ref("GRAPH_VALIDATION_RESULT", "validation-1"),
    author_ref: { principal_id: "user-1", principal_kind: "USER" },
    created_at: "2026-11-14T01:00:02Z",
  };
  const work: WorkRecord = {
    work_ref,
    scope_ref: scope,
    title: "Work",
    summary: "Test Work",
    origin_intent_ref: ref("INTENT", "intent-1"),
    owner_ref: ref("USER", "user-1"),
    lifecycle_state: "READY",
    current_phase: "PLANNING",
    current_revision: 3,
    current_plan_ref: plan_revision_ref,
    current_work_graph_ref: graph_revision_ref,
    relationship_refs: [],
    blocker_refs: [],
    created_by: { principal_id: "user-1", principal_kind: "USER" },
    created_at: "2026-11-14T01:00:01Z",
    updated_at: "2026-11-14T01:00:05Z",
  };
  const activation_request_ref = ref("GRAPH_ACTIVATION_REQUEST", "activation-request-1");
  const activation_receipt_ref = ref("PLAN_GRAPH_ACTIVATION_RECEIPT", "activation-receipt-1");
  const receipt: GraphActivationReceipt = {
    receipt_ref: activation_receipt_ref,
    request_ref: activation_request_ref,
    work_ref,
    plan_revision_ref,
    graph_revision_ref,
    expected_work_revision: 2,
    resulting_work_revision: 3,
    receipt_state: "ACCEPTED",
    received_at: "2026-11-14T01:00:05Z",
  };
  return {
    work,
    graph,
    receipt,
    activation_request_ref,
    activation_receipt_ref,
    work_ref,
    graph_revision_ref,
    nodeA,
    nodeB,
  };
}

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
      if (!current || current.version !== expectedVersion) {
        return createOperationResult<T>({
          status: "REJECTED",
          correlation_id: "corr-test",
          errors: [createOperationError("VERSION_CONFLICT", "Record version changed or missing")],
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
  const recordRef = (value: unknown): ObjectRef | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const item = value as Record<string, unknown>;
    for (const key of ["receipt_ref", "request_ref", "orchestration_ref", "checkpoint_ref"]) {
      const candidate = item[key];
      if (candidate && typeof candidate === "object" && "object_kind" in candidate) {
        return candidate as ObjectRef;
      }
    }
    return undefined;
  };
  const appendRepository = <T>(key: string): AppendOnlyRepository<T> => ({
    append: async (_ctx, value) => {
      appendOnlyFor(key).push(value);
      return createOperationResult({
        status: "OK",
        correlation_id: "corr-test",
        data: value,
      });
    },
    get: async (_ctx, objectRef) => {
      const found = appendOnlyFor(key).find((value) => {
        const candidate = recordRef(value);
        return candidate?.object_kind === objectRef.object_kind &&
          candidate.object_id === objectRef.object_id &&
          candidate.scope_ref.scope_id === objectRef.scope_ref.scope_id &&
          candidate.scope_ref.scope_kind === objectRef.scope_ref.scope_kind;
      });
      return found
        ? createOperationResult({
            status: "OK",
            correlation_id: "corr-test",
            data: found as T,
          })
        : createOperationResult<T>({
            status: "REJECTED",
            correlation_id: "corr-test",
            errors: [createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Append-only record was not found")],
          });
    },
  });
  const transaction: EngineTransaction = {
    repository: <T>(key: string) => repository<T>(key),
    appendOnly: <T>(key: string) => appendRepository<T>(key),
    idempotency: {
      get: async <T>(_ctx: RequestContext, key: string) => {
        const saved = idempotency.get(key) as IdempotencyRecord<T> | undefined;
        return createOperationResult({
          status: "OK",
          correlation_id: "corr-test",
          data: saved ?? null,
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
    read<T>(key: string, object_id: string): T | undefined {
      return recordsFor(key).get(object_id)?.value as T | undefined;
    },
    seedRepository<T>(key: string, object_id: string, value: T, version = "1") {
      recordsFor(key).set(object_id, { value, version });
    },
    seedAppendOnly<T>(key: string, value: T) {
      appendOnlyFor(key).push(value);
    },
  };
}

function makeCommand(
  fixtures: ReturnType<typeof makeFixtures>,
  suffix = "one",
  idempotency_key = "idem-one",
): SubmitPlanCommand {
  const request_ref = ref("ORCHESTRATION_REQUEST", "request-" + suffix);
  return {
    context: context("req-" + suffix, idempotency_key, "corr-" + suffix),
    work_ref: fixtures.work_ref,
    expected_work_version: "3",
    graph_revision_ref: fixtures.graph_revision_ref,
    activation_request_ref: fixtures.activation_request_ref,
    activation_receipt_ref: fixtures.activation_receipt_ref,
    orchestration_ref: ref("ORCHESTRATION_RUN", "run-" + suffix),
    request_ref,
    node_coordination_allocations: [
      {
        graph_node_ref: fixtures.nodeA.node_ref,
        node_coordination_ref: ref("NODE_COORDINATION", "coord-" + suffix + "-a"),
      },
      {
        graph_node_ref: fixtures.nodeB.node_ref,
        node_coordination_ref: ref("NODE_COORDINATION", "coord-" + suffix + "-b"),
      },
    ],
    created_at: "2026-11-14T01:00:06Z",
    request_fingerprint: fingerprint("a"),
    event_ref: ref("DOMAIN_EVENT", "event-" + suffix),
  };
}

function seedFixtures(state: ReturnType<typeof makeUnitOfWork>, fixtures: ReturnType<typeof makeFixtures>) {
  state.seedRepository("inv-02.works", fixtures.work_ref.object_id, fixtures.work, "3");
  state.seedRepository("inv-03.graph-revisions", fixtures.graph_revision_ref.object_id, fixtures.graph, "1");
  state.seedAppendOnly("inv-02.plan-graph-activation-receipts", fixtures.receipt);
}

describe("INV-04 orchestration application", () => {
  it("creates a pinned run and PENDING coordination records from INV-02's receipt", async () => {
    const fixtures = makeFixtures();
    const state = makeUnitOfWork();
    seedFixtures(state, fixtures);

    const result = await submitPlan(state.unitOfWork, makeCommand(fixtures));
    expect(result.status).toBe("OK");
    expect(result.data?.state).toBe("CREATED");
    expect(result.data?.activation_request_ref).toEqual(fixtures.activation_request_ref);
    expect(result.data?.graph_activation_receipt_ref).toEqual(fixtures.activation_receipt_ref);
    expect(state.read<unknown>("inv-04.orchestration-runs", "run-one")).toBeDefined();
    expect(state.read<unknown>("inv-04.node-coordination", "coord-one-a")).toBeDefined();
    expect(state.read<unknown>("inv-04.node-coordination", "coord-one-b")).toBeDefined();
    expect(state.events).toHaveLength(1);
    expect(state.events[0].event_type).toBe("orchestration.started");
    expect((state.events[0].payload as Record<string, unknown>).initial_state).toBe("CREATED");
  });

  it("returns the original result for an identical idempotent retry", async () => {
    const fixtures = makeFixtures();
    const state = makeUnitOfWork();
    seedFixtures(state, fixtures);
    const command = makeCommand(fixtures);
    const first = await submitPlan(state.unitOfWork, command);
    const replay = await submitPlan(state.unitOfWork, command);
    expect(first.status).toBe("OK");
    expect(replay).toEqual(first);
    expect(state.events).toHaveLength(1);
  });

  it("rejects a changed payload that reuses the orchestration idempotency key", async () => {
    const fixtures = makeFixtures();
    const state = makeUnitOfWork();
    seedFixtures(state, fixtures);
    const command = makeCommand(fixtures);
    await submitPlan(state.unitOfWork, command);
    const changed = {
      ...command,
      request_fingerprint: fingerprint("b"),
    };
    const result = await submitPlan(state.unitOfWork, changed);
    expect(result.status).toBe("REJECTED");
    expect(result.errors[0].code).toBe("IDEMPOTENCY_CONFLICT");
    expect(state.events).toHaveLength(1);
  });

  it("rejects stale Work versions before creating a run", async () => {
    const fixtures = makeFixtures();
    const state = makeUnitOfWork();
    seedFixtures(state, fixtures);
    const command = {
      ...makeCommand(fixtures, "stale", "idem-stale"),
      expected_work_version: "2",
    };
    const result = await submitPlan(state.unitOfWork, command);
    expect(result.status).toBe("REJECTED");
    expect(result.errors[0].code).toBe("VERSION_CONFLICT");
    expect(state.read("inv-04.orchestration-runs", "run-stale")).toBeUndefined();
  });

  it("rejects a receipt from a different activation request", async () => {
    const fixtures = makeFixtures();
    const state = makeUnitOfWork();
    seedFixtures(state, fixtures);
    const command = {
      ...makeCommand(fixtures, "wrong-request", "idem-wrong-request"),
      activation_request_ref: ref("GRAPH_ACTIVATION_REQUEST", "some-other-request"),
    };
    const result = await submitPlan(state.unitOfWork, command);
    expect(result.status).toBe("REJECTED");
    expect(result.errors[0].code).toBe("VALIDATION_ERROR");
    expect(state.read("inv-04.orchestration-runs", "run-wrong-request")).toBeUndefined();
  });

  it("requires one exact coordination allocation for every pinned Graph node", async () => {
    const fixtures = makeFixtures();
    const state = makeUnitOfWork();
    seedFixtures(state, fixtures);
    const command = {
      ...makeCommand(fixtures, "missing-node", "idem-missing-node"),
      node_coordination_allocations: [],
    };
    const result = await submitPlan(state.unitOfWork, command);
    expect(result.status).toBe("REJECTED");
    expect(result.errors[0].code).toBe("VALIDATION_ERROR");
    expect(state.read("inv-04.orchestration-runs", "run-missing-node")).toBeUndefined();
  });

  it("does not create an orchestration when the activation receipt is UNKNOWN", async () => {
    const fixtures = makeFixtures();
    fixtures.receipt.receipt_state = "UNKNOWN";
    const state = makeUnitOfWork();
    seedFixtures(state, fixtures);
    const result = await submitPlan(state.unitOfWork, makeCommand(fixtures, "unknown", "idem-unknown"));
    expect(result.status).toBe("REJECTED");
    expect(result.errors[0].code).toBe("OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED");
    expect(state.read("inv-04.orchestration-runs", "run-unknown")).toBeUndefined();
  });
});
