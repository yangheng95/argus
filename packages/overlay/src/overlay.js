const ACTION_ICONS = {
  click: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v14l4.5-4.5L15 18l3-3-4.5-5.5L18 5H6z"/></svg>`,
  double: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v14l4.5-4.5L15 18l3-3-4.5-5.5L18 5H6z"/><path d="M2 2l2-0.5M2 6l2-0.5" opacity="0.5"/></svg>`,
  right: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v14l4.5-4.5L15 18l3-3-4.5-5.5L18 5H6z"/><rect x="16" y="8" width="6" height="10" rx="1" opacity="0.5"/></svg>`,
  middle: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v14l4.5-4.5L15 18l3-3-4.5-5.5L18 5H6z"/></svg>`,
  drag: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4l6 6-6 6"/><path d="M4 10h16"/></svg>`,
  move: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l-3 3 3 3"/><path d="M9 5l3-3 3 3"/><path d="M15 19l3-3-3-3"/><path d="M19 9l3 3-3 3"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`,
  type: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="3" x2="12" y2="21"/><line x1="8" y1="21" x2="16" y2="21"/><polyline points="6 7 12 3 18 7"/></svg>`,
  key: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6" y2="10"/><line x1="10" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="14" y2="10"/><line x1="18" y1="10" x2="18" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/></svg>`,
  scroll: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 4 12 0 16 4"/><polyline points="8 20 12 24 16 20"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`,
  done: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7L10 17l-5-5"/></svg>`,
}

const POINTER_ACTIONS = new Set(["click", "double", "right", "middle", "drag", "move"])
const bridge = window.argusBridge

const popup = document.getElementById("popup")
const focus = document.getElementById("focus")
const iconEl = document.getElementById("icon")
const labelEl = document.getElementById("label")

let hideStartTimer = null
let hideWindowTimer = null

function clearTimers() {
  if (hideStartTimer !== null) {
    clearTimeout(hideStartTimer)
    hideStartTimer = null
  }
  if (hideWindowTimer !== null) {
    clearTimeout(hideWindowTimer)
    hideWindowTimer = null
  }
}

function showPopup(action, label, status) {
  clearTimers()
  popup.classList.remove("hiding", "visible", "done")
  focus.classList.remove("pointer", "visible", "done")
  void popup.offsetWidth
  void focus.offsetWidth

  const done = status === "done"
  iconEl.innerHTML = done ? ACTION_ICONS.done : ACTION_ICONS[action] ?? ACTION_ICONS.done
  labelEl.textContent = label
  popup.dataset.action = action
  if (done) popup.classList.add("done")
  popup.classList.add("visible")

  if (POINTER_ACTIONS.has(action)) {
    focus.classList.add("pointer", "visible")
    if (done) focus.classList.add("done")
  }

  hideStartTimer = setTimeout(() => {
    hideStartTimer = null
    popup.classList.remove("visible")
    popup.classList.add("hiding")
    focus.classList.remove("visible")
    hideWindowTimer = setTimeout(() => {
      hideWindowTimer = null
      void bridge.invokeSafe("hide_window", { window: "overlay" })
    }, 320)
  }, done ? 800 : 1500)
}

bridge.listen(bridge.events.showOverlay, (payload) => {
  const { x, y, action, label, status } = payload
  const px = Number(x)
  const py = Number(y)
  if (!Number.isFinite(px) || !Number.isFinite(py)) return

  const dpr = window.devicePixelRatio || 1
  const winWidth = Math.round(window.innerWidth * dpr)
  const winX = Math.round(px - winWidth / 2)
  const winY = Math.round(py - 88 * dpr)

  bridge
    .invoke("position_window", { window: "overlay", x: winX, y: winY })
    .then(() => showPopup(action, label, status ?? "start"))
    .catch(() => showPopup(action, label, status ?? "start"))
})
