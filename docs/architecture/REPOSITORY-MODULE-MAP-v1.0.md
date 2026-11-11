# BeamCore Repository-to-Module Map v1.0

**Status:** Architecture assessment and proposal only. No application source files changed.  
**Inspected branch:** `beamcore-native-engine`  
**Inspected commit:** `9d1cefc011ecccc497a745b3ce68e76edd82b5f7`  
**Purpose:** Map existing source code to the proposed implementation packages while preserving all 21 logical INV identities.

## 1. Executive finding

The inspected repository is a Remix 2.10.2 / React 18 / TypeScript application. It is not a Next.js 16 / React 19 application. Its existing organization is primarily by UI feature and technical concern, not by the proposed domain packages.

The right approach is a **modular monolith**: nine implementation package groups, with the 21 logical Engine IDs remaining distinct. The nine groups are co-location choices, not nine replacement Engines and not nine microservices.

The inspected native-engine snapshot has approximately 153 tracked files. Its main application folders are `app/components`, `app/lib`, `app/routes`, `app/styles`, `app/types`, and `app/utils`. No server-side relational schema, ORM setup, or migration directory was found in this tree. Existing persistence is browser IndexedDB chat history, not a durable server Work database.

Branches differ. This map is specifically for `beamcore-native-engine` at the commit above; do not assume `main`, `deployment-fix`, or preview repair branches have identical contents.

## 2. Existing repository map

| Existing path | Current responsibility | Important boundary |
|---|---|---|
| `app/lib/.server/llm/*` | AI provider configuration, model construction, prompts, stream/generate wrappers | Provider infrastructure; not the full INV-01 Intent or INV-13 Research domains |
| `app/routes/api.chat.ts` | Chat endpoint, regex build-request detection, provider choice, generation, build-format validation and retry | Several application responsibilities are currently mixed in one route |
| `app/routes/api.enhancer.ts` | Prompt enhancement through AI stream wrapper | Small AI application endpoint |
| `app/lib/runtime/message-parser.ts` | Parses streaming project/action tags and emits callbacks | Creation protocol parser; not durable Plan or Artifact storage |
| `app/lib/runtime/action-runner.ts` | Queues and runs file/shell actions through Daytona with WebContainer fallback | Interactive runtime runner; not durable INV-04 Orchestration |
| `app/lib/runtime/command-utils.ts` | Dev-server detection, preview port estimation, path normalization, Daytona error classification | Runtime helpers |
| `app/lib/runtime/daytona-guard.ts` | Preview opt-in, same-origin, bounded JSON validation | Request/CSRF guard; not identity or action authorization |
| `app/routes/api.daytona.ts` | Daytona sandbox creation/restoration, file/sync/command/preview operations | Provider-specific runtime adapter endpoint |
| `app/lib/daytona.client.ts` | Browser-side Daytona calls and remote preview store | Daytona client adapter |
| `app/lib/webcontainer/*` | Browser runtime boot and support checks | WebContainer adapter |
| `app/lib/stores/workbench.ts` | Browser project cards, ActionRunner instances, editor/files/previews/terminal state | Workbench UI state; not canonical INV-02 Work |
| `app/lib/stores/files.ts` | Live workspace file map and runtime mirroring | Not governed INV-16 File lifecycle or INV-10 Artifact version registry |
| `app/lib/persistence/*` | IndexedDB chat history | Local chat history; not durable Work, Memory, or Knowledge |
| `app/components/chat/Artifact.tsx` | Project card/action list presentation | UI component, not INV-10 Artifact record |
| `app/types/actions.ts`, `app/types/artifact.ts` | Stream protocol types | Transport types, not canonical domain schemas |
| `app/utils/logger.ts` | Scoped console logging | Not INV-11 audit, traces, SLI/SLO, or incident management |
| `scripts/build-vercel.mjs`, `vercel.json`, `wrangler.toml` | Build and platform configuration | Deployment plumbing, not complete INV-21 lifecycle |

## 3. Proposed nine implementation package groups

