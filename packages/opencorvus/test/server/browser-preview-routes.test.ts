import { afterEach, describe, expect, mock, test } from "bun:test"
import { and, eq } from "drizzle-orm"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { closeBrowserPreviewLiveSessions } from "../../src/browser-preview/live"
import {
  findLatestBrowserPreviewTarget,
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
    "PUT /task/:taskID/browser-preview/target persists an explicit URL as the task target",
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

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        id?: string
        status: string
        url?: string
        source: string
        diagnostics?: string[]
      }
      expect(body.id).toBeString()
      expect(body.status).toBe("ready")
      expect(body.url).toBe("http://localhost:5173/")
      expect(body.source).toBe("task-artifact")
      expect(body.diagnostics?.join("\n")).toContain(`Selected task browser preview target ${body.id}.`)
      expect(findLatestBrowserPreviewTarget(taskID)?.url).toBe("http://localhost:5173/")
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "PUT /task/:taskID/browser-preview/target rejects invalid explicit URL bodies",
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
        body: JSON.stringify({ url: "file:///tmp/index.html" }),
      })

      expect(response.status).toBe(400)
      const body = (await response.json()) as { status?: string; diagnostics?: string[] }
      expect(body.status).toBe("failed")
      expect(body.diagnostics?.join("\n")).toContain("Invalid browser preview URL: file:///tmp/index.html")
      expect(findLatestBrowserPreviewTarget(taskID)).toBeUndefined()
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "GET /task/:taskID/browser-preview/evidence/:evidenceID returns only persisted task evidence",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const screenshotPath = path.join(tmp.path, "desktop.png")
      await fs.writeFile(screenshotPath, "browser-preview-screenshot")
      const sha = sha16("browser-preview-screenshot")
      const evidenceID = persistBrowserPreviewEvidence({
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
      expect(body.capture?.path).toContain("desktop.png")
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
      const screenshotPath = path.join(tmp.path, "desktop.png")
      const bytes = Buffer.from("browser-preview-png-bytes")
      await fs.writeFile(screenshotPath, bytes)
      const evidenceID = persistBrowserPreviewEvidence({
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
    "GET /task/:taskID/browser-preview/evidence/:evidenceID rejects missing or mismatched screenshot artifacts",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const target = await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
      const missingEvidenceID = persistBrowserPreviewEvidence({
        taskID,
        targetID: target.id,
        viewportID: "desktop",
        status: "passed",
        summary: "all runtime capture layers passed",
        capture: { captured: true, passed: true, path: path.join(tmp.path, "missing.png"), sha: "missing" },
        diagnostics: ["all runtime capture layers passed"],
      })
      const screenshotPath = path.join(tmp.path, "mismatch.png")
      await fs.writeFile(screenshotPath, "actual-screenshot")
      const mismatchEvidenceID = persistBrowserPreviewEvidence({
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
    "POST /task/:taskID/browser-preview/capture does not replace an unknown targetID with the latest target",
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

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        status: string
        captures?: Record<string, unknown>
        evidenceIDs?: Record<string, string>
        target?: { status: string; url?: string; diagnostics?: string[] }
        diagnostics?: string[]
      }
      expect(body.status).toBe("failed")
      expect(body.captures).toEqual({})
      expect(body.evidenceIDs).toEqual({})
      expect(body.target?.status).toBe("failed")
      expect(body.target?.url).toBeUndefined()
      expect(body.target?.diagnostics?.join("\n")).toContain(
        "Browser preview target not found: art_previewtarget_missing",
      )
      expect(body.diagnostics?.join("\n")).toContain("requires a resolved http(s) URL")
    },
    { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS },
  )
})

function sha16(value: string | Uint8Array): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)
}
