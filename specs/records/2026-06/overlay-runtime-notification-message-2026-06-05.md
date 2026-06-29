# Overlay runtime notification message fix - 2026-06-05

## Problem

Overlay runtime notifications currently show the runtime source label as the visible message. For an unhandled Promise rejection, the toast says `window.unhandledrejection`, which identifies the browser event but not the failure.

## Call point audit

| Surface                                                                   | Evidence                                                                                                     | Decision                                                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/main.tsx` `reportOverlayRuntimeError(scope, error)` | Single runtime diagnostic entry point. Called by `window.error`, `window.unhandledrejection`, and `initApp`. | Change this entry point so toast `message` is the actual error summary. Keep `scope` in the details payload.    |
| `packages/overlay/src/services/notify.ts` `notifyError()`                 | Generic notification primitive used by task list, SSE, connection, runtime, and mission actions.             | Do not change generic notification behavior.                                                                    |
| `packages/overlay/test/runtime-diagnostics-source.test.ts`                | Existing static contract pins runtime failures route to notifications.                                       | Extend it to assert the runtime source is no longer the user-visible message and remains in diagnostic details. |

## Implementation

Use the existing `runtimeErrorMessage(error)` result as the visible runtime toast message. Prefix the collapsible details with `source: <scope>` so operators keep the diagnostic source without making it the primary user-facing text.

No fallback or compatibility path is needed; this replaces the old payload shape at the single runtime diagnostic entry point.

## Verification

Run:

- `bun test packages/overlay/test/runtime-diagnostics-source.test.ts`
