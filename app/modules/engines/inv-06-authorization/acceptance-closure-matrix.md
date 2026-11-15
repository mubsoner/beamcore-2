# INV-06 Acceptance Closure Matrix

**Source of truth:** `OMNI_INV01-INV21_AI_Implementation_Specifications_v2.9_INV01-21_Gap_Closure_Review`, INV-06 §14–§17.

**Purpose:** Track every required INV06-T01–T60 acceptance definition separately from unit-test coverage and provider/integration proof. This matrix is a gap register, not a declaration that the 60 acceptance tests have passed.

## Status meanings

- **TEST EXISTS** — a focused executable domain/application test exists in this branch. It counts as acceptance proof only after the exact current commit runs it successfully in CI and the required integration boundary is included.
- **LOGIC ONLY** — the provider-neutral rule/use case exists, but there is no dedicated test for the specific acceptance behavior yet.
- **INTEGRATION BLOCKER** — completion needs an actual provider, persistent repository, or another engine's enforcement/source adapter; a port or fake test adapter is not proof.
- **GAP** — required logical behavior or test is still missing/incomplete.

**Current engine test inventory:** 22 domain tests + 14 application tests = 36 focused INV-06 tests. The last fully-green Shared Foundation CI at commit `4e288b6a0c031add101d992d1bce4786ba90933f` ran 268/268 repository tests. The current branch head is newer; its CI must be checked separately before treating these latest changes as green.

## Acceptance status

