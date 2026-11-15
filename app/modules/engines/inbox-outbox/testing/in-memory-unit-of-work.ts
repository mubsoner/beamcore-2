import {
  createOperationError,
  createOperationResult,
  isObjectRef,
  type AppendOnlyRepository,
  type DomainEventEnvelope,
  type EngineTransaction,
  type EngineUnitOfWorkPort,
  type IdempotencyPort,
  type IdempotencyRecord,
  type ObjectRef,
  type OperationResult,
  type RequestContext,
  type Version,
  type VersionedRepository,
} from "../../shared";
import { sameScopeRef } from "../../shared";
import {
  cloneInMemoryInboxState,
  createInMemoryEventInbox,
  createInMemoryInboxState,
  type InMemoryInboxState,
} from "./in-memory-inbox";

interface StoredValue<T> {
  version: Version;
  value: T;
}

interface OutboxRecord {
  context: RequestContext;
  event: DomainEventEnvelope;
}

interface ReferenceState {
  repositories: Map<string, Map<string, StoredValue<unknown>>>;
  appendOnly: Map<string, Map<string, unknown>>;
  idempotency: Map<string, IdempotencyRecord<unknown>>;
  outbox: Map<string, OutboxRecord>;
  inbox: InMemoryInboxState;
}

function emptyState(): ReferenceState {
  return {
    repositories: new Map(),
    appendOnly: new Map(),
    idempotency: new Map(),
    outbox: new Map(),
    inbox: createInMemoryInboxState(),
  };
}

function cloneState(state: ReferenceState): ReferenceState {
  return {
    repositories: new Map([...state.repositories].map(([name, values]) => [
      name,
      new Map([...values].map(([key, record]) => [
        key,
        { version: record.version, value: structuredClone(record.value) },
      ])),
    ])),
    appendOnly: new Map([...state.appendOnly].map(([name, values]) => [
      name,
      new Map([...values].map(([key, value]) => [key, structuredClone(value)])),
    ])),
    idempotency: new Map([...state.idempotency].map(([key, value]) => [
      key,
      structuredClone(value),
    ])),
    outbox: new Map([...state.outbox].map(([key, value]) => [
      key,
      structuredClone(value),
    ])),
    inbox: cloneInMemoryInboxState(state.inbox),
  };
}

function scopeKey(context: RequestContext): string {
  const visit = (scope: RequestContext["scope_ref"]): unknown => [
    scope.scope_kind,
    scope.scope_id,
    scope.parent_scope_ref ? visit(scope.parent_scope_ref) : null,
  ];
  return JSON.stringify(visit(context.scope_ref));
}

function refScopeKey(ref: ObjectRef): string {
  const visit = (scope: ObjectRef["scope_ref"]): unknown => [
    scope.scope_kind,
    scope.scope_id,
    scope.parent_scope_ref ? visit(scope.parent_scope_ref) : null,
  ];
  return JSON.stringify(visit(ref.scope_ref));
}

function refKey(ref: ObjectRef): string {
  return JSON.stringify([ref.object_kind, ref.object_id, refScopeKey(ref)]);
}

function isRefInContext(context: RequestContext, ref: ObjectRef): boolean {
  return sameScopeRef(context.scope_ref, ref.scope_ref);
}

function result<T>(
  context: RequestContext,
  status: OperationResult<T>["status"],
  data?: T,
  errors: OperationResult<T>["errors"] = [],
  object_version?: Version,
): OperationResult<T> {
  return createOperationResult({
    status,
    correlation_id: context.correlation_id,
    data,
    errors,
    ...(object_version === undefined ? {} : { object_version }),
  });
}

/**
 * Process-local conformance adapter only. It models atomic commit/rollback for
 * contract tests; it is not durable and must never be used as production storage.
 */
