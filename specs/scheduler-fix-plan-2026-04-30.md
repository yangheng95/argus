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
- After v2, plan re-submits for second-pass review. No code change until v2 review approves.

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
| **P0** | Retry attempt's `goal_run` row exists but is invisible to `deriveGoalStatus` — goal stays at `pending` while build is actually running | §11.6, L8 | log line 19356 vs missing `from=pending to=running reason=beginBuildAttempt` for `gol_*0001` after retry | **Verified mechanism (v2):** `listGoalRunsByGoal` orders by `time_created DESC` (`engine/store.ts:493`) and returns artifact rows. `appendGoalRunArtifact` writes the supersede patch as a NEW artifact row whose `time_created = Math.max(existing.time_updated+1, now)` (`engine/persist.ts:565, 581-587`), so the patched-old artifact lands AFTER the new running row's `time_created = now`. `findLatestTipGoalRun` (`store.ts:505-512`) further filters by `supersede_of` set-membership, but **no writer populates `supersede_of`** (`persist.ts:1448` writes `null`; only `superseded_reason` is patched), so this filter is dead and `find` returns the first row by time_created — i.e. the patched-old row. Result: derive sees the OLD row's now-`pending` projection forever. | **High** — every retry hides progress; orchestrator may double-dispatch or miscount budget. |
| **P1** | Same session emits two contradictory terminal events (`reason=aborted` then `reason=completed`) on cancel-during-finish | §11.3 | log lines 19182-19183 | The session cancel path and the agent-runner natural-finish finally block are independent emit sites. No single-emit latch on the session. | **Medium** — overlay UI / consumers may act on the wrong terminal. |
| **P2** | Build agent terminal report missing → orchestrator only sees Zod schema rejection of `undefined`; agent's actual progress invisible | §11.1, L1 | log line 19180 (`Invalid input: expected object, received undefined`) | When LLM session is cancelled before calling `report_build_result`, BuildAgent.run finishes with `hasStructured=false`. The `build` tool then validates `undefined` against `BuildResultSchema`, throws, and the orchestrator only sees `build tool failed`. There is no contract enforcement at the protocol layer. | **Medium-high** — masks agent failure mode and prevents rule 1 root-cause analysis. |
| **P3** | Permission `external_directory` for the bench project root times out at 5 min, cancelling the build session | §11.2, memory `feedback_goal_permission_hang.md` | log line 19171 (`permission=external_directory patterns=["…UkylGI/*"] permission timeout rejected`) | Build session inherits default `ask` policy; auto-permission rules don't auto-allow the session's own worktree / project-root paths. | **Medium-high** — first build attempt always burns 5 minutes. |
| **P4** | `design_analysis` abort writes only stderr WARN — no `decision_log` entry → architect / build see `designSpecs=undefined` with no explanation | §2.3, L3 | log line 1729 (`materialCount=0 design_analysis: no visual input materialized — aborting before agent call`) | Abort path (`task-tools` design_analysis) bypasses `decision_log.append({phase: "design_analysis", ...})`. The phase exists structurally (audit §4 table) but has no writer for the abort case. | **Medium** — silent information loss across upstream→downstream seam. |
| **P5** | Bootstrap-first gate is **late rejection** rather than upstream constraint — orchestrator dispatches non-bootstrap goals in parallel intending "第一波并行构建", gate rejects each post-dispatch | §11.4 | log lines 7456, 7860 | `task-tools` build dispatch path enforces `pendingBootstrap` check after the orchestrator has already issued the dispatch. The constraint is not surfaced via `describe()` so the LLM cannot anticipate it. CLAUDE.md rule 13 ambiguity: late gate is closer to a hidden state machine than to LLM-driven flow. | **Medium** — wastes orchestrator turns; symptom of rule 13 violation. |

---

## 2. Fix specifications

### P0 — Tip-selection: kill dead `supersede_of` filter, use `superseded_reason`

**Files in scope (rule 35 grep targets).**
- `packages/opencorvus/src/engine/store.ts:482-512` (`listGoalRunsByGoal`, `findLatestTipGoalRun`)
- `packages/opencorvus/src/engine/store.ts` `latestPerGoalRun` (full grep — also called from `listGoalRunsForRun`, `listGoalRunsForTask`)
- `packages/opencorvus/src/engine/goal-status.ts:74-117` (`deriveGoalStatus` — also filters by `supersede_of`, same dead path)
- `packages/opencorvus/src/engine/persist.ts:506-528` (`supersedeGoalRun`), `:559-590` (`appendGoalRunArtifact`), `:1410-1490` (`beginBuildAttempt`)
- `packages/opencorvus/src/engine/describe.ts:tipFromChain` (around line 177-184 per reviewer — verify is parallel impl of same logic = rule 8 risk)

