# Coding Assistant Restore Selection Race

Date: 2026-06-13

## Problem

Playwright against `http://127.0.0.1:7878/ui` showed a race between user-selected Coding Assistant chat and initial workspace restore:

1. User clicks the left `Coding Assistant` activity.
2. Overlay creates/selects a right-sidebar assistant session and calls canonical `session/:id/conversation` plus `session/:id/events`.
3. Initial directory restore then switches from `/home/yangheng/myhexin-local/opecorvus` to `/mnt/c/Users/chuan/myhexin-local/demos/economy/economy_1`.
4. The center workflow is restored to the running task while the left activity still shows Coding Assistant.
5. The user sees task workflow messages instead of the selected assistant chat, so the assistant conversation is not shown as user/assistant turns.

## Call-Site Evidence

| Area                   | Grep evidence                                                                                                                                                                                      | Decision                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Assistant selection    | `packages/overlay/src/services/coding-assistant.ts::selectCodingAssistantSession` sets `boardStore.selectedSource = { kind: "session" }`, hydrates canonical conversation, and starts session SSE. | Keep this as the only assistant message path.                                              |
| Assistant activity     | `packages/overlay/src/main.tsx::activateCodingAssistantSessionList` loads session rows and opens workflow.                                                                                         | Do not add a second center panel or local transcript.                                      |
| Initial restore        | `packages/overlay/src/services/init.ts::restoreInitialWorkspace` selects a saved or running task after initial project load.                                                                       | Restore must not override a source the user already selected while init was still pending. |
| Directory switch       | `packages/overlay/src/services/workspace.ts::applyDirectory` clears project-scope state and reloads project data.                                                                                  | Keep directory reload behavior; the bug is restore ownership, not directory loading.       |
| Task selection         | `packages/overlay/src/services/task.ts::selectTask` owns task conversation switching.                                                                                                              | Do not route assistant messages through task selection.                                    |
| Existing restore tests | `packages/overlay/test/initial-workspace-restore-directory-sync.test.ts` already checks active standalone sessions when no task is restorable.                                                     | Add the missing restorable-running-task case.                                              |

## Acceptance

- `restoreInitialWorkspace()` returns without selecting a task when `boardStore.selectedSource.kind === "session"` before restore starts.
- Existing task restore still works when no source is selected.
- Coding Assistant continues to use canonical session conversation/event routes.
- Browser evidence after clicking Coding Assistant must show the center title as `Assistant` and no task workflow messages after initial restore settles.

## No New Sources

This fix does not add fallback routes, coding-specific message APIs, local transcript caches, hidden messages, or duplicate conversation stores.
