import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

test("right side coding assistant entry is the project-bound OpenTUI runtime activity", () => {
  const panel = readText("src/components/TuiHostPanel.tsx")
  const service = readText("src/services/tui-host.ts")
  const toolbar = readText("src/components/SideActivityToolbar.tsx")
  const html = readText("src/index.html")
  const main = readText("src/main.tsx")
  const css = readText("src/styles/surfaces/activity.css")

  expect(html).toContain('id="solidRightActivityToolbar"')
  expect(html).toContain('id="rightPanelTui"')
  expect(html).toContain('id="solidTuiHostMount"')
  expect(html).toContain('data-right-activity="tui"')
  expect(html).not.toContain('id="solidRightPanelTabs"')
  expect(html).not.toContain('id="rightPanelAssistant"')
  expect(html).not.toContain('id="solidCodingAssistantMount"')

  expect(main).toContain('type RightActivity = "tui" | "browser" | "inspector"')
  expect(main).toContain('const DEFAULT_RIGHT_ACTIVITY: RightActivity = "tui"')
  expect(main).toContain('{ id: "tui", icon: "terminal", labelKey: "tui.title" }')
  expect(main).toContain("<TuiHostPanel active={() => rightActivity() === \"tui\"}")
  expect(main).toContain('document.getElementById("solidRightActivityToolbar")')
  expect(main).toContain('document.getElementById("rightPanelTui")')
  expect(main).not.toContain("<CodingAssistantPanel")
  expect(main).not.toContain("rightPanelTab")
  expect(main).not.toContain("TuiRuntimePanel")

  expect(panel).toContain("props.active()")
  expect(panel).toContain('import("ghostty-web")')
  expect(panel).toContain("new mod.Terminal")
  expect(panel).toContain("createTuiHostConnectToken()")
  expect(panel).toContain("new WebSocket(buildTuiHostConnectUrl")
  expect(panel).toContain("socket.send(data)")
  expect(panel).toContain("resizeTuiHost({ cols, rows })")
  expect(panel).not.toContain("sendTuiHostInput(data)")
  expect(panel).not.toContain("loadTuiHostOutput(hostCursor)")
  expect(panel).not.toContain("loadTuiHostSnapshot")
  expect(panel).toContain('aria-label={t("tui.title")}')
  expect(panel).not.toContain("new EventSource")
  expect(panel).not.toContain("fetch(")
  expect(service).toContain('apiJson("tui/host/start"')
  expect(service).toContain('apiJson("tui/host/connect-token"')
  expect(service).toContain("apiWebSocketUrl(`tui/host/connect?")
  expect(service).not.toContain('apiJson("tui/host/input"')
  expect(service).not.toContain('apiJson("tui/host/snapshot"')
  expect(service).not.toContain('apiJson(`tui/host/output')
  expect(service).toContain('apiJson("tui/host/resize"')
  expect(service).not.toContain("tui/runtime/status")
  expect(toolbar).toContain('data-ui="side-activity-button"')
  expect(css).toContain(".side-activity-toolbar")
  expect(css).toContain(".tui-host-panel")
  expect(css).toContain(".tui-host-terminal")
})

test("retired browser-side coding assistant service does not remain as a right-sidebar TUI double source", () => {
  expect(existsSync(path.join(ROOT, "src/services/coding-assistant.ts"))).toBe(false)
  expect(existsSync(path.join(ROOT, "src/services/coding-assistant-transcript.ts"))).toBe(false)
  expect(existsSync(path.join(ROOT, "test/coding-assistant-service.test.ts"))).toBe(false)
})
