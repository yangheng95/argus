import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"

const OVERLAY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_DIR = path.resolve(OVERLAY_ROOT, ".scratch", "armed-confirm-button")

function css(relativePath: string): string {
  return readFileSync(path.join(OVERLAY_ROOT, relativePath), "utf8")
}

function styleSheet(): string {
  return [
    "src/styles/tokens/design-language.css",
    "src/styles/cascade/dark.css",
    "src/styles/cascade/base.css",
    "src/styles/primitives/button.css",
    "src/styles/surfaces/work-ledger.css",
  ]
    .map(css)
    .join("\n")
}

function saveScreenshot(name: string, bytes: Buffer): string {
  const file = path.join(SCRATCH_DIR, name)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, bytes)
  return file
}

test("armed confirm icon button exposes one visible icon slot across hover and confirm states", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 320, height: 180 })
    await page.setContent(`
      <!doctype html>
      <html data-theme="dark">
        <head>
          <style>${styleSheet()}</style>
          <style>
            body {
              margin: 0;
              padding: calc(32px * var(--ui-scale));
              background: var(--body-bg);
              color: var(--text);
              font-family: var(--font);
            }

            .fixture-row {
              display: flex;
              align-items: center;
              gap: calc(8px * var(--ui-scale));
              width: calc(220px * var(--ui-scale));
              padding: calc(8px * var(--ui-scale));
              background: var(--surface);
            }
          </style>
        </head>
        <body data-theme="dark">
          <div class="fixture-row work-row">
            <span>TradingView futures page clone</span>
            <div class="work-row-actions">
              <button
                type="button"
                class="oc-button"
                data-variant="ghost"
                data-size="icon"
                data-tone="danger"
                data-chrome="icon-action"
                data-ui="work-row-delete"
                title="Delete"
                aria-label="Delete"
                aria-pressed="false"
              >
                <span class="oc-armed-confirm-slot" data-confirm-slot="default">
                  <svg data-icon="delete" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 4h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
                    <path d="M6 4V3h4v1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
                    <path d="M5 6v7h6V6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>
                  </svg>
                </span>
                <span class="oc-armed-confirm-slot" data-confirm-slot="confirm" aria-hidden="true">
                  <svg data-icon="confirm" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4 8.5 7 11l5-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
                  </svg>
                </span>
                <span class="oc-armed-confirm-status" role="status" aria-live="polite"></span>
              </button>
            </div>
          </div>
          <script>
            const button = document.querySelector('[data-ui="work-row-delete"]');
            button.addEventListener("click", () => {
              if (button.dataset.confirm === "true") return;
              button.dataset.confirm = "true";
              button.setAttribute("aria-pressed", "true");
              button.querySelector('[data-confirm-slot="default"]').setAttribute("aria-hidden", "true");
              button.querySelector('[data-confirm-slot="confirm"]').removeAttribute("aria-hidden");
            });
          </script>
        </body>
      </html>
    `)

    await page.hover(".work-row")
    await page.hover('[data-ui="work-row-delete"]')

    const hoverState = await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>('[data-ui="work-row-delete"]')!
      const slots = [...button.querySelectorAll<HTMLElement>(".oc-armed-confirm-slot")]
      return {
        confirm: button.dataset.confirm ?? null,
        defaultDisplay: getComputedStyle(button.querySelector<HTMLElement>('[data-confirm-slot="default"]')!).display,
        confirmDisplay: getComputedStyle(button.querySelector<HTMLElement>('[data-confirm-slot="confirm"]')!).display,
        visibleSlots: slots.filter((slot) => {
          const style = getComputedStyle(slot)
          const rect = slot.getBoundingClientRect()
          return style.display !== "none" && rect.width > 0 && rect.height > 0
        }).length,
        visibleIcons: [...button.querySelectorAll<SVGElement>("svg")].filter((icon) => {
          const style = getComputedStyle(icon)
          const rect = icon.getBoundingClientRect()
          return style.display !== "none" && rect.width > 0 && rect.height > 0
        }).map((icon) => icon.dataset.icon),
      }
    })

    assert.equal(hoverState.confirm, null)
    assert.notEqual(hoverState.defaultDisplay, "none")
    assert.equal(hoverState.confirmDisplay, "none")
    assert.equal(hoverState.visibleSlots, 1)
    assert.deepEqual(hoverState.visibleIcons, ["delete"])
    assert.ok(saveScreenshot("work-ledger-delete-hover.png", await page.screenshot({ fullPage: false })))

    await page.click('[data-ui="work-row-delete"]')

    const armedState = await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>('[data-ui="work-row-delete"]')!
      const slots = [...button.querySelectorAll<HTMLElement>(".oc-armed-confirm-slot")]
      return {
        confirm: button.dataset.confirm ?? null,
        ariaPressed: button.getAttribute("aria-pressed"),
        defaultDisplay: getComputedStyle(button.querySelector<HTMLElement>('[data-confirm-slot="default"]')!).display,
        confirmDisplay: getComputedStyle(button.querySelector<HTMLElement>('[data-confirm-slot="confirm"]')!).display,
        visibleSlots: slots.filter((slot) => {
          const style = getComputedStyle(slot)
          const rect = slot.getBoundingClientRect()
          return style.display !== "none" && rect.width > 0 && rect.height > 0
        }).length,
        visibleIcons: [...button.querySelectorAll<SVGElement>("svg")].filter((icon) => {
          const style = getComputedStyle(icon)
          const rect = icon.getBoundingClientRect()
          return style.display !== "none" && rect.width > 0 && rect.height > 0
        }).map((icon) => icon.dataset.icon),
      }
    })

    assert.equal(armedState.confirm, "true")
    assert.equal(armedState.ariaPressed, "true")
    assert.equal(armedState.defaultDisplay, "none")
    assert.notEqual(armedState.confirmDisplay, "none")
    assert.equal(armedState.visibleSlots, 1)
    assert.deepEqual(armedState.visibleIcons, ["confirm"])
    assert.ok(saveScreenshot("work-ledger-delete-armed.png", await page.screenshot({ fullPage: false })))

    await page.close()
  } finally {
    await browser.close().catch(() => undefined)
  }
})
