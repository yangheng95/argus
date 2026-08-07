# Retire File Editor Nav Residue

Date: 2026-06-19

## Problem

`FileEditorPane` header controls now render through the shared `Button`
primitive with `data-ui="file-editor-save"` and `data-ui="file-editor-close"`.
`workspace.css` still kept a dead `.file-editor-nav` rule family that is not
referenced by production TSX or tests.

The 2026-06-18 file editor button primitive plan intentionally left
`.file-editor-nav` for a later cleanup pass because it was suspected dead CSS.
The current sweep confirms it has no owner.

## Recall

| Source                                                            | Evidence                                                                      | Decision                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| `FileEditorPane.tsx`                                              | Save and close controls render as `<Button>` with `data-ui` hooks.            | Keep current component code.                   |
| `workspace.css`                                                   | `.file-editor-nav` defines raw button color, layout, hover, and cursor rules. | Delete the orphan selector family.             |
| `file-explorer-editor.test.ts`                                    | Already rejects `.file-editor-save` and `.file-editor-close` raw classes.     | Extend the guard to reject `.file-editor-nav`. |
| `rg -n "file-editor-nav" packages/overlay/src --glob "!**/*.css"` | No production owner outside CSS.                                              | Treat as dead CSS residue.                     |

## Fix

- Delete `.file-editor-nav` rules from `workspace.css`.
- Extend the file explorer/editor source guard to reject `file-editor-nav` in
  both component source and workspace CSS.

## Acceptance

- `packages/overlay/src` has no `.file-editor-nav` production selector.
- File editor Save/Close remain owned by `.oc-button[data-ui=...]`.
- Existing file explorer/editor tests and overlay typecheck pass.

## Verification

- `bun test packages/overlay/test/file-explorer-editor.test.ts packages/overlay/test/workspace-composer-density.test.ts packages/overlay/test/overlay-architecture-guards.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-concurrency=1 --test-name-pattern "file explorer exposes accessible rows and file editor buttons" packages/overlay/test/browser/file-explorer-accessibility.test.ts`
- Visual review: `.scratch/file-editor-button-primitive.png`
