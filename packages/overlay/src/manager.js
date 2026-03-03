const bridge = window.opencorvusBridge
const invoke = bridge.invoke

const els = {
  statusBadge: document.getElementById("statusBadge"),
  statusText: document.getElementById("statusText"),
  pidText: document.getElementById("pidText"),
  chat: document.getElementById("chat"),
  logs: document.getElementById("logs"),
  logPathText: document.getElementById("logPathText"),
  sendForm: document.getElementById("sendForm"),
  sendBtn: document.getElementById("sendBtn"),
  promptInput: document.getElementById("promptInput"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  clearLogsBtn: document.getElementById("clearLogsBtn"),
  saveBtn: document.getElementById("saveBtn"),
  serveCmdInput: document.getElementById("serveCmdInput"),
  runCmdInput: document.getElementById("runCmdInput"),
  cwdInput: document.getElementById("cwdInput"),
  envInput: document.getElementById("envInput"),
}

const state = {
  logs: [],
  logPath: "",
  configLoaded: false,
  sending: false,
}

function readLines(input) {
  return input
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function readArgs(input) {
  const text = (input || "").trim()
  if (!text) return []

  const out = []
  let item = ""
  let quote = ""

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quote) {
      if (char === quote) {
        quote = ""
        continue
      }
      if (char === "\\" && i + 1 < text.length) {
        const next = text[i + 1]
        if (next === quote || next === "\\") {
          item += next
          i += 1
          continue
        }
      }
      item += char
      continue
    }

    if (char === "\"" || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (item) {
        out.push(item)
        item = ""
      }
      continue
    }

    item += char
  }

  if (item) out.push(item)
  return out
}

