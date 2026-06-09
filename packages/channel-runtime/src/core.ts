import path from "node:path"
import { createOpencode, createOpencodeClient, type Event, type OpencodeClient } from "@opencorvus-ai/sdk"
import { mkdir } from "node:fs/promises"
import type { ChannelAdapter, IncomingMessage } from "./adapter"
import type { STTPipeline } from "./stt/pipeline"
import type { VisionPipeline } from "./vision"
import {
  BOT_MESSAGE_LIMIT,
  formatToolStatus as formatToolStatusMessage,
  polishText,
  splitText,
} from "./message-formatter"
import { queueLimit as queueLimitRule } from "./channel-policy"
import { SessionCoordinator } from "./session-coordinator"

interface TaskReportProperties {
  sessionID: string
  status: "progress" | "need_input" | "done" | "failed"
  summary: string
  question?: string
  next_plan?: string
  artifacts?: string[]
  error?: string
}

interface Job {
  jobID: string
  sessionID: string
  turn: number
  status: "running" | "waiting_user"
  lastReport?: TaskReportProperties
  startedAt: number
  lastActivityAt: number
  channel: string
  thread: string
  adapter: ChannelAdapter
  platform: string
}

interface SessionEntry {
  sessionId: string
  adapter: ChannelAdapter
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
const controlPlatforms = [
  "slack",
  "telegram",
  "discord",
  "feishu",
  "whatsapp",
  "googlechat",
  "msteams",
  "line",
  "matrix",
  "mattermost",
  "signal",
  "wecom",
  "dingtalk",
  "qq",
] as const
type ControlPlatform = (typeof controlPlatforms)[number]
type ChannelAttachment = {
  mime: string
  url: string
  filename?: string
}
type ChannelResult = {
  kind: "panel_response" | "created" | "message" | "interaction" | "progress" | "task_list" | "cancelled"
  message: string
  task_id?: string
  attachments?: ChannelAttachment[]
}
type EventPermissionAsked = Extract<Event, { type: "permission.asked" }>
type EventSessionIdle = Extract<Event, { type: "session.idle" }>
type EventSessionError = Extract<Event, { type: "session.error" }>
type EventSessionStatus = Extract<Event, { type: "session.status" }>
type EventMessageUpdated = Extract<Event, { type: "message.updated" }>
type EventMessagePartUpdated = Extract<Event, { type: "message.part.updated" }>
type EventEvaluationCompleted = Extract<Event, { type: "evaluation.completed" }>
const MIRROR_PREFIX = "[opencorvus-mirror]"
type PendingTask = {
  taskId: string
  touch: number
}

export interface ChannelRuntimeOptions {
  port?: number
  baseUrl?: string
  sharedMode?: boolean
  sharedFile?: string
}

export class ChannelRuntime {
  private session = new SessionCoordinator<SessionEntry, IncomingMessage>()
  private adapters: ChannelAdapter[] = []
  private client!: OpencodeClient
  private server?: { url: string; close(): void }
  /** Buffer assistant text per messageID until message.updated signals completion */
  private textBuffers = new Map<string, string>()
  private static readonly TEXT_BUF_MAX = 200
  /** Track user message IDs to skip their parts */
  private userMessageIds = new Set<string>()
  private static readonly USER_MSG_MAX = 500
  private static readonly USER_MSG_TARGET = 400
  /** Buffer text captured from message.part.updated before we know the message role */
  private pendingPartTexts = new Map<string, string>()
  private static readonly PENDING_PART_MAX = 200
  private static readonly PENDING_PART_TARGET = 150
  /** Set to false by stop() to terminate the reconnect loop */
  private running = false
  private stt?: STTPipeline
  private vision?: VisionPipeline
  /** Base URL of the OpenCorvus server */
  private serverUrl!: string
  private sharedSessionId?: string
  private runtimeSession?: string
  /** Prevent creating duplicate overlay mirror threads */
  private overlayMirrorBound = false
  /** Active channel-runtime jobs keyed by sessionID */
  private jobs = new Map<string, Job>()
  private pending = new Map<string, PendingTask>()
  /** Guard against concurrent releaseSession() calls for the same session */
  private releasing = new Set<string>()
  private taskBindings = new Map<string, SessionEntry[]>()
  private taskByThread = new Map<string, string>()
  private pendingWatch: ReturnType<typeof setInterval> | null = null

  constructor(private options?: ChannelRuntimeOptions) {}

  setSTT(pipeline: STTPipeline): void {
    this.stt = pipeline
  }

  setVision(pipeline: VisionPipeline): void {
    this.vision = pipeline
  }

  get adapterCount(): number {
    return this.adapters.length
  }

  register(adapter: ChannelAdapter): this {
    this.adapters.push(adapter)
    return this
  }

  /** Send a message to a channel adapter with error logging (non-throwing). */
  private async safeSend(adapter: ChannelAdapter, channel: string, thread: string, message: string): Promise<void> {
    await adapter.sendMessage(channel, thread, message).catch((err) => {
      console.warn(`[ChannelRuntime] sendMessage failed (${adapter.platform ?? "unknown"} ${channel}):`, String(err))
    })
  }

