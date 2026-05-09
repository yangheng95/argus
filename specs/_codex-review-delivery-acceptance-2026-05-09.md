# Codex Review Request: Delivery Acceptance Gaps (calc benchmark)

## Background

Ran a fresh `overlay-web-benchmark.ts --request-file=script/benchmark/assets/web-calculator-request.txt --executor=mirrorcode` (2026-05-08 23:12 → 2026-05-09 00:13). 8/8 goals merged to master, integrity review = `pass`, then orchestrator stalled at `verdict=inconclusive, delivery=candidate` with no delivery session activity for ~10 min. Killed it.

Project dir: `C:/Users/hengu/AppData/Local/Temp/mirrorcode-overlay-benchmark-project-ySG0oy`. After kill the trunk has source code, tests, `package.json`, but **no `node_modules`, no `dist`, no `package-lock.json`, no `packageManager` field**.

## Confirmed gaps (with file:line evidence)

1. **`runLocalVerify` vacuously skipped** — `packages/opencorvus/script/benchmark/overlay-web-benchmark.ts:559-562` sets `DELIVERY_VERIFY_CMD = ""` whenever neither `--reference-images` nor `--delivery-verify-cmd` was passed. Then `:1354-1363` returns `{ mode: "skipped", exitCode: 0 }`. So `localVerifyExitCode === 0` in `evaluateQualityGates` is **always satisfied** for non-image-reference cases (calc, AMD-replica, etc.). It is not a real verification.

2. **`failedCheckIds` is advisory, not blocking** — `packages/opencorvus/src/delivery/checks/project-gate.ts:213-244` (`assessFunctionalCompletion`) explicitly classifies `failedCheckIds` (build/typecheck/test/lint) as auxiliary. Only `failedCoverageIds`, `failedRuntimeFlowIds`, and `review:integrity` are blocking. The DeliveryAgent (LLM) "weighs" build/test failures.

3. **Required checks run in a clean copy that excludes `node_modules`** — `:42-53` defines `CHECK_WORKSPACE_EXCLUDED_NAMES` = `[".git", ".opencorvus", ".opencorvus-worktrees", ".next", ".turbo", ".cache", "coverage", "node_modules", "out"]`. `withIsolatedCheckWorkspace` (`:682-695`) mkdtemps a scratch dir and `copyTreeIntoCheckWorkspace` (`:698-722`) copies everything except those names. Then `runShellCommand` invokes `npm run build` in that scratch dir. **No `npm install` ever happens.** A grep across `src/delivery` and `src/preview` confirms there is no install-related code anywhere on the delivery path.

4. **`ensureManagedPreviewSession` is brittle** — `packages/opencorvus/src/preview/session.ts:71-77`:
   - throws `no_preview_start_script` if `package.json` lacks `scripts.dev`
   - throws `no_package_manager` if `package.json` lacks `packageManager` field
   The benchmark-generated calc `package.json` has `scripts.dev=vite` but no `packageManager` field. Even if it had one, no `node_modules` means `npm run dev` exits immediately. Result: runtime flow always fails for benchmark deliverables → primary failure → reject. But this collides with gap #5 below.

5. **Wake gap: orchestrator stalls at `delivery=candidate`** — observed in this run, ≥10 heartbeats with no `delivery:` session ID after `delivery.ready` was emitted. memory note `project_orchestrator_wake_wedge_2026_04_29` documents the same family: `inject_operator_message` did not actually dispatchTaskLoop. Fix `5861ebc3b` covered the active+deferred-stop variant but not the candidate variant. Result: even when the engine *would* reject a calc deliverable on runtime flow, the loop never gets there.

6. **Integrity reviewer is LLM-only** — `solution_quality=pass(i0/c0/m0)` happens without spawning any subprocess, building anything, or rendering anything. It judges code by reading. So "262 tests passed" claims from per-goal worktrees are *believed*, never re-run on trunk.

7. **Lockfile policy is inverted** — `packages/opencorvus/script/benchmark/quality-gates.ts:67` lists `package-lock.json` in the `scaffold_expansion_flags` regex; *adding* a lockfile counts toward scaffold noise. There is **no rule requiring** a lockfile for projects that need reproducible installs.

## Architectural root causes

- **Per-goal worktree dispatch dilutes trunk-side responsibility**: each goal session has its own `node_modules` and runs tests there; on merge to master, `node_modules` is correctly excluded by `.gitignore`, but no host step reinstates dependencies on trunk before delivery checks. The architecture assumes per-goal verification transfers to trunk, which is unsound.
- **delivery-core prompt requires `start_frontend_preview` but does not mandate a precondition that dependencies are installed**. The `run_command` tool exists but is not directed to install before preview.
- **Two parallel "verify" paths (benchmark `runLocalVerify` and engine `runRequiredCheck`) both default to weak**: the first vacuously passes when no flag is supplied; the second runs in a clean scratch sans `node_modules` so commands fail, but failures are advisory.

