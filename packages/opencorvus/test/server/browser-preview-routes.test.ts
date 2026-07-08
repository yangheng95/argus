import { afterEach, describe, expect, mock, test } from "bun:test"
import { and, eq } from "drizzle-orm"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Server } from "../../src/server/server"
import {
  BROWSER_PREVIEW_EVIDENCE_KIND,
  latestBrowserPreviewEvidenceIDs,
  persistBrowserPreviewEvidence,
} from "../../src/browser-preview/persist"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import {
  TEST_BROWSER_PREVIEW_VIEWPORTS,
  persistTestBrowserPreviewTarget,
  persistTestBrowserPreviewTarget as persistBrowserPreviewTarget,
} from "../fixture/browser-preview"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const ROUTE_TEST_TIMEOUT_MILLISECONDS = 20_000
const ROUTE_BROWSER_PREVIEW_JOB_ID = "artifact_route_test_job"

describe("browser preview routes", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  async function seedTask(directory: string, taskID = `tsk_browserpreviewroute${Date.now()}`) {
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

  function servePreview() {
    return Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return new Response(
          `<!doctype html><html><head><title>Preview</title></head><body><button>Open</button><main>${"Preview ".repeat(80)}</main></body></html>`,
          {
            headers: { "content-type": "text/html" },
          },
        )
      },
    })
  }

  async function browserPreviewArtifactPath(directory: string, taskID: string, name: string): Promise<string> {
    const dir = ProjectRuntimePaths.browserPreviewJobRoot(directory, taskID, ROUTE_BROWSER_PREVIEW_JOB_ID)
    await fs.mkdir(dir, { recursive: true })
    return path.join(dir, name)
  }

  test(
    "GET /task/:taskID/browser-preview is task scoped and reads only saved targets",
    async () => {
      await using tmp = await tmpdir()
      const preview = servePreview()
      const taskID = await seedTask(tmp.path)
      try {
        await fs.writeFile(
          path.join(tmp.path, "package.json"),
          JSON.stringify({
            packageManager: "npm@10.9.0",
            opencorvus: { browserPreview: { url: "http://127.0.0.1:5173/" } },
          }),
        )
        const app = Server.App()
        const liveUrl = "https://preview.example/task"

        await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:9/dead" })
        await persistTestBrowserPreviewTarget({ taskID, url: liveUrl })

        const response = await app.request(`/task/${taskID}/browser-preview`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          status: string
          url?: string
          source: string
          viewports?: { id: string }[]
          candidates?: { url: string; selected: boolean }[]
        }
        expect(body.status).toBe("ready")
        expect(body.url).toBe(liveUrl)
        expect(body.source).toBe("task-artifact")
        expect(body.viewports?.map((viewport) => viewport.id)).toEqual(["desktop", "tablet", "mobile"])
        expect(body.candidates?.map((candidate) => ({ url: candidate.url, selected: candidate.selected }))).toEqual([
          { url: liveUrl, selected: true },
          { url: "http://127.0.0.1:9/dead", selected: false },
        ])
        expect(JSON.stringify(body)).not.toContain("Saved browser preview target is unreachable")

        const artifact = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(and(eq(EngineArtifactTable.kind, "browser_preview_target"), eq(EngineArtifactTable.task_id, taskID)))
            .limit(1)
            .get(),
        )
        expect(artifact?.task_id).toBe(taskID)
      } finally {
        preview.stop(true)
      }
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "GET /task/:taskID/browser-preview reports saved unreachable targets as failed",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const app = Server.App()
      const target = await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:9/dead" })

      const response = await app.request(`/task/${taskID}/browser-preview`, {
        headers: {
          "x-opencorvus-directory": tmp.path,
        },
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        id?: string
        status: string
        url?: string
        source: string
        candidates?: { id: string; url: string; selected: boolean }[]
        diagnostics?: string[]
      }
      expect(body.id).toBe(target.id)
      expect(body.status).toBe("failed")
      expect(body.url).toBe("http://127.0.0.1:9/dead")
      expect(body.source).toBe("task-artifact")
      expect(
        body.candidates?.map((candidate) => ({ id: candidate.id, url: candidate.url, selected: candidate.selected })),
      ).toEqual([{ id: target.id, url: "http://127.0.0.1:9/dead", selected: true }])
      expect(body.diagnostics?.join("\n")).toContain("Saved browser preview target is unreachable")
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "GET /task/:taskID/browser-preview does not replace the selected target with an older reachable candidate",
    async () => {
      await using tmp = await tmpdir()
      const preview = servePreview()
      const taskID = await seedTask(tmp.path)
      const app = Server.App()
      try {
        const reachable = await persistTestBrowserPreviewTarget({ taskID, url: preview.url.href, now: 100 })
        const unreachable = await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:9/dead", now: 200 })

        const response = await app.request(`/task/${taskID}/browser-preview`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          id?: string
          status: string
          url?: string
          source: string
          candidates?: { id: string; url: string; selected: boolean }[]
          diagnostics?: string[]
        }
        expect(body.id).toBe(unreachable.id)
        expect(body.status).toBe("failed")
        expect(body.url).toBe(unreachable.url)
        expect(body.source).toBe("task-artifact")
        expect(
          body.candidates?.map((candidate) => ({ id: candidate.id, url: candidate.url, selected: candidate.selected })),
        ).toEqual([
          { id: unreachable.id, url: unreachable.url, selected: true },
          { id: reachable.id, url: reachable.url, selected: false },
        ])
        expect(body.diagnostics?.join("\n")).toContain(unreachable.url)
        expect(body.diagnostics?.join("\n")).not.toContain(reachable.url)
      } finally {
        preview.stop(true)
      }
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "GET /task/:taskID/browser-preview does not use package metadata as a target source",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      await fs.writeFile(
        path.join(tmp.path, "package.json"),
        JSON.stringify({
          packageManager: "npm@10.9.0",
          opencorvus: { browserPreview: { url: "http://127.0.0.1:5173/", command: "npm run dev" } },
        }),
      )
      const app = Server.App()

      const response = await app.request(`/task/${taskID}/browser-preview`, {
        headers: {
          "x-opencorvus-directory": tmp.path,
        },
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { status: string; url?: string; source: string; diagnostics?: string[] }
      expect(body.status).toBe("missing")
      expect(body.url).toBeUndefined()
      expect(body.source).toBe("none")
      expect(body.diagnostics?.join("\n")).toContain("No browser preview target saved for this task")
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "GET /task/:taskID/browser-preview returns latest evidence IDs per viewport",
    async () => {
      await using tmp = await tmpdir()
      const preview = servePreview()
      const taskID = await seedTask(tmp.path)
      try {
        const target = await persistTestBrowserPreviewTarget({ taskID, url: preview.url.href })
        const desktopPath = await browserPreviewArtifactPath(tmp.path, taskID, "desktop.png")
        const mobilePath = await browserPreviewArtifactPath(tmp.path, taskID, "mobile.png")
        const newerDesktopPath = await browserPreviewArtifactPath(tmp.path, taskID, "desktop-newer.png")
        await fs.writeFile(desktopPath, "desktop-evidence")
        await fs.writeFile(mobilePath, "mobile-evidence")
        await fs.writeFile(newerDesktopPath, "desktop-newer-evidence")
        const desktopEvidenceID = persistBrowserPreviewEvidence({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportID: "desktop",
          operationKind: "preview-capture",
          status: "passed",
          summary: "desktop persisted evidence",
          capture: { captured: true, passed: true, path: desktopPath, sha: sha16("desktop-evidence") },
          diagnostics: ["desktop persisted evidence"],
          now: 1000,
        })
        const mobileEvidenceID = persistBrowserPreviewEvidence({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportID: "mobile",
          operationKind: "preview-capture",
          status: "passed",
          summary: "mobile persisted evidence",
          capture: { captured: true, passed: true, path: mobilePath, sha: sha16("mobile-evidence") },
          diagnostics: ["mobile persisted evidence"],
          now: 2000,
        })
        const newerDesktopEvidenceID = persistBrowserPreviewEvidence({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportID: "desktop",
          operationKind: "preview-capture",
          status: "passed",
          summary: "newer readable desktop evidence",
          capture: {
            captured: true,
            passed: true,
            path: newerDesktopPath,
            sha: sha16("desktop-newer-evidence"),
          },
          diagnostics: ["newer readable desktop evidence"],
          now: 3000,
        })
        const app = Server.App()

        const response = await app.request(`/task/${taskID}/browser-preview`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          latestEvidenceID?: string
          latestEvidenceIDs?: { desktop?: string; mobile?: string }
        }
        expect(body.latestEvidenceID).toBeUndefined()
        expect(body.latestEvidenceIDs?.desktop).toBe(newerDesktopEvidenceID)
        expect(body.latestEvidenceIDs?.desktop).not.toBe(desktopEvidenceID)
        expect(body.latestEvidenceIDs?.mobile).toBe(mobileEvidenceID)
      } finally {
        preview.stop(true)
      }
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "PUT /task/:taskID/browser-preview/target selects an existing saved target",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const app = Server.App()
      const target = await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5173/" })

      const response = await app.request(`/task/${taskID}/browser-preview/target`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-opencorvus-directory": tmp.path,
        },
        body: JSON.stringify({ targetID: target.id }),
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        id?: string
        status: string
        url?: string
        source: string
        diagnostics?: string[]
      }
      expect(body.id).toBe(target.id)
      expect(body.status).toBe("ready")
      expect(body.url).toBe("http://127.0.0.1:5173/")
      expect(body.source).toBe("task-artifact")
      expect(body.diagnostics?.join("\n")).toContain(`Selected task browser preview target ${target.id}.`)
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "PUT /task/:taskID/browser-preview/target rejects arbitrary URL bodies",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const app = Server.App()

      const response = await app.request(`/task/${taskID}/browser-preview/target`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-opencorvus-directory": tmp.path,
        },
        body: JSON.stringify({ url: "localhost:5173" }),
      })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(JSON.stringify(body)).toContain("targetID")
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "POST /task/:taskID/browser-preview/target saves a user-entered URL target",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const app = Server.App()

      const response = await app.request(`/task/${taskID}/browser-preview/target`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencorvus-directory": tmp.path,
        },
        body: JSON.stringify({
          url: "localhost:5173/app",
          viewports: TEST_BROWSER_PREVIEW_VIEWPORTS,
        }),
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { id?: string; status: string; url?: string; diagnostics?: string[] }
      expect(body.id).toBeTruthy()
      expect(body.status).toBe("ready")
      expect(body.url).toBe("http://localhost:5173/app")
      expect(body.diagnostics?.join("\n")).toContain("Saved task browser preview target")
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "GET /task/:taskID/browser-preview/evidence/:evidenceID returns only persisted task evidence",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const screenshotPath = await browserPreviewArtifactPath(tmp.path, taskID, "desktop.png")
      await fs.writeFile(screenshotPath, "browser-preview-screenshot")
      const sha = sha16("browser-preview-screenshot")
      const evidenceID = persistBrowserPreviewEvidence({
        projectRoot: tmp.path,
        taskID,
        targetID: target.id,
        viewportID: "desktop",
        operationKind: "preview-capture",
        status: "passed",
        summary: "all runtime capture layers passed",
        capture: { captured: true, passed: true, path: screenshotPath, sha },
        diagnostics: ["all runtime capture layers passed"],
        now: 1000,
      })
      const app = Server.App()

      const response = await app.request(`/task/${taskID}/browser-preview/evidence/${evidenceID}`, {
        headers: {
          "x-opencorvus-directory": tmp.path,
        },
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        id: string
        taskID: string
        targetID: string
        viewportID: string
        operationKind: string
        status: string
        capture?: { path?: string; sha?: string }
        diagnostics?: string[]
      }
      expect(body.id).toBe(evidenceID)
      expect(body.taskID).toBe(taskID)
      expect(body.targetID).toBe(target.id)
      expect(body.viewportID).toBe("desktop")
      expect(body.operationKind).toBe("preview-capture")
      expect(body.status).toBe("passed")
      expect(body.capture?.path).toBeUndefined()
      expect(body.capture?.sha).toBe(sha)
      expect(body.diagnostics).toEqual(["all runtime capture layers passed"])

      const missing = await app.request(`/task/${taskID}/browser-preview/evidence/art_missing`, {
        headers: {
          "x-opencorvus-directory": tmp.path,
        },
      })
      expect(missing.status).toBe(404)
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "GET /task/:taskID/browser-preview/evidence/:evidenceID rejects incomplete reference comparison artifacts",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const sideBySidePath = await browserPreviewArtifactPath(tmp.path, taskID, "incomplete-side-by-side.png")
      await fs.writeFile(sideBySidePath, "side-by-side-only")
      Database.use((db) =>
        db
          .insert(EngineArtifactTable)
          .values({
            id: "art_incomplete_reference_comparison",
            task_id: taskID,
            run_id: null,
            goal_run_id: null,
            acceptance_id: null,
            kind: "browser_preview_evidence",
            label: "capture",
            payload: {
              target_id: target.id,
              viewport_id: "desktop",
              operation_kind: "reference-comparison",
              region_id: "economy",
              artifact_paths: {
                side_by_side: ProjectRuntimePaths.taskRelative(
                  taskID,
                  "bp",
                  ROUTE_BROWSER_PREVIEW_JOB_ID,
                  "incomplete-side-by-side.png",
                ),
              },
              status: "passed",
              summary: "Incomplete reference comparison should be unreadable.",
              diagnostics: [],
              time_completed: Date.now(),
            },
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run(),
      )
      const app = Server.App()

      const evidence = await app.request(
        `/task/${taskID}/browser-preview/evidence/art_incomplete_reference_comparison`,
        {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        },
      )
      expect(evidence.status).toBe(500)
      expect(((await evidence.json()) as { name?: string }).name).toBe("BrowserPreviewEvidenceCorruptionError")

      const artifact = await app.request(
        `/task/${taskID}/browser-preview/evidence/art_incomplete_reference_comparison/artifact/side-by-side`,
        {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        },
      )
      expect(artifact.status).toBe(500)
      expect(((await artifact.json()) as { name?: string }).name).toBe("BrowserPreviewEvidenceCorruptionError")
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "GET /task/:taskID/browser-preview/evidence/:evidenceID/capture.png returns persisted PNG bytes",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const screenshotPath = await browserPreviewArtifactPath(tmp.path, taskID, "desktop.png")
      const bytes = Buffer.from("browser-preview-png-bytes")
      await fs.writeFile(screenshotPath, bytes)
      const evidenceID = persistBrowserPreviewEvidence({
        projectRoot: tmp.path,
        taskID,
        targetID: target.id,
        viewportID: "desktop",
        operationKind: "preview-capture",
        status: "passed",
        summary: "all runtime capture layers passed",
        capture: { captured: true, passed: true, path: screenshotPath, sha: sha16(bytes) },
        diagnostics: ["all runtime capture layers passed"],
        now: 1000,
      })
      const app = Server.App()

      const response = await app.request(`/task/${taskID}/browser-preview/evidence/${evidenceID}/capture.png`, {
        headers: {
          "x-opencorvus-directory": tmp.path,
        },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("image/png")
      expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe("browser-preview-png-bytes")

      const missing = await app.request(`/task/${taskID}/browser-preview/evidence/art_missing/capture.png`, {
        headers: {
          "x-opencorvus-directory": tmp.path,
        },
      })
      expect(missing.status).toBe(404)
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "GET /task/:taskID/browser-preview/evidence/:evidenceID/capture.png rejects reference comparison evidence",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const sourcePath = await browserPreviewArtifactPath(tmp.path, taskID, "capture-source.png")
      const implementationPath = await browserPreviewArtifactPath(tmp.path, taskID, "capture-implementation.png")
      const sideBySidePath = await browserPreviewArtifactPath(tmp.path, taskID, "capture-side-by-side.png")
      const implementationScreenshotPath = await browserPreviewArtifactPath(
        tmp.path,
        taskID,
        "capture-implementation-screenshot.png",
      )
      await fs.writeFile(sourcePath, "source-crop")
      await fs.writeFile(implementationPath, "implementation-crop")
      await fs.writeFile(sideBySidePath, "side-by-side")
      await fs.writeFile(implementationScreenshotPath, "implementation-screenshot")
      const evidenceID = persistBrowserPreviewEvidence({
        projectRoot: tmp.path,
        taskID,
        targetID: target.id,
        viewportID: "desktop",
        operationKind: "reference-comparison",
        regionID: "economy",
        cropIntent: "full-region",
        status: "passed",
        summary: "reference comparison completed",
        artifactPaths: {
          source_crop: sourcePath,
          implementation_crop: implementationPath,
          side_by_side: sideBySidePath,
        },
        capture: {
          region: {
            implementation_screenshot_path: implementationScreenshotPath,
          },
        },
        diagnostics: ["reference comparison completed"],
      })

      const response = await Server.App().request(
        `/task/${taskID}/browser-preview/evidence/${evidenceID}/capture.png`,
        {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        },
      )

      expect(response.status).toBe(404)
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "browser preview evidence rejects legacy task browser-preview runtime paths",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const legacyPath = ProjectRuntimePaths.taskAbsolute(tmp.path, taskID, "browser-preview", "legacy", "desktop.png")
      await fs.mkdir(path.dirname(legacyPath), { recursive: true })
      await fs.writeFile(legacyPath, "legacy-browser-preview-screenshot")

      expect(() =>
        persistBrowserPreviewEvidence({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportID: "desktop",
          operationKind: "preview-capture",
          status: "passed",
          summary: "legacy browser-preview path",
          capture: { captured: true, passed: true, path: legacyPath },
          diagnostics: ["legacy browser-preview path"],
        }),
      ).toThrow("task browser-preview job root")

      const staleEvidenceID = "art_stale_browser_preview_path"
      Database.use((db) =>
        db
          .insert(EngineArtifactTable)
          .values({
            id: staleEvidenceID,
            task_id: taskID,
            run_id: null,
            goal_run_id: null,
            acceptance_id: null,
            kind: BROWSER_PREVIEW_EVIDENCE_KIND,
            label: "capture",
            payload: {
              target_id: target.id,
              viewport_id: "desktop",
              operation_kind: "preview-capture",
              status: "passed",
              summary: "stale legacy browser-preview path",
              capture: {
                captured: true,
                passed: true,
                path: ProjectRuntimePaths.taskRelative(taskID, "browser-preview", "legacy", "desktop.png"),
              },
              diagnostics: ["stale legacy browser-preview path"],
              time_completed: Date.now(),
            },
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run(),
      )

      const response = await Server.App().request(`/task/${taskID}/browser-preview/evidence/${staleEvidenceID}`, {
        headers: {
          "x-opencorvus-directory": tmp.path,
        },
      })
      expect(response.status).toBe(500)
      expect(((await response.json()) as { name?: string }).name).toBe("BrowserPreviewEvidenceCorruptionError")
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "GET /task/:taskID/browser-preview/evidence/:evidenceID/artifact/:artifactName returns comparison PNG bytes",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const sourcePath = await browserPreviewArtifactPath(tmp.path, taskID, "source.png")
      const implementationPath = await browserPreviewArtifactPath(tmp.path, taskID, "implementation.png")
      const artifactPath = await browserPreviewArtifactPath(tmp.path, taskID, "side-by-side.png")
      const bytes = Buffer.from("region-comparison-png-bytes")
      await fs.writeFile(sourcePath, "source-crop")
      await fs.writeFile(implementationPath, "implementation-crop")
      await fs.writeFile(artifactPath, bytes)
      const evidenceID = persistBrowserPreviewEvidence({
        projectRoot: tmp.path,
        taskID,
        targetID: target.id,
        viewportID: "desktop",
        operationKind: "reference-comparison",
        regionID: "economy",
        cropIntent: "full-region",
        status: "passed",
        summary: "reference comparison completed",
        artifactPaths: {
          source_crop: sourcePath,
          implementation_crop: implementationPath,
          side_by_side: artifactPath,
        },
        diagnostics: ["reference comparison completed"],
        now: 1000,
      })
      const app = Server.App()

      const response = await app.request(
        `/task/${taskID}/browser-preview/evidence/${evidenceID}/artifact/side-by-side`,
        {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        },
      )

      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("image/png")
      expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe("region-comparison-png-bytes")

      const missing = await app.request(`/task/${taskID}/browser-preview/evidence/${evidenceID}/artifact/diff`, {
        headers: {
          "x-opencorvus-directory": tmp.path,
        },
      })
      expect(missing.status).toBe(404)
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "GET /task/:taskID/browser-preview/evidence/:evidenceID/artifact/:artifactName rejects source binding artifacts",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const sideBySidePath = await browserPreviewArtifactPath(tmp.path, taskID, "source-binding-side-by-side.png")
      await fs.writeFile(sideBySidePath, "source-binding-puzzle")
      const evidenceID = persistBrowserPreviewEvidence({
        projectRoot: tmp.path,
        taskID,
        targetID: target.id,
        viewportID: "desktop",
        operationKind: "source-binding",
        regionID: "economy",
        status: "passed",
        summary: "source binding completed",
        artifactPaths: {
          side_by_side: sideBySidePath,
        },
        diagnostics: ["source binding completed"],
      })

      const response = await Server.App().request(
        `/task/${taskID}/browser-preview/evidence/${evidenceID}/artifact/side-by-side`,
        {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        },
      )

      expect(response.status).toBe(404)
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "GET /task/:taskID/browser-preview/evidence/:evidenceID rejects missing or mismatched screenshot artifacts",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const missingPath = ProjectRuntimePaths.browserPreviewJobRelative(
        taskID,
        ROUTE_BROWSER_PREVIEW_JOB_ID,
        "missing.png",
      )
      const missingEvidenceID = persistBrowserPreviewEvidence({
        projectRoot: tmp.path,
        taskID,
        targetID: target.id,
        viewportID: "desktop",
        operationKind: "preview-capture",
        status: "passed",
        summary: "all runtime capture layers passed",
        capture: { captured: true, passed: true, path: missingPath, sha: "missing" },
        diagnostics: ["all runtime capture layers passed"],
      })
      const screenshotPath = await browserPreviewArtifactPath(tmp.path, taskID, "mismatch.png")
      await fs.writeFile(screenshotPath, "actual-screenshot")
      const mismatchEvidenceID = persistBrowserPreviewEvidence({
        projectRoot: tmp.path,
        taskID,
        targetID: target.id,
        viewportID: "desktop",
        operationKind: "preview-capture",
        status: "passed",
        summary: "all runtime capture layers passed",
        capture: { captured: true, passed: true, path: screenshotPath, sha: sha16("different-screenshot") },
        diagnostics: ["all runtime capture layers passed"],
      })
      const app = Server.App()

      const missing = await app.request(`/task/${taskID}/browser-preview/evidence/${missingEvidenceID}`, {
        headers: {
          "x-opencorvus-directory": tmp.path,
        },
      })
      expect(missing.status).toBe(500)
      const missingBody = (await missing.json()) as { name?: string; data?: { artifactPath?: string } }
      expect(missingBody.name).toBe("BrowserPreviewEvidenceCorruptionError")
      expect(missingBody.data?.artifactPath).toContain("missing.png")

      const mismatch = await app.request(`/task/${taskID}/browser-preview/evidence/${mismatchEvidenceID}`, {
        headers: {
          "x-opencorvus-directory": tmp.path,
        },
      })
      expect(mismatch.status).toBe(500)
      const mismatchBody = (await mismatch.json()) as { name?: string; data?: { expectedSha?: string; actualSha?: string } }
      expect(mismatchBody.name).toBe("BrowserPreviewEvidenceCorruptionError")
      expect(mismatchBody.data?.expectedSha).toBe(sha16("different-screenshot"))
      expect(mismatchBody.data?.actualSha).toBe(sha16("actual-screenshot"))
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "browser preview evidence rejects artifact paths outside task runtime",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })

      expect(() =>
        persistBrowserPreviewEvidence({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportID: "desktop",
          operationKind: "preview-capture",
          status: "passed",
          summary: "invalid absolute artifact",
          capture: { captured: true, passed: true, path: path.join(tmp.path, "outside.png") },
          diagnostics: ["invalid absolute artifact"],
        }),
      ).toThrow("task browser-preview job root")
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "old project-scoped browser preview target route is removed",
    async () => {
      await using tmp = await tmpdir()
      await seedTask(tmp.path)
      const app = Server.App()

      const response = await app.request("/browser-preview/target", {
        headers: {
          "x-opencorvus-directory": tmp.path,
        },
      })

      expect(response.status).toBe(404)
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test("GET /task/:taskID/browser-preview requires directory context", async () => {
    const app = Server.App()
    const response = await app.request("/task/tsk_browserpreviewroute000001/browser-preview")

    expect(response.status).toBe(400)
    const body = (await response.json()) as { name?: string }
    expect(body.name).toBe("DirectoryRequiredError")
  })

  test("GET /task/:taskID/browser-preview rejects task IDs from another project directory", async () => {
    await using first = await tmpdir()
    await using second = await tmpdir()
    const taskID = await seedTask(second.path)
    await persistTestBrowserPreviewTarget({ taskID, url: "https://preview.example/foreign-task" })
    const app = Server.App()

    const response = await app.request(`/task/${taskID}/browser-preview`, {
      headers: {
        "x-opencorvus-directory": first.path,
      },
    })

    expect(response.status).toBe(404)
    expect((await response.json()) as { name?: string }).toMatchObject({ name: "NotFoundError" })
  })

  test("browser preview task subroutes reject task IDs from another project directory", async () => {
    await using first = await tmpdir()
    await using second = await tmpdir()
    const taskID = await seedTask(second.path)
    const target = await persistTestBrowserPreviewTarget({ taskID, url: "https://preview.example/foreign-task" })
    const screenshotPath = await browserPreviewArtifactPath(second.path, taskID, "foreign-desktop.png")
    await fs.writeFile(screenshotPath, "foreign-browser-preview-screenshot")
    const evidenceID = persistBrowserPreviewEvidence({
      projectRoot: second.path,
      taskID,
      targetID: target.id,
      viewportID: "desktop",
      operationKind: "preview-capture",
      status: "passed",
      summary: "foreign project evidence",
      capture: {
        captured: true,
        passed: true,
        path: screenshotPath,
        sha: sha16("foreign-browser-preview-screenshot"),
      },
      diagnostics: ["foreign project evidence"],
    })
    const app = Server.App()
    const headers = {
      "content-type": "application/json",
      "x-opencorvus-directory": first.path,
    }

    const requests = [
      () => app.request(`/task/${taskID}/browser-preview/evidence/${evidenceID}`, { headers }),
      () => app.request(`/task/${taskID}/browser-preview/evidence/${evidenceID}/capture.png`, { headers }),
      () =>
        app.request(`/task/${taskID}/browser-preview/target`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ targetID: target.id }),
        }),
      () =>
        app.request(`/task/${taskID}/browser-preview/capture`, {
          method: "POST",
          headers,
          body: JSON.stringify({ targetID: target.id, viewportIDs: ["desktop"] }),
        }),
    ]

    for (const request of requests) {
      const response = await request()
      expect(response.status).toBe(404)
      expect((await response.json()) as { name?: string }).toMatchObject({ name: "NotFoundError" })
    }
  })

  test(
    "POST /task/:taskID/browser-preview/capture requires an explicit targetID",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const app = Server.App()

      const response = await app.request(`/task/${taskID}/browser-preview/capture`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencorvus-directory": tmp.path,
        },
        body: JSON.stringify({ viewportIDs: ["mobile"] }),
      })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(JSON.stringify(body)).toContain("targetID")
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "browser preview mutation routes reject direct evidence fields",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const app = Server.App()
      const cases = [
        {
          path: `/task/${taskID}/browser-preview/capture`,
          body: { targetID: target.id, viewportIDs: ["desktop"], url: "http://127.0.0.1:5173/" },
          field: "url",
        },
      ] as const

      for (const item of cases) {
        const response = await app.request(item.path, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify(item.body),
        })
        expect(response.status).toBe(400)
        expect(JSON.stringify(await response.json())).toContain(item.field)
      }
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "POST /task/:taskID/browser-preview/compare requires a persisted targetID before launching comparison",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const app = Server.App()

      const missingTargetID = await app.request(`/task/${taskID}/browser-preview/compare`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencorvus-directory": tmp.path,
        },
        body: JSON.stringify({ viewportIDs: ["desktop"], inlineBindings: [] }),
      })
      expect(missingTargetID.status).toBe(400)
      expect(JSON.stringify(await missingTargetID.json())).toContain("targetID")

      const unknownTarget = await app.request(`/task/${taskID}/browser-preview/compare`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencorvus-directory": tmp.path,
        },
        body: JSON.stringify({
          targetID: "art_previewtarget_missing",
          viewportIDs: ["desktop"],
          inlineBindings: [
            {
              region_id: "economy",
              viewport_id: "desktop",
              region_scope: "page-section",
              crop_intent: "full-region",
              source: {
                reference_artifact_id: "reference.png",
                bbox: { x: 0, y: 0, width: 100, height: 80 },
                semantic_role: "economy section",
              },
              implementation: {
                route: "/",
                locator: { kind: "data-oc-region", value: "economy" },
              },
            },
          ],
        }),
      })
      expect(unknownTarget.status).toBe(404)
      expect(JSON.stringify(await unknownTarget.json())).toContain("art_previewtarget_missing")

      const target = await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const withoutActiveRun = await app.request(`/task/${taskID}/browser-preview/compare`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencorvus-directory": tmp.path,
        },
        body: JSON.stringify({
          targetID: target.id,
          viewportIDs: ["desktop"],
          inlineBindings: [
            {
              region_id: "economy",
              viewport_id: "desktop",
              region_scope: "page-section",
              crop_intent: "full-region",
              source: {
                reference_artifact_id: "reference.png",
                bbox: { x: 0, y: 0, width: 100, height: 80 },
                semantic_role: "economy section",
              },
              implementation: {
                route: "/",
                locator: { kind: "data-oc-region", value: "economy" },
              },
            },
          ],
        }),
      })
      expect(withoutActiveRun.status).toBe(400)
      expect(JSON.stringify(await withoutActiveRun.json())).toContain("active run")
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "reference comparison evidence does not become the latest browser preview capture",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const screenshotPath = await browserPreviewArtifactPath(tmp.path, taskID, "desktop.png")
      const sourcePath = await browserPreviewArtifactPath(tmp.path, taskID, "source.png")
      const implementationPath = await browserPreviewArtifactPath(tmp.path, taskID, "implementation.png")
      const sideBySidePath = await browserPreviewArtifactPath(tmp.path, taskID, "side-by-side.png")
      await fs.writeFile(screenshotPath, "preview-capture")
      await fs.writeFile(sourcePath, "source-crop")
      await fs.writeFile(implementationPath, "implementation-crop")
      await fs.writeFile(sideBySidePath, "side-by-side")
      const captureID = persistBrowserPreviewEvidence({
        projectRoot: tmp.path,
        taskID,
        targetID: target.id,
        viewportID: "desktop",
        operationKind: "preview-capture",
        status: "passed",
        summary: "capture passed",
        capture: { path: screenshotPath },
        diagnostics: ["capture passed"],
        now: 1000,
      })
      persistBrowserPreviewEvidence({
        projectRoot: tmp.path,
        taskID,
        targetID: target.id,
        viewportID: "desktop",
        operationKind: "reference-comparison",
        regionID: "economy",
        cropIntent: "full-region",
        status: "passed",
        summary: "comparison passed",
        artifactPaths: {
          source_crop: sourcePath,
          implementation_crop: implementationPath,
          side_by_side: sideBySidePath,
        },
        diagnostics: ["comparison passed"],
        now: 2000,
      })

      expect(
        (await latestBrowserPreviewEvidenceIDs({ projectRoot: tmp.path, taskID, targetID: target.id })).desktop,
      ).toBe(captureID)
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test("retired browser preview PNG live routes are not mounted", async () => {
    await using tmp = await tmpdir()
    const taskID = await seedTask(tmp.path)
    const app = Server.App()
    const headers = {
      "content-type": "application/json",
      "x-opencorvus-directory": tmp.path,
    }

    const snapshot = await app.request(`/task/${taskID}/browser-preview/live/snapshot`, {
      method: "POST",
      headers,
      body: JSON.stringify({ targetID: "art_previewtarget_missing", viewportID: "desktop" }),
    })
    const input = await app.request(`/task/${taskID}/browser-preview/live/input`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        targetID: "art_previewtarget_missing",
        viewportID: "desktop",
        inputs: [{ kind: "click", x: 1, y: 1 }],
      }),
    })

    expect(snapshot.status).toBe(404)
    expect(input.status).toBe(404)
  })

  test(
    "POST /task/:taskID/browser-preview/capture rejects unknown target IDs before verification",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const app = Server.App()
      await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })

      const response = await app.request(`/task/${taskID}/browser-preview/capture`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencorvus-directory": tmp.path,
        },
        body: JSON.stringify({ targetID: "art_previewtarget_missing", viewportIDs: ["desktop"] }),
      })

      expect(response.status).toBe(404)
      expect(JSON.stringify(await response.json())).toContain("art_previewtarget_missing")
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )
})

function sha16(value: string | Uint8Array): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)
}

async function browserPreviewArtifactPath(projectRoot: string, taskID: string, filename: string): Promise<string> {
  const output = path.join(
    ProjectRuntimePaths.browserPreviewJobRoot(projectRoot, taskID, "artifact_route_test"),
    filename,
  )
  await fs.mkdir(path.dirname(output), { recursive: true })
  return output
}
