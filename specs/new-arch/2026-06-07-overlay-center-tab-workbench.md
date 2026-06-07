# Overlay Center Tab Workbench

## Request

Left panel is a permanent task list with no toolbar. Right panel is a permanent inspector. Right toolbar opens four center workbench tabs: file browser, diff, preview, and coding assistant. These tabs share one header, can be closed, and share horizontal space with the conversation.

## Call Points

| Surface | Current call point | Decision |
| --- | --- | --- |
| Left activity state | `packages/overlay/src/main.tsx` `LeftActivity`, `LEFT_ACTIVITIES`, `leftActivity()` effect | Delete the left activity state. The sidebar body always owns only `TaskList`. |
| Right activity state | `packages/overlay/src/main.tsx` `RightActivity`, `RIGHT_ACTIVITIES`, `selectRightActivity` | Replace inspector/browser/assistant switching with toolbar-to-center-tab open behavior. Inspector stays in the right panel and is not a toolbar item. |
| Center view switching | `packages/overlay/src/main.tsx` `ChatView` and `chatView()` DOM effect | Replace mutually exclusive chat views with a center workbench tab list. Conversation remains mounted and visible. |
| DOM roots | `packages/overlay/src/index.html` left panel bodies and chat view panes | Remove left toolbar/explorer/changes roots. Add center workbench roots for explorer, diff, preview, assistant, and file editor. |
| File explorer | `FileExplorerPanel` mounted in `solidFileExplorerMount` | Move mount into center workbench tab and make activity follow the explorer tab. |
| Diff | `FileChangesPanel` and `WorkspacePanel`/`DiffPreviewPanel` | Use `FileChangesPanel` as the diff center tab so the change list and selected diff remain a single source. |
| Preview | `BrowserPreviewPanel` in `chatBrowserPreviewPane` | Move into the center workbench preview tab; backend task preview target remains the only source. |
| Coding assistant | Existing `WorkspaceCodingCliLaunchers` and retired TUI plugin removal | Keep retired embedded TUI absent. Surface the existing coding CLI launchers in the assistant center tab while the rename/refactor continues. |
| Toolbar primitive | `SideActivityToolbar.tsx` | Allow no active item when no corresponding center tab is active. |
| Resizing | `services/pane.ts` keeps side pane resizing | Add a local center workbench resizer between conversation and workbench, persisted in overlay settings local storage. |
| Tests | `acceptance-panel-mount.test.ts`, `side-activity-toolbar-browser.test.ts`, `coding-assistant-panel.test.ts` | Update structural and browser assertions to pin the new layout and prevent reintroducing left toolbar or inspector toolbar items. |

