# Tabs Tabpanel Semantic Contract

Date: 2026-06-18

## Problem

The shared `Tabs` primitive delegates tab triggers to Kobalte, but it only
rendered `KobalteTabs.List` and `KobalteTabs.Trigger`. No runtime caller
rendered `KobalteTabs.Content`, so selected tabs had `aria-selected` without a
real controlled `tabpanel`.

## Recall

| Source | Relevant decision |
| --- | --- |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md` | Tabs semantics should be owned by `@kobalte/core/tabs`, preserving `.oc-tabs`, `.oc-tab`, and `data-*` styling contracts. |
| `2026-06-18-settings-segmented-aria-label-forwarding.md` | Non-tab segmented choices should use the shared Kobalte ToggleGroup-backed `SegmentedControl`, not pretend to be tabs. |
| `packages/overlay/node_modules/@kobalte/core/src/tabs/tabs-content.tsx` | Kobalte maps trigger `aria-controls` only after matching `Tabs.Content` registers its content ID; `Tabs.Content` owns `role="tabpanel"` and `aria-labelledby`. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n 'from "./ui/Tabs"|<Tabs|KobalteTabs|role="tabpanel"|Tabs.Content|data-ui="executor-popover-tab"|file-changes-view|browser-preview-size-tabs' packages/overlay/src packages/overlay/test specs/new-arch` | Live `Tabs` callers are `FileChangesPanel`, `ExecutorSelector`, and `BrowserPreviewPanel`. No runtime `role="tabpanel"` exists. | Add `TabList` and `TabPanel` to the primitive; migrate real tabbed surfaces. |
| `FileChangesPanel.tsx` | The tab list is in `SurfaceHeader.actions`, while content sections live in `.file-changes-body`. | Wrap header and body in the same `Tabs` root and render panels in the body. |
| `ExecutorSelector.tsx` | External executor tabs switch between real model-list panels. | Render one `TabPanel` per executor tab plus the disabled panel. |
| `BrowserPreviewPanel.tsx` | Viewport size selector changes a preview parameter, not a tabbed content panel. | Migrate it to `SegmentedControl` with existing `.oc-tabs` / `.oc-tab` visual classes. |

## Fix

- `Tabs` becomes the Kobalte root.
- `TabList` owns `KobalteTabs.List` and the `.oc-tabs` visual contract.
- `Tab` continues to own `KobalteTabs.Trigger` and `.oc-tab`.
- `TabPanel` owns `KobalteTabs.Content`.
- Browser Preview viewport buttons use `SegmentedControl`, not Tabs.

## Acceptance

- Runtime source uses `KobalteTabs.Content` through `TabPanel`.
- File Changes and Executor selected tabs expose a non-empty `aria-controls`
  that points to an existing visible `role="tabpanel"` with
  `aria-labelledby` back to the selected tab.
- Browser Preview viewport controls do not use `Tabs`.
- Existing `.oc-tabs` / `.oc-tab` visual styling remains intact.
- Browser screenshots verify File Changes diff and Executor external popover
  layout after the semantic migration.