### 1. Intent & Intelligence — INV-01 + INV-13
Reuse `app/lib/.server/llm/*`, `api.chat.ts`, and `api.enhancer.ts` as starting infrastructure. Extract separate Intent and Research modules. The current keyword/regex build-request detection is not a canonical NormalizedIntent workflow. No durable Source/Claim/Citation research records were found. Keep AI provider routing shared; keep Intent and Research records distinct.

### 2. Work Management — INV-02 + INV-03 + INV-04
Reuse `app/lib/stores/workbench.ts`, `message-parser.ts`, and `action-runner.ts` only as UI/protocol/runtime adapters. Workbench projects are browser state keyed by chat message ID, not durable Work identity, accepted Outcome target, WorkRevision, PlanRevision, WorkGraphRevision, or durable OrchestrationRun. Co-locate the modules but keep their records and state machines separate: Work owns active pointers; Planning owns versioned plans/graphs; Orchestration owns durable runs, waits, checkpoints, retries, cancellation, and recovery.

### 3. Identity & Access — INV-06 + INV-18
No BeamCore identity/membership domain module was found. The Daytona route explicitly notes that no BeamCore account-auth provider is wired in and production execution requires a trusted principal. Build Organization/Membership/Role facts separately from action-time Authorization decisions, scoped approvals, delegation, and revocation. Membership is not permission.

### 4. Capabilities & Integrations — INV-07 + INV-15
Reuse `api.daytona.ts`, `daytona.client.ts`, and `daytona-guard.ts` as a narrow Daytona adapter. They do not implement a versioned Capability Registry/Gateway or Connector connection/consent/scope/webhook/cursor/reconciliation lifecycle. Capability eligibility is not authorization; INV-06 must still authorize the principal.

### 5. Creation & Deliverables — INV-10 + INV-14 + INV-16
Reuse `message-parser.ts`, action/project protocol types, `stores/files.ts`, the ProjectCard, and editor/workbench UI. No canonical CreationProject/RequirementSpec/BuildRequest lifecycle, immutable ArtifactVersion/manifest/digest registry, or governed FileRecord/version/scan/quarantine/deletion lifecycle was found. Keep Creation, Artifact, and File as separate domain modules: Creation coordinates requirements/build; Artifact owns deliverables and lineage; File owns raw file intake and safety.

### 6. Assurance & External Truth — INV-08 + INV-11 + INV-12
Reuse current runtime/store/WebContainer tests and logger as foundations only. No durable EvidenceRecord/VerificationRun/OutcomeAssessment, audit/correlation and health model, or external observation/world snapshot/reconciliation lifecycle was found. Share correlation, event plumbing, and telemetry transport, but keep Verification, Observability, and World State authorities separate. Console logs are not audit records; runtime status is not Outcome verification.

### 7. Context & Attention — INV-09 + INV-17
Reuse IndexedDB only for local chat history and existing UI surfaces for future in-app attention. It is not governed Memory with scope/provenance/trust/TTL/quarantine/deletion propagation. No notification outbox/delivery domain was found. Keep chat history, Memory, and Notifications separate. M0 Memory foundation only; M1 conditional/bounded; M2 protected long-term memory disabled. V1 notifications in-app only.

### 8. Resources & Commerce — INV-19 + INV-20
No Usage Ledger, budgets/reservations, Invoice/Payment, Commission, Settlement, or Reconciliation domain was found. Provider API keys and sandbox operations are not usage or financial records. Usage owns meters, append-only usage ledger, budgets, reservations, and limit decisions. Financial owns customer/contract/quote/invoice/payment/commission/settlement/reconciliation facts. Share reporting/cost primitives only; keep ledgers separate. Live payments remain subject to explicit approval gates.

### 9. Runtime & Release Operations — INV-05 + INV-21
Reuse ActionRunner, command helpers, terminal store, Daytona/WebContainer adapters, and deployment config. ActionRunner is an in-memory interactive runner, not a durable ExecutionRecord/attempt/resource/secret/termination/reconciliation ledger. `WorkbenchStore.abortAllActions()` is currently a no-op. Deployment configuration is not the full INV-21 approval/rollout/health/migration/backup/restore/rollback/recovery lifecycle. Keep Execution and Deployment separate even when co-located. Runtime isolation, egress, limits, secrets, cancellation, termination, cleanup, and escape tests remain hard gates.

