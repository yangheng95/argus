import { createOpencode, type OpencodeClient } from "@opencorvus-ai/sdk"
import type { BotAdapter, IncomingMessage } from "./adapter"
import type { SlackAdapter } from "./adapters/slack"
import type { STTPipeline } from "./stt/pipeline"
import type { VisionPipeline } from "./vision"

interface SessionEntry {
  sessionId: string
  adapter: BotAdapter
  channel: string
  thread: string
}

export interface BotCoreOptions {
  port?: number
}

export class BotCore {
  private sessions = new Map<string, SessionEntry>()
  /** Reverse lookup: sessionId → threadKey */
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
  /** Sessions currently being processed — new messages are queued until session.idle fires */
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
      await adapter.sendMessage(msg.channel, msg.thread, `⏳ 当前任务正在进行，您的消息已加入队列（第 ${queue.length} 条）。`)
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
    return [
      "## CRITICAL — Tool Usage Rules",
      "",
      "### Coding Tasks (create files, write code, build projects, fix bugs)",
      "You MUST use bash/write/edit/read/glob/grep tools DIRECTLY.",
      "- Create files: use the `write` tool with the full file path and content.",
      "- Run commands: use the `bash` tool.",
      "- Edit files: use the `edit` tool.",
      "- DO NOT use screen/input tools for coding — they are slow and unreliable for file operations.",
      "",
      "### GUI Tasks (desktop interaction, screenshots, app control)",
      "Use screen/input tools for visual desktop interaction.",
      "Workflow: screen.list_windows → screen.bind_window → screen.screenshot → input actions → verify.",
      "",
      "### TUI Coding Mode (for complex interactive coding sessions)",
      "When the user requests TUI or you need interactive coding with real-time feedback:",
      '1. Use bash to launch TUI: `bash("start \\"OPENCORVUS_TUI\\" cmd /c \\"cd /d PROJECT_DIR && packages\\\\bot\\\\launch-tui.cmd .\\"")` (Windows)',
      "2. Wait 5 seconds: `input.wait(5000)`",
      "3. Find TUI window: `screen.list_windows` → look for window with title containing 'OPENCORVUS'",
      "4. Bind to TUI: `screen.bind_window(\"OPENCORVUS\")`",
      "5. Screenshot TUI to see its interface",
      "6. Type your coding task into the TUI prompt via `input.type`, then press Enter",
      "7. Monitor TUI progress via periodic screenshots",
      "",
      "## Bot Context",
      `You are responding to a user via ${channel}. Keep responses concise and actionable.`,
      "Tool calls are invisible to the user — always write text before/after actions.",
      "",
      "## Task Context & Memory",
      "MANDATORY at the start of every new task: call memory(action: \"search\") before major actions.",
      "Search for the task topic to find past decisions and lessons learned.",
    ].join("\n")
  }

  /**
   * Inject a prompt directly into a Slack channel, bypassing the Slack message listener.
   * This creates a session bound to the channel so SSE events flow back to Slack.
   * Useful for automated testing with bot tokens.
   */
  async injectPrompt(platform: string, channel: string, text: string): Promise<void> {
    const adapter = this.adapters.find((a) => a.platform === platform) as SlackAdapter | undefined
    if (!adapter) throw new Error(`No adapter for platform: ${platform}`)

    // Post the prompt as a visible message and get its ts for threading
    const ts = await adapter.postAndGetTs(channel, `[OpenCorvus Task] ${text}`)

    // Treat it as an incoming message — this creates session + sends prompt
    await this.handleMessage({
      platform,
      channel,
      thread: ts,
      user: "system",
      text,
    })
  }

  /** Format a brief Slack status message for important tool completions */
  private formatToolStatus(tool: string, input: any): string | null {
    try {
      switch (tool) {
        case "bash": {
          const cmd = input?.command ?? ""
          const short = cmd.length > 80 ? cmd.slice(0, 80) + "..." : cmd
          return `\`$ ${short}\``
        }
        case "edit":
          return `\`edit ${input?.filePath ?? "file"}\``
        case "write":
          return `\`write ${input?.filePath ?? "file"}\``
        case "skill":
          return `\`skill: ${input?.name ?? "?"}\``
        case "screen": {
          const action = input?.action
          if (action === "bind_window") return `\`screen.bind_window: ${input?.title ?? "?"}\``
          if (action === "list_windows") return "`screen.list_windows`"
          if (action === "screenshot") return "`screen.screenshot`"
          return "`screen`"
        }
        case "input": {
          const action = input?.action
          if (action === "key") return `\`input.key: ${input?.key ?? "?"}\``
          if (action === "click") return `\`input.click: (${input?.x ?? "?"}, ${input?.y ?? "?"}) ${input?.button ?? "left"}\``
          if (action === "type") return `\`input.type: ${Math.min(String(input?.text ?? "").length, 999)} chars\``
          if (action === "wait") return `\`input.wait: ${input?.ms ?? "?"}ms\``
          if (action === "scroll") return `\`input.scroll: ${input?.direction ?? "?"} ${input?.amount ?? ""}\``
          if (action === "drag") return `\`input.drag: (${input?.startX ?? "?"}, ${input?.startY ?? "?"}) -> (${input?.endX ?? "?"}, ${input?.endY ?? "?"})\``
          if (action === "move") return `\`input.move: (${input?.x ?? "?"}, ${input?.y ?? "?"})\``
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
   * Fetch screenshot attachment from API, upload to Slack, and optionally
   * run vision analysis in parallel. Vision analysis text is posted as a
   * follow-up message in the Slack thread.
   */
  private async processScreenshot(
    session: SessionEntry,
    sessionId: string,
    messageId: string,
    partId: string,
    title: string,
    diffPercent?: number,
  ): Promise<void> {
    try {
      const msgResult = await this.client.session.message({
        sessionID: sessionId,
        messageID: messageId,
      })
      if (msgResult.error) return

      const parts = (msgResult.data as any).parts ?? []
      for (const p of parts) {
        if (p.id !== partId) continue
        for (const att of p.state?.attachments ?? []) {
          if (att.type === "file" && att.mime?.startsWith("image/")) {
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
        }
      }
    } catch (err) {
      console.error("[BotCore] processScreenshot error:", err)
    }
  }

  private async handleEvent(event: any): Promise<void> {
    // Session entered standby — clear processing flag and dequeue next pending message
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
          const truncated = text.length > 3900 ? text.slice(0, 3900) + "\n...(truncated)" : text
          await session.adapter.sendMessage(session.channel, session.thread, truncated).catch(() => {})
          console.log(`[BotCore] Sent text for ${info.sessionID} (${text.length} chars)`)
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
      if (part.type === "tool") {
        const toolName = part.tool
        const toolInput = part.state?.input

        if (part.state?.status === "completed") {
          // Upload screenshot images from screen tool
          if (toolName === "screen") {
            const hasImage = (part.state.attachments ?? []).some(
              (a: any) => a.type === "file" && a.mime?.startsWith("image/"),
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
