import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { Snapshot } from "@/snapshot"
import { PlanningCapabilities, type CodingEventInfo, type CodingProvider, type CodingToolInfo, type ExecutorStatusInfo } from "./compat"
import type { ExecutorAdapter } from "./compat"

const log = Log.create({ service: "executor.managed" })

type Status = Exclude<ExecutorStatusInfo, "blocked">
type Notify = {
  type: string
  summary?: string
  payload?: Record<string, unknown>
}

type State = {
  id: string
  sessionID: string
  externalSessionID?: string
  status: Status
  error: string | null
  output: string
  events: Notify[]
  wake?: () => void
  abort: AbortController
  startHash?: string
}

export const ManagedCodingExecutor = {
  create(
    provider: CodingProvider,
    options: {
      model?: string | (() => string | undefined)
      cwd?: string | (() => string | undefined)
      system?: string | (() => string | undefined)
      maxTurns?: number | (() => number | undefined)
      tools?: CodingToolInfo[] | (() => CodingToolInfo[] | undefined)
      planning?: {
        spec: boolean
        plan: boolean
      }
    },
  ): ExecutorAdapter {
    const tasks = new Map<string, State>()
    const latest = new Map<string, string>()

    const start = (state: State, mode: "run" | "resume", prompt: string) => {
      const input = {
        model: value(options.model),
        prompt,
        cwd: value(options.cwd),
        system: value(options.system),
        maxTurns: value(options.maxTurns),
        tools: value(options.tools),
        signal: state.abort.signal,
      }
      const stream =
        mode === "run"
          ? provider.run(input)
          : provider.resume({
              ...input,
              sessionID: state.externalSessionID ?? state.sessionID,
            })

      state.status = "running"
      push(state, {
        type: "executor.status",
        summary: "running",
        payload: {
          sessionID: state.sessionID,
          queueTaskID: state.id,
          status: "running",
        },
      })

      void consume(stream, state, latest).catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        if (state.status === "running" || state.status === "retrying") {
          state.status = "failed"
          state.error = message
        } else {
          log.warn("executor stream error after terminal state", { status: state.status, error: message })
        }
      })
    }

    return {
      capabilities() {
        return {
          submit: true,
          status: true,
          abort: true,
          delivery: true,
          resume: true,
          events: true,
        }
      },
      async submit(input) {
        const id = Identifier.ascending("task")
        // Snapshot.track() is best-effort: it captures a git tree hash so delivery()
        // can later compute file diffs.  Failures are safe to ignore because delivery()
        // guards with `state.startHash && currentHash` and returns an empty diff array
        // when either hash is missing (e.g. non-git project, snapshots disabled, or
        // git index locked by a concurrent process).
        const startHash = await Snapshot.track().catch(() => undefined)
        const state: State = {
          id,
          sessionID: input.sessionID,
          status: "queued",
          error: null,
          output: "",
          events: [],
          abort: new AbortController(),
          startHash,
        }
        tasks.set(id, state)
        latest.set(input.sessionID, id)
        push(state, {
          type: "executor.status",
          summary: "queued",
          payload: {
            sessionID: input.sessionID,
            queueTaskID: id,
            status: "queued",
          },
        })
        start(state, "run", input.prompt)
        return {
          sessionID: input.sessionID,
          queueTaskID: id,
        }
      },
      async status(queueTaskID) {
        const state = tasks.get(queueTaskID)
        if (!state) throw new Error(`executor task not found: ${queueTaskID}`)
        return {
          queueTaskID,
          status: state.status,
          error: state.error,
        }
      },
      async abort(input) {
        const state = pick(tasks, latest, input)
        if (!state) return false
        state.abort.abort()
        await provider.interrupt(state.externalSessionID ?? state.sessionID).catch(() => false)
        state.status = "failed"
        state.error = "task cancelled"
        push(state, {
          type: "session.error",
          summary: "task cancelled",
          payload: {
            sessionID: state.sessionID,
            queueTaskID: state.id,
            error: "task cancelled",
          },
        })
        return true
      },
      async delivery(input) {
        const state = pick(tasks, latest, { sessionID: input.sessionID })
        if (!state) return { summary: "", diffs: [] }
        // Best-effort: capture current working tree so we can diff against startHash.
        // If this fails the guard below produces an empty diff array, which is acceptable
        // because the text summary is still returned and diffs are supplementary.
        const currentHash = await Snapshot.track().catch(() => undefined)
        const diffs = state.startHash && currentHash
          ? await Snapshot.diffFull(state.startHash, currentHash).catch(() => [])
          : []
        return {
          summary: state.output,
          diffs,
        }
      },
      async resume(input) {
        const id = Identifier.ascending("task")
        const prev = pick(tasks, latest, { sessionID: input.sessionID })
        const state: State = {
          id,
          sessionID: input.sessionID,
          externalSessionID: prev?.externalSessionID,
          status: "retrying",
          error: null,
          output: "",
          events: [],
          abort: new AbortController(),
        }
        tasks.set(id, state)
        latest.set(input.sessionID, id)
        push(state, {
          type: "executor.status",
          summary: "retrying",
          payload: {
            sessionID: input.sessionID,
            queueTaskID: id,
            status: "retrying",
          },
        })
        start(state, "resume", input.message)
        return {
          sessionID: input.sessionID,
          queueTaskID: id,
        }
      },
      async resolve(input) {
        if (!provider.respond) return false
        const state = pick(tasks, latest, input)
        if (!state) return false
        return provider.respond({
          sessionID: state.externalSessionID ?? state.sessionID,
          requestID: input.requestID,
          kind: input.kind,
          response: input.response,
          error: input.error,
        })
      },
      async *events(input) {
        const MAX_IDLE_MS = 30 * 60 * 1000 // 30 minutes max idle before giving up
        const state = pick(tasks, latest, input)
        if (!state) return
        let index = 0
        const abort = () => {
          state.wake?.()
        }
        input.signal?.addEventListener("abort", abort)
        try {
          while (true) {
            while (index < state.events.length) {
              yield state.events[index]!
              index += 1
            }
            if (input.signal?.aborted) return
            if (state.status === "completed" || state.status === "failed") return
            // Wait for new events with idle timeout protection
            const idled = await Promise.race([
              new Promise<false>((resolve) => {
                state.wake = () => resolve(false)
              }),
              new Promise<true>((resolve) =>
                setTimeout(() => resolve(true), MAX_IDLE_MS),
              ),
            ])
            state.wake = undefined
            if (idled) return // idle timeout — stop event stream
          }
        } finally {
          input.signal?.removeEventListener("abort", abort)
        }
      },
      planningCapabilities() {
        return PlanningCapabilities.parse(options.planning ?? {
          spec: false,
          plan: false,
        })
      },
      async generatePlanning(input) {
        const stream = provider.run({
          model: value(options.model),
          prompt: input.prompt,
          cwd: input.cwd ?? value(options.cwd),
          system: input.system ?? value(options.system),
          maxTurns: input.maxTurns ?? value(options.maxTurns) ?? 4,
          ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
          sandbox: input.sandbox ?? "read-only",
          ...(input.toolMode ? { toolMode: input.toolMode } : {}),
          ...(input.toolMode === "none" ? { tools: [] } : {}),
          signal: input.signal,
        })
        let text = ""
        for await (const event of stream) {
          if (event.type === "text_delta") {
            text += event.text
            continue
          }
          if (event.type === "done") {
            return {
              output: event.output ?? text,
            }
          }
          if (event.type === "error") {
            throw new Error(event.message)
          }
        }
        return {
          output: text,
        }
      },
    }
  },
}

