# Brief: Fix delivery acceptance gaps surfaced by calc benchmark (2026-05-09)

You (codex) own this end-to-end: design the spec, implement, test, commit, push. **Do not return a verbal plan and stop.** Stop only when the changes are committed and pushed (or when a CLAUDE.md rule blocks you and you need a human decision).

---

## 1. The benchmark run and what it exposed

A fresh calc benchmark was launched 2026-05-08 23:12:

```powershell
bun run script/benchmark/overlay-web-benchmark.ts --executor=mirrorcode --request-file=script/benchmark/assets/web-calculator-request.txt
```

State when killed (project dir `C:/Users/hengu/AppData/Local/Temp/mirrorcode-overlay-benchmark-project-ySG0oy`):

- 8/8 goals merged to master (8 linear commits).
- Integrity review = `pass` (4 dimensions all pass, 0/0/0).
- `delivery.ready` event fired, then `verdict=inconclusive, delivery=candidate` for ~10 heartbeats with **no `delivery:` session ever appearing**, then I killed it.
- Master tree contains `package.json`, `index.html`, `src/`, `tests/`, `vite.config.ts`. **NO `node_modules`, NO `dist`, NO `package-lock.json`. `package.json` has no `packageManager` field.**

Bench log: `packages/opencorvus/script/benchmark/runs/overlay-benchmark-20260508-231237.out`. Use it as evidence.

---

## 2. Confirmed code-level gaps (with file:line evidence — do NOT re-derive these from scratch; verify and proceed)

### G1. `runLocalVerify` is vacuously satisfied
- `script/benchmark/overlay-web-benchmark.ts:559-562` — `DELIVERY_VERIFY_CMD = ""` whenever neither `--reference-images` nor `--delivery-verify-cmd` is passed.
- `script/benchmark/overlay-web-benchmark.ts:1354-1363` — `runLocalVerify` returns `{ mode:"skipped", exitCode:0 }` for empty cmd.
- `script/benchmark/quality-gates.ts:203` — `evaluateQualityGates` accepts only when `localVerifyExitCode===0`. Vacuous pass.

### G2. `failedCheckIds` is advisory, not blocking
- `src/delivery/checks/project-gate.ts:213-244` — `assessFunctionalCompletion` puts only `failedCoverageIds + failedRuntimeFlowIds + review:integrity` in `primaryFailureIds`. `failedCheckIds` lands in `auxiliaryFailureIds`.
- `src/delivery/arbiter.ts:30-39` — gate passes when primary is empty.

### G3. Required checks run in scratch dir without `node_modules`
- `src/delivery/checks/project-gate.ts:43-53` — `CHECK_WORKSPACE_EXCLUDED_NAMES` includes `"node_modules"`.
- `src/delivery/checks/project-gate.ts:642, 682-722` — `withIsolatedCheckWorkspace` mkdtemps a scratch dir and copies tree minus excluded names; `runShellCommand` runs there. **No `npm install` step exists in `src/delivery` or `src/preview` (verified by grep).**

### G4. Missing `packageManager` silently disables required-check discovery (codex caught this — bigger than G3)
- `src/delivery/checks/discovery.ts:131-155` — `packageScriptRunner` returns `undefined` when `packageManager` field is absent.
- `src/delivery/checks/discovery.ts:122-128` — `discoverChecks` returns `{ build: [], test: [], lint: [], named: {...} }` — empty `build/test/lint` arrays. Required checks for build/test/lint are **never registered**, so they cannot fail.
- The calc `package.json` has no `packageManager` field, so build/test/lint checks were never even attempted.

### G5. Runtime flow runs BEFORE required checks; `failedBuild` branch is dead code (codex caught this)
- `src/delivery/checks/project-gate.ts:93-101` — `runRuntimeFlows({ checkResults: [] })` is invoked before required checks run.
- `src/delivery/checks/project-gate.ts:452-463` — the "skip runtime if build failed" guard reads `input.checkResults.some(...)` which is always false. Dead branch.

### G6. Managed preview is brittle
- `src/preview/session.ts:71-77` — throws `no_preview_start_script` if `package.json` lacks `scripts.dev`; throws `no_package_manager` if no `packageManager` field.
- `src/preview/session.ts:37-56` — bypass: explicit `metadata.previewUrl` skips checks (but is not used in normal calc path).
- No install step before `<pm> run dev` is invoked. With no `node_modules`, dev server fails immediately.
- Failure surfaces as `runtime_flow_error: <message>` string in evidence (`src/delivery/checks/project-gate.ts:510-517`), not as a structured manifest entry.

