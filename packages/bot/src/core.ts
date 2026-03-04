import path from "node:path"
import { createOpencode, createOpencodeClient, type Event, type OpencodeClient } from "@opencorvus-ai/sdk/v2"
import { mkdir } from "node:fs/promises"
import type { BotAdapter, IncomingMessage } from "./adapter"
import type { STTPipeline } from "./stt/pipeline"
import type { VisionPipeline } from "./vision"
import {
  BOT_MESSAGE_LIMIT,
  formatToolStatus as formatToolStatusMessage,
  polishText,
  splitText,
} from "./message-formatter"
import { permissionReply as permissionReplyRule, queueLimit as queueLimitRule, type PermissionReply } from "./bot-policy"
import { SessionCoordinator } from "./session-coordinator"

interface SessionEntry {
  sessionId: string
  adapter: BotAdapter
  channel: string
  thread: string
}

type ScreenAttachment = { type?: string; mime?: string; url?: string; filename?: string }
type SessionMessagePart = { id?: string; state?: { attachments?: ScreenAttachment[] } }
type PermissionAsked = {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
}
type EventPermissionAsked = Extract<Event, { type: "permission.asked" }>
type EventSessionIdle = Extract<Event, { type: "session.idle" }>
type EventMessageUpdated = Extract<Event, { type: "message.updated" }>
type EventMessagePartUpdated = Extract<Event, { type: "message.part.updated" }>
const MIRROR_PREFIX = "[opencorvus-mirror]"

export interface BotCoreOptions {
  port?: number
  baseUrl?: string
  sharedMode?: boolean
  sharedFile?: string
}

export class BotCore {
  private session = new SessionCoordinator<SessionEntry, IncomingMessage>()
  private adapters: BotAdapter[] = []
  private client!: OpencodeClient
  private server?: { url: string; close(): void }
  /** Buffer assistant text per messageID until message.updated signals completion */
  private textBuffers = new Map<string, string>()
  /** Track user message IDs to skip their parts */
  private userMessageIds = new Set<string>()
  /** Buffer text captured from message.part.updated before we know the message role */
  private pendingPartTexts = new Map<string, string>()
  /** Set to false by stop() to terminate the reconnect loop */
  private running = false
  private stt?: STTPipeline
  private vision?: VisionPipeline
  /** Base URL of the OpenCorvus server */
  private serverUrl!: string
  private sharedSessionId?: string
  /** Prevent creating duplicate overlay mirror threads */
  private overlayMirrorBound = false

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
    const baseUrl = this.options?.baseUrl?.trim()
    if (baseUrl) {
      this.client = createOpencodeClient({ baseUrl })
      this.server = undefined
      this.serverUrl = baseUrl
    } else {
      const opencorvus = await createOpencode({ port: this.options?.port ?? 0 })
      this.client = opencorvus.client
      this.server = opencorvus.server
      this.serverUrl = opencorvus.server.url
    }
    console.log(`[BotCore] OpenCorvus server running at ${this.serverUrl}`)

    this.subscribeEvents()

    for (const adapter of this.adapters) {
      adapter.onMessage((msg) => this.handleMessage(msg))
      await adapter.start()
    }

    // Pre-load shared session ID so overlay-originated events can be mirrored to Slack
    // even before the first Slack message arrives (which would otherwise populate sharedSessionId).
    if (this.sharedMode() && !this.sharedSessionId) {
      const fromFile = await this.readSharedSessionFile()
      if (fromFile) {
        this.sharedSessionId = fromFile
        console.log(`[BotCore] Pre-loaded shared session: ${fromFile}`)
      }
    }

