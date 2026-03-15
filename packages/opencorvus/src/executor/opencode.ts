import z from "zod"
import { Identifier } from "@/id/id"
import { TaskQueueService } from "@/scheduler/task-queue-service"
import { TaskQueueTable } from "@/scheduler/task-queue.sql"
import { GlobalBus } from "@/bus/global"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message"
import { SessionSummary } from "@/session/summary"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { Snapshot } from "@/snapshot"
import { Database, eq } from "@/storage/db"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { Log } from "@/util/log"

const SubmitInput = z.object({
  sessionID: Identifier.schema("session"),
  prompt: z.string(),
  priority: z.enum(["high", "normal", "low"]).optional(),
  source: z.enum(["planner", "scheduler", "system"]).optional(),
})

const ResumeInput = z.object({
  sessionID: Identifier.schema("session"),
  message: z.string(),
  priority: z.enum(["high", "normal", "low"]).optional(),
})

const EventResult = z.object({
  type: z.string(),
  summary: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
})

export namespace OpencodeExecutor {
  const log = Log.create({ service: "opencode-executor" })

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
      source: "orchestrator.task",
      priority: input.priority,
    })
    // Fire-and-forget: trigger immediate queue processing.  Errors inside
    // individual task execution are already caught by TaskQueueService (fail()),
    // but poll() itself can throw on database errors, so we catch here to
    // prevent an unhandled promise rejection from crashing the process.
    void TaskQueueService.runNow().catch((error) => {
      log.error("task queue runNow failed", {
        sessionID: input.sessionID,
        error: error instanceof Error ? error.message : String(error),
      })
    })
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
          .where(eq(TaskQueueTable.id, queueTaskID))
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

  export async function* events(input: { sessionID?: string; queueTaskID?: string; signal?: AbortSignal }) {
    if (!input.sessionID) return
    const sessionID = input.sessionID
    const queue: Array<z.infer<typeof EventResult>> = []
    let done = false
    let wake: (() => void) | undefined
    const push = (event: z.infer<typeof EventResult>) => {
      queue.push(event)
      wake?.()
    }
    const handler = (event: { payload: { type: string; properties: Record<string, unknown> } }) => {
      const next = mapEvent(event.payload, sessionID)
      if (!next) return
      push(next)
    }
    GlobalBus.on("event", handler)
    const abort = () => {
      done = true
      GlobalBus.off("event", handler)
      wake?.()
    }
    input.signal?.addEventListener("abort", abort)
    try {
      while (!done) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve
          })
          wake = undefined
          if (done && queue.length === 0) break
        }
        const next = queue.shift()
        if (next) yield next
      }
    } finally {
      input.signal?.removeEventListener("abort", abort)
      GlobalBus.off("event", handler)
    }
  }
}

function mapEvent(event: { type: string; properties: Record<string, unknown> }, sessionID: string) {
  const props = event.properties
  const matchSession =
    props.sessionID === sessionID ||
    (typeof props === "object" &&
      props !== null &&
      "info" in props &&
      typeof props.info === "object" &&
      props.info !== null &&
      (props.info as Record<string, unknown>).sessionID === sessionID) ||
    (typeof props === "object" &&
      props !== null &&
      "part" in props &&
      typeof props.part === "object" &&
      props.part !== null &&
      (props.part as Record<string, unknown>).sessionID === sessionID)

  if (!matchSession) return

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
  if (event.type === MessageV2.Event.Updated.type) {
    const info = props.info as Record<string, unknown>
    return {
      type: "message.updated",
      summary: typeof info.role === "string" ? `Message updated: ${info.role}` : "Message updated",
      payload: props,
    }
  }
  if (event.type === MessageV2.Event.PartUpdated.type) {
    const part = props.part as Record<string, unknown>
    return {
      type: "message.part.updated",
      summary: typeof part.type === "string" ? `Part updated: ${part.type}` : "Part updated",
      payload: props,
    }
  }
  if (event.type === MessageV2.Event.PartDelta.type) {
    return {
      type: "message.part.delta",
      summary: typeof props.field === "string" ? `Delta: ${props.field}` : "Message delta",
      payload: props,
    }
  }
  if (event.type === MessageV2.Event.Removed.type) {
    return {
      type: "message.removed",
      summary: "Message removed",
      payload: props,
    }
  }
  if (event.type === MessageV2.Event.PartRemoved.type) {
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

function summarize(messages: MessageV2.WithParts[]) {
  const assistant = [...messages].filter((item) => item.info.role === "assistant").at(-1)
  if (!assistant) return "Run completed without an assistant summary."
  const text = assistant.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
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
