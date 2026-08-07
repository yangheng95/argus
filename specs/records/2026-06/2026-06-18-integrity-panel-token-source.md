# Integrity Panel Token Source

Date: 2026-06-18

CSS means Cascading Style Sheets. GUI means Graphical User Interface.

## Problem

Independent style review found the Integrity panel uses undefined or
non-canonical tokens: `--border-muted`, `--radius-sm`, `--surface-muted`, and
the local Integrity use of `--oc-radius-sm`.

CSS declarations with `var()` and no fallback become invalid when the custom
property is undefined, so the Integrity report surfaces lose their intended
border, radius, or background chrome. This is most visible on light theme
surfaces where transparent Integrity blocks collapse into the surrounding
white panel.

## Recall

| Source                                             | Relevant constraint                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Pre-June overlay integrity card performance record | Integrity card readability depends on bounded, structured report sections.                        |
| `2026-06-11-integrity-verdict-findings-layout.md`  | Integrity rows should keep flat, readable report grouping.                                        |
| `flat-redesign-radius-coverage.test.ts`            | Runtime border radii must use canonical `--oc-radius-*` tokens, not legacy aliases.               |
| `design-language.css`                              | Defines `--oc-radius-soft`, `--surface-inset`, and control tokens as the canonical single source. |

## Impact Sweep

| Sweep                                                                                           | Result                                                                                                                                          | Decision                                                                               |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `rg -n -g '\*.css' -- '--surface-muted                                                          | --border-muted                                                                                                                                  | --radius-sm' packages/overlay/src/styles`                                              | Runtime hits for `--border-muted`, `--radius-sm`, and `--surface-muted` are limited to Integrity styles in `inspector.css`. | Replace the undefined local tokens at the Integrity call sites. |
| `rg -n -g '*.css' -- 'var\\(--oc-radius-sm' packages/overlay/src/styles/surfaces/inspector.css` | Integrity manifest chips also use `--oc-radius-sm`, which is not one of the canonical radius tokens in `flat-redesign-radius-coverage.test.ts`. | Move the Integrity call site to `--oc-radius-soft` with the rest of the report chrome. |
| `packages/overlay/src/styles/surfaces/inspector.css`                                            | The same file already uses `--border`, `--surface-inset`, and `--oc-radius-soft` for inspector cards and sections.                              | Use those existing tokens directly.                                                    |
| `packages/overlay/test/flat-redesign-radius-coverage.test.ts`                                   | Already rejects non-canonical radius values, but this issue needs a direct guard for undefined Integrity aliases too.                           | Add targeted test assertions against the retired Integrity aliases.                    |

## Fix Plan

1. Replace `var(--border-muted)` with tokenized border expressions using
   `var(--border)`.
2. Replace `var(--radius-sm)` with `var(--oc-radius-soft)`.
3. Replace `var(--surface-muted)` with `var(--surface-inset)`.
4. Add a regression test that rejects the undefined Integrity aliases and pins
   the report/detail/reviewer/manifest surfaces to canonical tokens.

## Acceptance

- `inspector.css` no longer references `--border-muted`, `--radius-sm`,
  `--surface-muted`, or `--oc-radius-sm` in the Integrity panel.
- Integrity report/detail/reviewer/manifest chrome uses existing canonical
  overlay tokens.
- Tests fail if those undefined aliases return.
