# BeamCore — Module Boundary Design v1.0

**Status:** Proposed design; no application source files changed.  
**Inspected baseline:** beamcore-native-engine @ 9d1cefc011ecccc497a745b3ce68e76edd82b5f7  
**Stack:** Remix 2.10.2, React 18.3.1, TypeScript 5.5.2, Vite 5.3.1  
**Purpose:** Define code boundaries for all 21 logical Engines without merging their authority, records, or lifecycle.

## 1. Decision

Use a provider-aware modular monolith in the existing Remix application. Preserve 21 distinct domain modules, one per INV. The nine package groups are filesystem namespaces only, not nine replacement Engines. Each Engine keeps its own domain records, lifecycle, application ports, contracts, and tests.

This is not approval to create microservices, select a database/provider, migrate frameworks, enable runtime execution, activate live payments, or redesign the UI.

## 2. Proposed source tree

    app/
      routes/                         # Remix transport adapters only
      components/                     # preserve existing V0 presentation
      features/                       # UI projections, not domain ownership
        chat/
        workbench/
        projects/
      modules/
        intent-intelligence/
          inv-01-intent/{domain,application,contracts,infrastructure,__tests__}
          inv-13-research/{domain,application,contracts,infrastructure,__tests__}
        work-management/
          inv-02-work/
          inv-03-planning/
          inv-04-orchestration/
        identity-access/
          inv-06-authorization/
          inv-18-organization/
        capabilities-integrations/
          inv-07-capability/
          inv-15-connector/
        creation-deliverables/
          inv-10-artifact/
          inv-14-creation/
          inv-16-file/
        assurance-external-truth/
          inv-08-verification/
          inv-11-observability/
          inv-12-world-state/
        context-attention/
          inv-09-memory/
          inv-17-notification/
        resources-commerce/
          inv-19-usage/
          inv-20-financial/
        runtime-release/
          inv-05-execution/
          inv-21-deployment/
      platform/
        contracts/
        application/
        persistence/
        events/
        security/
        observability/
        storage/
        config/
      lib/                             # transitional adapters; reduce gradually
        .server/llm/
        runtime/
        stores/
        persistence/
        webcontainer/
      types/                           # transport/UI-only types
      utils/

The exact directory names may change. The invariant is one logical module per INV. Do not create empty folders for future features. Do not move or rewrite existing UI components during the first extraction.

## 3. Standard internal module shape

Each INV module may use this structure as needed:

    inv-XX-engine/
      domain/
        entities/
        value-objects/
        state/
        policies/
        errors/
      application/
        commands/
        queries/
        handlers/
        ports/
      contracts/
        requests/
        responses/
        events/
        references/
      infrastructure/
        persistence/
        adapters/
      __tests__/
        unit/
        contract/
        integration/

A module may read another Engine through its published application port, store typed references to another Engine's record/version, or keep an explicitly non-authoritative projection with source/version/freshness metadata.

A module may not write another Engine's records directly, mirror another Engine's lifecycle as its own truth, or grant itself authority based on capability, role, ownership, entitlement, or UI state.

## 4. Nine co-location groups; 21 separate domain authorities

| Namespace | Engines | Shared infrastructure allowed | Boundary that must remain |
|---|---|---|---|
| intent-intelligence | INV-01, INV-13 | AI provider gateway, model adapters, structured-output validators | Intent/decision/clarification vs Research/Source/Claim/Citation/Conflict |
| work-management | INV-02, INV-03, INV-04 | Work-scoped transaction helper, version/idempotency utility | Work/accepted target vs Plan/Graph revisions vs durable orchestration runs |
| identity-access | INV-06, INV-18 | Principal/scope reference types, membership cache invalidation | Membership/role/entitlement facts vs authorization/policy/approval/delegation |
| capabilities-integrations | INV-07, INV-15 | Adapter SDK, schemas, secret references, health checks | Capability registry/Gateway vs connector definitions/connections/consent/webhooks/sync |
| creation-deliverables | INV-10, INV-14, INV-16 | Object-store client, digest and transfer primitives | Artifact/version/lineage vs Creation requirements/blueprint vs raw File intake/scan/extraction/deletion |
| assurance-external-truth | INV-08, INV-11, INV-12 | Correlation IDs, event envelope, telemetry transport | Verification/evidence verdict vs audit/telemetry/incident vs external observation/reconciliation |
| context-attention | INV-09, INV-17 | Scope-aware access utilities and UI attention primitives | Memory governance vs notification/delivery/read/dismiss lifecycle |
| resources-commerce | INV-19, INV-20 | Decimal/money formatting and reporting primitives | Usage ledger/budget/limits vs price/invoice/payment/commission/settlement |
| runtime-release | INV-05, INV-21 | Provider adapter conventions, correlation and health references | Execution/attempt/isolation/cleanup vs environment/release/deployment/backup/rollback |

