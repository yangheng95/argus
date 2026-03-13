import { rm } from "fs/promises"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"

function normal() {
  const live = process.env.OPENCORVUS_RUN_LIVE_E2E === "1" || process.env.OPENCORVUS_RUN_LIVE_E2E === "true"
  return live && process.env.OPENCORVUS_LIVE_E2E_USE_NORMAL_PATHS !== "0"
}

export async function resetDatabase() {
  await Instance.disposeAll().catch(() => undefined)
  Database.close()
  if (normal()) return
  await rm(Database.Path, { force: true }).catch(() => undefined)
  await rm(`${Database.Path}-wal`, { force: true }).catch(() => undefined)
  await rm(`${Database.Path}-shm`, { force: true }).catch(() => undefined)
}
