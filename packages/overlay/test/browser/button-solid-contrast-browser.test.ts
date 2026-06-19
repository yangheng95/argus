import assert from "node:assert/strict"
import { mkdirSync, readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")
const THEMES = ["light", "dark", "vscode-dark"] as const
const SAMPLES = [
  { selector: '[data-button-sample="neutral"]', label: "solid neutral", minimumContrast: 4.5 },
  { selector: '[data-button-sample="accent"]', label: "solid accent", minimumContrast: 4.5 },
  { selector: '[data-button-sample="danger"]', label: "solid danger", minimumContrast: 4.5 },
  { selector: '[data-ui="sidebar-new-task-button"]', label: "sidebar new task CTA", minimumContrast: 4.5 },
  { selector: '[data-ui="mission-new"]', label: "mission new CTA", minimumContrast: 4.5 },
  { selector: '[data-ui="coding-assistant-new"]', label: "coding assistant new CTA", minimumContrast: 4.5 },
  { selector: '[data-ui="window-close"]', label: "window close control", minimumContrast: 3 },
] as const

function readCss(rel: string): string {
  return readFileSync(join(OVERLAY_ROOT, "src/styles", rel), "utf8")
}

function overlayStyleHrefs(): string[] {
  const html = readFileSync(join(OVERLAY_ROOT, "src/index.html"), "utf8")
  const hrefs = Array.from(html.matchAll(/<link\s+rel="stylesheet"\s+href="styles\/([^"]+)"/g), (match) => match[1])
  if (hrefs.length === 0) throw new Error("No overlay stylesheet links found in src/index.html")
  return hrefs
}

function overlayCss(): string {
  return overlayStyleHrefs().map(readCss).join("\n")
}

async function saveScreenshot(element: { screenshot(options?: Record<string, unknown>): Promise<Buffer> }, name: string) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  await writeFile(target, await element.screenshot({}))
  return target
}

