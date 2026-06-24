import { afterEach, describe, expect, mock, test } from "bun:test"
import * as fs from "node:fs/promises"
import path from "node:path"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { ProjectTable } from "../../src/project/project.sql"
import { selectProjectDirectory } from "../../src/server/directory"
import { Server } from "../../src/server/server"
import { clearServerShutdownHandler } from "../../src/server/shutdown"
import { SessionTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

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
    Server.resetProjectRoutesAppForTest()
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

  test("task record read routes work without ?directory=", async () => {
    const now = Date.now()
    const taskID = Identifier.ascending("task")
    const sessionID = Identifier.ascending("session")
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: "project-task-read-record",
          name: "Task read record project",
          worktree: "C:/missing/task-read-record-project",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(SessionTable)
        .values({
          id: sessionID,
          project_id: "project-task-read-record",
          slug: "task-read-record-session",
          directory: "C:/missing/task-read-record-project",
          title: "Task read record session",
          version: "0.0.1",
          kind: "root",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: "project-task-read-record",
          session_id: sessionID,
          source: "api",
          title: "Task read project task",
          request: "read stale record",
          priority: "normal",
          kind: "workflow",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    const app = Server.App()
    for (const suffix of ["", "/status", "/board", "/progress", "/brief", "/transcript", "/runs", "/interactions", "/bindings"]) {
      const response = await app.request(`/task/${taskID}${suffix}`, { method: "GET" })
      expect(response.status, `GET /task/:taskID${suffix}`).toBe(200)
      await response.text()
    }
  })

  test("task operator model context resolves from task record without ?directory=", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        model: "test/base",
        agent: {
          orchestrator: {
            model: "test/orchestrator",
          },
        },
      },
    })
    const app = Server.App()
    const configResponse = await app.request("/config", {
      headers: { "x-opencorvus-directory": tmp.path },
    })
    expect(configResponse.status).toBe(200)

    const project = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.worktree, tmp.path)).get())
    expect(project).toBeDefined()

    const now = Date.now()
    const taskID = Identifier.ascending("task")
    const sessionID = Identifier.ascending("session")
    Database.use((db) => {
      db.insert(SessionTable)
        .values({
          id: sessionID,
          project_id: project!.id,
          slug: "task-operator-model-context-session",
          directory: tmp.path,
          title: "Task operator model context session",
          version: "0.0.1",
          kind: "root",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: project!.id,
          session_id: sessionID,
          source: "api",
          title: "Task operator model context",
          request: "resolve model context",
          priority: "normal",
          kind: "workflow",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    const response = await app.request(`/task/${taskID}/operator-model-context`, { method: "GET" })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      taskID,
      sessionID,
      agent: "orchestrator",
      model: {
        providerID: "test",
        modelID: "orchestrator",
      },
    })
  })

  test("task event stream connects without ?directory=", async () => {
    const now = Date.now()
    const taskID = Identifier.ascending("task")
    const sessionID = Identifier.ascending("session")
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: "project-task-events-record",
          name: "Task events record project",
          worktree: "C:/missing/task-events-record-project",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(SessionTable)
        .values({
          id: sessionID,
          project_id: "project-task-events-record",
          slug: "task-events-record-session",
          directory: "C:/missing/task-events-record-project",
          title: "Task events record session",
          version: "0.0.1",
          kind: "root",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: "project-task-events-record",
          session_id: sessionID,
          source: "api",
          title: "Task events project task",
          request: "stream stale record",
          priority: "normal",
          kind: "workflow",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    const app = Server.App()
    const response = await app.request(`/task/${taskID}/events`, { method: "GET" })
    expect(response.status).toBe(200)
    const reader = response.body?.getReader()
    expect(reader).toBeDefined()
    const first = await reader!.read()
    const text = new TextDecoder().decode(first.value)
    expect(text).toContain("task.connected")
    await reader!.cancel()
  })

  test("record-level DELETE /task/:taskID works without ?directory=", async () => {
    const now = Date.now()
    const taskID = Identifier.ascending("task")
    const sessionID = Identifier.ascending("session")
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: "project-deleted-record",
          name: "Deleted record project",
          worktree: "C:/missing/deleted-record-project",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(SessionTable)
        .values({
          id: sessionID,
          project_id: "project-deleted-record",
          slug: "deleted-record-session",
          directory: "C:/missing/deleted-record-project",
          title: "Deleted record session",
          version: "0.0.1",
          kind: "root",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: "project-deleted-record",
          session_id: sessionID,
          title: "Deleted project task",
          request: "delete stale record",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
          time_completed: now,
        })
        .run()
    })

    const app = Server.App()
    const response = await app.request(`/task/${taskID}`, { method: "DELETE" })

    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)
    const row = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
    expect(row).toBeUndefined()
    const session = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
    expect(session).toBeUndefined()
  })

  test("record-level DELETE /task/:taskID cancels and removes an active session-backed task without ?directory=", async () => {
    const now = Date.now()
    const taskID = Identifier.ascending("task")
    const sessionID = Identifier.ascending("session")
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: "project-deleted-active-record",
          name: "Deleted active record project",
          worktree: "C:/missing/deleted-active-record-project",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(SessionTable)
        .values({
          id: sessionID,
          project_id: "project-deleted-active-record",
          slug: "deleted-active-record-session",
          directory: "C:/missing/deleted-active-record-project",
          title: "Deleted active record session",
          version: "0.0.1",
          kind: "root",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: "project-deleted-active-record",
          session_id: sessionID,
          title: "Deleted active project task",
          request: "delete active stale record",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    const app = Server.App()
    const response = await app.request(`/task/${taskID}`, { method: "DELETE" })

    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)
    const row = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
    expect(row).toBeUndefined()
    const session = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
    expect(session).toBeUndefined()
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

  test("cold concurrent project routes share one route initialization", async () => {
    await using tmp = await tmpdir({ git: true })
    Server.resetProjectRoutesAppForTest()
    const app = Server.App()

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.request("/config", {
          method: "GET",
          headers: { "x-opencorvus-directory": tmp.path },
        }),
      ),
    )

    expect(responses.map((response) => response.status)).toEqual(Array(8).fill(200))
  })

  test("directory query preserves literal percent-encoded slash sequences", async () => {
    await using root = await tmpdir()
    const literal = path.join(root.path, "literal%2Fname")
    const nested = path.join(root.path, "literal", "name")
    await fs.mkdir(literal, { recursive: true })
    await fs.mkdir(nested, { recursive: true })

    const app = Server.App()
    const response = await app.request(`/path?directory=${encodeURIComponent(literal)}`, { method: "GET" })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { directory: string }
    expect(body.directory).toBe(path.resolve(literal))
    expect(body.directory).not.toBe(path.resolve(nested))
  })

  test("directory header preserves literal percent-encoded slash sequences", async () => {
    await using root = await tmpdir()
    const literal = path.join(root.path, "literal%2Fname")
    const nested = path.join(root.path, "literal", "name")
    await fs.mkdir(literal, { recursive: true })
    await fs.mkdir(nested, { recursive: true })

    const app = Server.App()
    const response = await app.request("/path", {
      method: "GET",
      headers: { "x-opencorvus-directory": literal },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { directory: string }
    expect(body.directory).toBe(path.resolve(literal))
    expect(body.directory).not.toBe(path.resolve(nested))
  })

  test("directory selector preserves literal values for middleware and websocket routes", () => {
    expect(
      selectProjectDirectory({
        queryDirectory: "C:/work/literal%2Fname",
        headerDirectory: "C:/work/nested/name",
      }),
    ).toBe("C:/work/literal%2Fname")
    expect(selectProjectDirectory({ headerDirectory: "C:/work/literal%2Fname" })).toBe("C:/work/literal%2Fname")
    expect(selectProjectDirectory({ queryDirectory: "   ", headerDirectory: "" })).toBeUndefined()
  })

  test("cross-project MySQL transfer routes work without ?directory=", async () => {
    const app = Server.App()

    const schema = await app.request("/global/db/mysql/schema", { method: "GET" })
    expect(schema.status).toBe(200)
    const schemaBody = (await schema.json()) as { format: string; mysqlDDL: string }
    expect(schemaBody.format).toBe("opencorvus.mysql-transfer.v1")
    expect(schemaBody.mysqlDDL).toContain("CREATE TABLE IF NOT EXISTS `project`")

    const exported = await app.request("/global/db/mysql/export", { method: "GET" })
    expect(exported.status).toBe(200)
    const exportedBody = (await exported.json()) as { snapshot: unknown }

    const imported = await app.request("/global/db/mysql/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshot: exportedBody.snapshot }),
    })
    expect(imported.status).toBe(200)
    const importedBody = (await imported.json()) as { ok: boolean; tables: unknown[] }
    expect(importedBody.ok).toBe(true)
    expect(importedBody.tables.length).toBeGreaterThan(0)
  })

  test("cross-project GET /global/tasks works without ?directory=", async () => {
    const now = Date.now()
    const query = `directory-required-global-tasks-${now}`
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
            title: `${query} Alpha task`,
            request: `${query} alpha`,
            time_created: now - 2,
            time_updated: now - 2,
          },
          {
            id: "task-beta",
            project_id: "project-beta",
            title: `${query} Beta task`,
            request: `${query} beta`,
            time_created: now - 1,
            time_updated: now - 1,
          },
        ])
        .run()
    })

    const app = Server.App()
    const response = await app.request(`/global/tasks?q=${encodeURIComponent(query)}`, { method: "GET" })
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

  // The negative assertions above lock the missing-directory failure path;
  // the literal percent tests lock the accepted query/header contract.
})
