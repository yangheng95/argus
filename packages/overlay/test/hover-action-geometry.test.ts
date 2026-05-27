import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

import { launchBrowser } from "./launch"

const OVERLAY_ROOT = path.resolve(import.meta.dir, "..")
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function css(relativePath: string): string {
  return readFileSync(path.join(OVERLAY_ROOT, relativePath), "utf8")
}

function styleSheet(): string {
  return [
    "src/styles/tokens/design-language.css",
    "src/styles/cascade/dark.css",
    "src/styles/cascade/base.css",
    "src/styles/primitives/button.css",
    "src/styles/surfaces/sidebar.css",
    "src/styles/surfaces/conversation.css",
  ].map(css).join("\n")
}

test("hover-only action rails do not overlap row text", async () => {
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 720, height: 360 })
    await page.setContent(`
      <!doctype html>
      <html data-theme="dark">
        <head>
          <style>${styleSheet()}</style>
          <style>
            body { margin: 0; padding: 24px; background: var(--body-bg); color: var(--text); }
            .fixture { width: 500px; display: grid; gap: 24px; }
            .oc-button { box-sizing: border-box; }
          </style>
        </head>
        <body data-theme="dark">
          <main class="fixture">
            <div class="task-row-mini global-task-row" data-status="active">
              <span class="task-row-badge" data-status="active"><span class="task-row-badge-text">active</span></span>
              <div class="task-row-body">
                <button type="button" class="task-row-main">
                  <div class="task-row-head"><strong># TradingView Supercharts full migration long title</strong></div>
                </button>
              </div>
              <div class="task-row-right">
                <small class="task-row-stamp">07:56:38</small>
                <div class="task-row-actions">
                  <button type="button" class="oc-button" data-ui="task-row-start-now">S</button>
                  <button type="button" class="oc-button" data-ui="task-row-cancel">C</button>
                  <button type="button" class="oc-button" data-ui="task-row-delete">D</button>
                </div>
              </div>
            </div>

            <div class="recent-dir-row">
              <button type="button" class="recent-dir-item">
                <span class="recent-dir-copy">
                  <span class="recent-dir-label">superchart</span>
                  <span class="recent-dir-path">D:/myhexin-local/demos/superchart/very/long/path</span>
                </span>
              </button>
              <button type="button" class="recent-dir-remove" aria-label="delete">x</button>
            </div>
          </main>
        </body>
      </html>
    `)

    const rest = await page.evaluate(() => {
      const taskActions = document.querySelector<HTMLElement>(".task-row-actions")!
      const recentRemove = document.querySelector<HTMLElement>(".recent-dir-remove")!
      return {
        taskOpacity: getComputedStyle(taskActions.querySelector<HTMLElement>(".oc-button")!).opacity,
        taskPointerEvents: getComputedStyle(taskActions.querySelector<HTMLElement>(".oc-button")!).pointerEvents,
        recentOpacity: getComputedStyle(recentRemove).opacity,
        recentPointerEvents: getComputedStyle(recentRemove).pointerEvents,
      }
    })
    expect(rest).toEqual({
      taskOpacity: "0",
      taskPointerEvents: "none",
      recentOpacity: "0",
      recentPointerEvents: "none",
    })

    await page.hover(".task-row-mini")
    await sleep(260)
    const taskHover = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>(".task-row-main")!.getBoundingClientRect()
      const actions = document.querySelector<HTMLElement>(".task-row-actions")!.getBoundingClientRect()
      const stamp = document.querySelector<HTMLElement>(".task-row-stamp")!
      return {
        mainRight: main.right,
        actionsLeft: actions.left,
        stampOpacity: getComputedStyle(stamp).opacity,
      }
    })
    expect(taskHover.mainRight).toBeLessThanOrEqual(taskHover.actionsLeft)
    expect(taskHover.stampOpacity).toBe("0")

    await page.hover(".recent-dir-row")
    await sleep(260)
    const recentHover = await page.evaluate(() => {
      const item = document.querySelector<HTMLElement>(".recent-dir-item")!.getBoundingClientRect()
      const remove = document.querySelector<HTMLElement>(".recent-dir-remove")!.getBoundingClientRect()
      return {
        itemRight: item.right,
        removeLeft: remove.left,
        removePointerEvents: getComputedStyle(document.querySelector<HTMLElement>(".recent-dir-remove")!).pointerEvents,
      }
    })
    expect(recentHover.itemRight).toBeLessThanOrEqual(recentHover.removeLeft)
    expect(recentHover.removePointerEvents).toBe("auto")
  } finally {
    await browser.close()
  }
}, { timeout: 120_000 })
