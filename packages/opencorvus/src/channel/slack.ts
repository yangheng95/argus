import { App } from "@slack/bolt"
import { ChannelIngress } from "@/channel/ingress"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Log } from "@/util/log"

const log = Log.create({ service: "channel.slack" })

export class SlackGateway {
  private app: App
  private directory: string
  private botUserId?: string
  private processed = new Set<string>()
  private startedAt = (Date.now() / 1000).toString()

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
    this.app.message(async ({ message }) => {
      await this.handleMessage(message as any).catch((error) => {
        log.error("slack message handler failed", { error })
      })
    })
    await this.app.start()
    log.info("slack gateway started", { directory: this.directory })
  }

  async stop() {
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
      await this.sendThread(channel, thread, result.message)
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
