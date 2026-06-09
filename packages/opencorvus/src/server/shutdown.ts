type ShutdownHandler = (reason: string) => void | Promise<void>

let shutdownHandler: ShutdownHandler | null = null

export function registerServerShutdownHandler(handler: ShutdownHandler) {
  shutdownHandler = handler
}

export function clearServerShutdownHandler(handler?: ShutdownHandler) {
  if (!handler || shutdownHandler === handler) shutdownHandler = null
}

export function hasServerShutdownHandler() {
  return shutdownHandler !== null
}

export function requestServerShutdown(reason: string) {
  const handler = shutdownHandler
  if (!handler) return false
  void Promise.resolve(handler(reason)).catch((error) => {
    console.error("[server.shutdown] request failed:", error)
  })
  return true
}