## 4. Shared infrastructure — not new Engines

These should be shared technical capabilities, not additional logical Engine IDs:
- AI provider gateway/model adapters.
- Database connection and repository infrastructure.
- Event inbox/outbox and queue transport.
- Correlation IDs, telemetry exporters, and audit transport.
- Secret/credential references and key management.
- Object storage and file transfer adapters.

Do not create new Engines named generic Database, AI, Project, File Storage, Logging, or Event Engine. Preserve INV-01 through INV-21.

## 5. Specific risks confirmed in source

1. Build classification, provider selection, generation, protocol validation, and retry are mixed in `api.chat.ts`.
2. Provider fallback is conditional on non-build chat requests; build jobs need an explicit bounded provider/failure policy rather than being described as already resilient.
3. Workbench Project state is not canonical Work.
4. The streaming parser is a protocol adapter; callbacks must not become authoritative Plan, Execution, or Artifact truth.
5. Daytona guest execution is explicitly gated to opt-in protected Vercel Preview and same-origin requests. These checks are not user authentication. Production remains disabled until trusted principal context and INV-06 authorization exist.
6. Action state has an AbortController, but durable external cancellation is not established; Workbench abort-all is a no-op.
7. IndexedDB is local chat history, not server-side Work persistence or Memory.
8. Existing unit tests cover selected helpers and runtime paths, not all INV acceptance/security/recovery contracts.

## 6. Recommended implementation order

1. Establish a repeatable typecheck, test, and deployment-build baseline. Preserve current V0 UI.
2. Create server persistence and tenant/principal foundations: INV-18 and INV-06, with distinct authorities.
3. Introduce canonical INV-02 Work and accepted Outcome target; adapt Workbench to reference Work rather than replace it.
4. Extract INV-01 Intent and INV-03 Planning contracts; introduce INV-04 durable orchestration only with checkpoints/recovery semantics.
5. Add INV-07 Capability contracts and wrap Daytona as a narrow adapter; keep INV-15 connector lifecycle independent.
6. Introduce INV-10 Artifact and INV-16 File foundations; connect INV-14 Creation to them.
7. Add INV-08 verification/evidence and INV-11 audit/observability before treating runtime output as success.
8. Keep INV-05 production execution gated by independent runtime assurance. Keep INV-21 deployment at readiness/interface scope until release gates pass.
9. Activate minimum INV-09 M0 and in-app INV-17 only under privacy/retention rules; add INV-19 basic usage controls; keep INV-20 live payments gated.

## 7. Guardrails

- This assessment changes no application source files.
- Do not delete, rename, or merge INV logical Engine IDs.
- Do not create 21 microservices; retain a provider-aware modular monolith unless a named need justifies a boundary.
- Do not treat chat message, Workbench Project, file map, action status, console log, or preview URL as canonical Work, Plan, Execution, Artifact, Evidence, or Outcome.
- Do not enable production Daytona execution before trusted principal and action-time authorization exist.
- Do not redesign the V0 UI during domain extraction. Keep mobile Workspace tools behind the menu; do not add large bottom tabs.
- Do not claim tests/deployment passed without actual run evidence.

## 8. Source paths

- `app/routes/api.chat.ts`
- `app/routes/api.daytona.ts`
- `app/lib/.server/llm/api-key.ts`
- `app/lib/.server/llm/model.ts`
- `app/lib/runtime/message-parser.ts`
- `app/lib/runtime/action-runner.ts`
- `app/lib/runtime/daytona-guard.ts`
- `app/lib/stores/workbench.ts`
- `app/lib/stores/files.ts`
- `app/lib/persistence/db.ts`
- `app/components/chat/Artifact.tsx`
- `scripts/build-vercel.mjs`

This map is an assessment tied to the inspected native-engine snapshot. Re-check the active branch and reconcile intervening commits before moving code or enabling new runtime authority.
