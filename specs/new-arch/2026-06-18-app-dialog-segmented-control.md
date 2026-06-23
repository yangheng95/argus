# App Dialog Segmented Control Primitive

Date: 2026-06-18
Status: implemented

## Problem

Independent GUI review found the task queue decision in `AppDialogHost` used a
local `role="group"` plus raw option buttons while the overlay already had a
Kobalte ToggleGroup-backed segmented control in settings. That duplicated
selection semantics and left AppDialog responsible for keyboard and ARIA
behavior that should belong to a mature primitive.

## Evidence Sweep

| Sweep                       | Evidence            | Decision        |
| --------------------------- | ------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `rg -n 'AppDialogHost       | role="group"        | data-selected   | task queue                                                                                                             | queue' packages/overlay/src packages/overlay/test specs/new-arch specs`                               | `AppDialogHost.tsx` was the task queue decision owner and rendered `role="group"`, raw choice buttons, and `data-selected`. | Replace the choice group only; do not alter dialog settlement, countdown, or Kobalte Select dialogs. |
| `rg -n 'RadioGroup          | RadioItem           | Segmented       | ToggleGroup                                                                                                            | @kobalte/core/(radio                                                                                  | toggle                                                                                                                      | menubar)                                                                                             | radiogroup | role="radio"' packages/overlay/src packages/overlay/test package.json packages/overlay/package.json` | `SettingsSegmented` already wrapped `@kobalte/core/toggle-group`, but it lived under settings-only primitives. | Extract a generic `SegmentedControl` so settings and AppDialog share one ToggleGroup wrapper. |
| `rg -n "app-dialog-decision | task-queue-decision | settleAppDialog | appDialog" packages/overlay/test packages/overlay/src/styles packages/overlay/src/services packages/overlay/src/store` | Existing tests guard the dedicated decision shell, countdown authority, and service settlement value. | Preserve `chooseTaskDecision(value)` and add guards that activation of the currently selected option still settles.         |

## Constraints

- Do not add a second ToggleGroup wrapper.
- Keep `SettingsSegmented` behavior: same-value clicks do not call `onChange`.
- Keep AppDialog behavior: activating the currently selected recommended option
  still confirms the decision.
- Preserve the `.app-dialog-decision__*` visual contract and screenshot it in a
  real browser.

## Tests

- Update `settings-primitives.test.ts` so settings delegates to the shared
  primitive and the shared primitive owns Kobalte ToggleGroup imports.
- Update AppDialog source guards so task decisions use `SegmentedControl`
  instead of raw group/buttons.
- Add a browser visual test for the task decision shell with `data-active`.

## Verification

- `bun test packages/overlay/test/settings-primitives.test.ts packages/overlay/test/dialog-service-single-source.test.ts packages/overlay/test/app-dialog-decision-visual.test.ts packages/overlay/test/app-dialog-timeout.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-reporter=dot --test-timeout=60000 packages/overlay/test/browser/app-dialog-segmented-control.test.ts`
- Screenshot reviewed: `.scratch/app-dialog-segmented-control.png`
