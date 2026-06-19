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

test("app dialog task decision segmented control stays readable in light theme", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const css = [
    readCss("tokens/design-language.css"),
    readCss("cascade/base.css"),
    readCss("cascade/light.css"),
    readCss("surfaces/dialog.css"),
  ].join("\n")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 720, height: 520 })
    await page.setContent(`
      <!doctype html>
      <html data-theme="light">
        <head>
          <style>
            ${css}
            :root {
              --ui-scale: 1;
              --dialog-drag-x: 0px;
              --dialog-drag-y: 0px;
            }
            body {
              min-height: 100vh;
              display: grid;
              place-items: center;
              margin: 0;
              background: var(--bg);
              color: var(--text);
              font-family: var(--font);
            }
          </style>
        </head>
        <body data-theme="light">
          <div id="appDialog" class="dialog" role="dialog" aria-modal="true">
            <form class="dialog-form app-dialog-form--decision">
              <header class="dialog-header">
                <h2 class="dialog-title">New Task Queue</h2>
              </header>
              <div class="app-dialog-decision" id="appDialogBody" data-kind="task-queue-decision">
                <div class="app-dialog-decision__copy">
                  <span class="app-dialog-decision__eyebrow">Task Queue</span>
                  <p>Should this new task wait in the queue or start when the directory is idle?</p>
                </div>
                <div class="app-dialog-decision__choices" aria-label="Start mode">
                  <button class="app-dialog-decision__choice" aria-pressed="true" data-pressed="" data-tone="neutral" data-value="start" data-recommended="true" type="button">
                    <span class="app-dialog-decision__choice-top">
                      <span>Start when idle</span>
                      <span class="app-dialog-decision__badge">Recommended</span>
                    </span>
                    <span class="app-dialog-decision__choice-body">Start as soon as this directory is idle; if a task is already active in the same directory, enter the directory queue.</span>
                  </button>
                  <button class="app-dialog-decision__choice" aria-pressed="false" data-tone="neutral" data-value="queue" data-recommended="false" type="button">
                    <span class="app-dialog-decision__choice-top">
                      <span>Wait in queue</span>
                    </span>
                    <span class="app-dialog-decision__choice-body">Enter the directory queue and start after the current same-directory task finishes.</span>
                  </button>
                </div>
                <div class="app-dialog-decision__timer" aria-live="polite">
                  <span>Recommended start mode applies in 8s</span>
                  <span class="app-dialog-decision__timer-track" aria-hidden="true">
                    <span class="app-dialog-decision__timer-fill" style="width: 72%"></span>
                  </span>
                </div>
              </div>
            </form>
          </div>
        </body>
      </html>
    `)

    const form = await page.$(".app-dialog-form--decision")
    assert.ok(form)
    await saveScreenshot(form, "app-dialog-segmented-control.png")

    const metrics = await page.evaluate(() => {
      const choices = document.querySelector(".app-dialog-decision__choices") as HTMLElement
      const active = document.querySelector('.app-dialog-decision__choice[data-value="start"]') as HTMLElement
      const inactive = document.querySelector('.app-dialog-decision__choice[data-value="queue"]') as HTMLElement
      const form = document.querySelector(".app-dialog-form--decision") as HTMLElement
      const formRect = form.getBoundingClientRect()
      const activeStyle = getComputedStyle(active)
      const inactiveStyle = getComputedStyle(inactive)
      const badgeStyle = getComputedStyle(active.querySelector(".app-dialog-decision__badge") as HTMLElement)
      const bodyStyle = getComputedStyle(active.querySelector(".app-dialog-decision__choice-body") as HTMLElement)
      const choicesRect = choices.getBoundingClientRect()
      const inactiveRect = inactive.getBoundingClientRect()
      return {
        choiceDisplay: getComputedStyle(choices).display,
        columns: getComputedStyle(choices).gridTemplateColumns.split(" ").length,
        formLeft: Math.round(formRect.left),
        formRight: Math.round(formRect.right),
        choicesClientWidth: Math.round(choices.clientWidth),
        choicesScrollWidth: Math.round(choices.scrollWidth),
        choicesLeft: Math.round(choicesRect.left),
        inactiveRight: Math.round(inactiveRect.right),
        choicesRight: Math.round(choicesRect.right),
        activeAttr: active.getAttribute("data-pressed"),
        pressedAttr: active.getAttribute("aria-pressed"),
        selectedAttr: active.getAttribute("data-selected"),
        activeBorder: activeStyle.borderColor,
        inactiveBorder: inactiveStyle.borderColor,
        activeBg: activeStyle.backgroundColor,
        inactiveBg: inactiveStyle.backgroundColor,
        badgeColor: badgeStyle.color,
        bodyColor: bodyStyle.color,
        activeText: active.textContent || "",
        activeAppearance: activeStyle.appearance,
        activeFont: activeStyle.fontFamily,
        formWidth: Math.round(formRect.width),
        formHeight: Math.round(formRect.height),
      }
    })

    assert.equal(metrics.choiceDisplay, "grid")
    assert.equal(metrics.columns, 2)
    assert.ok(metrics.choicesScrollWidth <= metrics.choicesClientWidth)
    assert.ok(metrics.inactiveRight <= metrics.choicesRight)
    assert.ok(metrics.choicesLeft >= metrics.formLeft)
    assert.ok(metrics.inactiveRight <= metrics.formRight)
    assert.equal(metrics.activeAttr, "")
    assert.equal(metrics.pressedAttr, "true")
    assert.equal(metrics.selectedAttr, null)
    assert.notEqual(metrics.activeBorder, metrics.inactiveBorder)
    assert.notEqual(metrics.activeBg, metrics.inactiveBg)
    assert.notEqual(metrics.badgeColor, "rgba(0, 0, 0, 0)")
    assert.notEqual(metrics.bodyColor, "rgba(0, 0, 0, 0)")
    assert.match(metrics.activeText, /Recommended/)
    assert.equal(metrics.activeAppearance, "none")
    assert.match(metrics.activeFont, /Inter|Segoe UI|Arial/)
    assert.ok(metrics.formWidth > 400)
    assert.ok(metrics.formHeight > 260)
  } finally {
    await browser.close()
  }
})
