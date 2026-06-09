import { afterEach, describe, expect, mock, test } from "bun:test"
import { and, eq } from "drizzle-orm"
import fs from "node:fs/promises"
import path from "node:path"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { persistBrowserPreviewEvidence, persistBrowserPreviewTarget } from "../../src/browser-preview/persist"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const ROUTE_TEST_TIMEOUT_MILLISECONDS = 20_000

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
        return new Response("<!doctype html><title>Preview</title>", {
          headers: { "content-type": "text/html" },
        })
      },
    })
  }

  test("GET /task/:taskID/browser-preview is task scoped and reads only saved targets", async () => {
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
      const liveUrl = `http://127.0.0.1:${preview.port}/task`

      const dead = await app.request(`/task/${taskID}/browser-preview/target`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-opencorvus-directory": tmp.path,
        },
        body: JSON.stringify({ url: "http://127.0.0.1:9/dead" }),
      })
      expect(dead.status).toBe(200)

      const save = await app.request(`/task/${taskID}/browser-preview/target`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-opencorvus-directory": tmp.path,
        },
        body: JSON.stringify({ url: liveUrl }),
      })
      expect(save.status).toBe(200)

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
      ])

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
  }, { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS })

  test("GET /task/:taskID/browser-preview does not use package metadata as a target source", async () => {
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
  }, { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS })

  test("PUT /task/:taskID/browser-preview/target accepts loopback host-port input", async () => {
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
    const body = (await response.json()) as { status: string; url?: string; source: string }
    expect(body.status).toBe("ready")
    expect(body.url).toBe("http://localhost:5173/")
    expect(body.source).toBe("task-artifact")
  }, { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS })

  test("GET /task/:taskID/browser-preview/evidence/:evidenceID returns only persisted task evidence", async () => {
    await using tmp = await tmpdir()
    const taskID = await seedTask(tmp.path)
    const target = await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:5174/task" })
    const evidenceID = persistBrowserPreviewEvidence({
      taskID,
      targetID: target.id,
      viewportID: "desktop",
      status: "passed",
      summary: "all runtime capture layers passed",
      capture: { captured: true, passed: true, path: "D:/workspace/app/.opencorvus/browser-preview/desktop.png" },
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
      capture?: { path?: string }
      diagnostics?: string[]
    }
    expect(body.id).toBe(evidenceID)
    expect(body.taskID).toBe(taskID)
    expect(body.targetID).toBe(target.id)
    expect(body.viewportID).toBe("desktop")
    expect(body.status).toBe("passed")
    expect(body.capture?.path).toContain("desktop.png")
    expect(body.diagnostics).toEqual(["all runtime capture layers passed"])

    const missing = await app.request(`/task/${taskID}/browser-preview/evidence/art_missing`, {
      headers: {
        "x-opencorvus-directory": tmp.path,
      },
    })
    expect(missing.status).toBe(404)
  }, { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS })

  test("old project-scoped browser preview target route is removed", async () => {
    await using tmp = await tmpdir()
    await seedTask(tmp.path)
    const app = Server.App()

    const response = await app.request("/browser-preview/target", {
      headers: {
        "x-opencorvus-directory": tmp.path,
      },
    })

    expect(response.status).toBe(404)
  }, { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS })

  test("GET /task/:taskID/browser-preview requires directory context", async () => {
    const app = Server.App()
    const response = await app.request("/task/tsk_browserpreviewroute000001/browser-preview")

    expect(response.status).toBe(400)
    const body = (await response.json()) as { name?: string }
    expect(body.name).toBe("DirectoryRequiredError")
  })

  test("POST /task/:taskID/browser-preview/capture requires an explicit targetID", async () => {
    await using tmp = await tmpdir()
    const taskID = await seedTask(tmp.path)
    const app = Server.App()

    const response = await app.request(`/task/${taskID}/browser-preview/capture`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify({ viewportID: "mobile" }),
    })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(JSON.stringify(body)).toContain("targetID")
  }, { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS })

  test("POST /task/:taskID/browser-preview/capture does not replace an unknown targetID with the latest target", async () => {
    await using tmp = await tmpdir()
    const taskID = await seedTask(tmp.path)
    const app = Server.App()
    const save = await app.request(`/task/${taskID}/browser-preview/target`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify({ url: "http://127.0.0.1:5174/task" }),
    })
    expect(save.status).toBe(200)

    const response = await app.request(`/task/${taskID}/browser-preview/capture`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify({ targetID: "art_previewtarget_missing", viewportID: "desktop" }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      status: string
      capture?: unknown
      target?: { status: string; url?: string; diagnostics?: string[] }
      diagnostics?: string[]
    }
    expect(body.status).toBe("failed")
    expect(body.capture).toBeUndefined()
    expect(body.target?.status).toBe("failed")
    expect(body.target?.url).toBeUndefined()
    expect(body.target?.diagnostics?.join("\n")).toContain(
      "Browser preview target not found: art_previewtarget_missing",
    )
    expect(body.diagnostics?.join("\n")).toContain("requires a resolved http(s) URL")
  }, { timeout: ROUTE_TEST_TIMEOUT_MILLISECONDS })
})