## Proposed plan (5 fixes)

### Fix A — Trunk integration gate (host-side, blocking)
Insert between integrity review and `deliver` invocation a host-side step that:
1. Detects package manager from `packageManager` field or lockfile.
2. Requires lockfile presence for reproducibility (`failedCheckIds` of new family `delivery_gap.no_lockfile`, blocking).
3. Runs `<pm> install --frozen-lockfile` (or `npm ci`) at trunk root.
4. Runs `<pm> run build`, `<pm> run typecheck`, `<pm> run test` if scripts exist.
5. Any failure → `failedCheckIds`, **promoted to primary blocker** (no longer advisory).

### Fix B — `start_frontend_preview` precondition contract
Modify `ensureManagedPreviewSession` (or wrap it in `resolveRuntimeFlowPreview`):
- If `packageManager` missing → fail with `missing_package_manager_field` and a structured fix instruction routed back to architect.
- If `node_modules` missing → call install (using the integration gate above) before launching dev command.
- Keep "no port guessing, no static fallback" rules.

### Fix C — Make `runLocalVerify` actually verify (or delete it)
Three options:
- **C1**: When task surface includes "frontend" (already detected), auto-register a default `delivery_verify_cmd` = `<pm> run build && <pm> exec -- vite preview --port=<auto> & curl --retry-times 30 --retry-delay 1 http://127.0.0.1:<port>`. Drop only when explicit `--delivery-verify-cmd=skip` is passed.
- **C2**: Remove `runLocalVerify` entirely and rely on engine-side runtime flow + integration gate as single source.
- **C3** (preferred): Keep benchmark-side as a sanity check, but make `localVerifyExitCode` advisory (drop from `evaluateQualityGates` triple). Move "real" verification to the engine.

### Fix D — Lockfile policy flip
- Remove `package-lock.json` from `scaffold_expansion_flags` regex.
- Add a `delivery_gap.missing_lockfile` failure when package.json declares dependencies but no lockfile exists.

### Fix E — Wake gap on `delivery=candidate`
- After `delivery.ready` event, if no `delivery:` session is observed within N heartbeats (e.g., 30s), `dispatchTaskLoop` must force-spawn a DeliveryAgent session.
- Same shape as the `5861ebc3b` fix for active+deferred-stop variant.
- Test: enumerate the 4 task states (active, candidate, completed, failed) × 2 dispatch states (deferred, alive); each must dispatch on `inject_operator_message` and on `delivery.ready`.

## Tests required (rule 28, 36)
- `test/delivery/integration-gate.test.ts`: trunk install + build + test runs and fails block accept.
- `test/delivery/integration-gate-lockfile.test.ts`: missing lockfile blocks accept.
- `test/preview/session-precondition.test.ts`: missing packageManager → structured fail; missing node_modules → install runs before dev.
- `test/orchestrator/delivery-candidate-wake.test.ts`: candidate state without delivery session for N heartbeats triggers dispatch.
- `test/benchmark/local-verify-default.test.ts`: when surface=frontend, default verify cmd is registered.

---

## Codex tasks for this review

Please challenge the analysis in three rounds. Use file references to ground each claim.

### Round 1 — claim validity
For each of the 7 confirmed gaps, answer:
- Is the file:line claim accurate? (Yes / No / partially with what specifically)
- Is the gap real, or is there a code path I missed that already addresses it?
- If real, what is the actual blast radius? (which task surfaces, executors, model providers?)

### Round 2 — plan completeness
For the 5 proposed fixes (A–E), answer:
- Does the fix address the root cause or just the symptom?
- Does it conflict with any existing rule in `CLAUDE.md` (especially rules 7, 8, 11, 13, 26, 35, 36)?
- Does it conflict with prior specs in `specs/`? (`delivery-evaluation-and-preview-repair-plan-2026-05-08.md`, `delivery-integrity-prerequisite-2026-05-08.md`, `delivery-completion-first-2026-05-02.md`)
- What test coverage gaps remain?

### Round 3 — alternatives + missing fixes
- What did I miss? (Other gaps, other root causes)
- Is there a simpler unifying fix that covers multiple gaps at once?
- Is there a "wrong direction" risk where my plan ossifies a bad design instead of fixing it?

Be terse and specific. Do not restate my analysis — only deltas.
