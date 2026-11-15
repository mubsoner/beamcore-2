# INV-06 Acceptance Closure Matrix

**Source of truth:** `OMNI_INV01-INV21_AI_Implementation_Specifications_v2.9_INV01-21_Gap_Closure_Review`, INV-06 §14–§17.

**Purpose:** Track every required INV06-T01–T60 acceptance definition separately from unit-test coverage and provider/integration proof. This matrix is a gap register, not a declaration that the 60 acceptance tests have passed.

## Status meanings

- **TEST EXISTS** — a focused executable domain/application test exists in this branch. It counts as acceptance proof only after the exact current commit runs it successfully in CI and the required integration boundary is included.
- **LOGIC ONLY** — the provider-neutral rule/use case exists, but there is no dedicated test for the specific acceptance behavior yet.
- **INTEGRATION BLOCKER** — completion needs an actual provider, persistent repository, or another engine's enforcement/source adapter; a port or fake test adapter is not proof.
- **GAP** — required logical behavior or test is still missing/incomplete.

**Current engine test inventory:** 31 domain tests + 28 application tests = 59 focused INV-06 tests. Latest branch head inspected: `bc6ffe0201b93f57185b3d1df1217f532e816eba`; CI run `43775412219` for that exact head was `in_progress` at matrix update time. This inventory is a test count, not a pass count. Passing unit tests are not substitutes for the provider/integration blockers below.

## Acceptance status

