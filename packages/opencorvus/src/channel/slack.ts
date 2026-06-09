import { App } from "@slack/bolt"
import { Bus } from "@/bus"
import { ChannelIngress } from "@/channel/ingress"
import { Event as EngineEvent, EngineChannelBindingTable } from "@/engine"
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
  private unsub?: () => void

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
    const auth = await this.app.client.auth.test()
    this.botUserId = auth.user_id
    this.subscribeEvents()
    this.app.message(async ({ message }) => {
      await this.handleMessage(message as any).catch((error) => {
        log.error("slack message handler failed", { error })
      })
    })
    await this.app.start()
    log.info("slack gateway started", { directory: this.directory })
  }

  async stop() {
    this.unsub?.()
    this.unsub = undefined
    await this.app.stop()
  }

  private subscribeEvents() {
    this.unsub?.()
    this.unsub = Bus.subscribe(EngineEvent.EvaluationCompleted, async (event) => {
      await this.withInstance(async () => {
        const binding = Database.use((db) =>
          db
            .select()
            .from(EngineChannelBindingTable)
            .where(
              and(
                eq(EngineChannelBindingTable.task_id, event.properties.taskID),
                eq(EngineChannelBindingTable.platform, "slack"),
              ),
            )
            .get(),
        )
        if (!binding) return
        await this.sendThread(
          binding.channel,
          binding.thread,
          `Evaluation ${event.properties.verdict}: ${event.properties.summary}`,
        )
      }).catch((error) => {
        log.error("slack event publish failed", {
          error,
          event: event.type,
          taskID: event.properties.taskID,
        })
      })
    })
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
      const result = await ChannelIngress.message({
        platform: "slack",
        channel,
        thread,
        text,
        user_id: message.user,
        request_id: message.ts,
        source: "slack",
        allow_create: thread === message.ts,
      })
      await this.sendThread(channel, thread, result.message, result.attachments)
    })
  }

  private async sendThread(
    channel: string,
    thread: string,
    text: string,
    attachments?: Array<{ mime: string; url: string; filename?: string }>,
  ) {
    if (text.trim()) {
      await this.app.client.chat.postMessage({
        channel,
        thread_ts: thread,
        text,
      })
    }
    const uploads = (attachments ?? [])
      .map(fileUpload)
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    if (uploads.length === 0) return
    await this.app.client.files.uploadV2({
      channel_id: channel,
      thread_ts: thread,
      file_uploads: uploads,
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

function fileUpload(input: { mime: string; url: string; filename?: string }) {
  if (!input.url.startsWith("data:") || !input.url.includes(",")) return
  const [head, data] = input.url.split(",", 2)
  const mime = input.mime || head.match(/^data:([^;]+)/)?.[1] || "application/octet-stream"
  return {
    file: Buffer.from(data, "base64"),
    filename: input.filename ?? defaultFileName(mime),
  }
}

function defaultFileName(mime: string) {
  if (mime === "image/png") return "opencorvus-gui.png"
  if (mime === "image/jpeg") return "opencorvus-gui.jpg"
  return "opencorvus-gui.bin"
}
