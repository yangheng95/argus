# File Explorer Drag Upload

## Requirement

Add drag-and-drop upload to the overlay file explorer, including the browser-served Web UI. Dropped files are written into the directory currently shown by the explorer through the existing project-scoped file API. The overlay and Web UI must share the same implementation path.

## Non-Negotiable Behavior

- No fallback upload path: uploads use `apiJson` and the project-scoped file route only.
- No overwrite and no auto-renaming: an existing destination file is a hard conflict.
- No implicit directory creation: the selected upload target must already be an existing project directory.
- No path traversal or dropped relative paths: each browser `File.name` is treated as a basename and rejected if it contains separators, `..`, or platform-reserved file names.
- Multi-file drops are atomic at validation time: duplicate names or existing destinations reject before any write occurs.

## Existing Sources And Call Points

| Surface                                                         | Evidence                                                                                         | Decision                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/server/routes/file.ts`                 | Owns `/file`, `/file/content`, `/find/file`, `/file/status`; mounted once from `AppRoutes`.      | Add `POST /file/upload` here.                                                                                  |
| `packages/opencorvus/src/file/index.ts`                         | Owns canonical path checks, `File.read`, `File.list`, `File.writeText`, and `File.Event.Edited`. | Add `File.upload` beside `writeText` and reuse the same project/worktree boundary checks.                      |
| `packages/overlay/src/components/FileExplorerPanel.tsx`         | Owns lazy directory browsing, search, current directory resource state, and refresh loop.        | Add drag/drop state and upload calls directly to explorer; refresh the affected directory after success.       |
| `packages/overlay/src/services/file-workbench.ts`               | Owns file explorer/editor data contracts and selected file state.                                | Add upload payload/result types and the `uploadDroppedFiles` API wrapper.                                      |
| `packages/overlay/src/services/api.ts`                          | Single overlay/Web UI HTTP transport.                                                            | Keep unchanged; the new route is project-scoped by existing route policy.                                      |
| `packages/transport-protocol/src/index.ts`                      | Requires directory for every non-bypass route.                                                   | Keep unchanged; `/file/upload` is not bypassed.                                                                |
| `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/*`        | Generated SDK outputs include file routes.                                                       | Do not hand-edit; regenerate only if the repo's SDK generation is part of verification.                        |
| `packages/overlay/src/components/settings/SkillMarketPanel.tsx` | Existing drag-and-drop import implementation reads browser files and surfaces drop-active state. | Reuse the same browser drag event shape and base64 reading pattern; do not share skill-specific package logic. |

## Acceptance

- Backend tests cover upload success, traversal/name rejection, duplicate dropped names, existing-file conflict, and `POST /file/upload` status mapping.
- Overlay static tests prove explorer uses `uploadDroppedFiles`, exposes drop state, and does not call direct `fetch`.
- Browser test drops a real `File` into the explorer panel, observes one `POST /file/upload` request with directory query injected by `apiJson`, confirms the explorer refreshes, and captures a screenshot of the upload affordance.
- Visual review inspects the real overlay page after the browser test build; the drop target must be visible without nested cards or text overflow.
