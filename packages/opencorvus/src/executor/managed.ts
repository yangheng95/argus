import { Identifier } from "@/id/id"
import { Snapshot } from "@/snapshot"
import { Log } from "@/util/log"
import { createEventQueue, type EventQueue } from "@/util/event-queue"
import { abortableIterable } from "@/util/stream-activity"
import { EngineConfig } from "@/engine/config"
import { PlanningCapabilities, type CodingEventInfo, type CodingProvider, type CodingProviderOptions, type ExecutorStatusInfo } from "./contract"
import type { ExecutorAdapter } from "./contract"
import {
  extractExecutorSessionRef,
  persistExecutorSessionRef,
  readExecutorSessionRef,
  resolveNativeResumeRef,
} from "./session-ref"

const log = Log.create({ service: "managed-executor" })

/**
 * Render an Error as `name: message | caused by: name: message | …` so the
 * inline state.error string preserves the upstream cause instead of
 * collapsing to the wrapper's message. The full stack still goes to the
 * file log via Log.formatError; this string is what overlay/status feeds
 * surface in-line.
 */
function formatErrorChain(err: unknown, depth = 0): string {
  if (!(err instanceof Error)) return String(err)
  const head = err.message ? `${err.name}: ${err.message}` : err.name
  if (!(err.cause instanceof Error) || depth >= 5) return head
  return `${head} | caused by: ${formatErrorChain(err.cause, depth + 1)}`
}

function requireExternalSessionID(state: State, operation: string): string {
  if (state.externalSessionID) return state.externalSessionID
  throw new Error(`managed executor ${operation} requires a provider-native session id for ${state.sessionID}`)
}

type Status = Exclude<ExecutorStatusInfo, "blocked">
type Notify = {
  type: string
  summary?: string
  payload?: Record<string, unknown>
}

type State = {
  id: string
  sessionID: string
  provider: string
  externalSessionID?: string
  status: Status
  error: string | null
  output: string
  /** Replay buffer (newest tail). Live consumers pull through `consumers`. */
  events: Notify[]
  /** Active event-queue consumers. push() fans out to each; terminal status
   *  broadcasts complete() to all. Single-source wait-loop lives in the
   *  queues themselves (util/event-queue.ts) — no hand-rolled while/wake here. */
  consumers: Set<EventQueue<Notify>>
  abort: AbortController
  startHash?: string
  runtime?: {
    taskID?: string
    logicalSessionID?: string
    runtimeDir?: string
    worktreeDir?: string
  }
}

