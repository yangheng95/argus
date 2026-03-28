import type { OpencodeClient } from "@opencorvus-ai/sdk/v2"
import type { IncomingMessage } from "./adapter"
import type { Job, PendingTask, SessionEntry } from "./types"
import type { SessionCoordinator } from "./session-coordinator"
import { buildSystemPrompt } from "./system-prompt"

export interface JobQueueDeps {
  client: OpencodeClient
  serverUrl: string
  session: SessionCoordinator<SessionEntry, IncomingMessage>
  findSessions: (sessionId: string) => SessionEntry[]
  mirrorSessions: (
    kind: "user" | "assistant" | "system",
    text: string,
    sessionId: string,
    sessions: SessionEntry[],
  ) => void
  handleMessage: (msg: IncomingMessage) => Promise<void>
}

export class JobQueue {
  /** Active bot-aware coding jobs keyed by sessionID */
  readonly jobs = new Map<string, Job>()
  readonly pending = new Map<string, PendingTask>()
  private pendingWatch: ReturnType<typeof setInterval> | null = null
  private _isRunning: () => boolean = () => true

  setRunningCheck(check: () => boolean) {
    this._isRunning = check
  }

  taskId(sessionId: string) {
    return `task_${sessionId.slice(-6)}_${Date.now().toString(36)}`
  }

  pendingTimeout() {
    const raw = Number(process.env.OPENCORVUS_BOT_TASK_TIMEOUT_MS)
    if (!Number.isFinite(raw) || raw <= 0) return 10 * 60 * 1000
    if (raw < 1_000) return 1_000
    return Math.floor(raw)
  }

  pendingSweepMs() {
    const raw = Number(process.env.OPENCORVUS_BOT_TASK_SWEEP_MS)
    if (!Number.isFinite(raw) || raw <= 0) return 5_000
    if (raw < 1_000) return 1_000
    return Math.floor(raw)
  }

  startPendingWatch() {
    if (this.pendingWatch) return
    this.pendingWatch = setInterval(() => {
      this.expirePending().catch((err) => console.error("[BotCore] pending watchdog error:", err))
    }, this.pendingSweepMs())
    this.pendingWatch.unref?.()
  }

  stopPendingWatch() {
    if (!this.pendingWatch) return
    clearInterval(this.pendingWatch)
    this.pendingWatch = null
  }

  markPending(sessionId: string, taskId: string) {
    this.pending.set(sessionId, {
      taskId,
      touch: Date.now(),
    })
  }

  touchPending(sessionId: string) {
    const item = this.pending.get(sessionId)
    if (!item) return
    item.touch = Date.now()
  }

  clearPending(sessionId: string) {
    this.pending.delete(sessionId)
  }

  releaseSession(sessionId: string, deps: JobQueueDeps) {
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
        deps.client.session
          .promptAsync({
            sessionID: sessionId,
            parts: [{ type: "text", text: continuationText }],
            system: buildSystemPrompt(job.platform),
          })
          .catch((err) => console.error("[BotCore] loop continuation error:", err))
        return
      }

      if (report.status === "need_input") {
        // Stop processing so the next user message is treated as an answer
        job.status = "waiting_user"
        deps.session.stop(sessionId)
        return
      }

      // done or failed: fall through to normal release
      this.jobs.delete(sessionId)
    } else if (job) {
      // Agent ended without calling task_report — clean up job
      this.jobs.delete(sessionId)
    }

    deps.session.stop(sessionId)
    const next = deps.session.dequeue(sessionId)
    if (!next.item) return
    deps.handleMessage(next.item.msg).catch((err) => console.error("[BotCore] dequeue handleMessage error:", err))
  }

  async pendingStatus(serverUrl: string, taskId: string) {
    const res = await fetch(`${serverUrl}/tui/runtime/task-status`, {
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

  async expirePending() {
    if (!this._isRunning()) return
    if (this.pending.size === 0) return
    const now = Date.now()
    const timeout = this.pendingTimeout()
    // deps are resolved lazily via the stored _deps reference
    const deps = this._deps
    if (!deps) return
    for (const [sessionId, item] of Array.from(this.pending.entries())) {
      const status = await this.pendingStatus(deps.serverUrl, item.taskId)
      if (status && !status.terminal) {
        this.touchPending(sessionId)
        continue
      }
      if (status?.terminal) {
        this.releaseSession(sessionId, deps)
        if (status.status !== "failed") continue
        const sessions = deps.findSessions(sessionId)
        if (sessions.length === 0) continue
        const msg = status.error ? `Task failed (${item.taskId}): ${status.error}` : `Task failed (${item.taskId}).`
        deps.mirrorSessions("system", msg, sessionId, sessions)
        for (const session of sessions) {
          await session.adapter.sendMessage(session.channel, session.thread, msg).catch(() => {})
        }
        continue
      }
      if (now - item.touch < timeout) continue
      this.releaseSession(sessionId, deps)
      const sessions = deps.findSessions(sessionId)
      if (sessions.length === 0) continue
      const sec = Math.floor(timeout / 1000)
      const msg = `Task timed out after ${sec}s (${item.taskId}). Queue released.`
      deps.mirrorSessions("system", msg, sessionId, sessions)
      for (const session of sessions) {
        await session.adapter.sendMessage(session.channel, session.thread, msg).catch(() => {})
      }
    }
  }

  /** Store deps reference for the interval-driven expirePending */
  private _deps?: JobQueueDeps
  setDeps(deps: JobQueueDeps) {
    this._deps = deps
  }

  clear() {
    this.pending.clear()
    this.jobs.clear()
  }
}
