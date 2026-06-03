# ResizeObserver frame coalescing plan

## Problem

The overlay emits frequent browser notifications:

`ResizeObserver loop completed with undelivered notifications.`

The root cause is synchronous layout-affecting work inside `ResizeObserver`
callbacks. Chromium reports this when resize delivery cannot finish in the
current turn because callback work triggers more layout changes.

## Repository evidence

Full-repository search for `ResizeObserver` found these runtime call sites:

| Path | Current behavior | Action |
| --- | --- | --- |
| `packages/overlay/src/components/Card.tsx` | Callback manually schedules sticky width measurement with `requestAnimationFrame`. | Replace the local scheduler with the shared animation-frame scheduler. |
| `packages/overlay/src/components/Conversation.tsx` | Callback synchronously calls `props.onMeasuredContentChanged()`. | Defer and coalesce the measurement notification to one animation frame. |
| `packages/overlay/src/components/TaskProgressBar.tsx` | Callback synchronously calls `remeasure()`, which reads layout and writes Solid state. | Defer and coalesce `remeasure()` to one animation frame. |
| `packages/overlay/src/utils/dom-utils.ts` | Comment only; `setupAutoScroll()` must not create a `ResizeObserver`. | Keep unchanged. |

Existing tests also assert `setupAutoScroll()` does not create a
`ResizeObserver`, so this fix must not add one there.

## Implementation

Create a tiny shared utility that schedules the latest callback on the next
animation frame and cancels the pending frame during cleanup. Use it at every
runtime `ResizeObserver` call site so observer delivery never synchronously
writes layout-affecting state.

This is a direct root-cause fix: resize notifications remain active, but their
layout work moves out of the observer delivery phase.

## Tests

Add source-level regression tests that require the high-risk components to use
the shared scheduler and disallow direct synchronous `ResizeObserver` callbacks
in `Conversation.tsx` and `TaskProgressBar.tsx`.

## Follow-up diagnosis

After callback coalescing, the notification still appeared. The remaining
source is `packages/overlay/src/main.tsx`: Chromium emits ResizeObserver
delivery diagnostics through `window.error`, and the overlay runtime diagnostic
handler promoted every `window.error` into a persistent user-facing
notification.

That browser delivery diagnostic is not an application runtime failure. Keep
logging it at debug level, but do not create an error notification for the two
exact browser messages:

- `ResizeObserver loop completed with undelivered notifications.`
- `ResizeObserver loop limit exceeded`
