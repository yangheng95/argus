# Scheduler Collaboration — Fix Plan (2026-04-30)

> **Source.** `specs/scheduler-collab-audit-2026-04-30.md` (commits `c9e87eac2` → `a7e2add22`) + live bench `tsk_dde13a67c001sbz6y2Qe0at8Fc` evidence.
>
> **Mode.** Repair. Each fix follows CLAUDE.md rules 7 (no fallback), 8 (single source), 13 (no hardcoded state machines), 33 (commit + push every change), 35 (full-repo grep before landing), 36 (every change carries unit / e2e tests).
>
> **Sequence required.** Codex review of this plan before any code change. Fixes apply in priority order. Each fix is its own commit with passing tests. New benchmark only after all P0/P1 fixes are merged + green.

## Revision history

- **v1 (commit `405632f56`).** Initial plan from audit findings.
- **v2 (this commit).** Revised after first reviewer pass (`superpowers:code-reviewer` agent). Reject + Revise verdicts on P0, P1, P5. Source-verified by direct read of `engine/store.ts:470-512`, `engine/persist.ts:506-528, 559-590, 1410-1490`, `session/status.ts:1-115`. Major changes:
  - **P0 mechanism description corrected.** Tip ordering is `time_created DESC` (`engine/store.ts:476, 493`), not `time_updated DESC`. The audit had this as a disjunction; plan v1 flattened to the wrong assertion. v2 narrows to the verified mechanism: `appendGoalRunArtifact:565` writes the patched-old row with `time_created = Math.max(existing.time_updated+1, now)`, which lands AFTER the new running row's `time_created = now`, so `time_created DESC` selects the patched-old.
  - **P0 dead-code finding folded in.** `findLatestTipGoalRun` (`store.ts:505-512`) filters by `supersede_of` set membership, but `supersede_of` is **never populated** by any current writer (`persist.ts:1448` sets it to `null` on insert; `appendGoalRunArtifact` only patches `superseded_reason` / `superseded_at`). The existing filter is dead. Same dead filter exists in `engine/goal-status.ts:79`. P0's fix MUST kill these dead filters and use `superseded_reason IS NULL` (rule 17 — kill parallel paths).
  - **P1 fundamentally rejected.** `session/status.ts:77-114` already has the exact latch v1 proposed, with a comment block citing the same `aborted+completed` double-fire bug shape. Adding a second latch is a rule 8 violation. v2 replaces P1 with a root-cause investigation: why does the existing latch fail at bench lines 19182-19183? Three hypotheses to verify before any code change.
  - **P5 contradiction resolved.** v1 said both "kill the late gate (rule 17)" and "keep as belt-and-braces" in the same section. v2 picks: **remove the late gate**. The validation marker stays "zero `bootstrap-first gate rejected ...` lines" because the gate is gone.
  - **P5 prompt phrasing softened.** v1 used directive ("dispatch only that bootstrap goal"); v2 uses physical-fact framing per reviewer Q5: state the file-conflict reality and trust LLM inference.
  - **P2 wording corrected.** v1 said throw "in finally"; actual throw is at `build/agent.ts:633-636` AFTER finally (which ends at 612). Re-stated.
  - **P2 mergeBackBlockedReport gap added.** Reviewer flagged the existing `mergeBackBlockedReport` synthesis (`agent.ts:614-630`) as a separate rule-7 fallback. v2 brings it into the typed-error regime in the same commit.
  - **P3 plumbing pinned.** v1 said "project root auto-derived"; v2 specifies via `Task.directory` exposed at `BuildAgent.run` session-ruleset composition, threading through the existing `agent/agent.ts:524-535` injection logic (not duplicating).
  - **P4 systemic bundling.** v1 only covered `design_analysis` abort. v2 bundles `intent-analysis` abort (audit L7) — same architectural shape, rule 4 (systemic root cause) applies.
