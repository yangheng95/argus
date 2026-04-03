import { launchBrowser } from "./launch"

const { default: puppeteer } = await import(
  new URL("../../opencorvus/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js", import.meta.url).href,
)

const src = new URL("../src/", import.meta.url)
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
}

async function browser() {
  const list = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ]
  for (const item of list) {
    if (await Bun.file(item).exists()) return item
  }
  throw new Error("No local Edge/Chrome executable found for overlay interaction safety test")
}

function serve() {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1)
      const file = Bun.file(new URL(name, src))
      const type = types[name.slice(name.lastIndexOf(".")) as keyof typeof types] || "application/octet-stream"
      return file.exists().then((ok) => ok ? new Response(file, { headers: { "content-type": type } }) : new Response("not found", { status: 404 }))
    },
  })
}

test("resolving one interaction only disables its own buttons", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => typeof (window as typeof window & { createOverlayInteractions?: unknown }).createOverlayInteractions === "function")

    const result = await tab.evaluate(() => {
      const escape = (value: unknown) => String(value ?? "")
      const goalsBody = document.createElement("div")
      document.body.appendChild(goalsBody)
      const helper = (window as typeof window & {
        createOverlayInteractions: (deps: Record<string, unknown>) => {
          renderInteractions: (items: unknown[]) => void
          resolveInteraction: (id: string, action: string, input?: Record<string, unknown>) => Promise<void>
        }
      }).createOverlayInteractions({
        state: {
          autoPermission: false,
          autoQuestion: false,
        },
        dom: {
          goalsBody,
        },
        document,
        escapeHtml: escape,
        renderMarkdown: escape,
        t: (key: string) => key === "interaction.processing_suffix" ? " (processing)" : key,
        record: (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value),
        apiJson: () => new Promise(() => undefined),
        nativePrompt: async () => null,
        loadBoard: async () => undefined,
        AppLog: {
          error() {},
          warn() {},
        },
      })

      helper.renderInteractions([{
        id: "first",
        type: "permission",
        status: "pending",
        title: "first",
        body: "first",
      }, {
        id: "second",
        type: "permission",
        status: "pending",
        title: "second",
        body: "second",
      }])

      void helper.resolveInteraction("first", "always")

      return {
        first: [...document.querySelectorAll('.interaction-alert[data-id="first"] button')].map((btn) => ({
          disabled: (btn as HTMLButtonElement).disabled,
          opacity: (btn as HTMLButtonElement).style.opacity,
        })),
        second: [...document.querySelectorAll('.interaction-alert[data-id="second"] button')].map((btn) => ({
          disabled: (btn as HTMLButtonElement).disabled,
          opacity: (btn as HTMLButtonElement).style.opacity,
        })),
      }
    })

    expect(result.first.every((item) => item.disabled && item.opacity === "0.5")).toBe(true)
    expect(result.second.every((item) => !item.disabled && item.opacity === "")).toBe(true)
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("renderMarkdown drops unsafe markdown URLs", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => {
      try {
        return typeof window.eval("renderMarkdown") === "function"
      } catch {
        return false
      }
    })

    const result = await tab.evaluate(() => {
      const renderMarkdown = window.eval("renderMarkdown")
      const root = document.createElement("div")
      root.innerHTML = renderMarkdown(
        "[bad](javascript:alert(1)) ![img](javascript:alert(1)) [good](https://example.com/path?q=1)",
      )
      return {
        links: [...root.querySelectorAll("a")].map((item) => item.getAttribute("href")),
        images: [...root.querySelectorAll("img")].map((item) => item.getAttribute("src")),
        text: root.textContent || "",
      }
    })

    expect(result.links).toEqual(["https://example.com/path?q=1"])
    expect(result.images).toEqual([])
    expect(result.text).toContain("bad")
    expect(result.text).toContain("good")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("automatic permission replies default to once and honor always", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => typeof (window as typeof window & { createOverlayInteractions?: unknown }).createOverlayInteractions === "function")

    const result = await tab.evaluate(async () => {
      const escape = (value: unknown) => String(value ?? "")
      async function run(reply?: "always") {
        const calls: Array<{ reply?: string }> = []
        const goalsBody = document.createElement("div")
        document.body.appendChild(goalsBody)
        const helper = (window as typeof window & {
          createOverlayInteractions: (deps: Record<string, unknown>) => {
            renderInteractions: (items: unknown[]) => void
          }
        }).createOverlayInteractions({
          state: {
            autoPermissionReply: reply,
          },
          dom: {
            goalsBody,
          },
          document,
          escapeHtml: escape,
          renderMarkdown: escape,
          t: (key: string) => key,
          record: (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value),
          apiJson: async (_path: string, input?: { body?: string }) => {
            calls.push(JSON.parse(String(input?.body || "{}")))
            return {}
          },
          nativePrompt: async () => null,
          loadBoard: async () => undefined,
          AppLog: {
            error() {},
            warn() {},
          },
        })

        helper.renderInteractions([{
          id: `permission-${reply || "once"}`,
          type: "permission",
          status: "pending",
          title: "permission",
          body: "permission",
        }])
        await new Promise((resolve) => setTimeout(resolve, 0))
        goalsBody.remove()
        return calls[0]?.reply || null
      }

      return {
        fallback: await run(),
        always: await run("always"),
      }
    })

    expect(result.fallback).toBe("once")
    expect(result.always).toBe("always")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })

test("interaction errors release busy before board reload settles", async () => {
  const exe = await browser()
  const server = serve()
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" })
    await tab.waitForFunction(() => typeof (window as typeof window & { createOverlayInteractions?: unknown }).createOverlayInteractions === "function")

    const result = await tab.evaluate(async () => {
      const escape = (value: unknown) => String(value ?? "")
      const goalsBody = document.createElement("div")
      document.body.appendChild(goalsBody)
      let done = () => undefined
      const helper = (window as typeof window & {
        createOverlayInteractions: (deps: Record<string, unknown>) => {
          renderInteractions: (items: unknown[]) => void
          resolveInteraction: (id: string, action: string, input?: Record<string, unknown>) => Promise<void>
          isInteractionBusy: () => boolean
        }
      }).createOverlayInteractions({
        state: {
          autoPermission: false,
          autoQuestion: false,
        },
        dom: {
          goalsBody,
        },
        document,
        escapeHtml: escape,
        renderMarkdown: escape,
        t: (key: string, vars?: Record<string, string>) => {
          if (key === "interaction.processing_suffix") return " (processing)"
          if (key === "interaction.error") return `error:${vars?.message || ""}`
          return key
        },
        record: (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value),
        apiJson: async () => {
          throw new Error("reply failed")
        },
        nativePrompt: async () => null,
        loadBoard: () => new Promise((resolve) => {
          done = resolve as () => void
        }),
        AppLog: {
          error() {},
          warn() {},
        },
      })

      helper.renderInteractions([{
        id: "first",
        type: "permission",
        status: "pending",
        title: "first",
        body: "first",
      }])

      const wait = helper.resolveInteraction("first", "always")
      await Promise.resolve()

      const during = {
        busy: helper.isInteractionBusy(),
        buttons: [...document.querySelectorAll('.interaction-alert[data-id="first"] button')].map((btn) => ({
          disabled: (btn as HTMLButtonElement).disabled,
          opacity: (btn as HTMLButtonElement).style.opacity,
        })),
        title: document.querySelector('.interaction-alert[data-id="first"] .interaction-title')?.textContent || "",
      }

      done()
      await wait

      return during
    })

    expect(result.busy).toBe(false)
    expect(result.buttons.every((item) => !item.disabled && item.opacity === "")).toBe(true)
    expect(result.title).toContain("error:reply failed")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 20_000 })
