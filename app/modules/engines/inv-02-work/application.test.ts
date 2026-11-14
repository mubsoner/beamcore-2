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
  changeWorkState,
  submitWork,
  type CreateWorkCommand,
  type TransitionWorkApplicationCommand,
} from "./application";
import type { WorkRecord, WorkRevision } from "./domain";

const scope = { scope_id: "scope-1", scope_kind: "WORK" as const };
const context: RequestContext = {
  request_id: "req-create",
  correlation_id: "corr-create",
  actor_ref: { principal_id: "user-1", principal_kind: "USER" },
  scope_ref: scope,
  issued_at: "2026-11-14T00:00:00Z",
  idempotency_key: "idem-create",
};
const ref = (object_kind: string, object_id: string): ObjectRef => ({
  object_kind,
  object_id,
  object_version: "1",
  scope_ref: scope,
});

const createCommand: CreateWorkCommand = {
  context,
  work_ref: ref("WORK", "work-1"),
  origin_intent_ref: ref("INTENT", "intent-1"),
  owner_ref: ref("USER", "user-1"),
  title: "Build a customer portal",
  summary: "Create and verify a customer-facing portal",
  created_at: "2026-11-14T00:00:01Z",
  request_fingerprint: "a".repeat(64),
  event_ref: ref("DOMAIN_EVENT", "event-work-created"),
};

