import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { captureRuntimePage, type RuntimeCaptureSuccess } from "../../src/delivery/runtime-capture"
import {
  buildScreenshotToolOutput,
  normalizeDeliveryScreenshotViewport,
  normalizeVerifyPageIntegrityInput,
} from "../../src/delivery/tools"
import { Instance } from "../../src/project/instance"
import { AttachmentStore } from "../../src/storage/attachment-store"

const tempDirs: string[] = []
const servers: http.Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("delivery screenshot viewport", () => {
  test("keeps normal captures inside the defensive viewport", () => {
    expect(normalizeDeliveryScreenshotViewport({ width: 1280, height: 720 })).toEqual({
      width: 1280,
      height: 720,
      capped: false,
    })
  })

  test("caps capture viewport without requiring host display resolution changes", () => {
    expect(normalizeDeliveryScreenshotViewport({ width: 4096, height: 2160 })).toEqual({
      width: 1440,
      height: 1080,
      capped: true,
    })
  })

  test("verify_page_integrity applies runtime defaults before runtime capture viewport", () => {
    expect(normalizeVerifyPageIntegrityInput({ url: "http://localhost:4173" })).toEqual({
      url: "http://localhost:4173",
      viewport_width: 1440,
      viewport_height: 1080,
      min_dom_descendants: 20,
      expect_selectors: [],
      expect_texts: [],
      wait_timeout_ms: 30_000,
      settle_ms: 2_500,
    })
  })

  test("runtime capture renders a local page and returns the integrity screenshot path", async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-runtime-capture-"))
    tempDirs.push(outDir)
    const url = await serveHtml(`
<!doctype html>
<html>
  <head><title>Runtime Capture Fixture</title><style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f7fbff; }
    #app { min-height: 600px; display: grid; grid-template-columns: 220px 1fr; }
    nav { background: #14324a; color: white; padding: 24px; }
    main { padding: 32px; color: #141414; }
    .metric { width: 260px; height: 120px; background: #f05a28; color: white; margin-top: 20px; }
  </style></head>
  <body>
    <div id="app">
      <nav><a href="/">Dashboard</a><button>Refresh</button><button>Export</button></nav>
      <main>
        <h1>Revenue Dashboard</h1>
        <section><p>Orders, margin, churn, retention, cohorts, forecast, alerts, and customer health.</p></section>
        <section class="metric">Revenue increased across all regions this quarter.</section>
      </main>
    </div>
  </body>
</html>
`)

    const capture = await captureRuntimePage({
      url,
      outDir,
      viewport_width: 800,
      viewport_height: 600,
      min_dom_descendants: 10,
      expect_selectors: ["#app", ".metric"],
      expect_texts: ["Revenue Dashboard"],
      settle_ms: 0,
    })

    expect(capture.captured).toBe(true)
    if (!capture.captured) throw new Error(capture.summary)
    expect(capture.passed).toBe(true)
    expect(capture.layers.http.passed).toBe(true)
    expect(capture.layers.dom.body_descendants).toBeGreaterThanOrEqual(10)
    expect(capture.layers.pixel.screenshot_path).toBe(capture.path)
    expect(await fileExists(capture.path)).toBe(true)
  })

  test("screenshot tool output attaches captured PNG for the next model turn", async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-screenshot-tool-"))
    tempDirs.push(projectDir)
    await Bun.$`git init`.cwd(projectDir).quiet()
    const screenshotPath = path.join(projectDir, "fixture.png")
    await fs.writeFile(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]))

    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        const output = (await buildScreenshotToolOutput(Instance.project.id, {
          captured: true,
          passed: true,
          url: "http://127.0.0.1:4173",
          target_url: "http://127.0.0.1:4173",
          path: screenshotPath,
          sha: "fixture-sha",
          bytes: 9,
          size: { width: 640, height: 480 },
          requested_viewport: { width: 640, height: 480 },
          viewport: { width: 640, height: 480, capped: false },
          layers: { pixel: { variance: 72.5 } },
          dom: {
            textLength: 0,
            nodeCount: 0,
            bodyDescendantCount: 0,
            hasBodyChildren: true,
            isEmptyRootShell: false,
          },
          summary: "captured",
        } as RuntimeCaptureSuccess)) as any

        expect(output.text).toContain('"ok": true')
        expect(output.attachments).toHaveLength(1)
        const attachment = output.attachments[0]
        expect(attachment.mime).toBe("image/png")
        expect(attachment.url).toStartWith(`/attachment/${Instance.project.id}/`)
        expect(attachment.url).not.toStartWith("data:")
        const located = AttachmentStore.nameFromUrl(attachment.url)
        expect(located).toBeTruthy()
        const bytes = await AttachmentStore.read(located!.projectID, located!.name)
        expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      },
    })
  })

  test("runtime capture treats browser unhandled rejections as JS integrity failures", async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-runtime-capture-"))
    tempDirs.push(outDir)
    const url = await serveHtml(`
<!doctype html>
<html>
  <body>
    <main><h1>Unhandled Rejection Fixture</h1><section><p>Enough page structure for capture.</p></section></main>
    <script>setTimeout(() => Promise.reject(new Error("fixture async failure")), 0)</script>
  </body>
</html>
`)

    const capture = await captureRuntimePage({
      url,
      outDir,
      viewport_width: 800,
      viewport_height: 600,
      min_dom_descendants: 2,
      settle_ms: 100,
    })

    expect(capture.captured).toBe(true)
    if (!capture.captured) throw new Error(capture.summary)
    expect(capture.layers.js.passed).toBe(false)
    expect(capture.layers.js.page_errors.join("\n")).toContain("fixture async failure")
  })

  test("verify_page_integrity delegates browser work to runtime capture", async () => {
    const source = await fs.readFile(path.resolve(import.meta.dir, "../../src/delivery/tools.ts"), "utf8")
    const start = source.indexOf("verify_page_integrity: tool")
    const end = source.indexOf("function renderDeliveryContextSection")
    const block = source.slice(start, end)

    expect(block).toContain("captureRuntimePage")
    expect(block).not.toContain("puppeteer.launch")
    expect(block).not.toContain("networkidle0")
  })
})

async function serveHtml(html: string): Promise<string> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(html)
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port")
  return `http://127.0.0.1:${address.port}`
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false,
  )
}