test("solid Button foregrounds stay readable across themes and interaction states", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 900, height: 520 })
    await page.setContent(`
      <!doctype html>
      <html data-theme="light">
        <head>
          <style>
            ${overlayCss()}
            :root { --ui-scale: 1; }
            body {
              min-height: 100vh;
              margin: 0;
              padding: 24px;
              background-color: var(--bg);
              background-image: none;
              color: var(--text);
              font-family: var(--font);
            }
            .button-solid-contrast-stage {
              width: min(720px, calc(100vw - 48px));
              display: grid;
              gap: 16px;
              padding: 16px;
              border: var(--oc-border-width) solid var(--border);
              border-radius: var(--oc-radius-large);
              background: var(--surface);
            }
            .button-solid-contrast-row {
              display: flex;
              flex-wrap: wrap;
              gap: 10px;
              align-items: center;
            }
            .button-solid-contrast-row > strong {
              flex: 0 0 100%;
              color: var(--text-strong);
              font-size: var(--ui-font-control);
              line-height: var(--ui-line-tight);
            }
            .button-solid-contrast-row.titlebar-window-controls {
              justify-content: flex-start;
            }
            [data-ui="focus-sentinel"] {
              position: fixed;
              top: 0;
              left: -200vw;
            }
          </style>
        </head>
        <body data-theme="light">
          <button type="button" data-ui="focus-sentinel">focus sentinel</button>
          <main class="button-solid-contrast-stage" data-ui="button-solid-contrast-stage">
            <section class="button-solid-contrast-row" aria-label="Button primitive solid tones">
              <strong>Button primitive solid tones</strong>
              <button class="oc-button" data-variant="solid" data-size="md" data-tone="neutral" data-button-sample="neutral" type="button">Neutral</button>
              <button class="oc-button" data-variant="solid" data-size="md" data-tone="accent" data-button-sample="accent" type="button">Accent</button>
              <button class="oc-button" data-variant="solid" data-size="md" data-tone="danger" data-button-sample="danger" type="button">Danger</button>
            </section>
            <section class="button-solid-contrast-row sidebar-header-actions" aria-label="Sidebar creation CTAs">
              <strong>Sidebar creation CTAs</strong>
              <button class="oc-button" data-variant="solid" data-size="md" data-tone="accent" data-ui="sidebar-new-task-button" type="button">
                <span class="sidebar-btn-icon" aria-hidden="true">+</span>
                <span class="sidebar-btn-label">New Task</span>
              </button>
              <button class="oc-button" data-variant="solid" data-size="md" data-tone="accent" data-ui="mission-new" type="button">
                <span class="sidebar-btn-icon" aria-hidden="true">+</span>
                <span class="sidebar-btn-label">New Mission</span>
              </button>
              <button class="oc-button" data-variant="solid" data-size="md" data-tone="accent" data-ui="coding-assistant-new" type="button">
                <span class="sidebar-btn-icon" aria-hidden="true">+</span>
                <span class="sidebar-btn-label">New Chat</span>
              </button>
            </section>
            <section class="button-solid-contrast-row titlebar-window-controls" aria-label="Titlebar window controls">
              <strong>Titlebar window controls</strong>
              <button class="oc-button" data-variant="ghost" data-size="icon" data-tone="neutral" data-chrome="window-control" data-ui="window-minimize" type="button" aria-label="Minimize">-</button>
              <button class="oc-button" data-variant="ghost" data-size="icon" data-tone="neutral" data-chrome="window-control" data-ui="window-maximize" type="button" aria-label="Maximize">[]</button>
              <button class="oc-button" data-variant="ghost" data-size="icon" data-tone="danger" data-chrome="window-control" data-ui="window-close" type="button" aria-label="Close">x</button>
            </section>
          </main>
        </body>
      </html>
    `)

    const stage = await page.$('[data-ui="button-solid-contrast-stage"]')
    assert.ok(stage)
    const failures: string[] = []
    const screenshots: string[] = []
    const focusSample = async (selector: string): Promise<boolean> => {
      await page.focus('[data-ui="focus-sentinel"]')
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await page.keyboard.press("Tab")
        const focused = await page.$eval(selector, (node: Element) => document.activeElement === node)
        if (focused) return true
      }
      return false
    }

    for (const theme of THEMES) {
      await page.evaluate((themeName) => {
        document.documentElement.dataset.theme = themeName
        document.body.dataset.theme = themeName
        ;(document.activeElement as HTMLElement | null)?.blur()
      }, theme)
      await page.mouse.move(1, 1)
      screenshots.push(await saveScreenshot(stage, `button-solid-contrast-${theme}.png`))

      for (const sample of SAMPLES) {
        const normal = await page.$eval(sample.selector, buttonMetrics)
        if (normal.contrast < sample.minimumContrast)
          failures.push(`${theme} ${sample.label} normal ${normal.contrast.toFixed(2)}`)

        await page.hover(sample.selector)
        const hover = await page.$eval(sample.selector, buttonMetrics)
        if (hover.contrast < sample.minimumContrast)
          failures.push(`${theme} ${sample.label} hover ${hover.contrast.toFixed(2)}`)

        await page.mouse.move(1, 1)
        const sampleFocused = await focusSample(sample.selector)
        if (!sampleFocused) failures.push(`${theme} ${sample.label} could not be focused by keyboard`)
        const focus = await page.$eval(sample.selector, buttonMetrics)
        if (!focus.focusVisible) failures.push(`${theme} ${sample.label} did not receive focus-visible`)
        if (focus.contrast < sample.minimumContrast)
          failures.push(`${theme} ${sample.label} focus ${focus.contrast.toFixed(2)}`)
      }

      await page.focus('[data-ui="focus-sentinel"]')
      await page.keyboard.press("Tab")
      await page.keyboard.press("Tab")
      await page.hover('[data-button-sample="danger"]')
      screenshots.push(await saveScreenshot(stage, `button-solid-contrast-${theme}-states.png`))

      await page.mouse.move(1, 1)
      await focusSample('[data-ui="window-close"]')
      screenshots.push(await saveScreenshot(stage, `button-window-close-contrast-${theme}-focus.png`))
      await page.hover('[data-ui="window-close"]')
      screenshots.push(await saveScreenshot(stage, `button-window-close-contrast-${theme}-hover.png`))
    }

    assert.deepEqual(failures, [])
    assert.deepEqual(
      screenshots.map((item) => item.endsWith(".png")),
      screenshots.map(() => true),
    )
  } finally {
    await browser.close()
  }
})

