# Overlay Full File Browser

Date: 2026-06-26

## Requirement

Complete the overlay file explorer into a project-scoped file browser that can create, rename, move, and delete files/directories in addition to the existing browse, search, edit, save, and upload behavior.

## Recall

| Source                                                                                 | Relevant constraint                                                                                                                                                           |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                                            | No fallback behavior, no compatibility path, no blind patching, and every code change needs tests.                                                                            |
| `2026-06-01-overlay-file-explorer-editor.md`                                           | Explorer/editor owns lazy browsing, search, text editing, and project-scoped `/file` APIs.                                                                                    |
| `2026-06-18-file-explorer-drag-upload.md`                                              | Uploads must not overwrite, auto-rename, create implicit directories, or accept path traversal.                                                                               |
| `2026-06-18-file-explorer-row-button-semantics.md`                                     | File explorer rows are command buttons, not an incomplete ARIA tree widget.                                                                                                   |
| `packages/opencorvus/src/file/index.ts`                                                | Single backend owner for path canonicalization, project/worktree boundary checks, file reads, writes, upload, list, status, and search.                                       |
| `packages/opencorvus/src/server/routes/file.ts`                                        | Single HTTP owner for file API routes. Current routes are `/file`, `/file/content`, `/file/upload`, and `/file/status`.                                                       |
| `packages/overlay/src/components/FileExplorerPanel.tsx`                                | Single UI owner for lazy directory browsing, search rows, upload strip, row selection/open behavior, and refresh loop.                                                        |
| User correction 2026-06-27                                                             | A single "File commands" menu is not a modern file browser interaction model; row operations should be available from selection-aware controls and right-click context menus. |
| `packages/overlay/src/components/AppDialogHost.tsx` + `src/styles/surfaces/dialog.css` | AppDialog is the single prompt/confirm/input dialog surface; improving prompt visuals belongs to the shared host/style, not file-browser-local CSS.                           |
| `packages/overlay/src/services/file-workbench.ts`                                      | Single overlay service for file explorer/editor data contracts and selected editor state.                                                                                     |

## Impact Sweep

| Sweep                         | Result                                                                                                   | Decision                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n 'File\.(read           | list                                                                                                     | writeText                                                      | upload                      | status                                                                                                                                                 | search)' packages/opencorvus/src packages/opencorvus/test`                                                     | Production callers of file service methods are isolated to CLI debug and `server/routes/file.ts`; tests cover `File.read/list/writeText/upload`. | Add new service methods beside the existing methods and call them only from `FileRoutes`. |
| `rg -n '"/file                | file\.(list                                                                                              | read                                                           | write                       | upload                                                                                                                                                 | status)                                                                                                        | FileUpload                                                                                                                                       | FileExplorerPanel                                                                         | file-workbench' packages/...` | SDK/OpenAPI currently expose only list/read/write/upload/status; overlay uses only `apiJson`, `FileExplorerPanel`, and `file-workbench`. | Add explicit `POST/PATCH/DELETE /file/item` routes and overlay service wrappers; generated SDK must be refreshed if route generation succeeds in this pass. |
| `rg -n 'InvalidDirectoryError | NotFoundError                                                                                            | ConflictError                                                  | File.\*Error' packages/...` | Existing generic `NotFoundError` exists for records; file upload already has `FileUpload*` named errors and 409 mapping for `FileUploadConflictError`. | Add file-specific named errors for invalid path, not found, and conflict, then map them in `namedErrorStatus`. |
| `git diff -- target files`    | Target implementation files are clean except locale files, which already contain unrelated user changes. | Patch target files precisely; preserve unrelated locale edits. |

## Backend Contract

- `POST /file/item`
  - Body: `{ path, type, content? }`, where `type` is `file` or `directory`.
  - Creates exactly one file or directory under an existing parent directory.
  - Does not overwrite and does not create missing parents.
  - Returns `File.Node`.

- `PATCH /file/item`
  - Body: `{ path, newPath }`.
  - Moves or renames a file/directory inside the project/worktree boundary.
  - Does not overwrite and requires destination parent to exist.
  - Returns `{ previousPath, path, node }`.

- `DELETE /file/item`
  - Query: `path`.
  - Deletes the selected file or directory recursively.
  - Rejects empty/root path.
  - Returns `{ path }`.

All mutation paths reuse the backend's canonical project/worktree boundary check. There is no direct filesystem call in overlay.

## UI Contract

- Add an Explorer command surface that matches modern file browser operation
  flow:
  - a visible `New` dropdown for file/folder creation;
  - visible selection actions for rename, move, delete, and refresh;
  - row context menus for right-click file/folder actions.
- Kobalte owns popup/menu semantics:
  - `DropdownMenu.Trigger as={Button}` for the `New` dropdown;
  - `ContextMenu.Trigger as={Button}` for file rows;
  - menu rows use Kobalte `Item as="button"`.
- Do not hand-assemble an icon-only toolbar or hide primary file operations in
  a single generic command menu.
- File commands remain:
  - New file under selected directory or selected file's parent.
  - New folder under selected directory or selected file's parent.
  - Rename selected item.
  - Move selected item by destination path.
  - Delete selected item with armed confirmation.
  - Context-menu delete uses the shared AppDialog confirmation before
    calling the same delete mutation.
  - Refresh visible directories.
- Rows remain buttons. Selecting a directory still toggles it; selecting a file still opens the editor.
- Mutations refresh the affected directory, clear stale selections after deletion, and update the open editor path after file rename/move.
- Error responses are displayed from the API error; no silent fallback, local fake success, or retry disguise.
- Ordinary AppDialog prompts use the shared `app-dialog-form` shell: compact
  flat header, direct message copy, clear input spacing, and non-gradient
  action footer.

## Tests

- Backend service tests:
  - create file and directory;
  - reject missing parents and conflicts;
  - move/rename without overwrite;
  - delete file and directory;
  - reject root delete and traversal.
- Route tests:
  - create/move/delete happy paths;
  - invalid path maps to 400;
  - missing file maps to 404;
  - conflict maps to 409.
- Overlay static tests:
  - service wrappers call `apiJson`;
  - toolbar/dialog/delete controls are present;
  - no direct `fetch`.
- Browser test:
  - create file, rename it, move it, delete it through the real Explorer UI fixture;
  - capture a screenshot of the command toolbar/dialog surface.
