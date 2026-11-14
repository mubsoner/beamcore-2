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
  acceptWorkOutcome,
  changeWorkState,
  submitWork,
  type AcceptWorkOutcomeApplicationCommand,
  type CreateWorkCommand,
  type TransitionWorkApplicationCommand,
} from "./application";
import type {
  AcceptOutcomeProposalResult,
  WorkDesiredOutcomeRevision,
  WorkRecord,
  WorkRevision,
} from "./domain";
import type { OutcomeProposal } from "../inv-01-intent/domain";

const scope = { scope_id: "scope-1", scope_kind: "WORK" as const };
const context: RequestContext = {
  request_id: "req-create",
  correlation_id: "corr-create",
  actor_ref: { principal_id: "user-1", principal_kind: "USER" },
  scope_ref: scope,
  issued_at: "2026-11-14T00:00:00Z",
  idempotency_key: "idem-create",
};
const ref = (object_kind: string, object_id: string, object_version = "1"): ObjectRef => ({
  object_kind,
  object_id,
  object_version,
  scope_ref: scope,
});

const outcomeProposal: OutcomeProposal = {
  proposal_ref: ref("OUTCOME_PROPOSAL", "proposal-1"),
  intent_ref: ref("INTENT", "intent-1"),
  proposal_revision: 1,
  desired_effect: "A customer portal is deployed",
  acceptance_criteria: [{
    criterion_id: "portal-reachable",
    description: "The portal responds to HTTP health checks",
    evaluation_kind: "EXTERNAL_STATE_CHECK",
    evaluation_method: "GET /health",
    expected_result: "HTTP 200",
    evidence_required: true,
    importance: "MUST",
  }],
  assumption_refs: [],
  unresolved_criterion_refs: [],
  state: "SUBMITTED",
  created_at: "2026-11-14T00:00:01Z",
};

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
  const receipts: AcceptOutcomeProposalResult["receipt"][] = [];
  const desiredOutcomes = new Map<string, WorkDesiredOutcomeRevision>();
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
        : createOperationResult<WorkRecord>({
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
        return createOperationResult<WorkRecord>({
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
      createOperationResult<WorkRevision>({
        status: "REJECTED",
        correlation_id: context.correlation_id,
        errors: [createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Revision was not found")],
      }),
  };

  const desiredOutcomeRepository: VersionedRepository<WorkDesiredOutcomeRevision> = {
    get: async (_context, objectRef) => {
      const value = desiredOutcomes.get(objectRef.object_id);
      return value
        ? createOperationResult({
            status: "OK",
            correlation_id: context.correlation_id,
            data: value,
            object_version: value.desired_outcome_ref.object_version,
          })
        : createOperationResult<WorkDesiredOutcomeRevision>({
            status: "REJECTED",
            correlation_id: context.correlation_id,
            errors: [createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Desired Outcome was not found")],
          });
    },
    create: async (_context, objectRef, value) => {
      if (desiredOutcomes.has(objectRef.object_id)) {
        return createOperationResult<WorkDesiredOutcomeRevision>({
          status: "REJECTED",
          correlation_id: context.correlation_id,
          errors: [createOperationError("VERSION_CONFLICT", "Desired Outcome revision already exists")],
        });
      }
      desiredOutcomes.set(objectRef.object_id, value);
      return createOperationResult({
        status: "OK",
        correlation_id: context.correlation_id,
        data: value,
        object_version: value.desired_outcome_ref.object_version,
      });
    },
    update: async (_context, objectRef, expectedVersion, value) => {
      const current = desiredOutcomes.get(objectRef.object_id);
      if (!current) {
        return createOperationResult<WorkDesiredOutcomeRevision>({
          status: "REJECTED",
          correlation_id: context.correlation_id,
          errors: [createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Desired Outcome was not found")],
        });
      }
      const currentVersion = current.desired_outcome_ref.object_version ?? String(current.revision_number);
      if (currentVersion !== expectedVersion) {
        return createOperationResult<WorkDesiredOutcomeRevision>({
          status: "REJECTED",
          correlation_id: context.correlation_id,
          errors: [createOperationError("VERSION_CONFLICT", "Desired Outcome revision changed")],
        });
      }
      desiredOutcomes.set(objectRef.object_id, value);
      return createOperationResult({
        status: "OK",
        correlation_id: context.correlation_id,
        data: value,
        object_version: value.desired_outcome_ref.object_version,
      });
    },
  };

  const receiptRepository: AppendOnlyRepository<AcceptOutcomeProposalResult["receipt"]> = {
    append: async (_context, receipt) => {
      receipts.push(receipt);
      return createOperationResult({
        status: "OK",
        correlation_id: context.correlation_id,
        data: receipt,
      });
    },
    get: async () =>
      createOperationResult<AcceptOutcomeProposalResult["receipt"]>({
        status: "REJECTED",
        correlation_id: context.correlation_id,
        errors: [createOperationError("NOT_FOUND_OR_NOT_VISIBLE", "Acceptance receipt was not found")],
      }),
  };

  const transaction: EngineTransaction = {
    repository: <T>(key: string) => {
      if (key === "inv-02.works") return workRepository as unknown as VersionedRepository<T>;
      if (key === "inv-02.desired-outcomes") return desiredOutcomeRepository as unknown as VersionedRepository<T>;
      throw new Error(`Unexpected repository: ${key}`);
    },
    appendOnly: <T>(key: string) => {
      if (key === "inv-02.work-revisions") return revisionRepository as unknown as AppendOnlyRepository<T>;
      if (key === "inv-02.outcome-acceptance-receipts") return receiptRepository as unknown as AppendOnlyRepository<T>;
      throw new Error(`Unexpected append-only repository: ${key}`);
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

  return { unitOfWork, works, revisions, receipts, desiredOutcomes, events, idempotency };
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

  it("accepts an outcome proposal and persists target, receipt, Work revision and event", async () => {
    const state = makeUnitOfWork();
    await submitWork(state.unitOfWork, createCommand);

    const command: AcceptWorkOutcomeApplicationCommand = {
      context: {
        ...context,
        request_id: "req-accept",
        correlation_id: "corr-accept",
        idempotency_key: "idem-accept",
      },
      work_ref: createCommand.work_ref,
      proposal: outcomeProposal,
      desired_outcome_ref: ref("WORK_DESIRED_OUTCOME_REVISION", "target-1"),
      receipt_ref: ref("OUTCOME_ACCEPTANCE_RECEIPT", "receipt-1"),
      acceptance_basis: "EXPLICIT_USER_CONFIRMATION",
      acceptance_basis_ref: ref("USER_CONFIRMATION", "confirmation-1"),
      accepted_by: context.actor_ref,
      accepted_at: "2026-11-14T00:00:04Z",
      expected_work_version: 1,
      authority: {
        decision_ref: ref("AUTHORITY_DECISION", "authority-accept"),
        disposition: "ALLOWED",
      },
      has_material_unresolved_unknowns: false,
      request_fingerprint: "e".repeat(64),
      event_ref: ref("DOMAIN_EVENT", "event-outcome-accepted"),
    };

    const result = await acceptWorkOutcome(state.unitOfWork, command);
    expect(result.status).toBe("OK");
    expect(result.data?.current_revision).toBe(2);
    expect(result.data?.current_desired_outcome_ref?.object_id).toBe("target-1");
    expect(state.desiredOutcomes.get("target-1")?.state).toBe("ACTIVE");
    expect(state.receipts).toHaveLength(1);
    expect(state.receipts[0].acceptance_state).toBe("ACCEPTED");
    expect(state.revisions).toHaveLength(2);
    expect(state.events[1].event_type).toBe("work.outcome_accepted");

    const replay = await acceptWorkOutcome(state.unitOfWork, command);
    expect(replay.status).toBe("OK");
    expect(state.receipts).toHaveLength(1);
    expect(state.revisions).toHaveLength(2);
    expect(state.events).toHaveLength(2);
  });

  it("supersedes the previous Desired Outcome revision on replacement", async () => {
    const state = makeUnitOfWork();
    await submitWork(state.unitOfWork, createCommand);

    const first: AcceptWorkOutcomeApplicationCommand = {
      context: { ...context, request_id: "req-outcome-1", idempotency_key: "idem-outcome-1" },
      work_ref: createCommand.work_ref,
      proposal: outcomeProposal,
      desired_outcome_ref: ref("WORK_DESIRED_OUTCOME_REVISION", "target-old", "1"),
      receipt_ref: ref("OUTCOME_ACCEPTANCE_RECEIPT", "receipt-old"),
      acceptance_basis: "EXPLICIT_USER_CONFIRMATION",
      acceptance_basis_ref: ref("USER_CONFIRMATION", "confirm-old"),
      accepted_by: context.actor_ref,
      accepted_at: "2026-11-14T00:00:04Z",
      expected_work_version: 1,
      authority: {
        decision_ref: ref("AUTHORITY_DECISION", "authority-old"),
        disposition: "ALLOWED",
      },
      has_material_unresolved_unknowns: false,
      request_fingerprint: "f".repeat(64),
      event_ref: ref("DOMAIN_EVENT", "event-outcome-old"),
    };
    const firstResult = await acceptWorkOutcome(state.unitOfWork, first);
    expect(firstResult.status).toBe("OK");

    const replacement: AcceptWorkOutcomeApplicationCommand = {
      context: {
        ...context,
        request_id: "req-outcome-2",
        idempotency_key: "idem-outcome-2",
      },
      work_ref: createCommand.work_ref,
      proposal: { ...outcomeProposal, proposal_ref: ref("OUTCOME_PROPOSAL", "proposal-2") },
      desired_outcome_ref: ref("WORK_DESIRED_OUTCOME_REVISION", "target-new", "2"),
      receipt_ref: ref("OUTCOME_ACCEPTANCE_RECEIPT", "receipt-new"),
      acceptance_basis: "EXISTING_APPROVED_REQUIREMENT",
      acceptance_basis_ref: ref("APPROVED_REQUIREMENT", "approved-requirement-1"),
      accepted_at: "2026-11-14T00:00:05Z",
      expected_work_version: 2,
      current_target_revision: 2,
      authority: {
        decision_ref: ref("AUTHORITY_DECISION", "authority-new"),
        disposition: "ALLOWED",
      },
      has_material_unresolved_unknowns: false,
      request_fingerprint: "1".repeat(64),
      event_ref: ref("DOMAIN_EVENT", "event-outcome-new"),
    };
    const replacementResult = await acceptWorkOutcome(state.unitOfWork, replacement);

    expect(replacementResult.status).toBe("OK");
    expect(state.desiredOutcomes.get("target-old")?.state).toBe("SUPERSEDED");
    expect(state.desiredOutcomes.get("target-new")?.state).toBe("ACTIVE");
    expect(state.desiredOutcomes.get("target-new")?.revision_number).toBe(2);
    expect(replacementResult.data?.current_revision).toBe(3);
    expect(state.receipts).toHaveLength(2);
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
