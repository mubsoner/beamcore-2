# BeamCore — Engine Consolidation Assessment v1.0

**Date:** 11 November 2026  
**Status:** Proposed module-packaging recommendation; no INV ownership has been merged or removed  
**Repository:** `mubsoner/beamcore-2`  
**Branch:** `architecture/inv-contract-reconciliation`  
**Decision context:** INV-01–INV-21 v2.9, A–S Current Truth, Vision 1.1, Technology Decision Register 1.1 and repository evidence reviewed on the documentation branch.

> The purpose is to reduce unnecessary implementation/service count without losing any specified responsibility. This is an assessment and recommendation, not an approval to rewrite source INV chapters.

---

## 1. Executive conclusion

The review did **not** find two INV engines that fully own the same authoritative domain object and lifecycle. Several Engines sit next to each other and share vocabulary, providers, events or workflow stages. Their specifications nevertheless assign distinct sources of truth and explicitly separate their authority.

**Recommendation: do not delete, rename or logically merge the 21 INV identities at this stage. Instead, implement them as 8–9 internal domain packages/subsystems inside one provider-aware modular monolith.** Keep separate domain modules and records inside each package. Do not create 21 microservices, 21 deployed applications, 21 databases, 21 queues or 21 user-facing areas.

The INV inventory states that the domains form connected areas rather than standalone applications; the Technology Decision Register says to preserve all 21 logical engines and use a modular monolith; A–S explicitly says first-class boundaries do not require separate UI screens or services. This assessment applies those principles to the code organization.

### Recommended count

- **21 logical INV identities:** retained for source traceability, ownership and acceptance-test mapping.
- **8–9 implementation packages:** grouped by close domain relationship.
- **1 primary trusted application/deployment:** the existing BeamCore Remix application, subject to verified provider compatibility.
- **1 authoritative platform database:** to be selected only after compatibility gates.
- **Shared platform infrastructure:** one identity/session adapter, AI provider gateway, transactional inbox/outbox pattern, audit/telemetry pipeline, secrets boundary and object-storage adapter where required.
- **Isolated execution boundary:** a separate runtime/worker security boundary only when INV-05's independent tests pass. It is not an extra business Engine.

This reduces deployment and operational complexity without flattening domain ownership.

## 2. Candidate overlaps: what is shared and what is not

### 2.1 Strong package co-location candidates

| Related Engines | Shared implementation area | Why they must still remain distinct |
|---|---|---|
| INV-02 Work + INV-03 Planning/Graph + INV-04 Orchestrator | **Work Management** package | Work owns accepted target/lifecycle; Planning owns Plan/Graph revisions; Orchestrator owns durable run/node coordination. Their records, versioning and transitions differ. |
| INV-06 Authorization/Policy + INV-18 Organization/Membership | **Identity & Access** package | INV-18 owns account/org/membership/role/entitlement facts; INV-06 evaluates current action authority, policy, risk, approval and delegation. Membership/role is not permission. |
| INV-07 Capability Registry/Gateway + INV-15 Connector/Integration | **Capabilities & Integrations** package | INV-07 owns the global allowlisted capability contract and invocation admission; INV-15 owns provider-specific connections, scopes, credential references, webhook/sync mechanics and external attempts. A connected provider is not blanket authority. |
| INV-14 Creation + INV-10 Artifact + INV-16 File | **Creation & Deliverables** package | INV-14 owns requirements/blueprints/build requests; INV-16 owns raw file intake/inspection/extraction/quarantine; INV-10 owns immutable durable Artifact/Knowledge versions and lineage. A shared object store does not merge those lifecycles. |

These are the best candidates for one top-level code package with clear submodules. They are not candidates for one combined database record or one merged lifecycle.

### 2.2 Shared infrastructure, but no domain merge

| Related Engines | Reuse once | Keep separate because |
|---|---|---|
| INV-01 Intent + INV-13 Intelligence/Research | One provider-neutral AI/model gateway, routing adapter, usage capture and schema-validation utilities | Intent/Decision owns normalized user intent, clarification, route and Outcome proposal. Intelligence owns bounded research/source/claim/citation/synthesis records and research budgets. A model call is shared infrastructure, not shared domain truth. |
| INV-08 Verification + INV-11 Observability + INV-12 World State | Correlation IDs, event schemas, evidence references, telemetry transport and shared audit plumbing | Verification owns admissible Evidence and Outcome verdicts; Observability owns system/work/incident/health facts; World State owns source-bound observations about external reality. |
| INV-09 Memory + INV-17 Notifications | Common scope/reference and retention/redaction utilities where appropriate | Memory is gated retention and retrieval of permitted context; Notification is recipient/channel delivery and read/receipt lifecycle. A notification is not Memory; Memory must not become a notification queue. |
| INV-19 Usage + INV-20 Billing/Payments | Common money/quantity primitives, cost attribution references and reporting projections | Usage owns measured consumption, reservations and resource limits. Billing owns commercial obligations, payment, commission, settlement, refund and dispute facts. Never merge their ledgers or let payment status bypass resource limits/authorization. |
| INV-05 Execution + INV-21 Deployment/Recovery | Shared operational conventions, correlation, idempotency, resource policy references and reconciliation patterns | Execution records sandbox process attempts and cleanup. Deployment owns release/environment/backup/restore/recovery operations. They have different risk, approvals, environments and rollback semantics. The untrusted execution worker must remain separately isolated. |

