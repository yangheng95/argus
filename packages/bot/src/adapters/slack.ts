import { App } from "@slack/bolt"
import type { BotAdapter, MessageHandler } from "../adapter"

export class SlackAdapter implements BotAdapter {
  readonly platform = "slack"
  private app: App
  private handler?: MessageHandler
  private botUserId?: string
  /** Deduplicate: Slack Socket Mode can deliver the same message event twice */
  private processedMessages = new Set<string>()

  constructor(opts: { token: string; signingSecret?: string; appToken: string }) {
    this.app = new App({
      token: opts.token,
      signingSecret: opts.signingSecret ?? "",
      socketMode: true,
      appToken: opts.appToken,
    })
  }

  async start(): Promise<void> {
    const auth = await this.app.client.auth.test()
    this.botUserId = auth.user_id
    console.log(`[Slack] Bot user ID: ${this.botUserId}`)

    this.app.message(async ({ message }) => {
      if (message.subtype || !("text" in message) || !message.text) return
      if ("user" in message && message.user === this.botUserId) return
      if (!this.handler) return

      // Deduplicate by message ts — Slack Socket Mode delivers thread events twice
      const msgTs = message.ts
      if (this.processedMessages.has(msgTs)) return
      this.processedMessages.add(msgTs)
      // Prevent unbounded growth
      if (this.processedMessages.size > 500) {
        const oldest = this.processedMessages.values().next().value!
        this.processedMessages.delete(oldest)
      }

      const channel = message.channel
      const thread = (message as any).thread_ts || message.ts

      await this.handler({
        platform: this.platform,
        channel,
        thread,
        user: ("user" in message ? message.user : undefined) ?? "unknown",
        text: message.text,
      })
    })

    await this.app.start()
  }

  async stop(): Promise<void> {
    await this.app.stop()
  }

  async sendMessage(channel: string, thread: string, text: string): Promise<void> {
    await this.app.client.chat.postMessage({
      channel,
      thread_ts: thread,
      text,
    })
  }

  /** Post a top-level message and return its ts (for threading replies) */
  async postAndGetTs(channel: string, text: string): Promise<string> {
    const result = await this.app.client.chat.postMessage({ channel, text })
    return result.ts!
  }

  async uploadImage(channel: string, thread: string, imageBuffer: Buffer, filename: string, title?: string): Promise<void> {
    await this.app.client.filesUploadV2({
      channel_id: channel,
      thread_ts: thread,
      file: imageBuffer,
      filename,
      title: title ?? filename,
    })
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler
  }
}
