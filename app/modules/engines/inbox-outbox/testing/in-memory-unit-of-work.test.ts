import { describe, expect, it } from "vitest";
import { createOperationResult, type InboxEventEnvelope, type ObjectRef, type RequestContext } from "../../shared";
import { createInMemoryEngineUnitOfWork } from "./in-memory-unit-of-work";

const scope = { scope_id: "tenant-a", scope_kind: "ORGANIZATION" as const };
const context: RequestContext = {
  request_id: "request-1",
  correlation_id: "correlation-1",
  actor_ref: { principal_id: "user-1", principal_kind: "USER" },
  scope_ref: scope,
  issued_at: "2026-11-15T10:00:00Z",
  idempotency_key: "command-1",
};
const ref: ObjectRef = {
  object_kind: "WORK",
  object_id: "work-1",
  object_version: "1",
  scope_ref: scope,
};


function incomingEvent(event_id: string): InboxEventEnvelope {
  const aggregateRef: ObjectRef = {
    object_kind: "WORK_GRAPH",
    object_id: "graph-1",
    object_version: "1",
    scope_ref: scope,
  };
  return {
    event_id,
    event_type: "planning.graph_validated",
    schema_version: 1,
    occurred_at: "2026-11-15T10:00:01Z",
    producer_engine: "INV-03",
    object_ref: {
      object_kind: "WORK_GRAPH_REVISION",
      object_id: `graph-revision-${event_id}`,
      object_version: "1",
      scope_ref: scope,
    },
    aggregate_ref: aggregateRef,
    aggregate_version: 1,
    scope_ref: scope,
    correlation_id: context.correlation_id,
    payload: { validation_status: "VALIDATED" },
  };
}

