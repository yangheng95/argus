import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { findBrowserPreviewEvidenceByID, persistBrowserPreviewTarget } from "../../src/browser-preview/persist"
import { resolveBrowserPreviewTarget } from "../../src/browser-preview/target"
import { verifyBrowserPreview } from "../../src/browser-preview/verification"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import type { RuntimeCaptureInput, RuntimeCaptureResult, RuntimeCaptureSuccess } from "../../src/runtime/page-capture"

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

    const result = await verifyBrowserPreview({
      projectRoot: tmp.path,
      target,
      viewportID: "tablet",
      outDir: tmp.path,
      async capture(input) {
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
    expect(result.viewport.id).toBe("tablet")
    expect(capturedInput?.url).toBe("http://127.0.0.1:5173/")
    expect(capturedInput?.viewport_width).toBe(834)
    expect(capturedInput?.viewport_height).toBe(1112)
    expect(capturedInput?.fileLabel).toBe("tablet")
  })

  test("fails visibly when the target has no URL", async () => {
    await using tmp = await tmpdir()
    const taskID = await seedTask(tmp.path)
    const target = await resolveBrowserPreviewTarget({ projectRoot: tmp.path, taskID, isVisible: async () => true })

    const result = await verifyBrowserPreview({
      projectRoot: tmp.path,
      target,
      viewportID: "desktop",
      async capture() {
        throw new Error("capture should not run")
      },
    })

    expect(result.status).toBe("failed")
    expect(result.capture).toBeUndefined()
    expect(result.diagnostics.join("\n")).toContain("requires a resolved http(s) URL")
  })

  test("persists task-scoped browser preview evidence from capture result", async () => {
    await using tmp = await tmpdir()
    const taskID = await seedTask(tmp.path)
    const persisted = await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5173/" })
    const target = await resolveBrowserPreviewTarget({ projectRoot: tmp.path, taskID, isVisible: async () => true })

    const result = await verifyBrowserPreview({
      projectRoot: tmp.path,
      taskID,
      target,
      viewportID: "desktop",
      outDir: tmp.path,
      async capture(input) {
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
    const artifact = Database.use((db) =>
      db
        .select()
        .from(EngineArtifactTable)
        .where(eq(EngineArtifactTable.kind, "browser_preview_evidence"))
        .limit(1)
        .get(),
    )
    expect(artifact?.task_id).toBe(taskID)
    expect(artifact?.payload?.target_id).toBe(persisted.id)
    expect(artifact?.payload?.status).toBe("failed")
    const evidence = findBrowserPreviewEvidenceByID({ taskID, evidenceID: result.target.latestEvidenceID! })
    expect(evidence?.taskID).toBe(taskID)
    expect(evidence?.targetID).toBe(persisted.id)
    expect(evidence?.viewportID).toBe("desktop")
    expect(evidence?.status).toBe("failed")
    expect(evidence?.capture).toEqual(artifact?.payload?.capture)
    expect(evidence?.diagnostics).toEqual(["runtime capture failed: server refused connection"])
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
