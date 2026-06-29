# File Item Alias Target Path

Date: 2026-06-29

## Requirement

Fix the overlay Explorer move failure where `PATCH /file/item?directory=/workspace` returns `FileInvalidPathError` for a project-relative destination such as `.nova-vibecoding-template/.agents` even though the destination stays inside the active project.

## Recall

| Source | Relevant evidence |
| --- | --- |
| User report screenshot | `API 400 file/item?directory=%2Fworkspace` with `FileInvalidPathError` and `path: ".nova-vibecoding-template/.agents"` during an overlay file-manager move. |
| `AGENTS.md` | No fallback, no dual source, inspect landed plans before edits, every code change needs tests, and do not patch around the real problem. |
| `specs/README.md` and `specs/records/2026-06/README.md` | New records must live under `specs/records/2026-06/`, include Recall, and update the index. |
| `2026-06-01-overlay-file-explorer-editor.md` | Explorer/editor must use the project-scoped file API and path traversal protection. |
| `2026-06-26-overlay-full-file-browser.md` | Create, move, and delete use `/file/item`; mutation paths reuse backend canonical project/worktree boundary checks. |
| `2026-06-28-overlay-file-context-menu-multiselect.md` | Multi-move uses the existing single-item API per selected item; no new backend route or fallback path. |
| `2026-06-28-overlay-vscode-file-operations-and-syntax.md` | Drag/drop move and context-menu move share the same existing move helpers and backend API. |
| `2026-06-27-project-path-reference-task-delete-root-repair.md` | Project identity intentionally preserves the selected path alias instead of realpath-canonicalizing visible project paths. |

## Acceptance

- Moving `.agents` to `.nova-vibecoding-template/.agents` through `/file/item` succeeds when the selected project directory is a symlink/junction alias whose real path differs from its visible path.
- Creating and uploading to non-existing child paths under a path-alias project still pass only when the nearest existing parent resolves inside the active project/worktree.
- Traversal and symlink-escape protections remain intact; no frontend retry, silent success, or compatibility path is added.
- Targeted tests cover the backend service and HTTP route that produced the visible `API 400`.

## Whole-Repository Search Evidence

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "FileInvalidPathError\|file/item\|File\.move\|File\.create\|File\.upload" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test` | `File.InvalidPathError` and `/file/item` are owned by `packages/opencorvus/src/file/index.ts` and `packages/opencorvus/src/server/routes/file.ts`; overlay calls only `createFileItem`, `moveFileItem`, and `deleteFileItem` wrappers in `file-workbench.ts`. | Fix the single backend path boundary check. Do not add overlay-side conversion or retry. |
| `rg -n "canonicalPath\|isPathAllowed\|assertAllowedFilePath" packages/opencorvus/src packages/opencorvus/test` | File service boundary checks all flow through `canonicalPath` -> `isPathAllowed`; create/move/remove/upload/list/read reuse this owner. | Update `canonicalPath` so every file operation receives the same corrected containment decision. |
| `rg -n "symlink\|realpath\|sameFilesystemLocation\|Filesystem\.contains" packages/opencorvus/src packages/opencorvus/test specs/records/2026-06` | Project code already preserves visible path aliases and compares filesystem identity explicitly; file service currently realpaths exact targets and falls back to the unresolved absolute target when the final path is absent. | Resolve the nearest existing ancestor and append the absent suffix, so non-existing mutation targets still compare against the physical project root. |
| `rg -n "PATCH /file/item\|POST/PATCH/DELETE /file/item" packages/opencorvus/test` | Route coverage exists in `packages/opencorvus/test/server/file-routes.test.ts` but lacks path-alias destination coverage. | Add route regression for the reported API surface. |

## Independent Agent Feedback

No sub-agent was spawned because the active tool policy only permits spawning when the user explicitly asks for sub-agents. The independent check here is a separate whole-repository source sweep against route ownership, file service ownership, project alias history, and existing path traversal tests.

## Root Cause

`File.canonicalPath()` calls `realpath()` on the exact target and, when that target does not exist, compares the unresolved absolute string. That is wrong for create/move/upload destinations because those destinations are intentionally absent. If the active project directory is a symlink, junction, bind mount, or other path alias, the project root canonicalizes to its physical path while the non-existing destination remains under the visible alias string. The containment check then reports that the destination escapes the project even when it is project-relative.

## Implementation Plan

- Replace the exact-target missing-path behavior in `canonicalPath()` with nearest-existing-ancestor canonicalization.
- Preserve security: an existing symlink ancestor inside the project that points outside must realpath outside and remain rejected.
- Add service regression coverage for create, move, and upload under an aliased project directory.
- Add route regression coverage for `PATCH /file/item` under an aliased project directory.
- Run targeted file and route tests, then run the spec link health test because this record updates specs.
