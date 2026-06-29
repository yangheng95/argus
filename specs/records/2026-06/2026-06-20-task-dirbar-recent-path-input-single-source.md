# TaskDirBar Recent Path Input Single Source

Date: 2026-06-20

CSS means Cascading Style Sheets. DOM means Document Object Model. CWD means
Current Working Directory.

## Recall

| Source                                                    | Relevant constraint                                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                               | GUI work must use mature primitives, avoid double sources, and verify visually when the UI changes.                                         |
| `2026-06-19-task-dirbar-recent-popover-semantics.md`      | The CWD recent popup is a Kobalte Popover dialog with a manual path input, submit action, detected-project rows, and recent-directory rows. |
| `2026-06-18-recent-directory-actions-button-primitive.md` | Recent popup action buttons already moved to the shared `Button` primitive; do not revisit those controls in this slice.                    |
| `2026-06-19-cwd-recent-trigger-button-primitive.md`       | The recent trigger is already a `Button`; keep this fix scoped to the editable path input.                                                  |
| `2026-06-19-retire-field-input-action-residue.md`         | Plain controls use `.field-input`; grouped controls use `.field-input-group`; search controls use `.search-field*`.                         |
| `packages/overlay/src/styles/surfaces/field.css`          | `.field-input` owns plain input chrome, `appearance: none`, tokenized border/background, and the focus ring.                                |

## Problem

Independent GUI review found that `TaskDirBar`'s recent-directory manual path
entry is still a bare `<input>` with only `data-ui="cwd-path-input"`.
`conversation.css` then reimplements input border, radius, background, text,
padding, height, and focus styling through `.recent-dir-edit-label input` and
`.recent-dir-edit-label input:focus`.

That creates a second plain-input implementation beside `.field-input`, and the
manual path entry misses the shared `appearance: none` protection that prevents
browser user-agent form chrome from leaking into themed/portaled controls.

## Evidence Sweep

| Sweep                                 | Result                                                                                                                              | Decision                                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `rg -n "cwd-path-input                | recent-dir-edit-label input                                                                                                         | field-input" packages/overlay/src packages/overlay/test specs -S`                                         | The only production `cwd-path-input` owner is `TaskDirBar.tsx`; the only private input chrome is in `conversation.css`. | Migrate that one input, not unrelated field surfaces. |
| `TaskDirBar.tsx` review               | The path entry is a normal text input and already has a stable `data-ui` locator and i18n placeholder.                              | Add `class="field-input"` and keep the behavior/event wiring unchanged.                                            |
| `conversation.css` review             | `.recent-dir-edit-label input` duplicates shared input chrome and `.recent-dir-edit-label input:focus` duplicates the focus source. | Delete the private chrome/focus selectors; keep only local layout sizing on `.recent-dir-edit-label .field-input`. |
| `task-dirbar-keyboard.test.ts` review | The real browser flow already opens the recent dialog, focuses `cwd-path-input`, and screenshots the popup.                         | Extend it to verify `field-input` ownership and focused input visual state.                                        |
| Independent explorer audit            | Confirmed high confidence and found no historical evidence requiring private input chrome.                                          | Proceed with a narrow single-source fix.                                                                           |

## Fix Plan

1. Add `class="field-input"` to the `cwd-path-input` input.
2. Remove `.recent-dir-edit-label input` and `.recent-dir-edit-label input:focus`
   private chrome from `conversation.css`.
3. Add only layout sizing for `.recent-dir-edit-label .field-input` so the
   popup keeps its compact grid fit without taking ownership of color, border,
   background, or focus ring.
4. Update static tests to require `field-input` on `cwd-path-input` and reject
   the retired private input/focus selectors.
5. Update the real browser TaskDirBar test to verify the focused manual path
   input uses `.field-input` and produces screenshot evidence.

## Acceptance

- `cwd-path-input` uses the shared `.field-input` primitive.
- `conversation.css` no longer defines private path-input border, background,
  color, or focus styling.
- Recent trigger, submit button, remove button, and row semantics remain
  unchanged.
- Static and browser tests cover the single-source contract.
- Visual evidence shows the focused recent path input in the real popup.