No full logical Engine merge is recommended. If future evidence shows duplicate ownership, identify the exact duplicated records, operations, state transitions and acceptance tests, then change the source architecture through a controlled decision before removing a boundary.

## 5. Cross-engine call model

### 5.1 In-process application ports first

Use explicit TypeScript application ports inside the modular monolith. Do not add HTTP/RPC or a broker between modules in the same server process. Keep interfaces stable and versionable so future extraction remains possible.

Illustrative only:

    interface WorkQueryPort {
      getWork(input: {
        principal: PrincipalRef;
        scope: ScopeRef;
        workRef: ObjectRef;
      }): Promise<OperationResult<WorkRecord>>;
    }

    interface AuthorizationPort {
      authorize(input: AuthorizationRequest):
        Promise<OperationResult<AuthorizationDecision>>;
    }

Exact types must be reconciled against the canonical INV-01 RequestContext, ObjectRef, ScopeRef, PrincipalRef, OperationResult and error contracts before implementation. Do not invent parallel aliases.

### 5.2 Commands and events are different

- A command requests a state change from the owning Engine and receives an authoritative result/receipt.
- An event reports a committed change; it is not a command and grants no authority.
- Consumers must be idempotent and tolerate duplicate, delayed, out-of-order and replayed events.
- Consequential consumers re-query the owning Engine's current authoritative state/version before acting.
- Mutations that require background work write an outbox item in the same transaction as the authoritative mutation.
- Dispatch may happen more than once. Recipient idempotency and reconciliation are required. Do not promise exactly-once delivery.

### 5.3 Shared result/error semantics

Use one canonical operation result envelope from the INV specifications. Preserve OK, PARTIAL, REJECTED and UNKNOWN; typed validation, unauthenticated, forbidden, policy-denied, approval-required, version-conflict, idempotency-conflict, dependency-unavailable, timeout, resource-limit, cancelled, integrity/untrusted-input, partial-result and outcome-unknown/reconciliation-required errors; correlation ID; warnings; object/version references; and safe messages.

Never convert UNKNOWN to FAILED or SUCCESS because a timeout or transport error occurred.

## 6. Protected action path

1. Resolve trusted authenticated principal and active scope.
2. Resolve the target resource from its owning Engine and verify scope.
3. Read current membership/role facts from INV-18.
4. Ask INV-06 for action/resource/scope/environment/time/risk/delegation/approval-specific authorization.
5. Ask INV-07 whether the requested capability version is registered, released, compatible, healthy and eligible.
6. Check applicable resource admission/budget through INV-19.
7. Ensure mandatory audit can be durably accepted by INV-11.
8. Dispatch through the capability/runtime boundary; INV-05 records actual execution.
9. Preserve output through INV-10/16 where applicable.
10. Evaluate admissible evidence and the accepted target through INV-08.
11. Update Work progress through INV-02 using source references and version checks.

This is not a requirement to invoke all 21 Engines for every simple chat answer. Protected side effects must use all applicable gates.

## 7. Shared event envelope and persistence requirements

The shared event infrastructure is not a new Engine. Minimum envelope:
- event ID and schema version;
- source Engine ID and event type;
- source object reference and revision;
- occurred-at and recorded-at timestamps;
- correlation, causation and request IDs;
- principal and scope references where permitted;
- idempotency/deduplication identity where applicable;
- redacted payload or typed references, never raw secret-bearing content.

The authoritative database remains undecided for this Remix branch. Whatever provider is selected must support atomic state plus outbox commit, unique idempotency constraints, optimistic version checks, append-only records where required, migrations, tenant-scoped queries, backup and restore.

Do not select SQL Connect, Cloud SQL, Supabase, Drizzle, Firestore or another provider solely because it appears in a stale register. Run a compatibility decision against the actual deployment and V1 constraints.

## 8. Existing source-to-module migration map

