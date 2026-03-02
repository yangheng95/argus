const frame = document.getElementById("frame")
const labelEl = document.getElementById("label")
const bridge = window.argusBridge

let timer = null
let hideTimer = null

function clearTimers() {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  if (hideTimer !== null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function readDuration(value) {
  const ms = Number(value)
  if (!Number.isFinite(ms)) return 1400
  return Math.max(300, Math.min(Math.round(ms), 10000))
}

bridge.listen(bridge.events.showWindowHighlight, (payload) => {
  const data = payload ?? {}
  clearTimers()
  labelEl.textContent = typeof data.label === "string" && data.label.trim()
    ? data.label
    : "Argus target window"
  frame.classList.remove("visible")
  void frame.offsetWidth
  frame.classList.add("visible")

  timer = setTimeout(() => {
    timer = null
    frame.classList.remove("visible")
    hideTimer = setTimeout(() => {
      hideTimer = null
      void bridge.invokeSafe("hide_window", { window: "window-highlight" })
    }, 140)
  }, readDuration(data.duration_ms))
})
