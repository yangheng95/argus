import assert from "node:assert/strict"
import { mkdirSync, readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCRATCH_ROOT = resolve(OVERLAY_ROOT, "../../.scratch")
const SAMPLE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAIklEQVR42mN8+fLlfwY0wMDAwMiABYyJgUqGqQYVDAAABYwD4oO6SpwAAAAASUVORK5CYII="

function readCss(rel: string): string {
  return readFileSync(join(OVERLAY_ROOT, "src/styles", rel), "utf8")
}

async function saveScreenshot(element: { screenshot(options?: Record<string, unknown>): Promise<Buffer> }, name: string) {
  const target = join(SCRATCH_ROOT, name)
  mkdirSync(dirname(target), { recursive: true })
  await writeFile(target, await element.screenshot({}))
  return target
}

function triggerLabel(messages: Record<string, string>, alt: string): string {
  return messages["image_preview.open_trigger_with_alt"]!.replace("{{alt}}", alt)
}

test("image preview triggers expose distinct accessible names and visible focus", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const css = [
    readCss("tokens/design-language.css"),
    readCss("cascade/base.css"),
    readCss("cascade/light.css"),
    readCss("primitives/button.css"),
    readCss("surfaces/messages.css"),
    readCss("surfaces/markdown.css"),
  ].join("\n")
  const zhCN = JSON.parse(readFileSync(join(OVERLAY_ROOT, "src/i18n/zh-CN.json"), "utf8")) as Record<string, string>
  const firstLabel = triggerLabel(zhCN, "Revenue chart")
  const secondLabel = triggerLabel(zhCN, "Cash flow screenshot")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 640, height: 360 })
    await page.setContent(`
      <!doctype html>
      <html data-theme="light">
        <head>
          <style>
            ${css}
            :root { --ui-scale: 1; }
            body {
              margin: 0;
              padding: 24px;
              background: var(--bg);
              color: var(--text);
              font-family: var(--font);
            }
            .fixture-row {
              display: flex;
              align-items: flex-start;
              gap: 24px;
              padding: 8px;
            }
            .fixture-row .md-img {
              width: 96px;
              height: 72px;
              object-fit: cover;
              background: var(--surface-inset);
            }
          </style>
        </head>
        <body data-theme="light">
          <main class="fixture-row" aria-label="Image preview trigger fixture">
            <button type="button" class="oc-button msg-image-trigger" data-variant="ghost" data-size="md" data-tone="neutral" data-ui="image-preview-trigger" data-image-preview-trigger="true" data-image-preview-src="${SAMPLE_PNG}" data-image-preview-alt="Revenue chart" title="${firstLabel}" aria-label="${firstLabel}">
              <img class="md-img" src="${SAMPLE_PNG}" alt="Revenue chart" loading="lazy">
            </button>
            <button type="button" class="oc-button msg-image-trigger" data-variant="ghost" data-size="md" data-tone="neutral" data-ui="image-preview-trigger" data-image-preview-trigger="true" data-image-preview-src="${SAMPLE_PNG}" data-image-preview-alt="Cash flow screenshot" title="${secondLabel}" aria-label="${secondLabel}">
              <img class="md-img" src="${SAMPLE_PNG}" alt="Cash flow screenshot" loading="lazy">
            </button>
          </main>
        </body>
      </html>
    `)

    const names = await page.$$eval('[data-image-preview-trigger]', (buttons) =>
      buttons.map((button) => ({
        ariaLabel: button.getAttribute("aria-label") || "",
        title: button.getAttribute("title") || "",
        imageAlt: button.querySelector("img")?.getAttribute("alt") || "",
        usesButtonPrimitive: button.classList.contains("oc-button"),
        dataUi: button.getAttribute("data-ui") || "",
      })),
    )
    assert.deepEqual(names, [
      {
        ariaLabel: firstLabel,
        title: firstLabel,
        imageAlt: "Revenue chart",
        usesButtonPrimitive: true,
        dataUi: "image-preview-trigger",
      },
      {
        ariaLabel: secondLabel,
        title: secondLabel,
        imageAlt: "Cash flow screenshot",
        usesButtonPrimitive: true,
        dataUi: "image-preview-trigger",
      },
    ])
    assert.notEqual(names[0]!.ariaLabel, names[1]!.ariaLabel)
    assert.ok(names.every((item) => item.ariaLabel.startsWith("打开图片预览")))
    assert.ok(names.every((item) => !item.ariaLabel.includes("Open image preview")))

    await page.keyboard.press("Tab")
    const focusState = await page.$eval('[data-image-preview-trigger]', (button) => {
      const style = getComputedStyle(button)
      return {
        active: document.activeElement === button,
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
        outlineColor: style.outlineColor,
      }
    })
    assert.equal(focusState.active, true)
    assert.notEqual(focusState.outlineStyle, "none")
    assert.ok(focusState.outlineWidth >= 1, `expected visible focus outline: ${JSON.stringify(focusState)}`)
    assert.notEqual(focusState.outlineColor, "rgba(0, 0, 0, 0)")

    const fixture = await page.$(".fixture-row")
    assert.ok(fixture)
    await saveScreenshot(fixture, "image-preview-trigger-focus.png")
  } finally {
    await browser.close()
  }
})
