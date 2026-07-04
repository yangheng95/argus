import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { generalExpertSquadCatalog } from "./expert-squad-fixture.ts"

await ensureOverlayDist()

function route(url: URL): string {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function send(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

function taskItem(): any {
  const created = 1_776_300_001_000
  return {
    updated_at: created + 1,
    pending_interactions: 0,
    overview: { headline: "Card metadata tooltip task", summary: "Card metadata tooltip task" },
    task: {
      id: "task-card-meta-tooltip",
      requestID: "req-card-meta-tooltip",
      title: "Card metadata tooltip task",
      request: "Render assistant metadata chips.",
      directory: "D:/card-meta/workspace",
      status: "active",
      sessionID: "session-card-meta-root",
      time: { created, updated: created + 1 },
    },
  }
}

function boardForTask(item: any): any {
  return {
    task: item.task,
    overview: item.overview,
    goalWorkflows: [],
    interactions: [],
    lastSequence: 1,
    snapshotVersion: `snapshot-${item.task.id}`,
  }
}

function transcript(): any[] {
  return [
    {
      info: {
        id: "message-card-meta-assistant",
        sessionID: "session-card-meta-root",
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        channel: "assistant",
        providerID: "openai",
        modelID: "gpt-5.5-card-metadata-long-name",
        tokens: { input: 12345, output: 678, reasoning: 0, total: 13023, cache: { read: 0, write: 0 } },
        cost: 0.0421,
        time: { created: 1_776_300_001_100 },
      },
      parts: [
        {
          id: "part-card-meta-assistant",
          messageID: "message-card-meta-assistant",
          sessionID: "session-card-meta-root",
          type: "text",
          text: "Metadata chip visual fixture.",
        },
      ],
    },
  ]
}

async function installOverlaySettings(page: any, serverUrl: string): Promise<void> {
  await page.evaluateOnNewDocument((origin) => {
    localStorage.setItem("oc_locale", "en-US")
    localStorage.setItem("oc_theme", "light")
    localStorage.setItem("oc_server_url", origin)
    localStorage.setItem("oc_auto_server", "false")
    localStorage.setItem("oc_directory", "D:/card-meta/workspace")
    window.__TAURI__ = {
      core: {
        invoke: async (command: string) => {
          if (command === "overlay_settings_load") {
            return {
              serverUrl: origin,
              autoServer: false,
              locale: "en-US",
              directory: "D:/card-meta/workspace",
              directoryMode: "custom",
            }
          }
          if (command === "overlay_settings_save") return true
          if (command === "overlay_open_url") return true
          if (command === "overlay_open_path") return true
          return null
        },
      },
      window: {
        getCurrentWindow() {
          return {
            close: async () => true,
            hide: async () => true,
            minimize: async () => true,
            startDragging: async () => true,
            isMaximized: async () => false,
            onResized: async () => ({ unlisten: async () => undefined }),
          }
        },
      },
    }
  }, serverUrl)
}

test(
  "card metadata chips expose focusable Kobalte tooltip details",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const item = taskItem()
    const messages = transcript()
    const badResponses: string[] = []
    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/" || path === "/ui" || path === "/ui/")
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "card-meta-tooltip-test" })
      if (path === "/global/projects/discover") return send([])
      if (path === "/global/tasks") return send({ tasks: [item] })
      if (path === "/mission") return send([])
      if (path === "/executor") return send([])
      if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
      if (path === "/project/current/worktrees") return send([])
      if (path === "/path") return send({ directory: item.task.directory, exists: true, git: true })
      if (path === "/vcs") return send({ branch: "visual", clean: true, dirty: false })
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config") {
        return send({
          server: {},
          provider: {},
          channel: {},
          mcp: {},
          model: "",
          directory: item.task.directory,
          version: "card-meta-tooltip-test",
        })
      }
      if (path === "/config/prompt" || path === "/expert-squad/catalog") {
        return send(generalExpertSquadCatalog())
      }
      if (path === "/channel") return send([])
      if (path === "/channel/runtime") return send({ status: "disabled", channels: [] })
      if (path === "/gateway/stats") return send({ active: 0, queued: 0, completed: 0, failed: 0 })
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/skill/directories") {
        return send({
          global_config: "D:/card-meta/config",
          managed_skills: "D:/card-meta/config/skills-market",
          remote_cache: "D:/card-meta/cache",
        })
      }
      if (path === "/skill/market") return send([])
      if (path === "/mcp") return send({})
      if (path === "/agent") return send([])
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log") return req.method === "POST" ? send({ ok: true }) : send([])
      if (/^\/session\/[^/]+\/config$/.test(path)) return send({})
      if (/^\/task\/[^/]+\/operator-model-context$/.test(path)) {
        return send({
          taskID: item.task.id,
          sessionID: item.task.sessionID,
          agent: "orchestrator",
          model: { providerID: "openai", modelID: "gpt-5.5-card-metadata-long-name" },
        })
      }
      if (/^\/task\/[^/]+\/browser-preview$/.test(path)) {
        return send({
          taskID: item.task.id,
          kind: "missing",
          status: "missing",
          projectRoot: item.task.directory,
          viewports: [],
          diagnostics: [],
          candidates: [],
          source: "none",
        })
      }
      if (/^\/task\/[^/]+\/followup$/.test(path)) return send({ followup: null })
      if (/^\/task\/[^/]+\/conversation$/.test(path)) {
        return send({
          board: boardForTask(item),
          transcript: messages,
          timeline: messages,
          events: [],
          view: { sessions: [{ sessionID: item.task.sessionID, stage: "assistant" }] },
          agentView: { sessions: [{ sessionID: item.task.sessionID, stage: "assistant" }] },
          eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
          history: { hasMore: false, oldestTimestamp: null, oldestMessageID: null, limit: 160 },
          messageWatermark: 0,
          lastSequence: 0,
        })
      }
      if (/^\/task\/[^/]+\/board$/.test(path)) return send(boardForTask(item))
      if (/^\/task\/[^/]+\/transcript$/.test(path)) return send(messages)
      if (path === "/task/events" || /^\/task\/[^/]+\/events$/.test(path)) {
        return new Response(":\n\n", {
          headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
        })
      }
      return send({ error: `unhandled ${req.method} ${path}` }, 404)
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      page.on("response", (response: any) => {
        if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
      })
      await page.setViewport({ width: 1280, height: 760 })
      await installOverlaySettings(page, server.origin)
      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
      await page.waitForFunction(() => typeof (window as any).selectTask === "function")
      await page.evaluate(async (taskID: string) => {
        const selectTask = (window as any).selectTask
        if (typeof selectTask !== "function") throw new Error("window.selectTask is not available")
        await selectTask(taskID)
      }, item.task.id)
      await page.waitForSelector('[data-ui="card-usage-hint"]', { visible: true })

      const chipState = await page.$$eval(".card__meta-chip", (chips) =>
        chips.map((chip) => ({
          dataUi: (chip as HTMLElement).dataset.ui || "",
          tabIndex: (chip as HTMLElement).tabIndex,
          title: chip.getAttribute("title") || "",
          ariaLabel: chip.getAttribute("aria-label") || "",
          text: chip.textContent?.replace(/\s+/g, " ").trim() || "",
          tag: chip.tagName,
        })),
      )
      assert.deepEqual(chipState.map((chip) => chip.dataUi).sort(), [
        "card-model-hint",
        "card-token-hint",
        "card-usage-hint",
      ])
      for (const chip of chipState) {
        assert.equal(chip.tag, "SPAN")
        assert.equal(chip.tabIndex, 0)
        assert.equal(chip.title, chip.ariaLabel)
        assert.ok(!chip.ariaLabel.includes("{value}"), `metadata aria-label leaked a placeholder: ${chip.ariaLabel}`)
      }
      const usage = chipState.find((chip) => chip.dataUi === "card-usage-hint")
      assert.ok(usage)
      assert.match(usage.ariaLabel, /Input tokens: 12345/)
      assert.match(usage.ariaLabel, /Output tokens: 678/)
      assert.match(usage.ariaLabel, /Total tokens: 13023/)
      assert.match(usage.ariaLabel, /Cost: /)

      await page.focus('[data-ui="card-usage-hint"]')
      await page.waitForSelector(".card-meta-tooltip", { visible: true })
      const tooltip = await page.$eval(".card-meta-tooltip", (node: HTMLElement) => {
        const rect = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return {
          text: node.textContent?.replace(/\s+/g, " ").trim() || "",
          role: node.getAttribute("role"),
          width: rect.width,
          height: rect.height,
          background: style.backgroundColor,
          color: style.color,
        }
      })
      assert.equal(tooltip.role, "tooltip")
      assert.match(tooltip.text, /Usage for this assistant turn/)
      assert.ok(tooltip.width > 120 && tooltip.height > 12, `tooltip should be visible: ${JSON.stringify(tooltip)}`)
      assert.notEqual(tooltip.background, "rgba(0, 0, 0, 0)")
      assert.notEqual(tooltip.color, "rgba(0, 0, 0, 0)")

      const screenshotPath = resolve(".scratch", "card-header-metadata-tooltip-focus.png")
      mkdirSync(dirname(screenshotPath), { recursive: true })
      writeFileSync(screenshotPath, await page.screenshot({ fullPage: false }))
      await page.close()

      assert.deepEqual(badResponses, [])
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 120_000 },
)
