# Tool Diff Open File Button

Date: 2026-06-20

CSS means Cascading Style Sheets. GUI means Graphical User Interface. UI means
User Interface.

## Problem

`InlineToolPart` renders structured tool file diffs with an `href="#"` anchor
that acts like a button by relying on the global `[data-file-path]` click
delegate. Its private `.msg-tool-diff-link` style has a hover-only color change
and no matching keyboard `:focus-visible` state. This creates a hand-written
button/link primitive and gives mouse and keyboard users different visual
feedback.

## Recall

| Source                                              | Existing decision                                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `2026-06-19-retire-message-path-link-residue.md`    | Markdown codespan file links stay as `code .file-link`; tool diff file openers are a separate structured tool surface. |
| `packages/overlay/src/components/ui/Button.tsx`     | Button primitive owns button semantics, variants, tones, disabled handling, and focus-visible chrome.                  |
| `packages/overlay/src/styles/primitives/button.css` | `.oc-button:focus-visible` is the shared keyboard focus source.                                                        |
| `packages/overlay/src/main.tsx`                     | Global `[data-file-path]` activation delegates file opening to `openPathInSelectedEditor(path)`.                       |

## Impact Sweep

| Sweep                                                     | Result                                                              | Decision                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `rg -n "msg-tool-diff-link                                | InlineToolPart                                                      | tool-diff                                                        | data-file-path | openPathInSelectedEditor" packages/overlay/src packages/overlay/test specs/new-arch` | `.msg-tool-diff-link` has one production owner in `InlineToolPart` and one hover-only CSS rule in `messages.css`. | Replace this structured tool opener with `Button`; keep markdown `file-link` unchanged. |
| `rg -n "InlineToolPart                                    | msg-tool                                                            | file-path                                                        | data-file-path | tool diff" packages/overlay/test/browser packages/overlay/test`                      | `message-file-link-browser.test.ts` already boots a real overlay conversation for file-link behavior.             | Extend that fixture with a tool diff card path and focused screenshot.                  |
| `packages/overlay/test/owner-surface-consistency.test.ts` | Message surface guards already protect structured tool card chrome. | Add a guard that the retired hover-only link class stays absent. |

## Fix

- Import `Button` in `InlineToolPart`.
- Render tool diff file openers as
  `Button type="button" variant="ghost" size="sm" tone="accent"
data-ui="tool-diff-open-file"` with the existing `data-file-path` and title.
- Replace `.msg-tool-diff-link` CSS with
  `.oc-button[data-ui="tool-diff-open-file"]` layout-only styling, relying on the
  shared Button primitive for hover and `:focus-visible`.
- Do not change Markdown codespan file links.

## Acceptance

- Static tests reject `class="msg-tool-diff-link"` and `href="#"` in
  `InlineToolPart`.
- Message CSS no longer contains `.msg-tool-diff-link:hover`.
- Browser coverage tabs to `[data-ui="tool-diff-open-file"]`, verifies
  `:focus-visible` and a non-empty outline, presses Enter, and observes the
  existing `[data-file-path]` open-path delegate.
- Screenshot `.scratch/tool-diff-open-file-focus-visible.png` shows the focused
  opener in the real tool diff card.