function value<T>(input: T | (() => T)) {
  if (typeof input === "function") return (input as () => T)()
  return input
}

async function consume(stream: AsyncIterable<CodingEventInfo>, state: State, latest: Map<string, string>) {
  for await (const event of stream) {
    if (state.abort.signal.aborted || state.status === "failed") return
    sync(state, event)
    push(state, map(state, event))

    if (event.type === "text_delta") {
      state.output += event.text
      continue
    }
    if (event.type === "error") {
      state.status = "failed"
      state.error = event.message
      return
    }
    if (event.type === "done") {
      state.status = "completed"
      state.error = null
      if (event.output) state.output = event.output
      latest.set(state.sessionID, state.id)
      return
    }
  }

  if (!state.abort.signal.aborted && (state.status === "running" || state.status === "retrying" || state.status === "queued")) {
    state.status = "failed"
    state.error = "executor stream ended unexpectedly"
    push(state, {
      type: "session.error",
      summary: "executor stream ended unexpectedly",
      payload: {
        sessionID: state.sessionID,
        queueTaskID: state.id,
        error: "executor stream ended unexpectedly",
      },
    })
  }

  // Free event buffers after stream finishes to prevent unbounded memory growth.
  // Status/delivery queries still work since they read state.output/state.status, not events.
  state.events.length = 0
}

