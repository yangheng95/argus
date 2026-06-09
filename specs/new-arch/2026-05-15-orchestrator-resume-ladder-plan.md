# 2026-05-15 Orchestrator Resume Ladder Plan

## Problem

When a workflow is resumed and the blocker is a stalled child agent, the orchestrator
must prefer the narrowest recovery that preserves the current contract. Recent traces
showed premature escalation to contract/workflow rewrites even when the right move was
"contact the child" or "kill the wedged child and re-dispatch the same goal".

The fix should stay semantic and local:

- expose the missing child-cancel operation
- make that operation retire the live `goal_run`
- keep prompt changes minimal instead of introducing a new scripted ladder

## Call-Site Inventory

### Prompt / policy surfaces

| Surface                                                                 | Role                                                 | Decision                                                                                                     |
| ----------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt`             | Orchestrator system policy                           | Keep the change to one short sentence near operator controls; do not add a standalone resume ladder section. |
| `packages/opencorvus/test/agent/orchestrator-core-grain-ladder.test.ts` | Existing per-goal vs task-wide retry ladder coverage | Keep unchanged; child-session recovery should not create a second large prompt policy block.                 |

### Tool exposure / runtime

| Surface                                         | Role                      | Decision                                                                                                                          |
| ----------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/agent/agent.ts`        | Orchestrator include list | Add `cancel_subagent`; keep `task_report` excluded.                                                                               |
| `packages/opencorvus/test/agent/agent.test.ts`  | Agent exposure regression | Assert orchestrator include list now contains `cancel_subagent`.                                                                  |
| `packages/opencorvus/src/orchestrator/tools.ts` | Tool implementation       | Keep `steer_subagent`; add `cancel_subagent`; reuse the same target resolver for `session_id` / `goal_id` / legacy `goal_run_id`. |

### Session / goal-run lifecycle

| Surface                                                                                   | Role                                             | Decision                                                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `packages/opencorvus/src/session/prompt/state.ts` via `SessionPrompt.cancel(...)`         | Terminally cancel the child session              | Reuse; do not invent a second session-kill path.                                           |
| `packages/opencorvus/src/engine/persist.ts` via `updateGoalRun(...)`                      | Retire the live `goal_run` after child cancel    | Mark the same attempt `aborted` so re-dispatch is unblocked.                               |
| `packages/opencorvus/src/engine/persist.ts` via `updateGoalRunExecutorSessionStatus(...)` | Retire executor lease state for the same attempt | Update alongside `goal_run` to avoid stale "active" executor rows.                         |
| `packages/opencorvus/src/server/routes/orchestrator.ts`                                   | No new route                                     | Keep resume control in orchestrator tools; do not create a parallel HTTP-only resume path. |
| `packages/opencorvus/src/task-api/index.ts`                                               | No task-wide abort change                        | `cancel_subagent` is intentionally narrower than task restart.                             |

## Design Rules

- Single source: child-session recovery semantics belong to the tool contract and runtime behavior, not a long prompt checklist.
- No fallback ladder duplication: do not add another child-resume policy in routes or task API.
- `cancel_subagent` is session-level recovery only. It must preserve the goal contract and instruct the orchestrator to explicitly re-dispatch the same goal/stage if work should continue.
- `modify_goal` remains contract change; `restart_from_stage` remains task-wide and destructive.

## Concrete Changes

1. Expose `cancel_subagent` to the orchestrator.
2. Implement `cancel_subagent` in orchestrator tools:
   - resolve `session_id`, `goal_id`, and legacy `goal_run_id`
   - verify the session belongs to the current task and is a direct-reply child kind
   - call `SessionPrompt.cancel(sessionID)`
   - if the target maps to a live `goal_run`, mark that attempt `aborted`
   - if an executor session exists for the attempt, mark it `aborted`
3. Keep orchestrator prompt deltas minimal:
   - add `cancel_subagent` to the operator-controls list
   - keep one short sentence that points resume back toward child/session-local recovery
4. Add regressions for:
   - orchestrator include list
   - `cancel_subagent` by child `session_id`
   - `cancel_subagent` by `goal_id`

## Validation

- `bun test packages/opencorvus/test/agent/agent.test.ts packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "control-plane panel tool|steer_subagent|cancel_subagent"`
- `bun run --cwd packages/opencorvus typecheck`
