# App Dialog Select Value Single Source

Date: 2026-06-19

UI means User Interface.

## Problem

Independent GUI review found that AppDialog select dialogs can display one
choice while returning another. `showAppDialog()` fills missing `selectValue`
from the first `selectOptions` entry, while `AppDialogHost` also displays the
first option when the stored value has no match. Settlement still returns the
stored value.

This is a dual-source bug: the visible selected option and the returned dialog
value can disagree.

## Recall

| Source                                                  | Relevant constraint                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `2026-06-17-app-dialog-select-trigger-single-source.md` | AppDialog select already uses the shared Kobalte Select shell; do not create another UI path.    |
| `2026-06-18-app-dialog-segmented-control.md`            | Task queue decisions reuse AppDialog `selectValue/selectOptions` state through SegmentedControl. |
| `AGENTS.md`                                             | No fallback logic; fail at the invalid input source instead of silently normalizing.             |

## Impact Sweep

| Sweep                            | Result                                                                                                                                                                                                                                            | Decision                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `rg -n "showAppDialog\\(         | select:\\s\*true                                                                                                                                                                                                                                  | selectOptions                                                                                                                          | selectValue" packages/overlay/src packages/overlay/test specs/new-arch` | Direct select callers already pass explicit values: rewind uses `view`, task queue uses `start`; `nativeSelect` is the only wrapper that defaults to the first option. | Keep direct callers; repair `nativeSelect` so it passes an explicit valid selected value or fails before opening. |
| `AppDialogHost.tsx`              | `selectedOption()` falls back to `selectOptions()[0]`, hiding invalid store state.                                                                                                                                                                | Remove host fallback; service validation is the single source.                                                                         |
| `app-dialog.ts::settleAppDialog` | Settlement returns `dialogStore.app.selectValue` for both select dialogs and task-card decisions.                                                                                                                                                 | Preserve settlement behavior after enforcing valid state before open.                                                                  |
| Independent review feedback      | `providerAuthInputs()` moved the fallback to `prompt.options[0]`, and `authenticateSelectedProvider()` moved it to `methods[0]?.index`. Backend `ProviderAuthPrompt` exposed only `options`, so the protocol had no source for the initial value. | Add `selectValue` to the provider auth select prompt protocol and require a unique `preferred` method for multi-method auth selection. |

## Fix Plan

- Add service-level validation for any AppDialog choice surface:
  `select === true` or `kind === "task-queue-decision"`.
- Require non-empty `selectOptions`.
- Require explicit non-empty `selectValue` that matches one option value.
- Remove AppDialogHost first-option display fallback.
- Update `nativeSelect` to require its caller's `selectValue` when options are
  present.
- Add `selectValue` to plugin/server/SDK `ProviderAuthPrompt` select descriptors.
- Parse provider auth select prompts strictly: missing or invalid `selectValue`
  throws before `nativeSelect` opens.
- Add `preferred?: boolean` to provider auth methods. Single-method auth can use
  the only method; multi-method auth requires exactly one preferred source.
- Let `settleAppDialog()` return the already validated `selectValue` directly
  for select and task decision dialogs; `recommendedValue` remains only a
  visual/task recommendation marker.
- Add unit coverage for missing and invalid select values, and for valid value
  settlement.

## Acceptance

- Invalid select dialog input throws before the dialog opens.
- Host selection display never diverges from stored `selectValue`.
- Existing task queue countdown dialogs still auto-settle to `start`.
- No new select shell, synthetic value, or first-option fallback is introduced.
- Task queue settlement no longer falls back from `selectValue` to
  `recommendedValue`.
- Provider auth prompts and multi-method auth no longer derive initial selection
  from array order.
