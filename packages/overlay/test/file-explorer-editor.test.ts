import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

test("file explorer and editor are wired as a VS Code-style split workbench", () => {
  const explorer = readText("src/components/FileExplorerPanel.tsx")
  const editor = readText("src/components/FileEditorPane.tsx")
  const toggle = readText("src/components/FileEditorToggle.tsx")
  const service = readText("src/services/file-workbench.ts")
  const tabs = readText("src/components/RightPanelTabs.tsx")
  const html = readText("src/index.html")
  const inspectorCss = readText("src/styles/surfaces/inspector.css")
  const workspaceCss = readText("src/styles/surfaces/workspace.css")

  expect(tabs).toContain('export type RightPanelTab = "explorer" | "changes" | "inspector"')
  expect(tabs).toContain('export const DEFAULT_RIGHT_PANEL_TAB: RightPanelTab = "explorer"')
  expect(tabs).toContain('props.onSelect("changes")')
  expect(html).toContain('id="rightPanelExplorer"')
  expect(html).toContain('id="solidFileExplorerMount"')
  expect(html).toContain('id="chatContentFrame"')
  expect(html).toContain('id="solidFileEditorMount"')
  expect(html).toContain('id="solidFileEditorToggleMount"')

  expect(explorer).toContain('apiJson(`file?path=')
  expect(explorer).toContain('apiJson(`find/file?')
  expect(explorer).toContain("createDeferred")
  expect(explorer).toContain("childrenByPath")
  expect(explorer).toContain("expandedPaths")
  expect(explorer).toContain('from "virtua/solid"')
  expect(explorer).toContain("VIRTUAL_EXPLORER_ROW_THRESHOLD")
  expect(explorer).toContain('<span class="file-explorer-chevron" />')
  expect(explorer).toContain("openFileEditor")

  expect(editor).toContain('apiJson(`file/content?path=')
  expect(editor).toContain('method: "PATCH"')
  expect(editor).toContain('body: JSON.stringify({ path, content })')
  expect(editor).toContain("file-editor-textarea")
  expect(editor).toContain("dirty")
  expect(toggle).toContain("toggleFileEditorFocus")
  expect(service).toContain('createSignal<"messages" | "editor">')

  expect(inspectorCss).toContain(".file-explorer-panel")
  expect(inspectorCss).toContain(".file-explorer-list[data-virtualized=\"true\"]")
  expect(workspaceCss).toContain(".chat-content-frame")
  expect(workspaceCss).toContain(".file-editor-mount")
  expect(workspaceCss).toContain('@media (max-width: 1280px)')
  expect(workspaceCss).toContain('[data-editor-focus="editor"] .chat-message-pane')
  expect(workspaceCss).toContain('[data-editor-focus="messages"] .file-editor-mount')
})
