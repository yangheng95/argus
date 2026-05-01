# Deliver Specialist Review Plan

Date: 2026-05-01

## Purpose

This plan refactors `deliver` from a single broad reviewer into one delivery
arbiter with capability-gated specialist review passes. The goal is to reduce
LLM context pressure while improving review depth, without adding fallback
paths, duplicate verdict owners, or repair logic inside delivery.

Terminology:

- LLM: Large Language Model, the model runtime used by agent sessions.
- API: Application Programming Interface, usually HTTP routes or typed server
  contracts.
- SDK: Software Development Kit, generated or handwritten client code consumed
  by applications.
- DOM: Document Object Model, the browser-rendered HTML tree used for runtime UI
  inspection.
- E2E: End-to-End, tests that exercise complete user workflows across system
  boundaries.
- SSE: Server-Sent Events, an HTTP streaming protocol used by chat and progress
  endpoints.
- SPA: Single Page Application, a frontend app that renders client-side routes
  from one entrypoint.

## Problem Statement

Current delivery review has one broad context owner. It must inspect build,
runtime, tests, UI, API, client contracts, visual output, security-sensitive
flows, and user-intent fidelity. That creates three recurring failures:

1. Context dilution: logs, screenshots, file excerpts, and test output compete
   in one LLM context, so domain-specific defects are missed.
2. Shallow review: delivery often verifies that commands pass but lacks enough
   focused context to judge frontend, backend, client, or test quality deeply.
3. Weak routing of feedback: a rejected delivery needs precise ownership
   evidence for retry or replan, but broad prose findings are hard to map back
   to goals.

The refactor must preserve a single final verdict owner. Specialist reviewers
produce evidence only; they never accept, reject, or patch the delivery
directly.

## Agent Review Corrections

This plan was reviewed by three read-only explorer agents on 2026-05-01. Their
findings are incorporated as hard design constraints:

1. The final verdict must continue to use the existing `kind="verdict"` artifact
   with `label="delivery-agent-verdict"` unless every reader is migrated in the
   same change. Do not add a parallel `delivery_arbiter_verdict` final verdict
   artifact.
2. Current delivery can edit files through `write_file` and `edit_file`. The
   specialist-review rollout must first remove delivery repair capability and
   rewrite the delivery prompt/tools so delivery is review-only.
3. Specialist output must not contain a pass/fail verdict. Specialists may only
   report execution completion, findings, proposed severity, and evidence.
   Arbiter revalidates evidence and assigns final severity.
4. Final `DeliveryVerdict` remains `accepted | rejected`. Missing required
   evidence is represented as a rejected verdict with evidence-quality findings,
   not a new delivery-level `inconclusive` state.
5. Existing hard gates that currently synthesize or override verdicts must move
   behind the arbiter as evidence producers, or the arbiter must be the sole
   function that converts their results into the final verdict.

## AI SDK v6 Schema Audit Decision

AI SDK v6 is not the primary fix for delivery `submit_verdict` reliability.
It can improve a narrow failure class: when the active provider supports native
strict tool calling and the specific tool schema is compatible, per-tool
`strict: true` can make tool-call inputs match the declared schema more
reliably.

The current local issue is broader than provider-side JSON shape enforcement:

- Historical context: when this plan was written, the repo was on
  `ai@5.0.124`; existing provider request-body contract work had already
  proved that stack could serialize the local provider matrix. The current AI
  SDK v6 migration replaces that runtime baseline and keeps this conclusion:
  the delivery architecture still needs specialist evidence and one arbiter.
- `submit_verdict` already uses one Zod `inputSchema` and execute-time
  cross-field checks. The remaining failures include missing final calls,
  repeated invalid retries, semantic contradictions, and weak evidence. An SDK
  upgrade alone does not solve those.
- Delivery sessions currently expose many tools and still include write/edit
  repair capability. That raises context pressure and lets delivery mix
  verification, repair, and final arbitration in one LLM context.

Therefore the specialist review architecture remains the required root fix.
It narrows each reviewer context, keeps specialists as evidence producers, and
makes one arbiter responsible for the final `delivery-agent-verdict`.

