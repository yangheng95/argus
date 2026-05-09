import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

import { launchBrowser } from "./launch"

const OVERLAY_ROOT = path.resolve(import.meta.dir, "..")

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
  ].map(css).join("\n")
}

test("critical icon affordances keep readable computed contrast", async () => {
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent(`
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
                <div class="chat-icon-col" data-disabled="true">
                  <button class="oc-button" data-variant="ghost" data-size="icon" data-tone="neutral" data-chrome="icon-action" data-ui="chat-toolbar-button">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="M13.5 7.5l-5.8 5.8a3.2 3.2 0 01-4.5-4.5L9 3a2 2 0 012.8 2.8L6 11.6a.8.8 0 01-1.1-1.1L10.5 5"/></svg>
                  </button>
                </div>
                <button class="chat-send" disabled>
                  <span class="chat-send-icon">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="M2 8l10-5-3 5 3 5z" fill="currentColor" stroke="none"/></svg>
                  </span>
                  <span class="chat-send-label">Send</span>
                </button>
              </div>
            </form>
          </main>
        </body>
      </html>
    `)

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
        send: read(".chat-send-icon", ".chat-send"),
        toolbar: read(".chat-icon-col .oc-button", ".chat-icon-col"),
      }
    })

    expect(report.send.fgOpacity).toBe("1")
    expect(report.send.ratio).toBeGreaterThanOrEqual(4.5)
    expect(report.toolbar.bgOpacity).toBe("0.85")
    expect(report.toolbar.ratio).toBeGreaterThanOrEqual(3)
  } finally {
    await browser.close()
  }
}, { timeout: 120_000 })
