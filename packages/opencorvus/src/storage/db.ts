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
import { mkdirSync } from "fs"
import { rm } from "fs/promises"
import * as schema from "./schema"
import { SCHEMA_DDL } from "./ddl"
import { ProjectRuntimePaths } from "@/project/runtime-paths"

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

function ensureSchemaCompatibility(sqlite: BunDatabase) {
  const engineTaskColumns = sqlite.query<{ name: string }, []>("PRAGMA table_info(engine_task)").all()
  if (engineTaskColumns.length > 0 && !engineTaskColumns.some((column) => column.name === "queue_order")) {
    sqlite.run("ALTER TABLE engine_task ADD COLUMN queue_order integer NOT NULL DEFAULT 0")
  }
}


export namespace Database {
  // SQLite state is global and single-source: `<Global.Path.data>/opencorvus.db`.
  // Project-scoped routing (`Instance.directory`) selects which project rows
  // a request operates on; it does NOT select a different SQLite file.
  //
  // Path() stays a function — not a const — so OPENCORVUS_HOME resolves
  // lazily on first DB open, after benchmarks / portable launchers have set
  // their env.
  export function Path() {
    return path.join(Global.Path.data, "opencorvus.db")
  }
  type Schema = typeof schema
  export type Transaction = SQLiteTransaction<"sync", void, Schema>

  type Client = SQLiteBunDatabase<Schema>

  const state = {
    sqlite: undefined as BunDatabase | undefined,
  }

  export const Client = lazy(() => {
    const dbPath = Path()
    log.info("opening database", { path: dbPath })
    // Ensure data dir exists — benchmarks create OPENCORVUS_HOME at runtime,
    // so the data subdirectory may not have been created by global/index.ts
    // module-load ensureDirectory calls.
    mkdirSync(path.dirname(dbPath), { recursive: true })

    const sqlite = new BunDatabase(dbPath, { create: true })
    state.sqlite = sqlite

    // auto_vacuum must be set before any table is created. For existing DBs
    // opened with auto_vacuum=NONE this pragma is silently ignored — delete
    // opencorvus.db to adopt the new mode (project rule: no DB migration).
    sqlite.run("PRAGMA auto_vacuum = INCREMENTAL")
    sqlite.run("PRAGMA journal_mode = WAL")
    sqlite.run("PRAGMA synchronous = NORMAL")
    sqlite.run("PRAGMA busy_timeout = 5000")
    sqlite.run("PRAGMA cache_size = -64000")
    sqlite.run("PRAGMA foreign_keys = ON")
    // Cap WAL file size on disk — anything above the limit is truncated at
    // the next checkpoint instead of staying resident.
    sqlite.run("PRAGMA journal_size_limit = 67108864")
    sqlite.run("PRAGMA wal_checkpoint(PASSIVE)")

    ensureSchemaCompatibility(sqlite)
    sqlite.exec(SCHEMA_DDL)
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

  // Atomic on-disk wipe shared by `opencorvus db reset` CLI and the
  // /global/db/reset HTTP backdoor. The SQLite file itself is global
  // (`Database.Path()`); caller still MUST pass the project directory
  // explicitly so project-scoped scratch under `<projectDir>/.opencorvus/`
  // can be removed alongside the shared DB.
  export async function reset(projectDir: string): Promise<Array<{ label: string; path: string; ok: boolean; error?: string }>> {
    close()
    const dbPath = Path()
    const targets: Array<{ label: string; path: string }> = [
      { label: "db", path: dbPath },
      { label: "db-wal", path: `${dbPath}-wal` },
      { label: "db-shm", path: `${dbPath}-shm` },
      { label: "runtime", path: ProjectRuntimePaths.projectRuntimeRoot(projectDir) },
      ...ProjectRuntimePaths.legacyRuntimeRelativePaths.map((relative) => ({
        label: `legacy:${relative}`,
        path: path.join(projectDir, ...relative.split("/")),
      })),
    ]
    const results: Array<{ label: string; path: string; ok: boolean; error?: string }> = []
    for (const target of targets) {
      try {
        await rm(target.path, { recursive: true, force: true })
        results.push({ ...target, ok: true })
      } catch (err) {
        results.push({ ...target, ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return results
  }

  /**
   * Run `PRAGMA wal_checkpoint(TRUNCATE)` to collapse the WAL back into the
   * main DB file and truncate it on disk. Only meaningful after bulk
   * DELETEs that shift many pages to free-list. Must run outside a
   * transaction — caller is responsible for not holding one.
   */
  export function checkpointTruncate() {
    // Forcing Client() ensures the sqlite handle is initialised; we cannot use
    // `use()` here because checkpoint must not run inside a transaction ctx.
    Client()
    const sqlite = state.sqlite
    if (!sqlite) return
    sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)")
  }

  /**
   * Run `VACUUM` to rebuild the DB file and reclaim free pages into the
   * filesystem. Expensive; call only after large-scale deletes. Must run
   * outside a transaction.
   */
  export function vacuum() {
    Client()
    const sqlite = state.sqlite
    if (!sqlite) return
    sqlite.run("VACUUM")
  }

  /**
   * Reclaim up to `pages` freelist pages back to the OS. Only effective when
   * the DB was created with `auto_vacuum = INCREMENTAL`. Cheap — O(pages) —
   * so safe to call after every cascading delete. Must run outside a
   * transaction.
   */
  export function incrementalVacuum(pages = 1000) {
    Client()
    const sqlite = state.sqlite
    if (!sqlite) return
    sqlite.run(`PRAGMA incremental_vacuum(${pages})`)
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

  export function hasActiveContext() {
    try {
      ctx.use()
      return true
    } catch {
      return false
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
