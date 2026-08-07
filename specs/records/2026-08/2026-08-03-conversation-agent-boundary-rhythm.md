# Conversation agent boundary rhythm

## Recall

- User request: refine the grey divider between adjacent conversation groups because it sits too close to the following Agent title and is visually too heavy.
- Acceptance: the divider has a finer, quieter treatment and a clear gap before the next identity row; message content and group ordering remain unchanged.
- Hard constraints: preserve the existing virtual-item agent-boundary projection; do not add a second separator, alter message data, or create/run UI automation tests.
- Sources read: supplied screenshot, `Conversation.tsx`, and `conversation.css`.
- Whole-repository search: `data-agent-boundary` has one component projection and one stylesheet owner. The stylesheet owner is adjusted in place.
- Independent agent feedback: none.

## Decision

The existing boundary pseudo-element remains the only separator. It moves into a small top gutter, uses a half-pixel visual stroke with a lower-contrast semantic divider mix, and reserves sixteen scaled pixels before the following conversation header.

## Verification

- Run `git diff --check` and Overlay typecheck.
- Inspect the real client after packaging, without UI automation.
