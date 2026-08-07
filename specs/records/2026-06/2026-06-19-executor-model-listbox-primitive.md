# Executor Model Listbox Primitive

Date: 2026-06-19

ARIA means Accessible Rich Internet Applications. CLI means Command Line
Interface. DOM means Document Object Model. UI means User Interface.

## Problem

Raman found that `ExecutorSelector` still rendered provider model choices as
handwritten buttons with `.executor-popover-model`, `data-active`, and
`aria-current`. This is a single-choice option list, but it was exposed as
ordinary buttons instead of listbox/option semantics.

## Recall

| Source                              | Relevant constraint                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ExecutorSelector.tsx`              | Mirror and external model pickers share `ProviderModelGroup` as their model choice renderer.                                                     |
| `FileChangesView.tsx`               | Existing Kobalte Listbox usage shows the mature primitive pattern for option rows.                                                               |
| `ComboboxControl.tsx`               | Search combobox is reserved for searchable command-style input; browser visual review showed it duplicated selected values in this model picker. |
| `AgentModelsPanel.tsx`              | Model selection in settings already avoids handwritten button lists by using shared selection primitives.                                        |
| `executor-selector-dualbar.test.ts` | Existing tests pinned the wrong `aria-current` model button contract.                                                                            |

## Evidence Sweep

| Command                                                                            | Result                                                             | Decision                                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `rg -n "ProviderModelGroup                                                         | executor-popover-model                                             | aria-current" packages/overlay/src/components/ExecutorSelector.tsx packages/overlay/test` | `ProviderModelGroup` owned the handwritten button list and tests asserted `aria-current`. | Replace the renderer and update tests to reject the retired button contract.                                                                      |
| `rg -n "Listbox.Root                                                               | ComboboxControl                                                    | SelectControl                                                                             | SettingsSelect" packages/overlay/src/components packages/overlay/test`                    | Kobalte Listbox already backs row selection in `FileChangesView`; combobox is search-oriented and produced duplicate input chrome in screenshots. | Use `Listbox.Root` / `Listbox.Item` for visible provider model lists. |
| `rg -n "executor-popover-model" packages/overlay/src/styles packages/overlay/test` | CSS and architecture guards also protected the old button classes. | Rename CSS hooks to listbox-specific classes and remove `.executor-popover-model`.        |

## Fix Plan

1. Introduce `ExecutorModelOption` objects derived from provider model IDs.
2. Replace `ProviderModelGroup` button rendering with Kobalte `Listbox.Root<ExecutorModelOption>`.
3. Keep provider grouping and existing pick handlers; only the model option primitive changes.
4. Remove `.executor-popover-models` / `.executor-popover-model` styling and replace it with listbox/option styles.
5. Update static tests and browser coverage for role `listbox` and `option`, with ArrowDown + Enter keyboard selection.

## Acceptance

- `ExecutorSelector.tsx` imports and uses Kobalte Listbox for model choices.
- No production source renders `class="executor-popover-model"` or `aria-current` for model selection.
- Browser test verifies model options expose listbox/option roles and keyboard selection changes the active model.
- Visual screenshots show no duplicated input chrome, readable unselected options, and clear selected option background on light popovers.
- Mirror and external popovers keep their existing data flow and provider grouping.
