# Expert Squad Select Readability Impact Review

Date: 2026-06-17

## Report

The Expert Squad selector dropdown can show unreadable unselected options on a
white/light background.

## Recall

- `2026-06-16-prompt-profile-expert-squad-switching.md` requires the prompt
  profile selector to use mature select/list primitives instead of mutating
  prompt fields or inventing a parallel selector.
- `2026-06-17-prompt-profile-selector-select-primitive.md` previously replaced
  the native select/chrome double source with Kobalte Select.
- `2026-06-17-select-popup-opaque-surface.md` identifies shared
  `.oc-select-*` popup styling as the single source for Expert Squad and other
  Select dropdown readability.
- `2026-06-17-log-viewer-select-style-single-source.md`,
  `2026-06-17-browser-preview-select-style-single-source.md`, and
  `2026-06-17-app-dialog-select-trigger-single-source.md` pin related Select
  controls to the same shared visual contract.

## Impact Sweep

| Search                    | Result                    | Decision                          |
| ------------------------- | ------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `rg -n "prompt profile    | promptProfile             | prompt-profile                    | Expert Squad                                                                                | 专家团                                                                                                                    | prompt-profile-select                                                                          | Select\\.Root | oc-select" packages/overlay/src/components packages/overlay/test -S` | `ChatComposer.tsx` renders the Expert Squad picker through Kobalte `Select.Root` and shared `.oc-select-*` popup classes. | Keep Kobalte as the implementation source; do not reintroduce native `<select>` / `<option>` styling. |
| `rg -n "<select           | <option                   | select\\.field-input              | custom-select" packages/overlay/src packages/overlay/test specs -S`                | No overlay component uses native `<select>` or `<option>`. Only legacy CSS remains in `field.css`.                        | Remove the unused native select/custom-select CSS so it cannot become a second styling source. |
| `rg -n "oc-select-content | oc-select-option          | --menu-panel-bg                   | --surface\\s\*:" packages/overlay/src/styles packages/overlay/test -S`                      | `.oc-select-content` uses `--menu-panel-bg`, while current tests were weakened to expect the old translucent `--surface`. | Restore tests to require opaque popup background and shared secondary text colors.             |
| `rg -n "log-level-select  | app-dialog-select-trigger | browser-preview-candidate-content | oc-select-trigger" packages/overlay/src/components packages/overlay/src/styles/surfaces -S` | AppDialog and BrowserPreview still use shared Select trigger/popup classes. LogViewer regressed to a local trigger class. | Reattach LogViewer to `.oc-select-trigger` and pin this in tests.                              |

## Fix

- Keep Expert Squad on Kobalte Select and shared `.oc-select-*` listbox styling.
- Restore static coverage so shared Select popup content must use the opaque
  `--menu-panel-bg` token and may not use translucent `--surface`.
- Restore browser coverage so the light Expert Squad popup checks unselected
  options and secondary descriptions, not only the top-level option element.
- Reattach LogViewer to `field-input oc-select-trigger log-level-select-trigger`.
- Remove unused native select/custom-select CSS from `field.css`.

## Acceptance

- Expert Squad options and descriptions are readable on the light popup surface.
- AppDialog, BrowserPreview, LogViewer, Settings, and Expert Squad use the same
  shared Select color source.
- There is no overlay component-native `<select>` / `<option>` implementation
  and no leftover native select/custom-select CSS in the active surface sheet.
- Static tests, Node browser visual test, typecheck, and screenshot review pass.
