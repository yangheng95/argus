import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

/**
 * Trace — unified, always-on workflow tracing.
 *
 * Replaces AgentTrace (per-agent markdown dump) and the env-gated LLMTrace
 * (session-level JSONL). Every workflow event — task start/finish, agent
 * boundaries, llm.step deltas, tool.call/result, phase changes — flows
 * through the same Trace.event() API. Each call:
 *   1. appends a JSON line to <Instance.directory>/.opencorvus/trace/<taskID>.jsonl
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

  // Per-taskID monotonic counter. Sequence numbers reset per task so the
  // benchmark can verify "no gaps" without coordinating across tasks.
  const counters = new Map<string, number>()

  // Per-file write queue — appends are chained so concurrent events for the
  // same task land in JSONL in the order Trace.event() was called, not the
  // order the kernel happened to flush. Key is absolute file path so multiple
  // Instances writing different files don't serialise against each other.
  const writes = new Map<string, Promise<void>>()

  // Single-event soft cap (1 MB). Larger payloads usually mean somebody
  // captured a base64 blob or full file contents — truncate, don't write.
  const MAX_LINE_BYTES = 1_048_576

  function nextSeq(taskID: string): number {
    const next = (counters.get(taskID) ?? 0) + 1
    counters.set(taskID, next)
    return next
  }

  function traceDir(): string | undefined {
    const override = process.env.OPENCORVUS_TRACE_DIR?.trim()
    if (override) return override
    try {
      return path.join(Instance.directory, ".opencorvus", "trace")
    } catch {
      return undefined
    }
  }

  export function file(taskID: string): string | undefined {
    const dir = traceDir()
    if (!dir) return undefined
    return path.join(dir, `${taskID}.jsonl`)
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
      seq: nextSeq(input.taskID),
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
   * List recent task IDs (by JSONL mtime, newest first). Used by overlay's
   * "pick a task to view trace" picker and by `--latest` in benchmarks.
   */
  export async function listTasks(): Promise<string[]> {
    const dir = traceDir()
    if (!dir) return []
    const entries = await fs.readdir(dir).catch(() => [])
    const stats = await Promise.all(
      entries
        .filter((name) => name.endsWith(".jsonl"))
        .map(async (name) => ({
          taskID: name.replace(/\.jsonl$/, ""),
          mtime: (await fs.stat(path.join(dir, name)).catch(() => null))?.mtimeMs ?? 0,
        })),
    )
    return stats.sort((a, b) => b.mtime - a.mtime).map((s) => s.taskID)
  }

  /**
   * For tests only — flushes any in-flight writes so subsequent reads see
   * everything. Production code shouldn't need this.
   */
  export async function flush(): Promise<void> {
    await Promise.all(writes.values())
  }

  /**
   * For tests only — wipe the per-task seq counter and write queue. Lets
   * a test re-emit events for the same taskID with seq starting at 1.
   */
  export function _resetForTests(taskID?: string): void {
    if (taskID) {
      counters.delete(taskID)
    } else {
      counters.clear()
      writes.clear()
    }
  }
}
