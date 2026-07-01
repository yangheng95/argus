import os from "os"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"

export const TEST_DATABASE_LOCK_DIAGNOSTIC_TIMEOUT_MS = 60_000

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

export async function resetDatabase() {
  await Instance.disposeAll().catch(() => undefined)
  Database.close()
  await Database.awaitEffectIdle(TEST_DATABASE_LOCK_DIAGNOSTIC_TIMEOUT_MS)
  Database.close()
  const dbPath = Database.Path()
  assertTestDatabasePath(dbPath)
  Database.rebuildSqlite(() => {})
}

export function rebuildTestDatabase() {
  const dbPath = Database.Path()
  assertTestDatabasePath(dbPath)
  Database.rebuildSqlite(() => {})
}