### 2.3 No full logical merge recommended

No full logical merge is recommended for any pair above. The overlap is in workflow adjacency, infrastructure or terminology, not duplicate authoritative ownership.

The core distinctions are explicit in the source architecture:

- Core decides what should happen; Capability describes how it can happen; Execution makes it happen; Control/Trust determines whether it may happen; Verification determines whether it worked.
- Intent and accepted Outcome, Plan and Work Graph, Orchestration and Execution, Artifact and File, Verification and Observability, Membership and Authorization, Usage and Billing, and Deployment health and Outcome must remain distinct.
- These boundaries are architectural semantics, not instructions to create a separate deployed service or screen for every concept.

## 3. Recommended implementation packages

The following are implementation groupings, not new Engine IDs.

| Package | INV modules inside | Suggested package responsibility |
|---|---|---|
| **P1 — Intent & Intelligence** | INV-01, INV-13 | Request interpretation, clarification, decision lineage and thin model/research adapters. Share one AI provider gateway; maintain separate Intent and Research domain modules. |
| **P2 — Work Management** | INV-02, INV-03, INV-04 | Work continuity, accepted targets, Plan/Graph revisions, activation and durable run coordination. One cohesive domain area; distinct records and owner interfaces. |
| **P3 — Identity & Access** | INV-06, INV-18 | Trusted principal/session integration, organization/workspace membership, role facts, scope resolution, authorization, approvals, delegation and revocation. Authentication provider remains an adapter. |
| **P4 — Capabilities & Integrations** | INV-07, INV-15 | Capability registry, secure gateway, connector manifests, external accounts/scopes and provider adapters. One invocation control path; no arbitrary endpoint path. |
| **P5 — Creation & Deliverables** | INV-10, INV-14, INV-16 | Creation requirements and blueprint, safe file intake if required, artifact versions/manifests/lineage and controlled export/preview references. File and Artifact models remain different. |
| **P6 — Assurance & External Truth** | INV-08, INV-11, INV-12 | Criterion-level verification, evidence, audit/telemetry/incident projections and external observation/reconciliation. Separate verdict, incident and world-observation records. |
| **P7 — Context & Attention** | INV-09, INV-17 | M0/bounded working Memory governance and in-product Needs You/notification projection. Separate memory gates from notification delivery. |
| **P8 — Resource & Commerce** | INV-19, INV-20 | Usage metering, reservations/resource limits and, only when approved, separate commercial/payment/commission ledger modules. Do not merge ledgers. |
| **P9 — Runtime & Release Operations** | INV-05, INV-21 | Execution contract/provider adapter and release/deployment/recovery readiness. This is one architecture grouping only: untrusted execution workers remain isolated from the trusted BeamCore control plane. |

P9 may be represented as two separate submodules and different runtime/deployment boundaries; it must not be deployed as one privileged process that lets generated code reach release credentials.

## 4. What should not be built as a new Engine

The following are shared infrastructure or cross-cutting contracts, not additional INV domains:

- A separate AI Provider Engine/LLM Engine: use the shared provider-neutral model gateway, consumed by INV-01, INV-13 and INV-14.
- A separate Project Engine merely because the UI has Projects: Project is a product/workspace context; it must not replace INV-02 Work.
- A separate Workflow Engine duplicating INV-04: use one selected durable workflow provider behind INV-04's adapter.
- A second Tool Engine duplicating INV-07: all approved invocations pass through the Capability Gateway.
- A separate Authentication Engine duplicating INV-06/18: identity provider proves authentication; INV-18 owns membership facts; INV-06 owns authorization.
- A standalone File Storage Engine duplicating INV-10/16: use one storage adapter where suitable, with distinct File and Artifact metadata/lifecycles.
- A generic Event Engine or universal broker merely because multiple domains emit events: use canonical event contracts plus transactional inbox/outbox and the selected durable workflow/event mechanism.
- A separate Logging/Monitoring Engine duplicating INV-11: shared telemetry tooling is infrastructure; INV-11 owns audit/health/incident semantics.
- A separate Budget Engine duplicating INV-19 or charging logic duplicated in INV-20: keep one Usage Ledger and one Financial Ledger.
- A new Preview Engine or Deployment Engine for the existing UI: use the bounded INV-05 runtime and INV-21 release boundaries.

Do not create another numbered Engine (INV-22+) unless a concrete user requirement cannot be owned safely by the existing domains and a formal scope/architecture change proves why.

## 5. V1 should activate fewer than 21 full subsystems

A V1 implementation should not attempt to build every domain to its full future scope.

