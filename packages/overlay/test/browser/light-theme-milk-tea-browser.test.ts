import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

function readCss(relativePath: string): string {
  return readFileSync(join(OVERLAY_ROOT, "src/styles", relativePath), "utf8")
}

function styleSheet(): string {
  return [
    "tokens/design-language.css",
    "cascade/base.css",
    "cascade/light.css",
    "primitives/button.css",
    "surfaces/header.css",
    "surfaces/workspace.css",
    "surfaces/sidebar.css",
    "surfaces/conversation.css",
    "surfaces/card.css",
    "surfaces/chat-bubble.css",
    "surfaces/composer.css",
  ]
    .map(readCss)
    .join("\n")
}

type SampledColor = {
  b: number
  g: number
  raw: string
  r: number
}

function parseRgb(value: string): SampledColor {
  const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) throw new Error(`Expected rgb color, got ${value}`)
  return {
    raw: value,
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
  }
}

function assertCodexRail(color: SampledColor, label: string): void {
  assert.ok(color.g >= color.r + 6, `${label} should carry the Codex pale-blue rail tint: ${color.raw}`)
  assert.ok(color.b >= color.r + 9, `${label} should carry the Codex pale-blue rail tint: ${color.raw}`)
  assert.ok(color.r >= 232 && color.g >= 242 && color.b >= 245, `${label} should remain a light rail: ${color.raw}`)
}

function assertCodexCanvas(color: SampledColor, label: string): void {
  const spread = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b)
  assert.ok(spread <= 2, `${label} should be a neutral near-white canvas: ${color.raw}`)
  assert.ok(color.r >= 252 && color.g >= 252 && color.b >= 252, `${label} should match the near-white reference: ${color.raw}`)
}

