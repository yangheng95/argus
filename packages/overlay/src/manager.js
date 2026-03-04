const bridge = window.opencorvusBridge
const invoke = bridge.invoke
const cmd = bridge.commands

const els = {
  statusBadge: document.getElementById("statusBadge"),
  statusText: document.getElementById("statusText"),
  pidText: document.getElementById("pidText"),
  chat: document.getElementById("chat"),
  logs: document.getElementById("logs"),
  openLogPanelBtn: document.getElementById("openLogPanelBtn"),
  logPanel: document.getElementById("logPanel"),
  closeLogPanelBtn: document.getElementById("closeLogPanelBtn"),
  logPathValue: document.getElementById("logPathValue"),
  sendForm: document.getElementById("sendForm"),
  sendBtn: document.getElementById("sendBtn"),
  promptInput: document.getElementById("promptInput"),
  charCount: document.getElementById("charCount"),
  composerHint: document.getElementById("composerHint"),
  clearChatBtn: document.getElementById("clearChatBtn"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  clearLogsBtn: document.getElementById("clearLogsBtn"),
  saveBtn: document.getElementById("saveBtn"),
  openMcpBtn: document.getElementById("openMcpBtn"),
  openSkillBtn: document.getElementById("openSkillBtn"),
  addMcpBtn: document.getElementById("addMcpBtn"),
  createSkillBtn: document.getElementById("createSkillBtn"),
  cwdInput: document.getElementById("cwdInput"),
  openEnvPanelBtn: document.getElementById("openEnvPanelBtn"),
  envPanel: document.getElementById("envPanel"),
  closeEnvPanelBtn: document.getElementById("closeEnvPanelBtn"),
  addEnvBtn: document.getElementById("addEnvBtn"),
  envGroups: document.getElementById("envGroups"),
}

const state = {
  logs: [],
  logPath: "",
  configLoaded: false,
  sending: false,
  stream: null,
  mirrorQueue: [],
  mirror: null,
  inputHistory: [],
  historyIndex: -1,
  pendingInput: "",
  config: null,
  envRows: [],
}

const STREAM_CHAR_DELAY = 10

const defaults = Object.freeze({
  command: "opencorvus",
  serve_args: ["serve", "--hostname=127.0.0.1", "--port=4096"],
  run_args: ["run"],
  bot_command: "bun",
  bot_args: ["run", "--cwd", "packages/bot", "--no-env-file", "--env-file", ".env", "src/main.ts"],
  server_url: "http://127.0.0.1:4096",
})

const envGroups = [
  {
    title: "Core Runtime",
    rows: [
      { key: "OPENCORVUS_CONFIG_CONTENT", use: "Inject runtime config JSON directly." },
      { key: "OPENCORVUS_PROJECT_DIR", use: "Override project root used by helper tooling." },
      {
        key: "OPENCORVUS_BOT_PERMISSION_PROFILE",
        use: "Set permission preset: restricted/standard/permissive/passthrough.",
      },
      {
        key: "OPENCORVUS_PERMISSION_ASK_REPLY",
        use: "Default permission auto-reply for run path: once/always/reject (default always).",
      },
      {
        key: "OPENCORVUS_BOT_PERMISSION_ASK_REPLY",
        use: "Set bot permission auto-reply: once/always/reject (default always).",
      },
      { key: "OPENCORVUS_BOT_SESSION_QUEUE_LIMIT", use: "Limit queued requests per channel session." },
      { key: "OPENCORVUS_BOT_DEBUG_TOOL_INPUT", use: "Show tool input details in status logs when set to 1." },
      { key: "OPENCORVUS_VISION_MODEL", use: "Default vision model for screenshot analysis." },
      { key: "OPENCORVUS_MONITOR_DIFF_THRESHOLD", use: "UI change threshold for monitor notifications (percent)." },
    ],
  },
  {
    title: "Speech & Vision",
    rows: [
      { key: "STT_PROVIDERS", use: "Comma-separated STT provider priority list." },
      { key: "STT_LANGUAGE", use: "Default speech recognition language code." },
      { key: "STT_LOCAL_COMMAND", use: "Local speech-to-text CLI command." },
      { key: "STT_GROQ_MODEL", use: "Groq STT model id." },
      { key: "STT_OPENAI_MODEL", use: "OpenAI Whisper model id." },
      { key: "STT_DEEPGRAM_MODEL", use: "Deepgram STT model id." },
      { key: "STT_GOOGLE_MODEL", use: "Google STT model id." },
      { key: "STT_GROQ_BASE_URL", use: "Groq STT endpoint override." },
      { key: "STT_OPENAI_BASE_URL", use: "OpenAI STT endpoint override." },
      { key: "STT_DEEPGRAM_BASE_URL", use: "Deepgram STT endpoint override." },
      { key: "STT_GOOGLE_BASE_URL", use: "Google STT endpoint override." },
    ],
  },
  {
    title: "Provider Keys",
    rows: [
      { key: "CODING_DASHSCOPE_API_KEY", use: "Alibaba coding endpoint API key." },
      { key: "DASHSCOPE_API_KEY", use: "Alibaba standard endpoint API key." },
      { key: "OPENAI_API_KEY", use: "OpenAI API key." },
      { key: "ANTHROPIC_API_KEY", use: "Anthropic API key." },
      { key: "GOOGLE_API_KEY", use: "Google API key for Gemini/STT." },
      { key: "GOOGLE_GENERATIVE_AI_API_KEY", use: "Google Generative AI API key." },
      { key: "GROQ_API_KEY", use: "Groq API key." },
      { key: "DEEPGRAM_API_KEY", use: "Deepgram API key." },
      { key: "DEEPSEEK_API_KEY", use: "DeepSeek API key." },
      { key: "OPENROUTER_API_KEY", use: "OpenRouter API key." },
    ],
  },
  {
    title: "Channel Integrations",
    rows: [
      { key: "SLACK_BOT_TOKEN", use: "Slack bot token (xoxb)." },
      { key: "SLACK_APP_TOKEN", use: "Slack app-level token (xapp)." },
      { key: "SLACK_SIGNING_SECRET", use: "Slack request signature secret." },
      { key: "SLACK_CHANNEL_ID", use: "Default Slack channel id for test injection." },
      { key: "TELEGRAM_BOT_TOKEN", use: "Telegram bot token." },
      { key: "FEISHU_APP_ID", use: "Feishu app id." },
      { key: "FEISHU_APP_SECRET", use: "Feishu app secret." },
      { key: "FEISHU_VERIFICATION_TOKEN", use: "Feishu webhook verification token." },
    ],
  },
  {
    title: "Runtime & Debug",
    rows: [
      { key: "HTTP_PROXY", use: "HTTP proxy for outbound requests." },
      { key: "HTTPS_PROXY", use: "HTTPS proxy for outbound requests." },
      { key: "SSL_CERT_FILE", use: "Custom CA bundle path." },
      { key: "OPENCORVUS_COORDINATE_SPACE", use: "Pointer coordinate mode (physical/logical/auto)." },
      { key: "OPENCORVUS_OVERLAY_BIN", use: "Override overlay executable path." },
      { key: "OPENCORVUS_OVERLAY_DISABLED", use: "Set to 1 to disable overlay sidecar." },
      { key: "OPENCORVUS_OVERLAY_SINGLETON_MODE", use: "Overlay process policy: reuse or kill-old-start-new." },
    ],
  },
]

const envHints = new Map(
  envGroups.flatMap((group) =>
    group.rows.map((item) => [
      item.key,
      {
        group: group.title,
        use: item.use,
      },
    ]),
  ),
)

// ── Input history helpers ──────────────────────────────────────────────────

function historyPush(text) {
  if (!text.trim()) return
  if (state.inputHistory[state.inputHistory.length - 1] === text) return
  state.inputHistory.push(text)
  if (state.inputHistory.length > 100) state.inputHistory.shift()
  state.historyIndex = -1
}

function historyNavigate(dir) {
  const hist = state.inputHistory
  if (hist.length === 0) return
  if (state.historyIndex === -1) state.pendingInput = els.promptInput.value
  const next = state.historyIndex + dir
  if (next < -1 || next >= hist.length) return
  state.historyIndex = next
  els.promptInput.value = next === -1 ? state.pendingInput : hist[hist.length - 1 - next]
  resizeTextarea()
  updateCharCount()
}

function resizeTextarea() {
  const el = els.promptInput
  el.style.height = "auto"
  el.style.height = Math.min(el.scrollHeight, 160) + "px"
}

function updateCharCount() {
  const len = els.promptInput.value.length
  els.charCount.textContent = len > 0 ? len : ""
}

function setSending(next) {
  state.sending = !!next
  if (state.sending) {
    els.sendBtn.textContent = "Stop"
    els.sendBtn.classList.add("stopping")
    els.sendBtn.disabled = false
    els.composerHint.textContent = "Running... click Stop to abort"
  } else {
    els.sendBtn.textContent = "Send"
    els.sendBtn.classList.remove("stopping")
    els.sendBtn.disabled = false
    els.composerHint.textContent = "Up/Down history | Enter send"
  }
}

function clearChat() {
  streamReset()
  mirrorReset()
  els.chat.innerHTML = '<div class="chat-empty">No messages yet - send an instruction below</div>'
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

    if (char === '"' || char === "'") {
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

function cleanList(input) {
  if (!Array.isArray(input)) return []
  return input.map((item) => String(item ?? "").trim()).filter((item) => item.length > 0)
}

function configValue(config) {
  const input = typeof config === "object" && config ? config : {}
  const serve = cleanList(input.serve_args)
  const run = cleanList(input.run_args)
  const botArgs = cleanList(input.bot_args)
  return {
    command: typeof input.command === "string" && input.command.trim() ? input.command.trim() : defaults.command,
    serve_args: serve.length > 0 ? serve : [...defaults.serve_args],
    run_args: run.length > 0 ? run : [...defaults.run_args],
    bot_command:
      typeof input.bot_command === "string" && input.bot_command.trim()
        ? input.bot_command.trim()
        : defaults.bot_command,
    bot_args: botArgs.length > 0 ? botArgs : [...defaults.bot_args],
    server_url:
      typeof input.server_url === "string" && input.server_url.trim() ? input.server_url.trim() : defaults.server_url,
    cwd: typeof input.cwd === "string" ? input.cwd : "",
    env: Array.isArray(input.env) ? input.env : [],
  }
}

function buildEnvRows(list) {
  const map = new Map()
  if (Array.isArray(list)) {
    for (const item of list) {
      const key = String(item?.key ?? "").trim()
      if (!key) continue
      map.set(key, String(item?.value ?? ""))
    }
  }

  const out = envGroups.flatMap((group) =>
    group.rows.map((item) => ({
      key: item.key,
      value: map.get(item.key) ?? "",
      use: item.use,
      group: group.title,
      custom: false,
    })),
  )

  for (const [key, value] of map) {
    if (envHints.has(key)) continue
    out.push({
      key,
      value,
      use: "Custom runtime variable.",
      group: "Custom",
      custom: true,
    })
  }

  return out
}

function readEnvRows() {
  return state.envRows
    .map((item) => ({
      key: String(item.key ?? "").trim(),
      value: String(item.value ?? ""),
    }))
    .filter((item) => item.key.length > 0)
}

function renderEnvGroups() {
  if (!els.envGroups) return
  els.envGroups.innerHTML = ""

  const names = [...envGroups.map((group) => group.title), "Custom"]
  for (const name of names) {
    const rows = state.envRows.filter((item) => item.group === name)
    if (rows.length === 0 && name !== "Custom") continue
    if (rows.length === 0 && name === "Custom") continue

    const group = document.createElement("section")
    group.className = "env-group"

    const title = document.createElement("div")
    title.className = "env-group-title"
    title.textContent = name
    group.appendChild(title)

    const wrap = document.createElement("div")
    wrap.className = "env-table-wrap"
    const table = document.createElement("table")
    table.className = "env-table"
    table.innerHTML = `
      <thead>
        <tr>
          <th>Variable</th>
          <th>Value</th>
          <th>Usage</th>
        </tr>
      </thead>
      <tbody></tbody>
    `

    const body = table.querySelector("tbody")
    for (const item of rows) {
      const row = document.createElement("tr")

      const keyCell = document.createElement("td")
      if (item.custom) {
        const keyInput = document.createElement("input")
        keyInput.className = "env-value"
        keyInput.placeholder = "ENV_NAME"
        keyInput.value = item.key
        keyInput.addEventListener("input", (event) => {
          item.key = event.target.value
        })
        keyCell.appendChild(keyInput)
      } else {
        const key = document.createElement("code")
        key.className = "env-key"
        key.textContent = item.key
        keyCell.appendChild(key)
      }

      const valueCell = document.createElement("td")
      const valueInput = document.createElement("input")
      valueInput.className = "env-value"
      valueInput.placeholder = "(empty)"
      valueInput.value = item.value
      valueInput.addEventListener("input", (event) => {
        item.value = event.target.value
      })
      valueCell.appendChild(valueInput)

      const useCell = document.createElement("td")
      const use = document.createElement("div")
      use.className = "env-use"
      use.textContent = item.use
      useCell.appendChild(use)

      row.appendChild(keyCell)
      row.appendChild(valueCell)
      row.appendChild(useCell)
      body.appendChild(row)
    }

    wrap.appendChild(table)
    group.appendChild(wrap)
    els.envGroups.appendChild(group)
  }
}

function addCustomEnv() {
  state.envRows.push({
    key: "",
    value: "",
    use: "Custom runtime variable.",
    group: "Custom",
    custom: true,
  })
  renderEnvGroups()
}

function fillConfig(config) {
  state.config = configValue(config)
  els.cwdInput.value = state.config.cwd
  state.envRows = buildEnvRows(state.config.env)
  renderEnvGroups()
  state.configLoaded = true
}

function readConfig() {
  const base = configValue(state.config)
  return {
    command: base.command,
    serve_args: base.serve_args,
    run_args: base.run_args,
    bot_command: base.bot_command,
    bot_args: base.bot_args,
    server_url: base.server_url,
    cwd: els.cwdInput.value.trim(),
    env: readEnvRows(),
  }
}

function panelOpen(panel, open) {
  if (!panel) return
  panel.classList.toggle("open", open)
  panel.setAttribute("aria-hidden", open ? "false" : "true")
}

function closePanels() {
  panelOpen(els.logPanel, false)
  panelOpen(els.envPanel, false)
}

function openPanel(panel) {
  closePanels()
  panelOpen(panel, true)
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
  if (els.logPathValue) els.logPathValue.textContent = text
  if (els.openLogPanelBtn) {
    els.openLogPanelBtn.title = text === "-" ? "Log path unavailable" : text
  }
}

function scrollChat() {
  els.chat.scrollTop = els.chat.scrollHeight
}

function copyText(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {})
  }
}

function makeMessage(role) {
  // Remove empty placeholder
  const empty = els.chat.querySelector(".chat-empty")
  if (empty) empty.remove()

  const box = document.createElement("div")
  box.className = `msg ${role}`

  const body = document.createElement("div")
  body.className = "msg-body"
  box.appendChild(body)

  // Copy button
  const copyBtn = document.createElement("button")
  copyBtn.className = "msg-copy"
  copyBtn.title = "Copy"
  copyBtn.textContent = "⎘"
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    copyText(body.textContent ?? "")
    copyBtn.textContent = "✓"
    setTimeout(() => {
      copyBtn.textContent = "⎘"
    }, 1200)
  })
  box.appendChild(copyBtn)

  // Timestamp
  const meta = document.createElement("div")
  meta.className = "msg-meta"
  meta.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  box.appendChild(meta)

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
    queue: [],
    timer: null,
    done: null,
    closed: false,
  }
  return state.stream
}

