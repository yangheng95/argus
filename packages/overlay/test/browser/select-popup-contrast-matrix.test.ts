import assert from "node:assert/strict"
import { mkdirSync, readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")

function readCss(rel: string): string {
  return readFileSync(join(OVERLAY_ROOT, "src/styles", rel), "utf8")
}

function overlayCss(): string {
  return [
    "tokens/design-language.css",
    "cascade/base.css",
    "cascade/dark.css",
    "cascade/vscode-dark.css",
    "cascade/light.css",
    "surfaces/field.css",
    "surfaces/composer.css",
    "surfaces/dialog.css",
    "surfaces/inspector.css",
    "surfaces/settings.css",
  ]
    .map(readCss)
    .join("\n")
}

async function saveScreenshot(element: { screenshot(options?: Record<string, unknown>): Promise<Buffer> }, name: string) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  await writeFile(target, await element.screenshot({}))
  return target
}

test("shared Select popup consumers keep readable options on a light popup surface", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1180, height: 820 })
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
              background: rgb(255, 255, 255);
              color: var(--text);
              font-family: var(--font);
            }
            .select-popup-matrix {
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: 16px;
              align-items: start;
            }
            .select-popup-sample {
              min-width: 0;
              padding: 12px;
              border: var(--oc-border-width) solid var(--border);
              border-radius: var(--oc-radius-large);
              background: var(--surface);
            }
            .select-popup-sample > strong {
              display: block;
              margin-bottom: 8px;
              color: var(--text-strong);
              font-size: var(--ui-font-control);
            }
            .select-popup-sample .oc-select-content {
              position: static;
              width: 100%;
              pointer-events: auto;
            }
          </style>
        </head>
        <body data-theme="light">
          <main class="select-popup-matrix" aria-label="Select popup contrast matrix">
            <section class="select-popup-sample" data-select-sample="prompt-profile">
              <strong>Expert Squad</strong>
              <div class="oc-select-content prompt-profile-select-content" data-expanded="">
                <ul class="oc-select-listbox prompt-profile-select-listbox" role="listbox">
                  <li class="oc-select-option prompt-profile-select-option" role="option" aria-selected="false">
                    <span class="prompt-profile-select-option-copy"><span>General</span><small>Baseline prompt set.</small></span>
                  </li>
                  <li class="oc-select-option prompt-profile-select-option" role="option" aria-selected="true" data-highlighted="">
                    <span class="prompt-profile-select-option-copy"><span>Frontend</span><small>Visual UI verification squad.</small></span>
                    <span class="oc-select-indicator">✓</span>
                  </li>
                </ul>
              </div>
            </section>

            <section class="select-popup-sample" data-select-sample="agent-model">
              <strong>Agent Model Settings</strong>
              <div class="oc-select-content agent-model-select-content" data-expanded="">
                <ul class="oc-select-listbox agent-model-select-listbox" role="listbox">
                  <li class="oc-select-option agent-model-select-option" role="option" aria-selected="false" data-model-value="openai/gpt-5.4">
                    <span class="oc-select-option-copy agent-model-select-option-text"><span>openai/gpt-5.4</span><small>Primary coding model.</small></span>
                  </li>
                  <li class="oc-select-option agent-model-select-option" role="option" aria-selected="true" data-highlighted="" data-model-value="anthropic/claude-sonnet-4-6">
                    <span class="oc-select-option-copy agent-model-select-option-text"><span>anthropic/claude-sonnet-4-6</span><small>Configured specialist model.</small></span>
                    <span class="oc-select-indicator">✓</span>
                  </li>
                </ul>
              </div>
            </section>

            <section class="select-popup-sample" data-select-sample="settings-form">
              <strong>Settings Form Select</strong>
              <div class="oc-select-content settings-form-select-content" data-expanded="">
                <ul class="oc-select-listbox settings-form-select-listbox" role="listbox">
                  <li class="oc-select-option settings-form-select-option" role="option" aria-selected="false">
                    <span class="oc-select-option-copy"><span>Local directory</span><small>Use a filesystem-backed source.</small></span>
                  </li>
                  <li class="oc-select-option settings-form-select-option" role="option" aria-selected="true" data-highlighted="">
                    <span class="oc-select-option-copy"><span>Managed source</span><small>Use the shared managed source.</small></span>
                    <span class="oc-select-indicator">✓</span>
                  </li>
                </ul>
              </div>
            </section>

            <section class="select-popup-sample" data-select-sample="app-dialog">
              <strong>App Dialog Select</strong>
              <div class="oc-select-content app-dialog-select-content" data-expanded="">
                <ul class="oc-select-listbox app-dialog-select-listbox" role="listbox">
                  <li class="oc-select-option app-dialog-select-option" role="option" aria-selected="false" data-value="view">View changed files</li>
                  <li class="oc-select-option app-dialog-select-option" role="option" aria-selected="true" data-highlighted="" data-value="continue">Continue current task <span class="oc-select-indicator">✓</span></li>
                </ul>
              </div>
            </section>

            <section class="select-popup-sample" data-select-sample="browser-preview">
              <strong>Browser Preview Target</strong>
              <div class="oc-select-content browser-preview-candidate-content" data-expanded="">
                <ul class="oc-select-listbox browser-preview-candidate-listbox" role="listbox">
                  <li class="oc-select-option browser-preview-candidate-option" role="option" aria-selected="false" data-ui="browser-preview-candidate-option" data-target-id="landing">
                    <span>http://localhost:4173/landing</span>
                  </li>
                  <li class="oc-select-option browser-preview-candidate-option" role="option" aria-selected="true" data-highlighted="" data-ui="browser-preview-candidate-option" data-target-id="checkout">
                    <span>http://localhost:4173/checkout</span><span class="oc-select-indicator">✓</span>
                  </li>
                </ul>
              </div>
            </section>

            <section class="select-popup-sample" data-select-sample="log-level">
              <strong>Log Level</strong>
              <div class="oc-select-content log-level-select-content" data-expanded="">
                <ul class="oc-select-listbox log-level-select-listbox" role="listbox">
                  <li class="oc-select-option log-level-select-option" role="option" aria-selected="false">INFO</li>
                  <li class="oc-select-option log-level-select-option" role="option" aria-selected="true" data-highlighted="">WARN <span class="oc-select-indicator">✓</span></li>
                </ul>
              </div>
            </section>
          </main>
        </body>
      </html>
    `)

    const matrix = await page.$(".select-popup-matrix")
    assert.ok(matrix)
    const screenshot = await saveScreenshot(matrix, "select-popup-contrast-matrix.png")
    assert.ok(screenshot.endsWith("select-popup-contrast-matrix.png"))

    const result = await page.evaluate(() => {
      interface Rgba {
        r: number
        g: number
        b: number
        a: number
      }
      function parseColor(value: string): Rgba {
        const match = value.match(/rgba?\(([^)]+)\)/)
        if (!match) throw new Error(`Unsupported color: ${value}`)
        const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()))
        const [r, g, b] = parts
        const a = parts.length >= 4 ? parts[3] : 1
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
      function optionSurface(option: HTMLElement, contentBackground: Rgba): Rgba {
        const optionBackground = parseColor(getComputedStyle(option).backgroundColor)
        return optionBackground.a > 0 ? composite(optionBackground, contentBackground) : contentBackground
      }

      return Array.from(document.querySelectorAll<HTMLElement>("[data-select-sample]")).map((sample) => {
        const content = sample.querySelector<HTMLElement>(".oc-select-content")
        if (!content) throw new Error(`Missing content for ${sample.dataset.selectSample}`)
        const contentBackground = parseColor(getComputedStyle(content).backgroundColor)
        const options = Array.from(sample.querySelectorAll<HTMLElement>(".oc-select-option")).map((option) => {
          const surface = optionSurface(option, contentBackground)
          const optionColor = parseColor(getComputedStyle(option).color)
          const textParts = Array.from(option.querySelectorAll<HTMLElement>("span, small"))
            .filter((part) => {
              const text = part.textContent?.trim() ?? ""
              return !!text && !part.classList.contains("oc-select-indicator")
            })
            .map((part) => {
              const color = parseColor(getComputedStyle(part).color)
              return {
                tag: part.tagName.toLowerCase(),
                text: part.textContent?.trim() ?? "",
                color: getComputedStyle(part).color,
                contrast: contrastRatio(color, surface),
              }
            })
          return {
            text: option.textContent?.trim().replace(/\s+/g, " ") ?? "",
            selected: option.getAttribute("aria-selected") === "true" || option.hasAttribute("data-selected"),
            color: getComputedStyle(option).color,
            background: getComputedStyle(option).backgroundColor,
            contrast: contrastRatio(optionColor, surface),
            surfaceAlpha: surface.a,
            textParts,
          }
        })
        const copyLayouts = Array.from(sample.querySelectorAll<HTMLElement>(".oc-select-option-copy")).map((copy) => {
          const label = copy.querySelector<HTMLElement>(":scope > span")
          const description = copy.querySelector<HTMLElement>(":scope > small")
          const copyStyle = getComputedStyle(copy)
          const labelRect = label?.getBoundingClientRect()
          const descriptionRect = description?.getBoundingClientRect()
          return {
            display: copyStyle.display,
            flexDirection: copyStyle.flexDirection,
            hasDescription: !!description,
            descriptionBelow:
              !descriptionRect || !labelRect
                ? true
                : descriptionRect.top >= labelRect.bottom - 0.5 && descriptionRect.left >= labelRect.left - 0.5,
          }
        })
        return {
          id: sample.dataset.selectSample ?? "",
          contentBackground: getComputedStyle(content).backgroundColor,
          contentBackgroundAlpha: contentBackground.a,
          options,
          copyLayouts,
        }
      })
    })

    assert.deepEqual(
      result.map((sample) => sample.id),
      ["prompt-profile", "agent-model", "settings-form", "app-dialog", "browser-preview", "log-level"],
    )

    for (const sample of result) {
      assert.equal(sample.contentBackgroundAlpha, 1, `${sample.id} popup background must be opaque`)
      assert.ok(sample.options.length >= 2, `${sample.id} should include selected and unselected options`)
      assert.ok(
        sample.options.some((option) => !option.selected),
        `${sample.id} must cover at least one unselected option`,
      )
      for (const copy of sample.copyLayouts.filter((layout) => layout.hasDescription)) {
        assert.equal(copy.display, "flex", `${sample.id} described option copy must use shared flex layout`)
        assert.equal(copy.flexDirection, "column", `${sample.id} described option copy must stack label and description`)
        assert.equal(copy.descriptionBelow, true, `${sample.id} description must render below the label`)
      }
      for (const option of sample.options) {
        assert.equal(option.surfaceAlpha, 1, `${sample.id} option surface must composite to opaque`)
        assert.notEqual(option.color, "rgba(0, 0, 0, 0)", `${sample.id} option text must not be transparent`)
        assert.ok(option.contrast >= 4.5, `${sample.id} option "${option.text}" contrast ${option.contrast}`)
        for (const part of option.textParts) {
          assert.notEqual(part.color, "rgba(0, 0, 0, 0)", `${sample.id} ${part.tag} must not be transparent`)
          assert.ok(part.contrast >= 4.5, `${sample.id} ${part.tag} "${part.text}" contrast ${part.contrast}`)
        }
      }
    }
  } finally {
    await browser.close()
  }
})
