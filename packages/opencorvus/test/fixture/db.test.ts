import { afterEach, expect, test } from "bun:test"
import { ProjectTable } from "../../src/project/project.sql"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "./db"

afterEach(async () => {
  await resetDatabase()
})

test("resetDatabase rebuilds the test schema and clears persisted rows", async () => {
  const now = Date.now()
  await resetDatabase()

  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: "project_fixture_reset",
        worktree: "C:/tmp/project_fixture_reset",
        name: "fixture reset",
        time_created: now,
        time_updated: now,
        time_initialized: now,
        sandboxes: [],
      })
      .run(),
  )
  expect(
    Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, "project_fixture_reset")).all()),
  ).toHaveLength(1)

  await resetDatabase()

  expect(
    Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, "project_fixture_reset")).all()),
  ).toHaveLength(0)
})
