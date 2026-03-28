import type { Event, OpencodeClient } from "@opencorvus-ai/sdk/v2"
import type { BotAdapter, IncomingMessage } from "./adapter"
import type { VisionPipeline } from "./vision"
import {
  BOT_MESSAGE_LIMIT,
  formatToolStatus as formatToolStatusMessage,
  polishText,
  splitText,
} from "./message-formatter"
import {
  permissionReply as permissionReplyRule,
  type PermissionReply,
} from "./bot-policy"
import type { SessionCoordinator } from "./session-coordinator"
import type { JobQueue } from "./job-queue"
import type { SharedSessionManager } from "./session-manager"
import type { ChannelDispatcher } from "./channel-dispatcher"
import type {
  EventMessagePartUpdated,
  EventMessageUpdated,
  EventOrchestratorEvaluationCompleted,
  EventPermissionAsked,
  EventSessionError,
  EventSessionIdle,
  EventSessionStatus,
  PermissionAsked,
  ScreenAttachment,
  SessionEntry,
  SessionMessagePart,
  TaskReportProperties,
} from "./types"
import { MIRROR_PREFIX } from "./types"

export interface EventHandlerDeps {
  client: OpencodeClient
  serverUrl: string
  session: SessionCoordinator<SessionEntry, IncomingMessage>
  jobQueue: JobQueue
  sharedSession: SharedSessionManager
  channelDispatcher: ChannelDispatcher
  adapters: BotAdapter[]
  vision?: VisionPipeline
  running: () => boolean
  handleMessage: (msg: IncomingMessage) => Promise<void>
}

export class EventHandler {
  /** Buffer assistant text per messageID until message.updated signals completion */
  readonly textBuffers = new Map<string, string>()
  /** Track user message IDs to skip their parts */
  readonly userMessageIds = new Set<string>()
  /** Buffer text captured from message.part.updated before we know the message role */
  readonly pendingPartTexts = new Map<string, string>()

