import path from "node:path"
import { createOpencode, type OpencodeClient } from "@opencorvus-ai/sdk"
import type { BotAdapter, IncomingMessage } from "./adapter"
import type { STTPipeline } from "./stt/pipeline"
import type { VisionPipeline } from "./vision"

interface SessionEntry {
  sessionId: string
  adapter: BotAdapter
  channel: string
  thread: string
}

type ScreenAttachment = { type?: string; mime?: string; url?: string; filename?: string }
type SessionMessagePart = { id?: string; state?: { attachments?: ScreenAttachment[] } }
type ToolInput = {
  command?: string
  filePath?: string
  name?: string
  action?: string
  title?: string
  window_id?: number
  key?: string
  x?: number
  y?: number
  button?: string
  text?: string
  ms?: number
  direction?: string
  amount?: number
  startX?: number
  startY?: number
  endX?: number
  endY?: number
}

const BOT_DEBUG_TOOL_INPUT_ENV = "OPENCORVUS_BOT_DEBUG_TOOL_INPUT"
const BOT_MESSAGE_LIMIT = 3900

function bool(input: string | undefined) {
  if (!input) return false
  const value = input.trim().toLowerCase()
  return value === "1" || value === "true" || value === "yes" || value === "on"
}

export interface BotCoreOptions {
  port?: number
}

export class BotCore {
  private sessions = new Map<string, SessionEntry>()
  /** Reverse lookup: sessionId -> threadKey */
  private sessionIndex = new Map<string, string>()
  private adapters: BotAdapter[] = []
  private client!: OpencodeClient
  private server!: { url: string; close(): void }
  /** Buffer assistant text per messageID until message.updated signals completion */
  private textBuffers = new Map<string, string>()
  /** Track user message IDs to skip their parts */
  private userMessageIds = new Set<string>()
  /** Set to false by stop() to terminate the reconnect loop */
  private running = false
  private stt?: STTPipeline
  private vision?: VisionPipeline
  /** Base URL of the OpenCorvus server */
  private serverUrl!: string
  /** Per-session pending message queue (staging area) */
  private sessionQueues = new Map<string, Array<{ msg: IncomingMessage; text: string }>>()
  /** Sessions currently being processed - new messages are queued until session.idle fires */
  private sessionProcessing = new Set<string>()

  constructor(private options?: BotCoreOptions) {}

  setSTT(pipeline: STTPipeline): void {
    this.stt = pipeline
  }

  setVision(pipeline: VisionPipeline): void {
    this.vision = pipeline
  }

  get adapterCount(): number {
    return this.adapters.length
  }

  register(adapter: BotAdapter): this {
    this.adapters.push(adapter)
    return this
  }

  async start(): Promise<void> {
    this.running = true
    const opencorvus = await createOpencode({ port: this.options?.port ?? 0 })
    this.client = opencorvus.client
    this.server = opencorvus.server
    this.serverUrl = opencorvus.server.url
    console.log(`[BotCore] OpenCorvus server running at ${this.serverUrl}`)

    this.subscribeEvents()

    for (const adapter of this.adapters) {
      adapter.onMessage((msg) => this.handleMessage(msg))
      await adapter.start()
    }

    // Overlay is managed by OpenCorvus's overlay-client.ts (spawned on first tool use)
  }

  async stop(): Promise<void> {
    this.running = false
    for (const adapter of this.adapters) {
      await adapter.stop()
    }
    this.server.close()
  }

