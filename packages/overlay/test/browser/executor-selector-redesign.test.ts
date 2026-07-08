// Playwright-driven behavioral test for the composer model selector.
//
//   - The active OpenCorvus model renders inside the composer capsule.
//   - Hexin remaining budget renders inside the same capsule when the selected
//     model uses the Hexin gateway.
//   - The popover lists connected OpenCorvus providers and keeps keyboard
//     model selection inside the current composer selector surface.

import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { expertSquadCatalogFixture } from "./expert-squad-fixture.ts"

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

function modelListboxSelector(section: "mirror" | "external", providerID: string): string {
  return `[data-section="${section}"] .executor-popover-group[data-provider-id="${providerID}"] .executor-model-listbox`
}

function modelOptionSelector(section: "mirror" | "external", modelValue: string): string {
  return `[data-section="${section}"] .executor-model-option[data-model-value="${modelValue}"]`
}

async function focusModelListbox(page: any, section: "mirror" | "external", providerID: string, modelValue: string) {
  const listboxSelector = modelListboxSelector(section, providerID)
  await page.waitForSelector(listboxSelector, { visible: true })
  await page.waitForSelector(modelOptionSelector(section, modelValue), { visible: true })
  await page.focus(listboxSelector)
  return listboxSelector
}

async function saveElementScreenshot(
  element: { screenshot(options?: Record<string, unknown>): Promise<Buffer> },
  name: string,
) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  const screenshot = await element.screenshot({})
  await writeFile(target, screenshot)
  return { target, screenshot }
}

async function readChipVisual(page: any, selector: string) {
  return page.$eval(selector, (node: HTMLElement) => {
    const styles = getComputedStyle(node)
    return {
      backgroundColor: styles.backgroundColor,
      boxShadow: styles.boxShadow,
      color: styles.color,
      focusVisible: node.matches(":focus-visible"),
      hover: node.matches(":hover"),
      outlineStyle: styles.outlineStyle,
      outlineWidth: styles.outlineWidth,
    }
  })
}

async function tabToSelector(page: any, selector: string) {
  await page.evaluate(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
  })
  for (let index = 0; index < 120; index += 1) {
    await page.keyboard.press("Tab")
    const state = await page.evaluate((targetSelector) => {
      const target = document.querySelector(targetSelector)
      const active = document.activeElement
      return {
        dataUi: active instanceof HTMLElement ? (active.dataset.ui ?? "") : "",
        focused: active === target,
        focusVisible: active instanceof HTMLElement ? active.matches(":focus-visible") : false,
        tagName: active?.tagName ?? "",
      }
    }, selector)
    if (state.focused) return state
  }
  throw new Error(`Unable to reach ${selector} with keyboard Tab`)
}

async function analyzeBudgetScreenshot(buffer: Buffer) {
  const image = sharp(buffer)
  const metadata = await image.metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  const raw = await image.ensureAlpha().raw().toBuffer()
  const buckets = new Set<number>()
  let nonTransparent = 0
  let nonWhite = 0
  let redDominant = 0
  for (let index = 0; index < raw.length; index += 4) {
    const red = raw[index]
    const green = raw[index + 1]
    const blue = raw[index + 2]
    const alpha = raw[index + 3]
    if (alpha < 16) continue
    nonTransparent += 1
    buckets.add(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4))
    if (Math.max(red, green, blue) < 250) nonWhite += 1
    if (red > green + 20 && red > blue + 20 && red > 120) redDominant += 1
  }
  return { width, height, nonTransparent, nonWhite, redDominant, uniqueColorBuckets: buckets.size }
}

