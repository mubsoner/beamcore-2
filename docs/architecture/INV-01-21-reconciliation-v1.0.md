# BeamCore — INV-01–INV-21 Architecture Reconciliation

**Document:** INV-01–INV-21 Reconciliation v1.0  
**Review date:** 11 November 2026  
**Status:** Proposed architecture/implementation baseline; not a production approval and not a claim of implementation completion  
**Repository:** `mubsoner/beamcore-2`  
**Documentation branch:** `architecture/inv-contract-reconciliation`  
**Branch base at creation:** `deployment-fix` — `6f0465632c3d4874358a812bfd1ab18738e0d5f7`  
**Repository code evidence reviewed:** `beamcore-native-engine` — `9d1cefc011ecccc497a745b3ce68e76edd82b5f7`  
**Source documents:** INV-01–INV-21 v2.9; BeamCore Full Engine Inventory; BeamCore Vision 1.1 (4 November 2026); BeamCore Engine & Technology Decision Register 1.1 (4 November 2026).

> This document reconciles existing source material. It does not replace the 21 INV chapters, silently approve proposed decisions, authorize paid resources or live payments, enable generated-code execution, or authorize Production deployment.

---

## 1. Purpose and interpretation

The INV specifications define Engine ownership, logical records, contracts, state transitions, interfaces, events, security rules, failure/recovery behavior, acceptance-test definitions and implementation boundaries. They do not prove that physical providers have been selected, adapters implemented, or tests passed.

Keep these three levels separate:

1. **Architecture defined:** the logical responsibility, contracts, states and expected conformance behavior are documented.
2. **Technology bound:** a specific provider, library, runtime, database, transport or hosting mechanism has been selected against those requirements and its decision is recorded.
3. **Implemented and verified:** code exists and the relevant contract, integration, security, failure and acceptance tests have actually run with traceable evidence.

A provider mentioned as a candidate is not a final selection. A folder, type, UI card, mock, prompt or adapter stub is not proof that an Engine is complete. Acceptance-test definitions are not results.

The 21 INV domains are connected **logical modules**, not a requirement for 21 independent applications or microservices. The recommended initial deployment shape is a provider-aware modular monolith with strict domain ownership and replaceable adapters. Untrusted execution workers must have a separate security/deployment boundary from the trusted BeamCore application.

The current BeamCore UI and its established visual direction remain the presentation baseline. This document does not authorize redesign or replacement of the dashboard, navigation, brand or working interactions.

## 2. Whole-system model

The principal governed journey is:

**Intent → Work and accepted Outcome target → Plan / Work Graph → Orchestration Run → Authorization and Capability admission → Execution Attempt → Artifact and Evidence → Verification / Outcome assessment → Work lifecycle update.**

Creation, intelligence, files, connectors, organization, usage, communications, deployment and recovery participate through the contracts of their owning Engines. No Engine may bypass another Engine's source-of-truth or enforcement boundary to shorten the flow.

### 2.1 Non-negotiable ownership distinctions

| Distinction | Correct ownership / meaning |
|---|---|
| Intent vs accepted Outcome | INV-01 interprets and proposes; INV-02 accepts and versions the Work target; INV-08 assesses it using evidence. |
| Work vs Project / Task | INV-02 owns durable Work continuity. A UI Project or task is not a replacement for Work. |
| Plan vs Work Graph | INV-03 owns both, but as distinct objects and revisions: Plan is strategy; Graph is validated dependency structure. |
| Validated vs active Graph | INV-03 validates; INV-02 owns the active Work binding and activation receipt. |
| Orchestration vs Execution | INV-04 coordinates; INV-05 runs the actual attempt and records effect/termination/cleanup facts. |
| Capability vs eligibility vs authority | INV-07 defines and admits capabilities; INV-06 decides whether the principal may perform this action now. |
| Identity vs authentication vs authorization | Authentication proves a principal; INV-18 supplies membership/role facts; INV-06 decides action authority. |
| Memory vs Knowledge vs Evidence vs Context | INV-09 governs retained recall; INV-10 owns durable Knowledge/Artifacts; INV-08 owns evidence/verification; Context is permitted information selected for a step. |
| File vs Artifact | INV-16 owns raw File identity/intake/extraction; INV-10 owns durable Artifact identity/version/lineage. |
| Execution success vs Outcome success | Process completion says what happened to a step; INV-08 determines whether the accepted result was achieved. |
| External observation vs World State certainty | INV-12 observations are source/time/coverage-bound and can be stale, partial, conflicting or unknown. |
| Notification vs source state | INV-17 communicates source-owned facts; it does not own approvals, Work, incidents or Outcomes. |
| Membership / role vs authorization | INV-18 owns membership and scoped role facts; INV-06 makes current authorization decisions. |
| Entitlement vs permission | Entitlement is product/feature/quantity eligibility; it does not grant access to a resource or action. |
| Usage vs billing | INV-19 owns measurements, usage ledger and limits; INV-20 owns commercial and financial facts. |
| Artifact readiness vs deployment | INV-14 proposes creation readiness; INV-21 owns release/deployment operations. |
| Deployment health vs Outcome | A healthy service or preview is not proof of the user's intended Outcome. |

