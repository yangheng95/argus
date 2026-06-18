import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { createServer, type Server } from "node:http"
import { readFileSync } from "node:fs"
import path from "node:path"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { findReadableBrowserPreviewEvidenceByID, persistBrowserPreviewTarget } from "../../src/browser-preview/persist"
import { resolveBrowserPreviewTarget } from "../../src/browser-preview/target"
import { verifyBrowserPreview } from "../../src/browser-preview/verification"
import { verifyBrowserPreviewForTest } from "../../src/browser-preview/verification-test-harness"
import { runBrowserPreviewEvidenceJob } from "../../src/browser-preview/evidence-runner"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import type {
  RuntimeCaptureInput,
  RuntimeCaptureResult,
  RuntimeCaptureSuccess,
} from "../../src/runtime/capture-contract"

describe("browser preview verification", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  async function seedTask(directory: string, taskID = `tsk_browserpreviewverify${Date.now()}`) {
    await Instance.provide({
      directory,
      fn: () => {
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              title: "Preview task",
              request: "Preview task",
              source: "api",
              time_created: Date.now(),
              time_updated: Date.now(),
            })
            .run(),
        )
      },
    })
    return taskID
  }

  test("captures the resolved URL with the shared viewport preset", async () => {
    await using tmp = await tmpdir()
    const taskID = await seedTask(tmp.path)
    await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5173/" })
    const target = await resolveBrowserPreviewTarget({ projectRoot: tmp.path, taskID, isVisible: async () => true })
    let capturedInput: RuntimeCaptureInput | undefined

    const result = await verifyBrowserPreviewForTest({
      projectRoot: tmp.path,
      taskID,
      targetID: target.id!,
      target,
      viewportIDs: ["tablet"],
      async captureForTest(input) {
        capturedInput = input
        const screenshotPath = path.join(input.outDir, "tablet.png")
        return {
          captured: true,
          passed: true,
          url: input.url,
          target_url: input.url,
          path: screenshotPath,
          sha: "abc123",
          bytes: 128,
          size: { width: 834, height: 1112 },
          requested_viewport: { width: input.viewport_width ?? 0, height: input.viewport_height ?? 0 },
          viewport: { width: input.viewport_width ?? 0, height: input.viewport_height ?? 0, capped: false },
          layers: passedLayers(screenshotPath),
          dom: {
            textLength: 12,
            nodeCount: 8,
            bodyDescendantCount: 6,
            hasBodyChildren: true,
            isEmptyRootShell: false,
          },
          summary: "all runtime capture layers passed on http://127.0.0.1:5173/",
        } as RuntimeCaptureResult
      },
    })

    expect(result.status).toBe("passed")
    expect(result.viewports.map((viewport) => viewport.id)).toEqual(["tablet"])
    expect(result.captures.tablet?.summary).toBe("all runtime capture layers passed on http://127.0.0.1:5173/")
    expect(result.evidenceIDs.tablet).toBeTruthy()
    expect(capturedInput?.url).toBe("http://127.0.0.1:5173/")
    expect(capturedInput?.viewport_width).toBe(834)
    expect(capturedInput?.viewport_height).toBe(1112)
    expect(capturedInput?.fileLabel).toBe("tablet")
  })

  test("captures every requested viewport in one verification job", async () => {
    await using tmp = await tmpdir()
    const taskID = await seedTask(tmp.path)
    await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5173/" })
    const target = await resolveBrowserPreviewTarget({ projectRoot: tmp.path, taskID, isVisible: async () => true })
    const capturedInputs: RuntimeCaptureInput[] = []

    const result = await verifyBrowserPreviewForTest({
      projectRoot: tmp.path,
      taskID,
      targetID: target.id!,
      target,
      viewportIDs: ["desktop", "mobile"],
      async captureForTest(input) {
        capturedInputs.push(input)
        const screenshotPath = path.join(input.outDir, `${input.fileLabel}.png`)
        return {
          captured: true,
          passed: input.fileLabel !== "mobile",
          url: input.url,
          target_url: input.url,
          path: screenshotPath,
          sha: `${input.fileLabel}-sha`,
          bytes: 128,
          size: { width: input.viewport_width ?? 0, height: input.viewport_height ?? 0 },
          requested_viewport: { width: input.viewport_width ?? 0, height: input.viewport_height ?? 0 },
          viewport: { width: input.viewport_width ?? 0, height: input.viewport_height ?? 0, capped: false },
          layers: passedLayers(screenshotPath),
          dom: {
            textLength: 12,
            nodeCount: 8,
            bodyDescendantCount: 6,
            hasBodyChildren: true,
            isEmptyRootShell: false,
          },
          summary: `${input.fileLabel} capture ${input.fileLabel === "mobile" ? "failed" : "passed"}`,
        } as RuntimeCaptureResult
      },
    })

    expect(result.status).toBe("failed")
    expect(result.viewports.map((viewport) => viewport.id)).toEqual(["desktop", "mobile"])
    expect(capturedInputs.map((input) => input.fileLabel)).toEqual(["desktop", "mobile"])
    expect(result.captures.desktop?.summary).toBe("desktop capture passed")
    expect(result.captures.mobile?.summary).toBe("mobile capture failed")
    expect(Object.keys(result.evidenceIDs).sort()).toEqual(["desktop", "mobile"])
    expect((result.captures.desktop as any).manifest.operations[0].viewportIDs).toEqual(["desktop", "mobile"])
    expect((result.captures.mobile as any).manifest.operations[0].viewportIDs).toEqual(["desktop", "mobile"])
  })

  test("fails visibly when the target has no URL", async () => {
    await using tmp = await tmpdir()
    const taskID = await seedTask(tmp.path)
    const target = await resolveBrowserPreviewTarget({ projectRoot: tmp.path, taskID, isVisible: async () => true })

    const result = await verifyBrowserPreview({
      projectRoot: tmp.path,
      taskID,
      targetID: "art_missing_browser_preview_target",
      target,
      viewportIDs: ["desktop"],
    })

    expect(result.status).toBe("failed")
    expect(result.captures).toEqual({})
    expect(result.evidenceIDs).toEqual({})
    expect(result.diagnostics.join("\n")).toContain("requires a resolved http(s) URL")
  })

  test("fails before capture when task-scoped verification lacks a target ID", async () => {
    await using tmp = await tmpdir()
    const taskID = await seedTask(tmp.path)
    await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5173/" })
    const target = await resolveBrowserPreviewTarget({ projectRoot: tmp.path, taskID, isVisible: async () => true })

    const result = await verifyBrowserPreview({
      projectRoot: tmp.path,
      taskID,
      targetID: "",
      target,
      viewportIDs: ["desktop"],
    })

    expect(result.status).toBe("failed")
    expect(result.captures).toEqual({})
    expect(result.evidenceIDs).toEqual({})
    expect(result.diagnostics.join("\n")).toContain("requires a task ID and persisted browser preview target ID")
  })

  test("fails before capture when no viewport is requested", async () => {
    await using tmp = await tmpdir()
    const taskID = await seedTask(tmp.path)
    await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5173/" })
    const target = await resolveBrowserPreviewTarget({ projectRoot: tmp.path, taskID, isVisible: async () => true })

    const result = await verifyBrowserPreview({
      projectRoot: tmp.path,
      taskID,
      targetID: target.id!,
      target,
      viewportIDs: [],
    })

    expect(result.status).toBe("failed")
    expect(result.viewports).toEqual([])
    expect(result.captures).toEqual({})
    expect(result.evidenceIDs).toEqual({})
    expect(result.diagnostics.join("\n")).toContain("requires at least one browser preview viewport")
  })

  test("persists task-scoped browser preview evidence from capture result", async () => {
    await using tmp = await tmpdir()
    const taskID = await seedTask(tmp.path)
    const persisted = await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5173/" })
    const target = await resolveBrowserPreviewTarget({ projectRoot: tmp.path, taskID, isVisible: async () => true })

    const result = await verifyBrowserPreviewForTest({
      projectRoot: tmp.path,
      taskID,
      targetID: persisted.id,
      target,
      viewportIDs: ["desktop"],
      async captureForTest(input) {
        return {
          captured: false,
          passed: false,
          url: input.url,
          requested_viewport: { width: input.viewport_width ?? 0, height: input.viewport_height ?? 0 },
          viewport: { width: input.viewport_width ?? 0, height: input.viewport_height ?? 0, capped: false },
          capture_error: { kind: "capture_failed", message: "server refused connection" },
          summary: "runtime capture failed: server refused connection",
        } as RuntimeCaptureResult
      },
    })

    expect(result.status).toBe("failed")
    expect(result.target.latestEvidenceIDs?.desktop).toBeTruthy()
    expect(result.evidenceIDs.desktop).toBe(result.target.latestEvidenceIDs?.desktop)
    const artifact = Database.use((db) =>
      db
        .select()
        .from(EngineArtifactTable)
        .where(eq(EngineArtifactTable.id, result.target.latestEvidenceIDs!.desktop!))
        .limit(1)
        .get(),
    )
    expect(artifact?.task_id).toBe(taskID)
    expect(artifact?.payload?.target_id).toBe(persisted.id)
    expect(artifact?.payload?.status).toBe("failed")
    const evidence = await findReadableBrowserPreviewEvidenceByID({
      projectRoot: tmp.path,
      taskID,
      evidenceID: result.target.latestEvidenceIDs!.desktop!,
    })
    expect(evidence?.taskID).toBe(taskID)
    expect(evidence?.targetID).toBe(persisted.id)
    expect(evidence?.viewportID).toBe("desktop")
    expect(evidence?.status).toBe("failed")
    expect(evidence?.capture).toEqual(artifact?.payload?.capture)
    expect(evidence?.diagnostics).toEqual(["runtime capture failed: server refused connection"])
  })

  test(
    "product evidence runner captures Chinese, Japanese, and Korean glyphs with default browser launch arguments",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const server = await startEastAsianGlyphServer()
      try {
        const target = await persistBrowserPreviewTarget({ taskID, url: server.url })
        const result = await runBrowserPreviewEvidenceJob({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportIDs: ["desktop"],
        })
        const capture = result.captures.desktop

        expect(capture?.captured).toBe(true)
        if (!capture?.captured) return
        expect(capture.passed).toBe(true)
        expect(capture.layers.glyph.passed).toBe(true)
        expect(capture.layers.glyph.checked).toBeGreaterThan(0)
        expect(capture.layers.glyph.failed).toEqual([])
        expect(capture.layers.js.console_errors).toEqual([])
        expect(capture.summary).toContain("all runtime capture layers passed")
      } finally {
        await server.close()
      }
    },
    { timeout: 120_000 },
  )

  test("product verification path does not import direct runtime page capture", () => {
    const source = readFileSync(new URL("../../src/browser-preview/verification.ts", import.meta.url), "utf8")
    const coreSource = readFileSync(new URL("../../src/browser-preview/verification-core.ts", import.meta.url), "utf8")
    const harnessSource = readFileSync(
      new URL("../../src/browser-preview/verification-test-harness.ts", import.meta.url),
      "utf8",
    )
    const evidenceRunnerSource = readFileSync(
      new URL("../../src/browser-preview/evidence-runner.ts", import.meta.url),
      "utf8",
    )
    const routeSource = readFileSync(new URL("../../src/server/routes/browser-preview.ts", import.meta.url), "utf8")

    expect(source).toContain("runBrowserPreviewEvidenceJob")
    expect(source).toMatch(
      /export async function verifyBrowserPreview\(\s*input: BrowserPreviewVerificationInput,\s*\)/,
    )
    expect(source).toContain("runBrowserPreviewVerification")
    expect(source).not.toContain("export async function verifyBrowserPreviewForTest")
    expect(source).not.toContain("captureForTest")
    expect(source).not.toContain("RuntimeCaptureInput")
    expect(source).not.toContain("writeBrowserEvidenceManifest")
    expect(harnessSource).toContain("export async function verifyBrowserPreviewForTest")
    expect(harnessSource).toContain("captureForTest: CaptureRuntimePage")
    expect(coreSource).toContain("export async function runBrowserPreviewVerification")
    expect(routeSource).toContain("verifyBrowserPreview")
    expect(routeSource).not.toContain("verifyBrowserPreviewForTest")
    expect(routeSource).not.toContain("verification-test-harness")
    expect(source).not.toContain("captureRuntimePage")
    for (const productSource of [source, coreSource, evidenceRunnerSource, routeSource]) {
      expect(productSource).not.toContain("captureRuntimePage")
      expect(productSource).not.toContain("renderPage")
      expect(productSource).not.toContain("@/browser/webpage")
      expect(productSource).not.toContain("@/runtime/visual-page")
      expect(productSource).not.toContain("@/runtime/page-capture")
    }
    expect(evidenceRunnerSource).toContain("@/runtime/png-metrics")
    expect(evidenceRunnerSource).toContain("@/runtime/capture-contract")
    expect(source).not.toContain('"no-task"')
    expect(source).not.toContain("targetID?:")
  })
})

