import { describe, expect, it, vi } from "vitest";
import {
  createOperationResult,
  type EngineTransaction,
  type EngineUnitOfWorkPort,
  type IdempotencyRecord,
  type ObjectRef,
  type OperationResult,
  type RequestContext,
  type VersionedRepository,
} from "../shared";
import type { DecisionRecord, RouteProposal } from "./domain";
import { requestRouteHandoff, type HandoffReceipt, type RouteHandoffPort } from "./handoff";

const scope = { scope_id: "scope-1", scope_kind: "WORK" as const };
const context: RequestContext = {
  request_id: "req-handoff",
  correlation_id: "corr-handoff",
  actor_ref: { principal_id: "user-1", principal_kind: "USER" },
  scope_ref: scope,
  issued_at: "2026-11-15T02:00:00Z",
  idempotency_key: "handoff-1",
};
const ref = (object_kind: string, object_id: string, object_version = "1"): ObjectRef => ({
  object_kind, object_id, object_version, scope_ref: scope,
});
const route: RouteProposal = {
  route_ref: ref("ROUTE_PROPOSAL", "route-1"),
  disposition: "RESEARCH",
  target_engine_id: "INV-13",
  target_operation: "submit_research_request",
  input_refs: [ref("INTENT", "intent-1")],
  required_authority_check: false,
  created_at: "2026-11-15T02:00:00Z",
};
const decision: DecisionRecord = {
  decision_ref: ref("DECISION_RECORD", "decision-1"),
  intent_ref: ref("INTENT", "intent-1"),
  intent_revision: 1,
  state: "ROUTE_SELECTED",
  disposition: "RESEARCH",
  route_proposal_ref: route.route_ref,
  lineage: {
    source_refs: [], requirement_refs: [], contextual_fact_refs: [],
    assumption_refs: [], constraint_refs: [], policy_decision_refs: [],
    authority_decision_refs: [], capability_refs: [], uncertainty_summary: [],
    rationale_summary: "Research is needed.",
  },
  created_at: "2026-11-15T02:00:00Z",
  correlation_id: context.correlation_id,
};

function makeHarness() {
  const decisions = new Map([[decision.decision_ref.object_id, decision]]);
  const routes = new Map([[route.route_ref.object_id, route]]);
  const receipts = new Map<string, { route_proposal_ref: ObjectRef; decision_ref: ObjectRef; receipt: HandoffReceipt; recorded_at: string }>();
  const idem = new Map<string, IdempotencyRecord<HandoffReceipt>>();
  const events: unknown[] = [];
  const decisionRepo: VersionedRepository<DecisionRecord> = {
    get: vi.fn(async (_ctx, objectRef) => {
      const value = decisions.get(objectRef.object_id);
      return value
        ? createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: value, object_version: String(value.state === "ROUTE_SELECTED" ? 1 : 2) })
        : createOperationResult<DecisionRecord>({ status: "REJECTED", correlation_id: context.correlation_id, errors: [] });
    }),
    create: vi.fn(async () => createOperationResult<DecisionRecord>({ status: "REJECTED", correlation_id: context.correlation_id })),
    update: vi.fn(async (_ctx, objectRef, expected, value) => {
      const current = decisions.get(objectRef.object_id);
      const version = current?.state === "ROUTE_SELECTED" ? "1" : "2";
      if (!current || expected !== version) return createOperationResult<DecisionRecord>({ status: "REJECTED", correlation_id: context.correlation_id });
      decisions.set(objectRef.object_id, value);
      return createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: value, object_version: String(Number(version) + 1) });
    }),
  };
  const routeRepo: VersionedRepository<RouteProposal> = {
    get: vi.fn(async (_ctx, objectRef) => {
      const value = routes.get(objectRef.object_id);
      return value
        ? createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: value, object_version: "1" })
        : createOperationResult<RouteProposal>({ status: "REJECTED", correlation_id: context.correlation_id });
    }),
    create: vi.fn(async () => createOperationResult<RouteProposal>({ status: "REJECTED", correlation_id: context.correlation_id })),
    update: vi.fn(async () => createOperationResult<RouteProposal>({ status: "REJECTED", correlation_id: context.correlation_id })),
  };
  const tx: EngineTransaction = {
    repository: <T>(key: string) => (key === "inv-01.route-proposals" ? routeRepo as VersionedRepository<T> : decisionRepo as VersionedRepository<T>),
    appendOnly: <T>() => ({
      append: vi.fn(async (_ctx, item) => {
        const value = item as typeof item & { route_proposal_ref?: ObjectRef };
        if (value.route_proposal_ref) receipts.set(value.route_proposal_ref.object_id, value as never);
        return createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: item });
      }),
      get: vi.fn(async (_ctx, objectRef) => {
        const value = receipts.get(objectRef.object_id);
        return value
          ? createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: value as T })
          : createOperationResult<T>({ status: "REJECTED", correlation_id: context.correlation_id, errors: [{ code: "NOT_FOUND_OR_NOT_VISIBLE", safe_message: "Not found", retryable: false }] });
      }),
    }),
    idempotency: {
      get: vi.fn(async <T>(_ctx: RequestContext, key: string): Promise<OperationResult<IdempotencyRecord<T> | null>> => {
        const record = idem.get(key);
        return createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: record as IdempotencyRecord<T> | undefined ?? null });
      }) as EngineTransaction["idempotency"]["get"],
      record: vi.fn(async <T>(_ctx: RequestContext, record: IdempotencyRecord<T>) => {
        idem.set(record.idempotency_key, record as IdempotencyRecord<HandoffReceipt>);
        return createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: record });
      }) as EngineTransaction["idempotency"]["record"],
    },
    outbox: {
      append: vi.fn(async (_ctx, item) => {
        events.push(item);
        return createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { event_id: item.event_id } });
      }),
    },
  };
  const unitOfWork: EngineUnitOfWorkPort = {
    execute: async <T>(_ctx: RequestContext, fn: (transaction: EngineTransaction) => Promise<OperationResult<T>>) => fn(tx),
  };
  return { unitOfWork, tx, decisions, receipts, idem, events, decisionRepo };
}