### 2.2 Universal invariants

- One source of truth per domain; cross-engine communication uses typed references, versioned facts and acknowledgements.
- Every protected operation resolves authenticated actor and scope from trusted server-side context, validates current membership/policy/authority, and rechecks at the enforcement boundary.
- Material revisions preserve history. Mutations use expected-version checks and stable idempotency identities where retries could duplicate effects.
- Published artifact versions, accepted targets, execution attempts, financial ledger records and evidence history are not silently overwritten.
- A timeout after a possible external side effect becomes `UNKNOWN` / reconciliation-required. It is not automatically failure, success or permission to retry.
- Cancellation requests stop future work where possible; they do not prove an in-flight external effect was undone.
- Secrets never enter browser bundles, normal model context, ordinary Memory, generated files, artifacts, test fixtures or unredacted logs.
- User content, files, model output, tool output and connector responses are untrusted until validated for their intended purpose.
- Required audit is durable and separately governed from sampled diagnostic telemetry.
- No build, process exit, successful API response, preview, notification receipt, payment callback or deployment health check alone proves the intended Outcome.

## 3. Complete engine ownership and implementation map

The implementation pattern indicates where the domain truth belongs; it does not mean an Engine is already implemented.

| INV | Engine | Owns / must contain | Vision 1 activation |
|---|---|---|---|
| 01 | Core / Intent & Decision | Canonical shared types; IntentRequest and immutable NormalizedIntent revisions; explicit requirements, assumptions, unknowns, ambiguities and constraints; OutcomeProposal; ClarificationRequest; RouteProposal, DecisionRecord, lineage, typed handoff receipt and explanations. Must distinguish user-stated facts from contextual facts and assumptions, ask clarification for material ambiguity, choose bounded routes and reconcile missing handoff receipts. | Required, bounded intent/clarification/route/model-inference entry point. |
| 02 | Work | Durable scoped WorkRecord and immutable WorkRevision; accepted Work-scoped Outcome target and acceptance basis; lifecycle, phase, blockers, relationships, timeline, closure disposition, pause/resume/cancel and status projections. A Work may outlive chat and link multiple Plans, Graphs, tasks, executions, artifacts and evidence records. | Required. |
| 03 | Planning / Work Graph | Separate PlanRecord/PlanRevision and WorkGraph/GraphRevision; node/edge dependencies, validation findings, cycle detection, activation request/receipt and ChangeImpactReport. Support lightweight plans for simple work and selective replanning for changed work. | Required for multi-step work; do not force full graph for simple answers. |
| 04 | Orchestrator | Durable OrchestrationRun pinned to exact Work, accepted target, Plan/Graph revision and activation receipt; node coordination, dependency gates, dispatch attempts, waits, checkpoints, retries, resource admission, cancellation reports, reconciliation and escalation. | Required for multi-step/background work; bounded durable coordination. |
| 05 | Execution Runtime | ExecutionRecord, append-only ExecutionAttempt, RuntimeProfile, ResourceMeasurement, checkpoints, cancellation, termination, cleanup and effect-knowledge records. Provider mechanics are behind replaceable adapters. | Interface required; actual generated-code execution gated by independent isolation assurance. |
| 06 | Identity / Authorization / Policy | Verified principal/session context; AuthorizationRequest/Decision; policy release/evaluation; risk context; scoped approvals, delegation, revocation and audit. Recheck current authority at action time. | Mandatory before protected actions. |
| 07 | Capability Registry / Secure Tool Gateway | CapabilityDefinition and immutable versions/contracts; release and eligibility lifecycle; schema/input/output validation; dependencies, side-effect, idempotency, secret and resource requirements; one enforced invocation gateway; results, revocation and reconciliation. | Minimal allowlisted registry and gateway required; no model-to-arbitrary-tool route. |
| 08 | Verification / Evidence | EvidenceRecord, VerificationRequest/Run, CriterionResult, Evidence relations, AssuranceProfile and OutcomeAssessment. Preserve exact target/criterion/artifact versions, methods, evaluator, evidence lineage, freshness, limitations and contradictions. | Mandatory criterion-level Outcome verification. |
| 09 | Memory | MemoryScope, provenance, source references, trust/classification/quarantine, candidate/write/read/promotion/delete/correction/export/retention gates, versions and deletion propagation. Memory is recall, not source of truth. | M0 domain foundation required; bounded STM/M1 only with TTL/cleanup/scope assurance; protected LTM/M2 disabled. |
| 10 | Knowledge / Artifact | Stable KnowledgeObject and Artifact identity; immutable ArtifactVersion; manifest/digest, dependencies, source/transform lineage, preview/export handles, currentness and deletion/invalidation. | Required immutable artifacts and lineage. |
| 11 | Observability / Audit | Telemetry context, durable AuditEvent, logs/traces/metrics, separate System/Service, Work and Outcome health projections, alert/Incident lifecycle, SLI/SLO and OMNI Care loop. Owns incident correlation, not other Engines' domain data. | Required baseline audit, correlation, redaction and health views. |
| 12 | World State / External Sources | ExternalSourceRecord and authority profiles; observations, source time, retrieval time, freshness, query coverage, consistency, snapshots, changes and expected-vs-observed reconciliation. Absence/partial queries do not prove absence. | Broad external observation deferred; reconciliation semantics remain mandatory for uncertain external effects. |
| 13 | Intelligence / Research | ResearchRequest/Run/Plan; source and claim records, citation/source links, contradictions, uncertainty, synthesis, model route decisions and time/source/token/cost budgets. Distinguish sourced facts, inferences, recommendations and unresolved questions. | Thin provider-neutral server inference for INV-01/14; broad autonomous research deferred. |
| 14 | Creation | CreationProject, RequirementSpec, CreationBlueprint, FS-01–FS-20 component dispositions, CreationBuildRequest, CreationTestPlan and CreationReadinessReport. Must request Plan/Graph, execution, artifact, verification and deployment through their owners. | Required but bounded to an explicitly supported web-app target profile. |
| 15 | Connector / Integration | ConnectorDefinition/Version, ConnectionRecord, external identity/account/resource mapping, consent/scopes, credential references, OperationDefinition, ExternalCallAttempt, webhook subscription/delivery, sync checkpoints, health, normalized errors and reconciliation. | Provider-neutral adapter framework; only explicitly approved operations active. |
| 16 | File / Multimodal | Raw FileRecord/FileVersion; UploadSession/chunks and digests; actual type inspection; scanner/safety profile; quarantine/release; isolated ProcessingRun; modality-specific ExtractedSegments and source locators; derivative provenance; source invalidation and deletion propagation. | Full multimodal deferred; limited safe file path only if required and after security/storage bindings. |
| 17 | Notification / Communication | NotificationRequest, policy decision, recipient resolution, channel plan, versioned templates, durable outbox, DeliveryRecord/Attempt, ProviderReceipt, preferences, suppression/defer/digest and in-app AttentionRef. Delivery/read/action/approval are separate. | In-app attention/status may be used; outbound channels disabled/deferred. |
| 18 | Organization / Membership / Entitlement | OrganizationRecord, Membership, Invitation, scoped RoleAssignment, ContextSelection, effective EntitlementView, offboarding and organization lifecycle workflows with acknowledgements. | Minimum personal/workspace/org context, membership, scoped roles, isolation and revocation required; enterprise breadth deferred. |
| 19 | Usage / Metering / Spend Limits | Versioned meter, trusted RawUsageObservation, append-only UsageLedgerEntry, aggregation revisions, budgets, atomic SpendReservation, LimitDecision, adjustments, cost assessments and provider reconciliation. | Basic measured usage attribution and resource/spend limits mandatory before expensive work. |
| 20 | Billing / Subscription / Payments | Product/plan/price versions, billing customer/account and explicit bill-to, commercial contract, quote/invoice, payment attempts/allocation/settlement, commission/fees where approved, refunds/credits/disputes, provider event ledger and financial reconciliation. | Revision 1.1 proposes bounded App Owner payment/commission slice, subject to explicit scope and release approval; full subscription/general billing deferred. |
| 21 | Deployment / Operations / Recovery | Environment profiles/records, immutable ArtifactReleaseManifest, ReleaseCandidate/gates/approval refs, DeploymentOperation/Attempt, config/secret references, health checks, migration, BackupSnapshot, RecoveryOperation, rollback/forward-fix and runbook executions. | Readiness/interface only initially; production generated-app deployment disabled until separate release gates pass. |

