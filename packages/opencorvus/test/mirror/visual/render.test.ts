import { describe, test, expect } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import os from "node:os"
import { PNG } from "pngjs"
import {
  SCREENSHOT_STABILIZATION_CSS,
  renderFiles,
  RenderOutputSchema,
} from "../../../src/mirror/visual/render"

// Golden parity — mirror originals
import {
  SCREENSHOT_STABILIZATION_CSS as mirrorCss,
} from "D:/myhexin-local/opencode-private/packages/mirror/src/service/render.ts"

// ─── GOLDEN PARITY — pure helpers ─────────────────────────────────────────

describe("render — GOLDEN PARITY on pure helpers", () => {
  test("SCREENSHOT_STABILIZATION_CSS is byte-identical to mirror", () => {
    expect(SCREENSHOT_STABILIZATION_CSS).toBe(mirrorCss)
  })
})

// ─── renderFiles — integration ────────────────────────────────────────────

describe("renderFiles (integration)", () => {
  test("captures an explicit file URL and output passes schema", async () => {
    const dir = resolve(os.tmpdir(), "mirror-render-ok-" + process.pid)
    mkdirSync(dir, { recursive: true })
    const htmlPath = resolve(dir, "index.html")
    writeFileSync(
      htmlPath,
      `<!doctype html><html><body style="background:#ff0000;margin:0"><div style="width:100px;height:100px;background:#00ff00"></div></body></html>`,
    )

    try {
      const result = await renderFiles({
        url: pathToFileURL(htmlPath).href,
        viewport: { width: 320, height: 240 },
        timeout: 20_000,
      })
      expect(() => RenderOutputSchema.parse(result)).not.toThrow()
      expect(result.screenshotDataUrl.startsWith("data:image/png;base64,")).toBe(true)
      expect(result.screenshotBuffer.length).toBeGreaterThan(0)
      expect(result.renderTimeMs).toBeGreaterThan(0)

      const png = PNG.sync.read(result.screenshotBuffer)
      expect(png.width).toBeGreaterThan(0)
      expect(png.height).toBeGreaterThan(0)
      expect(png.width).toBeLessThanOrEqual(result.viewport.width * 2) // account for DPR
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