| ID | Required acceptance behavior | Current evidence/status | Remaining closure |
|---|---|---|---|
| T01 | Valid principal, in-scope action and allow policy returns ALLOW | TEST EXISTS — domain allow case | Re-run against current head and real policy/identity adapters |
| T02 | Missing authentication blocks protected action | TEST EXISTS — unauthenticated state is denied | Verify at INV-05/07 action boundaries |
| T03 | Expired session requires reauthentication or denial | LOGIC ONLY — expired principal maps to REQUIRE_REAUTH | Add explicit test and bind session freshness to IdP adapter |
| T04 | Revoked session blocks subsequent actions | LOGIC ONLY — REVOKED authentication state is denied; session revocation workflow emits session.revoked | Add session-provider revocation integration test |
| T05 | Authentication without action permission is denied | LOGIC ONLY — NOT_GRANTED permission is denied | Add focused test using current INV-18 permission facts |
| T06 | Ownership alone cannot bypass policy | LOGIC ONLY — authorization is action/policy based; no owner bypass exists | Add explicit owner fixture and test |
| T07 | Admin without action entitlement is denied | INTEGRATION BLOCKER | Bind role/entitlement facts from INV-18 and test |
| T08 | Developer cannot access production without production authority | INTEGRATION BLOCKER | Bind environment/role policy and test |
| T09 | Reachable capability without authority is blocked at tool gateway | INTEGRATION BLOCKER | Integrate INV-07 Secure Tool Gateway |
| T10 | Natural-language “approved” claim without ApprovalRecord is blocked | LOGIC ONLY — request requires a real scoped approval reference | Add model-text/memory fixture and integration test |
| T11 | Caller cannot spoof another principal | TEST EXISTS — actor/context mismatch validation | Re-run current CI and verify IdP adapter |
| T12 | Caller-supplied scope inconsistent with target is rejected | TEST EXISTS — scope mismatch validation | Add cross-tenant repository test |
| T13 | Cross-tenant guessed object read is denied | INTEGRATION BLOCKER — readDecision port masks not-visible records | Implement real object-level repository filtering and test |
| T14 | Not-visible target does not leak existence | LOGIC ONLY — generic NOT_FOUND_OR_NOT_VISIBLE response | Prove against persistent multi-tenant repository |
| T15 | Membership removal takes effect within declared propagation objective | INTEGRATION BLOCKER | INV-18 event/read adapter and an approved, measurable propagation SLO are open |
| T16 | Stale cached decision rejected after membership/entitlement version changes | LOGIC ONLY — decision fingerprint includes current source versions | Add cache and INV-18 version-change integration test |
| T17 | Policy version change forces next action re-evaluation | LOGIC ONLY — action boundary re-resolves policy on each call | Add policy-version mutation/action-boundary test |
| T18 | Policy timeout returns unavailable/indeterminate and prevents side effect | LOGIC ONLY — provider failure is fail-closed | Add dedicated outage test and INV-05/07 proof |
| T19 | Policy UNKNOWN/conflict cannot become ALLOW | TEST EXISTS — UNKNOWN maps to INDETERMINATE | Add evaluator conflict fixture when policy evaluator is selected |
| T20 | Draft/suspended policy cannot authorize | TEST EXISTS — suspended policy case; draft is guarded by the same release-state gate | Add explicit draft test |
| T21 | Policy release immutable; changes create a new version and invalidation/recheck | LOGIC ONLY — ordered release lifecycle and guarded publish/suspend ports | Bind immutable policy store, approval/impact evidence and invalidation event consumer |
| T22 | Required missing/stale/indeterminate risk blocks action | LOGIC ONLY — risk freshness and required-assessment checks exist | Add dedicated missing/stale risk tests and risk source adapter |
| T23 | Approval-required returns scoped approval requirement without execution | TEST EXISTS — approval-required decision case | Verify no protected side effect through INV-05/07 |
| T24 | Unauthorized approver cannot decide approval | LOGIC ONLY — current approver verification gates decision | Add explicit authorized=false test and live INV-18 integration |
| T25 | Self-approval rejected when independent approval is required | TEST EXISTS — independent approver guard | Add cross-kind PrincipalRef test if policy permits varied principal types |
| T26 | Approval for one action cannot authorize another | TEST EXISTS — exact action checked in approval validation | Assert action-mismatch reason directly |
| T27 | Approval for one resource cannot authorize another | LOGIC ONLY — exact ObjectRef/version binding exists | Add focused resource-mismatch test |
| T28 | Approval cannot cross tenant/environment | LOGIC ONLY — scope/environment exact-match guards exist | Add dedicated tenant and environment negative tests |
| T29 | Material Work/resource/context version change forces re-evaluation/new approval | LOGIC ONLY — canonical request fingerprint and context version binding exist | Add Work/Plan/Graph version change test |
| T30 | Expired approval is rejected | LOGIC ONLY — expiry and lifecycle guards exist | Add direct expired-use authorization test |
| T31 | Revoked approval rejected despite cached prior allow | LOGIC ONLY — revoked_at/state are checked and action boundary rereads approval | Add cached-decision + revocation integration test |
| T32 | One-time approval cannot be used concurrently twice | INTEGRATION BLOCKER | Real repository must atomically compare-and-set approval and commit decision/audit/outbox in one DB transaction |
| T33 | Replayed one-time approval rejected with audit reason | TEST EXISTS — pure consume/replay and exact-request claim tests | Prove idempotency and durable audit in persistent adapter |
| T34 | Reusable approval only when current policy explicitly permits it | LOGIC ONLY — use mode must match explicit policy value | Add reusable approval success/denial tests |
| T35 | Grantor cannot delegate permissions it does not hold | TEST EXISTS — attempted action escalation is rejected | Verify against live membership/permission adapter |
| T36 | Delegation scope cannot exceed grantor or parent | TEST EXISTS — scope/action/resource/parent constraints are validated | Add nested parent/ancestor integration fixture |
| T37 | Subdelegation denied by default | TEST EXISTS — subdelegation needs explicit authority | Add root-level no-parent subdelegation negative test |
| T38 | Allowed subdelegation preserves lineage, scope and parent expiry | TEST EXISTS — complete ancestry, bounds and cycle logic | Add positive multi-level subdelegation test with real lineage source |
| T39 | Circular/self-delegation and privilege escalation rejected | TEST EXISTS — self actor and delegation cycle guards exist | Add full cyclic multi-parent graph integration test |
| T40 | Expired/suspended/revoked delegation cannot be used | TEST EXISTS — expired reactivation and terminal revocation are checked | Verify actual INV-18/authority source returns current invalid state |
| T41 | Delegation revocation invalidates later action and emits audit/event | LOGIC ONLY — revoke use case and atomic event repository port exist | Add action-after-revocation integration test with INV-05/07 |
| T42 | Role/scope/expiry/risk/context changes trigger action-time re-evaluation | LOGIC ONLY — boundary re-resolves principal/facts/policy and rechecks conditions | Add source-version change matrix test |
| T43 | Long-running Work rechecks before next consequential action | INTEGRATION BLOCKER | Integrate recheck hook into INV-04 and enforcement points in INV-05/07 |
| T44 | Service identity cannot replace acting user without permitted delegation | TEST EXISTS — distinct service identity requires verified delegation | Verify against service identity and delegation providers |
| T45 | External authorization failure/uncertainty blocks action | LOGIC ONLY — denied/unknown external authority states fail closed | Add dedicated test and external authority adapter |
| T46 | Capability fallback cannot broaden permissions or reuse unrelated approval | INTEGRATION BLOCKER | INV-07 capability fallback and approval binding integration test |
| T47 | Wrong expected version conflicts without partial mutation | LOGIC ONLY — expected version validation and CAS ports exist | Add stale CAS application test against repository adapter |
| T48 | Same idempotency key + same canonical payload returns same logical result | INTEGRATION BLOCKER | Implement/verify persistent idempotency replay in repository adapter |
| T49 | Same idempotency key + different payload returns conflict | LOGIC ONLY — key consistency and canonical fingerprint inputs exist | Add application replay/conflict test with persistent idempotency store |
| T50 | Duplicate/delayed/reordered authority events cannot restore older state | INTEGRATION BLOCKER | Connect INV-18 authority event versions to Inbox ordering/consumer state |
| T51 | Approval consumption atomic and version-checked | INTEGRATION BLOCKER | Repository/database must prove concurrent CAS and rollback with fault-injection tests |
| T52 | Decision fingerprint changes on material authority source version | TEST EXISTS — source-version change alters authority fingerprint | Add full INV-18/IdP/policy source contract fixture |
| T53 | Decision expiry prevents reuse without event invalidation | TEST EXISTS — decision currentness checks validity deadline | Verify on actual enforcement adapter |
| T54 | Safe denial does not reveal secret/private policy/hidden data | TEST EXISTS — private reason whitelist and no caller-supplied refs | Add audience-specific integration/redaction tests |
| T55 | Audit contains source/version/correlation lineage, excludes secrets | LOGIC ONLY — expanded audit fields and atomic commit port exist | Add audit payload assertions and real protected audit-store test |
| T56 | Revocation does not claim to undo completed external effect; downstream reconcile signalled | INTEGRATION BLOCKER | INV-04/05 reconciliation path and external-effect uncertainty proof |
| T57 | Decision history/list/search access filtered by object and tenant scope | LOGIC ONLY — filtered single-decision read port exists | List/history API and persistent repository filtering are not implemented |
| T58 | Malformed/unsupported request rejected before evaluation | TEST EXISTS — request validation rejects actor/scope/reference errors | Add malformed payload fuzz/property tests |
| T59 | Stale approver authority at decision time blocks approval | LOGIC ONLY — verifyApprover is called immediately before decision | Add stale-membership/approver source-version test |
| T60 | Restart/recovery never resurrects expired/revoked/suspended state | INTEGRATION BLOCKER | Requires durable persistence, recovery tests and event-consumer restart tests |

