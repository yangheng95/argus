# Overlay New Task Directory Ownership

Date: 2026-06-22

## Problem

Opening a new project directory and sending the first panel message can create a
task, select that task, and then fail subsequent task-scoped operations with:

`task <id> has no owning project directory`

## Recall

- `packages/overlay/src/services/task-directory.ts`
  - `taskOwningDirectory(taskID)` intentionally rejects task IDs that are not
    backed by a task row, loaded board task, or selected task source directory.
  - This must stay fail-loud; using the current project directory as a fallback
    would reintroduce cross-project request leakage.
- `packages/overlay/src/services/chat.ts`
  - `panelMessage()` creates a new task with `createTask()` when no task is
    selected.
  - After direct creation it calls `selectTask(createdTaskID)` without passing
    the project directory that was used for creation.
- `packages/overlay/src/services/task.ts`
  - `selectTask(taskID, { directory })` already supports freezing the selected
    source directory before the task row or board snapshot exists.

## Root Cause

The new-task path knows the active project directory at creation time, but it
drops that directory before selecting the created task. The selected task then
has only an ID, so later task-scoped requests cannot prove which project owns
the task.

## Decision

- In `panelMessage()`, capture the active project directory immediately before
  direct task creation.
- Require that directory to exist for task creation.
- Select the created task with `selectTask(createdTaskID, { directory })`.
- Add a regression test proving a newly created task can immediately resolve
  `taskOwningDirectory()` to the creation directory.

## Acceptance

- Creating a task from an empty/new project directory freezes the task's owning
  directory in `boardStore.selectedSource`.
- `taskOwningDirectory(createdTaskID)` works immediately after direct task
  creation, before the global task list reloads.
- No global current-directory fallback is added to `taskOwningDirectory()`.