async function startEastAsianGlyphServer(): Promise<{ url: string; close(): Promise<void> }> {
  let server: Server | undefined
  const html = [
    "<!doctype html>",
    '<html lang="zh-CN">',
    '<head><meta charset="utf-8"><title>East Asian glyph runner probe</title>',
    "<style>",
    "body{margin:0;padding:32px;background:#fff;color:#111;font-size:22px;line-height:1.7}",
    ".arial{font-family:Arial,sans-serif}",
    ".ainvest{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',Robot,'Source Han Sans',sans-serif}",
    ".windows{font-family:'Segoe UI','Microsoft YaHei UI','Microsoft YaHei',sans-serif}",
    ".noto{font-family:'NotoSans','Noto Sans CJK SC','Source Han Sans SC',sans-serif}",
    ".grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:20px}",
    "</style></head><body>",
    '<main data-oc-region="glyph-probe">',
    '<h1 class="windows">按钮 图标 尺寸 状态 中文测试</h1>',
    '<p class="arial">Arial/sans: 按钮 图标 尺寸 状态 中文测试</p>',
    '<p class="ainvest">AInvest base stack: 按钮 图标 尺寸 状态 中文测试</p>',
    '<p class="windows">Windows East Asian stack: 按钮 图标 尺寸 状态 中文测试</p>',
    '<p class="noto">Noto stack: 按钮 图标 尺寸 状态 中文测试</p>',
    '<section class="grid">',
    ...Array.from({ length: 24 }, (_, index) => `<span>中文样本 ${index} 按钮图标尺寸状态</span>`),
    "</section>",
    "</main></body></html>",
  ].join("")
  await new Promise<void>((resolve, reject) => {
    server = createServer((request, response) => {
      if (request.url === "/favicon.ico") {
        response.writeHead(204).end()
        return
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      response.end(html)
    })
    server.once("error", reject)
    server.listen(7778, "127.0.0.1", resolve)
  })
  return {
    url: "http://127.0.0.1:7778/",
    close: () => new Promise<void>((resolve) => server?.close(() => resolve())),
  }
}

function passedLayers(screenshotPath: string): RuntimeCaptureSuccess["layers"] {
  return {
    http: { passed: true, status: 200, content_type: "text/html", body_length: 240, reason: "" },
    asset: { passed: true, total: 1, failed: [] },
    dom: { passed: true, body_descendants: 20, required: 20 },
    js: { passed: true, console_errors: [], page_errors: [] },
    glyph: { passed: true, checked: 0, failed: [] },
    pixel: { passed: true, variance: 64, floor: 25, screenshot_path: screenshotPath },
    expected: { passed: true, missing_selectors: [], missing_texts: [] },
  }
}
