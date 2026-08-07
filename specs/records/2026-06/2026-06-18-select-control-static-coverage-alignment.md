# Select Control Static Coverage Alignment

Date: 2026-06-18

GUI means Graphical User Interface. CSS means Cascading Style Sheets.

## Problem

The Expert Squad selector was rechecked after the light popup readability
report. Real browser evidence shows the current selector and shared Select
popup matrix render readable unselected options on a white popup surface.
However `theme-form-control-coverage.test.ts` still expects several callers to
spell out shared `oc-select-*` classes directly.

That expectation is now stale because `SelectControl` is the single Kobalte
Select shell and composes shared classes with caller classes internally. Keeping
the stale assertions makes the guard fail even when the production path is
correct, and can push future fixes toward duplicated caller-owned class logic.

## Recall

| Source                                                   | Relevant decision                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `2026-06-17-prompt-profile-selector-select-primitive.md` | Expert Squad must use Kobalte Select rather than native select plus hidden chrome.        |
| `2026-06-17-expert-squad-select-readability-impact.md`   | Shared `.oc-select-*` popup styling is the single Select readability source.              |
| `2026-06-18-select-popup-readability-impact-review.md`   | Do not add component-local foreground/background overrides to `.prompt-profile-select-*`. |
| `2026-06-18-popup-contrast-light-palette.md`             | Select and non-Select popup contrast are guarded by browser matrices.                     |

## Evidence

| Check                                                                                                                                                                                      | Result                                                                                                                                           | Decision                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/prompt-profile-selector-browser.test.ts`                                                                      | Passes and saves `.scratch/prompt-profile-selector-current.png`; unselected Expert Squad options are readable.                                   | Do not change production Expert Squad CSS.                                        |
| `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/select-popup-contrast-matrix.test.ts`                                                                         | Passes and saves `.scratch/select-popup-contrast-matrix.png`; every Select consumer includes unselected option coverage.                         | Keep the matrix as the visual source.                                             |
| `bun test packages/overlay/test/theme-form-control-coverage.test.ts packages/overlay/test/select-control-single-source.test.ts packages/overlay/test/popup-contrast-matrix-source.test.ts` | Fails only on stale static expectations that callers contain composed `oc-select-*` class strings or that `SelectControl` itself is a violation. | Update the static guard to inspect the single source and caller props separately. |

## Fix Plan

1. Keep production Select and popup CSS unchanged.
2. Make the static guard assert that `SelectControl` composes
   `oc-select-trigger`, `oc-select-content`, `oc-select-listbox`,
   `oc-select-option`, and `oc-select-indicator`.
3. Make caller assertions check that consumers pass their domain classes to
   `SelectControl`.
4. Exclude `SelectControl.tsx` from the caller-only `Select.Trigger` scan while
   still requiring it to own the Kobalte shell.

## Acceptance

- Expert Squad browser readability test passes and screenshot review confirms
  unselected options are visible.
- Select popup matrix browser test passes and screenshot review confirms all
  sampled unselected options are visible.
- Static form-control coverage passes without requiring duplicated caller-owned
  shared class strings.
