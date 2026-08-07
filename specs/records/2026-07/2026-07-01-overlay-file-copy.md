# Overlay File Copy

Date: 2026-07-01

## Requirement

Further improve the overlay file manager by adding real project-scoped file and
directory copy support.

## Recall

| Category | Evidence |
| --- | --- |
| User request | "进一步完善文件管理器" after the prior investigation showed Explorer copy is missing. |
| Acceptance criteria | Copy a file or directory from the Explorer context menu; multi-copy selected top-level items; preserve source items; write only through project-scoped backend APIs; reject overwrite, missing parent, traversal, root copy, and symlink escape; update SDK/OpenAPI; cover service, route, static overlay, and browser visual tests. |
| Hard constraints | No fallback/compat logic; no overlay direct filesystem mutation; no frontend read-create imitation of copy; no overwrite or auto-rename; Kobalte context menu remains the command surface; overlay UI changes need real browser screenshots; do not restart or disturb the user's running OpenCorvus/overlay process. |
| Sources read | `AGENTS.md`; `specs/records/2026-06/2026-06-01-overlay-file-explorer-editor.md`; `2026-06-26-overlay-full-file-browser.md`; `2026-06-28-overlay-file-context-menu-multiselect.md`; `2026-06-28-overlay-vscode-file-operations-and-syntax.md`; `packages/opencorvus/src/file/index.ts`; `packages/opencorvus/src/server/routes/file.ts`; `packages/overlay/src/services/file-workbench.ts`; `packages/overlay/src/components/FileExplorerPanel.tsx`; Explorer static and browser tests. |
| Whole-repository grep | `rg -n "File\\.(read|list|writeText|upload|create|move|remove|copy)|CreateRequest|MoveRequest|MoveResult|DeleteResult|FileInvalidPathError|FileConflictError|FileNotFoundError|UploadConflictError|namedErrorStatus|/file/item|file\\.create|file\\.move|file\\.delete|file\\.copy" packages/opencorvus/src packages/opencorvus/test packages/sdk packages/overlay/src packages/overlay/test specs -S`; `rg -n "FileExplorerPanel|file-workbench|createFileItem|moveFileItem|deleteFileItem|copyFileItem|ContextMenu|file-explorer-context|ExplorerSelection|topLevelActionSelections|moveItems|deleteItems|runMutation|mutationOperation|explorer\\.(new_file|new_folder|rename|move|delete|refresh|upload|copy|copy_success|copy_many)" packages/overlay/src packages/overlay/test -S`; `rg -n "copy|复制|fs\\.cp|fs\\.copyFile|copyFileSync|cpSync|copyRecursive|clipboard|Clipboard|navigator\\.clipboard|project\\.copy|common\\.copy" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records/2026-06 specs/records/2026-07 -S`. |
| Grep result | File service and route support read/list/write/upload/create/move/remove only. SDK/OpenAPI expose `file.create`, `file.move`, and `file.delete` under `/file/item`; no `file.copy`. Overlay service exposes `createFileItem`, `moveFileItem`, and `deleteFileItem`; no copy wrapper. Explorer context menus render open/upload/new/rename/move/delete/refresh only. Browser tests verify create/rename/move/delete/upload and multi-move/delete, not copy. Existing clipboard copy actions are unrelated text/image/debug/project-directory copy surfaces and must not be reused for filesystem copy. |
| Independent agent feedback | Not spawned. The available `multi_agent_v1` tool explicitly forbids spawning sub-agents unless the user asks for sub-agents/delegation; this task has no such authorization. Main-agent grep and code inspection are the evidence source for this record. |

## Contract

### Backend

- Add `File.CopyRequest = { path, newPath }`.
- Add `File.CopyResult = { sourcePath, path, node }`.
- Add `File.copy(input)` beside `create`, `move`, and `remove`.
- Add `POST /file/item/copy` with operation id `file.copy`.
- Copy files and directories recursively through the backend only.
- Reuse the existing project/worktree canonical boundary checks.
- Require the source to exist and the destination parent to exist.
- Reject empty/root source, traversal, symlink escape, missing source, missing parent, and existing destination.
- Do not overwrite, auto-rename, or create missing destination parents.

### Overlay

- Add `copyFileItem(path, newPath, scope)` in `file-workbench.ts`.
- Add context-menu Copy for file and directory rows.
- Copy asks for a destination path. For multi-copy it asks for a destination directory and preserves selected names.
- Copy supports the same top-level selection filtering used by multi-move/delete, so selecting a directory and its descendants copies only the selected directory.
- Copy refreshes affected destination/source directories and keeps existing editor state unchanged.
- Errors are surfaced from the API response through the existing command message path.

## Implementation Plan

1. Backend service: add copy schemas, implement source/destination validation using existing helpers, and use `fs.promises.cp` for recursive copies after validation.
2. Backend route/OpenAPI: expose `POST /file/item/copy`, map existing file named errors through the single error handler, and refresh generated SDK/OpenAPI outputs.
3. Overlay service/UI: add wrapper, mutation kind, dialogs, context-menu entries, multi-copy function, success i18n, and static assertions.
4. Browser test: extend the existing Explorer real-browser scenario to copy a file and multi-copy selected items through context menus; capture menu/dialog screenshots.
5. Verification: run focused file service/route tests, overlay static test, Explorer browser test through Node Playwright, SDK route contract tests, historical docs link test, typechecks, and a final diff review.

## Toolchain Addendum

Running the generated-artifact entry point exposed a docs toolchain defect:
`script/generate.ts` rendered API MDX and then ran Prettier over the same files,
while `docs:check` byte-compares the raw docs renderer output. The fix keeps the
API MDX files under `render-api-md.ts` as their single formatting source and
excludes them from the generated-artifact Prettier pass.

The SDK OpenAPI file is regenerated from `packages/sdk/js/script/build.ts` after
the full generate run so this change keeps the tracked OpenAPI diff scoped to
the new `/file/item/copy` operation instead of unrelated JSON formatting churn.
