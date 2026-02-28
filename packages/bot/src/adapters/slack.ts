import { App } from "@slack/bolt"
import type { BotAdapter, MessageHandler } from "../adapter"

export class SlackAdapter implements BotAdapter {
  readonly platform = "slack"
  private app: App
  private handler?: MessageHandler

  constructor(opts: { token: string; signingSecret?: string; appToken: string }) {
    this.app = new App({
      token: opts.token,
      signingSecret: opts.signingSecret ?? "",
      socketMode: true,
      appToken: opts.appToken,
    })
  }

  async start(): Promise<void> {
    this.app.message(async ({ message }) => {
      if (message.subtype || !("text" in message) || !message.text) return
      if (!this.handler) return

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
