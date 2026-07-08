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
    "cascade/dark.css",
    "primitives/button.css",
    "surfaces/field.css",
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
        <html data-theme="dark">
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
          <body data-theme="dark">
            <main class="composer-primitive-stage">
              <div class="chat-composer-stack" data-stack="ready">
                <div class="chat-attachments" id="chatAttachments">
                  <div class="chat-attachment-item" title="world-economy.png">
                    <span class="chat-attachment-icon">PNG</span>
                    <span class="chat-attachment-name">world-economy.png</span>
                    <button class="oc-button" data-variant="ghost" data-size="icon" data-tone="neutral" data-chrome="icon-action" data-ui="chat-attachment-remove" type="button" aria-label="Remove attachment">
                      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    </button>
                  </div>
                </div>
                <form class="chat-input" data-case="ready">
                  <div class="chat-compose-row">
                    <div class="chat-textarea-wrap">
                      <textarea class="chat-textarea" rows="2">Review this screenshot and keep the focus ring visible.</textarea>
                    </div>
                  </div>
                  <div class="chat-compose-meta">
                    <div class="chat-compose-meta-left">
                      <div class="composer-mode-select-wrap">
                        <button class="composer-mode-select-trigger oc-select-trigger" type="button">
                          <span class="composer-mode-select-copy">
                            <span class="composer-mode-select-label">Mode</span>
                            <span class="composer-mode-select-value">Chat</span>
                          </span>
                          <span class="composer-mode-select-caret"></span>
                        </button>
                      </div>
                      <div class="expert-squad-select-wrap">
                        <button class="expert-squad-select-trigger oc-select-trigger" type="button">
                          <span class="expert-squad-select-copy">
                            <span class="expert-squad-select-label">Context</span>
                            <span class="expert-squad-select-value">IDE context</span>
                          </span>
                          <span class="expert-squad-select-caret"></span>
                        </button>
                      </div>
                      <div class="composer-model-selector" data-ui="composer-model-selector">
                        <button class="oc-button" data-variant="outline" data-size="sm" data-tone="neutral" data-ui="composer-model-selector-trigger" type="button" aria-label="OpenCorvus model: hexin/kimi-k2.7-code">
                          <span class="composer-model-selector-copy">
                            <span class="composer-model-selector-value">hexin/kimi-k2.7-code</span>
                            <span class="executor-budget-inline" data-ui="executor-hexin-budget" data-loading="false" data-over-budget="false" data-low-budget="true" role="status" aria-live="polite" aria-label="Remaining 19.99 / 4,435.30 · spent 4,415.31">
                              <span class="executor-budget-value">Hexin 19.99 / 4,435.30</span>
                            </span>
                          </span>
                        </button>
                      </div>
                    </div>
                    <div class="chat-compose-meta-right">
                      <div class="composer-attachment-loaders" data-ui="composer-attachment-loaders">
                        <button class="composer-attachment-loader-trigger oc-button" data-variant="ghost" data-size="icon" data-tone="neutral" type="button" aria-label="Attach file">
                          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8M8 4v8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
                        </button>
                        <span class="composer-attachment-loader-count">1 file</span>
                      </div>
                      <button class="oc-button" data-variant="solid" data-size="md" data-tone="accent" data-mode="send" type="submit" id="chatSend">
                        <span class="chat-send-icon" aria-hidden="true">
                          <svg viewBox="0 0 16 16"><path d="M3 8h8M8 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </span>
                        <span class="chat-send-label">Send</span>
                      </button>
                    </div>
                  </div>
                </form>
              </div>
              <div class="chat-composer-stack" data-stack="disabled">
                <form class="chat-input" data-case="disabled">
                  <div class="chat-compose-row">
                    <div class="chat-textarea-wrap">
                      <textarea class="chat-textarea" rows="2" disabled></textarea>
                    </div>
                  </div>
                  <div class="chat-compose-meta">
                    <div class="chat-compose-meta-left" aria-hidden="true"></div>
                    <div class="chat-compose-meta-right">
                      <button class="oc-button" data-variant="solid" data-size="md" data-tone="accent" data-mode="send" type="submit" disabled>
                        <span class="chat-send-icon" aria-hidden="true">
                          <svg viewBox="0 0 16 16"><path d="M3 8h8M8 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </span>
                        <span class="chat-send-label">Send</span>
                      </button>
                    </div>
                  </div>
                </form>
              </div>
              <div class="chat-composer-stack" data-stack="busy">
                <form class="chat-input" data-case="busy">
                  <div class="chat-compose-row">
                    <div class="chat-textarea-wrap">
                      <textarea class="chat-textarea" rows="2">Interrupt the active task.</textarea>
                    </div>
                  </div>
                  <div class="chat-compose-meta">
                    <div class="chat-compose-meta-left" aria-hidden="true"></div>
                    <div class="chat-compose-meta-right">
                      <button class="oc-button" data-variant="solid" data-size="md" data-tone="danger" data-mode="stop" data-busy="true" type="button" id="btnTaskInterrupt">
                        <span class="chat-send-icon" aria-hidden="true">
                          <svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" stroke="none"/></svg>
                        </span>
                        <span class="chat-send-label">Stop</span>
                      </button>
                    </div>
                  </div>
                </form>
              </div>
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
        const stage = document.querySelector<HTMLElement>(".composer-primitive-stage")
        const stack = document.querySelector<HTMLElement>('[data-stack="ready"]')
        const form = document.querySelector<HTMLElement>('[data-case="ready"]')
        const attachments = document.querySelector<HTMLElement>('[data-stack="ready"] .chat-attachments')
        const row = document.querySelector<HTMLElement>('[data-case="ready"] .chat-compose-row')
        const meta = document.querySelector<HTMLElement>('[data-case="ready"] .chat-compose-meta')
        const metaLeft = document.querySelector<HTMLElement>('[data-case="ready"] .chat-compose-meta-left')
        const metaRight = document.querySelector<HTMLElement>('[data-case="ready"] .chat-compose-meta-right')
        const modeSelect = document.querySelector<HTMLElement>('[data-case="ready"] .composer-mode-select-wrap')
        const expertSelect = document.querySelector<HTMLElement>('[data-case="ready"] .expert-squad-select-wrap')
        const modelSelect = document.querySelector<HTMLElement>('[data-case="ready"] .composer-model-selector')
        const modeValue = document.querySelector<HTMLElement>('[data-case="ready"] .composer-mode-select-value')
        const expertValue = document.querySelector<HTMLElement>('[data-case="ready"] .expert-squad-select-value')
        const modelValue = document.querySelector<HTMLElement>('[data-case="ready"] .composer-model-selector-value')
        const modelBudget = document.querySelector<HTMLElement>('[data-case="ready"] [data-ui="executor-hexin-budget"]')
        const modeCaret = document.querySelector<HTMLElement>('[data-case="ready"] .composer-mode-select-caret')
        const expertCaret = document.querySelector<HTMLElement>('[data-case="ready"] .expert-squad-select-caret')
        const loaders = document.querySelector<HTMLElement>('[data-case="ready"] .composer-attachment-loaders')
        const ready = document.querySelector<HTMLElement>('[data-case="ready"] .oc-button[data-mode="send"]')
        const disabled = document.querySelector<HTMLElement>('[data-case="disabled"] .oc-button[data-mode="send"]')
        const stop = document.querySelector<HTMLElement>('[data-case="busy"] .oc-button[data-mode="stop"]')
        const remove = document.querySelector<HTMLElement>('[data-ui="chat-attachment-remove"]')
        if (
          !stage ||
          !stack ||
          !form ||
          !attachments ||
          !row ||
          !meta ||
          !metaLeft ||
          !metaRight ||
          !modeSelect ||
          !expertSelect ||
          !modelSelect ||
          !modeValue ||
          !expertValue ||
          !modelValue ||
          !modelBudget ||
          !modeCaret ||
          !expertCaret ||
          !loaders ||
          !ready ||
          !disabled ||
          !stop ||
          !remove
        ) {
          throw new Error("missing composer primitive fixture nodes")
        }
        const stageBox = stage.getBoundingClientRect()
        const stackBox = stack.getBoundingClientRect()
        const formBox = form.getBoundingClientRect()
        const attachmentsBox = attachments.getBoundingClientRect()
        const rowBox = row.getBoundingClientRect()
        const metaBox = meta.getBoundingClientRect()
        const metaLeftBox = metaLeft.getBoundingClientRect()
        const metaRightBox = metaRight.getBoundingClientRect()
        const modeSelectBox = modeSelect.getBoundingClientRect()
        const expertSelectBox = expertSelect.getBoundingClientRect()
        const modelSelectBox = modelSelect.getBoundingClientRect()
        const modelBudgetBox = modelBudget.getBoundingClientRect()
        const modeSelectStyle = getComputedStyle(modeSelect)
        const expertSelectStyle = getComputedStyle(expertSelect)
        const modelSelectStyle = getComputedStyle(modelSelect)
        const modeValueStyle = getComputedStyle(modeValue)
        const expertValueStyle = getComputedStyle(expertValue)
        const modelValueStyle = getComputedStyle(modelValue)
        const modelBudgetStyle = getComputedStyle(modelBudget)
        const modeCaretStyle = getComputedStyle(modeCaret)
        const expertCaretStyle = getComputedStyle(expertCaret)
        const loadersBox = loaders.getBoundingClientRect()
        const readyBox = ready.getBoundingClientRect()
        const readyCenterY = readyBox.top + readyBox.height / 2
        const loadersCenterY = loadersBox.top + loadersBox.height / 2
        return {
          legacyClassCount: document.querySelectorAll(".chat-send, .chat-attachment-remove").length,
          rowActionCount: row.querySelectorAll('.oc-button[data-mode]').length,
          metaRightActionCount: metaRight.querySelectorAll('.oc-button[data-mode]').length,
          inputContainsAttachments: Boolean(form.querySelector(".chat-attachments")),
          stageWidth: Math.round(stageBox.width),
          stackWidth: Math.round(stackBox.width),
          formWidth: Math.round(formBox.width),
          formHeight: Math.round(formBox.height),
          attachmentsWidth: Math.round(attachmentsBox.width),
          attachmentsBeforeForm: Math.round((formBox.top - attachmentsBox.bottom) * 100) / 100,
          attachmentsLeftInsideStack: Math.round((attachmentsBox.left - stackBox.left) * 100) / 100,
          attachmentsRightInsideStack: Math.round((stackBox.right - attachmentsBox.right) * 100) / 100,
          formRadius: getComputedStyle(form).borderRadius,
          formLeftInsideStage: Math.round((formBox.left - stageBox.left) * 100) / 100,
          formRightInsideStage: Math.round((stageBox.right - formBox.right) * 100) / 100,
          rowWidth: Math.round(rowBox.width),
          metaWidth: Math.round(metaBox.width),
          metaGap: Math.round((metaBox.top - rowBox.bottom) * 100) / 100,
          metaLeftWidth: Math.round(metaLeftBox.width),
          metaLeftInsideForm: Math.round((metaLeftBox.left - formBox.left) * 100) / 100,
          modeSelectWidth: Math.round(modeSelectBox.width),
          expertSelectWidth: Math.round(expertSelectBox.width),
          modelSelectWidth: Math.round(modelSelectBox.width),
          modelBudgetText: modelBudget.textContent?.trim() ?? "",
          modelBudgetParentIsModelSelector: modelBudget.closest(".composer-model-selector") === modelSelect,
          modelBudgetLeftInsideSelector: Math.round((modelBudgetBox.left - modelSelectBox.left) * 100) / 100,
          modelBudgetRightInsideSelector: Math.round((modelSelectBox.right - modelBudgetBox.right) * 100) / 100,
          modelBudgetDisplay: modelBudgetStyle.display,
          modelBudgetBorderInlineStart: modelBudgetStyle.borderInlineStartStyle,
          modeSelectLeftInsideMetaLeft: Math.round((modeSelectBox.left - metaLeftBox.left) * 100) / 100,
          expertAfterMode: Math.round((expertSelectBox.left - modeSelectBox.right) * 100) / 100,
          modelAfterExpert: Math.round((modelSelectBox.left - expertSelectBox.right) * 100) / 100,
          modeSelectBoxShadow: modeSelectStyle.boxShadow,
          expertSelectBoxShadow: expertSelectStyle.boxShadow,
          modelSelectBoxShadow: modelSelectStyle.boxShadow,
          modeSelectBackground: modeSelectStyle.backgroundColor,
          expertSelectBackground: expertSelectStyle.backgroundColor,
          modelSelectBackground: modelSelectStyle.backgroundColor,
          modeValueColor: modeValueStyle.color,
          expertValueColor: expertValueStyle.color,
          modelValueColor: modelValueStyle.color,
          modeCaretDisplay: modeCaretStyle.display,
          expertCaretDisplay: expertCaretStyle.display,
          modeCaretText: modeCaret.textContent ?? "",
          expertCaretText: expertCaret.textContent ?? "",
          loadersAfterMetaLeft: Math.round((loadersBox.left - metaLeftBox.right) * 100) / 100,
          metaRightInsideForm: Math.round((formBox.right - metaRightBox.right) * 100) / 100,
          readyAfterLoaders: Math.round((readyBox.left - loadersBox.right) * 100) / 100,
          readyRightInsideForm: Math.round((formBox.right - readyBox.right) * 100) / 100,
          readyBottomInsideForm: Math.round((formBox.bottom - readyBox.bottom) * 100) / 100,
          readyTopInsideMeta: Math.round((readyBox.top - metaBox.top) * 100) / 100,
          readyBottomInsideMeta: Math.round((metaBox.bottom - readyBox.bottom) * 100) / 100,
          loaderSendCenterDelta: Math.round(Math.abs(loadersCenterY - readyCenterY) * 100) / 100,
          readyClass: ready.className,
          readyVariant: ready.getAttribute("data-variant"),
          readyTone: ready.getAttribute("data-tone"),
          readyHeight: Math.round(readyBox.height),
          readyWidth: Math.round(readyBox.width),
          readyRadius: getComputedStyle(ready).borderRadius,
          disabledOpacity: getComputedStyle(disabled).opacity,
          stopTone: stop.getAttribute("data-tone"),
          stopMode: stop.getAttribute("data-mode"),
          removeClass: remove.className,
          removeChrome: remove.getAttribute("data-chrome"),
        }
      })

      assert.equal(metrics.legacyClassCount, 0)
      assert.equal(metrics.rowActionCount, 0)
      assert.equal(metrics.metaRightActionCount, 1)
      assert.equal(metrics.inputContainsAttachments, false)
      assert.equal(metrics.stageWidth, 680)
      assert.equal(metrics.stackWidth, metrics.formWidth)
      assert.ok(metrics.formWidth <= metrics.stageWidth - 28)
      assert.ok(metrics.formHeight >= 96)
      assert.ok(metrics.formHeight <= 112)
      assert.ok(metrics.attachmentsWidth <= metrics.formWidth)
      assert.ok(metrics.attachmentsBeforeForm >= 5)
      assert.ok(metrics.attachmentsLeftInsideStack >= 0)
      assert.ok(metrics.attachmentsRightInsideStack >= 0)
      assert.match(metrics.formRadius, /2[0-9]px/)
      assert.ok(metrics.formLeftInsideStage >= 13)
      assert.ok(metrics.formRightInsideStage >= 13)
      assert.ok(metrics.rowWidth <= metrics.formWidth - 28)
      assert.ok(metrics.metaWidth <= metrics.formWidth - 28)
      assert.ok(metrics.metaGap >= 5)
      assert.ok(metrics.metaGap <= 7)
      assert.ok(metrics.metaLeftWidth > 0)
      assert.ok(metrics.metaLeftInsideForm >= 13)
      assert.ok(metrics.modeSelectWidth >= 42 && metrics.modeSelectWidth <= 92)
      assert.ok(metrics.expertSelectWidth >= 80 && metrics.expertSelectWidth <= 188)
      assert.ok(metrics.modelSelectWidth >= 160 && metrics.modelSelectWidth <= 276)
      assert.ok(metrics.modelBudgetText.includes("Hexin 19.99"), metrics.modelBudgetText)
      assert.equal(metrics.modelBudgetParentIsModelSelector, true)
      assert.ok(metrics.modelBudgetLeftInsideSelector >= 0)
      assert.ok(metrics.modelBudgetRightInsideSelector >= 0)
      assert.ok(["flex", "inline-flex"].includes(metrics.modelBudgetDisplay), metrics.modelBudgetDisplay)
      assert.notEqual(metrics.modelBudgetBorderInlineStart, "none")
      assert.ok(metrics.modeSelectLeftInsideMetaLeft <= 1)
      assert.ok(metrics.expertAfterMode >= 4 && metrics.expertAfterMode <= 7)
      assert.ok(metrics.modelAfterExpert >= 4 && metrics.modelAfterExpert <= 7)
      assert.notEqual(metrics.modeSelectBackground, "rgba(0, 0, 0, 0)")
      assert.notEqual(metrics.expertSelectBackground, "rgba(0, 0, 0, 0)")
      assert.notEqual(metrics.modelSelectBackground, "rgba(0, 0, 0, 0)")
      assert.match(metrics.modeSelectBoxShadow, /inset/)
      assert.match(metrics.expertSelectBoxShadow, /inset/)
      assert.match(metrics.modelSelectBoxShadow, /inset/)
      assert.equal(metrics.modeValueColor, metrics.expertValueColor)
      assert.equal(metrics.modelValueColor, metrics.expertValueColor)
      assert.equal(metrics.modeCaretDisplay, "none")
      assert.equal(metrics.expertCaretDisplay, "none")
      assert.equal(metrics.modeCaretText, "")
      assert.equal(metrics.expertCaretText, "")
      assert.ok(metrics.loadersAfterMetaLeft >= 7)
      assert.ok(metrics.metaRightInsideForm >= 13)
      assert.ok(metrics.readyAfterLoaders >= 3)
      assert.ok(metrics.readyRightInsideForm >= 13)
      assert.ok(metrics.readyBottomInsideForm >= 8)
      assert.ok(metrics.readyTopInsideMeta >= -1)
      assert.ok(metrics.readyBottomInsideMeta >= -1)
      assert.ok(metrics.loaderSendCenterDelta <= 2)
      assert.match(metrics.readyClass, /\boc-button\b/)
      assert.equal(metrics.readyVariant, "solid")
      assert.equal(metrics.readyTone, "accent")
      assert.ok(metrics.readyHeight >= 32 && metrics.readyHeight <= 42)
      assert.equal(metrics.readyWidth, metrics.readyHeight)
      assert.notEqual(metrics.readyRadius, "0px")
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
