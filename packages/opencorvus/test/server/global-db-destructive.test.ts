import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { ProjectTable } from "../../src/project/project.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Server } from "../../src/server/server"
import { clearServerShutdownHandler, registerServerShutdownHandler } from "../../src/server/shutdown"
import { Database, eq } from "../../src/storage/db"
import { exportMysqlTransferSnapshot } from "../../src/storage/mysql-transfer"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"

Log.init({ print: false })

const tempDirs: string[] = []

function mktemp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function insertProject(id: string, name: string, worktree: string, sandboxes: string[] = []) {
  const now = Date.now()
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id,
        name,
        worktree,
        sandboxes,
        time_created: now,
        time_updated: now,
      })
      .run()
  })
}

function projectIDs() {
  return Database.use((db) => db.select({ id: ProjectTable.id }).from(ProjectTable).all()).map((row) => row.id)
}

function insertActiveRun(input: { projectID: string; projectName: string; worktree: string }) {
  const taskID = Identifier.ascending("task")
  const runID = Identifier.ascending("run")
  const now = Date.now()
  insertProject(input.projectID, input.projectName, input.worktree)
  Database.use((db) => {
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: input.projectID,
        source: "test",
        title: "Active destructive-route guard task",
        request: "keep destructive database routes blocked while this run is active",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: runID,
        task_id: taskID,
        run_id: runID,
        kind: "run",
        label: "active-run",
        payload: {
          executor: "opencorvus",
          status: "running",
          phase: "execute",
          time_started: now,
          time_completed: null,
        },
        time_created: now + 1,
        time_updated: now + 1,
      })
      .run()
  })
}

async function expectActiveSessionConflict(response: Response, operation: string) {
  expect(response.status).toBe(409)
  const body = (await response.json()) as { name?: string; data?: { operation?: string; message?: string } }
  expect(body.name).toBe("ActiveExecutorSessionsError")
  expect(body.data?.operation).toBe(operation)
  expect(body.data?.message).toContain("Active executor sessions exist")
  Database.close()
}

function installRestartHarness() {
  const reasons: string[] = []
  let resolveShutdown!: (reason: string) => void
  const shutdown = new Promise<string>((resolve) => {
    resolveShutdown = resolve
  })
  registerServerShutdownHandler((reason) => {
    reasons.push(reason)
    resolveShutdown(reason)
  })
  const unref = mock(() => undefined)
  const spawn = spyOn(Bun, "spawn").mockReturnValue({ unref } as any)
  return { reasons, shutdown, spawn, unref }
}

