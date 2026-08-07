# Remove Subagent Stale Recovery

Date: 2026-06-30

DB means Database. A2A means Agent-to-Agent coordination.

## Recall

- User request: fix the failure where TradingView indices clone goals G27 and
  G28 were marked failed before the task was cancelled. The user challenged the
  "stale" judgment as unnecessary and asked to remove the useless logic.
- Acceptance criteria:
  - Missing root build tool ownership must not be treated as evidence that a
    child build session is stale or safe to cancel.
  - `cancel_subagent` must not expose a stale-recovery path for orchestrator
    guessing. A live build `goal_run` without live root ownership remains
    running and must wait for durable terminal/refill/session evidence or
    explicit task-level cancellation.
  - A2A cancellation requests remain bound to
    `respond_agent_coordination(decision="cancel_worker")` and must not be
    bypassed through `cancel_subagent`.
  - The fix must include focused regression tests and prompt/schema hygiene
    updates so the broken path cannot reappear as a tool option.
- Hard constraints:
  - No fallback, retry loop, route bypass, or state-machine workaround.
  - Do not add keyword matching against cancellation reasons.
  - Do not restart, kill, refresh, or otherwise disturb the user's running
    OpenCorvus or overlay process.
  - Do not use git reset and do not create a new git worktree.
  - Preserve existing dirty worktree changes; only patch the scoped files.
- Disk records read before implementation:
  - `specs/README.md`
  - `specs/current/architecture/99-principles.md`
  - `specs/records/2026-06/README.md`
  - `specs/records/2026-06/2026-06-30-goal-mutation-running-session-activity-boundary.md`
  - `specs/records/2026-06/2026-06-30-worktree-cleanup-process-quiescence.md`
  - `packages/opencorvus/src/orchestrator/tools.ts`
  - `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
  - `packages/opencorvus/test/orchestrator/tools.test.ts`
  - `packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts`
  - `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`
  - `packages/opencorvus/test/agent/orchestrator-stale-recovery-prompt.test.ts`
- Runtime evidence from task `tsk_f17e432c2001tH12z7TjZFKf7M`:
  - G27 `gol_f19450e76001FLyGAWFz63HZuv` and G28
    `gol_f1945167c001lnu9loXMJxfRMo` were created at `2026-06-30 16:03:03Z`
    and `16:03:05Z`.
  - Their build tool calls returned "Build agent started" and opened
    `goal_run` ids `26f61d8d` and `324e2d71`, then retry ids `792055fe` and
    `7d945ccd`.
  - `orchestrator_tool_ownership` terminal rows were written milliseconds after
    dispatch because the dispatch tool ended, while the child build sessions
    continued writing messages and reading evidence files.
  - `recover_stale` correctly refused the first no-owner live goal-run case,
    but the orchestrator then called explicit `cancel_subagent`, aborting the
    running G27/G28 attempts.
  - Both worktrees stayed clean at base commit `ed05a2b`; no component files,
    commits, or changed files were produced before cancellation.
- Whole-repository grep evidence:
  - `cancel_subagent` tool schema and execution live in
    `packages/opencorvus/src/orchestrator/tools.ts`.
  - `recover_stale` appears in `orchestrator-core.txt`,
    `tools.ts`, `tools.test.ts`, `orchestrator-tool-descriptions.test.ts`,
    `core-prompt-hygiene.test.ts`, and
    `orchestrator-stale-recovery-prompt.test.ts`.
  - `cancelLiveOwnedBuild` is the only live-ownership cancellation helper in
    `tools.ts`; it is valid only when a live ownership artifact exists.
  - `resolveSubagentControlTarget` currently allows `goal_run_id` and
    `session_id` paths that bypass the stricter `goal_id` live-owner/active
    session guard.
  - Existing prompt lines already say a started build is live session evidence
    and terminal refill should wake future decisions; stale recovery contradicts
    that model.
- Independent agent feedback: no sub-agent was spawned because the currently
  available sub-agent tool explicitly says not to spawn unless the user
  explicitly requests delegation or parallel agent work. The local DB and code
  evidence is sufficient for this scoped repair.

## Root Cause

The build tool is asynchronous. Root `orchestrator_tool_ownership` describes
the dispatch tool call, not the child build lifecycle. When the dispatch tool
returns "started", that ownership closes immediately by design. The child build
session remains live through durable `goal_run`, session, message, part, and
terminal refill facts.

The stale-recovery path gave the orchestrator an invalid inference target:
"live goal_run with no root build ownership" looked like a recoverable stale
worker, even though the tool itself already knew that root ownership does not
prove child lifecycle. The model then bypassed the `recover_stale` refusal by
calling explicit `cancel_subagent`.

## Decision

Remove stale recovery from the orchestrator control surface.

`cancel_subagent` remains a cancellation tool, but for build-like roles that
use live orchestrator tool ownership control it may mutate state only when a
live ownership artifact exists. If the target `goal_run` is still live and
there is no live ownership artifact, the tool returns a refusal and leaves the
run untouched. That turns the G27/G28 failure mode into a visible non-mutating
error instead of an abort.

This is not a fallback and not a gate for normal progress. It removes an
invalid control source and makes destructive cancellation depend on the single
live ownership fact that the cancellation helper actually owns.

## Call Point Decisions

| Area | Decision |
| --- | --- |
| `orchestrator/tools.ts::cancel_subagent` schema | Delete `mode` and the `recover_stale` option. |
| `orchestrator/tools.ts::cancel_subagent` execution | For live-ownership-control roles with no live ownership, refuse and do not call `abortGoalRunExecution`. |
| `orchestrator/tools.ts::resolveSubagentControlTarget` | Remove stale-finalization language from errors. |
| `orchestrator-core.txt` | Replace stale recovery guidance with "do not infer stale; park the wake; cancel only from explicit cancellation evidence." |
| `tools.test.ts` | Replace stale-recovery tests with non-mutating no-owner live-run regressions and update schema expectations. |
| Prompt hygiene tests | Assert that `recover_stale` is absent and that missing ownership is not cancellation evidence. |

## Validation Follow-Up

Running the complete orchestrator tool test file exposed an unrelated but local
stage failure boundary: `frontend_research` could receive an
`onSessionCreated` id before the child session row existed, then crash while
writing `SessionStatus`. The correct repair is not to make `SessionStatus`
tolerate missing rows. Stage dispatchers now mark terminal failure only for
persisted child sessions; a pre-persistence startup failure still returns the
visible failure card and does not fabricate lifecycle state.

A full `tools.test.ts` run still exposed an order-dependent DB WAL cleanup
lock in the unrelated `respond_agent_coordination continue` group after the
targeted stale and `frontend_research` regressions passed. The same failing
continue case passes in isolation, so that remaining failure is a separate
test resource-lifecycle issue and not evidence that stale cancellation remains.

## Validation Plan

- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "cancel_subagent"`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "frontend_research"`
- `bun test packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts`
- `bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`
- `bun test packages/opencorvus/test/agent/orchestrator-stale-recovery-prompt.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`
