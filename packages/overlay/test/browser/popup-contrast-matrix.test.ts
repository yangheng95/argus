import assert from "node:assert/strict"
import { mkdirSync, readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")

function readCss(rel: string): string {
  return readFileSync(join(OVERLAY_ROOT, "src/styles", rel), "utf8")
}

function overlayStyleHrefs(): string[] {
  const html = readFileSync(join(OVERLAY_ROOT, "src/index.html"), "utf8")
  const hrefs = Array.from(html.matchAll(/<link\s+rel="stylesheet"\s+href="styles\/([^"]+)"/g), (match) => match[1])
  if (hrefs.length === 0) throw new Error("No overlay stylesheet links found in src/index.html")
  return hrefs
}

const OVERLAY_STYLE_HREFS = overlayStyleHrefs()

function overlayCss(): string {
  return OVERLAY_STYLE_HREFS.map(readCss).join("\n")
}

async function saveScreenshot(element: { screenshot(options?: Record<string, unknown>): Promise<Buffer> }, name: string) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  await writeFile(target, await element.screenshot({}))
  return target
}

test("popup and command surfaces keep secondary text readable on light opaque panels", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1220, height: 920 })
    await page.setContent(`
      <!doctype html>
      <html data-theme="light">
        <head>
          <style>
            ${overlayCss()}
            :root { --ui-scale: 1; }
            body {
              min-height: 100vh;
              margin: 0;
              padding: 24px;
              background: rgb(255, 255, 255);
              color: var(--text);
              font-family: var(--font);
            }
            .popup-matrix {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 16px;
              align-items: start;
            }
            .popup-sample {
              min-width: 0;
              padding: 12px;
              border: var(--oc-border-width) solid var(--border);
              border-radius: var(--oc-radius-large);
              background: var(--surface);
            }
            .popup-sample > strong {
              display: block;
              margin-bottom: 8px;
              color: var(--text-strong);
              font-size: var(--ui-font-control);
            }
            .popup-sample .executor-popover,
            .popup-sample .project-worktree-panel,
            .popup-sample .recent-dir-panel,
            .popup-sample .workspace-terminal-menu,
            .popup-sample .workspace-editor-menu,
            .popup-sample .workspace-coding-cli-menu,
            .popup-sample .titlebar-menubar-panel,
            .popup-sample .cmdk-panel {
              position: static;
              width: 100%;
              max-width: 100%;
              max-height: none;
              transform: none;
            }
            .popup-sample .project-worktree-item {
              grid-template-columns: minmax(72px, 1fr) minmax(74px, max-content) minmax(0, 136px) minmax(0, 128px);
            }
            .popup-sample .cmdk-panel {
              display: flex;
            }
          </style>
        </head>
        <body data-theme="light">
          <main class="popup-matrix" aria-label="Popup contrast matrix">
            <section class="popup-sample" data-popup-sample="executor-popover">
              <strong>Executor Popover</strong>
              <div class="executor-popover">
                <div class="executor-popover-header">
                  <span class="executor-popover-title" data-popup-text>External executor</span>
                  <span class="executor-popover-hint" data-popup-text>Choose the runtime profile for this task.</span>
                </div>
                <div class="executor-popover-empty" data-popup-text>No external executors are configured.</div>
                <button class="executor-popover-model" type="button" disabled data-popup-text>
                  Unavailable model
                </button>
                <div class="executor-popover-group">
                  <div class="executor-popover-group-header">
                    <span class="executor-popover-group-name" data-popup-text>OpenAI</span>
                    <span data-popup-text>2 models</span>
                  </div>
                </div>
              </div>
            </section>

            <section class="popup-sample" data-popup-sample="worktree-panel">
              <strong>Worktree Panel</strong>
              <div class="project-worktree-panel">
                <div class="project-worktree-panel-shell">
                  <div class="project-worktree-panel-head">
                    <div class="project-worktree-panel-title" data-popup-text>Worktrees</div>
                    <span class="project-worktree-head-count" data-kind="active" data-popup-text>Active 1</span>
                    <span class="project-worktree-cleanup-hint" data-popup-text>Expired cleanup available</span>
                  </div>
                  <div class="project-worktree-row" data-status="expired">
                    <button class="project-worktree-item" type="button">
                      <span class="project-worktree-name" data-popup-text>feature/ui</span>
                      <span class="project-worktree-path" data-popup-text>C:/repo/worktrees/ui</span>
                      <span class="project-worktree-branch" data-popup-text>coding-assistant</span>
                      <span class="project-worktree-state" data-popup-text>Expired</span>
                    </button>
                    <button class="project-worktree-remove" type="button" data-popup-text>×</button>
                    <button class="project-worktree-remove" type="button" disabled data-popup-text>×</button>
                  </div>
                  <div class="project-worktree-row" data-status="active">
                    <button class="project-worktree-item" type="button">
                      <span class="project-worktree-name" data-popup-text>main</span>
                      <span class="project-worktree-path" data-popup-text>C:/repo/main</span>
                      <span class="project-worktree-branch" data-popup-text>coding-assistant</span>
                      <span class="project-worktree-state" data-popup-text>Active</span>
                    </button>
                  </div>
                  <div class="project-worktree-empty" data-popup-text>No archived worktrees.</div>
                </div>
              </div>
            </section>

            <section class="popup-sample" data-popup-sample="recent-directory">
              <strong>Recent Directory</strong>
              <div class="recent-dir-panel">
                <div class="recent-dir-panel-shell">
                  <div class="recent-dir-panel-head">
                    <div class="recent-dir-panel-title" data-popup-text>Recent directories</div>
                    <div class="recent-dir-panel-meta" data-popup-text>C:/Users/chuan/myhexin-local/opecorvus</div>
                  </div>
                  <section class="recent-dir-section">
                    <div class="recent-dir-section-title" data-popup-text>Pinned</div>
                    <div class="recent-dir-row">
                      <button class="recent-dir-item" type="button">
                        <span class="recent-dir-copy">
                          <span class="recent-dir-label" data-popup-text>OpenCorvus</span>
                          <span class="recent-dir-path" data-popup-text>C:/Users/chuan/myhexin-local/opecorvus</span>
                        </span>
                      </button>
                    </div>
                    <label class="recent-dir-edit-label">
                      <input value="OpenCorvus" aria-label="Rename directory" />
                      <button class="recent-dir-edit-submit" type="button" disabled data-popup-text>Save</button>
                    </label>
                  </section>
                </div>
              </div>
            </section>

            <section class="popup-sample" data-popup-sample="workspace-launcher-menu">
              <strong>Workspace Launcher Menus</strong>
              <div class="workspace-terminal-menu">
                <button class="workspace-terminal-option" type="button">
                  <span aria-hidden="true">T</span>
                  <span class="workspace-terminal-option-label" data-popup-text>Open terminal</span>
                </button>
              </div>
              <div class="workspace-editor-menu">
                <button class="workspace-editor-option" type="button">
                  <span aria-hidden="true">E</span>
                  <span class="workspace-editor-option-label" data-popup-text>Open editor</span>
                </button>
              </div>
              <div class="workspace-coding-cli-menu">
                <button class="workspace-coding-cli-option" type="button">
                  <span aria-hidden="true">C</span>
                  <span class="workspace-coding-cli-option-label" data-popup-text>Open coding CLI</span>
                </button>
              </div>
            </section>

            <section class="popup-sample" data-popup-sample="titlebar-menu">
              <strong>Titlebar Menu</strong>
              <div class="titlebar-menubar-panel" data-menu="workspace">
                <div class="titlebar-menubar-group">
                  <div class="titlebar-menubar-group-title" data-popup-text>Workspace</div>
                  <button class="titlebar-menubar-item titlebar-menubar-recent-item" type="button">
                    <span class="titlebar-menubar-recent-name" data-popup-text>OpenCorvus</span>
                    <span class="titlebar-menubar-recent-path" data-popup-text>C:/Users/chuan/myhexin-local/opecorvus</span>
                  </button>
                  <button class="titlebar-menubar-item" type="button">
                    <span class="titlebar-menubar-item-title" data-popup-text>Open folder</span>
                    <span class="titlebar-menubar-item-meta" data-popup-text>Ctrl+O</span>
                  </button>
                  <button class="titlebar-menubar-item" type="button" disabled>
                    <span class="titlebar-menubar-item-title" data-popup-text>Unavailable action</span>
                    <span class="titlebar-menubar-item-meta" data-popup-text>Offline</span>
                  </button>
                </div>
              </div>
            </section>

            <section class="popup-sample" data-popup-sample="command-palette">
              <strong>Command Palette</strong>
              <form class="dialog-form cmdk-panel">
                <input class="cmdk-input" value="config" aria-label="Search commands" />
                <div class="cmdk-list" role="listbox">
                  <div class="cmdk-item" role="option">
                    <span class="cmdk-item-group" data-popup-text>Settings</span>
                    <span class="cmdk-item-label" data-popup-text>Open Skill Market</span>
                    <span class="cmdk-item-hint" data-popup-text>Ctrl+K</span>
                  </div>
                  <div class="cmdk-item cmdk-item--active" role="option" aria-selected="true">
                    <span class="cmdk-item-group" data-popup-text>Workspace</span>
                    <span class="cmdk-item-label" data-popup-text>Open recent workspace</span>
                    <span class="cmdk-item-hint" data-popup-text>Enter</span>
                  </div>
                  <div class="cmdk-empty" data-popup-text>No matching commands.</div>
                </div>
                <div class="cmdk-foot" data-popup-text>Use arrow keys to move through results.</div>
              </form>
            </section>
          </main>
        </body>
      </html>
    `)

    const matrix = await page.$(".popup-matrix")
    assert.ok(matrix)
    const screenshot = await saveScreenshot(matrix, "popup-contrast-matrix.png")
    assert.ok(screenshot.endsWith("popup-contrast-matrix.png"))

    const result = await page.evaluate(() => {
      interface Rgba {
        r: number
        g: number
        b: number
        a: number
      }

      function parseAlpha(value: string | undefined): number {
        if (!value) return 1
        if (value.endsWith("%")) return Number.parseFloat(value) / 100
        return Number.parseFloat(value)
      }

      function parseColor(value: string): Rgba {
        const normalized = value.trim().toLowerCase()
        if (normalized === "transparent") return { r: 0, g: 0, b: 0, a: 0 }
        const rgb = normalized.match(/^rgba?\((.*)\)$/)
        if (rgb) {
          const body = rgb[1]!.trim()
          const [channels, alpha] = body.split("/").map((part) => part.trim())
          const parts = channels!.split(/[\s,]+/).filter(Boolean)
          const [r, g, b] = parts.map((part) => Number.parseFloat(part))
          const a = alpha === undefined ? (parts[3] === undefined ? 1 : parseAlpha(parts[3])) : parseAlpha(alpha)
          if (![r, g, b, a].every(Number.isFinite)) throw new Error(`Invalid rgb color: ${value}`)
          return { r, g, b, a }
        }
        const srgb = normalized.match(/^color\(\s*srgb\s+(.+)\)$/)
        if (srgb) {
          const [channels, alpha] = srgb[1]!.split("/").map((part) => part.trim())
          const [r, g, b] = channels!.split(/\s+/).map((part) => Number.parseFloat(part) * 255)
          const a = alpha === undefined ? 1 : parseAlpha(alpha)
          if (![r, g, b, a].every(Number.isFinite)) throw new Error(`Invalid srgb color: ${value}`)
          return { r, g, b, a }
        }
        throw new Error(`Unsupported color: ${value}`)
      }

      function composite(foreground: Rgba, background: Rgba): Rgba {
        const alpha = foreground.a + background.a * (1 - foreground.a)
        if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
        return {
          r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
          g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
          b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
          a: alpha,
        }
      }

      function channel(value: number): number {
        const scaled = value / 255
        return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
      }

      function luminance(color: Rgba): number {
        return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
      }

      function contrastRatio(foreground: Rgba, background: Rgba): number {
        const lighter = Math.max(luminance(foreground), luminance(background))
        const darker = Math.min(luminance(foreground), luminance(background))
        return (lighter + 0.05) / (darker + 0.05)
      }

      function textSurface(element: HTMLElement, sample: HTMLElement): Rgba {
        const ancestors: HTMLElement[] = []
        for (let node: HTMLElement | null = element; node; node = node.parentElement) {
          ancestors.push(node)
          if (node === sample) break
        }
        let surface: Rgba = { r: 255, g: 255, b: 255, a: 1 }
        for (const ancestor of ancestors.reverse()) {
          const background = parseColor(getComputedStyle(ancestor).backgroundColor)
          if (background.a > 0) surface = composite(background, surface)
        }
        return surface
      }

      function effectiveOpacity(element: HTMLElement, sample: HTMLElement): number {
        let opacity = 1
        for (let node: HTMLElement | null = element; node; node = node.parentElement) {
          const value = Number.parseFloat(getComputedStyle(node).opacity)
          if (Number.isFinite(value)) opacity *= value
          if (node === sample) break
        }
        return opacity
      }

      return Array.from(document.querySelectorAll<HTMLElement>("[data-popup-sample]")).map((sample) => {
        const texts = Array.from(sample.querySelectorAll<HTMLElement>("[data-popup-text]")).map((element) => {
          const rawColor = parseColor(getComputedStyle(element).color)
          const opacity = effectiveOpacity(element, sample)
          const surface = textSurface(element, sample)
          const foreground = composite({ ...rawColor, a: rawColor.a * opacity }, surface)
          return {
            text: element.textContent?.trim().replace(/\s+/g, " ") ?? "",
            selector: element.className || element.tagName.toLowerCase(),
            color: getComputedStyle(element).color,
            effectiveOpacity: opacity,
            surface,
            surfaceAlpha: surface.a,
            contrast: contrastRatio(foreground, surface),
          }
        })
        return {
          id: sample.dataset.popupSample ?? "",
          texts,
        }
      })
    })

    assert.deepEqual(
      result.map((sample) => sample.id),
      [
        "executor-popover",
        "worktree-panel",
        "recent-directory",
        "workspace-launcher-menu",
        "titlebar-menu",
        "command-palette",
      ],
    )
    assert.equal(
      OVERLAY_STYLE_HREFS.indexOf("surfaces/composer.css") < OVERLAY_STYLE_HREFS.indexOf("surfaces/field.css"),
      true,
      "Popup matrix must load CSS in the same order as src/index.html",
    )
    assert.equal(
      OVERLAY_STYLE_HREFS.indexOf("surfaces/titlebar.css") < OVERLAY_STYLE_HREFS.indexOf("surfaces/cmdk.css"),
      true,
      "Popup matrix must preserve real titlebar/cmdk cascade order",
    )

    for (const sample of result) {
      assert.ok(sample.texts.length > 0, `${sample.id} should expose popup text samples`)
      for (const text of sample.texts) {
        assert.equal(text.surfaceAlpha, 1, `${sample.id} "${text.text}" surface must composite to opaque`)
        assert.notEqual(text.color, "rgba(0, 0, 0, 0)", `${sample.id} "${text.text}" must not be transparent`)
        assert.ok(
          text.effectiveOpacity >= 0.95,
          `${sample.id} ${text.selector} "${text.text}" effective opacity ${text.effectiveOpacity.toFixed(2)}`,
        )
        assert.ok(
          text.contrast >= 4.5,
          `${sample.id} ${text.selector} "${text.text}" contrast ${text.contrast.toFixed(2)}`,
        )
      }
    }
  } finally {
    await browser.close()
  }
})
