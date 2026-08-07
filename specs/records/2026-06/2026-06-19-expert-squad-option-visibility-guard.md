# Expert Squad Option Visibility Guard

## Recall

- `2026-06-17-prompt-profile-selector-select-primitive.md` removed the old native select plus hidden chrome split and moved Expert Squad to Kobalte Select.
- `2026-06-17-select-popup-opaque-surface.md` made `.oc-select-content` use opaque `--menu-panel-bg`.
- `2026-06-18-select-popup-readability-impact-review.md` decided not to add component-local `.prompt-profile-select-*` color overrides.
- `2026-06-18-expert-squad-unselected-option-contrast-guard.md` added real browser contrast coverage for unselected Expert Squad options.
- `2026-06-19-prompt-profile-select-runtime-contrast.md` proved Kobalte runtime `aria-selected`, `data-selected`, and `data-highlighted` states on the real selector.

## Evidence

| Source                                                                                                                | Finding                                                                                                                                             | Decision                                                              |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Independent owner review                                                                                              | Expert Squad is `ChatComposer.tsx` using `SelectControl<PromptProfileOption>`; color owner is shared `field.css`, not local prompt-profile CSS.     | Keep production CSS unchanged unless the shared selector fails.       |
| Independent impact review                                                                                             | SelectControl consumers are already covered by `select-popup-contrast-matrix`; non-Select popup gaps are separate.                                  | Harden the real Expert Squad browser test first.                      |
| Independent test review                                                                                               | Current test catches white text on white background, but not `display`, `visibility`, `opacity`, zero-size rendering, or `-webkit-text-fill-color`. | Add visibility and text-fill assertions to the existing runtime test. |
| `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/prompt-profile-selector-browser.test.ts` | Current runtime screenshot remains readable after the new assertions.                                                                               | No component-local visual patch is justified.                         |

## Fix

- Extend the real `prompt-profile-selector-browser.test.ts` path.
- Keep the screenshot target as `.prompt-profile-select-content`.
- Assert the popup content and every option are rendered: `display != none`, `visibility == visible`, opacity at least `0.95`, and non-zero bounding box.
- Assert each option and each label/description part has both normal `color` and `-webkit-text-fill-color` contrast of at least `4.5` against the effective light popup surface.
- Preserve existing Kobalte runtime state assertions for unselected and highlighted options.

## Acceptance

- The reported Expert Squad white-background unselected-option bug is guarded at real runtime visibility and text-paint layers.
- No fallback, local color override, raw color, or duplicate select implementation is introduced.
- VS Code media synchronization still must be verified after browser tests because Vite rebuilds can leave `dist-vite` newer than `media/ui`.
