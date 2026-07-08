import { expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { installBrowserErrorCollector } from "./browser/error-collector"

class FakeBrowserPage {
  readonly listeners = new Map<string, Array<(value: any) => void>>()

  on(event: "pageerror" | "console" | "response" | "requestfailed", listener: (value: any) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  emit(event: "pageerror" | "console" | "response" | "requestfailed", value: any): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value)
  }
}

function consoleMessage(type: string, text: string) {
  return {
    type: () => type,
    text: () => text,
  }
}

function response(status: number, url: string) {
  return {
    status: () => status,
    url: () => url,
  }
}

function failedRequest(url: string, errorText: string) {
  return {
    url: () => url,
    failure: () => ({ errorText }),
  }
}

test("browser error collector fails on page errors, console errors, unexpected fixture 404s, and request failures", () => {
  const page = new FakeBrowserPage()
  const collector = installBrowserErrorCollector(page)

  page.emit("pageerror", new Error("render exploded"))
  page.emit("console", consoleMessage("error", "component threw"))
  page.emit("response", response(404, "http://fixture.local/missing"))
  page.emit("requestfailed", failedRequest("http://fixture.local/offline", "net::ERR_CONNECTION_REFUSED"))

  expect(() => collector.assertNoUnexpectedErrors()).toThrow(/render exploded/)
  expect(() => collector.assertNoUnexpectedErrors()).toThrow(/component threw/)
  expect(() => collector.assertNoUnexpectedErrors()).toThrow(/404 http:\/\/fixture\.local\/missing/)
  expect(() => collector.assertNoUnexpectedErrors()).toThrow(
    /requestfailed: net::ERR_CONNECTION_REFUSED http:\/\/fixture\.local\/offline/,
  )
})

test("browser error collector allows explicitly expected fixture failures", () => {
  const page = new FakeBrowserPage()
  const collector = installBrowserErrorCollector(page, {
    allowResponse(input) {
      return input.path === "/find/file" && input.status === 500
    },
  })

  page.emit("response", response(500, "http://fixture.local/find/file"))

  expect(() => collector.assertNoUnexpectedErrors()).not.toThrow()
})

test("browser error collector response allow rules can distinguish query strings", () => {
  const page = new FakeBrowserPage()
  const collector = installBrowserErrorCollector(page, {
    allowResponse(input) {
      return input.pathWithSearch === "/file?path=" && input.status === 500
    },
  })

  page.emit("response", response(500, "http://fixture.local/file?path="))
  page.emit("response", response(500, "http://fixture.local/file?path=src"))

  expect(() => collector.assertNoUnexpectedErrors()).toThrow(/500 http:\/\/fixture\.local\/file\?path=src/)
})

test("browser error collector allows explicitly expected request failures", () => {
  const page = new FakeBrowserPage()
  const collector = installBrowserErrorCollector(page, {
    allowRequestFailure(input) {
      return input.path === "/expected-abort" && input.errorText === "net::ERR_ABORTED"
    },
  })

  page.emit("requestfailed", failedRequest("http://fixture.local/expected-abort", "net::ERR_ABORTED"))

  expect(() => collector.assertNoUnexpectedErrors()).not.toThrow()
})

test("browser error collector is idempotent and later calls update precise allow rules", () => {
  const page = new FakeBrowserPage()
  const collector = installBrowserErrorCollector(page)
  const sameCollector = installBrowserErrorCollector(page, {
    allowResponse(input) {
      return input.path === "/expected" && input.status === 503
    },
  })

  page.emit("response", response(503, "http://fixture.local/expected"))

  expect(sameCollector).toBe(collector)
  expect(page.listeners.get("response")?.length).toBe(1)
  expect(() => collector.assertNoUnexpectedErrors()).not.toThrow()
})

