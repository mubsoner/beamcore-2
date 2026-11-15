import { describe, expect, it } from "vitest";
import type { ObjectRef, RequestContext } from "../../shared";
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

describe("In-memory Unit of Work reference conformance", () => {
  it("commits repository, idempotency and outbox writes together on success", async () => {
    const unit = createInMemoryEngineUnitOfWork();
    const outcome = await unit.execute(context, async (tx) => {
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
      if (idempotency.status !== "OK") return idempotency;
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
      return outbox.status === "OK" ? created : outbox;
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
});
