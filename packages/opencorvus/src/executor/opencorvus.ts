import z from "zod"
import { Identifier } from "@/id/id"
import { TaskQueueService } from "@/scheduler/task-queue-service"
import { TaskQueueTable } from "@/scheduler/task-queue.sql"
import { GlobalBus } from "@/bus/global"
import { Session } from "@/session"
import { Message } from "@/session"
import { SessionSummary } from "@/session/summary"
import { SessionPrompt } from "@/session/prompt"
import { Database, eq, and, inArray } from "@/storage/db"
import { createEventQueue } from "@/util/event-queue"
import { EngineConfig } from "@/engine/config"
import { mapSessionBusEvent } from "@/protocol/session-mirror"

const SubmitInput = z.object({
  sessionID: Identifier.schema("session"),
  prompt: z.string(),
  priority: z.enum(["critical", "high", "normal", "low"]).optional(),
  source: z.enum(["evaluator", "system"]).optional(),
})

const ResumeInput = z.object({
  sessionID: Identifier.schema("session"),
  message: z.string(),
  priority: z.enum(["critical", "high", "normal", "low"]).optional(),
})

const EventResult = z.object({
  type: z.string(),
  summary: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
})

export namespace OpencorvusExecutor {
  export function capabilities() {
    return {
      submit: true,
      status: true,
      abort: true,
      acceptance: true,
      resume: true,
      events: true,
    }
  }

  export async function submit(raw: z.input<typeof SubmitInput>) {
    const input = SubmitInput.parse(raw)
    const queueTaskID = TaskQueueService.enqueuePrompt({
      sessionID: input.sessionID,
      prompt: {
        parts: [
          {
            type: "text",
            text: input.prompt,
            ...(input.source ? { source: input.source } : {}),
          },
        ],
      },
      source: "engine.task",
      // Inner agent task queue only knows high/normal/low — that queue
      // schedules steps inside one orchestrator task and has no concept of
      // cross-task pre-emption. Orchestrator-level "critical" (used for fix
      // tasks that jump the project queue) maps to inner "high".
      priority: input.priority === "critical" ? "high" : input.priority,
    })
    void TaskQueueService.runNow()
    return {
      sessionID: input.sessionID,
      queueTaskID,
    }
  }

  export async function status(queueTaskID: string) {
    const row = Database.use((db) => db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, queueTaskID)).get())
    if (!row) throw new Error(`executor task not found: ${queueTaskID}`)
    return {
      queueTaskID: row.id,
      status: row.status,
      error: row.error_message ?? null,
    }
  }

  export async function resume(raw: z.input<typeof ResumeInput>) {
    const input = ResumeInput.parse(raw)
    return submit({
      sessionID: input.sessionID,
      prompt: input.message,
      priority: input.priority,
    })
  }

  export async function abort(input: { sessionID?: string; queueTaskID?: string }) {
    const queueTaskID = input.queueTaskID
    if (input.sessionID) {
      SessionPrompt.cancel(input.sessionID)
    }
    if (queueTaskID) {
      Database.use((db) =>
        db
          .update(TaskQueueTable)
          .set({
            status: "failed",
            error_message: "task cancelled",
            time_completed: Date.now(),
            time_updated: Date.now(),
          })
          .where(and(eq(TaskQueueTable.id, queueTaskID), inArray(TaskQueueTable.status, ["queued", "running"])))
          .run(),
      )
    }
    return true
  }

  export async function acceptance(input: { sessionID: string; since?: number }) {
    const msgs = await Session.messages({ sessionID: input.sessionID })
    const scoped =
      typeof input.since === "number" ? msgs.filter((item) => (item.info.time?.created ?? 0) >= input.since!) : msgs
    const diffs =
      typeof input.since === "number"
        ? await SessionSummary.computeDiff({ messages: scoped })
        : await Session.diff(input.sessionID)
    return {
      summary: summarize(scoped),
      diffs,
    }
  }

  export async function* events(input: {
    goalID?: string
    sessionID?: string
    queueTaskID?: string
    signal?: AbortSignal
  }) {
    if (!input.goalID && !input.sessionID) return

    // audit-2026-04-29 W2-V30 — pre-fix the generator awaited
    // EngineConfig.get() BEFORE registering the GlobalBus handler.
    // Any event published between events() being called (caller
    // does `stream = events(...)`) and the await resolving was
    // dropped — the generator hadn't subscribed yet. Hardest to
    // see in production (eventual replay or retry covers it) but
    // fully exposed in tests that publish a single event after
    // calling stream.next() and time out waiting for it.
    //
    // Subscribe SYNCHRONOUSLY in the body's pre-await region.
    // Buffer events into a pre-await holding array; once the
    // queue is materialised after EngineConfig.get(), drain into
    // it. This way no event published from caller-time to
    // queue-creation-time is lost.
    const buffered: z.infer<typeof EventResult>[] = []
    let queue: ReturnType<typeof createEventQueue<z.infer<typeof EventResult>>> | undefined

    const handler = (msg: { payload: any }) => {
      const event = msg.payload
      if (!event || typeof event.type !== "string") return
      const next = mapSessionBusEvent(event, input)
      if (!next) return
      const target = queue
      if (target) {
        target.push(next)
        if (next.type === "task-queue.completed" && input.queueTaskID) {
          const payload = next.payload as { queueTaskID?: string } | undefined
          if (payload?.queueTaskID === input.queueTaskID) target.complete()
        }
      } else {
        // Pre-queue event — buffer until the queue is ready.
        buffered.push(next)
      }
    }
    // Subscribe to GlobalBus (cross-Instance): goal executors run in
    // worktree Instances while the pipeline consumer sits in the MAIN
    // Instance. Bus.subscribeAll() is Instance-scoped and would miss
    // the worktree events — GlobalBus is the only common surface.
    GlobalBus.on("event", handler)
    try {
      const cfg = await EngineConfig.get()
      queue = createEventQueue<z.infer<typeof EventResult>>({
        idleMs: cfg.activity.executor_events_idle_ms,
        signal: input.signal,
        label: `opencorvus-executor:${input.queueTaskID ?? input.sessionID ?? input.goalID}`,
      })
      // Drain anything we caught during the EngineConfig.get await.
      for (const ev of buffered) {
        queue.push(ev)
        if (ev.type === "task-queue.completed" && input.queueTaskID) {
          const payload = ev.payload as { queueTaskID?: string } | undefined
          if (payload?.queueTaskID === input.queueTaskID) queue.complete()
        }
      }
      buffered.length = 0
      yield* queue.iterable
    } finally {
      GlobalBus.off("event", handler)
      queue?.complete()
    }
  }
}

function summarize(messages: Message.WithParts[]) {
  const assistant = [...messages].filter((item) => item.info.role === "assistant").at(-1)
  if (!assistant) return "Run completed without an assistant summary."
  const text = assistant.parts
    .filter((part): part is Message.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
  if (text) return text
  const tool = assistant.parts
    .flatMap((part) => {
      if (part.type !== "tool") return []
      if (part.state.status !== "completed") return []
      return [part.state.output.trim()]
    })
    .filter(Boolean)
    .join("\n\n")
  if (tool) return tool
  return "Run completed without a textual summary."
}