  async handleMessage(msg: IncomingMessage): Promise<void> {
    const threadKey = `${msg.platform}:${msg.channel}:${msg.thread}`
    const adapter = this.adapters.find((a) => a.platform === msg.platform)
    if (!adapter) return

    // --- Voice message transcription ---
    let text = msg.text
    if (msg.audio) {
      if (!this.stt || !this.stt.isAvailable) {
        await adapter.sendMessage(msg.channel, msg.thread, "Voice messages are not supported (no STT provider configured).")
        if (!text) return
      } else {
        const result = await this.stt.transcribe(msg.audio)
        if (result) {
          const prefix = `[Voice message transcript]: ${result.text}`
          text = text ? `${prefix}\n\n${text}` : prefix
          console.log(`[BotCore] Transcribed voice (${result.provider}, ${result.durationMs}ms)`)
        } else {
          await adapter.sendMessage(msg.channel, msg.thread, "Failed to transcribe voice message.")
          if (!text) return
        }
      }
    }

    if (!text) return

    let session = this.sessions.get(threadKey)

    if (!session) {
      const createResult = await this.client.session.create({
        title: `${msg.platform} thread ${msg.thread}`,
      })

      if (createResult.error) {
        console.error("[BotCore] session.create error:", JSON.stringify(createResult.error).slice(0, 500))
        await adapter.sendMessage(msg.channel, msg.thread, "Failed to create session.")
        return
      }

      session = {
        sessionId: createResult.data.id,
        adapter,
        channel: msg.channel,
        thread: msg.thread,
      }
      this.sessions.set(threadKey, session)
      this.sessionIndex.set(createResult.data.id, threadKey)
      console.log(`[BotCore] Created session ${createResult.data.id} for ${threadKey}`)
    }

    // If session is currently processing a task, queue this message and notify user
    if (this.sessionProcessing.has(session.sessionId)) {
      const queue = this.sessionQueues.get(session.sessionId) ?? []
      queue.push({ msg, text })
      this.sessionQueues.set(session.sessionId, queue)
      await adapter.sendMessage(msg.channel, msg.thread, `Current task is still running. Your message is queued (#${queue.length}).`)
      console.log(`[BotCore] Queued message for ${session.sessionId}, queue size: ${queue.length}`)
      return
    }

    // Mark session as processing before sending prompt
    this.sessionProcessing.add(session.sessionId)

    // Use promptAsync to bypass monitor command queue and execute directly.
    // System prompt is injected via the `system` field (appended to LLM system prompt in llm.ts:76).
    const result = await this.client.session.promptAsync({
      sessionID: session.sessionId,
      parts: [{ type: "text", text }],
      system: this.buildSystemPrompt(msg.platform),
    })

    if (result.error) {
      this.sessionProcessing.delete(session.sessionId)
      console.error("[BotCore] session.promptAsync error:", JSON.stringify(result.error).slice(0, 500))
      await adapter.sendMessage(msg.channel, msg.thread, "Failed to send prompt.")
      return
    }

    console.log(`[BotCore] Prompt sent for session ${session.sessionId}`)
  }

  /**
   * Build bot-specific system prompt injected via the API's `system` field.
   * Provides operational context: bot interaction mode, TUI launch instructions,
   * and window binding strategy for on-demand TUI.
   */
  private buildSystemPrompt(platform: string): string {
    const channel = platform === "slack" ? "Slack" : platform === "discord" ? "Discord" : platform
    const projectRoot = path.resolve(import.meta.dirname, "../../..")
    const opencorvusSrc = path.join(projectRoot, "packages", "opencorvus", "src", "index.ts")
    return [
      `You are OpenCorvus - a coding and desktop automation assistant. The user talks to you via ${channel}, and they also watch your screen. They need to SEE what you are doing.`,
      "",
      "## The visibility principle",
      "Everything you do must be visible to the user. Using background tools (write, bash) to produce code silently is unacceptable - the user has no idea what you changed or whether it is correct.",
      "For coding tasks, open a visible coding tool first:",
      "- **Claude Code**: `bash('start \"Claude Code\" cmd /k \"set CLAUDECODE= && set CLAUDE_CODE_SSE_PORT= && claude\"')` — opens in a new terminal",
      `- **OpenCorvus TUI**: \`bash('start "OpenCorvus" cmd /k "bun --preload @opentui/solid/preload --conditions=browser ${opencorvusSrc} <project_dir>"')\``,
      "Exception: if the user explicitly asks for a specific tool ('use codex', 'use VS Code', 'run bash'), follow that instruction.",
      "",
      "## Window discovery and binding (CRITICAL)",
      "Single-monitor flow: start with `screen.screenshot`; you often do NOT need `screen.list_windows`.",
      "Use `screen.bind_window` when app-level precision is needed (window-relative coordinates).",
      "- Prefer `screen.list_windows` + `window_id` for deterministic window selection.",
      "- Strategy: window first. Only when target window is not found should you use `screen.list_monitors` + `screen.bind_monitor`.",
      "- `screen.bind_window` also supports title/app substring fallback (case-insensitive).",
      "- Use `screen.list_windows` when multiple windows are possible, or bind_window fails.",
      "- After binding, take a `screenshot` to confirm you see the correct window.",
      "",
      "### Claude Code window binding workflow:",
      "1. `bash('start \"Claude Code\" cmd /k \"set CLAUDECODE= && set CLAUDE_CODE_SSE_PORT= && claude\"')` to launch",
      "2. Skip wait when possible; if needed use `input.wait` with ms=10",
      "3. Run `screen.list_windows`, pick the Claude window `window_id`, then call `screen.bind_window` with that id",
      "4. If needed, fallback to title matching with 'claude' or 'Claude Code'",
      "5. `screenshot` to verify",
      "6. `input.type` to enter commands, then `input.key` with key='Return' to submit",
      "",
      "## Tool parameter constraints (MUST follow strictly)",
      "- `input.wait`: ms must be 10-10000 (integer). Prefer short waits (10ms first) to keep events responsive.",
      "- `screen.screenshot`: wait_for_change must be boolean `true` or `false`, NOT a string.",
      "- `input.click`: x and y must be integers. button is 'left', 'right', or 'middle'.",
      "- `input.type`: text is a string. For special keys, use `input.key` instead.",
      "- `input.key`: key must be a valid key name (e.g., 'Return', 'Tab', 'Escape', 'Backspace').",
      "- All coordinates are logical (DPI-aware) pixel values.",
      "",
      "## Response style",
      "Write in short, scannable blocks suitable for chat apps.",
      "- Start with a one-line direct answer.",
      "- Use short labeled sections when useful: Plan, Actions, Result, Next.",
      "- Prefer numbered steps for procedures and '-' bullets for facts.",
      "- Keep each paragraph to one or two short sentences.",
      "- Use fenced code blocks for commands or code snippets.",
      "- Avoid long walls of text, repeated filler, or unnecessary prefaces.",
      "",
      "## Desktop tasks",
      "Use screen/input tools to interact visually. Always describe what you see after each screenshot.",
      "",
      "## When something fails",
      "Read the error message carefully. Fix the exact issue before retrying. Don't loop on the same broken action.",
      "If a tool says 'invalid arguments', check the parameter constraints above.",
      "",
      "## Memory",
      "Search memory at the start of each task to recall relevant past context.",
    ].join("\n")
  }