**Verified state of the code (v2, after reviewer pass).**
- `listGoalRunsByGoal` issues `SELECT … ORDER BY time_created DESC` then runs `latestPerGoalRun` JS aggregator.
- `findLatestTipGoalRun` collects `supersede_of` strings from the rows, then returns first row whose `id` ∉ that set.
- The `supersede_of` column is **never populated by current writers** — `beginBuildAttempt:1448` writes `null`, and `appendGoalRunArtifact` patches only `superseded_reason` / `superseded_at`. The filter set is therefore always empty in practice; `find` returns the first by `time_created DESC`, which after the patch's bumped `time_created` is the OLD superseded row.
- Same dead filter at `goal-status.ts:79` (verified by reviewer).

**Fix (single-source, no fallback, kills dead path).**

1. **`findLatestTipGoalRun`** — replace the `supersede_of`-set filter with `superseded_reason IS NULL` predicate at the JS layer. Concrete:
   ```ts
   export function findLatestTipGoalRun(goalID: string): GoalRunRow | undefined {
     const rows = listGoalRunsByGoal(goalID)
     return rows.find((r) => !r.superseded_reason)
   }
   ```
   `listGoalRunsByGoal` already orders by `time_created DESC`. The first row whose `superseded_reason` is null is the live tip.

2. **`deriveGoalStatus`** — apply the same predicate change at `goal-status.ts:79` (kills the parallel dead filter, rule 8 + rule 17).

