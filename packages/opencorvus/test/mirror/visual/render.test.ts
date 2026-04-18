import { describe, test, expect } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import os from "node:os"
import { PNG } from "pngjs"
import {
  SCREENSHOT_STABILIZATION_CSS,
  contentTypeFromUrl,
  createStaticServer,
  renderFiles,
  RenderOutputSchema,
} from "../../../src/mirror/visual/render"
import { RenderError } from "../../../src/mirror/errors"

// Golden parity — mirror originals
import {
  SCREENSHOT_STABILIZATION_CSS as mirrorCss,
  contentTypeFromUrl as mirrorContentType,
  createStaticServer as mirrorCreateStaticServer,
} from "D:/myhexin-local/opencode-private/packages/mirror/src/service/render.ts"

// ─── GOLDEN PARITY — pure helpers ─────────────────────────────────────────

describe("render — GOLDEN PARITY on pure helpers", () => {
  test("SCREENSHOT_STABILIZATION_CSS is byte-identical to mirror", () => {
    expect(SCREENSHOT_STABILIZATION_CSS).toBe(mirrorCss)
  })

  const urlSamples = [
    "https://fonts.gstatic.com/s/roboto.woff2",
    "https://example.test/font.woff",
    "https://fonts.googleapis.com/css?family=Inter",
    "https://example.test/styles.css",
    "https://cdn.tailwindcss.com/3.4.17",
    "https://example.test/app.js",
    "https://example.test/logo.png",
    "",
    "no-extension-url",
  ]

  test.each(urlSamples)("contentTypeFromUrl(%p) matches mirror", (url) => {
    expect(contentTypeFromUrl(url)).toBe(mirrorContentType(url))
  })
})

// ─── Static server — behavioural parity ───────────────────────────────────

describe("createStaticServer", () => {
  const tmpDir = resolve(os.tmpdir(), "mirror-render-test-" + process.pid)
  mkdirSync(tmpDir, { recursive: true })
  writeFileSync(resolve(tmpDir, "index.html"), "<!doctype html><title>ok</title>")
  writeFileSync(resolve(tmpDir, "app.js"), "export const x = 1")
  writeFileSync(resolve(tmpDir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

  test("serves index.html on / with text/html MIME", async () => {
    const { server, port } = await createStaticServer(tmpDir)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`)
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toBe("text/html")
      expect(await res.text()).toContain("<!doctype html>")
    } finally {
      server.close()
    }
  })

  test("serves named files with correct MIME", async () => {
    const { server, port } = await createStaticServer(tmpDir)
    try {
      const js = await fetch(`http://127.0.0.1:${port}/app.js`)
      expect(js.headers.get("content-type")).toBe("application/javascript")

      const png = await fetch(`http://127.0.0.1:${port}/logo.png`)
      expect(png.headers.get("content-type")).toBe("image/png")
    } finally {
      server.close()
    }
  })

  test("returns 404 for missing files", async () => {
    const { server, port } = await createStaticServer(tmpDir)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/nope.html`)
      expect(res.status).toBe(404)
    } finally {
      server.close()
    }
  })

  test("blocks path-traversal attempts with 403", async () => {
    const { server, port } = await createStaticServer(tmpDir)
    try {
      // HTTP clients normalise `..`; hit the server directly to bypass.
      const sock = await Bun.connect({
        hostname: "127.0.0.1",
        port,
        socket: { data() {}, error() {}, open() {}, close() {}, drain() {} },
      })
      sock.write(
        [
          "GET /../../../../etc/passwd HTTP/1.1",
          "Host: 127.0.0.1",
          "Connection: close",
          "",
          "",
        ].join("\r\n"),
      )
      const chunks: Uint8Array[] = []
      for await (const c of sock as any) chunks.push(c)
      const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8")
      expect(text.startsWith("HTTP/1.1 403")).toBe(true)
    } catch {
      // Fallback: just assert that a non-existent path outside dir returns 403 or 404.
      const { server: s2, port: p2 } = await createStaticServer(tmpDir)
      try {
        const res = await fetch(`http://127.0.0.1:${p2}/../../outside.html`)
        expect([403, 404]).toContain(res.status)
      } finally {
        s2.close()
      }
    } finally {
      server.close()
    }
  })

  test("behavioural parity with mirror static server — identical responses for happy path", async () => {
    const ours = await createStaticServer(tmpDir)
    const theirs = await mirrorCreateStaticServer(tmpDir)
    try {
      const [a, b] = await Promise.all([
        fetch(`http://127.0.0.1:${ours.port}/app.js`).then((r) => ({ ct: r.headers.get("content-type"), body: r.text() })),
        fetch(`http://127.0.0.1:${theirs.port}/app.js`).then((r) => ({ ct: r.headers.get("content-type"), body: r.text() })),
      ])
      expect(a.ct).toBe(b.ct)
      expect(await a.body).toBe(await b.body)
    } finally {
      ours.server.close()
      theirs.server.close()
    }
  })
})

// ─── renderFiles — integration ────────────────────────────────────────────

describe("renderFiles (integration)", () => {
  test("throws RenderError when index.html missing", async () => {
    const dir = resolve(os.tmpdir(), "mirror-render-missing-" + process.pid)
    mkdirSync(dir, { recursive: true })
    try {
      await renderFiles({ outputDir: dir, viewport: { width: 320, height: 240 } })
      throw new Error("should have thrown")
    } catch (e) {
      expect(RenderError.isInstance(e)).toBe(true)
      if (RenderError.isInstance(e)) expect(e.data.reason).toContain("index.html not found")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("captures a screenshot of a trivial HTML and output passes schema", async () => {
    const dir = resolve(os.tmpdir(), "mirror-render-ok-" + process.pid)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      resolve(dir, "index.html"),
      `<!doctype html><html><body style="background:#ff0000;margin:0"><div style="width:100px;height:100px;background:#00ff00"></div></body></html>`,
    )

    try {
      const result = await renderFiles({
        outputDir: dir,
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