### 3.1 INV-14 creation completeness catalogue

Every target profile must explicitly disposition all FS-01–FS-20 components as `REQUIRED`, `NOT_REQUIRED`, `EXTERNAL_DEPENDENCY` or `UNSUPPORTED_OR_UNRESOLVED`, with rationale and evidence. No material component may disappear silently.

| ID | Area | Required concern |
|---|---|---|
| FS-01 | Requirements / acceptance | Actors, workflows, business rules, assumptions, non-goals, open questions and measurable acceptance criteria. |
| FS-02 | Architecture / dependencies | Component map, trust boundaries, data flow, dependencies and versions. |
| FS-03 | Frontend / UI | Working flows, validation, loading/empty/success/error states, responsiveness and accessibility. |
| FS-04 | Backend / services | Real server-side business rules and validation, not critical logic only in UI. |
| FS-05 | Data / storage | Entities, relations, constraints, indexes, migrations, seed/fixture data. |
| FS-06 | APIs / webhooks | Schemas, auth, errors, rate/abuse limits, idempotency and signatures. |
| FS-07 | Identity / access | Backend-enforced roles, permissions and tenant isolation. |
| FS-08 | Business processes | State transitions, approvals, notifications, exception paths. |
| FS-09 | Admin/operator/customer surfaces | Usable role-specific workflows and operating controls. |
| FS-10 | Integrations | Provider, scopes, secret boundary, fixtures/sandbox, failure and reconciliation. |
| FS-11 | Reports / analytics | Metric definitions and calculations reconciled against source data/fixtures. |
| FS-12 | Security / privacy | Trust boundaries, classification, secrets, validation and least privilege. |
| FS-13 | Tests / evaluation | Structural, unit, contract, integration, E2E, permission and security tests. |
| FS-14 | Packaging / build | Reproducible build/package, dependency inventory and environment config. |
| FS-15 | Deploy / release | Environment, migrations, approvals, rollout and stop/rollback path. |
| FS-16 | Operations / recovery | Health, telemetry, owner, backup/restore, incident and forward repair. |
| FS-17 | Documentation / handover | Setup/run, user/admin/operations guides, API docs and limitations. |
| FS-18 | Change/version | Versions, dependencies, impact/revalidation and prior verified versions. |
| FS-19 | Export / portability | Export contents/limits/config boundaries/formats and restore/move proof. |
| FS-20 | Outcome verification | Map accepted Work criteria to INV-08 evidence and verdicts. |

