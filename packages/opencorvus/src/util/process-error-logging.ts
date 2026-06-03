import { Log } from "./log"

function errorPayload(reason: unknown) {
  return reason instanceof Error ? { error: reason } : { reason }
}

export function installProcessErrorLogging() {
  process.on("unhandledRejection", (reason) => {
    Log.Default.error("unhandled rejection", errorPayload(reason))
  })

  process.on("uncaughtException", (error) => {
    Log.Default.error("uncaught exception", errorPayload(error))
  })
}