function makeUnitOfWork() {
  const works = new Map<string, WorkRecord>();
  const revisions: WorkRevision[] = [];
  const events: DomainEventEnvelope[] = [];
  const idempotency = new Map<string, IdempotencyRecord<unknown>>();

  const workRepository: VersionedRepository<WorkRecord> = {
    get: async (_context, objectRef) => {
      const value = works.get(objectRef.object_id);
      return value
        ? createOperationResult({
            status: "OK",
            correlation_id: context.correlation_id,
            data: value,
            object_version: String(value.current_revision),
          })
        : createOperationResult({
            status: "REJECTED",
            correlation_id: context.correlation_id,
            errors: [createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Work was not found")],
          });
    },
    create: async (_context, objectRef, value) => {
      if (works.has(objectRef.object_id)) {
        return createOperationResult({
          status: "REJECTED",
          correlation_id: context.correlation_id,
          errors: [createOperationError("VERSION_CONFLICT", "Work already exists")],
        });
      }
      works.set(objectRef.object_id, value);
      return createOperationResult({
        status: "OK",
        correlation_id: context.correlation_id,
        data: value,
        object_version: String(value.current_revision),
      });
    },
    update: async (_context, objectRef, expectedVersion, value) => {
      const current = works.get(objectRef.object_id);
      if (!current) {
        return createOperationResult({
          status: "REJECTED",
          correlation_id: context.correlation_id,
          errors: [createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Work was not found")],
        });
      }
      if (String(current.current_revision) !== expectedVersion) {
        return createOperationResult({
          status: "REJECTED",
          correlation_id: context.correlation_id,
          errors: [createOperationError("VERSION_CONFLICT", "Work version changed")],
        });
      }
      works.set(objectRef.object_id, value);
      return createOperationResult({
        status: "OK",
        correlation_id: context.correlation_id,
        data: value,
        object_version: String(value.current_revision),
      });
    },
  };

  const revisionRepository: AppendOnlyRepository<WorkRevision> = {
    append: async (_context, revision) => {
      revisions.push(revision);
      return createOperationResult({
        status: "OK",
        correlation_id: context.correlation_id,
        data: revision,
      });
    },
    get: async () =>
      createOperationResult({
        status: "REJECTED",
        correlation_id: context.correlation_id,
        errors: [createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Revision was not found")],
      }),
  };

  const transaction: EngineTransaction = {
    repository: <T>(key: string) => {
      if (key !== "inv-02.works") throw new Error(`Unexpected repository: ${key}`);
      return workRepository as unknown as VersionedRepository<T>;
    },
    appendOnly: <T>(key: string) => {
      if (key !== "inv-02.work-revisions") throw new Error(`Unexpected append-only repository: ${key}`);
      return revisionRepository as unknown as AppendOnlyRepository<T>;
    },
    idempotency: {
      get: async <T>(_context: RequestContext, key: string) => {
        const value = idempotency.get(key) as IdempotencyRecord<T> | undefined;
        return createOperationResult({
          status: "OK",
          correlation_id: context.correlation_id,
          data: value ?? null,
        });
      },
      record: async <T>(_context: RequestContext, record: IdempotencyRecord<T>) => {
        idempotency.set(record.idempotency_key, record as IdempotencyRecord<unknown>);
        return createOperationResult({
          status: "OK",
          correlation_id: context.correlation_id,
          data: record,
        });
      },
    },
    outbox: {
      append: async (_context, event) => {
        events.push(event);
        return createOperationResult({
          status: "OK",
          correlation_id: context.correlation_id,
          data: { event_id: event.event_id },
        });
      },
    },
  };

  const unitOfWork: EngineUnitOfWorkPort = {
    execute: async <T>(
      _context: RequestContext,
      operation: (transaction: EngineTransaction) => Promise<OperationResult<T>>,
    ) => operation(transaction),
  };

  return { unitOfWork, works, revisions, events, idempotency };
}

describe("INV-02 Work application use cases", () => {
  it("creates Work, revision, outbox event and idempotency result atomically", async () => {
    const state = makeUnitOfWork();
    const result = await submitWork(state.unitOfWork, createCommand);

    expect(result.status).toBe("OK");
    expect(result.data?.lifecycle_state).toBe("PROPOSED");
    expect(state.works.has("work-1")).toBe(true);
    expect(state.revisions).toHaveLength(1);
    expect(state.revisions[0].revision_number).toBe(1);
    expect(state.events).toHaveLength(1);
    expect(state.events[0].event_type).toBe("work.created");
    expect(state.idempotency.has("idem-create")).toBe(true);
  });

  it("returns the original result on replay and rejects key reuse with a different fingerprint", async () => {
    const state = makeUnitOfWork();
    const first = await submitWork(state.unitOfWork, createCommand);
    const replay = await submitWork(state.unitOfWork, createCommand);
    const conflict = await submitWork(state.unitOfWork, {
      ...createCommand,
      request_fingerprint: "b".repeat(64),
    });

    expect(first.status).toBe("OK");
    expect(replay.status).toBe("OK");
    expect(conflict.status).toBe("REJECTED");
    expect(conflict.errors[0]?.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(state.revisions).toHaveLength(1);
    expect(state.events).toHaveLength(1);
  });

  it("changes Work state with optimistic versioning, revision history and an outbox event", async () => {
    const state = makeUnitOfWork();
    const created = await submitWork(state.unitOfWork, createCommand);
    expect(created.status).toBe("OK");

    const transition: TransitionWorkApplicationCommand = {
      context: {
        ...context,
        request_id: "req-ready",
        correlation_id: "corr-ready",
        idempotency_key: "idem-ready",
      },
      work_ref: createCommand.work_ref,
      transition: {
        expected_version: 1,
        target_state: "READY",
        reason_ref: ref("WORK_TRANSITION_REASON", "reason-ready"),
        occurred_at: "2026-11-14T00:00:02Z",
        authority: {
          decision_ref: ref("AUTHORITY_DECISION", "authority-ready"),
          disposition: "ALLOWED",
        },
        guards: {
          active_blocker_count: 0,
          prerequisites_satisfied: true,
          orchestrator_eligible: false,
          reconciliation_complete: false,
        },
      },
      request_fingerprint: "c".repeat(64),
      event_ref: ref("DOMAIN_EVENT", "event-work-ready"),
    };

    const result = await changeWorkState(state.unitOfWork, transition);
    expect(result.status).toBe("OK");
    expect(result.data?.lifecycle_state).toBe("READY");
    expect(result.data?.current_revision).toBe(2);
    expect(state.revisions).toHaveLength(2);
    expect(state.revisions[1].revision_number).toBe(2);
    expect(state.events).toHaveLength(2);
    expect(state.events[1].event_type).toBe("work.lifecycle_changed");

    const replay = await changeWorkState(state.unitOfWork, transition);
    expect(replay.status).toBe("OK");
    expect(state.revisions).toHaveLength(2);
    expect(state.events).toHaveLength(2);
  });

  it("rejects stale Work transitions without writing another revision or event", async () => {
    const state = makeUnitOfWork();
    await submitWork(state.unitOfWork, createCommand);
    const command: TransitionWorkApplicationCommand = {
      context: {
        ...context,
        request_id: "req-stale",
        correlation_id: "corr-stale",
        idempotency_key: "idem-stale",
      },
      work_ref: createCommand.work_ref,
      transition: {
        expected_version: 99,
        target_state: "READY",
        reason_ref: ref("WORK_TRANSITION_REASON", "reason-ready"),
        occurred_at: "2026-11-14T00:00:03Z",
        authority: {
          decision_ref: ref("AUTHORITY_DECISION", "authority-ready"),
          disposition: "ALLOWED",
        },
        guards: {
          active_blocker_count: 0,
          prerequisites_satisfied: true,
          orchestrator_eligible: false,
          reconciliation_complete: false,
        },
      },
      request_fingerprint: "d".repeat(64),
      event_ref: ref("DOMAIN_EVENT", "event-work-stale"),
    };

    const result = await changeWorkState(state.unitOfWork, command);
    expect(result.status).toBe("REJECTED");
    expect(result.errors[0]?.code).toBe("VERSION_CONFLICT");
    expect(state.revisions).toHaveLength(1);
    expect(state.events).toHaveLength(1);
  });
});
