import { App } from "@slack/bolt"
import type { AudioAttachment, BotAdapter, MessageHandler } from "../adapter"

export class SlackAdapter implements BotAdapter {
  readonly platform = "slack"
  private app: App
  private token: string
  private handler?: MessageHandler
  private botUserId?: string
  /** Deduplicate: Slack Socket Mode can deliver the same message event twice */
  private processedMessages = new Set<string>()

  constructor(opts: { token: string; signingSecret?: string; appToken: string }) {
    this.token = opts.token
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

    // Debug: log ALL raw message events before any filtering
    this.app.event("message", async ({ event }) => {
      console.log(`[Slack][DEBUG] raw event: subtype=${(event as any).subtype ?? "none"} bot_id=${(event as any).bot_id ?? "none"} user=${(event as any).user ?? "none"} text="${((event as any).text ?? "").slice(0, 60)}"`)
    })

    this.app.message(async ({ message }) => {
      // Allow file_share subtype (voice messages), block other subtypes
      if (message.subtype && message.subtype !== "file_share") return
      if ("user" in message && message.user === this.botUserId) return
      if (!this.handler) return

      // Extract text (may be empty for voice-only messages)
      const text = ("text" in message ? message.text : undefined) ?? ""

      // Detect audio attachments from message files
      let audio: AudioAttachment | undefined
      const files = (message as any).files as Array<{
        mimetype: string
        url_private: string
        name?: string
        size: number
        duration_ms?: number
      }> | undefined

      if (files) {
        const audioFile = files.find((f) => f.mimetype?.startsWith("audio/"))
        if (audioFile) {
          try {
            const res = await fetch(audioFile.url_private, {
              headers: { Authorization: `Bearer ${this.token}` },
              signal: AbortSignal.timeout(30_000),
            })
            if (res.ok) {
              const buffer = Buffer.from(await res.arrayBuffer())
              audio = {
                data: buffer,
                mime: audioFile.mimetype,
                filename: audioFile.name,
                size: buffer.length,
                duration: audioFile.duration_ms ? audioFile.duration_ms / 1000 : undefined,
              }
            } else {
              console.error(`[Slack] Failed to download audio: ${res.status}`)
            }
          } catch (err) {
            console.error("[Slack] Audio download error:", err)
          }
        }
      }

      // Skip if no text and no audio
      if (!text && !audio) return

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
        text,
        audio,
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