### G7. `deliver` tool can stall after `persistTaskDelivery` (codex re-attributed)
- `src/orchestrator/tools.ts:3253-3458` — `deliver` calls `persistTaskDelivery` then synchronously `DeliveryService.verify`. There is no `DeliveryReady` consumer elsewhere.
- Symptom from this run: `delivery.ready` plugin event fired (line 3761 / 4264) but no `delivery:` session followed and no verdict artifact landed. The bench loop kept heart­beating in `verdict=inconclusive, delivery=candidate`.
- Likely cause: `DeliveryService.verify` threw or returned silently between candidate persistence and verdict persistence. **Invariant missing**: candidate persistence MUST be followed by either a verdict artifact or a structured `delivery_verification_threw` artifact.
- Note: `delivery.ready` is misleading — it actually fires on candidate persistence, not on verified delivery.

### G8. Lockfile policy is inverted
- `script/benchmark/quality-gates.ts:67` — `package-lock.json` is in the `scaffold_expansion_flags` regex, so adding a lockfile counts toward scaffold noise.
- `script/benchmark/quality-gates.ts:38-39` — lockfiles are recognized as legitimate config files, but no rule **requires** their presence.

### G9. Integrity review is LLM-only (no execution)
- `src/integrity/agent.ts:392` — submits-only tools to LLM session. No subprocess, no build, no render. Verdict is a code-reading judgment.

---

## 3. Earlier codex review of my proposed plan (paste of feedback you yourself gave when reviewing read-only)

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

---

## 4. Hard constraints from `CLAUDE.md`

These are non-negotiable. If a fix violates them, redesign the fix.

- **Rule 7 / 8**: no fallback, no dual source. The new readiness gate must be the **single** truth for "is the trunk runnable". Do not also keep `runLocalVerify` as a parallel pass-gate.
- **Rule 11 / 13**: no state-machine code; flow control is LLM-driven where applicable. The readiness gate is data validation (file existence, PM field, lockfile match) — that's allowed (rule 6.1, host-side data integrity). Do NOT add an FSM that watches heartbeat counts to force-spawn the DeliveryAgent (codex E warning).
- **Rule 16**: unreleased project, no compat patches; replace and delete old code paths.
- **Rule 17**: dead code (e.g. `failedBuild` branch in runtime flow) must be excised, not left in.
- **Rule 26**: every fix commits + pushes; do not bundle. Hooks must pass — no `--no-verify`.
- **Rule 28 / 36**: every change ships with tests. Specifically:
  - Adding the readiness gate ⇒ tests for each precondition + each blocking failure.
  - Removing `runLocalVerify` from the accept triple ⇒ test asserts the old vacuous-pass path no longer exists.
  - Changing `assessFunctionalCompletion` ⇒ test enumerates which IDs are primary vs auxiliary in the new world.
  - `deliver` invariant ⇒ test forces `DeliveryService.verify` to throw and asserts a `delivery_verification_threw` artifact lands.
- **Rule 35**: full-repo grep before locking the spec. The grep table is in §6 below; verify and extend it as you implement.
- **Rule 32**: write the spec to disk first (under `specs/`), then implement.

---

## 5. Cross-spec context (read these, do not re-derive)

- `specs/delivery-evaluation-and-preview-repair-plan-2026-05-08.md` — the existing managed-preview architecture. Your new readiness gate plugs into the same manifest pipeline. Do not double-source it.
- `specs/delivery-integrity-prerequisite-2026-05-08.md` — integrity prerequisite already runs before `DeliveryService.verify`. Your readiness gate plugs in as a sibling prerequisite.
- `docs/delivery-completion-first-2026-05-02.md` — completion-first principle.

---

## 6. Pre-locked grep table (rule 35) — extend before locking the spec

