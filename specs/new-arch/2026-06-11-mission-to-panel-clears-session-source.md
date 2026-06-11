# Mission To Panel Clears Session Source

Date: 2026-06-11

## Root Cause

Mission sessions hydrate the shared conversation/card stores through
`boardStore.selectedSource = { kind: "session", id }`. Returning to the Task
Panel only changed `pageMode`, so the panel rendered the still-selected session
conversation. Clicking New Conversation called `selectTask("")`, but
`selectTask` treated `activeTaskID() === ""` plus a loaded session board as an
already-empty task selection and returned before clearing shared stores.

## Call Points

| Surface | Evidence | Decision |
| --- | --- | --- |
| `packages/overlay/src/services/task.ts::selectTask` | `rg "selectTask\\(" packages/overlay/src packages/overlay/test` shows this as the task selection choke point. | Fix the no-op guard to compare the full selected source, not only `activeTaskID()`. Empty task selection is already selected only when `selectedSource` is null. |
| Sidebar New Conversation | `packages/overlay/src/main.tsx` binds `btnCreateTask` to `setPageMode("panel")` then `selectTask("")`. | Keep this call site; the service fix makes it clear Mission sessions correctly. |
| Sidebar Mission toggle | `packages/overlay/src/main.tsx` binds `btnMission` to a page-mode toggle only. | When toggling from Mission to Panel, call `selectTask("")` so the shared Mission conversation is removed. |
| Mission Back to Panel | `packages/overlay/src/components/Mission.tsx` passes `onBackToPanel={() => setPageMode("panel")}`. | Route through `handleCloseMission()` before switching page mode. |
| Mission session open/close | `packages/overlay/src/components/Mission.tsx::openMissionSession` and `handleCloseMission`. | Keep as the Mission-owned session source owner; no second source or fallback. |

## Acceptance

- `selectTask("")` clears a selected Mission session even when a session board
  is loaded.
- New Conversation from Mission switches to Panel and leaves no selected
  session source.
- Mission Back to Panel and sidebar Mission toggle both clear Mission session
  messages instead of hiding them behind `pageMode`.
