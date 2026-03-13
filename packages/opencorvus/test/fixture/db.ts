import { GlobalBus } from "../../src/bus/global"
import { rm } from "fs/promises"
import { Instance } from "../../src/project/instance"
import { Scheduler } from "../../src/scheduler"
import { Database } from "../../src/storage/db"

function normal() {
  const live = process.env.OPENCORVUS_RUN_LIVE_E2E === "1" || process.env.OPENCORVUS_RUN_LIVE_E2E === "true"
  return live && process.env.OPENCORVUS_LIVE_E2E_USE_NORMAL_PATHS === "1"
}

export async function resetDatabase() {
  await Instance.disposeAll().catch(() => undefined)
  Scheduler.reset()
  GlobalBus.removeAllListeners()
  Database.close()
  if (normal()) return
  await rm(Database.Path, { force: true }).catch(() => undefined)
  await rm(`${Database.Path}-wal`, { force: true }).catch(() => undefined)
  await rm(`${Database.Path}-shm`, { force: true }).catch(() => undefined)
}
