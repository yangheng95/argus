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

test("card TODO summary progressbar exposes accessible value without visual drift", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const css = [
    readCss("tokens/design-language.css"),
    readCss("cascade/base.css"),
    readCss("cascade/light.css"),
    readCss("surfaces/card.css"),
  ].join("\n")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 560, height: 180 })
    await page.setContent(`
      <!doctype html>
      <html data-theme="light">
        <head>
          <style>
            ${css}
            :root { --ui-scale: 1; }
            body {
              margin: 0;
              padding: calc(24px * var(--ui-scale));
              background: var(--bg);
              color: var(--text);
              font-family: var(--font);
            }
            .fixture-card {
              width: calc(420px * var(--ui-scale));
              padding: var(--card-pad-y) var(--card-pad-x);
              border: var(--oc-border-width) solid var(--card-border);
              border-radius: var(--oc-radius-soft);
              background: var(--card-bg-0);
            }
          </style>
        </head>
        <body data-theme="light">
          <main class="fixture-card" aria-label="Card TODO summary fixture">
            <span class="card__todo-summary" title="1/3 done · Writing tests">
              <span
                class="card__todo-progress"
                role="progressbar"
                aria-label="Checklist progress"
                aria-valuenow="1"
                aria-valuemin="0"
                aria-valuemax="3"
                aria-valuetext="1/3 done · Writing tests"
                style="--pct: 33%"
              ></span>
              <span class="card__todo-count">1/3</span>
              <span class="card__todo-current">Writing tests</span>
            </span>
          </main>
        </body>
      </html>
    `)

    const state = await page.$eval(".card__todo-summary", (summary: HTMLElement) => {
      const progress = summary.querySelector<HTMLElement>(".card__todo-progress")
      const count = summary.querySelector<HTMLElement>(".card__todo-count")
      const current = summary.querySelector<HTMLElement>(".card__todo-current")
      if (!progress || !count || !current) throw new Error("TODO summary fixture did not render")
      const progressRect = progress.getBoundingClientRect()
      const summaryRect = summary.getBoundingClientRect()
      const progressStyle = getComputedStyle(progress)
      return {
        title: summary.getAttribute("title"),
        role: progress.getAttribute("role"),
        label: progress.getAttribute("aria-label"),
        now: progress.getAttribute("aria-valuenow"),
        min: progress.getAttribute("aria-valuemin"),
        max: progress.getAttribute("aria-valuemax"),
        valueText: progress.getAttribute("aria-valuetext"),
        progressWidth: progressRect.width,
        summaryWidth: summaryRect.width,
        progressHeight: progressRect.height,
        progressBackground: progressStyle.backgroundColor,
        countText: count.textContent?.trim(),
        currentText: current.textContent?.trim(),
      }
    })
    assert.deepEqual(
      {
        title: state.title,
        role: state.role,
        label: state.label,
        now: state.now,
        min: state.min,
        max: state.max,
        valueText: state.valueText,
        countText: state.countText,
        currentText: state.currentText,
      },
      {
        title: "1/3 done · Writing tests",
        role: "progressbar",
        label: "Checklist progress",
        now: "1",
        min: "0",
        max: "3",
        valueText: "1/3 done · Writing tests",
        countText: "1/3",
        currentText: "Writing tests",
      },
    )
    assert.ok(state.progressWidth >= 60, `progress bar should retain minimum visible width: ${JSON.stringify(state)}`)
    assert.ok(state.summaryWidth > state.progressWidth, `summary row should include text after the bar: ${JSON.stringify(state)}`)
    assert.ok(state.progressHeight >= 4, `progress bar should remain visible: ${JSON.stringify(state)}`)
    assert.notEqual(state.progressBackground, "rgba(0, 0, 0, 0)")

    const fixture = await page.$(".fixture-card")
    assert.ok(fixture)
    const screenshotPath = resolve(SCRATCH_ROOT, "card-todo-summary-progressbar-a11y.png")
    mkdirSync(dirname(screenshotPath), { recursive: true })
    const screenshot = await fixture.screenshot({})
    assert.ok(screenshot.length > 0)
    writeFileSync(screenshotPath, screenshot)
  } finally {
    await browser.close()
  }
})