function streamEntry() {
  const item = streamPrepare()
  if (item.entry) return item.entry
  item.entry = makeMessage("assistant")
  item.entry.body.classList.add("stream-cursor")
  renderMessage(item.entry, "", false)
  return item.entry
}

function textParts(text) {
  if (typeof text !== "string" || !text) return []
  return Array.from(text)
}

function streamSchedule() {
  const item = state.stream
  if (!item || item.timer || item.closed) return
  item.timer = setTimeout(streamTick, STREAM_CHAR_DELAY)
}

function streamTick() {
  const item = state.stream
  if (!item || item.closed) return
  if (item.queue.length === 0) {
    item.timer = null
    if (item.done) streamFinalize(item, item.done)
    return
  }
  const next = item.queue.shift()
  if (typeof next === "string") {
    item.touched = true
    item.text += next
    renderMessage(streamEntry(), item.text, false)
  }
  item.timer = setTimeout(streamTick, STREAM_CHAR_DELAY)
}

function streamFinalize(item, payload) {
  if (item.closed) return
  item.closed = true
  if (item.timer) {
    clearTimeout(item.timer)
    item.timer = null
  }
  if (item.entry) {
    item.entry.body.classList.remove("stream-cursor")
    if (item.touched) renderMessage(item.entry, item.text, true)
  }
  if (!item.touched && payload?.success) {
    if (!item.entry) item.entry = makeMessage("assistant")
    renderMessage(item.entry, "(empty response)", false)
    item.touched = true
  }
}

