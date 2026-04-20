import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { taskIDForSession as resolveTaskID } from "@/server/routes/task-event"

/**
 * Trace — unified, always-on workflow tracing.
 *
 * Replaces AgentTrace (per-agent markdown dump) and the env-gated LLMTrace
 * (session-level JSONL). Every workflow event — task start/finish, agent
 * boundaries, llm.step deltas, tool.call/result, phase changes — flows
 * through the same Trace.event() API. Each call:
 *   1. appends a JSON line to <Instance.directory>/.opencorvus/task/<taskID>/trace.jsonl
 *   2. broadcasts via Bus.publish so overlay SSE consumers get it live
 *
 * The runtime (session/llm.ts) hooks every LLM call so individual agents
 * don't need to call Trace.event manually for their LLM activity. Workflow
 * orchestration code adds task / phase / tool meta events.
 */

const log = Log.create({ service: "trace" })

const TraceCategory = z.enum([
  "task.start",
  "task.finish",
  "agent.start",
  "agent.finish",
  "llm.request",      // pre-transform outbound: full system + messages + providerOptions
  "llm.outbound",     // post-transform: raw body handed to streamText per step
  "llm.step",
  "llm.finish",
  "llm.error",
  "tool.call",
  "tool.result",
  "tool.error",
  "phase.change",
  "error",
])
export type TraceCategory = z.infer<typeof TraceCategory>

const TraceEventSchema = z.object({
  ts: z.number(),
  seq: z.number(),
  taskID: z.string(),
  sessionID: z.string().optional(),
  agent: z.string().optional(),
  round: z.number().optional(),
  category: z.string(),
  payload: z.unknown().optional(),
})
export type TraceEvent = z.infer<typeof TraceEventSchema>

export namespace Trace {
  export const Event = BusEvent.define("trace.event", TraceEventSchema)

  /**
   * Resolve the task that owns a session — walks `session.parent_id` to the
   * root and joins to `engine_task.session_id`. Returns undefined only
   * when the session row is genuinely orphaned (a real bug), in which case
   * the caller MUST throw rather than silently dropping events.
   */
  export function taskIDForSession(sessionID: string): string | undefined {
    return resolveTaskID(sessionID)
  }

  // Per-file write queue — appends are chained so concurrent events for the
  // same task land in JSONL in the order Trace.event() was called, not the
  // order the kernel happened to flush. Key is absolute file path so multiple
  // Instances writing different files don't serialise against each other.
  const writes = new Map<string, Promise<void>>()

  // Single-event soft cap (1 MB). Larger payloads usually mean somebody
  // captured a base64 blob or full file contents — truncate, don't write.
  const MAX_LINE_BYTES = 1_048_576

  // Per-process monotonic sequence — only used as a tiebreaker for events
  // that share a millisecond timestamp. Across process restarts the counter
  // resets, but `ts` still orders events from different runs correctly, so
  // readers should sort by (ts, seq).
  let seqCounter = 0
  function nextSeq(): number {
    return ++seqCounter
  }

  // Project-scoped task root: <Instance.directory>/.opencorvus/task/.
  // Each task gets its own subdirectory (task/<taskID>/) so future per-task
  // artifacts (trace, logs, outputs) live together and a task's on-disk state
  // can be wiped by removing a single directory. OPENCORVUS_TRACE_DIR still
  // overrides the root for tests; subdirectory layout is preserved under it.
  function taskRoot(): string | undefined {
    const override = process.env.OPENCORVUS_TRACE_DIR?.trim()
    if (override) return override
    try {
      return path.join(Instance.directory, ".opencorvus", "task")
    } catch {
      return undefined
    }
  }

  export function file(taskID: string): string | undefined {
    const root = taskRoot()
    if (!root) return undefined
    return path.join(root, taskID, "trace.jsonl")
  }

  function enqueue(file: string, line: string) {
    const prev = writes.get(file) ?? Promise.resolve()
    const next = prev
      .then(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.appendFile(file, line, "utf8")
      })
      .catch((error) => {
        log.warn("trace write failed", { file, error: String(error) })
      })
    writes.set(file, next)
  }

  /**
   * Record one trace event. Synchronous from the caller's perspective —
   * disk write happens on the per-file queue in the background, Bus broadcast
   * fires immediately. Never throws: trace failures must not crash workflows.
   */
  export function event(input: {
    taskID: string
    sessionID?: string
    agent?: string
    round?: number
    category: TraceCategory | string
    payload?: unknown
  }): void {
    const ev: TraceEvent = {
      ts: Date.now(),
      seq: nextSeq(),
      taskID: input.taskID,
      sessionID: input.sessionID,
      agent: input.agent,
      round: input.round,
      category: input.category,
      payload: input.payload,
    }

    const f = file(input.taskID)
    if (f) {
      let line = JSON.stringify(ev) + "\n"
      if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
        const truncated: TraceEvent = {
          ...ev,
          payload: {
            _truncated: true,
            originalBytes: Buffer.byteLength(line, "utf8"),
            note: `payload exceeded ${MAX_LINE_BYTES} bytes — dropped`,
          },
        }
        line = JSON.stringify(truncated) + "\n"
      }
      enqueue(f, line)
    }

    void Bus.publish(Event, ev).catch((error) => {
      log.warn("trace bus broadcast failed", { taskID: input.taskID, error: String(error) })
    })
  }

  /**
   * Read all events for a task. Used by the /trace/:taskID HTTP route and
   * by tests / benchmarks. Returns [] if the file doesn't exist.
   */
  export async function read(taskID: string): Promise<TraceEvent[]> {
    const f = file(taskID)
    if (!f) return []
    const raw = await fs.readFile(f, "utf8").catch(() => "")
    if (!raw.trim()) return []
    const events: TraceEvent[] = []
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        events.push(JSON.parse(line))
      } catch {
        // Skip malformed lines (partial writes during crash, etc.) — don't fail the whole read.
      }
    }
    return events
  }

  /**
   * List recent task IDs (by trace.jsonl mtime, newest first). Used by the
   * overlay's "pick a task to view trace" picker and by `--latest` in
   * benchmarks. Enumerates task/<taskID>/trace.jsonl under taskRoot().
   */
  export async function listTasks(): Promise<string[]> {
    const root = taskRoot()
    if (!root) return []
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    const stats = await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map(async (e) => {
          const jsonl = path.join(root, e.name, "trace.jsonl")
          const stat = await fs.stat(jsonl).catch(() => null)
          return stat ? { taskID: e.name, mtime: stat.mtimeMs } : null
        }),
    )
    return stats
      .filter((s): s is { taskID: string; mtime: number } => s !== null)
      .sort((a, b) => b.mtime - a.mtime)
      .map((s) => s.taskID)
  }

  /**
   * For tests only — flushes any in-flight writes so subsequent reads see
   * everything. Production code shouldn't need this.
   */
  export async function flush(): Promise<void> {
    await Promise.all(writes.values())
  }

  /**
   * For tests only — wipe the write queue and reset the seq counter. Lets
   * a test re-emit events without leftover queued promises from prior runs.
   */
  export function _resetForTests(): void {
    seqCounter = 0
    writes.clear()
  }
}
