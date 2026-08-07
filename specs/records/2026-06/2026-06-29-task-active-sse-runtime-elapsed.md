# Task Active SSE Runtime Elapsed

Date: 2026-06-29

## Problem

The task status header was changed to count selected-task SSE activity, but the
first implementation stored elapsed runtime only in the current overlay
JavaScript process. Re-entering the same active task created a fresh in-memory
state, so the header started again at `0s`.

The user correction is explicit: this is actual running time evidenced by SSE
updates, not browser foreground/window visibility. Therefore the UI must not use
`document.hidden`, `performance.now()`, or `useNowTick()` for the task status
elapsed label.

## Recall

| Record | Constraint |
| --- | --- |
| `2026-06-04-overlay-tool-agent-timer-single-source.md` | Runtime duration must be owned by persisted lifecycle evidence, not mount time. |
| `2026-06-18-retire-titlebar-status-residue.md` | `TaskStatusHeader` is the live task status owner. |
| `2026-06-28-tool-pending-start-time-contract.md` | Overlay must stay strict; missing runtime timestamps are backend/data contract bugs. |

## Call Point Inventory

Grep covered `TaskStatusHeader`, `taskElapsed`, `useNowTick`,
`task.messages.changed`, `messageWatermark`, `conversation/events`,
`replayTaskEventToTree`, and `performance.now`.

| Call point | Decision |
| --- | --- |
| `packages/overlay/src/components/TaskStatusHeader.tsx` | Keep rendering active elapsed from `selectedTaskSseActiveElapsedMs(key)`. Do not reintroduce wall-clock ticking. |
| `packages/overlay/src/services/sse.ts` | Record only non-heartbeat selected-task SSE events. `task.messages.changed` uses its persisted message watermark, not receive time. |
| `packages/overlay/src/services/conversation.ts` | Hydrate and tail merge must initialize the same activity state from `/task/:id/conversation` `messageWatermark` plus replayed protocol events. |
| `packages/overlay/src/services/task-runtime-activity.ts` | Single frontend owner for selected-task activity state; key by task id plus `task.time.created`, baseline by `task.time.started`. |
| `packages/overlay/src/utils/sse-active-elapsed.ts` | Elapsed is `latestActivityAt - task.time.started`, clamped at zero for pre-start evidence. Older replayed events must not reduce the restored watermark. |
| `packages/overlay/src/services/clock.ts` | Card durations may use wall-clock ticks; task status elapsed must not. |

## Decision

Replace interval accumulation with observed runtime restoration:

- baseline: `task.time.started`;
- active observation: max selected-task activity timestamp;
- message activity source: `task.messages.changed.payload.watermark` and
  hydrate `messageWatermark`;
- protocol activity source: event `emittedAt` / `emitted_at` / `timestamp`;
- queued tasks do not start;
- terminal tasks still render from explicit terminal timestamps.

This keeps the display frozen when no selected-task activity arrives, but
restores the existing active runtime whenever the user enters the task again.
No foreground/visibility or wall-clock fallback is introduced.

## Verification

- Unit tests must cover restored persisted activity, old replay events not
  reducing elapsed, queued tasks staying blank, and malformed message-change
  events failing instead of inferring time.
- Browser test must open the same active task twice and assert the elapsed label
  is restored to a non-zero value both times.
