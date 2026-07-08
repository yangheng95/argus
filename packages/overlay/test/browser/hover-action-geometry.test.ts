import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"

const OVERLAY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
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
  ]
    .map(css)
    .join("\n")
}

function workLedgerStyleSheet(): string {
  return [
    "src/styles/tokens/design-language.css",
    "src/styles/cascade/dark.css",
    "src/styles/cascade/base.css",
    "src/styles/primitives/button.css",
    "src/styles/surfaces/sidebar.css",
    "src/styles/surfaces/work-ledger.css",
  ]
    .map(css)
    .join("\n")
}

test(
  "hover-only action rails do not overlap row text",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

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
                  <button type="button" class="oc-button" data-chrome="icon-action" data-ui="task-row-start-now">S</button>
                  <button type="button" class="oc-button" data-chrome="icon-action" data-ui="task-row-cancel" aria-label="Stop">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <rect x="4" y="4" width="8" height="8" rx="1" fill="none" stroke="currentColor" />
                    </svg>
                  </button>
                  <button type="button" class="oc-button" data-chrome="icon-action" data-ui="task-row-download">D</button>
                  <button type="button" class="oc-button" data-chrome="icon-action" data-ui="task-row-rename">R</button>
                  <button type="button" class="oc-button" data-chrome="icon-action" data-ui="task-row-delete">D</button>
                </div>
              </div>
            </div>

          </main>
        </body>
      </html>
    `)

      await page.mouse.move(1, 1)
      await sleep(260)
      const rest = await page.evaluate(() => {
        const taskActions = document.querySelector<HTMLElement>(".task-row-actions")!
        return {
          taskOpacity: getComputedStyle(taskActions.querySelector<HTMLElement>(".oc-button")!).opacity,
          taskPointerEvents: getComputedStyle(taskActions.querySelector<HTMLElement>(".oc-button")!).pointerEvents,
        }
      })
      assert.deepEqual(rest, {
        taskOpacity: "0",
        taskPointerEvents: "none",
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
      assert.ok(
        taskHover.mainRight <= taskHover.actionsLeft,
        `expected task row text to end before actions: ${taskHover.mainRight} <= ${taskHover.actionsLeft}`,
      )
      assert.equal(taskHover.stampOpacity, "0")
    } finally {
      await browser.close()
    }
  },
  { timeout: 120_000 },
)

test(
  "Work Ledger action rails do not overlap inline metadata or status",
  async () => {
    assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
    assert.equal(typeof globalThis.Bun, "undefined")

    const browser = await launchBrowser()
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 520, height: 240 })
      await page.setContent(`
      <!doctype html>
      <html data-theme="dark">
        <head>
          <style>${workLedgerStyleSheet()}</style>
          <style>
            body { margin: 0; padding: 24px; background: var(--body-bg); color: var(--text); }
            .fixture { width: 370px; }
            .oc-button { box-sizing: border-box; }
          </style>
        </head>
        <body data-theme="dark">
          <main class="fixture">
            <div class="task-row-mini global-task-row work-row" data-kind="mission" data-status="active" data-action-count="1">
              <span class="work-row-kind-mark" data-kind="mission">M</span>
              <div class="task-row-body work-row-body">
                <button type="button" class="oc-button task-row-main work-row-main" data-ui="ledger-row-main" data-variant="ghost" data-size="sm" data-tone="neutral">
                  <div class="task-row-head work-row-head">
                    <strong>Replicate TradingView futures page</strong>
                    <span class="work-row-inline-meta">2 tasks</span>
                  </div>
                </button>
              </div>
              <div class="task-row-right work-row-right">
                <span class="work-row-status-mark" data-status="active">1/2</span>
                <small class="task-row-stamp work-row-stamp">now</small>
                <div class="task-row-actions work-row-actions">
                  <button type="button" class="oc-button" data-chrome="icon-action" data-ui="work-row-delete" aria-label="Delete">
                    <svg viewBox="0 0 16 16" aria-hidden="true" data-icon="delete" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3.5 4.5h9"></path>
                      <path d="M6.5 4.5V3.3h3v1.2"></path>
                      <path d="M5 6v6.2h6V6"></path>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <div class="task-row-mini global-task-row work-row" data-status="completed" data-action-count="3">
              <span class="work-row-kind-mark" data-kind="task">T</span>
              <div class="task-row-body work-row-body">
                <button type="button" class="oc-button task-row-main work-row-main" data-ui="ledger-row-main" data-variant="ghost" data-size="sm" data-tone="neutral">
                  <div class="task-row-head work-row-head">
                    <strong>project delete task B</strong>
                  </div>
                </button>
              </div>
              <div class="task-row-right work-row-right">
                <span class="work-row-status-mark" data-status="completed">Completed</span>
                <small class="task-row-stamp work-row-stamp">1m ago</small>
                <div class="task-row-actions work-row-actions">
                  <button type="button" class="oc-button" data-chrome="icon-action" data-ui="task-row-download">D</button>
                  <button type="button" class="oc-button" data-chrome="icon-action" data-ui="task-row-rename">R</button>
                  <button type="button" class="oc-button" data-chrome="icon-action" data-ui="task-row-delete">X</button>
                </div>
              </div>
            </div>
            <div class="task-row-mini global-task-row work-row" data-status="queued" data-action-count="5">
              <span class="work-row-kind-mark" data-kind="task">T</span>
              <div class="task-row-body work-row-body">
                <button type="button" class="oc-button task-row-main work-row-main" data-ui="ledger-row-main" data-variant="ghost" data-size="sm" data-tone="neutral">
                  <div class="task-row-head work-row-head">
                    <strong>Phase 01: Futures Clone Audit very long mounted task title</strong>
                    <span class="work-row-inline-meta">Mission task</span>
                  </div>
                </button>
              </div>
              <div class="task-row-right work-row-right">
                <span class="work-row-status-mark" data-status="queued">Queued</span>
                <small class="task-row-stamp work-row-stamp">just now</small>
                <div class="task-row-actions work-row-actions">
                  <button type="button" class="oc-button" data-chrome="icon-action" data-ui="task-row-start-now">S</button>
                  <button type="button" class="oc-button" data-chrome="icon-action" data-ui="task-row-cancel" aria-label="Stop">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <rect x="4" y="4" width="8" height="8" rx="1" fill="none" stroke="currentColor"></rect>
                    </svg>
                  </button>
                  <button type="button" class="oc-button" data-chrome="icon-action" data-ui="task-row-download">D</button>
                  <button type="button" class="oc-button" data-chrome="icon-action" data-ui="task-row-rename">R</button>
                  <button type="button" class="oc-button" data-chrome="icon-action" data-ui="task-row-delete">X</button>
                </div>
              </div>
            </div>
          </main>
        </body>
      </html>
    `)

      await page.mouse.move(1, 1)
      await sleep(260)
      const completedRest = await page.evaluate(() => {
        const row = document.querySelector<HTMLElement>('.work-row[data-status="completed"]')!
        const center = (rect: DOMRect) => (rect.top + rect.bottom) / 2
        const icon = row.querySelector<HTMLElement>(".work-row-kind-mark")!.getBoundingClientRect()
        const title = row.querySelector<HTMLElement>(".work-row-head strong")!.getBoundingClientRect()
        const status = row.querySelector<HTMLElement>(".work-row-status-mark")!.getBoundingClientRect()
        const stamp = row.querySelector<HTMLElement>(".work-row-stamp")!.getBoundingClientRect()
        const actions = row.querySelector<HTMLElement>(".work-row-actions")!.getBoundingClientRect()
        const firstAction = row.querySelector<HTMLElement>(".work-row-actions .oc-button")!
        return {
          iconDelta: Math.abs(center(icon) - center(title)),
          statusDelta: Math.abs(center(status) - center(title)),
          stampDelta: Math.abs(center(stamp) - center(title)),
          actionsWidth: actions.width,
          firstActionOpacity: getComputedStyle(firstAction).opacity,
          firstActionPointerEvents: getComputedStyle(firstAction).pointerEvents,
        }
      })
      assert.ok(completedRest.iconDelta <= 1.5, `expected icon and title centerlines to match: ${completedRest.iconDelta}`)
      assert.ok(
        completedRest.statusDelta <= 1.5,
        `expected status chip and title centerlines to match: ${completedRest.statusDelta}`,
      )
      assert.ok(
        completedRest.stampDelta <= 1.5,
        `expected timestamp and title centerlines to match: ${completedRest.stampDelta}`,
      )
      assert.equal(completedRest.actionsWidth, 0)
      assert.equal(completedRest.firstActionOpacity, "0")
      assert.equal(completedRest.firstActionPointerEvents, "none")

      mkdirSync(path.join(OVERLAY_ROOT, ".scratch"), { recursive: true })
      const completedRestElement = await page.$('.work-row[data-status="completed"]')
      assert.ok(completedRestElement)
      const completedRestScreenshot = await completedRestElement.screenshot({})
      writeFileSync(path.join(OVERLAY_ROOT, ".scratch", "work-ledger-default-row-alignment.png"), completedRestScreenshot)
      assert.ok(completedRestScreenshot.byteLength > 0)

      await page.hover('.work-row[data-status="completed"]')
      await sleep(260)
      const completedHover = await page.evaluate(() => {
        const row = document.querySelector<HTMLElement>('.work-row[data-status="completed"]')!
        const center = (rect: DOMRect) => (rect.top + rect.bottom) / 2
        const rowRect = row.getBoundingClientRect()
        const title = row.querySelector<HTMLElement>(".work-row-head strong")!.getBoundingClientRect()
        const main = row.querySelector<HTMLElement>(".work-row-main")!.getBoundingClientRect()
        const actions = row.querySelector<HTMLElement>(".work-row-actions")!.getBoundingClientRect()
        const download = row.querySelector<HTMLElement>('[data-ui="task-row-download"]')!.getBoundingClientRect()
        const rename = row.querySelector<HTMLElement>('[data-ui="task-row-rename"]')!.getBoundingClientRect()
        const remove = row.querySelector<HTMLElement>('[data-ui="task-row-delete"]')!.getBoundingClientRect()
        const status = row.querySelector<HTMLElement>(".work-row-status-mark")!
        const stamp = row.querySelector<HTMLElement>(".work-row-stamp")!
        return {
          titleToDownloadDelta: Math.abs(center(title) - center(download)),
          titleToRenameDelta: Math.abs(center(title) - center(rename)),
          titleToDeleteDelta: Math.abs(center(title) - center(remove)),
          mainRight: main.right,
          actionsLeft: actions.left,
          actionsRight: actions.right,
          rowRight: rowRect.right,
          actionsWidth: actions.width,
          firstGap: rename.left - download.right,
          secondGap: remove.left - rename.right,
          rightPad: actions.right - remove.right,
          statusWidth: status.getBoundingClientRect().width,
          stampWidth: stamp.getBoundingClientRect().width,
        }
      })
      assert.ok(
        completedHover.mainRight <= completedHover.actionsLeft,
        `expected completed row text to end before actions: ${completedHover.mainRight} <= ${completedHover.actionsLeft}`,
      )
      assert.equal(completedHover.actionsWidth, 82)
      assert.ok(completedHover.firstGap >= 4, `expected gap between download and rename actions: ${completedHover.firstGap}`)
      assert.ok(completedHover.secondGap >= 4, `expected gap between rename and delete actions: ${completedHover.secondGap}`)
      assert.ok(completedHover.rightPad >= 4, `expected right rail padding before row edge: ${completedHover.rightPad}`)
      assert.ok(
        completedHover.rowRight - completedHover.actionsRight >= 0,
        `expected action rail to stay inside row edge: ${completedHover.actionsRight} <= ${completedHover.rowRight}`,
      )
      assert.ok(
        completedHover.titleToDownloadDelta <= 1.5,
        `expected download action and title centerlines to match: ${completedHover.titleToDownloadDelta}`,
      )
      assert.ok(
        completedHover.titleToRenameDelta <= 1.5,
        `expected rename action and title centerlines to match: ${completedHover.titleToRenameDelta}`,
      )
      assert.ok(
        completedHover.titleToDeleteDelta <= 1.5,
        `expected delete action and title centerlines to match: ${completedHover.titleToDeleteDelta}`,
      )
      assert.equal(completedHover.statusWidth, 0)
      assert.equal(completedHover.stampWidth, 0)

      await page.hover('.work-row[data-kind="mission"]')
      await sleep(260)
      const missionHover = await page.evaluate(() => {
        const row = document.querySelector<HTMLElement>('.work-row[data-kind="mission"]')!
        const actions = row.querySelector<HTMLElement>(".work-row-actions")!.getBoundingClientRect()
        const deleteIcon = row.querySelector<SVGElement>('[data-ui="work-row-delete"] svg')!
        return {
          actionsWidth: actions.width,
          stopCount: row.querySelectorAll('[data-ui="work-row-stop"]').length,
          deleteIconName: deleteIcon.getAttribute("data-icon"),
          deletePathCount: deleteIcon.querySelectorAll("path").length,
        }
      })
      assert.equal(missionHover.actionsWidth, 30)
      assert.equal(missionHover.stopCount, 0)
      assert.equal(missionHover.deleteIconName, "delete")
      assert.equal(missionHover.deletePathCount, 3)

      await page.hover('.work-row[data-status="queued"]')
      await sleep(260)
      const workHover = await page.evaluate(() => {
        const row = document.querySelector<HTMLElement>('.work-row[data-status="queued"]')!
        const main = row.querySelector<HTMLElement>(".work-row-main")!.getBoundingClientRect()
        const actions = row.querySelector<HTMLElement>(".work-row-actions")!.getBoundingClientRect()
        const meta = row.querySelector<HTMLElement>(".work-row-inline-meta")!
        const right = row.querySelector<HTMLElement>(".work-row-right")!
        const status = row.querySelector<HTMLElement>(".work-row-status-mark")!
        const stamp = row.querySelector<HTMLElement>(".work-row-stamp")!
        const cancelButton = row.querySelector<HTMLElement>('[data-ui="task-row-cancel"]')!
        const cancelRect = cancelButton.querySelector<SVGRectElement>("rect")!
        const cancelSvg = cancelButton.querySelector<SVGSVGElement>("svg")!
        return {
          mainRight: main.right,
          actionsLeft: actions.left,
          actionsWidth: actions.width,
          metaWidth: meta.getBoundingClientRect().width,
          rightGap: getComputedStyle(right).gap,
          statusWidth: status.getBoundingClientRect().width,
          stampWidth: stamp.getBoundingClientRect().width,
          cancelColor: getComputedStyle(cancelButton).color,
          cancelRectFill: getComputedStyle(cancelRect).fill,
          cancelRectStroke: getComputedStyle(cancelRect).stroke,
          cancelSvgWidth: Math.round(cancelSvg.getBoundingClientRect().width),
        }
      })
      assert.ok(
        workHover.mainRight <= workHover.actionsLeft,
        `expected WorkLedger row text to end before actions: ${workHover.mainRight} <= ${workHover.actionsLeft}`,
      )
      assert.equal(workHover.actionsWidth, 134)
      assert.equal(workHover.metaWidth, 0)
      assert.equal(workHover.rightGap, "0px")
      assert.equal(workHover.statusWidth, 0)
      assert.equal(workHover.stampWidth, 0)
      assert.equal(workHover.cancelRectFill, "none")
      assert.equal(workHover.cancelRectStroke, workHover.cancelColor)
      assert.ok(workHover.cancelSvgWidth >= 8 && workHover.cancelSvgWidth <= 10)

      const queuedRowElement = await page.$('.work-row[data-status="queued"]')
      assert.ok(queuedRowElement)
      const queuedScreenshot = await queuedRowElement.screenshot({})
      writeFileSync(path.join(OVERLAY_ROOT, ".scratch", "work-ledger-queued-stop-line-icon.png"), queuedScreenshot)
      assert.ok(queuedScreenshot.byteLength > 0)

      await page.hover('.work-row[data-kind="mission"]')
      await sleep(260)
      const rowElement = await page.$('.work-row[data-kind="mission"]')
      assert.ok(rowElement)
      const screenshot = await rowElement.screenshot({})
      writeFileSync(path.join(OVERLAY_ROOT, ".scratch", "work-ledger-action-geometry.png"), screenshot)
      assert.ok(screenshot.byteLength > 0)

      await page.hover('.work-row[data-status="completed"]')
      await sleep(260)
      const completedRowElement = await page.$('.work-row[data-status="completed"]')
      assert.ok(completedRowElement)
      const completedScreenshot = await completedRowElement.screenshot({})
      writeFileSync(path.join(OVERLAY_ROOT, ".scratch", "work-ledger-action-rail-alignment.png"), completedScreenshot)
      assert.ok(completedScreenshot.byteLength > 0)
    } finally {
      await browser.close()
    }
  },
  { timeout: 120_000 },
)
