import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

test("browser preview panel uses mature primitives and HostTransport-backed service", () => {
  const component = readText("src/components/BrowserPreviewPanel.tsx")
  const service = readText("src/services/browser-preview.ts")
  const html = readText("src/index.html")
  const main = readText("src/main.tsx")
  const css = readText("src/styles/surfaces/inspector.css")
  const activityCss = readText("src/styles/surfaces/activity.css")

  expect(html).toContain('id="chatViewTitle"')
  expect(html).toContain('id="centerWorkbenchBrowser"')
  expect(html).toContain('id="solidBrowserPreviewMount"')
  expect(html).not.toContain('id="rightPanelBrowser"')
  expect(html).not.toContain('id="solidRightPanelTabs"')
  expect(main).toContain("<BrowserPreviewPanel")
  expect(main).toContain('active={() => activeCenterWorkbenchTab() === "browser"}')
  expect(main).toContain("refreshKey={() => boardStore.boardUpdatedAt}")
  expect(main).toContain('onReady={() => selectRightActivity("browser")}')
  expect(main).toContain('browser: document.getElementById("centerWorkbenchBrowser")')
  expect(main).toContain('onSelect={selectRightActivity}')

  expect(component).toContain('from "./ui/Tabs"')
  expect(component).toContain('from "./ui/Button"')
  expect(component).toContain("currentTarget()?.viewports")
  expect(component).toContain("loadTaskBrowserPreviewTarget")
  expect(component).toContain("saveTaskBrowserPreviewTarget")
  expect(component).toContain("captureTaskBrowserPreviewEvidence")
  expect(component).toContain("props.refreshKey()")
  expect(component).toContain("props.onReady?.(resolved)")
  expect(component).toContain("lastAutoFocusedPreviewKey")
  expect(component).toContain('data-active={String(panelActive())}')
  expect(component).toContain("<iframe")
  expect(component).toContain('sandbox="allow-forms allow-modals allow-popups allow-scripts"')
  expect(component).toContain('referrerPolicy="no-referrer"')
  expect(component).toContain("props.taskID()")
  expect(component).toContain("props.active()")
  expect(component).not.toContain("!props.active() || !taskID || !directory")
  expect(component).toContain("currentTargetError")
  expect(component).toContain('data-status="failed"')
  expect(component).toContain('verification.error ? "failed"')
  expect(component).not.toContain("new EventSource")
  expect(component).not.toContain("fetch(")
  expect(service).toContain('apiJson(`task/${encodeURIComponent(taskID)}/browser-preview`')
  expect(service).toContain('apiJson(`task/${encodeURIComponent(input.taskID)}/browser-preview/target`')
  expect(service).toContain('apiJson(`task/${encodeURIComponent(input.taskID)}/browser-preview/capture`')
  expect(service).not.toContain("apiJson(`browser-preview")
  expect(service).not.toContain("fetch(")
  expect(service).not.toContain("BROWSER_PREVIEW_VIEWPORTS")

  expect(activityCss).toContain(".chat-browser-preview-activity")
  expect(css).toContain(".browser-preview-panel")
  expect(css).toContain(".browser-preview-frame")
  expect(css).toContain(".browser-preview-evidence")
})
