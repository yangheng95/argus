# Settings Select Primitive Single Source - 2026-06-17

## Problem

Settings panels have a shared primitives module, but Select controls are still
implemented locally in feature panels. `AgentModelsPanel` and
`SkillMarketPanel` both hand-write `Select.Root`, trigger, hidden select,
portal, content, listbox, option item, caret, and selected indicator.

This already caused an accessibility drift: Agent model selects do not provide
an accessible name on the trigger or hidden select, while Skill/MCP form
selects do.

## Evidence Sweep

| Command | Result | Decision |
| --- | --- | --- |
| `rg -n 'Select\.Root|Select\.Trigger|Select\.HiddenSelect|SelectRootItemComponentProps|function .*Select' packages/overlay/src/components/settings packages/overlay/test` | Direct settings Select implementations exist in `AgentModelsPanel.tsx` and `SkillMarketPanel.tsx`; tests assert those local functions. | Add a settings primitive and move both panels to it. |
| `rg -n 'SettingsSegmented|Panels MUST' packages/overlay/src/components/settings/primitives.tsx packages/overlay/test/settings-primitives.test.ts` | `primitives.tsx` is the intended single source for settings panel controls but has only `SettingsSegmented`. | Export `SettingsSelect` from the same module. |
| `rg -n 'agent-model-select|settings-form-select|aria-label|aria-labelledby' packages/overlay/src/components/settings packages/overlay/test` | Existing CSS/test hooks depend on panel-specific class names, while accessible naming is inconsistent. | Preserve class hooks via primitive props and require one `ariaLabel` source for trigger and hidden select. |

## Fix

- Add `SettingsSelect` and `SettingsSelectOption` to
  `components/settings/primitives.tsx`.
- `SettingsSelect` owns Kobalte Select shell, shared `.oc-select-*` classes,
  caret icon, selected indicator, `Trigger` accessible name, and
  `HiddenSelect` accessible name.
- `SettingsSelect` only selects an option that exactly matches `value`; it
  does not silently select the first option when callers pass an invalid value.
- Panels keep only option construction and persistence callbacks.
- Preserve existing data hooks:
  - `.agent-model-select-option[data-model-value]`
  - `.settings-form-select-option[data-value]`
  - existing trigger/content/listbox class names
- Update source tests to reject local settings `Select.Root` wrappers.

## Acceptance

- Settings panels import `SettingsSelect`; they no longer import
  `@kobalte/core/select`.
- `settings-primitives.test.ts` pins `SettingsSelect` as the only settings
  Kobalte Select owner.
- Agent model, skill, and MCP selects all provide the same accessible label to
  the trigger and hidden select.
- Invalid settings Select values are not hidden by an implicit first-option
  fallback.
- Targeted unit/browser tests, overlay typecheck, and visual screenshots pass.
