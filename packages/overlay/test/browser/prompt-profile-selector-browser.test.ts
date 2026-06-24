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
const TRANSPARENT_TEXT_PAINT = ["rgb", "a(", [0, 0, 0, 0].join(", "), ")"].join("")

function route(url: URL) {
  return url.pathname.replace(/\/+$/, "") || "/"
}

async function saveScreenshot(
  element: { screenshot(options?: Record<string, unknown>): Promise<Buffer> },
  name: string,
) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  await writeFile(target, await element.screenshot({}))
  return target
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

function taskListPayload() {
  return { tasks: [] }
}

interface PromptProfileFixture {
  id: string
  label: string
  description: string
  built_in: boolean
  editable: boolean
  agents: Record<string, string>
}

const promptProfileScenarios = [
  {
    locale: "en-US",
    triggerLabel: "Expert Squad",
    screenshotName: "prompt-profile-selector-runtime-highlighted-en-US.png",
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
        id: "frontend-replica",
        label: "Frontend Replica",
        description: "Visual UI verification squad.",
        built_in: true,
        editable: false,
        agents: {},
      },
      {
        id: "backend",
        label: "Backend",
        description: "Contract and data integrity squad.",
        built_in: true,
        editable: false,
        agents: {},
      },
      {
        id: "algorithm",
        label: "Algorithm",
        description: "Correctness and benchmark squad.",
        built_in: true,
        editable: false,
        agents: {},
      },
      {
        id: "frontend-automation-debug",
        label: "Frontend Automation Debug",
        description: "Regression and evidence squad.",
        built_in: true,
        editable: false,
        agents: {},
      },
    ],
    expectedLabels: [
      "General Baseline prompt set.",
      "Frontend Replica Visual UI verification squad.",
      "Backend Contract and data integrity squad.",
      "Algorithm Correctness and benchmark squad.",
      "Frontend Automation Debug Regression and evidence squad.",
    ],
    expectedUnselectedLabels: [
      "General Baseline prompt set.",
      "Backend Contract and data integrity squad.",
      "Algorithm Correctness and benchmark squad.",
      "Frontend Automation Debug Regression and evidence squad.",
    ],
  },
  {
    locale: "zh-CN",
    triggerLabel: "专家团",
    screenshotName: "prompt-profile-selector-runtime-highlighted-zh-CN.png",
    profiles: [
      {
        id: "general",
        label: "通用",
        description: "基础提示词集合。",
        built_in: true,
        editable: false,
        agents: {},
      },
      {
        id: "frontend-replica",
        label: "前端",
        description: "视觉界面验证专家团。",
        built_in: true,
        editable: false,
        agents: {},
      },
      {
        id: "backend",
        label: "后端",
        description: "契约和数据完整性专家团。",
        built_in: true,
        editable: false,
        agents: {},
      },
      {
        id: "algorithm",
        label: "算法",
        description: "正确性和基准回归专家团。",
        built_in: true,
        editable: false,
        agents: {},
      },
      {
        id: "frontend-automation-debug",
        label: "测试",
        description: "回归和证据专家团。",
        built_in: true,
        editable: false,
        agents: {},
      },
    ],
    expectedLabels: [
      "通用 基础提示词集合。",
      "前端 视觉界面验证专家团。",
      "后端 契约和数据完整性专家团。",
      "算法 正确性和基准回归专家团。",
      "测试 回归和证据专家团。",
    ],
    expectedUnselectedLabels: [
      "通用 基础提示词集合。",
      "后端 契约和数据完整性专家团。",
      "算法 正确性和基准回归专家团。",
      "测试 回归和证据专家团。",
    ],
  },
] satisfies Array<{
  locale: "en-US" | "zh-CN"
  triggerLabel: string
  screenshotName: string
  profiles: PromptProfileFixture[]
  expectedLabels: string[]
  expectedUnselectedLabels: string[]
}>

