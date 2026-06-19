# File Explorer Row Button Size Source

Date: 2026-06-20

GUI means Graphical User Interface. CSS means Cascading Style Sheets.

## Problem

Independent GUI review found File Explorer rows still have two coupled issues:

- The rows render as bare `<button class="file-explorer-row">`, while the
  panel already uses the shared `Button` primitive for retry and search-clear
  actions.
- Row geometry is split across TypeScript and CSS. `Virtualizer.itemSize` uses
  an unscaled `26`, while CSS renders rows at `calc(26px * var(--ui-scale))`.
  Indentation is also duplicated as an inline `row.depth * 14 + 3` formula and
  CSS grid/padding literals.

When `--ui-scale` is not `1`, the virtualizer can measure a row as 26px while
the DOM paints it larger. That can produce scroll drift and focus-row clipping
in large directories.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-18-file-explorer-row-button-semantics.md` | File Explorer rows intentionally stay command buttons, not an incomplete ARIA tree widget. |
| `2026-06-20-file-explorer-row-focus-visible.md` | Row focus must remain visibly independent from hover and support keyboard activation. |
| `2026-06-18-file-explorer-retry-button-primitive.md` | Non-row File Explorer actions already use the shared `Button` primitive. |
| `FileExplorerPanel.tsx` | Virtualizer and row rendering are in the same component, so geometry constants can be centralized there and exported to CSS variables. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n 'EXPLORER_ROW_HEIGHT|row.depth \\* 14|file-explorer-row' packages/overlay/src packages/overlay/test specs/new-arch` | Production hits are isolated to `FileExplorerPanel.tsx` and `inspector.css`; tests pin native row button semantics and focus-visible CSS. | Update the single live owner and its existing tests. |
| `file-explorer-accessibility.test.ts` | Real browser fixture opens the actual Explorer panel and screenshots row focus. Root fixture currently has too few rows to exercise Virtualizer. | Expand the fixture above the virtualization threshold and set `--ui-scale` to prove geometry alignment. |
| `Button.tsx` / `button.css` | `Button` supports class pass-through and variant data attrs, while allowing surface-specific layout overrides. | Render rows as `<Button variant="ghost" size="sm" tone="neutral">` with row CSS variables for dense layout. |

## Fix Plan

1. Replace both bare row buttons with `Button` and add
   `data-ui="file-explorer-row"`.
2. Centralize row geometry as TypeScript constants in `FileExplorerPanel.tsx`.
3. Export row height and base padding to `.file-explorer-panel` CSS variables,
   and pass only a per-row depth-offset variable to each row.
4. Use the same height constant multiplied by the current `--ui-scale` for
   `Virtualizer.itemSize`.
5. Update `inspector.css` so row height and indentation consume those CSS
   variables rather than hard-coded row geometry literals.
6. Extend static and browser tests to reject the old formula, require
   `.oc-button`, and verify virtualized row geometry at `--ui-scale != 1`.

## Acceptance

- File Explorer rows render through the shared `Button` primitive.
- CSS no longer owns independent `26/14/3` row geometry for the explorer rows.
- `Virtualizer.itemSize` and rendered row height use the same row-height
  constant and current `--ui-scale`.
- Browser evidence proves virtualized rows align at a non-default UI scale.
- Current-file, directory expansion, keyboard focus, and upload behaviors stay
  intact.
