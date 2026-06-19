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

test("Task progress goal pills expose visible keyboard focus", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const css = [
    readCss("tokens/design-language.css"),
    readCss("cascade/base.css"),
    readCss("cascade/light.css"),
    readCss("primitives/button.css"),
    readCss("surfaces/card.css"),
  ].join("\n")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 860, height: 520 })
    await page.setContent(`
      <!doctype html>
      <html>
        <head>
          <style>
            ${css}
            :root {
              --ui-scale: 1;
              --conversation-card-inline-size: min(720px, 100%);
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
            .task-progress-focus-stage {
              width: 680px;
              padding: 14px;
              background: var(--surface);
              border: var(--oc-border-width) solid var(--border);
              border-radius: var(--oc-radius-large);
            }
          </style>
        </head>
        <body data-theme="light">
          <main class="task-progress-focus-stage">
            <section class="task-progress" role="region" aria-label="Goal Progress" data-folded="false" data-running="true">
              <div class="task-progress__header">
                <span class="task-progress__heading">Goal Progress</span>
                <span class="task-progress__summary">1/4</span>
                <button type="button" class="oc-button" data-variant="ghost" data-size="icon" data-tone="neutral" data-ui="task-progress-fold" aria-expanded="true" aria-controls="taskProgressPills">
                  <span aria-hidden="true">^</span>
                </button>
              </div>
              <div class="task-progress__bar" aria-hidden="true">
                <div class="task-progress__bar-fill" style="--progress-passed: 25%"></div>
                <div class="task-progress__bar-fail" style="--progress-failed: 25%"></div>
              </div>
              <div id="taskProgressPills" class="task-progress__pills" data-collapsed="false">
                <button type="button" class="oc-button" data-variant="outline" data-size="mini" data-tone="neutral" data-ui="task-progress-pill" data-state="passed" data-goal-id="goal-1">
                  <span class="task-progress__pill-id">G1</span>
                  <span class="task-progress__pill-title">Reference evidence captured</span>
                </button>
                <button type="button" class="oc-button" data-variant="outline" data-size="mini" data-tone="neutral" data-ui="task-progress-pill" data-state="running" data-goal-id="goal-2">
                  <span class="task-progress__pill-id">G2</span>
                  <span class="task-progress__pill-title">Implement visual comparison</span>
                </button>
                <button type="button" class="oc-button" data-variant="outline" data-size="mini" data-tone="neutral" data-ui="task-progress-pill" data-state="failed" data-goal-id="goal-3">
                  <span class="task-progress__pill-id">G3</span>
                  <span class="task-progress__pill-title">Repair keyboard focus states</span>
                </button>
              </div>
            </section>
          </main>
          <script>
            for (const pill of document.querySelectorAll('[data-ui="task-progress-pill"]')) {
              pill.addEventListener("click", () => {
                document.body.dataset.selectedGoal = pill.dataset.goalId || "";
              });
            }
          </script>
        </body>
      </html>
    `)

    const pillSelector = '.oc-button[data-ui="task-progress-pill"][data-goal-id="goal-1"]'
    let pillFocused = false
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await page.keyboard.press("Tab")
      pillFocused = await page.$eval(pillSelector, (node) => document.activeElement === node)
      if (pillFocused) break
    }
    assert.equal(pillFocused, true)

    const focused = await page.$eval(pillSelector, (node) => {
      const button = node as HTMLElement
      const style = getComputedStyle(button)
      return {
        className: button.className,
        variant: button.dataset.variant,
        size: button.dataset.size,
        tone: button.dataset.tone,
        focusVisible: button.matches(":focus-visible"),
        backgroundColor: style.backgroundColor,
        borderColor: style.borderTopColor,
        color: style.color,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      }
    })
    assert.match(focused.className, /\boc-button\b/)
    assert.equal(focused.variant, "outline")
    assert.equal(focused.size, "mini")
    assert.equal(focused.tone, "neutral")
    assert.equal(focused.focusVisible, true)
    assert.notEqual(focused.backgroundColor, "rgba(0, 0, 0, 0)")
    assert.notEqual(focused.borderColor, "rgba(0, 0, 0, 0)")
    assert.notEqual(focused.color, "rgba(0, 0, 0, 0)")
    assert.notEqual(focused.outlineStyle, "none")
    assert.notEqual(focused.outlineWidth, "0px")

    await page.keyboard.press("Enter")
    const selectedGoal = await page.$eval("body", (node) => (node as HTMLElement).dataset.selectedGoal ?? "")
    assert.equal(selectedGoal, "goal-1")

    const stage = await page.$(".task-progress-focus-stage")
    assert.ok(stage)
    writeFileSync(scratchPath("task-progress-pill-focus-light.png"), await stage.screenshot({}))
  } finally {
    await browser.close()
  }
})
