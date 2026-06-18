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

test("Markdown code copy uses Button focus chrome and copied state", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const css = [
    readCss("tokens/design-language.css"),
    readCss("cascade/base.css"),
    readCss("cascade/light.css"),
    readCss("primitives/button.css"),
    readCss("surfaces/markdown.css"),
  ].join("\n")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 720, height: 320 })
    await page.setContent(`
      <!doctype html>
      <html data-theme="light">
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
            .markdown-stage {
              max-width: 620px;
              padding: 16px;
              border: var(--oc-border-width) solid var(--border);
              border-radius: var(--oc-radius-large);
              background: var(--surface);
            }
            .md-code-toolbar {
              opacity: var(--ui-opacity-full);
              pointer-events: auto;
            }
          </style>
        </head>
        <body data-theme="light">
          <main class="markdown-stage" data-ui="markdown-stage">
            <div class="md-code" data-lang="typescript">
              <div class="md-code-toolbar">
                <span class="md-code-lang">typescript</span>
                <button
                  type="button"
                  class="oc-button md-code-copy"
                  data-variant="ghost"
                  data-size="icon"
                  data-tone="neutral"
                  data-chrome="icon-action"
                  data-ui="markdown-code-copy"
                  data-md-copy="console.log(&quot;ok&quot;)"
                  title="Copy code"
                  aria-label="Copy code"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 8h10v12H8zM6 16H4V4h12v2" fill="none" stroke="currentColor" stroke-width="2" />
                  </svg>
                </button>
              </div>
              <pre><code class="hljs language-typescript">console.log(&quot;ok&quot;)</code></pre>
            </div>
          </main>
          <script>
            document.querySelector('[data-ui="markdown-code-copy"]').addEventListener("click", (event) => {
              const button = event.currentTarget;
              button.dataset.copied = "true";
              button.setAttribute("aria-label", "Copied");
              button.title = "Copied";
              document.body.dataset.copied = button.getAttribute("data-md-copy") || "";
            });
          </script>
        </body>
      </html>
    `)

    const state = await page.$eval('[data-ui="markdown-code-copy"]', (node) => {
      const button = node as HTMLElement
      return {
        tag: button.tagName,
        className: button.className,
        variant: button.dataset.variant ?? "",
        size: button.dataset.size ?? "",
        tone: button.dataset.tone ?? "",
        chrome: button.dataset.chrome ?? "",
        dataUi: button.dataset.ui ?? "",
        copyPayload: button.getAttribute("data-md-copy") ?? "",
        ariaLabel: button.getAttribute("aria-label") ?? "",
      }
    })
    assert.deepEqual(state, {
      tag: "BUTTON",
      className: "oc-button md-code-copy",
      variant: "ghost",
      size: "icon",
      tone: "neutral",
      chrome: "icon-action",
      dataUi: "markdown-code-copy",
      copyPayload: 'console.log("ok")',
      ariaLabel: "Copy code",
    })

    await page.keyboard.press("Tab")
    const focused = await page.$eval('[data-ui="markdown-code-copy"]', (node) => {
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
    assert.ok(focused.width >= 22, JSON.stringify(focused))
    assert.ok(focused.height >= 22, JSON.stringify(focused))
    assert.equal(focused.svgWidth, "12px")
    assert.equal(focused.svgHeight, "12px")

    await page.keyboard.press("Enter")
    const copied = await page.$eval('[data-ui="markdown-code-copy"]', (node) => {
      const button = node as HTMLElement
      const style = getComputedStyle(button)
      return {
        copied: button.dataset.copied ?? "",
        ariaLabel: button.getAttribute("aria-label") ?? "",
        title: button.getAttribute("title") ?? "",
        bodyCopied: document.body.dataset.copied ?? "",
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
        color: style.color,
      }
    })
    assert.equal(copied.copied, "true")
    assert.equal(copied.ariaLabel, "Copied")
    assert.equal(copied.title, "Copied")
    assert.equal(copied.bodyCopied, 'console.log("ok")')
    assert.notEqual(copied.backgroundColor, "rgba(0, 0, 0, 0)")
    assert.notEqual(copied.boxShadow, "none")
    assert.notEqual(copied.color, "rgba(0, 0, 0, 0)")

    const stage = await page.$('[data-ui="markdown-stage"]')
    assert.ok(stage)
    writeFileSync(scratchPath("markdown-code-copy-focus.png"), await stage.screenshot({}))
  } finally {
    await browser.close()
  }
})