export const ManagedCodingExecutor = {
  create(
    provider: CodingProvider,
    options: CodingProviderOptions,
  ): ExecutorAdapter {
    const tasks = new Map<string, State>()
    const latest = new Map<string, string>()

    const start = (state: State, mode: "run" | "resume", prompt: string, cwdOverride?: string, systemOverride?: string) => {
      const resolvedCwd = cwdOverride ?? value(options.cwd)
      const input = {
        model: value(options.model),
        prompt,
        ...state.runtime,
        cwd: resolvedCwd,
        system: systemOverride ?? value(options.system),
        maxTurns: value(options.maxTurns),
        tools: value(options.tools),
        signal: state.abort.signal,
      }
      const stream =
        mode === "run"
          ? provider.run(input)
          : provider.resume({
              ...input,
              sessionID: state.externalSessionID!,
            })

      state.status = "running"
      push(state, {
        type: "executor.progress",
        summary: "running",
        payload: {
          sessionID: state.sessionID,
          queueTaskID: state.id,
          status: "running",
        },
      })

      consume(stream, state, latest).catch((err) => {
        if (state.status !== "failed" && state.status !== "completed" && !state.abort.signal.aborted) {
          state.status = "failed"
          state.error = formatErrorChain(err)
          // Log the raw Error so Log.formatError walks the .cause chain into
          // the file log. The state.error string only carries message + first
          // cause, which is what downstream consumers (overlay, status feeds)
          // can render inline.
          log.error("managed executor stream errored", {
            sessionID: state.sessionID,
            queueTaskID: state.id,
            error: err,
          })
          push(state, {
            type: "session.error",
            summary: state.error,
            payload: {
              sessionID: state.sessionID,
              queueTaskID: state.id,
              error: state.error,
            },
          })
          completeConsumers(state)
        }
      }).finally(() => {
        // consume() may land in terminal status via its own "done" / "error"
        // branches without going through the catch above; mirror the broadcast
        // so consumer iterables always exit.
        if (state.status === "completed" || state.status === "failed") {
          completeConsumers(state)
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
        const startHash = await Snapshot.track().catch((error) => {
          log.warn("initial snapshot failed; delivery diffs will be empty", {
            sessionID: input.sessionID,
            queueTaskID: id,
            error: error instanceof Error ? error.message : String(error),
          })
          return undefined
        })
        const state: State = {
          id,
          sessionID: input.sessionID,
          provider: provider.name,
          status: "queued",
          error: null,
          output: "",
          events: [],
          consumers: new Set(),
          abort: new AbortController(),
          startHash,
          runtime: {
            taskID: input.taskID,
            logicalSessionID: input.logicalSessionID ?? input.sessionID,
            runtimeDir: input.runtimeDir,
            worktreeDir: input.worktreeDir ?? input.cwd,
          },
        }
        tasks.set(id, state)
        latest.set(input.sessionID, id)
        await persistExecutorSessionRef({
          sessionID: input.sessionID,
          provider: provider.name,
        }).catch((error) => {
          log.warn("persist initial executor session ref failed", {
            sessionID: input.sessionID,
            queueTaskID: id,
            error: error instanceof Error ? error.message : String(error),
          })
        })
        push(state, {
          type: "executor.progress",
          summary: "queued",
          payload: {
            sessionID: input.sessionID,
            queueTaskID: id,
            status: "queued",
          },
        })
        start(state, "run", input.prompt, input.cwd, input.system)
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
        if (state.status === "failed" || state.status === "completed") return true
        state.abort.abort()
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
        completeConsumers(state)
        await bestEffortInterrupt(provider, state)
        return true
      },
      async delivery(input) {
        const state = pick(tasks, latest, { sessionID: input.sessionID })
        if (!state) return { summary: "", diffs: [] }
        const currentHash = await Snapshot.track()
        const diffs = state.startHash && currentHash ? await Snapshot.diffFull(state.startHash, currentHash) : []
        return {
          summary: state.output,
          diffs,
        }
      },
      async resume(input) {
        const id = Identifier.ascending("task")
        const prev = pick(tasks, latest, { sessionID: input.sessionID })
        const metadata = prev?.externalSessionID ? undefined : await readExecutorSessionRef(input.sessionID)
        const externalSessionID =
          prev?.externalSessionID ??
          resolveNativeResumeRef(provider.name, metadata)
        const state: State = {
          id,
          sessionID: input.sessionID,
          provider: provider.name,
          externalSessionID,
          status: "retrying",
          error: null,
          output: "",
          events: [],
          consumers: new Set(),
          abort: new AbortController(),
          runtime: prev?.runtime ?? {
            taskID: input.taskID,
            logicalSessionID: input.logicalSessionID ?? input.sessionID,
            runtimeDir: input.runtimeDir,
            worktreeDir: input.worktreeDir,
          },
        }
        tasks.set(id, state)
        latest.set(input.sessionID, id)
        await persistExecutorSessionRef({
          sessionID: input.sessionID,
          provider: provider.name,
          ref: state.externalSessionID ? { nativeSessionID: state.externalSessionID } : undefined,
        })
        push(state, {
          type: "executor.progress",
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
          sessionID: requireExternalSessionID(state, "respond"),
          requestID: input.requestID,
          kind: input.kind,
          response: input.response,
          error: input.error,
        })
      },
      async *events(input) {
        const state = pick(tasks, latest, input)
        if (!state) return
        const cfg = await EngineConfig.get().catch(() => ({
          activity: { executor_events_idle_ms: 240_000 },
        }))
        const queue = createEventQueue<Notify>({
          idleMs: cfg.activity.executor_events_idle_ms,
          signal: input.signal,
          label: `managed-executor:${state.id}`,
        })
        // Replay buffered history first. Terminal-status tasks never push
        // again, so `complete()` after replay is correct.
        for (const ev of state.events) queue.push(ev)
        if (state.status === "completed" || state.status === "failed") {
          queue.complete()
        } else {
          state.consumers.add(queue)
        }
        try {
          yield* queue.iterable
        } finally {
          state.consumers.delete(queue)
          queue.complete()
        }
      },
      planningCapabilities() {
        return PlanningCapabilities.parse({
          spec: true,
          plan: true,
        })
      },
      async generatePlanning(input) {
        const stream = provider.run({
          model: value(options.model),
          prompt: input.prompt,
          cwd: input.cwd ?? value(options.cwd),
          system: input.system ?? value(options.system),
          maxTurns: input.maxTurns ?? value(options.maxTurns) ?? 4,
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
  let eventCount = 0
  log.info("consume started", { sessionID: state.sessionID, queueTaskID: state.id })
  for await (const event of abortableIterable(stream, state.abort.signal)) {
    if (state.abort.signal.aborted || state.status === "failed") return
    eventCount++
    if (eventCount <= 5 || eventCount % 20 === 0) {
      log.info("consume event", { sessionID: state.sessionID, queueTaskID: state.id, eventCount, type: event.type })
    }
    const ref = sync(state, event)
    if (ref) {
      await persistExecutorSessionRef({
        sessionID: state.sessionID,
        provider: state.provider,
        ref,
      }).catch((error) => {
        log.warn("persist executor session ref failed", {
          sessionID: state.sessionID,
          queueTaskID: state.id,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }
    const notify = map(state, event)
    if (notify) push(state, notify)

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

  if (state.abort.signal.aborted) return

  if (state.status === "running" || state.status === "retrying" || state.status === "queued") {
    // Stream ended without an explicit "done" event.
    // If zero events were produced and no output was generated, the executor
    // likely failed to start (e.g. auth error, spawn failure). Mark as failed
    // so the orchestrator can detect the problem instead of treating an empty
    // run as a successful completion.
    if (eventCount === 0 && !state.output) {
      log.error("consume ended with zero events", { sessionID: state.sessionID, queueTaskID: state.id })
      state.status = "failed"
      state.error = "Executor stream ended without producing any events — the process likely failed to start"
      push(state, {
        type: "session.error",
        summary: state.error,
        payload: {
          sessionID: state.sessionID,
          queueTaskID: state.id,
          error: state.error,
        },
      })
      return
    }
    log.info("consume completed", { sessionID: state.sessionID, queueTaskID: state.id, eventCount, outputLength: state.output.length })
    state.status = "completed"
  }
}

async function bestEffortInterrupt(provider: CodingProvider, state: State) {
  try {
    const sessionID = state.externalSessionID ?? state.sessionID
    await Promise.race([
      provider.interrupt(sessionID).catch(() => false),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ])
  } catch {
    // The local executor state is already terminal; provider interrupt is a
    // best-effort physical stop for adapters that expose a native session id.
  }
}

function pick(tasks: Map<string, State>, latest: Map<string, string>, input: { sessionID?: string; queueTaskID?: string }) {
  if (input.queueTaskID) return tasks.get(input.queueTaskID)
  if (!input.sessionID) return
  const current = latest.get(input.sessionID)
  if (!current) return
  return tasks.get(current)
}

function sync(state: State, event: CodingEventInfo) {
  const ref = extractExecutorSessionRef(event)
  if (ref?.nativeSessionID) {
    state.externalSessionID = ref.nativeSessionID
    return ref
  }
  if (event.type !== "progress" || !event.meta) return ref
  if (typeof event.meta.session_id === "string" && event.meta.session_id) {
    state.externalSessionID = event.meta.session_id
    return { nativeSessionID: event.meta.session_id }
  }
  const response = event.meta.response
  if (!response || typeof response !== "object") return
  const item = response as Record<string, unknown>
  if (typeof item.id === "string" && item.id) {
    state.externalSessionID = item.id
    return { nativeSessionID: item.id }
  }
  return ref
}

function push(state: State, event: Notify) {
  state.events.push(event)
  for (const consumer of state.consumers) consumer.push(event)
}

/**
 * Finalize all active event-queue consumers. Call this after writing
 * `state.status = "completed" | "failed"` so consumer iterables drain
 * buffered events and exit cleanly — no hand-rolled wake dance here,
 * the queue does it.
 */
function completeConsumers(state: State) {
  for (const consumer of state.consumers) consumer.complete()
  state.consumers.clear()
}

function map(state: State, event: CodingEventInfo): Notify | null {
  if (event.type === "progress") {
    return {
      type: "executor.progress",
      summary: event.summary ?? event.phase,
      payload: {
        sessionID: state.sessionID,
        queueTaskID: state.id,
        phase: event.phase,
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
  if (event.type === "tool_delta") {
    return {
      type: "tool.delta",
      summary: event.name ? `Generating tool call: ${event.name}` : "Generating tool call",
      payload: {
        sessionID: state.sessionID,
        queueTaskID: state.id,
        id: event.id,
        ...(event.name ? { name: event.name } : {}),
        delta: event.delta,
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
    // Tokens/cost are written into the active assistant message row by
    // `build/agent.ts:case "usage"` and surfaced to overlay through
    // `message.updated` — same path as internal sessions. No parallel
    // Notify stream needed; dropping here keeps message-row the single
    // source (rule 8).
    return null
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
