# VS Code Media UI Dist-Vite Single Source

Date: 2026-06-19

GUI means Graphical User Interface. VSIX means Visual Studio Code Extension.

## Problem

The Expert Squad dropdown contrast report points back to a stale webview asset
risk, not a new component-local Select color problem. Current overlay source
uses the shared Kobalte-backed `SelectControl`, and current `dist-vite` uses the
shared `.oc-select-*` popup styles. However, tracked
`packages/vscode-extension/media/ui` has drifted from
`packages/overlay/dist-vite`: hashes, asset names, i18n payloads, and CSS differ.
The existing bundle assertion only rejects retired prompt-profile native-select
markers, so it can pass while the shipped webview assets are not the current
overlay bundle.

## Recall

| Source                                                        | Relevant decision                                                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `2026-06-18-expert-squad-unselected-option-contrast-guard.md` | Expert Squad readability belongs to the shared Select popup source; stale `media/ui` can show old behavior. |
| `2026-06-19-prompt-profile-select-runtime-contrast.md`        | Runtime verification should use the real Kobalte Expert Squad selector, not local color overrides.          |
| `2026-06-19-vsix-skip-build-media-ui-contrast-guard.md`       | VSIX packaging validates `media/ui` even when build is skipped, but the validation is marker-based.         |
| `packages/vscode-extension/esbuild.mjs`                       | Normal extension build copies `packages/overlay/dist-vite` into `media/ui`.                                 |
| `packages/vscode-extension/script/package-vsix.ts`            | `--skip-build` validates existing `media/ui` before packaging.                                              |

## Impact Sweep

| Sweep                                                                                                                                                                                                          | Result                                                                                                                                              | Decision                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `rg -n "prompt-profile                                                                                                                                                                                         | Expert                                                                                                                                              | SelectControl                                        | oc-select" packages/overlay/src packages/overlay/test specs/new-arch` | Expert Squad still renders through shared `SelectControl`; shared `.oc-select-content` and `.oc-select-option` own popup foreground/background. | Do not patch component-local colors.                           |
| `node --input-type=module -e "import { assertOverlayUiBundleDir } from './packages/vscode-extension/script/overlay-ui-bundle-assertions.mjs'; assertOverlayUiBundleDir('packages/vscode-extension/media/ui')"` | Current stale `media/ui` passes the retired-marker assertion.                                                                                       | Strengthen assertion beyond marker checks.           |
| Hash inventory of `packages/overlay/dist-vite` and `packages/vscode-extension/media/ui`                                                                                                                        | Every generated asset except the logo differs; `media/ui` still contains old scrollbar CSS while `dist-vite` contains current ledger scrollbar CSS. | Make `dist-vite` the single source and reject drift. |
| `rg -n "assertPackageOverlayUiAssets                                                                                                                                                                           | assertOverlayUiBundleDir                                                                                                                            | media/ui                                             | dist-vite" packages/vscode-extension`                                 | The package and build paths already have one validation hook.                                                                                   | Extend that hook instead of creating a second validation path. |

## Fix Plan

1. Add a reusable directory-sync assertion to
   `packages/vscode-extension/script/overlay-ui-bundle-assertions.mjs`.
2. Make `assertPackageOverlayUiAssets(extensionRoot)` validate both:
   retired-marker hygiene and exact `media/ui` equality with sibling
   `../overlay/dist-vite`.
3. Keep `esbuild.mjs` on the same helper after its normal copy step.
4. Add unit coverage for drifted `media/ui` and `--skip-build` packaging.
5. Sync tracked `packages/vscode-extension/media/ui` from current
   `packages/overlay/dist-vite`.

## Acceptance

- `media/ui` and `dist-vite` have the same recursive relative file set and
  byte contents.
- `--skip-build` rejects clean-looking but drifted `media/ui`.
- Normal build validation still rejects retired prompt-profile native-select
  markers.
- No Expert Squad-specific CSS override or Select component fork is introduced.
