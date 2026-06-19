# Agent Models i18n Source

Date: 2026-06-19

i18n means internationalization. GUI means Graphical User Interface.

## Problem

Independent GUI review found the Agent Models settings panel still rendered
`title="Agent Models"` even though the settings section already has the shared
`cmdk.settings.agent_models` locale key. In Chinese UI this made the sidebar
and titlebar entry translate while the panel heading stayed English.

The same panel also kept English user-facing labels for model tiers, inherited
agent overrides, unavailable override labels, and per-agent saving status.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `packages/overlay/src/store/dialog.ts` | `CONFIG_SECTIONS` is the single source for settings section ids, order, and label keys. |
| `2026-06-18-command-palette-config-sections-single-source.md` | Settings sections should use existing `CONFIG_SECTIONS` i18n labels directly; no local label fallback logic. |
| `2026-06-18-settings-primitives-single-source-completion.md` | Settings panels must compose shared `SettingsPanel` / `SettingsGroup` primitives without reintroducing local header chrome. |
| `packages/overlay/src/i18n/en-US.json` / `zh-CN.json` | Agent Models strings already live in the locale catalog. |

## Evidence Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "agent_models|Agent Models|SettingsGroup title|cmdk.settings" packages/overlay/src packages/overlay/test specs/new-arch` | `cmdk.settings.agent_models` exists in both locale files and `CONFIG_SECTIONS`; `AgentModelsPanel.tsx` hard-coded the group title; the static guard expected that literal. | Replace the literal with `t("cmdk.settings.agent_models")` and update the guard. |
| `rg -n "Core —|Lightweight —|Internal —|inherit project default|saving…" packages/overlay/src/components/settings/AgentModelsPanel.tsx` | Additional Agent Models strings were still English literals inside the same visible panel. | Add scoped `agent_models.*` keys and use `t()`. |
| Real browser Agent Models run under `zh-CN` | The per-agent empty override trigger rendered blank while the listbox option had the inherited-default label. | Fix the shared Select trigger display source so empty-string options still show the controlled label. |
| Real browser prompt-profile selector test | Expert Squad Select popup is readable in current source; the report points at runtime bundle drift, not a local Select color bug. | Do not add `.prompt-profile-select-*` color overrides. |

## Fix

- Use `t("cmdk.settings.agent_models")` for the Agent Models `SettingsGroup`
  heading.
- Add locale keys for the Agent Models tier labels and inherited model option.
- Reuse `agent_models.option_unavailable` and `agent_models.saving` for
  per-agent rows.
- Render `SelectControl` trigger text from the controlled `props.value` so
  empty-string options do not appear blank.
- Update the architecture guard so it rejects the retired English literals.
- Extend the real browser Agent Models flow to run under `zh-CN`, verify the
  titlebar menu, sidebar tab, panel heading, tier label, and select placeholder
  are localized, and capture a screenshot.

## Acceptance

- Chinese Agent Models UI shows `Agent 模型` consistently in the titlebar menu,
  settings sidebar, and panel heading.
- Empty per-agent model overrides visibly show `— 继承项目默认 —` instead of a
  blank select trigger.
- Agent Models panel source no longer contains the retired English visible
  literals.
- Existing per-agent model PATCH behavior remains unchanged.
