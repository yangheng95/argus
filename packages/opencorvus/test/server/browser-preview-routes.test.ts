import { afterEach, describe, expect, mock, test } from "bun:test"
import { and, eq } from "drizzle-orm"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { PNG } from "pngjs"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Server } from "../../src/server/server"
import { closeBrowserPreviewLiveSessions } from "../../src/browser-preview/live"
import {
  BROWSER_PREVIEW_EVIDENCE_KIND,
  latestBrowserPreviewEvidenceIDs,
  persistBrowserPreviewEvidence,
  persistBrowserPreviewTarget,
} from "../../src/browser-preview/persist"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const ROUTE_TEST_TIMEOUT_MILLISECONDS = 20_000

describe("browser preview routes", () => {
  afterEach(async () => {
    await closeBrowserPreviewLiveSessions()
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

  function centerPixel(bytes: Buffer): [number, number, number, number] {
    const png = PNG.sync.read(bytes)
    const x = Math.floor(png.width / 2)
    const y = Math.floor(png.height / 2)
    const offset = (y * png.width + x) * 4
    return [png.data[offset]!, png.data[offset + 1]!, png.data[offset + 2]!, png.data[offset + 3]!]
  }

  function expectCenterColor(bytes: Buffer, color: "red" | "blue") {
    const [red, green, blue] = centerPixel(bytes)
    if (color === "red") {
      expect(red).toBeGreaterThan(200)
      expect(green).toBeLessThan(80)
      expect(blue).toBeLessThan(80)
    } else {
      expect(red).toBeLessThan(80)
      expect(green).toBeLessThan(80)
      expect(blue).toBeGreaterThan(200)
    }
  }

  async function browserPreviewArtifactPath(directory: string, taskID: string, name: string): Promise<string> {
    const dir = ProjectRuntimePaths.taskAbsolute(directory, taskID, "browser-preview", "art-route-test-job")
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

        await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:9/dead" })
        await persistBrowserPreviewTarget({ taskID, url: liveUrl })

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
        expect(JSON.stringify(body)).toContain("Saved browser preview target is unreachable")

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
      const target = await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:9/dead" })

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
        const reachable = await persistBrowserPreviewTarget({ taskID, url: preview.url.href, now: 100 })
        const unreachable = await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:9/dead", now: 200 })

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
        const target = await persistBrowserPreviewTarget({ taskID, url: preview.url.href })
        const desktopPath = await browserPreviewArtifactPath(tmp.path, taskID, "desktop.png")
        const mobilePath = await browserPreviewArtifactPath(tmp.path, taskID, "mobile.png")
        await fs.writeFile(desktopPath, "desktop-evidence")
        await fs.writeFile(mobilePath, "mobile-evidence")
        const desktopEvidenceID = persistBrowserPreviewEvidence({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportID: "desktop",
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
          status: "passed",
          summary: "mobile persisted evidence",
          capture: { captured: true, passed: true, path: mobilePath, sha: sha16("mobile-evidence") },
          diagnostics: ["mobile persisted evidence"],
          now: 2000,
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
        expect(body.latestEvidenceIDs?.desktop).toBe(desktopEvidenceID)
        expect(body.latestEvidenceIDs?.mobile).toBe(mobileEvidenceID)
      } finally {
        preview.stop(true)
      }
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "GET /task/:taskID/browser-preview skips unreadable latest evidence IDs",
    async () => {
      await using tmp = await tmpdir()
      const preview = servePreview()
      const taskID = await seedTask(tmp.path)
      try {
        const target = await persistBrowserPreviewTarget({ taskID, url: preview.url.href })
        const readablePath = await browserPreviewArtifactPath(tmp.path, taskID, "desktop-readable.png")
        const corruptPath = await browserPreviewArtifactPath(tmp.path, taskID, "desktop-corrupt.png")
        await fs.writeFile(readablePath, "desktop-readable")
        await fs.writeFile(corruptPath, "desktop-corrupt")
        const readableEvidenceID = persistBrowserPreviewEvidence({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportID: "desktop",
          status: "passed",
          summary: "older readable desktop evidence",
          capture: { captured: true, passed: true, path: readablePath, sha: sha16("desktop-readable") },
          diagnostics: ["older readable desktop evidence"],
          now: 1000,
        })
        const corruptEvidenceID = persistBrowserPreviewEvidence({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportID: "desktop",
          status: "passed",
          summary: "newer corrupt desktop evidence",
          capture: { captured: true, passed: true, path: corruptPath, sha: "wrongsha" },
          diagnostics: ["newer corrupt desktop evidence"],
          now: 2000,
        })
        expect(
          (await latestBrowserPreviewEvidenceIDs({ projectRoot: tmp.path, taskID, targetID: target.id })).desktop,
        ).toBe(readableEvidenceID)

        const app = Server.App()
        const response = await app.request(`/task/${taskID}/browser-preview`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          latestEvidenceIDs?: { desktop?: string }
        }
        expect(body.latestEvidenceIDs?.desktop).toBe(readableEvidenceID)
        expect(body.latestEvidenceIDs?.desktop).not.toBe(corruptEvidenceID)
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
      const target = await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5173/" })

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
    "GET /task/:taskID/browser-preview/evidence/:evidenceID returns only persisted task evidence",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const screenshotPath = await browserPreviewArtifactPath(tmp.path, taskID, "desktop.png")
      await fs.writeFile(screenshotPath, "browser-preview-screenshot")
      const sha = sha16("browser-preview-screenshot")
      const evidenceID = persistBrowserPreviewEvidence({
        projectRoot: tmp.path,
        taskID,
        targetID: target.id,
        viewportID: "desktop",
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
        status: string
        capture?: { path?: string; sha?: string }
        diagnostics?: string[]
      }
      expect(body.id).toBe(evidenceID)
      expect(body.taskID).toBe(taskID)
      expect(body.targetID).toBe(target.id)
      expect(body.viewportID).toBe("desktop")
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
    "GET /task/:taskID/browser-preview/evidence/:evidenceID/capture.png returns persisted PNG bytes",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const screenshotPath = await browserPreviewArtifactPath(tmp.path, taskID, "desktop.png")
      const bytes = Buffer.from("browser-preview-png-bytes")
      await fs.writeFile(screenshotPath, bytes)
      const evidenceID = persistBrowserPreviewEvidence({
        projectRoot: tmp.path,
        taskID,
        targetID: target.id,
        viewportID: "desktop",
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
    "GET /task/:taskID/browser-preview/evidence/:evidenceID/artifact/:artifactName returns comparison PNG bytes",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const artifactPath = await browserPreviewArtifactPath(tmp.path, taskID, "side-by-side.png")
      const bytes = Buffer.from("region-comparison-png-bytes")
      await fs.writeFile(artifactPath, bytes)
      const evidenceID = persistBrowserPreviewEvidence({
        projectRoot: tmp.path,
        taskID,
        targetID: target.id,
        viewportID: "desktop",
        operationKind: "reference-comparison",
        regionID: "economy",
        status: "passed",
        summary: "reference comparison completed",
        artifactPaths: { side_by_side: artifactPath },
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
    "GET /task/:taskID/browser-preview/evidence/:evidenceID rejects missing or mismatched screenshot artifacts",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const missingPath = ProjectRuntimePaths.taskRelative(
        taskID,
        "browser-preview",
        "art-route-test-job",
        "missing.png",
      )
      const missingEvidenceID = persistBrowserPreviewEvidence({
        projectRoot: tmp.path,
        taskID,
        targetID: target.id,
        viewportID: "desktop",
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
      expect(missing.status).toBe(404)

      const mismatch = await app.request(`/task/${taskID}/browser-preview/evidence/${mismatchEvidenceID}`, {
        headers: {
          "x-opencorvus-directory": tmp.path,
        },
      })
      expect(mismatch.status).toBe(404)
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "browser preview evidence rejects artifact paths outside task runtime",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })

      expect(() =>
        persistBrowserPreviewEvidence({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportID: "desktop",
          status: "passed",
          summary: "invalid absolute artifact",
          capture: { captured: true, passed: true, path: path.join(tmp.path, "outside.png") },
          diagnostics: ["invalid absolute artifact"],
        }),
      ).toThrow("outside task runtime")
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
    "browser preview task request schemas reject direct URL and output directory fields",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const app = Server.App()
      const binding = {
        region_id: "economy",
        viewport_id: "desktop",
        region_scope: "page-section",
        source: {
          reference_artifact_id: "reference.png",
          bbox: { x: 0, y: 0, width: 100, height: 80 },
          semantic_role: "economy section",
        },
        implementation: {
          route: "/",
          locator: { kind: "data-oc-region", value: "economy" },
        },
      }
      const request = async (path: string, body: unknown) =>
        app.request(`/task/${taskID}/browser-preview/${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify(body),
        })

      const capture = await request("capture", {
        targetID: target.id,
        viewportIDs: ["desktop"],
        url: "http://127.0.0.1:5173/",
        outDir: ".opencorvus/other",
      })
      expect(capture.status).toBe(400)
      expect(JSON.stringify(await capture.json())).toContain("url")

      const compareTopLevel = await request("compare", {
        targetID: target.id,
        viewportIDs: ["desktop"],
        inlineBindings: [binding],
        url: "http://127.0.0.1:5173/",
      })
      expect(compareTopLevel.status).toBe(400)
      expect(JSON.stringify(await compareTopLevel.json())).toContain("url")

      const compareNested = await request("compare", {
        targetID: target.id,
        viewportIDs: ["desktop"],
        inlineBindings: [
          {
            ...binding,
            source: {
              ...binding.source,
              outDir: ".opencorvus/other",
            },
          },
        ],
      })
      expect(compareNested.status).toBe(400)
      expect(JSON.stringify(await compareNested.json())).toContain("outDir")

      const liveSnapshot = await request("live/snapshot", {
        targetID: target.id,
        viewportID: "desktop",
        url: "http://127.0.0.1:5173/",
      })
      expect(liveSnapshot.status).toBe(400)
      expect(JSON.stringify(await liveSnapshot.json())).toContain("url")

      const liveInput = await request("live/input", {
        targetID: target.id,
        viewportID: "desktop",
        input: { kind: "click", x: 1, y: 1, outDir: ".opencorvus/other" },
      })
      expect(liveInput.status).toBe(400)
      expect(JSON.stringify(await liveInput.json())).toContain("outDir")
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
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "reference comparison evidence does not become the latest browser preview capture",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const screenshotPath = await browserPreviewArtifactPath(tmp.path, taskID, "desktop.png")
      const sideBySidePath = await browserPreviewArtifactPath(tmp.path, taskID, "side-by-side.png")
      await fs.writeFile(screenshotPath, "preview-capture")
      await fs.writeFile(sideBySidePath, "side-by-side")
      const captureID = persistBrowserPreviewEvidence({
        projectRoot: tmp.path,
        taskID,
        targetID: target.id,
        viewportID: "desktop",
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
        status: "passed",
        summary: "comparison passed",
        artifactPaths: { side_by_side: sideBySidePath },
        diagnostics: ["comparison passed"],
        now: 2000,
      })

      expect((await latestBrowserPreviewEvidenceIDs({ projectRoot: tmp.path, taskID, targetID: target.id })).desktop).toBe(
        captureID,
      )
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "malformed operation kind evidence is unreadable and does not become latest capture",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const screenshotPath = await browserPreviewArtifactPath(tmp.path, taskID, "desktop.png")
      await fs.writeFile(screenshotPath, "preview-capture")
      const captureID = persistBrowserPreviewEvidence({
        projectRoot: tmp.path,
        taskID,
        targetID: target.id,
        viewportID: "desktop",
        status: "passed",
        summary: "capture passed",
        capture: { path: screenshotPath },
        diagnostics: ["capture passed"],
        now: 1000,
      })
      const badEvidence = [
        {
          id: "art_preview_missing_operation_kind",
          payload: {
            target_id: target.id,
            viewport_id: "desktop",
            status: "passed",
            summary: "missing operation kind",
            capture: { path: runtimeRelativePath(tmp.path, screenshotPath) },
            diagnostics: [],
            time_completed: 2000,
          },
          time: 2000,
        },
        {
          id: "art_preview_unknown_operation_kind",
          payload: {
            target_id: target.id,
            viewport_id: "desktop",
            operation_kind: "comparison",
            status: "passed",
            summary: "unknown operation kind",
            capture: { path: runtimeRelativePath(tmp.path, screenshotPath) },
            diagnostics: [],
            time_completed: 3000,
          },
          time: 3000,
        },
      ]
      Database.use((db) => {
        for (const item of badEvidence) {
          db.insert(EngineArtifactTable)
            .values({
              id: item.id,
              task_id: taskID,
              run_id: null,
              goal_run_id: null,
              acceptance_id: null,
              kind: BROWSER_PREVIEW_EVIDENCE_KIND,
              label: "capture",
              payload: item.payload,
              time_created: item.time,
              time_updated: item.time,
            })
            .run()
        }
      })

      expect((await latestBrowserPreviewEvidenceIDs({ projectRoot: tmp.path, taskID, targetID: target.id })).desktop).toBe(
        captureID,
      )

      const app = Server.App()
      for (const item of badEvidence) {
        const evidence = await app.request(`/task/${taskID}/browser-preview/evidence/${item.id}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(evidence.status).toBe(404)

        const capture = await app.request(`/task/${taskID}/browser-preview/evidence/${item.id}/capture.png`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(capture.status).toBe(404)
      }
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "POST /task/:taskID/browser-preview/live/snapshot returns a PNG from the persisted target",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistBrowserPreviewTarget({
        taskID,
        url: `data:text/html,${encodeURIComponent(`<!doctype html><html><body><button>Live</button><main>${"Preview ".repeat(80)}</main></body></html>`)}`,
      })
      const app = Server.App()
      const response = await app.request(`/task/${taskID}/browser-preview/live/snapshot`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencorvus-directory": tmp.path,
        },
        body: JSON.stringify({ targetID: target.id, viewportID: "mobile" }),
      })

      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("image/png")
      const bytes = Buffer.from(await response.arrayBuffer())
      expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    },
    { timeout: 60_000 },
  )

  test(
    "POST /task/:taskID/browser-preview/live/input serializes concurrent same-session commands",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistBrowserPreviewTarget({
        taskID,
        url: `data:text/html,${encodeURIComponent(`<!doctype html>
          <html>
            <head>
              <style>
                html, body { margin: 0; width: 100%; height: 100%; background: rgb(32, 32, 32); }
                button { position: absolute; top: 0; width: 120px; height: 120px; }
                #first { left: 0; }
                #second { left: 150px; }
              </style>
              <script>
                window.firstCompleted = false
                window.raceDetected = false
                function paint(value) {
                  document.body.style.background = value
                }
                function firstInput() {
                  setTimeout(() => {
                    window.firstCompleted = true
                    if (!window.raceDetected) paint('rgb(255, 0, 0)')
                  }, 40)
                }
                function secondInput() {
                  if (window.firstCompleted) {
                    paint('rgb(0, 0, 255)')
                  } else {
                    window.raceDetected = true
                    paint('rgb(255, 0, 255)')
                  }
                }
              </script>
            </head>
            <body>
              <button id="first" onclick="firstInput()">First</button>
              <button id="second" onclick="secondInput()">Second</button>
            </body>
          </html>`)}`,
      })
      const app = Server.App()
      const headers = {
        "content-type": "application/json",
        "x-opencorvus-directory": tmp.path,
      }
      const url = `/task/${taskID}/browser-preview/live/input`

      const warm = await app.request(`/task/${taskID}/browser-preview/live/snapshot`, {
        method: "POST",
        headers,
        body: JSON.stringify({ targetID: target.id, viewportID: "desktop" }),
      })
      expect(warm.status).toBe(200)

      const redRequest = app.request(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          targetID: target.id,
          viewportID: "desktop",
          input: { kind: "click", x: 60, y: 60 },
        }),
      })
      const blueRequest = app.request(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          targetID: target.id,
          viewportID: "desktop",
          input: { kind: "click", x: 210, y: 60 },
        }),
      })

      const [redResponse, blueResponse] = await Promise.all([redRequest, blueRequest])
      expect(redResponse.status).toBe(200)
      expect(blueResponse.status).toBe(200)
      expectCenterColor(Buffer.from(await redResponse.arrayBuffer()), "red")
      expectCenterColor(Buffer.from(await blueResponse.arrayBuffer()), "blue")

      const finalSnapshot = await app.request(`/task/${taskID}/browser-preview/live/snapshot`, {
        method: "POST",
        headers,
        body: JSON.stringify({ targetID: target.id, viewportID: "desktop" }),
      })
      expect(finalSnapshot.status).toBe(200)
      expectCenterColor(Buffer.from(await finalSnapshot.arrayBuffer()), "blue")
    },
    { timeout: 60_000 },
  )

  test(
    "POST /task/:taskID/browser-preview/live/input requires persisted target IDs",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const app = Server.App()

      const missingTargetID = await app.request(`/task/${taskID}/browser-preview/live/input`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencorvus-directory": tmp.path,
        },
        body: JSON.stringify({
          url: "http://127.0.0.1:5173/",
          viewportID: "desktop",
          input: { kind: "click", x: 1, y: 1 },
        }),
      })
      expect(missingTargetID.status).toBe(400)
      expect(JSON.stringify(await missingTargetID.json())).toContain("targetID")

      const unknownTarget = await app.request(`/task/${taskID}/browser-preview/live/input`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencorvus-directory": tmp.path,
        },
        body: JSON.stringify({
          targetID: "art_previewtarget_missing",
          viewportID: "desktop",
          input: { kind: "click", x: 1, y: 1 },
        }),
      })
      expect(unknownTarget.status).toBe(404)
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "POST /task/:taskID/browser-preview/capture rejects unknown target IDs before verification",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const app = Server.App()
      await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })

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
  const output = ProjectRuntimePaths.taskAbsolute(projectRoot, taskID, "browser-preview", "route-test", filename)
  await fs.mkdir(path.dirname(output), { recursive: true })
  return output
}

function runtimeRelativePath(projectRoot: string, absolutePath: string): string {
  return path.relative(path.resolve(projectRoot), path.resolve(absolutePath)).replaceAll(path.sep, "/")
}