export function createInMemoryEngineUnitOfWork(): EngineUnitOfWorkPort & {
  snapshot(): {
    repository_records: number;
    append_only_records: number;
    idempotency_records: number;
    inbox_records: number;
    outbox_records: number;
  };
} {
  let committed = emptyState();
  let queue: Promise<void> = Promise.resolve();

  return {
    execute: async <T>(
      context: RequestContext,
      command: (transaction: EngineTransaction) => Promise<OperationResult<T>>,
    ): Promise<OperationResult<T>> => {
      let release!: () => void;
      const previous = queue;
      queue = new Promise<void>((resolve) => { release = resolve; });
      await previous;

      try {
        const staged = cloneState(committed);
        const inbox = createInMemoryEventInbox({ state: staged.inbox });
        const transaction: EngineTransaction = {
          repository: <V>(name: string): VersionedRepository<V> => ({
            get: async (ctx, ref) => {
              if (!isRefInContext(ctx, ref)) {
                return result<V>(ctx, "REJECTED", undefined, [
                  createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Record was not found"),
                ]);
              }
              const record = staged.repositories.get(name)?.get(
                JSON.stringify([scopeKey(ctx), refKey(ref)]),
              );
              return record
                ? result(ctx, "OK", structuredClone(record.value as V), [], record.version)
                : result<V>(ctx, "REJECTED", undefined, [
                    createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Record was not found"),
                  ]);
            },
            create: async (ctx, ref, value) => {
              if (!isRefInContext(ctx, ref)) {
                return result<V>(ctx, "REJECTED", undefined, [
                  createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Record was not found"),
                ]);
              }
              const key = JSON.stringify([scopeKey(ctx), refKey(ref)]);
              const records = staged.repositories.get(name) ?? new Map();
              if (records.has(key)) {
                return result<V>(ctx, "REJECTED", undefined, [
                  createOperationError("VERSION_CONFLICT", "Record already exists"),
                ]);
              }
              records.set(key, { version: "1", value: structuredClone(value) });
              staged.repositories.set(name, records);
              return result(ctx, "OK", structuredClone(value), [], "1");
            },
            update: async (ctx, ref, expectedVersion, value) => {
              if (!isRefInContext(ctx, ref)) {
                return result<V>(ctx, "REJECTED", undefined, [
                  createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Record was not found"),
                ]);
              }
              const key = JSON.stringify([scopeKey(ctx), refKey(ref)]);
              const records = staged.repositories.get(name) ?? new Map();
              const current = records.get(key);
              if (!current || current.version !== expectedVersion) {
                return result<V>(ctx, "REJECTED", undefined, [
                  createOperationError("VERSION_CONFLICT", "Expected version does not match"),
                ]);
              }
              const next = Number(expectedVersion);
              if (!Number.isSafeInteger(next) || next < 1 || String(next) !== expectedVersion || next >= Number.MAX_SAFE_INTEGER) {
                return result<V>(ctx, "REJECTED", undefined, [
                  createOperationError("VERSION_CONFLICT", "Reference adapter requires a safe integer version token"),
                ]);
              }
              const nextVersion = String(next + 1);
              records.set(key, { version: nextVersion, value: structuredClone(value) });
              staged.repositories.set(name, records);
              return result(ctx, "OK", structuredClone(value), [], nextVersion);
            },
          }),
          appendOnly: <V>(name: string): AppendOnlyRepository<V> => ({
            append: async (ctx, ref, value) => {
              if (!isObjectRef(ref) || !isRefInContext(ctx, ref)) {
                return result<V>(ctx, "REJECTED", undefined, [
                  createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Record was not found"),
                ]);
              }
              const values = staged.appendOnly.get(name) ?? new Map();
              const key = JSON.stringify([scopeKey(ctx), refKey(ref)]);
              if (values.has(key)) {
                return result<V>(ctx, "REJECTED", undefined, [
                  createOperationError("VERSION_CONFLICT", "Append-only record identity already exists"),
                ]);
              }
              values.set(key, structuredClone(value));
              staged.appendOnly.set(name, values);
              return result(ctx, "OK", structuredClone(value));
            },
            get: async (ctx, ref) => {
              if (!isObjectRef(ref) || !isRefInContext(ctx, ref)) {
                return result<V>(ctx, "REJECTED", undefined, [
                  createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Record was not found"),
                ]);
              }
              const value = staged.appendOnly.get(name)?.get(
                JSON.stringify([scopeKey(ctx), refKey(ref)]),
              );
              return value === undefined
                ? result<V>(ctx, "REJECTED", undefined, [
                    createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Record was not found"),
                  ])
                : result(ctx, "OK", structuredClone(value as V));
            },
          }),
          idempotency: {
            get: async <V>(ctx, key: string) => {
              const record = staged.idempotency.get(JSON.stringify([scopeKey(ctx), key]));
              return result<IdempotencyRecord<V> | null>(
                ctx,
                "OK",
                record ? structuredClone(record as IdempotencyRecord<V>) : null,
              );
            },
            record: async <V>(ctx, record: IdempotencyRecord<V>) => {
              const key = JSON.stringify([scopeKey(ctx), record.idempotency_key]);
              const prior = staged.idempotency.get(key);
              if (prior && prior.request_fingerprint !== record.request_fingerprint) {
                return result<IdempotencyRecord<V>>(ctx, "REJECTED", undefined, [
                  createOperationError("IDEMPOTENCY_CONFLICT", "Idempotency key was reused with a different request"),
                ]);
              }
              if (prior) return result(ctx, "OK", structuredClone(prior as IdempotencyRecord<V>));
              staged.idempotency.set(key, structuredClone(record));
              return result(ctx, "OK", structuredClone(record));
            },
          } satisfies IdempotencyPort,
          inbox,
          outbox: {
            append: async (ctx, event) => {
              const key = JSON.stringify([scopeKey(ctx), event.event_id]);
              if (staged.outbox.has(key)) {
                return result(ctx, "REJECTED", undefined, [
                  createOperationError("EVENT_ID_REUSED_WITH_DIFFERENT_PAYLOAD", "Outbox event_id already exists"),
                ]);
              }
              staged.outbox.set(key, { context: structuredClone(ctx), event: structuredClone(event) });
              return result(ctx, "OK", { event_id: event.event_id });
            },
          },
        };

        let outcome: OperationResult<T>;
        try {
          outcome = await command(transaction);
        } catch {
          return result<T>(context, "UNKNOWN", undefined, [
            createOperationError("OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED", "Command threw before transaction outcome could be confirmed", true),
          ]);
        }

        if (outcome.status === "OK" || outcome.status === "PARTIAL") {
          committed = staged;
        }
        return outcome;
      } finally {
        release();
      }
    },
    snapshot: () => ({
      repository_records: [...committed.repositories.values()].reduce((n, values) => n + values.size, 0),
      append_only_records: [...committed.appendOnly.values()].reduce((n, values) => n + values.size, 0),
      idempotency_records: committed.idempotency.size,
      inbox_records: committed.inbox.events.size,
      outbox_records: committed.outbox.size,
    }),
  };
}
