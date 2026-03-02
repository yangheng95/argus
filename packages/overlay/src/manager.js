const bridge = window.argusBridge
const invoke = bridge.invoke

const els = {
  statusBadge: document.getElementById("statusBadge"),
  statusText: document.getElementById("statusText"),
  pidText: document.getElementById("pidText"),
  chat: document.getElementById("chat"),
  logs: document.getElementById("logs"),
  sendForm: document.getElementById("sendForm"),
  sendBtn: document.getElementById("sendBtn"),
  promptInput: document.getElementById("promptInput"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  clearLogsBtn: document.getElementById("clearLogsBtn"),
  saveBtn: document.getElementById("saveBtn"),
  commandInput: document.getElementById("commandInput"),
  cwdInput: document.getElementById("cwdInput"),
  serveArgsInput: document.getElementById("serveArgsInput"),
  runArgsInput: document.getElementById("runArgsInput"),
  envInput: document.getElementById("envInput"),
}

const state = {
  logs: [],
  configLoaded: false,
  sending: false,
}

function readLines(input) {
  return input
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
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
  els.commandInput.value = config.command ?? "argus"
  els.cwdInput.value = config.cwd ?? ""
  els.serveArgsInput.value = Array.isArray(config.serve_args) ? config.serve_args.join("\n") : ""
  els.runArgsInput.value = Array.isArray(config.run_args) ? config.run_args.join("\n") : ""
  els.envInput.value = envToText(config.env)
  state.configLoaded = true
}

function readConfig() {
  return {
    command: (els.commandInput.value || "argus").trim(),
    cwd: els.cwdInput.value.trim(),
    serve_args: readLines(els.serveArgsInput.value),
    run_args: readLines(els.runArgsInput.value),
    env: textToEnv(els.envInput.value),
  }
}

function setStatus(running, pid) {
  els.statusBadge.classList.toggle("running", !!running)
  els.statusText.textContent = running ? "Running" : "Stopped"
  els.pidText.textContent = `PID: ${pid ?? "-"}`
}

function addMessage(role, text) {
  const box = document.createElement("div")
  box.className = `msg ${role}`
  box.textContent = text
  els.chat.appendChild(box)
  els.chat.scrollTop = els.chat.scrollHeight
}

function renderLogs() {
  els.logs.textContent = state.logs.join("\n")
  els.logs.scrollTop = els.logs.scrollHeight
}

function appendLog(line) {
  if (!line) return
  state.logs.push(String(line))
  if (state.logs.length > 800) state.logs = state.logs.slice(-800)
  renderLogs()
}

function applySnapshot(snapshot) {
  if (!snapshot) return
  setStatus(snapshot.running, snapshot.pid)
  if (Array.isArray(snapshot.logs)) {
    state.logs = snapshot.logs.slice(-800)
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
  addMessage("system", "Argus manager is ready.")
  await refreshState()
}

void boot()
