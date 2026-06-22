# Task Switch Directory Source

Date: 2026-06-22
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the rendered overlay surface.
- UI: User Interface, visible controls and panels.
- SSE: Server-Sent Events, the live update stream used by the overlay.

## Task Definition

Stop task selection from issuing project-scoped UI requests against the
previous workspace directory while the newly selected task's board is still
loading.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate source, recall disk plans before edits, test every change, visual verify UI work, commit and push each round. |
| `2026-06-19-deep-performance-investigation.md` | Always-mounted overlay panels can amplify task selection pressure; fix trigger-level causes instead of caching broad stale data. |
| `2026-06-22-section-phase-solid-owner.md` | Task selection UI state must have a single live owner and avoid imperative duplicate writers. |
| `workspace-active-directory.test.ts` | Selected task directory already owns project-scoped controls over stale settings once `board.task.directory` exists. |
| `task-directory-project-scope.test.ts` | Project-scope reloads must use selected task directory for direct panel requests. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| `selectTask()` | Synchronously writes `boardStore.selectedSource = { kind: "task", id, directory }` before async hydrate. | Treat this selected-source directory as the task-scoped directory while the board is empty. |
| `selectTask()` sync phase | Previously updated `selectedSource`, `selectEpoch`, `taskSwitching`, board clearing, and writer reset as separate Solid writes. | Batch the switch identity and projection clears so reactive effects cannot observe a half-switched task. |
| `activeProjectDirectory()` | Currently returns `boardStore.board?.task?.directory || settingsStore.directory`. | Add the selected-source directory to the same consistency-checked task directory source. |
| `taskOwningDirectory()` | Already resolves and consistency-checks task row, matching board task, and selected source directories. | Reuse this owner resolver for selected-task project controls instead of adding a parallel resolver. |
| Task switch trace | Selecting long tasks produced 51-53 requests and stale `economy_1` calls such as `operator-model-context`, `panel/knowledge/memory`, `terminal/profiles`, `config/prompt-profile`, and `followup`. | Fix the directory source before reducing individual request counts. |
| Existing tests | `workspace-active-directory.test.ts` does not cover selected-source directory before board load. | Add a regression test for that race window and an inconsistency fail-loud case. |

## Root Cause

The UI flips the selected task immediately so the operator sees a fast task
selection response, but `activeProjectDirectory()` continues to read the old
workspace directory until the new board snapshot arrives. Always-mounted
project controls then observe the new task ID with the old directory and launch
stale requests, including 404s for task-scoped model context. This is not a
server bottleneck; it is a client-side directory source mismatch during the
task switch window.

## Fix Plan

1. Make `activeProjectDirectory()` derive selected task directory through
   `taskOwningDirectory()`, rejecting conflicts and missing owners.
2. Keep settings directory only for non-task project scope.
3. Add tests for selected-source directory ownership before board load and for
   board/selected-source directory conflict.
4. Batch the synchronous `selectTask()` identity and projection updates.
5. Rerun the task-select trace and visually inspect the real `/ui/` page.

## Acceptance

- During task switch, task-scoped project UI requests use the selected task
  directory as soon as `selectedSource.directory` exists.
- Directory conflicts between `board.task.directory` and
  `selectedSource.directory` throw instead of silently picking one.
- Stale previous-directory task requests disappear from the trace.
- Focused tests, overlay typecheck, visual QA, self-review, commit, and push
  pass.

## Implementation

- `activeProjectDirectory()` now delegates selected-task directory ownership
  to `taskOwningDirectory()`, the existing task row / board / selected-source
  consistency checker.
- If both task-owned directories exist and disagree, the UI throws immediately
  instead of silently choosing one.
- If the selected task has no owning directory, the UI throws instead of
  reusing an unrelated previous board directory.
- `selectTask()` batches selected task identity, selected source, switch epoch,
  switching flag, board clear, message clear, and writer reset in one Solid
  transaction.

## Verification

| Check | Result |
| --- | --- |
| `bun test packages/overlay/test/task-selection-dead-task.test.ts --timeout 30000` | 8 pass |
| `bun test packages/overlay/test/workspace-active-directory.test.ts --timeout 30000` | 9 pass |
| `bun test packages/overlay/test/task-directory-project-scope.test.ts --timeout 30000` | 8 pass |
| `bun test packages/overlay/test/runtime-directory-actions.test.ts --timeout 30000` | 9 pass |
| `bun run --cwd packages/overlay typecheck` | Pass |
| `bun run --cwd packages/overlay build:vite` | Pass |
| `node packages/overlay/.scratch/task-select-directory-window.mjs` | Previous-directory request count after click: 0; screenshot: `.scratch/task-select-directory-window-tsk_edc1eeb470011vW1ZfiEsw7ijo.png`. |

## Self Review

- The fix does not add a fallback path: selected task directory resolution uses
  `taskOwningDirectory()` and throws for conflicts or missing task owners.
- The selected task directory remains a single task-owned source shared by the
  existing task row / board / selected-source resolver; the code does not
  create a second independent source of truth.
- The UI screenshot shows the selected `economy_8` task loaded with visible
  task content, composer, left task list, and right toolbar.
