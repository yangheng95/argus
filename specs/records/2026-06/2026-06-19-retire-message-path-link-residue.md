# Retire Message Path Link Residue

Date: 2026-06-19

## Problem

Message CSS still ships the retired `.path-box` / `.path-link` file-path
rendering contract. The live Markdown renderer emits `code .file-link`, and
`workspace.css` owns that styling. Keeping the old message selectors creates a
second CSS source for the same visible file-link surface.

## Recall

| Source                                            | Relevant constraint                                                                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-10-overlay-markdown-url-boundary-fix.md` | File-link code spans stay unchanged inside the shared Markdown renderer while URL preview logic changed.                         |
| `2026-06-18-retire-workspace-panel-residue.md`    | `code .file-link` remains live and is explicitly owned by `workspace.css`.                                                       |
| `overlay-architecture-guards.test.ts`             | Existing guard requires `code .file-link` in `workspace.css`, but did not reject the retired `.path-*` family in `messages.css`. |

## Evidence Sweep

| Command                                                                          | Result                                                                                                                   | Decision                                    |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `rg -n -F 'path-box' packages/overlay/src packages/overlay/test specs/new-arch`  | Only `messages.css` comment/rule hits.                                                                                   | Retire `.path-box`.                         |
| `rg -n -F 'path-link' packages/overlay/src packages/overlay/test specs/new-arch` | Only `messages.css` comment/rules hit.                                                                                   | Retire `.path-link` and its states.         |
| `rg -n -F 'file-link' packages/overlay/src packages/overlay/test specs/new-arch` | `markdown.ts` emits `class="file-link"`; `workspace.css` owns `code .file-link`; guards already pin workspace ownership. | Keep `file-link` as the single live source. |

## Fix

- Remove stale `path-box / path-link` wording from the messages surface
  comment.
- Delete `.path-box`, `.path-link`, `.path-link:hover:not(:disabled)`, and
  `.path-link:disabled` from `messages.css`.
- Extend architecture guards to reject retired `.path-box` / `.path-link` in
  message CSS while preserving `workspace.css` as the `code .file-link` owner.
- Add a browser visual test that renders a real overlay conversation message
  with a file codespan and screenshots the `.file-link` hover state.

## Acceptance

- Production source has no `.path-box` or `.path-link` selectors.
- Markdown file codespans still render as `code .file-link` with
  `data-file-path`.
- `workspace.css` remains the only file-link style owner.
- Focused static tests, typecheck, browser test, and screenshot review pass.
