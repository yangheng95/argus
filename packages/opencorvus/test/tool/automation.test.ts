import { afterEach, describe, expect, test } from "bun:test"
import { AutomationTool } from "../../src/tool/automation"
import { AutomationRuntime } from "../../src/opencorvus/automation"
import { AppiumDriver } from "../../src/opencorvus/automation/adapters/appium"
import { PlaywrightDriver } from "../../src/opencorvus/automation/adapters/playwright"

const ctx = {
  sessionID: "test",
  messageID: "msg",
  callID: "call",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

class LocatorStub implements PlaywrightDriver.Locator {
  clicks = 0
  visible = true

  count() {
    return Promise.resolve(1)
  }

  first() {
    return this
  }

  click() {
    this.clicks += 1
    return Promise.resolve()
  }

  fill() {
    return Promise.resolve()
  }

  isVisible() {
    return Promise.resolve(this.visible)
  }

  isEnabled() {
    return Promise.resolve(true)
  }

  evaluate<T>(fn: (element: Element, arg?: unknown) => T | Promise<T>, arg?: unknown) {
    const element = {
      textContent: "Save",
      getAttribute: () => null,
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 10, height: 10 }),
    } as unknown as Element
    return Promise.resolve(fn(element, arg))
  }
}

class ElementStub implements AppiumDriver.Element {
  elementId = "e-1"
  value = ""

  click() {
    return Promise.resolve()
  }

  isDisplayed() {
    return Promise.resolve(true)
  }

  isEnabled() {
    return Promise.resolve(true)
  }

  clear() {
    this.value = ""
    return Promise.resolve()
  }

  setValue(value: string) {
    this.value = value
    return Promise.resolve()
  }

  getText() {
    return Promise.resolve(this.value)
  }
}

function launcher() {
  const locator = new LocatorStub()
  const fronts: string[] = []
  let contextClosed = false
  let browserClosed = false
  let seq = 0

  type Page = PlaywrightDriver.Page & {
    goto: (url: string) => Promise<void>
    close: () => Promise<void>
    url: () => string
    title: () => Promise<string>
    context: () => Context
    id: string
  }
  type Context = {
    newPage: () => Promise<Page>
    pages: () => Page[]
    close: () => Promise<void>
  }

  const pages = [] as Page[]

  let context: Context
  const page = () => {
    seq += 1
    const id = `tab-${seq}`
    let current = "about:blank"
    const next: Page = {
      id,
      locator: () => locator,
      getByRole: () => locator,
      getByText: () => locator,
      keyboard: { press: async () => {} },
      mouse: { wheel: async () => {} },
      screenshot: async () => new Uint8Array([1]),
      bringToFront: async () => {
        fronts.push(id)
      },
      goto: async (url) => {
        current = url
      },
      close: async () => {
        const index = pages.findIndex((item) => item.id === id)
        if (index >= 0) pages.splice(index, 1)
      },
      url: () => current,
      title: async () => current,
      context: () => context,
    }
    return next
  }

  context = {
    newPage: async () => {
      const next = page()
      pages.push(next)
      return next
    },
    pages: () => [...pages],
    close: async () => {
      contextClosed = true
    },
  }

  const browser = {
    newContext: async () => context,
    close: async () => {
      browserClosed = true
    },
  }

  return {
    launcher: {
      chromium: {
        launch: async () => browser,
      },
    },
    fronts,
    closed: () => ({
      contextClosed,
      browserClosed,
    }),
  }
}

afterEach(() => {
  AutomationRuntime.clear()
  AutomationRuntime.setPlaywrightLauncher()
  Reflect.deleteProperty(globalThis as object, "__opencorvus_playwright_page")
  Reflect.deleteProperty(globalThis as object, "__opencorvus_playwright_launcher")
})

