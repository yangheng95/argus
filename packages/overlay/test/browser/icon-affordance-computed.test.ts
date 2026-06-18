import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"

const OVERLAY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function css(relativePath: string): string {
  return readFileSync(path.join(OVERLAY_ROOT, relativePath), "utf8")
}

function styleSheet(): string {
  return [
    "src/styles/tokens/design-language.css",
    "src/styles/cascade/light.css",
    "src/styles/cascade/base.css",
    "src/styles/primitives/button.css",
    "src/styles/surfaces/composer.css",
    "src/styles/surfaces/card.css",
  ]
    .map(css)
    .join("\n")
}

test(
  "critical icon affordances keep readable computed contrast",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const browser = await launchBrowser()
    try {
      const page = await browser.newPage()
      const fixtureHtml = `
      <!doctype html>
      <html data-theme="light">
        <head><style>${styleSheet()}</style></head>
        <body data-theme="light">
          <main style="padding: 24px; display: grid; gap: 24px; background: var(--body-bg);">
            <form class="chat-input">
              <div class="chat-compose-row">
                <div class="chat-textarea-wrap">
                  <textarea class="chat-textarea" disabled></textarea>
                </div>
                <button class="oc-button" data-variant="solid" data-size="md" data-tone="accent" data-mode="send" disabled>
                  <span class="chat-send-icon">
                    <span aria-hidden="true">Send</span>
                  </span>
                  <span class="chat-send-label">Send</span>
                </button>
              </div>
            </form>
          </main>
        </body>
      </html>
    `
      await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(fixtureHtml)}`)

      const report = await page.evaluate(() => {
        type Rgb = { r: number; g: number; b: number; a: number }
        const parseColor = (value: string): Rgb => {
          const rgb = value.match(/rgba?\(([^)]+)\)/)
          if (rgb) {
            const parts = rgb[1]!.split(/,\s*/).map(Number)
            return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 }
          }
          const srgb = value.match(/color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+))?\)/)
          if (srgb) {
            return {
              r: Number(srgb[1]) * 255,
              g: Number(srgb[2]) * 255,
              b: Number(srgb[3]) * 255,
              a: srgb[4] ? Number(srgb[4]) : 1,
            }
          }
          throw new Error(`Unsupported computed color: ${value}`)
        }
        const luminance = (c: Rgb) => {
          const channel = (v: number) => {
            const s = v / 255
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
          }
          return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
        }
        const contrast = (fg: string, bg: string) => {
          const a = luminance(parseColor(fg))
          const b = luminance(parseColor(bg))
          const hi = Math.max(a, b)
          const lo = Math.min(a, b)
          return (hi + 0.05) / (lo + 0.05)
        }
        const read = (fgSelector: string, bgSelector: string) => {
          const fg = document.querySelector(fgSelector)
          const bg = document.querySelector(bgSelector)
          if (!(fg instanceof HTMLElement) || !(bg instanceof HTMLElement)) {
            throw new Error(`Missing fixture nodes: ${fgSelector} / ${bgSelector}`)
          }
          const fgStyle = getComputedStyle(fg)
          const bgStyle = getComputedStyle(bg)
          return {
            fg: fgStyle.color,
            bg: bgStyle.backgroundColor,
            fgOpacity: fgStyle.opacity,
            bgOpacity: bgStyle.opacity,
            ratio: contrast(fgStyle.color, bgStyle.backgroundColor),
          }
        }
        return {
          send: read(".chat-send-icon", '.oc-button[data-mode="send"]'),
        }
      })

      assert.equal(report.send.fgOpacity, "1")
      assert.ok(report.send.ratio >= 4.5, `expected send icon contrast >= 4.5, got ${report.send.ratio}`)
    } finally {
      await browser.close()
    }
  },
  { timeout: 120_000 },
)
