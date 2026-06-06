import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { extractBrowserPreviewUrlFromText } from "../../src/browser-preview/extract"
import { persistBrowserPreviewTarget } from "../../src/browser-preview/persist"
import { normalizeBrowserPreviewUrl, resolveBrowserPreviewTarget } from "../../src/browser-preview/target"
import { Instance } from "../../src/project/instance"
import { ProtocolStore } from "../../src/protocol/store"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

async function writePackageJson(root: string, value: unknown) {
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify(value, null, 2))
}

describe("browser preview target resolver", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  async function seedTask(directory: string) {
    const taskID = `tsk_browserpreviewtarget${Date.now()}`
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

  test("uses the task artifact target as the only resolved URL source", async () => {
    await using tmp = await tmpdir()
    await writePackageJson(tmp.path, {
      opencorvus: {
        browserPreview: {
          url: "http://127.0.0.1:4173/",
          command: "npm run dev",
        },
      },
    })
    const taskID = await seedTask(tmp.path)
    const persisted = await persistBrowserPreviewTarget({
      taskID,
      url: "http://127.0.0.1:5173/task",
    })

    const target = await resolveBrowserPreviewTarget({
      projectRoot: tmp.path,
      taskID,
    })

    expect(target.id).toBe(persisted.id)
    expect(target.kind).toBe("task-url")
    expect(target.status).toBe("ready")
    expect(target.source).toBe("task-artifact")
    expect(target.url).toBe("http://127.0.0.1:5173/task")
    expect(target.viewports.map((viewport) => viewport.id)).toEqual(["desktop", "tablet", "mobile"])
  })

  test("persisting a preview target emits a task update event for overlay refresh", async () => {
    await using tmp = await tmpdir()
    const taskID = await seedTask(tmp.path)

    await persistBrowserPreviewTarget({
      taskID,
      url: "http://127.0.0.1:5173/task",
    })

    const events = ProtocolStore.listTaskEvents(taskID)
    const event = events.find((item) => item.type === "task.updated" && item.source === "browser-preview.target")
    expect(event?.payload?.summary).toBe("Browser preview target updated")
    expect(event?.payload?.taskID).toBe(taskID)
  })

  test("does not resolve package metadata when the task has no saved target", async () => {
    await using tmp = await tmpdir()
    await writePackageJson(tmp.path, {
      packageManager: "npm@10.9.0",
      scripts: { dev: "vite --host 127.0.0.1" },
      opencorvus: {
        browserPreview: {
          url: "http://localhost:4173/",
          command: "npm run dev",
        },
      },
    })
    const taskID = await seedTask(tmp.path)

    const target = await resolveBrowserPreviewTarget({ projectRoot: tmp.path, taskID })

    expect(target.status).toBe("missing")
    expect(target.kind).toBe("missing")
    expect(target.url).toBeUndefined()
    expect(target.source).toBe("none")
    expect(target.diagnostics.join("\n")).toContain("No browser preview target saved for this task")
  })

  test("does not parse package.json when resolving a missing task target", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, "package.json"), "{")
    const taskID = await seedTask(tmp.path)

    const target = await resolveBrowserPreviewTarget({ projectRoot: tmp.path, taskID })

    expect(target.status).toBe("missing")
    expect(target.kind).toBe("missing")
    expect(target.source).toBe("none")
    expect(target.diagnostics.join("\n")).toContain("No browser preview target saved for this task")
  })

  test("normalizes explicit http(s) URLs and loopback host-port text before saving task targets", () => {
    expect(normalizeBrowserPreviewUrl(" http://127.0.0.1:5173/dashboard ")).toBe("http://127.0.0.1:5173/dashboard")
    expect(normalizeBrowserPreviewUrl("localhost:5173")).toBe("http://localhost:5173/")
    expect(normalizeBrowserPreviewUrl("127.0.0.1:5173/dashboard")).toBe("http://127.0.0.1:5173/dashboard")
    expect(normalizeBrowserPreviewUrl("[::1]:5173")).toBe("http://[::1]:5173/")
    expect(normalizeBrowserPreviewUrl("https://example.test/")).toBe("https://example.test/")
    expect(normalizeBrowserPreviewUrl("file:///tmp/index.html")).toBeUndefined()
    expect(normalizeBrowserPreviewUrl("example.test:5173")).toBeUndefined()
    expect(normalizeBrowserPreviewUrl("")).toBeUndefined()
  })

  test("extracts a loopback preview URL from process output", () => {
    const output = [
      "  VITE v6.0.0 ready in 120 ms",
      "  ➜  Local:   http://localhost:5173/",
      "  docs: https://vite.dev/",
    ].join("\n")

    expect(extractBrowserPreviewUrlFromText(output)).toBe("http://localhost:5173/")
  })

  test("extracts an IPv6 loopback preview URL from process output", () => {
    expect(extractBrowserPreviewUrlFromText("Local: http://[::1]:5173/")).toBe("http://[::1]:5173/")
  })
})
