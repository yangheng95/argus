import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCREENSHOT_PATH = fileURLToPath(new URL("../../.scratch/browser-preview-header-height.png", import.meta.url))

function readCss(relativePath: string): string {
  return readFileSync(join(OVERLAY_ROOT, "src/styles", relativePath), "utf8")
}

function styleSheet(): string {
  return [
    "tokens/design-language.css",
    "cascade/base.css",
    "cascade/dark.css",
    "primitives/button.css",
    "surfaces/header.css",
    "surfaces/inspector.css",
  ]
    .map(readCss)
    .join("\n")
}

test("browser preview command header uses the shared surface header height", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 900, height: 260 })
    await page.setContent(`
      <!doctype html>
      <html data-theme="dark">
        <head>
          <style>
            ${styleSheet()}
            body {
              margin: 0;
              padding: var(--ui-gap-lg);
              background: var(--bg);
              color: var(--text);
            }
            .header-fixture {
              display: grid;
              grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr);
              gap: var(--ui-gap-lg);
            }
            .browser-preview-panel {
              height: calc(180px * var(--ui-scale));
              border: var(--oc-border-width) solid var(--border);
            }
            .browser-preview-stage {
              min-height: 0;
            }
          </style>
        </head>
        <body data-theme="dark">
          <main class="header-fixture">
            <header class="chat-header oc-surface-header">
              <div class="chat-header-main oc-surface-header__main">
                <span class="chat-title oc-surface-header__title">Workflow</span>
              </div>
              <div class="chat-header-meta oc-surface-header__actions">
                <button class="oc-button" data-variant="ghost" data-size="icon" data-tone="neutral" type="button" aria-label="Toggle panel"></button>
              </div>
            </header>
            <section class="browser-preview-panel" aria-label="Browser Preview">
              <div class="browser-preview-command-surface" data-ui="browser-preview-chrome">
                <div class="browser-preview-chrome-grid" data-ui="browser-preview-toolbar">
                  <form class="browser-preview-address-form" data-ui="browser-preview-address-form">
                    <input class="browser-preview-address-input" data-ui="browser-preview-address-input" value="about:blank" aria-label="Address" />
                    <button class="oc-button" data-variant="ghost" data-size="icon" data-tone="neutral" type="button" aria-label="Reload"></button>
                  </form>
                  <div class="browser-preview-chrome-actions">
                    <button class="oc-button browser-preview-comment-mode-button" data-variant="ghost" data-size="icon" data-tone="neutral" type="button" aria-label="Select node"></button>
                  </div>
                </div>
              </div>
              <div class="browser-preview-stage"></div>
            </section>
          </main>
        </body>
      </html>
    `)

    const metrics = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector)
        const box = element?.getBoundingClientRect()
        return box ? { height: box.height, top: box.top, bottom: box.bottom, width: box.width } : null
      }
      const commandStyle = getComputedStyle(document.querySelector<HTMLElement>(".browser-preview-command-surface")!)
      const gridStyle = getComputedStyle(document.querySelector<HTMLElement>(".browser-preview-chrome-grid")!)
      return {
        tokenHeight: Number.parseFloat(commandStyle.minHeight),
        chatHeader: rect(".chat-header"),
        command: rect(".browser-preview-command-surface"),
        grid: rect(".browser-preview-chrome-grid"),
        address: rect(".browser-preview-address-form"),
        reload: rect('.browser-preview-address-form .oc-button[data-size="icon"]'),
        comment: rect(".browser-preview-comment-mode-button"),
        commandMinHeight: commandStyle.minHeight,
        commandMaxHeight: commandStyle.maxHeight,
        gridMinHeight: gridStyle.minHeight,
      }
    })

    assert.ok(metrics.chatHeader)
    assert.ok(metrics.command)
    assert.ok(metrics.grid)
    assert.ok(metrics.address)
    assert.ok(metrics.reload)
    assert.ok(metrics.comment)
    assert.ok(Math.abs(metrics.command.height - metrics.tokenHeight) <= 1, JSON.stringify(metrics))
    assert.ok(Math.abs(metrics.command.height - metrics.chatHeader.height) <= 1, JSON.stringify(metrics))
    assert.ok(Math.abs(metrics.grid.height - metrics.command.height) <= 1, JSON.stringify(metrics))
    assert.ok(metrics.address.height <= metrics.command.height, JSON.stringify(metrics))
    assert.ok(metrics.reload.height <= metrics.command.height, JSON.stringify(metrics))
    assert.ok(metrics.comment.height <= metrics.command.height, JSON.stringify(metrics))
    assert.equal(metrics.commandMinHeight, `${metrics.tokenHeight}px`)
    assert.equal(metrics.commandMaxHeight, `${metrics.tokenHeight}px`)
    assert.equal(metrics.gridMinHeight, "0px")

    const panel = await page.$(".browser-preview-panel")
    assert.ok(panel)
    mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true })
    writeFileSync(SCREENSHOT_PATH, await panel.screenshot())
  } finally {
    await browser.close()
  }
})
