# Browser Evidence Title Font Weight Token

Date: 2026-06-19

CSS means Cascading Style Sheets. UI means User Interface.

## Problem

The browser evidence card title in message tool output used a literal
`font-weight: 600`. That bypassed the overlay typography token contract and
made this evidence title a separate weight source from the rest of the message
surface.

## Recall

| Source                                                | Relevant constraint                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md` | Overlay UI is converging on mature primitives and shared style contracts, not component-local behavior and styling. |
| `2026-06-09-overlay-ui-tech-debt-consensus.md`        | CSS debt should converge on tokenized surface ownership; do not grow local style exceptions.                        |
| `flat-redesign-font-weight-coverage.test.ts`          | Non-token CSS `font-weight` declarations outside `design-language.css` are rejected.                                |
| `InlineToolPart.tsx`                                  | Browser evidence cards render `.msg-browser-evidence__title` for completed tool output with browser metadata.       |

## Evidence Sweep

| Command                                                                     | Result                                                     | Decision                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `rg -n 'font-weight:\s\*[0-9]+                                              | msg-browser-evidence                                       | ui-font-weight' packages/overlay/src/styles/surfaces/messages.css packages/overlay/src/components/InlineToolPart.tsx packages/overlay/src/components/Card.tsx packages/overlay/test specs/new-arch -g '_.css' -g '_.tsx' -g '_.ts' -g '_.md'` | The only live literal in the scanned message surface was `.msg-browser-evidence__title { font-weight: 600; }`; `InlineToolPart.tsx` renders it. | Replace the literal with the existing strong weight token. |
| `bun test packages/overlay/test/flat-redesign-font-weight-coverage.test.ts` | Failed on `messages.css:151: 600`.                         | Keep the strict token coverage test and make the production CSS comply.                                                                                                                                                                       |
| `message-image-preview.test.ts` inspection                                  | The test already owns browser evidence image CSS coverage. | Add a browser evidence title typography assertion there rather than creating a parallel test owner.                                                                                                                                           |

## Fix

- Change `.msg-browser-evidence__title` to
  `font-weight: var(--ui-font-weight-strong)`.
- Add a focused static test that pins this card title to the strong weight
  token.
- Do not add new tokens and do not alter `InlineToolPart.tsx` structure.

## Acceptance

- `flat-redesign-font-weight-coverage.test.ts` passes.
- `message-image-preview.test.ts` passes and covers the browser evidence title
  typography source.
- A real browser test opens the image-preview fixture, expands the tool card,
  captures the browser evidence card, and confirms the title's computed weight
  matches the strong token.
