# Settings TabPanel Active Test Contract

Date: 2026-06-18

## Acronyms

- UI: User Interface, the visible settings dialog and titlebar menus.
- DOM: Document Object Model, the rendered browser element tree.

## Problem

`2026-06-18-settings-dialog-tabs-primitive.md` moved settings navigation to the
shared `Tabs` primitive. Production `ConfigDialogHost` now renders settings
content through `TabPanel` and no longer emits `.config-tab-panel.active`.
Several browser tests and one historical command-palette note still used the
retired `.active` class as the active panel source. One command-palette browser
wait had already moved away from `.active`, but still read the first
`.config-tab-panel[data-config-panel]`, which is also not the selected panel
source once multiple Kobalte `TabPanel` nodes can exist.

That creates a test double source: the production state source is the current
rendered Kobalte `TabPanel`, while tests wait for a class that no longer exists.

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n 'class="config-tab-panel active"|\.config-tab-panel\.active' packages/overlay/src packages/overlay/test specs/new-arch` | Production and static tests reject the old class; only historical text mentions it positively. | Keep production unchanged and update the stale historical acceptance wording. |
| `rg -n '\[data-config-panel="[^\"]+"\]\.active|data-config-panel.*classList\.contains\("active"\)' packages/overlay/test/browser` | Stale browser waits appear in settings/titlebar/provider/runtime icon tests. | Replace them with the current rendered `data-config-panel` selector and panel content evidence. |
| `rg -n 'querySelector\("\.config-tab-panel\[data-config-panel\]"\)' packages/overlay/test/browser` | Command Palette read the first panel instead of the target panel. | Query the target `[data-config-panel="..."]` and its rendered body/content. |
| `packages/overlay/src/components/ConfigDialogHost.tsx` | `TabPanel` owns role and visibility; `data-config-panel` remains the stable test hook. | Use `[data-config-panel="..."]` plus expected content/child selectors, not `.active`. |

## Fix Plan

1. Update browser tests that wait for `[data-config-panel="..."].active` or
   `classList.contains("active")`.
2. Update browser tests that read the first `.config-tab-panel[data-config-panel]`.
3. Keep each test's user-facing evidence check: expected panel content,
   field label, avatar icon, provider controls, MCP/skill rows, etc.
4. Update the older command-palette config-sections note so its acceptance
   describes `data-config-panel` current panel evidence instead of `.active`.

## Acceptance

- No browser test requires `.config-tab-panel.active` or
  `[data-config-panel="..."].active`.
- No browser test checks `classList.contains("active")` on a config panel.
- No browser test reads the first `.config-tab-panel[data-config-panel]` as the
  selected panel.
- Tests still assert the target settings panel is present and its expected
  content appears.
- The existing settings Tabs primitive guards remain unchanged and continue to
  reject the retired class in production.