| INV | V1 implementation depth |
|---|---|
| 01 | Active: structured intent, clarification, bounded route and Outcome proposal |
| 02 | Active: durable Work, target acceptance, lifecycle, revision and timeline |
| 03 | Active: Plan/Graph revisions, validation and activation |
| 04 | Active: bounded durable orchestration, wait/retry/reconcile/stop |
| 05 | Interface/runtime profile now; execution gated until independent isolation tests |
| 06 | Active: authentication context integration, action-time authorization and approvals required for protected actions |
| 07 | Active: minimal allowlisted registry and secure gateway |
| 08 | Active: criterion-level evidence and Outcome verdict |
| 09 | M0 required; M1 only with explicit scope/TTL/cleanup assurance; M2 disabled |
| 10 | Active: immutable artifact identity/version/lineage |
| 11 | Active baseline: durable audit, correlation, redaction and distinct health views |
| 12 | Reconciliation semantics and bounded fixtures; broad live observation deferred |
| 13 | Thin provider-neutral inference; broad autonomous research deferred |
| 14 | Bounded creation and FS-01–FS-20 disposition for one approved target profile |
| 15 | Bounded adapter foundation; only approved operations active |
| 16 | Safe file references/intake only if required; full multimodal deferred |
| 17 | In-app attention only where required; outbound channels disabled |
| 18 | Minimum personal/workspace/org, membership, scoped role and revocation foundation |
| 19 | Basic trusted metering and configured resource/budget limits |
| 20 | Simulated/test-only design until explicit payment-scope approval and release gates; broad subscriptions/invoicing deferred |
| 21 | Release-readiness interface only; no generated-app production publishing |

This activation overlay follows Vision 1.1; it does not reduce the logical scope of the INV specifications.

## 6. Suggested code organization

The exact paths should be chosen after the current Remix repository is mapped. As a concept, use bounded domain packages under one app rather than a separate application per Engine:

```text
app/
  domains/
    intent-intelligence/
      intent/           # INV-01
      research/         # INV-13
    work-management/
      work/             # INV-02
      planning/         # INV-03
      orchestration/    # INV-04
    identity-access/
      authorization/    # INV-06
      organization/     # INV-18
    capabilities/
      registry-gateway/ # INV-07
      connectors/       # INV-15
    creation-delivery/
      creation/         # INV-14
      files/            # INV-16
      artifacts/        # INV-10
    assurance/
      verification/     # INV-08
      observability/    # INV-11
      world-state/      # INV-12
    context-attention/
      memory/           # INV-09
      notifications/    # INV-17
    resource-commerce/
      usage/            # INV-19
      billing/          # INV-20
    operations/
      execution/        # INV-05 control contracts; worker is isolated
      deployment/       # INV-21 trusted release/recovery control
  shared/
    contracts/          # canonical INV-01 shared types only
    ai-provider/        # one server-only model gateway adapter
    persistence/        # selected platform DB and transaction adapters
    inbox-outbox/       # event receipt and emitted-event plumbing
    secrets/            # server-only secret references/boundary
    telemetry/          # instrumentation/redaction primitives
```

This layout is illustrative, not a demand to refactor the existing repository immediately. Preserve existing working code and the V0 UI; map and migrate incrementally only where a tested gap requires it.

## 7. Decision recommendation

| Decision | Recommendation | Status |
|---|---|---|
| Delete any INV Engine as redundant | No | Not recommended; no complete duplicate ownership found. |
| Merge source INV specifications into combined specifications | No | Would blur source-of-truth and acceptance-test ownership. |
| Group related Engines into domain packages | Yes | Recommended; 8–9 packages as above. |
| Build 21 microservices | No | Explicitly reject for V1. |
| Keep one trusted BeamCore application first | Yes | Modular monolith. |
| Keep one authoritative platform DB | Yes | Physical provider still requires compatibility and security gate. |
| Share AI provider gateway, audit plumbing, inbox/outbox, storage adapters and secrets boundary | Yes | Shared infrastructure, not new Engines. |
| Isolate generated-code runtime | Yes | Mandatory security boundary; remains gated until tested. |
| Add new INV-22 or more | No | Only via documented need and approved architecture/scope change. |

### Closure condition

This assessment may be adopted as the **implementation packaging proposal** without changing the semantic ownership of INV-01–INV-21. Before any actual code restructuring, map current source paths to these packages and confirm that no existing behavior or ownership is lost. Any proposal to truly merge two domain owners must identify the duplicate records/states, migration path, acceptance-test impact and new single source of truth, then receive explicit architecture approval.

---

## 8. Source traceability

- **INV-01–INV-21 v2.9:** the detailed chapter definitions and ownership boundaries.
- **Full Engine Inventory:** per-engine summary, cross-engine distinctions, V1 activation overlay and implementation mapping.
- **OMNI A–S Current Truth:** first-class boundary decisions and the statement that a semantic boundary need not become its own screen or service.
- **BeamCore Vision 1.1:** V1 activation and gated/deferred capabilities.
- **Engine & Technology Decision Register 1.1:** modular monolith, preservation of 21 logical engine IDs and provider-neutral adapters.

This document is an assessment proposal. It does not amend the authoritative INV source chapters and does not claim any package or Engine has been implemented or verified.
