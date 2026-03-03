import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { TaskQueueService } from "@/scheduler/task-queue-service"
import { Instance } from "@/project/instance"
import { Tui } from "@/tui"

type Mode = "none" | "spawned" | "connected"

const state = Instance.state(() => ({
  handle: null as Tui.Handle | null,
  mode: "none" as Mode,
  sessionID: null as string | null,
}))

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
      await s.handle.close().catch(() => {})
    }

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
      await s.handle.close().catch(() => {})
    }
    s.handle = null
    s.mode = "none"
    s.sessionID = null
    return true
  }

  export async function proxy(input: { path: string; body?: unknown }) {
    const s = state()
    if (!s.handle || s.handle.closed) {
      throw new Error("TUI runtime is not running. Call /tui/runtime/start first.")
    }
    if (!input.path.startsWith("/tui/")) {
      throw new Error("proxy path must start with /tui/")
    }

    const res = await fetch(`${s.handle.url}${input.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.body ?? {}),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`TUI proxy failed: ${res.status} ${input.path} ${text}`)

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

    const prompt = {
      agent: input.agent,
      parts: [
        {
          type: "text" as const,
          text: input.text,
        },
      ],
    }
    const run = () =>
      SessionPrompt.prompt({
        sessionID,
        ...prompt,
      })

    const wait = input.wait ?? true
    if (!wait) {
      TaskQueueService.enqueuePrompt({
        sessionID,
        prompt,
        source: "tui.runtime.submit-task",
      })
      return {
        accepted: true as const,
        sessionID,
        waited: false,
        completed: false,
        message: null,
      }
    }

    const start = Date.now()
    const timeoutMs = input.timeoutMs ?? 5 * 60 * 1000
    const result = await Promise.race([
      run().then((message) => ({ kind: "done" as const, message })),
      new Promise<{ kind: "timeout" }>((resolve) =>
        setTimeout(() => resolve({ kind: "timeout" }), timeoutMs),
      ),
    ])

    if (result.kind === "done") {
      return {
        accepted: true as const,
        sessionID,
        waited: true,
        completed: true,
        message: result.message,
      }
    }

    const status = SessionStatus.get(sessionID)
    const msgs = await Session.messages({ sessionID, limit: 50 })
    const latest = msgs
      .filter((m) => m.info.role === "assistant" && m.info.time.created >= start)
      .at(-1) ?? null
    return {
      accepted: true as const,
      sessionID,
      waited: true,
      completed: status.type === "idle" && !!latest,
      message: latest,
    }
  }
}
