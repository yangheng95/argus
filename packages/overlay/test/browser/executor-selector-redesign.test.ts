// Playwright-driven behavioral test for the dual-chip executor bar.
//
//   - Two chips (OpenCorvus + external) render side-by-side under the
//     composer.
//   - Clicking OpenCorvus opens its popover; only connected providers'
//     models appear.
//   - Clicking External opens its popover; all configured providers for
//     the active executor appear, but provider auth is not presented as
//     executor connectivity.
//   - Opening one popover closes the other.
//   - Wide popovers stay attached to their trigger while Kobalte keeps
//     them inside compact one-row composer viewports.

import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")

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

async function saveScreenshot(page: { screenshot(options?: Record<string, unknown>): Promise<Buffer> }, name: string) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  await writeFile(target, await page.screenshot({ fullPage: false }))
  return target
}

test(
  "dual executor chip — mirror vs external popovers with availability",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const projectModel = "hexin/kimi-k2.7-code"
    const codexModel = "gpt-5.5-codex"
    let budgetRequests = 0
    const promptProfileCatalog = {
      active: "frontend",
      project_active: "frontend",
      session_active: null,
      default: "general",
      targets: [],
      profiles: [
        {
          id: "general",
          label: "General",
          description: "Baseline prompt set.",
          built_in: true,
          editable: false,
          agents: {},
        },
        {
          id: "frontend",
          label: "Frontend",
          description: "Visual UI verification squad.",
          built_in: true,
          editable: false,
          agents: {},
        },
      ],
    }

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/" || path === "/ui" || path === "/ui/") {
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      }
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
      if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
      if (path === "/vcs") {
        return send({
          branch: "dev",
          clean: true,
          dirty: false,
          staged: 0,
          modified: 0,
          untracked: 0,
          conflicts: 0,
          ahead: 0,
          behind: 0,
        })
      }
      if (path === "/provider") {
        // openai and hexin are connected; anthropic is configured but NOT
        // connected. OpenCorvus should hide anthropic, while the external
        // Claude Code tab still lists anthropic models without mislabeling
        // Claude Code itself as disconnected.
        return send({
          all: [
            {
              id: "hexin",
              name: "Hexin OpenAI Gateway",
              models: {
                "kimi-k2.7-code": { id: "kimi-k2.7-code" },
              },
            },
            {
              id: "openai",
              name: "OpenAI",
              models: {
                "gpt-5.5-pro": { id: "gpt-5.5-pro" },
                "gpt-5.5-codex": { id: "gpt-5.5-codex" },
              },
            },
            {
              id: "anthropic",
              name: "Anthropic",
              models: {
                "claude-sonnet-4-6": { id: "claude-sonnet-4-6" },
              },
            },
          ],
          connected: ["hexin", "openai"],
          default: { openai: "gpt-5.5-pro" },
        })
      }
      if (path === "/provider/hexin/budget") {
        budgetRequests++
        return send({
          ok: true,
          budget: {
            maxBudget: 4435.3,
            spend: 4415.312612080029,
            remaining: 19.9873879199713,
            overBudget: false,
          },
        })
      }
      if (path === "/provider/auth") return send({})
      if (path === "/config/providers") {
        return send({ providers: [], default: {} })
      }
      if (path === "/config" && req.method === "GET") {
        return send({ model: projectModel })
      }
      if (path === "/config" && req.method === "PATCH") {
        return send(await req.json())
      }
      if (path === "/config/prompt") return send([])
      if (path === "/config/prompt-profile") return send(promptProfileCatalog)
      if (path === "/mission") return send([])
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") {
        return send([
          { id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true },
          { id: "codex", label: "Codex", selectable: true, discovered: true, model: codexModel },
          { id: "claude-code", label: "Claude Code", selectable: true, discovered: true },
        ])
      }
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      if (path.startsWith("/executor/") && path.endsWith("/model")) return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const pageErrors: string[] = []
      page.on("requestfailed", (payload) => {
        const item = payload as { url?: string; errorText?: string }
        pageErrors.push(`requestfailed: ${item.url || ""} ${item.errorText || ""}`.trim())
      })
      page.on("response", (payload) => {
        const item = payload as { url?: string; status?: number }
        if (typeof item.status === "number" && item.status >= 400) {
          pageErrors.push(`response${item.status}: ${item.url || ""}`)
        }
      })
      page.on("console", (payload) => {
        const item = payload as { type?: string; text?: string }
        if (item.type === "error") pageErrors.push(`console: ${item.text || ""}`)
      })
      await page.setViewport({ width: 960, height: 720 })
      await page.evaluateOnNewDocument((serverUrl) => {
        ;(window as any).__OPENCORVUS_LOCALE__ = "en-US"
        localStorage.setItem("oc_locale", "en-US")
        window.__TAURI__ = {
          core: {
            invoke: async (command: string) => {
              if (command === "overlay_settings_load") {
                return {
                  serverUrl,
                  autoServer: false,
                  locale: "en-US",
                  directory: "D:/overlay/workspace/app",
                  executor: "codex",
                }
              }
              if (command === "overlay_settings_save") return true
              if (command === "overlay_create_temp_dir") return "D:/overlay/temp"
              return null
            },
          },
          window: {
            getCurrentWindow() {
              return {
                close: async () => undefined,
                hide: async () => undefined,
                minimize: async () => undefined,
                startDragging: async () => undefined,
                isMaximized: async () => false,
                onResized: async () => ({ unlisten: async () => undefined }),
              }
            },
          },
        }
      }, server.origin)

      try {
        await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
      } catch (error) {
        assert.fail(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(pageErrors, null, 2)}`)
      }
      await page.waitForSelector('[data-ui="executor-chip-mirror"]')
      await page.waitForSelector('[data-ui="executor-chip-external"]')
      await page.waitForFunction(() =>
        (document.querySelector('[data-ui="executor-chip-mirror"]') as HTMLElement | null)?.innerText.includes(
          "kimi-k2.7-code",
        ),
      )
      await page.waitForSelector('[data-ui="executor-hexin-budget"]')
      await page.waitForFunction(() =>
        (document.querySelector('[data-ui="executor-hexin-budget"]') as HTMLElement | null)?.innerText.includes(
          "19.99",
        ),
      )
      assert.equal(budgetRequests, 1)

      // Both chips share one bar that spans the composer row.
      const layout = await page.evaluate(() => {
        const bar = document.querySelector('[data-ui="executor-dualbar"]') as HTMLElement | null
        const mirror = document.querySelector('[data-ui="executor-chip-mirror"]') as HTMLElement | null
        const external = document.querySelector('[data-ui="executor-chip-external"]') as HTMLElement | null
        return {
          barLeft: bar ? bar.getBoundingClientRect().left : 0,
          barRight: bar ? bar.getBoundingClientRect().right : 0,
          barWidth: bar ? bar.getBoundingClientRect().width : 0,
          mirrorLeft: mirror ? mirror.getBoundingClientRect().left : 0,
          mirrorRight: mirror ? mirror.getBoundingClientRect().right : 0,
          externalLeft: external ? external.getBoundingClientRect().left : 0,
          externalRight: external ? external.getBoundingClientRect().right : 0,
          mirrorText: mirror?.innerText ?? "",
          externalText: external?.innerText ?? "",
        }
      })
      assert.ok(layout.barLeft <= layout.mirrorLeft + 1, JSON.stringify(layout))
      assert.ok(layout.barRight >= layout.externalRight - 1, JSON.stringify(layout))
      assert.ok(layout.externalLeft > layout.mirrorRight - 1, JSON.stringify(layout))
      assert.ok(layout.mirrorText.includes("OpenCorvus"))
      assert.ok(layout.mirrorText.includes("kimi-k2.7-code"))
      assert.ok(layout.externalText.includes("Codex"))
      assert.ok(layout.externalText.includes("gpt-5.5-codex"))
      const budgetLayout = await page.evaluate(() => {
        const budget = document.querySelector('[data-ui="executor-hexin-budget"]') as HTMLElement | null
        const value = budget?.querySelector(".executor-budget-value") as HTMLElement | null
        const mirrorSlot = document.querySelector('[data-side="mirror"]') as HTMLElement | null
        const externalSlot = document.querySelector('[data-side="external"]') as HTMLElement | null
        const promptProfile = document.querySelector('[data-ui="prompt-profile-selector"]') as HTMLElement | null
        const meta = document.querySelector(".chat-compose-meta-left") as HTMLElement | null
        const budgetRect = budget?.getBoundingClientRect()
        const mirrorRect = mirrorSlot?.getBoundingClientRect()
        const externalRect = externalSlot?.getBoundingClientRect()
        const promptRect = promptProfile?.getBoundingClientRect()
        const metaRect = meta?.getBoundingClientRect()
        const color = value ? getComputedStyle(value).color : ""
        return {
          role: budget?.getAttribute("role") ?? "",
          live: budget?.getAttribute("aria-live") ?? "",
          low: budget?.dataset.lowBudget ?? "",
          parentSide: budget?.closest("[data-side]")?.getAttribute("data-side") ?? "",
          budgetLeft: budgetRect?.left ?? 0,
          budgetRight: budgetRect?.right ?? 0,
          mirrorLeft: mirrorRect?.left ?? 0,
          mirrorRight: mirrorRect?.right ?? 0,
          mirrorTop: mirrorRect?.top ?? 0,
          externalLeft: externalRect?.left ?? 0,
          externalTop: externalRect?.top ?? 0,
          promptTop: promptRect?.top ?? 0,
          metaHeight: metaRect?.height ?? 0,
          color,
        }
      })
      assert.equal(budgetLayout.role, "status")
      assert.equal(budgetLayout.live, "polite")
      assert.equal(budgetLayout.low, "true")
      assert.equal(budgetLayout.parentSide, "mirror")
      assert.ok(budgetLayout.budgetLeft >= budgetLayout.mirrorLeft - 1, JSON.stringify(budgetLayout))
      assert.ok(budgetLayout.budgetRight <= budgetLayout.mirrorRight + 1, JSON.stringify(budgetLayout))
      assert.ok(budgetLayout.budgetRight < budgetLayout.externalLeft - 1, JSON.stringify(budgetLayout))
      assert.ok(Math.abs(budgetLayout.promptTop - budgetLayout.mirrorTop) <= 1, JSON.stringify(budgetLayout))
      assert.ok(Math.abs(budgetLayout.externalTop - budgetLayout.mirrorTop) <= 1, JSON.stringify(budgetLayout))
      assert.ok(budgetLayout.metaHeight < 48, JSON.stringify(budgetLayout))
      const colorMatch = budgetLayout.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      assert.notEqual(colorMatch, null, budgetLayout.color)
      assert.ok(Number(colorMatch![1]) > Number(colorMatch![2]), budgetLayout.color)
      assert.ok(Number(colorMatch![1]) > Number(colorMatch![3]), budgetLayout.color)

      // Mirror popover: opens above the left chip and lists only connected
      // providers (openai). Anthropic stays hidden because it isn't connected.
      // innerText reflects text-transform; provider group headers are uppercased
      // for the picker, so we match case-insensitively.
      await page.click('[data-ui="executor-chip-mirror"]')
      await page.waitForSelector('[data-section="mirror"]')
      await page.waitForFunction(() => {
        const body = document.querySelector('[data-section="mirror"]') as HTMLElement | null
        return body?.innerText.toLowerCase().includes("openai") ?? false
      })
      const mirrorBody = (
        await page.$eval('[data-section="mirror"]', (node) => (node as HTMLElement).innerText)
      ).toLowerCase()
      assert.ok(mirrorBody.includes("openai"))
      assert.ok(mirrorBody.includes("hexin"))
      assert.equal(mirrorBody.includes("anthropic"), false)
      assert.ok(mirrorBody.includes("gpt-5.5-pro"))
      assert.ok(mirrorBody.includes("gpt-5.5-codex"))
      assert.ok(mirrorBody.includes("kimi-k2.7-code"))
      const mirrorPlacement = await page.evaluate(() => {
        const slot = document.querySelector('[data-side="mirror"]') as HTMLElement | null
        const trigger = document.querySelector('[data-ui="executor-chip-mirror"]') as HTMLElement | null
        const popover = document.querySelector('[data-section="mirror"]') as HTMLElement | null
        const header = popover?.querySelector(".executor-popover-header") as HTMLElement | null
        if (!slot || !trigger || !popover || !header) return null
        const slotRect = slot.getBoundingClientRect()
        const triggerRect = trigger.getBoundingClientRect()
        const popoverRect = popover.getBoundingClientRect()
        const headerRect = header.getBoundingClientRect()
        const style = getComputedStyle(popover)
        return {
          slotLeft: slotRect.left,
          slotRight: slotRect.right,
          triggerLeft: triggerRect.left,
          triggerRight: triggerRect.right,
          popoverLeft: popoverRect.left,
          popoverRight: popoverRect.right,
          headerLeft: headerRect.left,
          viewportWidth: window.innerWidth,
          inlineStyle: popover.getAttribute("style") || "",
          position: style.position,
          left: style.left,
          transform: style.transform,
        }
      })
      assert.notEqual(mirrorPlacement, null)
      assert.notEqual(mirrorPlacement!.position, "static", JSON.stringify(mirrorPlacement))
      assert.ok(mirrorPlacement!.popoverLeft >= 0, JSON.stringify(mirrorPlacement))
      assert.ok(mirrorPlacement!.headerLeft >= mirrorPlacement!.popoverLeft, JSON.stringify(mirrorPlacement))
      assert.ok(mirrorPlacement!.popoverRight <= mirrorPlacement!.viewportWidth + 1, JSON.stringify(mirrorPlacement))
      assert.ok(mirrorPlacement!.popoverLeft <= mirrorPlacement!.triggerLeft + 1, JSON.stringify(mirrorPlacement))
      assert.ok(mirrorPlacement!.popoverRight >= mirrorPlacement!.triggerRight - 1, JSON.stringify(mirrorPlacement))
      const mirrorModelState = await page.evaluate(() => {
        const current = document.querySelector(
          '[data-section="mirror"] .executor-popover-model[title="hexin/kimi-k2.7-code"]',
        ) as HTMLElement | null
        const inactive = document.querySelector(
          '[data-section="mirror"] .executor-popover-model[title="openai/gpt-5.5-pro"]',
        ) as HTMLElement | null
        return {
          currentActive: current?.dataset.active ?? "",
          currentAria: current?.getAttribute("aria-current") ?? "",
          inactiveActive: inactive?.dataset.active ?? "",
          inactiveAria: inactive?.getAttribute("aria-current") ?? "",
        }
      })
      assert.deepEqual(mirrorModelState, {
        currentActive: "true",
        currentAria: "true",
        inactiveActive: "false",
        inactiveAria: "",
      })
      const visibleErrorNotifications = await page.$$eval(".app-notification[data-tone=\"error\"]", (nodes) =>
        nodes.map((node) => (node as HTMLElement).innerText.trim()),
      )
      assert.deepEqual(visibleErrorNotifications, [])
      await saveScreenshot(page, "executor-selector-current-model-aria.png")

      await page.click('[data-section="mirror"] .executor-popover-model[title="openai/gpt-5.5-pro"]')
      await page.waitForFunction(() =>
        (document.querySelector('[data-ui="executor-chip-mirror"]') as HTMLElement | null)?.innerText.includes(
          "gpt-5.5-pro",
        ),
      )
      await page.waitForFunction(() => document.querySelector('[data-ui="executor-hexin-budget"]') === null)
      assert.equal(budgetRequests, 1)
      await page.click('[data-ui="executor-chip-mirror"]')
      await page.waitForSelector('[data-section="mirror"]')
      // The external popover should NOT be open while the mirror popover is.
      assert.equal(await page.$('[data-section="external"]'), null)

      // Clicking the external chip closes the mirror popover and opens its own.
      const externalChipSelector = '[data-ui="executor-chip-external"]'
      await page.waitForSelector(externalChipSelector, { visible: true })
      const externalChipHitTest = await page.$eval(externalChipSelector, (node: HTMLElement, selector) => {
        const rect = node.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        return hit?.closest(String(selector)) === node
      }, externalChipSelector)
      assert.equal(externalChipHitTest, true)
      await page.click(externalChipSelector)
      await page.waitForSelector('[data-section="external"]')
      assert.equal(await page.$('[data-section="mirror"]'), null)

      // External popover defaults to the active executor (codex).
      await page.waitForFunction(() => {
        const body = document.querySelector('[data-section="external"]') as HTMLElement | null
        return body?.innerText.toLowerCase().includes("openai") ?? false
      })
      const externalTabState = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-section="external"] [data-ui="executor-popover-tab"]')).map(
          (node) => ({
            text: (node as HTMLElement).innerText.trim(),
            role: node.getAttribute("role") ?? "",
            active: (node as HTMLElement).dataset.active ?? "",
            selected: node.getAttribute("aria-selected") ?? "",
          }),
        ),
      )
      assert.deepEqual(
        externalTabState.map((row) => ({
          text: row.text,
          role: row.role,
          active: row.active,
          selected: row.selected,
        })),
        [
          { text: "None", role: "tab", active: "false", selected: "false" },
          { text: "Codex", role: "tab", active: "true", selected: "true" },
          { text: "Claude Code", role: "tab", active: "false", selected: "false" },
        ],
      )
      const externalModelState = await page.evaluate(() => {
        const current = document.querySelector(
          '[data-section="external"] .executor-popover-model[title="gpt-5.5-codex"]',
        ) as HTMLElement | null
        const inactive = document.querySelector(
          '[data-section="external"] .executor-popover-model[title="gpt-5.5-pro"]',
        ) as HTMLElement | null
        return {
          currentActive: current?.dataset.active ?? "",
          currentAria: current?.getAttribute("aria-current") ?? "",
          inactiveActive: inactive?.dataset.active ?? "",
          inactiveAria: inactive?.getAttribute("aria-current") ?? "",
        }
      })
      assert.deepEqual(externalModelState, {
        currentActive: "true",
        currentAria: "true",
        inactiveActive: "false",
        inactiveAria: "",
      })
      const externalBody = (
        await page.$eval('[data-section="external"]', (node) => (node as HTMLElement).innerText)
      ).toLowerCase()
      assert.ok(externalBody.includes("openai"))
      assert.ok(externalBody.includes("gpt-5.5-codex"))

      // Switching the focused tab to Claude Code should list anthropic models
      // without inheriting overlay provider-auth wording.
      const claudeTab = await page.$$eval(
        '[data-section="external"] [data-ui="executor-popover-tab"]',
        (nodes) =>
          nodes
            .map((node, index) => ({ index, text: (node as HTMLElement).innerText.trim() }))
            .find((row) => row.text === "Claude Code")?.index ?? -1,
      )
      assert.ok(claudeTab >= 0)
      const tabHandles = await page.$$('[data-section="external"] [data-ui="executor-popover-tab"]')
      await tabHandles[claudeTab]!.click()
      await page.waitForFunction(() => {
        const body = document.querySelector('[data-section="external"]') as HTMLElement | null
        return body?.innerText.toLowerCase().includes("anthropic") ?? false
      })
      const claudeTabState = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-section="external"] [data-ui="executor-popover-tab"]')).map(
          (node) => ({
            text: (node as HTMLElement).innerText.trim(),
            active: (node as HTMLElement).dataset.active ?? "",
            selected: node.getAttribute("aria-selected") ?? "",
          }),
        ),
      )
      assert.deepEqual(
        claudeTabState.map((row) => ({
          text: row.text,
          active: row.active,
          selected: row.selected,
        })),
        [
          { text: "None", active: "false", selected: "false" },
          { text: "Codex", active: "false", selected: "false" },
          { text: "Claude Code", active: "true", selected: "true" },
        ],
      )
      const claudeBody = (
        await page.$eval('[data-section="external"]', (node) => (node as HTMLElement).innerText)
      ).toLowerCase()
      assert.ok(claudeBody.includes("anthropic"))
      assert.ok(claudeBody.includes("claude-sonnet-4-6"))
      assert.equal(claudeBody.includes("not connected"), false)
      const placement = await page.evaluate(() => {
        const slot = document.querySelector('[data-side="external"]') as HTMLElement | null
        const trigger = document.querySelector('[data-ui="executor-chip-external"]') as HTMLElement | null
        const popover = document.querySelector('[data-section="external"]') as HTMLElement | null
        if (!slot || !popover) return null
        const slotRect = slot.getBoundingClientRect()
        const triggerRect = trigger?.getBoundingClientRect()
        const popoverRect = popover.getBoundingClientRect()
        const style = getComputedStyle(popover)
        return {
          slotLeft: slotRect.left,
          slotRight: slotRect.right,
          triggerLeft: triggerRect?.left ?? 0,
          triggerRight: triggerRect?.right ?? 0,
          popoverLeft: popoverRect.left,
          popoverRight: popoverRect.right,
          viewportWidth: window.innerWidth,
          inlineStyle: popover.getAttribute("style") || "",
          position: style.position,
          left: style.left,
          transform: style.transform,
        }
      })
      assert.notEqual(placement, null)
      assert.notEqual(placement!.position, "static", JSON.stringify(placement))
      assert.ok(placement!.popoverLeft >= 0, JSON.stringify(placement))
      assert.ok(placement!.popoverRight <= placement!.viewportWidth + 1, JSON.stringify(placement))
      assert.ok(placement!.popoverLeft <= placement!.triggerLeft + 1, JSON.stringify(placement))
      assert.ok(placement!.popoverRight >= placement!.triggerRight - 1, JSON.stringify(placement))
      assert.deepEqual(pageErrors, [])
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)
