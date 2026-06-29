# Log Viewer Open File Button

Date: 2026-06-28

## Requirement

Help already opens the overlay LogViewer through the `oc:open-logs` UI event.
Users now need a button in that opened log surface that opens the actual current
server log file in the host operating system. The same surface must also be
tall enough for real log triage and manually resizable by the operator.

## Recall

| Source | Constraint |
| --- | --- |
| `AGENTS.md` | No fallback logic, no duplicate source, no blind patching, UI changes need tests and screenshot review. |
| `2026-06-15-help-open-logs.md` | Keep Help opening logs through the existing `oc:open-logs` event and `/log/tail`; do not add a second log viewer or fetch path. |
| `2026-06-20-log-viewer-refresh-entry-single-source.md` | Do not reintroduce the removed duplicate server-log refresh action; new button must perform a distinct open-file action. |
| `HostTransport` | Native host actions must go through `getHostTransport().native(...)`; `nativeOpen()` is the existing single helper for `open-path`. |
| `Dialog` primitive | Base dialog supports drag-positioning but no size resize contract; LogViewer can own a form class without changing every dialog. |

## Evidence Sweep

| Command | Evidence | Decision |
| --- | --- | --- |
| `rg -n "open-logs|LogViewer|log/tail|log/files|nativeOpen|open-path" packages/overlay/src packages/opencorvus/src packages/overlay/test packages/opencorvus/test -S` | `TitlebarMenubar` and `CommandPalette` dispatch `oc:open-logs`; `LogViewer` calls `apiJson("log/tail?n=500")`; `nativeOpen()` maps file paths to `open-path`. | Keep the opening event and LogViewer component; add file-open action inside LogViewer. |
| `packages/opencorvus/src/server/routes/app.ts` | `/log/tail` returns `Log.read({ lines: n })`; log route tests assert the body has `path`, `file`, `directory`, and `lines`. | Use `/log/tail` response `path` as the single current-log-file source. |
| `packages/overlay/test/browser/*.test.ts` | Several fixtures return `/log/tail` with only `lines`, which is older than the real route contract. | Update touched fixtures to include `path` instead of making LogViewer tolerate a missing path. |
| `.dialog-wide` and `.log-viewer` CSS | Wide dialogs are capped at 620px and `.log-viewer` is capped at 520px, producing a short log panel. | Add a LogViewer-specific form class with a taller default height and native `resize: both`; make `.log-viewer` flex to the form height. |

## Implementation Plan

1. Replace LogViewer's module-level server log state with a typed object that
   stores both `path` and `lines` from `/log/tail`.
2. Validate `/log/tail` response shape in LogViewer; missing `path` or non-array
   `lines` is a test fixture/server contract error, not a UI fallback case.
3. Add a `btnLogOpenFile` header `Button` that calls `nativeOpen(currentPath)`.
4. Disable the button while refreshing or before the current path is known.
5. Add `log.open_file` / `log.open_file_hint` locale entries.
6. Add `log-viewer-dialog-form` as the LogViewer dialog form owner, with taller
   default dimensions, min/max bounds, and native resize.
7. Update static guards and browser fixtures so the button is present, distinct
   from refresh, and invokes `overlay_open_path` with the current log path.

## Acceptance

- Help still opens the same LogViewer dialog through `oc:open-logs`.
- LogViewer header has exactly one refresh button and one open-file button.
- Clicking the open-file button calls the host `open-path` command with the
  `/log/tail` response path.
- LogViewer opens with a readable default height and its log list expands with
  the dialog body.
- Dragging the dialog resize handle changes the dialog and log-list dimensions.
- Existing Copy, Clear, Close, filtering, and virtual-list behavior remain intact.
- Browser screenshot of the real LogViewer dialog is reviewed after the change.
