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

export const DatabaseSchemaResetRequiredError = NamedError.create(
  "DatabaseSchemaResetRequiredError",
  z.object({
    message: z.string(),
    path: z.string(),
    reason: z.string(),
  }),
)

export type DatabaseUnavailableErrorData = {
  message: string
  path: string
  operation: string
  code: string
  errno?: number
  byteOffset?: number
}

export const DatabaseUnavailableError = NamedError.create(
  "DatabaseUnavailableError",
  z.object({
    message: z.string(),
    path: z.string(),
    operation: z.string(),
    code: z.string(),
    errno: z.number().optional(),
    byteOffset: z.number().optional(),
  }),
)

const log = Log.create({ service: "db" })

type SchemaShape = Map<string, string[]>

const SQLITE_UNAVAILABLE_CODE_PREFIXES = ["SQLITE_IOERR", "SQLITE_CANTOPEN", "SQLITE_CORRUPT", "SQLITE_READONLY"]
const SQLITE_UNAVAILABLE_CODES = new Set(["SQLITE_NOTADB", "SQLITE_FULL"])

function objectField(input: unknown, key: string): unknown {
  if (!input || typeof input !== "object") return undefined
  return (input as Record<string, unknown>)[key]
}

function stringField(input: unknown, key: string): string | undefined {
  const value = objectField(input, key)
  return typeof value === "string" ? value : undefined
}

function numberField(input: unknown, key: string): number | undefined {
  const value = objectField(input, key)
  return typeof value === "number" ? value : undefined
}

function firstField<T>(input: unknown, key: string, read: (candidate: unknown, key: string) => T | undefined) {
  let current = input
  for (let depth = 0; depth < 8; depth++) {
    const value = read(current, key)
    if (value !== undefined) return value
    const cause = objectField(current, "cause")
    if (!cause || cause === current) return undefined
    current = cause
  }
}

function isSqliteUnavailableCode(code: string): boolean {
  if (SQLITE_UNAVAILABLE_CODES.has(code)) return true
  return SQLITE_UNAVAILABLE_CODE_PREFIXES.some((prefix) => code === prefix || code.startsWith(`${prefix}_`))
}

function sqliteUnavailableCode(error: unknown): string | undefined {
  const code = firstField(error, "code", stringField)
  if (!code || !isSqliteUnavailableCode(code)) return undefined
  return code
}

function unavailableDataFromSqlite(
  error: unknown,
  operation: string,
  dbPath: string,
): DatabaseUnavailableErrorData | undefined {
  const code = sqliteUnavailableCode(error)
  if (!code) return undefined
  const sourceMessage = error instanceof Error ? error.message : String(error)
  const data: DatabaseUnavailableErrorData = {
    path: dbPath,
    operation,
    code,
    message: `OpenCorvus database is unavailable at ${dbPath} during ${operation}: ${sourceMessage}`,
  }
  const errno = firstField(error, "errno", numberField)
  if (errno !== undefined) data.errno = errno
  const byteOffset = firstField(error, "byteOffset", numberField)
  if (byteOffset !== undefined) data.byteOffset = byteOffset
  return data
}

function quoteIdentifier(name: string) {
  return `"${name.replaceAll('"', '""')}"`
}

function readOrdinaryTableShape(sqlite: BunDatabase): SchemaShape {
  const tableRows = sqlite
    .query<
      { name: string },
      []
    >("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql LIKE 'CREATE TABLE%' ORDER BY name")
    .all()

  const shape: SchemaShape = new Map()
  for (const row of tableRows) {
    const columns = sqlite
      .query<{ name: string }, []>(`PRAGMA table_info(${quoteIdentifier(row.name)})`)
      .all()
      .map((column) => column.name)
    shape.set(row.name, columns)
  }
  return shape
}

function expectedSchemaShape(): SchemaShape {
  const sqlite = new BunDatabase(":memory:")
  try {
    sqlite.exec(SCHEMA_DDL)
    return readOrdinaryTableShape(sqlite)
  } finally {
    sqlite.close()
  }
}

function findSchemaDrift(sqlite: BunDatabase): string | undefined {
  const expected = expectedSchemaShape()
  const actual = readOrdinaryTableShape(sqlite)

  for (const tableName of actual.keys()) {
    if (!expected.has(tableName)) return `unexpected table ${tableName}`
  }
  for (const [tableName, expectedColumns] of expected) {
    const actualColumns = actual.get(tableName)
    if (!actualColumns) return `missing table ${tableName}`
    const actualColumnList = actualColumns.join(",")
    const expectedColumnList = expectedColumns.join(",")
    if (actualColumnList !== expectedColumnList) {
      return `table ${tableName} columns differ: actual [${actualColumnList}], expected [${expectedColumnList}]`
    }
  }
}

