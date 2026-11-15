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
import { getDecision, getNormalizedIntent, submitIntent, type SubmitIntentCommand } from "./application";
import type { IntentEvaluationResult } from "./domain";

const scope = { scope_id: "scope-1", scope_kind: "WORK" as const };
const context: RequestContext = {
  request_id: "req-1",
  correlation_id: "corr-1",
  actor_ref: { principal_id: "user-1", principal_kind: "USER" },
  scope_ref: scope,
  issued_at: "2026-11-13T03:00:00Z",
  idempotency_key: "idem-1",
};
const ref = (object_kind: string, object_id: string, object_version = "1"): ObjectRef => ({
  object_kind, object_id, object_version, scope_ref: scope,
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
  requested_work_kind: "INFORMATIONAL",
  desired_effect_summary: "A sourced comparison",
  explicit_requirements: [],
  contextual_facts: [],
  assumptions: [],
  unknowns: [],
  ambiguity_items: [],
  created_at: "2026-11-13T03:00:01Z",
  decision_ref: ref("DECISION_RECORD", "decision-1"),
  disposition: "ANSWER_DIRECTLY",
  rationale_summary: "The request is bounded and informational.",
  event_refs: {
    intent_normalized: ref("DOMAIN_EVENT", "event-intent-1"),
    decision_recorded: ref("DOMAIN_EVENT", "event-decision-1"),
  },
  request_fingerprint: "a".repeat(64),
};

function makeUnitOfWork() {
  const idempotency = new Map<string, IdempotencyRecord<IntentEvaluationResult>>();
  const stored = new Map<string, unknown>();
  const outboxEvents: unknown[] = [];
  const repo: VersionedRepository<unknown> = {
    get: vi.fn(async (_ctx, objectRef) => {
      const value = stored.get(objectRef.object_id);
      if (value === undefined) {
        return createOperationResult<unknown>({
          status: "REJECTED", correlation_id: context.correlation_id,
        });
      }
      return createOperationResult({
        status: "OK", correlation_id: context.correlation_id,
        data: value, object_version: objectRef.object_version ?? "1",
      });
    }),
    create: vi.fn(async (_ctx, objectRef, value) => {
      stored.set(objectRef.object_id, value);
      return createOperationResult({
        status: "OK", correlation_id: context.correlation_id, data: value,
        object_version: objectRef.object_version,
      });
    }),
    update: vi.fn(async () => createOperationResult<unknown>({
      status: "REJECTED", correlation_id: context.correlation_id,
    })),
  };
  const tx: EngineTransaction = {
    repository: <T>() => repo as VersionedRepository<T>,
    appendOnly: <T>() => ({
      append: vi.fn(async () => createOperationResult<T>({
        status: "OK", correlation_id: context.correlation_id,
      })),
      get: vi.fn(async () => createOperationResult<T>({
        status: "REJECTED", correlation_id: context.correlation_id,
      })),
    }),
    idempotency: {
      get: vi.fn(async <T>(_ctx: RequestContext, key: string): Promise<OperationResult<IdempotencyRecord<T> | null>> => {
        const record = idempotency.get(key) as IdempotencyRecord<T> | undefined;
        return createOperationResult<IdempotencyRecord<T> | null>({
          status: "OK", correlation_id: context.correlation_id, data: record ?? null,
        });
      }) as EngineTransaction["idempotency"]["get"],
      record: vi.fn(async <T>(_ctx: RequestContext, record: IdempotencyRecord<T>): Promise<OperationResult<IdempotencyRecord<T>>> => {
        idempotency.set(record.idempotency_key, record as IdempotencyRecord<IntentEvaluationResult>);
        return createOperationResult<IdempotencyRecord<T>>({
          status: "OK", correlation_id: context.correlation_id, data: record,
        });
      }) as EngineTransaction["idempotency"]["record"],
    },
    outbox: {
      append: vi.fn(async (_ctx, event) => {
        outboxEvents.push(event);
        return createOperationResult({
          status: "OK", correlation_id: context.correlation_id, data: { event_id: event.event_id },
        });
      }),
    },
  };
  const unitOfWork: EngineUnitOfWorkPort = {
    execute: async <T>(_ctx: RequestContext, callback: (transaction: EngineTransaction) => Promise<OperationResult<T>>) =>
      callback(tx),
  };
  return { unitOfWork, tx, repo, stored, idempotency, outboxEvents };
}

describe("INV-01 submitIntent application use case", () => {
  it("persists a complete IntentEvaluationResult, DecisionRecord, outbox facts and idempotency result", async () => {
    const { unitOfWork, tx, repo, stored, idempotency, outboxEvents } = makeUnitOfWork();
    const result = await submitIntent(unitOfWork, command);
    expect(result.status).toBe("OK");
    expect(result.data?.normalized_intent.lifecycle_state).toBe("READY_FOR_DECISION");
    expect(result.data?.decision_record.disposition).toBe("ANSWER_DIRECTLY");
    expect(stored.has("intent-1")).toBe(true);
    expect(stored.has("decision-1")).toBe(true);
    expect(repo.create).toHaveBeenCalledTimes(2);
    expect(tx.outbox.append).toHaveBeenCalledTimes(2);
    expect(outboxEvents).toHaveLength(2);
    expect(tx.idempotency.record).toHaveBeenCalledTimes(1);
    expect(idempotency.has("idem-1")).toBe(true);
  });

  it("persists a clarification request and keeps the decision awaiting clarification", async () => {
    const { unitOfWork, stored, outboxEvents } = makeUnitOfWork();
    const clarificationCommand: SubmitIntentCommand = {
      ...command,
      context: { ...context, idempotency_key: "idem-clarify" },
      intent_ref: ref("INTENT", "intent-clarify"),
      decision_ref: ref("DECISION_RECORD", "decision-clarify"),
      disposition: "CLARIFY",
      ambiguity_items: [{
        ambiguity_id: "deployment-target",
        description: "The deployment target changes security and release setup.",
        plausible_interpretations: ["Vercel", "Another provider"],
        materiality: "MATERIAL",
        clarification_required: true,
      }],
      clarification: {
        clarification_ref: ref("CLARIFICATION_REQUEST", "clarification-1"),
        question: "Which deployment target should be used?",
        decision_impact: "The target changes release and security requirements.",
        required_field_ids: ["deployment_target"],
      },
      event_refs: {
        intent_normalized: ref("DOMAIN_EVENT", "event-intent-clarify"),
        decision_recorded: ref("DOMAIN_EVENT", "event-decision-clarify"),
        clarification_requested: ref("DOMAIN_EVENT", "event-clarification"),
      },
    };
    const result = await submitIntent(unitOfWork, clarificationCommand);
    expect(result.status).toBe("OK");
    expect(result.data?.normalized_intent.lifecycle_state).toBe("AWAITING_CLARIFICATION");
    expect(result.data?.decision_record.state).toBe("AWAITING_CLARIFICATION");
    expect(result.data?.clarification_request?.state).toBe("OPEN");
    expect(stored.has("clarification-1")).toBe(true);
    expect(outboxEvents).toHaveLength(3);
  });

  it("requires a clarification record when material ambiguity is present", async () => {
    const { unitOfWork, repo } = makeUnitOfWork();
    const result = await submitIntent(unitOfWork, {
      ...command,
      ambiguity_items: [{
        ambiguity_id: "material",
        description: "The requested action has two materially different interpretations.",
        plausible_interpretations: ["A", "B"],
        materiality: "CRITICAL",
        clarification_required: true,
      }],
    });
    expect(result.status).toBe("REJECTED");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("persists an OutcomeProposal without making an authoritative Work target", async () => {
    const { unitOfWork, stored, outboxEvents } = makeUnitOfWork();
    const proposalCommand: SubmitIntentCommand = {
      ...command,
      context: { ...context, idempotency_key: "idem-outcome" },
      intent_ref: ref("INTENT", "intent-outcome"),
      decision_ref: ref("DECISION_RECORD", "decision-outcome"),
      outcome_proposal: {
        proposal_ref: ref("OUTCOME_PROPOSAL", "proposal-1"),
        proposal_revision: 1,
        desired_effect: "A verified database comparison",
        acceptance_criteria: [{
          criterion_id: "source-backed",
          description: "Comparison claims are supported by credible sources.",
          evaluation_kind: "CONTENT_REVIEW",
          evaluation_method: "Review cited sources and claims.",
          expected_result: "Each material claim has supporting citations.",
          evidence_required: true,
          importance: "MUST",
        }],
        assumption_refs: [],
        unresolved_criterion_refs: [],
      },
      event_refs: {
        intent_normalized: ref("DOMAIN_EVENT", "event-intent-outcome"),
        decision_recorded: ref("DOMAIN_EVENT", "event-decision-outcome"),
        outcome_proposal_created: ref("DOMAIN_EVENT", "event-outcome-proposal"),
      },
    };
    const result = await submitIntent(unitOfWork, proposalCommand);
    expect(result.status).toBe("OK");
    expect(result.data?.outcome_proposal?.state).toBe("SUBMITTED");
    expect(stored.has("proposal-1")).toBe(true);
    expect(outboxEvents).toHaveLength(3);
    expect(stored.has("work-1")).toBe(false);
  });

  it("persists a typed route proposal without claiming that the recipient accepted it", async () => {
    const { unitOfWork, stored, outboxEvents } = makeUnitOfWork();
    const routeCommand: SubmitIntentCommand = {
      ...command,
      context: { ...context, idempotency_key: "idem-route" },
      intent_ref: ref("INTENT", "intent-route"),
      decision_ref: ref("DECISION_RECORD", "decision-route"),
      disposition: "RESEARCH",
      requested_work_kind: "RESEARCH",
      route_proposal: {
        route_ref: ref("ROUTE_PROPOSAL", "route-1"),
        target_engine_id: "INV-13",
        target_operation: "submit_research_request",
        input_refs: [ref("INTENT", "intent-route")],
        required_authority_check: false,
      },
      event_refs: {
        intent_normalized: ref("DOMAIN_EVENT", "event-intent-route"),
        decision_recorded: ref("DOMAIN_EVENT", "event-decision-route"),
        route_selected: ref("DOMAIN_EVENT", "event-route-selected"),
      },
    };
    const result = await submitIntent(unitOfWork, routeCommand);
    expect(result.status).toBe("OK");
    expect(stored.has("route-1")).toBe(true);
    expect(result.data?.decision_record.state).toBe("ROUTE_SELECTED");
    expect(outboxEvents).toHaveLength(3);
  });

  it("returns the original evaluation result on identical replay", async () => {
    const { unitOfWork, repo, tx } = makeUnitOfWork();
    const first = await submitIntent(unitOfWork, command);
    const second = await submitIntent(unitOfWork, command);
    expect(first.status).toBe("OK");
    expect(second).toEqual(first);
    expect(repo.create).toHaveBeenCalledTimes(2);
    expect(tx.outbox.append).toHaveBeenCalledTimes(2);
  });

  it("rejects idempotency-key reuse with a different fingerprint", async () => {
    const { unitOfWork, repo } = makeUnitOfWork();
    await submitIntent(unitOfWork, command);
    const result = await submitIntent(unitOfWork, {
      ...command,
      request_fingerprint: "b".repeat(64),
    });
    expect(result.status).toBe("REJECTED");
    expect(result.errors[0]?.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(repo.create).toHaveBeenCalledTimes(2);
  });

  it("rejects out-of-scope event references before persistence", async () => {
    const { unitOfWork, repo } = makeUnitOfWork();
    const result = await submitIntent(unitOfWork, {
      ...command,
      event_refs: {
        ...command.event_refs,
        decision_recorded: {
          ...ref("DOMAIN_EVENT", "foreign-event"),
          scope_ref: { scope_id: "scope-foreign", scope_kind: "WORK" },
        },
      },
    });
    expect(result.status).toBe("REJECTED");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only idempotency key before persistence", async () => {
    const { unitOfWork, repo } = makeUnitOfWork();
    const result = await submitIntent(unitOfWork, {
      ...command,
      context: { ...context, idempotency_key: "   " },
    });
    expect(result.status).toBe("REJECTED");
    expect(repo.create).not.toHaveBeenCalled();
  });
}

  it("reads the persisted normalized Intent and Decision through their scoped owners", async () => {
    const { unitOfWork, repo } = makeUnitOfWork();
    const submitted = await submitIntent(unitOfWork, command);
    expect(submitted.status).toBe("OK");
    if (submitted.status !== "OK" || !submitted.data) return;

    const intent = await getNormalizedIntent(
      unitOfWork, context, submitted.data.normalized_intent.intent_ref,
    );
    const decision = await getDecision(
      unitOfWork, context, submitted.data.decision_record.decision_ref,
    );

    expect(intent.status).toBe("OK");
    expect(intent.data?.intent_ref).toEqual(submitted.data.normalized_intent.intent_ref);
    expect(intent.object_version).toBe("1");
    expect(decision.status).toBe("OK");
    expect(decision.data?.decision_ref).toEqual(submitted.data.decision_record.decision_ref);
    expect(decision.object_version).toBe("1");
    expect(repo.get).toHaveBeenCalledTimes(2);
  });

  it("rejects cross-scope reads before querying the repository", async () => {
    const { unitOfWork, repo } = makeUnitOfWork();
    const foreignIntent = {
      ...ref("INTENT", "foreign-intent"),
      scope_ref: { scope_id: "scope-foreign", scope_kind: "WORK" as const },
    };
    const result = await getNormalizedIntent(unitOfWork, context, foreignIntent);
    expect(result.status).toBe("REJECTED");
    expect(result.errors[0]?.code).toBe("VALIDATION_ERROR");
    expect(repo.get).not.toHaveBeenCalled();
  });

  it("rejects a repository response whose record identity does not match the requested reference", async () => {
    const { unitOfWork, stored } = makeUnitOfWork();
    const submitted = await submitIntent(unitOfWork, command);
    expect(submitted.status).toBe("OK");
    if (submitted.status !== "OK" || !submitted.data) return;

    stored.set("intent-tampered", {
      ...submitted.data.normalized_intent,
      intent_ref: ref("INTENT", "another-intent"),
    });
    const result = await getNormalizedIntent(
      unitOfWork, context, ref("INTENT", "intent-tampered"),
    );
    expect(result.status).toBe("REJECTED");
    expect(result.errors[0]?.code).toBe("INTEGRITY_OR_UNTRUSTED_INPUT");
  });

});