    // Overlay is managed by OpenCorvus's overlay-client.ts (spawned on first tool use)
  }

  async stop(): Promise<void> {
    this.running = false
    for (const adapter of this.adapters) {
      await adapter.stop()
    }
    this.server?.close()
  }

  async handleMessage(msg: IncomingMessage): Promise<void> {
    const threadKey = `${msg.platform}:${msg.channel}:${msg.thread}`
    const adapter = this.adapters.find((a) => a.platform === msg.platform)
    if (!adapter) return

    // --- Voice message transcription ---
    let text = msg.text
    if (msg.audio) {
      if (!this.stt || !this.stt.isAvailable) {
        const notice = "Voice messages are not supported (no STT provider configured)."
        this.mirror("system", notice, {
          platform: msg.platform,
          channel: msg.channel,
          thread: msg.thread,
        })
        await adapter.sendMessage(msg.channel, msg.thread, notice)
        if (!text) return
      } else {
        const result = await this.stt.transcribe(msg.audio)
        if (result) {
          const prefix = `[Voice message transcript]: ${result.text}`
          text = text ? `${prefix}\n\n${text}` : prefix
          console.log(`[BotCore] Transcribed voice (${result.provider}, ${result.durationMs}ms)`)
        } else {
          const notice = "Failed to transcribe voice message."
          this.mirror("system", notice, {
            platform: msg.platform,
            channel: msg.channel,
            thread: msg.thread,
          })
          await adapter.sendMessage(msg.channel, msg.thread, notice)
          if (!text) return
        }
      }
    }

    if (!text) return

    let session = this.session.get(threadKey)

    if (!session) {
      const shared = this.sharedMode()
      const sharedId = shared ? await this.ensureSharedSession(msg) : undefined
      if (shared) {
        if (!sharedId) {
          const notice = "Failed to initialize shared session."
          this.mirror("system", notice, {
            platform: msg.platform,
            channel: msg.channel,
            thread: msg.thread,
          })
          await adapter.sendMessage(msg.channel, msg.thread, notice)
          return
        }
        session = {
          sessionId: sharedId,
          adapter,
          channel: msg.channel,
          thread: msg.thread,
        }
        this.session.bind(threadKey, session)
        console.log(`[BotCore] Bound ${threadKey} to shared session ${sharedId}`)
      }
      if (!shared) {
        const createResult = await this.client.session.create({
          title: `${msg.platform} thread ${msg.thread}`,
        })

        if (createResult.error) {
          console.error("[BotCore] session.create error:", JSON.stringify(createResult.error).slice(0, 500))
          const notice = "Failed to create session."
          this.mirror("system", notice, {
            platform: msg.platform,
            channel: msg.channel,
            thread: msg.thread,
          })
          await adapter.sendMessage(msg.channel, msg.thread, notice)
          return
        }

        session = {
          sessionId: createResult.data.id,
          adapter,
          channel: msg.channel,
          thread: msg.thread,
        }
        this.session.bind(threadKey, session)
        console.log(`[BotCore] Created session ${createResult.data.id} for ${threadKey}`)
      }
    }

    if (!session) {
      const notice = "Failed to initialize session."
      this.mirror("system", notice, {
        platform: msg.platform,
        channel: msg.channel,
        thread: msg.thread,
      })
      await adapter.sendMessage(msg.channel, msg.thread, notice)
      return
    }
    this.mirror("user", text, {
      platform: msg.platform,
      channel: msg.channel,
      thread: msg.thread,
      sessionId: session.sessionId,
    })

    // If session is currently processing a task, queue this message and notify user
    if (this.session.processing(session.sessionId)) {
      const queue = this.session.enqueue(session.sessionId, { msg, text }, this.queueLimit())
      if (!queue.ok) {
        const notice = `Current task is still running. Queue is full (${queue.limit}). Please retry later.`
        this.mirror("system", notice, {
          platform: msg.platform,
          channel: msg.channel,
          thread: msg.thread,
          sessionId: session.sessionId,
        })
        await adapter.sendMessage(
          msg.channel,
          msg.thread,
          notice,
        )
        console.warn(`[BotCore] Dropped message for ${session.sessionId}, queue limit reached: ${queue.limit}`)
        return
      }
      const notice = `Current task is still running. Your message is queued (#${queue.size}).`
      this.mirror("system", notice, {
        platform: msg.platform,
        channel: msg.channel,
        thread: msg.thread,
        sessionId: session.sessionId,
      })
      await adapter.sendMessage(msg.channel, msg.thread, notice)
      console.log(`[BotCore] Queued message for ${session.sessionId}, queue size: ${queue.size}`)
      return
    }

    // Mark session as processing before sending prompt
    this.session.start(session.sessionId)

    // promptAsync enqueues work and returns immediately.
    // System prompt is injected via the `system` field (appended to LLM system prompt in llm.ts:76).
    const result = await this.client.session.promptAsync({
      sessionID: session.sessionId,
      parts: [{ type: "text", text }],
      system: this.buildSystemPrompt(msg.platform),
    })

    if (result.error) {
      this.session.stop(session.sessionId)
      console.error("[BotCore] session.promptAsync error:", JSON.stringify(result.error).slice(0, 500))
      const notice = "Failed to send prompt."
      this.mirror("system", notice, {
        platform: msg.platform,
        channel: msg.channel,
        thread: msg.thread,
        sessionId: session.sessionId,
      })
      await adapter.sendMessage(msg.channel, msg.thread, notice)
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
    return polishText(text)
  }

  private split(text: string, limit = BOT_MESSAGE_LIMIT): string[] {
    return splitText(text, limit)
  }

  private mirror(
    kind: "user" | "assistant" | "system",
    text: string,
    info?: { sessionId?: string; platform?: string; channel?: string; thread?: string },
  ) {
    if (process.env.OPENCORVUS_MIRROR_STDOUT !== "1") return
    const value = text.trim()
    if (!value) return
    console.log(
      `${MIRROR_PREFIX}${JSON.stringify({
        kind,
        text: value,
        ts: Date.now(),
        session_id: info?.sessionId,
        platform: info?.platform,
        channel: info?.channel,
        thread: info?.thread,
      })}`,
    )
  }

  private sharedMode() {
    if (this.options?.sharedMode !== undefined) return this.options.sharedMode
    return process.env.OPENCORVUS_SHARED_SESSION_MODE === "1"
  }

  private sharedFile() {
    const fromOption = this.options?.sharedFile?.trim()
    if (fromOption) return fromOption
    const fromEnv = process.env.OPENCORVUS_SHARED_SESSION_FILE?.trim()
    if (fromEnv) return fromEnv
    return path.resolve(process.cwd(), ".opencorvus/shared-session.json")
  }

  private async readSharedSessionFile() {
    const file = this.sharedFile()
    const raw = (await Bun.file(file).json().catch(() => undefined)) as { session_id?: unknown } | undefined
    if (!raw) return undefined
    if (typeof raw.session_id !== "string") return undefined
    const id = raw.session_id.trim()
    if (!id) return undefined
    return id
  }

  private async writeSharedSessionFile(sessionId: string) {
    const file = this.sharedFile()
    const dir = path.dirname(file)
    await mkdir(dir, { recursive: true })
    const payload = {
      session_id: sessionId,
      updated_at: Date.now(),
    }
    await Bun.write(file, JSON.stringify(payload, null, 2) + "\n")
  }

  private async ensureSharedSession(msg: IncomingMessage) {
    if (!this.sharedMode()) return undefined
    if (this.sharedSessionId) return this.sharedSessionId

    const fromFile = await this.readSharedSessionFile()
    if (fromFile) {
      this.sharedSessionId = fromFile
      return fromFile
    }

    const createResult = await this.client.session.create({
      title: `${msg.platform} shared session`,
    })
    if (createResult.error) {
      console.error("[BotCore] shared session.create error:", JSON.stringify(createResult.error).slice(0, 500))
      return undefined
    }

    this.sharedSessionId = createResult.data.id
    await this.writeSharedSessionFile(createResult.data.id).catch((err) => {
      console.warn("[BotCore] shared session file write failed:", err)
    })
    console.log(`[BotCore] Created shared session ${createResult.data.id}`)
    return createResult.data.id
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

  private queueLimit() {
    return queueLimitRule(process.env)
  }

  private permissionReply(): PermissionReply {
    return permissionReplyRule(process.env)
  }

  /** Format a brief status message for important tool completions */
  private formatToolStatus(tool: string, input: unknown): string | null {
    return formatToolStatusMessage(tool, input, process.env)
  }

  private findSessions(sessionId: string) {
    return this.session.findSessions(sessionId)
  }

  /**
   * In shared mode, when no Slack thread is bound to the shared session yet
   * (e.g. overlay sends a prompt before any Slack message arrives), create a
   * dedicated mirror thread in SLACK_CHANNEL_ID and bind it.  Called lazily on
   * the first event that needs a Slack target.
   */
  private async bindOverlayMirrorIfNeeded(sessionId: string): Promise<SessionEntry[]> {
    // Already bound — just look up what SessionCoordinator has
    if (this.overlayMirrorBound) return this.findSessions(sessionId)

    const channel = process.env.SLACK_CHANNEL_ID
    if (!channel) return []

    const adapter = this.adapters.find((a) => typeof a.startThread === "function")
    if (!adapter?.startThread) return []

    // Set flag before await to prevent concurrent calls from creating multiple threads
    this.overlayMirrorBound = true
    try {
      const ts = await adapter.startThread(channel, "[Overlay Console] Session started")
      const entry: SessionEntry = { sessionId, adapter, channel, thread: ts }
      this.session.bind(`overlay-mirror:${sessionId}`, entry)
      console.log(`[BotCore] Overlay mirror thread created: ${channel}:${ts} for session ${sessionId}`)
      return [entry]
    } catch (err) {
      this.overlayMirrorBound = false
      console.warn("[BotCore] Failed to create overlay mirror thread:", err)
      return []
    }
  }

  /**
   * Upload screenshot attachment and optionally run vision analysis in parallel.
   * Prefer event payload attachments and fall back to fetching message parts if needed.
   */
  private async processScreenshot(
    sessions: SessionEntry[],
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
        const uploadPromise = Promise.all(
          sessions.map((session) =>
            session.adapter.uploadImage(
              session.channel,
              session.thread,
              buffer,
              att.filename ?? `screenshot.${ext}`,
              title,
            ),
          ),
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

  private async handleEvent(event: Event): Promise<void> {
    if (event.type === "permission.asked") {
      const asked = (event as EventPermissionAsked).properties as PermissionAsked
      const reply = this.permissionReply()
      const result = await this.client.permission.reply({
        requestID: asked.id,
        reply,
      })
      const sessions = this.findSessions(asked.sessionID)
      if (result.error) {
        console.error("[BotCore] permission.reply error:", JSON.stringify(result.error).slice(0, 500))
        this.mirror("system", `Failed to reply permission request: ${asked.permission}`, { sessionId: asked.sessionID })
        for (const session of sessions) {
          await session.adapter
            .sendMessage(session.channel, session.thread, `Failed to reply permission request: ${asked.permission}`)
            .catch(() => {})
        }
        return
      }
      this.mirror("system", `Auto-replied permission (${reply}): ${asked.permission}`, { sessionId: asked.sessionID })
      for (const session of sessions) {
        const patterns = asked.patterns.length > 0 ? asked.patterns.join(", ") : "*"
        await session.adapter
          .sendMessage(session.channel, session.thread, `Auto-replied permission (${reply}): ${asked.permission} [${patterns}]`)
          .catch(() => {})
      }
      console.log(`[BotCore] Auto-replied permission ${asked.id} with ${reply}`)
      return
    }

    // Session entered standby - clear processing flag and dequeue next pending message
    if (event.type === "session.idle") {
      const sessionId = (event as EventSessionIdle).properties.sessionID
      if (sessionId) {
        this.session.stop(sessionId)
        const next = this.session.dequeue(sessionId)
        if (next.item) {
          console.log(`[BotCore] Dequeuing next message for ${sessionId}, remaining: ${next.remaining}`)
          this.handleMessage(next.item.msg).catch((err) => console.error("[BotCore] dequeue handleMessage error:", err))
        }
      }
      return
    }

    // Track user message IDs so we can skip their parts
    if (event.type === "message.updated") {
      const info = (event as EventMessageUpdated).properties.info

      if (info.role === "user") {
        // Track on first event only; message.updated fires twice for the same user message
        const isNew = !this.userMessageIds.has(info.id)
        this.userMessageIds.add(info.id)

        // In shared mode, mirror the user's overlay prompt to Slack.
        // message.part.updated for the user text arrives BEFORE this event, so the text
        // may have been buffered under the user messageID — clean that up and fetch via API.
        if (isNew && this.sharedMode() && info.sessionID === this.sharedSessionId) {
          this.textBuffers.delete(info.id)
          let sessions = this.findSessions(info.sessionID)
          if (sessions.length === 0) sessions = await this.bindOverlayMirrorIfNeeded(info.sessionID)
          if (sessions.length > 0) {
            const msgResult = await this.client.session.message({ sessionID: info.sessionID, messageID: info.id })
            if (!msgResult.error) {
              const data = msgResult.data as { parts?: Array<{ type?: string; text?: string }> }
              const text = (data.parts ?? []).filter((p) => p.type === "text").map((p) => p.text ?? "").join("").trim()
              if (text) {
                for (const session of sessions) {
                  await session.adapter.sendMessage(session.channel, session.thread, `> ${text}`).catch(() => {})
                }
              }
            }
          }
        }
        return
      }

      // Flush buffered text when assistant message (one agentic step) completes
      if (info.role === "assistant" && info.time.completed) {
        let sessions = this.findSessions(info.sessionID)
        if (sessions.length === 0 && this.sharedMode() && info.sessionID === this.sharedSessionId) {
          sessions = await this.bindOverlayMirrorIfNeeded(info.sessionID)
        }
        if (sessions.length === 0) return

        const text = this.textBuffers.get(info.id)
        this.textBuffers.delete(info.id)

        if (text) {
          const polished = this.polish(text)
          if (polished) {
            for (const part of this.split(polished, BOT_MESSAGE_LIMIT)) {
              this.mirror("assistant", part, { sessionId: info.sessionID })
              for (const session of sessions) {
                await session.adapter.sendMessage(session.channel, session.thread, part).catch(() => {})
              }
            }
          }
          console.log(`[BotCore] Sent text for ${info.sessionID} (${polished.length} chars)`)
        }

        if (info.error) {
          const errMsg = "error" in info.error ? (info.error as any).error : JSON.stringify(info.error)
          this.mirror("system", `Error: ${errMsg}`, { sessionId: info.sessionID })
          for (const session of sessions) {
            await session.adapter.sendMessage(session.channel, session.thread, `Error: ${errMsg}`).catch(() => {})
          }
        }

      }
    }

    if (event.type === "message.part.updated") {
      const part = (event as EventMessagePartUpdated).properties.part

      // In shared mode, pre-capture text parts before we know the message role.
      // message.part.updated fires BEFORE message.updated(role=user), so we store
      // the text here and consume it when message.updated confirms role=user.
      if (this.sharedMode() && part.sessionID === this.sharedSessionId && part.type === "text" && part.text?.trim()) {
        this.pendingPartTexts.set(part.messageID, part.text)
      }

      // Skip parts belonging to user messages
      if (this.userMessageIds.has(part.messageID)) return

      let sessions = this.findSessions(part.sessionID)
      if (sessions.length === 0 && this.sharedMode() && part.sessionID === this.sharedSessionId) {
        sessions = await this.bindOverlayMirrorIfNeeded(part.sessionID)
      }
      if (sessions.length === 0) return

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
              const rawDiff = (metadata as Record<string, unknown>).diffPercent
              const diffPercent = typeof rawDiff === "number" ? rawDiff : undefined
              await this.processScreenshot(
                sessions,
                part.sessionID,
                part.messageID,
                part.id,
                part.state.title,
                diffPercent,
                part.state.attachments ?? [],
              )
            }
          }

          // Post brief status for important tools (bash, edit, write, skill)
          const statusMsg = this.formatToolStatus(toolName, toolInput)
          if (statusMsg) {
            this.mirror("assistant", statusMsg, { sessionId: part.sessionID })
            for (const session of sessions) {
              await session.adapter.sendMessage(session.channel, session.thread, statusMsg).catch(() => {})
            }
          }
        }

        if (part.state?.status === "error") {
          const statusMsg = this.formatToolStatus(toolName, toolInput) ?? `\`${toolName}\``
          const err = String(part.state.error ?? "Unknown tool error")
          this.mirror("system", `${statusMsg} failed: ${err}`, { sessionId: part.sessionID })
          for (const session of sessions) {
            await session.adapter.sendMessage(session.channel, session.thread, `${statusMsg} failed: ${err}`).catch(() => {})
          }
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
              await this.handleEvent(event as Event)
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
