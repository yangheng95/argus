import { Database as BunDatabase } from "bun:sqlite"
import { drizzle, type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { Context } from "../util/context"
import { lazy } from "../util/lazy"
import { Global } from "../global"
import { Log } from "../util/log"
import { NamedError } from "@opencorvus-ai/util/error"
import z from "zod"
import path from "path"
import * as schema from "./schema"
import { SCHEMA_DDL } from "./ddl"

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

function columnNames(sqlite: BunDatabase, table: string) {
  return sqlite
    .query(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>
}

function ensureColumn(sqlite: BunDatabase, table: string, name: string, definition: string) {
  if (columnNames(sqlite, table).some((item) => item.name === name)) return
  sqlite.run(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
}

function applySchemaPatches(sqlite: BunDatabase) {
  ensureColumn(sqlite, "control_message", "scope", "scope text NOT NULL DEFAULT 'global'")
  ensureColumn(sqlite, "control_message", "scope_id", "scope_id text NOT NULL DEFAULT 'panel'")
  ensureColumn(sqlite, "memory_file", "session_id", "session_id text")
  ensureColumn(sqlite, "memory_file", "scope", "scope text NOT NULL DEFAULT 'global'")
  ensureColumn(sqlite, "memory_file", "kind", "kind text NOT NULL DEFAULT 'note'")
  ensureColumn(sqlite, "memory_file", "key", "key text")
  ensureColumn(sqlite, "memory_file", "importance", "importance integer NOT NULL DEFAULT 60")
  ensureColumn(sqlite, "memory_file", "confidence", "confidence integer NOT NULL DEFAULT 75")
  ensureColumn(sqlite, "workbench_preference", "session_id", "session_id text")
  ensureColumn(sqlite, "orchestrator_task", "active_spec_version_id", "active_spec_version_id text")
  sqlite.run("CREATE INDEX IF NOT EXISTS control_message_scope_idx ON control_message (scope, scope_id)")
  sqlite.run("CREATE INDEX IF NOT EXISTS memory_file_session_idx ON memory_file (session_id)")
  sqlite.run("CREATE INDEX IF NOT EXISTS memory_file_scope_idx ON memory_file (scope)")
  sqlite.run("CREATE INDEX IF NOT EXISTS memory_file_kind_idx ON memory_file (kind)")
  sqlite.run("CREATE INDEX IF NOT EXISTS memory_file_key_idx ON memory_file (key)")
  sqlite.run("CREATE INDEX IF NOT EXISTS workbench_preference_session_idx ON workbench_preference (session_id)")
  sqlite.run("CREATE INDEX IF NOT EXISTS workbench_preference_scope_idx ON workbench_preference (scope)")
}

export namespace Database {
  export const Path = path.join(Global.Path.data, "opencorvus.db")
  type Schema = typeof schema
  export type Transaction = SQLiteTransaction<"sync", void, Schema>

  type Client = SQLiteBunDatabase<Schema>

  const state = {
    sqlite: undefined as BunDatabase | undefined,
  }

  export const Client = lazy(() => {
    log.info("opening database", { path: path.join(Global.Path.data, "opencorvus.db") })

    const sqlite = new BunDatabase(path.join(Global.Path.data, "opencorvus.db"), { create: true })
    state.sqlite = sqlite

    sqlite.run("PRAGMA journal_mode = WAL")
    sqlite.run("PRAGMA synchronous = NORMAL")
    sqlite.run("PRAGMA busy_timeout = 5000")
    sqlite.run("PRAGMA cache_size = -64000")
    sqlite.run("PRAGMA foreign_keys = ON")
    sqlite.run("PRAGMA wal_checkpoint(PASSIVE)")

    // Create all tables (IF NOT EXISTS — idempotent)
    sqlite.exec(SCHEMA_DDL)
    applySchemaPatches(sqlite)
    log.info("schema applied")

    const db = drizzle({ client: sqlite, schema })

    return db
  })

  export function close() {
    const sqlite = state.sqlite
    if (!sqlite) return
    sqlite.close()
    state.sqlite = undefined
    Client.reset()
  }

  export type TxOrDb = Transaction | Client

  const ctx = Context.create<{
    tx: TxOrDb
    effects: (() => void | Promise<void>)[]
  }>("database")

  const effectLog = Log.create({ service: "db-effect" })

  /** Execute post-commit effects, catching and logging any failures. */
  function drainEffects(effects: (() => void | Promise<void>)[]) {
    for (const fn of effects) {
      try {
        const result = fn()
        // If the effect returns a Promise (e.g. Bus.publish), attach a catch
        // so unhandled rejections don't crash the process and failures are logged.
        if (result && typeof (result as any).then === "function") {
          ;(result as Promise<unknown>).catch((err) => {
            effectLog.warn("post-commit effect failed", { error: err instanceof Error ? err.message : String(err) })
          })
        }
      } catch (err) {
        effectLog.warn("post-commit effect threw synchronously", { error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  export function use<T>(callback: (trx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
        drainEffects(effects)
        return result
      }
      throw err
    }
  }

  export function effect(fn: () => any | Promise<any>) {
    try {
      ctx.use().effects.push(fn)
    } catch {
      try {
        const result = fn()
        if (result && typeof (result as any).then === "function") {
          ;(result as Promise<unknown>).catch((err) => {
            effectLog.warn("immediate effect failed", { error: err instanceof Error ? err.message : String(err) })
          })
        }
      } catch (err) {
        effectLog.warn("immediate effect threw", { error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  export function transaction<T>(callback: (tx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = Client().transaction((tx) => {
          return ctx.provide({ tx, effects }, () => callback(tx))
        })
        drainEffects(effects)
        return result
      }
      throw err
    }
  }
}
