# Task List Row Directory Selection

Date: 2026-06-23
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the visible overlay surface.
- UI: User Interface, visible controls and layout surfaces.
- SSE: Server-Sent Events, the task live-update stream.

## Task Definition

Make the ordinary task ledger row selection carry the clicked task row's owning
directory into `selectTask()`. This matches the existing Mission task projection
selection path and removes a task-switch handoff gap where the selected task
directory is rediscovered from task-list state instead of being passed by the
row that the operator actually clicked.

## Recall

| Source                                                       | Constraint carried forward                                                                                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                  | No fallback, no duplicate source, recall disk plans before edits, test every change, visual verify UI work, commit and push each round.                                     |
| `2026-06-22-overlay-directory-switch-task-ownership-race.md` | `BoardSource` task selections must carry the selected task's owning directory when the caller has it from the task row or explicit task projection.                         |
| `2026-06-22-task-switch-directory-source.md`                 | During task switch, selected task directory ownership is strict and fail-loud through `taskOwningDirectory()`.                                                              |
| `2026-06-22-task-switch-stable-request-keys.md`              | Task switching still needs request fan-out reduction at trigger-level causes; avoid broad caches.                                                                           |
| Live 7878 read-only sampling                                 | The running process is stale, but selecting visible task rows measured 443-2570ms; current-source fixes should reduce handoff ambiguity before chasing old-bundle symptoms. |

## Call Point Inventory

| Surface                | Evidence                                                                                                                         | Decision                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Mission task selection | `Mission.tsx::handleTaskSelect()` calls `props.onSelectTask(task.id, task.directory)`.                                           | Keep as the reference task-projection contract.                                                    |
| Main Mission entry     | `selectMissionTask(taskID, directory?)` passes `{ directory }` to `selectTask()`.                                                | Keep unchanged.                                                                                    |
| Ordinary TaskList row  | `TaskRow` has `directory()` from `props.item.task.directory`, but row and main-button clicks call `props.onSelectTask(id())`.    | Pass `id(), directory()` so the clicked row owns the handoff.                                      |
| TaskList prop type     | `TaskListProps.onSelectTask` currently accepts only `taskID`.                                                                    | Extend to `(taskID, directory)`; no new store or lookup path.                                      |
| Main TaskList entry    | `selectTaskFromTaskList(taskID)` calls `selectTask(taskID)`.                                                                     | Accept optional directory and call `selectTask(taskID, { directory })`.                            |
| `selectTask()`         | Already prefers explicit `options.directory` over task row lookup.                                                               | Reuse the existing explicit directory contract; no service change needed.                          |
| Tests                  | Existing task switch tests cover explicit directory behavior and cross-directory hydrate; no test pins the TaskList row handoff. | Add source-level regression for TaskList passing row directory and main using the explicit option. |

## Root Cause

The service layer already supports the correct ownership handoff:
`selectTask(taskID, { directory })`. Mission task rows use it. Ordinary task
ledger rows still drop the row directory and rely on `selectTask()` to find the
task row again through global task-list state. That is usually equivalent, but
it violates the documented cross-project selection boundary: the click source
has the owning directory and should pass it before any project projection can be
cleared by `applyDirectory()`.

## Fix Plan

1. Extend `TaskRow` and `TaskListProps.onSelectTask` to pass `(taskID, directory)`.
2. Pass `directory()` from both row-level click and `LedgerRowMainButton` click.
3. Update `selectTaskFromTaskList()` to forward `{ directory }` into `selectTask()`.
4. Add a focused source regression that rejects the old `props.onSelectTask(id())` path.
5. Run focused TaskList/task-selection tests, overlay typecheck, browser visual task-row coverage, self-review, commit, and push.

## Acceptance

- Ordinary TaskList row selection passes the clicked row's task directory into
  `selectTask()`.
- Mission task selection remains unchanged and uses the same callback shape.
- No current-directory fallback, duplicate task directory cache, hidden route,
  or alternate task selection source is added.
- Focused tests, typecheck, browser visual QA, self-review, commit, and push pass.

## Verification

- `bun test packages/overlay/test/task-list-selection-directory.test.ts packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/task-selection-dead-task.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-list-tree-click.test.ts`

## Visual Acceptance

Reviewed the task-list browser screenshots from the isolated Playwright fixture:

- `.scratch/task-row-children-toggle-focus.png`
- `.scratch/task-row-actions-keyboard-open.png`
- `.scratch/task-row-cancel-armed-confirm.png`

The task list panel, row focus ring, action rail, and cancel confirmation state
remain aligned with no text overlap or button occlusion.

## Self Review

The change reuses the existing `selectTask(taskID, { directory })` contract and
the row's existing `directory()` source. It does not add a cache, fallback,
route, or second directory lookup path. The Mission projection keeps the same
shape, and the ordinary TaskList path now matches it.