  /**
   * audit-2026-04-29 W2-V14 — concurrent-start race. Pre-fix
   * `start()` had no idempotency guard. Two near-simultaneous
   * callers both saw `this.running === false` (only set on entry,
   * not before the await on `createOpencode`), and BOTH proceeded
   * to spawn an OpenCorvus server, register adapter handlers
   * twice, and call `subscribeEvents` twice — leaving a duplicate
   * SSE reconnect loop, double event dispatch, and (in the
   * non-baseUrl branch) port collision on the second
   * `createOpencode`.
   *
   * Hold an in-flight Promise so concurrent callers share the
   * single startup; subsequent calls after a successful start are
   * a no-op. This mirrors the pendingStart pattern in
   * vscode-extension/extension.ts and the start-once contract in
   * Server.listen.
   */
  private startPromise: Promise<void> | undefined

  async start(): Promise<void> {
    if (this.running) return
    if (this.startPromise) return this.startPromise
    this.startPromise = this._doStart()
      .catch((err) => {
        // Roll back the running flag so a failure (createOpencode
        // throwing, adapter rejection, etc.) doesn't block a
        // legitimate retry. The throw still propagates to the
        // caller so the failure is loud (CLAUDE.md §一-7).
        this.running = false
        throw err
      })
      .finally(() => {
        this.startPromise = undefined
      })
    return this.startPromise
  }

  private async _doStart(): Promise<void> {
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
    console.log(`[ChannelRuntime] OpenCorvus server running at ${this.serverUrl}`)

    this.subscribeEvents()
    this.startPendingWatch()

    const started = await Promise.allSettled(
      this.adapters.map(async (adapter) => {
        adapter.onMessage((msg) => this.handleMessage(msg))
        await adapter.start()
        return adapter
      }),
    )
    this.adapters = started.flatMap((item) => (item.status === "fulfilled" ? [item.value] : []))
    started
      .filter((item) => item.status === "rejected")
      .forEach((item) => {
        console.error("[ChannelRuntime] adapter start failed:", item.reason)
      })
    if (this.adapters.length === 0) {
      console.warn("[ChannelRuntime] No chat adapter started successfully.")
    }

    // Pre-load shared session ID so overlay-originated events can be mirrored to Slack
    // even before the first Slack message arrives (which would otherwise populate sharedSessionId).
    if (this.sharedMode() && !this.sharedSessionId) {
      const fromFile = await this.readSharedSessionFile()
      if (fromFile) {
        this.sharedSessionId = fromFile
        console.log(`[ChannelRuntime] Pre-loaded shared session: ${fromFile}`)
      }
    }

    // Overlay is managed by OpenCorvus's overlay-client.ts (spawned on first tool use)
  }