## 4. V1 scope and gates

The 21 INV chapters define the broader architecture. Vision 1.1 activates only the bounded parts needed for the first Work-centered end-to-end journey.

### 4.1 Core participation

- **Must include:** INV-01, 02, 03, 04, 06, 07 (minimal), 08, 10, 11 (baseline), 14 (bounded), 18 (minimum foundation), 19 (basic).
- **Staged:** INV-09 M0; M1 only if scope, TTL, cleanup and revocation behavior are approved.
- **Thin inference:** INV-13 server-side model gateway/routing for supported intent and creation tasks.
- **Bounded adapters:** INV-15 only approved providers and operations.
- **In-app only:** INV-17 where source-backed attention/approval/blocker UX is required.
- **Interface/readiness:** INV-05 and INV-21 until their independent gates pass.
- **Narrow/fixture-based:** INV-12 reconciliation semantics; INV-16 safe file references/intake only if the proving-ground requires it.
- **Conditional commercial proposal:** INV-20 payment/commission slice under Vision 1.1 Revision 1.1; live operations remain separately gated.

### 4.2 Explicitly gated/deferred capabilities

- Unrestricted generated-code execution, arbitrary shell access, open egress or execution on trusted BeamCore API/browser.
- Protected long-term Memory and automatic STM-to-LTM promotion.
- Broad autonomous research and general source/claim graph.
- Public connector marketplace, arbitrary endpoints, unrestricted OAuth, generic webhooks/broad synchronization and unrestricted network egress.
- Full OCR/audio/video/archive multimodal pipeline before safe intake/parser/scanner/storage controls.
- External email/SMS/push/social/voice notification channels.
- Enterprise organization/federation/SCIM and complex transfer/merge/split operations.
- Subscription catalog, recurring billing, general invoice/tax/accounting automation, wallet/stored value and broad commercial billing.
- Production generated-app publishing, public custom domains, multi-region failover, self-hosted/private/hybrid profiles and formal availability/recovery commitments.

### 4.3 G0–G6 release gates

| Gate | Required evidence | Permitted capability |
|---|---|---|
| G0 — Scope and bindings | Approved V1 scope, provider/binding register and unresolved-decision disposition | Begin foundation implementation. |
| G1 — Identity/data | Verified principal, scope model, DB migrations, server-side tenant isolation tests | Persist private platform records. |
| G2 — Work/AI | Work lifecycle/accepted target, server-side AI, schema validation, provider error/usage handling | Real intent-to-Work flow and controlled interpretation. |
| G3 — Plan/creation | Immutable Plan/Graph, INV-14 blueprint and structured file/artifact versions | Generate/revise files for supported target profile. |
| G4 — Runtime assurance | Independently tested isolated runtime, resource and egress policy | Build/test execution and restricted preview for approved profile. |
| G5 — Verification/operations | Outcome evidence, audit, metering, failure/recovery tests | Claim the defined V1 slice as functionally verified. |
| G6 — Production release | Separately approved environment, artifact integrity/provenance, security/recovery and deployment verification | Production deployment for approved target only. |

A UI that looks complete or an available provider dashboard does not skip a gate.

## 5. Canonical cross-engine contracts

### 5.1 Shared types: INV-01 is the only declaration source

Other engines define their domain records but MUST NOT redefine these common types with alternative field names or meanings.

- `ID`: opaque stable identifier.
- `Timestamp`: timezone-aware RFC 3339 timestamp.
- `RevisionNumber`: positive integer for ordered domain revisions.
- `Version`: opaque stable concurrency token; canonical external/logical representation is string.
- `ScopeRef`: `scope_id`, `scope_kind`, optional parent scope.
- `PrincipalRef`: `principal_id`, `principal_kind`, optional home scope.
- `ObjectRef`: `object_kind`, `object_id`, optional `object_version`, required `scope_ref`.
- `SourceRef`: typed ObjectRef, source version, optional locator/digest/observed timestamp and trust/freshness labels.
- `RequestContext`: request ID, correlation ID, actor ref, authenticated scope ref, issued timestamp, optional deadline, idempotency key and expected version.

