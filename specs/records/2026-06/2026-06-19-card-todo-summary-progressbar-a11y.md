# Card Todo Summary Progressbar Accessibility

Date: 2026-06-19

DOM means Document Object Model. UI means User Interface. TODO means task checklist items surfaced from todo tools.

## Problem

Independent GUI accessibility review found the collapsed card TODO progress
indicator renders `role="progressbar"` in both `CardHeader` and `ChatBubble`
without an accessible name. Screen reader users can encounter a bare numeric
progressbar and cannot tell that it describes the collapsed checklist.

The same JSX is duplicated in both renderers, so fixing one surface alone would
leave a visual and accessibility double source.

## Recall

| Source                                          | Relevant constraint                                                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-card-header-nested-interactions.md` | `CardHeader` and `ChatBubble` share the collapsed preview / TODO rows and must keep header actions outside the disclosure button. |
| `12-overlay-card-system.md`                     | Structured card header behavior should have a single owner instead of ad hoc renderer forks.                                      |
| `AGENTS.md` rule 8                              | No double-source design. Shared TODO summary markup must not remain copied in two components.                                     |
| `AGENTS.md` rule 36                             | UI contract changes require tests.                                                                                                |

## Impact Sweep

| Sweep                                  | Result                                                           | Decision                                                                         |
| -------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `rg -n "card\_\_todo-progress          | role=\"progressbar\"                                             | collectTodoSummary" packages/overlay/src packages/overlay/test`                  | Live collapsed TODO progressbar markup exists only in `CardHeader.tsx` and `ChatBubble.tsx`; `TaskProgressBar.tsx` is a separate goals strip. | Extract a card-specific TODO summary component rather than reusing goal progress semantics. |
| `rg -n "progress.heading               | todo" packages/overlay/src/i18n packages/overlay/src/components` | `progress.heading` translates to Goals/目标, which is not the checklist meaning. | Add card TODO-specific i18n keys for accessible label and value text.                                                                         |
| `rg -n "class=\"card\_\_todo-summary\" | card\_\_todo-progress" packages/overlay/test`                    | `chat-bubble.test.ts` pins the duplicated source shape.                          | Update tests to pin the new single owner and accessibility attributes.                                                                        |

## Fix Plan

- Add `CardTodoSummary` as the sole JSX owner for collapsed card TODO summary.
- Keep visual classes unchanged: `.card__todo-summary`, `.card__todo-progress`,
  `.card__todo-count`, and `.card__todo-current`.
- Add `aria-label` and `aria-valuetext` to the progressbar using TODO-specific
  i18n keys.
- Replace the duplicate markup in `CardHeader` and `ChatBubble` with the shared
  component.
- Keep CSS unchanged; this is an accessibility and ownership correction, not a
  visual redesign.

## Acceptance

- `CardHeader.tsx` and `ChatBubble.tsx` import and render `CardTodoSummary`.
- Neither renderer owns raw `.card__todo-progress` JSX.
- The sole progressbar owner has `aria-label`, `aria-valuenow`, `aria-valuemin`,
  `aria-valuemax`, and `aria-valuetext`.
- English and Chinese locale files include the TODO progress keys.
- Existing collapsed card visual classes remain unchanged.
