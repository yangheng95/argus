import z from "zod"
import { Identifier } from "@/id/id"
import { TaskQueueService } from "@/scheduler/task-queue-service"
import { TaskQueueTable } from "@/scheduler/task-queue.sql"
import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { Session } from "@/session"
import { Message, SessionStatus } from "@/session"
import { SessionSummary } from "@/session/summary"
import { SessionPrompt } from "@/session/prompt"
import { Snapshot } from "@/snapshot"
import { Database, eq, and, inArray } from "@/storage/db"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { sessionGoalID } from "@/server/routes/task-event"
import { createEventQueue } from "@/util/event-queue"
import { EngineConfig } from "@/engine/config"

const SubmitInput = z.object({
  sessionID: Identifier.schema("session"),
  prompt: z.string(),
  priority: z.enum(["critical", "high", "normal", "low"]).optional(),
  source: z.enum(["planner", "evaluator", "system"]).optional(),
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

export namespace OpencodeExecutor {
  export function capabilities() {
    return {
      submit: true,
      status: true,
      abort: true,
      delivery: true,
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
          .where(and(
            eq(TaskQueueTable.id, queueTaskID),
            inArray(TaskQueueTable.status, ["queued", "running"]),
          ))
          .run(),
      )
    }
    return true
  }

  export async function delivery(input: { sessionID: string; since?: number }) {
    const msgs = await Session.messages({ sessionID: input.sessionID })
    const scoped = typeof input.since === "number"
      ? msgs.filter((item) => (item.info.time?.created ?? 0) >= input.since!)
      : msgs
    const diffs = typeof input.since === "number"
      ? await SessionSummary.computeDiff({ messages: scoped })
      : await Session.diff(input.sessionID)
    return {
      summary: summarize(scoped),
      diffs,
    }
  }

  export async function* events(input: { goalID?: string; sessionID?: string; queueTaskID?: string; signal?: AbortSignal }) {
    if (!input.goalID && !input.sessionID) return
    const cfg = await EngineConfig.get()
    const queue = createEventQueue<z.infer<typeof EventResult>>({
      idleMs: cfg.activity.executor_events_idle_ms,
      signal: input.signal,
      label: `opencode-executor:${input.queueTaskID ?? input.sessionID ?? input.goalID}`,
    })

    // Subscribe to GlobalBus (cross-Instance): goal executors run in
    // worktree Instances while the pipeline consumer sits in the MAIN
    // Instance. Bus.subscribeAll() is Instance-scoped and would miss
    // the worktree events — GlobalBus is the only common surface.
    const handler = (msg: { payload: any }) => {
      const event = msg.payload
      if (!event || typeof event.type !== "string") return
      const next = mapEvent(event, input)
      if (!next) return
      queue.push(next)
      if (next.type === "task-queue.completed" && input.queueTaskID) {
        const payload = next.payload as { queueTaskID?: string } | undefined
        if (payload?.queueTaskID === input.queueTaskID) queue.complete()
      }
    }
    GlobalBus.on("event", handler)
    try {
      yield* queue.iterable
    } finally {
      GlobalBus.off("event", handler)
      queue.complete()
    }
  }
}

function eventSessionID(event: { type: string; properties: Record<string, unknown> }) {
  const props = event.properties
  if (typeof props.sessionID === "string" && props.sessionID.length > 0) return props.sessionID
  const info = props.info
  if (typeof info === "object" && info !== null && typeof (info as Record<string, unknown>).sessionID === "string") {
    return (info as Record<string, unknown>).sessionID as string
  }
  const part = props.part
  if (typeof part === "object" && part !== null && typeof (part as Record<string, unknown>).sessionID === "string") {
    return (part as Record<string, unknown>).sessionID as string
  }
  return undefined
}

function mapEvent(
  event: { type: string; properties: Record<string, unknown> },
  input: { goalID?: string; sessionID?: string },
) {
  const props = event.properties
  const sessionID = eventSessionID(event)
  if (!sessionID) return
  if (input.goalID) {
    if (sessionGoalID(sessionID) !== input.goalID) return
  } else if (input.sessionID) {
    if (sessionID !== input.sessionID) return
  } else {
    return
  }

  if (event.type === SessionStatus.Event.Status.type) {
    return {
      type: "session.status",
      summary: String(props.status ?? "session status"),
      payload: props,
    }
  }
  if (event.type === SessionStatus.Event.Idle.type) {
    return {
      type: "session.idle",
      summary: "Session idle",
      payload: props,
    }
  }
  if (event.type === Message.Event.Updated.type) {
    const info = props.info as Record<string, unknown>
    // Stamp agent identity — external executor processes don't set this
    if (!info.agent) info.agent = "executor"
    return {
      type: "message.updated",
      summary: typeof info.role === "string" ? `Message updated: ${info.role}` : "Message updated",
      payload: props,
    }
  }
  if (event.type === Message.Event.PartUpdated.type) {
    const part = props.part as Record<string, unknown>
    return {
      type: "message.part.updated",
      summary: typeof part.type === "string" ? `Part updated: ${part.type}` : "Part updated",
      payload: props,
    }
  }
  if (event.type === Message.Event.PartDelta.type) {
    return {
      type: "message.part.delta",
      summary: typeof props.field === "string" ? `Delta: ${props.field}` : "Message delta",
      payload: props,
    }
  }
  if (event.type === Message.Event.Removed.type) {
    return {
      type: "message.removed",
      summary: "Message removed",
      payload: props,
    }
  }
  if (event.type === Message.Event.PartRemoved.type) {
    return {
      type: "message.part.removed",
      summary: "Part removed",
      payload: props,
    }
  }
  if (event.type === Session.Event.Error.type) {
    return {
      type: "session.error",
      summary: "Session error",
      payload: props,
    }
  }
  if (event.type === PermissionNext.Event.Asked.type) {
    return {
      type: "permission.asked",
      summary: `Permission requested: ${String(props.permission ?? "")}`.trim(),
      payload: props,
    }
  }
  if (event.type === PermissionNext.Event.Replied.type) {
    return {
      type: "permission.replied",
      summary: `Permission reply: ${String(props.reply ?? "")}`.trim(),
      payload: props,
    }
  }
  if (event.type === Question.Event.Asked.type) {
    return {
      type: "question.asked",
      summary: "Question requested",
      payload: props,
    }
  }
  if (event.type === Question.Event.Replied.type) {
    return {
      type: "question.replied",
      summary: "Question answered",
      payload: props,
    }
  }
  if (event.type === Question.Event.Rejected.type) {
    return {
      type: "question.rejected",
      summary: "Question rejected",
      payload: props,
    }
  }
  return {
    type: event.type,
    summary: event.type,
    payload: props,
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
