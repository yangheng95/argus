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

test("Reasoning toggle uses Button focus chrome in light and dark themes", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const css = [
    readCss("tokens/design-language.css"),
    readCss("cascade/base.css"),
    readCss("cascade/light.css"),
    readCss("cascade/dark.css"),
    readCss("primitives/button.css"),
    readCss("surfaces/messages.css"),
  ].join("\n")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    for (const theme of ["light", "dark"] as const) {
      const page = await browser.newPage()
      await page.setViewport({ width: 680, height: 360 })
      await page.setContent(`
        <!doctype html>
        <html data-theme="${theme}">
          <head>
            <style>
              ${css}
              :root {
                --ui-scale: 1;
              }
              body {
                margin: 0;
                padding: 24px;
                background: var(--surface-inset);
                color: var(--text);
                font-family: var(--font);
              }
              .reasoning-stage {
                max-width: 560px;
                padding: 16px;
                border: var(--oc-border-width) solid var(--border);
                border-radius: var(--oc-radius-large);
                background: var(--surface);
              }
            </style>
          </head>
          <body data-theme="${theme}">
            <main class="reasoning-stage" data-ui="reasoning-stage">
              <section class="msg-reasoning" data-expanded="true">
                <button
                  type="button"
                  class="oc-button"
                  data-variant="ghost"
                  data-size="mini"
                  data-tone="accent"
                  data-ui="reasoning-toggle"
                  aria-expanded="true"
                >
                  Reasoning
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" />
                  </svg>
                </button>
                <div class="reasoning-text md-content">The model checks the workspace state before editing.</div>
              </section>
            </main>
            <script>
              const toggle = document.querySelector('[data-ui="reasoning-toggle"]');
              const reasoning = document.querySelector(".msg-reasoning");
              toggle.addEventListener("click", () => {
                const expanded = toggle.getAttribute("aria-expanded") === "true";
                toggle.setAttribute("aria-expanded", expanded ? "false" : "true");
                reasoning.dataset.expanded = expanded ? "false" : "true";
              });
            </script>
          </body>
        </html>
      `)

      const state = await page.$eval('[data-ui="reasoning-toggle"]', (node) => {
        const button = node as HTMLElement
        return {
          oldClassCount: document.querySelectorAll(".reasoning-label").length,
          tag: button.tagName,
          className: button.className,
          dataUi: button.dataset.ui ?? "",
          variant: button.dataset.variant ?? "",
          size: button.dataset.size ?? "",
          tone: button.dataset.tone ?? "",
          ariaExpanded: button.getAttribute("aria-expanded") ?? "",
        }
      })
      assert.deepEqual(state, {
        oldClassCount: 0,
        tag: "BUTTON",
        className: "oc-button",
        dataUi: "reasoning-toggle",
        variant: "ghost",
        size: "mini",
        tone: "accent",
        ariaExpanded: "true",
      })

      await page.keyboard.press("Tab")
      const focused = await page.$eval('[data-ui="reasoning-toggle"]', (node) => {
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
          color: style.color,
          textTransform: style.textTransform,
          letterSpacing: style.letterSpacing,
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
      assert.notEqual(focused.color, "rgba(0, 0, 0, 0)")
      assert.equal(focused.textTransform, "uppercase")
      assert.notEqual(focused.letterSpacing, "normal")
      assert.ok(focused.width > 72, JSON.stringify(focused))
      assert.ok(focused.height >= 20, JSON.stringify(focused))
      assert.equal(focused.svgWidth, "12px")
      assert.equal(focused.svgHeight, "12px")

      await page.keyboard.press("Enter")
      const collapsed = await page.$eval(".msg-reasoning", (node) => {
        const reasoning = node as HTMLElement
        const text = reasoning.querySelector<HTMLElement>(".reasoning-text")
        const toggle = reasoning.querySelector<HTMLElement>('[data-ui="reasoning-toggle"]')
        return {
          expanded: reasoning.dataset.expanded ?? "",
          ariaExpanded: toggle?.getAttribute("aria-expanded") ?? "",
          textDisplay: text ? getComputedStyle(text).display : "",
        }
      })
      assert.deepEqual(collapsed, { expanded: "false", ariaExpanded: "false", textDisplay: "none" })

      const stage = await page.$('[data-ui="reasoning-stage"]')
      assert.ok(stage)
      writeFileSync(scratchPath(`reasoning-toggle-focus-${theme}.png`), await stage.screenshot({}))
      await page.close()
    }
  } finally {
    await browser.close()
  }
})
