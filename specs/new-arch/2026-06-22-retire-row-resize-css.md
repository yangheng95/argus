# Retire Row Resize CSS

Date: 2026-06-22
Status: Verified

## Acronyms

- CSS: Cascading Style Sheets, the stylesheet language that owns overlay visual states.
- GUI: Graphical User Interface, the browser-rendered overlay surface.
- UI: User Interface, visible controls and layout surfaces.

## Task Definition

Remove the dead row-resize CSS state from workspace resizing so the overlay has
only the resize state that runtime code can actually emit.

## Recall

| Source                                            | Constraint carried forward                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                       | Remove high-confidence dead CSS only with evidence, test every change, avoid fallback and duplicate state.                 |
| `2026-06-17-left-pane-resizer-accessibility.md`   | Pane pointer/keyboard resize is owned by `services/pane.ts`; `renderPaneLayout()` remains the single pane layout renderer. |
| `2026-06-22-window-resize-center-layout-frame.md` | Pane resize work is already frame-owned; do not add another resize state owner.                                            |
| Independent GUI audit 2026-06-22                  | `body[data-resizing="row"]` exists only in CSS; runtime writes `document.body.dataset.resizing = "true"` and deletes it.   |

## Call Point Inventory

| Surface                      | Evidence                                                                                   | Decision                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Pane resize runtime          | `services/pane.ts` writes `document.body.dataset.resizing = "true"` and deletes it.        | Keep this as the only pane drag body state.                                  |
| Config dialog resize runtime | `ConfigDialogHost.tsx` writes `document.body.dataset.resizing = "true"` and deletes it.    | Keep this shared column-resize cursor state.                                 |
| Workspace CSS                | `workspace.css` defines both `body[data-resizing="row"]` and `body[data-resizing="true"]`. | Delete the unreachable row state.                                            |
| Tests                        | `pane-config.test.ts` already reads pane service and workspace CSS.                        | Add absence guards for row state and presence guard for the live true state. |

## Root Cause

The project used to carry a row-resize body state, but no current runtime code
emits `data-resizing="row"`. Keeping that selector creates an untestable state
and suggests a second resize direction contract that does not exist.

## Implementation

- Deleted `body[data-resizing="row"]` and its descendant row-resize cursor rule
  from `workspace.css`.
- Added `pane-config.test.ts` guards that reject row resize CSS and reject a
  runtime `dataset.resizing = "row"` writer.

## Verification

- `bun test packages/overlay/test/pane-config.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/left-pane-resizer-browser.test.ts`
- Visual QA: viewed `.scratch/left-pane-resizer-desktop-resize.png`,
  `.scratch/left-pane-resizer-component-compact-resize.png`, and
  `.scratch/left-pane-resizer-restored-desktop-resize.png`; existing column
  resize layout remains coherent after deleting the unreachable row state.

## Self Review

- `rg` shows runtime resize writers only assign `dataset.resizing = "true"` or
  delete the dataset property.
- `workspace.css` still keeps the live `body[data-resizing="true"]` column
  resize cursor path.
