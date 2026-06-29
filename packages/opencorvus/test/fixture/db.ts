import { rm } from "fs/promises"
import os from "os"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"

function inside(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}

function assertTestDatabasePath(dbPath: string) {
  if (inside(os.tmpdir(), dbPath)) return
  throw new Error(
    `Refusing to reset non-test opencorvus database at ${dbPath}. ` +
      "Run tests with the package bunfig preload or set OPENCORVUS_HOME to a temp directory.",
  )
}

function isBusyRemovalError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "EBUSY" || error.code === "EPERM")
  )
}

async function removeDatabaseFile(file: string) {
  const started = Date.now()
  let attempt = 0
  let lastBusyError: unknown
  for (;;) {
    try {
      await rm(file, { force: true })
      return
    } catch (error) {
      if (!isBusyRemovalError(error)) throw error
      lastBusyError = error
      const elapsed = Date.now() - started
      if (elapsed >= 60_000) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          `Timed out removing locked test database file after ${elapsed}ms and ${attempt + 1} attempts: ${file}. Last busy error: ${message}`,
          { cause: lastBusyError },
        )
      }
      Database.close()
      Bun.gc(true)
      await Bun.sleep(Math.min(100 + attempt * 25, 500))
      attempt++
    }
  }
}

export async function resetDatabase() {
  await Instance.disposeAll().catch(() => undefined)
  Database.close()
  const dbPath = Database.Path()
  assertTestDatabasePath(dbPath)
  await removeDatabaseFile(`${dbPath}-wal`)
  await removeDatabaseFile(`${dbPath}-shm`)
  await removeDatabaseFile(dbPath)
}

export function rebuildTestDatabase() {
  const dbPath = Database.Path()
  assertTestDatabasePath(dbPath)
  Database.rebuildSqlite(() => {})
}