  private polish(text: string): string {
    const normalized = text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim()
    if (!normalized) return ""
    return normalized
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
  }

  private split(text: string, limit = BOT_MESSAGE_LIMIT): string[] {
    if (text.length <= limit) return [text]

    const out: string[] = []
    const blocks = text.split(/\n{2,}/)
    let chunk = ""

    for (const block of blocks) {
      const joined = chunk ? `${chunk}\n\n${block}` : block
      if (joined.length <= limit) {
        chunk = joined
        continue
      }

      if (chunk) {
        out.push(chunk)
        chunk = ""
      }

      if (block.length <= limit) {
        chunk = block
        continue
      }

      for (const line of block.split("\n")) {
        const next = chunk ? `${chunk}\n${line}` : line
        if (next.length <= limit) {
          chunk = next
          continue
        }

        if (chunk) {
          out.push(chunk)
          chunk = ""
        }

        if (line.length <= limit) {
          chunk = line
          continue
        }

        let index = 0
        while (index < line.length) {
          const part = line.slice(index, index + limit)
          if (part.length === limit) {
            out.push(part)
            index += limit
            continue
          }
          chunk = part
          index = line.length
        }
      }
    }

    if (chunk) out.push(chunk)
    return out
  }

  /**
   * Inject a prompt directly into a channel, bypassing inbound listener events.
   * Requires adapter.startThread(channel, text).
   */
  async injectPrompt(platform: string, channel: string, text: string): Promise<void> {
    const adapter = this.adapters.find((a) => a.platform === platform)
    if (!adapter) throw new Error(`No adapter for platform: ${platform}`)
    if (!adapter.startThread) throw new Error(`Adapter ${platform} does not support injectPrompt`)

    // Post the prompt as a visible message and get its ts for threading
    const ts = await adapter.startThread(channel, `[OpenCorvus Task] ${text}`)

    // Treat it as an incoming message — this creates session + sends prompt
    await this.handleMessage({
      platform,
      channel,
      thread: ts,
      user: "system",
      text,
    })
  }

  private toolInputDebug() {
    return bool(process.env[BOT_DEBUG_TOOL_INPUT_ENV])
  }

