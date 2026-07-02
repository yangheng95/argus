# Agent Model Select Popup Elevation

## Recall

| Field | Notes |
| --- | --- |
| User request | The Agent Models setting can no longer be opened; screenshot shows the fullscreen Config & Settings dialog on the Agent Models tab, with the project default model select visible but no popup list visible after interaction. |
| Acceptance criteria | The Agent Models model select must visibly open inside the fullscreen settings dialog; the selected option list must be above the dialog layer, clickable, and verified by a real browser screenshot. Focused tests must fail for the old layering bug and pass after the repair. |
| Hard constraints | No fallback logic, no AgentModelsPanel-only duplicate select implementation, no gate or bypass, no unrelated edits to the existing dirty `packages/opencorvus/src/provider/models-snapshot.ts`, no restart or refresh of the user's running OpenCorvus/overlay process without explicit permission. |
| Sources read | `AGENTS.md`; `specs/current/architecture/05-config.md`; `specs/current/architecture/06-provider.md`; `specs/current/architecture/07-panel.md`; `packages/overlay/src/components/settings/AgentModelsPanel.tsx`; `packages/overlay/src/components/settings/primitives.tsx`; `packages/overlay/src/components/ui/SelectControl.tsx`; `packages/overlay/src/styles/surfaces/field.css`; `packages/overlay/src/styles/surfaces/dialog.css`; `packages/overlay/src/styles/tokens/design-language.css`; focused Agent Models and select tests. |
| Whole-repository search evidence | `rg "Agent Models|agent models|agentModels|AgentModels|agent model"` located the UI in `AgentModelsPanel.tsx` and tests in `packages/overlay/test/**`. `rg -- "oc-select-content|SelectControl|SettingsSelect|agent-model-select"` showed Agent Models uses the shared `SettingsSelect -> SelectControl` shell; other consumers are prompt profile, app dialog, browser preview, and log viewer. `rg -- "--ui-z-|z-index"` showed `.dialog` uses `var(--ui-z-dialog)` (`10000`) while `.oc-select-content` still used literal `z-index: 1000`. |
| Tooling note | The first `rg` z-index command put `-g` globs after paths and PowerShell/ripgrep treated them as paths; rerunning with the pattern guarded by `--` produced the relevant evidence. |
| Independent agent feedback | Not spawned: current multi-agent tool contract forbids subagents unless the user explicitly requests delegation. The repair remains locally reviewable because the evidence is in the shared select shell and the focused browser test will inspect real rendered stacking. |

## Diagnosis

`SelectControl` renders `Select.Portal`, so popup content is appended outside the settings dialog subtree. The fullscreen settings dialog uses `.dialog { z-index: var(--ui-z-dialog); }`, and `--ui-z-dialog` is `10000`. The shared popup content uses `.oc-select-content { z-index: 1000; }`, which puts the opened list under the fullscreen dialog. The operator sees the trigger react but no visible options, matching "cannot open".

This is a shared select elevation bug, not an Agent Models data bug. Fixing it in `AgentModelsPanel` would create a second source and leave other `SelectControl` consumers broken in dialog contexts.

## Plan

1. Route `.oc-select-content` through the existing elevation scale with `calc(var(--ui-z-dialog) + 1)`, making select popups sit above active dialogs while still staying below `--ui-z-toast`.
2. Add a focused CSS contract in `theme-form-control-coverage.test.ts` proving shared select content uses the tokenized popup elevation.
3. Strengthen `agent-models-panel.test.ts` so clicking the Agent Models select asserts the popup is visible at the click point and above the fullscreen config dialog, then saves a popup screenshot.
4. Run focused overlay tests and visually review the new screenshot.

## Verification Plan

- `bun test packages/overlay/test/theme-form-control-coverage.test.ts packages/overlay/test/agent-models-panel-load.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/agent-models-panel.test.ts`
- Visual review of the generated Agent Models popup screenshot under `.scratch/`.

## Verification Results

- `bun test packages/overlay/test/theme-form-control-coverage.test.ts packages/overlay/test/agent-models-panel-load.test.ts packages/overlay/test/flat-redesign-elevation-coverage.test.ts packages/overlay/test/browser-error-collector.test.ts` passed.
- `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --test --test-concurrency=1 packages/overlay/test/browser/agent-models-panel.test.ts` passed and regenerated `.scratch/agent-models-select-popup-visible.png`.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` passed after indexing this record.
- Visual review of `.scratch/agent-models-select-popup-visible.png` confirmed the Agent Models popup list is visible above the settings dialog.
