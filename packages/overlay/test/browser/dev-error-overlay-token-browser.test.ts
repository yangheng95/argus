import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")
const SOURCE = readFileSync(join(OVERLAY_ROOT, "src/utils/dev-error.ts"), "utf8")

function readCss(rel: string): string {
  return readFileSync(join(OVERLAY_ROOT, "src/styles", rel), "utf8")
}

function devErrorCss(): string {
  const match = SOURCE.match(/const DEV_ERROR_CSS = `([\s\S]*)`\s*$/)
  if (!match) throw new Error("DEV_ERROR_CSS template not found")
  return match[1]
}

test("dev error overlay CSS resolves through theme tokens in browser", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const css = [
    readCss("tokens/design-language.css"),
    readCss("cascade/base.css"),
    readCss("cascade/light.css"),
    devErrorCss(),
  ].join("\n")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 520, height: 260 })
    await page.setContent(`
      <!doctype html>
      <html data-theme="light">
        <head>
          <style>
            ${css}
            :root { --ui-scale: 1; }
            body {
              margin: 0;
              min-height: 260px;
              background: var(--bg);
              color: var(--text);
              font-family: var(--font);
            }
          </style>
        </head>
        <body data-theme="light">
          <section id="devErrorOverlay" aria-label="Dev error overlay fixture">
            <div class="dev-error-header">
              <span class="dev-error-title">Dev Errors</span>
              <span class="dev-error-badge dev-error-badge--error">1</span>
              <button class="dev-error-clear" type="button">x</button>
            </div>
            <div class="dev-error-list">
              <div class="dev-error-entry dev-error-entry--error">
                <span class="dev-error-level">ERROR</span>
                <span class="dev-error-time">10:30:00</span>
                <span class="dev-error-loc">OverlayRender</span>
                <span class="dev-error-count">x2</span>
                <div class="dev-error-msg">Tokenized dev overlay error text.</div>
                <button class="dev-error-dismiss" type="button">x</button>
              </div>
              <div class="dev-error-entry dev-error-entry--warn">
                <span class="dev-error-level">WARN</span>
                <span class="dev-error-time">10:31:00</span>
                <span class="dev-error-loc">OverlayStore</span>
                <div class="dev-error-msg">Tokenized dev overlay warning text.</div>
                <button class="dev-error-dismiss" type="button">x</button>
              </div>
            </div>
          </section>
        </body>
      </html>
    `)

    const metrics = await page.$eval("#devErrorOverlay", (overlay: HTMLElement) => {
      const title = overlay.querySelector<HTMLElement>(".dev-error-title")
      const badge = overlay.querySelector<HTMLElement>(".dev-error-badge")
      const errorLevel = overlay.querySelector<HTMLElement>(".dev-error-entry--error .dev-error-level")
      const warnLevel = overlay.querySelector<HTMLElement>(".dev-error-entry--warn .dev-error-level")
      const message = overlay.querySelector<HTMLElement>(".dev-error-msg")
      if (!title || !badge || !errorLevel || !warnLevel || !message) throw new Error("fixture did not render")
      const rect = overlay.getBoundingClientRect()
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        background: getComputedStyle(overlay).backgroundColor,
        borderColor: getComputedStyle(overlay).borderTopColor,
        titleColor: getComputedStyle(title).color,
        badgeBackground: getComputedStyle(badge).backgroundColor,
        errorColor: getComputedStyle(errorLevel).color,
        warnColor: getComputedStyle(warnLevel).color,
        messageColor: getComputedStyle(message).color,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
      }
    })

    assert.ok(metrics.width >= 400, `overlay width should render: ${JSON.stringify(metrics)}`)
    assert.ok(metrics.height > 80, `overlay entries should render: ${JSON.stringify(metrics)}`)
    for (const [key, value] of Object.entries(metrics)) {
      if (typeof value !== "string") continue
      assert.notEqual(value, "rgba(0, 0, 0, 0)", `${key} should resolve to a visible token color`)
      assert.notEqual(value, "transparent", `${key} should resolve to a visible token color`)
    }
    assert.ok(metrics.overflowX <= 1, `fixture should not overflow horizontally: ${JSON.stringify(metrics)}`)

    const screenshotPath = resolve(SCRATCH_ROOT, "dev-error-overlay-token-source.png")
    mkdirSync(dirname(screenshotPath), { recursive: true })
    const screenshot = await page.screenshot({ fullPage: false })
    assert.ok(screenshot.length > 0)
    writeFileSync(screenshotPath, screenshot)
  } finally {
    await browser.close()
  }
})
