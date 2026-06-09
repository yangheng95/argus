import { readFileSync } from "fs"
import { resolve } from "path"
import { describe, expect, test } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { SCHEMA_DDL } from "../../src/storage/ddl"
import { QuickNoteTable } from "../../src/storage/schema"

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

  test("generated DDL includes quick note from the exported Drizzle schema", () => {
    expect(QuickNoteTable).toBeDefined()

    const sqlite = new Sqlite(":memory:")
    try {
      sqlite.exec(SCHEMA_DDL)
      const columns = sqlite
        .query<{ name: string }, []>("PRAGMA table_info('quick_note')")
        .all()
        .map((row) => row.name)
      const indexes = indexNames(sqlite, "quick_note")

      expect(columns).toEqual([
        "id",
        "project_id",
        "content",
        "summary",
        "tags",
        "status",
        "user_id",
        "time_created",
        "time_updated",
      ])
      expect(indexes).toContain("quick_note_project_idx")
      expect(indexes).toContain("quick_note_user_idx")
      expect(indexes).toContain("quick_note_status_idx")
    } finally {
      sqlite.close()
    }
  })

  test("generated DDL preserves Drizzle expression and partial indexes", () => {
    const sqlite = new Sqlite(":memory:")
    try {
      sqlite.exec(SCHEMA_DDL)
      const row = sqlite
        .query<
          { sql: string },
          []
        >("SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = 'part_message_tool_call_idx'")
        .get()

      expect(row?.sql).toContain(`json_extract("data", '$.callID')`)
      expect(row?.sql).toContain(`WHERE json_extract("data", '$.type') = 'tool'`)
    } finally {
      sqlite.close()
    }
  })

  test("generated DDL cleans duplicate channel bindings before creating the unique index", () => {
    const sqlite = new Sqlite(":memory:")
    try {
      sqlite.exec(`
        CREATE TABLE engine_channel_binding (
          id text PRIMARY KEY,
          task_id text NOT NULL,
          platform text NOT NULL,
          channel text NOT NULL,
          thread text NOT NULL,
          payload text,
          time_created integer NOT NULL,
          time_updated integer NOT NULL
        );
        INSERT INTO engine_channel_binding (
          id, task_id, platform, channel, thread, payload, time_created, time_updated
        ) VALUES
          ('first', 'task-1', 'slack', 'chan', 'thread', NULL, 1, 1),
          ('second', 'task-2', 'slack', 'chan', 'thread', NULL, 2, 2);
      `)

      sqlite.exec(SCHEMA_DDL)

      const count = sqlite.query<{ count: number }, []>("SELECT count(*) AS count FROM engine_channel_binding").get()
      const indexes = indexNames(sqlite, "engine_channel_binding")

      expect(count?.count).toBe(1)
      expect(indexes).toContain("engine_channel_binding_thread_idx")
    } finally {
      sqlite.close()
    }
  })
})