function buttonMetrics(element: Element) {
  interface Rgba {
    r: number
    g: number
    b: number
    a: number
  }

  function parseAlpha(value: string | undefined): number {
    if (!value) return 1
    if (value.endsWith("%")) return Number.parseFloat(value) / 100
    return Number.parseFloat(value)
  }

  function parseColor(value: string): Rgba {
    const normalized = value.trim().toLowerCase()
    if (normalized === "transparent") return { r: 0, g: 0, b: 0, a: 0 }
    const rgb = normalized.match(/^rgba?\((.*)\)$/)
    if (rgb) {
      const body = rgb[1]!.trim()
      const [channels, alpha] = body.split("/").map((part) => part.trim())
      const parts = channels!.split(/[\s,]+/).filter(Boolean)
      const [r, g, b] = parts.map((part) => Number.parseFloat(part))
      const a = alpha === undefined ? (parts[3] === undefined ? 1 : parseAlpha(parts[3])) : parseAlpha(alpha)
      if (![r, g, b, a].every(Number.isFinite)) throw new Error(`Invalid rgb color: ${value}`)
      return { r, g, b, a }
    }
    const srgb = normalized.match(/^color\(\s*srgb\s+(.+)\)$/)
    if (srgb) {
      const [channels, alpha] = srgb[1]!.split("/").map((part) => part.trim())
      const [r, g, b] = channels!.split(/\s+/).map((part) => Number.parseFloat(part) * 255)
      const a = alpha === undefined ? 1 : parseAlpha(alpha)
      if (![r, g, b, a].every(Number.isFinite)) throw new Error(`Invalid srgb color: ${value}`)
      return { r, g, b, a }
    }
    const oklab = normalized.match(/^oklab\((.+)\)$/)
    if (oklab) {
      const [channels, alpha] = oklab[1]!.split("/").map((part) => part.trim())
      const [l, aa, bb] = channels!.split(/\s+/).map((part) => Number.parseFloat(part))
      const a = alpha === undefined ? 1 : parseAlpha(alpha)
      if (![l, aa, bb, a].every(Number.isFinite)) throw new Error(`Invalid oklab color: ${value}`)
      const ll = l + 0.3963377774 * aa + 0.2158037573 * bb
      const mm = l - 0.1055613458 * aa - 0.0638541728 * bb
      const ss = l - 0.0894841775 * aa - 1.291485548 * bb
      const linearR = 4.0767416621 * ll ** 3 - 3.3077115913 * mm ** 3 + 0.2309699292 * ss ** 3
      const linearG = -1.2684380046 * ll ** 3 + 2.6097574011 * mm ** 3 - 0.3413193965 * ss ** 3
      const linearB = -0.0041960863 * ll ** 3 - 0.7034186147 * mm ** 3 + 1.707614701 * ss ** 3
      const encode = (channel: number) => {
        const encoded = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055
        return Math.min(255, Math.max(0, encoded * 255))
      }
      return { r: encode(linearR), g: encode(linearG), b: encode(linearB), a }
    }
    throw new Error(`Unsupported color: ${value}`)
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

  function effectiveBackground(node: HTMLElement): Rgba {
    const ancestors: HTMLElement[] = []
    for (let current: HTMLElement | null = node; current; current = current.parentElement) {
      ancestors.push(current)
      if (current === document.body) break
    }
    let surface: Rgba = { r: 255, g: 255, b: 255, a: 1 }
    for (const current of ancestors.reverse()) {
      const background = parseColor(getComputedStyle(current).backgroundColor)
      if (background.a > 0) surface = composite(background, surface)
    }
    return surface
  }

  const button = element as HTMLElement
  const styles = getComputedStyle(button)
  const background = effectiveBackground(button)
  const color = parseColor(styles.color)
  const foreground = composite(color, background)

  return {
    color: styles.color,
    backgroundColor: styles.backgroundColor,
    focusVisible: button.matches(":focus-visible"),
    contrast: contrastRatio(foreground, background),
  }
}
