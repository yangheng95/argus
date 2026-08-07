# Prompt Profile Trigger Select Primitive

Date: 2026-06-18

## Report

The Expert Squad selector readability report exposed a remaining component
reuse gap after option contrast was fixed: the selector popup used shared
`.oc-select-*` classes, but the trigger still carried only its local
`.prompt-profile-select-trigger` class.

## Recall

| Source                                                   | Existing decision                                                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `2026-06-16-prompt-profile-expert-squad-switching.md`    | The Overlay selector must use the same mature select/list pattern as other settings controls.               |
| `2026-06-17-prompt-profile-selector-select-primitive.md` | The prompt-profile picker must not keep native select chrome or a parallel visual control.                  |
| `2026-06-18-popup-contrast-light-palette.md`             | Expert Squad popup readability belongs to shared `.oc-select-*` popup contracts, not local color overrides. |

## Impact Sweep

| Sweep                                              | Result                                                                                                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n '<Select\\.Trigger                          | oc-select-trigger                                                                                                                                         | data-ui="prompt-profile-selector"' packages/overlay/src packages/overlay/test` | AppDialog, Browser Preview, Log Viewer, and settings primitives use `.oc-select-trigger`; Expert Squad was the only active `Select.Trigger` without it. |
| `packages/overlay/src/index.html` stylesheet order | `field.css` loads after `composer.css`, so adding the shared class requires a higher-specificity local selector for the compact two-line composer layout. |

## Fix

- Add `.oc-select-trigger` to the Expert Squad `Select.Trigger`.
- Keep the local trigger class for the composer-specific compact two-line
  layout.
- Use `.prompt-profile-select-trigger.oc-select-trigger` for local layout
  rules so the later shared `field.css` rule cannot unintentionally override
  the Expert Squad spacing.
- Extend the real browser selector test to save the opened popup screenshot and
  assert the trigger carries both shared and local classes.

## Acceptance

- Expert Squad trigger participates in the shared Select trigger primitive.
- The compact trigger layout keeps its 10px scaled gap after `field.css` loads.
- The opened selector screenshot and contrast assertions remain green on light
  theme.
