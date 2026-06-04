import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

test("right side coding assistant entry is the project-bound OpenTUI runtime activity", () => {
  const panel = readText("src/components/TuiRuntimePanel.tsx")
  const service = readText("src/services/tui-runtime.ts")
  const toolbar = readText("src/components/SideActivityToolbar.tsx")
  const html = readText("src/index.html")
  const main = readText("src/main.tsx")
  const css = readText("src/styles/surfaces/activity.css")

  expect(html).toContain('id="solidRightActivityToolbar"')
  expect(html).toContain('id="rightPanelTui"')
  expect(html).toContain('id="solidTuiRuntimeMount"')
  expect(html).toContain('data-right-activity="tui"')
  expect(html).not.toContain('id="solidRightPanelTabs"')
  expect(html).not.toContain('id="rightPanelAssistant"')
  expect(html).not.toContain('id="solidCodingAssistantMount"')

  expect(main).toContain('type RightActivity = "tui" | "browser" | "inspector"')
  expect(main).toContain('const DEFAULT_RIGHT_ACTIVITY: RightActivity = "tui"')
  expect(main).toContain('{ id: "tui", icon: "terminal", labelKey: "tui.title" }')
  expect(main).toContain("<TuiRuntimePanel active={() => rightActivity() === \"tui\"}")
  expect(main).toContain('document.getElementById("solidRightActivityToolbar")')
  expect(main).toContain('document.getElementById("rightPanelTui")')
  expect(main).not.toContain("<CodingAssistantPanel")
  expect(main).not.toContain("rightPanelTab")

  expect(panel).toContain("props.active()")
  expect(panel).toContain("loadTuiRuntimeStatus")
  expect(panel).toContain('aria-label={t("tui.title")}')
  expect(panel).not.toContain("new EventSource")
  expect(panel).not.toContain("fetch(")
  expect(service).toContain('apiJson("tui/runtime/status")')
  expect(toolbar).toContain('data-ui="side-activity-button"')
  expect(css).toContain(".side-activity-toolbar")
  expect(css).toContain(".tui-runtime-panel")
})
