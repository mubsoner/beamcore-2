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
import { submitIntent, type SubmitIntentCommand } from "./application";
import type { NormalizedIntent } from "./domain";

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
const command: SubmitIntentCommand = {
  context,
  request: {
    raw_input: "Research current database options",
    input_source_refs: [],
    requested_context_refs: [],
    explicit_constraints: [],
    received_at: "2026-11-13T03:00:00Z",
  },
  intent_ref: ref("INTENT", "intent-1"),
  revision_number: 1,
  user_goal_summary: "Compare database options",
  requested_work_kind: "RESEARCH",
  desired_effect_summary: "A sourced comparison",
  explicit_requirements: [],
  contextual_facts: [],
  assumptions: [],
  unknowns: [],
  ambiguity_items: [],
  created_at: "2026-11-13T03:00:01Z",
  request_fingerprint: "a".repeat(64),
  event_ref: ref("DOMAIN_EVENT", "event-1"),
};

function makeUnitOfWork() {
  const idempotency = new Map<string, IdempotencyRecord<NormalizedIntent>>();
  const stored = new Map<string, NormalizedIntent>();
  const repo: VersionedRepository<NormalizedIntent> = {
    get: vi.fn(async () => createOperationResult<NormalizedIntent>({
      status: "REJECTED", correlation_id: context.correlation_id,
    })),
    create: vi.fn(async (_ctx, objectRef, value) => {
      stored.set(objectRef.object_id, value);
      return createOperationResult({
        status: "OK", correlation_id: context.correlation_id, data: value,
        object_version: objectRef.object_version,
      });
    }),
    update: vi.fn(async () => createOperationResult<NormalizedIntent>({
      status: "REJECTED", correlation_id: context.correlation_id,
    })),
  };
  const tx: EngineTransaction = {
    repository: <T>() => repo as unknown as VersionedRepository<T>,
    appendOnly: <T>() => ({
      append: vi.fn(async () => createOperationResult<T>({
        status: "OK", correlation_id: context.correlation_id,
      })),
      get: vi.fn(async () => createOperationResult<T>({
        status: "REJECTED", correlation_id: context.correlation_id,
      })),
    }),
    idempotency: {
      get: vi.fn(async <T>(_ctx: RequestContext, key: string) => {
        const record = idempotency.get(key) as IdempotencyRecord<T> | undefined;
        return createOperationResult({
          status: "OK", correlation_id: context.correlation_id, data: record ?? null,
        });
      }),
      record: vi.fn(async <T>(_ctx: RequestContext, record: IdempotencyRecord<T>) => {
        idempotency.set(record.idempotency_key, record as IdempotencyRecord<NormalizedIntent>);
        return createOperationResult({
          status: "OK", correlation_id: context.correlation_id, data: record,
        });
      }),
    },
    outbox: {
      append: vi.fn(async () => createOperationResult({
        status: "OK", correlation_id: context.correlation_id, data: { event_id: "event-1" },
      })),
    },
  };
  const unitOfWork: EngineUnitOfWorkPort = {
    execute: async <T>(_ctx: RequestContext, callback: (transaction: EngineTransaction) => Promise<OperationResult<T>>) =>
      callback(tx),
  };
  return { unitOfWork, tx, repo, stored, idempotency };
}

describe("INV-01 submitIntent application use case", () => {
  it("persists the normalized intent, outbox event and idempotency result in one unit of work", async () => {
    const { unitOfWork, tx, repo, stored, idempotency } = makeUnitOfWork();
    const result = await submitIntent(unitOfWork, command);
    expect(result.status).toBe("OK");
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(tx.outbox.append).toHaveBeenCalledTimes(1);
    expect(tx.idempotency.record).toHaveBeenCalledTimes(1);
    expect(stored.has("intent-1")).toBe(true);
    expect(idempotency.has("idem-1")).toBe(true);
  });

  it("returns the original result for an identical idempotent replay", async () => {
    const { unitOfWork, repo } = makeUnitOfWork();
    const first = await submitIntent(unitOfWork, command);
    const second = await submitIntent(unitOfWork, command);
    expect(first.status).toBe("OK");
    expect(second.status).toBe("OK");
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it("rejects reuse of an idempotency key with a different fingerprint", async () => {
    const { unitOfWork, repo } = makeUnitOfWork();
    await submitIntent(unitOfWork, command);
    const conflict = await submitIntent(unitOfWork, {
      ...command,
      request_fingerprint: "b".repeat(64),
    });
    expect(conflict.status).toBe("REJECTED");
    expect(conflict.errors[0]?.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing idempotency key before persistence", async () => {
    const { unitOfWork, repo } = makeUnitOfWork();
    const result = await submitIntent(unitOfWork, {
      ...command,
      context: { ...context, idempotency_key: undefined },
    });
    expect(result.status).toBe("REJECTED");
    expect(repo.create).not.toHaveBeenCalled();
  });
});
