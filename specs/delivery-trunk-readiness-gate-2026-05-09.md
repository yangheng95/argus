# Delivery Trunk Readiness Gate — 2026-05-09

## Background

The calc benchmark launched at 2026-05-08 23:12 exposed a delivery acceptance gap: the task persisted a delivery candidate and emitted `delivery.ready`, but no delivery verdict artifact landed, while the merged project had no `node_modules`, no `dist`, no lockfile, and no `packageManager` field. This spec implements the repair brief in `specs/_codex-brief-delivery-trunk-readiness-2026-05-09.md`.

Existing context recalled before implementation:

- `specs/delivery-evaluation-and-preview-repair-plan-2026-05-08.md`: managed preview and manifest evidence are the product path.
- `specs/delivery-integrity-prerequisite-2026-05-08.md`: delivery prerequisites run before `DeliveryService.verify`.
- `docs/delivery-completion-first-2026-05-02.md`: delivery completion evidence is the primary decision line.

## Decision

Introduce `ProjectRuntimeReadiness` as the single source for whether the merged trunk is runnable for JavaScript and TypeScript web projects.

The gate owns these facts:

- `package.json` with dependencies, devDependencies, or scripts must declare a valid `packageManager`.
- The declared package manager must have a matching committed lockfile.
- Conflicting lockfiles are readiness failures.
- Package-manager inference from lockfiles is forbidden.
- Frozen install is the readiness precondition when the project declares dependencies and `node_modules` is absent: `npm ci`, `bun install --frozen-lockfile`, `pnpm install --frozen-lockfile`, or `yarn install --immutable`.
- Discovered build, test, lint, and typecheck package scripts are executed only after readiness passes.

## Manifest Contract

`DeliveryEvidenceManifest` gets a `runtimeReadiness` field.

Manifest execution order is:

1. Coverage validation.
2. Project runtime readiness.
3. Required checks discovered from the same package-manager contract.
4. Runtime preview flows.
5. Specialist and review evidence.
6. Functional assessment and arbiter.

Readiness failures are primary delivery blockers. Required-check failures remain visible as failed check results; readiness-derived check failures are promoted through `failedReadinessIds` so `assessFunctionalCompletion` does not rely on the delivery LLM to reject an unrunnable trunk.

## Deliver Invariant

Once `deliver` persists a candidate through `persistTaskDelivery`, the same tool invocation must persist either:

- a `delivery-agent-verdict` artifact, or
- a `delivery_verification_threw` artifact plus a structured rejected verdict artifact.

This is not a wake or heartbeat scheduler. It is a tool-local persistence invariant.

## Codex 审查反馈

> 1. `runLocalVerify`: Yes. Real. Blast: benchmark-only, all executors/providers, all no-reference web/nonvisual requests.
> 2. `failedCheckIds` advisory: Yes. Real. Blast: every build/test/lint/typecheck required check; LLM/provider variability matters because rejection is delegated.
> 3. Clean copy excludes node_modules: Partially. For this calc trunk, missing `packageManager` means discovery produces no `npm run build` at all. Two failure modes.
> 4. Preview brittleness: Yes, with one exception (explicit metadata previewUrl bypass).
> 5. Wake gap: Symptom yes; root-cause claim not proven. Treat as "deliver tool failed to continue after candidate persistence", not necessarily a scheduler wake bug.
> 6. Integrity LLM-only: Yes.
> 7. Lockfile policy: Yes for benchmark audit.
>
> **Plan deltas:**
>
> A. Trunk integration gate: do it inside `DeliveryEvidenceManifest` as the single delivery gate, not as a separate pre-deliver path. Require `packageManager` PLUS matching lockfile; don't infer PM from lockfile (preview spec already says no PM inference).
>
> B. Preview install precondition: `preview installs if node_modules missing` duplicates A unless both call one shared `ensureProjectReadyForRuntime`. Missing `packageManager` should be a structured primary failure, not an exception-only runtime-flow string.
>
> C. `runLocalVerify`: C1 (auto-register build+preview+curl) is wrong — second verification path with shell/port/curl/Windows fragility. Prefer C3: engine gate owns truth; benchmark `localVerify` is advisory or deleted.
>
> D. Lockfile policy flip: broaden beyond `package-lock.json` to `bun.lock`, `pnpm-lock.yaml`, `yarn.lock`, with PM-lock consistency. Include `devDependencies`.
>
> E. Wake watchdog: risky, creates a second owner for delivery execution. Better invariant: once `deliver` persists a candidate, the same tool invocation must either create a delivery session/verdict artifact or persist a structured `delivery_verification_threw` fact before returning.
>
> **Round 3 — missed items:**
> - Missing `packageManager` disables required-check discovery entirely.
> - Runtime flow runs before required checks and receives `checkResults: []`, so its `failedBuild` branch is currently unreachable.
> - `delivery.ready` naming is misleading.
> - **Simpler unifying fix**: one `ProjectRuntimeReadiness` gate feeding required checks, runtime preview, and lockfile/package-manager validation. Make its failures primary in the manifest.
> - Wrong-direction risk: adding benchmark verify, preview install, and delivery wake watchdog separately ossifies three competing truth sources.

## Grep Lock

Extended grep before locking this spec found:

- `ensureManagedPreviewSession`: `src/preview/session.ts`, `src/delivery/checks/project-gate.ts`, `src/delivery/tools.ts`, `src/orchestrator/tools.ts`.
- `assessFunctionalCompletion`: `src/delivery/checks/project-gate.ts`.
- `arbitrateDeliveryGate`: `src/delivery/arbiter.ts`, `src/delivery/checks/project-gate.ts`, `src/delivery/index.ts`.
- `evaluateQualityGates`: `script/benchmark/quality-gates.ts`, `script/benchmark/overlay-web-benchmark.ts`.
- `runLocalVerify` / `localVerifyExitCode`: benchmark script and benchmark tests only outside historical run logs.
- `withIsolatedCheckWorkspace` / `CHECK_WORKSPACE_EXCLUDED_NAMES`: `src/delivery/checks/project-gate.ts`.
- `persistTaskDelivery`: `src/engine/persist.ts`, `src/orchestrator/tools.ts`.
- `delivery.ready`: engine event model/log, orchestrator plugin trigger, plugin product docs, historical benchmark logs.
- `packageScriptRunner` / `packageManagerName`: `src/delivery/checks/discovery.ts`.
- Prompts requiring update: `src/prompt/core/architect-core.txt` and `src/prompt/core/build-core.txt`.

`delivery.ready` is externally documented as a plugin hook in English and Chinese product docs, so this change does not rename it in code. Follow-up: rename to `delivery.candidate_persisted` only with plugin compatibility documentation and migration.

## Test Plan

- Readiness unit tests cover missing `packageManager`, invalid package manager, missing lockfile, mismatched lockfile, conflicting lockfiles, frozen install command selection, and passed readiness.
- Manifest tests assert readiness failures are primary and required checks/runtime preview run only after readiness passes.
- Functional-assessment tests enumerate primary readiness IDs, primary runtime/integrity IDs, and auxiliary specialist IDs.
- Benchmark quality-gate tests assert vacuous `localVerifyExitCode` no longer participates in acceptance.
- Deliver invariant test forces `DeliveryService.verify` to throw and asserts `delivery_verification_threw` and a rejected `delivery-agent-verdict` artifact are persisted.

## Non-Goals

- Do not touch wake or heartbeat scheduling.
- Do not add a benchmark-side parallel verifier.
- Do not infer package manager from a lockfile.
- Do not keep dead runtime-flow build-failure branches after required checks are reordered.