  /** Format a brief status message for important tool completions */
  private formatToolStatus(tool: string, input: unknown): string | null {
    try {
      const data = (input ?? {}) as ToolInput
      const debug = this.toolInputDebug()
      switch (tool) {
        case "bash": {
          if (!debug) return "`$ bash`"
          const cmd = data.command ?? ""
          const short = cmd.length > 80 ? cmd.slice(0, 80) + "..." : cmd
          return `\`$ ${short}\``
        }
        case "edit":
          if (!debug) return "`edit`"
          return `\`edit ${data.filePath ?? "file"}\``
        case "write":
          if (!debug) return "`write`"
          return `\`write ${data.filePath ?? "file"}\``
        case "skill":
          if (!debug) return "`skill`"
          return `\`skill: ${data.name ?? "?"}\``
        case "screen": {
          const action = data.action
          if (action === "bind_window" && !debug) return "`screen.bind_window`"
          if (action === "bind_window") {
            const target = data.title ?? (typeof data.window_id === "number" ? `#${data.window_id}` : "?")
            return `\`screen.bind_window: ${target}\``
          }
          if (action === "list_windows") return "`screen.list_windows`"
          if (action === "screenshot") return "`screen.screenshot`"
          if (action) return `\`screen.${action}\``
          return "`screen`"
        }
        case "input": {
          const action = data.action
          if (!action) return "`input`"
          if (!debug) return `\`input.${action}\``
          if (action === "key") return `\`input.key: ${data.key ?? "?"}\``
          if (action === "click") return `\`input.click: (${data.x ?? "?"}, ${data.y ?? "?"}) ${data.button ?? "left"}\``
          if (action === "type") return `\`input.type: ${Math.min(String(data.text ?? "").length, 999)} chars\``
          if (action === "wait") return `\`input.wait: ${data.ms ?? "?"}ms\``
          if (action === "scroll") return `\`input.scroll: ${data.direction ?? "?"} ${data.amount ?? ""}\``
          if (action === "drag") return `\`input.drag: (${data.startX ?? "?"}, ${data.startY ?? "?"}) -> (${data.endX ?? "?"}, ${data.endY ?? "?"})\``
          if (action === "move") return `\`input.move: (${data.x ?? "?"}, ${data.y ?? "?"})\``
          return "`input`"
        }
        // read, glob, grep — too noisy, skip
        default:
          return null
      }
    } catch {
      return null
    }
  }

  private findSession(sessionId: string): SessionEntry | undefined {
    const threadKey = this.sessionIndex.get(sessionId)
    if (!threadKey) return undefined
    return this.sessions.get(threadKey)
  }


  /**
   * Upload screenshot attachment and optionally run vision analysis in parallel.
   * Prefer event payload attachments and fall back to fetching message parts if needed.
   */
  private async processScreenshot(
    session: SessionEntry,
    sessionId: string,
    messageId: string,
    partId: string,
    title: string,
    diffPercent?: number,
    initialAttachments?: ScreenAttachment[],
  ): Promise<void> {
    try {
      let attachments = (initialAttachments ?? []).filter((att) => att.type === "file" && att.mime?.startsWith("image/"))
      if (attachments.length === 0) {
        const msgResult = await this.client.session.message({
          sessionID: sessionId,
          messageID: messageId,
        })
        if (msgResult.error) return
        const data = msgResult.data as { parts?: SessionMessagePart[] }
        const part = (data.parts ?? []).find((p) => p.id === partId)
        attachments = (part?.state?.attachments ?? []).filter((att) => att.type === "file" && att.mime?.startsWith("image/"))
      }
      for (const att of attachments) {
        const match = att.url?.match(/^data:[^;]+;base64,(.+)$/)
        if (!match) continue

        const base64Data = match[1]
        const buffer = Buffer.from(base64Data, "base64")
        const ext = att.mime === "image/png" ? "png" : "jpg"

        // Skip vision for oversized screenshots (would timeout or OOM the API)
        const tooLarge = buffer.length >= 7 * 1024 * 1024
        if (tooLarge) {
          console.log(`[BotCore] Vision skipped: screenshot too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB > 7MB)`)
        }

        // Skip vision for trivial screen changes (cursor blinks, etc.)
        const visionDiffThreshold = Number(process.env.OPENCORVUS_MONITOR_DIFF_THRESHOLD) || 2
        const lowDiff = diffPercent !== undefined && diffPercent < visionDiffThreshold
        if (lowDiff) {
          console.log(`[BotCore] Vision skipped: low screen change (${diffPercent.toFixed(1)}% < ${visionDiffThreshold}% threshold)`)
        }

        // Run upload and vision analysis in parallel
        const uploadPromise = session.adapter.uploadImage(
          session.channel,
          session.thread,
          buffer,
          att.filename ?? `screenshot.${ext}`,
          title,
        )

        const shouldVision = this.vision && !tooLarge && !lowDiff
        const visionPromise = shouldVision
          ? this.vision!.analyze(base64Data).catch((err) => {
              console.warn("[BotCore] Vision analysis failed:", err)
              return null
            })
          : Promise.resolve(null)

        const [, visionResult] = await Promise.all([uploadPromise, visionPromise])

        console.log(`[BotCore] Uploaded screenshot (${(buffer.length / 1024).toFixed(0)}KB)`)

        if (visionResult) {
          console.log(`[BotCore] Vision analysis (${visionResult.tokens.prompt + visionResult.tokens.completion} tokens): ${visionResult.description.slice(0, 120)}...`)
        }
      }
    } catch (err) {
      console.error("[BotCore] processScreenshot error:", err)
    }
  }