  mirror(
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

  mirrorSessions(
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

  private polish(text: string): string {
    return polishText(text)
  }

  private split(text: string, limit = BOT_MESSAGE_LIMIT): string[] {
    return splitText(text, limit)
  }

  private permissionReply(): PermissionReply {
    return permissionReplyRule(process.env)
  }

  /** Format a brief status message for important tool completions */
  private formatToolStatus(tool: string, input: unknown): string | null {
    return formatToolStatusMessage(tool, input, process.env)
  }

  private findSessions(deps: EventHandlerDeps, sessionId: string) {
    return deps.session.findSessions(sessionId)
  }

  private jobQueueDeps(deps: EventHandlerDeps) {
    return {
      client: deps.client,
      serverUrl: deps.serverUrl,
      session: deps.session,
      findSessions: (sid: string) => this.findSessions(deps, sid),
      mirrorSessions: (kind: "user" | "assistant" | "system", text: string, sid: string, sessions: SessionEntry[]) =>
        this.mirrorSessions(kind, text, sid, sessions),
      handleMessage: deps.handleMessage,
    }
  }

  /**
   * Upload screenshot attachment and optionally run vision analysis in parallel.
   * Prefer event payload attachments and fall back to fetching message parts if needed.
   */
  private async processScreenshot(
    deps: EventHandlerDeps,
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
        const msgResult = await deps.client.session.message({
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
            `[BotCore] Vision skipped: screenshot too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB > 7MB)`,
          )
        }

        // Skip vision for trivial screen changes (cursor blinks, etc.)
        const visionDiffThreshold = Number(process.env.OPENCORVUS_MONITOR_DIFF_THRESHOLD) || 2
        const lowDiff = diffPercent !== undefined && diffPercent < visionDiffThreshold
        if (lowDiff) {
          console.log(
            `[BotCore] Vision skipped: low screen change (${diffPercent.toFixed(1)}% < ${visionDiffThreshold}% threshold)`,
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

        const shouldVision = deps.vision && !tooLarge && !lowDiff
        const visionPromise = shouldVision
          ? deps.vision!.analyze(base64Data).catch((err) => {
              console.warn("[BotCore] Vision analysis failed:", err)
              return null
            })
          : Promise.resolve(null)

        const [, visionResult] = await Promise.all([uploadPromise, visionPromise])

        console.log(`[BotCore] Uploaded screenshot (${(buffer.length / 1024).toFixed(0)}KB)`)

        if (visionResult) {
          console.log(
            `[BotCore] Vision analysis (${visionResult.tokens.prompt + visionResult.tokens.completion} tokens): ${visionResult.description.slice(0, 120)}...`,
          )
        }
      }
    } catch (err) {
      console.error("[BotCore] processScreenshot error:", err)
    }
  }

  async handleEvent(event: Event, deps: EventHandlerDeps): Promise<void> {
    if (event.type === "orchestrator.evaluation.completed") {
      const info = (event as EventOrchestratorEvaluationCompleted).properties
      const sessions = deps.channelDispatcher.findTaskBindings(info.taskID)
      if (sessions.length === 0) return
      const msg = `Evaluation ${info.verdict}: ${info.summary}`
      for (const session of sessions) {
        await session.adapter.sendMessage(session.channel, session.thread, msg).catch(() => {})
      }
      return
    }

    if (event.type === "session.status") {
      const info = (event as EventSessionStatus).properties
      if (!info.sessionID) return
      if (info.status.type !== "idle") {
        deps.jobQueue.touchPending(info.sessionID)
        return
      }
      const pending = deps.jobQueue.pending.get(info.sessionID)
      if (!pending) return
      const status = await deps.jobQueue.pendingStatus(deps.serverUrl, pending.taskId)
      if (status?.terminal) {
        deps.jobQueue.releaseSession(info.sessionID, this.jobQueueDeps(deps))
      }
      return
    }

    // task.report: agent signals loop status via the task_report tool
    if ((event as any).type === "task.report") {
      const report = (event as any).properties as TaskReportProperties
      const job = deps.jobQueue.jobs.get(report.sessionID)
      if (!job) return

      job.lastReport = report
      job.lastActivityAt = Date.now()
      // Touch pending watchdog so it doesn't time out during a long loop
      deps.jobQueue.touchPending(report.sessionID)

      if (report.status === "progress") {
        const msg = `[Turn ${job.turn}] ${report.summary}`
        await job.adapter.sendMessage(job.channel, job.thread, msg).catch(() => {})
        this.mirrorSessions("assistant", msg, report.sessionID, this.findSessions(deps, report.sessionID))
      } else if (report.status === "need_input") {
        const msg = `? ${report.question ?? report.summary}`
        await job.adapter.sendMessage(job.channel, job.thread, msg).catch(() => {})
        this.mirrorSessions("assistant", msg, report.sessionID, this.findSessions(deps, report.sessionID))
      } else if (report.status === "done") {
        const artifactsLine = report.artifacts?.length ? `\nFiles: ${report.artifacts.join(", ")}` : ""
        const msg = `Done (${job.turn + 1} turns): ${report.summary}${artifactsLine}`
        await job.adapter.sendMessage(job.channel, job.thread, msg).catch(() => {})
        this.mirrorSessions("assistant", msg, report.sessionID, this.findSessions(deps, report.sessionID))
      } else if (report.status === "failed") {
        const msg = `Failed: ${report.error ?? report.summary}`
        await job.adapter.sendMessage(job.channel, job.thread, msg).catch(() => {})
        this.mirrorSessions("system", msg, report.sessionID, this.findSessions(deps, report.sessionID))
      }
      return
    }

    if (event.type === "permission.asked") {
      const asked = (event as EventPermissionAsked).properties as PermissionAsked
      deps.jobQueue.touchPending(asked.sessionID)
      const reply = this.permissionReply()
      const result = await deps.client.permission.reply({
        requestID: asked.id,
        reply,
      })
      const sessions = this.findSessions(deps, asked.sessionID)
      if (result.error) {
        console.error("[BotCore] permission.reply error:", JSON.stringify(result.error).slice(0, 500))
        this.mirrorSessions(
          "system",
          `Failed to reply permission request: ${asked.permission}`,
          asked.sessionID,
          sessions,
        )
        for (const session of sessions) {
          await session.adapter
            .sendMessage(session.channel, session.thread, `Failed to reply permission request: ${asked.permission}`)
            .catch(() => {})
        }
        return
      }
      this.mirrorSessions(
        "system",
        `Auto-replied permission (${reply}): ${asked.permission}`,
        asked.sessionID,
        sessions,
      )
      for (const session of sessions) {
        const patterns = asked.patterns.length > 0 ? asked.patterns.join(", ") : "*"
        await session.adapter
          .sendMessage(
            session.channel,
            session.thread,
            `Auto-replied permission (${reply}): ${asked.permission} [${patterns}]`,
          )
          .catch(() => {})
      }
      console.log(`[BotCore] Auto-replied permission ${asked.id} with ${reply}`)
      return
    }

    // Session entered standby - clear processing flag and dequeue next pending message
    if (event.type === "session.idle") {
      const sessionId = (event as EventSessionIdle).properties.sessionID
      if (sessionId) {
        deps.jobQueue.releaseSession(sessionId, this.jobQueueDeps(deps))
      }
      return
    }

    if (event.type === "session.error") {
      const props = (event as EventSessionError).properties
      const sessionId = props.sessionID
      if (!sessionId) return
      deps.jobQueue.releaseSession(sessionId, this.jobQueueDeps(deps))
      const sessions = this.findSessions(deps, sessionId)
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
        await session.adapter.sendMessage(session.channel, session.thread, msg).catch(() => {})
      }
      return
    }

    // Track user message IDs so we can skip their parts
    if (event.type === "message.updated") {
      const info = (event as EventMessageUpdated).properties.info
      deps.jobQueue.touchPending(info.sessionID)

      if (info.role === "user") {
        // Track on first event only; message.updated fires twice for the same user message
        const isNew = !this.userMessageIds.has(info.id)
        this.userMessageIds.add(info.id)

        // In shared mode, mirror the user's overlay prompt to Slack.
        // message.part.updated arrives BEFORE this event and pre-captured the text in pendingPartTexts.
        const sharedSessionId = deps.sharedSession.getSharedSessionId()
        if (isNew && deps.sharedSession.sharedMode() && info.sessionID === sharedSessionId) {
          // Clean up any user text that leaked into textBuffers before role was known
          this.textBuffers.delete(info.id)
          const userText = this.pendingPartTexts.get(info.id)
          this.pendingPartTexts.delete(info.id)
          if (userText) {
            let sessions = this.findSessions(deps, info.sessionID)
            if (sessions.length === 0) sessions = await deps.sharedSession.bindOverlayMirrorIfNeeded(info.sessionID, deps.adapters, deps.session, (sid) => this.findSessions(deps, sid))
            for (const session of sessions) {
              await session.adapter.sendMessage(session.channel, session.thread, `> ${userText.trim()}`).catch(() => {})
            }
          }
        }
        return
      }

      // Flush buffered text when assistant message (one agentic step) completes
      if (info.role === "assistant" && info.time.completed) {
        let sessions = this.findSessions(deps, info.sessionID)
        const sharedSessionId = deps.sharedSession.getSharedSessionId()
        if (sessions.length === 0 && deps.sharedSession.sharedMode() && info.sessionID === sharedSessionId) {
          sessions = await deps.sharedSession.bindOverlayMirrorIfNeeded(info.sessionID, deps.adapters, deps.session, (sid) => this.findSessions(deps, sid))
        }
        if (sessions.length === 0) return

        const text = this.textBuffers.get(info.id)
        this.textBuffers.delete(info.id)

        if (text) {
          const polished = this.polish(text)
          if (polished) {
            for (const part of this.split(polished, BOT_MESSAGE_LIMIT)) {
              this.mirrorSessions("assistant", part, info.sessionID, sessions)
              for (const session of sessions) {
                await session.adapter.sendMessage(session.channel, session.thread, part).catch(() => {})
              }
            }
          }
          console.log(`[BotCore] Sent text for ${info.sessionID} (${polished.length} chars)`)
        }

        if (info.error) {
          const errMsg = "error" in info.error ? (info.error as any).error : JSON.stringify(info.error)
          this.mirrorSessions("system", `Error: ${errMsg}`, info.sessionID, sessions)
          for (const session of sessions) {
            await session.adapter.sendMessage(session.channel, session.thread, `Error: ${errMsg}`).catch(() => {})
          }
        }
      }
    }

    if (event.type === "message.part.updated") {
      const part = (event as EventMessagePartUpdated).properties.part
      deps.jobQueue.touchPending(part.sessionID)

      // In shared mode, pre-capture text parts before we know the message role.
      // message.part.updated fires BEFORE message.updated(role=user), so we store
      // the text here and consume it when message.updated confirms role=user.
      const sharedSessionId = deps.sharedSession.getSharedSessionId()
      if (deps.sharedSession.sharedMode() && part.sessionID === sharedSessionId && part.type === "text" && part.text?.trim()) {
        this.pendingPartTexts.set(part.messageID, part.text)
      }

      // Skip parts belonging to user messages
      if (this.userMessageIds.has(part.messageID)) return

      let sessions = this.findSessions(deps, part.sessionID)
      if (sessions.length === 0 && deps.sharedSession.sharedMode() && part.sessionID === sharedSessionId) {
        sessions = await deps.sharedSession.bindOverlayMirrorIfNeeded(part.sessionID, deps.adapters, deps.session, (sid) => this.findSessions(deps, sid))
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
                deps,
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
              await session.adapter.sendMessage(session.channel, session.thread, statusMsg).catch(() => {})
            }
          }
        }

        if (part.state?.status === "error") {
          const statusMsg = this.formatToolStatus(toolName, toolInput) ?? `\`${toolName}\``
          const err = String(part.state.error ?? "Unknown tool error")
          this.mirrorSessions("system", `${statusMsg} failed: ${err}`, part.sessionID, sessions)
          for (const session of sessions) {
            await session.adapter
              .sendMessage(session.channel, session.thread, `${statusMsg} failed: ${err}`)
              .catch(() => {})
          }
        }
      }
    }
  }

  subscribeEvents(deps: EventHandlerDeps): void {
    const reconnect = async () => {
      let delay = 1000
      while (deps.running()) {
        try {
          const events = await deps.client.event.subscribe()
          delay = 1000 // reset backoff on successful connection
          for await (const event of events.stream) {
            try {
              await this.handleEvent(event as Event, deps)
            } catch (err) {
              console.error("[BotCore] event handler error:", err)
            }
          }
          console.warn("[BotCore] event stream ended, reconnecting...")
        } catch (err) {
          console.error(`[BotCore] event stream error, retrying in ${delay}ms:`, err)
        }
        if (deps.running()) {
          await new Promise((resolve) => setTimeout(resolve, delay))
          delay = Math.min(delay * 2, 60_000) // exponential backoff, cap 60s
        }
      }
    }
    reconnect().catch((err) => console.error("[BotCore] fatal reconnect error:", err))
  }
}
