import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_DIR = resolve(OVERLAY_ROOT, ".scratch", "task-progress-floating-window")

function readCss(rel: string): string {
  return readFileSync(join(OVERLAY_ROOT, "src/styles", rel), "utf8")
}

function saveScreenshot(name: string, bytes: Buffer): string {
  const target = join(SCRATCH_DIR, name)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, bytes)
  return target
}

test("task progress floating window drags and resizes inside the message panel", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const css = [
    readCss("tokens/design-language.css"),
    readCss("cascade/base.css"),
    readCss("cascade/dark.css"),
    readCss("primitives/button.css"),
    readCss("surfaces/card.css"),
  ].join("\n")
  const fixtureGoals = [
    { number: 1, state: "passed", title: "Frame budget CSS handoff" },
    { number: 2, state: "passed", title: "Glass elevation polish" },
    { number: 3, state: "running", title: "Segmented minimap wiring" },
    { number: 4, state: "failed", title: "Failure evidence review" },
    { number: 5, state: "blocked", title: "Blocked dependency note" },
    { number: 6, state: "pending", title: "Final screenshot review" },
  ]
  const fixtureIcon = (state: string) => {
    if (state === "passed") {
      return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.3 6.6 11.4 12.8 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    }
    if (state === "running") {
      return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 0 1-8.4 3.7M3 8a5 5 0 0 1 8.4-3.7M11.4 1.8v2.5H8.9M4.6 14.2v-2.5h2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    }
    if (state === "pending") {
      return '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.8" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>'
    }
    return '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.8" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5.8 5.8 10.2 10.2M10.2 5.8 5.8 10.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
  }
  const segmentsMarkup = fixtureGoals
    .map(
      (goal) =>
        `<span class="task-progress__segment" data-ui="task-progress-segment" data-state="${goal.state}" data-goal-id="goal-${goal.number}" title="${goal.title}" aria-hidden="true"></span>`,
    )
    .join("")
  const pillsMarkup = fixtureGoals
    .map(
      (goal) => `<button type="button" class="oc-button" data-variant="outline" data-size="mini" data-tone="neutral" data-ui="task-progress-pill" data-state="${goal.state}" data-goal-id="goal-${goal.number}" title="${goal.title}">
        <span class="task-progress__pill-icon" aria-hidden="true">${fixtureIcon(goal.state)}</span>
        <span class="task-progress__pill-id">#G${goal.number}</span>
        <span class="task-progress__pill-title">${goal.title}</span>
      </button>`,
    )
    .join("")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1180, height: 720 })
    await page.setContent(`
      <!doctype html>
      <html data-theme="dark">
        <head>
          <style>
            ${css}
            body {
              margin: 0;
              background: var(--bg);
              color: var(--text);
              font-family: var(--font);
            }
            .fixture-shell {
              width: 1080px;
              height: 620px;
              margin: 40px auto;
              display: grid;
              grid-template-rows: 42px 1fr;
              border: var(--oc-border-width) solid var(--border);
              background: var(--surface);
            }
            .fixture-body {
              position: relative;
              min-height: 0;
              display: grid;
              grid-template-columns: minmax(0, 1fr) minmax(0, 760px) minmax(0, 1fr);
              background: var(--chat-canvas);
            }
            .fixture-scroll-shell {
              grid-column: 2;
              min-height: 0;
              display: flex;
            }
            .fixture-header {
              display: flex;
              align-items: center;
              padding: 0 16px;
              border-bottom: var(--oc-border-width) solid var(--border);
              color: var(--text-strong);
              font-weight: var(--ui-font-weight-strong);
            }
            .chat-scroll {
              flex: 1 1 auto;
              min-height: 0;
              height: 100%;
              padding: 18px 22px;
              overflow: auto;
              background:
                linear-gradient(180deg, color-mix(in srgb, var(--surface-inset) 82%, transparent), transparent 42%),
                var(--chat-canvas);
            }
            .fixture-message {
              width: min(720px, 100%);
              min-height: 68px;
              margin: 0 auto 12px;
              padding: 14px 16px;
              border: var(--oc-border-width) solid var(--card-border);
              border-radius: var(--oc-radius-soft);
              background: color-mix(in srgb, var(--card-bg-0) 84%, transparent);
              color: var(--text-soft);
              box-sizing: border-box;
            }
            .task-progress {
              --task-progress-left: 0px;
              --task-progress-top: 0px;
              --task-progress-width: 600px;
              --task-progress-height: 220px;
            }
          </style>
        </head>
        <body data-theme="dark">
          <section class="fixture-shell">
            <header class="fixture-header">Chat</header>
            <div class="fixture-body" data-ui="movement-boundary">
              <div class="fixture-scroll-shell" data-ui="scroll-shell">
                <main class="chat-scroll" data-ui="message-panel">
                  ${Array.from({ length: 18 }, (_, index) => `<article class="fixture-message" data-ui="fixture-message">Message panel content row ${index + 1}. The floating goals window should sit above this content and stay within the panel while it moves.</article>`).join("")}
                </main>
              </div>
              <section
                class="task-progress"
                role="region"
                aria-label="Goals"
                data-folded="false"
                data-floating-ready="true"
                data-running="true"
                data-window-state="idle"
              >
                <div class="task-progress__header" data-ui="task-progress-drag-handle" title="Drag goals window">
                  <span class="task-progress__heading">Goals</span>
                  <span class="task-progress__counts">
                    <span class="task-progress__count" data-state="passed" title="2 passed">
                      <span class="task-progress__count-dot" aria-hidden="true"></span>
                      <span>2</span>
                    </span>
                    <span class="task-progress__count" data-state="running" title="1 running">
                      <span class="task-progress__count-dot" aria-hidden="true"></span>
                      <span>1</span>
                    </span>
                    <span class="task-progress__count" data-state="failed" title="1 failed">
                      <span class="task-progress__count-dot" aria-hidden="true"></span>
                      <span>1</span>
                    </span>
                    <span class="task-progress__count" data-state="pending" title="1 pending">
                      <span class="task-progress__count-dot" aria-hidden="true"></span>
                      <span>1</span>
                    </span>
                  </span>
                  <span class="task-progress__summary">2/6</span>
                  <button
                    type="button"
                    class="oc-button"
                    data-variant="ghost"
                    data-size="icon"
                    data-tone="neutral"
                    data-ui="task-progress-fold"
                    aria-expanded="true"
                    aria-controls="taskProgressPills"
                    title="Collapse goals"
                    aria-label="Collapse goals"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                </div>
                <div class="task-progress__body">
                  <div class="task-progress__bar" aria-hidden="true">
                    ${segmentsMarkup}
                  </div>
                  <div id="taskProgressPills" class="task-progress__pills" data-collapsed="false">
                    ${pillsMarkup}
                  </div>
                </div>
                <button
                  type="button"
                  class="oc-button"
                  data-variant="ghost"
                  data-size="icon"
                  data-tone="neutral"
                  data-ui="task-progress-resize"
                  title="Resize goals window"
                  aria-label="Resize goals window"
                ></button>
              </section>
            </div>
          </section>
          <script>
            const boundary = document.querySelector('[data-ui="movement-boundary"]');
            const panel = document.querySelector('[data-ui="message-panel"]');
            const progress = document.querySelector(".task-progress");
            const header = document.querySelector('[data-ui="task-progress-drag-handle"]');
            const resize = document.querySelector('[data-ui="task-progress-resize"]');
            const inset = 8;
            let frame = {
              width: Math.round((boundary.clientWidth - inset * 2) * 0.64),
              height: 220,
            };
            frame.x = Math.round((boundary.clientWidth - frame.width) / 2);
            frame.y = Math.round((boundary.clientHeight - frame.height) * 0.24);
            let session = null;
            function clamp(next) {
              const minWidth = Math.min(320, boundary.clientWidth - inset * 2);
              const minHeight = Math.min(96, boundary.clientHeight - inset * 2);
              const width = Math.min(boundary.clientWidth - inset * 2, Math.max(minWidth, next.width));
              const height = Math.min(boundary.clientHeight - inset * 2, Math.max(minHeight, next.height));
              const x = Math.min(Math.max(next.x, inset), boundary.clientWidth - inset - width);
              const y = Math.min(Math.max(next.y, inset), boundary.clientHeight - inset - height);
              return { x, y, width, height };
            }
            function resizeFromAnchor(start, dx, dy) {
              const anchored = clamp(start);
              return {
                ...anchored,
                width: Math.min(boundary.clientWidth - inset - anchored.x, Math.max(320, anchored.width + dx)),
                height: anchored.height,
              };
            }
            function apply() {
              frame = clamp(frame);
              progress.style.setProperty("--task-progress-left", Math.round(frame.x) + "px");
              progress.style.setProperty("--task-progress-top", Math.round(frame.y) + "px");
              progress.style.setProperty("--task-progress-width", Math.round(frame.width) + "px");
              progress.style.setProperty("--task-progress-height", Math.round(frame.height) + "px");
            }
            function begin(event, kind) {
              if (event.button !== 0) return;
              if (kind === "move" && event.target.closest("button")) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              session = {
                kind,
                pointerID: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                startFrame: { ...frame },
                capture: event.currentTarget,
              };
              progress.dataset.windowState = kind === "move" ? "dragging" : "resizing";
              event.preventDefault();
              event.stopPropagation();
            }
            function move(event) {
              if (!session || session.pointerID !== event.pointerId) return;
              const dx = event.clientX - session.startX;
              const dy = event.clientY - session.startY;
              frame = session.kind === "move"
                ? clamp({ ...session.startFrame, x: session.startFrame.x + dx, y: session.startFrame.y + dy })
                : resizeFromAnchor(session.startFrame, dx, dy);
              apply();
              event.preventDefault();
            }
            function end(event) {
              if (!session || session.pointerID !== event.pointerId) return;
              if (session.capture.hasPointerCapture(event.pointerId)) session.capture.releasePointerCapture(event.pointerId);
              session = null;
              progress.dataset.windowState = "idle";
            }
            header.addEventListener("pointerdown", (event) => begin(event, "move"));
            resize.addEventListener("pointerdown", (event) => begin(event, "resize"));
            progress.addEventListener("pointermove", move);
            progress.addEventListener("pointerup", end);
            progress.addEventListener("pointercancel", end);
            window.addEventListener("resize", apply);
            apply();
          </script>
        </body>
      </html>
    `)

    await page.waitForSelector(".task-progress[data-floating-ready='true']", { visible: true })
    const initial = await page.evaluate(() => {
      const boundary = document.querySelector<HTMLElement>('[data-ui="movement-boundary"]')!.getBoundingClientRect()
      const panel = document.querySelector<HTMLElement>('[data-ui="message-panel"]')!.getBoundingClientRect()
      const firstMessage = document.querySelector<HTMLElement>('[data-ui="fixture-message"]')!.getBoundingClientRect()
      const node = document.querySelector<HTMLElement>(".task-progress")!
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      const budget = Number.parseFloat(style.getPropertyValue("--task-progress-height"))
      return {
        left: rect.left,
        top: rect.top,
        boundaryLeft: boundary.left,
        boundaryTop: boundary.top,
        boundaryRight: boundary.right,
        boundaryBottom: boundary.bottom,
        panelLeft: panel.left,
        panelTop: panel.top,
        firstMessageTop: firstMessage.top,
        width: rect.width,
        height: rect.height,
        budget,
        opacity: style.opacity,
        boxShadow: style.boxShadow,
        backdropFilter: style.backdropFilter,
      }
    })
    assert.equal(initial.opacity, "1")
    assert.ok(initial.left > initial.boundaryLeft + 80, `initial window should not stick to the left edge: ${JSON.stringify(initial)}`)
    assert.ok(initial.top > initial.boundaryTop + 40, `initial window should not stick to the top edge: ${JSON.stringify(initial)}`)
    assert.ok(
      Math.abs(initial.firstMessageTop - (initial.panelTop + 18)) <= 2,
      `first message should stay at panel padding instead of below the progress window: ${JSON.stringify(initial)}`,
    )
    assert.ok(initial.height < initial.budget)
    assert.notEqual(initial.boxShadow, "none")
    assert.notEqual(initial.backdropFilter, "none")

    const idleScreenshotPath = saveScreenshot("dark-window-idle-mixed-states.png", await page.screenshot({ fullPage: false }))
    assert.ok(idleScreenshotPath.endsWith("dark-window-idle-mixed-states.png"))

    const headerRect = await page.$eval('[data-ui="task-progress-drag-handle"]', (node) => {
      const rect = (node as HTMLElement).getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })
    await page.mouse.move(headerRect.x, headerRect.y)
    await page.mouse.down()
    await page.mouse.move(headerRect.x + 360, headerRect.y + 110, { steps: 8 })
    await page.mouse.up()

    const movedRight = await page.evaluate(() => {
      const boundary = document.querySelector<HTMLElement>('[data-ui="movement-boundary"]')!.getBoundingClientRect()
      const panel = document.querySelector<HTMLElement>('[data-ui="message-panel"]')!.getBoundingClientRect()
      const progress = document.querySelector<HTMLElement>(".task-progress")!.getBoundingClientRect()
      return {
        boundary: { left: boundary.left, top: boundary.top, right: boundary.right, bottom: boundary.bottom },
        panel: { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom },
        progress: { left: progress.left, top: progress.top, right: progress.right, bottom: progress.bottom },
      }
    })
    assert.ok(movedRight.progress.left > initial.left + 120)
    assert.ok(movedRight.progress.top > initial.top + 80)
    assert.ok(movedRight.progress.right > movedRight.panel.right + 80)
    assert.ok(movedRight.progress.left >= movedRight.boundary.left + 7)
    assert.ok(movedRight.progress.top >= movedRight.boundary.top + 7)
    assert.ok(movedRight.progress.right <= movedRight.boundary.right - 7)
    assert.ok(movedRight.progress.bottom <= movedRight.boundary.bottom - 7)

    const rightGutterScreenshotPath = saveScreenshot("dark-window-right-gutter.png", await page.screenshot({ fullPage: false }))
    assert.ok(rightGutterScreenshotPath.endsWith("dark-window-right-gutter.png"))

    const movedHeaderRect = await page.$eval('[data-ui="task-progress-drag-handle"]', (node) => {
      const rect = (node as HTMLElement).getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })
    await page.mouse.move(movedHeaderRect.x, movedHeaderRect.y)
    await page.mouse.down()
    await page.mouse.move(movedHeaderRect.x - 760, movedHeaderRect.y - 60, { steps: 10 })
    await page.mouse.up()

    const movedLeft = await page.evaluate(() => {
      const boundary = document.querySelector<HTMLElement>('[data-ui="movement-boundary"]')!.getBoundingClientRect()
      const panel = document.querySelector<HTMLElement>('[data-ui="message-panel"]')!.getBoundingClientRect()
      const progress = document.querySelector<HTMLElement>(".task-progress")!.getBoundingClientRect()
      return {
        boundary: { left: boundary.left, top: boundary.top, right: boundary.right, bottom: boundary.bottom },
        panel: { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom },
        progress: { left: progress.left, top: progress.top, right: progress.right, bottom: progress.bottom },
      }
    })
    assert.ok(movedLeft.progress.left < movedLeft.panel.left - 80)
    assert.ok(movedLeft.progress.left >= movedLeft.boundary.left + 7)
    assert.ok(movedLeft.progress.top >= movedLeft.boundary.top + 7)
    assert.ok(movedLeft.progress.right <= movedLeft.boundary.right - 7)
    assert.ok(movedLeft.progress.bottom <= movedLeft.boundary.bottom - 7)

    const leftGutterScreenshotPath = saveScreenshot("dark-window-left-gutter.png", await page.screenshot({ fullPage: false }))
    assert.ok(leftGutterScreenshotPath.endsWith("dark-window-left-gutter.png"))

    const resizeRect = await page.$eval('[data-ui="task-progress-resize"]', (node) => {
      const rect = (node as HTMLElement).getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })
    await page.mouse.move(resizeRect.x, resizeRect.y)
    await page.mouse.down()
    await page.mouse.move(resizeRect.x + 140, resizeRect.y + 90, { steps: 8 })
    await page.mouse.up()

    const resized = await page.evaluate(() => {
      const boundary = document.querySelector<HTMLElement>('[data-ui="movement-boundary"]')!.getBoundingClientRect()
      const progressEl = document.querySelector<HTMLElement>(".task-progress")!
      const progress = progressEl.getBoundingClientRect()
      const style = getComputedStyle(progressEl)
      const resizeButton = document.querySelector<HTMLElement>('[data-ui="task-progress-resize"]')!
      return {
        width: progress.width,
        height: progress.height,
        heightBudget: Number.parseFloat(style.getPropertyValue("--task-progress-height")),
        boundaryRight: boundary.right,
        boundaryBottom: boundary.bottom,
        right: progress.right,
        bottom: progress.bottom,
        resizeCursor: getComputedStyle(resizeButton).cursor,
      }
    })
    assert.ok(resized.width >= movedLeft.progress.right - movedLeft.progress.left)
    assert.equal(resized.heightBudget, initial.budget)
    assert.ok(resized.height <= resized.heightBudget)
    assert.ok(resized.right <= resized.boundaryRight - 7)
    assert.ok(resized.bottom <= resized.boundaryBottom - 7)
    assert.equal(resized.resizeCursor, "ew-resize")

    const screenshotPath = saveScreenshot("dark-window-after-drag-resize.png", await page.screenshot({ fullPage: false }))
    assert.ok(screenshotPath.endsWith("dark-window-after-drag-resize.png"))
    await page.close()
  } finally {
    await browser.close().catch(() => undefined)
  }
})
