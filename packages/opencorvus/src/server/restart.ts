import { Env } from "@/runtime/env"
import { hasServerShutdownHandler, requestServerShutdown } from "./shutdown"

const RESTART_CHILD_STARTUP_GRACE_MS = 500

export function canRestartServer() {
  return hasServerShutdownHandler()
}

export async function startServerRestart(reason: string, startupGraceMs = RESTART_CHILD_STARTUP_GRACE_MS) {
  if (!hasServerShutdownHandler()) return false
  const child = Bun.spawn(process.argv, {
    cwd: process.cwd(),
    env: Env.snapshot(),
    stdio: ["ignore", "ignore", "ignore"],
  })
  child.unref()
  const startup = await Promise.race([
    child.exited.then((exitCode) => ({ status: "exited" as const, exitCode })),
    Bun.sleep(startupGraceMs).then(() => ({ status: "running" as const })),
  ])
  if (startup.status === "exited") {
    throw new Error(`Restart child exited before shutdown handoff with code ${startup.exitCode}`)
  }
  setTimeout(() => {
    requestServerShutdown(reason)
  }, 25)
  return true
}