- **Codex CLI second-pass findings (folded into v2):**
  - **P2 scoped to opencode executor.** Codex flagged: BuildAgent.run also serves `codex`/`claude-code` external executors where the host synthesises the BuildResult after the provider finishes — there is no in-session `report_build_result` tool call. v1's "make terminal report mandatory" would mark every external-executor build as a contract violation. v2 scopes the contract error to the opencode terminal-tool collector path; external executors keep their host-synthesised shape.
  - **P3 dropped task-root allow.** Codex flagged: auto-allowing the task primary directory covers sibling worktrees too, which breaks worktree isolation (a build for goal A could touch goal B's worktree via `../../goal-B/…`). v2 narrows the new allow rules to the **current goal's worktree path only**, plus an explicit list of scratch/cache directories the goal opted into (no shared parent).
  - **P5 keeps defense-in-depth gate, demotes to safety net.** Codex flagged: removing the gate entirely leaves the same LLM mistake unblocked. Bench evidence shows the LLM dispatched non-bootstrap goals while bootstrap was live. v2 keeps the gate as a final enforcement, BUT raises the constraint into describe + prompt as the *primary* signal so the LLM doesn't get there. The gate's role becomes belt-and-braces for the LLM-misbehaviour case, with a clear log line that distinguishes "LLM ignored the constraint" from "the gate is the constraint." Rule 17 still kills the previous redundant emit/return paths inside the gate; only the assertive check stays.

- **v3 (this commit) — codex second-pass + cron self-challenge.** Six revisions:
  1. **P0 reversed.** Codex P1: `supersede_of` is the **designed** chain — verified 10+ readers (`engine/persist.ts:345/364/484/552/623/666/694`, `engine/store.ts:122/501/509/1556/1578`, `engine/goal-status.ts:79`, `engine/describe.ts:165/180`, `engine/workflow.ts:411`, `workbench/board.ts:892-898`, plus `test/engine/state-invariants.test.ts:82-123` enforcing invariants on it). The bug is **`beginBuildAttempt:1448` writing `supersede_of: null` instead of threading `openGoalImplementationVersion().supersededTipID` through**. v3 fix: populate `supersede_of` from the version output. Single source remains `supersede_of`. v2's "filter by `superseded_reason`" plan is dropped — it would have deleted a working abstraction with a parallel one.
  2. **P3 contradiction resolved + ordering correction.** v2 revision-history said "task-root allow dropped" but v2 body still added a task-primary-directory rule and tested it (lines 196-200). Codex P1: this also reverses permission precedence — `PermissionNext.merge` flattens, `evaluate` uses `findLast`, so an allow appended after user config OVERRIDES an explicit user deny. v3: align body with revision-history (worktree-only, no task-root). Define injection slot BEFORE user config so user-explicit deny wins via `findLast`. Add deny-wins regression test.
  3. **P3 root-cause investigation added.** Cron self-challenge: bench rule pattern at line 17478 already includes `${worktree}/**` allow. Bench timeout (line 19171) was for `${task_root}/*` request — NOT worktree. v2 P3's worktree-only fix would be a no-op against the actual bench evidence. v3 P3 splits into P3-A (investigate which tool call requested `${task_root}/*` and whether the agent's intent was correct) + P3-B (the worktree+ordering fix above). P3-B lands regardless; P3-A determines if more is needed.
  4. **P5 contradiction aligned.** Codex P1: v2 revision-history said "gate stays" but v2 body still included "delete the late gate" + grep invariant test. v3 picks one: gate stays as defense-in-depth; drop the "kill" framing from body; drop the grep invariant test; keep the gate-still-works regression test.
  5. **P2 control-flow specified.** Codex P2: current orchestrator catches BuildAgent errors → finalizes failed → **rethrows**. v2 said "orchestrator sees normal failed attempt" but didn't specify the catch. v3 adds: build tool's catch block on `BuildAgentContractError` → `finalizeBuildAttempt({status:failed, ...})` → return `BuildResult { status: "failed", ... }` directly to the orchestrator (DO NOT rethrow). Add a test asserting the orchestrator does NOT see the generic "build tool failed" error path.
  6. **P1 inventory updated.** Codex P2: §1 inventory still said "No single-emit latch on the session" (line 46) while v2 §body says "latch exists at status.ts:97". v3 fixes inventory and narrows root cause to H1: `SessionStatus.set` calls `Bus.publish(Event.Status, ...)` at line 98 BEFORE writing state at line 113. `Bus.dispatch` invokes subscribers synchronously, so a subscriber can re-enter `set()` before the latch is sealed. Tests target subscriber re-entry, not "latch absent."

- **Codex P3 finding "duplicated checklist at lines 341-374"**: verified by grep that v2 file has exactly one `§7. Codex review checklist` (lines 354-368) and one `§6. Items deferred` (lines 344-350) — no actual duplication in the file. Likely a diff-rendering artifact from how the v1→v2 patch presented sections. v3 leaves §6/§7 as-is. If codex still observes duplication on v3, will need pair-programming session to identify the rendering issue.

- **v4 (this commit) — Codex close-out of unfinished plan work.** Remaining gaps closed:
  1. **P3-A completed from bench logs.** `_session-r1-opencode.run-pre-fixes.out:17478-17481` shows a `glob` call evaluated against `${task_root}/*` while the ruleset already had `${worktree}/**` allow. `_session-r1-opencode.run-pre-fixes.out:26523-26525` shows a `bash` path argument resolving to the task root and then asking `external_directory` for `${task_root}/*`. Both are build-session escapes from the owned worktree, not missing legitimate worktree allow rules.
  2. **P3 policy changed from "ask outside worktree" to "deny task-root escape".** Build sessions get an owned-worktree allow plus an explicit task-root / sibling-worktree deny so out-of-scope access fails immediately instead of burning 5 minutes. No task-root allow is introduced.
  3. **Order, commit messages, validation markers, and review questions updated to match v3/v4 decisions.** Stale `drop late gate`, `tip selection filters superseded`, and `project-temp-root timeout` wording removed.

- After v4, plan re-submits for final review. No code change until review approves.

---

## 0. Scope and non-goals

| In scope | Out of scope this round |
|---|---|
| P0–P5 listed below (real bugs verified by source + bench) | Whole-of-architecture redesign |
| Source-driven fixes (no behavioural patches, no fallback insertion) | `BuildResult` schema enrichment (audit §2.5; tracked separately as a follow-up because it touches every downstream consumer) |
| Test coverage for every change (rule 36) | `dispatchTaskLoop` fire-and-forget hardening (audit §7; current LLM re-derive contract holds — not a bug, just fragile) |
| Disclosure and single-source cleanup for enforcement gates that currently surprise the LLM | Bus event catalog overhaul — re-classify orphans vs observability-only (audit §3 caveat). Fast-follow doc work, not a fix. |

