import { describe, expect, it } from "vitest";
import {
  acceptOutcomeProposal,
  applyPlanGraphActivation,
  createWork,
  transitionWork,
  validateWorkClosure,
  type WorkRecord,
} from "./domain";
import type { ObjectRef, RequestContext } from "../shared";
import type { OutcomeProposal } from "../inv-01-intent/domain";

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
const authority = {
  decision_ref: ref("AUTHORITY_DECISION", "auth-1"),
  disposition: "ALLOWED" as const,
};
const makeWork = (): WorkRecord => {
  const result = createWork({
    context,
    work_ref: ref("WORK", "work-1"),
    origin_intent_ref: ref("INTENT", "intent-1"),
    owner_ref: ref("USER", "user-1"),
    title: "Website",
    summary: "Build a website",
    created_at: "2026-11-13T03:00:01Z",
  });
  if (!result.ok) throw new Error(result.issues[0].safe_message);
  return result.value;
};
const proposal: OutcomeProposal = {
  proposal_ref: ref("OUTCOME_PROPOSAL", "proposal-1"),
  intent_ref: ref("INTENT", "intent-1"),
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
  state: "SUBMITTED",
  created_at: "2026-11-13T03:00:02Z",
};

describe("INV-02 Work domain", () => {
  it("creates scoped Work as PROPOSED and requires idempotency", () => {
    const work = makeWork();
    expect(work.lifecycle_state).toBe("PROPOSED");
    expect(work.current_revision).toBe(1);
    expect(work.current_phase).toBe("INTAKE");
    expect(createWork({
      context: { ...context, idempotency_key: undefined },
      work_ref: ref("WORK", "work-2"),
      origin_intent_ref: ref("INTENT", "intent-1"),
      owner_ref: ref("USER", "user-1"),
      title: "x", summary: "y", created_at: "2026-11-13T03:00:01Z",
    }).ok).toBe(false);
  });

  it("rejects cross-scope references", () => {
    const otherScope = { scope_id: "scope-2", scope_kind: "WORK" as const };
    const result = createWork({
      context,
      work_ref: ref("WORK", "work-2"),
      origin_intent_ref: { ...ref("INTENT", "intent-1"), scope_ref: otherScope },
      owner_ref: ref("USER", "user-1"),
      title: "x", summary: "y", created_at: "2026-11-13T03:00:01Z",
    });
    expect(result.ok).toBe(false);
  });

  it("applies guarded lifecycle transitions with optimistic concurrency", () => {
    const work = makeWork();
    const command = {
      expected_version: 1,
      target_state: "READY" as const,
      reason_ref: ref("REASON", "ready"),
      occurred_at: "2026-11-13T03:01:00Z",
      authority,
      guards: {
        active_blocker_count: 0,
        prerequisites_satisfied: true,
        orchestrator_eligible: false,
        reconciliation_complete: true,
      },
    };
    const moved = transitionWork(work, command, context);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.work.lifecycle_state).toBe("READY");
    expect(moved.value.work.current_revision).toBe(2);
    expect(moved.value.revision.revision_number).toBe(2);
    expect(transitionWork(work, { ...command, expected_version: 0 }, context).ok).toBe(false);
  });

  it("does not enter READY while blockers remain or start without orchestrator eligibility", () => {
    const work = makeWork();
    const base = {
      expected_version: 1,
      reason_ref: ref("REASON", "reason"),
      occurred_at: "2026-11-13T03:01:00Z",
      authority,
      guards: {
        active_blocker_count: 1,
        prerequisites_satisfied: false,
        orchestrator_eligible: false,
        reconciliation_complete: false,
      },
    };
    expect(transitionWork(work, { ...base, target_state: "READY" }, context).ok).toBe(false);
    const ready = transitionWork(work, {
      ...base,
      target_state: "READY",
      guards: { ...base.guards, active_blocker_count: 0, prerequisites_satisfied: true },
    }, context);
    if (!ready.ok) return;
    expect(transitionWork(ready.value.work, {
      ...base,
      expected_version: 2,
      target_state: "IN_PROGRESS",
    }, context).ok).toBe(false);
  });

  it("keeps Work completion distinct from outcome success and enforces closure mapping", () => {
    expect(validateWorkClosure("COMPLETED", "NORMAL_FINISH")).toBe(true);
    expect(validateWorkClosure("COMPLETED", "TERMINAL_FAILURE")).toBe(false);
    const work = makeWork();
    const result = transitionWork(work, {
      expected_version: 1,
      target_state: "CANCELLED",
      reason_ref: ref("REASON", "cancel"),
      occurred_at: "2026-11-13T03:02:00Z",
      authority,
      guards: {
        active_blocker_count: 0,
        prerequisites_satisfied: true,
        orchestrator_eligible: false,
        reconciliation_complete: false,
      },
      closure_disposition: "CANCELLED_BY_AUTHORIZED_ACTOR",
      closure_reason: "User cancelled",
    }, context);
    expect(result.ok).toBe(true);
  });

  it("accepts an outcome proposal only with matching basis and authority evidence", () => {
    const work = makeWork();
    const result = acceptOutcomeProposal({
      context,
      work,
      proposal,
      desired_outcome_ref: ref("WORK_DESIRED_OUTCOME_REVISION", "target-1"),
      receipt_ref: ref("OUTCOME_ACCEPTANCE_RECEIPT", "receipt-1"),
      acceptance_basis: "EXPLICIT_USER_CONFIRMATION",
      acceptance_basis_ref: ref("USER_CONFIRMATION", "confirmation-1"),
      accepted_by: context.actor_ref,
      accepted_at: "2026-11-13T03:03:00Z",
      expected_work_version: 1,
      authority,
      has_material_unresolved_unknowns: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.work.current_revision).toBe(2);
    expect(result.value.work.current_desired_outcome_ref).toEqual(ref("WORK_DESIRED_OUTCOME_REVISION", "target-1"));
    expect(result.value.receipt.acceptance_state).toBe("ACCEPTED");
  });

  it("rejects outcome evidence that crosses scope or changes the originating intent version", () => {
    const work = makeWork();
    const crossScope = { scope_id: "scope-2", scope_kind: "WORK" as const };

    expect(acceptOutcomeProposal({
      context,
      work,
      proposal: {
        ...proposal,
        intent_ref: ref("INTENT", "intent-1", "2"),
      },
      desired_outcome_ref: ref("WORK_DESIRED_OUTCOME_REVISION", "target-2"),
      receipt_ref: ref("OUTCOME_ACCEPTANCE_RECEIPT", "receipt-2"),
      acceptance_basis: "EXPLICIT_USER_CONFIRMATION",
      acceptance_basis_ref: ref("USER_CONFIRMATION", "confirmation-2"),
      accepted_by: context.actor_ref,
      accepted_at: "2026-11-13T03:03:00Z",
      expected_work_version: 1,
      authority,
      has_material_unresolved_unknowns: false,
    }).ok).toBe(false);

    expect(acceptOutcomeProposal({
      context,
      work,
      proposal,
      desired_outcome_ref: {
        ...ref("WORK_DESIRED_OUTCOME_REVISION", "target-3"),
        scope_ref: crossScope,
      },
      receipt_ref: ref("OUTCOME_ACCEPTANCE_RECEIPT", "receipt-3"),
      acceptance_basis: "EXPLICIT_USER_CONFIRMATION",
      acceptance_basis_ref: ref("USER_CONFIRMATION", "confirmation-3"),
      accepted_by: context.actor_ref,
      accepted_at: "2026-11-13T03:03:00Z",
      expected_work_version: 1,
      authority,
      has_material_unresolved_unknowns: false,
    }).ok).toBe(false);
  });

  it("blocks policy interpretation with unresolved uncertainty and rejects mismatched basis refs", () => {
    const work = makeWork();
    const base = {
      context, work, proposal,
      desired_outcome_ref: ref("WORK_DESIRED_OUTCOME_REVISION", "target-1"),
      receipt_ref: ref("OUTCOME_ACCEPTANCE_RECEIPT", "receipt-1"),
      acceptance_basis: "POLICY_PERMITTED_INTERPRETATION" as const,
      acceptance_basis_ref: ref("POLICY_DECISION", "policy-1"),
      accepted_at: "2026-11-13T03:03:00Z",
      expected_work_version: 1,
      authority,
    };
    expect(acceptOutcomeProposal({
      ...base,
      has_material_unresolved_unknowns: true,
    }).ok).toBe(false);
    expect(acceptOutcomeProposal({
      ...base,
      acceptance_basis_ref: ref("USER_CONFIRMATION", "wrong-basis"),
      has_material_unresolved_unknowns: false,
    }).ok).toBe(false);
  });

  it("requires an exact accepted Plan/Graph binding receipt and reconciles UNKNOWN", () => {
    const work = makeWork();
    const receipt = {
      receipt_ref: ref("PLAN_GRAPH_ACTIVATION_RECEIPT", "activation-1"),
      work_ref: work.work_ref,
      plan_revision_ref: ref("PLAN_REVISION", "plan-r1"),
      graph_revision_ref: ref("WORK_GRAPH_REVISION", "graph-r1"),
      expected_work_revision: 1,
      resulting_work_revision: 2,
      receipt_state: "ACCEPTED" as const,
      received_at: "2026-11-13T03:04:00Z",
    };
    const applied = applyPlanGraphActivation(work, receipt, 1);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.value.current_plan_ref).toEqual(receipt.plan_revision_ref);
      expect(applied.value.current_work_graph_ref).toEqual(receipt.graph_revision_ref);
    }
    expect(applyPlanGraphActivation(work, { ...receipt, receipt_state: "UNKNOWN" }, 1).ok).toBe(false);
  });
});