The AI SDK v6 migration is now implemented separately from this delivery plan.
Further delivery-specific schema work still needs a replayable corpus of real
`submit_verdict` failures. The acceptance bar is:

- compare AI SDK v5 and v6 request bodies for `submit_verdict` and specialist
  review tools;
- prove `strict: true` is accepted by every supported target provider/model or
  explicitly keep it off for incompatible tools without adding fallback logic;
- measure invalid tool-call rate on the same replay corpus;
- keep one runtime AI SDK major version in the repo;
- land only if it reduces schema-invalid submit failures without changing the
  final verdict artifact contract.

## Non-Goals

- Do not add optional human-style reviewers that may or may not run by model
  preference.
- Do not let specialist reviewers directly modify deliverables.
- Do not let specialists emit final delivery verdicts.
- Do not create a second delivery acceptance path beside the existing delivery
  manifest and verdict.
- Do not use keyword-only acceptance checks.
- Do not introduce fallback behavior when a specialist fails. Missing required
  specialist evidence is itself delivery evidence.

## Target Architecture

```text
deliver
  ├─ surface_detector
  ├─ deterministic_checks
  ├─ specialist_reviews
  │   ├─ frontend_review
  │   ├─ backend_api_review
  │   ├─ client_contract_review
  │   ├─ test_integration_review
  │   ├─ visual_runtime_review
  │   └─ security_data_review
  └─ delivery_arbiter
```

Ownership:

- `surface_detector` is the only owner of review surface selection.
- `deterministic_checks` is the only owner of command, build, runtime, lint, and
  probe execution.
- Specialist reviews are scoped readers. They consume the detector output,
  deterministic evidence, selected files, and requirement context.
- `delivery_arbiter` is the only final verdict owner.

## Capability-Gated Mandatory Reviews

Specialist reviews are not optional in the loose sense. They are mandatory when
their surface is detected, and absent when their surface is not detected.

| Review | Enabled when | Core evidence |
|---|---|---|
| `frontend_review` | React, Vue, Svelte, Angular, Next.js, Vite, SPA entrypoints, UI components, or browser routes are detected | DOM snapshot, route list, component files, state/data hooks, browser console |
| `backend_api_review` | API routes, server entrypoints, RPC handlers, SSE endpoints, webhooks, auth handlers, or OpenAPI routes are detected | route inventory, request/response probes, server logs, error paths |
| `client_contract_review` | SDKs, generated clients, fetch wrappers, API adapters, GraphQL clients, or frontend-server calls are detected | call sites, shared schemas, typed client output, network traces |
| `test_integration_review` | Any tests exist or the task requires tests | test files, command output, coverage of requirements, fake-test detection |
| `visual_runtime_review` | User request includes UI, screenshot/reference, visual fidelity, layout, responsive behavior, or browser interaction | screenshots, DOM after interaction, viewport matrix, visual contract |
| `security_data_review` | Auth, payments, upload, file paths, secrets, database writes, migrations, permissions, or user data are detected | auth flows, secret scan, input validation, file/data access paths |

If a detector cannot classify a surface with evidence, the arbiter must treat
that as rejected `evidence_quality` rather than silently skipping review.

## Surface Detector Contract

The detector emits a structured manifest:

```ts
type DeliverySurfaceManifest = {
  taskID: string
  deliveryID?: string
  projectRoot: string
  surfaces: DeliverySurface[]
  evidence: DeliverySurfaceEvidence[]
}

type DeliverySurface =
  | "frontend"
  | "backend_api"
  | "client_contract"
  | "test_integration"
  | "visual_runtime"
  | "security_data"

type DeliverySurfaceEvidence = {
  surface: DeliverySurface
  reason: string
  refs: Array<{
    kind: "file" | "command" | "route" | "dependency" | "runtime_probe"
    ref: string
  }>
}
```

Detector rules must be structural:

- package/framework detection reads manifests such as `package.json`,
  framework config, route files, and build scripts.
- route detection reads server route registrations or framework conventions.
- visual detection reads the task request, design analysis output, attachments,
  and runtime probes.
