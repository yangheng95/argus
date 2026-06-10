import { afterEach, describe, expect, test } from "bun:test"
import { Database as RawSqlite } from "bun:sqlite"
import { ProjectTable } from "../../src/project/project.sql"
import { MemoryChunkTable, MemoryFileTable } from "../../src/memory/memory.sql"
import { Database, eq } from "../../src/storage/db"
import {
  exportMysqlTransferSnapshot,
  importMysqlTransferSnapshot,
  mysqlSchemaExport,
} from "../../src/storage/mysql-transfer"
import { resetDatabase } from "../fixture/db"

describe("MySQL transfer", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("exports MySQL staging DDL from the current Drizzle schema", () => {
    const schema = mysqlSchemaExport()

    expect(schema.mysqlDDL).toContain("CREATE TABLE IF NOT EXISTS `project`")
    expect(schema.mysqlDDL).toContain("CREATE TABLE IF NOT EXISTS `engine_task`")
    expect(schema.tables.some((table) => table.name === "project")).toBe(true)
    expect(schema.derivedTables).toEqual(["memory_fts"])
    expect(schema.skippedIndexes.some((index) => index.index === "part_message_tool_call_idx")).toBe(true)
  })

  test("rejects snapshots with a stale schema fingerprint before rebuilding", () => {
    const snapshot = exportMysqlTransferSnapshot()
    const stale = { ...snapshot, schemaFingerprint: "stale" }

    expect(() => importMysqlTransferSnapshot(stale)).toThrow("schema fingerprint mismatch")
  })

  test("round-trips ordinary rows and rebuilds derived memory FTS", () => {
    const now = Date.now()
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: "project-transfer",
          name: "Transfer",
          worktree: "D:/transfer",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(MemoryFileTable)
        .values({
          id: "memory-file-transfer",
          project_id: "project-transfer",
          scope: "global",
          title: "Transfer memory",
          source: "user",
          kind: "note",
          importance: 60,
          confidence: 75,
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(MemoryChunkTable)
        .values({
          id: "memory-chunk-transfer",
          file_id: "memory-file-transfer",
          project_id: "project-transfer",
          content: "mysql transfer memory content",
          token_count: 4,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    const snapshot = exportMysqlTransferSnapshot()
    const result = importMysqlTransferSnapshot(snapshot)

    expect(result.ok).toBe(true)
    const project = Database.use((db) =>
      db.select().from(ProjectTable).where(eq(ProjectTable.id, "project-transfer")).get(),
    )
    expect(project?.name).toBe("Transfer")

    const raw = new RawSqlite(Database.Path(), { readonly: true })
    try {
      const fts = raw
        .query<{ count: number }, []>(
          "SELECT count(*) AS count FROM memory_fts WHERE chunk_id = 'memory-chunk-transfer'",
        )
        .get()
      expect(fts?.count).toBe(1)
    } finally {
      raw.close()
    }
  })
})
