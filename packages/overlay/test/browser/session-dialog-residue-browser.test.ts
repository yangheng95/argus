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

function sessionDialogFixture(bodyHtml: string): string {
  return `
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
            <div class="session-dialog-body" id="sessionDialogBody">${bodyHtml}</div>
          </section>
        </div>
      </body>
    </html>
  `
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

test("session dialog service-owned body states render without host fallback copy", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 820, height: 620 })

    const cases = [
      {
        name: "loading",
        html: '<p class="empty-hint">Loading…</p>',
        text: "Loading…",
        screenshot: "session-dialog-body-loading.png",
      },
      {
        name: "empty",
        html: '<p class="empty-hint">No messages yet.</p>',
        text: "No messages yet.",
        screenshot: "session-dialog-body-empty.png",
      },
      {
        name: "error",
        html: '<p class="empty-hint">Failed to load session: upstream unavailable</p>',
        text: "Failed to load session: upstream unavailable",
        screenshot: "session-dialog-body-error.png",
      },
    ]

    for (const item of cases) {
      await page.setContent(sessionDialogFixture(item.html))
      await page.waitForSelector(".session-dialog-body")
      const state = await page.$eval(".dialog-form", (node) => {
        const form = node as HTMLElement
        const body = form.querySelector<HTMLElement>(".session-dialog-body")!
        const bodyStyle = getComputedStyle(body)
        const rect = form.getBoundingClientRect()
        return {
          width: rect.width,
          height: rect.height,
          text: body.textContent?.trim() ?? "",
          bodyBackground: bodyStyle.backgroundColor,
          bodyBorderTop: bodyStyle.borderTopWidth,
          fallbackCopy: body.textContent?.includes("Loading...") ?? false,
        }
      })

      assert.ok(state.width > 260, `${item.name} dialog should have visible width`)
      assert.ok(state.height > 90, `${item.name} dialog should have visible height`)
      assert.equal(state.text, item.text)
      assert.equal(state.fallbackCopy, false)
      assert.notEqual(state.bodyBackground, "rgba(0, 0, 0, 0)")
      assert.equal(state.bodyBorderTop, "1px")

      const form = await page.$(".dialog-form")
      assert.ok(form)
      const screenshot = await saveScreenshot(form, item.screenshot)
      assert.ok(screenshot.endsWith(item.screenshot))
    }
  } finally {
    await browser.close()
  }
})
