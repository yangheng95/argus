;(function () {
  const tauri = window.__TAURI__

  const events = Object.freeze({
    showOverlay: "show-overlay",
    showConfirm: "show-confirm",
    showWindowHighlight: "show-window-highlight",
    managerLog: "manager-log",
    managerState: "manager-state",
  })

  async function invoke(cmd, payload = {}) {
    if (!tauri?.core?.invoke) throw new Error("Tauri core invoke is unavailable")
    return tauri.core.invoke(cmd, payload)
  }

  async function invokeSafe(cmd, payload = {}) {
    try {
      return await invoke(cmd, payload)
    } catch {
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
