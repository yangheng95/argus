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

test("Trace event heads expose visible keyboard focus and toggle from keyboard", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const css = [
    readCss("tokens/design-language.css"),
    readCss("cascade/base.css"),
    readCss("cascade/light.css"),
    readCss("primitives/panel.css"),
    readCss("primitives/button.css"),
    readCss("surfaces/card.css"),
  ].join("\n")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 920, height: 620 })
    await page.setContent(`
      <!doctype html>
      <html>
        <head>
          <style>
            ${css}
            :root {
              --ui-scale: 1;
              --conversation-card-inline-size: min(760px, 100%);
              --card-min-inline-size: 0px;
              --card-sticky-inline-size: 0px;
            }
            body {
              margin: 0;
              padding: 24px;
              background: rgb(255, 255, 255);
              color: var(--text);
              font-family: var(--font);
            }
            .trace-focus-stage {
              width: 760px;
              padding: 12px;
              background: var(--surface);
              border: var(--oc-border-width) solid var(--border);
              border-radius: var(--oc-radius-large);
            }
          </style>
        </head>
        <body data-theme="light">
          <main class="trace-focus-stage">
            <section class="oc-panel trace-panel">
              <header class="oc-panel__head trace-panel-head">
                <div class="oc-panel__title">Agent trace</div>
              </header>
              <div class="oc-panel__body trace-panel-body">
                <div class="trace-event" data-kind="llm_request" data-open="false">
                  <button type="button" class="trace-event-head" aria-expanded="false">
                    <span class="trace-event-ts">10:24:32.018</span>
                    <span class="trace-event-kind">llm_request - build-agent - 12 msgs</span>
                    <span class="trace-event-sid">a7f3c102</span>
                    <span class="trace-event-chevron" aria-hidden="true">></span>
                  </button>
                  <pre class="trace-event-body" hidden>{"kind":"llm_request"}</pre>
                </div>
              </div>
            </section>
          </main>
          <script>
            const head = document.querySelector(".trace-event-head");
            const event = document.querySelector(".trace-event");
            const body = document.querySelector(".trace-event-body");
            head.addEventListener("click", () => {
              const next = head.getAttribute("aria-expanded") !== "true";
              head.setAttribute("aria-expanded", String(next));
              if (next) head.setAttribute("aria-controls", "trace-event-fixture-body");
              else head.removeAttribute("aria-controls");
              event.dataset.open = String(next);
              body.hidden = !next;
              body.id = next ? "trace-event-fixture-body" : "";
            });
          </script>
        </body>
      </html>
    `)

    const headSelector = ".trace-event-head"
    await page.keyboard.press("Tab")
    const focused = await page.$eval(headSelector, (node) => {
      const button = node as HTMLElement
      const style = getComputedStyle(button)
      return {
        active: document.activeElement === button,
        focusVisible: button.matches(":focus-visible"),
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
        outlineStyle: style.outlineStyle,
      }
    })
    assert.equal(focused.active, true)
    assert.equal(focused.focusVisible, true)
    assert.notEqual(focused.backgroundColor, "rgba(0, 0, 0, 0)")
    assert.notEqual(focused.boxShadow, "none")
    assert.equal(focused.outlineStyle, "none")

    await page.keyboard.press("Enter")
    const expanded = await page.$eval(headSelector, (node) => {
      const button = node as HTMLElement
      const controls = button.getAttribute("aria-controls") ?? ""
      const body = controls ? document.getElementById(controls) : null
      return {
        expanded: button.getAttribute("aria-expanded"),
        controls,
        bodyClass: body?.className ?? "",
        bodyHidden: body instanceof HTMLElement ? body.hidden : true,
      }
    })
    assert.deepEqual(expanded, {
      expanded: "true",
      controls: "trace-event-fixture-body",
      bodyClass: "trace-event-body",
      bodyHidden: false,
    })

    const stage = await page.$(".trace-focus-stage")
    assert.ok(stage)
    writeFileSync(scratchPath("trace-event-head-focus-light.png"), await stage.screenshot({}))
  } finally {
    await browser.close()
  }
})
