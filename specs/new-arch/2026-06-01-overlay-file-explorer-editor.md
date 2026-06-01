# Overlay File Explorer And Editor

## Requirement

Add a VS Code-style file explorer and an editor pane:

- Explorer is a top-level right-panel tab, separate from file changes and inspector.
- Explorer uses the existing project-scoped file API as the single source of truth.
- Clicking a directory expands it lazily.
- Clicking an editable text file opens the editor pane.
- The editor pane sits to the right of the message pane on wide screens.
- On narrow screens, the message pane and editor pane switch by explicit buttons.
- Large directories must not force recursive filesystem scans or full DOM render.
- Text edits must save through the project-scoped file API with path traversal protection.

## Existing Sources And Call Points

| Surface | Current role | Decision |
| --- | --- | --- |
| `packages/opencorvus/src/server/routes/file.ts` | Owns `/file`, `/file/content`, `/find/file`, `/file/status` | Extend `/file/content` with `PATCH` for text saves; keep reads/lists unchanged. |
| `packages/opencorvus/src/file/index.ts` | Owns path canonicalization, `File.read`, `File.list`, search cache, `File.Event.Edited` | Add `File.writeText` beside `read/list` and reuse the same path allow-list. |
| `packages/overlay/src/components/RightPanelTabs.tsx` | Top-level right-panel tab owner | Add `explorer`; rename current changed-files tab label to `changes` without moving its existing body id. |
| `packages/overlay/src/components/ChangesPanel.tsx` | Changed-files tab content | Keep as-is; no explorer logic here. |
| `packages/overlay/src/components/WorkspacePanel.tsx` | Bottom diff workspace | Keep as diff workspace; file editor is a separate message-side sidecar. |
| `packages/overlay/src/services/api.ts` | Single overlay HTTP transport | Explorer/editor wrappers call `apiJson`; no direct fetch. |
| `packages/overlay/src/styles/surfaces/workspace.css` | Workspace and main layout CSS | Add message/editor split rules here because the editor pane is attached to the workspace main chat column. |

## UX Contract

- Right panel tabs: `Explorer`, `Files`, `Inspector`; `Files` remains the changed-files surface.
- Default tab: `Explorer`.
- Explorer rows are flat, dense, and icon-led. No nested cards.
- Search uses `/find/file?type=file&limit=80`; tree browsing uses lazy `/file?path=...`.
- Tree render is virtualized when visible rows exceed the threshold.
- File editor has a tab-like header, dirty indicator, save button, close button, and a monospaced textarea.
- Binary/image reads show a non-editable empty state instead of a textarea.
- Wide split is controlled by CSS at a single breakpoint.
- Narrow mode uses the same selected editor state; buttons only change which pane is visible.

## Test Plan

- Unit test `File.writeText`: writes existing text files, rejects traversal, rejects binary extensions.
- Overlay static tests: right-panel tabs include explorer/changes/inspector; `index.html` has the sidecar mounts; explorer uses `apiJson`, lazy list/search, and `Virtualizer`; editor uses `PATCH /file/content`.
- Typecheck overlay and opencorvus packages.
- Browser visual check at wide and narrow widths with a mocked API transport: no horizontal overflow, split mode on wide, switch mode on narrow, virtualized tree row count bounded.