Do not add an alternate `{kind, id, version}` object-reference shape. Do not make an engine-specific replacement such as `OrgRequestContext` or `DeploymentRequestContext`. Engine-specific target, graph, capability, approval, artifact, budget and environment fields belong in typed command payloads.

### 5.2 Common operation result

The canonical common operation status is exactly:

`OK | PARTIAL | REJECTED | UNKNOWN`.

Domain states such as `ACCEPTED`, `PENDING`, `PASS`, `FAIL`, `COMPLETED`, `DELIVERED` and `SETTLED` stay in owning Engine payloads/state/verdicts. They do not replace the common envelope.

`OperationResult.status=OK` means that the invoked operation completed. It does not mean a downstream handoff was accepted, an external side effect occurred, a process ran successfully or the intended Outcome passed verification.

Errors use the canonical INV-01 OperationError code/safe-message/retryability/details-reference structure. An extension to the shared error catalogue requires a versioned contract change.

### 5.3 Event envelope, inbox and outbox

The logical event envelope carries:

- `event_id`, `event_type`, `schema_version`, `occurred_at`, `producer_engine`;
- exact `object_ref` and applicable `scope_ref`;
- `correlation_id`, optional `causation_id`, optional `actor_ref`;
- minimal typed payload and version/provenance information needed by consumers.

Events can be duplicated, delayed and out of order. Consumers deduplicate stable event IDs and reject stale aggregate/object versions. A transaction plus outbox (or equivalent) protects locally committed domain changes from being lost before dispatch. Incoming event receipts are stored in an **inbox**. Locally emitted domain facts are stored in the **outbox**. Do not use a single table as both.

Transport, delivery guarantees, ordering, replay, leases/locks and dead-letter mechanisms are physical bindings; they must preserve the logical contract.

### 5.4 Handoff rules

- A RouteProposal is a request, not an execution command.
- The recipient Engine acknowledges acceptance/rejection/unknown and creates or updates its own authoritative record.
- Handoff requested is not handoff confirmed.
- If acknowledgement is missing, preserve UNKNOWN and query/reconcile before resubmission.
- A successful handoff is not proof of execution or Outcome success.
- The same idempotency key with the same payload returns the original logical result; the same key with materially different payload is a conflict.
- Long-running operations recheck authority, version and stop/cancel state after pauses/resume.

## 6. Cross-engine handoff map

| From → To | Handoff content | Authoritative receipt/result |
|---|---|---|
| INV-01 → INV-02 | Normalized intent, requirement/assumption/unknown/constraint refs and OutcomeProposal | INV-02 creates Work and returns acceptance/rejection receipt for exact accepted target revision. |
| INV-02 → INV-03 | Accepted Work target/revision and constraints | INV-03 returns versioned Plan/Graph proposals and validation/impact records. |
| INV-03 → INV-02 | Validated Graph revision and activation request with expected Work version | INV-02 returns GraphActivationReceipt and owns active Plan/Graph pointers. |
| INV-02/03 → INV-04 | Work/target, Plan revision, active Graph revision, activation receipt and pinned node versions | INV-04 creates durable run pinned to those versions. |
| INV-04 → INV-06/07/19 | Proposed node operation, actor/scope, capability/version, requested resources and idempotency identity | INV-06 authorization, INV-07 capability admission and INV-19 resource/limit decision. |
| INV-04/07 → INV-05 | Admitted execution request with exact runtime profile, input digest, limits and authorization refs | INV-05 records Execution/Attempt and later output, measurements, termination, cleanup and effect knowledge. |
| INV-05/14/15/16 → INV-10 | Output/file/build material and source/version/provenance refs | INV-10 creates immutable ArtifactVersion/manifest/lineage refs. |
| INV-05/10/12/14 → INV-08 | Evidence candidates, artifacts, outputs, observations and accepted criteria refs | INV-08 returns criterion-level results and target-version-bound Outcome verdict. |
| INV-08 → INV-02 | Outcome assessment reference with target/criteria versions | INV-02 updates Work lifecycle/closure under its own transition rules. |
| INV-05/providers → INV-19 | Trusted runtime/provider measurement observation | INV-19 accepts/deduplicates ledger entry and settles reservation. |
| INV-15 → INV-12 | External operation receipt/observation with provider/source identity | INV-12 records source-bound observation and reconciliation status. |
| Source Engines → INV-17 | Minimal source event/version and optional AttentionRef | INV-17 evaluates recipient, policy, consent, channel and records delivery state. |
| INV-18 → INV-06/07/15/17/19/20 | Current membership, role, scope and entitlement facts with version/freshness | Consumer rechecks its own authorization/policy; membership does not itself grant access. |
| INV-14/10/08/06/19 → INV-21 | Release proposal, immutable artifact digest, provenance, verification, approval and budget evidence | INV-21 records candidate, gate decisions, deployment operation and health/recovery evidence. |

## 7. Technology-binding reconciliation

