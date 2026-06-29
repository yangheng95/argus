# 2026-06-29 Task Active SSE Elapsed

## Goal

The selected task status header must count live running time actively in the
overlay, not by subtracting wall-clock `Date.now()` from `task.time.created`.
The live counter advances only from real selected-task SSE updates: each
non-heartbeat update closes the interval since the previous selected-task SSE
update, and that interval is accumulated only while the task lifecycle is
`active`.

## Recall

| Source | Constraint |
| --- | --- |
| `AGENTS.md` | No fallback logic, inspect landed plans before edits, preserve task requirements through verification, do not disturb running overlay processes. |
| `2026-06-04-overlay-tool-agent-timer-single-source.md` | Tool and agent card durations are owned by persisted card/tool timestamps and must not be reinterpreted from render time. |
| `2026-06-19-card-header-chrome-single-source.md` | Card duration rendering stays in `CardHeaderChrome`; task status header is a separate surface. |
| `2026-06-27-bug-hunt-residual-convergence.md` | Terminal task elapsed display must still reject missing or invalid `task.time.completed` instead of using local time. |
| User correction, 2026-06-29 | "前台" here means actual running activity with SSE updates, not browser foreground/window visibility. |

## Call Point Inventory

| Call point | Current behavior | Decision |
| --- | --- | --- |
| `packages/overlay/src/components/TaskStatusHeader.tsx` | Live tasks render `formatDuration(useNowTick() - task.time.created)`, so wall-clock time is counted even when no selected-task stream updates are arriving. `queued` is treated as live. | Replace only the live active branch with the selected-task SSE activity accumulator. `queued` renders no running elapsed label. Terminal validation remains. |
| `packages/overlay/src/services/sse.ts` | Selected task stream parses and routes events, ignoring heartbeat/connected control events. | After heartbeat/connected filtering and before routing side effects, record the SSE arrival time for the selected task. Pause the accumulator when the selected stream closes or stops so reconnect gaps do not count. |
| `packages/overlay/src/services/task-runtime-activity.ts` | No dedicated owner for task status header active runtime. | Own the reactive selected-task active elapsed value keyed by `taskID:task.time.created`. |
| `packages/overlay/src/utils/sse-active-elapsed.ts` | No pure accumulator. | Accumulate intervals between active SSE updates and reject invalid/non-monotonic timestamps. |
| `packages/overlay/src/services/clock.ts` | Shared wall-clock tick for card durations and the task header. | Leave unchanged so card/session duration semantics are not disturbed. |
| `packages/overlay/src/components/CardHeaderChrome.tsx` | Running card chips use persisted `CardNode.time` plus shared wall-clock tick. | Keep unchanged because card timing has a separate single-source contract. |
| `packages/overlay/src/utils/visibility-interval.ts` | Starts/stops intervals on document visibility and exposes `onVisible`. | Leave unchanged; browser visibility is not the source for task runtime. |
| `packages/overlay/test/card-duration-single-source.test.ts` | Static guard expects `TaskStatusHeader` to use `useNowTick`. | Update the guard to require the selected-task SSE activity owner and still forbid private `Date.now() - start` live elapsed logic. |
| `packages/overlay/test/sse-active-elapsed.test.ts` | No coverage for active SSE runtime accumulation. | Add pure and service tests for active-only accumulation, pause on reconnect gaps, key reset, and invalid timestamp rejection. |

## Acceptance

- Active selected task elapsed time advances only when selected-task SSE updates arrive.
- Time without selected-task SSE updates is not added by a local clock.
- Reconnect/stop gaps are not added when the next SSE update arrives.
- `queued` task status does not advance or display a live elapsed timer.
- Terminal timestamp errors remain visible and logged.
- Card/tool/agent duration code paths are untouched.
