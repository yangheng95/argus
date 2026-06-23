# AppDialog Recommended Badge Primitive

Date: 2026-06-20

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model.

## Recall

| Source                                            | Relevant constraint                                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                       | Mature primitives must own repeated UI chrome; frontend changes require real browser screenshots.           |
| `2026-06-20-app-dialog-task-decision-keyboard.md` | AppDialog task decisions must keep the real `AppDialogHost` and shared Kobalte `SegmentedControl` chain.    |
| `2026-06-09-overlay-ui-tech-debt-consensus.md`    | Overlay controls should converge on mature/shared primitives, and tests should stop preserving debt shapes. |
| Settings primitives review                        | `SettingsPill` is settings-surface owned and should not become a general overlay badge by import leakage.   |
| Inline pill review                                | `gwg-priority-badge` is a dotted advisory status, not a generic compact label.                              |

## Problem

Independent GUI review found AppDialog task decisions still render the
recommended label with a private span:

- `AppDialogHost.tsx` renders
  `<span class="app-dialog-decision__badge">`.
- `dialog.css` owns `.app-dialog-decision__badge` chrome.
- `app-dialog-segmented-control.test.ts` queries the private selector and
  therefore protects the debt shape.

The task decision option itself correctly uses `SegmentedControl`, but the
recommended label remains a separate hand-written tag primitive. The same
pattern appears in Architect and Integrity, so preserving another local class
would continue the tag/chip drift.

## Impact Sweep

| Sweep                                                                                                                     | Result                                                                                                                 | Decision                                                       |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `rg -n "app-dialog-decision\_\_badge                                                                                      | recommended                                                                                                            | AppDialogHost                                                  | SegmentedControl" packages/overlay/src packages/overlay/test specs/new-arch -S` | AppDialog recommended badge is isolated to `AppDialogHost`, `dialog.css`, static tests, and the real browser test. | Migrate AppDialog only in this slice. |
| `Get-ChildItem packages/overlay/src/components/ui`                                                                        | No shared read-only Tag/Pill/Badge primitive exists.                                                                   | Add a minimal `Badge` primitive under `components/ui`.         |
| `rg -n -e "inline-pill" -e "s-pill" -e "gwg-priority-badge" packages/overlay/src packages/overlay/test specs/new-arch -S` | Existing pill classes are surface-specific: settings or GWG.                                                           | Do not import them into AppDialog.                             |
| AppDialog browser test review                                                                                             | The test already opens the real overlay, screenshots focus/hover, and checks badge color through the private selector. | Keep the visual test but query the shared `oc-badge` contract. |

## Fix Plan

1. Add `Badge` as a read-only span primitive with `tone` and optional `size`
   data attributes.
2. Add `styles/primitives/badge.css` and load it from `index.html` beside other
   primitives.
3. Replace AppDialog recommended label with `<Badge tone="accent" size="sm">`.
4. Delete `.app-dialog-decision__badge` from `dialog.css`.
5. Update static and browser tests to require the shared primitive contract and
   reject the retired private selector.

## Acceptance

- AppDialog recommended label renders through the shared `Badge` primitive.
- `dialog.css` no longer defines badge chrome.
- Browser evidence still shows the real AppDialog task decision, the
  recommended label is visible, no horizontal overflow appears, and Enter,
  Space, and click settlement still work.
- The new primitive uses tokenized CSS only and does not introduce raw colors.