- test detection reads test directories and package scripts; the selected
  reviewer then maps those tests back to goal acceptance specs.
- security detection reads code and config surfaces, not generic keywords alone.

## Specialist Output Contract

Every specialist emits the same review result shape:

```ts
type DeliverySpecialistReview = {
  reviewer:
    | "frontend"
    | "backend_api"
    | "client_contract"
    | "test_integration"
    | "visual_runtime"
    | "security_data"
  executionStatus: "completed" | "tool_failed" | "evidence_missing"
  summary: string
  findings: DeliveryReviewFinding[]
  evidenceRefs: string[]
  reviewedSurfaces: string[]
}

type DeliveryReviewFinding = {
  proposedSeverity: "blocking" | "major" | "minor"
  category:
    | "startup"
    | "runtime"
    | "functional"
    | "contract"
    | "visual"
    | "test_quality"
    | "evidence_quality"
    | "security"
    | "data_integrity"
    | "user_intent"
  claim: string
  evidence: Array<{
    kind:
      | "file"
      | "command"
      | "screenshot"
      | "dom"
      | "network"
      | "api_response"
      | "log"
    ref: string
    excerpt?: string
  }>
  affectedRequirementIDs: string[]
  suggestedOwnerGoalID?: string
}
```

Rules:

- A finding without evidence is invalid.
- Specialist `proposedSeverity` is advisory. The arbiter independently validates
  the evidence and assigns the final severity in the final `DeliveryVerdict`.
- A required specialist with `executionStatus !== "completed"` blocks acceptance
  unless the surface detector proves that specialist was not required.
- Specialists may recommend owner goals, but the orchestrator decides retry or
  replan.

## Delivery Arbiter Rules

The arbiter consumes:

- delivery manifest
- task requirements
- architect goal contracts
- deterministic check results
- surface manifest
- specialist review results

Verdict rules:

1. Any failed required deterministic check is `rejected`.
2. Any arbiter-validated blocking specialist finding is `rejected`.
3. Any required specialist with missing or invalid evidence is `rejected` with
   category `evidence_quality`.
4. Any visual task without real rendered screenshot or post-interaction DOM
   evidence is `rejected`.
5. Any test-quality finding that proves fake tests, empty tests, stub checks, or
   keyword-only validation is `rejected`.
6. If all required deterministic checks pass and all required specialists pass
   with evidence, delivery may be `accepted`.

The arbiter writes the existing final structured verdict artifact:
`kind="verdict"` with `label="delivery-agent-verdict"`. Specialist outputs are
attached as evidence artifacts, not competing verdicts.

## Context Budget Strategy

Each specialist receives a narrow evidence pack:

- task requirements relevant to its surface
- goal contracts touching its surface
- deterministic check output relevant to its surface
- a bounded file list selected by detector evidence
- runtime artifacts relevant to its surface

Specialists do not receive the full repository, full logs, or unrelated
screenshots by default. They may call codebase tools for additional targeted
reads, and those reads become evidence refs.

This reduces context load while preserving auditability.

## Execution Model

Specialist reviews run after deterministic checks produce baseline evidence.
Independent specialists can run in parallel. The arbiter waits for every
required specialist selected by `surface_detector`.

```text
detector + deterministic checks
        ↓
parallel specialist reviews
        ↓
arbiter verdict
        ↓
accepted | rejected
```

The target delivery stage is read-only over the deliverable. It may start
servers, run commands, take screenshots, send HTTP requests, and inspect files.
It does not patch project files. Phase 0 removed delivery repair tools before
specialist reviews are enabled.

## Implementation Phases

### Phase 0: Inventory And Remove Delivery Repair

Status: complete.

Owner files:

- `packages/opencorvus/src/delivery/`
- `packages/opencorvus/src/prompt/core/delivery-core.txt`
- `packages/opencorvus/src/engine/engine.sql.ts`
- `packages/opencorvus/src/engine/persist.ts`
- `packages/opencorvus/src/engine/store.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/src/workbench/board.ts`
- `packages/opencorvus/test/delivery/`
- `packages/opencorvus/test/benchmark/`

