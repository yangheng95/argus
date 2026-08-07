# Delegated context inline disclosure

## Recall

- User request: restyle `调度上下文` so it has no card border, reads as part of the surrounding transcript, keeps its disclosure icon beside the label rather than on an opposite edge, and limits expanded content to a fixed-height scrollable area.
- Acceptance: the collapsed control is an inline transparent disclosure with adjacent icon, label, and chevron; expanded context has no enclosing card or left rail and scrolls vertically inside a stable reading height.
- Hard constraints: reuse `DelegatedContextDisclosure` and the existing task-scoped conversation disclosure store; do not alter message/session data, add a rendering path, or create/run UI automation tests.
- Sources read: `DelegatedContextDisclosure.tsx`, `messages.css`, the existing `2026-07-30-delegated-context-color-harmony.md` decision, and the supplied screenshot.
- Whole-repository search: `DelegatedContextDisclosure`, `msg-delegated-context`, `delegated-context-toggle`, `CardParts`, and the localized `transcript.delegated_context` label were searched. The shared component is the sole production renderer and is consumed by the message stream and child-Agent progress views.
- Independent agent feedback: none; no delegated audit was requested.

## Decision

The existing disclosure component remains the single owner of expansion. Its button uses the established ghost primitive and is styled as an inline transparent transcript cue. The expanded body receives one component-scoped height token, vertical scrolling, and overscroll containment; it deliberately has no border, card surface, or separator rail.

## Verification

- Run Overlay typecheck and `git diff --check`.
- Inspect the real native conversation after the currently running client releases the package executable, without UI automation.