3. **`engine/describe.ts:tipFromChain`** (verify reviewer's claim about parallel implementation) — if it duplicates the tip-selection logic, replace the duplication with a call to `findLatestTipGoalRun` (rule 9 — extract pattern).

4. **DO NOT remove the `Math.max` bump in `appendGoalRunArtifact:565`.** Reviewer Finding B: the bump guarantees monotonic ordering across multiple appends to the same `goal_run_id` (rapid patch sequences). After this fix, the cross-`goal_run_id` tip selection is correct regardless of the bump, so the bump's purpose is preserved cleanly within one logical goal_run. Removing it would risk nondeterministic SQLite ordering on equal-ms appends.

**Rule 8 / rule 17 check (v2).**
- The dead `supersede_of`-set filter is removed at both `findLatestTipGoalRun` AND `deriveGoalStatus`. Single predicate (`superseded_reason IS NULL`) at both. Single source.
- `appendGoalRunArtifact`'s `Math.max` bump kept for its documented purpose. Not a fallback — it serves a different invariant (intra-goal_run monotonicity).

**Tests (rule 28 / 36).**
1. Unit `packages/opencorvus/test/engine/goal-tip-selection.test.ts` (new file):
   - Build a goal with: one OLD goal_run (`status=failed`, `superseded_reason="build_retry"`, post-patch `time_created=T+5`), one NEW goal_run (`status=running`, `time_created=T+3`, `superseded_reason=null`).
   - Assert `findLatestTipGoalRun(goalID).id === NEW.id`.
   - Assert `deriveGoalStatus(goalID) === "running"`.
   - Negative case (rule 36): with NO running attempt opened, assert `deriveGoalStatus(goalID) === "pending"` (the supersede projection still holds).
2. E2E in `packages/opencorvus/test/engine/retry-status-emission.e2e.test.ts`:
   - Spawn in-process bench, force first build attempt to fail (mock `BuildAgent.run` to return `{status: "failed"}`).
   - Drive the orchestrator's retry call, assert `service=goal-status from=pending to=running reason=beginBuildAttempt` log line emits within 3s.

### P1 — Investigate why the existing terminal latch fails (then fix that)

**v1 was rejected.** Reviewer surfaced that the latch v1 proposed already exists at `session/status.ts:77-114` (verified by direct read). The `if (state()[sessionID]?.type === "terminal") return` guard at line 97 is exactly "first terminal wins"; the comment block at 78-96 even cites the prior aborted+completed double-fire. v1 would have created a parallel latch (rule 8 violation) without fixing why the existing one fails.

**Pre-fix investigation required.** The bench evidence (lines 19182-19183 — same sessionID, two terminal emits) means the existing latch at `status.ts:97` was bypassed. Three hypotheses, all to be checked before any code change:

**H1 — TOCTOU between read at `status.ts:97` and write at `status.ts:113`.** Two concurrent `set(sessionID, …)` calls could both pass the check before either writes. JS is single-threaded but `Bus.publish` (line 98) may be sync but launches subscribers as Promises; if a subscriber synchronously calls back into `set(...)` (re-entrancy), the inner call sees state still un-written. **Verify by:** instrumenting `set()` to log the read/write ordering during the actual bench reproduction; static-grep `Bus.subscribe` handlers that touch sessions.

**H2 — Multi-Instance state map.** `lazyInstanceState` at `status.ts:60` keys on the current `Instance` (i.e. `Instance.directory`). Build sessions live in per-goal worktree paths; orchestrator sessions live at the project root. If `set(sessionID, …)` is reached from two different `Instance` contexts, each has its own `state()` map and the latch in each passes independently. **Verify by:** logging `Instance.directory` at every `set()` call for the failing sessionID; checking whether the build session is created under a different `Instance.provide(...)` boundary than the orchestrator's emit path.

**H3 — Direct `Bus.publish(SessionStatus.Event.Status, ...)` bypassing `set()`.** Anywhere that calls `Bus.publish` for the Status event without going through `SessionStatus.set` skips the latch entirely. **Verify by:** `grep -rn "Bus.publish.*Event.Status\|publish.*session.status" packages/opencorvus/src` and reviewing every hit.

**Fix scope decided AFTER hypothesis is confirmed.** Likely outcomes:
- H1 (re-entrancy): swap order at `status.ts:97-113` so the state write happens BEFORE the publish, or wrap in an atomic-update. Single-source change, no parallel latch added.
- H2 (multi-Instance): trace and unify the Instance boundary for session lifecycle events; the `state()` map needs to be process-wide for terminal latches, not per-Instance. Replace `lazyInstanceState` for THIS use with a process-singleton (rule 8 — single source of session terminal authority).
- H3 (direct publish): refactor the offending callers to go through `SessionStatus.set`. Delete the bypass (rule 17).

**Rule check (v2).**
- Rule 1: root cause first, no patches over symptoms.
- Rule 8: outcome is one latch (the existing one fixed), not two.
- Rule 17: any dead/parallel emit path discovered in H3 is deleted.

**Tests (rule 28 / 36).**
1. The hypothesis confirmation itself produces a regression test: whichever H is the cause, the test reproduces the cancel-during-finish race and asserts exactly one `SessionStatus.Event.Status` Bus event with `type=terminal` per session.
2. If H2: cross-Instance test — emit terminal from two different `Instance` contexts for the same sessionID, assert the second is dropped.
3. If H3: lint / negative test asserting no direct `Bus.publish(Event.Status, ...)` calls outside `SessionStatus.set` (a small `bun run script/check/...` invariant).

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

In `orchestrator/tools.ts`:
- The build tool catches `BuildAgentContractError`, calls `finalizeBuildAttempt({ status: "failed", summary: \`build agent contract violation (${code}): ${message}\`, error: diagnostics })`, then writes a `decision_log phase="retry"` entry with `key="build_agent_contract_violation"` and `value` carrying the diagnostics. Orchestrator sees a normal failed attempt; retry budget applies.

**Rule 7 check (v2).**
- Both paths now throw the same typed error. No fallback (no fake result, no continue-on-error).
- Diagnostic context survives via the typed error and the decision_log entry; next attempt's prompt receives "Prior attempt failed: contract violation — code=…" verbatim.

**Tests.**
1. Unit `packages/opencorvus/test/build/contract.test.ts` (new file):
   - Mock LLM stream that emits messages but never calls `report_build_result` → assert `BuildAgentContractError` thrown with `code="missing_terminal_report"`, diagnostics populated.
   - Mock LLM stream that calls `merge_back` followed by `report_build_result` with a result that fails the structured-output guard → assert `code="merge_back_blocked"`.
   - Negative case (rule 36): LLM emits a clean `report_build_result` → assert no error, normal `BuildResult` returned.
2. Integration `packages/opencorvus/test/orchestrator/build-contract-violation.test.ts`:
   - Drive the build tool past a contract-violating BuildAgent → assert `goal_run` row has `status=failed`, `decision_log` row exists with `phase="retry"` `key="build_agent_contract_violation"`.

### P3 — Worktree-path + project-directory as primary allow-rules for build session

**Files in scope (rule 35 grep targets, refined v2).**
- `packages/opencorvus/src/permission/next.ts` (`PermissionNext.fromConfig`, `findLast` evaluator at line ~319)
- `packages/opencorvus/src/agent/agent.ts:75-90` (existing whitelist includes `Instance.directory/**` — the gap is the bench project root is OUTSIDE Instance.directory)
- `packages/opencorvus/src/agent/agent.ts:524-535` (existing injection logic: when user config has no explicit `external_directory` rule, injects a default `external_directory: { GLOB: "allow" }` — must thread through, not duplicate)
- `packages/opencorvus/src/orchestrator/tools.ts:3870+` (where build session ruleset is composed and worktree path becomes available)

**Verified state (v2).**
- Reviewer pass: `agent/agent.ts:86-89` already whitelists `Instance.directory/**`. Bench project root `…/UkylGI/` is NOT under that — it's the per-task primary directory and lives separately.
- Reviewer pass: `findLast`-wins evaluator means new allow rules MUST come AFTER any default `ask` rule.
- Reviewer pass: the `agent/agent.ts:524-535` special injection MUST be the threading point, not a sibling site.

**Fix (v2 — codex feedback applied: per-goal-worktree only, no shared root).**

Codex reviewer flagged: auto-allowing the project/task primary root opens `../../sibling-worktree/…` paths, breaking worktree isolation between goals. v2 narrows to the **current goal's worktree path only**, plus an opt-in list of explicit scratch/cache paths the goal declared.

When BuildAgent composes the session ruleset:
1. Always include an `external_directory: allow` rule for the **current goal's worktree absolute path with trailing `/**`** only (`${worktree}/**`).
2. Optional: include allow rules for explicit scratch/cache paths the goal declared (e.g. `node_modules` cache directory if explicitly configured). These come from goal metadata, NOT from a shared root.
3. **Do NOT auto-allow the task primary directory or any parent of multiple worktrees.** Sibling worktree access stays in `ask` territory (which is correct: a goal's build agent has no business touching another goal's worktree).

Rules are appended AFTER user config rules (so `findLast`-wins respects explicit overrides) but BEFORE the default `ask` so in-scope paths resolve immediately. Threading: the injection happens at the same site as the existing `agent/agent.ts:524-535` block — that block is extended to emit ONLY the current worktree allow pattern when available from agent input.

**Rule 7 / 8 / isolation check.**
- Not a fallback: a positive `allow` rule at a more specific pattern; `findLast`-wins picks it for paths under the worktree.
- Single source: the new rule lives in the same `PermissionNext` ruleset; no parallel engine.
- Worktree isolation preserved: per-goal worktrees do not see each other; cross-worktree access falls back to `ask` (operator-gated).
- Threads through existing injection logic (rule 11 abstraction).

**Tests.**
1. Unit `packages/opencorvus/test/permission/build-session.test.ts`:
   - Compose a build-session ruleset with worktree `${A}`. Simulate request for `${A}/file.ts` → assert immediate `allow`.
   - Simulate request for `${A}/../sibling-B/file.ts` (sibling worktree) → assert `ask` (isolation preserved).
   - Simulate request for `${A}/../../task-root/scratch/file` (parent task root) → assert `ask` (isolation preserved).
   - Simulate request for `C:/Users/random-other-path/file` → assert `ask`.
2. E2E `packages/opencorvus/test/build/permission-no-timeout.e2e.test.ts`:
   - Spawn an in-process build session against a temp worktree; run a 60-second build that only touches files inside the worktree → assert zero permission timeouts.
   - Negative E2E: run a build that tries to access a sibling worktree path → assert the request hits `ask` (not `allow`); operator-side no-op approver lets it through, but the audit trail records the cross-worktree attempt.

### P4 — Decision-log writer for `design_analysis` AND `intent-analysis` aborts (rule 4 systemic)

**Files in scope (rule 35 grep targets).**
- `packages/opencorvus/src/orchestrator/tools.ts` — both `design_analysis` and `intent-analysis` (a.k.a. `analyze_intent`) tool bodies; abort paths
- `packages/opencorvus/src/decision-log/index.ts` (verify `phase="design_analysis"` and `phase="intent_analysis"` are accepted; if `phase` is a closed enum, extend it)
- `packages/opencorvus/src/prompt/upstream-context.ts` (must inject both phases into architect / build / orchestrator-wake prompts; if injection is keyed on a fixed phase list, extend it)

**Fix (v2 — bundled, rule 4 systemic).**

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

**Rule 1 / rule 4 check (v2).**
- Audit L3 (design abort) and L7 (intent abort) are the same architectural shape. Fixing only one is rule-4 patch-shape. v2 bundles both in one commit.
- Writer + reader symmetry verified before landing (rule 35).

**Tests.**
1. Unit `packages/opencorvus/test/decision-log/abort-writers.test.ts`:
   - Drive `design_analysis` with a URL that fails content_paint gate → assert decision_log row created with phase=`design_analysis`, reason class `url_render_timeout`.
   - Drive `intent_analysis` with an empty/unparseable request → assert phase=`intent_analysis` row with appropriate reason.
2. Integration `packages/opencorvus/test/prompt/abort-visibility.test.ts`:
   - After each abort kind, run architect agent prompt builder → assert the prompt contains the abort reason verbatim.
   - Negative case: when no abort happened, assert no spurious "aborted" text in the prompt.

### P5 — Bootstrap-first: describe-time annotation + physical-fact prompt as primary, gate retained as defense-in-depth (v2 codex-folded)

**Codex reviewer flagged (correctly):** v1's "remove the gate entirely" leaves the LLM mistake unblocked. The bench evidence shows the LLM already attempted non-bootstrap dispatch while bootstrap was running. Removing the gate without proving the LLM will respect the constraint is unsafe. v2 keeps the gate as a final safety net but moves the primary signal upstream so the LLM doesn't reach the gate in the normal case.

**Files in scope.**
- `packages/opencorvus/src/orchestrator/tools.ts:3760-3880` (`pendingBootstrap` gate stays; cleanup of redundant log lines + clearer error message)
- `packages/opencorvus/src/engine/describe.ts:60-243` (add `task.activeBootstrapGoalID: string | null`)
- `packages/opencorvus/src/orchestrator/agent.ts` (system prompt physical-fact paragraph)

**Fix (v2).**

1. **Add `task.activeBootstrapGoalID`** at `engine/describe.ts`: derived per-wake from goal set. Single source at the task level (avoids the per-goal naming concern reviewer Q5b raised).

2. **Orchestrator prompt addition** (physical-fact framing — no directive):
   > "Bootstrap goals own scaffold-level files (`package.json`, `vite.config.ts`/`bunfig.toml`, `tsconfig.json`, `src/main.*`, `src/App.*`). Every other goal in this task will need those files on its worktree. Dispatching bootstrap and non-bootstrap goals in parallel produces guaranteed merge conflicts on those files at delivery time. When `task.activeBootstrapGoalID` is set, the bootstrap goal must complete first; the dispatch tool will refuse non-bootstrap dispatches in this state."
   The last clause is honest disclosure: the gate exists. The LLM can decide to wait.

3. **Gate stays at `orchestrator/tools.ts:3760-3880`** but cleaned up:
   - Single-line WARN with the dispatched goalID + pending bootstrapID, distinguishing "LLM ignored the constraint" from "the constraint exists." (Rule 1 visibility.)
   - No silent passthrough; no synthesised result; tool returns a clear error to the orchestrator LLM so the next turn can choose another goal.
   - Rule 17 cleanup of the previous duplicated log/return paths within the gate (if any).

**Rule 13 / rule 17 check (v2 codex-folded).**
- Late gate retained as defense-in-depth — codex correctly argued this against pure rule 17 application. The cost-benefit: removing the gate to satisfy rule 17 risks LLM mistakes producing merge conflicts at delivery time (a worse failure mode). The gate is a single check (not a state machine), and its presence is now disclosed in the prompt (rule 15: not synthetic / not hidden).
- Rule 13: a single bool/null check is not a state machine. The gate's role is constrained to rejecting the dispatch and returning an LLM-readable error.

**Tests (v2).**
1. Unit `packages/opencorvus/test/engine/describe-bootstrap-active.test.ts`:
   - Task with bootstrap+4 features, bootstrap.status="running" → assert `task.activeBootstrapGoalID === bootstrap.id`.
   - Bootstrap completes → assert `null`.
   - No bootstrap goal in set → assert `null`.
2. E2E `packages/opencorvus/test/orchestrator/bootstrap-serial-dispatch.e2e.test.ts`:
   - Orchestrator on bootstrap+features task: assert first-turn `build` is called with `goalID=bootstrap`. Externally-observable contract.
3. Gate-still-works regression test `packages/opencorvus/test/orchestrator/bootstrap-gate-defense.test.ts`:
   - Direct `build` tool call with a feature goalID while bootstrap is running → assert the tool returns the gate error with the disclosed message.
4. Bench-evidence regression: zero `bootstrap-first gate rejected non-bootstrap dispatch` lines on a normal bench run (LLM follows the constraint). If the line appears, it's diagnostic of the LLM ignoring the prompt — flag for prompt revision, but the gate still saved us.

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
