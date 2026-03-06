import { App } from "@slack/bolt"
import { Bus } from "@/bus"
import { Event as OrchestratorEvent } from "@/orchestrator/model"
import { OrchestratorService } from "@/orchestrator/service"
import { OrchestratorChannelBindingTable } from "@/orchestrator/orchestrator.sql"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Database, and, eq } from "@/storage/db"
import { Log } from "@/util/log"

const log = Log.create({ service: "channel.slack" })

export class SlackGateway {
  private app: App
  private directory: string
  private botUserId?: string
  private processed = new Set<string>()
  private startedAt = (Date.now() / 1000).toString()
  private unsubs: Array<() => void> = []

  constructor(input: { directory: string; token: string; appToken: string; signingSecret?: string }) {
    this.directory = input.directory
    this.app = new App({
      token: input.token,
      signingSecret: input.signingSecret ?? "",
      socketMode: true,
      appToken: input.appToken,
    })
  }

  async start() {
    await this.withInstance(async () => {
      this.subscribeEvents()
    })
    const auth = await this.app.client.auth.test()
    this.botUserId = auth.user_id
    this.app.message(async ({ message }) => {
      await this.handleMessage(message as any).catch((error) => {
        log.error("slack message handler failed", { error })
      })
    })
    await this.app.start()
    log.info("slack gateway started", { directory: this.directory })
  }

  async stop() {
    for (const unsub of this.unsubs.splice(0)) {
      unsub()
    }
    await this.app.stop()
  }

  private async handleMessage(message: {
    subtype?: string
    user?: string
    text?: string
    ts: string
    thread_ts?: string
    channel: string
  }) {
    if (message.subtype) return
    if (message.user && message.user === this.botUserId) return
    if (message.ts < this.startedAt) return
    if (this.processed.has(message.ts)) return
    this.processed.add(message.ts)
    if (this.processed.size > 500) {
      const oldest = this.processed.values().next().value
      if (oldest) this.processed.delete(oldest)
    }
    const text = (message.text ?? "").trim()
    if (!text) return
    const channel = message.channel
    const thread = message.thread_ts ?? message.ts

    await this.withInstance(async () => {
      const binding = findBinding(channel, thread)
      if (!binding) {
        if (thread !== message.ts) return
        const taskID = await OrchestratorService.createTask({
          project: Instance.project.id,
          source: "slack",
          request: text,
          channelBinding: {
            platform: "slack",
            channel,
            thread,
            payload: {
              user: message.user,
            },
          },
          metadata: {
            slack: {
              user: message.user,
            },
          },
        })
        await this.sendThread(channel, thread, `Task accepted: \`${taskID}\``)
        return
      }

      const interactions = await OrchestratorService.listTaskInteractions(binding.task_id)
      const pending = interactions.find((item) => item.status === "pending")
      if (pending) {
        await this.replyInteraction(binding.task_id, pending, text)
        return
      }

      const result = await OrchestratorService.handleTaskMessage(binding.task_id, {
        text,
        source: "slack",
        user_id: message.user,
      })
      await this.sendThread(channel, thread, result.message)
    })
  }

  private async replyInteraction(
    taskID: string,
    interaction: Awaited<ReturnType<typeof OrchestratorService.listTaskInteractions>>[number],
    text: string,
  ) {
    const binding = findBindingByTask(taskID)
    if (!binding) return
    if (interaction.type === "permission") {
      const parsed = parsePermissionReply(text)
      if (!parsed) {
        await this.sendThread(binding.channel, binding.thread, "Reply with `allow`, `always`, or `reject`.")
        return
      }
      if (parsed.reply === "reject") {
        await OrchestratorService.rejectInteraction(interaction.id, { message: parsed.message })
        await this.sendThread(binding.channel, binding.thread, "Permission rejected.")
        return
      }
      await OrchestratorService.replyInteraction(interaction.id, { reply: parsed.reply })
      await this.sendThread(binding.channel, binding.thread, `Permission reply recorded: \`${parsed.reply}\`.`)
      return
    }

    const count = Array.isArray(interaction.payload?.questions) ? interaction.payload.questions.length : 1
    await OrchestratorService.replyInteraction(interaction.id, {
      answers: Array.from({ length: count }, () => [text]),
    })
    await this.sendThread(binding.channel, binding.thread, "Answer recorded.")
  }

  private subscribeEvents() {
    const subscribe = (def: { type: string }) => {
      const unsub = Bus.subscribeAll(async (event) => {
        if (event.type !== def.type) return
        const taskID = event.properties?.taskID
        if (typeof taskID !== "string") return
        await this.publishEvent(taskID, event)
      })
      this.unsubs.push(unsub)
    }

    subscribe(OrchestratorEvent.TaskUpdated)
    subscribe(OrchestratorEvent.PlanActivated)
    subscribe(OrchestratorEvent.RunUpdated)
    subscribe(OrchestratorEvent.InteractionRequested)
    subscribe(OrchestratorEvent.InteractionResolved)
    subscribe(OrchestratorEvent.DeliveryReady)
    subscribe(OrchestratorEvent.EvaluationCompleted)
    subscribe(OrchestratorEvent.GoalPassed)
    subscribe(OrchestratorEvent.GoalFailed)
  }

  private async publishEvent(taskID: string, event: { type: string; properties: Record<string, unknown> }) {
    await this.withInstance(async () => {
      const binding = findBindingByTask(taskID)
      if (!binding) return
      const text = await formatEvent(taskID, event)
      if (!text) return
      await this.sendThread(binding.channel, binding.thread, text)
    })
  }

  private async sendThread(channel: string, thread: string, text: string) {
    await this.app.client.chat.postMessage({
      channel,
      thread_ts: thread,
      text,
    })
  }

  private withInstance<T>(fn: () => Promise<T>) {
    return Instance.provide({
      directory: this.directory,
      init: InstanceBootstrap,
      fn,
    })
  }
}

function findBinding(channel: string, thread: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorChannelBindingTable)
      .where(
        and(
          eq(OrchestratorChannelBindingTable.platform, "slack"),
          eq(OrchestratorChannelBindingTable.channel, channel),
          eq(OrchestratorChannelBindingTable.thread, thread),
        ),
      )
      .get(),
  )
}

function findBindingByTask(taskID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorChannelBindingTable)
      .where(and(eq(OrchestratorChannelBindingTable.platform, "slack"), eq(OrchestratorChannelBindingTable.task_id, taskID)))
      .get(),
  )
}

async function formatEvent(taskID: string, event: { type: string; properties: Record<string, unknown> }) {
  if (event.type === OrchestratorEvent.InteractionRequested.type) {
    const interactions = await OrchestratorService.listTaskInteractions(taskID)
    const interaction = interactions.find((item) => item.id === event.properties.interactionID)
    if (!interaction) return "Input requested."
    return [`Input requested: ${interaction.title}`, interaction.body].filter(Boolean).join("\n\n")
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

function parsePermissionReply(text: string) {
  const value = text.trim().toLowerCase()
  if (["allow", "approve", "yes", "y", "once"].includes(value)) {
    return { reply: "once" as const }
  }
  if (["always", "allow always", "approve always"].includes(value)) {
    return { reply: "always" as const }
  }
  if (["reject", "deny", "no", "n"].includes(value)) {
    return { reply: "reject" as const, message: undefined }
  }
  return undefined
}
