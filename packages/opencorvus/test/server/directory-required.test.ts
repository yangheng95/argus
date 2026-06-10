import { afterEach, describe, expect, mock, test } from "bun:test"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { ProjectTable } from "../../src/project/project.sql"
import { Server } from "../../src/server/server"
import { clearServerShutdownHandler } from "../../src/server/shutdown"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"

Log.init({ print: false })

/**
 * 2026-04-30 darwin cascade audit (W2-V31). Pre-fix the project-scope
 * middleware fell back to `process.cwd()` when no `?directory=` was
 * supplied — on macOS .app launched from Finder cwd is `/`, which made
 * `Project.initGit("/")` permission-deny on every project-scoped request
 * and 500-stormed the entire overlay (rule 7: no fallback).
 *
 * Fix: throw `DirectoryRequiredError` (NamedError → 400) when the
 * directory query/header is absent on a project-scoped route.
 *
 * Control-plane routes (/log, /log/*, /shutdown, /restart) and the cross-project
 * mounts (/global/*, /auth/*) must continue to work without ?directory=.
 */
describe("project-scope middleware: directory required", () => {
  afterEach(async () => {
    mock.restore()
    clearServerShutdownHandler()
    await resetDatabase()
  })

  test("project-scoped GET /tasks without ?directory= returns 400 + DirectoryRequiredError", async () => {
    const app = Server.App()
    const response = await app.request("/tasks", { method: "GET" })

    expect(response.status).toBe(400)
    const body = (await response.json()) as { name: string; data: { message: string } }
    expect(body.name).toBe("DirectoryRequiredError")
    expect(body.data.message).toContain("/tasks")
    expect(body.data.message).toContain("?directory=")
  })

  test("control-plane POST /shutdown still works without ?directory=", async () => {
    const app = Server.App()
    // No registered shutdown handler → 503 (per app-routes.test.ts), but
    // crucially NOT 400 from the directory-required middleware: the
    // control-plane bypass at server.ts must short-circuit before the
    // directory check runs.
    const response = await app.request("/shutdown", { method: "POST" })
    expect(response.status).toBe(503)
    const body = (await response.json()) as { ok: boolean }
    expect(body.ok).toBe(false)
  })

  test("control-plane log read routes work without ?directory=", async () => {
    const app = Server.App()

    const read = await app.request("/log", { method: "GET" })
    expect(read.status).toBe(200)
    const readBody = (await read.json()) as { directory: string; lines: string[] }
    expect(readBody.directory).toBe(Log.directory())
    expect(Array.isArray(readBody.lines)).toBe(true)

    const files = await app.request("/log/files", { method: "GET" })
    expect(files.status).toBe(200)
    const filesBody = (await files.json()) as { directory: string; files: unknown[] }
    expect(filesBody.directory).toBe(Log.directory())
    expect(Array.isArray(filesBody.files)).toBe(true)
  })

  test("cross-project GET /global/health works without ?directory=", async () => {
    const app = Server.App()
    const response = await app.request("/global/health", { method: "GET" })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { healthy: boolean }
    expect(body.healthy).toBe(true)
  })

  test("cross-project GET /global/tasks works without ?directory=", async () => {
    const now = Date.now()
    Database.use((db) => {
      db.insert(ProjectTable)
        .values([
          {
            id: "project-alpha",
            name: "Alpha",
            worktree: "C:/work/alpha",
            sandboxes: [],
            time_created: now,
            time_updated: now,
          },
          {
            id: "project-beta",
            name: "Beta",
            worktree: "C:/work/beta",
            sandboxes: [],
            time_created: now,
            time_updated: now,
          },
        ])
        .run()
      db.insert(EngineTaskTable)
        .values([
          {
            id: "task-alpha",
            project_id: "project-alpha",
            title: "Alpha task",
            request: "alpha",
            time_created: now - 2,
            time_updated: now - 2,
          },
          {
            id: "task-beta",
            project_id: "project-beta",
            title: "Beta task",
            request: "beta",
            time_created: now - 1,
            time_updated: now - 1,
          },
        ])
        .run()
    })

    const app = Server.App()
    const response = await app.request("/global/tasks", { method: "GET" })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { tasks: Array<{ task: { directory?: string } }> }
    expect(Array.isArray(body.tasks)).toBe(true)
    expect(body.tasks.map((item) => item.task.directory).sort()).toEqual(["C:/work/alpha", "C:/work/beta"])
  })

  test("cross-project GET /global/tasks uses a compound cursor for equal updated timestamps", async () => {
    const now = Date.now()
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: "project-pagination",
          name: "Pagination",
          worktree: "C:/work/pagination",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values(
          ["page-a", "page-b", "page-c"].map((id) => ({
            id,
            project_id: "project-pagination",
            title: `Compound cursor ${id}`,
            request: id,
            time_created: now,
            time_updated: now,
          })),
        )
        .run()
    })

    const app = Server.App()
    const first = await app.request("/global/tasks?limit=2&q=Compound%20cursor", { method: "GET" })
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as { tasks: Array<{ task: { id: string; time: { updated: number } } }> }
    expect(firstBody.tasks.map((item) => item.task.id)).toEqual(["page-c", "page-b"])

    const cursor = firstBody.tasks.at(-1)!.task
    const next = await app.request(
      `/global/tasks?limit=2&q=Compound%20cursor&cursor=${cursor.time.updated}&cursorTaskID=${cursor.id}`,
      {
        method: "GET",
      },
    )
    expect(next.status).toBe(200)
    const nextBody = (await next.json()) as { tasks: Array<{ task: { id: string } }> }
    expect(nextBody.tasks.map((item) => item.task.id)).toEqual(["page-a"])
  })

  test("cross-project GET /global/tasks rejects incomplete compound cursor query", async () => {
    const app = Server.App()
    const response = await app.request("/global/tasks?cursor=100", { method: "GET" })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
  })

  test("cross-project DELETE /auth/:providerID works without ?directory=", async () => {
    const app = Server.App()
    const response = await app.request("/auth/test-provider", { method: "DELETE" })
    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)
  })

  test("cross-project PUT /auth/:providerID works without ?directory=", async () => {
    const app = Server.App()
    const response = await app.request("/auth/test-provider", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "api", key: "test-key" }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)
  })

  // The assertion that the header (or query) directory is accepted by
  // the middleware is covered by full-engine integration tests; we
  // intentionally do NOT exercise that branch here because it would
  // require booting the project DB / git plumbing in a unit-test
  // budget. The negative assertions above (no directory → 400) and
  // the bypass tests (control-plane, cross-project) are sufficient
  // to lock the directory-gate contract.
})
