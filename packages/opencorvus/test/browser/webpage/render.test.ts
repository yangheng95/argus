import { describe, test, expect } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { AddressInfo } from "node:net"
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
import { RenderError } from "../../../src/browser/webpage/errors"

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

  test("does not require networkidle for initial navigation", () => {
    const source = readFileSync(resolve(import.meta.dir, "../../../src/browser/webpage/render.ts"), "utf8")

    expect(source).toContain('waitUntil: "domcontentloaded"')
    expect(source).not.toContain('page.goto(input.url, { waitUntil: "networkidle"')
  })

  test("owns navigation by browser inactivity instead of Playwright elapsed timeout", () => {
    const source = readFileSync(resolve(import.meta.dir, "../../../src/browser/webpage/render.ts"), "utf8")

    expect(source).toContain("opencorvusWithBrowserInactivity")
    expect(source).toContain('() => page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 0 })')
    expect(source).toContain('() => page.waitForLoadState("networkidle", { timeout: 0 })')
    expect(source).toContain("opencorvusIsCriticalPageRequestFailure")
    expect(source).toContain("opencorvusIsSameOriginPageError")
    expect(source).toContain('assertNoBrowserFailures("stabilization")')
    expect(source).toContain('assertNoBrowserFailures("screenshot")')
    expect(source).toContain('assertNoBrowserFailures("artifact")')
    expect(source).not.toContain("opencorvusIsSameOriginConsoleError")
    expect(source).not.toContain("console error")
    expect(source).not.toContain('page.goto(input.url, { waitUntil: "domcontentloaded", timeout: input.timeout })')
    expect(source).not.toContain('page.waitForLoadState("networkidle", { timeout: Math.min(5000, input.timeout) })')
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

  test("rejects successful pages with failed subresources before returning screenshots", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/missing.png") {
        res.writeHead(404, { "content-type": "image/png" })
        res.end("missing")
        return
      }
      res.writeHead(200, { "content-type": "text/html" })
      res.end(
        '<!doctype html><html><body><main>Renderable page with broken asset<img src="/missing.png"></main></body></html>',
      )
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as AddressInfo).port
    try {
      await renderFiles({
        url: `http://127.0.0.1:${port}/`,
        viewport: { width: 320, height: 240 },
        timeout: 20_000,
      })
      throw new Error("should have thrown")
    } catch (error) {
      expect(RenderError.isInstance(error)).toBe(true)
      if (RenderError.isInstance(error)) {
        expect(error.data.reason).toContain("Browser failures")
        expect(error.data.reason).toContain("missing.png")
      }
    } finally {
      server.close()
    }
  }, 60_000)

  test("renders successful pages with failed third-party script diagnostics", async () => {
    const thirdPartyServer = createServer((_req, res) => {
      res.writeHead(404, { "content-type": "application/javascript" })
      res.end("missing")
    })
    await new Promise<void>((resolve) => thirdPartyServer.listen(0, "127.0.0.1", resolve))
    const thirdPartyPort = (thirdPartyServer.address() as AddressInfo).port
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" })
      res.end(
        `<!doctype html><html><body><main>Renderable page with third-party diagnostics<script src="http://127.0.0.1:${thirdPartyPort}/missing.js"></script></main></body></html>`,
      )
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as AddressInfo).port
    try {
      const result = await renderFiles({
        url: `http://127.0.0.1:${port}/`,
        viewport: { width: 320, height: 240 },
        timeout: 20_000,
      })

      expect(result.visibleText).toContain("Renderable page with third-party diagnostics")
      expect(result.screenshotBuffer.length).toBeGreaterThan(0)
    } finally {
      server.close()
      thirdPartyServer.close()
    }
  }, 60_000)

  test("rejects late page errors during stabilization before returning screenshots", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" })
      res.end(
        `<!doctype html><html><body><main>Renderable page with late error</main>
        <script>setTimeout(() => { throw new Error("late render pageerror") }, 1000)</script></body></html>`,
      )
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as AddressInfo).port
    try {
      await renderFiles({
        url: `http://127.0.0.1:${port}/`,
        viewport: { width: 320, height: 240 },
        timeout: 20_000,
      })
      throw new Error("should have thrown")
    } catch (error) {
      expect(RenderError.isInstance(error)).toBe(true)
      if (RenderError.isInstance(error)) {
        expect(error.data.reason).toContain("late render pageerror")
      }
    } finally {
      server.close()
    }
  }, 60_000)
})
