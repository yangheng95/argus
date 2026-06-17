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

test(
  "agent reply box primitive layout stays readable with long text and errors",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const css = [
      readCss("tokens/design-language.css"),
      readCss("cascade/base.css"),
      readCss("cascade/light.css"),
      readCss("primitives/button.css"),
      readCss("surfaces/card.css"),
    ].join("\n")

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 900, height: 680 })
      await page.setContent(`
        <!doctype html>
        <html data-theme="light">
          <head>
            <style>
              ${css}
              :root {
                --ui-scale: 1;
                --conversation-card-inline-size: min(720px, 100%);
                --card-min-inline-size: 0px;
                --card-sticky-inline-size: 0px;
              }
              body {
                margin: 0;
                padding: 24px;
                background: var(--bg);
              }
              .reply-visual-stage {
                width: min(760px, calc(100vw - 48px));
              }
              .card__body {
                padding: 14px;
              }
            </style>
          </head>
          <body data-theme="light">
            <main class="reply-visual-stage">
              <section class="card" data-depth="0" data-kind="step" data-stage="build">
                <header class="card__head">
                  <span class="card__title">Build agent session</span>
                </header>
                <div class="card__body">
                  <form class="card__agent-reply" data-case="active">
                    <textarea class="card__agent-reply-input" rows="2" style="height: 58px">Please retry the layout pass.
Keep the follow-up instruction visible.
Confirm the screenshot evidence.
Report the exact terminal state.</textarea>
                    <button class="oc-button" data-variant="solid" data-size="sm" data-tone="accent" data-ui="agent-reply-send" type="submit">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M12 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      <span>Send</span>
                    </button>
                  </form>
                  <form class="card__agent-reply" data-case="disabled">
                    <textarea class="card__agent-reply-input" rows="2" style="height: 58px" disabled>Sending state keeps the same geometry.</textarea>
                    <button class="oc-button" data-variant="solid" data-size="sm" data-tone="accent" data-ui="agent-reply-send" type="submit" disabled>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M12 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      <span>Sending</span>
                    </button>
                  </form>
                  <form class="card__agent-reply" data-case="error">
                    <textarea class="card__agent-reply-input" rows="2" style="height: 58px">Retry keeps the draft text.</textarea>
                    <button class="oc-button" data-variant="solid" data-size="sm" data-tone="accent" data-ui="agent-reply-send" type="submit">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M12 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      <span>Send</span>
                    </button>
                    <div class="card__agent-reply-error" role="alert">
                      <span class="card__agent-reply-error-msg">Session reply failed with a structured diagnostic. The message is intentionally long enough to wrap without pushing the close action outside the card.</span>
                      <button class="oc-button" data-variant="ghost" data-size="icon" data-tone="danger" data-chrome="icon-action" data-ui="agent-reply-error-dismiss" type="button">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                      </button>
                    </div>
                  </form>
                </div>
              </section>
            </main>
          </body>
        </html>
      `)
      await page.focus('.card__agent-reply[data-case="active"] .card__agent-reply-input')

      const metrics = await page.evaluate(() => {
        const stage = document.querySelector(".reply-visual-stage") as HTMLElement
        const activeForm = document.querySelector('.card__agent-reply[data-case="active"]') as HTMLElement
        const activeInput = activeForm.querySelector(".card__agent-reply-input") as HTMLTextAreaElement
        const activeSend = activeForm.querySelector('[data-ui="agent-reply-send"]') as HTMLElement
        const disabledSend = document.querySelector('.card__agent-reply[data-case="disabled"] [data-ui="agent-reply-send"]') as
          | HTMLButtonElement
          | null
        const errorForm = document.querySelector('.card__agent-reply[data-case="error"]') as HTMLElement
        const error = errorForm.querySelector(".card__agent-reply-error") as HTMLElement
        const dismiss = error.querySelector('[data-ui="agent-reply-error-dismiss"]') as HTMLElement
        const formRect = activeForm.getBoundingClientRect()
        const inputRect = activeInput.getBoundingClientRect()
        const sendRect = activeSend.getBoundingClientRect()
        const errorRect = error.getBoundingClientRect()
        const stageRect = stage.getBoundingClientRect()
        const dismissRect = dismiss.getBoundingClientRect()
        const inputStyle = getComputedStyle(activeInput)
        const sendStyle = getComputedStyle(activeSend)
        const dismissStyle = getComputedStyle(dismiss)
        return {
          inputOverflowY: inputStyle.overflowY,
          inputScrolls: activeInput.scrollHeight > activeInput.clientHeight,
          inputHeight: Math.round(inputRect.height),
          sendInsideInput:
            sendRect.right <= inputRect.right - 4 &&
            sendRect.left >= inputRect.left &&
            sendRect.top >= inputRect.top &&
            sendRect.bottom <= inputRect.bottom,
          sendInsideForm: sendRect.right <= formRect.right && sendRect.left >= formRect.left,
          sendClass: activeSend.className,
          sendVariant: activeSend.getAttribute("data-variant"),
          sendSize: activeSend.getAttribute("data-size"),
          sendBg: sendStyle.backgroundColor,
          disabledOpacity: disabledSend ? getComputedStyle(disabledSend).opacity : "",
          errorInsideStage: errorRect.left >= stageRect.left && errorRect.right <= stageRect.right,
          dismissInsideError: dismissRect.right <= errorRect.right && dismissRect.left >= errorRect.left,
          dismissClass: dismiss.className,
          dismissSize: dismiss.getAttribute("data-size"),
          dismissColor: dismissStyle.color,
        }
      })

      assert.equal(metrics.inputOverflowY, "auto")
      assert.equal(metrics.inputScrolls, true)
      assert.equal(metrics.inputHeight, 58)
      assert.equal(metrics.sendInsideInput, true)
      assert.equal(metrics.sendInsideForm, true)
      assert.match(metrics.sendClass, /\boc-button\b/)
      assert.equal(metrics.sendVariant, "solid")
      assert.equal(metrics.sendSize, "sm")
      assert.notEqual(metrics.sendBg, "rgba(0, 0, 0, 0)")
      assert.notEqual(metrics.disabledOpacity, "1")
      assert.equal(metrics.errorInsideStage, true)
      assert.equal(metrics.dismissInsideError, true)
      assert.match(metrics.dismissClass, /\boc-button\b/)
      assert.equal(metrics.dismissSize, "icon")
      assert.notEqual(metrics.dismissColor, "rgba(0, 0, 0, 0)")

      const stage = await page.$(".reply-visual-stage")
      assert.ok(stage)
      const screenshot = await saveScreenshot(stage, "agent-reply-box-primitives.png")
      assert.ok(screenshot.endsWith("agent-reply-box-primitives.png"))
    } finally {
      await browser.close().catch(() => undefined)
    }
  },
  { timeout: 20_000 },
)