---

## 1. Problem inventory (verified, with file:line)

| # | Issue | Audit ref | Bench ref | Verified root cause | Severity |
|---|---|---|---|---|---|
| **P0** | Retry attempt's `goal_run` row exists but is invisible to `deriveGoalStatus` — goal stays at `pending` while build is actually running | §11.6, L8 | log line 19356 vs missing `from=pending to=running reason=beginBuildAttempt` for `gol_*0001` after retry | **Verified mechanism (v3):** `findLatestTipGoalRun` (`store.ts:505-512`), `engine/describe.ts:180`, `engine/goal-status.ts:79`, `engine/workflow.ts:411`, `workbench/board.ts:892-898` ALL filter by `supersede_of` set-membership — this is the **designed** chain abstraction. The bug is **`beginBuildAttempt` writes `supersede_of: null` at `persist.ts:1448`** instead of threading `openGoalImplementationVersion().supersededTipID` (which is computed at `persist.ts:617-666` but never propagated). Without supersede_of populated, the OLD terminal row's id never enters the supersededIDs set, so `find` returns the OLD row by `time_created DESC` (the patched-old has `time_created = max(old.time_updated+1, now) ≥ new.time_created`). Derive then projects to OLD's superseded-pending state forever. v2 incorrectly diagnosed this as "supersede_of is dead" — actual diagnosis is "supersede_of is correctly designed but `beginBuildAttempt` skips populating it". | **High** — every retry hides progress; orchestrator may double-dispatch or miscount budget. |
| **P1** | Same session emits two contradictory terminal events (`reason=aborted` then `reason=completed`) on cancel-during-finish | §11.3 | log lines 19182-19183 | **Verified mechanism (v3):** `SessionStatus.set` (`session/status.ts:77-114`) HAS a first-terminal-wins latch at line 97 (`if (state()[sessionID]?.type === "terminal") return`). The bug is the latch's TOCTOU window: line 98 publishes via `Bus.publish` (synchronous dispatch — subscribers run in-thread); line 113 writes state. A subscriber that re-enters `set()` (e.g. via `Bus.subscribeAll` consumers calling back into the session lifecycle) sees state still un-written and bypasses the latch. Two terminal publishes both pass before either writes. v2 inventory said "no latch" — was wrong; latch exists, has a re-entrancy hole. | **Medium** — overlay UI / consumers may act on the wrong terminal. |
| **P2** | Build agent terminal report missing → orchestrator only sees Zod schema rejection of `undefined`; agent's actual progress invisible | §11.1, L1 | log line 19180 (`Invalid input: expected object, received undefined`) | When LLM session is cancelled before calling `report_build_result`, BuildAgent.run finishes with `hasStructured=false`. The `build` tool then validates `undefined` against `BuildResultSchema`, throws, and the orchestrator only sees `build tool failed`. There is no contract enforcement at the protocol layer. | **Medium-high** — masks agent failure mode and prevents rule 1 root-cause analysis. |
| **P3** | Permission `external_directory` for the bench project root times out at 5 min, cancelling the build session | §11.2, memory `feedback_goal_permission_hang.md` | log lines 17480→19171 and 26523→28222 (`permission=external_directory patterns=["…UkylGI/*"] permission timeout rejected`) | **Verified mechanism (v4):** build sessions already carry `${worktree}/**` allow, but the LLM/tool call escaped to the task root. First occurrence: `glob **/*` caused an external-directory ask for `${task_root}/*`; second occurrence: `bash` had an absolute task-root path argument. The gap is not "missing worktree allow"; it is "out-of-scope task-root access falls through to `ask` and waits 5 minutes." | **Medium-high** — first build attempt can burn 5 minutes and hide the real contract failure. |
| **P4** | `design_analysis` abort writes only stderr WARN — no `decision_log` entry → architect / build see `designSpecs=undefined` with no explanation | §2.3, L3 | log line 1729 (`materialCount=0 design_analysis: no visual input materialized — aborting before agent call`) | Abort path (`task-tools` design_analysis) bypasses `decision_log.append({phase: "design_analysis", ...})`. The phase exists structurally (audit §4 table) but has no writer for the abort case. | **Medium** — silent information loss across upstream→downstream seam. |
| **P5** | Bootstrap-first gate is **late rejection** rather than upstream constraint — orchestrator dispatches non-bootstrap goals in parallel intending "第一波并行构建", gate rejects each post-dispatch | §11.4 | log lines 7456, 7860 | `task-tools` build dispatch path enforces `pendingBootstrap` check after the orchestrator has already issued the dispatch. The constraint is not surfaced via `describe()` so the LLM cannot anticipate it. CLAUDE.md rule 13 ambiguity: late gate is closer to a hidden state machine than to LLM-driven flow. | **Medium** — wastes orchestrator turns; symptom of rule 13 violation. |

---

## 2. Fix specifications

### P0 — Populate `supersede_of` from `openGoalImplementationVersion().supersededTipID` in `beginBuildAttempt`

**Codex P1 reversed v2.** `supersede_of` is the **designed chain abstraction**, used by 10+ readers and a state-invariant test. v2's "kill the supersede_of filter" plan would delete a working abstraction. v3 fix: populate the column properly. Single source remains `supersede_of`.

