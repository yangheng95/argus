# Expert Squad Unselected Option Contrast Guard

Date: 2026-06-18

## Report

The Expert Squad selector was reported as hiding unselected dropdown options on
a white popup background. Because this selector now uses the shared Kobalte
Select primitive, the investigation must treat the issue as a shared Select
popup readability risk, not a component-local color patch.

## Recall

| Source                                                   | Existing decision                                                                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-16-prompt-profile-expert-squad-switching.md`    | Prompt profiles are the single expert-squad source and the UI must use mature Select/list primitives.                        |
| `2026-06-17-prompt-profile-selector-select-primitive.md` | The old native select plus hidden visual chrome was removed because native option text could inherit transparent foreground. |
| `2026-06-17-select-popup-opaque-surface.md`              | `.oc-select-content` owns the Select popup surface and must use opaque `--menu-panel-bg`.                                    |
| `2026-06-18-select-popup-readability-impact-review.md`   | Do not add `.prompt-profile-select-*` foreground/background overrides; keep the shared `.oc-select-*` contract.              |
| `2026-06-18-popup-contrast-light-palette.md`             | Light popup secondary text readability belongs to shared tokens and matrix coverage.                                         |

## Impact Sweep

| Sweep                                                                                                                   | Result                                                                                                                                                                                                                                             | Decision                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n -F "<select" packages/overlay/src packages/overlay/test specs`                                          | No active overlay component renders a native prompt-profile `<select>` or `<option>`.                                                                                                                                                              | Do not reintroduce native select-specific CSS.                                                                                               |
| `rg -n -F "prompt-profile-select" packages/overlay/src packages/overlay/dist-vite packages/overlay/test specs` | Source and current dist both use Kobalte Select with `.oc-select-content` and `.oc-select-option`.                                                                                                                                                 | Treat current runtime as the evidence source, not the old native implementation.                                                             |
| Real browser screenshot `.scratch/prompt-profile-selector-current.png`                                                  | The current light-theme popup renders General, Frontend, Backend, and Algorithm visibly.                                                                                                                                                           | No production color patch is justified by current evidence.                                                                                  |
| `packages/vscode-extension/src/webview/html.ts` + `packages/vscode-extension/esbuild.mjs`                               | VS Code webviews load `media/ui`, which is copied from `packages/overlay/dist-vite` during the extension build. A stale local `media/ui` can therefore show the retired native prompt-profile select even when source and `dist-vite` are correct. | Refresh local `media/ui` through the extension build and add a build-time bundle assertion for retired prompt-profile native-select markers. |
| `packages/overlay/test/browser/prompt-profile-selector-browser.test.ts`                                                 | The test checked all options but did not pin Kobalte's explicit `aria-selected="false"` unselected-option state.                                                                                                                                   | Harden the browser test to match the reported failure mode.                                                                                  |
| `packages/overlay/test/browser/select-popup-contrast-matrix.test.ts`                                                    | The matrix covered shared Select consumers, but hand-wrote a partial CSS order instead of using `src/index.html` as the stylesheet source.                                                                                                         | Load matrix CSS from the real entrypoint order.                                                                                              |

## Fix

- Keep the Expert Squad selector on Kobalte Select and shared `.oc-select-*`
  popup styling.
- Extend the real overlay browser test to:
  - identify unselected `.prompt-profile-select-option[aria-selected="false"]`
    rows explicitly;
  - composite each option background over the popup background;
  - assert primary and secondary text contrast against that effective surface;
  - keep the popup background alpha check at `1`.
- Make the shared Select matrix read stylesheet order from `src/index.html`
  and require an explicit `aria-selected="false"` option for every sample.
- Leave production CSS and component code unchanged because the current
  screenshots and shared Select matrix already prove the live source is
  readable.
- Move the VS Code extension's synced webview bundle assertions into a
  testable helper and reject the retired prompt-profile native-select markers
  from `media/ui` after every extension UI sync.

## Acceptance

- Expert Squad light-theme popup remains visually readable in a real browser.
- Unselected Expert Squad options have primary and secondary text contrast of
  at least `4.5` against their effective white popup surface.
- VS Code extension builds cannot ship `media/ui` assets containing the retired
  prompt-profile native `<select>` / hidden chrome implementation.
- Shared Select matrix coverage remains green for Expert Squad, Agent Models,
  Settings, App Dialog, Browser Preview, and Log Level.
- No component-local `.prompt-profile-select-*` color override is introduced.