test("launchBrowser centralizes browser error collector ownership", () => {
  const source = readFileSync(join(import.meta.dir, "launch.ts"), "utf8")

  expect(source).toContain(
    'import { installBrowserErrorCollector, type BrowserErrorCollector } from "./browser/error-collector.ts"',
  )
  expect(source).toContain("private browserErrorCollectors = new Map<string, BrowserErrorCollector>()")
  expect(source).toContain("this.browserErrorCollectors.set(id, installBrowserErrorCollector(page))")
  expect(source).toContain("this.assertNoUnexpectedBrowserErrors()")
  expect(source).not.toContain("BROWSER_COLLECTOR_OPT_OUT")
})

test("launchBrowser binds RPC inactivity and lock release to sidecar lifecycle", () => {
  const source = readFileSync(join(import.meta.dir, "launch.ts"), "utf8")

  expect(source).toContain('this.refreshPendingRpcTimers("stdout")')
  expect(source).toContain('this.refreshPendingRpcTimers("stderr")')
  expect(source).toContain("rejectPendingBrowserCalls")
  expect(source).toContain('this.child!.once("close"')
  expect(source).toContain('await this.terminateSidecar("browser close")')
  expect(source).toContain('detached: process.platform !== "win32"')
  expect(source).toContain('spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"]')
  expect(source).not.toContain("this.child?.kill()\n          this.release()")
})

test("app dialog browser fixture uses the shared collector and explicit unmatched 404s", () => {
  const source = readFileSync(join(import.meta.dir, "browser", "app-dialog-segmented-control.test.ts"), "utf8")

  expect(source).toContain('import { installBrowserErrorCollector } from "./error-collector.ts"')
  expect(source).toContain("installBrowserErrorCollector(page)")
  expect(source).toContain('if (path === "/skill/mounts")')
  expect(source).toContain('if (path === "/project/current/worktrees")')
  expect(source).toContain(`/task/\${taskID}/conversation`)
  expect(source).toContain("unhandled ${req.method} ${url.pathname}")
  expect(source).not.toContain('page.on("console"')
  expect(source).not.toContain('page.on("pageerror"')
  expect(source).toContain("return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })")
})

test("coding assistant directory browser fixture uses the shared collector", () => {
  const source = readFileSync(join(import.meta.dir, "browser", "coding-assistant-directory-browser.test.ts"), "utf8")

  expect(source).toContain('import { installBrowserErrorCollector } from "./error-collector.ts"')
  expect(source).toContain("installBrowserErrorCollector(page)")
  expect(source).toContain("errors.assertNoUnexpectedErrors()")
  expect(source).not.toContain('page.on("console"')
  expect(source).not.toContain('page.on("pageerror"')
  expect(source).not.toContain('page.on("response"')
})

test("task dirbar browser fixture uses the shared collector", () => {
  const source = readFileSync(join(import.meta.dir, "browser", "task-dirbar-keyboard.test.ts"), "utf8")

  expect(source).toContain('import { installBrowserErrorCollector } from "./error-collector.ts"')
  expect(source).toContain("installBrowserErrorCollector(page")
  expect(source).toContain("errors.assertNoUnexpectedErrors()")
  expect(source).toContain('path === "/global/tasks"')
  expect(source).not.toContain('path === "/tasks" || path === "/global/tasks"')
  expect(source).not.toContain('response.path === "/global/tasks" || response.path === "/tasks"')
  expect(source).not.toContain('page.on("console"')
  expect(source).not.toContain('page.on("pageerror"')
  expect(source).not.toContain('page.on("response"')
})

test("screenshot browser evidence suite uses the shared collector", () => {
  const source = readFileSync(join(import.meta.dir, "browser", "screenshot-browser-panel-browser.test.ts"), "utf8")

  expect(source).toContain('import { installBrowserErrorCollector } from "./error-collector.ts"')
  expect(source).toContain("installBrowserErrorCollector(page")
  expect(source).toContain("errors.assertNoUnexpectedErrors()")
  expect(source).not.toContain("unexpectedRequests")
  expect(source).not.toContain('page.on("console"')
  expect(source).not.toContain('page.on("pageerror"')
  expect(source).not.toContain('page.on("response"')
  expect(source).not.toContain('page.on("requestfailed"')
})

