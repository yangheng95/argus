import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ProjectTable } from "../../src/project/project.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Server } from "../../src/server/server"
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

describe("global destructive database routes", () => {
  afterEach(async () => {
    mock.restore()
    Server.resetProjectRoutesAppForTest()
    await resetDatabase()
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test("DB reset rejects a relative projectDir before disposal or reset", async () => {
    const disposeAll = spyOn(Instance, "disposeAll")
    const reset = spyOn(Database, "reset")

    const response = await Server.App().request("/global/db/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectDir: "relative-project" }),
    })

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain("absolute")
    expect(disposeAll).not.toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()
  })

  test("DB reset rejects an unknown absolute projectDir before deleting project scratch", async () => {
    const unknownProject = mktemp("opencorvus-db-reset-unknown-project-")
    const sentinelFiles = [
      path.join(ProjectRuntimePaths.projectRuntimeRoot(unknownProject), "runtime.txt"),
      ...ProjectRuntimePaths.legacyRuntimeRelativePaths.map((relative) =>
        path.join(unknownProject, ...relative.split("/"), "legacy.txt"),
      ),
    ]
    for (const file of sentinelFiles) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, "keep")
    }

    const disposeAll = spyOn(Instance, "disposeAll")
    const reset = spyOn(Database, "reset")

    const response = await Server.App().request("/global/db/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectDir: unknownProject }),
    })

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain("registered project directory")
    expect(disposeAll).not.toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()
    for (const file of sentinelFiles) {
      expect(fs.readFileSync(file, "utf8")).toBe("keep")
    }
  })

  test("DB reset accepts a registered project worktree and uses the registered path", async () => {
    const projectDir = mktemp("opencorvus-db-reset-registered-project-")
    insertProject("project-reset-registered", "Reset registered", projectDir)
    const runtimePath = ProjectRuntimePaths.projectRuntimeRoot(projectDir)
    const disposeAll = spyOn(Instance, "disposeAll").mockResolvedValue(undefined)
    const reset = spyOn(Database, "reset").mockResolvedValue([{ label: "runtime", path: runtimePath, ok: true }])

    const response = await Server.App().request("/global/db/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectDir: projectDir + path.sep }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; targets: Array<{ label: string; path: string }> }
    expect(body.ok).toBe(true)
    expect(body.targets.find((target) => target.label === "runtime")?.path).toBe(runtimePath)
    expect(disposeAll).toHaveBeenCalledTimes(1)
    expect(reset).toHaveBeenCalledWith(projectDir)
  })

  test("DB reset accepts a registered sandbox directory and uses that registered path", async () => {
    const projectDir = mktemp("opencorvus-db-reset-sandbox-project-")
    const sandboxDir = mktemp("opencorvus-db-reset-sandbox-")
    insertProject("project-reset-sandbox", "Reset sandbox", projectDir, [sandboxDir])
    const runtimePath = ProjectRuntimePaths.projectRuntimeRoot(sandboxDir)
    const disposeAll = spyOn(Instance, "disposeAll").mockResolvedValue(undefined)
    const reset = spyOn(Database, "reset").mockResolvedValue([{ label: "runtime", path: runtimePath, ok: true }])

    const response = await Server.App().request("/global/db/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectDir: sandboxDir + path.sep }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; targets: Array<{ label: string; path: string }> }
    expect(body.ok).toBe(true)
    expect(body.targets.find((target) => target.label === "runtime")?.path).toBe(runtimePath)
    expect(disposeAll).toHaveBeenCalledTimes(1)
    expect(reset).toHaveBeenCalledWith(sandboxDir)
  })

  test("MySQL import aborts before rebuilding SQLite when disposeAll rejects", async () => {
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
  })
})