describe("In-memory Unit of Work reference conformance", () => {
  it("commits repository, idempotency and outbox writes together on success", async () => {
    const unit = createInMemoryEngineUnitOfWork();
    const outcome = await unit.execute<{ title: string }>(context, async (tx) => {
      const created = await tx.repository<{ title: string }>("work").create(
        context,
        ref,
        { title: "Prepare proposal" },
      );
      if (created.status !== "OK") return created;
      const idempotency = await tx.idempotency.record(context, {
        idempotency_key: "command-1",
        request_fingerprint: "sha256:request-one",
        result: created,
        recorded_at: "2026-11-15T10:00:01Z",
      });
      if (idempotency.status !== "OK") return createOperationResult<{ title: string }>({ status: idempotency.status, correlation_id: context.correlation_id, errors: idempotency.errors, warnings: idempotency.warnings });
      const outbox = await tx.outbox.append(context, {
        event_id: "event-1",
        event_type: "work.created",
        schema_version: 1,
        occurred_at: "2026-11-15T10:00:01Z",
        producer_engine: "INV-02",
        object_ref: ref,
        scope_ref: scope,
        correlation_id: context.correlation_id,
        payload: { work_id: "work-1" },
      });
      return outbox.status === "OK" ? created : createOperationResult<{ title: string }>({ status: outbox.status, correlation_id: context.correlation_id, errors: outbox.errors, warnings: outbox.warnings });
    });

    expect(outcome.status).toBe("OK");
    expect(unit.snapshot()).toEqual({
      repository_records: 1,
      append_only_records: 0,
      idempotency_records: 1,
      inbox_records: 0,
      outbox_records: 1,
    });
  });

  it("rolls back every staged write when command is rejected", async () => {
    const unit = createInMemoryEngineUnitOfWork();
    const outcome = await unit.execute(context, async (tx) => {
      await tx.repository<{ title: string }>("work").create(context, ref, {
        title: "Must not persist",
      });
      await tx.outbox.append(context, {
        event_id: "event-rejected",
        event_type: "work.created",
        schema_version: 1,
        occurred_at: "2026-11-15T10:00:01Z",
        producer_engine: "INV-02",
        object_ref: ref,
        scope_ref: scope,
        correlation_id: context.correlation_id,
        payload: {},
      });
      return {
        status: "REJECTED" as const,
        correlation_id: context.correlation_id,
        errors: [],
        warnings: [],
      };
    });

    expect(outcome.status).toBe("REJECTED");
    expect(unit.snapshot()).toEqual({
      repository_records: 0,
      append_only_records: 0,
      idempotency_records: 0,
      inbox_records: 0,
      outbox_records: 0,
    });
  });

  it("does not commit when the command outcome is unknown", async () => {
    const unit = createInMemoryEngineUnitOfWork();
    const outcome = await unit.execute(context, async (tx) => {
      await tx.repository<{ title: string }>("work").create(context, ref, {
        title: "Unknown outcome",
      });
      return {
        status: "UNKNOWN" as const,
        correlation_id: context.correlation_id,
        errors: [],
        warnings: [],
      };
    });

    expect(outcome.status).toBe("UNKNOWN");
    expect(unit.snapshot().repository_records).toBe(0);
  });

  it("returns UNKNOWN and rolls back when the command throws", async () => {
    const unit = createInMemoryEngineUnitOfWork();
    const outcome = await unit.execute(context, async (tx) => {
      await tx.repository<{ title: string }>("work").create(context, ref, {
        title: "Thrown command",
      });
      throw new Error("simulated failure");
    });

    expect(outcome.status).toBe("UNKNOWN");
    expect(unit.snapshot().repository_records).toBe(0);
    expect(outcome.errors[0]?.code).toBe("OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED");
  });
  it("commits Inbox, domain mutation, idempotency and Outbox atomically", async () => {
    const unit = createInMemoryEngineUnitOfWork();
    const incoming = incomingEvent("incoming-atomic");
    const outcome = await unit.execute(context, async (tx) => {
      const received = await tx.inbox!.accept(context, "work-activation-v1", incoming);
      if (received.status !== "OK") {
        return createOperationResult({
          status: "REJECTED",
          correlation_id: context.correlation_id,
          errors: received.errors,
        });
      }
      const saved = await tx.repository<{ active_graph_id: string }>("work").create(
        context,
        ref,
        { active_graph_id: "graph-1" },
      );
      if (saved.status !== "OK") return saved;
      const emitted = await tx.outbox.append(context, {
        event_id: "outgoing-atomic",
        event_type: "work.graph_activation_requested",
        schema_version: 1,
        occurred_at: "2026-11-15T10:00:02Z",
        producer_engine: "INV-02",
        object_ref: ref,
        scope_ref: scope,
        correlation_id: context.correlation_id,
        payload: { incoming_event_id: received.data?.event_id },
      });
      if (emitted.status !== "OK") {
        return createOperationResult({
          status: "REJECTED",
          correlation_id: context.correlation_id,
          errors: emitted.errors,
        });
      }
      const recorded = await tx.idempotency.record(context, {
        idempotency_key: "activate-graph-atomic",
        request_fingerprint: "fingerprint-atomic",
        result: saved,
        recorded_at: "2026-11-15T10:00:02Z",
      });
      return recorded.status === "OK" ? saved : createOperationResult({
        status: "REJECTED",
        correlation_id: context.correlation_id,
        errors: recorded.errors,
      });
    });

    expect(outcome.status).toBe("OK");
    expect(unit.snapshot()).toEqual({
      repository_records: 1,
      append_only_records: 0,
      idempotency_records: 1,
      inbox_records: 1,
      outbox_records: 1,
    });
  });

  it("rolls Inbox receipt back when a later step rejects, so redelivery is accepted", async () => {
    const unit = createInMemoryEngineUnitOfWork();
    const incoming = incomingEvent("incoming-rollback");
    const rejected = await unit.execute(context, async (tx) => {
      const received = await tx.inbox!.accept(context, "work-activation-v1", incoming);
      expect(received.status).toBe("OK");
      await tx.repository<{ active_graph_id: string }>("work").create(
        context,
        ref,
        { active_graph_id: "must-rollback" },
      );
      return createOperationResult({
        status: "REJECTED",
        correlation_id: context.correlation_id,
      });
    });

    expect(rejected.status).toBe("REJECTED");
    expect(unit.snapshot()).toEqual({
      repository_records: 0,
      append_only_records: 0,
      idempotency_records: 0,
      inbox_records: 0,
      outbox_records: 0,
    });

    const replay = await unit.execute(context, (tx) =>
      tx.inbox!.accept(context, "work-activation-v1", incoming),
    );
    expect(replay.status).toBe("OK");
    expect(replay.data?.disposition).toBe("ACCEPTED");
    expect(unit.snapshot().inbox_records).toBe(1);
  });

  it("serializes concurrent delivery so only one Inbox receipt is stored", async () => {
    const unit = createInMemoryEngineUnitOfWork();
    const incoming = incomingEvent("incoming-concurrent");
    const deliver = () => unit.execute(context, (tx) =>
      tx.inbox!.accept(context, "work-activation-v1", incoming),
    );
    const [first, second] = await Promise.all([deliver(), deliver()]);

    expect([first.data?.disposition, second.data?.disposition].sort()).toEqual([
      "ACCEPTED",
      "DUPLICATE",
    ]);
    expect(unit.snapshot().inbox_records).toBe(1);
  });


  it("stores append-only records by explicit identity and reads them back", async () => {
    const unit = createInMemoryEngineUnitOfWork();
    const revisionRef: ObjectRef = {
      object_kind: "WORK_REVISION",
      object_id: "work-1:r2",
      object_version: "2",
      scope_ref: scope,
    };
    const appended = await unit.execute(context, async (tx) =>
      tx.appendOnly<{ revision_ref: ObjectRef; revision_number: number }>("work-revisions")
        .append(context, revisionRef, { revision_ref: revisionRef, revision_number: 2 }),
    );
    expect(appended.status).toBe("OK");

    const read = await unit.execute(context, (tx) =>
      tx.appendOnly<{ revision_ref: ObjectRef; revision_number: number }>("work-revisions")
        .get(context, revisionRef),
    );
    expect(read.status).toBe("OK");
    expect(read.data?.revision_number).toBe(2);
    expect(unit.snapshot().append_only_records).toBe(1);
  });

  it("rejects duplicate append-only identities without replacing the original", async () => {
    const unit = createInMemoryEngineUnitOfWork();
    const repository = () => unit.execute(context, (tx) =>
      tx.appendOnly<{ revision_ref: ObjectRef; note: string }>("work-revisions")
        .append(context, ref, { revision_ref: ref, note: "original" }),
    );
    expect((await repository()).status).toBe("OK");
    const duplicate = await repository();
    expect(duplicate.status).toBe("REJECTED");
    expect(duplicate.errors[0]?.code).toBe("VERSION_CONFLICT");

    const read = await unit.execute(context, (tx) =>
      tx.appendOnly<{ revision_ref: ObjectRef; note: string }>("work-revisions")
        .get(context, ref),
    );
    expect(read.data?.note).toBe("original");
    expect(unit.snapshot().append_only_records).toBe(1);
  });

  it("rejects append-only writes and reads outside the request scope", async () => {
    const unit = createInMemoryEngineUnitOfWork();
    const otherScopeRef: ObjectRef = {
      ...ref,
      scope_ref: { scope_id: "tenant-b", scope_kind: "ORGANIZATION" },
    };
    const write = await unit.execute(context, (tx) =>
      tx.appendOnly<{ note: string }>("private-records")
        .append(context, otherScopeRef, { note: "must not persist" }),
    );
    expect(write.status).toBe("REJECTED");

    const read = await unit.execute(context, (tx) =>
      tx.appendOnly<{ note: string }>("private-records").get(context, otherScopeRef),
    );
    expect(read.status).toBe("REJECTED");
    expect(unit.snapshot().append_only_records).toBe(0);
  });

});
