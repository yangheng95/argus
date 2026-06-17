import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { ProjectTable } from "../../src/project/project.sql"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Database, eq } from "../../src/storage/db"
import { exportMysqlTransferSnapshot } from "../../src/storage/mysql-transfer"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"

Log.init({ print: false })

function insertProject(id: string, name: string, worktree: string) {
  const now = Date.now()
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id,
        name,
        worktree,
        sandboxes: [],
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
    expect(projectIDs()).toEqual(["project-dispose-survivor"])
  })
})