function streamReset() {
  const item = state.stream
  if (!item) return
  if (item.timer) clearTimeout(item.timer)
  state.stream = null
}

function streamAppend(text) {
  if (typeof text !== "string" || !text) return
  const item = streamPrepare()
  if (item.closed) return
  item.queue.push(...textParts(text))
  streamSchedule()
}

function streamReplace(text) {
  const item = streamPrepare()
  if (item.closed) return
  item.touched = false
  item.text = ""
  item.done = null
  item.queue = textParts(typeof text === "string" ? text : "")
  renderMessage(streamEntry(), "", false)
  streamSchedule()
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
  if (item.closed) return
  item.done = payload ?? {}
  if (!item.timer && item.queue.length === 0) streamFinalize(item, item.done)
}

function mirrorStart() {
  if (state.mirror || state.mirrorQueue.length === 0) return
  const text = state.mirrorQueue.shift()
  if (typeof text !== "string" || !text) {
    mirrorStart()
    return
  }
  const entry = makeMessage("assistant")
  entry.body.classList.add("stream-cursor")
  renderMessage(entry, "", false)
  state.mirror = {
    entry,
    text: "",
    queue: textParts(text),
    timer: null,
  }
  state.mirror.timer = setTimeout(mirrorTick, STREAM_CHAR_DELAY)
}

