import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  closeFileEditor,
  fileWorkbenchOpen,
  openFileEditor,
  selectedFilePath,
  selectedFileTarget,
} from "../src/services/file-workbench"

const ROOT = path.resolve(import.meta.dir, "..")

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

function bodyOf(source: string, selector: string): string {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "")
  const wanted = selector.replace(/\s+/g, " ").trim()
  for (const chunk of css.split("}")) {
    const open = chunk.indexOf("{")
    if (open < 0) continue
    if (chunk.slice(0, open).replace(/\s+/g, " ").trim() === wanted) return chunk.slice(open + 1)
  }
  throw new Error(`CSS rule not found: ${selector}`)
}

test("file explorer, diff, and editor are wired through center workbench panels", () => {
  const explorer = readText("src/components/FileExplorerPanel.tsx")
  const editor = readText("src/components/FileEditorPane.tsx")
  const filesPanel = readText("src/components/FileChangesPanel.tsx")
  const codeEditor = readText("src/components/primitives/CodeEditor.tsx")
  const service = readText("src/services/file-workbench.ts")
  const packageJson = readText("package.json")
  const viteConfig = readText("vite.config.ts")
  const html = readText("src/index.html")
  const main = readText("src/main.tsx")
  const app = readText("src/components/App.tsx")
  const inspectorCss = readText("src/styles/surfaces/inspector.css")
  const activityCss = readText("src/styles/surfaces/activity.css")
  const workspaceCss = readText("src/styles/surfaces/workspace.css")
  const en = readText("src/i18n/en-US.json")
  const zh = readText("src/i18n/zh-CN.json")

  expect(html).not.toContain('id="solidLeftActivityToolbar"')
  expect(html).toContain('id="leftPanelWork"')
  expect(html).toContain('id="workLedgerPanel"')
  expect(html).not.toContain('id="leftPanelExplorer"')
  expect(html).not.toContain('id="leftPanelChanges"')
  expect(html).not.toContain('data-left-activity="tasks"')
  expect(html).toContain('id="centerWorkbench"')
  expect(html).toContain('id="centerWorkbenchWorkflow"')
  expect(html).toContain('id="centerWorkbenchExplorer"')
  expect(html).toContain('id="centerWorkbenchDiff"')
  expect(html).toContain('id="centerWorkbenchFile"')
  expect(html).toContain('id="solidFileExplorerMount"')
  expect(html).toContain('id="solidFileChangesMount"')
  expect(html).toContain('id="chatContentFrame"')
  expect(html).not.toContain('id="chatFileEditorPane"')
  expect(html).not.toContain('data-chat-view="file" data-active="false"')
  expect(html).not.toContain('id="chatDiffPane"')
  expect(html).not.toContain('data-chat-view="diff" data-active="false"')
  expect(html).toContain('id="solidFileEditorMount"')
  expect(html).toContain('class="center-workbench-activity chat-file-editor-activity file-editor-mount"')
  expect(html).not.toContain('id="workspaceResizer"')
  expect(html).not.toContain('id="rightPanelExplorer"')
  expect(html).not.toContain('id="rightPanelFiles"')
  expect(html).not.toContain('id="solidRightFilesMount"')
  expect(html).not.toContain('id="solidFileEditorToggleMount"')
  expect(html).not.toContain('id="solidFileEditorMount" class="sections-files-tab"')
  expect(main).toContain(
    '<FileExplorerPanel active={() => isCenterWorkbenchPanelOpen("explorer")} directory={activeDirectory}',
  )
  expect(app).toContain('id="solidFileEditorMount"')
  expect(app).toContain("<FileEditorPane />")
  expect(main).not.toContain("<FileEditorPane")
  expect(main).toContain("<FileChangesPanel")
  expect(main).toContain('workflow: document.getElementById("centerWorkbenchWorkflow")')
  expect(main).toContain("diffOpen={workspaceOpen()}")
  expect(main).toContain('openCenterWorkbenchPanel("diff")')
  expect(main).not.toContain('setLeftActivity("changes")')
  expect(main).not.toContain('document.getElementById("leftPanelChanges")')
  expect(main).toContain('document.getElementById("solidFileChangesMount")')
  expect(main).not.toContain('changes: document.getElementById("leftPanelChanges")')
  expect(main).toContain('file: document.getElementById("centerWorkbenchFile")')
  expect(main).toContain('diff: document.getElementById("centerWorkbenchDiff")')
  expect(main).not.toContain('setChatView("file")')
  expect(main).not.toContain('setChatView("diff")')
  expect(main).toContain("closeFileEditor()")
  expect(main).not.toContain("fileEditorMountEl")
  expect(main).not.toContain("hidden = !fileWorkbenchOpen()")
  expect(main).not.toContain('document.getElementById("workspaceResizer")')
  expect(main).not.toContain('if (fileWorkbenchOpen() || workspaceOpen()) setRightPanelTab("files")')
  expect(main).not.toContain('document.getElementById("solidFileEditorToggleMount")')
  expect(main).not.toContain("FileEditorToggle")
  expect(main).not.toContain("frame.dataset.editorOpen = fileWorkbenchOpen() || workspaceOpen()")
  expect(main).not.toContain("frame.dataset.editorOpen = activeTaskID() || selectedFilePath() || workspaceOpen()")

  expect(explorer).toContain('apiJson(fileQueryPath("file", { path }, scope))')
  expect(explorer).toContain("searchFiles(query: string, scope: FileOperationScope)")
  expect(explorer).toContain("apiJson(`find/file?")
  expect(explorer).toContain("uploadDroppedFiles")
  expect(explorer).toContain("createFileItem")
  expect(explorer).toContain("copyFileItem")
  expect(explorer).toContain("moveFileItem")
  expect(explorer).toContain("deleteFileItem")
  expect(explorer).toContain("updateOpenFilePathAfterMove")
  expect(explorer).toContain("closeFileEditorIfDeleted")
  expect(explorer).toContain('import { showAppDialog } from "../services/app-dialog"')
  expect(explorer).toContain('import * as ContextMenu from "@kobalte/core/context-menu"')
  expect(explorer).not.toContain('import * as DropdownMenu from "@kobalte/core/dropdown-menu"')
  expect(explorer).not.toContain('import { ArmedConfirmButton } from "./ui/ArmedConfirmButton"')
  expect(explorer).toContain("dragHasFiles")
  expect(explorer).toContain("dataTransferFiles")
  expect(explorer).not.toContain("handleUploadDrop")
  expect(explorer).toContain("beginExplorerRowDrag")
  expect(explorer).toContain("handleExplorerDrop")
  expect(explorer).toContain("moveSelectionsToDirectory")
  expect(explorer).toContain("EXPLORER_SELECTION_MIME")
  expect(explorer).toContain("openUploadPicker")
  expect(explorer).toContain("handleUploadInputChange")
  expect(explorer).not.toContain("<DropdownMenu.Root")
  expect(explorer).not.toContain("<DropdownMenu.Trigger")
  expect(explorer).toContain("as={Button}")
  expect(explorer).not.toContain("file-explorer-new-menu")
  expect(explorer).not.toContain("<DropdownMenu.Item")
  expect(explorer).toContain("<ContextMenu.Root>")
  expect(explorer).toContain("<ContextMenu.Trigger")
  expect(explorer).toContain('<ContextMenu.Content class="file-explorer-context-menu">')
  expect(explorer).toContain("<ContextMenu.Item")
  expect(explorer).toContain('<ContextMenu.Separator class="file-explorer-menu-separator" />')
  expect(explorer).toContain('data-app-context-menu-trigger="true"')
  expect(explorer).not.toContain('role="toolbar"')
  expect(explorer).not.toContain("file-explorer-commandbar")
  expect(explorer).not.toContain('data-ui="file-explorer-command-menu"')
  expect(explorer).not.toContain('class="file-explorer-command-menu"')
  expect(explorer).not.toContain('Icon name="external-link"')
  expect(explorer).not.toContain('data-ui="file-explorer-new-menu"')
  expect(explorer).not.toContain('data-ui="file-explorer-rename"')
  expect(explorer).not.toContain('data-ui="file-explorer-move"')
  expect(explorer).not.toContain('data-ui="file-explorer-delete"')
  expect(explorer).not.toContain('data-ui="file-explorer-refresh"')
  expect(explorer).toContain('dataUi="file-explorer-context-new-file"')
  expect(explorer).toContain('dataUi="file-explorer-context-new-folder"')
  expect(explorer).toContain('dataUi="file-explorer-context-upload"')
  expect(explorer).toContain('dataUi="file-explorer-context-refresh"')
  expect(explorer).toContain('dataUi="file-explorer-context-copy"')
  expect(explorer).toContain('dataUi="file-explorer-context-move"')
  expect(explorer).toContain('dataUi="file-explorer-context-delete"')
  expect(explorer).toContain("confirmDeleteItems")
  expect(explorer).toContain("copyItems")
  expect(explorer).toContain("moveItems")
  expect(explorer).toContain("topLevelActionSelections")
  expect(explorer).toContain("isPathOrDescendant(item.path, candidate.path)")
  expect(explorer).toContain("canPlaceSelectionsInDirectory")
  expect(explorer).toContain("selectRangeTo")
  expect(explorer).toContain("toggleSelection")
  expect(explorer).toContain('data-selected={isNodeSelected() ? "true" : "false"}')
  expect(explorer).toContain('draggable={!commandBusy()}')
  expect(explorer).toContain('data-dragging={isNodeDragging() ? "true" : undefined}')
  expect(explorer).toContain('data-drop-target={isNodeDropTarget() ? dropStatus() : undefined}')
  expect(explorer).toContain('data-drop-target={dropTargetPath() === "" && dropTargetRowPath() === null ? dropStatus() : undefined}')
  expect(explorer).not.toContain("FILE_EXPLORER_DELETE_CONFIRM_SECONDS")
  expect(explorer).toContain("showAppDialog")
  expect(explorer).not.toContain("<ArmedConfirmButton")
  expect(explorer).not.toContain("window.prompt")
  expect(explorer).not.toContain("window.confirm")
  expect(explorer).toContain('data-ui="file-explorer-upload-input"')
  expect(explorer).toContain("multiple")
  expect(explorer).not.toContain('data-ui="file-explorer-upload-dropzone"')
  expect(explorer).not.toContain("data-upload-target")
  expect(explorer).toContain('tc("explorer.upload_success"')
  expect(explorer).not.toContain("fetch(")
  expect(explorer).toContain("INITIAL_DIRECTORY_LOAD_DELAY_MS")
  expect(explorer).toContain("ACTIVE_DIRECTORY_REFRESH_INTERVAL_MS")
  expect(explorer).toContain("props.active?.() ?? true")
  expect(explorer).toContain('props.directory ? props.directory().trim() : ""')
  expect(explorer).toContain("setChildrenByPath(new Map())")
  expect(explorer).toContain("!active() || !currentDirectory")
  expect(explorer).toContain('window.setTimeout(() => void loadDirectory("")')
  expect(explorer).toContain("window.setInterval")
  expect(explorer).toContain("loadDirectory(path, { force: true })")
  expect(explorer).toContain("createDeferred")
  expect(explorer).toContain("childrenByPath")
  expect(explorer).toContain("expandedPaths")
  expect(explorer).toContain("directoryErrors")
  expect(explorer).toContain("rootLoading")
  expect(explorer).toContain("searchLoading")
  expect(explorer).toContain('t("explorer.load_failed")')
  expect(explorer).not.toContain("next.set(path, [])")
  expect(explorer).toContain('from "virtua/solid"')
  expect(explorer).toContain("VIRTUAL_EXPLORER_ROW_THRESHOLD")
  expect(explorer).toContain("FILE_EXPLORER_ROW_HEIGHT_PX = 26")
  expect(explorer).toContain("FILE_EXPLORER_ROW_INDENT_PX = 14")
  expect(explorer).toContain("scaledExplorerRowHeight")
  expect(explorer).toContain("itemSize={explorerRowItemSize()}")
  expect(explorer).not.toContain("itemSize={EXPLORER_ROW_HEIGHT}")
  expect(explorer).toMatch(/<ContextMenu\.Trigger[\s\S]*as=\{Button\}[\s\S]*data-ui="file-explorer-row"/)
  expect(explorer).not.toMatch(/<button[\s\S]*class="file-explorer-row"/)
  expect(explorer).toContain('style={{ "--file-explorer-row-depth": String(row.depth) }}')
  expect(explorer).not.toContain("row.depth * 14 + 3")
  expect(explorer).toContain('<span class="file-explorer-chevron" />')
  expect(explorer).toContain("openFileEditor")
  expect(explorer).toContain('aria-current={isSearchRowCurrent() ? "true" : undefined}')
  expect(explorer).toContain('aria-current={isNodeCurrent() ? "true" : undefined}')
  expect(explorer).toContain("aria-expanded={isDirectory ? row.expanded : undefined}")
  expect(explorer).not.toContain('role="tree"')
  expect(explorer).not.toContain('role="treeitem"')
  expect(explorer).not.toContain("aria-selected=")
  expect(explorer).toContain('class="file-explorer-search-input search-field-input"')
  expect(explorer).not.toContain("search-field-input field-input")

  expect(editor).toContain("function fileContentPath(target: FileEditorTarget)")
  expect(editor).toContain("directory: target.directory")
  expect(editor).toContain('apiJson(projectScopedPath("file/content", target.directory)')
  expect(editor).toContain('method: "PATCH"')
  expect(editor).toContain("body: JSON.stringify({ path: target.path, content })")
  expect(editor).toContain('import { CodeEditor } from "./primitives/CodeEditor"')
  expect(editor).toContain('import { Button } from "./ui/Button"')
  expect(editor).toContain("<CodeEditor")
  expect(editor).toContain("path={path()}")
  expect(editor).toMatch(/<Button[\s\S]*data-ui="file-editor-save"/)
  expect(editor).toMatch(/<Button[\s\S]*data-ui="file-editor-close"/)
  expect(editor).toContain('data-chrome="icon-action"')
  expect(editor).not.toContain("<textarea")
  expect(editor).not.toContain('class="file-editor-save"')
  expect(editor).not.toContain('class="file-editor-close"')
  expect(editor).not.toContain("file-editor-nav")
  expect(editor).toContain("dirty")
  expect(codeEditor).toContain('import { basicSetup, EditorView } from "codemirror"')
  expect(codeEditor).toContain('import { javascript } from "@codemirror/lang-javascript"')
  expect(codeEditor).toContain('import { html } from "@codemirror/lang-html"')
  expect(codeEditor).toContain('import { css } from "@codemirror/lang-css"')
  expect(codeEditor).toContain('import { markdown } from "@codemirror/lang-markdown"')
  expect(codeEditor).toContain('import { json } from "@codemirror/lang-json"')
  expect(codeEditor).toContain('import { python } from "@codemirror/lang-python"')
  expect(codeEditor).toContain('import { Compartment, type Extension } from "@codemirror/state"')
  expect(codeEditor).toContain("editorLanguageExtensions")
  expect(codeEditor).toContain("languageCompartment.reconfigure")
  expect(codeEditor).toContain("javascript({ typescript: true, jsx: true })")
  expect(codeEditor).toContain("EditorView.updateListener")
  expect(codeEditor).toContain("update.state.doc.toString()")
  expect(codeEditor).toContain("view?.destroy()")
  expect(service).not.toContain('createSignal<"messages" | "editor">')
  expect(service).not.toContain("toggleFileEditorFocus")
  expect(service).not.toContain("showWorkbenchPane")
  expect(service).toContain("const [fileWorkbenchOpen, setFileWorkbenchOpen]")
  expect(service).toContain("setFileWorkbenchOpen(false)")
  expect(service).toContain('import { uint8ToBase64 } from "@opencorvus-ai/transport-protocol"')
  expect(service).toContain('import { projectScopedPath } from "./project-directory"')
  expect(service).toContain("export interface FileOperationScope")
  expect(service).toContain("export interface FileEditorTarget extends FileOperationScope")
  expect(service).toContain("const [selectedFileTarget, setSelectedFileTarget]")
  expect(service).toContain("uploadDroppedFiles")
  expect(service).toContain('apiJson(projectScopedPath("file/upload", scope.directory)')
  expect(service).toContain("createFileItem")
  expect(service).toContain('apiJson(projectScopedPath("file/item", scope.directory)')
  expect(service).toContain("moveFileItem")
  expect(service).toContain('method: "PATCH"')
  expect(service).toContain("copyFileItem")
  expect(service).toContain('projectScopedPath("file/item/copy", scope.directory)')
  expect(service).toContain('method: "POST"')
  expect(service).toContain("deleteFileItem")
  expect(service).toContain('fileQueryPath("file/item", { path }, scope)')
  expect(explorer).toContain("currentOperationScope")
  expect(explorer).toContain("ownsExplorerOperation")
  expect(explorer).toContain("type FileMutationOperation")
  expect(explorer).toContain("const [mutationOperation, setMutationOperation]")
  expect(explorer).toContain("let mutationOperationSequence = 0")
  expect(explorer).toContain("const commandBusy = createMemo(() => mutationOperation()?.directory === directory())")
  expect(explorer).toContain("setMutationOperation({ token, kind, directory: scope.directory.trim() })")
  expect(explorer).toContain("if (ownsMutationOperation() && ownsExplorerOperation(scope)) setMutationError")
  expect(explorer).toContain("if (ownsMutationOperation()) setMutationOperation(null)")
  expect(explorer).not.toContain('const [mutationKind, setMutationKind] = createSignal<FileMutationKind>("")')
  expect(explorer).toContain("selectedFileTarget")
  expect(explorer).toContain("openExplorerFile")
  expect(explorer).toContain("createFileItem(")
  expect(explorer).toContain("scope,")
  expect(explorer).toContain("copyFileItem(item.path, nextPath, scope)")
  expect(explorer).toContain("moveFileItem(item.path, nextPath, scope)")
  expect(explorer).toContain("deleteFileItem(item.path, scope)")
  expect(explorer).toContain("uploadDroppedFiles(targetDir, files, scope)")
  expect(explorer).toContain("untrack,")
  expect(explorer).toContain("untrack(() => {")
  expect(service).toContain("updateOpenFilePathAfterMove")
  expect(service).toContain("closeFileEditorIfDeleted")
  expect(service).toContain("file.arrayBuffer()")
  for (const dep of [
    '"@codemirror/autocomplete"',
    '"@codemirror/commands"',
    '"@codemirror/lang-css"',
    '"@codemirror/lang-html"',
    '"@codemirror/lang-javascript"',
    '"@codemirror/lang-json"',
    '"@codemirror/lang-markdown"',
    '"@codemirror/lang-python"',
    '"@codemirror/language"',
    '"@codemirror/lint"',
    '"@codemirror/search"',
    '"@codemirror/state"',
    '"@codemirror/view"',
  ]) {
    expect(packageJson).toContain(dep)
  }
  expect(viteConfig).toContain("const codeMirrorDedupePackages = [")
  for (const dep of [
    '"@codemirror/autocomplete"',
    '"@codemirror/commands"',
    '"@codemirror/language"',
    '"@codemirror/lint"',
    '"@codemirror/search"',
    '"@codemirror/state"',
    '"@codemirror/view"',
  ]) {
    expect(viteConfig).toContain(dep)
  }
  expect(viteConfig).toContain("dedupe: codeMirrorDedupePackages")
  expect(editor).not.toContain("showMessagesPane")
  expect(filesPanel).toContain("<ChangesPanel active={props.active} hasSelectedTask />")
  expect(filesPanel).toContain("<DiffPreviewPanel")
  expect(filesPanel).not.toContain("<FileEditorPane")
  expect(filesPanel).toContain("data-active-view={activeView()}")
  expect(filesPanel).toContain("<Tabs")
  expect(filesPanel).toContain("<Tab")
  expect(filesPanel).toContain('value="diff"')
  expect(filesPanel).toContain("props.onActiveViewChange")
  expect(main).toContain("fileChangesActiveView")
  expect(main).toContain("activeView={fileChangesActiveView()}")
  expect(main).toContain("onActiveViewChange={setFileChangesActiveView}")

  expect(inspectorCss).toContain(".file-explorer-panel")
  expect(inspectorCss).not.toContain(".file-explorer-command-surface")
  expect(inspectorCss).not.toContain(".file-explorer-new-menu")
  expect(inspectorCss).toContain(".file-explorer-context-menu")
  expect(inspectorCss).toContain(".file-explorer-menu-item")
  expect(inspectorCss).toContain(".file-explorer-menu-item[data-highlighted]")
  expect(inspectorCss).toContain(".file-explorer-menu-separator")
  expect(inspectorCss).not.toContain('data-ui="file-explorer-new-menu"')
  expect(inspectorCss).not.toContain(".file-explorer-command-menu")
  expect(inspectorCss).not.toContain(".file-explorer-command-actions")
  expect(inspectorCss).not.toContain('data-ui="file-explorer-delete"')
  expect(inspectorCss).not.toContain(".file-explorer-commandbar")
  expect(inspectorCss).not.toContain(".file-explorer-command-icon")
  expect(inspectorCss).toContain(".file-explorer-command-message")
  expect(inspectorCss).not.toContain(".file-explorer-selection")
  expect(inspectorCss).toContain(".file-explorer-upload-input")
  expect(inspectorCss).not.toContain(".file-explorer-upload-strip")
  expect(inspectorCss).toContain(".file-explorer-upload-message")
  expect(inspectorCss).not.toContain('.file-explorer-row[data-upload-target="true"]')
  expect(inspectorCss).toContain('.file-explorer-row[data-selected="true"]')
  expect(inspectorCss).toContain('.file-explorer-row[data-dragging="true"]')
  expect(inspectorCss).toContain('.file-explorer-row[data-drop-target="move"]')
  expect(inspectorCss).toContain('.file-explorer-row[data-drop-target="invalid"]')
  expect(inspectorCss).toContain('.file-explorer-list[data-drop-target="upload"]')
  expect(inspectorCss).toContain('.file-explorer-list[data-virtualized="true"]')
  expect(inspectorCss).toContain(".file-explorer-row:hover")
  expect(inspectorCss).toContain(".file-explorer-row:focus-visible")
  expect(inspectorCss).toContain("--file-explorer-row-depth: 0")
  expect(bodyOf(inspectorCss, ".file-explorer-row")).toContain("height: var(--file-explorer-row-height)")
  expect(bodyOf(inspectorCss, ".file-explorer-row")).toContain("min-height: var(--file-explorer-row-height)")
  expect(bodyOf(inspectorCss, ".file-explorer-row")).toContain(
    "var(--file-explorer-row-depth) * var(--file-explorer-row-indent)",
  )
  expect(bodyOf(inspectorCss, ".file-explorer-row")).toContain("font-weight: var(--ui-font-weight-body)")
  expect(bodyOf(inspectorCss, ".file-explorer-row")).not.toContain("height: calc(26px * var(--ui-scale))")
  expect(bodyOf(inspectorCss, ".file-explorer-row > svg")).toContain("width: var(--file-explorer-row-icon-width)")
  expect(bodyOf(inspectorCss, ".file-explorer-row > svg")).toContain("height: var(--file-explorer-row-icon-width)")
  expect(bodyOf(inspectorCss, ".file-explorer-row > svg")).not.toContain("--oc-density-chip-height")
  expect(inspectorCss).not.toContain(".file-explorer-search-input.field-input")
  expect(inspectorCss).not.toContain(".file-explorer-row:hover,\n.file-explorer-row:focus-visible")
  expect(bodyOf(inspectorCss, ".file-explorer-row:focus-visible")).toMatch(
    /outline:\s*var\(--oc-border-width\)\s+solid\s+var\(--accent\)/,
  )
  expect(bodyOf(inspectorCss, ".file-explorer-row:focus-visible")).not.toMatch(/outline:\s*(0|none)/)
  expect(explorer).toContain('"file-explorer-search-retry"')
  expect(explorer).toContain('"file-explorer-retry"')
  expect(explorer).not.toContain('class="file-explorer-retry"')
  expect(inspectorCss).toContain('.file-explorer-empty .oc-button[data-ui="file-explorer-retry"]')
  expect(inspectorCss).not.toContain(".file-explorer-retry {")
  expect(inspectorCss).not.toContain(".file-explorer-retry:hover")
  expect(inspectorCss).not.toContain(".file-explorer-retry:focus-visible")
  expect(activityCss).toContain(".sidebar-file-changes-panel")
  expect(activityCss).toContain("container: side-activity / inline-size")
  expect(activityCss).toContain(".file-changes-panel")
  expect(activityCss).toContain(".file-changes-diff-header")
  expect(inspectorCss).not.toContain(".right-files-panel")
  expect(inspectorCss).not.toContain(".right-files-diff-header")
  expect(workspaceCss).toContain(".chat-content-frame")
  expect(workspaceCss).toContain("container: chat-workbench / inline-size")
  expect(workspaceCss).toContain(".center-workbench")
  expect(workspaceCss).not.toContain(".center-workbench-tabs")
  expect(workspaceCss).toContain('.center-workbench-view[data-open="true"]')
  expect(workspaceCss).toContain(".center-workbench-panel-separator")
  expect(workspaceCss).toContain(".chat-file-editor-activity")
  expect(workspaceCss).not.toContain(".chat-diff-activity.workspace-mount")
  expect(workspaceCss).toContain(".file-editor-mount")
  expect(workspaceCss).toMatch(/\.file-editor-mount > div\s*\{[^}]*flex:\s*1 1 0;[^}]*display:\s*flex;/)
  expect(workspaceCss).not.toContain(".file-editor-mount[hidden]")
  expect(workspaceCss).not.toContain(".workspace-mount[hidden]")
  expect(workspaceCss).not.toContain(".pane-resizer.pane-resizer-workspace")
  expect(workspaceCss).not.toContain(".file-editor-toggle")
  expect(workspaceCss).not.toContain(".message-workbench")
  expect(workspaceCss).not.toContain("@container message-workbench (max-width: 720px)")
  expect(workspaceCss).toContain(".file-editor-code")
  expect(workspaceCss).toContain(".file-editor-code .cm-editor")
  expect(workspaceCss).toMatch(/\.file-editor-pane\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/)
  expect(workspaceCss).toContain('.file-editor-header .oc-button[data-ui="file-editor-save"]')
  expect(workspaceCss).toContain('.file-editor-header .oc-button[data-ui="file-editor-close"]')
  expect(workspaceCss).not.toContain(".file-editor-save {")
  expect(workspaceCss).not.toContain(".file-editor-close {")
  expect(workspaceCss).not.toContain(".file-editor-nav")
  expect(workspaceCss).not.toContain("@container chat-workbench (max-width: 860px)")
  expect(workspaceCss).not.toContain('[data-editor-focus="editor"] .chat-message-pane')
  expect(workspaceCss).not.toContain('[data-editor-focus="messages"] .file-editor-mount')
  for (const key of [
    "explorer.uploading",
    "explorer.upload_success",
    "explorer.upload_error",
    "explorer.upload_files",
    "explorer.open",
    "explorer.expand",
    "explorer.collapse",
    "explorer.new_file",
    "explorer.new_folder",
    "explorer.rename",
    "explorer.copy",
    "explorer.copy_message",
    "explorer.copy_many_message",
    "explorer.copy_many_success",
    "explorer.copy_invalid",
    "explorer.move",
    "explorer.move_many_message",
    "explorer.move_many_success",
    "explorer.drop_move_invalid",
    "explorer.destination_directory",
    "explorer.delete",
    "explorer.delete_message",
    "explorer.delete_many_message",
    "explorer.delete_many_success",
    "explorer.refresh",
    "explorer.selected_count",
    "explorer.create_success",
    "explorer.rename_success",
    "explorer.copy_success",
    "explorer.move_success",
    "explorer.delete_success",
  ]) {
    expect(en).toContain(`"${key}"`)
    expect(zh).toContain(`"${key}"`)
  }
})