  async stop(): Promise<void> {
    this.running = false
    this.runtimeSession = undefined
    this.stopPendingWatch()
    this.pending.clear()
    this.taskBindings.clear()
    this.taskByThread.clear()
    this.textBuffers.clear()
    this.userMessageIds.clear()
    this.pendingPartTexts.clear()
    this.jobs.clear()
    this.releasing.clear()
    this.session.clear()
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
          console.log(`[ChannelRuntime] Transcribed voice (${result.provider}, ${result.durationMs}ms)`)
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

    if (this.channelProtocol(msg.platform)) {
      await this.handleChannelMessage(msg as IncomingMessage & { platform: ControlPlatform }, adapter, text)
      return
    }

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
        console.log(`[ChannelRuntime] Bound ${threadKey} to shared session ${sharedId}`)
      }
      if (!shared) {
        const createResult = await this.client.session.create({
          title: `${msg.platform} thread ${msg.thread}`,
        })

        if (createResult.error || !createResult.data) {
          console.error("[ChannelRuntime] session.create error:", JSON.stringify(createResult.error).slice(0, 500))
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
        console.log(`[ChannelRuntime] Created session ${createResult.data.id} for ${threadKey}`)
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

    // If there is an active job waiting for user input, treat this message as the answer
    const activeJob = this.jobs.get(session.sessionId)
    if (activeJob?.status === "waiting_user") {
      activeJob.status = "running"
      activeJob.turn++
      activeJob.lastActivityAt = Date.now()
      activeJob.lastReport = undefined
      this.session.start(session.sessionId)
      await this.client.session.promptAsync({
        sessionID: session.sessionId,
        parts: [{ type: "text", text }],
        system: this.buildSystemPrompt(msg.platform),
      })
      return
    }

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
        await adapter.sendMessage(msg.channel, msg.thread, notice)
        console.warn(`[ChannelRuntime] Dropped message for ${session.sessionId}, queue limit reached: ${queue.limit}`)
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
      console.log(`[ChannelRuntime] Queued message for ${session.sessionId}, queue size: ${queue.size}`)
      return
    }

    // Mark session as processing before sending prompt
    this.session.start(session.sessionId)

    // Create a new job to track this task through the channel-runtime loop
    this.jobs.set(session.sessionId, {
      jobID: Math.random().toString(36).slice(2),
      sessionID: session.sessionId,
      turn: 0,
      status: "running",
      lastReport: undefined,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      channel: session.channel,
      thread: session.thread,
      adapter: session.adapter,
      platform: msg.platform,
    })

    const result = await this.submitTask(session.sessionId, text, msg.platform)
    if (result !== "ok") {
      this.clearPending(session.sessionId)
      this.session.stop(session.sessionId)
      this.jobs.delete(session.sessionId)
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
  }

  private async submitTask(sessionID: string, text: string, platform: string) {
    if (this.taskMode() === "tui-runtime") {
      const runtimeReady = await this.startRuntime(sessionID)
      if (!runtimeReady) {
        return "failed" as const
      }
      const result = await this.client.tui.runtime.submitTask({
        sessionID,
        text,
        wait: false,
      })
      if (!result.error) {
        const data = result.data as
          | {
              accepted?: boolean
              taskID?: string | null
              completed?: boolean
              waited?: boolean
            }
          | undefined
        if (data?.accepted) {
          const taskId =
            typeof data.taskID === "string" && data.taskID.trim() ? data.taskID.trim() : this.taskId(sessionID)
          this.markPending(sessionID, taskId)
          console.log(
            `[ChannelRuntime] Task accepted via tui.runtime.submitTask for session ${sessionID} (task=${taskId}, waited=${data?.waited ? "true" : "false"})`,
          )
          return "ok" as const
        }
        console.warn(
          `[ChannelRuntime] tui.runtime.submitTask did not accept task for session ${sessionID} (waited=${data?.waited ? "true" : "false"})`,
        )
      }
      console.error("[ChannelRuntime] tui.runtime.submitTask error:", JSON.stringify(result.error).slice(0, 500))
      return "failed" as const
    }

    const result = await this.client.session.promptAsync({
      sessionID,
      parts: [{ type: "text", text }],
      system: this.buildSystemPrompt(platform),
    })
    if (result.error) {
      console.error("[ChannelRuntime] session.promptAsync error:", JSON.stringify(result.error).slice(0, 500))
      return "failed" as const
    }
    this.markPending(sessionID, this.taskId(sessionID))
    console.log(`[ChannelRuntime] Prompt sent via session.promptAsync for session ${sessionID}`)
    return "ok" as const
  }

  private async startRuntime(sessionID: string) {
    if (this.runtimeSession === sessionID) return true

    const directory = process.env.OPENCORVUS_PROJECT_DIR?.trim() || process.cwd()
    const bin = process.env.OPENCORVUS_BIN_PATH?.trim()
    const result = await this.client.tui.runtime.start({
      mode: "spawn",
      directory,
      sessionID,
      ...(bin ? { bin } : {}),
    })
    if (result.error) {
      console.error("[ChannelRuntime] tui.runtime.start error:", JSON.stringify(result.error).slice(0, 500))
      return false
    }

    this.runtimeSession = sessionID
    console.log(`[ChannelRuntime] TUI runtime started for session ${sessionID}`)
    return true
  }

  private taskMode() {
    const raw = process.env.OPENCORVUS_CHANNEL_TASK_MODE?.trim().toLowerCase()
    if (raw === "session-async") return "session-async"
    return "tui-runtime"
  }

  /**
   * Build channel-runtime system prompt injected via the API's `system` field.
   * Provides operational context: remote interaction mode, TUI launch instructions,
   * and window binding strategy for on-demand TUI.
   */
  private buildSystemPrompt(platform: string): string {
    const channel = platform === "slack" ? "Slack" : platform === "discord" ? "Discord" : platform
    return [
      `You are OpenCorvus - a coding and desktop automation assistant. The user talks to you via ${channel}, and they also watch your screen. They need to SEE what you are doing.`,
      "",
      "## The visibility principle",
      "Everything you do must be visible to the user. Using background tools (write, bash) to produce code silently is unacceptable - the user has no idea what you changed or whether it is correct.",
      "For coding tasks, open a visible coding tool first:",
      '- **Claude Code**: `bash(\'start "Claude Code" cmd /k "set CLAUDECODE= && set CLAUDE_CODE_SSE_PORT= && claude"\')` — opens in a new terminal',
      '- **OpenCorvus TUI (preferred)**: use the `tui` tool, e.g. `tui({ action: "start", mode: "spawn", directory: "<project_dir>" })`',
      '- Then submit coding work with `tui({ action: "submit_task", text: "<task>", wait: true })`',
      "- Do NOT use `bun --preload ... src/index.ts` style launch commands in packaged/runtime environments.",
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
      "### After focus-changing shortcuts (Win+I, Win+E, Alt+Tab, etc.)",
      "The system auto-detects focus changes. Your next screenshot will capture the newly focused window.",
      "If the screenshot doesn't show the expected window, use `screen.list_windows` to find it, then `screen.bind_window`.",
      "Do NOT repeat the same shortcut if the first attempt opened the window — instead, rebind to see it.",
      "",
      "### Claude Code window binding workflow:",
      '1. `bash(\'start "Claude Code" cmd /k "set CLAUDECODE= && set CLAUDE_CODE_SSE_PORT= && claude"\')` to launch',
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
      "Use screen/input tools to interact visually. After screenshots: note key state + coordinates briefly (1 line). No verbose descriptions.",
      "",
      "## When something fails",
      "Read the error message carefully. Fix the exact issue before retrying. Don't loop on the same broken action.",
      "If a tool says 'invalid arguments', check the parameter constraints above.",
      "",
      "## Memory",
      "Search memory at the start of each task to recall relevant past context.",
      "",
      "## Task Loop Protocol (MANDATORY in managed channel mode)",
      "You are running inside a managed channel coding loop. At the end of EVERY turn you MUST call the `task_report` tool:",
      "- `task_report(status='progress', summary='...', next_plan='...')` — made progress, need more turns",
      "- `task_report(status='need_input', summary='...', question='...')` — cannot proceed without user answer",
      "- `task_report(status='done', summary='...', artifacts=[...])` — task fully complete",
      "- `task_report(status='failed', summary='...', error='...')` — unrecoverable error",
      "Never end a turn without calling task_report. It is the channel runtime's signal to continue or wait.",
    ].join("\n")
  }

  private channelProtocol(platform: string): platform is ControlPlatform {
    return process.env.OPENCORVUS_CHANNEL_PROTOCOL === "1" && controlPlatforms.includes(platform as ControlPlatform)
  }

  private async handleChannelMessage(
    msg: IncomingMessage & { platform: ControlPlatform },
    adapter: ChannelAdapter,
    text: string,
  ) {
    const result = await this.client.channel.message({
      platform: msg.platform as ControlPlatform,
      channel: msg.channel,
      thread: msg.thread,
      text,
      user_id: msg.user,
      source: msg.platform,
      allow_create: true,
    })
    if (result.error) {
      const notice = "Failed to handle message."
      this.mirror("system", notice, {
        platform: msg.platform,
        channel: msg.channel,
        thread: msg.thread,
      })
      await adapter.sendMessage(msg.channel, msg.thread, notice)
      return
    }
    const data = result.data as ChannelResult
    if (data.task_id) {
      this.bindTask(data.task_id, {
        sessionId: data.task_id,
        adapter,
        channel: msg.channel,
        thread: msg.thread,
      })
    }
    await this.sendChannelResult(adapter, msg.channel, msg.thread, data)
  }

  private polish(text: string): string {
    return polishText(text)
  }

  private split(text: string, limit = BOT_MESSAGE_LIMIT): string[] {
    return splitText(text, limit)
  }

  private bindTask(taskID: string, entry: SessionEntry) {
    const key = `${entry.adapter.platform}:${entry.channel}:${entry.thread}`
    const previous = this.taskByThread.get(key)
    if (previous && previous !== taskID) {
      const next = (this.taskBindings.get(previous) ?? []).filter((item) => !sameEntry(item, entry))
      if (next.length > 0) this.taskBindings.set(previous, next)
      else this.taskBindings.delete(previous)
    }
    this.taskByThread.set(key, taskID)
    const current = this.taskBindings.get(taskID) ?? []
    if (current.some((item) => sameEntry(item, entry))) return
    this.taskBindings.set(taskID, [...current, entry])
  }

  private findTaskBindings(taskID: string) {
    return this.taskBindings.get(taskID) ?? []
  }

  private async sendChannelResult(adapter: ChannelAdapter, channel: string, thread: string, result: ChannelResult) {
    if (result.message.trim()) {
      await adapter.sendMessage(channel, thread, result.message)
    }
    for (const item of result.attachments ?? []) {
      const image = imageAttachment(item)
      if (!image) continue
      if (adapter.uploadImageUrl) {
        try {
          const url = await this.publishChannelAttachment(item.mime, image.buffer, image.filename)
          await adapter.uploadImageUrl(channel, thread, url, image.filename, result.message || image.filename)
          continue
        } catch (error) {
          console.warn("[ChannelRuntime] uploadImageUrl fallback:", error)
        }
      }
      await adapter.uploadImage(channel, thread, image.buffer, image.filename, result.message || image.filename)
    }
  }

  private async publishChannelAttachment(mime: string, buffer: Buffer, filename: string) {
    const res = await fetch(`${this.serverUrl.replace(/\/+$/, "")}/channel/attachment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mime,
        filename,
        data: buffer.toString("base64"),
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      throw new Error(`channel attachment publish failed: ${res.status} ${await res.text()}`)
    }
    const data = (await res.json()) as { url?: string }
    if (!data.url) throw new Error("channel attachment publish failed: missing url")
    return data.url
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

  private mirrorSessions(
    kind: "user" | "assistant" | "system",
    text: string,
    sessionId: string,
    sessions: SessionEntry[],
  ) {
    if (sessions.length === 0) {
      this.mirror(kind, text, { sessionId })
      return
    }
    const seen = new Set<string>()
    for (const item of sessions) {
      const key = `${item.adapter.platform}:${item.channel}:${item.thread}`
      if (seen.has(key)) continue
      seen.add(key)
      this.mirror(kind, text, {
        sessionId,
        platform: item.adapter.platform,
        channel: item.channel,
        thread: item.thread,
      })
    }
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
    // File may not exist or contain invalid JSON on first startup
    const raw = (await Bun.file(file)
      .json()
      .catch(() => undefined)) as { session_id?: unknown } | undefined
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
    if (createResult.error || !createResult.data) {
      console.error("[ChannelRuntime] shared session.create error:", JSON.stringify(createResult.error).slice(0, 500))
      return undefined
    }

    this.sharedSessionId = createResult.data.id
    await this.writeSharedSessionFile(createResult.data.id).catch((err) => {
      console.warn("[ChannelRuntime] shared session file write failed:", err)
    })
    console.log(`[ChannelRuntime] Created shared session ${createResult.data.id}`)
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

  private taskId(sessionId: string) {
    return `task_${sessionId.slice(-6)}_${Date.now().toString(36)}`
  }

  private pendingTimeout() {
    const raw = Number(process.env.OPENCORVUS_CHANNEL_TASK_TIMEOUT_MS)
    if (!Number.isFinite(raw) || raw <= 0) return 10 * 60 * 1000
    if (raw < 1_000) return 1_000
    return Math.floor(raw)
  }

  private pendingSweepMs() {
    const raw = Number(process.env.OPENCORVUS_CHANNEL_TASK_SWEEP_MS)
    if (!Number.isFinite(raw) || raw <= 0) return 5_000
    if (raw < 1_000) return 1_000
    return Math.floor(raw)
  }

  private startPendingWatch() {
    if (this.pendingWatch) return
    this.pendingWatch = setInterval(() => {
      this.expirePending().catch((err) => console.error("[ChannelRuntime] pending watchdog error:", err))
    }, this.pendingSweepMs())
    this.pendingWatch.unref?.()
  }

  private stopPendingWatch() {
    if (!this.pendingWatch) return
    clearInterval(this.pendingWatch)
    this.pendingWatch = null
  }

  private markPending(sessionId: string, taskId: string) {
    this.pending.set(sessionId, {
      taskId,
      touch: Date.now(),
    })
  }

  private touchPending(sessionId: string) {
    const item = this.pending.get(sessionId)
    if (!item) return
    item.touch = Date.now()
  }

  private clearPending(sessionId: string) {
    this.pending.delete(sessionId)
  }

  private releaseSession(sessionId: string) {
    // Guard: prevent concurrent release for the same session (e.g. session.idle + expirePending)
    if (this.releasing.has(sessionId)) return
    this.releasing.add(sessionId)

    this.clearPending(sessionId)
    const job = this.jobs.get(sessionId)

    // If there is a pending task_report driving the loop, handle it before releasing
    if (job?.lastReport) {
      const report = job.lastReport
      job.lastReport = undefined

      if (report.status === "progress") {
        // Continue loop: keep processing flag set, send continuation prompt
        job.turn++
        job.lastActivityAt = Date.now()
        const continuationText = report.next_plan
          ? `Continue. Next step: ${report.next_plan}`
          : "Continue with the task."
        this.client.session
          .promptAsync({
            sessionID: sessionId,
            parts: [{ type: "text", text: continuationText }],
            system: this.buildSystemPrompt(job.platform),
          })
          .then((result) => {
            this.releasing.delete(sessionId)
            if (result.error) {
              console.error("[ChannelRuntime] loop continuation API error:", JSON.stringify(result.error).slice(0, 500))
              this.jobs.delete(sessionId)
              this.session.stop(sessionId)
              const next = this.session.dequeue(sessionId)
              if (next.item)
                this.handleMessage(next.item.msg).catch((err) =>
                  console.error("[ChannelRuntime] dequeue handleMessage error:", err),
                )
            } else {
              this.markPending(sessionId, this.taskId(sessionId))
            }
          })
          .catch((err) => {
            this.releasing.delete(sessionId)
            console.error("[ChannelRuntime] loop continuation error:", err)
            this.jobs.delete(sessionId)
            this.session.stop(sessionId)
            const next = this.session.dequeue(sessionId)
            if (next.item)
              this.handleMessage(next.item.msg).catch((err) =>
                console.error("[ChannelRuntime] dequeue handleMessage error:", err),
              )
          })
        return
      }

      if (report.status === "need_input") {
        // Stop processing so the next user message is treated as an answer
        job.status = "waiting_user"
        this.session.stop(sessionId)
        this.releasing.delete(sessionId)
        return
      }

      // done or failed: fall through to normal release
      this.jobs.delete(sessionId)
    } else if (job) {
      // Agent ended without calling task_report — clean up job
      this.jobs.delete(sessionId)
    }

    this.session.stop(sessionId)
    this.releasing.delete(sessionId)
    const next = this.session.dequeue(sessionId)
    if (!next.item) return
    this.handleMessage(next.item.msg).catch((err) =>
      console.error("[ChannelRuntime] dequeue handleMessage error:", err),
    )
  }

  private async pendingStatus(taskId: string) {
    const res = await fetch(`${this.serverUrl}/tui/runtime/task-status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskID: taskId }),
      signal: AbortSignal.timeout(4_000),
    }).catch(() => null)
    if (!res?.ok) return null
    const body = (await res.json().catch(() => null)) as {
      found?: boolean
      status?: string
      terminal?: boolean
      error?: string | null
    } | null
    if (!body || body.found !== true) return null
    return {
      status: typeof body.status === "string" ? body.status : "",
      terminal: body.terminal === true,
      error: typeof body.error === "string" && body.error.trim() ? body.error.trim() : null,
    }
  }

  private async expirePending() {
    if (this.pending.size === 0) return
    const now = Date.now()
    const timeout = this.pendingTimeout()
    for (const [sessionId, item] of Array.from(this.pending.entries())) {
      const status = await this.pendingStatus(item.taskId)
      if (status && !status.terminal) {
        this.touchPending(sessionId)
        continue
      }
      if (status?.terminal) {
        this.releaseSession(sessionId)
        if (status.status !== "failed") continue
        const sessions = this.findSessions(sessionId)
        if (sessions.length === 0) continue
        const msg = status.error ? `Task failed (${item.taskId}): ${status.error}` : `Task failed (${item.taskId}).`
        this.mirrorSessions("system", msg, sessionId, sessions)
        for (const session of sessions) {
          await this.safeSend(session.adapter, session.channel, session.thread, msg)
        }
        continue
      }
      if (now - item.touch < timeout) continue
      this.releaseSession(sessionId)
      const sessions = this.findSessions(sessionId)
      if (sessions.length === 0) continue
      const sec = Math.floor(timeout / 1000)
      const msg = `Task timed out after ${sec}s (${item.taskId}). Queue released.`
      this.mirrorSessions("system", msg, sessionId, sessions)
      for (const session of sessions) {
        await this.safeSend(session.adapter, session.channel, session.thread, msg)
      }
    }
  }

  private queueLimit() {
    return queueLimitRule(process.env)
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
      console.log(`[ChannelRuntime] Overlay mirror thread created: ${channel}:${ts} for session ${sessionId}`)
      return [entry]
    } catch (err) {
      this.overlayMirrorBound = false
      console.warn("[ChannelRuntime] Failed to create overlay mirror thread:", err)
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
      let attachments = (initialAttachments ?? []).filter(
        (att) => att.type === "file" && att.mime?.startsWith("image/"),
      )
      if (attachments.length === 0) {
        const msgResult = await this.client.session.message({
          sessionID: sessionId,
          messageID: messageId,
        })
        if (msgResult.error) return
        const data = msgResult.data as { parts?: SessionMessagePart[] }
        const part = (data.parts ?? []).find((p) => p.id === partId)
        attachments = (part?.state?.attachments ?? []).filter(
          (att) => att.type === "file" && att.mime?.startsWith("image/"),
        )
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
          console.log(
            `[ChannelRuntime] Vision skipped: screenshot too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB > 7MB)`,
          )
        }

        // Skip vision for trivial screen changes (cursor blinks, etc.)
        const visionDiffThreshold = Number(process.env.OPENCORVUS_MONITOR_DIFF_THRESHOLD) || 2
        const lowDiff = diffPercent !== undefined && diffPercent < visionDiffThreshold
        if (lowDiff) {
          console.log(
            `[ChannelRuntime] Vision skipped: low screen change (${diffPercent.toFixed(1)}% < ${visionDiffThreshold}% threshold)`,
          )
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
              console.warn("[ChannelRuntime] Vision analysis failed:", err)
              return null
            })
          : Promise.resolve(null)

        const [, visionResult] = await Promise.all([uploadPromise, visionPromise])

        console.log(`[ChannelRuntime] Uploaded screenshot (${(buffer.length / 1024).toFixed(0)}KB)`)

        if (visionResult) {
          console.log(
            `[ChannelRuntime] Vision analysis (${visionResult.tokens.prompt + visionResult.tokens.completion} tokens): ${visionResult.description.slice(0, 120)}...`,
          )
        }
      }
    } catch (err) {
      console.error("[ChannelRuntime] processScreenshot error:", err)
    }
  }

  private async handleEvent(event: Event): Promise<void> {
    // Engine emits evaluation.completed when acceptance's adversarial verification
    // finishes. Push the verdict back to every channel thread bound to the task
    // so chat operators see acceptance/rejection without polling.
    // (Earlier code checked "engine.evaluation.completed" — that prefix is
    //  stripped by the orchestrator route before SSE, so the SDK type is the
    //  bare "evaluation.completed".)
    if (event.type === "evaluation.completed") {
      const info = (event as EventEvaluationCompleted).properties
      const sessions = this.findTaskBindings(info.taskID)
      if (sessions.length === 0) return
      const msg = `Evaluation ${info.verdict}: ${info.summary}`
      for (const session of sessions) {
        await this.safeSend(session.adapter, session.channel, session.thread, msg)
      }
      return
    }

    if (event.type === "session.status") {
      const info = (event as EventSessionStatus).properties
      if (!info.sessionID) return
      if (info.status.type !== "idle") {
        this.touchPending(info.sessionID)
        return
      }
      const pending = this.pending.get(info.sessionID)
      if (!pending) return
      const status = await this.pendingStatus(pending.taskId)
      if (status?.terminal) {
        this.releaseSession(info.sessionID)
      }
      return
    }

    // task.report: agent signals loop status via the task_report tool
    const eventObj = event as { type?: string; properties?: unknown }
    if (eventObj.type === "task.report") {
      const report = eventObj.properties as TaskReportProperties
      const job = this.jobs.get(report.sessionID)
      if (!job) return

      job.lastReport = report
      job.lastActivityAt = Date.now()
      // Touch pending watchdog so it doesn't time out during a long loop
      this.touchPending(report.sessionID)

      if (report.status === "progress") {
        const msg = `[Turn ${job.turn}] ${report.summary}`
        await this.safeSend(job.adapter, job.channel, job.thread, msg)
        this.mirrorSessions("assistant", msg, report.sessionID, this.findSessions(report.sessionID))
      } else if (report.status === "need_input") {
        const msg = `? ${report.question ?? report.summary}`
        await this.safeSend(job.adapter, job.channel, job.thread, msg)
        this.mirrorSessions("assistant", msg, report.sessionID, this.findSessions(report.sessionID))
      } else if (report.status === "done") {
        const artifactsLine = report.artifacts?.length ? `\nFiles: ${report.artifacts.join(", ")}` : ""
        const msg = `Done (${job.turn + 1} turns): ${report.summary}${artifactsLine}`
        await this.safeSend(job.adapter, job.channel, job.thread, msg)
        this.mirrorSessions("assistant", msg, report.sessionID, this.findSessions(report.sessionID))
      } else if (report.status === "failed") {
        const msg = `Failed: ${report.error ?? report.summary}`
        await this.safeSend(job.adapter, job.channel, job.thread, msg)
        this.mirrorSessions("system", msg, report.sessionID, this.findSessions(report.sessionID))
      }
      return
    }

    if (event.type === "permission.asked") {
      const asked = (event as EventPermissionAsked).properties as PermissionAsked
      this.touchPending(asked.sessionID)
      const sessions = this.findSessions(asked.sessionID)
      const patterns = asked.patterns.length > 0 ? asked.patterns.join(", ") : "*"
      this.mirrorSessions(
        "system",
        `Permission requested: ${asked.permission} [${patterns}]`,
        asked.sessionID,
        sessions,
      )
      for (const session of sessions) {
        await this.safeSend(
          session.adapter,
          session.channel,
          session.thread,
          `Permission requested: ${asked.permission} [${patterns}]. Waiting for operator reply.`,
        )
      }
      console.log(`[ChannelRuntime] Permission request ${asked.id} is waiting for operator reply`)
      return
    }

    // Session entered standby - clear processing flag and dequeue next pending message
    if (event.type === "session.idle") {
      const sessionId = (event as EventSessionIdle).properties.sessionID
      if (sessionId) {
        this.releaseSession(sessionId)
      }
      return
    }

    if (event.type === "session.error") {
      const props = (event as EventSessionError).properties
      const sessionId = props.sessionID
      if (!sessionId) return
      this.releaseSession(sessionId)
      const sessions = this.findSessions(sessionId)
      if (sessions.length === 0) return
      const msg = (() => {
        const error = props.error
        if (!error) return "Session failed."
        const data = "data" in error ? error.data : undefined
        const detail =
          data && typeof data === "object" && "message" in data && typeof data.message === "string"
            ? data.message
            : undefined
        if (detail) return `Session failed: ${detail}`
        return `Session failed: ${String(error.name ?? "unknown_error")}`
      })()
      this.mirrorSessions("system", msg, sessionId, sessions)
      for (const session of sessions) {
        await this.safeSend(session.adapter, session.channel, session.thread, msg)
      }
      return
    }

    // Track user message IDs so we can skip their parts
    if (event.type === "message.updated") {
      const info = (event as EventMessageUpdated).properties.info
      this.touchPending(info.sessionID)

      if (info.role === "user") {
        // Track on first event only; message.updated fires twice for the same user message
        const isNew = !this.userMessageIds.has(info.id)
        this.userMessageIds.add(info.id)
        // Prevent unbounded growth — evict oldest entries when limit reached
        if (this.userMessageIds.size > ChannelRuntime.USER_MSG_MAX) {
          const iter = this.userMessageIds.values()
          const evictCount = this.userMessageIds.size - ChannelRuntime.USER_MSG_TARGET
          for (let i = 0; i < evictCount; i++) {
            const val = iter.next().value
            if (val !== undefined) this.userMessageIds.delete(val)
          }
        }

        // In shared mode, mirror the user's overlay prompt to Slack.
        // message.part.updated arrives BEFORE this event and pre-captured the text in pendingPartTexts.
        if (isNew && this.sharedMode() && info.sessionID === this.sharedSessionId) {
          // Clean up any user text that leaked into textBuffers before role was known
          this.textBuffers.delete(info.id)
          const userText = this.pendingPartTexts.get(info.id)
          this.pendingPartTexts.delete(info.id)
          if (userText) {
            let sessions = this.findSessions(info.sessionID)
            if (sessions.length === 0) sessions = await this.bindOverlayMirrorIfNeeded(info.sessionID)
            for (const session of sessions) {
              await this.safeSend(session.adapter, session.channel, session.thread, `> ${userText.trim()}`)
            }
          }
        }
        return
      }

      // Flush buffered text when assistant message (one agentic step) completes
      if (info.role === "assistant" && info.time.completed) {
        const text = this.textBuffers.get(info.id)
        this.textBuffers.delete(info.id)
        if (info.parentID) {
          this.userMessageIds.delete(info.parentID)
          this.pendingPartTexts.delete(info.parentID)
          this.textBuffers.delete(info.parentID)
        }
        let sessions = this.findSessions(info.sessionID)
        if (sessions.length === 0 && this.sharedMode() && info.sessionID === this.sharedSessionId) {
          sessions = await this.bindOverlayMirrorIfNeeded(info.sessionID)
        }
        if (sessions.length === 0) return

        if (text) {
          const polished = this.polish(text)
          if (polished) {
            for (const part of this.split(polished, BOT_MESSAGE_LIMIT)) {
              this.mirrorSessions("assistant", part, info.sessionID, sessions)
              for (const session of sessions) {
                await this.safeSend(session.adapter, session.channel, session.thread, part)
              }
            }
          }
          console.log(`[ChannelRuntime] Sent text for ${info.sessionID} (${polished.length} chars)`)
        }

        if (info.error) {
          const errObj = info.error as Record<string, unknown>
          const errMsg = typeof errObj?.error === "string" ? errObj.error : JSON.stringify(info.error)
          this.mirrorSessions("system", `Error: ${errMsg}`, info.sessionID, sessions)
          for (const session of sessions) {
            await this.safeSend(session.adapter, session.channel, session.thread, `Error: ${errMsg}`)
          }
        }
      }
    }

    if (event.type === "message.part.updated") {
      const part = (event as EventMessagePartUpdated).properties.part
      this.touchPending(part.sessionID)

      // In shared mode, pre-capture text parts before we know the message role.
      // message.part.updated fires BEFORE message.updated(role=user), so we store
      // the text here and consume it when message.updated confirms role=user.
      if (this.sharedMode() && part.sessionID === this.sharedSessionId && part.type === "text" && part.text?.trim()) {
        this.pendingPartTexts.set(part.messageID, part.text)
        // Prevent unbounded growth — evict oldest entries when limit reached
        if (this.pendingPartTexts.size > ChannelRuntime.PENDING_PART_MAX) {
          const iter = this.pendingPartTexts.keys()
          const evictCount = this.pendingPartTexts.size - ChannelRuntime.PENDING_PART_TARGET
          for (let i = 0; i < evictCount; i++) {
            const key = iter.next().value
            if (key !== undefined) this.pendingPartTexts.delete(key)
          }
        }
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
        // Safety cap — entries are normally flushed on message.updated but may leak on abort
        if (this.textBuffers.size > ChannelRuntime.TEXT_BUF_MAX) {
          const iter = this.textBuffers.keys()
          const val = iter.next().value
          if (val !== undefined) this.textBuffers.delete(val)
        }
      }

      // Post tool progress for key tools so remote channel users can see what happened.
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
            this.mirrorSessions("assistant", statusMsg, part.sessionID, sessions)
            for (const session of sessions) {
              await this.safeSend(session.adapter, session.channel, session.thread, statusMsg)
            }
          }
        }

        if (part.state?.status === "error") {
          const statusMsg = this.formatToolStatus(toolName, toolInput) ?? `\`${toolName}\``
          // Mirrors packages/opencorvus/src/session/tool-failure-cause.ts:renderToolFailureCause.
          // channel-runtime only depends on @opencorvus-ai/sdk (generated types,
          // no runtime exports), so we cannot import the renderer directly.
          const failure = (
            part.state as { failure?: { kind?: string; name?: string; originSite?: string; message?: string } }
          ).failure
          const err = failure?.message
            ? `${failure.kind ?? ""}/${failure.name ?? ""} at ${failure.originSite ?? "unknown"}: ${failure.message}`
            : "Unknown tool error"
          this.mirrorSessions("system", `${statusMsg} failed: ${err}`, part.sessionID, sessions)
          for (const session of sessions) {
            await this.safeSend(session.adapter, session.channel, session.thread, `${statusMsg} failed: ${err}`)
          }
        }
      }
    }
  }

  // ChannelRuntime relays events from every active OpenCorvus instance into
  // IM channels, so it must subscribe to the cross-instance bus (/global/event).
  // The project-scoped /event endpoint requires a directory and emits one
  // instance's events only — using it here rejects with DirectoryRequiredError
  // and breaks cross-project relaying. Mirror the ACP agent contract
  // (packages/opencorvus/src/acp/agent.ts) which already uses global.event +
  // payload unwrap.
  private subscribeEvents(): void {
    const reconnect = async () => {
      let delay = 1000
      while (this.running) {
        try {
          const events = await this.client.global.event()
          delay = 1000 // reset backoff on successful connection
          for await (const wrapped of events.stream) {
            const payload = (wrapped as { payload?: unknown })?.payload
            if (!payload) continue
            try {
              await this.handleEvent(payload as Event)
            } catch (err) {
              console.error("[ChannelRuntime] event handler error:", err)
            }
          }
          console.warn("[ChannelRuntime] event stream ended, reconnecting...")
        } catch (err) {
          console.error(`[ChannelRuntime] event stream error, retrying in ${delay}ms:`, err)
        }
        if (this.running) {
          await new Promise((resolve) => setTimeout(resolve, delay))
          delay = Math.min(delay * 2, 60_000) // exponential backoff, cap 60s
        }
      }
    }
    reconnect().catch((err) => console.error("[ChannelRuntime] fatal reconnect error:", err))
  }
}

function imageAttachment(input: ChannelAttachment) {
  if (!input.mime.startsWith("image/")) return
  const match = input.url.match(/^data:[^;]+;base64,(.+)$/)
  if (!match) return
  const buffer = Buffer.from(match[1], "base64")
  const fallback = input.mime === "image/png" ? "opencorvus-gui.png" : "opencorvus-gui.jpg"
  return {
    buffer,
    filename: input.filename ?? fallback,
  }
}

function sameEntry(left: SessionEntry, right: SessionEntry) {
  return (
    left.adapter.platform === right.adapter.platform && left.channel === right.channel && left.thread === right.thread
  )
}
