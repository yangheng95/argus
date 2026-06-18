import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

function readCss(relativePath: string): string {
  return readFileSync(join(OVERLAY_ROOT, "src/styles", relativePath), "utf8")
}

function styleSheet(): string {
  return [
    "tokens/design-language.css",
    "cascade/base.css",
    "cascade/light.css",
    "primitives/button.css",
    "surfaces/composer.css",
  ]
    .map(readCss)
    .join("\n")
}

test(
  "chat composer action buttons use Button primitive chrome",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const browser = await launchBrowser(["--disable-dev-shm-usage"])
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 900, height: 520 })
      await page.setContent(`
        <!doctype html>
        <html data-theme="light">
          <head>
            <style>
              ${styleSheet()}
              body {
                margin: 0;
                padding: var(--ui-gap-lg);
                background: var(--bg);
              }
              .composer-primitive-stage {
                display: grid;
                gap: var(--ui-gap-md);
                max-width: calc(680px * var(--ui-scale));
              }
            </style>
          </head>
          <body data-theme="light">
            <main class="composer-primitive-stage">
              <form class="chat-input" data-case="ready">
                <div class="chat-attachments" id="chatAttachments">
                  <div class="chat-attachment-item" title="world-economy.png">
                    <span class="chat-attachment-icon">PNG</span>
                    <span class="chat-attachment-name">world-economy.png</span>
                    <button class="oc-button" data-variant="ghost" data-size="icon" data-tone="neutral" data-chrome="icon-action" data-ui="chat-attachment-remove" type="button" aria-label="Remove attachment">
                      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    </button>
                  </div>
                </div>
                <div class="chat-compose-row">
                  <div class="chat-textarea-wrap">
                    <textarea class="chat-textarea" rows="2">Review this screenshot and keep the focus ring visible.</textarea>
                  </div>
                  <button class="oc-button" data-variant="solid" data-size="md" data-tone="accent" data-mode="send" type="submit" id="chatSend">
                    <span class="chat-send-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16"><path d="M3 8h8M8 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </span>
                    <span class="chat-send-label">Send</span>
                  </button>
                </div>
              </form>
              <form class="chat-input" data-case="disabled">
                <div class="chat-compose-row">
                  <div class="chat-textarea-wrap">
                    <textarea class="chat-textarea" rows="2" disabled></textarea>
                  </div>
                  <button class="oc-button" data-variant="solid" data-size="md" data-tone="accent" data-mode="send" type="submit" disabled>
                    <span class="chat-send-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16"><path d="M3 8h8M8 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </span>
                    <span class="chat-send-label">Send</span>
                  </button>
                </div>
              </form>
              <form class="chat-input" data-case="busy">
                <div class="chat-compose-row">
                  <div class="chat-textarea-wrap">
                    <textarea class="chat-textarea" rows="2">Interrupt the active task.</textarea>
                  </div>
                  <button class="oc-button" data-variant="solid" data-size="md" data-tone="danger" data-mode="stop" data-busy="true" type="button" id="btnTaskInterrupt">
                    <span class="chat-send-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" stroke="none"/></svg>
                    </span>
                    <span class="chat-send-label">Stop</span>
                  </button>
                </div>
              </form>
            </main>
          </body>
        </html>
      `)

      await page.keyboard.press("Tab")
      const removeFocus = await page.$eval('[data-ui="chat-attachment-remove"]', (node: HTMLElement) => {
        const style = getComputedStyle(node)
        return {
          className: node.className,
          focusVisible: node.matches(":focus-visible"),
          outlineStyle: style.outlineStyle,
          width: Math.round(node.getBoundingClientRect().width),
        }
      })
      assert.match(removeFocus.className, /\boc-button\b/)
      assert.equal(removeFocus.focusVisible, true)
      assert.notEqual(removeFocus.outlineStyle, "none")
      assert.ok(removeFocus.width > 0)

      const sendSelector = '[data-case="ready"] .oc-button[data-mode="send"]'
      const sendBeforeHover = await page.$eval(sendSelector, (node) => getComputedStyle(node).backgroundColor)
      await page.hover(sendSelector)
      const sendAfterHover = await page.$eval(sendSelector, (node) => getComputedStyle(node).backgroundColor)

      const metrics = await page.evaluate(() => {
        const ready = document.querySelector<HTMLElement>('[data-case="ready"] .oc-button[data-mode="send"]')
        const disabled = document.querySelector<HTMLElement>('[data-case="disabled"] .oc-button[data-mode="send"]')
        const stop = document.querySelector<HTMLElement>('[data-case="busy"] .oc-button[data-mode="stop"]')
        const remove = document.querySelector<HTMLElement>('[data-ui="chat-attachment-remove"]')
        if (!ready || !disabled || !stop || !remove) throw new Error("missing composer primitive fixture nodes")
        return {
          legacyClassCount: document.querySelectorAll(".chat-send, .chat-attachment-remove").length,
          readyClass: ready.className,
          readyVariant: ready.getAttribute("data-variant"),
          readyTone: ready.getAttribute("data-tone"),
          readyHeight: Math.round(ready.getBoundingClientRect().height),
          disabledOpacity: getComputedStyle(disabled).opacity,
          stopTone: stop.getAttribute("data-tone"),
          stopMode: stop.getAttribute("data-mode"),
          removeClass: remove.className,
          removeChrome: remove.getAttribute("data-chrome"),
        }
      })

      assert.equal(metrics.legacyClassCount, 0)
      assert.match(metrics.readyClass, /\boc-button\b/)
      assert.equal(metrics.readyVariant, "solid")
      assert.equal(metrics.readyTone, "accent")
      assert.ok(metrics.readyHeight >= 54)
      assert.equal(metrics.disabledOpacity, "1")
      assert.equal(metrics.stopTone, "danger")
      assert.equal(metrics.stopMode, "stop")
      assert.match(metrics.removeClass, /\boc-button\b/)
      assert.equal(metrics.removeChrome, "icon-action")
      assert.notEqual(sendBeforeHover, sendAfterHover)

      const stage = await page.$(".composer-primitive-stage")
      assert.ok(stage)
      const screenshotPath = resolve(".scratch/chat-composer-button-primitives.png")
      mkdirSync(dirname(screenshotPath), { recursive: true })
      writeFileSync(screenshotPath, await stage.screenshot({}))
    } finally {
      await browser.close()
    }
  },
  { timeout: 120_000 },
)
