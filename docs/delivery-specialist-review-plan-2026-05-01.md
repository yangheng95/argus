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
that as `inconclusive` rather than silently skipping review.

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
- test detection reads test directories, package scripts, and goal acceptance
  specs.
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
  status: "passed" | "failed" | "inconclusive"
  summary: string
  findings: DeliveryReviewFinding[]
  evidenceRefs: string[]
  reviewedSurfaces: string[]
}

type DeliveryReviewFinding = {
  severity: "blocking" | "major" | "minor"
  category:
    | "startup"
    | "runtime"
    | "functional"
    | "contract"
    | "visual"
    | "test_quality"
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
- A `blocking` finding rejects delivery.
- A required specialist returning `inconclusive` prevents acceptance unless the
  arbiter has deterministic evidence proving that surface is irrelevant.
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
2. Any specialist `blocking` finding is `rejected`.
3. Any required specialist with missing or invalid evidence is `inconclusive`.
4. Any visual task without real rendered screenshot or post-interaction DOM
   evidence is `rejected`.
5. Any test-quality finding that proves fake tests, empty tests, stub checks, or
   keyword-only validation is `rejected`.
6. If all required deterministic checks pass and all required specialists pass
   with evidence, delivery may be `accepted`.

The arbiter writes a single final structured verdict. Specialist outputs are
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
accepted | rejected | inconclusive
```

`deliver` remains read-only over the deliverable. It may start servers, run
commands, take screenshots, send HTTP requests, and inspect files. It does not
patch project files.

## Implementation Phases

### Phase 0: Inventory Current Delivery Flow

Owner files:

- `packages/opencorvus/src/delivery/`
- `packages/opencorvus/src/prompt/core/delivery-core.txt`
- `packages/opencorvus/test/delivery/`
- `packages/opencorvus/test/benchmark/`

Tasks:

- Map current deterministic checks and final verdict path.
- Identify the current single owner of delivery manifest persistence.
- Identify where delivery prompt context is assembled.
- Mark current evidence artifacts and their payload shapes.

Acceptance:

- A short implementation note lists current owners and the new insertion point.
- No runtime behavior changes.

### Phase 1: Surface Detector

Tasks:

- Add `DeliverySurfaceManifest` and detector implementation.
- Persist the detector output as a delivery artifact.
- Add detector tests for frontend-only, backend-only, fullstack, visual, and
  security-sensitive projects.

Acceptance:

- Detector selects surfaces from structural evidence.
- Detector output is deterministic for fixture projects.
- No keyword-only detection is accepted.

### Phase 2: Shared Specialist Review Contract

Tasks:

- Add shared review result schema.
- Add validation that every finding has evidence.
- Add artifact persistence for specialist outputs.
- Add arbiter input loading for specialist outputs.

Acceptance:

- Invalid specialist output fails before arbitration.
- Specialist artifacts are queryable by task and delivery.
- Existing delivery verdict format remains single-source.

### Phase 3: Test And Integration Review

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

### Phase 4: Frontend And Visual Runtime Reviews

Scope:

- `frontend_review` inspects component structure, route behavior, client state,
  browser console, accessibility basics, and interaction state.
- `visual_runtime_review` inspects actual screenshots, DOM after interaction,
  viewport matrix, and visual contract alignment.

Acceptance:

- UI project without meaningful interaction evidence is rejected.
- Auth-gated UI is judged after real interaction, not only login shell DOM.
- Visual review requires rendered artifacts, not source-only claims.

### Phase 5: Backend API And Client Contract Reviews

Scope:

- `backend_api_review` probes routes, status codes, error handling, streaming,
  auth boundaries, and data mutation paths.
- `client_contract_review` compares frontend/client call sites against backend
  route schemas and shared types.

Acceptance:

- Route/client mismatch is rejected with both call-site and route evidence.
- SSE endpoints are verified as streaming when the task requires streaming.
- Backend-only tasks can pass without frontend review.

### Phase 6: Security And Data Review

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

### Phase 7: Arbiter Integration And Retry Guidance

Tasks:

- Aggregate specialist findings into final delivery verdict.
- Map blocking findings to suggested owner goals.
- Emit structured retry or replan guidance without direct repair.

Acceptance:

- One final verdict owner remains.
- Rejected delivery contains specialist evidence and owner mapping.
- Existing orchestrator retry/replan loop receives actionable root cause.

## Benchmark Plan

Add focused benchmark fixtures before enabling the full path:

1. Frontend-only app with passing build but broken interaction.
2. Backend-only API with passing tests but wrong error status.
3. Fullstack app with frontend client contract drift.
4. Visual app with a good login shell but broken post-login surface.
5. Test suite with empty or fake tests.
6. Auth/upload app with a security flaw.

Benchmark success criteria:

- Each bad fixture is rejected for the correct specialist reason.
- Each good fixture is accepted.
- Final verdict always comes from delivery arbiter.
- Specialist evidence includes file, command, screenshot, DOM, network, or log
  refs as appropriate.
- Context packs stay bounded and do not include unrelated full logs.

## Data Persistence

Use delivery artifacts rather than new parallel state tables unless measured
query needs prove otherwise.

Artifact kinds:

- `delivery_surface_manifest`
- `delivery_specialist_review`
- `delivery_arbiter_verdict`

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

Specialist prompts should be short and surface-specific. They should not repeat
the entire delivery policy.

## Risks And Controls

| Risk | Control |
|---|---|
| Specialists become a second verdict path | Arbiter consumes specialist artifacts and remains only final verdict owner |
| Surface detector misses a project type | Detector tests and inconclusive verdict for unclassified evidence |
| Review context still grows too large | Surface-specific evidence packs and bounded logs |
| Specialists produce generic prose | Schema requires concrete evidence refs |
| Delivery starts repairing code | Deliver stays read-only; retry/replan owns repair |
| Review latency grows | Run independent specialists in parallel and skip absent surfaces structurally |

## Rollout Strategy

1. Land detector and schemas behind the existing delivery path.
2. Enable `test_integration_review` first because it is project-agnostic.
3. Enable frontend and visual reviews for UI projects.
4. Enable backend and client contract reviews for fullstack/API projects.
5. Enable security/data review only when detector evidence selects it.
6. Make arbiter consume all required specialist outputs.
7. Remove any old broad prompt sections that duplicate specialist-specific
   responsibilities.

## Completion Criteria

- Delivery has one final verdict owner.
- Required specialists run based on structural surface evidence.
- Every specialist finding carries concrete evidence.
- Bad fixtures fail for the intended specialist reason.
- Good fixtures pass without requiring irrelevant specialists.
- Full delivery benchmark remains green.
- No direct deliverable repair is introduced under delivery.
- No fallback or parallel acceptance path remains.
