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

async function saveScreenshot(element: { screenshot(options?: Record<string, unknown>): Promise<Buffer> }, name: string) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  await writeFile(target, await element.screenshot({}))
  return target
}

test("live session dialog body renders without retired section or diff dialog selectors", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 820, height: 620 })
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
          <div id="sessionDialog" class="dialog dialog-wide" role="dialog" aria-modal="true">
            <div class="dialog-overlay" data-dialog-modal="true"></div>
            <section class="dialog-form">
              <header class="dialog-header">
                <h2 class="dialog-title">Build Session</h2>
                <div class="dialog-header-actions">
                  <button class="oc-button" data-size="sm" data-variant="ghost" type="button">Close</button>
                </div>
              </header>
              <div class="session-dialog-body" id="sessionDialogBody">
                <div class="session-msg" data-role="assistant">
                  <span class="session-msg-role">assistant</span>
                  <div class="session-msg-text md-content">
                    <p>Session transcript renders through the current session dialog body.</p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </body>
      </html>
    `)

    await page.waitForSelector(".session-dialog-body")
    const state = await page.$eval(".session-dialog-body", (node) => {
      const body = node as HTMLElement
      const style = getComputedStyle(body)
      const rect = body.getBoundingClientRect()
      const retired = Array.from(
        document.querySelectorAll(
          ".section-dialog-head, .section-dialog-meta, .section-dialog-body, .session-actions, .diff-dialog-head, .diff-dialog-form",
        ),
      ).length
      const nestedTitleCount = document.querySelectorAll(".dialog-title .dialog-title").length
      return {
        retired,
        nestedTitleCount,
        titleCount: document.querySelectorAll(".dialog-header > .dialog-title").length,
        width: rect.width,
        height: rect.height,
        borderTopWidth: style.borderTopWidth,
        backgroundColor: style.backgroundColor,
        text: body.textContent?.trim() ?? "",
      }
    })

    assert.equal(state.retired, 0)
    assert.equal(state.nestedTitleCount, 0)
    assert.equal(state.titleCount, 1)
    assert.ok(state.width > 240)
    assert.ok(state.height > 40)
    assert.equal(state.borderTopWidth, "1px")
    assert.notEqual(state.backgroundColor, "rgba(0, 0, 0, 0)")
    assert.match(state.text, /Session transcript/)

    const form = await page.$(".dialog-form")
    assert.ok(form)
    const screenshot = await saveScreenshot(form, "session-dialog-residue-live-dialog.png")
    assert.ok(screenshot.endsWith("session-dialog-residue-live-dialog.png"))
  } finally {
    await browser.close()
  }
})
