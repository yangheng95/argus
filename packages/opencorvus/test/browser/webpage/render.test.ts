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
  resolveNodeRenderSidecarRuntime,
} from "../../../src/browser/webpage/render"

describe("render helpers", () => {
  test("SCREENSHOT_STABILIZATION_CSS disables unstable visual effects", () => {
    expect(SCREENSHOT_STABILIZATION_CSS).toContain("animation")
    expect(SCREENSHOT_STABILIZATION_CSS).toContain("transition")
    expect(SCREENSHOT_STABILIZATION_CSS).toContain("caret-color")
  })

  test("prefers packaged browser MCP node runtime and npm Playwright modules", async () => {
    const dir = resolve(os.tmpdir(), "webpage-render-packaged-runtime-" + process.pid)
    const runtimeDir = resolve(dir, "browser-mcp-node")
    const moduleDir = resolve(runtimeDir, "node_modules", "playwright")
    mkdirSync(moduleDir, { recursive: true })
    const nodeName = process.platform === "win32" ? "node.exe" : "node"
    const nodePath = resolve(runtimeDir, nodeName)
    const playwrightPath = resolve(moduleDir, "index.js")
    writeFileSync(resolve(dir, process.platform === "win32" ? "opencorvus.exe" : "opencorvus"), "")
    writeFileSync(nodePath, "")
    writeFileSync(playwrightPath, "")

    try {
      const result = await resolveNodeRenderSidecarRuntime({
        execPath: resolve(dir, process.platform === "win32" ? "opencorvus.exe" : "opencorvus"),
        platform: process.platform,
      })
      expect(result.nodeExecutable).toBe(nodePath)
      expect(result.playwrightRequirePath).toBe(playwrightPath)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("renderFiles integration", () => {
  test("captures an explicit file URL and output passes schema", async () => {
    const dir = resolve(os.tmpdir(), "webpage-render-ok-" + process.pid)
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
      expect(png.width).toBeLessThanOrEqual(result.viewport.width * 2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  test("captures visible text without hidden/offscreen text", async () => {
    const dir = resolve(os.tmpdir(), "webpage-render-visible-text-" + process.pid)
    mkdirSync(dir, { recursive: true })
    const htmlPath = resolve(dir, "index.html")
    writeFileSync(
      htmlPath,
      `<!doctype html><html><body>
        <main>Visible benchmark copy</main>
        <div style="display:contents"><strong>Contents wrapper text</strong></div>
        <p style="display:none">Hidden display text</p>
        <p style="opacity:0">Transparent text</p>
        <p style="position:absolute;left:-10000px">Offscreen text</p>
      </body></html>`,
    )

    try {
      const result = await renderFiles({
        url: pathToFileURL(htmlPath).href,
        viewport: { width: 320, height: 240 },
        timeout: 20_000,
      })
      expect(result.bodyText).toContain("Transparent text")
      expect(result.visibleText).toContain("Visible benchmark copy")
      expect(result.visibleText).toContain("Contents wrapper text")
      expect(result.visibleText).not.toContain("Hidden display text")
      expect(result.visibleText).not.toContain("Transparent text")
      expect(result.visibleText).not.toContain("Offscreen text")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
