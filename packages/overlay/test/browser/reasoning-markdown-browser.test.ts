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

test("reasoning Markdown renders stable blocks while keeping the active tail raw", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const css = [
    readCss("tokens/design-language.css"),
    readCss("cascade/base.css"),
    readCss("cascade/light.css"),
    readCss("primitives/button.css"),
    readCss("surfaces/markdown.css"),
    readCss("surfaces/messages.css"),
  ].join("\n")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 760, height: 430 })
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
              background: var(--surface-inset);
              color: var(--text);
              font-family: var(--font);
            }
            .reasoning-stage {
              width: 640px;
              padding: 16px;
              border: var(--oc-border-width) solid var(--border);
              border-radius: var(--oc-radius-large);
              background: var(--surface);
            }
            .reasoning-stage .md-code-toolbar {
              opacity: var(--ui-opacity-full);
              pointer-events: auto;
            }
          </style>
        </head>
        <body data-theme="light">
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
              <div class="reasoning-text md-content">
                <div class="md-frozen-block">
                  <ul>
                    <li>Read the landed plan before editing.</li>
                    <li>Reuse the text streaming Markdown primitive.</li>
                  </ul>
                </div>
                <div class="md-frozen-block">
                  <div class="md-code" data-lang="typescript">
                    <div class="md-code-toolbar">
                      <span class="md-code-lang">typescript</span>
                    </div>
                    <pre><code class="hljs language-typescript"><span class="hljs-keyword">const</span> done = <span class="hljs-literal">true</span></code></pre>
                  </div>
                </div>
                <div class="md-active-text reasoning-text--streaming">\`\`\`ts
const live = "still streaming"</div>
              </div>
            </section>
          </main>
        </body>
      </html>
    `)

    const state = await page.$eval('[data-ui="reasoning-stage"]', (node) => {
      const stage = node as HTMLElement
      const reasoning = stage.querySelector<HTMLElement>(".msg-reasoning")
      const text = stage.querySelector<HTMLElement>(".reasoning-text")
      const active = stage.querySelector<HTMLElement>(".md-active-text.reasoning-text--streaming")
      const code = stage.querySelector<HTMLElement>(".md-code pre code")
      const activeStyle = active ? getComputedStyle(active) : null
      const codeRect = code?.getBoundingClientRect()
      return {
        expanded: reasoning?.dataset.expanded ?? "",
        listItems: stage.querySelectorAll(".md-frozen-block ul li").length,
        codeVisible: Boolean(codeRect && codeRect.width > 0 && codeRect.height > 0),
        activeText: active?.textContent ?? "",
        activeWhiteSpace: activeStyle?.whiteSpace ?? "",
        activeParsedCodeBlocks: active?.querySelectorAll("pre, code").length ?? -1,
        textDisplay: text ? getComputedStyle(text).display : "",
      }
    })

    assert.equal(state.expanded, "true")
    assert.equal(state.listItems, 2)
    assert.equal(state.codeVisible, true)
    assert.match(state.activeText, /```ts\s+const live = "still streaming"/)
    assert.equal(state.activeWhiteSpace, "pre-wrap")
    assert.equal(state.activeParsedCodeBlocks, 0)
    assert.equal(state.textDisplay, "block")

    const stage = await page.$('[data-ui="reasoning-stage"]')
    assert.ok(stage)
    writeFileSync(scratchPath("reasoning-markdown-streaming.png"), await stage.screenshot({}))
  } finally {
    await browser.close()
  }
})
