# VSIX Skip Build Media UI Contrast Guard

## Context

The Expert Squad selector readability report could not be reproduced in the
current overlay source or the current `media/ui` bundle. Both independent scans
found the same old root cause: a retired prompt-profile native `<select>` plus
separate chrome path could leave the real option text transparent on a light
popup surface.

The remaining host-side risk was the VSIX packaging path:

| Path | Evidence | Decision |
| --- | --- | --- |
| `packages/overlay/src/components/ChatComposer.tsx` | Expert Squad now uses shared `SelectControl`, not a native select. | Do not add local color overrides. |
| `packages/overlay/src/styles/surfaces/field.css` | `.oc-select-content` and `.oc-select-option` own popup foreground/background tokens. | Keep shared Select styling as the only visual source. |
| `packages/vscode-extension/esbuild.mjs` | Normal extension builds build and sync `media/ui`, then assert retired prompt-profile markers are absent. | Keep the normal build assertion. |
| `packages/vscode-extension/script/package-vsix.ts` | `--skip-build` previously only assumed existing `dist/` and `media/ui` were current. | Validate existing `media/ui` before packaging, even when skipping the build. |

## Implementation

- Add `assertPackageOverlayUiAssets(extensionRoot)` as the package-level owner
  for `media/ui` bundle validation.
- Add `prepareOverlayUiForVsix(...)` so both normal and `--skip-build` VSIX
  flows pass through the same bundle assertion.
- Keep the assertion in `esbuild.mjs`; VSIX packaging is a second host boundary,
  so it must not trust a previous build blindly.

## Tests

- `packages/vscode-extension/test/package-vsix.test.ts` now covers:
  - `--skip-build` does not rebuild.
  - `--skip-build` still rejects stale prompt-profile native select assets.
  - normal packaging calls the build hook before validating fresh `media/ui`.

## Non-goals

- No Expert Squad-specific CSS colors.
- No local `.prompt-profile-select-*` contrast override.
- No fallback behavior for stale bundles.
