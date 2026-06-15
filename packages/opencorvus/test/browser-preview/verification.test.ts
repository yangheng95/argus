import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { readFileSync } from "node:fs"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { findReadableBrowserPreviewEvidenceByID, persistBrowserPreviewTarget } from "../../src/browser-preview/persist"
import { resolveBrowserPreviewTarget } from "../../src/browser-preview/target"
import { verifyBrowserPreview } from "../../src/browser-preview/verification"
import { verifyBrowserPreviewForTest } from "../../src/browser-preview/verification-test-harness"
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
      outDir: tmp.path,
      async captureForTest(input) {
        capturedInput = input
        return {
          captured: true,
          passed: true,
          url: input.url,
          target_url: input.url,
          path: `${tmp.path}/tablet.png`,
          sha: "abc123",
          bytes: 128,
          size: { width: 834, height: 1112 },
          requested_viewport: { width: input.viewport_width ?? 0, height: input.viewport_height ?? 0 },
          viewport: { width: input.viewport_width ?? 0, height: input.viewport_height ?? 0, capped: false },
          layers: passedLayers(`${tmp.path}/tablet.png`),
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
      outDir: tmp.path,
      async captureForTest(input) {
        capturedInputs.push(input)
        return {
          captured: true,
          passed: input.fileLabel !== "mobile",
          url: input.url,
          target_url: input.url,
          path: `${tmp.path}/${input.fileLabel}.png`,
          sha: `${input.fileLabel}-sha`,
          bytes: 128,
          size: { width: input.viewport_width ?? 0, height: input.viewport_height ?? 0 },
          requested_viewport: { width: input.viewport_width ?? 0, height: input.viewport_height ?? 0 },
          viewport: { width: input.viewport_width ?? 0, height: input.viewport_height ?? 0, capped: false },
          layers: passedLayers(`${tmp.path}/${input.fileLabel}.png`),
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
      outDir: tmp.path,
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
    expect(result.target.latestEvidenceID).toBeTruthy()
    expect(result.evidenceIDs.desktop).toBe(result.target.latestEvidenceID)
    const artifact = Database.use((db) =>
      db
        .select()
        .from(EngineArtifactTable)
        .where(eq(EngineArtifactTable.id, result.target.latestEvidenceID!))
        .limit(1)
        .get(),
    )
    expect(artifact?.task_id).toBe(taskID)
    expect(artifact?.payload?.target_id).toBe(persisted.id)
    expect(artifact?.payload?.status).toBe("failed")
    const evidence = await findReadableBrowserPreviewEvidenceByID({
      taskID,
      evidenceID: result.target.latestEvidenceID!,
    })
    expect(evidence?.taskID).toBe(taskID)
    expect(evidence?.targetID).toBe(persisted.id)
    expect(evidence?.viewportID).toBe("desktop")
    expect(evidence?.status).toBe("failed")
    expect(evidence?.capture).toEqual(artifact?.payload?.capture)
    expect(evidence?.diagnostics).toEqual(["runtime capture failed: server refused connection"])
  })

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

function passedLayers(screenshotPath: string): RuntimeCaptureSuccess["layers"] {
  return {
    http: { passed: true, status: 200, content_type: "text/html", body_length: 240, reason: "" },
    asset: { passed: true, total: 1, failed: [] },
    dom: { passed: true, body_descendants: 20, required: 20 },
    js: { passed: true, console_errors: [], page_errors: [] },
    pixel: { passed: true, variance: 64, floor: 25, screenshot_path: screenshotPath },
    expected: { passed: true, missing_selectors: [], missing_texts: [] },
  }
}