test("light theme renders Codex-reference pale rail and near-white canvas", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1180, height: 760 })
    await page.setContent(`
      <!doctype html>
      <html data-theme="light">
        <head>
          <style>
            ${styleSheet()}
            :root {
              --ui-overlay-min-width: 0px;
              --ui-overlay-min-height: 0px;
              --ui-overlay-min-aspect-ratio: 1;
            }
            body {
              width: auto;
              min-width: 0;
              min-height: 0;
              height: auto;
              margin: 0;
              padding: calc(18px * var(--ui-scale));
            }
            .codex-theme-stage {
              width: calc(1120px * var(--ui-scale));
              height: calc(680px * var(--ui-scale));
              display: flex;
              overflow: hidden;
              border: var(--oc-border-width) solid var(--border);
              border-radius: var(--oc-radius-large);
              background: var(--panel-body-bg);
            }
            .codex-theme-sidebar {
              flex: 0 0 calc(280px * var(--ui-scale));
            }
            .codex-theme-chat {
              min-width: 0;
              flex: 1 1 auto;
            }
          </style>
        </head>
        <body data-theme="light">
          <main class="codex-theme-stage panel-body">
            <aside class="sidebar codex-theme-sidebar">
              <div class="side-panel-content sidebar-content">
                <div class="sidebar-header oc-surface-header">
                  <div class="sidebar-title oc-surface-header__title">Projects</div>
                </div>
                <div class="sidebar-body">
                  <div class="sidebar-list session-list-panel">
                    <div class="project-group">
                      <div class="project-group-head">
                        <button class="oc-button" data-ui="project-group-toggle" data-variant="ghost" data-size="sm" type="button">
                          <span class="project-group-icon">▣</span>
                          <span class="project-group-copy">
                            <span class="project-group-name">opecorvus</span>
                            <span class="project-group-parent">C:/Projects</span>
                          </span>
                          <span class="project-group-count">3</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </aside>
            <section class="chat codex-theme-chat">
              <header class="chat-header oc-surface-header">
                <div class="chat-header-main oc-surface-header__main">
                  <span class="chat-title oc-surface-header__title">Workflow</span>
                </div>
                <div class="chat-header-status">
                  <span class="chat-task-status task-status">
                    <span class="status-label">Running</span>
                    <span class="elapsed">00:38</span>
                  </span>
                </div>
                <div class="chat-header-meta oc-surface-header__actions"></div>
              </header>
              <div class="conversation-body">
                <div class="conversation-scroll-shell">
                  <div class="chat-scroll">
                    <div class="chat-bubble-row" data-role="user" data-align="right">
                      <div class="chat-bubble-shell" data-align="right">
                        <article class="chat-bubble" data-align="right">
                          <div class="chat-bubble__body">
                            Codex reference light theme visual sample.
                          </div>
                        </article>
                      </div>
                    </div>
                    <article class="card" data-kind="message">
                      <div class="card__body">The rail should read pale blue while the main surface stays near-white.</div>
                    </article>
                  </div>
                </div>
              </div>
              <div class="chat-composer-stack">
                <form class="chat-input">
                  <div class="chat-compose-row">
                    <div class="chat-textarea-wrap">
                      <textarea class="chat-textarea">Tune the overlay light palette.</textarea>
                    </div>
                  </div>
                  <div class="chat-compose-meta">
                    <div class="chat-compose-meta-left">
                      <div class="composer-mode-select-wrap">
                        <button class="composer-mode-select-trigger oc-select-trigger" type="button">
                          <span class="composer-mode-select-value">Chat</span>
                        </button>
                      </div>
                    </div>
                    <div class="chat-compose-meta-right">
                      <button class="oc-button" data-variant="solid" data-size="md" data-tone="accent" data-mode="send" type="button">
                        <span class="chat-send-icon">↑</span>
                        <span class="chat-send-label">Send</span>
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </section>
          </main>
        </body>
      </html>
    `)

    await page.waitForSelector(".chat-input", { visible: true, timeout: 15_000 })
    const samples = await page.evaluate(() => {
      const bg = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector)
        if (!node) throw new Error(`Missing ${selector}`)
        return getComputedStyle(node).backgroundColor
      }
      return {
        bodyBgImage: getComputedStyle(document.body).backgroundImage,
        panel: bg(".panel-body"),
        sidebar: bg(".sidebar"),
        sidebarHeader: bg(".sidebar-header"),
        chat: bg(".chat"),
        chatScroll: bg(".chat-scroll"),
        composerBorder: getComputedStyle(document.querySelector<HTMLElement>(".chat-input")!).borderColor,
        composerImage: getComputedStyle(document.querySelector<HTMLElement>(".chat-input")!).backgroundImage,
      }
    })

    assert.match(samples.bodyBgImage, /rgb\(236,\s*246,\s*249\)/)
    assert.match(samples.bodyBgImage, /rgb\(255,\s*255,\s*255\)/)
    assertCodexRail(parseRgb(samples.sidebar), "sidebar")
    assertCodexRail(parseRgb(samples.sidebarHeader), "sidebar header")
    for (const [label, raw] of Object.entries({
      panel: samples.panel,
      chat: samples.chat,
      chatScroll: samples.chatScroll,
    })) {
      assertCodexCanvas(parseRgb(raw), label)
    }
    assert.notEqual(samples.composerBorder, "rgb(255, 255, 255)")
    assert.match(samples.composerImage, /(?:rgb\(255,\s*255,\s*255\)|color\(srgb 1 1 1(?: \/ 0\.\d+)?\))/)

    const stage = await page.$(".codex-theme-stage")
    assert.ok(stage)
    const screenshotPath = resolve(".scratch/light-theme-codex-reference.png")
    mkdirSync(dirname(screenshotPath), { recursive: true })
    const buffer = await stage.screenshot({})
    writeFileSync(screenshotPath, buffer)
    assert.ok(buffer.length > 20_000, `Codex reference theme screenshot is too small: ${buffer.length}`)
  } finally {
    await browser.close()
  }
})