const command = {
  context,
  route_proposal_ref: route.route_ref,
  decision_ref: decision.decision_ref,
  request_fingerprint: "a".repeat(64),
  requested_at: "2026-11-15T02:00:01Z",
  requested_event_ref: ref("DOMAIN_EVENT", "event-request"),
  result_event_ref: ref("DOMAIN_EVENT", "event-result"),
};

describe("INV-01 durable route handoff", () => {
  it("persists HANDOFF_REQUESTED before calling recipient and records its authoritative acceptance", async () => {
    const harness = makeHarness();
    const port: RouteHandoffPort = {
      lookup: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { state: "NOT_SUBMITTED" as const } })),
      submit: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: {
        route_proposal_ref: route.route_ref, recipient_engine_id: "INV-13",
        recipient_request_ref: ref("RESEARCH_REQUEST", "research-1"),
        receipt_state: "ACCEPTED" as const, received_at: "2026-11-15T02:00:02Z",
      } })),
    };
    const result = await requestRouteHandoff(harness.unitOfWork, port, command);
    expect(result.status).toBe("OK");
    expect(result.data?.receipt_state).toBe("ACCEPTED");
    expect(harness.decisions.get("decision-1")?.state).toBe("HANDOFF_CONFIRMED");
    expect(harness.events.map((e) => (e as { event_type: string }).event_type)).toEqual([
      "decision.handoff_requested", "decision.handoff_confirmed",
    ]);
    const replay = await requestRouteHandoff(harness.unitOfWork, port, command);
    expect(replay).toEqual(result);
    expect(port.submit).toHaveBeenCalledTimes(1);
  });

  it("keeps the decision UNKNOWN and does not submit when recipient state cannot be established", async () => {
    const harness = makeHarness();
    const port: RouteHandoffPort = {
      lookup: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { state: "UNKNOWN" as const } })),
      submit: vi.fn(),
    };
    const result = await requestRouteHandoff(harness.unitOfWork, port, command);
    expect(result.status).toBe("UNKNOWN");
    expect(result.data?.receipt_state).toBe("UNKNOWN");
    expect(port.submit).not.toHaveBeenCalled();
    expect(harness.decisions.get("decision-1")?.state).toBe("UNKNOWN");
  });

  it("marks a definitive recipient rejection as BLOCKED rather than accepted", async () => {
    const harness = makeHarness();
    const port: RouteHandoffPort = {
      lookup: vi.fn(async () => createOperationResult({ status: "OK", correlation_id: context.correlation_id, data: { state: "RECEIPT_AVAILABLE" as const, receipt: {
        route_proposal_ref: route.route_ref, recipient_engine_id: "INV-13",
        receipt_state: "REJECTED" as const, rejection_error: {
          code: "POLICY_DENIED", safe_message: "Recipient policy denied this request", retryable: false,
        },
      } } })),
      submit: vi.fn(),
    };
    const result = await requestRouteHandoff(harness.unitOfWork, port, command);
    expect(result.status).toBe("REJECTED");
    expect(harness.decisions.get("decision-1")?.state).toBe("BLOCKED");
    expect(port.submit).not.toHaveBeenCalled();
  });

  it("rejects a route reference from another scope before persistence or handoff", async () => {
    const harness = makeHarness();
    const port: RouteHandoffPort = {
      lookup: vi.fn(), submit: vi.fn(),
    };
    const result = await requestRouteHandoff(harness.unitOfWork, port, {
      ...command,
      route_proposal_ref: { ...route.route_ref, scope_ref: { scope_id: "foreign", scope_kind: "WORK" } },
    });
    expect(result.status).toBe("REJECTED");
    expect(port.lookup).not.toHaveBeenCalled();
    expect(harness.tx.outbox.append).not.toHaveBeenCalled();
  });
});