**Files in scope (rule 35 grep — full coverage verified).**
- **Bug site:** `packages/opencorvus/src/engine/persist.ts:1410-1490` (`beginBuildAttempt`) — line 1448 hardcodes `supersede_of: null`; `openGoalImplementationVersion`'s return value (`supersededTipID`) is computed at `:617-666`/`:673-694` but never threaded.
- **Readers (must keep working — rule 35):**
  - `engine/store.ts:505-512` (`findLatestTipGoalRun`)
  - `engine/store.ts:122` (column type), `:1556`, `:1578` (writer field)
  - `engine/goal-status.ts:79-90` (`deriveGoalStatus` supersede chain)
  - `engine/describe.ts:165, 180` (workflow projection)
  - `engine/workflow.ts:411` (workflow goal-run filtering)
  - `workbench/board.ts:892-898` (`currentGoalRunFromRows` supersede filter)
  - `engine/persist.ts:345` (existing `supersede_of` consumer in `superseded` query)
  - `engine/persist.ts:484` (cleanup metric counter)
- **Tests (must continue to pass + extend):**
  - `test/engine/state-invariants.test.ts:82-123` (asserts `supersede_of` references exist, no dangling links)
  - `test/engine/start-new-attempt.test.ts:128, 164, 213, 230, 246, 253` (asserts `supersededTipID` returned)

**Fix (single-source, no fallback).**

In `engine/persist.ts:beginBuildAttempt`:
- Capture `openGoalImplementationVersion`'s return: `const version = openGoalImplementationVersion({ goal, reason: "build_retry", now })`. (Already there.)
- At line 1448 (`supersede_of: null`), replace with `supersede_of: version.supersededTipID ?? null`.
- That's it. Every reader already filters by this column correctly; the bug was the column staying `null` on retry.

**Why this is the right fix (rule 1 root cause).**
- `openGoalImplementationVersion:683` calls `supersedeGoalRun(oldGoalRunID, reason, now)` which patches the OLD row with `superseded_reason` + `superseded_at`. It then returns `{supersededTipID: tip.id}` — the OLD goal_run_id the new attempt is superseding.
- `beginBuildAttempt` ignores this return value's `supersededTipID` field. Threading it through completes the designed chain.
- After fix: NEW row has `supersede_of = OLD.id`. `findLatestTipGoalRun`'s loop collects `[OLD.id]` into supersededIDs, then `find` skips the OLD row, returns NEW. Derive returns `running`.
- Math.max bump at `appendGoalRunArtifact:565` stays — it serves intra-goal_run_id monotonicity, unrelated to tip selection now that the filter works.

