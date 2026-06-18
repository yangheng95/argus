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

async function saveScreenshot(element: { screenshot(options?: Record<string, unknown>): Promise<Buffer> }, name: string) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  await writeFile(target, await element.screenshot({}))
  return target
}

test("Mission and Coding Assistant ledger rows expose one keyboard selection control", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const css = [
    readCss("tokens/design-language.css"),
    readCss("cascade/base.css"),
    readCss("cascade/light.css"),
    readCss("primitives/button.css"),
    readCss("surfaces/sidebar.css"),
  ].join("\n")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 820, height: 460 })
    await page.setContent(`
      <!doctype html>
      <html data-theme="light">
        <head>
          <style>
            ${css}
            :root { --ui-scale: 1; }
            body {
              margin: 0;
              padding: 24px;
              background: var(--bg);
              color: var(--text);
              font-family: var(--font);
            }
            .ledger-fixture {
              width: min(720px, calc(100vw - 48px));
              display: grid;
              gap: 10px;
            }
          </style>
        </head>
        <body data-theme="light">
          <main class="ledger-fixture">
            <div class="task-row-mini global-task-row mission-row" data-ui="mission-row" data-session-id="mission-a" data-active="true" title="Mission A">
              <span class="task-row-badge mission-row-kind-badge" aria-hidden="true">M</span>
              <div class="task-row-body">
                <button type="button" class="task-row-main mission-row-main" data-action="mission-select" aria-current="page">
                  <div class="task-row-head"><strong>Mission A</strong></div>
                </button>
              </div>
              <div class="task-row-right">
                <small class="task-row-stamp mission-row-stamp">now</small>
                <div class="task-row-actions">
                  <button type="button" class="oc-button" data-size="icon" data-variant="ghost" data-tone="neutral" data-chrome="icon-action" data-ui="task-row-cancel" data-action="mission-stop" aria-label="Stop">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>
                  </button>
                  <button type="button" class="oc-button" data-size="icon" data-variant="ghost" data-tone="neutral" data-chrome="icon-action" data-ui="task-row-rename" data-action="mission-rename" aria-label="Rename">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19h4L19 9l-4-4L5 15v4Z" fill="currentColor"/></svg>
                  </button>
                  <button type="button" class="oc-button" data-size="icon" data-variant="ghost" data-tone="danger" data-chrome="icon-action" data-ui="task-row-delete" data-action="mission-delete" aria-label="Delete">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10l-1 12H8L7 7Zm2-3h6l1 2H8l1-2Z" fill="currentColor"/></svg>
                  </button>
                </div>
              </div>
            </div>
            <div class="task-row-mini global-task-row coding-assistant-row" data-ui="coding-assistant-row" data-session-id="assistant-a" title="Assistant A">
              <span class="task-row-badge coding-assistant-row-kind-badge" aria-hidden="true">A</span>
              <div class="task-row-body">
                <button type="button" class="task-row-main coding-assistant-row-main" data-action="assistant-select">
                  <div class="task-row-head"><strong>Assistant A</strong></div>
                </button>
              </div>
              <div class="task-row-right">
                <small class="task-row-stamp coding-assistant-row-stamp">now</small>
                <div class="task-row-actions">
                  <button type="button" class="oc-button" data-size="icon" data-variant="ghost" data-tone="neutral" data-chrome="icon-action" data-ui="task-row-cancel" data-action="assistant-stop" aria-label="Stop">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>
                  </button>
                  <button type="button" class="oc-button" data-size="icon" data-variant="ghost" data-tone="neutral" data-chrome="icon-action" data-ui="task-row-rename" data-action="assistant-rename" aria-label="Rename">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19h4L19 9l-4-4L5 15v4Z" fill="currentColor"/></svg>
                  </button>
                  <button type="button" class="oc-button" data-size="icon" data-variant="ghost" data-tone="danger" data-chrome="icon-action" data-ui="task-row-delete" data-action="assistant-delete" aria-label="Delete">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10l-1 12H8L7 7Zm2-3h6l1 2H8l1-2Z" fill="currentColor"/></svg>
                  </button>
                </div>
              </div>
            </div>
          </main>
          <script>
            window.__ledgerEvents = []
            for (const node of document.querySelectorAll("[data-action]")) {
              node.addEventListener("click", () => window.__ledgerEvents.push(node.getAttribute("data-action")))
            }
          </script>
        </body>
      </html>
    `)

    const fixture = await page.$(".ledger-fixture")
    assert.ok(fixture)
    await page.hover('[data-ui="mission-row"]')
    await saveScreenshot(fixture, "ledger-row-interactions.png")

    const structure = await page.evaluate(() => {
      const missionRow = document.querySelector('[data-ui="mission-row"]') as HTMLElement
      const assistantRow = document.querySelector('[data-ui="coding-assistant-row"]') as HTMLElement
      return {
        missionRole: missionRow.getAttribute("role"),
        missionTabindex: missionRow.getAttribute("tabindex"),
        assistantRole: assistantRow.getAttribute("role"),
        assistantTabindex: assistantRow.getAttribute("tabindex"),
        missionCurrent: missionRow.querySelector(".mission-row-main")?.getAttribute("aria-current"),
        assistantCurrent: assistantRow.querySelector(".coding-assistant-row-main")?.getAttribute("aria-current"),
        missionButtons: missionRow.querySelectorAll("button").length,
        assistantButtons: assistantRow.querySelectorAll("button").length,
      }
    })

    assert.equal(structure.missionRole, null)
    assert.equal(structure.missionTabindex, null)
    assert.equal(structure.assistantRole, null)
    assert.equal(structure.assistantTabindex, null)
    assert.equal(structure.missionCurrent, "page")
    assert.equal(structure.assistantCurrent, null)
    assert.equal(structure.missionButtons, 4)
    assert.equal(structure.assistantButtons, 4)

    const focused: string[] = []
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Tab")
      focused.push(
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("data-action") || ""),
      )
    }
    assert.deepEqual(focused, [
      "mission-select",
      "mission-stop",
      "mission-rename",
      "mission-delete",
      "assistant-select",
      "assistant-stop",
      "assistant-rename",
      "assistant-delete",
    ])

    await page.hover('[data-ui="mission-row"]')
    await page.click('[data-action="mission-stop"]')
    await page.hover('[data-ui="coding-assistant-row"]')
    await page.click('[data-action="assistant-delete"]')
    await page.click('[data-action="assistant-select"]')
    assert.deepEqual(
      await page.evaluate(() => (window as unknown as { __ledgerEvents: string[] }).__ledgerEvents),
      ["mission-stop", "assistant-delete", "assistant-select"],
    )
  } finally {
    await browser.close()
  }
})