function hasOrdinaryTables(sqlite: BunDatabase) {
  return readOrdinaryTableShape(sqlite).size > 0
}

function configureSqlite(sqlite: BunDatabase) {
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
}

function dropCurrentSchema(sqlite: BunDatabase) {
  const triggers = sqlite
    .query<{ name: string }, []>("SELECT name FROM sqlite_schema WHERE type = 'trigger' AND name NOT LIKE 'sqlite_%'")
    .all()
  for (const trigger of triggers) {
    sqlite.run(`DROP TRIGGER IF EXISTS ${quoteIdentifier(trigger.name)}`)
  }

  const tables = sqlite
    .query<
      { name: string },
      []
    >("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY CASE WHEN name = 'memory_fts' THEN 0 ELSE 1 END, name")
    .all()
  for (const table of tables) {
    sqlite.run(`DROP TABLE IF EXISTS ${quoteIdentifier(table.name)}`)
  }
}

function openSqlite(dbPath: string) {
  const sqlite = new BunDatabase(dbPath, { create: true })
  configureSqlite(sqlite)
  return sqlite
}

function throwSchemaResetRequired(sqlite: BunDatabase, dbPath: string, reason: string): never {
  sqlite.close()
  throw new DatabaseSchemaResetRequiredError({
    path: dbPath,
    reason,
    message:
      `OpenCorvus database schema reset required at ${dbPath}: ${reason}. ` +
      "Run `opencorvus db path` to confirm the database location, then run `opencorvus db reset --force` from the project directory.",
  })
}

function ensureCurrentSchema(sqlite: BunDatabase, dbPath: string): BunDatabase {
  if (hasOrdinaryTables(sqlite)) {
    const drift = findSchemaDrift(sqlite)
    if (drift) {
      log.warn("database schema drift detected; reset required", { path: dbPath, reason: drift })
      throwSchemaResetRequired(sqlite, dbPath, drift)
    }
  }

  try {
    sqlite.exec(SCHEMA_DDL)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    log.warn("database schema apply failed; reset required", {
      path: dbPath,
      error: reason,
    })
    throwSchemaResetRequired(sqlite, dbPath, reason)
  }

  const drift = findSchemaDrift(sqlite)
  if (drift) {
    log.warn("database schema drift detected after schema apply; reset required", { path: dbPath, reason: drift })
    throwSchemaResetRequired(sqlite, dbPath, drift)
  }
  return sqlite
}