Technology Decision Register 1.1 is a **proposed** baseline. Its own status leaves compatibility checks and repository gap audit open. Its provider names must not be treated as blanket approval to provision services.

### 7.1 Material repository mismatch

The audited repository evidence in the source review identifies:

- **Actual application:** Remix 2.10.2, React 18, TypeScript and Vite; `@remix-run/*` and `@vercel/remix` are present.
- **TDR assumption:** Next.js 16 App Router and React 19 are labelled as the previous repository baseline in the decision register.

The repository is the implementation evidence. Therefore Next.js-specific recommendations (such as Next Route Handlers or Next-only workflow integration assumptions) cannot be applied literally without a compatibility review. Do not migrate to Next.js simply to match an inaccurate baseline statement. Any migration requires a demonstrated blocker, impact review and explicit approval. Recheck the exact repository head before binding SDK versions.

### 7.2 Candidate technologies and safe dispositions

| Area | TDR proposal / repository fact | Reconciliation disposition |
|---|---|---|
| Framework | TDR: Next.js 16/React 19 baseline; repo: Remix 2.10.2/React 18 | Keep actual repo baseline during this work; test compatibility against Remix. No migration by assumption. |
| Authentication | Firebase Auth proposed default; no complete BeamCore auth/authorization foundation found in inspected branch | Evaluate server-verified sessions and Remix/Vercel integration. Firebase remains proposed until compatibility/security tests pass. Authentication is not INV-06 authorization. |
| Database | PostgreSQL logical model; SQL Connect proposed default; direct Cloud SQL + Drizzle named single fallback | Select one authoritative relational store only after compatibility, transaction, region, access-control and cost checks. Do not create dual authoritative stores or add Firestore as a shortcut. No paid provisioning is authorized by this review. |
| Object storage | Firebase Storage proposed default | Keep INV-10 artifact semantics provider-neutral; test private scope, versions, digest, temporary access and deletion propagation before binding. |
| AI | Vercel AI SDK/Gateway proposed default; existing Gemini/Groq/OpenRouter adapters in repo | Preserve server-only provider-neutral inference boundary. Evaluate whether Gateway materially helps and whether it supports current Remix deployment. Keys must remain server-only. |
| Durable workflow | Vercel Workflow SDK proposed default with Next.js assumptions; no proven durable workflow in repo | Verify Remix/runtime compatibility, persistence, retry, wait/resume, cancellation, outbox and deployment behavior before selection. Do not add several workflow platforms. |
| Runtime | Vercel Sandbox is TDR's gated candidate; Daytona SDK/route and WebContainer are present in branch | Presence is not security assurance. Compare actual providers using the same isolation, egress, secret, resource, cancellation, termination and cleanup tests. Keep execution gated. |
| Events | Transactional DB outbox architecture-locked; Kafka/NATS deferred | Implement minimum inbox/outbox and durable workflow handoff after DB choice; no broker fleet without measured need. |
| Audit/telemetry | INV-11 durable audit plus OpenTelemetry-compatible tooling proposed | Durable audit is a separate source of truth; logs/traces/metrics are redacted diagnostics and cannot replace it. |
| Vector search | Separate vector database deferred | Do not add vector storage without a measurable retrieval requirement and approved privacy/deletion policy. |
| Notifications | In-product projection only | No outbound channel without consent, recipient, adapter, receipt, retry and privacy gates. |
| Payments | BeamCore-managed payment and commission proposal under Vision 1.1 | Simulated/test only until scope, provider, commercial, legal/finance, security and reconciliation gates are explicitly approved. |
| Deployment | Vercel deployment path is current project context; generated-app production deployment deferred | Preserve readiness interface. No generated-app production publish or claims of recovery readiness without INV-21 evidence. |

### 7.3 Compatibility gates

- **Database/identity/offline:** real repository/runtime compatibility; privileged server SDK behavior; relational ownership; transaction/version/idempotency; tenant isolation; revocation; IndexedDB offline outbox and reconnect conflict semantics; region/cost.
- **Workflow/AI:** current Remix/Vercel app compatibility; durable restart/retry/wait/resume/cancel; transactional outbox dispatch; schema validation; provider fallback; usage/error capture; no secrets in browser bundle/log.
- **Sandbox:** independent per-job isolation; deny-by-default egress; no platform or other-tenant secrets/data; CPU/RAM/disk/time/concurrency limits; cancellation/termination; cleanup; artifact export control; escaped-process/network/filesystem negative tests.

A failed sandbox gate blocks execution/preview, not the whole Work-centered product. A failed DB/workflow compatibility gate requires the single named fallback or a recorded decision; it does not reopen unrestricted vendor search.

## 8. Repository gap register

**Evidence snapshot:** inspected code branch `beamcore-native-engine`, commit `9d1cefc011ecccc497a745b3ce68e76edd82b5f7`. The documentation branch for this file is separate and must not be treated as the audited code branch.

Observed findings from that code snapshot:

