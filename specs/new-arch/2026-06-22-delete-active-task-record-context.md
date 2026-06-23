# Delete Active Task Record Context

Date: 2026-06-22
Status: Implemented

## Problem

Clicking a task row delete action can leave the overlay showing
`Failed to load tasks: Failed to fetch` on port 7878. Read-only live evidence
showed the managed sidecar had exited after logging:

```text
instance: No context found for instance
```

The UI error is only the downstream symptom. The backend process exited while
handling the delete/cleanup chain, so later `/global/tasks` requests had no
listener to connect to.

## Recall

| Source                                                               | Constraint                                                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                          | No fallback, no gate, no hiding process crashes behind UI retry logic.                                                             |
| `specs/event-log-task-project-directory-2026-06-16.md`               | Global task event subscribers must resolve runtime paths from task/project rows, not ambient `Instance.directory`.                 |
| `specs/new-arch/2026-06-12-deleted-project-task-record-routes.md`    | `DELETE /task/:taskID` is a record-level route and must work without `?directory=`.                                                |
| `specs/new-arch/2026-06-19-task-mission-agent-cancellation-scope.md` | Task cancellation must terminate real live execution handles; timeout/failure must be visible, not marked as success.              |
| `specs/new-arch/2026-06-20-runtime-isolation-second-repair.md`       | Task-owned artifacts and runtime paths should derive from the task primary project, not whichever project is active in the caller. |

## Call Point Inventory

| Surface               | Evidence                                                                                                                                                                                                        | Decision                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Overlay delete action | `packages/overlay/src/services/task.ts::deleteTask` calls `DELETE /task/:taskID`, then reloads `global/tasks`.                                                                                                  | Keep. The UI should not mask a backend crash.                                                                                |
| Server route          | `packages/opencorvus/src/server/routes/orchestrator.ts` maps `DELETE /task/:taskID` to `EngineService.deleteTask`.                                                                                              | Keep route shape and method-aware no-directory contract.                                                                     |
| Delete service        | `packages/opencorvus/src/task-api/index.ts::deleteTask` loads the task row, cancels active tasks, removes the root session tree, then deletes the task row.                                                     | Audit active-task cancellation under no ambient `Instance`.                                                                  |
| Cancel service        | `packages/opencorvus/src/task-api/index.ts::cancelTask` cancels orchestrator/pipeline/session prompts, goal runs, live execution, active run, and finally updates the task to cancelled.                        | Add a live deletion regression that drives this full branch without `Instance.current()`.                                    |
| Live writer helpers   | `packages/opencorvus/src/engine/writer.ts` already has `provideTaskRootSessionDirectory()` for some process-recovery flows. `abortLiveExecutionForTask()` does not wrap its own task scope.                     | If the regression proves this path needs context, wrap from task row/session directory instead of reading caller context.    |
| Live ownership writer | `packages/opencorvus/src/engine/writer.ts::abortLiveOrchestratorToolOwnership` updates orchestrator tool parts through `Session.updatePart`, which publishes `Bus` events requiring an ambient task `Instance`. | `cancelTask` now closes live ownership inside the task root session `Instance` before marking the task cancelled.            |
| Shutdown writer       | `packages/opencorvus/src/engine/writer.ts::terminateTaskOwnedSessionsAndFail` is process lifecycle cleanup, not user cancel.                                                                                    | Use shutdown-specific session termination so a missing prompt handle does not leave active zombie tasks during process exit. |
| Terminal task update  | `packages/opencorvus/src/engine/state.ts::finalizeLiveRunForTerminalTask` writes decision-log projection and finalizes live run.                                                                                | Preserve task-primary-project root as source; do not use caller active directory.                                            |
| Event subscribers     | `EngineEventLog`, protocol bridge, scheduler/list projections react to terminal task/run/session events.                                                                                                        | Any subscriber that handles task events must use task/project rows or receive an explicit project context.                   |

## Implemented Design

- `EngineService.cancelTask` now enumerates live orchestrator tool ownership
  before live goal/run cleanup and calls `abortLiveOrchestratorToolOwnership`
  inside the task root session `Instance` when there is no ambient
  `Instance.current()`.
- `DELETE /task/:taskID` still stays record-level because it calls the same
  active-task cancellation branch and still does not require `?directory=`.
- `cancelSessionPromptInScope` remains fail-loud for user/operator cancel:
  a non-terminal session with no matching prompt state still raises
  `TaskCancellationIncompleteError`.
- Shutdown/dead-owner cleanup uses `terminateSessionPromptInScope`, which is
  explicitly process-lifecycle terminalization. It attempts prompt cancel, then
  marks every task-owned non-terminal session as `terminal/aborted` because the
  owning process is exiting.

## Acceptance

- `DELETE /task/:taskID` without `?directory=` deletes an active task that has
  root/child sessions, a live run, a live goal run, and live orchestrator tool
  ownership.
- The delete request does not throw `No context found for instance`.
- The route remains record-level; no project directory query is injected or
  required for `DELETE /task/:taskID`.
- Existing stale project record deletion tests continue to pass.
- The fix does not add fallback directory logic, duplicate task stores, retry
  gates, or frontend-only masking.

## Verification Plan

1. Add a focused server/task-api regression that seeds the live task shape and
   calls `DELETE /task/:taskID` outside `Instance.provide`.
2. Run the regression before and after the code change.
3. Run existing no-directory delete route tests.
4. Run focused cancellation and event-log tests that cover adjacent context
   boundaries.
5. Self-review the changed backend surfaces for stray ambient `Instance` reads
   on record-level delete paths.

## Verification Completed

```powershell
bun test packages/opencorvus/test/task-api/cancel-task-live-ownership.test.ts --timeout 60000
bun test packages/opencorvus/test/server/directory-required.test.ts --test-name-pattern "record-level DELETE" --timeout 60000
bun test packages/opencorvus/test/task-api/cancel-task-abort-timeout.test.ts --timeout 60000
bun test packages/opencorvus/test/engine/shutdown-active-task-sessions.test.ts --timeout 60000
bun test packages/opencorvus/test/engine/goal-run-owner-orphan.test.ts --timeout 60000
bun run --cwd packages/opencorvus typecheck
```
