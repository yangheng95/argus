# Settings Primitives Single Source Completion

Date: 2026-06-18

CSS means Cascading Style Sheets. DOM means Document Object Model. UI means User Interface.

## Problem

Independent GUI review found that `components/settings/primitives.tsx` already
declares `.s-*` as the required settings surface vocabulary, but several active
settings panels still create older row/group/status containers directly:

- `.config-panel-group`
- `.config-panel-card`
- `.config-toggle-list-item`
- `.agent-model-row`
- `.provider-flat-row`
- `.provider-count-pill`
- `.provider-row-status`
- `.ext-group`
- `.ext-group-body`
- `.extension-row`
- `.extension-row-main`
- `.extension-row-actions`
- `.extension-status`

That is a real double-source issue, not just stale CSS. The old selectors still
own layout or status chrome in production DOM, while the primitive layer claims
to be the single source.

## Recall

| Source                                                                      | Relevant constraint                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/overlay/src/components/settings/primitives.tsx`                   | Panels must compose primitive components instead of hand-writing wrapper DOM so tokens stay enforced.                                                                                                                                |
| `packages/overlay/src/styles/surfaces/settings.css` primitive migration map | `extension-row`, `provider-flat-row`, `agent-model-row`, `config-toggle-list-item` should converge on `.s-row`; `config-panel-group` and `ext-group` should converge on `.s-group`; status/count pills should converge on `.s-pill`. |
| `specs/records/2026-06/2026-06-17-settings-select-primitive-single-source.md`      | Settings-local Kobalte selects were already moved behind `SettingsSelect`; new work should extend primitives rather than reintroduce local wrappers.                                                                                 |
| `specs/records/2026-06/2026-06-18-retire-settings-config-shell-residue.md`         | Retired settings shells should be removed once no production creation points remain.                                                                                                                                                 |
| `specs/records/2026-06/2026-06-18-retire-settings-extension-memory-residue.md`     | Earlier cleanup intentionally kept live `.ext-group` / `.extension-row*` selectors because they still had production owners; this pass must migrate those owners first.                                                              |
| `specs/records/2026-06/2026-06-18-settings-surface-header-residue.md`              | Settings headings already use `SurfaceHeader`; no need to recreate header chrome.                                                                                                                                                    |

## Impact Sweep

| Sweep                                                                                                                                    | Result                                                                                                            | Decision                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n -F "config-panel-group" packages/overlay/src/components/settings packages/overlay/test specs`                            | Production owners: `GeneralPanel`, `NetworkPanel`, `AgentModelsPanel`, `ProvidersPanel`, `PromptCatalog`.         | Migrate group wrappers to `SettingsPanel` / `SettingsGroup`; preserve `SurfaceHeader` semantics only where primitive group actions are insufficient.                                         |
| `rg -n -F "config-toggle-list-item" packages/overlay/src/components/settings packages/overlay/test specs`                       | Production owners: `GeneralPanel`, `NetworkPanel`; browser test targets the old selector.                         | Replace with `SettingsRow` rows and update the browser test selector to `.s-row`.                                                                                                            |
| `rg -n -F "provider-flat-row" packages/overlay/src/components/settings packages/overlay/src/styles packages/overlay/test specs` | Production owner: `ProvidersPanel`; CSS owns responsive grid and tests pin grid areas.                            | Render provider entries through `SettingsRow` while keeping provider-specific grid classes for business layout. Delete old `provider-flat-row` selector.                                     |
| `rg -n -F "extension-row" packages/overlay/src/components/settings packages/overlay/src/styles packages/overlay/test specs`     | Production owners: `ChannelsPanel`, `SkillMarketPanel`; side activity CSS/tests also address compact left panels. | Render settings extension rows through `SettingsRow` with domain classes. Move compact layout selectors to `.sidebar-tool-panel .s-row[...]` instead of `.extension-row`.                    |
| `rg -n -F "extension-status" packages/overlay/src packages/overlay/test specs` after component migration                        | No production TSX/HTML owner remains; hits are CSS, tests, and this spec.                                         | Retire `.extension-status` from inline-pill and activity CSS, then update tests to treat `SettingsPill` and `gwg-priority-badge` as the live pill owners.                                    |
| `rg -n -F "market-card" packages/overlay/src/components/settings packages/overlay/src/styles packages/overlay/test specs`       | Skill market cards remain one repeated card/list item, not a generic row.                                         | Migrate the row chrome to `SettingsRow` only if doing so preserves card action layout; otherwise keep market-specific classes but remove settings status direct creation via `SettingsPill`. |
| `rg -n -F "ext-group" packages/overlay/src/components/settings packages/overlay/src/styles packages/overlay/test specs`         | `SkillMarketPanel` owns skill, MCP, and market groups; activity CSS uses compact panel variants.                  | Extend `SettingsGroup` to forward section attributes/events, then use it as the group primitive with domain classes/data attributes.                                                         |

## Fix Plan

1. Extend `SettingsGroup`, `SettingsRow`, and `SettingsPill` so primitives can
   forward safe HTML attributes, `class`, and event handlers while still owning
   `.s-group`, `.s-row`, and `.s-pill` output.
2. Migrate `GeneralPanel`, `NetworkPanel`, `AgentModelsPanel`, `ProvidersPanel`,
   `ChannelsPanel`, `PromptCatalog`, and `SkillMarketPanel` away from old group,
   row, and status creation points.
3. Keep business/domain classes only for domain layout details that are not the
   primitive itself, such as provider grid areas and channel action clusters.
4. Replace settings status/count badges with `SettingsPill` and a small local
   tone mapping helper where status strings do not match primitive tone names.
5. Update CSS selectors so `.s-row` and `.s-group` own shared chrome. Delete old
   settings-specific row/group selectors once no component creates them.
6. Update unit and browser tests from preserving old selectors to rejecting old
   settings DOM creation points and verifying `.s-*` primitive adoption.
7. Run targeted unit tests, overlay typecheck, and browser visual checks for
   General settings and left activity Skill/MCP compact panels.

## Acceptance

- Settings components outside `primitives.tsx` do not hand-write the old row or
  group selectors listed in Problem.
- `SettingsGroup` / `SettingsRow` / `SettingsPill` remain the only source of
  `.s-group`, `.s-row`, and `.s-pill` DOM output.
- Provider rows keep the existing responsive grid areas and action/key/model
  layout.
- General and Network checkbox rows still expose real checkbox controls and
  keep hover/focus wash through primitive `interactive` rows.
- Skill/MCP compact left panels still show title, detail/path, actions, and
  status without overflow.
- Tests no longer require `.extension-row` / `.provider-flat-row` / old config
  rows to exist.
- Browser screenshots for General settings and compact Skill/MCP panels confirm
  the migration did not regress visible density or readability.
