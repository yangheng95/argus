# 2026-06-19 Retire Dialog Head Residue

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Problem

`.dialog-header` is the Dialog primitive's current header contract, but the old
`.dialog-head` selector still exists in dialog CSS and in the settings snapshot
helper. That keeps accepting a retired dialog header shape and can hide a future
regression where a feature-local dialog bypasses the primitive.

## Recall

| Source                                                | Relevant constraint                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md` | Dialog migration preserves `.dialog-form` and `.dialog-header` as the public CSS contract.                          |
| `2026-06-19-retire-session-dialog-diff-residue.md`    | Session dialogs now delegate title and form chrome to the Dialog primitive.                                         |
| `Dialog.tsx` inspection                               | The primitive emits `.dialog-header`, `.dialog-title`, and `.dialog-header-actions`; it never emits `.dialog-head`. |
| `dialog-primitive.test.ts`                            | Tests already assert the primitive's `.dialog-header` class.                                                        |

## Impact Sweep

| Sweep                                                                                                                                                   | Result                                                                               | Decision                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `rg --pcre2 '(?<![A-Za-z0-9_-])dialog-head(?![A-Za-z0-9_-])' packages/overlay/src packages/overlay/test packages/overlay/script specs`   | Three live hits: two in `dialog.css`, one compatibility query in `snap-settings.ts`. | Remove all current-source `.dialog-head` references.                        |
| `rg --pcre2 '(?<![A-Za-z0-9_-])dialog-header(?![A-Za-z0-9_-])' packages/overlay/src packages/overlay/test packages/overlay/script specs` | Production primitive and browser tests use `.dialog-header`.                         | Keep `.dialog-header` as the only header selector.                          |
| `packages/overlay/src/styles/surfaces/dialog.css`                                                                                                       | `.dialog-head` duplicates the same flex layout that `.dialog-header` owns.           | Delete the old rule and remove it from the direct-child form selector.      |
| `packages/overlay/script/snap-settings.ts`                                                                                                              | Helper queries `.dialog-header,.dialog-head`, accepting both old and new DOM.        | Query only `.dialog-header` so snapshot diagnostics fail on retired markup. |

## Fix Plan

1. Delete the standalone `.dialog-head` rule from `dialog.css`.
2. Remove `.dialog-form > .dialog-head` from the shared form-header selector.
3. Change `snap-settings.ts` to query only `.dialog-header`.
4. Extend the dialog cleanup test to reject exact `.dialog-head` in current
   source and snapshot helpers.
5. Run dialog unit tests plus the config/app dialog browser screenshots and
   inspect the rendered header.

## Acceptance

- Exact `.dialog-head` has no current-source hits under overlay source, tests,
  scripts, specs, or new-arch notes except historical documentation before this
  file.
- Dialog primitive still emits `.dialog-header`.
- Config and app dialog browser tests pass and screenshots show unchanged header
  spacing/title/action layout.