Tasks:

- Map current deterministic checks and final verdict path.
- Identify the current single owner of delivery manifest persistence.
- Identify where delivery prompt context is assembled.
- Mark current evidence artifacts and their payload shapes.
- Remove delivery repair capability from the delivery prompt and tool exposure:
  `write_file`, `edit_file`, and any equivalent write tool must not be available
  in delivery review sessions.
- Keep orchestrator retry/replan as the only repair path after rejected
  delivery.
- Record every current final-verdict reader before touching verdict artifacts:
  publish, workflow projection, task API, workbench board, prosecutor/retry
  context, and delivery history reads.

Acceptance:

- A short implementation note lists current owners and the new insertion point.
- Delivery can still inspect, run, render, and reject/accept, but cannot patch
  project files.
- The only final verdict artifact remains `kind="verdict"` with
  `label="delivery-agent-verdict"`.

Completed in Phase 0 implementation:

- Delivery extra-tool surface no longer exposes `write_file` or `edit_file`.
- Delivery agent registry tool exposure is now an explicit empty include list,
  so global mutation tools such as `edit`, `write`, `apply_patch`, `bash`, and
  recursive `task` dispatch cannot bypass the delivery-specific review tools.
- Delivery prompt is review-only and routes repair through rejection details and
  orchestrator retry/replan.
- Prompt and workflow comments no longer describe delivery as the fixer.
- Regression tests cover tool-surface read-only behavior and prompt hygiene.

Phase 0 implementation note:

- Current delivery prompt context is assembled in
  `packages/opencorvus/src/delivery/agent.ts` from
  `packages/opencorvus/src/prompt/core/delivery-core.txt`, task context,
  goal contracts, delivery diffs, executor reports, design specs, and operator
  notes.
- Current delivery review tools are injected by `DeliveryAgent.verify()` through
  `createDeliveryTools()` plus `createDeliveryOutputTools()`. Registry tools
  are intentionally suppressed at `Agent.Info.tools` for `delivery`.
- Current deterministic delivery manifest is owned by
  `packages/opencorvus/src/delivery/checks/project-gate.ts` and consumed by
  `DeliveryService.verify()`.
- Current final verdict write path remains
  `packages/opencorvus/src/orchestrator/tools.ts`, which persists
  `kind="verdict"` with `label="delivery-agent-verdict"`.
- Current verdict readers include publish gating, workflow projection, task API
  delivery history, workbench board, engine describe/retry context, and
  delivery history lookups through `packages/opencorvus/src/engine/store.ts`.

### Phase 1: Surface Detector

Status: complete.

Tasks:

- Add `DeliverySurfaceManifest` and detector implementation.
- Persist the detector output as a delivery artifact.
- Add detector tests for frontend-only, backend-only, fullstack, visual, and
  security-sensitive projects.
- Reuse or move existing structural discovery code instead of duplicating
  framework/package detection. `delivery/checks/discovery.ts` and
  `delivery/checks/project-gate.ts` must not remain a second source of surface
  classification.

Acceptance:

- Detector selects surfaces from structural evidence.
- Detector output is deterministic for fixture projects.
- No keyword-only detection is accepted.
- Existing deterministic gates consume the same detector result where they need
  project-surface classification.

Completed in Phase 1 implementation:

- Added `packages/opencorvus/src/delivery/surface-detector.ts` as the single
  owner of delivery surface selection.
- Added `delivery_surface_manifest` artifact persistence through the existing
  delivery evidence manifest writer and reader helpers.
- Wired `buildDeliveryEvidenceManifest()` to attach one surface manifest and
  made runtime flow classification consume that manifest instead of re-reading
  package frontend metadata.
- Added detector fixtures for frontend, backend API, fullstack, visual runtime,
  security/data, and text-only non-detection cases.

### Phase 2: Shared Specialist Review Contract

Status: complete.

Tasks:

- Add shared review result schema.
- Add validation that every finding has evidence.
- Add artifact persistence for specialist outputs.
- Add arbiter input loading for specialist outputs.
- Add `delivery_surface_manifest` and `delivery_specialist_review` to the
  artifact kind union and artifact read helpers. Do not add a new final verdict
  kind.

