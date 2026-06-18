import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")

function readCss(rel: string): string {
  return readFileSync(join(OVERLAY_ROOT, "src/styles", rel), "utf8")
}

function scratchPath(name: string): string {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  return target
}

test("Mission global action error dismiss exposes Button focus chrome", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const css = [
    readCss("tokens/design-language.css"),
    readCss("cascade/base.css"),
    readCss("cascade/light.css"),
    readCss("primitives/button.css"),
    readCss("surfaces/mission.css"),
  ].join("\n")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 520, height: 240 })
    await page.setContent(`
      <!doctype html>
      <html>
        <head>
          <style>
            ${css}
            :root {
              --ui-scale: 1;
            }
            body {
              margin: 0;
              padding: 24px;
              background: rgb(255, 255, 255);
              color: var(--text);
              font-family: var(--font);
            }
            .mission-left-panel {
              width: 420px;
              border: var(--oc-border-width) solid var(--border);
              border-radius: var(--oc-radius-large);
              background: var(--surface);
            }
          </style>
        </head>
        <body data-theme="light">
          <main class="mission-left-panel" data-ui="mission-left-panel">
            <div class="mission-action-error" role="alert" data-ui="mission-global-action-error">
              <span>Delete failed: request timed out</span>
              <button
                type="button"
                class="oc-button"
                data-variant="ghost"
                data-size="icon"
                data-tone="neutral"
                data-chrome="icon-action"
                data-ui="mission-action-error-dismiss"
                aria-label="Clear"
                title="Clear"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" />
                </svg>
              </button>
            </div>
          </main>
          <script>
            document.querySelector('[data-ui="mission-action-error-dismiss"]').addEventListener("click", () => {
              document.body.dataset.dismissed = "true";
            });
          </script>
        </body>
      </html>
    `)

    const state = await page.$eval('[data-ui="mission-global-action-error"]', (node) => {
      const alert = node as HTMLElement
      const dismiss = alert.querySelector<HTMLButtonElement>('[data-ui="mission-action-error-dismiss"]')
      return {
        role: alert.getAttribute("role"),
        oldClassCount: alert.querySelectorAll(".mission-action-error-dismiss").length,
        dismissTag: dismiss?.tagName ?? "",
        dismissClass: dismiss?.className ?? "",
        dismissVariant: dismiss?.dataset.variant ?? "",
        dismissSize: dismiss?.dataset.size ?? "",
        dismissTone: dismiss?.dataset.tone ?? "",
        dismissChrome: dismiss?.dataset.chrome ?? "",
        dismissAriaLabel: dismiss?.getAttribute("aria-label") ?? "",
        dismissTitle: dismiss?.getAttribute("title") ?? "",
      }
    })
    assert.deepEqual(state, {
      role: "alert",
      oldClassCount: 0,
      dismissTag: "BUTTON",
      dismissClass: "oc-button",
      dismissVariant: "ghost",
      dismissSize: "icon",
      dismissTone: "neutral",
      dismissChrome: "icon-action",
      dismissAriaLabel: "Clear",
      dismissTitle: "Clear",
    })

    await page.keyboard.press("Tab")
    const focused = await page.$eval('[data-ui="mission-action-error-dismiss"]', (node) => {
      const button = node as HTMLElement
      const style = getComputedStyle(button)
      const rect = button.getBoundingClientRect()
      const svg = button.querySelector("svg")
      const svgStyle = svg ? getComputedStyle(svg) : null
      return {
        active: document.activeElement === button,
        focusVisible: button.matches(":focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
        color: style.color,
        width: rect.width,
        height: rect.height,
        svgWidth: svgStyle?.width ?? "",
        svgHeight: svgStyle?.height ?? "",
      }
    })
    assert.equal(focused.active, true)
    assert.equal(focused.focusVisible, true)
    assert.notEqual(focused.outlineStyle, "none")
    assert.notEqual(focused.outlineWidth, "0px")
    assert.notEqual(focused.backgroundColor, "rgba(0, 0, 0, 0)")
    assert.notEqual(focused.boxShadow, "none")
    assert.notEqual(focused.color, "rgba(0, 0, 0, 0)")
    assert.ok(focused.width >= 24, JSON.stringify(focused))
    assert.ok(focused.height >= 24, JSON.stringify(focused))
    assert.equal(focused.svgWidth, "12px")
    assert.equal(focused.svgHeight, "12px")

    await page.keyboard.press("Enter")
    assert.equal(await page.$eval("body", (node) => (node as HTMLElement).dataset.dismissed ?? ""), "true")

    const panel = await page.$('[data-ui="mission-left-panel"]')
    assert.ok(panel)
    writeFileSync(scratchPath("mission-action-error-dismiss-focus.png"), await panel.screenshot({}))
  } finally {
    await browser.close()
  }
})
