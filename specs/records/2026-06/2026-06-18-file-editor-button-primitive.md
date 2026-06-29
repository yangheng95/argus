# File Editor Button Primitive

Date: 2026-06-18

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model.

## Problem

Independent GUI review found `FileEditorPane` already delegates the editing
body to the `CodeEditor` primitive, but its header actions still render raw
buttons:

- `button.file-editor-save`
- `button.file-editor-close`

`workspace.css` then recreates the button shell, dimensions, hover color,
hover background, and disabled cursor/opacity for those two controls. That is a
second button source beside `components/ui/Button.tsx` and
`styles/primitives/button.css`, and it means focus-visible, hover, disabled, and
density updates can drift from the rest of the overlay.

During browser verification, the first screenshot also exposed that Solid's
portal wrapper inside `#solidFileEditorMount` could shrink to header height,
leaving the CodeMirror editor with a zero-height visual box even though the DOM
text was present. The same file editor pass must prove the editor body paints
before the screenshot is accepted.

## Recall

| Source                                                    | Relevant constraint                                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md`     | `FileEditorPane` was already migrated from raw textarea to `CodeEditor`; the remaining header controls should not stay on local primitives. |
| `2026-06-18-chat-composer-button-primitive-owner.md`      | Operation buttons should use `Button` and stable `data-ui` selectors instead of private raw button classes.                                 |
| `2026-06-18-workspace-split-launcher-button-primitive.md` | Workspace controls should route visible trigger chrome through `Button` while preserving layout-specific data hooks.                        |
| `2026-06-18-project-worktree-remove-button-primitive.md`  | Local button shell, hover, disabled, and focus ownership should move to `Button`; surface CSS should only set scoped variables.             |
| `packages/overlay/src/components/ui/Button.tsx`           | `Button` owns `.oc-button`, `variant`, `size`, and `tone`.                                                                                  |
| `packages/overlay/src/styles/primitives/button.css`       | Focus-visible, hover, disabled, icon-action, and solid/ghost button behavior are single-sourced here.                                       |

## Impact Sweep

| Sweep                                        | Result                                                                                                                                                      | Decision                                                                                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n "file-editor-save                     | file-editor-close                                                                                                                                           | file-editor-nav                                                                                                                                        | FileEditorPane" packages/overlay/src packages/overlay/test specs/new-arch` | Production owners are `FileEditorPane.tsx` and `workspace.css`; tests are `file-explorer-editor.test.ts` and `workspace-composer-density.test.ts`. `file-editor-nav` only appears in CSS. | Migrate Save/Close now; do not delete `file-editor-nav` in this patch because it is suspected dead CSS and needs separate cleanup approval. |
| `FileEditorPane.tsx` review                  | The Save action is a real operation button; Close is an icon operation button.                                                                              | Use `Button` for both, with `data-ui="file-editor-save"` and `data-ui="file-editor-close"`.                                                            |
| `workspace.css` review                       | `.file-editor-save` and `.file-editor-close` duplicate button chrome and state.                                                                             | Remove those two selectors from local button shell; retarget only necessary layout variables to `.file-editor-header .oc-button[data-ui=...]`.         |
| `file-explorer-accessibility.test.ts` review | Existing browser fixture opens a real center workbench file editor by selecting `src/main.tsx`.                                                             | Extend it to assert `.oc-button`, disabled Save, focus ring, Close icon-action chrome, and screenshot evidence.                                        |
| Browser screenshot review                    | DOM text existed in `.cm-content`, but the screenshot was blank because the portal wrapper, `.file-editor-pane`, and CodeMirror boxes had zero body height. | Give the file-editor mount's portal wrapper and pane an explicit flex/full-height contract and assert editor/body boxes are visible before screenshot. |

## Fix Plan

1. Import `Button` in `FileEditorPane.tsx`.
2. Replace Save with `<Button variant="ghost" size="sm">`, preserving
   disabled, dirty, saving label, and save callback.
3. Replace Close with `<Button variant="ghost" size="icon" tone="neutral"
data-chrome="icon-action">`, preserving title, ARIA label, icon, and close
   callback.
4. Retarget workspace CSS to
   `.file-editor-header .oc-button[data-ui="file-editor-save"]` and
   `.file-editor-header .oc-button[data-ui="file-editor-close"]`.
5. Update static tests to reject the retired `file-editor-save` /
   `file-editor-close` raw classes and require `Button` primitive ownership.
6. Extend the existing file explorer browser test with real file editor
   focus/disabled/screenshot assertions.
7. Assert the editor body has nonzero visual height and text is visible before
   saving screenshot evidence.

## Acceptance

- File editor Save and Close render as `.oc-button`.
- `FileEditorPane.tsx` no longer emits `class="file-editor-save"` or
  `class="file-editor-close"`.
- `workspace.css` no longer styles `.file-editor-save` or `.file-editor-close`
  as private button classes.
- Disabled Save remains visible and keyboard focus on Close uses the shared
  `Button` focus ring.
- Browser screenshot evidence covers the center workbench file editor with
  visible text content, not only DOM text.
