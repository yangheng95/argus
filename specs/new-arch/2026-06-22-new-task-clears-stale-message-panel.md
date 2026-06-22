# New Task Clears Stale Message Panel

Date: 2026-06-22

## Problem

Clicking the sidebar New Task button can leave the center message panel showing
the previous conversation.

The expected lifecycle already exists: New Task should deselect the current
conversation and focus the shared composer. The broken case is not ordinary
task selection. It happens when `boardStore.selectedSource`, `boardStore.board`,
and `boardStore.taskSwitching` are already empty, but the conversation writer
still has projected `cardTreeStore` cards or `messageStore` still has message
state. `selectTask("")` returns early in that state, so the canonical clearing
calls (`clearMessages()` and `resetWriter()`) do not run.

## Call-Site Evidence

| Area | Evidence | Decision |
| --- | --- | --- |
| Sidebar New Task binding | `packages/overlay/src/main.tsx::bindSidebarStaticControls` inlines launcher logic. | Restore a single `openTaskLauncher()` helper so New Task owns Tasks focus and deselection in one place. |
| Historical launcher contract | `specs/new-arch/2026-06-16-left-activity-composer-binding.md` says New Task should select the Tasks left activity and center panel. | Reuse that contract; do not add a parallel New Task panel or hidden message path. |
| Deselection lifecycle | `packages/overlay/src/services/task.ts::selectTask("")` clears board/messages/writer, but only after its early no-op guard. | Tighten the no-op guard so it only skips work when the message panel stores are also empty. |
| Writer projection | `packages/overlay/src/services/tree-writer.ts::resetWriter()` clears `cardTreeStore` and writer indices. | Keep it as the single visual message-panel clear path. |
| Message store | `packages/overlay/src/store/messages.ts::clearMessages()` clears message arrays and pending parts. | Include message store emptiness in the deselection no-op predicate. |

## Implementation

1. Export no new state and add no fallback route.
2. `selectTask("")` checks `messageStore.messages`, `messageStore.messagesBySession`,
   `messageStore.selectedTaskID`, `messageStore.chatAttachments`, and
   `cardTreeStore.order/cards` before treating deselection as a no-op.
3. Add `openTaskLauncher()` in `main.tsx`; it closes Mission/Assistant launcher
   modes, focuses the Tasks surface, selects the Tasks left activity, and calls
   `selectTask("")`.
4. Bind `#btnCreateTask` to `openTaskLauncher()`.

## Acceptance

- Clicking New Task clears stale message cards even when no task/session is
  selected.
- Clicking New Task also re-selects the Tasks left activity and primary center
  panel.
- Existing task deselection behavior and cross-directory task selection remain
  unchanged.
- Focused tests cover the stale writer/card-tree case and the launcher binding
  contract.
