import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { BrowserRuntime } from "../../src/browser/runtime"
import {
  createSession,
  destroySession,
  getSession,
  getSessionStats,
  getSessions,
  getSessionStatus,
  withSessionOperationLock,
} from "../../src/mcp/browser/sessions"

type Handler = (...args: unknown[]) => void

class FakePage {
  private handlers = new Map<string, Handler[]>()

  async addInitScript() {}

  on(event: string, handler: Handler) {
    const existing = this.handlers.get(event) ?? []
    existing.push(handler)
    this.handlers.set(event, existing)
    return this
  }

  async close() {
    for (const handler of this.handlers.get("close") ?? []) handler()
  }

  url() {
    return "about:blank"
  }

  async title() {
    return ""
  }
}

class FakeContext {
  readonly pagesList: FakePage[] = []
  newPageDelayMs = 0
  closed = false
  private handlers = new Map<string, Handler[]>()

  constructor(private readonly failNewPage = false) {}

  async newPage() {
    if (this.closed) throw new Error("context closed")
    if (this.newPageDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.newPageDelayMs))
    if (this.closed) throw new Error("context closed")
    if (this.failNewPage) throw new Error("new page failed")
    const page = new FakePage()
    this.pagesList.push(page)
    return page
  }

  async route() {}

  on(event: string, handler: Handler) {
    const existing = this.handlers.get(event) ?? []
    existing.push(handler)
    this.handlers.set(event, existing)
    return this
  }

  pages() {
    return this.pagesList
  }

  async close() {
    this.closed = true
    for (const handler of this.handlers.get("close") ?? []) handler()
  }
}

class FakeBrowser {
  readonly contexts: FakeContext[] = []
  readonly contextOptions: any[] = []
  private disconnectedHandlers: Handler[] = []
  private closed = false

  constructor(private readonly contextFactory: () => FakeContext) {}

  isConnected() {
    return !this.closed
  }

  async newContext(options?: any) {
    this.contextOptions.push(options)
    const context = this.contextFactory()
    this.contexts.push(context)
    return context
  }

  on(event: string, handler: Handler) {
    if (event === "disconnected") this.disconnectedHandlers.push(handler)
    return this
  }

  async close() {
    this.closed = true
    for (const handler of this.disconnectedHandlers) handler()
  }
}