describe("tool.automation", () => {
  test("reports detached runtime in status action", async () => {
    const tool = await AutomationTool.init()
    const result = await tool.execute({ action: "status" }, ctx)
    expect(result.metadata.playwright).toBe(false)
    expect(result.metadata.appium).toBe(false)
  })

  test("returns runtime unavailable when run action has no attached driver", async () => {
    const tool = await AutomationTool.init()
    const result = await tool.execute(
      {
        action: "run",
        step: {
          id: "noop",
          act: { kind: "wait", ms: 1 },
        },
      },
      ctx,
    )
    expect(result.metadata.ok).toBe(false)
    expect(result.metadata.reason).toBe("runtime_unavailable")
  })

  test("runs single step through playwright driver", async () => {
    const locator = new LocatorStub()
    const page: PlaywrightDriver.Page = {
      locator: () => locator,
      getByRole: () => locator,
      getByText: () => locator,
      keyboard: { press: async () => {} },
      mouse: { wheel: async () => {} },
      screenshot: async () => new Uint8Array([1]),
    }
    AutomationRuntime.setPlaywright({ page })

    const tool = await AutomationTool.init()
    const result = await tool.execute(
      {
        action: "run",
        driver: "playwright",
        step: {
          id: "save",
          target: [{ kind: "role", value: "button", name: "Save" }],
          pre: [{ kind: "visible" }],
          act: { kind: "click" },
          post: [{ kind: "exists" }],
        },
      },
      ctx,
    )
    const payload = JSON.parse(result.output) as { ok: boolean; driver: string; failed: number }
    expect(payload.ok).toBe(true)
    expect(payload.driver).toBe("playwright")
    expect(payload.failed).toBe(0)
    expect(locator.clicks).toBe(1)
  })

  test("auto mode picks appium when playwright is absent", async () => {
    const element = new ElementStub()
    const client: AppiumDriver.Client = {
      $$: async () => [element],
      keys: async () => {},
      pause: async () => {},
      execute: async () => true,
      takeScreenshot: async () => "",
    }
    AutomationRuntime.setAppium({ client })

    const tool = await AutomationTool.init()
    const result = await tool.execute(
      {
        action: "run",
        step: {
          id: "field",
          target: [{ kind: "aid", value: "username" }],
          act: { kind: "type", text: "alice" },
        },
      },
      ctx,
    )
    const payload = JSON.parse(result.output) as { ok: boolean; driver: string }
    expect(payload.ok).toBe(true)
    expect(payload.driver).toBe("appium")
    expect(element.value).toBe("alice")
  })

  test("attaches runtime from global keys and clears it", async () => {
    const locator = new LocatorStub()
    const page: PlaywrightDriver.Page = {
      locator: () => locator,
      getByRole: () => locator,
      getByText: () => locator,
      keyboard: { press: async () => {} },
      mouse: { wheel: async () => {} },
      screenshot: async () => new Uint8Array([1]),
    }
    Reflect.set(globalThis as object, "__opencorvus_playwright_page", page)

    const tool = await AutomationTool.init()
    const attached = await tool.execute({ action: "attach" }, ctx)
    expect(attached.metadata.playwright).toBe(true)

    const status = await tool.execute({ action: "status" }, ctx)
    expect(status.metadata.playwright).toBe(true)

    const cleared = await tool.execute({ action: "clear", kind: "playwright" }, ctx)
    expect(cleared.metadata.playwright).toBe(false)
    Reflect.deleteProperty(globalThis as object, "__opencorvus_playwright_page")
  })

  test("applies post_template when step.post is omitted", async () => {
    const locator = new LocatorStub()
    locator.visible = false
    const page: PlaywrightDriver.Page = {
      locator: () => locator,
      getByRole: () => locator,
      getByText: () => locator,
      keyboard: { press: async () => {} },
      mouse: { wheel: async () => {} },
      screenshot: async () => new Uint8Array([1]),
    }
    AutomationRuntime.setPlaywright({ page })

    const tool = await AutomationTool.init()
    const result = await tool.execute(
      {
        action: "run",
        driver: "playwright",
        post_template: "visible",
        timeoutMs: 20,
        intervalMs: 0,
        retryMax: 1,
        step: {
          id: "save",
          target: [{ kind: "role", value: "button", name: "Save" }],
          act: { kind: "click" },
        },
      },
      ctx,
    )
    const payload = JSON.parse(result.output) as { ok: boolean; failed: number }
    expect(payload.ok).toBe(false)
    expect(payload.failed).toBe(1)
  })

  test("manages playwright lifecycle actions with tabs", async () => {
    const mocked = launcher()
    Reflect.set(globalThis as object, "__opencorvus_playwright_launcher", mocked.launcher)

    const tool = await AutomationTool.init()
    const started = await tool.execute(
      {
        action: "start",
        playwright_launcher_global: "__opencorvus_playwright_launcher",
        url: "https://example.com",
      },
      ctx,
    )
    expect(started.metadata.ok).toBe(true)
    expect(started.metadata.total).toBe(1)
    expect(started.metadata.tabs[0].url).toBe("https://example.com")

    const opened = await tool.execute({ action: "open", url: "https://example.com/docs" }, ctx)
    expect(opened.metadata.ok).toBe(true)
    expect(opened.metadata.tabs[0].url).toBe("https://example.com/docs")

    const created = await tool.execute({ action: "new_tab", url: "https://example.com/new" }, ctx)
    expect(created.metadata.ok).toBe(true)
    expect(created.metadata.total).toBe(2)
    expect(created.metadata.active).toBe(1)

    const listed = await tool.execute({ action: "list_tabs" }, ctx)
    expect(listed.metadata.ok).toBe(true)
    expect(listed.metadata.tabs[1].url).toBe("https://example.com/new")

    const switched = await tool.execute({ action: "switch_tab", index: 0 }, ctx)
    expect(switched.metadata.ok).toBe(true)
    expect(switched.metadata.active).toBe(0)
    expect(mocked.fronts).toContain("tab-1")

    const closed = await tool.execute({ action: "close_tab", index: 1 }, ctx)
    expect(closed.metadata.ok).toBe(true)
    expect(closed.metadata.total).toBe(1)

    const stopped = await tool.execute({ action: "stop" }, ctx)
    expect(stopped.metadata.ok).toBe(true)
    expect(stopped.metadata.contextClosed).toBe(true)
    expect(stopped.metadata.browserClosed).toBe(true)

    const finalStatus = await tool.execute({ action: "status" }, ctx)
    expect(finalStatus.metadata.playwright).toBe(false)
  })
})
