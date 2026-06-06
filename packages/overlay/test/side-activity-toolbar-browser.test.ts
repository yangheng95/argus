import { expect, test } from "bun:test"
import { launchBrowser } from "./launch"
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist"

await ensureOverlayDist()

function route(url: URL) {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function send(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  })
}

test("side activity toolbar switches bound panels and survives collapse", async () => {
  const server = Bun.serve({
    idleTimeout: 255,
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
      if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
      if (path === "/vcs") return send({ branch: "dev", clean: true, dirty: false, staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0 })
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/config/providers") return send({ providers: [] })
      if (path === "/config") return send({ model: "" })
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/tui/runtime/status") return send({ running: false, mode: "none", url: null, sessionID: null })
      if (path === "/file") return send({ entries: [{ path: "src/main.tsx", name: "main.tsx", type: "file" }] })
      if (path === "/find/file") return send({ entries: [] })
      return send({})
    },
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument((portValue) => {
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_server_url", `http://127.0.0.1:${portValue}`)
      localStorage.setItem("oc_right_panel_collapsed", "false")
    }, server.port)

    await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]')
    await page.waitForSelector('#solidRightActivityToolbar')
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]')

    const clickButton = async (selector: string) => {
      await page.$eval(selector, (node) => (node as HTMLButtonElement).click())
    }

    const activeState = async () => await page.evaluate(() => {
      const active = (selector: string) => document.querySelector<HTMLElement>(selector)?.dataset.active ?? ""
      const display = (selector: string) => getComputedStyle(document.querySelector<HTMLElement>(selector)!).display
      return {
        leftTasks: active("#leftPanelTasks"),
        leftExplorer: active("#leftPanelExplorer"),
        leftChanges: active("#leftPanelChanges"),
        rightInspector: active("#rightPanelInspector"),
        chatConversation: active("#chatMessagePane"),
        chatPreview: active("#chatBrowserPreviewPane"),
        leftToolbarDisplay: display("#solidLeftActivityToolbar"),
        rightToolbarDisplay: display("#solidRightActivityToolbar"),
        rightActivityButtons: document.querySelectorAll('[data-ui="side-activity-button"][data-side="right"]').length,
        rightTuiButton: document.querySelector<HTMLElement>('[data-ui="side-activity-button"][data-side="right"][data-activity="tui"]')?.dataset.active ?? "",
        rightPreviewButton: document.querySelector<HTMLElement>('[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]')?.dataset.active ?? "",
        rightInspectorButton: document.querySelector<HTMLElement>('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')?.dataset.active ?? "",
        chatTitle: document.querySelector<HTMLElement>("#chatViewTitle")?.textContent ?? "",
        rightTitle: document.querySelector<HTMLElement>("#rightPanelTitle")?.textContent ?? "",
      }
    })

    expect(await activeState()).toMatchObject({
      leftTasks: "true",
      leftExplorer: "false",
      leftChanges: "false",
      rightInspector: "true",
      chatConversation: "true",
      chatPreview: "false",
      leftToolbarDisplay: "flex",
      rightToolbarDisplay: "flex",
      rightActivityButtons: 3,
      rightTuiButton: "false",
      rightPreviewButton: "false",
      rightInspectorButton: "true",
      chatTitle: "Conversation",
      rightTitle: "Inspector",
    })
    await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="explorer"]')
    expect(await activeState()).toMatchObject({ leftTasks: "false", leftExplorer: "true", leftChanges: "false" })

    await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="changes"]')
    expect(await activeState()).toMatchObject({ leftTasks: "false", leftExplorer: "false", leftChanges: "true" })

    await clickButton('[data-ui="side-activity-button"][data-side="left"][data-activity="tasks"]')
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("acceptance:focus-changes")))
    expect(await activeState()).toMatchObject({ leftTasks: "false", leftExplorer: "false", leftChanges: "true" })

    await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="browser"]')
    expect(await activeState()).toMatchObject({
      chatConversation: "false",
      chatPreview: "true",
      rightPreviewButton: "true",
      rightInspectorButton: "false",
      rightInspector: "true",
      chatTitle: "Preview",
      rightTitle: "Inspector",
    })

    await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="tui"]')
    expect(await activeState()).toMatchObject({
      chatConversation: "false",
      chatPreview: "false",
      rightTuiButton: "true",
      rightPreviewButton: "false",
      chatTitle: "TUI",
    })

    await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')
    expect(await activeState()).toMatchObject({
      chatConversation: "true",
      chatPreview: "false",
      rightInspectorButton: "true",
      chatTitle: "Conversation",
    })

    await clickButton('[data-ui="sidebar-header-collapse-toggle"]')
    await clickButton('[data-ui="right-panel-header-collapse-toggle"]')
    const collapsed = await page.evaluate(() => {
      const measure = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector)
        if (!node) throw new Error(`Missing ${selector}`)
        const style = getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        return { display: style.display, width: Math.round(rect.width), height: Math.round(rect.height) }
      }
      return {
        sidebar: measure("#sidebar"),
        sections: measure("#sections"),
        leftToolbar: measure("#solidLeftActivityToolbar"),
        rightToolbar: measure("#solidRightActivityToolbar"),
        leftContent: measure("#sidebar .side-panel-content"),
        rightContent: measure("#sections .side-panel-content"),
      }
    })

    expect(collapsed.sidebar.width).toBeLessThanOrEqual(48)
    expect(collapsed.sections.width).toBeLessThanOrEqual(48)
    expect(collapsed.leftToolbar.display).toBe("flex")
    expect(collapsed.rightToolbar.display).toBe("flex")
    expect(collapsed.leftToolbar.height).toBeGreaterThan(300)
    expect(collapsed.rightToolbar.height).toBeGreaterThan(300)
    expect(collapsed.leftContent.display).toBe("none")
    expect(collapsed.rightContent.display).toBe("none")

    await clickButton('[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]')
    await page.waitForFunction(() => localStorage.getItem("oc_right_panel_collapsed") === "false")
    const reopened = await page.evaluate(() => {
      const sections = document.querySelector<HTMLElement>("#sections")
      const content = document.querySelector<HTMLElement>("#sections .side-panel-content")
      const inspectorButton = document.querySelector<HTMLElement>(
        '[data-ui="side-activity-button"][data-side="right"][data-activity="inspector"]',
      )
      if (!sections || !content || !inspectorButton) throw new Error("Missing right panel activity nodes")
      return {
        collapsed: sections.dataset.collapsed || "",
        contentDisplay: getComputedStyle(content).display,
        sectionsWidth: Math.round(sections.getBoundingClientRect().width),
        inspectorButtonActive: inspectorButton.dataset.active || "",
        persisted: localStorage.getItem("oc_right_panel_collapsed") || "",
      }
    })
    expect(reopened).toMatchObject({
      collapsed: "false",
      contentDisplay: "flex",
      inspectorButtonActive: "true",
      persisted: "false",
    })
    expect(reopened.sectionsWidth).toBeGreaterThan(300)
  } finally {
    await browser.close()
    server.stop(true)
  }
}, { timeout: 60_000 })
