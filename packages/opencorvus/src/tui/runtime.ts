import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session"
import { TaskQueueService } from "@/scheduler/task-queue-service"
import { TaskQueueTable } from "@/scheduler/task-queue.sql"
import { Instance, lazyInstanceState } from "@/project/instance"
import { Tui } from "@/tui"
import { Bus } from "@/bus"
import { Database, eq } from "@/storage/db"
import { NamedError } from "@opencorvus-ai/util/error"
import { SessionAgentIdentity } from "@/session/agent-identity"

type Mode = "none" | "spawned" | "connected"

const state = lazyInstanceState(() => ({
  handle: null as Tui.Handle | null,
  mode: "none" as Mode,
  sessionID: null as string | null,
  stopping: false,
}))

function proxyPath(raw: string) {
  if (!raw.startsWith("/tui/")) {
    throw new Error("proxy path must start with /tui/")
  }
  const parsed = new URL(raw, "http://opencorvus.internal")
  const normalized = parsed.pathname + parsed.search
  if (!parsed.pathname.startsWith("/tui/")) {
    throw new Error("proxy path must stay within /tui/")
  }
  return normalized
}

function watchExit(handle: Tui.Handle, sessionID: string | null) {
  const fail = (message: string) => {
    if (!sessionID) return
    Bus.publish(Session.Event.Error, {
      sessionID,
      error: new NamedError.Unknown({ message }).toObject(),
    })
  }

  void handle
    .waitForExit()
    .then((code) => {
      const s = state()
      if (s.handle !== handle) return
      const stopping = s.stopping
      s.handle = null
      s.mode = "none"
      s.stopping = false
      if (stopping) return
      fail(`TUI runtime exited unexpectedly (code ${code ?? "unknown"})`)
    })
    .catch((error) => {
      const s = state()
      if (s.handle !== handle) return
      const stopping = s.stopping
      s.handle = null
      s.mode = "none"
      s.stopping = false
      if (stopping) return
      const detail = error instanceof Error ? error.message : String(error)
      fail(`TUI runtime exit watcher failed: ${detail}`)
    })
}

export namespace TuiRuntime {
  export const Status = {
    schema: {
      running: true,
      mode: "none" as Mode,
      url: null as string | null,
      sessionID: null as string | null,
    },
  }

  export async function start(input: {
    mode: "spawn" | "connect"
    url?: string
    directory?: string
    sessionID?: string
    model?: string
    agent?: string
    prompt?: string
    continue?: boolean
    fork?: boolean
    port?: number
    hostname?: string
    bin?: string
  }) {
    const s = state()
    if (s.handle && !s.handle.closed) {
      s.stopping = true
      await s.handle.close().catch(() => {})
    }
    s.stopping = false

    if (input.mode === "connect") {
      if (!input.url) throw new Error("url is required when mode=connect")
      s.handle = Tui.connect(input.url)
      s.mode = "connected"
      s.sessionID = input.sessionID ?? null
      return {
        mode: s.mode,
        url: s.handle.url,
      }
    }

    s.handle = await Tui.spawn({
      directory: input.directory,
      sessionID: input.sessionID,
      model: input.model,
      agent: input.agent,
      prompt: input.prompt,
      continue: input.continue,
      fork: input.fork,
      port: input.port,
      hostname: input.hostname,
      bin: input.bin,
    })
    s.mode = "spawned"
    s.sessionID = input.sessionID ?? null
    watchExit(s.handle, s.sessionID)
    return {
      mode: s.mode,
      url: s.handle.url,
    }
  }

  export function status() {
    const s = state()
    return {
      running: !!s.handle && !s.handle.closed,
      mode: s.mode,
      url: s.handle?.url ?? null,
      sessionID: s.sessionID,
    }
  }

  export async function stop() {
    const s = state()
    if (s.handle && !s.handle.closed) {
      s.stopping = true
      await s.handle.close().catch(() => {})
    }
    s.handle = null
    s.mode = "none"
    s.sessionID = null
    s.stopping = false
    return true
  }

  export async function proxy(input: { path: string; body?: unknown }) {
    const s = state()
    if (!s.handle || s.handle.closed) {
      throw new Error("TUI runtime is not running. Call /tui/runtime/start first.")
    }
    const path = proxyPath(input.path)

    const res = await fetch(`${s.handle.url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.body ?? {}),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`TUI proxy failed: ${res.status} ${path} ${text}`)

    const type = res.headers.get("Content-Type") ?? ""
    if (type.includes("application/json")) {
      return JSON.parse(text)
    }
    return text
  }

  export async function submitTask(input: {
    text: string
    sessionID?: string
    agent?: string
    wait?: boolean
    timeoutMs?: number
  }) {
    const s = state()
    const sessionID = input.sessionID ?? s.sessionID
    if (!sessionID) {
      throw new Error("sessionID is required. Pass it in /tui/runtime/start or /tui/runtime/submit-task.")
    }
    s.sessionID = sessionID

    const session = await Session.get(sessionID)
    const prompt = SessionAgentIdentity.applyToPrompt(session.kind, {
      agent: input.agent,
      parts: [
        {
          type: "text" as const,
          text: input.text,
        },
      ],
    })
    const run = () =>
      SessionPrompt.prompt({
        sessionID,
        ...prompt,
      })

    const wait = input.wait ?? true
    if (!wait) {
      const taskID = TaskQueueService.enqueuePrompt({
        sessionID,
        prompt,
        source: "tui.runtime.submit-task",
      })
      return {
        accepted: true as const,
        sessionID,
        taskID,
        waited: false,
        completed: false,
        message: null,
      }
    }

    const start = Date.now()
    const timeoutMs = input.timeoutMs ?? 5 * 60 * 1000
    const result = await Promise.race([
      run().then((message) => ({ kind: "done" as const, message })),
      new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)),
    ])

    if (result.kind === "done") {
      return {
        accepted: true as const,
        sessionID,
        taskID: null,
        waited: true,
        completed: true,
        message: result.message,
      }
    }

    const status = SessionStatus.get(sessionID)
    const msgs = await Session.messages({ sessionID, limit: 50 })
    const latest = msgs.filter((m) => m.info.role === "assistant" && m.info.time.created >= start).at(-1) ?? null
    return {
      accepted: true as const,
      sessionID,
      taskID: null,
      waited: true,
      completed: (status.type === "idle" || status.type === "terminal") && !!latest,
      message: latest,
    }
  }

  export function taskStatus(input: { taskID: string }) {
    const taskID = input.taskID.trim()
    if (!taskID) {
      throw new Error("taskID is required")
    }
    const item = Database.use((db) =>
      db
        .select({
          id: TaskQueueTable.id,
          sessionID: TaskQueueTable.session_id,
          status: TaskQueueTable.status,
          error: TaskQueueTable.error_message,
          updatedAt: TaskQueueTable.time_updated,
          completedAt: TaskQueueTable.time_completed,
        })
        .from(TaskQueueTable)
        .where(eq(TaskQueueTable.id, taskID))
        .get(),
    )
    if (!item) {
      return {
        found: false as const,
        taskID,
        sessionID: null,
        status: "unknown",
        terminal: true,
        error: "task not found",
        updatedAt: null,
        completedAt: null,
      }
    }
    const terminal = item.status === "completed" || item.status === "failed"
    return {
      found: true as const,
      taskID: item.id,
      sessionID: item.sessionID,
      status: item.status,
      terminal,
      error: item.error ?? null,
      updatedAt: item.updatedAt,
      completedAt: item.completedAt,
    }
  }
}
