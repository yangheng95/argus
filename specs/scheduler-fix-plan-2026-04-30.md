# Scheduler Collaboration — Fix Plan (2026-04-30)

> **Source.** `specs/scheduler-collab-audit-2026-04-30.md` (commits `c9e87eac2` → `a7e2add22`) + live bench `tsk_dde13a67c001sbz6y2Qe0at8Fc` evidence.
>
> **Mode.** Repair. Each fix follows CLAUDE.md rules 7 (no fallback), 8 (single source), 13 (no hardcoded state machines), 33 (commit + push every change), 35 (full-repo grep before landing), 36 (every change carries unit / e2e tests).
>
> **Sequence required.** Codex review of this plan before any code change. Fixes apply in priority order. Each fix is its own commit with passing tests. New benchmark only after all P0/P1 fixes are merged + green.

---

## 0. Scope and non-goals

| In scope | Out of scope this round |
|---|---|
| P0–P3 listed below (real bugs verified by source + bench) | Whole-of-architecture redesign |
| Source-driven fixes (no behavioural patches, no fallback insertion) | `BuildResult` schema enrichment (audit §2.5; tracked separately as a follow-up because it touches every downstream consumer) |
| Test coverage for every change (rule 36) | `dispatchTaskLoop` fire-and-forget hardening (audit §7; current LLM re-derive contract holds — not a bug, just fragile) |
| Removal of legacy enforcement gates that break rule 13 (rule 17 — kill dead/parallel paths) | Bus event catalog overhaul — re-classify orphans vs observability-only (audit §3 caveat). Fast-follow doc work, not a fix. |

---

## 1. Problem inventory (verified, with file:line)

| # | Issue | Audit ref | Bench ref | Verified root cause | Severity |
|---|---|---|---|---|---|
| **P0** | Retry attempt's `goal_run` row exists but is invisible to `deriveGoalStatus` — goal stays at `pending` while build is actually running | §11.6, L8 | log line 19356 vs missing `from=pending to=running reason=beginBuildAttempt` for `gol_*0001` after retry | `supersedeGoalRun` patches the OLD row's `time_updated = max(existing.time_updated + 1, now)` (`engine/persist.ts:565`); `beginBuildAttempt` inserts NEW row with `time_created = now` (`engine/persist.ts:1466`). Tip selection ordered by `time_updated DESC` (or any ordering not filtering on `superseded_reason IS NULL` first) picks the patched-old row → the new running attempt never becomes the tip. | **High** — every retry hides progress; orchestrator may double-dispatch or miscount budget. |
| **P1** | Same session emits two contradictory terminal events (`reason=aborted` then `reason=completed`) on cancel-during-finish | §11.3 | log lines 19182-19183 | The session cancel path and the agent-runner natural-finish finally block are independent emit sites. No single-emit latch on the session. | **Medium** — overlay UI / consumers may act on the wrong terminal. |
| **P2** | Build agent terminal report missing → orchestrator only sees Zod schema rejection of `undefined`; agent's actual progress invisible | §11.1, L1 | log line 19180 (`Invalid input: expected object, received undefined`) | When LLM session is cancelled before calling `report_build_result`, BuildAgent.run finishes with `hasStructured=false`. The `build` tool then validates `undefined` against `BuildResultSchema`, throws, and the orchestrator only sees `build tool failed`. There is no contract enforcement at the protocol layer. | **Medium-high** — masks agent failure mode and prevents rule 1 root-cause analysis. |
| **P3** | Permission `external_directory` for the bench project root times out at 5 min, cancelling the build session | §11.2, memory `feedback_goal_permission_hang.md` | log line 19171 (`permission=external_directory patterns=["…UkylGI/*"] permission timeout rejected`) | Build session inherits default `ask` policy; auto-permission rules don't auto-allow the session's own worktree / project-root paths. | **Medium-high** — first build attempt always burns 5 minutes. |
| **P4** | `design_analysis` abort writes only stderr WARN — no `decision_log` entry → architect / build see `designSpecs=undefined` with no explanation | §2.3, L3 | log line 1729 (`materialCount=0 design_analysis: no visual input materialized — aborting before agent call`) | Abort path (`task-tools` design_analysis) bypasses `decision_log.append({phase: "design_analysis", ...})`. The phase exists structurally (audit §4 table) but has no writer for the abort case. | **Medium** — silent information loss across upstream→downstream seam. |
| **P5** | Bootstrap-first gate is **late rejection** rather than upstream constraint — orchestrator dispatches non-bootstrap goals in parallel intending "第一波并行构建", gate rejects each post-dispatch | §11.4 | log lines 7456, 7860 | `task-tools` build dispatch path enforces `pendingBootstrap` check after the orchestrator has already issued the dispatch. The constraint is not surfaced via `describe()` so the LLM cannot anticipate it. CLAUDE.md rule 13 ambiguity: late gate is closer to a hidden state machine than to LLM-driven flow. | **Medium** — wastes orchestrator turns; symptom of rule 13 violation. |