  private async handleEvent(event: any): Promise<void> {
    // Session entered standby - clear processing flag and dequeue next pending message
    if (event.type === "session.idle") {
      const sessionId = event.properties?.sessionID
      if (sessionId) {
        this.sessionProcessing.delete(sessionId)
        const queue = this.sessionQueues.get(sessionId)
        if (queue && queue.length > 0) {
          const next = queue.shift()!
          if (queue.length === 0) this.sessionQueues.delete(sessionId)
          console.log(`[BotCore] Dequeuing next message for ${sessionId}, remaining: ${queue.length}`)
          this.handleMessage(next.msg).catch((err) => console.error("[BotCore] dequeue handleMessage error:", err))
        }
      }
      return
    }

    // Track user message IDs so we can skip their parts
    if (event.type === "message.updated") {
      const info = event.properties.info

      if (info.role === "user") {
        this.userMessageIds.add(info.id)
        return
      }

      // Flush buffered text when assistant message (one agentic step) completes
      if (info.role === "assistant" && info.time.completed) {
        const session = this.findSession(info.sessionID)
        if (!session) return

        const text = this.textBuffers.get(info.id)
        this.textBuffers.delete(info.id)

        if (text) {
          const polished = this.polish(text)
          if (polished) {
            for (const part of this.split(polished, BOT_MESSAGE_LIMIT)) {
              await session.adapter.sendMessage(session.channel, session.thread, part).catch(() => {})
            }
          }
          console.log(`[BotCore] Sent text for ${info.sessionID} (${polished.length} chars)`)
        }

        if (info.error) {
          const errMsg = "error" in info.error ? (info.error as any).error : JSON.stringify(info.error)
          await session.adapter.sendMessage(session.channel, session.thread, `Error: ${errMsg}`).catch(() => {})
        }

      }
    }

    if (event.type === "message.part.updated") {
      const part = event.properties.part

      // Skip parts belonging to user messages
      if (this.userMessageIds.has(part.messageID)) return

      const session = this.findSession(part.sessionID)
      if (!session) return

      // Buffer text parts keyed by messageID (flushed on message.updated)
      if (part.type === "text") {
        this.textBuffers.set(part.messageID, part.text)
      }

      // Post tool progress for key tools so bot users can see what happened.
      // Overlay hints (popup + window highlight) are handled natively by
      // OpenCorvus's overlay-client.ts — no need to duplicate here.
      if (part.type === "tool") {
        const toolName = part.tool
        const toolInput = part.state?.input

        if (part.state?.status === "completed") {
          // Upload screenshot images from screen tool
          if (toolName === "screen") {
            const hasImage = (part.state.attachments ?? []).some(
              (a: ScreenAttachment) => a.type === "file" && a.mime?.startsWith("image/"),
            )
            if (hasImage) {
              const metadata = part.state.metadata ?? {}
              await this.processScreenshot(
                session,
                part.sessionID,
                part.messageID,
                part.id,
                part.state.title,
                metadata.diffPercent,
                part.state.attachments ?? [],
              )
            }
          }

          // Post brief status for important tools (bash, edit, write, skill)
          const statusMsg = this.formatToolStatus(toolName, toolInput)
          if (statusMsg) {
            await session.adapter.sendMessage(session.channel, session.thread, statusMsg).catch(() => {})
          }
        }

        if (part.state?.status === "error") {
          const statusMsg = this.formatToolStatus(toolName, toolInput) ?? `\`${toolName}\``
          const err = String(part.state.error ?? "Unknown tool error")
          await session.adapter.sendMessage(session.channel, session.thread, `${statusMsg} failed: ${err}`).catch(() => {})
        }
      }
    }
  }

  private subscribeEvents(): void {
    const reconnect = async () => {
      let delay = 1000
      while (this.running) {
        try {
          const events = await this.client.event.subscribe()
          delay = 1000 // reset backoff on successful connection
          for await (const event of events.stream) {
            try {
              await this.handleEvent(event)
            } catch (err) {
              console.error("[BotCore] event handler error:", err)
            }
          }
          console.warn("[BotCore] event stream ended, reconnecting...")
        } catch (err) {
          console.error(`[BotCore] event stream error, retrying in ${delay}ms:`, err)
        }
        if (this.running) {
          await new Promise(resolve => setTimeout(resolve, delay))
          delay = Math.min(delay * 2, 60_000) // exponential backoff, cap 60s
        }
      }
    }
    reconnect().catch(err => console.error("[BotCore] fatal reconnect error:", err))
  }
}
