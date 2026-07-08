import assert from "node:assert/strict"
import { mkdirSync, readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { launchBrowser } from "../launch.ts"

const OVERLAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCREENSHOT_PATH = resolve(OVERLAY_ROOT, "../..", ".scratch/card-icon-visual.png")

function readOverlayCss(rel: string): string {
  return readFileSync(join(OVERLAY_ROOT, "src", "styles", rel), "utf8")
}

test("card and tool visual fixtures render SVG icon slots without overflow", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 900, height: 1200 })
    const css = [
      readOverlayCss("tokens/design-language.css"),
      readOverlayCss("cascade/base.css"),
      readOverlayCss("cascade/dark.css"),
      readOverlayCss("cascade/typography.css"),
      readOverlayCss("surfaces/messages.css"),
      readOverlayCss("surfaces/card.css"),
    ].join("\n")
    const html = readFileSync(join(OVERLAY_ROOT, "test", "card-visual.html"), "utf8")
      .replace('<link rel="stylesheet" href="../src/styles.css" />', "")
      .replace('<link rel="stylesheet" href="../src/styles/surfaces/card.css" />', `<style>${css}</style>`)

    await page.setContent(html, { waitUntil: "load", timeout: 15_000 })
    await page.waitForSelector(".tool-icon svg", { timeout: 5_000 })
    await page.waitForSelector(".card__icon svg", { timeout: 5_000 })

    const metrics = await page.$$eval(".tool-icon, .card__icon, .msg-patch__icon", (elements) =>
      elements.map((element) => {
        const host = element.getBoundingClientRect()
        const svg = element instanceof SVGElement ? element : element.querySelector("svg")
        const icon = svg ? svg.getBoundingClientRect() : null
        return {
          className: element.getAttribute("class") || "",
          text: (element.textContent || "").trim(),
          host: { width: host.width, height: host.height },
          icon: icon ? { width: icon.width, height: icon.height } : null,
        }
      }),
    )

    assert.ok(metrics.length >= 4)
    for (const item of metrics) {
      assert.equal(item.text, "", `${item.className} should not render character glyph text`)
      assert.ok(item.icon, `${item.className} should contain an SVG icon`)
      assert.ok(item.icon!.width <= item.host.width + 1, `${item.className} icon overflows horizontally`)
      assert.ok(item.icon!.height <= item.host.height + 1, `${item.className} icon overflows vertically`)
    }

    mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true })
    await writeFile(SCREENSHOT_PATH, await page.screenshot({ fullPage: true }))
  } finally {
    await browser.close()
  }
})
