# File Explorer Row Focus Visible

Date: 2026-06-20

## Problem

The File Explorer rows are real buttons, but their hover and keyboard focus
selectors were merged:

```css
.file-explorer-row:hover,
.file-explorer-row:focus-visible {
  background: var(--subtle-2);
  color: var(--text-strong);
  outline: 0;
}
```

That made keyboard focus depend on the same fill as hover and explicitly
removed the focus outline. The row button semantics were correct, but the
keyboard-visible state was not independently visible.

## Recall

| Source                                             | Relevant decision                                                                                                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-file-explorer-row-button-semantics.md` | File Explorer rows stay as dense row buttons, not an incomplete ARIA tree widget. Directory rows expose `aria-expanded`; the current file row exposes `aria-current`.  |
| `2026-06-18-file-editor-button-primitive.md`       | The existing browser fixture opens the real File Explorer through the right toolbar and validates the center workbench, so row focus coverage belongs in that fixture. |
| `2026-06-19-workspace-split-menu-focus-ring.md`    | Hover/highlight styling must not replace a distinct `:focus-visible` ring.                                                                                             |

## Impact Sweep

| Sweep                                                                                                                                                                                 | Result                                                                    | Decision                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------- | --------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `rg -n "file-explorer-row                                                                                                                                                             | file-explorer.\*focus-visible                                             | outline:\\s\*0                                                           | openFile | data-path | file-explorer-accessibility" packages/overlay/src packages/overlay/test specs` | Only `inspector.css` owned the File Explorer row visual state. Existing browser coverage clicked rows but did not Tab to rows or assert focus visuals. | Split hover and focus-visible rules and extend the real browser fixture. |
| `git diff -- packages/overlay/src/styles/surfaces/inspector.css packages/overlay/test/browser/file-explorer-accessibility.test.ts packages/overlay/test/file-explorer-editor.test.ts` | Target files were clean before the fix.                                   | Safe to edit these files without overwriting unrelated worktree changes. |
| `2026-06-18-file-explorer-row-button-semantics.md`                                                                                                                                    | The established row model is a command button list, not a tree primitive. | Do not introduce tree roles or custom roving-keyboard state.             |

## Fix

- Keep File Explorer rows as native `<button>` controls.
- Split `.file-explorer-row:hover` from `.file-explorer-row:focus-visible`.
- Give `:focus-visible` the same tokenized fill plus a tokenized outline using
  `var(--oc-border-width)` and `var(--accent)`.
- Add a static guard that rejects the old merged hover/focus block and rejects
  `outline: 0` or `outline: none` on the File Explorer row focus rule.
- Extend the browser fixture to Tab to directory and file rows, assert
  `:focus-visible`, use Enter to expand a directory, use Space to open a file,
  and save `.scratch/file-explorer-row-focus-visible.png` for visual review.

## Acceptance

- Keyboard focus on File Explorer rows has an independent visible outline.
- Directory rows remain native buttons and expand with Enter.
- File rows remain native buttons and open with Space.
- The current-file ARIA contract from the prior row semantics fix still holds.
- No raw color, fallback path, alternate primitive, or duplicate row model is
  introduced.
