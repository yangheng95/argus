# Expert Squad Chinese Select Readability Coverage

Date: 2026-06-20

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model. VSIX means Visual Studio Code Extension.

## Report

The Expert Squad selector dropdown was reported as showing unreadable
unselected options on a white popup background. The report was made from the
Chinese user-facing surface, so English-only browser coverage is insufficient
evidence.

## Recall

| Source | Relevant decision |
| --- | --- |
| `2026-06-17-expert-squad-select-readability-impact.md` | Expert Squad must stay on Kobalte Select and shared `.oc-select-*` popup styling. |
| `2026-06-18-expert-squad-unselected-option-contrast-guard.md` | Treat this as shared Select readability, not a component-local color patch. |
| `2026-06-19-prompt-profile-select-runtime-contrast.md` | Runtime verification must use the real Expert Squad selector and Kobalte state attributes. |
| `2026-06-19-vscode-media-ui-dist-vite-single-source.md` | Stale VSIX `media/ui` can surface retired dropdown behavior even when source is correct. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n '<SelectControl|Select\\.Root|DropdownMenu\\.Root|Listbox\\.Root' packages/overlay/src/components -g '*.tsx'` | `SelectControl` owns Kobalte Select; Expert Squad, Browser Preview, AppDialog, LogViewer, and Settings consume it. Executor and FileChanges are Kobalte Listbox surfaces. | Do not add Expert Squad-specific colors. Keep shared Select as the source. |
| `rg -n '<select|<option|custom-select|select\\.field-input|prompt-profile-select-native|prompt-profile-select-chrome|prompt-profile-select-hidden' packages/overlay/src packages/overlay/test packages/vscode-extension/media/ui -S` | No active overlay source owns native prompt-profile option chrome; media bundle contains the current Kobalte code path. | Do not revive native select CSS. |
| Real browser `prompt-profile-selector-browser.test.ts` | The current English light popup is readable and exposes Kobalte selected/highlighted state. | Keep the English evidence, but add Chinese runtime evidence. |
| Real browser `select-popup-contrast-matrix.test.ts` | Shared Select consumer matrix is readable on white popup surfaces. | Treat non-Expert Select consumers as covered by the shared matrix. |

## Fix Plan

1. Parameterize the real Expert Squad browser test over `en-US` and `zh-CN`.
2. Use Chinese prompt profile labels and descriptions in the `zh-CN` case so
   CJK option text is measured, not only the trigger chrome.
3. Preserve the existing Kobalte runtime assertions: `role="option"`,
   `aria-selected="false"`, `data-selected`, and `data-highlighted`.
4. Save separate locale screenshots for visual review.
5. Keep production CSS unchanged unless the real Chinese test fails.

## Acceptance

- English and Chinese Expert Squad light-theme popup screenshots show readable
  unselected options on the white popup surface.
- Every option and nested label/description part keeps at least 4.5:1 contrast
  against its effective popup surface in both locales.
- VSIX `media/ui` remains synchronized with `packages/overlay/dist-vite`.
- No raw color, local `.prompt-profile-select-*` color override, fallback, or
  duplicate select implementation is introduced.
