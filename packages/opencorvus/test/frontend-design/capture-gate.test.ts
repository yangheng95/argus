import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  assessCaptureManifest,
  assessCaptureDiagnostics,
  CaptureReferenceError,
  captureReferenceManifest,
  type CaptureManifestType,
} from "../../src/frontend-design/capture-gate"

function manifest(overrides: Partial<CaptureManifestType>): CaptureManifestType {
  return {
    url: "https://www.baidu.com/",
    viewport: { width: 1440, height: 900, device_scale_factor: 1 },
    captured_at: Date.now(),
    duration_ms: 100,
    screenshot_sha256: "a".repeat(64),
    dom_sha256: "b".repeat(64),
    screenshot_byte_size: 50_000,
    har_byte_size: 50_000,
    non_white_pixel_ratio: 0.1,
    unique_color_count: 32,
    text_length: 100,
    reference_strings: ["百度一下", "新闻", "hao123"],
    palette: ["#ffffff", "#4e6ef2"],
    layout: {},
    tool_version: {},
    ...overrides,
  }
}

describe("capture reference diagnostics", () => {
  test("does not warn for sparse captures with visible text evidence", () => {
    const warnings = assessCaptureDiagnostics(
      manifest({
        non_white_pixel_ratio: 0.031948,
        text_length: 80,
        reference_strings: ["百度一下", "新闻", "地图"],
      }),
    )

    expect(warnings.some((v) => v.field === "non_white_pixel_ratio")).toBe(false)
  })

  test("rejects blank sparse captures as unusable references", () => {
    const assessment = assessCaptureManifest(
      manifest({
        non_white_pixel_ratio: 0.031948,
        text_length: 0,
        reference_strings: [],
        layout: {},
      }),
    )

    expect(assessment.ok).toBe(false)
    expect(assessment.diagnostics.some((v) => v.field === "non_white_pixel_ratio")).toBe(true)
    expect(assessment.ok ? "" : assessment.reason).toContain("no usable visual reference evidence")
  })

  test("does not keep an in-process browser capture override", () => {
    const source = readFileSync(path.join(import.meta.dir, "../../src/frontend-design/capture-gate.ts"), "utf8")

    expect(source).not.toContain("OPENCORVUS_CAPTURE_BROWSER_IN_PROCESS")
    expect(source).not.toContain("captureBrowserEvidenceInProcess")
    expect(source).not.toContain("launchPlaywrightBrowser")
  })

  test("node capture script uses the shared launch timeout instead of a hard-coded Chrome startup cap", () => {
    const source = readFileSync(path.join(import.meta.dir, "../../src/frontend-design/capture-gate.ts"), "utf8")

    expect(source).toContain("timeout: input.launchTimeoutMs")
    expect(source).not.toContain("timeout: 15000")
    expect(source).not.toContain("timeout: 15_000")
    expect(source).not.toContain("timeoutMs ?? 90_000")
  })

  test("node capture script does not require networkidle for initial navigation", () => {
    const source = readFileSync(path.join(import.meta.dir, "../../src/frontend-design/capture-gate.ts"), "utf8")

    expect(source).toContain('waitUntil: "domcontentloaded"')
    expect(source).not.toContain('page.goto(input.url, { waitUntil: "networkidle"')
  })

  test("node capture script passes browser proxy credentials to the Playwright context", () => {
    const source = readFileSync(path.join(import.meta.dir, "../../src/frontend-design/capture-gate.ts"), "utf8")

    expect(source).toContain("browserProxy?: BrowserRuntime.BrowserProxyConfig")
    expect(source).toContain("proxyServer: browserProxy?.server")
    expect(source).toContain("...(input.browserProxy ? { proxy: input.browserProxy } : {})")
  })

  test("url screenshot tool does not downgrade unusable captures into attachments", () => {
    const source = readFileSync(path.join(import.meta.dir, "../../src/frontend-design/url-screenshot-tool.ts"), "utf8")

    expect(source).toContain("Rejects blank or no-signal captures before returning a PNG attachment")
    expect(source).not.toContain("without rejecting the image")
  })

  test("captures a local HTTP visual reference through the browser runtime", async () => {
    const outDir = path.join(os.tmpdir(), `capture-gate-runtime-${process.pid}-${Date.now()}`)
    mkdirSync(outDir, { recursive: true })
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          `<!doctype html><html><body style="margin:0;background:#fff">
            <main style="width:640px;height:360px;background:#4e6ef2;color:white">
              <h1>Runtime capture fixture</h1>
              <p>Visible reference copy</p>
            </main>
          </body></html>`,
          { headers: { "content-type": "text/html" } },
        )
      },
    })

    try {
      const result = await captureReferenceManifest({
        url: `http://127.0.0.1:${server.port}/`,
        outDir,
        viewport: { width: 640, height: 360 },
        timeoutMs: 20_000,
      })

      expect(result.manifest.reference_strings).toContain("Runtime capture fixture")
      expect(statSync(result.artifactPaths.screenshotPng).size).toBeGreaterThan(0)
      expect(statSync(result.artifactPaths.domHtml).size).toBeGreaterThan(0)
    } finally {
      server.stop(true)
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 60_000)

  test("rejects a real blank local HTTP capture before materializing reference artifacts", async () => {
    const outDir = path.join(os.tmpdir(), `capture-gate-blank-${process.pid}-${Date.now()}`)
    mkdirSync(outDir, { recursive: true })
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(`<!doctype html><html><body style="margin:0;background:#fff"></body></html>`, {
          headers: { "content-type": "text/html" },
        })
      },
    })

    try {
      await expect(
        captureReferenceManifest({
          url: `http://127.0.0.1:${server.port}/`,
          outDir,
          viewport: { width: 640, height: 360 },
          timeoutMs: 20_000,
        }),
      ).rejects.toBeInstanceOf(CaptureReferenceError)
      expect(existsSync(path.join(outDir, "manifest.json"))).toBe(false)
      expect(existsSync(path.join(outDir, "screenshot.png"))).toBe(false)
    } finally {
      server.stop(true)
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 60_000)
})
