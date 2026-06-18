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

test("CSS token closure surfaces resolve canonical tokens visually", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const css = [
    readCss("tokens/design-language.css"),
    readCss("cascade/base.css"),
    readCss("cascade/light.css"),
    readCss("primitives/button.css"),
    readCss("surfaces/sidebar.css"),
    readCss("surfaces/changes.css"),
    readCss("surfaces/messages.css"),
    readCss("surfaces/settings.css"),
    readCss("surfaces/activity.css"),
  ].join("\n")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 980, height: 760 })
    await page.setContent(`
      <!doctype html>
      <html>
        <head>
          <style>
            ${css}
            :root { --ui-scale: 1; }
            body {
              margin: 0;
              padding: 24px;
              background: rgb(255, 255, 255);
              color: var(--text);
              font-family: var(--font);
            }
            .token-closure-stage {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 16px;
            }
            .token-closure-sample {
              min-width: 0;
              padding: 14px;
              border: var(--oc-border-width) solid var(--border);
              border-radius: var(--oc-radius-large);
              background: var(--surface);
            }
            .token-closure-sample h2 {
              margin: 0 0 10px;
              color: var(--text-strong);
              font-size: var(--ui-font-title);
            }
            .task-row-mini {
              position: relative;
              display: grid;
              grid-template-columns: minmax(0, 1fr) var(--task-row-actions-width);
              min-height: 32px;
              align-items: center;
            }
            .task-row-actions {
              position: static;
              transform: none;
              pointer-events: auto;
            }
            .task-row-actions .oc-button[data-chrome="icon-action"][data-ui] {
              opacity: 1;
              pointer-events: auto;
            }
          </style>
        </head>
        <body data-theme="light">
          <main class="token-closure-stage">
            <section class="token-closure-sample">
              <h2>Task row actions</h2>
              <div class="task-row-mini">
                <input class="task-row-rename-input" value="Rename target" aria-label="Rename target">
                <div class="task-row-actions">
                  <button class="oc-button" data-chrome="icon-action" data-ui="task-row-delete" type="button">D</button>
                  <button class="oc-button" data-chrome="icon-action" data-ui="task-row-rename" type="button">R</button>
                </div>
              </div>
            </section>
            <section class="token-closure-sample">
              <h2>File changes labels</h2>
              <div class="changes-total">
                <span class="changes-commit">a1b2c3d</span>
                <span class="changes-group-commit">main@d4e5f6a</span>
              </div>
            </section>
            <section class="token-closure-sample">
              <h2>Image preview</h2>
              <div class="image-preview-dialog__stage" style="--image-preview-rendered-width: 180px; --image-preview-rendered-height: 96px;">
                <div class="image-preview-dialog__image" role="img" aria-label="Preview placeholder"></div>
              </div>
            </section>
            <section class="token-closure-sample">
              <h2>Settings controls</h2>
              <button class="s-segmented-btn" type="button">Ask</button>
              <details class="provider-advanced-fields" open>
                <summary class="provider-advanced-summary">Advanced</summary>
                <span class="provider-advanced-derived">derived from profile</span>
              </details>
            </section>
            <section class="token-closure-sample">
              <h2>Activity status</h2>
              <div class="sidebar-tool-panel">
                <div class="config-status-box">Status box uses canonical radius.</div>
              </div>
            </section>
          </main>
        </body>
      </html>
    `)

    const metrics = await page.evaluate(() => {
      const styles = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector)
        if (!node) throw new Error(`missing ${selector}`)
        const computed = getComputedStyle(node)
        return {
          backgroundColor: computed.backgroundColor,
          borderRadius: computed.borderTopLeftRadius,
          borderTopColor: computed.borderTopColor,
          borderTopStyle: computed.borderTopStyle,
          boxShadow: computed.boxShadow,
          color: computed.color,
          fontFamily: computed.fontFamily,
          fontWeight: computed.fontWeight,
        }
      }
      return {
        action: styles('.task-row-actions .oc-button[data-ui="task-row-delete"]'),
        rename: styles(".task-row-rename-input"),
        commit: styles(".changes-commit"),
        image: styles(".image-preview-dialog__image"),
        segmented: styles(".s-segmented-btn"),
        derived: styles(".provider-advanced-derived"),
        status: styles(".config-status-box"),
      }
    })

    for (const [name, metric] of Object.entries(metrics)) {
      assert.notEqual(metric.color, "rgba(0, 0, 0, 0)", `${name} color should resolve`)
    }
    for (const name of ["action", "rename", "image", "segmented", "status"] as const) {
      assert.notEqual(metrics[name].borderRadius, "0px", `${name} radius should resolve`)
    }
    assert.match(metrics.commit.fontFamily, /Cascadia|JetBrains|monospace/i)
    assert.match(metrics.derived.fontFamily, /Cascadia|JetBrains|monospace/i)
    assert.notEqual(metrics.image.boxShadow, "none")
    assert.equal(metrics.status.borderTopStyle, "solid")
    assert.notEqual(metrics.status.backgroundColor, "rgba(0, 0, 0, 0)")

    const stage = await page.$(".token-closure-stage")
    assert.ok(stage)
    writeFileSync(scratchPath("css-token-closure-light.png"), await stage.screenshot({}))
  } finally {
    await browser.close()
  }
})