async function waitForAssistantButton(
  page: any,
  diagnostics: { badResponses: string[]; consoleMessages: string[]; pageErrors: string[] },
): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const exists = await page.evaluate(
      () => !!document.querySelector('[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]'),
    )
    if (exists) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const state = await page.evaluate(() => ({
    readyState: document.readyState,
    bodyLength: document.body?.textContent?.length ?? 0,
    bodySample: document.body?.textContent?.slice(0, 300) ?? "",
    hasComposerMount: !!document.querySelector("#solidChatComposer"),
    scripts: Array.from(document.scripts).map((script) => script.src || script.textContent?.slice(0, 80) || ""),
  }))
  throw new Error(`Assistant activity button did not mount: ${JSON.stringify({ ...diagnostics, state }, null, 2)}`)
}

for (const scenario of promptProfileScenarios) {
  test(`prompt profile selector options remain readable on the light popup surface (${scenario.locale})`, async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const promptProfileCatalog = {
      active: "frontend-replica",
      project_active: "frontend-replica",
      session_active: null,
      default: "general",
      targets: [],
      profiles: scenario.profiles,
    }

    const server = await startBrowserFixture(async (req) => {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/" || path === "/ui" || path === "/ui/")
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks" || path === "/global/tasks") return send(taskListPayload())
      if (path === "/global/projects/discover") return send([])
      if (path === "/session") return send([])
      if (path === "/mission") return send([])
      if (path === "/project/current/worktrees") return send([])
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
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config/prompt") return send([])
      if (path === "/config/prompt-profile") return send(promptProfileCatalog)
      if (path === "/config" && (req.method === "GET" || req.method === "PATCH")) {
        return send({
          model: "opencorvus/gpt-5-nano",
          prompt_profile: { active: "frontend-replica" },
        })
      }
      if (path === "/coding/sessions") return send({ sessions: [], nextCursor: null })
      if (path === "/coding/cli/profiles" || path === "/terminal/profiles") return send({ profiles: [] })
      if (path === "/task/events") {
        return new Response(":\n\n", {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
          },
        })
      }
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") {
        return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
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
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    })

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      const badResponses: string[] = []
      const consoleMessages: string[] = []
      const pageErrors: string[] = []
      page.on("response", (response: any) => {
        if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
      })
      page.on("console", (message: any) => {
        consoleMessages.push(`${message.type}: ${message.text}`)
      })
      page.on("pageerror", (error: any) => {
        pageErrors.push(error.message || String(error))
      })
      await page.setViewport({ width: 1280, height: 860 })
      await page.evaluateOnNewDocument(
        ({ serverUrl, locale }) => {
          ;(window as any).__OPENCORVUS_LOCALE__ = locale
          localStorage.setItem("oc_locale", locale)
          localStorage.setItem("oc_theme", "light")
          localStorage.setItem("oc_server_url", serverUrl)
          localStorage.setItem("oc_auto_server", "false")
          localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
          localStorage.setItem("oc_workspace_directory", "D:/overlay/workspace/app")
          ;(window as any).__TAURI__ = {
            core: {
              invoke: async (command: string) => {
                if (command === "overlay_settings_load") {
                  return {
                    serverUrl,
                    autoServer: false,
                    locale,
                    theme: "light",
                    directory: "D:/overlay/workspace/app",
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
        },
        { serverUrl: server.origin, locale: scenario.locale },
      )

      await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
      await waitForAssistantButton(page, { badResponses, consoleMessages, pageErrors })
      const assistantVisible = await page.$eval(
        '[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]',
        (node: HTMLElement) => {
          const rect = node.getBoundingClientRect()
          const style = getComputedStyle(node)
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
        },
      )
      assert.equal(assistantVisible, true)
      await page.$eval(
        '[data-ui="side-activity-button"][data-side="left"][data-activity="assistant"]',
        (node: HTMLElement) => node.click(),
      )
      await page.waitForSelector('[data-ui="prompt-profile-selector"]')
      await page.waitForFunction(() => {
        const trigger = document.querySelector<HTMLButtonElement>('[data-ui="prompt-profile-selector"]')
        return !!trigger && !trigger.disabled
      })
      await page.click('[data-ui="prompt-profile-selector"]')
      await page.waitForSelector(".prompt-profile-select-content")
      await page.waitForSelector(".prompt-profile-select-option")
      await page.mouse.move(2, 2)
      let keyboardHighlightedBackend = false
      for (let attempt = 0; attempt < scenario.profiles.length + 1; attempt += 1) {
        await page.keyboard.press("ArrowDown")
        keyboardHighlightedBackend = await page.evaluate(
          () =>
            !!document.querySelector(
              '.prompt-profile-select-option[data-profile-id="backend"][data-highlighted][aria-selected="false"]',
            ),
        )
        if (keyboardHighlightedBackend) break
      }
      assert.equal(keyboardHighlightedBackend, true)
      await page.waitForFunction(
        () =>
          !!document.querySelector(
            '.prompt-profile-select-option[data-profile-id="backend"][data-highlighted][aria-selected="false"]',
          ),
      )

      const contentElement = await page.$(".prompt-profile-select-content")
      assert.ok(contentElement)
      const screenshot = await saveScreenshot(contentElement, scenario.screenshotName)
      assert.ok(screenshot.endsWith(scenario.screenshotName))

      const result = await page.evaluate(() => {
        interface Rgba {
          r: number
          g: number
          b: number
          a: number
        }
        function parseColor(value: string): Rgba {
          const match = value.match(/rgba?\(([^)]+)\)/)
          if (match) {
            const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()))
            const [r, g, b] = parts
            const a = parts.length >= 4 ? parts[3] : 1
            if (![r, g, b, a].every(Number.isFinite)) throw new Error(`Invalid color: ${value}`)
            return { r, g, b, a }
          }
          const srgb = value.match(/color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+))?\)/)
          if (!srgb) throw new Error(`Unsupported color: ${value}`)
          const r = Number.parseFloat(srgb[1]) * 255
          const g = Number.parseFloat(srgb[2]) * 255
          const b = Number.parseFloat(srgb[3]) * 255
          const a = srgb[4] === undefined ? 1 : Number.parseFloat(srgb[4])
          if (![r, g, b, a].every(Number.isFinite)) throw new Error(`Invalid color: ${value}`)
          return { r, g, b, a }
        }
        function composite(foreground: Rgba, background: Rgba): Rgba {
          const alpha = foreground.a + background.a * (1 - foreground.a)
          if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
          return {
            r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
            g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
            b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
            a: alpha,
          }
        }
        function channel(value: number): number {
          const scaled = value / 255
          return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
        }
        function luminance(color: Rgba): number {
          return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
        }
        function contrastRatio(foreground: Rgba, background: Rgba): number {
          const lighter = Math.max(luminance(foreground), luminance(background))
          const darker = Math.min(luminance(foreground), luminance(background))
          return (lighter + 0.05) / (darker + 0.05)
        }
        function textFillColor(style: CSSStyleDeclaration): string {
          return style.getPropertyValue("-webkit-text-fill-color") || style.color
        }
        function renderedState(element: HTMLElement) {
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return {
            display: style.display,
            visibility: style.visibility,
            opacity: Number.parseFloat(style.opacity),
            rectWidth: rect.width,
            rectHeight: rect.height,
          }
        }

        const rootTheme = document.documentElement.dataset.theme
        const bodyTheme = document.body.dataset.theme
        const trigger = document.querySelector('[data-ui="prompt-profile-selector"]') as HTMLElement | null
        if (!trigger) throw new Error("Missing prompt profile select trigger")
        const content = document.querySelector(".prompt-profile-select-content") as HTMLElement | null
        if (!content) throw new Error("Missing prompt profile select content")
        const triggerStyle = getComputedStyle(trigger)
        const triggerText = trigger.textContent?.replace(/\s+/g, " ").trim() ?? ""
        const contentState = renderedState(content)
        const scaleText = getComputedStyle(document.body).getPropertyValue("--ui-scale").trim()
        const uiScale = Number.parseFloat(scaleText)
        if (!Number.isFinite(uiScale)) throw new Error(`Invalid --ui-scale: ${scaleText}`)
        const contentBackground = getComputedStyle(content).backgroundColor
        const contentBackgroundParts = contentBackground.match(/rgba?\(([^)]+)\)/)?.[1].split(",") ?? []
        const contentBackgroundAlpha =
          contentBackgroundParts.length >= 4 ? Number.parseFloat(contentBackgroundParts[3].trim()) : 1
        const contentBackgroundColor = parseColor(contentBackground)
        const options = Array.from(document.querySelectorAll(".prompt-profile-select-option")).map((node) => {
          const option = node as HTMLElement
          const style = getComputedStyle(option)
          const optionState = renderedState(option)
          const optionBackgroundColor = parseColor(style.backgroundColor)
          const surface =
            optionBackgroundColor.a > 0
              ? composite(optionBackgroundColor, contentBackgroundColor)
              : contentBackgroundColor
          const optionColor = parseColor(style.color)
          const optionTextFillColor = textFillColor(style)
          const optionTextFillColorValue = parseColor(optionTextFillColor)
          const copy = option.querySelector(".prompt-profile-select-option-copy") as HTMLElement | null
          const textParts = Array.from(copy?.children ?? [])
            .map((child) => {
              const element = child as HTMLElement
              const childStyle = getComputedStyle(element)
              const color = childStyle.color
              const fillColor = textFillColor(childStyle)
              const colorValue = parseColor(color)
              const fillColorValue = parseColor(fillColor)
              return {
                ...renderedState(element),
                tag: element.tagName.toLowerCase(),
                text: element.textContent?.trim() ?? "",
                color,
                textFillColor: fillColor,
                contrast: contrastRatio(colorValue, surface),
                textFillContrast: contrastRatio(fillColorValue, surface),
              }
            })
            .filter((part) => part.text)
          const label = textParts
            .map((part) => part.text)
            .filter(Boolean)
            .join(" ")
          return {
            label,
            profileID: option.dataset.profileId ?? "",
            role: option.getAttribute("role"),
            selectedAttribute: option.getAttribute("aria-selected"),
            selectedData: option.hasAttribute("data-selected"),
            selected: option.hasAttribute("data-selected") || option.getAttribute("aria-selected") === "true",
            highlighted: option.hasAttribute("data-highlighted"),
            ...optionState,
            color: style.color,
            textFillColor: optionTextFillColor,
            background: style.backgroundColor,
            surfaceAlpha: surface.a,
            contrast: contrastRatio(optionColor, surface),
            textFillContrast: contrastRatio(optionTextFillColorValue, surface),
            textParts,
          }
        })
        return {
          rootTheme,
          bodyTheme,
          triggerText,
          triggerClassList: Array.from(trigger.classList),
          triggerGapPixels: Number.parseFloat(triggerStyle.columnGap),
          expectedTriggerGapPixels: 10 * uiScale,
          contentState,
          contentBackground,
          contentBackgroundAlpha,
          options,
        }
      })

      assert.equal(result.rootTheme, "light")
      assert.equal(result.bodyTheme, "light")
      assert.ok(
        result.triggerText.includes(scenario.triggerLabel),
        `trigger text must reflect ${scenario.locale}: ${result.triggerText}`,
      )
      assert.ok(result.triggerClassList.includes("oc-select-trigger"))
      assert.ok(result.triggerClassList.includes("prompt-profile-select-trigger"))
      assert.equal(Math.abs(result.triggerGapPixels - result.expectedTriggerGapPixels) < 0.01, true)
      assert.notEqual(result.contentState.display, "none")
      assert.equal(result.contentState.visibility, "visible")
      assert.ok(result.contentState.opacity >= 0.95)
      assert.ok(result.contentState.rectWidth > 0)
      assert.ok(result.contentState.rectHeight > 0)
      assert.match(result.contentBackground, /^rgb\(/)
      assert.equal(result.contentBackgroundAlpha, 1)
      assert.deepEqual(
        result.options.map((option) => option.label),
        scenario.expectedLabels,
      )
      assert.deepEqual(
        result.options.map((option) => option.selectedAttribute),
        ["false", "true", "false", "false", "false"],
      )
      assert.equal(
        result.options.every((option) => option.role === "option"),
        true,
      )
      assert.equal(result.options.filter((option) => option.selectedData).length, 1)
      assert.equal(
        result.options.some((option) => option.selectedData && option.selectedAttribute === "true"),
        true,
      )
      const unselectedOptions = result.options.filter((option) => option.selectedAttribute === "false")
      const highlightedUnselected = result.options.find(
        (option) => option.profileID === "backend" && option.highlighted && option.selectedAttribute === "false",
      )
      assert.ok(
        highlightedUnselected,
        `Kobalte runtime highlight must reach a real unselected option: ${JSON.stringify(result.options)}`,
      )
      assert.deepEqual(
        unselectedOptions.map((option) => option.label),
        scenario.expectedUnselectedLabels,
      )
      assert.equal(
        result.options.every((option) => option.color !== TRANSPARENT_TEXT_PAINT),
        true,
      )
      assert.equal(
        result.options.every((option) => option.textFillColor !== TRANSPARENT_TEXT_PAINT),
        true,
      )
      assert.equal(
        result.options.every((option) => option.display !== "none"),
        true,
      )
      assert.equal(
        result.options.every((option) => option.visibility === "visible"),
        true,
      )
      assert.equal(
        result.options.every((option) => option.opacity >= 0.95),
        true,
      )
      assert.equal(
        result.options.every((option) => option.rectWidth > 0 && option.rectHeight > 0),
        true,
      )
      assert.equal(
        result.options.every((option) => option.surfaceAlpha === 1),
        true,
      )
      assert.equal(
        result.options.every((option) => option.contrast >= 4.5),
        true,
      )
      assert.equal(
        result.options.every((option) => option.textFillContrast >= 4.5),
        true,
      )
      assert.equal(
        result.options.every((option) => option.textParts.length >= 2),
        true,
      )
      assert.equal(
        unselectedOptions.every((option) => option.contrast >= 4.5),
        true,
      )
      assert.equal(
        unselectedOptions.every((option) => option.textFillContrast >= 4.5),
        true,
      )
      assert.ok(highlightedUnselected.contrast >= 4.5)
      assert.ok(highlightedUnselected.textFillContrast >= 4.5)
      assert.notEqual(
        highlightedUnselected.background,
        unselectedOptions.find((option) => !option.highlighted)?.background,
        "highlighted unselected option must have a visible runtime state",
      )
      assert.equal(
        result.options.every((option) =>
          option.textParts.every(
            (part) =>
              part.display !== "none" &&
              part.visibility === "visible" &&
              part.opacity >= 0.95 &&
              part.rectWidth > 0 &&
              part.rectHeight > 0 &&
              part.color !== TRANSPARENT_TEXT_PAINT &&
              part.textFillColor !== TRANSPARENT_TEXT_PAINT &&
              part.contrast >= 4.5 &&
              part.textFillContrast >= 4.5,
          ),
        ),
        true,
      )
      assert.equal(
        highlightedUnselected.textParts.every((part) => part.color !== TRANSPARENT_TEXT_PAINT && part.contrast >= 4.5),
        true,
      )
      assert.equal(
        unselectedOptions.every((option) =>
          option.textParts.every(
            (part) =>
              part.color !== TRANSPARENT_TEXT_PAINT &&
              part.textFillColor !== TRANSPARENT_TEXT_PAINT &&
              part.contrast >= 4.5 &&
              part.textFillContrast >= 4.5,
          ),
        ),
        true,
      )
      assert.deepEqual(badResponses, [])
    } finally {
      await browser.close()
      await server.close()
    }
  })
}
