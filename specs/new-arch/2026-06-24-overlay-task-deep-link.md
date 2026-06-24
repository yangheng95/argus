# Overlay Task Deep Link

Date: 2026-06-24
Status: Implemented and verified

## Acronyms

- URL: Uniform Resource Locator, the browser address used to open the overlay.
- UI: User Interface, visible controls and panels.
- SSE: Server-Sent Events, the task live-update stream.

## Task Definition

Allow the overlay Web UI to open a concrete task from URL parameters, using one
canonical parameter contract:

```text
/ui/?taskID=<task-id>
```

The URL must only express startup intent. Task selection, directory ownership,
conversation hydration, persisted restore, and SSE subscription continue to run
through `selectTask(taskID)`. The task's owning directory is resolved from the
backend task/conversation record, not from the URL.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate source, read disk plans before editing, test every change, visual verify frontend work. |
| `2026-06-22-task-switch-directory-source.md` | Selected task directory is strict and fail-loud through the existing task ownership resolver. |
| `2026-06-23-task-list-row-directory-selection.md` | Callers that know the selected task directory must pass it directly to `selectTask(taskID, { directory })`. |
| `2026-06-13-coding-assistant-restore-selection-race.md` | Startup restore must not override an already selected standalone session. |
| User correction in current task | `taskID` is the primary key; the URL should not carry project directory as a second task ownership source. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| URL parsing | `rg "window.location|URLSearchParams" packages/overlay/src` shows no startup task deep-link parser. | Add one parser module for canonical `taskID` only; reject aliases and `directory`. |
| Init restore | `initApp()` calls `restoreInitialWorkspace()` after `loadInitialData()`. | Insert deep-link restore before persisted restore; if it selects a task, skip persisted restore for that startup pass. |
| Reconnect restore | `startConnectionMonitor()` also calls `restoreInitialWorkspace()`. | Do not re-apply URL intent on reconnect; deep links are initial page-open intent only. |
| Task selection | `selectTask(taskID)` already validates task ID, hydrates conversation, starts SSE, and persists workspace memory. | Reuse it, but ensure post-hydrate SSE and persistence use the hydrated task directory. |
| Conversation hydrate | `GET /task/:taskID/conversation` is a directory-policy bypass and server tests prove it hydrates from the task project, not the request directory. | Allow task conversation hydrate to omit directory, then register the returned `board.task.directory`. Session hydrate remains directory-required. |
| UI focus | `main.tsx` focuses restored tasks with `onConnected: focusInitialRestoredTaskWorkspace`. | Deep-link selection should trigger the same connected focus hook because `activeTaskID()` is set by `selectTask()`. |
| Tests | `initial-workspace-restore-directory-sync.test.ts` covers restore and selected-source behavior. | Add focused unit tests for parser and init precedence using mocks. |

## Root Cause

The overlay has a canonical task selection service, but cold startup only reads
persisted settings. Opening `/ui/?taskID=...` currently leaves the query unused,
so operators cannot share or bookmark a task-specific overlay URL. Adding
`directory` to the URL would create a second task ownership source even though
`taskID` is the backend primary key and conversation hydrate can resolve the
task project.

## Fix Plan

1. Add a small deep-link module that reads only `taskID`.
2. Reject `directory` and task parameter aliases so the URL has one task source.
3. After initial data load, apply the deep link through `selectTask(taskID)`;
   otherwise use existing `restoreInitialWorkspace()`.
4. Keep reconnect behavior on persisted restore only.
5. Let task conversation hydrate omit request directory and register the
   returned board task directory for SSE/replay/project-scoped UI.
6. Add tests for valid link selection, directory-param rejection, no-query
   persisted restore, and parser behavior.

## Acceptance

- `/ui/?taskID=tsk_xxx` selects that task through `selectTask(taskID)`.
- `/ui/?taskID=tsk_xxx&directory=C%3A%2Frepo` is rejected instead of creating
  a second task ownership source.
- No aliases such as `task`, `taskId`, or `task_id` are accepted.
- Existing persisted workspace restore continues to work when no deep link is
  present.
- Reconnect does not replay stale URL intent.
- Focused tests, typecheck, visual/browser evidence, self-review, commit, and
  push pass or any external blocker is reported explicitly.

## Verification

- `bun test packages/overlay/test/task-deep-link.test.ts packages/overlay/test/initial-workspace-restore-directory-sync.test.ts packages/overlay/test/mission-session-source.test.ts packages/overlay/test/conversation-hydrate-replay.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-deep-link-browser.test.ts`
- Visual evidence: `.scratch/task-deep-link-browser.png`
