# Kobalte Selected State Single Source

Date: 2026-06-19

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model. ARIA means Accessible Rich Internet Applications, the
browser accessibility attribute family used by Kobalte primitives.

## Problem

The dropdown highlighted-state fix removed several impossible or missing
`data-highlighted` styles, but the next independent audit found a deeper
pattern: some shared primitives still duplicated Kobalte selection state through
local `data-active` props. That leaves the visual source and accessibility source
split across two owners.

## Recall

| Source                                                                                 | Relevant decision                                                                                       |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `2026-06-19-dropdown-menu-highlighted-contrast-source.md`                              | Kobalte runtime state attributes must be the visual source for highlighted/selected popup options.      |
| `2026-06-18-select-control-shell-single-source.md`                                     | SelectControl is the single Kobalte Select shell owner.                                                 |
| `2026-06-18-settings-dialog-tabs-primitive.md`                                         | Settings and panel tabs must use the shared Tabs primitive rather than hand-written ARIA.               |
| `2026-06-18-titlebar-view-radio-focus-single-source.md`                                | Titlebar theme radio items are live Kobalte menubar radio items and keyboard focus must remain visible. |
| `packages/overlay/node_modules/@kobalte/core/src/tabs/tabs-trigger.tsx`                | Tabs Trigger emits `aria-selected`, `data-selected`, and `data-highlighted`.                            |
| `packages/overlay/node_modules/@kobalte/core/src/toggle-button/toggle-button-root.tsx` | ToggleGroup items emit `aria-pressed` and `data-pressed`.                                               |
| `packages/overlay/node_modules/@kobalte/core/src/menu/menu-item-base.tsx`              | Menubar radio items emit `aria-checked`, `data-checked`, and `data-highlighted`.                        |
| `packages/overlay/node_modules/@kobalte/core/src/listbox/listbox-item.tsx`             | Select/Listbox items emit `aria-selected`, `data-selected`, and `data-highlighted`.                     |

## Impact Sweep

| Sweep                         | Result          | Decision                                                          |
| ----------------------------- | --------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `rg -n "<Tab\\b               | active=\\{      | oc-tab\\[data-active" packages/overlay/src packages/overlay/test` | Shared `Tab` call sites are `ConfigDialogHost`, `FileChangesPanel`, and `ExecutorSelector`. CSS overrides live in `tabs.css`, `activity.css`, `composer.css`, `changes.css`, and `settings.css`. | Remove `TabProps.active` and style Kobalte `[data-selected]` / `[data-highlighted]`.                                                   |
| `rg -n "SegmentedControl      | s-segmented-btn | app-dialog-decision\_\_choice                                     | data-active                                                                                                                                                                                      | data-pressed" packages/overlay/src packages/overlay/test`                                                                              | Shared segmented consumers are settings primitives, AppDialog decisions, Browser Preview viewports, and FileChanges status filters.         | Remove wrapper `data-active`; style Kobalte `[data-pressed]`. |
| `rg -n "titlebar-theme-option | data-active     | data-checked                                                      | aria-checked                                                                                                                                                                                     | Menubar\\.RadioItem" packages/overlay/src/components/titlebar packages/overlay/src/styles/surfaces/titlebar.css packages/overlay/test` | Only the theme radio item uses Kobalte Menubar radio with local `data-active`; menu trigger `data-active` is not the same semantic surface. | Retire theme option `data-active`; style `[data-checked]`.    |
| `rg -n "oc-select-option      | data-selected   | aria-selected                                                     | SelectControl" packages/overlay/src/components packages/overlay/src/styles/surfaces/field.css packages/overlay/test`                                                                             | Shared Select options style highlighted/hover but not selected-only rows.                                                              | Add selected-only row styling and extend matrix coverage.                                                                                   |

## Fix Plan

1. Remove `active` from the shared `Tab` API and all `<Tab>` call sites.
2. Change tab CSS from local `[data-active="true"]` to Kobalte
   `[data-selected]`, and add `[data-highlighted]` hover-equivalent styling.
3. Remove `data-active` from `SegmentedControl`; update settings/dialog CSS and
   tests to use `[data-pressed]`.
4. Remove titlebar theme radio `data-active`; use `[data-checked]` for the
   selected visual state and keep `[data-highlighted]` for roving focus.
5. Add `.oc-select-option[data-selected]` selected-only row styling and update
   the browser contrast matrix with selected-only, highlighted-only, and
   selected+highlighted samples.
6. Keep unrelated business `data-active` surfaces unchanged: task rows, panels,
   resizers, recent-directory current location, prompt profile list rows, and
   titlebar menu trigger open state.

## Acceptance

- Shared `Tabs.tsx` contains no `active` prop and no local `data-active` output.
- Shared `SegmentedControl.tsx` contains no local `data-active` output.
- Titlebar theme radio items contain no local `data-active` output.
- Kobalte selected/pressed/checked/highlighted state selectors are covered by
  static tests.
- Real browser tests confirm selected tab/segmented/radio/select states remain
  visible and accessible.
- Production touched files introduce no raw color, parallel token source, or
  impossible Kobalte state selector.
