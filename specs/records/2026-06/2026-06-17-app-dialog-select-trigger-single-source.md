# App Dialog Select Trigger Single Source

Date: 2026-06-17

UI means User Interface.

## Problem

`AppDialogHost` uses Kobalte Select for app-level choice dialogs. Its popup
content, listbox, and option already use the shared `.oc-select-*` classes, but
the trigger still uses `custom-select`, the legacy native-select chrome class,
and omits `.oc-select-trigger`.

This splits one control across Kobalte popup styling, native-select trigger
padding, and AppDialog-local hooks. Long selected labels can crowd the caret
instead of inheriting the shared truncation rule from `field.css`.

## Call Points

| Search                                                               | Evidence                                                                                            | Decision                                                       |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `rg -n "AppDialogHost                                                | app-dialog-select                                                                                   | custom-select                                                  | oc-select-trigger" packages/overlay/src packages/overlay/test specs -S` | `AppDialogHost.tsx` renders `<Select.Trigger class="field-input app-dialog-input custom-select app-dialog-select-trigger">`; the same Select content/listbox/item already uses `.oc-select-*`. | Add `.oc-select-trigger` and remove `custom-select` from the Kobalte trigger. |
| `specs/records/2026-06/2026-06-01-overlay-mature-ui-primitives-refactor.md` | AppDialogHost is part of the canonical dialog surface that should preserve ids and store contracts. | Do not change dialog ids, store state, or settlement behavior. |
| `packages/overlay/test/browser/provider-auth-panel.test.ts`          | Provider auth flow opens `#appDialogSelect` and chooses `.app-dialog-select-option`.                | Use this browser path for visual verification.                 |

## Fix Shape

- Change the trigger class to `field-input oc-select-trigger app-dialog-input
app-dialog-select-trigger`.
- Keep AppDialog-specific ids/hooks and popup classes.
- Add source tests requiring shared trigger ownership and rejecting
  `custom-select` on the Kobalte trigger.

## Verification

- `bun test packages/overlay/test/dialog-service-single-source.test.ts packages/overlay/test/theme-form-control-coverage.test.ts`
- `bun run --cwd packages/overlay typecheck`
- Browser screenshot with App dialog select open, showing readable option text,
  ellipsized trigger value, and right-aligned caret.