| Existing path | Transitional destination | Migration rule |
|---|---|---|
| app/routes/api.chat.ts | Thin route → INV-01/13/14 application ports | Extract classification and creation decisions incrementally; preserve existing UI response protocol until separately tested |
| app/lib/.server/llm/* | platform AI provider adapter | Provider infrastructure only; no Work/Intent/Research state |
| app/lib/runtime/message-parser.ts | Creation stream-protocol adapter | No persistence or authority; validate model actions before dispatch |
| app/lib/runtime/action-runner.ts | Transitional INV-05 runtime adapter | Not durable orchestration; production runtime stays gated |
| app/routes/api.daytona.ts | Daytona adapter behind INV-07 | Keep guest Preview guard; no production bypass |
| app/lib/daytona.client.ts | Daytona client adapter | Browser calls only the approved server boundary; no provider secrets |
| app/lib/webcontainer/* | Browser runtime adapter | Not a trusted platform runtime for untrusted production code |
| app/lib/stores/workbench.ts | features/workbench projection | Replace message-keyed project truth with server Work references only after Work API is tested |
| app/lib/stores/files.ts | Local editor state plus INV-16/10 ports | Unsaved editor state stays distinct from canonical File/Artifact versions |
| app/lib/persistence/* | Local chat-history adapter | Keep as chat history; not Work DB or Memory |
| app/components/chat/Artifact.tsx | Existing presentation | Preserve design; bind to real Artifact/Creation refs when available |
| app/utils/logger.ts | platform observability adapter | Development logger only; protected audit needs durable INV-11 |

## 9. Import and dependency rules

1. A module imports its own internal layers.
2. A module may import shared platform contracts.
3. A module must not import another module's infrastructure, database tables, SDK client or private entity classes.
4. Cross-engine calls use the owning module's published application port/contracts.
5. UI/features may import public query/command clients, never domain repositories or privileged provider clients.
6. Remix routes parse transport input, resolve trusted context, call application ports and map results to HTTP; they do not own domain lifecycle rules.
7. Provider adapters implement ports; they do not decide business policy or become a source of truth.
8. Shared utilities stay generic. Work-specific state/policy belongs to INV-02.
9. No cyclic module dependencies. Use explicit receipts/events or an owning neutral contract instead of a third super-engine.
10. Add import-boundary enforcement through lint restrictions, package exports or equivalent after initial extraction.

## 10. Boundary test strategy

### Module tests
- entity/value invariants and allowed transitions;
- expected-version and optimistic concurrency;
- idempotency replay/conflict;
- authorization denial and scope mismatch;
- typed errors and UNKNOWN handling;
- no direct writes to another Engine's records.

### Cross-engine contract tests
- INV-01 proposal → INV-02 acceptance receipt → INV-08 exact-target assessment;
- INV-03 validated graph → INV-02 activation receipt → INV-04 pinned run;
- INV-04 dispatch → INV-06 authorization → INV-07 eligibility → INV-05 attempt;
- INV-05 output → INV-10 Artifact / INV-16 File → INV-08 evidence;
- INV-18 revocation → INV-06 denial on next protected action;
- INV-05 measurements → INV-19 usage ledger/reservation;
- INV-12 reconciliation → INV-04 safe continuation;
- INV-11 audit precondition failure → protected dispatch denied unless approved degraded mode;
- notification delivery/read/dismiss does not mutate source Work/approval/Outcome.

### Failure/recovery tests
- process restart between DB commit and outbox dispatch;
- duplicate outbox delivery and duplicate capability invocation;
- provider timeout after possible external side effect;
- stale Work/Graph/Capability/Policy/Membership version;
- approval revoked while a run waits;
- cancellation while a process runs;
- process stopped but external effect remains unknown;
- DB or audit unavailable before protected action;
- partial artifact/file writes and cleanup failure;
- budget reservation succeeds but dispatch fails; late/duplicate usage arrives;
- deployment/restore/rollback interruption.

A test is PASS only with commit/build identity, environment, command, fixture, actual output and evidence reference.

## 11. V1 implementation order

1. Platform foundations: canonical contracts, trusted principal/scope, persistence/migrations, transaction/outbox, audit/correlation and test baseline.
2. INV-18 + INV-06: minimum workspace/membership and action-time authorization, with distinct records.
3. INV-02 + INV-01: durable Work and intent proposal/acceptance receipt, integrated behind the existing composer.
4. INV-03 + INV-04: Plan/Graph revisions, activation and durable orchestration for approved V1 work.
5. INV-07 + bounded INV-13/14: capability gateway and server AI/creation with schema validation.
6. INV-10 + minimum INV-16 + INV-08: Artifact/File lineage and evidence-based verification.
7. INV-11 + INV-19 + INV-09 M0: audit, usage guardrails and Memory foundation; M1 only with TTL/cleanup/isolation approval.
8. INV-05 and INV-21 only after their independent runtime/release gates. INV-20 live payments remain behind explicit commercial/legal/provider approval.

This order remains provisional until the Vision 1.1 payment revision and the actual proving-ground requirements are formally reconciled.

## 12. Explicit non-actions

- No source files moved or changed.
- No UI redesign; preserve current V0 design, composer, Workspace and mobile menu behavior.
- No Next.js migration; current baseline is Remix.
- No DB, workflow, identity, object-store, sandbox or payment provider selected here.
- No live resources, billing, production deployment or credentials requested.
- No Engine ID merged, removed or renamed.
- No production generated-code execution, live payments or generated-app deployment authorized.

## 13. Review required before extraction

Review and approve:
- one module per INV as the initial logical structure;
- nine co-location namespaces as provisional folders only;
- in-process application ports for the initial modular monolith;
- transactional outbox and idempotent consumers;
- no direct cross-module persistence access;
- protected-action sequence in Section 6;
- migration map and UI-preservation constraints;
- V1 payment/commission scope disposition and proving-ground acceptance criteria.

If a boundary cannot be implemented or tested under these rules, revise it with evidence before moving code.

---
This proposal is tied to the inspected Remix native-engine snapshot. Reconcile later commits before implementation.
