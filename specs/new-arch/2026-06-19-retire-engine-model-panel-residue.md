# Retire Engine Model Panel Residue

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Recall

- `AGENTS.md` requires root-cause fixes, no fallback paths, no double source, and tests for code changes.
- `2026-06-17-settings-select-primitive-single-source.md` keeps agent model selects on the shared `SettingsSelect` / `SelectControl` primitive while preserving `.agent-model-select*` hooks.
- `2026-06-18-select-control-shell-single-source.md` moved select shell ownership to the shared `.oc-select-*` family.
- `2026-06-19-retire-field-input-action-residue.md` retired old field selector families from `field.css` once production DOM stopped emitting them.

## Evidence

| Sweep                                                                                 | Result                                                                                                                                                                      | Decision                                                                    |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `rg -n "engine-model-panel" packages/overlay/src -g "!*.css"`                         | No production DOM owner exists.                                                                                                                                             | Remove the dead selector instead of preserving a phantom model panel owner. |
| `rg -n "engine-model-panel" packages/overlay/test specs/new-arch -g "*.ts" -g "*.md"` | No active test or plan protects the selector.                                                                                                                               | Add a retired-selector guard.                                               |
| `rg -n "agent-model-select                                                            | agent-model-assignment                                                                                                                                                      | provider-panel                                                              | executor-model-listbox" packages/overlay/src packages/overlay/test specs/new-arch -g "_._"` | Live model surfaces use `.agent-model-select`, `.agent-model-assignment`, `.provider-panel`, and `.executor-model-listbox`. | Keep current owners unchanged. |
| `packages/overlay/src/styles/surfaces/field.css`                                      | The grouped reset applies to `.field-input`, `.config-status-box`, and dead `.engine-model-panel`; the comment also advertises retired `dir-panel` / model-panel ownership. | Narrow the rule and comment to the live field/status owners.                |

## Root Cause

The old engine model panel class survived in the shared field reset after agent
model settings moved to the current settings/select primitives. Keeping it made
model-panel chrome appear to have a second owner in `field.css`, even though no
production DOM emits `.engine-model-panel`.

## Fix Plan

1. Delete `.engine-model-panel` from the shared field/status reset.
2. Update the comment so it names only live owners.
3. Extend the retired field selector guard to reject `.engine-model-panel` in
   production source and `field.css`.

## Acceptance

- Production source and `field.css` no longer contain `.engine-model-panel`.
- `.field-input` and `.config-status-box` keep their shared reset.
- Live model selectors remain owned by `AgentModelsPanel`, `ProvidersPanel`, and
  `ExecutorSelector`.
