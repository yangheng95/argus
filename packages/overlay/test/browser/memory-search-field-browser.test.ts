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

test("Memory search uses shared search-field focus and Button actions", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const css = [
    readCss("tokens/design-language.css"),
    readCss("cascade/base.css"),
    readCss("cascade/light.css"),
    readCss("primitives/button.css"),
    readCss("surfaces/field.css"),
    readCss("surfaces/settings.css"),
  ].join("\n")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 720, height: 280 })
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
            .memory-panel {
              max-width: 620px;
              padding: 14px;
              border: var(--oc-border-width) solid var(--border);
              border-radius: var(--oc-radius-large);
              background: var(--surface);
            }
          </style>
        </head>
        <body data-theme="light">
          <main class="memory-panel" data-ui="memory-panel">
            <div class="knowledge-toolbar">
              <div class="memory-search search-field">
                <svg class="memory-search-icon search-field-icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" fill="none" stroke="currentColor" stroke-width="2" />
                </svg>
                <input
                  id="memorySearch"
                  type="search"
                  class="memory-search-input search-field-input"
                  placeholder="Search memory"
                  aria-label="Search memory"
                  value="latency"
                >
                <button
                  type="button"
                  class="oc-button"
                  data-variant="ghost"
                  data-size="icon"
                  data-tone="neutral"
                  data-chrome="icon-action"
                  data-ui="memory-search-clear"
                  aria-label="Clear"
                  title="Clear"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" /></svg>
                </button>
              </div>
              <button
                type="button"
                id="btnMemorySearch"
                class="oc-button"
                data-variant="ghost"
                data-size="sm"
                data-tone="neutral"
                data-ui="memory-search-submit"
                aria-label="Search"
              >
                <span>Search</span>
              </button>
              <button
                type="button"
                id="btnMemoryRefresh"
                class="oc-button"
                data-variant="ghost"
                data-size="sm"
                data-tone="neutral"
                data-ui="memory-refresh"
                aria-label="Refresh"
              >
                <span>Refresh</span>
              </button>
            </div>
          </main>
          <script>
            const input = document.querySelector("#memorySearch");
            const clear = document.querySelector('[data-ui="memory-search-clear"]');
            const submit = document.querySelector('[data-ui="memory-search-submit"]');
            input.addEventListener("keydown", (event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                document.body.dataset.submitted = input.value;
              }
            });
            clear.addEventListener("click", () => {
              input.value = "";
              document.body.dataset.cleared = "true";
            });
            submit.addEventListener("click", () => {
              document.body.dataset.submitted = input.value;
            });
          </script>
        </body>
      </html>
    `)

    const state = await page.$eval(".knowledge-toolbar", (node) => {
      const toolbar = node as HTMLElement
      const search = toolbar.querySelector<HTMLElement>(".memory-search")
      const input = toolbar.querySelector<HTMLInputElement>("#memorySearch")
      const clear = toolbar.querySelector<HTMLButtonElement>('[data-ui="memory-search-clear"]')
      const submit = toolbar.querySelector<HTMLButtonElement>('[data-ui="memory-search-submit"]')
      return {
        oldInputCount: toolbar.querySelectorAll(".knowledge-search").length,
        searchClasses: search?.className ?? "",
        inputClasses: input?.className ?? "",
        inputType: input?.type ?? "",
        inputAriaLabel: input?.getAttribute("aria-label") ?? "",
        clearClass: clear?.className ?? "",
        clearChrome: clear?.dataset.chrome ?? "",
        clearVariant: clear?.dataset.variant ?? "",
        clearSize: clear?.dataset.size ?? "",
        submitClass: submit?.className ?? "",
        submitVariant: submit?.dataset.variant ?? "",
        submitSize: submit?.dataset.size ?? "",
      }
    })
    assert.deepEqual(state, {
      oldInputCount: 0,
      searchClasses: "memory-search search-field",
      inputClasses: "memory-search-input search-field-input",
      inputType: "search",
      inputAriaLabel: "Search memory",
      clearClass: "oc-button",
      clearChrome: "icon-action",
      clearVariant: "ghost",
      clearSize: "icon",
      submitClass: "oc-button",
      submitVariant: "ghost",
      submitSize: "sm",
    })

    await page.focus("#memorySearch")
    const focusState = await page.$eval(".memory-search", (node) => {
      const field = node as HTMLElement
      const input = field.querySelector<HTMLInputElement>("#memorySearch")
      const style = getComputedStyle(field)
      const inputStyle = input ? getComputedStyle(input) : null
      const rect = field.getBoundingClientRect()
      return {
        focusWithin: field.matches(":focus-within"),
        borderColor: style.borderTopColor,
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
        inputOutline: inputStyle?.outlineStyle ?? "",
        width: rect.width,
        height: rect.height,
      }
    })
    assert.equal(focusState.focusWithin, true)
    assert.notEqual(focusState.backgroundColor, "rgba(0, 0, 0, 0)")
    assert.notEqual(focusState.boxShadow, "none")
    assert.equal(focusState.inputOutline, "none")
    assert.ok(focusState.width > 240, JSON.stringify(focusState))
    assert.ok(focusState.height >= 30, JSON.stringify(focusState))

    await page.keyboard.press("Enter")
    assert.equal(await page.$eval("body", (node) => (node as HTMLElement).dataset.submitted ?? ""), "latency")
    const hitState = await page.$eval('[data-ui="memory-search-clear"]', (node) => {
      const clear = node as HTMLElement
      const clearRect = clear.getBoundingClientRect()
      const centerX = clearRect.left + clearRect.width / 2
      const centerY = clearRect.top + clearRect.height / 2
      const hit = document.elementFromPoint(centerX, centerY) as HTMLElement | null
      const hitOwner = hit?.closest<HTMLElement>("[data-ui]")
      const field = document.querySelector<HTMLElement>(".memory-search")
      const submit = document.querySelector<HTMLElement>('[data-ui="memory-search-submit"]')
      const fieldRect = field?.getBoundingClientRect()
      const submitRect = submit?.getBoundingClientRect()
      return {
        hitDataUi: hitOwner?.dataset.ui ?? "",
        hitTag: hit?.tagName ?? "",
        hitText: hit?.textContent?.trim() ?? "",
        fieldRect: fieldRect
          ? { left: fieldRect.left, right: fieldRect.right, top: fieldRect.top, bottom: fieldRect.bottom }
          : null,
        clearRect: { left: clearRect.left, right: clearRect.right, top: clearRect.top, bottom: clearRect.bottom },
        submitRect: submitRect
          ? { left: submitRect.left, right: submitRect.right, top: submitRect.top, bottom: submitRect.bottom }
          : null,
      }
    })
    assert.equal(hitState.hitDataUi, "memory-search-clear", JSON.stringify(hitState, null, 2))
    await page.click('[data-ui="memory-search-clear"]')
    assert.deepEqual(
      await page.$eval("body", (node) => {
        const input = document.querySelector<HTMLInputElement>("#memorySearch")
        return {
          cleared: (node as HTMLElement).dataset.cleared ?? "",
          value: input?.value ?? "",
        }
      }),
      { cleared: "true", value: "" },
    )

    const panel = await page.$('[data-ui="memory-panel"]')
    assert.ok(panel)
    writeFileSync(scratchPath("memory-search-field-focus.png"), await panel.screenshot({}))
  } finally {
    await browser.close()
  }
})
