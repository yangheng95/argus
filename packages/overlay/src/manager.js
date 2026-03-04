const bridge = window.opencorvusBridge
const invoke = bridge.invoke
const cmd = bridge.commands
const FIXED_SERVE_ARGS = ["serve"]
const FIXED_RUN_ARGS = ["run", "--continue"]

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
  openMcpBtn: document.getElementById("openMcpBtn"),
  openSkillBtn: document.getElementById("openSkillBtn"),
  addMcpBtn: document.getElementById("addMcpBtn"),
  createSkillBtn: document.getElementById("createSkillBtn"),
  commandInput: document.getElementById("commandInput"),
  serveArgsInput: document.getElementById("serveArgsInput"),
  runArgsInput: document.getElementById("runArgsInput"),
  serveFixedInput: document.getElementById("serveFixedInput"),
  runFixedInput: document.getElementById("runFixedInput"),
  servePreviewInput: document.getElementById("servePreviewInput"),
  runPreviewInput: document.getElementById("runPreviewInput"),
  cwdInput: document.getElementById("cwdInput"),
  envInput: document.getElementById("envInput"),
}

const state = {
  logs: [],
  logPath: "",
  command: "opencorvus",
  serveArgs: [...FIXED_SERVE_ARGS],
  runArgs: [...FIXED_RUN_ARGS],
  configLoaded: false,
  sending: false,
  stream: null,
}

function setSending(next) {
  state.sending = !!next
  els.sendBtn.disabled = state.sending
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

function argsToText(args) {
  if (!Array.isArray(args)) return ""
  return args
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0)
    .join("\n")
}

function normArgs(args, fallback) {
  const list = Array.isArray(args)
    ? args.map((item) => String(item ?? "").trim()).filter((item) => item.length > 0)
    : readLines(String(args ?? ""))
  if (list.length > 0) return list
  return [...fallback]
}