| Symbol | Files / lines |
|---|---|
| `ensureManagedPreviewSession` | `src/preview/session.ts:32`, `src/delivery/checks/project-gate.ts:529`, `src/delivery/tools.ts:494`, `src/orchestrator/tools.ts:3320` |
| `assessFunctionalCompletion` | `src/delivery/checks/project-gate.ts:131,174,213` |
| `arbitrateDeliveryGate` | `src/delivery/arbiter.ts:30`, `src/delivery/checks/project-gate.ts:182`, `src/delivery/index.ts:16` |
| `evaluateQualityGates` | `script/benchmark/quality-gates.ts:174`, `script/benchmark/overlay-web-benchmark.ts:1467` |
| `runLocalVerify` | `script/benchmark/overlay-web-benchmark.ts:1365` |
| `localVerifyExitCode` | `quality-gates.ts:179,203,207`; `overlay-web-benchmark.ts:1472,1583,1588`; runs/*.out (historical only) |
| `withIsolatedCheckWorkspace` / `CHECK_WORKSPACE_EXCLUDED_NAMES` | `src/delivery/checks/project-gate.ts:43,642,682,727` |
| `persistTaskDelivery` | `src/engine/persist.ts:1067`, `src/orchestrator/tools.ts:3255` |
| `delivery.ready` (event) | `src/engine/event-log.ts:29,216`, `src/engine/model.ts:1062`, `src/orchestrator/tools.ts:3761,4264` |
| `packageScriptRunner` / `packageManagerName` | `src/delivery/checks/discovery.ts:144,151` |
| Architect prompt | `src/prompt/core/architect-core.txt` |

If you change any of these symbols' contracts, every callsite must be updated in the same commit.

---

## 7. What you must deliver

1. **Spec** at `specs/delivery-trunk-readiness-gate-2026-05-09.md`:
   - Background (point to this brief).
   - Decision: introduce `ProjectRuntimeReadiness` gate. Single source for: PM field validity, lockfile presence + PM-lock consistency, install (frozen-lockfile / `npm ci`) on trunk, build/test/typecheck if scripts exist.
   - Manifest changes: add `runtimeReadiness` field; required-checks reorder (readiness → required → runtime preview); `assessFunctionalCompletion` promotes readiness-derived check failures to primary.
   - `deliver` tool invariant: candidate persistence → must persist verdict OR `delivery_verification_threw` artifact before tool returns.
   - Codex review feedback section (paste from §3 above; rule 35 demands explicit "codex 审查反馈").
   - Test plan (rule 36 specifics).
   - **Non-goals** (rule 17): do not touch wake/heartbeat scheduler; do not add benchmark-side parallel verifier; do not infer PM from lockfile.
2. **Implementation** under `packages/opencorvus/src/delivery/checks/runtime-readiness.ts` (or whatever name fits). Wire it into `buildDeliveryEvidenceManifest` between coverage validation and runtime flows.
3. **Reorder** `runRequiredChecks` ↔ `runRuntimeFlows` so required checks run first; delete the dead `failedBuild` branch in `runRuntimeFlows`.
4. **`assessFunctionalCompletion` change**: add `failedReadinessIds` (or merge readiness failures into a designated subset of `failedCheckIds`) and promote them to primary.
5. **`deliver` tool invariant**: wrap the `DeliveryService.verify` call so any throw / non-return persists a `delivery_verification_threw` artifact and emits a structured failed verdict before the tool returns.
6. **Benchmark side**: drop `localVerifyExitCode` from `evaluateQualityGates`'s accept triple; keep `runLocalVerify` only if explicitly invoked, otherwise remove. Update all callers found in §6.
7. **Lockfile policy flip**: remove `package-lock.json` from `scaffold_expansion_flags` regex (`quality-gates.ts:67`); the readiness gate now requires lockfile.
8. **Architect prompt**: in `src/prompt/core/architect-core.txt`, require any newly scaffolded JS/TS web project to declare `packageManager` and commit a matching lockfile. Grep for any other prompt that scaffolds projects (intent-analysis, requirements, build) and update those too if relevant.
9. **Tests** per §4 rule 36 list. Place under `packages/opencorvus/test/`.
10. **Rename**: `delivery.ready` event → `delivery.candidate_persisted` if and only if the rename can be done without breaking external consumers (grep `event-log.ts`, plugin triggers, overlay subscribers). If too invasive, leave the rename as a follow-up TODO in the spec but document the misnomer.
11. **Commit per logical step** (rule 26). Push after the suite passes. Don't `--no-verify`.
12. **Run** the existing suite to make sure nothing else broke: `cd packages/opencorvus && bun run typecheck && bun test test/delivery/` (use directed test paths, rule 21 forbids broad `bun test`).

---

## 8. Working notes

- This is git-clean except for `packages/sdk/js/src/gen/types.gen.ts`, `packages/sdk/openapi.json`, and a `.superpowers/` dir. Do not commit those incidentally. The `script/benchmark/runs/*.out`/`.events.ndjson` etc are bench output — leave alone.
- Branch is `claude/benchmark-snapshot-fix-2026-05-07`; main branch for PRs is `dev`.
- Hooks on `git push` run typecheck + api:routes-check + docs:check. Failing → fix the root cause.
- If a test you write requires installing a real package manager / running a real `npm install`, isolate it with a `tmpdir` and skip on CI when network is unavailable; do not weaken the test.

---

## 9. Stop conditions

Stop and ask only when:
- A CLAUDE.md rule blocks a needed change and there's no compliant alternative.
- You discover a 10th gap that materially changes the design.
- A test reveals the calc bench is hitting an entirely different bug (e.g. an executor bug masquerading as a delivery bug).

Otherwise, finish: spec → impl → tests → commit → push.
