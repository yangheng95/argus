# Kobalte TabPanel State Single Source

Date: 2026-06-19

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model. ARIA means Accessible Rich Internet Applications, the
browser accessibility attribute family used by Kobalte primitives.

## Problem

The Kobalte selected-state cleanup removed local `data-active` from tab
triggers, segmented controls, and titlebar radio items. A follow-up independent
audit found one remaining same-class split: `FileChangesPanel` still writes
local `data-active` on Kobalte `Tabs.Content` panels and CSS hides inactive
panels through `.file-changes-view[data-active="false"]`.

That duplicates Kobalte's own content state. Kobalte `Tabs.Content` already
mounts only the selected panel by default and marks the mounted panel with
`data-selected`.

## Recall

| Source | Relevant decision |
| --- | --- |
| `2026-06-19-kobalte-selected-state-single-source.md` | Kobalte runtime state attributes must be the visual source for selected/pressed/checked controls. |
| `2026-06-19-dropdown-menu-highlighted-contrast-source.md` | Kobalte runtime state attributes, not local mirrors, own popup/listbox visibility and selection styling. |
| `packages/overlay/node_modules/@kobalte/core/src/tabs/tabs-content.tsx` | `Tabs.Content` emits `role="tabpanel"`, `aria-labelledby`, and `data-selected` when selected; default presence follows selected state. |
| `packages/overlay/src/components/ui/Tabs.tsx` | `TabPanel` is a thin wrapper over `KobalteTabs.Content`. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "<TabPanel\\b|data-active=\\{|file-changes-view\\[data-active" packages/overlay/src packages/overlay/test` | Only `FileChangesPanel` writes `data-active` on `TabPanel`; `activity.css` has the matching hide rule. | Remove the local panel state and dead CSS rule. |
| `rg -n "data-selected|hidden|Tabs.Content" packages/overlay/node_modules/@kobalte/core/src/tabs` | Kobalte Content owns `data-selected` and selected presence. | Browser tests should assert panel `data-selected`, not local `data-active`. |

## Fix Plan

1. Delete `data-active` from the two `FileChangesPanel` `TabPanel` call sites.
2. Delete `.file-changes-view[data-active="false"]`; Kobalte Content presence
   and `data-selected` are the panel state source.
3. Extend static tests so feature `TabPanel` call sites cannot add
   `data-active`.
4. Extend the browser diff-navigation test to assert selected panels have
   Kobalte `data-selected` and no local `data-active`.

## Acceptance

- `FileChangesPanel` has no `TabPanel` `data-active` attributes.
- `activity.css` has no `.file-changes-view[data-active="false"]` rule.
- Browser diff-navigation proves selected tab panels expose `data-selected`,
  retain ARIA linkage, and do not carry `data-active`.
- No production touched file introduces raw color, parallel token source, or
  impossible Kobalte selector.