## Provider and cross-engine blockers

The following cannot be marked closed from provider-neutral types or fake/in-memory tests:

1. **INV-18** — authoritative membership, role-binding and entitlement lookups; removal/revocation freshness and the approved propagation objective.
2. **Identity provider** — authentication/session/token/step-up adapter and revocation source.
3. **Policy evaluator** — selected language/runtime, conflict semantics, policy release store, approval authority and impact-review evidence.
4. **Persistent repository** — durable decision/approval/delegation/revocation records, optimistic concurrency, idempotency, atomic one-time consumption, audit and transactional Outbox.
5. **INV-05 and INV-07** — actual execution/tool side-effect boundaries that enforce ALLOW and must-hold conditions immediately before the effect.
6. **INV-04** — long-running Work wait/stop/recheck behavior and downstream handling of revocation or uncertain external effects.
7. **INV-19/20/21/15** — spend/entitlement, governed environment, connector and external authorization facts where applicable.

## Exit gate for INV-06

Do not mark INV-06 production-complete or move its closure status to PASS until:

- all applicable T01–T60 have exact test/build evidence, not merely definitions;
- latest branch CI is green;
- INV-18, identity and policy adapters are connected and conformance-tested;
- persistent atomicity/idempotency/recovery guarantees are tested against the selected database;
- INV-05/07 action-boundary tests prove denied, stale, revoked, expired, indeterminate and condition-unsatisfied requests cannot cause protected effects;
- INV-04/05/07 event and reconciliation contracts are verified;
- privacy/audit and revocation propagation requirements are approved and tested.

Until those adapters are selected and connected, status remains **provider-neutral implementation in progress — protected production execution not yet certified**.