- The app uses Remix 2.10.2 / React 18 / TypeScript / Vite, not Next.js 16 / React 19.
- Existing AI adapters include Gemini, Groq and OpenRouter. `api.chat.ts` still combines simple build-intent regex routing with model/build handling; its build path did not use the normal chat fallback route in the reviewed implementation.
- `ActionRunner` can dispatch through Daytona and WebContainer fallback, but it is not a durable INV-04 orchestration store or complete INV-05 server-side Execution/Attempt ledger.
- Workbench Project state is a UI workspace record, not canonical INV-02 Work.
- Chat history in `db.ts` / `useChatHistory.ts` is browser IndexedDB; it is not durable server-side Work persistence.
- No authoritative platform PostgreSQL DB, verified BeamCore authentication/membership boundary or complete INV-06 action-time authorization foundation was found in that inspected snapshot.
- The Daytona route had preview-only guest guards, same-origin checks and request validation in the branch under review. Same-origin is CSRF mitigation, not authentication. A preview guest route must remain closed unless it is explicitly approved and protected.
- Parser/ActionRunner/preview-handoff repairs are useful tactical fixes but do not replace Work, Planning, Orchestration, Evidence/Verification or Artifact source-of-truth modules.

### 8.1 Priority gaps

| Gap | Priority | Finding | Closure evidence |
|---|---|---|---|
| GAP-01 | P0 | No canonical durable server Work store/accepted Outcome target in inspected branch | Authenticated scope persistence, immutable revisions, acceptance receipt and lifecycle tests. |
| GAP-02 | P0 | No verified BeamCore identity/session plus action-time authorization foundation | Auth/session, membership, tenant isolation, revocation freshness and negative IDOR tests. |
| GAP-03 | P0 | No durable Plan/Graph activation and Orchestration Run foundation | Pinned revisions, activation receipts, restart/retry/reconcile/cancel tests. |
| GAP-04 | P0 | No independent generated-code sandbox assurance | Isolation, deny egress, filesystem/secrets, resource, cancellation, cleanup and escape negative tests. |
| GAP-05 | P0 | TDR framework baseline conflicts with real repo | Compatibility review using actual Remix/React runtime; no assumed migration. |
| GAP-06 | P0 | Platform DB, session provider and workflow binding remain unverified | Database/identity/workflow compatibility spikes, recorded cost/region/security results. |
| GAP-07 | P1 | Regex build routing is not full INV-01 decision lifecycle | Versioned intent, clarification, Outcome proposal, route and recipient handoff receipt. |
| GAP-08 | P1 | ActionRunner is not durable INV-04/05 source of truth | Durable run/attempt, dispatch idempotency, measurement, termination and cleanup. |
| GAP-09 | P1 | Project/file records do not establish INV-10 ArtifactVersion/manifest/lineage | Immutable artifact record, digest, source and transform lineage. |
| GAP-10 | P1 | Criterion-level Evidence/Verification/Outcome not complete | INV-08 exact target/criteria, evidence admissibility, freshness and verdict tests. |
| GAP-11 | P1 | Basic logs are not INV-11 durable audit/health/Incident system | Durable audit, redaction, correlation and separate System/Work/Outcome health. |
| GAP-12 | P1 | Trusted usage ledger and atomic resource reservations missing | Source meters, attribution, concurrent reservation and hard-limit enforcement tests. |
| GAP-13 | P1 | Provider choices not proven against actual repository runtime | Per-binding compatibility tests and a single authoritative provider selection. |
| GAP-14 | P2 | Broad research, protected LTM, multimodal, outbound channels, enterprise org and production publish are deferred | Keep disabled; reopen only with user need, scope change, owning engine and gates. |

Priority is relative to the approved controlled V1 journey, not an instruction to build all future capabilities immediately.

### 8.2 CI/test truth

CI evidence must be checked against the exact head commit each time. Previous runs on the engine branch reported failures at the test stage even after typecheck fixes. This document does not claim the current branch passes CI, and it does not claim any unrun acceptance test passed. A final status requires exact workflow run IDs, commands, environments, output and commit SHA.

## 9. Document-level contradictions / open decisions

| ID | Issue | Safe disposition |
|---|---|---|
| DEC-01 | TDR 1.1 labels Next.js 16 / React 19 as baseline while the code repository uses Remix 2.10.2 / React 18. | Treat as a documentation/repository mismatch. Re-run provider compatibility decisions on actual Remix. No framework migration by assumption. |
| DEC-02 | Vision 1.1 Revision 1.1 proposes managed App Owner payment/subaccount/commission/settlement; INV-20 Gate A disables billing/payment; TDR calls payment conditional/live-gated. | Keep simulated/test flows only until explicit controlled scope approval and all commercial, provider, legal/finance, security, operations and reconciliation gates pass. |
| DEC-03 | Daytona exists in code; Vercel Sandbox is another gated candidate. | No provider selected from code presence. Use one shared independent runtime assurance suite. |
| DEC-04 | Vercel Workflow SDK proposal relies on Next.js assumptions; actual repo is Remix. | Workflow provider remains unbound until the actual Remix/Vercel compatibility gate passes. |
| DEC-05 | INV-17 says 80 tests but enumerates NOTIF-T01 through NOTIF-T82. | Preserve all 82 identifiers and correct the count in a versioned source amendment; do not drop NOTIF-T81/T82. |
| DEC-06 | Multiple chapters repeat shared type/request/result definitions. | INV-01 remains the single canonical source for shared shapes; downstream engines define only domain payloads. Field changes require versioned reconciliation. |
| DEC-07 | Existing Workbench Projects may be interpreted as canonical Work. | Maintain separate Project/UI context and INV-02 Work domain records; connect them with typed references only. |

