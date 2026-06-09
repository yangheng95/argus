import { readFileSync } from "fs"
import { resolve } from "path"
import { describe, expect, test } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { SCHEMA_DDL } from "../../src/storage/ddl"

const REQUIRED_INDEXES = [
  "engine_task_time_updated_idx",
  "engine_task_project_time_updated_idx",
  "protocol_event_task_type_session_status_idx",
  "protocol_event_session_type_status_order_idx",
]

function indexNames(sqlite: Sqlite, table: string): string[] {
  return sqlite
    .query<{ name: string }, []>(`PRAGMA index_list('${table}')`)
    .all()
    .map((row) => row.name)
}

describe("task list query indexes", () => {
  test("bootstrap DDL creates indexes used by task list projections", () => {
    const sqlite = new Sqlite(":memory:")
    try {
      sqlite.exec(SCHEMA_DDL)
      const names = [...indexNames(sqlite, "engine_task"), ...indexNames(sqlite, "protocol_event")]
      for (const name of REQUIRED_INDEXES) {
        expect(names).toContain(name)
      }
    } finally {
      sqlite.close()
    }
  })

  test("Drizzle schemas declare the same task list indexes", () => {
    const engineSource = readFileSync(resolve(import.meta.dir, "../../src/engine/engine.sql.ts"), "utf8")
    const protocolSource = readFileSync(resolve(import.meta.dir, "../../src/protocol/protocol.sql.ts"), "utf8")
    const source = `${engineSource}\n${protocolSource}`
    for (const name of REQUIRED_INDEXES) {
      expect(source).toContain(`"${name}"`)
    }
  })
})
