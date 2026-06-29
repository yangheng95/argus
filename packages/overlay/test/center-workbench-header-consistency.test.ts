import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function readText(path: string): string {
  return readFileSync(join(OVERLAY_ROOT, path), "utf8")
}

test("center workbench panels use the shared solid surface header", () => {
  const explorer = readText("src/components/FileExplorerPanel.tsx")
  const changes = readText("src/components/FileChangesPanel.tsx")
  const preview = readText("src/components/BrowserPreviewPanel.tsx")

  for (const source of [explorer, changes, preview]) {
    expect(source).toContain('from "./ui/SurfaceHeader"')
    expect(source).toContain("<SurfaceHeader")
    expect(source).toContain('variant="panel"')
  }

  expect(explorer).toContain('title={t("explorer.title")}')
  expect(changes).toContain('title={t("section.files")}')
  expect(preview).toContain('title={t("browser_preview.title")}')
  expect(changes).not.toContain('class="file-changes-switcher"')
  expect(preview).not.toContain('class="browser-preview-toolbar"')
})

test("center workbench shell does not offset panel headers", () => {
  const workspaceCss = readText("src/styles/surfaces/workspace.css")
  const activityCss = readText("src/styles/surfaces/activity.css")
  const inspectorCss = readText("src/styles/surfaces/inspector.css")

  expect(workspaceCss).toContain(".center-workbench-activity {\n  flex: 1 1 0;")
  expect(workspaceCss).toContain("padding: 0;")
  expect(workspaceCss).not.toContain(".center-workbench-activity.chat-workflow-activity")
  expect(activityCss).toContain(".sidebar-explorer-panel,\n.sidebar-file-changes-panel,")
  expect(activityCss).toContain("container: side-activity / inline-size")
  expect(activityCss).toContain(".file-changes-body {\n  padding: var(--ui-gap-sm);")
  expect(inspectorCss).not.toContain(".file-explorer-command-surface")
  expect(inspectorCss).toContain(".file-explorer-panel :where(.file-explorer-search)")
})
