import path from "node:path"
import { existsSync } from "node:fs"
import { spawn, type ChildProcess } from "node:child_process"
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
  /** Overlay Tauri process for visual feedback */
  private overlayProcess: ChildProcess | null = null
  /** Last known cursor position for overlay hints on non-spatial actions */
  private lastOverlayPos = { x: 960, y: 540 }
  /** Path to overlay binary (cached after first resolve) */
  private overlayBin: string | null = null
  /** Number of overlay restart attempts */
  private overlayRestarts = 0

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

  // --- Overlay Process Management ---

  async startOverlay(): Promise<void> {
    if (!this.overlayBin) {
      const projectRoot = path.resolve(import.meta.dirname, "../../..")
      const releaseBin = path.join(projectRoot, "packages", "overlay", "src-tauri", "target", "release", "opencorvus-overlay.exe")
      const debugBin = path.join(projectRoot, "packages", "overlay", "src-tauri", "target", "debug", "opencorvus-overlay.exe")
      this.overlayBin = existsSync(releaseBin) ? releaseBin : existsSync(debugBin) ? debugBin : null
    }
    if (!this.overlayBin) {
      console.log("[BotCore] Overlay binary not found, skipping overlay launch")
      return
    }

    try {
      const proc = spawn(this.overlayBin, [], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, OPENCORVUS_OVERLAY_STDIN_EXIT: "1", RUST_BACKTRACE: "1" },
      })

      this.overlayProcess = proc

      proc.stdout?.on("data", (data: Buffer) => {
        for (const line of data.toString().split("\n")) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)
            console.log(`[BotCore] Overlay reply: ${JSON.stringify(msg)}`)
          } catch {}
        }
      })

      proc.stderr?.on("data", (data: Buffer) => {
        const text = data.toString().trim()
        if (text) console.error(`[BotCore] Overlay stderr: ${text}`)
      })

      proc.on("exit", (code) => {
        console.log(`[BotCore] Overlay exited (code ${code})`)
        this.overlayProcess = null
        // Auto-restart up to 5 times if still running
        if (this.running && code !== 0 && this.overlayRestarts < 5) {
          this.overlayRestarts++
          console.log(`[BotCore] Auto-restarting overlay (attempt ${this.overlayRestarts}/5)...`)
          setTimeout(() => this.startOverlay(), 2000)
        }
      })

      console.log(`[BotCore] Overlay started (pid ${proc.pid}, bin: ${path.basename(path.dirname(this.overlayBin))})`)
    } catch (err) {
      console.error("[BotCore] Failed to start overlay:", err)
    }
  }

  private stopOverlay(): void {
    if (this.overlayProcess) {
      this.overlayProcess.kill()
      this.overlayProcess = null
      console.log("[BotCore] Overlay stopped")
    }
  }

  private sendOverlayEvent(event: Record<string, unknown>): void {
    if (!this.overlayProcess?.stdin?.writable) return
    try {
      this.overlayProcess.stdin.write(JSON.stringify(event) + "\n")
    } catch {}
  }

  private sendInputHint(input: any, status?: string): void {
    const action = input?.action
    if (!action || action === "wait") return

    let x: number, y: number, label: string

    switch (action) {
      case "click":
      case "double":
      case "right":
      case "middle":
        x = Number(input.x) || 0
        y = Number(input.y) || 0
        label = `${action} (${x}, ${y})`
        this.lastOverlayPos = { x, y }
        break
      case "scroll":
        x = Number(input.x) || this.lastOverlayPos.x
        y = Number(input.y) || this.lastOverlayPos.y
        label = `scroll ${input.direction ?? "?"}`
        break
      case "drag":
        x = Number(input.startX) || 0
        y = Number(input.startY) || 0
        label = `drag → (${input.endX ?? "?"}, ${input.endY ?? "?"})`
        this.lastOverlayPos = { x, y }
        break
      case "move":
        x = Number(input.x) || 0
        y = Number(input.y) || 0
        label = `move (${x}, ${y})`
        this.lastOverlayPos = { x, y }
        break
      case "type": {
        x = this.lastOverlayPos.x
        y = this.lastOverlayPos.y
        const text = String(input.text ?? "")
        label = text.length > 20 ? `type ${text.length} chars` : `type: ${text}`
        break
      }
      case "key":
        x = this.lastOverlayPos.x
        y = this.lastOverlayPos.y
        label = `key: ${input.key ?? "?"}`
        break
      default:
        return
    }

    this.sendOverlayEvent({ type: "hint", x, y, action, label, status })
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

    // Start overlay process for visual feedback
    await this.startOverlay()
  }

  async stop(): Promise<void> {
    this.running = false
    for (const adapter of this.adapters) {
      await adapter.stop()
    }
    this.server.close()
    this.stopOverlay()
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
    const projectRoot = path.resolve(import.meta.dirname, "../../..")
    const opencorvusSrc = path.join(projectRoot, "packages", "opencorvus", "src", "index.ts")
    return [
      `You are OpenCorvus — a coding and desktop automation assistant. The user talks to you via ${channel}, but they also watch your screen. They need to SEE what you're doing.`,
      "",
      "## The visibility principle",
      "Everything you do must be visible to the user. Using background tools (write, bash) to produce code silently is unacceptable — the user has no idea what you changed or whether it's correct.",
      "For coding tasks, open the OpenCorvus TUI first. The TUI runs in a real terminal window the user can watch, and it has full coding capabilities.",
      `TUI launch command (Windows): bash("start \\"OpenCorvus\\" cmd /c \\"bun --preload @opentui/solid/preload --conditions=browser ${opencorvusSrc} <project_dir>\\"")`,
      "After launching: use screen tools to bind to the TUI window, take a screenshot to confirm it's open, then type the coding task into its prompt.",
      "Exception: if the user explicitly asks for a specific tool ('use codex', 'use VS Code', 'run bash'), follow that instruction.",
      "",
      "## Desktop tasks",
      "Use screen/input tools to interact visually. Always describe what you see after each screenshot.",
      "",
      "## When something fails",
      "Find out why before trying again. Don't loop on the same broken action.",
      "",
      "## Memory",
      "Search memory at the start of each task to recall relevant past context.",
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

        // Send overlay hint when input tool starts executing
        if (toolName === "input" && part.state?.status === "running") {
          this.sendInputHint(toolInput)
        }

        if (part.state?.status === "completed") {
          // Send "done" overlay hint for input tool completion
          if (toolName === "input") {
            this.sendInputHint(toolInput, "done")
          }
          // Screen tool completions
          if (toolName === "screen") {
            // Highlight the bound window with overlay frame
            if (toolInput?.action === "bind_window") {
              const meta = part.state.metadata
              if (meta?.x !== undefined && meta?.width !== undefined) {
                this.sendOverlayEvent({
                  type: "window-highlight",
                  x: Number(meta.x),
                  y: Number(meta.y),
                  width: Number(meta.width),
                  height: Number(meta.height),
                  label: meta.title || meta.appName || "Target window",
                  duration_ms: 2500,
                })
              }
            }

            // Upload screenshot images
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