describe("global destructive database routes", () => {
  afterEach(async () => {
    mock.restore()
    clearServerShutdownHandler()
    Server.resetProjectRoutesAppForTest()
    await resetDatabase()
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test.serial("DB reset rejects projectDir input before disposal or file deletion", async () => {
    const unknownProject = mktemp("opencorvus-db-reset-unknown-project-")
    const dbPath = Database.Path()
    const runtimePath = ProjectRuntimePaths.projectRuntimeRoot(unknownProject)
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    fs.writeFileSync(dbPath, "db")
    fs.mkdirSync(runtimePath, { recursive: true })
    fs.writeFileSync(path.join(runtimePath, "runtime.txt"), "keep")

    const disposeAll = spyOn(Instance, "disposeAll")
    const resetFiles = spyOn(Database, "resetFiles")

    const response = await Server.App().request("/global/db/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectDir: unknownProject }),
    })

    expect(response.status).toBe(400)
    expect(disposeAll).not.toHaveBeenCalled()
    expect(resetFiles).not.toHaveBeenCalled()
    expect(fs.readFileSync(dbPath, "utf8")).toBe("db")
    expect(fs.readFileSync(path.join(runtimePath, "runtime.txt"), "utf8")).toBe("keep")
  })

  test.serial("DB reset rejects a mismatched database target before disposal or file deletion", async () => {
    const dbPath = Database.Path()
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    fs.writeFileSync(dbPath, "db")

    const disposeAll = spyOn(Instance, "disposeAll")
    const resetFiles = spyOn(Database, "resetFiles")
    installRestartHarness()

    const response = await Server.App().request("/global/db/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ database: path.join(path.dirname(dbPath), "other.db") }),
    })

    expect(response.status).toBe(400)
    expect(disposeAll).not.toHaveBeenCalled()
    expect(resetFiles).not.toHaveBeenCalled()
    expect(fs.readFileSync(dbPath, "utf8")).toBe("db")
  })

  test.serial("DB reset rejects missing restart handler before disposal or file deletion", async () => {
    const dbPath = Database.Path()
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    fs.writeFileSync(dbPath, "db")

    const disposeAll = spyOn(Instance, "disposeAll")
    const resetFiles = spyOn(Database, "resetFiles")

    const response = await Server.App().request("/global/db/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ database: dbPath }),
    })

    expect(response.status).toBe(503)
    expect(disposeAll).not.toHaveBeenCalled()
    expect(resetFiles).not.toHaveBeenCalled()
    expect(fs.readFileSync(dbPath, "utf8")).toBe("db")
  })

  test.serial("DB reset current request deletes only current database files and restarts", async () => {
    const projectDir = mktemp("opencorvus-db-reset-project-sentinel-")
    const dbPath = Database.Path()
    const runtimePath = ProjectRuntimePaths.projectRuntimeRoot(projectDir)
    const legacyRuntimePath = path.join(projectDir, ".opencorvus", "runtime")
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    fs.writeFileSync(dbPath, "db")
    fs.writeFileSync(`${dbPath}-wal`, "wal")
    fs.writeFileSync(`${dbPath}-shm`, "shm")
    fs.mkdirSync(runtimePath, { recursive: true })
    fs.writeFileSync(path.join(runtimePath, "runtime.txt"), "runtime")
    fs.mkdirSync(legacyRuntimePath, { recursive: true })
    fs.writeFileSync(path.join(legacyRuntimePath, "legacy.txt"), "legacy")

    const reset = spyOn(Database, "reset")
    spyOn(Instance, "disposeAll").mockResolvedValue(undefined)
    const restart = installRestartHarness()

    const response = await Server.App().request("/global/db/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ database: dbPath }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      ok: boolean
      restarting: boolean
      targets: Array<{ label: string; path: string }>
    }
    expect(body.ok).toBe(true)
    expect(body.restarting).toBe(true)
    expect(body.targets.map((target) => target.path)).toEqual([dbPath, `${dbPath}-wal`, `${dbPath}-shm`])
    expect(reset).not.toHaveBeenCalled()
    expect(restart.spawn).toHaveBeenCalledTimes(1)
    expect(restart.unref).toHaveBeenCalledTimes(1)
    await expect(restart.shutdown).resolves.toBe("server.restart")
    expect(restart.reasons).toEqual(["server.restart"])
    expect(fs.existsSync(dbPath)).toBe(false)
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false)
    expect(fs.existsSync(`${dbPath}-shm`)).toBe(false)
    expect(fs.readFileSync(path.join(runtimePath, "runtime.txt"), "utf8")).toBe("runtime")
    expect(fs.readFileSync(path.join(legacyRuntimePath, "legacy.txt"), "utf8")).toBe("legacy")
  })

  test.serial("DB reset deletes stale-schema database file without opening the project registry", async () => {
    const dbPath = Database.Path()
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    const stale = new BunDatabase(dbPath, { create: true })
    stale.exec(`
      CREATE TABLE engine_artifact (
        id           text PRIMARY KEY,
        task_id      text NOT NULL,
        run_id       text,
        goal_run_id  text,
        kind         text NOT NULL,
        label        text NOT NULL,
        payload      text,
        time_created integer NOT NULL,
        time_updated integer NOT NULL
      );
      INSERT INTO engine_artifact (
        id, task_id, run_id, goal_run_id, kind, label, payload, time_created, time_updated
      ) VALUES (
        'stale-artifact', 'task-1', NULL, NULL, 'acceptance', 'stale', '{}', 1, 1
      );
    `)
    stale.close()
    Bun.gc(true)
    await Bun.sleep(100)
    fs.writeFileSync(`${dbPath}-wal`, "wal")
    fs.writeFileSync(`${dbPath}-shm`, "shm")
    spyOn(Instance, "disposeAll").mockResolvedValue(undefined)
    const restart = installRestartHarness()

    const response = await Server.App().request("/global/db/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ database: dbPath }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      ok: boolean
      restarting: boolean
      targets: Array<{ label: string; path: string }>
    }
    expect(body.ok).toBe(true)
    expect(body.restarting).toBe(true)
    expect(body.targets.map((target) => target.path)).toEqual([dbPath, `${dbPath}-wal`, `${dbPath}-shm`])
    expect(restart.spawn).toHaveBeenCalledTimes(1)
    await expect(restart.shutdown).resolves.toBe("server.restart")
    expect(fs.existsSync(dbPath)).toBe(false)
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false)
    expect(fs.existsSync(`${dbPath}-shm`)).toBe(false)
  })

  test.serial("global dispose rejects active executor sessions across any project", async () => {
    insertActiveRun({
      projectID: "project-active-global-dispose",
      projectName: "Active global dispose",
      worktree: mktemp("opencorvus-active-global-dispose-"),
    })
    const disposeAll = spyOn(Instance, "disposeAll").mockResolvedValue(undefined)

    const response = await Server.App().request("/global/dispose", { method: "POST" })

    await expectActiveSessionConflict(response, "global.dispose")
    expect(disposeAll).not.toHaveBeenCalled()
  })

  test.serial("DB reset rejects active executor sessions across any project before disposal or file deletion", async () => {
    insertActiveRun({
      projectID: "project-active-db-reset",
      projectName: "Active DB reset",
      worktree: mktemp("opencorvus-active-db-reset-"),
    })
    const dbPath = Database.Path()
    const disposeAll = spyOn(Instance, "disposeAll").mockResolvedValue(undefined)
    const resetFiles = spyOn(Database, "resetFiles").mockResolvedValue([{ label: "database", path: dbPath, ok: true }])
    installRestartHarness()

    const response = await Server.App().request("/global/db/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ database: dbPath }),
    })

    await expectActiveSessionConflict(response, "global.db.reset")
    expect(disposeAll).not.toHaveBeenCalled()
    expect(resetFiles).not.toHaveBeenCalled()
  })

  test.serial("MySQL import rejects active executor sessions across any project before rebuilding SQLite", async () => {
    insertProject("project-import-active-source", "Import active source", "C:/opencorvus/import-active-source")
    const snapshot = exportMysqlTransferSnapshot()
    insertActiveRun({
      projectID: "project-active-mysql-import",
      projectName: "Active MySQL import",
      worktree: mktemp("opencorvus-active-mysql-import-"),
    })
    const disposeAll = spyOn(Instance, "disposeAll").mockResolvedValue(undefined)

    const response = await Server.App().request("/global/db/mysql/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshot }),
    })

    await expectActiveSessionConflict(response, "global.db.mysql.import")
    expect(disposeAll).not.toHaveBeenCalled()
    expect(projectIDs()).toContain("project-active-mysql-import")
    Database.close()
  })

  test.serial("MySQL import aborts before rebuilding SQLite when disposeAll rejects", async () => {
    insertProject("project-import-source", "Import source", "C:/opencorvus/import-source")
    const snapshot = exportMysqlTransferSnapshot()

    Database.use((db) => {
      db.delete(ProjectTable).where(eq(ProjectTable.id, "project-import-source")).run()
    })
    insertProject("project-dispose-survivor", "Dispose survivor", "C:/opencorvus/dispose-survivor")

    spyOn(Instance, "disposeAll").mockRejectedValue(new Error("dispose failed"))

    const response = await Server.App().request("/global/db/mysql/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshot }),
    })

    expect(response.status).toBe(500)
    expect(projectIDs()).toContain("project-dispose-survivor")
    expect(projectIDs()).not.toContain("project-import-source")
    await response.text()
    Database.close()
  })
})
