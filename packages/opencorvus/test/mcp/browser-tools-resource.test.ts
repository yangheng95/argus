import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { browserDiagnosticsIssueCount, screenshotPixelSummary } from "../../src/mcp/browser/tools"

test("browser screenshot CDP session detaches on capture errors", () => {
  const source = fs.readFileSync(path.join(import.meta.dir, "../../src/mcp/browser/screenshot.ts"), "utf8")
  expect(source).toContain('cdp.send("Page.captureScreenshot"')
  expect(source).toMatch(/finally\s*\{\s*await cdp\.detach\(\)\.catch\(\(\)\s*=>\s*undefined\)/s)
})

test("browser MCP navigation and wait tools use browser inactivity instead of Playwright elapsed timeouts", () => {
  const source = fs.readFileSync(path.join(import.meta.dir, "../../src/mcp/browser/tools.ts"), "utf8")

  expect(source).toContain("withBrowserMcpInactivity")
  expect(source).toContain('page.goto(url, { timeout: 0, waitUntil: waitUntil ?? "domcontentloaded" })')
  expect(source).toContain('page.locator(selector).waitFor({ state: state ?? "visible", timeout: 0 })')
  expect(source).toContain("page.waitForURL((url) => url.href.includes(pattern), { timeout: 0 })")
  expect(source).toContain('page.waitForLoadState(state ?? "load", { timeout: 0 })')
  expect(source).toContain('page.reload({ timeout: 0 })')
  expect(source).toContain('page.goBack({ timeout: 0 })')
  expect(source).toContain('page.goForward({ timeout: 0 })')
  expect(source).not.toContain("timeout: timeout ?? 20_000")
  expect(source).toContain('on("requestfailed", (payload) => fail(browserMcpActivityLabel("requestfailed", payload)))')
  expect(source).toContain('on("pageerror", (payload) => fail(browserMcpActivityLabel("pageerror", payload)))')
})

test("browser MCP visual tools are blocked by accumulated diagnostics", () => {
  const source = fs.readFileSync(path.join(import.meta.dir, "../../src/mcp/browser/tools.ts"), "utf8")
  const screenshotSection = source.slice(source.indexOf('"screenshot"'), source.indexOf('"observe"'))
  const observeSection = source.slice(source.indexOf('"observe"'), source.indexOf('"click"'))

  expect(screenshotSection.match(/assertNoBrowserDiagnostics\(sessionId, "screenshot"\)/g)?.length ?? 0).toBeGreaterThan(1)
  expect(observeSection.match(/assertNoBrowserDiagnostics\(sessionId, "observe"\)/g)?.length ?? 0).toBeGreaterThan(1)
  expect(source).toContain("Browser MCP ${action} blocked by ${count} page diagnostic(s)")
  expect(
    browserDiagnosticsIssueCount({
      consoleErrors: [{ type: "error", text: "boom" }],
      pageErrors: [{ message: "late throw" }],
      failedRequests: [{ url: "http://127.0.0.1/fail", method: "GET", resourceType: "script", reason: "reset" }],
      httpErrors: [{ url: "http://127.0.0.1/500", status: 500, statusText: "Server Error", resourceType: "fetch" }],
    }),
  ).toBe(4)
})

test("browser MCP visual diagnostics ignore implicit browser favicon noise", () => {
  expect(
    browserDiagnosticsIssueCount({
      consoleErrors: [{ type: "error", text: "Failed to load resource: the server responded with a status of 404" }],
      pageErrors: [],
      failedRequests: [],
      httpErrors: [
        {
          url: "http://127.0.0.1/favicon.ico",
          status: 404,
          statusText: "Not Found",
          resourceType: "other",
        },
      ],
    }),
  ).toBe(0)
})

test("browser MCP monitor screenshot endpoint does not return cached or error SVG screenshots as HTTP 200", () => {
  const source = fs.readFileSync(path.join(import.meta.dir, "../../src/mcp/browser/monitor.ts"), "utf8")

  expect(source).not.toContain("lastScreenshot")
  expect(source).not.toContain("image/svg+xml")
  expect(source).toContain("writeMonitorScreenshotError(res, 409")
  expect(source).toContain("writeMonitorScreenshotError(res, status")
  expect(source).toContain('"Content-Type": "application/json; charset=utf-8"')
  expect(source).toContain("? 504")
  expect(source).not.toMatch(/catch \(e\)[\s\S]{0,500}writeHead\(200/)
})

test("browser MCP CDP screenshot capture has one strict source", () => {
  const tools = fs.readFileSync(path.join(import.meta.dir, "../../src/mcp/browser/tools.ts"), "utf8")
  const monitor = fs.readFileSync(path.join(import.meta.dir, "../../src/mcp/browser/monitor.ts"), "utf8")
  const screenshot = fs.readFileSync(path.join(import.meta.dir, "../../src/mcp/browser/screenshot.ts"), "utf8")

  expect(tools).not.toContain('cdp.send("Page.captureScreenshot"')
  expect(monitor).not.toContain('cdp.send("Page.captureScreenshot"')
  expect(screenshot.match(/cdp\.send\("Page\.captureScreenshot"/g)?.length).toBe(1)
  expect(tools).toContain("captureBrowserMcpViewportScreenshot(page)")
  expect(monitor).toContain("captureBrowserMcpViewportScreenshot(session.page")
})

test("browser screenshot pixel summary warns when compression is too high", () => {
  const summary = screenshotPixelSummary(3000, 2000)

  expect(summary.currentPixels).toBe(6_000_000)
  expect(summary.compressedWidth).toBe(1254)
  expect(summary.compressedHeight).toBe(836)
  expect(summary.compressedPixels).toBe(1_048_344)
  expect(summary.compressionRatio).toBe(2.39)
  expect(summary.preferPartialScreenshot).toBe(true)
  expect(summary.text).toContain("当前像素: 6000000 (3000x2000)")
  expect(summary.text).toContain("压缩后像素: 1048344 (1254x836)")
  expect(summary.text).toContain("压缩率: 2.39x")
  expect(summary.text).toContain("压缩率过大，请优先使用 selector 或 clip 做局部截图")
})

test("browser screenshot pixel summary keeps viewport screenshots unflagged", () => {
  const summary = screenshotPixelSummary(640, 480)

  expect(summary.currentPixels).toBe(307_200)
  expect(summary.compressedWidth).toBe(640)
  expect(summary.compressedHeight).toBe(480)
  expect(summary.compressedPixels).toBe(307_200)
  expect(summary.compressionRatio).toBe(1)
  expect(summary.preferPartialScreenshot).toBe(false)
  expect(summary.text).not.toContain("压缩率过大")
})
