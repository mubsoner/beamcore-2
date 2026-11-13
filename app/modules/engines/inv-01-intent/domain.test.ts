import { describe, expect, it } from "vitest";
import {
  applyOutcomeAcceptanceReceipt,
  canSelectRoute,
  createOutcomeProposal,
  normalizeIntent,
  reviseIntent,
  transitionIntent,
  type NormalizeIntentInput,
} from "./domain";
import type { ObjectRef, RequestContext } from "../shared";

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
  object_kind,
  object_id,
  object_version,
  scope_ref: scope,
});
const baseInput = (): NormalizeIntentInput => ({
  context,
  request: {
    raw_input: "Build a small website",
    input_source_refs: [],
    requested_context_refs: [],
    explicit_constraints: [],
    received_at: "2026-11-13T03:00:00Z",
  },
  intent_ref: ref("INTENT", "intent-1"),
  revision_number: 1,
  user_goal_summary: "Build a small website",
  requested_work_kind: "CREATION",
  desired_effect_summary: "A working website",
  explicit_requirements: [],
  contextual_facts: [],
  assumptions: [],
  unknowns: [],
  ambiguity_items: [],
  created_at: "2026-11-13T03:00:01Z",
});

describe("INV-01 intent domain", () => {
  it("normalizes a clear intent without inventing criteria", () => {
    const result = normalizeIntent(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lifecycle_state).toBe("NORMALIZED");
    expect(result.value.explicit_requirements).toEqual([]);
    expect(result.value.source_refs).toEqual([]);
  });

  it("requires clarification for material ambiguity and unresolved unknowns", () => {
    const input = baseInput();
    input.ambiguity_items = [{
      ambiguity_id: "amb-1",
      description: "Which deployment target?",
      plausible_interpretations: ["Cloudflare", "Vercel"],
      materiality: "MATERIAL",
      clarification_required: true,
    }];
    const result = normalizeIntent(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lifecycle_state).toBe("AWAITING_CLARIFICATION");
    expect(canSelectRoute("CREATE", result.value).ok).toBe(false);
    expect(canSelectRoute("CLARIFY", result.value).ok).toBe(true);
  });

  it("rejects invalid scope and noncanonical references", () => {
    const input = baseInput();
    input.intent_ref = {
      engineId: "INV-01",
      kind: "INTENT",
      id: "intent-1",
      scope: scope,
    } as unknown as ObjectRef;
    const result = normalizeIntent(input);
    expect(result.ok).toBe(false);
  });

  it("creates a new revision linked to the prior intent", () => {
    const first = normalizeIntent(baseInput());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const next = baseInput();
    next.intent_ref = ref("INTENT", "intent-1", "2");
    next.revision_number = 2;
    const revised = reviseIntent(first.value, next);
    expect(revised.ok).toBe(true);
    if (!revised.ok) return;
    expect(revised.value.prior_revision_ref).toEqual(first.value.intent_ref);
    expect(revised.value.revision_number).toBe(2);
  });

  it("rejects skipped revisions and terminal lifecycle reopening", () => {
    const first = normalizeIntent(baseInput());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const next = baseInput();
    next.intent_ref = ref("INTENT", "intent-1", "3");
    next.revision_number = 3;
    expect(reviseIntent(first.value, next).ok).toBe(false);
    expect(transitionIntent(first.value, "WITHDRAWN").ok).toBe(true);
    const withdrawn = transitionIntent(first.value, "WITHDRAWN");
    if (!withdrawn.ok) return;
    expect(transitionIntent(withdrawn.value, "READY_FOR_DECISION").ok).toBe(false);
  });

  it("creates only a draft proposal when acceptance criteria remain unresolved", () => {
    const intent = normalizeIntent(baseInput());
    expect(intent.ok).toBe(true);
    if (!intent.ok) return;
    const result = createOutcomeProposal({
      proposal_ref: ref("OUTCOME_PROPOSAL", "proposal-1"),
      intent: intent.value,
      proposal_revision: 1,
      desired_effect: "A deployed website",
      acceptance_criteria: [],
      assumption_refs: [],
      unresolved_criterion_refs: [ref("UNRESOLVED_CRITERION", "criterion-1")],
      created_at: "2026-11-13T03:00:02Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toBe("DRAFT");
  });

  it("applies only an authoritative Work acceptance receipt", () => {
    const normalized = normalizeIntent(baseInput());
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const ready = transitionIntent(normalized.value, "READY_FOR_DECISION");
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    const intent = ready;
    const proposal = createOutcomeProposal({
      proposal_ref: ref("OUTCOME_PROPOSAL", "proposal-1"),
      intent: intent.value,
      proposal_revision: 1,
      desired_effect: "A deployed website",
      acceptance_criteria: [{
        criterion_id: "criterion-1",
        description: "Website is reachable",
        evaluation_kind: "EXTERNAL_STATE_CHECK",
        evaluation_method: "HTTP health check",
        expected_result: "HTTP 200",
        evidence_required: true,
        importance: "MUST",
      }],
      assumption_refs: [],
      unresolved_criterion_refs: [],
      created_at: "2026-11-13T03:00:02Z",
    });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.value.state).toBe("SUBMITTED");
    const applied = applyOutcomeAcceptanceReceipt(proposal.value, {
      receipt_ref: ref("OUTCOME_ACCEPTANCE_RECEIPT", "receipt-1"),
      proposal_ref: proposal.value.proposal_ref,
      work_ref: ref("WORK", "work-1"),
      acceptance_state: "ACCEPTED",
      acceptance_basis: "EXPLICIT_USER_CONFIRMATION",
      accepted_target_ref: ref("WORK_DESIRED_OUTCOME_REVISION", "target-1"),
      accepted_target_revision: 1,
      received_at: "2026-11-13T03:00:03Z",
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.state).toBe("ACCEPTED_BY_WORK");
    expect(applied.value.acceptance_receipt_ref).toEqual(ref("OUTCOME_ACCEPTANCE_RECEIPT", "receipt-1"));
  });
});
