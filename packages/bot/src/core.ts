import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk"
import type { BotAdapter, IncomingMessage } from "./adapter"
import type { SlackAdapter } from "./adapters/slack"
import type { STTPipeline } from "./stt/pipeline"
import type { VisionPipeline } from "./vision"

// A2A event type definitions (mirrored from protocol.ts for bot-side use)
interface A2AEvent {
  type: string
  properties: Record<string, any>
}

interface SessionEntry {
  sessionId: string
  adapter: BotAdapter
  channel: string
  thread: string
}

export interface BotCoreOptions {
  port?: number
  a2a?: boolean
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
  /** Base URL of the Argus server */
  private serverUrl!: string

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
    const argus = await createOpencode({ port: this.options?.port ?? 0 })
    this.client = argus.client
    this.server = argus.server
    this.serverUrl = argus.server.url
    console.log(`[BotCore] Argus server running at ${this.serverUrl}`)

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
        body: { title: `${msg.platform} thread ${msg.thread}` },
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

    // Use promptAsync to bypass monitor command queue and execute directly.
    // System prompt is injected via the `system` field (appended to LLM system prompt in llm.ts:76).
    const result = await this.client.session.promptAsync({
      path: { id: session.sessionId },
      body: {
        parts: [{ type: "text", text }],
        system: this.buildSystemPrompt(),
      },
    })

    if (result.error) {
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
  private buildSystemPrompt(): string {
    return [
      "## Bot Context",
      "You are responding to a user via Slack. Keep responses concise and actionable.",
      "Tool calls are invisible to the user — always write text before/after actions.",
      "",
      "## Coding Tasks (Session API First)",
      "When asked to write or modify code, execute via Session API workflow (not TUI window automation):",
      "1. Keep using the current session context and submit the coding instruction as a normal prompt",
      "2. Wait for assistant completion and report concise progress/result to Slack",
      "3. Use TUI runtime only as optional visual monitor, never as execution source of truth",
      "",
      "## Non-Coding Tasks",
      "For questions that need real-time data (weather, news, stock prices, etc.), use available tools (web search, bash, etc.).",
      "For GUI tasks (screenshots, app interaction) — use screen/input tools directly.",
      "Only answer directly without tools when you are confident the answer is in your training data.",
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
    const ts = await adapter.postAndGetTs(channel, `[Argus Task] ${text}`)

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
        // screen, input, read, glob, grep — too noisy, skip
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
        path: { id: sessionId, messageID: messageId },
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
            const visionDiffThreshold = Number(process.env.ARGUS_MONITOR_DIFF_THRESHOLD) || 2
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

  /**
   * Handle A2A-specific events for Slack progress reporting.
   * These events come from the A2A orchestrator and provide
   * real-time updates about task execution progress.
   */
  private async handleA2AEvent(event: A2AEvent): Promise<void> {
    const props = event.properties
    const sessionId = props.sessionID
    if (!sessionId) return

    const session = this.findSession(sessionId)
    if (!session) return

    try {
      switch (event.type) {
        case "a2a.task.dispatched":
          await session.adapter.sendMessage(
            session.channel,
            session.thread,
            `🚀 *Task started*`,
          )
          break

        case "a2a.plan.ready":
          await session.adapter.sendMessage(
            session.channel,
            session.thread,
            `📋 *Plan ready* — ${props.stepCount} steps`,
          )
          break

        case "a2a.step.started":
          await session.adapter.sendMessage(
            session.channel,
            session.thread,
            `▶️ Step ${props.stepIndex + 1}/${props.totalSteps}: ${props.description}`,
          )
          break

        case "a2a.step.completed":
          if (props.success) {
            await session.adapter.sendMessage(
              session.channel,
              session.thread,
              `✅ Step completed${props.retryCount > 0 ? ` (${props.retryCount} retries)` : ""}`,
            )
          } else {
            await session.adapter.sendMessage(
              session.channel,
              session.thread,
              `❌ Step failed: ${(props.summary as string).slice(0, 200)}`,
            )
          }
          break

        case "a2a.replan.requested":
          await session.adapter.sendMessage(
            session.channel,
            session.thread,
            `🔄 *Re-planning* (attempt ${props.attempt}): ${(props.reason as string).slice(0, 200)}`,
          )
          break

        case "a2a.goal.evaluated":
          if (props.action === "achieved") {
            await session.adapter.sendMessage(
              session.channel,
              session.thread,
              `🎯 *Goal achieved!*`,
            )
          } else if (props.action === "deadlock") {
            await session.adapter.sendMessage(
              session.channel,
              session.thread,
              `⚠️ *Deadlock detected*: ${(props.reason as string).slice(0, 200)}`,
            )
          }
          break

        case "a2a.task.completed":
          const emoji = props.success ? "✅" : "❌"
          await session.adapter.sendMessage(
            session.channel,
            session.thread,
            `${emoji} *Task ${props.success ? "completed" : "failed"}*\n${(props.summary as string).slice(0, 500)}`,
          )
          break
      }
    } catch (err) {
      console.error("[BotCore] A2A event handler error:", err)
    }
  }

  private async handleEvent(event: any): Promise<void> {
    // Handle A2A events
    if (typeof event.type === "string" && event.type.startsWith("a2a.")) {
      await this.handleA2AEvent(event as A2AEvent)
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

      // Post tool progress for key tools so Slack users can see what's happening.
      if (part.type === "tool" && part.state?.status === "completed") {
        const toolName = part.tool
        const toolInput = part.state?.input

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
