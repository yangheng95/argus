import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ProjectTable } from "../../src/project/project.sql"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

describe("Database post-commit effects", () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  test("test reset waits for delayed effect database access before rebuilding sqlite", async () => {
    let effectCompleted = false

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: "project-db-effect-reset",
          name: "DB effect reset",
          worktree: "C:/db-effect-reset",
          sandboxes: [],
          time_created: 1,
          time_updated: 1,
        })
        .run()
      Database.effect(async () => {
        await delay(25)
        Database.use((effectDb) => {
          effectDb.select({ id: ProjectTable.id }).from(ProjectTable).all()
        })
        effectCompleted = true
      })
    })

    await resetDatabase()

    expect(effectCompleted).toBe(true)
    expect(Database.hasOpenConnection()).toBe(false)
    expect(Database.use((db) => db.select({ id: ProjectTable.id }).from(ProjectTable).all())).toEqual([])
  })
})
