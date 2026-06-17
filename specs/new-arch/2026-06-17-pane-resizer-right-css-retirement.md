# Right Pane Resizer CSS Retirement

Date: 2026-06-17

CSS means Cascading Style Sheets. UI means User Interface.

## Problem

`packages/overlay/src/styles/surfaces/workspace.css` still references
`.pane-resizer-right` in the mobile pane handle hiding rule. The current default
pane owns only `#leftPaneResizer`; the right side of the workbench is handled by
the center workbench separators and side activity panels.

Keeping `.pane-resizer-right` makes the removed right pane handle look like an
available CSS contract and weakens dead-code scans.

## Call Points

| Search | Evidence | Decision |
| --- | --- | --- |
| `rg -n "pane-resizer-right|rightPaneResizer|rightHandleId|pane-resizer-left|leftPaneResizer" packages/overlay/src packages/overlay/test specs/new-arch` | Runtime DOM has only `leftPaneResizer`; tests assert `rightPaneResizer` is absent; `PANEL_PANE_CONFIG.rightHandleId` is `null`; `.pane-resizer-right` only appears in CSS. | Delete the dead `.pane-resizer-right` selector. |
| `packages/overlay/src/services/pane.ts` `PANEL_PANE_CONFIG` | `rightHandleId: null` and `rightControls: null` are the current single source. | Do not add a placeholder right handle. |
| Browser tests | `pane-collapse-*`, `side-activity-toolbar-browser`, and `titlebar-menubar` already assert `#rightPaneResizer` is absent. | Add a static CSS regression for the class name. |

## Fix Shape

- Remove `.pane-resizer-right` from `workspace.css`.
- Add a static test proving the DOM/config keep no right pane handle and the
  CSS no longer exposes the dead selector.

## Verification

- `bun test packages/overlay/test/pane-resizer-css.test.ts`
- `bun run --cwd packages/overlay typecheck`
- Browser smoke with an existing pane/resizer browser test.
