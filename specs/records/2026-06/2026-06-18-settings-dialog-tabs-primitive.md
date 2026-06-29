# Settings Dialog Tabs Primitive

Date: 2026-06-18

UI means User Interface. ARIA means Accessible Rich Internet Applications.

## Problem

Independent GUI review found that the settings dialog shell still hand-writes
its sidebar tab interaction with plain buttons, an `active` class, and a single
locally shown `.config-tab-panel`. That leaves tab selection semantics outside
the shared Kobalte-backed `Tabs` primitive even though the rest of the overlay
already treats tab semantics as primitive-owned.

## Recall

| Source                                                       | Relevant constraint                                                                                                                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md`        | Tabs semantics should be owned by `@kobalte/core/tabs`, preserving the shared primitive contract.                                                                     |
| `2026-06-18-tabs-tabpanel-semantic-contract.md`              | Real tabbed surfaces must render `Tabs`, `TabList`, `Tab`, and `TabPanel` so Kobalte owns `aria-selected`, `aria-controls`, `role="tabpanel"`, and `aria-labelledby`. |
| `2026-06-18-settings-primitives-single-source-completion.md` | Settings surfaces should extend existing primitives instead of keeping local row/group/status interaction chrome.                                                     |
| `packages/overlay/src/store/dialog.ts`                       | `CONFIG_SECTIONS` is the single source for settings tab order and labels.                                                                                             |
| `packages/overlay/src/services/dialog.ts`                    | `switchConfigTab` is the existing state write entrypoint and normalizes unknown tab names to `general`.                                                               |

## Impact Sweep

| Sweep                                                                                   | Result                                                                                         | Decision                                                                                                                            |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n -F "config-nav-item" packages/overlay/src packages/overlay/test specs`  | Production owner is `ConfigDialogHost`; CSS and tests preserve `.config-nav-item.active`.      | Retire local nav item classes and render sidebar triggers through `Tab`.                                                            |
| `rg -n -F "config-tab-panel" packages/overlay/src packages/overlay/test specs` | Production owner is the single active panel in `ConfigDialogHost`; CSS/tests expect `.active`. | Render the content through `TabPanel`; keep `config-tab-panel` as the panel surface class but remove `.active` as the state source. |
| `rg -n -F "switchConfigTab" packages/overlay/src packages/overlay/test specs`  | Used by `ConfigDialogHost`, `focusConfigSection`, and command-palette guard docs.              | Keep the service as the state write source; pass it to `Tabs.onValueChange`.                                                        |
| `rg -n -F 'from "./ui/Tabs"' packages/overlay/src packages/overlay/test specs` | Runtime callers are `FileChangesPanel` and `ExecutorSelector`; `ConfigDialogHost` is missing.  | Add `ConfigDialogHost` as a Tabs caller and update primitive guards.                                                                |
| `rg -n -F "<Tabs" packages/overlay/src packages/overlay/test specs`            | Runtime tabbed surfaces are File Changes and Executor only.                                    | Settings dialog becomes the third real tabbed surface.                                                                              |

## Fix Plan

1. Import `Tabs`, `TabList`, `Tab`, and `TabPanel` in `ConfigDialogHost`.
2. Make `.config-dialog-layout` the `Tabs` root while preserving the existing
   resizer and content layout.
3. Render the sidebar as a `TabList` inside the existing `nav#configSidebar`.
   Each entry becomes a `Tab` with `data-config-tab`, `data-active`, icon,
   label, and optional badge content.
4. Replace `.config-nav-spacer` with a data attribute on the About tab so the
   tablist contains tab triggers only.
5. Render the right content with `TabPanel` and keep `data-config-panel` for
   existing tests and CSS hooks.
6. Update CSS selectors from `.config-nav-item.active` to
   `.config-sidebar .oc-tab[data-active="true"]`, and remove `.active` as the
   panel visibility source.
7. Update unit/browser tests to reject the old hand-written tab shell and prove
   selected tabs have Kobalte ARIA wiring plus visible screenshot evidence.

## Acceptance

- `ConfigDialogHost` uses the shared `Tabs` primitive.
- Settings sidebar triggers expose tab semantics through Kobalte, not local
  `button.active` state.
- The selected settings tab has `aria-selected="true"` and `aria-controls`
  pointing at a visible `role="tabpanel"`.
- The panel has `aria-labelledby` pointing back to the selected tab trigger.
- The resizer still controls `configSidebar`.
- Memory tab remains full-height and scrollable.
- No production code or tests require `.config-nav-item` or
  `.config-tab-panel.active` as the state source.
- Browser screenshot review confirms General and About tabs remain readable.