Acceptance:

- Invalid specialist output fails before arbitration.
- Specialist artifacts are queryable by task and delivery.
- Existing delivery verdict format remains single-source.
- Specialist `executionStatus`, findings, and proposed severities cannot by
  themselves publish an accepted or rejected final verdict.

Completed in Phase 2 implementation:

- Added `packages/opencorvus/src/delivery/specialist-review.ts` as the shared
  specialist review payload owner.
- Specialist review payloads carry `taskId`, `runId`, `deliveryId`, reviewer
  identity, execution status, findings, evidence refs, and reviewed surfaces;
  they do not carry a final delivery verdict.
- Validation rejects findings without evidence, cross-surface specialist output,
  empty evidence refs, and extra keys such as `verdict`.
- Added `delivery_specialist_review` artifact kind and read/write helpers for
  querying specialist evidence by task or delivery.

### Phase 3: Test And Integration Review

Status: complete.

Reason to implement first: it catches fake acceptance, stub tests, and missing
coverage across every project type.

Scope:

- Verify tests map to requirement IDs or goal acceptance specs.
- Detect empty test files, snapshot-only shells, no-op scripts, and fake green
  checks.
- Inspect integration or E2E coverage when present.

Acceptance:

- Fixture with fake tests is rejected.
- Fixture with meaningful tests and passing commands passes this reviewer.
- Findings identify file and command evidence.

Completed in Phase 3 implementation:

- Added `packages/opencorvus/src/delivery/specialists/test-integration.ts`
  as the deterministic `test_integration_review` evidence producer.
- The reviewer consumes the surface manifest, package test script, test files,
  existing command results, and goal requirement IDs without introducing a
  second command execution path.
- It emits blocking `test_quality` findings for empty test files, no-op test
  scripts, snapshot-only test shells, missing test files for acceptance-backed
  goals, failing required test commands, and tests without observable
  assertions.
- Requirement-ID mapping gaps are recorded as major specialist findings for the
  future arbiter, while fake-green and missing-test evidence blocks the existing
  delivery evidence gate immediately.
- Meaningful acceptance-mapped tests produce a completed specialist review with
  concrete file and command evidence refs and no findings.

### Phase 4: Frontend And Visual Runtime Reviews

Status: complete.

Scope:

- `frontend_review` inspects component structure, route behavior, client state,
  browser console, accessibility basics, and interaction state.
- `visual_runtime_review` inspects actual screenshots, DOM after interaction,
  viewport matrix, and visual contract alignment.

Acceptance:

- UI project without meaningful interaction evidence is rejected.
- Auth-gated UI is judged after real interaction, not only login shell DOM.
- Visual review requires rendered artifacts, not source-only claims.

Completed in Phase 4 implementation:

- Added `packages/opencorvus/src/delivery/specialists/frontend-visual.ts`
  with separate `frontend` and `visual_runtime` specialist evidence producers.
- Frontend review consumes structural surface evidence and runtime flow failures
  without re-running browser probes.
- Visual runtime review requires existing rendered runtime flow evidence and
  blocks missing screenshot or DOM artifacts.
- `buildDeliveryEvidenceManifest()` runs the selected frontend and visual
  specialists through the same specialist review collection used by
  `test_integration`.

### Phase 5: Backend API And Client Contract Reviews

Status: complete.

Scope:

- `backend_api_review` probes routes, status codes, error handling, streaming,
  auth boundaries, and data mutation paths.
- `client_contract_review` compares frontend/client call sites against backend
  route schemas and shared types.

Acceptance:

- Route/client mismatch is rejected with both call-site and route evidence.
- SSE endpoints are verified as streaming when the task requires streaming.
- Backend-only tasks can pass without frontend review.

Completed in Phase 5 implementation:

- Added `packages/opencorvus/src/delivery/specialists/backend-client.ts`
  with separate `backend_api` and `client_contract` evidence producers.
- Backend review requires structural route evidence from the surface manifest.
- Client contract review requires client file or endpoint evidence and flags
  client endpoint calls that have no matching backend route evidence.