function pick(tasks: Map<string, State>, latest: Map<string, string>, input: { sessionID?: string; queueTaskID?: string }) {
  if (input.queueTaskID) return tasks.get(input.queueTaskID)
  if (!input.sessionID) return
  const current = latest.get(input.sessionID)
  if (!current) return
  return tasks.get(current)
}

function sync(state: State, event: CodingEventInfo) {
  if (event.type === "done" && event.sessionID) {
    state.externalSessionID = event.sessionID
    return
  }
  if (event.type !== "status" || !event.meta) return
  if (typeof event.meta.session_id === "string" && event.meta.session_id) {
    state.externalSessionID = event.meta.session_id
    return
  }
  const response = event.meta.response
  if (!response || typeof response !== "object") return
  const item = response as Record<string, unknown>
  if (typeof item.id === "string" && item.id) state.externalSessionID = item.id
}

function push(state: State, event: Notify) {
  state.events.push(event)
  state.wake?.()
}

function map(state: State, event: CodingEventInfo): Notify {
  if (event.type === "status") {
    return {
      type: "executor.status",
      summary: event.status,
      payload: {
        sessionID: state.sessionID,
        queueTaskID: state.id,
        ...event.meta,
      },
    }
  }
  if (event.type === "text_delta") {
    return {
      type: "message.part.delta",
      summary: "Delta: text",
      payload: {
        sessionID: state.sessionID,
        queueTaskID: state.id,
        field: "text",
        delta: event.text,
      },
    }
  }
  if (event.type === "tool_call") {
    return {
      type: "tool.call",
      summary: `Tool call: ${event.name}`,
      payload: {
        sessionID: state.sessionID,
        queueTaskID: state.id,
        id: event.id,
        name: event.name,
        input: event.input,
        ...(event.meta ?? {}),
      },
    }
  }
  if (event.type === "tool_result") {
    return {
      type: "tool.result",
      summary: `Tool result: ${event.id}`,
      payload: {
        sessionID: state.sessionID,
        queueTaskID: state.id,
        id: event.id,
        output: event.output,
        ...(event.meta ?? {}),
      },
    }
  }
  if (event.type === "reasoning_delta") {
    return {
      type: "reasoning.delta",
      summary: event.text,
      payload: {
        sessionID: state.sessionID,
        queueTaskID: state.id,
        ...(event.meta ?? {}),
      },
    }
  }
  if (event.type === "plan_delta") {
    return {
      type: "plan.delta",
      summary: event.summary ?? "Plan updated",
      payload: {
        sessionID: state.sessionID,
        queueTaskID: state.id,
        ...(event.meta ?? {}),
      },
    }
  }
  if (event.type === "diff_delta") {
    return {
      type: "diff.delta",
      summary: event.summary ?? "Diff updated",
      payload: {
        sessionID: state.sessionID,
        queueTaskID: state.id,
        ...(event.meta ?? {}),
      },
    }
  }
  if (event.type === "approval_request") {
    return {
      type: "approval.request",
      summary: event.message ?? event.approval,
      payload: {
        sessionID: state.sessionID,
        queueTaskID: state.id,
        id: event.id,
        approval: event.approval,
        ...(event.meta ?? {}),
      },
    }
  }
  if (event.type === "input_request") {
    return {
      type: "input.request",
      summary: "User input requested",
      payload: {
        sessionID: state.sessionID,
        queueTaskID: state.id,
        id: event.id,
        questions: event.questions,
        ...(event.meta ?? {}),
      },
    }
  }
  if (event.type === "usage") {
    return {
      type: "usage.updated",
      summary: event.totalTokens ? `${event.totalTokens} tokens` : "Usage updated",
      payload: {
        sessionID: state.sessionID,
        queueTaskID: state.id,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        totalTokens: event.totalTokens,
        costUSD: event.costUSD,
        ...(event.meta ?? {}),
      },
    }
  }
  if (event.type === "raw") {
    return {
      type: "protocol.raw",
      summary: event.name,
      payload: {
        sessionID: state.sessionID,
        queueTaskID: state.id,
        ...(event.meta ?? {}),
      },
    }
  }
  if (event.type === "done") {
    return {
      type: "session.idle",
      summary: "Session idle",
      payload: {
        sessionID: state.sessionID,
        queueTaskID: state.id,
        output: event.output,
        costUSD: event.costUSD,
        turns: event.turns,
      },
    }
  }
  return {
    type: "session.error",
    summary: event.message,
    payload: {
      sessionID: state.sessionID,
      queueTaskID: state.id,
      error: event.message,
      ...event.meta,
    },
  }
}
