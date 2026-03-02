const titleEl = document.getElementById("title")
const msgEl = document.getElementById("msg")
const okEl = document.getElementById("ok")
const cancelEl = document.getElementById("cancel")

let currentID = ""
let timeoutTimer = null

function clearTimeoutTimer() {
  if (timeoutTimer === null) return
  clearTimeout(timeoutTimer)
  timeoutTimer = null
}

function reply(answer) {
  if (!currentID) return
  const id = currentID
  currentID = ""
  clearTimeoutTimer()
  window.__TAURI__.core.invoke("confirm_reply", { window: "confirm", id, answer }).catch(() => {})
}

okEl.addEventListener("click", () => reply("confirm"))
cancelEl.addEventListener("click", () => reply("cancel"))

window.__TAURI__.event.listen("show-confirm", (event) => {
  const payload = event.payload ?? {}
  currentID = payload.id || ""
  if (!currentID) return

  titleEl.textContent = payload.title || "Confirm Next Step"
  msgEl.textContent = payload.message || "Continue?"
  okEl.textContent = payload.confirm || "Confirm"
  cancelEl.textContent = payload.cancel || "Cancel"

  const px = Number(payload.x)
  const py = Number(payload.y)
  const x = Number.isFinite(px) ? Math.round(px - (window.innerWidth || 460) / 2) : -9999
  const y = Number.isFinite(py) ? Math.round(py - (window.innerHeight || 220) / 2) : -9999

  window.__TAURI__.core.invoke("position_window", { window: "confirm", x, y }).catch(() => {})
  clearTimeoutTimer()

  const ms = Number(payload.timeout_ms)
  if (Number.isFinite(ms) && ms > 0) {
    timeoutTimer = setTimeout(() => {
      timeoutTimer = null
      reply("timeout")
    }, ms)
  }
})
