# Command Palette Config Sections Single Source

Date: 2026-06-18

## Problem

`CONFIG_SECTIONS` in `packages/overlay/src/store/dialog.ts` is the single
source for config dialog section ids, labels, and order. `CommandPalette`
kept a separate `SETTINGS_TABS` array and generated settings commands from
that local list.

That local list had already drifted: `skill`, `skill-market`, and `mcp` were
present in the real config dialog and titlebar settings menu, but missing from
Cmd/Ctrl+K. Operators could open those panels through the titlebar, but could
not search for them in the command palette. Future config sections would also
drift unless every caller remembered to update two sources.

## Evidence Sweep

| Search | Result | Decision |
| --- | --- | --- |
| `rg -n "CONFIG_SECTIONS|SETTINGS_TABS|data-config-panel|openConfigDialog|setActiveSection|activeSection" packages/overlay/src packages/overlay/test specs/new-arch` | `CONFIG_SECTIONS` is consumed by `ConfigDialogHost`, `services/dialog.ts`, and `TitlebarMenubar`; `CommandPalette` is the only `SETTINGS_TABS` owner. | Delete `SETTINGS_TABS` and consume `CONFIG_SECTIONS` in `CommandPalette`. |
| `rg -n "skill.market.title|mcp.title|cmdk.settings.providers|cmdk.settings.agent_models" packages/overlay/src packages/overlay/test` | The missing sections already have i18n label keys in `CONFIG_SECTIONS`. | Use `t(section.labelKey)` directly; do not add local label fallback logic. |
| `rg -n "apiJson|/skill|skill/|/mcp|mcp" packages/overlay/src/components/settings/SkillMarketPanel.tsx packages/overlay/src/services packages/overlay/test/browser/controls.test.ts` | The real panels fetch `/skill/installed`, `/skill/directories`, `/skill/market`, and `/mcp`. | Browser regression must provide those fixture endpoints and assert no runtime errors. |

## Fix

- Import `CONFIG_SECTIONS` in `CommandPalette`.
- Generate every `settings:*` command from `CONFIG_SECTIONS`.
- Run settings commands through `openConfigDialog(section.id)` so there is one
  command execution path.
- Remove the local `SETTINGS_TABS` list and the `switchConfigTab` command path.
- Extend static tests to reject a reintroduced local list.
- Extend the real browser test so Cmd/Ctrl+K search opens the MCP and Skill
  Market panels.

## Acceptance

- `CommandPalette` has no `SETTINGS_TABS` constant.
- Adding a config section to `CONFIG_SECTIONS` automatically creates the
  CommandPalette setting command.
- Searching `MCP` in Cmd/Ctrl+K and pressing Enter opens
  `[data-config-panel="mcp"].active`.
- Searching `skill market` in Cmd/Ctrl+K and pressing Enter opens
  `[data-config-panel="skill-market"].active`.
- The browser test serves the real Skill/MCP panel API dependencies and
  asserts no page error, console error, 404, or failed request is emitted.
