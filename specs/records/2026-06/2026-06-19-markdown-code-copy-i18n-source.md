# 2026-06-19 Markdown Code Copy i18n Source

i18n means internationalization. DOM means Document Object Model. HTML means
HyperText Markup Language.

## Problem

Markdown fenced-code copy buttons still emit English `Copy code`, `Copied`, and
`Copy failed` strings from the shared markdown renderer and delegated click
handler. In a `zh-CN` overlay, keyboard and screen-reader users still get
English accessible names and copy feedback for every rendered code block.

## Recall

| Source                                              | Relevant constraint                                                                                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                         | User-visible strings must follow the existing i18n system; no per-entry fallback strings.                                                            |
| `2026-06-19-markdown-code-copy-button-primitive.md` | The copy control is a shared generated HTML path: `wrapCodeBlock` emits the button and `main.tsx` delegates behavior through `button[data-md-copy]`. |
| `packages/overlay/src/utils/i18n.ts`                | Components and utilities can call strict `t()` once locale data is loaded.                                                                           |
| `2026-06-19-image-preview-dialog-i18n-source.md`    | Copy feedback state should keep semantic keys or labels from i18n rather than English message strings.                                               |

## Impact Sweep

| Sweep                                                                              | Result                                                                                | Decision                                                                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `rg -n 'Copy code                                                                  | Copied                                                                                | Copy failed                                                                                     | data-md-copy | wrapCodeBlock' packages/overlay/src packages/overlay/test specs` | Active production literals are in `utils/markdown.ts` and `main.tsx`; browser and markdown-safety tests assert the English strings. | Fix the shared generated HTML and delegated listener, then update both tests. |
| `rg -n 'renderMarkdown\\(' packages/overlay/src packages/overlay/test`             | Markdown rendering is used across cards, dialogs, prompts, reasoning, and text parts. | Do not fix per surface; the renderer label must be localized once.                              |
| `rg -n 'markdown\\.' packages/overlay/src/i18n`                                    | No code-copy markdown namespace exists.                                               | Add `markdown.copy_code`, `markdown.copied`, and `markdown.copy_failed` to both locale bundles. |
| `git status --short -- packages/overlay/src/i18n/*.json specs/records/2026-06/2026-06-29-spec-consolidation.md` | Locale and HISTORY files already contain unrelated unstaged work.                     | Stage only this hunk when committing.                                                           |

## Fix Plan

1. Import `t()` in `utils/markdown.ts` and use it for generated `title` and
   `aria-label` on `data-ui="markdown-code-copy"`.
2. Use `t()` in `main.tsx` delegated copy feedback and restore path; preserve
   the original localized label captured from the rendered button.
3. Add locale keys for English and Chinese.
4. Update markdown safety tests to install real locale data and assert the
   generated HTML uses the current locale.
5. Update the Node browser test to render the button in Chinese, exercise the
   real copied state, check for no overflow, and save a screenshot.

## Acceptance

- Production `utils/markdown.ts` and `main.tsx` contain no hard-coded English
  markdown copy labels or feedback strings.
- Markdown code-copy tests prove both locale bundles contain the keys and the
  rendered HTML uses localized labels.
- Browser evidence verifies a focused/clicked Chinese markdown copy button
  keeps the shared Button chrome and does not overflow.
