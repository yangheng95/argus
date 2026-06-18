# CSS Token Closure

Date: 2026-06-18

CSS means Cascading Style Sheets. GUI means Graphical User Interface.

## Problem

Independent review found `sidebar.css` still references `--oc-radius-sm`, which
is not defined by the overlay design language. Running
`css-token-closure.test.ts` showed the issue is broader: several overlay
surfaces still reference undefined font, radius, color, and border tokens, while
some legitimate component-owned runtime style variables are missing from the
test's explicit runtime set.

Leaving the test red makes token regressions hard to locate; fixing only one
token would keep the guard unusable.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `flat-redesign-radius-coverage.test.ts` | Runtime border radius call sites must use canonical `--oc-radius-*` tokens. |
| `design-language.css` | Defines `--mono`, `--ui-font-*`, `--ui-font-weight-*`, `--oc-border-width`, and `--oc-radius-{none,soft,large,pill}`. |
| `css-token-closure.test.ts` | Surface CSS may reference defined design tokens or explicitly listed runtime style vars. |
| `2026-06-18-integrity-panel-token-source.md` | Undefined local token aliases must be replaced with canonical overlay tokens, not hidden behind new aliases. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `bun test packages/overlay/test/css-token-closure.test.ts` | Fails on undefined real tokens and missing runtime style vars. | Replace real undefined tokens; register only vars written by component runtime. |
| `bun test packages/overlay/test/flat-redesign-radius-coverage.test.ts` | Also exposes three literal / calc radius call sites in `activity.css`, `messages.css`, and `settings.css`. | Move those call sites to the canonical radius set while the same token cleanup is active. |
| `rg -n -- '--oc-radius-sm|--font-mono|--ui-font-mono|--ui-font-size-xs|--ui-font-size-sm|--ui-font-weight|--oc-border-width-strong|--text-subtle' packages/overlay/src/styles` | Offenders are in `activity.css`, `workspace-onboarding.css`, `changes.css`, `inspector.css`, `notifications.css`, `mission.css`, `settings.css`, and `sidebar.css`. | Map them to existing canonical tokens. |
| `rg -n -- 'dialog-drag-x|image-preview-rendered-width|titlebar-menu-anchor-left|center-workbench-panel-grow' packages/overlay/src` | These vars are written by `Dialog.tsx`, `ImagePreview.tsx`, `TitlebarMenubar.tsx`, and `main.tsx`. | Add them to `RUNTIME_STYLE_VARS`; do not create fake design tokens. |

## Fix Plan

1. Replace undefined font family aliases with `var(--mono)`.
2. Replace undefined font size and weight aliases with existing
   `--ui-font-*` and `--ui-font-weight-*` tokens.
3. Replace undefined sidebar radii with `--oc-radius-soft`.
4. Replace undefined settings color/border aliases with existing tokens.
5. Replace remaining non-canonical radius literals with existing radius tokens.
6. Extend `css-token-closure.test.ts` only for vars that are proven runtime
   style inputs.
7. Update stale tests that pinned undefined tokens.

## Acceptance

- `css-token-closure.test.ts` passes.
- `flat-redesign-radius-coverage.test.ts` passes.
- `css-token-closure-browser.test.ts` renders the affected controls and saves
  `.scratch/css-token-closure-light.png` for visual review.
- `rg -- '--oc-radius-sm|--font-mono|--ui-font-mono|--ui-font-size-xs|--ui-font-size-sm|--ui-font-weight\\)|--oc-border-width-strong|--text-subtle' packages/overlay/src/styles` returns no live source hits.
