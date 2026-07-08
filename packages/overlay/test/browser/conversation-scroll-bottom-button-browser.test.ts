import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_DIR = resolve(OVERLAY_ROOT, ".scratch", "conversation-scroll-bottom-button")

function read(relativePath: string): string {
  return readFileSync(join(OVERLAY_ROOT, relativePath), "utf8")
}

function saveScreenshot(name: string, bytes: Buffer): string {
  const file = join(SCRATCH_DIR, name)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, bytes)
  return file
}

test("floating scroll-to-bottom button stays above the composer and re-pins the transcript", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 960, height: 720 })
    await page.setContent(`
      <!doctype html>
      <style>
        :root {
          --ui-scale: 1;
          --ui-z-sticky: 40;
          --ui-shadow-tone: rgba(15, 23, 42, 0.45);
          --ui-duration-base: 0ms;
          --ui-timing-standard: linear;
          --ui-opacity-full: 1;
          --ui-opacity-hidden: 0;
          --ui-opacity-subtle: .72;
          --ui-opacity-dim: .64;
          --ui-opacity-disabled: .48;
          --ui-font-control: 13px;
          --ui-font-small: 12px;
          --ui-font-meta: 11px;
          --ui-font-title: 13px;
          --ui-font-weight-strong: 650;
          --ui-font-weight-body: 400;
          --ui-font-weight-medium: 500;
          --ui-letter-spacing-normal: 0;
          --ui-letter-spacing-loose: .02em;
          --font: Inter, system-ui, sans-serif;
          --oc-density-control-height: 30px;
          --oc-density-icon-button: 30px;
          --oc-density-chip-height: 18px;
          --oc-header-gap: 8px;
          --ui-btn-mini-padding-x: 6px;
          --ui-btn-mini-padding-y: 0;
          --oc-radius-soft: 8px;
          --oc-radius-pill: 999px;
          --oc-border-width: 1px;
          --surface: #ffffff;
          --surface-inset: #f7f8fa;
          --surface-hover: #eef1f5;
          --bg: #edf0f4;
          --chat-canvas: #f5f7fa;
          --text: #243042;
          --text-strong: #111827;
          --text-soft: #475569;
          --text-muted: #64748b;
          --text-on-strong: #ffffff;
          --border: #d7dde6;
          --border-strong: #aeb8c7;
          --accent: #2563eb;
          --card-bg-0: #ffffff;
          --card-bg-1: #ffffff;
          --card-border: #d7dde6;
          --card-border-strong: #aeb8c7;
          --card-line-dim: #d7dde6;
          --card-stage: #2563eb;
          --conversation-card-inline-size: 100%;
          --conversation-user-card-inline-size: min(72%, 720px);
          --conversation-system-card-inline-size: min(86%, 760px);
        }
        body {
          margin: 0;
          background: var(--bg);
          color: var(--text);
          font-family: var(--font);
        }
        [hidden] {
          display: none !important;
        }
        .chat {
          width: 760px;
          height: 640px;
          margin: 32px auto;
          display: flex;
          flex-direction: column;
          background: var(--chat-canvas);
          border: 1px solid var(--border);
          overflow: hidden;
        }
        .chat-header {
          flex: 0 0 42px;
          display: flex;
          align-items: center;
          padding: 0 16px;
          border-bottom: 1px solid var(--border);
          background: var(--surface);
          font-weight: 650;
        }
        .chat-message-pane {
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .conversation-body {
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
        }
        ${read("src/styles/primitives/button.css")}
        ${read("src/styles/surfaces/conversation.css")}
        ${read("src/styles/surfaces/chat-bubble.css")}
        .composer-fixture {
          flex: 0 0 84px;
          display: flex;
          align-items: center;
          padding: 12px 16px;
          border-top: 1px solid var(--border);
          background: var(--surface);
        }
        .composer-fixture-box {
          width: 100%;
          height: 52px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface-inset);
        }
        .chat-bubble-row[data-kind="agent"] .chat-bubble {
          margin: 0;
        }
        .chat-bubble__body,
        .chat-bubble__body-inner {
          display: none;
        }
        .chat-bubble__title {
          font-size: 13px;
        }
      </style>
      <section class="chat">
        <header class="chat-header">Workflow</header>
        <div class="chat-message-pane">
          <div class="conversation-body">
            <div class="conversation-scroll-shell">
              <main class="chat-scroll session-content" id="scroll" data-follow-lock="false"></main>
              <button
                type="button"
                class="oc-button conversation-scroll-bottom"
                data-variant="solid"
                data-size="icon"
                data-tone="neutral"
                data-ui="conversation-scroll-bottom"
                title="Scroll to bottom"
                aria-label="Scroll to bottom"
                hidden
              >
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          </div>
        </div>
        <div class="composer-fixture"><div class="composer-fixture-box"></div></div>
      </section>
      <script>
        const scroll = document.getElementById("scroll");
        const button = document.querySelector('[data-ui="conversation-scroll-bottom"]');
        function agentRow(index) {
          const item = document.createElement("div");
          item.className = "conversation-virtual-item";
          item.innerHTML = '<article class="chat-bubble-row chat-bubble-row--collapsed" data-card-id="agent-' + index + '" data-kind="agent" data-role="assistant" data-stage="assistant" data-status="completed" data-depth="0">' +
            '<div class="chat-bubble-shell" data-align="left"><div class="chat-bubble chat-bubble--collapsed" data-align="left" data-stage="assistant" data-status="completed">' +
            '<div class="chat-bubble__head" data-align="left"><div class="chat-bubble__title-row"><button class="oc-button chat-bubble__head-main" data-variant="ghost" data-size="mini" data-tone="neutral" data-ui="chat-bubble-head-main" aria-expanded="false">' +
            '<span class="chat-bubble__identity" data-align="left"><span class="chat-bubble__identity-copy"><span class="chat-bubble__title-line" data-align="left"><span class="chat-bubble__title">Assistant</span></span></span></span>' +
            '<span class="card__preview-row"><span class="card__collapsed-preview">Completed result ' + index + ' with enough text to prove the collapsed preview line is visible.</span></span>' +
            '</button></div></div><div class="chat-bubble__foot"><span class="chat-bubble__stamp">12:' + String(index).padStart(2, "0") + '</span></div>' +
            '</div></div></article>';
          return item;
        }
        function userRow() {
          const item = document.createElement("div");
          item.className = "conversation-virtual-item";
          item.innerHTML = '<article class="chat-bubble-row chat-bubble-row--expanded" data-card-id="user" data-kind="message" data-role="user" data-align="right" data-status="completed" data-depth="0">' +
            '<div class="chat-bubble-shell" data-align="right"><div class="chat-bubble" data-align="right" data-stage="user" data-status="completed">' +
            '<div class="chat-bubble__head" data-align="right"><div class="chat-bubble__title-row"><button class="oc-button chat-bubble__head-main" data-variant="ghost" data-size="mini" data-tone="neutral" data-ui="chat-bubble-head-main" aria-expanded="true">' +
            '<span class="chat-bubble__identity" data-align="right"><span class="chat-bubble__identity-copy"><span class="chat-bubble__title-line" data-align="right"><span class="chat-bubble__title">User</span></span></span></span></button></div></div>' +
            '<div class="chat-bubble__body"><div class="chat-bubble__body-inner">Keep the original user message expanded.</div></div><div class="chat-bubble__foot"><span class="chat-bubble__stamp">12:00</span></div>' +
            '</div></div></article>';
          return item;
        }
        scroll.appendChild(userRow());
        for (let i = 1; i <= 38; i += 1) scroll.appendChild(agentRow(i));
        function syncButton() {
          const away = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop > 8;
          button.hidden = !away;
        }
        scroll.addEventListener("scroll", syncButton, { passive: true });
        button.addEventListener("click", () => {
          scroll.scrollTop = scroll.scrollHeight;
          syncButton();
        });
        scroll.scrollTop = scroll.scrollHeight;
        syncButton();
      </script>
    `)

    await page.waitForFunction(() => Boolean(document.querySelector('[data-ui="conversation-scroll-bottom"]')))
    const metricsBefore = await page.evaluate(() => {
      const scroll = document.getElementById("scroll") as HTMLElement
      const button = document.querySelector<HTMLElement>('[data-ui="conversation-scroll-bottom"]')!
      const composer = document.querySelector<HTMLElement>(".composer-fixture")!
      scroll.scrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight - 260)
      scroll.dispatchEvent(new Event("scroll"))
      const buttonRect = button.getBoundingClientRect()
      const composerRect = composer.getBoundingClientRect()
      return {
        hidden: button.hidden,
        distanceFromBottom: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop,
        buttonCenterX: buttonRect.left + buttonRect.width / 2,
        shellCenterX: document.querySelector<HTMLElement>(".conversation-scroll-shell")!.getBoundingClientRect().left +
          document.querySelector<HTMLElement>(".conversation-scroll-shell")!.getBoundingClientRect().width / 2,
        buttonBottom: buttonRect.bottom,
        composerTop: composerRect.top,
        collapsedCount: document.querySelectorAll('.chat-bubble-row[data-kind="agent"] [aria-expanded="false"]').length,
        expandedUserCount: document.querySelectorAll('.chat-bubble-row[data-role="user"] [aria-expanded="true"]').length,
      }
    })
    assert.equal(metricsBefore.hidden, false)
    assert.ok(metricsBefore.distanceFromBottom > 200)
    assert.ok(Math.abs(metricsBefore.buttonCenterX - metricsBefore.shellCenterX) <= 1)
    assert.ok(metricsBefore.buttonBottom < metricsBefore.composerTop)
    assert.equal(metricsBefore.collapsedCount, 38)
    assert.equal(metricsBefore.expandedUserCount, 1)
    const visiblePath = saveScreenshot("scroll-button-visible.png", await page.screenshot({ fullPage: false }))
    assert.ok(visiblePath.endsWith("scroll-button-visible.png"))

    await page.click('[data-ui="conversation-scroll-bottom"]')
    await page.waitForFunction(() => {
      const scroll = document.getElementById("scroll") as HTMLElement
      const button = document.querySelector<HTMLButtonElement>('[data-ui="conversation-scroll-bottom"]')!
      return button.hidden && scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 2
    })
    const afterPath = saveScreenshot("after-scroll-bottom.png", await page.screenshot({ fullPage: false }))
    assert.ok(afterPath.endsWith("after-scroll-bottom.png"))
    await page.close()
  } finally {
    await browser.close().catch(() => undefined)
  }
})
