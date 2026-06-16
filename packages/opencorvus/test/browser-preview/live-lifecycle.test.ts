import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..", "..")

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8")
}

test("interactive browser preview sessions have bounded resource lifetimes", () => {
  const live = source("src/browser-preview/live.ts")

  expect(live).toContain("LIVE_IDLE_TIMEOUT_MILLISECONDS")
  expect(live).toContain("private armIdleTimer(): void")
  expect(live).toContain("this.idleTimer.unref?.()")
  expect(live).toContain("private clearIdleTimer(): void")
  expect(live).toContain("this.clearIdleTimer()")
  expect(live).toContain("detached: process.platform !== \"win32\"")
  expect(live).toContain('terminateChildTree(this.child, "SIGTERM")')
  expect(live).toContain('terminateChildTree(this.child, "SIGKILL")')
  expect(live).toContain("process.kill(-pid, signal)")
})

test("interactive browser preview command abort and timeout paths release listeners", () => {
  const live = source("src/browser-preview/live.ts")

  expect(live).toContain("const pending = this.pending.get(id)")
  expect(live).toContain("pending.reject(new Error(`Browser preview live command timed out.")
  expect(live).toContain('new Error("Browser preview live command aborted.")')
  expect(live).toContain('signal?.removeEventListener("abort", abort)')
})

test("interactive browser preview sidecars close on parent pipe teardown", () => {
  const live = source("src/browser-preview/live.ts")

  expect(live).toContain("let shuttingDown = false;")
  expect(live).toContain('process.stdin.on("end", shutdown);')
  expect(live).toContain('process.stdin.on("close", shutdown);')
  expect(live).toContain("if (browser) await browser.close().catch")
})

test("server dispose and shutdown paths close interactive browser preview sessions", () => {
  const serve = source("src/cli/cmd/serve.ts")
  const appRoutes = source("src/server/routes/app.ts")
  const globalRoutes = source("src/server/routes/global.ts")

  expect(serve).toContain("closeBrowserPreviewLiveSessions")
  expect(serve).toContain("abortCurrentProcessLiveExecution")
  expect(serve.indexOf("await closeBrowserPreviewLiveSessions()")).toBeGreaterThan(
    serve.indexOf("abortCurrentProcessLiveExecution"),
  )
  expect(appRoutes).toContain("await closeBrowserPreviewLiveSessions()")
  expect(appRoutes.indexOf("await closeBrowserPreviewLiveSessions()")).toBeLessThan(
    appRoutes.indexOf("await Instance.dispose()"),
  )
  expect(globalRoutes).toContain("await closeBrowserPreviewLiveSessions()")
  expect(globalRoutes.indexOf("await closeBrowserPreviewLiveSessions()")).toBeLessThan(
    globalRoutes.indexOf("await Instance.disposeAll()"),
  )
})
