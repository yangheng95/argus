# Browser Preview Select Style Single Source

Date: 2026-06-17

CSS means Cascading Style Sheets. UI means User Interface. URL means Uniform
Resource Locator.

## Problem

`BrowserPreviewPanel` uses Kobalte Select for the preview target candidate
dropdown, but its popup visual contract is still duplicated in
`inspector.css` through `.browser-preview-candidate-content`,
`.browser-preview-candidate-listbox`, `.browser-preview-candidate-option`, and
`.browser-preview-candidate-indicator`.

The overlay already has a shared Kobalte Select visual contract in
`field.css` via `.oc-select-content`, `.oc-select-listbox`,
`.oc-select-option`, and `.oc-select-indicator`. Keeping a private Browser
Preview popup style means future contrast, hover, spacing, or selected-state
fixes to shared Select controls will not apply to the preview candidate
dropdown.

## Call Points

| Search                                                                                                                               | Evidence                                                                                               | Decision                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `rg -n "Select.Root<BrowserPreviewCandidate>                                                                                         | browser-preview-candidate-content                                                                      | browser-preview-candidate-option                                                           | oc-select-content | oc-select-option" packages/overlay/src packages/overlay/test specs/new-arch` | `BrowserPreviewPanel.tsx` renders Kobalte Select but gives content/listbox/item/indicator only Browser Preview-specific class names. `inspector.css` duplicates popup tokens. | Add shared `.oc-select-*` classes to the candidate Select and retire duplicated popup CSS. |
| `specs/records/2026-06/2026-06-09-browser-preview-candidate-dropdown.md`                                                                    | The old implementation plan asked for a native select, but current source already uses Kobalte Select. | Treat current Kobalte Select as the implementation source; do not return to native select. |
| `specs/records/2026-06/2026-06-15-browser-preview-target-evidence-binding.md` and `2026-06-17-browser-preview-selected-target-authority.md` | Browser preview target selection and evidence ownership are backend task-scoped contracts.             | Do not change routes, target IDs, reachability, evidence, or selection behavior.           |

## Fix Shape

- Keep `browser-preview-candidate-*` hooks that tests and browser flows use.
- Add shared `oc-select-trigger`, `oc-select-content`, `oc-select-listbox`,
  `oc-select-option`, and `oc-select-indicator` classes to the candidate
  Select parts.
- Remove duplicated Browser Preview popup token rules from `inspector.css`;
  keep only placement/layout rules that are specific to the preview command
  surface.
- Update static tests so they require shared Select classes and reject private
  popup token ownership.

## Verification

- `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/theme-form-control-coverage.test.ts`
- `bun run --cwd packages/overlay typecheck`
- Node browser screenshot with Browser Preview candidate dropdown open on a
  light surface, including contrast checks for visible option text.