---

## 2. Fix specifications

### P0 — Tip-selection ordering: filter superseded BEFORE picking newest

**Files in scope.**
- `packages/opencorvus/src/engine/persist.ts` (`supersedeGoalRun`, `appendGoalRunArtifact`, `findLatestTipGoalRun`, `latestPerGoalRun`)
- `packages/opencorvus/src/engine/store.ts` (where the SQL/query lives)
- `packages/opencorvus/src/engine/goal-status.ts` (`deriveGoalStatus` — confirm it consumes the corrected tip)

**Fix (single-source, no fallback).**

Tip selection MUST filter `superseded_reason IS NULL` **before** any time-based ordering. The current implementation (verified by reading `appendGoalRunArtifact:565` and `beginBuildAttempt:1466`) places the patched-old row's `time_updated` strictly after the new running row's `time_created` by construction (`Math.max(existing.time_updated + 1, now)`). Any tip query that sorts by `time_updated DESC` without first filtering supersededs will always select the wrong row.

Concrete change:
- `latestPerGoalRun` query: add `WHERE superseded_reason IS NULL` to the per-goal_run aggregate, then `ORDER BY time_created DESC LIMIT 1` (or equivalent SQL/Drizzle-kit predicate).
- `findLatestTipGoalRun(goal_id)`: same filter, scoped to a single goal.
- Remove the `Math.max` time-bump in `appendGoalRunArtifact` if it has no other purpose. **Verify rule 35 grep first** — if other consumers rely on the bump for monotonic ordering of multi-append patches, keep it but ensure those consumers also filter supersededs.

**Rule 8 / rule 17 check.**
- The `Math.max` bump exists to "guarantee strict wall-clock monotonicity across appends to the same logical goal_run" (`persist.ts:559-565`). After this fix, that property is preserved within the same `goal_run_id` (the patched-old row is still the latest version of itself). The cross-goal_run tip selection no longer depends on it.
- No fallback path. The fix replaces broken ordering with correct ordering. No "if old, fall back to new" — the filter eliminates supersededs unconditionally.

**Tests (rule 28 / 36).**
1. Unit test in `packages/opencorvus/test/engine/persist.test.ts` (or new `goal-tip-selection.test.ts`):
   - Construct goal with one terminal+superseded `goal_run` (status=`failed`, `superseded_reason="build_retry"`, `time_updated=T+1`) and one new `goal_run` (status=`running`, `time_created=T`, no supersede).
   - Assert `findLatestTipGoalRun(goalID)` returns the new running row.
   - Assert `deriveGoalStatus(goalID)` returns `running`.
2. E2E regression test: spawn an in-process bench with one bootstrap goal, force the first attempt to fail (e.g. inject build agent that throws), assert second attempt's `service=goal-status from=pending to=running reason=beginBuildAttempt` log line is emitted.

### P1 — Single-emit terminal latch on Session

**Files in scope.**
- `packages/opencorvus/src/session/index.ts` (where `Session.error / Session.idle / Session.status` events emit)
- `packages/opencorvus/src/session/status.ts` (terminal state setters)
- `packages/opencorvus/src/session/loop.ts` (cancel + finally finish paths)
- `packages/opencorvus/src/agent/runner.ts` (which orchestrates lifecycle for build/architect/etc.)

**Fix.**

A `Session` may transition to terminal exactly once. The first writer wins; subsequent attempts to emit a terminal event for the same session are no-ops (logged at WARN with the second reason for diagnostics, not silently swallowed — rule 1 visibility).