**Rule 8 / rule 17 check (v3).**
- Single source: `supersede_of`. No `superseded_reason`-based parallel filter introduced (v2's mistake).
- No dead code added. The existing dead-by-data state of `supersede_of` (always null) becomes live-by-data once the writer is fixed.

**Tests (rule 28 / 36).**
1. Unit `packages/opencorvus/test/engine/begin-build-attempt-supersede.test.ts` (new):
   - Set up goal with one terminal `goal_run` (`status=failed`).
   - Call `beginBuildAttempt(...)`, assert the new row's `supersede_of === oldRun.id`.
   - Assert `findLatestTipGoalRun(goalID).id === newRun.id`.
   - Assert `deriveGoalStatus(goalID) === "running"`.
   - Negative (rule 36): on first-ever attempt (no prior tip), assert `supersede_of === null` and tip lookup returns the new running row.
2. Run existing `test/engine/state-invariants.test.ts` — assert it still passes (the new write satisfies the dangling-link invariant: `supersede_of` points at an existing logical goal_run id).
3. E2E `test/engine/retry-status-emission.e2e.test.ts`:
   - Force first attempt to fail. Drive retry. Assert `service=goal-status from=pending to=running reason=beginBuildAttempt` log line emits within 3s of the build tool re-invocation.

### P1 — Seal the latch BEFORE publishing in `SessionStatus.set` (close the re-entrancy hole)

**Codex P2 narrowed v2's three hypotheses to H1.** v2 carried three candidates (TOCTOU re-entrancy, multi-Instance state map, direct Bus.publish bypass). Codex pointed out the concrete shape: `SessionStatus.set` (`session/status.ts:77-114`) calls `Bus.publish` at line 98 BEFORE writing state at line 113. `Bus.dispatch` is synchronous, so a subscriber can re-enter `set()` before the latch is sealed. v3 commits to this as the verified root cause; the remaining hypotheses (H2 multi-Instance, H3 direct publish) become regression-test invariants enforced separately.

**Files in scope.**
- `packages/opencorvus/src/session/status.ts:77-114` (the `set()` function — fix site).
- `packages/opencorvus/src/bus/index.ts` (verify `Bus.publish` synchronous-dispatch contract).
- `packages/opencorvus/test/session/terminal-latch-reentrancy.test.ts` (new test).

**Fix (single-source, no parallel latch).**

In `session/status.ts:set`:
- **Move the state write BEFORE the publish.** Order becomes:
  1. Read latch at line 97 — if already terminal, return.
  2. Write state at (formerly line 113) — seals the latch *before* any subscriber runs.
  3. Publish at (formerly line 98) — subscribers run after the latch is sealed; any re-entrant `set()` call sees the sealed state.
- Same applies to the `idle` branch's `delete state()[sessionID]` ordering — but idle's semantics are different (re-entrant set after idle is allowed), so leave its ordering and only change the terminal path.

The terminal-keep behaviour (line 113 retains terminal in state) stays. The idle-delete behaviour stays. Only the publish/write order on terminal changes.

**Why this is the right fix (rule 1 root cause + rule 8 single source).**
- Single source: the existing latch at line 97. No new boolean, no DB column, no parallel structure.
- Re-entrancy hole closed: subscribers running synchronously inside `Bus.publish` see the sealed state when they call `set()` again.
- Rule 13: no state machine introduced. The fix is pure ordering of two existing operations.

**Tests (rule 28 / 36).**
1. Unit `test/session/terminal-latch-reentrancy.test.ts`:
   - Subscribe a synchronous handler to `Bus.subscribe(SessionStatus.Event.Status)` that re-enters `SessionStatus.set(sessionID, {type: "terminal", reason: "completed"})` when it sees a terminal status.
   - Call `SessionStatus.set(sessionID, {type: "terminal", reason: "aborted"})`.
   - Assert: exactly ONE Bus.publish observed (only the original `aborted`); the re-entrant `completed` is dropped by the now-sealed latch.
2. Static check (rule 35) `script/check/session-status-emit-discipline.ts`:
   - Greps `packages/opencorvus/src/**/*.ts` for `Bus.publish(SessionStatus.Event.Status` / `Bus.publish(.*session.status` outside `session/status.ts`. Asserts zero hits — closes H3 (direct publish bypass).
3. Existing `test/session/*` regressions stay green; the order change must not affect non-terminal transitions.

**Out of scope here (verified-not-needed by H1 confirmation).**
- H2 multi-Instance: the `lazyInstanceState` map IS per-Instance, but session lifecycles flow through one Instance context per session. No cross-Instance set() calls observed in the bench evidence. Tracking as defer-only.
- DB-persistent latch: out of scope; in-memory is correct because session lifecycle is process-bounded.

### P2 — Build-agent contract (opencode-only path): replace generic Error throw + bring `mergeBackBlockedReport` synthesis into typed-error regime

**Files in scope (rule 35 grep targets).**
- `packages/opencorvus/src/build/agent.ts:614-636` (opencode terminal-tool collector — terminal-report consumption + `mergeBackBlockedReport` synthesis + schema-rejection throw, all three in the same block)
- `packages/opencorvus/src/build/types.ts` (BuildResult schema, BuildAgentContractError new export)
- `packages/opencorvus/src/orchestrator/tools.ts:3950+` (build tool consumes the error and routes to `finalizeBuildAttempt`)
- `packages/opencorvus/src/executor/codex.ts`, `packages/opencorvus/src/executor/claude-code.ts` (host-synthesised BuildResult path — **NOT in scope of P2 contract enforcement**; verify the opencode-only branch is the right scoping)

**Verified state of code (v2).**
- Reviewer pass: the actual schema-rejection throw is at `agent.ts:633-636` AFTER the finally block (which ends at 612), not "in finally" as v1 claimed.
- Reviewer pass: the existing `mergeBackBlockedReport` synthesis at `agent.ts:614-630` constructs a fake-success-encoded-as-failed `parsed` value when the LLM breaks the merge_back contract — this IS a rule-7 fallback by the plan's own standard, parallel to the missing-terminal-report case.
- Codex pass: `BuildAgent.run` also serves `codex` and `claude-code` external executors; those paths host-synthesise a `BuildResult` AFTER the provider finishes, never relying on an in-session `report_build_result` tool call. P2 must NOT classify those as contract violations — the contract applies only to the opencode terminal-tool collector path.

**Fix.**

Introduce one typed error class for both branches:
```ts
// packages/opencorvus/src/build/types.ts
export class BuildAgentContractError extends Error {
  constructor(
    readonly code: "missing_terminal_report" | "merge_back_blocked",
    readonly diagnostics: { sessionID: string; lastMessageAt?: number; toolCallsObserved?: number; mergeBackError?: string },
    message: string,
  ) {
    super(message)
    this.name = "BuildAgentContractError"
  }
}
```

In `build/agent.ts` — **opencode terminal-tool collector path only** (verify by reading the executor branch above the throw site; the throw at `:633-636` lives inside the opencode collector):
- Replace the generic schema-rejection throw at `:633-636` with `throw new BuildAgentContractError("missing_terminal_report", {...}, "...")`.
- Replace the `mergeBackBlockedReport` synthesis at `:614-630` with `throw new BuildAgentContractError("merge_back_blocked", {...}, "...")`. **Delete the synthesis** (rule 17 — no parallel path).
- The old "synthesize a fake parsed object" code is removed entirely.

External executors (`codex` / `claude-code`) host-synthesised path: untouched. Those paths already produce a structured BuildResult from the provider response shape, so the contract violation surface does not apply.

In `orchestrator/tools.ts` (the `build` tool body, around `:3950+`):
- **Catch `BuildAgentContractError` SPECIFICALLY** before the generic catch.
- Call `finalizeBuildAttempt({ status: "failed", summary: \`build agent contract violation (${code}): ${message}\`, error: diagnostics })`.
- Write `decision_log phase="retry"` entry with `key="build_agent_contract_violation"` and `value` carrying diagnostics.
- **Return a `BuildResult { status: "failed", summary, worktree? }` directly to the orchestrator** — DO NOT rethrow. The orchestrator's tool result reads as a normal failed build (NOT the generic `build tool failed` error path).
- The generic catch (for non-typed errors — model unavailable, worktree creation failed) keeps its rethrow behaviour. Only the typed contract error short-circuits to a `failed` BuildResult.

**Rule 7 check (v4).**
- Both paths now throw the same typed error. No fallback (no fake result, no continue-on-error).
- Diagnostic context survives via the typed error and the decision_log entry; next attempt's prompt receives "Prior attempt failed: contract violation — code=…" verbatim.

**Tests (v3 — control-flow specified per codex P2 #1).**
1. Unit `packages/opencorvus/test/build/contract.test.ts` (new file):
   - Mock LLM stream that emits messages but never calls `report_build_result` → assert `BuildAgentContractError` thrown with `code="missing_terminal_report"`, diagnostics populated.
   - Mock LLM stream that calls `merge_back` followed by `report_build_result` with a result that fails the structured-output guard → assert `code="merge_back_blocked"`.
   - Negative case (rule 36): LLM emits a clean `report_build_result` → assert no error, normal `BuildResult` returned.
2. Integration `packages/opencorvus/test/orchestrator/build-contract-violation.test.ts`:
   - Drive the build tool past a contract-violating BuildAgent → assert:
     - `goal_run` row has `status=failed`
     - `decision_log` row exists with `phase="retry"` `key="build_agent_contract_violation"`
     - **The build tool returned a `BuildResult { status: "failed" }` object — orchestrator's tool result is a normal failure, NOT a tool error / NOT a Zod-rejection error / NOT a rethrown `BuildAgentContractError`** (codex P2 #1: assert the orchestrator does not see the generic `build tool failed` path).
   - Negative on the rethrow gap: configure a non-typed error (e.g. mock `BuildAgent.run` throwing a generic `Error("simulated infra failure")`) → assert that path DOES rethrow (the contract change must not weaken infrastructure-error visibility).

### P3 — Build-session permission policy: owned worktree allow, task-root escape deny

**Codex P1 + v4 close-out.** v2/v3 already corrected two design errors: no task-root allow, and injected rules must sit before user config because `PermissionNext.evaluate` uses `findLast`. The remaining P3-A question is now closed from bench evidence: the timeout was not missing legitimate worktree access. It was task-root escape.

**P3-A evidence and decision (v4).**
- `_session-r1-opencode.run-pre-fixes.out:17478-17481` shows `external_directory` evaluated for `${task_root}/*` while the effective ruleset already contained `${worktree}/**` allow.
- `_session-r1-opencode.run-pre-fixes.out:26523-26525` shows `bash` resolving an absolute task-root argument and then requesting `external_directory` for `${task_root}/*`.
- `tool/glob.ts:32-34` defaults to `Instance.directory`, but an explicit path can escape; `tool/bash.ts:133` defaults `workdir` to `Instance.directory`, while `bash.ts:181-213` extracts static path arguments and asks external-directory permission for paths outside `Instance.containsPath`.
- `build/agent.ts:499-504` starts build sessions with `sessionDirectory: worktreeDir`, so the owned scope is the build worktree. The observed task-root access is out-of-scope for a build session.

**Files in scope (rule 35 grep, v4).**
- `packages/opencorvus/src/permission/next.ts:319` — `findLast` evaluator.
- `packages/opencorvus/src/permission/next.ts` — `PermissionNext.merge` flattening behaviour.
- `packages/opencorvus/src/agent/agent.ts:75-90` and `packages/opencorvus/src/agent/agent.ts:524-535` — existing session ruleset injection.
- `packages/opencorvus/src/tool/glob.ts:32-34` and `packages/opencorvus/src/tool/bash.ts:133,181-213` — concrete escape paths to cover in tests.
- `packages/opencorvus/src/orchestrator/tools.ts:3870+` — build session ruleset composition site, where `${worktree}` and task root are both known.

**Fix (v4).**

When BuildAgent composes the session ruleset, inject one scoped build-session block before user config:
1. `external_directory deny "${taskRoot}/**"` for task-root and sibling-worktree escapes.
2. `external_directory allow "${worktree}/**"` after the task-root deny inside the same injected block so the owned worktree remains usable even when it is physically nested under `${taskRoot}/.opencorvus/worktrees/...`.
3. Optional opt-in rules for explicit scratch/cache paths declared via goal metadata, still before user config and never as a broad task-root allow.
4. User config rules remain later. Because `findLast` wins, an explicit operator deny inside the worktree still overrides the injected allow; an explicit operator allow can deliberately widen scope.

**Why deny instead of ask for task root.**
- `ask` is the bench failure mode: unattended permission waits burn the full timeout and mask the real build failure.
- Task-root and sibling-worktree reads are outside a build agent's owned scope. Immediate deny is the single-source policy; it lets the LLM correct to the worktree on the next turn without waiting 5 minutes.
- Unrelated paths outside task root remain `ask` unless user config explicitly allows or denies them.

**Rule 7 / 8 / isolation check (v4).**
- Not a fallback: one `PermissionNext` ruleset expresses both boundary deny and owned-worktree allow.
- Single source: no parallel permission evaluator, no hidden compatibility path.
- Worktree isolation: sibling worktree access is `deny`, not `allow` and not a hanging `ask`.
- User precedence: later user config still has the last word under `findLast`.

**Tests (v4).**
1. Unit `packages/opencorvus/test/permission/build-session.test.ts`:
   - Compose ruleset with task root `${T}` and worktree `${T}/.opencorvus/worktrees/goal-A`.
   - Request `${worktree}/file.ts` → assert `allow`.
   - User config has `external_directory: deny, pattern: "${worktree}/secret/**"`; request `${worktree}/secret/key` → assert `deny`.
   - Request `${T}/package.json` → assert `deny`, not `ask`.
   - Request `${T}/.opencorvus/worktrees/goal-B/file.ts` → assert `deny`, not `ask`.
   - Request `C:/Users/random-other-path/file` → assert `ask` unless user config says otherwise.
2. Tool integration `packages/opencorvus/test/tool/build-permission-boundary.test.ts`:
   - Build-session `glob({ pattern: "**/*" })` searches the worktree and creates no external-directory ask.
   - `glob({ pattern: "**/*", path: taskRoot })` denies immediately.
   - `bash({ command: "ls <taskRoot>", workdir: worktree })` denies immediately.
3. E2E `packages/opencorvus/test/build/permission-no-timeout.e2e.test.ts`:
   - Spawn build session against temp worktree; run a build touching only worktree paths → assert zero permission timeouts.
   - Negative case: attempted task-root access denies within 1 second and leaves no pending permission row.

### P4 — Decision-log writer for `design_analysis` AND `intent-analysis` aborts (rule 4 systemic)

**Files in scope (rule 35 grep targets).**
- `packages/opencorvus/src/orchestrator/tools.ts` — both `design_analysis` and `intent-analysis` (a.k.a. `analyze_intent`) tool bodies; abort paths
- `packages/opencorvus/src/decision-log/index.ts` (verify `phase="design_analysis"` and `phase="intent_analysis"` are accepted; if `phase` is a closed enum, extend it)
- `packages/opencorvus/src/prompt/upstream-context.ts` (must inject both phases into architect / build / orchestrator-wake prompts; if injection is keyed on a fixed phase list, extend it)

**Fix (v4 — bundled, rule 4 systemic).**

Both `design_analysis` and `intent-analysis` abort paths must write a `decision_log` entry on abort:

```
{ phase: "design_analysis" | "intent_analysis",
  goalID: undefined,                        // task-scoped
  key: "abort_<reason-class>",              // e.g. abort_no_visual_material, abort_url_render_timeout, abort_intent_unparseable
  value: "<concrete one-liner stating what was attempted and why it gave up>",
  reason: "<machine-classifiable reason: url_render_timeout | no_visual_material | …>" }
```

Verify reader side end-to-end:
- `decision-log/index.ts:phasePromptSection` must support both phases (audit §4 lists `design_analysis` as "writer site not located"; intent-analysis is missing entirely from §4 table).
- `prompt/upstream-context.ts` must include the two phases in its injection set so architect / build prompts say "Intent analysis aborted: …" or "Design analysis aborted: …" verbatim.

**Rule 1 / rule 4 check (v4).**
- Audit L3 (design abort) and L7 (intent abort) are the same architectural shape. Fixing only one is rule-4 patch-shape. v2 bundles both in one commit.
- Writer + reader symmetry verified before landing (rule 35).

**Tests.**
1. Unit `packages/opencorvus/test/decision-log/abort-writers.test.ts`:
   - Drive `design_analysis` with a URL that fails content_paint gate → assert decision_log row created with phase=`design_analysis`, reason class `url_render_timeout`.
   - Drive `intent_analysis` with an empty/unparseable request → assert phase=`intent_analysis` row with appropriate reason.
2. Integration `packages/opencorvus/test/prompt/abort-visibility.test.ts`:
   - After each abort kind, run architect agent prompt builder → assert the prompt contains the abort reason verbatim.
   - Negative case: when no abort happened, assert no spurious "aborted" text in the prompt.

### P5 — Bootstrap-first: keep the gate, add describe field, add physical-fact prompt (v3: contradiction resolved)

**Codex P1 #3 flagged v2 internal contradiction.** v2 revision-history said "gate stays as defense-in-depth" but v2 §body said "delete the late gate" and added a grep invariant that asserts the gate stays deleted. v3 picks ONE design: **the gate stays.** v2's deletion plan and the grep invariant are dropped from this section.

**Files in scope.**
- `packages/opencorvus/src/orchestrator/tools.ts:3760-3880` (`pendingBootstrap` gate STAYS; minor cleanup only — single clearer WARN)
- `packages/opencorvus/src/engine/describe.ts:60-243` (add `task.activeBootstrapGoalID: string | null`)
- `packages/opencorvus/src/orchestrator/agent.ts` (system prompt physical-fact paragraph)

**Fix (v3).**

1. **Add `task.activeBootstrapGoalID: string | null`** at `engine/describe.ts`: derived per-wake from goal set (one bootstrap goal not yet terminal → its ID; otherwise null). Single source at task level.

2. **Orchestrator prompt addition** (physical-fact framing including honest disclosure that the gate exists):
   > "Bootstrap goals own scaffold-level files (`package.json`, `vite.config.ts`/`bunfig.toml`, `tsconfig.json`, `src/main.*`, `src/App.*`). Every other goal in this task will need those files on its worktree. Dispatching bootstrap and non-bootstrap goals in parallel produces guaranteed merge conflicts at delivery time. When `task.activeBootstrapGoalID` is set, the dispatch tool will refuse non-bootstrap dispatches until the bootstrap goal completes. Plan accordingly."
   Disclosure of the gate (rule 15: not synthetic / not hidden).

3. **Gate at `orchestrator/tools.ts:3760-3880` stays as defense-in-depth.** Minor cleanup:
   - Single clear WARN log including dispatched goalID + active bootstrapID + the dispatch was blocked because of the bootstrap-first invariant.
   - Tool returns a structured error to the orchestrator LLM; the next turn can pick the bootstrap goal explicitly.
   - No deletion of the gate. v2 had an internal "delete + keep" contradiction; v3 picks "keep".

**Rule check (v3).**
- Rule 13: the gate is a single condition check, not a state machine.
- Rule 15: gate is disclosed in the prompt; not hidden / not synthetic.
- Rule 17: NO grep invariant for "gate stays deleted." The gate is part of the design.
- Rule 6 (LLM intelligence): the prompt now gives the LLM the constraint upfront so it picks bootstrap on first turn. Gate becomes safety net (rare path).

**Tests (v3 — codex-corrected: drop the "stay deleted" invariant).**
1. Unit `test/engine/describe-bootstrap-active.test.ts`:
   - Task with bootstrap+4 features, bootstrap.status="running" → assert `task.activeBootstrapGoalID === bootstrap.id`.
   - Bootstrap completes → assert `null`.
   - No bootstrap goal in set → assert `null`.
2. E2E `test/orchestrator/bootstrap-serial-dispatch.e2e.test.ts`:
   - Orchestrator on bootstrap+features task: assert first-turn `build` is called with `goalID=bootstrap` (LLM-driven, externally-observable).
3. Gate-still-works regression `test/orchestrator/bootstrap-gate-defense.test.ts`:
   - Direct `build` tool call with a feature goalID while bootstrap is running → assert the tool returns the gate error with the disclosed message; the gate IS still there.
4. Bench-evidence regression: zero `bootstrap-first gate rejected non-bootstrap dispatch` WARN lines on a normal bench run *because* the LLM read the prompt and chose serial dispatch — this validates the prompt is effective. If WARN appears, the gate saved us, and the prompt needs tightening.

---

## 3. Order of operations

P0 must land first because later retry tests depend on `beginBuildAttempt` producing a visible supersede chain. Then P1 seals terminal-event re-entry before contract-violation tests assert exactly one terminal outcome. Then P3 lands before P2 integration work so permission timeouts cannot mask the build-agent contract failure. Then P2, P4, and P5.

```
P0 → P1 → P3 → P2 → P4 → P5
```

Each lands as its own commit:
- `fix(engine): thread supersede chain on build retry (P0)`
- `fix(session): seal terminal latch before publish (P1)`
- `fix(permission): deny task-root escape and allow owned worktree (P3)`
- `fix(build): surface missing terminal report as contract violation (P2)`
- `fix(orchestrator): write decision_log on stage aborts (P4)`
- `fix(orchestrator): surface bootstrap gate before dispatch (P5)`

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
   - **P3**: zero `permission timeout rejected` lines; if task-root or sibling-worktree access is attempted, it denies immediately (target <1s) and leaves no pending permission row.
   - **P4**: when `design_analysis` or `intent_analysis` aborts, the decision_log table contains the matching phase entry; the next architect/build prompt contains the concrete abort reason verbatim.
   - **P5**: zero `bootstrap-first gate rejected non-bootstrap dispatch` WARN lines on a normal bench run because the LLM serializes bootstrap first; direct gate regression still returns the disclosed structured error.

Bench must reach `qualityVerdict: accepted` (or produce a clean rejection trace if real quality fails) with all six markers in place. CLAUDE.md rule 24 — even on accept, run a manual second review.

---

## 5. Review decisions now closed

1. **P0 query change scope** — no query change. Keep `latestPerGoalRun`, `findLatestTipGoalRun`, and existing `supersede_of` readers; fix the writer by threading `openGoalImplementationVersion().supersededTipID` into `beginBuildAttempt`.
2. **P1 terminal latch placement** — keep the latch in-memory for this round and seal state before publish. A DB-level terminal-emission column is deferred unless restart-time duplicate terminal events are reproduced.
3. **P2 contract violation handling** — `BuildAgentContractError` counts as a normal failed build attempt under the existing retry budget. Add a separate contract-violation budget only if repeated contract violations still loop after P2.
4. **P3 permission scope** — owned worktree is the build-session boundary. Task-root and sibling-worktree escapes deny immediately; no task-root allow.
5. **P5 prompt phrasing** — use the physical-fact prompt from §P5 and disclose the gate. No hidden "dispatch only" instruction and no runtime-only refusal claim without prompt disclosure.
6. **Test infrastructure** — add narrow helpers only if existing tmpdir/worktree fixtures create duplication. Fixture extraction is not a blocker for the six commits.
7. **Bench reset mechanics** — run a fresh bench only. Delete `packages/opencorvus/script/benchmark/runs/` outputs and benchmark scratch DB/temp dirs after verifying absolute paths under benchmark-owned directories; do not use `--resume-task-id`.

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
8. Are the closed decisions in §5 reflected in P0-P5 and the implementation order?
9. Is the validation bench in §4 sufficient to declare done, or does it need extra fixtures?

If any check fails, reject the plan and request revision before any code change.
