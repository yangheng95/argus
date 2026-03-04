const titleEl = document.getElementById("title")
const msgEl = document.getElementById("msg")
const okEl = document.getElementById("ok")
const okTextEl = document.getElementById("ok-text")
const cancelEl = document.getElementById("cancel")
const cancelTextEl = document.getElementById("cancel-text")
const riskEl = document.getElementById("risk")
const sourceEl = document.getElementById("source")
const targetEl = document.getElementById("target")
const cardEl = document.getElementById("card")
const timerWrapEl = document.getElementById("timer-wrap")
const timerFillEl = document.getElementById("timer-fill")
const timerLabelEl = document.getElementById("timer-label")
const detailsToggleEl = document.getElementById("details-toggle")
const detailsEl = document.getElementById("details")
const detailIDEl = document.getElementById("detail-id")
const detailButtonsEl = document.getElementById("detail-buttons")
const detailTimeoutEl = document.getElementById("detail-timeout")
const detailMessageEl = document.getElementById("detail-message")
const openConsoleEl = document.getElementById("open-console")
const rememberEl = document.getElementById("remember")
const rememberTextEl = document.getElementById("remember-text")
const bridge = window.opencorvusBridge

const RULE_KEY = "opencorvus.confirm.rules.v1"
const DETAIL_KEY = "opencorvus.confirm.details.v1"
const REMEMBER_DEFAULT = "Remember this decision for this exact request in this session."

let currentID = ""
let currentKey = ""
let timeoutTimer = null
let countdownTimer = null
let timeoutStart = 0
let timeoutMs = 0
let rules = readRules()

function readRules() {
  const raw = sessionStorage.getItem(RULE_KEY)
  if (!raw) return {}
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== "object") return {}
    return value
  } catch {
    return {}
  }
}

function writeRules() {
  sessionStorage.setItem(RULE_KEY, JSON.stringify(rules))
}

function hash(input) {
  let value = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    value ^= input.charCodeAt(i)
    value += (value << 1) + (value << 4) + (value << 7) + (value << 8) + (value << 24)
  }
  return `k${(value >>> 0).toString(16)}`
}

function keyOf(data) {
  return hash([data.title, data.message, data.confirm, data.cancel].join("\u0000"))
}

function pick(value, fallback) {
  if (typeof value !== "string") return fallback
  const text = value.trim()
  if (!text) return fallback
  return text
}

function inferRisk(title, message) {
  const text = `${title}\n${message}`.toLowerCase()
  const high = [
    "delete",
    "remove",
    "drop",
    "reset",
    "erase",
    "format",
    "overwrite",
    "destroy",
    "shutdown",
    "kill",
    "sudo",
    "admin",
    "password",
    "payment",
    "transfer",
    "submit",
    "send",
    "publish",
    "deploy",
    "install",
    "uninstall",
    "run",
    "execute",
    "shell",
    "terminal",
    "command",
    "commit",
    "push",
    "merge",
  ]
  if (high.some((word) => text.includes(word))) return "high"

  const low = ["click", "type", "key", "scroll", "move", "drag", "open", "navigate", "focus", "view", "read", "check"]
  if (low.some((word) => text.includes(word))) return "low"
  return "medium"
}

function inferSource(data, title, message) {
  const direct = [data.source, data.app, data.application, data.origin]
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .find(Boolean)
  if (direct) return direct

  const text = `${title}\n${message}`
  const patterns = [
    /\b(?:from|source|app|application|window)\s*[:=]\s*([A-Za-z0-9 _().-]{2,40})/i,
    /\bfrom\s+([A-Z][A-Za-z0-9 _().-]{1,32})/,
    /(?:\u6765\u81ea|\u6765\u6e90)\s*[:\uFF1A]?\s*([^\n,\uFF0C]{2,24})/,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    const value = match[1].trim()
    if (!value) continue
    return value
  }

  return "OpenCorvus"
}

function setRisk(risk) {
  cardEl.dataset.risk = risk
  if (risk === "high") {
    riskEl.textContent = "High risk"
    return
  }
  if (risk === "low") {
    riskEl.textContent = "Low risk"
    return
  }
  riskEl.textContent = "Medium risk"
}

function clearTimeoutTimer() {
  if (timeoutTimer === null) return
  clearTimeout(timeoutTimer)
  timeoutTimer = null
}

function clearCountdownTimer() {
  if (countdownTimer === null) return
  clearInterval(countdownTimer)
  countdownTimer = null
}

function clearTimers() {
  clearTimeoutTimer()
  clearCountdownTimer()
  timeoutStart = 0
  timeoutMs = 0
  timerWrapEl.hidden = true
  timerLabelEl.hidden = true
  timerFillEl.style.width = "0%"
}

function updateCountdown() {
  if (timeoutMs <= 0) return
  const left = Math.max(0, timeoutStart + timeoutMs - Date.now())
  timerLabelEl.textContent = `Timeout in ${(left / 1000).toFixed(1)}s`
  const progress = Math.min(100, Math.max(0, (1 - left / timeoutMs) * 100))
  timerFillEl.style.width = `${progress}%`
}

function startCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    clearTimers()
    return
  }
  timeoutStart = Date.now()
  timeoutMs = ms
  timerWrapEl.hidden = false
  timerLabelEl.hidden = false
  updateCountdown()
  countdownTimer = setInterval(updateCountdown, 100)
}

function setDetails(open) {
  detailsEl.hidden = !open
  detailsToggleEl.setAttribute("aria-expanded", open ? "true" : "false")
  detailsToggleEl.textContent = open ? "Hide details" : "Show details"
  sessionStorage.setItem(DETAIL_KEY, open ? "1" : "0")
}

function detailsOpen() {
  return detailsToggleEl.getAttribute("aria-expanded") === "true"
}

function defaultFocus(risk, remembered) {
  if (remembered === "cancel") {
    cancelEl.focus()
    return
  }
  if (remembered === "confirm") {
    okEl.focus()
    return
  }
  if (risk === "high") {
    cancelEl.focus()
    return
  }
  okEl.focus()
}

function rememberText(answer) {
  if (!answer && !rememberEl.checked) {
    rememberTextEl.textContent = REMEMBER_DEFAULT
    return
  }

  if (!answer && rememberEl.checked) {
    rememberTextEl.textContent = "This decision will be remembered after you choose."
    return
  }

  const label = answer === "confirm" ? "allow" : "reject"
  if (rememberEl.checked) {
    rememberTextEl.textContent = `Remembered decision in this session: ${label}.`
    return
  }

  rememberTextEl.textContent = `Remembered decision (${label}) will be cleared after you choose.`
}

function targetText(data) {
  const x = Number(data.x)
  const y = Number(data.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return "Target: unknown"
  return `Target: (${Math.round(x)}, ${Math.round(y)})`
}

function reply(answer) {
  if (!currentID) return

  const id = currentID
  const key = currentKey
  currentID = ""
  currentKey = ""
  clearTimers()

  if (key) {
    if (rememberEl.checked) {
      rules[key] = answer
      writeRules()
    } else if (rules[key]) {
      delete rules[key]
      writeRules()
    }
  }

  void bridge.invokeSafe(bridge.commands.confirmReply, { window: bridge.windows.confirm, id, answer })
}

okEl.addEventListener("click", () => reply("confirm"))
cancelEl.addEventListener("click", () => reply("cancel"))

rememberEl.addEventListener("change", () => {
  rememberText(rules[currentKey])
})

detailsToggleEl.addEventListener("click", () => {
  setDetails(!detailsOpen())
})

openConsoleEl.addEventListener("click", () => {
  void bridge.invokeSafe(bridge.commands.managerOpen)
})

document.addEventListener("keydown", (event) => {
  if (!currentID) return

  if (event.key === "Escape") {
    event.preventDefault()
    reply("cancel")
    return
  }

  if (event.key !== "Enter") return

  const active = document.activeElement
  if (active === detailsToggleEl || active === rememberEl || active === openConsoleEl) return

  event.preventDefault()
  if (active === cancelEl) {
    reply("cancel")
    return
  }
  reply("confirm")
})

bridge.listen(bridge.events.showConfirm, (payload) => {
  const data = payload ?? {}
  const id = pick(data.id, "")
  if (!id) return

  clearTimers()
  currentID = id

  const title = pick(data.title, "Confirm next step")
  const message = pick(data.message, "Continue?")
  const confirm = pick(data.confirm, "Allow once")
  const cancel = pick(data.cancel, "Reject")
  const timeout = Number(data.timeout_ms)
  const ms = Number.isFinite(timeout) && timeout > 0 ? Math.round(timeout) : 0

  const key = keyOf({ title, message, confirm, cancel })
  currentKey = key

  titleEl.textContent = title
  msgEl.textContent = message
  okTextEl.textContent = confirm
  cancelTextEl.textContent = cancel
  targetEl.textContent = targetText(data)

  sourceEl.textContent = `From ${inferSource(data, title, message)}`
  const risk = inferRisk(title, message)
  setRisk(risk)

  detailIDEl.textContent = id
  detailButtonsEl.textContent = `${confirm} / ${cancel}`
  detailTimeoutEl.textContent = ms > 0 ? `${(ms / 1000).toFixed(1)}s` : "none"
  detailMessageEl.textContent = message

  const remembered = rules[key] === "confirm" || rules[key] === "cancel" ? rules[key] : undefined
  rememberEl.checked = Boolean(remembered)
  rememberText(remembered)

  defaultFocus(risk, remembered)
  startCountdown(ms)

  if (ms > 0) {
    timeoutTimer = setTimeout(() => {
      timeoutTimer = null
      reply("timeout")
    }, ms)
  }
})

setDetails(sessionStorage.getItem(DETAIL_KEY) === "1")
