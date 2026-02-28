import { App } from "@slack/bolt"

export type MessageHandler = (msg: {
  platform: string
  channel: string
  thread: string
  user: string
  text: string
}) => Promise<void>

export class SlackAdapter {
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

  onMessage(handler: MessageHandler): void {
    this.handler = handler
  }
}
