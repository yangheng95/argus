# Markdown Link Focus Visible

Date: 2026-06-20

CSS means Cascading Style Sheets. GUI means Graphical User Interface. UI means
User Interface.

## Problem

Independent GUI review found rendered Markdown links have pointer hover feedback
but no tokenized keyboard `:focus-visible` state. This affects both file-path
codespans rendered as `code .file-link` and ordinary Markdown anchors inside
message and `md-content` surfaces.

## Recall

| Source                                           | Existing decision                                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `2026-06-19-retire-message-path-link-residue.md` | `workspace.css` is the only live owner for `code .file-link`; retired `.path-*` styles must stay removed.                                                                |
| `2026-06-20-tool-diff-open-file-button.md`       | Structured tool diff file openers are separate from Markdown file links and already use `Button`.                                                                        |
| `packages/overlay/src/utils/markdown.ts`         | File-ish codespans render as `<a class="file-link" href="#" data-file-path="...">`; ordinary safe links render as anchors with `data-browser-preview-url` for HTTP URLs. |
| `packages/overlay/src/main.tsx`                  | Document-level click delegates open `[data-file-path]` links in the selected editor and HTTP anchors through browser preview/native open flow.                           |

## Impact Sweep

| Sweep                | Result           | Decision                                                                                                        |
| -------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `rg -n "file-link    | data-file-path   | renderMarkdown" packages/overlay/src packages/overlay/test specs`                                      | `markdown.ts` emits `file-link`; `workspace.css` owns it; `message-file-link-browser.test.ts` already covers real rendered file-link hover. | Keep renderer and owner unchanged; extend CSS and browser coverage.                                                                         |
| `rg -n "md-content a | msg-text a       | :hover                                                                                                          | :focus-visible" packages/overlay/src/styles/surfaces/markdown.css packages/overlay/src/styles/surfaces/workspace.css packages/overlay/test` | `workspace.css` has `code .file-link:hover` only; `markdown.css` has `.msg-text a:hover`, `.md-content a:hover`, and `.md-link:hover` only. | Add matching focus-visible states at the shared surface owners. |
| `rg -n 'href="#"     | target="\_blank" | rel="noreferrer"' packages/overlay/src/utils/markdown.ts packages/overlay/src/components packages/overlay/test` | `href="#" data-file-path` is unique to Markdown file codespans; normal HTTP anchors are centralized in the renderer.                        | Do not add per-call-site link behavior.                                                                                                     |

## Fix

- Add `code .file-link:focus-visible` in `workspace.css` with tokenized color,
  underline, outline, outline offset, and radius.
- Add `:focus-visible` states for `.msg-text a`, `.md-content a`, and `.md-link`
  in `markdown.css`.
- Extend static guards so file-link ownership includes focus-visible.
- Extend the existing real overlay `message-file-link-browser.test.ts` fixture
  with both a file codespan and an ordinary HTTP Markdown link, then verify Tab
  focus, visible focus chrome, screenshots, and Enter activation for the file
  link path delegate.

## Acceptance

- `workspace.css` remains the only `code .file-link` style owner.
- File codespan and ordinary Markdown anchors expose visible
  `:focus-visible` chrome without raw colors.
- Browser screenshots:
  `.scratch/message-file-link-focus-visible.png` and
  `.scratch/message-markdown-link-focus-visible.png`.
