# Overlay Project Switch Backend Disconnect

Date: 2026-06-22

## Problem

When the overlay switches projects, project-scoped HTTP/SSE requests can be
issued with the previous directory. The backend is still running, but the UI
shows repeated failed fetches / reconnects because the request context no
longer matches the active project.

## Call-Site Recall

- `packages/overlay/src/services/workspace.ts`
  - `applyDirectory()` is the manual project switch path and already calls
    `configureApi({ directory: next })` before `checkConnection()` and
    `reloadProjectScope()`.
  - `setWorkspaceDirectory(value, "task")` is the cross-project task-selection
    path. It updates `settingsStore.directory`, stops task-list SSE, clears
    project-scope data, and calls `reloadProjectScope()`, but it relies on the
    top-level Solid effect in `main.tsx` to retarget the API client.
- `packages/overlay/src/main.tsx`
  - the top-level effect eventually calls `configureApi({ directory:
    activeDirectory() })` after settings hydration.
- `packages/overlay/src/services/sse.ts`
  - selected-task SSE gets an explicit directory from callers.
  - task-list SSE computes its directory with
    `boardStore.board?.task?.directory || settingsStore.directory`, so a stale
    selected board can reconnect the global task-list stream to the previous
    project during a switch.
- `packages/overlay/src/services/config.ts`
  - `reloadProjectScope()` calls `configureApi({ directory })`, but callers
    before it can still run against a stale API context.

## Root Cause

Project directory is effectively multi-sourced during transitions:

1. `settingsStore.directory`
2. `boardStore.board.task.directory`
3. the API module's private `directoryContext`
4. callers passing explicit SSE/request directories

Manual switching already synchronizes (1) and (3) immediately. Cross-project
task switching did not. Task-list SSE also read (2), which is explicitly stale
during a switch.

## Decision

- Make `setWorkspaceDirectory(value, "task")` call
  `configureApi({ directory: next })` immediately after mutating settings.
- Make task-list SSE use only `settingsStore.directory` as its project source.
  Selected-task streams continue to receive explicit task directories.

This removes the stale board-derived project source without parsing failures,
retrying around the issue, or weakening backend project-scope validation.

## Acceptance

- Cross-project task directory changes immediately retarget `apiUrl()` /
  transport requests.
- Task-list SSE opens against `settingsStore.directory`, even if an old board
  snapshot still has a previous task directory.
- Existing selected-task SSE behavior remains explicit-directory based.