describe("browser MCP session lifecycle", () => {
  const originalLaunch = BrowserRuntime.launchPlaywrightBrowserInNodeProcess
  const launchedBrowsers: FakeBrowser[] = []

  test("session cleanup timers and shutdown signals observe async failures", () => {
    const sessions = readFileSync(path.resolve(import.meta.dir, "../../src/mcp/browser/sessions.ts"), "utf8")
    const index = readFileSync(path.resolve(import.meta.dir, "../../src/mcp/browser/index.ts"), "utf8")

    expect(sessions).toContain("})().catch((error) => {")
    expect(sessions).toContain("session cleanup failed")
    expect(sessions).toContain("SIGINT shutdown failed")
    expect(sessions).toContain("SIGTERM shutdown failed")
    expect(index).toContain("void close().catch((error) => {")
  })

  afterEach(async () => {
    for (const session of getSessions()) {
      await destroySession(session.id).catch(() => undefined)
    }
    for (const browser of launchedBrowsers.splice(0)) {
      await browser.close()
    }
    ;(
      BrowserRuntime as { launchPlaywrightBrowserInNodeProcess: typeof originalLaunch }
    ).launchPlaywrightBrowserInNodeProcess = originalLaunch
  })

  test("coalesces concurrent browser launch requests", async () => {
    let launchCount = 0
    const browser = new FakeBrowser(() => new FakeContext())
    launchedBrowsers.push(browser)
    ;(
      BrowserRuntime as { launchPlaywrightBrowserInNodeProcess: typeof originalLaunch }
    ).launchPlaywrightBrowserInNodeProcess = async () => {
      launchCount++
      await new Promise((resolve) => setTimeout(resolve, 20))
      return browser as never
    }

    const [first, second] = await Promise.all([
      createSession({ virtualCursor: false }),
      createSession({ virtualCursor: false }),
    ])

    expect(first.sessionId).not.toBe(second.sessionId)
    expect(launchCount).toBe(1)
    expect(browser.contexts.length).toBe(2)
  })

  test("does not use process proxy environment when session proxy is omitted", async () => {
    const originalHttpsProxy = process.env.HTTPS_PROXY
    let launchInput: Parameters<typeof BrowserRuntime.launchPlaywrightBrowserInNodeProcess>[0] | undefined
    const browser = new FakeBrowser(() => new FakeContext())
    launchedBrowsers.push(browser)
    ;(
      BrowserRuntime as { launchPlaywrightBrowserInNodeProcess: typeof originalLaunch }
    ).launchPlaywrightBrowserInNodeProcess = async (input) => {
      launchInput = input
      return browser as never
    }

    try {
      process.env.HTTPS_PROXY = "http://env-proxy.example:8080"
      const session = await createSession({ virtualCursor: false })

      expect(session.sessionId).toMatch(/^sess_/)
      expect(launchInput?.args?.some((arg) => arg.startsWith("--proxy-server="))).toBe(false)
      expect(browser.contextOptions[0]?.proxy).toBeUndefined()
    } finally {
      if (originalHttpsProxy === undefined) delete process.env.HTTPS_PROXY
      else process.env.HTTPS_PROXY = originalHttpsProxy
    }
  })
  test("uses explicit session proxy without reading process proxy environment for browser launch", async () => {
    const originalHttpsProxy = process.env.HTTPS_PROXY
    let launchInput: Parameters<typeof BrowserRuntime.launchPlaywrightBrowserInNodeProcess>[0] | undefined
    const browser = new FakeBrowser(() => new FakeContext())
    launchedBrowsers.push(browser)
    ;(
      BrowserRuntime as { launchPlaywrightBrowserInNodeProcess: typeof originalLaunch }
    ).launchPlaywrightBrowserInNodeProcess = async (input) => {
      launchInput = input
      return browser as never
    }

    try {
      process.env.HTTPS_PROXY = "http://env-proxy.example:8080"
      const session = await createSession({
        virtualCursor: false,
        proxy: { server: "http://explicit-session-proxy.example:9090" },
      })

      expect(session.sessionId).toMatch(/^sess_/)
      expect(launchInput?.args).not.toContain("--proxy-server=http://env-proxy.example:8080")
      expect(launchInput?.args?.some((arg) => arg.startsWith("--proxy-server="))).toBe(false)
      expect(browser.contextOptions[0]?.proxy).toEqual({ server: "http://explicit-session-proxy.example:9090" })
    } finally {
      if (originalHttpsProxy === undefined) delete process.env.HTTPS_PROXY
      else process.env.HTTPS_PROXY = originalHttpsProxy
    }
  })

  test("closes a newly created profile when page creation fails", async () => {
    const context = new FakeContext(true)
    const browser = new FakeBrowser(() => context)
    launchedBrowsers.push(browser)
    ;(
      BrowserRuntime as { launchPlaywrightBrowserInNodeProcess: typeof originalLaunch }
    ).launchPlaywrightBrowserInNodeProcess = async () => browser as never

    await expect(createSession({ virtualCursor: false })).rejects.toThrow("new page failed")
    expect(context.closed).toBe(true)
    expect(getSessionStats().active).toBe(0)
    expect(getSessionStats().profiles).toBe(0)
  })

  test("serializes profile reuse against destroying the previous session", async () => {
    const context = new FakeContext()
    const browser = new FakeBrowser(() => context)
    launchedBrowsers.push(browser)
    ;(
      BrowserRuntime as { launchPlaywrightBrowserInNodeProcess: typeof originalLaunch }
    ).launchPlaywrightBrowserInNodeProcess = async () => browser as never

    const first = await createSession({ virtualCursor: false })
    context.newPageDelayMs = 20

    const [second, destroyed] = await Promise.all([
      createSession({ profileId: first.profileId, virtualCursor: false }),
      destroySession(first.sessionId),
    ])

    expect(second.profileId).toBe(first.profileId)
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(destroyed.profilePreserved).toBe(true)
    expect(context.closed).toBe(false)
    expect(getSessionStats().active).toBe(1)
    expect(getSessionStats().profiles).toBe(1)
  })

  test("serializes operations against the same browser session", async () => {
    const sessionId = "sess_operation_lock"
    const events: string[] = []

    const first = withSessionOperationLock(sessionId, async () => {
      events.push("first:start")
      await new Promise((resolve) => setTimeout(resolve, 20))
      events.push("first:end")
    })
    const second = withSessionOperationLock(sessionId, async () => {
      events.push("second:start")
      events.push("second:end")
    })

    await Promise.all([first, second])

    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"])
  })

  test("releases the session operation lock after a tool error", async () => {
    const sessionId = "sess_operation_lock_error"
    const events: string[] = []

    await expect(
      withSessionOperationLock(sessionId, async () => {
        events.push("error:start")
        throw new Error("simulated tool error")
      }),
    ).rejects.toThrow("simulated tool error")

    await withSessionOperationLock(sessionId, async () => {
      events.push("next:start")
    })

    expect(events).toEqual(["error:start", "next:start"])
  })

  test("records a clear unavailable status when a page closes unexpectedly", async () => {
    const context = new FakeContext()
    const browser = new FakeBrowser(() => context)
    launchedBrowsers.push(browser)
    ;(
      BrowserRuntime as { launchPlaywrightBrowserInNodeProcess: typeof originalLaunch }
    ).launchPlaywrightBrowserInNodeProcess = async () => browser as never

    const created = await createSession({ virtualCursor: false })
    await context.pagesList[0].close()

    expect(() => getSession(created.sessionId)).toThrow(/Session unavailable: .*page_closed/)
    expect(getSessionStatus(created.sessionId)).toMatchObject({
      sessionId: created.sessionId,
      profileId: created.profileId,
      status: "unavailable",
      reason: "page_closed",
      message: "Page closed unexpectedly",
    })
    expect(getSessionStats().active).toBe(0)
    expect(getSessionStats().profiles).toBe(0)
  })
})