- `buildDeliveryEvidenceManifest()` runs backend and client reviews through
  the same specialist collection path as test, frontend, and visual reviews.

### Phase 6: Security And Data Review

Status: complete.

Scope:

- Auth bypass.
- Secrets in source or generated output.
- Upload and file path traversal.
- Unsafe persistence writes.
- Permission and tenant boundary mistakes.

Acceptance:

- Security-sensitive fixtures with concrete flaws are rejected.
- Non-security projects do not run this reviewer unless detector evidence
  selects it.

Completed in Phase 6 implementation:

- Added `packages/opencorvus/src/delivery/specialists/security-data.ts`
  as the `security_data` specialist evidence producer.
- The reviewer runs only when the surface detector selects `security_data`, and
  consumes detector-selected file and dependency evidence.
- It emits blocking findings for hardcoded secret-like values, upload/file path
  handling that uses user-controlled filenames without basename normalization,
  and unconditional destructive data operations.
- `buildDeliveryEvidenceManifest()` runs the reviewer through the same
  specialist collection path and converts blocking findings into failed review
  evidence for the existing delivery gate.
- Tests cover absent-surface skip behavior, missing security evidence,
  hardcoded secrets, unsafe upload paths, destructive data operations, clean
  security-sensitive files, and project-gate rejection for a detected security
  flaw.

### Phase 7: Arbiter Integration And Retry Guidance

Status: complete.

Tasks:

- Aggregate specialist findings into final delivery verdict.
- Map arbiter-validated blocking findings to suggested owner goals.
- Emit structured retry or replan guidance without direct repair.
- Convert existing manifest rejection, runtime-evidence rejection, and visual
  hard-gate override paths into arbiter inputs. The final verdict conversion
  must happen in one arbiter owner.
- Write the final result through the existing `delivery-agent-verdict` artifact
  path so workflow, publish, board, and task API readers stay single-source.

Acceptance:

- One final verdict owner remains.
- Rejected delivery contains specialist evidence and owner mapping.
- Existing orchestrator retry/replan loop receives actionable root cause.
- No code path writes or reads a parallel final verdict artifact.

Completed in Phase 7 implementation:

- Added `packages/opencorvus/src/delivery/arbiter.ts` as the single owner that
  converts delivery evidence into gate outcomes and final delivery verdicts.
- `project-gate.ts` now produces deterministic evidence and delegates final
  gate synthesis to `arbitrateDeliveryGate()`.
- `DeliveryService.verify()` now passes manifest, runtime evidence, LLM verdict,
  and visual metric evidence into `arbitrateDeliveryVerdict()` instead of
  locally synthesizing manifest/runtime/visual verdicts.
- Runtime-evidence rejection and visual hard-gate override conversion moved out
  of `delivery/verdict.ts`; that file now only owns the verdict schema and
  derived views.
- Specialist review failures map back to suggested owner goals or requirement
  coverage when available, so rejected delivery carries actionable retry
  attribution.
- Final persistence still writes only the existing `kind="verdict"` artifact
  with `label="delivery-agent-verdict"`; no `delivery_arbiter_verdict` path was
  added.
- Delivery prompt broad review sections were narrowed so DeliveryAgent consumes
  specialist evidence for API, client, security/data, visual-runtime, and
  test-quality surfaces instead of duplicating those policies in its main
  prompt.

## Benchmark Plan

Add focused benchmark fixtures before enabling the full path:

1. Frontend-only app with passing build but broken interaction.
2. Backend-only API with passing tests but wrong error status.
3. Fullstack app with frontend client contract drift.
4. Visual app with a good login shell but broken post-login surface.
5. Test suite with empty or fake tests.
6. Auth/upload app with a security flaw.

Use a table-driven fixture harness. Each fixture declares:

```ts
type DeliverySpecialistFixtureExpectation = {
  name: string
  projectFixture: string
  expectedVerdict: "accepted" | "rejected"
  expectedReviewer?: DeliverySpecialistReview["reviewer"]
  expectedCategory?: DeliveryReviewFinding["category"]
  requiredArtifactKinds: Array<
    "delivery_surface_manifest" |
    "delivery_specialist_review" |
    "verdict"
  >
  requiredEvidenceKinds: Array<
    "file" |
    "command" |
    "screenshot" |
    "dom" |
    "network" |
    "api_response" |
    "log"
  >
  maxContextFiles?: number
  maxLogChars?: number
}
```

Benchmark success criteria:

- Each bad fixture is rejected with the expected reviewer and finding category.
- Each good fixture is accepted without requiring irrelevant specialists.
- Final verdict is written only as `kind="verdict"` with
  `label="delivery-agent-verdict"`.
- Required artifact kinds and evidence kinds are present.
- Context packs respect fixture-specific `maxContextFiles` and `maxLogChars`.
- Tests assert there is no `delivery_arbiter_verdict` final artifact.
- Fake-test fixtures cover: empty test files, `test` scripts that only
  `echo ok`, file-existence-only checks, self-grep checks, and tests that pass
  while mapping to no requirement or acceptance spec.

## Data Persistence

Use delivery artifacts rather than new parallel state tables unless measured
query needs prove otherwise.

Artifact kinds:

- `delivery_surface_manifest`
- `delivery_specialist_review`

Final verdict persistence:

- Continue writing the existing `kind="verdict"` artifact with
  `label="delivery-agent-verdict"`.
- Do not add `delivery_arbiter_verdict` unless every verdict reader is migrated
  in the same change and the old path is deleted. This plan chooses the existing
  verdict path.

Each artifact should carry `task_id`, `run_id`, `delivery_id`, and optional
`goal_run_id` when the evidence maps cleanly to one goal.

## Prompt Changes

Delivery prompt should state:

- deterministic checks run before specialist reviews
- specialists are evidence producers, not verdict owners
- every finding requires concrete evidence
- no specialist may patch files
- arbiter is the only final verdict owner
- missing evidence from a required specialist blocks acceptance
- final delivery verdict remains `accepted | rejected`
- delivery repair belongs to orchestrator retry/replan and build agents, not
  delivery review

Specialist prompts should be short and surface-specific. They should not repeat
the entire delivery policy.

## Risks And Controls

| Risk | Control |
|---|---|
| Specialists become a second verdict path | Arbiter consumes specialist artifacts and remains only final verdict owner |
| Surface detector misses a project type | Detector tests and rejected evidence-quality verdict for unclassified evidence |
| Review context still grows too large | Surface-specific evidence packs and bounded logs |
| Specialists produce generic prose | Schema requires concrete evidence refs and arbiter rejects invalid evidence |
| Delivery starts repairing code | Phase 0 removes delivery write/edit tools before specialist rollout |
| New verdict artifact becomes a second source | Final verdict continues through existing `delivery-agent-verdict` artifact |
| Specialist status becomes hidden verdict | Specialists emit execution status and proposed severity only; arbiter assigns final severity |
| Review latency grows | Run independent specialists in parallel and skip absent surfaces structurally |

## Rollout Strategy

1. Remove delivery write/edit repair tools and update the delivery prompt to
   review-only.
2. Land detector and schemas behind the existing delivery path.
3. Add the table-driven specialist fixture harness before enabling reviewers.
4. Enable `test_integration_review` first because it is project-agnostic.
5. Enable frontend and visual reviews for UI projects.
6. Enable backend and client contract reviews for fullstack/API projects.
7. Enable security/data review only when detector evidence selects it.
8. Move manifest/runtime/visual hard-gate verdict conversion into the arbiter.
9. Remove any old broad prompt sections that duplicate specialist-specific
   responsibilities.

## Completion Criteria

- Delivery has one final verdict owner.
- Final verdict remains the existing `delivery-agent-verdict` artifact.
- Required specialists run based on structural surface evidence.
- Every specialist finding carries concrete evidence.
- Bad fixtures fail for the intended specialist reason.
- Good fixtures pass without requiring irrelevant specialists.
- Full delivery benchmark remains green.
- No direct deliverable repair is introduced under delivery.
- No fallback or parallel acceptance path remains.