Concrete change:
- Add a `terminalEmitted: boolean` field on the in-memory Session record, set atomically inside the same DB transaction that writes the terminal status row.
- All terminal-emitting code paths (cancel, natural finish, error) consult this latch before emitting `Bus.publish(SessionTerminal, ...)`.
- The cancel path always wins if it fires first (because it's the explicit operator decision). Natural finish on a cancelled session emits a debug log "session terminal already claimed by cancel; skipping completed-emit" but does not raise.

**Rule 13 check.**
- A boolean latch is not a state machine. There are no enumerated states beyond `terminalEmitted ∈ {false, true}`. The flow logic (when to emit, what to emit) remains LLM-decided / cancel-decided.

**Tests.**
1. Unit test in `packages/opencorvus/test/session/terminal-latch.test.ts`:
   - Spawn a session, simulate cancel-during-finish race (cancel + finally execute concurrently).
   - Assert exactly one `SessionTerminal` Bus event is emitted; second is suppressed and logged.
2. Update existing `agent-runner.test.ts` or `session-loop.test.ts` to assert single-emit invariant on the cancel path.

### P2 — Build-agent contract: terminal report mandatory or surface as agent-contract failure

**Files in scope.**
- `packages/opencorvus/src/build/agent.ts` (BuildAgent.run terminal collection)
- `packages/opencorvus/src/build/types.ts` (BuildResult / BuildAgentContractError)
- `packages/opencorvus/src/orchestrator/tools.ts:3950+` (build tool's terminal report consumption)

**Fix.**

Define a new error class `BuildAgentContractError extends Error` with `code = "missing_terminal_report"`. BuildAgent.run's finally block:
- If a `BuildResult` was emitted via `report_build_result` tool call → return it.
- Otherwise → throw `BuildAgentContractError("build agent terminated without report_build_result; sessionID=…, last_message_at=…, tool_calls=N")`.

The build tool catches the error, calls `finalizeBuildAttempt({ status: "failed", summary: "agent contract violation: …", error: … })` so the goal_run lifecycle stays consistent (no orphaned attempt-running rows — audit §11.6 had this risk listed). The orchestrator sees a normal failed build and decides next via the existing retry path.

**Rule 7 check.**
- This is **not a fallback**. It is explicit error handling. We do not synthesise a fake `BuildResult` from session messages. We surface the contract violation as the failure it is, with diagnostic context the orchestrator's next prompt can read.
- The diagnostic context is written to `decision_log phase="retry"` with `reason="build_agent_contract_violation"` so the next attempt's prompt explicitly tells the LLM what went wrong.

**Tests.**
1. Unit test in `packages/opencorvus/test/build/contract.test.ts`:
   - Mock LLM stream that emits messages but never calls `report_build_result`.
   - Assert `BuildAgentContractError` thrown with diagnostic fields.
2. Integration test: build tool catching the error, asserting `goal_run.status=failed`, `decision_log` retry entry written.

### P3 — Project-root permission allow-list as primary policy

**Files in scope.**
- `packages/opencorvus/src/permission/next.ts` (`PermissionNext.fromConfig`, `findLast` evaluator)
- `packages/opencorvus/src/orchestrator/tools.ts` (where build session permission ruleset is built)
- `packages/opencorvus/src/agent/runner.ts` (per-agent permission inheritance)

**Fix.**

When BuildAgent opens a session for a per-goal worktree, the session's permission ruleset MUST include an explicit allow rule for the worktree directory **before** the session is created. The pattern is the worktree absolute path with trailing `/**`. This is the **primary policy** for the build session — not a fallback added on timeout.

Concrete change:
- In `BuildAgent.run` (or wherever session ruleset is composed from agent-base + per-call adds), append:
  ```
  { permission: "external_directory", action: "allow", pattern: "${worktree}/**" }
  ```
- The build agent owns its worktree → has primary write authority → no need to "ask" for paths inside its own scope.
- The bench project root (which contains all worktrees + scratch dirs) gets a similar rule automatically derived from the project directory at session-bootstrap.

**Rule 7 / 8 check.**
- This is **not a fallback** for an existing "ask" rule — the existing "ask" applies to paths outside the agent's scope. Two coexisting rules with different patterns is the existing pattern-matched policy design (rule 11 — the abstraction layer), not double-source.
- Memory note `feedback_goal_permission_hang.md` documents the silent-fallback mistake from prior fixes; this fix avoids the silent fallback by being a primary positive rule.

**Tests.**
1. Unit test in `packages/opencorvus/test/permission/build-session.test.ts`:
   - Compose a build-session ruleset, simulate a tool requesting a path inside the worktree, assert immediate `allow`.
   - Simulate a tool requesting a path outside the worktree, assert `ask` (existing behaviour).
2. E2E test: spawn an in-process build session against a temp worktree, assert no permission timeouts occur during a normal-shape build.

### P4 — Decision-log writer for `design_analysis` abort

**Files in scope.**
- `packages/opencorvus/src/orchestrator/tools.ts` (the `design_analysis` tool body — abort path before agent call)
- `packages/opencorvus/src/decision-log/index.ts` (verify `phase="design_analysis"` is supported in `phasePromptSection` lookup)
- `packages/opencorvus/src/prompt/upstream-context.ts` (verify it injects design_analysis into architect/build prompts)

**Fix.**

In the `design_analysis` tool's abort path (currently emits stderr WARN at `task-tools` `materialCount=0`), append a decision_log entry:
```
{ phase: "design_analysis",
  goalID: undefined,  // task-scoped
  key: "abort_no_visual_material",
  value: "design_analysis aborted before agent call",
  reason: "<concrete reason: url render timeout / no figma url / etc.>" }
```

**Then verify** (rule 35 grep) that `prompt/upstream-context.ts` injects `phase="design_analysis"` decisions into architect/build prompts. If not, add it to the injector. Architect's prompt then explicitly states "Design analysis was aborted: …" so the LLM can decide whether to proceed without visual context or escalate via question/fail_task.

**Rule 1 / rule 4 check.**
- Root-cause: information was being lost across the upstream-→downstream seam. Fixing the writer side without fixing the reader side would be patch-shaped. Both sides must be verified.

**Tests.**
1. Unit test: drive `design_analysis` with a URL that fails content_paint gate, assert decision_log entry created.
2. Integration test: after a design_analysis abort, run architect agent, assert prompt contains the abort reason verbatim.

### P5 — Bootstrap-first as upstream LLM constraint, not late gate

**Files in scope.**
- `packages/opencorvus/src/orchestrator/tools.ts` (`pendingBootstrap` gate location — search "bootstrap-first gate")
- `packages/opencorvus/src/engine/describe.ts` (where the orchestrator's per-wake snapshot is built)
- `packages/opencorvus/src/orchestrator/agent.ts` (system prompt for orchestrator)

**Fix.**

Remove the `pendingBootstrap` late-rejection gate (rule 17 — kill dead/parallel path). Replace with two changes:
1. `describe()` output annotates each goal with `kind` (`bootstrap` / `system` / `feature`) and `dispatchEligible` (boolean derived from "any bootstrap goal still live → only bootstrap goals are eligible").
2. Orchestrator system prompt (or upstream-context section) gets a paragraph: "When the goal set contains any goal with `kind=bootstrap` whose status is not terminal, dispatch only that bootstrap goal. Other goals will become eligible after bootstrap completes."

The LLM then makes the dispatch decision with the constraint visible upfront. No hidden state machine.

**Rule 13 check.**
- Removes a hidden if-else state machine (gate). Replaces with LLM-readable constraint in the prompt.
- Rule 6: leverages LLM intelligence to schedule, doesn't enforce via code.

**Tests.**
1. Unit test on `describe()`: construct a task with bootstrap + 4 feature goals, assert `dispatchEligible: true` only for bootstrap; after bootstrap completes, assert all become eligible.
2. E2E test: orchestrator on a task with bootstrap+features, assert it dispatches only bootstrap on first turn (verify by checking which `build` tool calls were made).
3. Negative test: attempt a feature dispatch via direct tool call → assert tool returns descriptive error citing bootstrap gating (kept as belt-and-braces but no longer the primary enforcement).

---

## 3. Order of operations

P0 must land first because P1/P2 tests depend on the retry path emitting correct status. Then P1 (cleanup terminal events) so P2's contract violation surfaces cleanly. Then P3 (so P2 isn't masked by 5-min permission timeouts in the test fixture). Then P4, then P5.

```
P0 → P1 → P2 → P3 → P4 → P5
```

Each lands as its own commit:
- `fix(engine): tip selection filters superseded before ordering (P0)`
- `fix(session): single-emit terminal latch (P1)`
- `fix(build): surface missing terminal report as contract violation (P2)`
- `fix(permission): worktree path is primary allow rule for build session (P3)`
- `fix(orchestrator): write decision_log on design_analysis abort (P4)`
- `refactor(orchestrator): bootstrap-first as LLM-readable constraint, drop late gate (P5)`

After each commit: pre-push hook (typecheck / api:routes-check / docs:check / panel-i18n / secret-scan) must pass. Tests must pass. Push immediately.

---

## 4. Validation: new bench

After all six commits land:
1. Reset bench artifacts (`packages/opencorvus/script/benchmark/runs/`, scratch DB).
2. Launch overlay-web-benchmark with the same model/executor/case as `tsk_dde13a67c001sbz6y2Qe0at8Fc` (CLAUDE.md rule 25 — no `--no-browser`).
3. Verify in the new bench log:
   - **P0**: every retry attempt emits `from=pending to=running reason=beginBuildAttempt` immediately after `supersedeGoalRun:build_retry`.
   - **P1**: zero sessions emit two terminal `[overlay-benchmark] session.terminal …` lines for the same session ID.
   - **P2**: if any build agent finishes without `report_build_result`, log shows `BuildAgentContractError` with diagnostic context (and orchestrator surfaces a normal `failed` goal_run, not Zod schema rejection).
   - **P3**: zero `permission=external_directory pattern=…/{project-temp-root}/* permission timeout rejected` lines.
   - **P4**: when design_analysis aborts, the decision_log table (verifiable via DB query) contains a `phase=design_analysis` entry; the architect's first prompt contains "Design analysis aborted" verbatim.
   - **P5**: zero `bootstrap-first gate rejected non-bootstrap dispatch` WARN lines (the LLM no longer attempts those dispatches).

Bench must reach `qualityVerdict: accepted` (or produce a clean rejection trace if real quality fails) with all six markers in place. CLAUDE.md rule 24 — even on accept, run a manual second review.

---

## 5. Open questions for review

1. **P0 query change scope** — does `latestPerGoalRun` have any other call site that depends on the current "patched-old wins on time_updated" ordering? Need full grep before landing.
2. **P1 terminal latch placement** — should the latch live on the in-memory Session record, or in DB as a `terminal_emitted_at` column? In-memory is faster; DB survives restarts. Audit §7 W2 noted the `dispatchTaskLoop` fragility — should this be a DB latch to survive that?
3. **P2 contract violation handling** — if `BuildAgentContractError` is thrown, should the orchestrator's retry budget count it? Currently `delivery.max_fix_runs` is the only budget. Should there be a separate "agent contract violation" budget that escalates faster (e.g. fail_task after 1 violation, since it indicates LLM model incompatibility, not goal difficulty)?
4. **P3 worktree-allow scope** — is the worktree directory the right boundary, or should the project temp root be the boundary? Bench creates `…/UkylGI/.opencorvus/worktrees/goal-…`; the build agent occasionally touches paths outside the worktree (e.g. shared cache). Need behavioural verification.
5. **P5 prompt phrasing** — "When the goal set contains any goal with kind=bootstrap whose status is not terminal, dispatch only that bootstrap goal" is a directive; rule 6 prefers LLM-driven flexibility. Is there a softer phrasing that still produces the right behaviour without sounding like a hardcoded rule?
6. **Test infrastructure** — do we need new test helpers for "spawn build session against temp worktree" (P3 E2E), or are existing fixtures sufficient?
7. **Bench reset mechanics** — does `bench --reset` exist? If not, manual delete of `mirrorcode-overlay-benchmark-*` temp dirs is the contract; safe under autonomous run? (Memory note `project_resume_bench_cwd_leak_2026_04_29.md` warns against `--resume-task-id`; fresh bench is preferred.)

---

## 6. Items deferred to later rounds

- **§2.5 / L1 BuildResult schema enrichment.** Current schema `{status, summary, worktree?}` loses the build agent's tool-call history. P2 surfaces contract violations but doesn't widen the success-path payload. Tracked separately because it touches every downstream consumer of BuildResult.
- **§7 wake-mechanism hardening.** `dispatchTaskLoop` fire-and-forget; current LLM re-derive is the safety net. Memory note `project_orchestrator_wake_wedge_2026_04_29.md` (commit 5861ebc3b) covers the most acute case. Larger redesign deferred.
- **§3 Bus event re-classification.** Many "orphan" events are observability sidecar via `Bus.subscribeAll`/`GlobalBus.on("event", …)`. Catalog overhaul is doc work, not a fix.
- **§5 D2 verification-evidence denormalisation.** Single-write derived from `verdict` artifact; reader-side risk only on partial persist. Defer until partial-persist ever observed.
- **§5 D6 bootstrap-first ambiguity** — addressed by P5; nothing else deferred.

---

## 7. Codex review checklist

Reviewer should verify:

1. Does each fix have ONE writer and ONE source of truth (rule 8)?
2. Does any fix introduce a fallback / compatibility path (rule 7)?
3. Does any fix introduce hardcoded state machine logic (rule 13)?
4. Is the rule 35 grep planned — explicit list of files to scan before landing?
5. Does each fix have unit AND e2e coverage (rule 28 / 36)?
6. Do P0/P1/P2 fixes introduce drift between in-memory and DB state?
7. Does P5's prompt-driven rephrasing actually drive the LLM to the same behaviour, or does it leave a window where the bootstrap goal can be skipped?
8. Are the open questions in §5 answered or explicitly deferred?
9. Is the validation bench in §4 sufficient to declare done, or does it need extra fixtures?

If any check fails, reject the plan and request revision before any code change.
