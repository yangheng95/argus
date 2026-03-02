const titleEl = document.getElementById("title")
const msgEl = document.getElementById("msg")
const okEl = document.getElementById("ok")
const cancelEl = document.getElementById("cancel")
const bridge = window.argusBridge

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
  void bridge.invokeSafe("confirm_reply", { window: "confirm", id, answer })
}

okEl.addEventListener("click", () => reply("confirm"))
cancelEl.addEventListener("click", () => reply("cancel"))

bridge.listen(bridge.events.showConfirm, (payload) => {
  const data = payload ?? {}
  currentID = data.id || ""
  if (!currentID) return

  titleEl.textContent = data.title || "Confirm Next Step"
  msgEl.textContent = data.message || "Continue?"
  okEl.textContent = data.confirm || "Confirm"
  cancelEl.textContent = data.cancel || "Cancel"

  const px = Number(data.x)
  const py = Number(data.y)
  const x = Number.isFinite(px) ? Math.round(px - (window.innerWidth || 460) / 2) : -9999
  const y = Number.isFinite(py) ? Math.round(py - (window.innerHeight || 220) / 2) : -9999

  void bridge.invokeSafe("position_window", { window: "confirm", x, y })
  clearTimeoutTimer()

  const ms = Number(data.timeout_ms)
  if (Number.isFinite(ms) && ms > 0) {
    timeoutTimer = setTimeout(() => {
      timeoutTimer = null
      reply("timeout")
    }, ms)
  }
})
