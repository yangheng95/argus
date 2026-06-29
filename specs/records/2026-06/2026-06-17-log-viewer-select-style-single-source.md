# Log Viewer Select Style Single Source

Date: 2026-06-17

CSS means Cascading Style Sheets. UI means User Interface.

## Problem

`LogViewer` already uses Kobalte Select for the severity filter, and its popup
content, listbox, and item parts already use the shared `.oc-select-*` classes.
The trigger still omits `.oc-select-trigger`, and `.log-level-select` still owns
root-level chrome: background, border, padding, text color, focus border, font,
and cursor.

That splits one Select control across two visual sources. Shared Select trigger
fixes in `field.css` will not reliably apply to the Log Viewer severity filter,
and the root chrome can conflict with the trigger chrome.

## Call Points

| Search                                                               | Evidence                                                                                                 | Decision                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `rg -n "LogViewer                                                    | log-level-select                                                                                         | Select\\.Root<LogLevel>                                                         | oc-select-trigger" packages/overlay/src packages/overlay/test specs` | `LogViewer.tsx` uses Kobalte Select. The trigger is `field-input log-level-select-trigger`, while content/listbox/items already use `.oc-select-*`. `settings.css` defines root chrome for `.log-level-select`. | Add `.oc-select-trigger` to the trigger and retire root chrome from `.log-level-select`. |
| `specs/records/2026-06/2026-06-01-overlay-mature-ui-primitives-refactor.md` | LogViewer is already on the mature primitive path for parsing, virtualization, and Kobalte Select usage. | Keep the current Kobalte Select; do not add another primitive or native select. |
| `specs/records/2026-06/2026-06-15-help-open-logs.md`                        | LogViewer opens through the single `oc:open-logs` event and must keep a stable readable log list height. | Do not change opening, fetching, filtering semantics, or virtual list sizing.   |

## Fix Shape

- Keep `.log-level-select` as a root positioning/hook class only.
- Add `oc-select-trigger` to the severity trigger class list.
- Delete private root chrome and focus styling from `settings.css`.
- Do not require `.log-level-select` to own a CSS rule in architecture guards;
  the class may stay on the Kobalte root as a DOM hook while trigger/content
  visuals come from shared `.oc-select-*` primitives.
- Extend tests so LogViewer requires the shared trigger class and rejects root
  ownership of Select background, border, padding, color, and focus chrome.

## Verification

- `bun test packages/overlay/test/log-viewer-primitive.test.ts packages/overlay/test/theme-form-control-coverage.test.ts`
- `bun run --cwd packages/overlay typecheck`
- Browser screenshot with `#logDialog` open and the severity dropdown expanded
  on a light surface, verifying readable option text and no doubled select
  border.
