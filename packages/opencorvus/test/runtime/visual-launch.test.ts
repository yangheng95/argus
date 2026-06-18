import { afterEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { renderPage, runVisualDiff, summarizeVisualReport } from "../../src/runtime/visual-page"
import { serveRenderedDir } from "../../script/benchmark/static-render-server"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

test("runtime render rejects local files instead of starting a server", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-url-only-render-"))
  tempDirs.push(dir)
  const htmlPath = path.join(dir, "index.html")
  await fs.writeFile(htmlPath, "<!doctype html><html><body><main>local file</main></body></html>")

  await expect(
    renderPage({
      rendered: htmlPath,
      outDir: dir,
      viewport: { width: 320, height: 240 },
      settleMs: 0,
    }),
  ).rejects.toThrow("URL-only")
})

test("runtime visual render source has no package-manager or static-server path", async () => {
  const source = await fs.readFile(path.resolve(import.meta.dir, "../../src/runtime/visual-page.ts"), "utf8")

  expect(source).not.toContain("BUN_BINARY")
  expect(source).not.toContain("bun install")
  expect(source).not.toContain("bun run")
  expect(source).not.toContain("startStaticServer")
  expect(source).not.toContain("resolveProjectLaunchScript")
  expect(source).not.toContain("headless: true")
})

test("runtime visual render uses the shared browser launch timeout resolver", async () => {
  const source = await fs.readFile(path.resolve(import.meta.dir, "../../src/runtime/visual-page.ts"), "utf8")

  expect(source).toContain("BrowserRuntime.resolveBrowserLaunchTimeoutMs(input.browserLaunchTimeoutMs)")
  expect(source).not.toContain("OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS ?? 60_000")
})

test("runtime visual render reports glyph coverage as a capture layer", async () => {
  const source = await fs.readFile(path.resolve(import.meta.dir, "../../src/runtime/visual-page.ts"), "utf8")

  expect(source).toContain("collectGlyphCoverage(page)")
  expect(source).toContain("const glyph = await collectGlyphCoverage(page)")
  expect(source).toContain("glyph,")
})

test("visual diff fails runtime capture layers even when screenshot similarity passes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-runtime-visual-diff-"))
  tempDirs.push(dir)
  const projectDir = path.join(dir, "site")
  const referenceDir = path.join(dir, "reference-render")
  const diffDir = path.join(dir, "diff")
  await fs.mkdir(projectDir, { recursive: true })
  await fs.writeFile(
    path.join(projectDir, "index.html"),
    [
      "<!doctype html>",
      "<html>",
      "<head>",
      "<style>",
      "body{margin:0;background:white;color:#111;font:20px Arial,sans-serif}",
      "main{width:320px;height:240px;display:grid;place-items:center}",
      "</style>",
      "</head>",
      "<body>",
      "<main><section><h1>Runtime layer check</h1><p>Visual output is stable.</p></section></main>",
      '<script>console.error("runtime-layer-failure")</script>',
      "</body>",
      "</html>",
    ].join(""),
  )

  const server = await serveRenderedDir(projectDir)
  try {
    const viewport = { width: 320, height: 240 }
    const referenceRender = await renderPage({
      rendered: server.url,
      outDir: referenceDir,
      viewport,
      settleMs: 0,
      headless: true,
      minDomDescendants: 1,
    })
    const referencePath = path.join(dir, "reference.png")
    await fs.copyFile(referenceRender.renderedPath, referencePath)

    const report = await runVisualDiff({
      rendered: server.url,
      reference: referencePath,
      outDir: diffDir,
      viewport,
      threshold: 0.85,
      worstThreshold: 0.55,
      headless: true,
    })
    const persisted = JSON.parse(await fs.readFile(path.join(diffDir, "diff.json"), "utf8"))

    expect(report.gate.meanPassed).toBe(true)
    expect(report.gate.worstPassed).toBe(true)
    expect(report.gate.runtimePassed).toBe(false)
    expect(report.runtime.failedLayers).toContain("js")
    expect(report.reason).toBe("runtime_layers")
    expect(report.passed).toBe(false)
    expect(persisted.runtime.failedLayers).toContain("js")
    expect(summarizeVisualReport(report)).toContain("runtime_failed=js")
  } finally {
    await server.close()
  }
}, 30000)