function mirrorTick() {
  const item = state.mirror
  if (!item) return
  if (item.queue.length === 0) {
    item.timer = null
    item.entry.body.classList.remove("stream-cursor")
    renderMessage(item.entry, item.text, true)
    state.mirror = null
    mirrorStart()
    return
  }
  const next = item.queue.shift()
  if (typeof next === "string") {
    item.text += next
    renderMessage(item.entry, item.text, false)
  }
  item.timer = setTimeout(mirrorTick, STREAM_CHAR_DELAY)
}

function mirrorAppend(text) {
  if (typeof text !== "string" || !text) return
  state.mirrorQueue.push(text)
  mirrorStart()
}

function mirrorReset() {
  if (state.mirror?.timer) clearTimeout(state.mirror.timer)
  state.mirror = null
  state.mirrorQueue = []
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
    state.logs = snapshot.logs
      .map((item) => normalizeLog(item))
      .filter((item) => Boolean(item))
      .slice(-800)
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
  streamReset()
  const result = await invoke(cmd.managerSend, { prompt })
  if (result?.accepted) return
  throw new Error("prompt not accepted")
}

function bindEvents() {
  els.sendForm.addEventListener("submit", async (event) => {
    event.preventDefault()

    // Stop mode: clicking Send while running aborts the task
    if (state.sending) {
      try {
        await stopBot()
      } catch (error) {
        addMessage("system", `Stop failed: ${error?.message || String(error)}`)
      }
      return
    }

    const prompt = els.promptInput.value.trim()
    if (!prompt) return

    historyPush(prompt)
    addMessage("user", prompt)
    els.promptInput.value = ""
    resizeTextarea()
    updateCharCount()

    setSending(true)
    try {
      await sendPrompt(prompt)
    } catch (error) {
      addMessage("system", `Send failed: ${error?.message || String(error)}`)
      setSending(false)
    }
  })

  els.promptInput.addEventListener("keydown", (event) => {
    // History navigation with ↑/↓ (only when caret is at start/end)
    if (event.key === "ArrowUp" && !event.shiftKey && !event.isComposing) {
      const pos = els.promptInput.selectionStart
      if (pos === 0) {
        event.preventDefault()
        historyNavigate(1)
        return
      }
    }
    if (event.key === "ArrowDown" && !event.shiftKey && !event.isComposing) {
      const pos = els.promptInput.selectionStart
      if (pos === els.promptInput.value.length) {
        event.preventDefault()
        historyNavigate(-1)
        return
      }
    }

    if (event.key !== "Enter") return
    if (event.shiftKey) return
    if (event.isComposing) return
    event.preventDefault()
    els.sendForm.requestSubmit()
  })

  els.promptInput.addEventListener("input", () => {
    resizeTextarea()
    updateCharCount()
  })

  els.clearChatBtn?.addEventListener("click", () => {
    clearChat()
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

  els.openLogPanelBtn?.addEventListener("click", () => {
    openPanel(els.logPanel)
  })

  els.closeLogPanelBtn?.addEventListener("click", () => {
    closePanels()
  })

  els.openEnvPanelBtn?.addEventListener("click", () => {
    openPanel(els.envPanel)
  })

  els.closeEnvPanelBtn?.addEventListener("click", () => {
    closePanels()
  })

  const panels = [els.logPanel, els.envPanel]
  panels.forEach((panel) => {
    panel?.addEventListener("click", (event) => {
      if (event.target !== panel) return
      closePanels()
    })
  })

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return
    closePanels()
  })

  els.addEnvBtn?.addEventListener("click", () => {
    addCustomEnv()
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
      if (text) mirrorAppend(text)
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
  addMessage("system", "OpenCorvus manager is ready.")
  await refreshState()
}

void boot()
