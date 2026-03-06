import { Bus } from "@/bus"
import { Event as OrchestratorEvent } from "@/orchestrator/model"
import { OrchestratorChannelBindingTable } from "@/orchestrator/orchestrator.sql"
import { findTask } from "@/orchestrator/store"
import { Database, and, eq } from "@/storage/db"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "channel.slack-mirror" })

export namespace SlackMirror {
  const state = Instance.state(() => ({
    booted: false,
  }))

  export function init() {
    if (!process.env.SLACK_BOT_TOKEN) return
    const current = state()
    if (current.booted) return
    current.booted = true
    subscribe()
  }
}

function subscribe() {
  const defs = [
    OrchestratorEvent.TaskCreated,
    OrchestratorEvent.TaskUpdated,
    OrchestratorEvent.PlanActivated,
    OrchestratorEvent.RunUpdated,
    OrchestratorEvent.InteractionRequested,
    OrchestratorEvent.InteractionResolved,
    OrchestratorEvent.DeliveryReady,
    OrchestratorEvent.EvaluationCompleted,
    OrchestratorEvent.GoalPassed,
    OrchestratorEvent.GoalFailed,
    OrchestratorEvent.TaskMessageRecorded,
  ]
  for (const def of defs) {
    Bus.subscribeAll(async (event) => {
      if (event.type !== def.type) return
      const taskID = event.properties?.taskID
      if (typeof taskID !== "string") return
      await publish(taskID, event).catch((error) => {
        log.warn("publish failed", { taskID, type: event.type, error: error instanceof Error ? error.message : String(error) })
      })
    })
  }
}

async function publish(taskID: string, event: { type: string; properties: Record<string, unknown> }) {
  const binding = ensureBinding(taskID)
  if (!binding) return
  const thread = await ensureThread(binding.task_id, binding.channel, binding.thread)
  if (!thread) return
  const text = eventText(taskID, event)
  if (!text) return
  await postMessage({
    channel: binding.channel,
    thread,
    text,
  })
}

function ensureBinding(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorChannelBindingTable)
      .where(and(eq(OrchestratorChannelBindingTable.task_id, taskID), eq(OrchestratorChannelBindingTable.platform, "slack")))
      .get(),
  )
}

async function ensureThread(taskID: string, channel: string, thread: string) {
  if (thread && thread !== "pending") return thread
  const task = findTask(taskID)
  if (!task) return
  const created = await postMessage({
    channel,
    text: [`Task accepted: \`${task.id}\``, task.title, task.request].filter(Boolean).join("\n\n"),
  })
  if (!created?.ts) return
  Database.use((db) =>
    db
      .update(OrchestratorChannelBindingTable)
      .set({
        thread: created.ts,
        time_updated: Date.now(),
      })
      .where(and(eq(OrchestratorChannelBindingTable.task_id, taskID), eq(OrchestratorChannelBindingTable.platform, "slack")))
      .run(),
  )
  return created.ts
}

function eventText(taskID: string, event: { type: string; properties: Record<string, unknown> }) {
  if (event.type === OrchestratorEvent.TaskCreated.type) return ""
  if (event.type === OrchestratorEvent.TaskMessageRecorded.type) {
    if (String(event.properties.source ?? "") === "slack") return ""
    return [`Operator message mirrored`, String(event.properties.text ?? "")].join("\n\n")
  }
  if (event.type === OrchestratorEvent.InteractionRequested.type) {
    return String(event.properties.summary ?? "Input requested.")
  }
  if (event.type === OrchestratorEvent.InteractionResolved.type) {
    return String(event.properties.summary ?? "Interaction resolved.")
  }
  if (event.type === OrchestratorEvent.EvaluationCompleted.type) {
    const verdict = String(event.properties.verdict ?? "inconclusive")
    return `Evaluation ${verdict}: ${String(event.properties.summary ?? "")}`.trim()
  }
  if (event.type === OrchestratorEvent.DeliveryReady.type) {
    return `Delivery ready: ${String(event.properties.summary ?? "")}`.trim()
  }
  if (event.type === OrchestratorEvent.GoalPassed.type || event.type === OrchestratorEvent.GoalFailed.type) {
    return String(event.properties.summary ?? event.type)
  }
  if (event.type === OrchestratorEvent.RunUpdated.type) {
    const status = String(event.properties.status ?? "")
    if (!["blocked", "failed", "completed", "aborted"].includes(status)) return ""
    return `Run ${status}: ${String(event.properties.summary ?? "")}`.trim()
  }
  if (event.type === OrchestratorEvent.PlanActivated.type) {
    return `Plan updated: ${String(event.properties.summary ?? "")}`.trim()
  }
  if (event.type === OrchestratorEvent.TaskUpdated.type) {
    const status = String(event.properties.status ?? "")
    if (!["blocked", "completed", "failed", "cancelled"].includes(status)) return ""
    return `Task ${status}: ${String(event.properties.summary ?? "")}`.trim()
  }
  return ""
}

async function postMessage(input: { channel: string; text: string; thread?: string }) {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: input.channel,
      text: input.text,
      ...(input.thread ? { thread_ts: input.thread } : {}),
    }),
  }).catch(() => undefined)
  if (!response?.ok) return
  const body = await response.json().catch(() => undefined) as { ok?: boolean; ts?: string; error?: string } | undefined
  if (!body?.ok) {
    log.warn("slack api rejected postMessage", { channel: input.channel, error: body?.error })
    return
  }
  return {
    ts: body.ts,
  }
}
