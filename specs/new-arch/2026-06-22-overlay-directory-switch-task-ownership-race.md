# Overlay Directory Switch Task Ownership Race

Date: 2026-06-22

## Problem

Switching the working directory from the 7878 overlay can surface:

`task <id> has no owning project directory`

The concrete report used `tsk_eee71c1f20019M30KQJIbe240T`. A live `GET /global/tasks?limit=100`
against `http://127.0.0.1:7878` shows that task does have an owning directory:

`C:\Users\chuan\myhexin-local\demos\economy\economy_2`

The exception is therefore not a backend task-row ownership loss. It is an overlay state transition race:

1. `selectTask()` exposes `boardStore.selectedSource = { kind: "task", id }`.
2. A cross-project selection calls `applyDirectory(taskDirectory)`.
3. `applyDirectory()` clears project-scope projections, including `boardStore.tasks`.
4. Before the selected board is loaded, reactive code such as the follow-up suggestion effect calls
   `taskOwningDirectory(activeTaskID())`.
5. `taskOwningDirectory()` sees the selected task id but no board/task-list row, so it correctly throws.

Manual directory switching has the adjacent issue that `applyDirectory()` clears project data but does not clear the
old selected task source as part of the same lifecycle.

## Call-Site Evidence

| Area                         | Grep evidence                                                                                                                                            | Decision                                                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task owning directory        | `packages/overlay/src/services/task-directory.ts::taskOwningDirectory` reads the task row or loaded board only.                                          | Keep strict ownership resolution; do not use the active directory as a substitute.                                                                |
| Board ownership helper       | `packages/overlay/src/store/board.ts::selectedTaskOwningDirectory` uses board/task-list ownership for board reloads.                                     | Preserve the same ownership invariant.                                                                                                            |
| Cross-project selection      | `packages/overlay/src/services/task.ts::selectTask` sets `selectedSource` before `applyDirectory()`.                                                     | Attach the clicked task row's owning directory to the selected source so the handoff has a stable route context while project projections reload. |
| Manual directory switch      | `packages/overlay/src/services/workspace.ts::applyDirectory` clears project-scope data but leaves `selectedSource` intact.                               | Clear task/session selection synchronously when the user switches directories directly.                                                           |
| Follow-up suggestion         | `packages/overlay/src/main.tsx` calls `taskScopedPath(taskID, taskOwningDirectory(taskID), "/followup")`.                                                | No change needed once invalid intermediate selection states are removed.                                                                          |
| Existing restore race record | `specs/new-arch/2026-06-13-coding-assistant-restore-selection-race.md` says `applyDirectory` owns directory reload and `selectTask` owns task switching. | Reuse those boundaries, no new store or duplicate task directory cache.                                                                           |

## Implementation

1. Add an internal `preserveSelection` option to `applyDirectory()` so directory-switch callers can choose whether the
   active conversation/task source is cleared during the directory transition.
2. The default/manual directory switch path clears selection before project projections are cleared.
3. `BoardSource` task selections carry the selected task's owning directory when the caller has it from the task row or
   explicit mission/task projection. This is route context for the selected task, not the current active directory.
4. `taskOwningDirectory()` and the board reload helper resolve ownership from board, task list, or selected task source
   and fail on any disagreement between those sources.
5. `selectTask()` computes the target task directory before the switch and calls `applyDirectory(..., {
preserveSelection: true })` for its own cross-project transition, because it is about to hydrate the selected task
   itself.

## Acceptance

- Manual `applyDirectory()` clears `activeTaskID()`, board, and task rows atomically with the directory switch.
- Cross-project `selectTask()` keeps a stable selected-source owning directory while `applyDirectory()` is in flight.
- Cross-project `selectTask()` hydrates the task using the original task row directory, starts SSE with that same
  directory, and persists the workspace task/directory after successful hydration.
- `taskOwningDirectory()` still rejects a task id with no row or loaded board; no current-directory fallback is added.
- Focused overlay tests cover the race and pass.

## No New Sources

This fix does not add fallback directory logic, duplicate task stores, hidden messages, route policy changes, or backend
compatibility paths.
