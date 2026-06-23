# Card Header Metadata Tooltip Accessibility

Date: 2026-06-19

ARIA means Accessible Rich Internet Applications. UI means User Interface.

## Problem

Independent GUI accessibility review found the card header metadata rail had
one visual owner but inconsistent semantics:

- model and context chips had visible text plus `title` and `aria-label`, but
  long values were still truncated and only mouse hover could reveal the full
  text visually;
- usage exposed input/output/total/cost breakdown only through `title`;
- context token i18n strings used `{value}` while the panel translator only
  expands `{{value}}`, so tooltip and ARIA copy could show a literal
  placeholder.

## Recall

| Source                                           | Relevant constraint                                                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `2026-06-19-card-header-chrome-single-source.md` | `CardHeaderChrome.tsx` is the sole TSX owner for metadata and action rail chrome.                                    |
| `2026-06-18-card-header-nested-interactions.md`  | Header disclosure and action controls are siblings; metadata fixes must not reintroduce nested interactive controls. |
| `AGENTS.md` rule 8                               | Metadata semantics must not split into separate model/context/usage implementations.                                 |
| `AGENTS.md` rule 36                              | Accessibility behavior changes require tests.                                                                        |

## Impact Sweep

| Sweep                      | Result             | Decision                                                                                      |
| -------------------------- | ------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `rg -n "card\_\_model-hint | card\_\_token-hint | card\_\_usage-hint                                                                            | usageTip                                                                                                      | usage_tooltip" packages/overlay/src packages/overlay/test specs/new-arch` | Production metadata owner is only `CardHeaderChrome.tsx`; CSS owner is `card.css`. | Add one shared `CardMetaHint` inside `CardHeaderChrome.tsx`. |
| `rg -n "Tooltip            | Popover            | @kobalte/core" packages/overlay/src packages/overlay/node_modules/@kobalte/core/dist/tooltip` | The project already uses Kobalte primitives, and Kobalte Tooltip is installed though not yet wrapped locally. | Use Kobalte Tooltip rather than hand-writing hover/focus behavior.        |
| `rg -n "\{value\}          | \{\{value\}\}      | card.context_tokens_tooltip" packages/overlay/src/i18n packages/overlay/test`                 | Only `card.context_tokens_tooltip*` still used single-brace placeholders.                                     | Convert these keys to `{{value}}` and pin them in tests.                  |

## Fix Plan

- Add `CardMetaHint` as the single metadata chip primitive inside
  `CardHeaderChrome.tsx`.
- Render model, context token, and usage chips through Kobalte Tooltip with the
  same detail string wired to `title`, `aria-label`, and tooltip content.
- Make chips focusable static text (`as="span"`, `tabIndex={0}`), not buttons.
- Localize usage breakdown labels and the session model settings button.
- Keep `.card__model-hint`, `.card__token-hint`, and `.card__usage-hint`
  visual classes unchanged so the header layout does not change.

## Acceptance

- `CardHeaderChrome.tsx` imports `@kobalte/core/tooltip`.
- Model/context/usage metadata render through `CardMetaHint`.
- `.card__usage-hint` has localized accessible detail and no longer relies on
  `title` only.
- Context token i18n strings use `{{value}}`.
- Browser evidence verifies focus opens a tooltip and the card header layout
  remains visible.
