# Conversation Scroll Follow Lock

## Symptom

When the operator scrolls up to read earlier messages, the conversation pane can
still jump back to the bottom while streaming or while cards resize.

## Root Cause

`setupAutoScroll` only disables follow-to-bottom after a recent wheel/touch/key
intent. Real scroll actions can arrive without that marker, including scrollbar
thumb drags, OS-composed scroll events, focus restoration, and WebView2 scroll
normalization. In those cases tracking stays enabled, so resize/mutation
callbacks keep forcing `scrollTop = scrollHeight`.

## Design

- Any upward scroll that leaves the viewport away from the bottom is operator
  intent and disables follow-lock.
- Program-owned jumps use an explicit suppression flag, not heuristic intent
  timing.
- While tracking is false, mutations and resize events must never scroll.
- Returning to the bottom re-enables tracking in `Conversation.tsx`.

## Acceptance

- Scrolling upward without a wheel/key intent disables follow-lock.
- Explicit controller jumps do not call `onUserScrollUp`.
- Content growth while tracking is false preserves the operator's scroll
  position.
