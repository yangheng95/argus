# Overlay deleted-session stale card plan

## Problem

When the overlay restores a persisted `workspaceTaskID` that no longer exists in the refreshed task list, `restoreInitialWorkspace()` returns `false` without driving the existing deselection cleanup path. If a previous conversation projection is still present in the in-memory `cardTreeStore`, the center Conversation panel can keep rendering cards for the deleted task/session even though the sidebar has already refreshed to different rows.

## Evidence and call points

| Surface                       | Call point                                                                                    | Decision                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Task row select               | `packages/overlay/src/main.tsx` -> `selectTask(taskID)`                                       | Keep. `selectTask()` already clears board/messages/writer before hydrating the new task.                                           |
| Task row delete               | `packages/overlay/src/main.tsx` -> `deleteTask(taskID)` -> active task uses `selectTask("")`  | Keep. Active local delete already clears through the canonical path.                                                               |
| Task list refresh             | `packages/overlay/src/store/board.ts` `applyTasks()` -> `setOrphanedSelectionHandler()`       | Keep. It detects selected task removal during normal refresh and delegates to `selectTask("")`.                                    |
| Restore startup/reconnect     | `packages/overlay/src/services/init.ts` `restoreInitialWorkspace()`                           | Change. When no restorable task exists, explicitly call `selectTask("")` if any stale selection, board, or projected cards remain. |
| Mission session select/delete | `packages/overlay/src/components/Mission.tsx` `openMissionSession()` / `handleCloseMission()` | Keep. Session source already stops SSE, clears messages, resets writer, and hydrates.                                              |
| Conversation projection       | `packages/overlay/src/services/conversation.ts` `hydrateConversation()`                       | Keep. Hydrate resets writer before applying server view.                                                                           |
| Writer store                  | `packages/overlay/src/services/tree-writer.ts` `resetWriter()`                                | Reuse as part of existing `selectTask("")`; no parallel clearing implementation.                                                   |

## Acceptance

- Add a regression test that seeds a stale selected task and visible `cardTreeStore` card, then calls `restoreInitialWorkspace()` with the saved task absent from `boardStore.tasks`.
- The test must assert the restore returns `false`, `boardStore.selectedSource` is `null`, `boardStore.board` is `null`, and `cardTreeStore.order` is empty.
- Keep the fix on the existing deselection path instead of adding a separate visibility/filter gate in Conversation.
