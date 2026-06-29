# Prompt Profile List Current ARIA

Date: 2026-06-18

## Problem

The Prompt Profiles settings panel visually marks the currently inspected
profile with `.prompt-profile-list-item[data-active="true"]`, but the focusable
profile row button does not expose that current state. Keyboard and
assistive-technology users can activate each profile row but cannot identify
which profile currently owns the detail editor.

## Recall

| Source                                                    | Relevant decision                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-16-prompt-profile-expert-squad-switching.md`     | Prompt Profiles are the single expert-squad source; the settings UI selects profiles without changing workflow or tool routing. |
| `2026-06-18-prompt-profile-extension-import-consensus.md` | `PromptCatalog` is now the prompt-profile management and import surface.                                                        |
| `2026-06-18-prompt-profile-textarea-accessible-names.md`  | The Prompt Profile panel already binds editable textarea names to visible target labels.                                        |
| `2026-06-18-executor-selector-current-model-aria.md`      | Command rows that choose the current model use `aria-current="true"`, not toggle or listbox semantics.                          |
| `2026-06-18-ledger-row-current-aria.md`                   | Visual `data-active` current-row state must be mirrored onto the focusable row control.                                         |

## Impact Sweep

| Sweep                                               | Result                                                                                    | Decision                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `rg -n 'prompt-profile-list                         | data-active=                                                                              | aria-current                                 | aria-selected                                                         | aria-pressed' packages/overlay/src/components/settings/PromptCatalog.tsx packages/overlay/test specs/new-arch`                                  | Only `PromptCatalog` renders `.prompt-profile-list-item`; browser coverage only checked `data-active="true"`. | Fix `PromptCatalog` and extend existing Prompt Profile browser coverage. |
| `rg -n 'data-active=                                | aria-current=                                                                             | aria-selected=                               | aria-pressed=' packages/overlay/src/components packages/overlay/test` | Task, Mission, Coding Assistant, file changes, and executor rows already mirror selected/current visual state to ARIA on the focusable control. | Match the established current-row pattern.                                                                    |
| `packages/overlay/src/styles/surfaces/settings.css` | `.prompt-profile-list-item[data-active="true"]` is the only visual selected-profile hook. | Keep this visual source; add semantics only. |

## Decision

Add `aria-current={selectedProfileID() === profile.id ? "true" : undefined}` to
the existing profile row button. Do not use `aria-selected`, because the list is
not a listbox, tablist, tree, or grid. Do not use `aria-pressed`, because the
profile row is not a toggle button and clicking the current profile does not
toggle it off.

## Acceptance

- The active Prompt Profile row has both `data-active="true"` and
  `aria-current="true"` on the same focusable button.
- Unselected profile rows have `data-active="false"` and no `aria-current`.
- The panel does not add `aria-selected` or `aria-pressed` to these command
  buttons.
- Existing visual layout and screenshot evidence remain unchanged.
