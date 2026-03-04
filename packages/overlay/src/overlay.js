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
  confirm: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="m9 11 2 2 4-4"/></svg>`,
  done: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7L10 17l-5-5"/></svg>`,
  error: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 16h0.01"/></svg>`,
}

const ACTION_TITLE = {
  click: "Click",
  double: "Double click",
  right: "Right click",
  middle: "Middle click",
  drag: "Drag",
  move: "Move cursor",
  type: "Type text",
  key: "Press key",
  scroll: "Scroll",
  confirm: "Confirm",
}

const POINTER_ACTIONS = new Set(["click", "double", "right", "middle", "drag", "move"])
const THROTTLE_ACTIONS = new Set(["move", "scroll"])

const THROTTLE_MS = 100
const MERGE_WINDOW_MS = 260
const HIDE_MS = {
  start: 1200,
  running: 1100,
  done: 700,
  error: 1600,
}

const bridge = window.opencorvusBridge
const popup = document.getElementById("popup")
const focus = document.getElementById("focus")
const iconEl = document.getElementById("icon")
const titleEl = document.getElementById("title")
const detailEl = document.getElementById("detail")

let hideStartTimer = null
let hideWindowTimer = null
let last = null
const actionTimes = new Map()

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

function normalizeAction(input) {
  if (typeof input !== "string") return "move"
  const key = input.trim().toLowerCase()
  return key in ACTION_TITLE ? key : "move"
}

function normalizeStatus(input) {
  if (typeof input !== "string") return "start"
  const key = input.trim().toLowerCase()
  if (key === "done" || key === "running" || key === "error") return key
  return "start"
}

function cleanLabel(input) {
  if (typeof input !== "string") return ""
  return input.replace(/\s+/g, " ").trim()
}

function iconFor(action, status) {
  if (status === "done") return ACTION_ICONS.done
  if (status === "error") return ACTION_ICONS.error
  return ACTION_ICONS[action] ?? ACTION_ICONS.move
}

function titleFor(action, status) {
  const base = ACTION_TITLE[action] ?? "Action"
  if (status === "done") return `${base} complete`
  if (status === "error") return `${base} failed`
  if (status === "running") return `${base} running`
  return base
}

function detailFor(label, status) {
  if (!label) {
    if (status === "done") return "Completed successfully"
    if (status === "error") return "Action failed"
    if (status === "running") return "Running"
    return "In progress"
  }

  if (status === "done" && label.toLowerCase() === "done") return "Completed successfully"
  if (status === "done" && label.toLowerCase().startsWith("done ")) return label.slice(5)
  return label
}

function updateFocus(action, status) {
  focus.classList.remove("pointer", "visible", "done", "error")
  if (!POINTER_ACTIONS.has(action)) return
  focus.classList.add("pointer", "visible")
  if (status === "done") focus.classList.add("done")
  if (status === "error") focus.classList.add("error")
}

function shouldMerge(event, now) {
  if (!last) return false
  if (last.action !== event.action || last.status !== event.status) return false
  return now - last.time <= MERGE_WINDOW_MS
}

function shouldThrottle(action, status, now) {
  if (status === "done" || status === "error") return false
  if (!THROTTLE_ACTIONS.has(action)) return false
  const prev = actionTimes.get(action) ?? 0
  if (now - prev < THROTTLE_MS) return true
  actionTimes.set(action, now)
  return false
}

function render(event, merged) {
  if (!merged) {
    popup.classList.remove("hiding", "visible")
    focus.classList.remove("visible")
    void popup.offsetWidth
    void focus.offsetWidth
  } else {
    popup.classList.remove("hiding")
  }

  popup.dataset.action = event.action
  popup.dataset.status = event.status
  iconEl.innerHTML = iconFor(event.action, event.status)
  titleEl.textContent = titleFor(event.action, event.status)
  detailEl.textContent = event.count > 1 ? `${event.detail} (x${event.count})` : event.detail

  popup.classList.add("visible")
  updateFocus(event.action, event.status)
}

function scheduleHide(status) {
  clearTimers()
  hideStartTimer = setTimeout(() => {
    hideStartTimer = null
    popup.classList.remove("visible")
    popup.classList.add("hiding")
    focus.classList.remove("visible")
    hideWindowTimer = setTimeout(() => {
      hideWindowTimer = null
      last = null
      void bridge.invokeSafe(bridge.commands.hideWindow, { window: bridge.windows.overlay })
    }, 260)
  }, HIDE_MS[status] ?? HIDE_MS.start)
}

function showEvent(action, label, status) {
  const now = Date.now()
  if (shouldThrottle(action, status, now)) return

  const merged = shouldMerge({ action, status }, now)
  const count = merged ? (last?.count ?? 1) + 1 : 1
  const detail = detailFor(label, status)

  render({ action, status, detail, count }, merged)
  scheduleHide(status)

  last = {
    action,
    status,
    count,
    time: now,
  }
}

bridge.listen(bridge.events.showOverlay, (payload) => {
  const action = normalizeAction(payload?.action)
  const status = normalizeStatus(payload?.status)
  const label = cleanLabel(payload?.label)
  showEvent(action, label, status)
})