test(
  "composer model selector renders Hexin budget and connected provider picker",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const projectModel = "hexin/kimi-k2.7-code"
    const codexModel = "gpt-5.5-codex"
    let hexinApiKeySaveCount = 0
    const budgetRequests: Array<{ directory: string; remaining: number }> = []
    const expertSquadCatalog = expertSquadCatalogFixture({
      active: "frontend-replica",
      projectActive: "frontend-replica",
      squads: [
        {
          id: "general",
          label: "General",
          description: "Baseline prompt set.",
          built_in: true,
        },
        {
          id: "frontend-replica",
          label: "Frontend Replica",
          description: "Visual UI verification squad.",
          built_in: false,
        },
      ],
    })

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
      if (path === "/global/tasks") return send({ tasks: [] })
      if (path === "/work-ledger") return send({ rows: [], nextCursor: null })
      if (path === "/work-ledger/events" || path === "/task/events") {
        return new Response("", {
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        })
      }
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
        const directory = url.searchParams.get("directory") ?? ""
        const remaining = hexinApiKeySaveCount > 0 ? 16.5 : directory.endsWith("/next") ? 18.75 : 19.9873879199713
        budgetRequests.push({ directory, remaining })
        return send({
          ok: true,
          budget: {
            maxBudget: 4435.3,
            spend: 4415.312612080029,
            remaining,
            overBudget: false,
          },
        })
      }
      if (path === "/provider/auth") {
        return send({
          hexin: [
            {
              type: "api",
              label: hexinApiKeySaveCount > 0 ? `API key saved ${hexinApiKeySaveCount}` : "API key",
            },
          ],
        })
      }
      if (path === "/auth/hexin" && req.method === "PUT") {
        const body = (await req.json()) as { key?: unknown }
        assert.equal(typeof body.key, "string")
        hexinApiKeySaveCount += 1
        return send(true)
      }
      if (path === "/provider/hexin/refresh" && req.method === "POST") {
        return send({
          ok: true,
          count: 1,
          ids: ["kimi-k2.7-code"],
        })
      }
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
      if (path === "/expert-squad/catalog") return send(expertSquadCatalog)
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
      if (path === "/skill/mounts")
        return send({
          scope: "project",
          skills: [],
          agents: [],
          matrix: [],
          project_mounts: { agents: {} },
          unmounted_count: 0,
        })
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
      const selectorTrigger = '[data-ui="composer-model-selector-trigger"]'
      await page.waitForSelector('[data-ui="composer-model-selector"]')
      await page.waitForSelector(selectorTrigger)
      await page.waitForFunction(() =>
        (document.querySelector('[data-ui="composer-model-selector"]') as HTMLElement | null)?.innerText.includes(
          "kimi-k2.7-code",
        ),
      )
      await page.waitForSelector('[data-ui="executor-hexin-budget"]')
      await page.waitForFunction(() =>
        (document.querySelector('[data-ui="executor-hexin-budget"]') as HTMLElement | null)?.innerText.includes(
          "19.99",
        ),
      )
      assert.equal(budgetRequests.length, 1)
      assert.equal(budgetRequests.at(-1)?.directory, "D:/overlay/workspace/app")

      const layout = await page.evaluate(() => {
        const selector = document.querySelector('[data-ui="composer-model-selector"]') as HTMLElement | null
        const trigger = document.querySelector('[data-ui="composer-model-selector-trigger"]') as HTMLElement | null
        const value = document.querySelector(".composer-model-selector-value") as HTMLElement | null
        const selectorRect = selector?.getBoundingClientRect()
        const triggerRect = trigger?.getBoundingClientRect()
        return {
          selectorWidth: selectorRect?.width ?? 0,
          selectorHeight: selectorRect?.height ?? 0,
          triggerWidth: triggerRect?.width ?? 0,
          triggerHeight: triggerRect?.height ?? 0,
          selectorText: selector?.innerText ?? "",
          valueText: value?.innerText ?? "",
        }
      })
      assert.ok(layout.selectorWidth >= 120, JSON.stringify(layout))
      assert.ok(layout.selectorHeight >= 22, JSON.stringify(layout))
      assert.ok(layout.triggerWidth >= layout.selectorWidth - 1, JSON.stringify(layout))
      assert.ok(layout.triggerHeight >= layout.selectorHeight - 1, JSON.stringify(layout))
      assert.ok(layout.selectorText.includes("kimi-k2.7-code"), JSON.stringify(layout))
      assert.equal(layout.valueText, projectModel)

      const budgetLayout = await page.evaluate(() => {
        const selector = document.querySelector('[data-ui="composer-model-selector"]') as HTMLElement | null
        const trigger = document.querySelector('[data-ui="composer-model-selector-trigger"]') as HTMLElement | null
        const budget = document.querySelector('[data-ui="executor-hexin-budget"]') as HTMLElement | null
        const value = budget?.querySelector(".executor-budget-value") as HTMLElement | null
        const selectorCopy = document.querySelector(".composer-model-selector-copy") as HTMLElement | null
        const selectorRect = selector?.getBoundingClientRect()
        const triggerRect = trigger?.getBoundingClientRect()
        const budgetRect = budget?.getBoundingClientRect()
        const color = value ? getComputedStyle(value).color : ""
        return {
          role: budget?.getAttribute("role") ?? "",
          live: budget?.getAttribute("aria-live") ?? "",
          ariaLabel: budget?.getAttribute("aria-label") ?? "",
          title: budget?.getAttribute("title") ?? "",
          low: budget?.dataset.lowBudget ?? "",
          insideSelector: !!budget?.closest('[data-ui="composer-model-selector"]'),
          insideTrigger: !!budget?.closest('[data-ui="composer-model-selector-trigger"]'),
          copyDisplay: selectorCopy ? getComputedStyle(selectorCopy).display : "",
          selectorLeft: selectorRect?.left ?? 0,
          selectorRight: selectorRect?.right ?? 0,
          triggerLeft: triggerRect?.left ?? 0,
          triggerRight: triggerRect?.right ?? 0,
          budgetLeft: budgetRect?.left ?? 0,
          budgetRight: budgetRect?.right ?? 0,
          color,
        }
      })
      assert.equal(budgetLayout.role, "status")
      assert.equal(budgetLayout.live, "polite")
      assert.ok(budgetLayout.ariaLabel.includes("Remaining 19.99 / 4,435.30"), JSON.stringify(budgetLayout))
      assert.ok(budgetLayout.title.includes("spent 4,415.31"), JSON.stringify(budgetLayout))
      assert.equal(budgetLayout.low, "true")
      assert.equal(budgetLayout.insideSelector, true)
      assert.equal(budgetLayout.insideTrigger, true)
      assert.equal(budgetLayout.copyDisplay, "flex")
      assert.ok(budgetLayout.budgetLeft >= budgetLayout.selectorLeft - 1, JSON.stringify(budgetLayout))
      assert.ok(budgetLayout.budgetRight <= budgetLayout.selectorRight + 1, JSON.stringify(budgetLayout))
      assert.ok(budgetLayout.budgetLeft >= budgetLayout.triggerLeft - 1, JSON.stringify(budgetLayout))
      assert.ok(budgetLayout.budgetRight <= budgetLayout.triggerRight + 1, JSON.stringify(budgetLayout))
      const colorMatch = budgetLayout.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      assert.notEqual(colorMatch, null, budgetLayout.color)
      assert.ok(Number(colorMatch![1]) > Number(colorMatch![2]), budgetLayout.color)
      assert.ok(Number(colorMatch![1]) > Number(colorMatch![3]), budgetLayout.color)
      const budgetElement = await page.$('[data-ui="executor-hexin-budget"]')
      assert.ok(budgetElement, "Hexin budget element should exist before screenshot")
      const budgetScreenshot = await saveElementScreenshot(budgetElement, "executor-selector-hexin-budget-inline.png")
      assert.ok(budgetScreenshot.target.endsWith("executor-selector-hexin-budget-inline.png"))
      const budgetScreenshotStats = await analyzeBudgetScreenshot(budgetScreenshot.screenshot)
      assert.ok(budgetScreenshotStats.width >= 48, JSON.stringify(budgetScreenshotStats))
      assert.ok(budgetScreenshotStats.height >= 8, JSON.stringify(budgetScreenshotStats))
      assert.ok(budgetScreenshotStats.nonWhite > 0, JSON.stringify(budgetScreenshotStats))
      assert.ok(budgetScreenshotStats.uniqueColorBuckets >= 4, JSON.stringify(budgetScreenshotStats))
      assert.ok(budgetScreenshotStats.redDominant > 0, JSON.stringify(budgetScreenshotStats))

      await page.hover(selectorTrigger)
      const hoverSelectorVisual = await readChipVisual(page, selectorTrigger)
      assert.equal(hoverSelectorVisual.hover, true)
      await page.mouse.move(0, 0)
      const selectorFocusState = await tabToSelector(page, selectorTrigger)
      assert.deepEqual(selectorFocusState, {
        dataUi: "composer-model-selector-trigger",
        focused: true,
        focusVisible: true,
        tagName: "BUTTON",
      })
      const focusSelectorVisual = await readChipVisual(page, selectorTrigger)
      assert.equal(focusSelectorVisual.focusVisible, true)
      assert.notEqual(focusSelectorVisual.outlineStyle, "none")
      assert.notEqual(focusSelectorVisual.outlineWidth, "0px")
      const focusedSelector = await page.$(selectorTrigger)
      assert.ok(focusedSelector, "focused composer model selector should exist before screenshot")
      const focusScreenshot = await saveElementScreenshot(focusedSelector, "composer-model-selector-focus-visible.png")
      assert.ok(focusScreenshot.target.endsWith("composer-model-selector-focus-visible.png"))

      await page.evaluate(async () => {
        await (window as any).applyDirectory("D:/overlay/workspace/next", { persist: false, save: false })
      })
      await page.waitForFunction(() =>
        (document.querySelector('[data-ui="executor-hexin-budget"]') as HTMLElement | null)?.innerText.includes(
          "18.75",
        ),
      )
      assert.ok(
        budgetRequests.some((item) => item.directory === "D:/overlay/workspace/next" && item.remaining === 18.75),
        JSON.stringify(budgetRequests),
      )

      // The composer popover lists only connected OpenCorvus providers.
      // innerText reflects text-transform; provider group headers are uppercased
      // for the picker, so we match case-insensitively.
      await page.click(selectorTrigger)
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
      assert.ok(mirrorBody.includes("gpt-5.5-pro"), mirrorBody)
      assert.ok(mirrorBody.includes("gpt-5.5-codex"))
      assert.ok(mirrorBody.includes("kimi-k2.7-code"))
      const mirrorOpenState = await page.evaluate(() => {
        const trigger = document.querySelector('[data-ui="composer-model-selector-trigger"]') as HTMLElement | null
        return {
          ariaExpanded: trigger?.getAttribute("aria-expanded") ?? "",
          dataExpanded: trigger?.hasAttribute("data-expanded") ?? false,
          triggerDataOpen: trigger?.getAttribute("data-open") ?? null,
        }
      })
      assert.deepEqual(mirrorOpenState, {
        ariaExpanded: "true",
        dataExpanded: true,
        triggerDataOpen: null,
      })
      const openedSelector = await page.$(selectorTrigger)
      assert.ok(openedSelector, "opened composer model selector should exist before screenshot")
      const openStateScreenshot = await saveElementScreenshot(openedSelector, "composer-model-selector-expanded-state.png")
      assert.ok(openStateScreenshot.target.endsWith("composer-model-selector-expanded-state.png"))
      const mirrorPlacement = await page.evaluate(() => {
        const selector = document.querySelector('[data-ui="composer-model-selector"]') as HTMLElement | null
        const trigger = document.querySelector('[data-ui="composer-model-selector-trigger"]') as HTMLElement | null
        const popover = document.querySelector('[data-section="mirror"]') as HTMLElement | null
        const header = popover?.querySelector(".executor-popover-header") as HTMLElement | null
        if (!selector || !trigger || !popover || !header) return null
        const selectorRect = selector.getBoundingClientRect()
        const triggerRect = trigger.getBoundingClientRect()
        const popoverRect = popover.getBoundingClientRect()
        const headerRect = header.getBoundingClientRect()
        const style = getComputedStyle(popover)
        return {
          selectorLeft: selectorRect.left,
          selectorRight: selectorRect.right,
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

      const mirrorListboxSelector = await focusModelListbox(page, "mirror", "hexin", "hexin/kimi-k2.7-code")
      const mirrorModelState = await page.evaluate(
        (args: { listboxSelector: string; currentSelector: string }) => {
          const { listboxSelector, currentSelector } = args
          const listbox = document.querySelector(listboxSelector) as HTMLElement | null
          const current = document.querySelector(currentSelector) as HTMLElement | null
          const retiredButtons = document.querySelectorAll('[data-section="mirror"] .executor-popover-model')
          return {
            listboxRole: listbox?.getAttribute("role") ?? "",
            listboxFocused: document.activeElement === listbox,
            currentRole: current?.getAttribute("role") ?? "",
            currentSelected: current?.hasAttribute("data-selected") ?? false,
            currentAriaSelected: current?.getAttribute("aria-selected") ?? "",
            currentText: current?.textContent?.trim() ?? "",
            retiredButtonCount: retiredButtons.length,
          }
        },
        {
          listboxSelector: mirrorListboxSelector,
          currentSelector: modelOptionSelector("mirror", "hexin/kimi-k2.7-code"),
        },
      )
      assert.deepEqual(mirrorModelState, {
        listboxRole: "listbox",
        listboxFocused: true,
        currentRole: "option",
        currentSelected: true,
        currentAriaSelected: "true",
        currentText: "kimi-k2.7-code",
        retiredButtonCount: 0,
      })
      await saveScreenshot(page, "executor-selector-current-model-listbox.png")

      await focusModelListbox(page, "mirror", "openai", "openai/gpt-5.5-pro")
      const openaiModelOptionState = await page.$eval(
        modelOptionSelector("mirror", "openai/gpt-5.5-pro"),
        (node: HTMLElement) => ({
          role: node.getAttribute("role") ?? "",
          selected: node.hasAttribute("data-selected"),
          ariaSelected: node.getAttribute("aria-selected") ?? "",
          text: node.textContent?.trim() ?? "",
        }),
      )
      assert.deepEqual(openaiModelOptionState, {
        role: "option",
        selected: false,
        ariaSelected: "false",
        text: "gpt-5.5-pro",
      })
      await page.focus(modelOptionSelector("mirror", "openai/gpt-5.5-codex"))
      await page.waitForFunction(
        () => (document.activeElement as HTMLElement | null)?.dataset.modelValue === "openai/gpt-5.5-codex",
      )
      await page.keyboard.press("ArrowDown")
      await page.waitForFunction(
        () => (document.activeElement as HTMLElement | null)?.dataset.modelValue === "openai/gpt-5.5-pro",
      )
      const highlightedModelState = await page.$eval(
        modelOptionSelector("mirror", "openai/gpt-5.5-pro"),
        (node: HTMLElement) => {
          const styles = getComputedStyle(node)
          return {
            highlighted: node.hasAttribute("data-highlighted"),
            selected: node.hasAttribute("data-selected"),
            ariaSelected: node.getAttribute("aria-selected") ?? "",
            backgroundColor: styles.backgroundColor,
            color: styles.color,
          }
        },
      )
      assert.equal(highlightedModelState.highlighted, true)
      assert.equal(highlightedModelState.selected, false)
      assert.equal(highlightedModelState.ariaSelected, "false")
      assert.notEqual(highlightedModelState.backgroundColor, "rgba(0, 0, 0, 0)")
      assert.notEqual(highlightedModelState.color, "rgba(0, 0, 0, 0)")
      await saveScreenshot(page, "executor-selector-keyboard-highlighted-model.png")
      await page.keyboard.press("Enter")
      await page.waitForFunction(() =>
        (document.querySelector('[data-ui="composer-model-selector"]') as HTMLElement | null)?.innerText.includes(
          "gpt-5.5-pro",
        ),
      )
      await page.waitForFunction(() => document.querySelector('[data-ui="executor-hexin-budget"]') === null)
      const keyboardSelection = await page.$eval('[data-ui="composer-model-selector"]', (node: HTMLElement) =>
        node.innerText.trim(),
      )
      assert.ok(keyboardSelection.includes("gpt-5.5-pro"))
      const visibleErrorNotifications = await page.$$eval('.app-notification[data-tone="error"]', (nodes) =>
        nodes.map((node) => (node as HTMLElement).innerText.trim()),
      )
      assert.deepEqual(visibleErrorNotifications, [])
      assert.ok(
        budgetRequests.every((item) => item.directory),
        JSON.stringify(budgetRequests),
      )
      await page.click(selectorTrigger)
      await page.waitForSelector('[data-section="mirror"]')
      assert.equal(await page.$('[data-section="external"]'), null)
      assert.deepEqual(pageErrors, [])
    } finally {
      await browser.close().catch(() => undefined)
      await server.close()
    }
  },
  { timeout: 60_000 },
)