function quoteArg(input) {
  if (!input) return "\"\""
  if (!/[\s"'\\]/.test(input)) return input
  return `"${input.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`
}

function argsToText(list) {
  if (!Array.isArray(list)) return ""
  return list.map((item) => quoteArg(String(item))).join(" ")
}

function commandToText(command, list) {
  return argsToText([command || "opencorvus", ...(Array.isArray(list) ? list : [])])
}

function envToText(env) {
  if (!Array.isArray(env)) return ""
  return env.map((item) => `${item.key ?? ""}=${item.value ?? ""}`).join("\n")
}

function textToEnv(input) {
  return readLines(input)
    .map((line) => {
      const idx = line.indexOf("=")
      if (idx < 1) return null
      return {
        key: line.slice(0, idx).trim(),
        value: line.slice(idx + 1).trim(),
      }
    })
    .filter((item) => item && item.key)
}

function fillConfig(config) {
  if (!config) return
  const command = config.command ?? "opencorvus"
  els.serveCmdInput.value = commandToText(command, config.serve_args)
  els.runCmdInput.value = commandToText(command, config.run_args)
  els.cwdInput.value = config.cwd ?? ""
  els.envInput.value = envToText(config.env)
  state.configLoaded = true
}

function readConfig() {
  const serve = readArgs(els.serveCmdInput.value)
  const run = readArgs(els.runCmdInput.value)
  const command = (serve[0] || run[0] || "opencorvus").trim() || "opencorvus"

  return {
    command,
    cwd: els.cwdInput.value.trim(),
    serve_args: serve.length > 0 ? serve.slice(1) : [],
    run_args: run.length === 0 ? [] : run[0] === command ? run.slice(1) : run,
    env: textToEnv(els.envInput.value),
  }
}

function setStatus(running, pid) {
  els.statusBadge.classList.toggle("running", !!running)
  els.statusText.textContent = running ? "Running" : "Stopped"
  els.pidText.textContent = `PID: ${pid ?? "-"}`
}

function setLogPath(value) {
  const text = typeof value === "string" && value.trim() ? value.trim() : "-"
  state.logPath = text
  els.logPathText.textContent = `Log file: ${text}`
}

function addMessage(role, text) {
  const box = document.createElement("div")
  box.className = `msg ${role}`
  box.textContent = text
  els.chat.appendChild(box)
  els.chat.scrollTop = els.chat.scrollHeight
}

function renderLogs() {
  els.logs.textContent = state.logs.map((item) => JSON.stringify(item)).join("\n")
  els.logs.scrollTop = els.logs.scrollHeight
}

function normalizeLog(item) {
  if (!item) return null
  if (typeof item === "object") {
    const x = item
    return {
      ts: Number.isFinite(Number(x.ts)) ? Number(x.ts) : Math.floor(Date.now() / 1000),
      level: typeof x.level === "string" ? x.level : "info",
      tag: typeof x.tag === "string" ? x.tag : "manager",
      message: typeof x.message === "string" ? x.message : JSON.stringify(x),
      detail: x.detail ?? null,
    }
  }
  if (typeof item === "string") {
    return {
      ts: Math.floor(Date.now() / 1000),
      level: "info",
      tag: "legacy",
      message: item,
      detail: null,
    }
  }
  return null
}

function appendLog(item) {
  const line = normalizeLog(item)
  if (!line) return
  state.logs.push(line)
  if (state.logs.length > 800) state.logs = state.logs.slice(-800)
  renderLogs()
}

function applySnapshot(snapshot) {
  if (!snapshot) return
  setStatus(snapshot.running, snapshot.pid)
  setLogPath(snapshot.log_path)
  if (Array.isArray(snapshot.logs)) {
    state.logs = snapshot.logs.map((item) => normalizeLog(item)).filter((item) => Boolean(item)).slice(-800)
    renderLogs()
  }
  if (!state.configLoaded) fillConfig(snapshot.config)
}

async function refreshState() {
  const snapshot = await invoke("manager_get")
  applySnapshot(snapshot)
}

async function startBot() {
  const snapshot = await invoke("manager_start")
  applySnapshot(snapshot)
}

async function stopBot() {
  const snapshot = await invoke("manager_stop")
  applySnapshot(snapshot)
}

async function clearLogs() {
  const snapshot = await invoke("manager_clear_logs")
  applySnapshot(snapshot)
}

async function saveConfig() {
  const snapshot = await invoke("manager_save", { config: readConfig() })
  state.configLoaded = false
  applySnapshot(snapshot)
  addMessage("system", "Configuration saved.")
}

async function sendPrompt(prompt) {
  const result = await invoke("manager_send", { prompt })
  if (result.success) {
    addMessage("assistant", result.output || "(empty response)")
    return
  }
  addMessage("system", `Command failed (code ${result.code}): ${result.output}`)
}

function bindEvents() {
  els.sendForm.addEventListener("submit", async (event) => {
    event.preventDefault()
    if (state.sending) return
    const prompt = els.promptInput.value.trim()
    if (!prompt) return

    addMessage("user", prompt)
    els.promptInput.value = ""

    state.sending = true
    els.sendBtn.disabled = true
    try {
      await sendPrompt(prompt)
      await refreshState()
    } catch (error) {
      addMessage("system", `Send failed: ${error?.message || String(error)}`)
    } finally {
      state.sending = false
      els.sendBtn.disabled = false
    }
  })

  els.promptInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return
    if (event.shiftKey) return
    if (event.isComposing) return
    event.preventDefault()
    if (state.sending) return
    els.sendForm.requestSubmit()
  })

  els.startBtn.addEventListener("click", async () => {
    try {
      await startBot()
    } catch (error) {
      addMessage("system", `Start failed: ${error?.message || String(error)}`)
    }
  })

  els.stopBtn.addEventListener("click", async () => {
    try {
      await stopBot()
    } catch (error) {
      addMessage("system", `Stop failed: ${error?.message || String(error)}`)
    }
  })

  els.refreshBtn.addEventListener("click", async () => {
    try {
      await refreshState()
    } catch (error) {
      addMessage("system", `Refresh failed: ${error?.message || String(error)}`)
    }
  })

  els.clearLogsBtn.addEventListener("click", async () => {
    try {
      await clearLogs()
    } catch (error) {
      addMessage("system", `Clear logs failed: ${error?.message || String(error)}`)
    }
  })

  els.saveBtn.addEventListener("click", async () => {
    try {
      await saveConfig()
    } catch (error) {
      addMessage("system", `Save config failed: ${error?.message || String(error)}`)
    }
  })
}

function bindTauriEvents() {
  bridge.listen(bridge.events.managerLog, (payload) => {
    appendLog(payload)
  })

  bridge.listen(bridge.events.managerState, (payload) => {
    applySnapshot(payload)
  })
}

async function boot() {
  bindEvents()
  bindTauriEvents()
  addMessage("system", "OpenCorvus manager is ready.")
  await refreshState()
}

void boot()