function quote(input) {
  if (!input) return "\"\""
  if (!/[\s"'\\]/.test(input)) return input
  return `"${input.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`
}

function cmdLine(command, args) {
  return [command, ...args].map((item) => quote(String(item))).join(" ")
}

function renderCommandPreview() {
  const command = (els.commandInput?.value ?? state.command ?? "opencorvus").trim() || "opencorvus"
  const serveArgs = normArgs(readLines(els.serveArgsInput?.value ?? ""), FIXED_SERVE_ARGS)
  const runArgs = normArgs(readLines(els.runArgsInput?.value ?? ""), FIXED_RUN_ARGS)
  state.command = command
  state.serveArgs = serveArgs
  state.runArgs = runArgs
  if (els.serveFixedInput) els.serveFixedInput.value = serveArgs.join(" ")
  if (els.runFixedInput) els.runFixedInput.value = `${runArgs.join(" ")} "<prompt>"`
  if (els.servePreviewInput) els.servePreviewInput.value = cmd(command, serveArgs)
  if (els.runPreviewInput) els.runPreviewInput.value = `${cmd(command, runArgs)} "<prompt>"`
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
  state.command = (config.command ?? "opencorvus").trim() || "opencorvus"
  state.serveArgs = normArgs(config.serve_args, FIXED_SERVE_ARGS)
  state.runArgs = normArgs(config.run_args, FIXED_RUN_ARGS)
  if (els.commandInput) els.commandInput.value = state.command
  if (els.serveArgsInput) els.serveArgsInput.value = argsToText(state.serveArgs)
  if (els.runArgsInput) els.runArgsInput.value = argsToText(state.runArgs)
  els.cwdInput.value = config.cwd ?? ""
  els.envInput.value = envToText(config.env)
  renderCommandPreview()
  state.configLoaded = true
}

function readConfig() {
  const command = (els.commandInput?.value ?? state.command ?? "opencorvus").trim() || "opencorvus"
  const serveArgs = normArgs(readLines(els.serveArgsInput?.value ?? ""), FIXED_SERVE_ARGS)
  const runArgs = normArgs(readLines(els.runArgsInput?.value ?? ""), FIXED_RUN_ARGS)
  state.command = command
  state.serveArgs = serveArgs
  state.runArgs = runArgs
  return {
    command,
    serve_args: serveArgs,
    run_args: runArgs,
    cwd: els.cwdInput.value.trim(),
    env: textToEnv(els.envInput.value),
  }
}

function setStatus(snapshot) {
  const running = !!snapshot?.running
  const pid = snapshot?.pid ?? "-"
  const channel = snapshot?.channel_running ? ` | Channel PID: ${snapshot.channel_pid ?? "-"}` : " | Channel: stopped"
  const session = snapshot?.shared_session_id ? ` | Session: ${snapshot.shared_session_id}` : ""
  els.statusBadge.classList.toggle("running", running)
  els.statusText.textContent = running ? "Running" : "Stopped"
  els.pidText.textContent = `Core PID: ${pid}${channel}${session}`
}

function setLogPath(value) {
  const text = typeof value === "string" && value.trim() ? value.trim() : "-"
  state.logPath = text
  els.logPathText.textContent = `Log file: ${text}`
}

function scrollChat() {
  els.chat.scrollTop = els.chat.scrollHeight
}

function makeMessage(role) {
  const box = document.createElement("div")
  box.className = `msg ${role}`
  const body = document.createElement("div")
  body.className = "msg-body"
  box.appendChild(body)
  els.chat.appendChild(box)
  scrollChat()
  return { box, body, role, markdown: role === "assistant", text: "" }
}

function escapeHtml(input) {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function safeUrl(input, image = false) {
  if (typeof input !== "string") return null
  const value = input.trim()
  if (!value) return null
  if (/^https?:\/\/\S+$/i.test(value)) return value
  if (/^file:\/\/\S+$/i.test(value)) return value
  if (image && /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(value)) return value
  return null
}

function renderInline(input) {
  const stash = []
  let text = escapeHtml(input)

  text = text.replace(/`([^`\n]+)`/g, (_all, value) => {
    const idx = stash.length
    stash.push(`<code>${value}</code>`)
    return `\u0000${idx}\u0000`
  })

  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (all, alt, url) => {
    const safe = safeUrl(url, true)
    if (!safe) return all
    return `<img src="${safe}" alt="${alt || "image"}" loading="lazy" />`
  })

  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, url) => {
    const safe = safeUrl(url, false)
    if (!safe) return all
    return `<a href="${safe}" target="_blank" rel="noreferrer noopener">${label}</a>`
  })

  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  text = text.replace(/\*([^*\n]+)\*/g, "<em>$1</em>")

  text = text.replace(/\u0000(\d+)\u0000/g, (_all, idx) => stash[Number(idx)] ?? "")
  return text
}

function renderBlocks(input) {
  const out = []
  const lines = input.split(/\r?\n/)
  let para = []
  let list = null
  let quote = []

  function flushPara() {
    if (para.length === 0) return
    out.push(`<p>${renderInline(para.join("\n")).replace(/\n/g, "<br>")}</p>`)
    para = []
  }

  function flushList() {
    if (!list || list.items.length === 0) return
    const tag = list.type === "ol" ? "ol" : "ul"
    out.push(`<${tag}>${list.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`)
    list = null
  }

  function flushQuote() {
    if (quote.length === 0) return
    out.push(`<blockquote>${renderInline(quote.join("\n")).replace(/\n/g, "<br>")}</blockquote>`)
    quote = []
  }

  for (const line of lines) {
    if (!line.trim()) {
      flushPara()
      flushList()
      flushQuote()
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flushPara()
      flushList()
      flushQuote()
      const depth = heading[1].length
      out.push(`<h${depth}>${renderInline(heading[2])}</h${depth}>`)
      continue
    }

    const block = line.match(/^>\s?(.*)$/)
    if (block) {
      flushPara()
      flushList()
      quote.push(block[1])
      continue
    }

    const ul = line.match(/^[-*]\s+(.*)$/)
    if (ul) {
      flushPara()
      flushQuote()
      if (!list || list.type !== "ul") {
        flushList()
        list = { type: "ul", items: [] }
      }
      list.items.push(ul[1])
      continue
    }

    const ol = line.match(/^\d+\.\s+(.*)$/)
    if (ol) {
      flushPara()
      flushQuote()
      if (!list || list.type !== "ol") {
        flushList()
        list = { type: "ol", items: [] }
      }
      list.items.push(ol[1])
      continue
    }

    if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) {
      flushPara()
      flushList()
      flushQuote()
      out.push("<hr>")
      continue
    }

    para.push(line)
  }

  flushPara()
  flushList()
  flushQuote()
  return out.join("")
}

function markdown(input) {
  const text = typeof input === "string" ? input : ""
  const out = []
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g
  let last = 0
  let match = fence.exec(text)

  while (match) {
    const plain = text.slice(last, match.index)
    if (plain.trim()) out.push(renderBlocks(plain))
    const lang = escapeHtml((match[1] || "").trim())
    const code = escapeHtml((match[2] || "").replace(/\n$/, ""))
    out.push(`<pre><code${lang ? ` data-lang="${lang}"` : ""}>${code}</code></pre>`)
    last = fence.lastIndex
    match = fence.exec(text)
  }

  const tail = text.slice(last)
  if (tail.trim()) out.push(renderBlocks(tail))
  if (out.length === 0) return "<p></p>"
  return out.join("")
}

function renderMessage(entry, text, markdownEnabled = entry.role === "assistant") {
  entry.text = text
  entry.markdown = !!markdownEnabled
  if (entry.markdown) {
    entry.body.classList.add("markdown")
    entry.body.innerHTML = markdown(text)
  } else {
    entry.body.classList.remove("markdown")
    entry.body.textContent = text
  }
  scrollChat()
}

function addMessage(role, text, options = {}) {
  const entry = makeMessage(role)
  renderMessage(entry, text, !!options.markdown)
  if (role === "system") {
    setTimeout(() => {
      entry.box.style.transition = "opacity 0.4s"
      entry.box.style.opacity = "0"
      setTimeout(() => entry.box.remove(), 400)
    }, 4000)
  }
  return entry
}

function streamPrepare() {
  if (state.stream) return state.stream
  state.stream = {
    entry: null,
    text: "",
    touched: false,
  }
  return state.stream
}

function streamEntry() {
  const item = streamPrepare()
  if (item.entry) return item.entry
  item.entry = makeMessage("assistant")
  renderMessage(item.entry, "", true)
  return item.entry
}

function streamAppend(text) {
  if (typeof text !== "string" || !text) return
  const item = streamPrepare()
  item.touched = true
  item.text += text
  renderMessage(streamEntry(), item.text, true)
}

function streamReplace(text) {
  const item = streamPrepare()
  item.touched = true
  item.text = typeof text === "string" ? text : ""
  renderMessage(streamEntry(), item.text, true)
}

function streamImage(url, alt) {
  const safe = safeUrl(url, true)
  if (!safe) return
  const name = typeof alt === "string" && alt.trim() ? alt.trim() : "image"
  const item = streamPrepare()
  const prefix = item.text.trim() ? "\n\n" : ""
  streamAppend(`${prefix}![${name}](${safe})`)
}

function streamDone(payload) {
  const item = state.stream
  if (!item) return
  if (!item.touched && payload?.success) {
    item.entry = makeMessage("assistant")
    renderMessage(item.entry, "(empty response)", false)
    item.touched = true
  }
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
  setStatus(snapshot)
  if (typeof snapshot.prompt_running === "boolean") setSending(snapshot.prompt_running)
  setLogPath(snapshot.log_path)
  if (Array.isArray(snapshot.logs)) {
    state.logs = snapshot.logs.map((item) => normalizeLog(item)).filter((item) => Boolean(item)).slice(-800)
    renderLogs()
  }
  if (!state.configLoaded) fillConfig(snapshot.config)
}

async function refreshState() {
  const snapshot = await invoke(cmd.managerGet)
  applySnapshot(snapshot)
}

async function startBot() {
  const snapshot = await invoke(cmd.managerStart)
  applySnapshot(snapshot)
}

async function stopBot() {
  const snapshot = await invoke(cmd.managerStop)
  applySnapshot(snapshot)
}

async function clearLogs() {
  const snapshot = await invoke(cmd.managerClearLogs)
  applySnapshot(snapshot)
}

async function saveConfig() {
  const snapshot = await invoke(cmd.managerSave, { config: readConfig() })
  state.configLoaded = false
  applySnapshot(snapshot)
  addMessage("system", "Configuration saved.")
}

async function openMcpConfig() {
  const file = await invoke(cmd.managerOpenMcpConfig)
  addMessage("system", `MCP config opened: ${file}`)
}

async function openSkillFolder() {
  const dir = await invoke(cmd.managerOpenSkillDir)
  addMessage("system", `Skills folder opened: ${dir}`)
}

async function addMcp() {
  const name = window.prompt("MCP name (kebab-case)")
  if (!name) return
  const trimmed = name.trim()
  if (!trimmed) return

  const remote = window.confirm("Use remote MCP? OK=remote URL, Cancel=local command")
  if (remote) {
    const url = window.prompt("Remote MCP URL", "https://example.com/mcp")
    if (!url) return
    const file = await invoke(cmd.managerAddMcp, {
      name: trimmed,
      config: {
        type: "remote",
        url: url.trim(),
      },
    })
    addMessage("system", `MCP "${trimmed}" added in ${file}`)
    return
  }

  const line = window.prompt("Local MCP command", "npx -y @modelcontextprotocol/server-filesystem .")
  if (!line) return
  const command = readArgs(line)
  if (command.length === 0) return
  const file = await invoke(cmd.managerAddMcp, {
    name: trimmed,
    config: {
      type: "local",
      command,
    },
  })
  addMessage("system", `MCP "${trimmed}" added in ${file}`)
}

async function createSkill() {
  const name = window.prompt("Skill name (kebab-case)")
  if (!name) return
  const trimmed = name.trim()
  if (!trimmed) return
  const description = window.prompt("Skill description", "Describe when and why this skill should be used.")
  if (description === null) return
  const file = await invoke(cmd.managerCreateSkill, {
    name: trimmed,
    description: description.trim(),
  })
  addMessage("system", `Skill scaffold ready: ${file}`)
}

async function sendPrompt(prompt) {
  state.stream = null
  const result = await invoke(cmd.managerSend, { prompt })
  if (result?.accepted) return
  throw new Error("prompt not accepted")
}

function bindEvents() {
  els.commandInput?.addEventListener("input", () => {
    renderCommandPreview()
  })
  els.serveArgsInput?.addEventListener("input", () => {
    renderCommandPreview()
  })
  els.runArgsInput?.addEventListener("input", () => {
    renderCommandPreview()
  })

  els.sendForm.addEventListener("submit", async (event) => {
    event.preventDefault()
    if (state.sending) return
    const prompt = els.promptInput.value.trim()
    if (!prompt) return

    addMessage("user", prompt)
    els.promptInput.value = ""

    setSending(true)
    try {
      await sendPrompt(prompt)
    } catch (error) {
      addMessage("system", `Send failed: ${error?.message || String(error)}`)
      setSending(false)
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

  els.openMcpBtn.addEventListener("click", async () => {
    try {
      await openMcpConfig()
    } catch (error) {
      addMessage("system", `Open MCP config failed: ${error?.message || String(error)}`)
    }
  })

  els.openSkillBtn.addEventListener("click", async () => {
    try {
      await openSkillFolder()
    } catch (error) {
      addMessage("system", `Open skills folder failed: ${error?.message || String(error)}`)
    }
  })

  els.addMcpBtn.addEventListener("click", async () => {
    try {
      await addMcp()
    } catch (error) {
      addMessage("system", `Add MCP failed: ${error?.message || String(error)}`)
    }
  })

  els.createSkillBtn.addEventListener("click", async () => {
    try {
      await createSkill()
    } catch (error) {
      addMessage("system", `Create skill failed: ${error?.message || String(error)}`)
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

  bridge.listen(bridge.events.managerChat, (payload) => {
    const kind = typeof payload?.kind === "string" ? payload.kind : ""
    const text = typeof payload?.text === "string" ? payload.text : ""

    if (kind === "mirror_user") {
      if (text) addMessage("user", text)
      return
    }

    if (kind === "mirror_assistant") {
      if (state.sending) return
      if (text) addMessage("assistant", text, { markdown: true })
      return
    }

    if (kind === "mirror_system") {
      if (text) addMessage("system", text)
      return
    }

    if (kind === "start") {
      streamPrepare()
      return
    }

    if (kind === "delta") {
      streamAppend(typeof payload?.text === "string" ? payload.text : "")
      return
    }

    if (kind === "replace") {
      streamReplace(typeof payload?.text === "string" ? payload.text : "")
      return
    }

    if (kind === "image") {
      streamImage(payload?.url, payload?.alt)
      return
    }

    if (kind === "system") {
      if (text) addMessage("system", text)
      return
    }

    if (kind === "done") {
      streamDone(payload)
      setSending(false)
      void refreshState()
    }
  })
}

async function boot() {
  bindEvents()
  bindTauriEvents()
  renderCommandPreview()
  addMessage("system", "OpenCorvus manager is ready.")
  await refreshState()
}

void boot()
