# Select Control Shell Single Source

Date: 2026-06-18

UI means User Interface. ARIA means Accessible Rich Internet Applications.

## Problem

Independent GUI review found the shared Select visual classes already exist,
but the Kobalte Select shell is still repeated in non-settings feature
components. Each consumer locally wires `Select.Root`, trigger, hidden select,
portal, content, listbox, item, indicator, value, and accessible label behavior.

This keeps several sources of truth for popup semantics beside
`SettingsSelect`, and makes future fixes to readable options, trigger focus,
portal behavior, and hidden select labelling easy to miss.

## Recall

| Source                                                    | Relevant constraint                                                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-17-prompt-profile-selector-select-primitive.md`  | Expert Squad must use Kobalte Select and shared `.oc-select-*` popup classes, not native select or a split visual shell.                              |
| `2026-06-17-settings-select-primitive-single-source.md`   | Settings panels already use `SettingsSelect` instead of local Select wrappers.                                                                        |
| `2026-06-18-select-popup-readability-impact-review.md`    | Select popup readability belongs to shared `.oc-select-*` contracts and must cover Expert Squad, AppDialog, Browser Preview, LogViewer, and settings. |
| `packages/overlay/src/components/settings/primitives.tsx` | Current `SettingsSelect` owns a reusable shell shape, but it lives in the settings namespace.                                                         |

## Impact Sweep

| Sweep                                | Result                                                                         | Decision                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `rg -n "Select\\.Root                | Select\\.Trigger                                                               | Select\\.HiddenSelect                                                                       | Select\\.Portal                                                                 | Select\\.Content                                                              | Select\\.Listbox                                                               | Select\\.Item" packages/overlay/src/components -g "\*.tsx"`                                 | Direct Select shells exist only in `AppDialogHost`, `BrowserPreviewPanel`, `ChatComposer`, `LogViewer`, and `settings/primitives.tsx`. | Create `components/ui/SelectControl.tsx` as the only Kobalte shell owner; migrate all five. |
| `rg -n "SettingsSelect               | Select\\.Root" packages/overlay/src/components/settings packages/overlay/test` | Settings panels import `SettingsSelect`; tests already reject settings-local `Select.Root`. | Keep `SettingsSelect` as the settings wrapper, but delegate to `SelectControl`. |
| `rg -n "prompt-profile-select        | app-dialog-select                                                              | browser-preview-candidate                                                                   | log-level-select                                                                | settings-form-select                                                          | agent-model-select" packages/overlay/src packages/overlay/test specs/new-arch` | Existing class names are used by CSS, browser tests, and contrast matrix fixtures.          | Preserve public class/data selectors; change ownership of shell only.                                                                  |
| `rg -n "select-popup-contrast-matrix | prompt-profile-selector-browser                                                | app-dialog-select-option                                                                    | browser-preview-candidate-option                                                | log-level-select-option" packages/overlay/test/browser packages/overlay/test` | Browser coverage already validates popup contrast and consumer classes.        | Add source guards and reuse existing browser contrast/prompt-profile tests after migration. |

## Fix Plan

1. Add `components/ui/SelectControl.tsx`.
   - It owns `Select.Root`, `Select.Trigger`, `Select.HiddenSelect`,
     `Select.Portal`, `Select.Content`, `Select.Listbox`, `Select.Item`, and
     `Select.ItemIndicator`.
   - It prepends canonical `.oc-select-*` classes and accepts local class
     suffixes for layout selectors.
   - It supports either `aria-label` or `aria-labelledby`, custom trigger
     value content, option labels/descriptions, option data attributes, and
     indicator class customization.
2. Replace `SettingsSelect` internals with a wrapper around `SelectControl`.
3. Migrate `AppDialogHost`, `BrowserPreviewPanel`, `ChatComposer`, and
   `LogViewer` to `SelectControl` and remove their direct Kobalte imports.
4. Update static tests so direct Kobalte Select shells are allowed only in
   `SelectControl.tsx`.
5. Run existing select popup/browser contrast tests and a typecheck.

## Acceptance

- Production feature components do not import `@kobalte/core/select`.
- `Select.Root`, `Select.Trigger`, `Select.HiddenSelect`, `Select.Portal`,
  `Select.Content`, and `Select.Listbox` appear only in `SelectControl.tsx`.
- `SettingsSelect` remains the settings-facing API and delegates to
  `SelectControl`.
- Existing consumer selectors remain stable:
  `.prompt-profile-select-*`, `.app-dialog-select-*`,
  `.browser-preview-candidate-*`, `.log-level-select-*`, and settings select
  classes.
- Browser popup contrast and Expert Squad readability coverage still pass.
