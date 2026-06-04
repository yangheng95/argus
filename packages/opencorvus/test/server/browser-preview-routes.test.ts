import { afterEach, describe, expect, mock, test } from "bun:test"
import { eq } from "drizzle-orm"
import fs from "node:fs/promises"
import path from "node:path"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

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
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            title: "Preview task",
            request: "Preview task",
            source: "api",
            time_created: Date.now(),
            time_updated: Date.now(),
          }).run(),
        )
      },
    })
    return taskID
  }

  test("GET /task/:taskID/browser-preview is task scoped and reads only saved targets", async () => {
    await using tmp = await tmpdir()
    const taskID = await seedTask(tmp.path)
    await fs.writeFile(
      path.join(tmp.path, "package.json"),
      JSON.stringify({
        packageManager: "npm@10.9.0",
        opencorvus: { browserPreview: { url: "http://127.0.0.1:5173/" } },
      }),
    )
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

    const response = await app.request(`/task/${taskID}/browser-preview`, {
      headers: {
        "x-opencorvus-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { status: string; url?: string; source: string; viewports?: { id: string }[] }
    expect(body.status).toBe("ready")
    expect(body.url).toBe("http://127.0.0.1:5174/task")
    expect(body.source).toBe("task-artifact")
    expect(body.viewports?.map((viewport) => viewport.id)).toEqual(["desktop", "tablet", "mobile"])

    const artifact = Database.use((db) =>
      db.select().from(EngineArtifactTable)
        .where(eq(EngineArtifactTable.kind, "browser_preview_target"))
        .limit(1)
        .get(),
    )
    expect(artifact?.task_id).toBe(taskID)
  })

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
    const body = await response.json() as { status: string; url?: string; source: string; diagnostics?: string[] }
    expect(body.status).toBe("missing")
    expect(body.url).toBeUndefined()
    expect(body.source).toBe("none")
    expect(body.diagnostics?.join("\n")).toContain("No browser preview target saved for this task")
  })

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
  })

  test("GET /task/:taskID/browser-preview requires directory context", async () => {
    const app = Server.App()
    const response = await app.request("/task/tsk_browserpreviewroute000001/browser-preview")

    expect(response.status).toBe(400)
    const body = await response.json() as { name?: string }
    expect(body.name).toBe("DirectoryRequiredError")
  })

  test("POST /task/:taskID/browser-preview/capture surfaces missing target without launching capture", async () => {
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

    expect(response.status).toBe(200)
    const body = await response.json() as {
      status: string
      viewport?: { id: string }
      capture?: unknown
      target?: { status: string }
      diagnostics?: string[]
    }
    expect(body.status).toBe("failed")
    expect(body.viewport?.id).toBe("mobile")
    expect(body.capture).toBeUndefined()
    expect(body.target?.status).toBe("missing")
    expect(body.diagnostics?.join("\n")).toContain("requires a resolved http(s) URL")
  })

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
    const body = await response.json() as {
      status: string
      capture?: unknown
      target?: { status: string; url?: string; diagnostics?: string[] }
      diagnostics?: string[]
    }
    expect(body.status).toBe("failed")
    expect(body.capture).toBeUndefined()
    expect(body.target?.status).toBe("failed")
    expect(body.target?.url).toBeUndefined()
    expect(body.target?.diagnostics?.join("\n")).toContain("Browser preview target not found: art_previewtarget_missing")
    expect(body.diagnostics?.join("\n")).toContain("requires a resolved http(s) URL")
  })
})
