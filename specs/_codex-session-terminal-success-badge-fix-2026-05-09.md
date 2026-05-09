# Session Terminal Badge Fix - 2026-05-09

## Problem

Successful worker agents can show a red error badge in Overlay even when their terminal tool result is PASS.

Evidence from existing benchmark logs:

- Requirements session `ses_1fe2a219effdFGTzPI8NPoLEwL` emitted `session.terminal ... reason=aborted`.
- The same session then logged `requirements agent finished`.
- The abort came from `SessionPromptState.cancel()` in the prompt loop `finally`, not from a user cancel.

## Root Cause

`SessionLoop.loop` uses the same `cancel()` path for natural loop cleanup and operator cancellation. `cancel()` publishes `SessionStatus terminal/aborted`. `runAgentSession` later publishes `terminal/completed`, but `SessionStatus` intentionally latches the first terminal event, so the success terminal is dropped.

Overlay then maps `terminal/aborted` to `CardStatus.error`. It also does not preserve `terminal.reason`, so the badge helper cannot distinguish cancelled/aborted from a hard error.

## Fix Plan

1. Add a prompt-state cleanup function that removes the loop state without publishing `terminal/aborted`.
2. Use that cleanup function from `SessionLoop.loop` when the loop naturally exits.
3. Keep `cancel()` as the only operator/user cancellation path that publishes `terminal/aborted`.
4. Preserve `session.status.status.reason` on Overlay card nodes so real aborted sessions render as cancelled, not hard error.
5. Add focused regression tests for both backend lifecycle and Overlay projection.

## Acceptance

- A successful worker agent can publish `terminal/completed` after prompt loop cleanup.
- Prompt cancellation still publishes `terminal/aborted`.
- Overlay cards retain `terminalReason="aborted"` for real aborted sessions.
- Targeted tests pass.
