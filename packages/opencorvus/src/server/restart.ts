import { Env } from "@/runtime/env"
import { hasServerShutdownHandler, requestServerShutdown } from "./shutdown"

export function canRestartServer() {
  return hasServerShutdownHandler()
}

export function startServerRestart(reason: string) {
  if (!hasServerShutdownHandler()) return false
  const child = Bun.spawn(process.argv, {
    cwd: process.cwd(),
    env: Env.snapshot(),
    stdio: ["ignore", "ignore", "ignore"],
  })
  child.unref()
  setTimeout(() => {
    requestServerShutdown(reason)
  }, 25)
  return true
}
