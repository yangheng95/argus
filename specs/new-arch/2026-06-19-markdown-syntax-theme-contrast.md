# Markdown Syntax Theme Contrast

## Context

- `renderMarkdown()` is the central Markdown renderer for cards, dialogs, prompts, reasoning, and message text.
- Prior Markdown work fixed the code-copy button primitive and i18n source, but syntax token contrast was still owned by a theme-independent GitHub Dark palette in `design-language.css`.
- Light-theme code blocks render on `--surface-inset`, so fixed dark-surface syntax tokens made strings, numbers, functions, variables, and diff text low contrast.

## Evidence

| Source                                                   | Finding                                                                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/styles/tokens/design-language.css` | `--oc-syntax-*` tokens were declared at root as a fixed GitHub Dark palette.                                                     |
| `packages/overlay/src/styles/surfaces/markdown.css`      | `.hljs-*` classes consume `--oc-syntax-*`; code block backgrounds use theme token `--surface-inset`.                             |
| `packages/overlay/src/utils/markdown.ts`                 | `renderMarkdown()` registers highlight.js languages and emits `hljs` classes for fenced code.                                    |
| Independent review                                       | Light `--surface-inset` plus fixed GitHub Dark syntax colors produced contrast as low as roughly 1.5:1 for common token classes. |

## Decision

- Move `--oc-syntax-*` out of root design-language tokens and into the three theme cascade files.
- Keep the same token names so `markdown.css` remains the single renderer-side mapping from `hljs` class to syntax intent.
- Use a GitHub Light style syntax palette for `light`.
- Keep the dark syntax palette for `dark` and `vscode-dark`, but raise comment contrast because the real layered surfaces are more translucent than a single flat background estimate.
- Keep the code-block language label on an existing Markdown surface semantic token (`--text-strong`), not on a new syntax token, because it is toolbar metadata rather than highlighted source text.
- Give the code-block toolbar its own existing `--surface-inset` backing. It is an absolutely positioned overlay sibling of the `<pre>` element, so relying on the code block's background as an implicit sibling backdrop leaves contrast dependent on whatever source tokens sit underneath.
- Add a real browser test that loads the overlay app, calls `window.renderMarkdown()`, renders TypeScript and diff fenced code, and measures computed contrast for visible `hljs` tokens across all overlay themes.

## Acceptance

- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/markdown-syntax-contrast-browser.test.ts` passes.
- `.scratch/markdown-syntax-contrast-light.png` is visually reviewed.
- Theme cascade discipline remains green after `--oc-syntax-*` moves to theme files.
- No per-surface `.hljs-*` color patch is introduced.
- Code-block language labels keep at least 4.5:1 contrast in light, dark, and vscode-dark themes.
- Code-block toolbar uses existing surface/border/shadow tokens and no raw color.
