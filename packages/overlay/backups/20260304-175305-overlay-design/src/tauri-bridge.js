;(function () {
  const tauri = window.__TAURI__
  const protocol = window.opencorvusOverlayProtocol
  const warns = new Map()
  const WARN_THROTTLE_MS = 3_000

  if (!protocol || typeof protocol !== "object") throw new Error("overlay protocol is unavailable")
  if (!protocol.windows || typeof protocol.windows !== "object") throw new Error("overlay protocol windows are unavailable")
  if (!protocol.events || typeof protocol.events !== "object") throw new Error("overlay protocol events are unavailable")
  if (!protocol.commands || typeof protocol.commands !== "object") throw new Error("overlay protocol commands are unavailable")

  const windows = protocol.windows
  const events = protocol.events
  const commands = protocol.commands

  async function invoke(cmd, payload = {}) {
    if (!tauri?.core?.invoke) throw new Error("Tauri core invoke is unavailable")
    return tauri.core.invoke(cmd, payload)
  }

  function warn(cmd, error) {
    const key = String(cmd)
    const now = Date.now()
    const last = warns.get(key) ?? 0
    if (now - last < WARN_THROTTLE_MS) return
    warns.set(key, now)
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[overlay-bridge] invokeSafe failed: ${key}: ${message}`)
  }

  async function invokeSafe(cmd, payload = {}) {
    try {
      return await invoke(cmd, payload)
    } catch (error) {
      warn(cmd, error)
      return undefined
    }
  }

  function listen(name, fn) {
    if (!tauri?.event?.listen) throw new Error("Tauri event API is unavailable")
    return tauri.event.listen(name, (event) => fn(event.payload, event))
  }

  window.opencorvusBridge = Object.freeze({
    windows,
    events,
    commands,
    invoke,
    invokeSafe,
    listen,
  })
})()
