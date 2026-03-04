;(function () {
  const tauri = window.__TAURI__
  const warns = new Map()
  const WARN_THROTTLE_MS = 3_000

  const events = Object.freeze({
    showOverlay: "show-overlay",
    showConfirm: "show-confirm",
    showWindowHighlight: "show-window-highlight",
    managerLog: "manager-log",
    managerState: "manager-state",
    managerChat: "manager-chat",
    overlayDiagnostic: "overlay-diagnostic",
  })

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
    events,
    invoke,
    invokeSafe,
    listen,
  })
})()
