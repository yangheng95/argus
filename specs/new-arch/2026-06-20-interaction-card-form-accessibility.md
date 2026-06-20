# Interaction Card Form Accessibility

Date: 2026-06-20

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `AGENTS.md` | Shared UI surfaces must use one component path, avoid fallback behavior, and verify frontend changes with a real rendered screenshot. |
| `2026-06-04-mission-question-rendering.md` | Raw mission questions and engine interactions intentionally render through the same `InteractionCard` path. |
| `2026-06-19-interaction-card-textarea-primitive.md` | Inline and dialog question custom replies already share `AutoGrowTextarea` plus `.composer-textarea`; do not add a second input primitive. |
| `InteractionDialogHost.tsx` | The dialog body reuses `InteractionCard`, so semantic fixes in the card cover the popup and inline timeline surfaces together. |

## Evidence Sweep

| Target | Result | Decision |
| --- | --- | --- |
| `rg "<InteractionCard|InteractionCard\\b|interaction-card__question|interaction-card__error|interaction-card__custom-input" packages/overlay/src packages/overlay/test specs/new-arch` | `InteractionCard` renders only from `CardParts` and `InteractionDialogHost`; tests already cover the shared textarea path. | Fix the shared component directly; do not add a parallel question form. |
| `InteractionCard.tsx` | Question groups are plain `div` containers, the custom textarea relies on placeholder text, and the error is a plain `div`. | Use `fieldset`/`legend`, `aria-labelledby`, `aria-describedby`, and an assertive alert region. |
| Huygens independent review | Text buttons override visible labels with explanatory `aria-label`s, and slow submissions expose only `disabled` controls without a card-level busy status. | Remove text-button `aria-label` overrides, keep visible text as the accessible name, and add a localized polite busy status. |
| `card.css` | Existing question styles are class-based and can be kept while resetting native fieldset/legend chrome. | Preserve visual density with a small fieldset reset instead of hand-writing a new form surface. |
| `interaction-card-textarea-browser.test.ts` | The fixture renders both inline and dialog cards and already captures screenshots. | Extend this real browser fixture to verify labels, descriptions, focus, error live region, and screenshots in both surfaces. |

## Fix

- Add stable per-question ids derived from `interaction.id` and the question index.
- Render every question as a `fieldset` and expose the visible question/header as a `legend`.
- Label each custom `AutoGrowTextarea` with the legend through `aria-labelledby`, while keeping the placeholder only as helper text.
- Connect option descriptions through `aria-describedby` so labels do not flatten metadata into unnamed text.
- Mark reply failures as `role="alert"` with `aria-live="assertive"` so assistive technologies announce failed submissions.
- Add card-level `aria-busy` and a localized `role="status"` message while a reply/reject request is pending.
- Remove explanatory `aria-label`s from visible text buttons; keep descriptions in `title` so the accessible name matches the visible label.
- Keep the existing `Button` and `AutoGrowTextarea` primitives; this change only corrects semantics around them.

## Acceptance

- Real browser fixture proves inline and dialog questions have `fieldset` + `legend`.
- Inline and dialog custom textareas have a non-placeholder accessible name via `aria-labelledby`.
- Option descriptions are connected with `aria-describedby`.
- A failed answer shows one assertive alert and focus remains in the interaction card.
- A pending answer sets `aria-busy="true"`, exposes a polite status, disables controls, and keeps focus inside the interaction card.
- Text buttons remain findable by their visible labels and no longer carry overriding `aria-label`s.
- Screenshots are captured and visually reviewed for the inline card and dialog after the semantic changes.