| ID | Required acceptance behavior | Current evidence/status | Remaining closure |
|---|---|---|---|
| T01 | Valid principal, in-scope action and allow policy returns ALLOW | TEST EXISTS — domain allow case | Re-run against current head and real policy/identity adapters |
| T02 | Missing authentication blocks protected action | TEST EXISTS — unauthenticated state is denied | Verify at INV-05/07 action boundaries |
| T03 | Expired session requires reauthentication or denial | TEST EXISTS — application test rejects an already-expired authenticated session result | Bind session freshness and revocation to the selected IdP adapter |
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
| T24 | Unauthorized approver cannot decide an approval | TEST EXISTS — application tests re-resolve current approver authority and deny revoked/stale approvers | Verify against live INV-18 membership and policy adapter |
| T25 | Self-approval rejected when independent approval is required | TEST EXISTS — independent approver guard | Add cross-kind PrincipalRef test if policy permits varied principal types |
| T26 | Approval for one action cannot authorize another | TEST EXISTS — exact action checked in approval validation | Assert action-mismatch reason directly |
| T27 | Approval for one resource cannot authorize another resource | TEST EXISTS — exact resource reference and canonical approval binding are checked | Verify against current persistent resource/version source |
| T28 | Approval cannot cross tenant/environment | TEST EXISTS — exact scope and environment are checked | Add persistent multi-tenant approval repository test |
| T29 | Material Work/resource/context version change after approval forces re-evaluation/new approval | TEST EXISTS — canonical binding includes resource, Work/Plan/Graph/execution/capability versions and risk | Verify with live context-version sources and action boundary |
| T30 | Expired approval is rejected | TEST EXISTS — approval expiry and expiry lifecycle transitions are tested | Verify scheduler/persistence expiry and action-boundary reads |
| T31 | Revoked approval is rejected even if an earlier allow decision is cached | LOGIC ONLY — action boundary reloads approval and checks current state | Add cached-decision plus durable approval revocation integration test |
| T32 | A one-time approval cannot be consumed by two concurrent authorization requests | INTEGRATION BLOCKER — claim command carries exact current row version and request; database compare-and-set is required | Prove concurrent CAS and transaction rollback on selected persistent repository |
| T33 | Replayed one-time approval is rejected with an auditable safe reason | TEST EXISTS — same request + same idempotency key replays its claim after current authority recheck; another key/request is denied | Prove durable idempotent replay and audit/outbox in database adapter |
| T34 | Reusable approval works only where the current policy explicitly permits reusable use within scope | TEST EXISTS — reusable binding allows equivalent requests but rejects changed resource/action/scope/context | Add integration test against live policy and approval store |
| T35 | Delegation cannot grant a permission the grantor does not currently possess | TEST EXISTS — current grantor action set and inherited limits/conditions constrain the child | Verify source adapter against live INV-18 and policy facts |
| T36 | Delegation scope cannot exceed grantor authority or the parent delegation | TEST EXISTS — direct parent and full ancestor chain constrain scope/actions/resources/limits/conditions/time | Add live multi-level lineage-source conformance test |
| T37 | Subdelegation defaults to denied | TEST EXISTS — explicit grantor and ancestor subdelegation authority is required | Verify persisted policy bindings and revocation propagation |
| T38 | Subdelegation, when explicitly allowed, preserves lineage, scope limits and parent expiry | TEST EXISTS — multi-level ancestry is checked root-to-parent; widening, broken chain and cycles are rejected | Verify full ancestry retrieval and event ordering in durable source adapter |
| T39 | Circular/self-delegation and attempted privilege escalation are rejected | TEST EXISTS — self-delegation, self-reference/cycle and ancestor widening checks are covered | Add property-based cyclic graph tests and live ancestry integration |
| T40 | Expired/suspended/revoked delegation cannot be used | TEST EXISTS — expired activation is denied; reactivation rechecks grantor authority and cited decision | Verify current INV-18/delegation source and event-consumer freshness |
| T41 | Delegation revocation invalidates later actions and produces an auditable event | LOGIC ONLY — revocation and suspension use CAS plus atomic Outbox repository contracts | Prove revoke-to-action denial through INV-05/07 with durable event delivery |
| T42 | Role/scope/expiry/risk/context changes trigger action-time re-evaluation | LOGIC ONLY — boundary re-resolves principal/facts/policy and rechecks conditions | Add source-version change matrix test |
| T43 | A long-running Work is rechecked before its next consequential action after a policy/membership/delegation change | INTEGRATION BLOCKER | Integrate recheck hook into INV-04 and enforcement points in INV-05/07 |
| T44 | A caller cannot substitute its own service identity for an acting user without an explicit permitted delegation | TEST EXISTS — service identity must resolve independently and be bound to a verified delegation | Verify with real application/service identity provider and delegation source |
| T45 | External authorization failure/uncertainty blocks action | LOGIC ONLY — denied/unknown external authority states fail closed | Add dedicated test and external authority adapter |
| T46 | Capability fallback cannot broaden permissions or reuse unrelated approval | INTEGRATION BLOCKER | INV-07 capability fallback and approval binding integration test |
| T47 | Authorization request with wrong expected version returns a conflict and performs no partial mutation | TEST EXISTS — current approval row version is passed separately from stable ObjectRef version; stale CAS is rejected | Prove database compare-and-set and rollback under race/fault injection |
| T48 | Repeated request with the same idempotency key and same canonical payload returns the same logical operation result | LOGIC ONLY — decision fingerprint binds canonical request plus current authority fingerprint; one-time claim replay is keyed to the same request/operation | Verify persistent idempotency replay and stable results with the selected repository/transaction adapter |
| T49 | Reusing an idempotency key with different canonical payload returns an idempotency conflict | LOGIC ONLY — canonical request and authority fingerprints are bound to the idempotency record | Add durable application replay/conflict tests against persistent repository |
| T50 | Duplicate/delayed/reordered authority events cannot restore older state | INTEGRATION BLOCKER | Connect INV-18 authority event versions to Inbox ordering/consumer state |
| T51 | Approval consumption is atomic and version-checked under concurrent use | INTEGRATION BLOCKER — application sends claim and decision/audit/outbox in a single repository command | Prove concurrent database CAS, rollback and replay behavior |
| T52 | Decision fingerprint changes on material authority source version | TEST EXISTS — source-version changes alter the authority fingerprint and idempotency binding | Add full INV-18/IdP/policy source contract fixture |
| T53 | Decision expiry prevents reuse without event invalidation | TEST EXISTS — decision currentness checks validity deadline; expired request deadline is denied | Verify on actual enforcement adapter |
| T54 | Safe denial does not reveal secret/private policy/hidden data | TEST EXISTS — private reason whitelist and no caller-supplied refs | Add audience-specific integration/redaction tests |
| T55 | Audit contains source/version/correlation lineage, excludes secrets | LOGIC ONLY — expanded audit fields and atomic commit port exist | Add audit payload assertions and real protected audit-store test |
| T56 | Revocation does not claim to undo completed external effect; downstream reconcile signalled | INTEGRATION BLOCKER | INV-04/05 reconciliation path and external-effect uncertainty proof |
| T57 | Decision history/list/search access filtered by object and tenant scope | LOGIC ONLY — filtered single-decision read port exists | List/history API and persistent repository filtering are not implemented |
| T58 | Malformed/unsupported request rejected before evaluation | TEST EXISTS — request validation rejects actor/scope/reference errors | Add malformed payload fuzz/property tests |
| T59 | Stale approver authority at decision time blocks approval even if authority existed when the request was created | TEST EXISTS — decision application re-resolves approver and all approval-required constraints immediately before mutation | Verify against live membership revocation and policy source versions |
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
