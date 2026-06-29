# Overlay VS Code File Operations And Syntax

Date: 2026-06-28

## Requirement

Support common VS Code-style Explorer operations in the overlay, including multi-selection, drag/drop, rename, and syntax highlighting for editable text files.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `AGENTS.md` | No fallback logic, no duplicate sources, inspect landed plans before edits, every code change needs tests, and overlay UI changes need screenshot review. |
| `2026-06-28-overlay-file-context-menu-multiselect.md` | Explorer management commands have no visible toolbar/dropzone; context menu remains the explicit command surface; multi-select is local Explorer state; move/delete use existing `/file/item`. |
| `2026-06-01-overlay-file-explorer-editor.md` | `FileExplorerPanel` owns lazy browsing; `FileEditorPane` owns project-scoped text editing; editor uses the single project-scoped `/file/content` API. |
| `2026-06-18-file-explorer-drag-upload.md` | Uploads must use the existing project-scoped `/file/upload` route, no overwrite/auto-rename/implicit directory creation/path traversal. |
| Current `CodeEditor.tsx` | The editor already uses CodeMirror 6; syntax support should be added as CodeMirror language extensions instead of custom token parsing. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "FileEditorPane|CodeEditor|codemirror|syntax|highlight" packages/overlay/src packages/overlay/test specs/new-arch` | `FileEditorPane` passes text content into `CodeEditor`; `CodeEditor` currently uses `basicSetup` only. | Add a `path` prop to `CodeEditor` and select a CodeMirror language extension from the file extension. |
| `rg -n "moveItems|moveItem|renameItem|deleteItems|uploadDroppedFiles" packages/overlay/src/components/FileExplorerPanel.tsx` | Context-menu move/delete/upload already own the project-scoped mutation and refresh behavior. | Extract drag/drop move/upload through the same existing functions; do not create a second backend path. |
| `rg -n "draggable|data-drag|onDrag" packages/overlay/src packages/overlay/test` | Other drag surfaces use dataset state and CSS; Explorer currently has no row drag after context-menu-only change. | Add Explorer-specific drag state and row drop indicators without touching unrelated drag systems. |
| `bun add --cwd packages/overlay @codemirror/lang-*` | Official CodeMirror language packages installed for JavaScript/TypeScript/JSX/TSX, HTML, CSS, Markdown, JSON, and Python. | Use mature CodeMirror language packages for common code files; plain text remains editable without invented highlighting. |
| Browser test hang after adding language packages | Bun's isolated dependency layout can provide multiple CodeMirror core instances. | `vite.config.ts` must dedupe CodeMirror core packages so `basicSetup`, `Compartment`, `EditorView`, and language extensions resolve through one browser bundle source. |
| Browser test lost multi-selection after drag-move refresh | The selected-file expansion effect called `loadDirectory` while tracked, so directory refreshes could rerun the effect and reset Explorer multi-selection. | Wrap those directory loads in `untrack`; selected-file expansion must not subscribe to directory cache signals. |

## UI Contract

- Multi-select remains: Ctrl/Meta toggles rows, Shift selects visible ranges.
- Rename remains a single-target command through the context menu dialog.
- Dragging a selected row drags the current selected set; dragging an unselected row selects and drags that row.
- Dropping Explorer rows on a directory moves the top-level selected paths into that directory, preserving names.
- Dropping Explorer rows on empty/root area moves the selected paths to the project root.
- Dropping external files on a directory or the root uploads them through the existing upload API.
- Invalid self/descendant drops do not call the backend and show an explicit command error.
- No visible file-management toolbar is restored.
- Editable text files use CodeMirror syntax highlighting for recognized code extensions.
- CodeMirror core packages are explicit overlay dependencies and are deduped in Vite; no parallel CodeMirror state/view/language instances are allowed in the browser bundle.
- The selected-file expansion effect may expand/load ancestors, but it must not track directory cache state or it will overwrite user multi-selection during refresh.

## Acceptance

- Static tests prove Explorer rows are draggable, expose drag-over state, and drag/drop calls the same move/upload mutation helpers.
- Browser tests cover multi-select drag move into a folder and root upload by drop.
- Static tests prove `CodeEditor` imports official CodeMirror language packages and receives the active file path from `FileEditorPane`.
- Static tests prove Vite dedupes CodeMirror core packages and the selected-file expansion directory load is untracked.
- Browser screenshot review covers drag-over visual state and highlighted editor content.