### 9.1 Payment/commission decision still requiring explicit approval

Vision 1.1 proposes a specific product direction: BeamCore owns the master merchant integration; App Owners submit beneficiary/business details and settlement bank details; BeamCore creates/maps provider subaccounts where supported; a versioned commission policy allocates proceeds; provider fees, commission, refunds, disputes and settlement must reconcile.

The proposal does **not** select the launch provider, commission percentage, fee bearer, countries/currencies, tax treatment, dispute policy or settlement timings. Paystack and Flutterwave are candidates, not interchangeable pre-approved implementations. No independent App Owner merchant account is assumed.

Until explicit scope approval and provider/legal/finance/security/test/operational acceptance, keep live charges, settlements, refunds and payouts disabled. No wallet/iCoin, escrow, general subscription billing or broad payout rail is implied.

## 10. Ordered implementation sequence

These are work packages, not 21 independent projects.

1. **Freeze semantic baseline and resolve contradictions.** Record actual repository/runtime baseline; agree the first supported creation proving-ground requirements; keep proposed providers as ports until tested.
2. **Platform foundation.** Bind one relational database, server-verified identity/session, scope/tenant enforcement, migrations, shared types, secrets, durable audit and separate inbox/outbox transaction pattern.
3. **Core Work spine.** Implement INV-01/02/03/04: intent/clarification, durable Work and accepted target, Plan/Graph revision/activation, durable orchestration and safe recovery.
4. **Control and budget spine.** Implement INV-06/07/18/19: current membership and authorization, allowlisted capabilities, action-time enforcement, trusted usage and concurrency-safe bounded reservations.
5. **Creation and result spine.** Implement bounded INV-13, INV-14 FS-01–FS-20 target disposition, INV-10 immutable artifacts and INV-08 criterion-level evidence/verification.
6. **Operational support.** Implement INV-11 baseline, INV-09 M0 (and M1 only if approved), INV-17 in-app attention, INV-12 reconciliation fixtures and only required safe INV-16 file references.
7. **Runtime assurance.** Select/test the isolated runtime. Keep generated-code execution and live preview disabled until all independent isolation/egress/resource/secrets/termination/cleanup tests pass.
8. **Conditional commercial/release readiness.** After explicit scope approval, implement bounded INV-15/20 payment/commission in provider test mode; live operations require separate release authorization. Keep INV-21 readiness-only; production generated-app publishing requires separate G6 approval.

## 11. Engine completion and evidence policy

An Engine can be reported as complete only when:

- its ownership and non-responsibilities match the source INV chapter;
- its logical records, transitions and invariants are implemented and validated;
- canonical INV-01 shared contracts are used without local aliases;
- scope, action-time authorization, version, idempotency and secret boundaries are tested;
- applicable duplicate, late/out-of-order, timeout, cancellation, UNKNOWN, partial, reconciliation and recovery cases are covered;
- cross-engine handoffs and failure behavior are tested against the actual recipient contracts;
- acceptance-test IDs map to runnable test cases and recorded outputs;
- evidence names the tested commit/version, environment, exact command, fixture/input, observed result and artifact;
- gated/deferred paths remain disabled with truthful status;
- UI changes are limited to exposing real working states in the current BeamCore design.

**Documentation review = DOCUMENTED, not TESTED_PASS.** No test is PASS unless actually executed with evidence. No UI display, model response, build, process exit, preview, provider callback or deployment health result alone proves Outcome success.

## 12. Source traceability and authority

- **INV-01–INV-21 specifications v2.9:** authoritative for each Engine's logical responsibilities, ownership, records, interfaces, invariants, lifecycle and acceptance-test definitions.
- **A–S Current Truth:** cross-engine semantic principles and established architecture distinctions.
- **BeamCore Vision 1.1:** proposed V1 user journey, activation boundaries, G0–G6 gates, UI preservation and Revision 1.1 payment-scope proposal. Its status remains pending controlled approval where stated.
- **Engine & Technology Decision Register 1.1:** proposed technology defaults, compatibility gates, payment-provider/commission architecture proposal and repository gap-audit requirements. Proposed provider defaults are not final vendor lock.
- **Current repository source:** authority for the actual framework, dependencies, modules, code paths, CI and deployment evidence at the commit inspected.

This reconciliation document is an implementation aid; it does not supersede the source INV chapters. Any later source-backed contradiction must be recorded with the exact conflicting contract, impact, owner and versioned resolution.