export namespace Database {
  // SQLite state is process-wide and single-source: `<Global.Path.data>/opencorvus.db`.
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
    unavailable: undefined as DatabaseUnavailableErrorData | undefined,
  }

  function unavailableError() {
    return state.unavailable ? new DatabaseUnavailableError(state.unavailable) : undefined
  }

  function closeSqliteAfterUnavailable() {
    const sqlite = state.sqlite
    state.sqlite = undefined
    Client.reset()
    if (!sqlite) return
    try {
      sqlite.close()
    } catch (error) {
      log.warn("database close failed after unavailable error", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  export function normalizeError(error: unknown, operation: string): unknown {
    if (DatabaseUnavailableError.isInstance(error)) return error
    const data = unavailableDataFromSqlite(error, operation, Path())
    if (!data) return error
    state.unavailable = data
    closeSqliteAfterUnavailable()
    return new DatabaseUnavailableError(data, error instanceof Error ? { cause: error } : undefined)
  }

  export function isUnavailableError(error: unknown): boolean {
    return DatabaseUnavailableError.isInstance(error) || sqliteUnavailableCode(error) !== undefined
  }

  export function unavailable() {
    return state.unavailable ? { ...state.unavailable } : undefined
  }

  function throwIfUnavailable(): void {
    const error = unavailableError()
    if (error) throw error
  }

  function throwNormalized(error: unknown, operation: string): never {
    throw normalizeError(error, operation)
  }

  export const Client = lazy(() => {
    throwIfUnavailable()
    const dbPath = Path()
    log.info("opening database", { path: dbPath })
    // Ensure data dir exists — benchmarks create OPENCORVUS_HOME at runtime,
    // so the data subdirectory may not have been created by global/index.ts
    // module-load ensureDirectory calls.
    mkdirSync(path.dirname(dbPath), { recursive: true })

    try {
      const sqlite = ensureCurrentSchema(openSqlite(dbPath), dbPath)
      state.sqlite = sqlite
      log.info("schema applied")

      const db = drizzle({ client: sqlite, schema })

      return db
    } catch (error) {
      throwNormalized(error, "Database.Client")
    }
  })

  export function close() {
    const sqlite = state.sqlite
    const wasUnavailable = state.unavailable !== undefined
    state.sqlite = undefined
    state.unavailable = undefined
    Client.reset()
    if (!sqlite) return
    if (!wasUnavailable) {
      try {
        sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)")
      } catch (error) {
        log.warn("database WAL checkpoint failed during close", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    try {
      sqlite.close()
    } catch (error) {
      log.warn("database close failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  export function hasOpenConnection() {
    return !!state.sqlite
  }

  export type ResetTarget = { label: string; path: string; ok: boolean; error?: string }
  type ResetTargetInput = { label: string; path: string }

  function databaseFileTargets(databasePath = Path()): ResetTargetInput[] {
    const dbPath = databasePath
    return [
      { label: "db", path: dbPath },
      { label: "db-wal", path: `${dbPath}-wal` },
      { label: "db-shm", path: `${dbPath}-shm` },
    ]
  }

  async function removeTargets(targets: ResetTargetInput[]): Promise<ResetTarget[]> {
    const results: ResetTarget[] = []
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

  // Overlay DB reset is a file deletion operation for the current runtime
  // SQLite path reported by /global/health. It must not read SQLite state
  // first, because schema drift or a corrupt DB file is the primary reason the
  // user needs this action.
  export async function resetFiles(databasePath: string): Promise<ResetTarget[]> {
    const normalizedDatabasePath = databasePath.trim()
    if (!path.isAbsolute(normalizedDatabasePath)) {
      throw new Error(`Database.resetFiles databasePath must be an absolute path: ${databasePath}`)
    }
    const currentDatabasePath = Path()
    if (normalizedDatabasePath !== currentDatabasePath) {
      throw new Error(`Database.resetFiles databasePath must match Database.Path(): expected ${currentDatabasePath}`)
    }
    close()
    return removeTargets(databaseFileTargets(normalizedDatabasePath))
  }

  // Atomic on-disk wipe used by `opencorvus db reset` CLI. The SQLite file
  // itself is global (`Database.Path()`); caller still MUST pass the project
  // directory explicitly so project-scoped scratch under
  // `<projectDir>/.opencorvus/` can be removed alongside the shared DB.
  export async function reset(projectDir: string): Promise<ResetTarget[]> {
    const normalizedProjectDir = projectDir.trim()
    if (!path.isAbsolute(normalizedProjectDir)) {
      throw new Error(`Database.reset projectDir must be an absolute path: ${projectDir}`)
    }
    close()
    const targets: ResetTargetInput[] = [
      ...databaseFileTargets(),
      { label: "runtime", path: ProjectRuntimePaths.projectRuntimeRoot(normalizedProjectDir) },
      ...ProjectRuntimePaths.legacyRuntimeRelativePaths.map((relative) => ({
        label: `legacy:${relative}`,
        path: path.join(normalizedProjectDir, ...relative.split("/")),
      })),
    ]
    return removeTargets(targets)
  }

  export function rebuildSqlite(callback: (sqlite: BunDatabase) => void) {
    close()
    const dbPath = Path()
    mkdirSync(path.dirname(dbPath), { recursive: true })
    let sqlite: BunDatabase
    try {
      sqlite = openSqlite(dbPath)
    } catch (error) {
      throwNormalized(error, "Database.rebuildSqlite")
    }
    try {
      sqlite.run("PRAGMA foreign_keys = OFF")
      sqlite.run("BEGIN")
      dropCurrentSchema(sqlite)
      sqlite.exec(SCHEMA_DDL)
      callback(sqlite)
      sqlite.run("COMMIT")
      sqlite.run("PRAGMA foreign_keys = ON")
    } catch (err) {
      try {
        sqlite.run("ROLLBACK")
      } catch {}
      throwNormalized(err, "Database.rebuildSqlite")
    } finally {
      if (state.sqlite === sqlite) state.sqlite = undefined
      try {
        sqlite.close()
      } catch {}
      Client.reset()
    }
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
    try {
      Client()
      const sqlite = state.sqlite
      if (!sqlite) return
      sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)")
    } catch (error) {
      throwNormalized(error, "Database.checkpointTruncate")
    }
  }

  /**
   * Run `VACUUM` to rebuild the DB file and reclaim free pages into the
   * filesystem. Expensive; call only after large-scale deletes. Must run
   * outside a transaction.
   */
  export function vacuum() {
    try {
      Client()
      const sqlite = state.sqlite
      if (!sqlite) return
      sqlite.run("VACUUM")
    } catch (error) {
      throwNormalized(error, "Database.vacuum")
    }
  }

  /**
   * Reclaim up to `pages` freelist pages back to the OS. Only effective when
   * the DB was created with `auto_vacuum = INCREMENTAL`. Cheap — O(pages) —
   * so safe to call after every cascading delete. Must run outside a
   * transaction.
   */
  export function incrementalVacuum(pages = 1000) {
    try {
      Client()
      const sqlite = state.sqlite
      if (!sqlite) return
      sqlite.run(`PRAGMA incremental_vacuum(${pages})`)
    } catch (error) {
      throwNormalized(error, "Database.incrementalVacuum")
    }
  }

  export type TxOrDb = Transaction | Client

  const ctx = Context.create<{
    tx: TxOrDb
    effects: (() => void | Promise<void>)[]
  }>("database")

  const effectLog = Log.create({ service: "db-effect" })
  const activeEffects = new Set<Promise<void>>()
  let effectActivityVersion = 0

  function markEffectActivity() {
    effectActivityVersion++
  }

  function delay(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

  function trackEffect(result: Promise<unknown>) {
    let tracked: Promise<void>
    tracked = Promise.resolve(result)
      .then(
        () => undefined,
        (err) => {
          effectLog.warn("post-commit effect failed", { error: err instanceof Error ? err.message : String(err) })
        },
      )
      .finally(() => {
        activeEffects.delete(tracked)
        markEffectActivity()
      })
    activeEffects.add(tracked)
    markEffectActivity()
  }

  function isPromiseLike(value: unknown): value is Promise<unknown> {
    return (
      (typeof value === "object" || typeof value === "function") &&
      value !== null &&
      "then" in value &&
      typeof value.then === "function"
    )
  }

  function runEffect(fn: () => void | Promise<void>) {
    try {
      const result = fn()
      if (isPromiseLike(result)) {
        trackEffect(result)
      }
    } catch (err) {
      effectLog.warn("post-commit effect threw synchronously", {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /** Execute post-commit effects, catching and logging any failures. */
  function drainEffects(effects: (() => void | Promise<void>)[]) {
    for (const fn of effects) {
      runEffect(fn)
    }
  }

  export function use<T>(callback: (trx: TxOrDb) => T): T {
    throwIfUnavailable()
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        try {
          throwIfUnavailable()
          const effects: (() => void | Promise<void>)[] = []
          const db = Client()
          const result = ctx.provide({ effects, tx: db }, () => callback(db))
          drainEffects(effects)
          return result
        } catch (inner) {
          throwNormalized(inner, "Database.use")
        }
      }
      throw err
    }
  }

  export function effect(fn: () => any | Promise<any>) {
    try {
      ctx.use().effects.push(fn)
    } catch {
      runEffect(fn)
    }
  }

  export async function awaitEffectIdle(idleTimeoutMs: number) {
    if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs <= 0) {
      throw new Error(`Database.awaitEffectIdle: invalid idleTimeoutMs ${idleTimeoutMs}`)
    }

    let lastActivityVersion = effectActivityVersion
    let idleDeadline = Date.now() + idleTimeoutMs
    while (activeEffects.size > 0) {
      if (effectActivityVersion !== lastActivityVersion) {
        lastActivityVersion = effectActivityVersion
        idleDeadline = Date.now() + idleTimeoutMs
      }

      const remaining = idleDeadline - Date.now()
      if (remaining <= 0) {
        throw new Error(
          `Database.awaitEffectIdle: ${activeEffects.size} post-commit effect(s) still active after ${idleTimeoutMs}ms without effect activity`,
        )
      }

      const snapshot = [...activeEffects]
      await Promise.race([Promise.allSettled(snapshot).then(() => undefined), delay(Math.min(50, remaining))])
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
    throwIfUnavailable()
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        try {
          throwIfUnavailable()
          const effects: (() => void | Promise<void>)[] = []
          const result = Client().transaction((tx) => {
            return ctx.provide({ tx, effects }, () => callback(tx))
          })
          drainEffects(effects)
          return result
        } catch (inner) {
          throwNormalized(inner, "Database.transaction")
        }
      }
      throw err
    }
  }
}