test("command palette and titlebar browser suites use the shared collector", () => {
  for (const file of ["command-palette.test.ts", "titlebar-menubar.test.ts"]) {
    const source = readFileSync(join(import.meta.dir, "browser", file), "utf8")
    expect(source).toContain('import { installBrowserErrorCollector } from "./error-collector.ts"')
    expect(source).toContain("installBrowserErrorCollector(page")
    expect(source).toContain("errors.assertNoUnexpectedErrors()")
    expect(source).not.toContain('page.on("console"')
    expect(source).not.toContain('page.on("pageerror"')
    expect(source).not.toContain('page.on("response"')
    expect(source).not.toContain('page.on("requestfailed"')
  }
})

test("provider prompt and skill browser suites are covered by the central browser collector", () => {
  const files = [
    "agent-models-panel.test.ts",
    "expert-squad-panel.test.ts",
    "provider-agent-model-sync.test.ts",
    "provider-auth-panel.test.ts",
    "provider-oauth.test.ts",
    "skill-mcp-panel-browser.test.ts",
    "skill-mount-matrix-browser.test.ts",
  ]

  for (const file of files) {
    const source = readFileSync(join(import.meta.dir, "browser", file), "utf8")
    expect(source, `${file} must use the shared launchBrowser helper`).toContain("launchBrowser")
    expect(source).not.toContain('page.on("console"')
    expect(source).not.toContain('page.on("pageerror"')
    expect(source).not.toContain('page.on("requestfailed"')
  }
})

test("browser task-list fixtures use the single global tasks route", () => {
  const browserDir = join(import.meta.dir, "browser")
  const files = readdirSync(browserDir)
    .filter((file) => file.endsWith(".test.ts"))
    .sort()

  for (const file of files) {
    const source = readFileSync(join(browserDir, file), "utf8")
    expect(source).not.toMatch(/if\s*\(\s*path\s*===\s*["']\/tasks["']/)
    expect(source).not.toMatch(/["']\/tasks["']\s*\|\|\s*path\s*===\s*["']\/global\/tasks["']/)
    expect(source).not.toMatch(/["']\/global\/tasks["']\s*\|\|\s*path\s*===\s*["']\/tasks["']/)
  }
})

test("confirmed TaskList and conversation browser coverage uses the shared collector", () => {
  const files = [
    "task-list-tree-click.test.ts",
    "task-list-reduced-motion-browser.test.ts",
    "task-list-perf.test.ts",
    "task-status-header-missing-completion-browser.test.ts",
    "expert-squad-selector-browser.test.ts",
    "conversation-agent-rail-scroll-browser.test.ts",
    "message-card-chronological-turns-browser.test.ts",
  ]

  for (const file of files) {
    const source = readFileSync(join(import.meta.dir, "browser", file), "utf8")
    expect(source).toContain("installBrowserErrorCollector(page")
    expect(source).toContain("errors.assertNoUnexpectedErrors()")
    expect(source).not.toContain('page.on("console"')
    expect(source).not.toContain('page.on("pageerror"')
    expect(source).not.toContain('page.on("response"')
    expect(source).not.toContain('page.on("requestfailed"')
    expect(source).not.toContain("badResponses")
  }
})

test("browser collector ownership is repository-wide", () => {
  const browserDir = join(import.meta.dir, "browser")
  const files = readdirSync(browserDir)
    .filter((file) => file.endsWith(".test.ts"))
    .sort()

  for (const file of files) {
    const source = readFileSync(join(browserDir, file), "utf8")
    if (!source.includes("launchBrowser")) continue
    expect(source, `${file} must not define a local collector opt-out`).not.toContain("BROWSER_COLLECTOR_OPT_OUT")
  }
})