test("file workbench open state is independent from selected task presence", () => {
  closeFileEditor()
  expect(fileWorkbenchOpen()).toBe(false)
  expect(selectedFilePath()).toBe("")
  expect(selectedFileTarget()).toBe(null)

  openFileEditor("src/main.tsx", { directory: "D:/overlay/workspace/app" })
  expect(fileWorkbenchOpen()).toBe(true)
  expect(selectedFilePath()).toBe("src/main.tsx")
  expect(selectedFileTarget()).toEqual({ path: "src/main.tsx", directory: "D:/overlay/workspace/app" })

  closeFileEditor()
  expect(fileWorkbenchOpen()).toBe(false)
  expect(selectedFilePath()).toBe("")
  expect(selectedFileTarget()).toBe(null)
})

test("file explorer selected-file expansion is active-gated", () => {
  const explorer = readText("src/components/FileExplorerPanel.tsx")
  expect(explorer).toMatch(
    /createEffect\(\(\) => \{\s*const currentDirectory = directory\(\)\s*if \(!active\(\) \|\| !currentDirectory\) return\s*const selectedTarget = selectedFileTarget\(\)/,
  )
  expect(explorer).not.toMatch(
    /createEffect\(\(\) => \{\s*const selected = selectedFilePath\(\)\s*if \(!selected\) return/,
  )
})

test("file explorer search requests are active-gated", () => {
  const explorer = readText("src/components/FileExplorerPanel.tsx")
  expect(explorer).toMatch(
    /const \[searchResults, \{ refetch: refetchSearch \}\] = createResource\(\s*\(\) => \{\s*const currentDirectory = directory\(\)\s*if \(!active\(\) \|\| !currentDirectory\) return undefined\s*return \{ query: deferredQuery\(\), directory: currentDirectory \}/,
  )
  expect(explorer).not.toContain("() => ({ query: deferredQuery(), directory: directory() })")
})

test("file explorer rows expose truthful button semantics instead of an incomplete aria tree", () => {
  const explorer = readText("src/components/FileExplorerPanel.tsx")

  expect(explorer).not.toContain('role="tree"')
  expect(explorer).not.toContain('role="treeitem"')
  expect(explorer).toContain('aria-current={isSearchRowCurrent() ? "true" : undefined}')
  expect(explorer).toContain('aria-current={isNodeCurrent() ? "true" : undefined}')
  expect(explorer).toContain("aria-expanded={isDirectory ? row.expanded : undefined}")
  expect(explorer).not.toContain("aria-selected=")
  expect(explorer).not.toContain("aria-pressed=")
})
