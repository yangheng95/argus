import assert from "node:assert/strict"
import { mkdirSync, readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")

function overlayStyleHrefs(): string[] {
  const html = readFileSync(join(OVERLAY_ROOT, "src/index.html"), "utf8")
  const hrefs = Array.from(html.matchAll(/<link\s+rel="stylesheet"\s+href="styles\/([^"]+)"/g), (match) => match[1])
  if (hrefs.length === 0) throw new Error("No overlay stylesheet links found in src/index.html")
  return hrefs
}

function overlayCss(): string {
  return overlayStyleHrefs()
    .map((href) => readFileSync(join(OVERLAY_ROOT, "src/styles", href), "utf8"))
    .join("\n")
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

async function hoverBackground(
  page: { hover(selector: string): Promise<void>; $eval<T>(selector: string, fn: (node: Element) => T): Promise<T> },
  selector: string,
) {
  await page.hover(selector)
  return page.$eval(selector, (node) => getComputedStyle(node).backgroundColor)
}

test("live settings neighbor surfaces render without retired preference row selectors", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 960, height: 720 })
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
              background: var(--body-bg);
              color: var(--text);
              font-family: var(--font);
            }
          </style>
        </head>
        <body data-theme="light">
          <div id="configDialog">
            <section class="dialog-form">
              <div class="config-content" data-test-surface="pref-retire-neighbors">
                <section class="config-section">
                  <h3 class="config-section-title">Knowledge</h3>
                  <div class="knowledge-list">
                    <article class="knowledge-item" data-mode="browse">
                      <div class="knowledge-item-row">
                        <button class="oc-button knowledge-item-main" data-variant="ghost" data-size="sm" data-tone="neutral" data-ui="memory-row-main" type="button" aria-expanded="false">
                          <span class="knowledge-item-title">Market notes</span>
                          <span class="knowledge-item-meta-row">
                            <span class="knowledge-item-meta">Global memory</span>
                            <span class="knowledge-scope" data-scope="global">global</span>
                          </span>
                        </button>
                        <button class="oc-button" data-size="sm" data-variant="ghost" data-action="delete-memory" type="button">Delete</button>
                      </div>
                    </article>
                  </div>
                </section>
                <section class="config-section">
                  <h3 class="config-section-title">Skills</h3>
                  <article class="market-card">
                    <div class="market-card-main">
                      <strong>Browser Review</strong>
                      <span>Checks visible UI state with browser evidence.</span>
                      <small>Installed from local directory</small>
                    </div>
                    <div class="market-card-actions">
                      <button class="oc-button" data-size="sm" data-variant="secondary" type="button">Open</button>
                    </div>
                  </article>
                </section>
                <section class="config-section">
                  <h3 class="config-section-title">Channels</h3>
                  <article class="channel-doc-card">
                    <strong class="channel-doc-title">OpenAI channel</strong>
                    <p class="channel-doc-credit">Provider configuration help and diagnostics.</p>
                    <button class="oc-button" data-size="sm" data-variant="ghost" type="button">Copy</button>
                  </article>
                </section>
              </div>
            </section>
          </div>
        </body>
      </html>
    `)

    await page.waitForSelector("[data-test-surface='pref-retire-neighbors']")
    const state = await page.$eval("[data-test-surface='pref-retire-neighbors']", (node) => {
      const root = node as HTMLElement
      const retired = Array.from(
        document.querySelectorAll(".pref-item, .pref-item-head, .pref-item-key, .pref-item-value"),
      ).length
      const surfaces = [".knowledge-item", ".market-card", ".channel-doc-card"].map((selector) => {
        const element = root.querySelector<HTMLElement>(selector)
        if (!element) throw new Error(`Missing ${selector}`)
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return {
          selector,
          width: rect.width,
          height: rect.height,
          display: style.display,
          text: element.textContent?.trim() ?? "",
        }
      })
      const memoryTitle = root.querySelector<HTMLElement>(".knowledge-item-title")
      if (!memoryTitle) throw new Error("Missing .knowledge-item-title")
      const titleRect = memoryTitle.getBoundingClientRect()
      return {
        retired,
        surfaces,
        memoryTitle: {
          text: memoryTitle.textContent?.trim() ?? "",
          height: titleRect.height,
          width: titleRect.width,
        },
      }
    })

    assert.equal(state.retired, 0)
    assert.equal(state.memoryTitle.text, "Market notes")
    assert.ok(state.memoryTitle.height > 12, `.knowledge-item-title visible height ${state.memoryTitle.height}`)
    assert.ok(state.memoryTitle.width > 40, `.knowledge-item-title visible width ${state.memoryTitle.width}`)
    for (const surface of state.surfaces) {
      assert.ok(surface.width > 240, `${surface.selector} width`)
      assert.ok(surface.height > 24, `${surface.selector} height`)
      assert.notEqual(surface.display, "none", `${surface.selector} display`)
      assert.ok(surface.text.length > 0, `${surface.selector} text`)
    }

    for (const selector of [".knowledge-item", ".market-card", ".channel-doc-card"]) {
      const background = await hoverBackground(page, selector)
      assert.notEqual(background, "rgba(0, 0, 0, 0)", `${selector} hover background`)
    }

    const surface = await page.$("[data-test-surface='pref-retire-neighbors']")
    assert.ok(surface)
    const screenshot = await saveScreenshot(surface, "settings-neighbor-surfaces-pref-residue.png")
    assert.ok(screenshot.endsWith("settings-neighbor-surfaces-pref-residue.png"))
  } finally {
    await browser.close()
  }
})
