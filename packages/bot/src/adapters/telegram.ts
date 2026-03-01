import { Bot, InputFile } from "grammy"
import type { AudioAttachment, BotAdapter, MessageHandler } from "../adapter"

export class TelegramAdapter implements BotAdapter {
  readonly platform = "telegram"
  private bot: Bot
  private token: string
  private handler?: MessageHandler

  constructor(opts: { token: string }) {
    this.token = opts.token
    this.bot = new Bot(opts.token)
  }

  async start(): Promise<void> {
    this.bot.on("message:text", async (ctx) => {
      // Ignore messages from the bot itself
      if (ctx.from.id === this.bot.botInfo.id) return
      if (!this.handler) return

      const channel = String(ctx.chat.id)
      const thread = String(
        ctx.message.reply_to_message?.message_id ?? ctx.message.message_id,
      )
      const user = String(ctx.from.id)

      await this.handler({
        platform: this.platform,
        channel,
        thread,
        user,
        text: ctx.message.text,
      })
    })

    // Voice messages (Telegram voice notes, always .ogg opus)
    this.bot.on("message:voice", async (ctx) => {
      if (ctx.from.id === this.bot.botInfo.id) return
      if (!this.handler) return

      const channel = String(ctx.chat.id)
      const thread = String(
        ctx.message.reply_to_message?.message_id ?? ctx.message.message_id,
      )
      const user = String(ctx.from.id)

      const audio = await this.downloadTelegramFile(
        ctx.message.voice.file_id,
        "audio/ogg",
        ctx.message.voice.duration,
      )

      if (!audio) return

      await this.handler({
        platform: this.platform,
        channel,
        thread,
        user,
        text: ctx.message.caption ?? "",
        audio,
      })
    })

    // Audio file attachments (e.g., .mp3, .m4a sent as documents)
    this.bot.on("message:audio", async (ctx) => {
      if (ctx.from.id === this.bot.botInfo.id) return
      if (!this.handler) return

      const channel = String(ctx.chat.id)
      const thread = String(
        ctx.message.reply_to_message?.message_id ?? ctx.message.message_id,
      )
      const user = String(ctx.from.id)

      const audio = await this.downloadTelegramFile(
        ctx.message.audio.file_id,
        ctx.message.audio.mime_type ?? "audio/mpeg",
        ctx.message.audio.duration,
        ctx.message.audio.file_name,
      )

      if (!audio) return

      await this.handler({
        platform: this.platform,
        channel,
        thread,
        user,
        text: ctx.message.caption ?? "",
        audio,
      })
    })

    // bot.start() blocks (long polling), so we don't await it
    this.bot.start()
    console.log(`[Telegram] Bot started (long polling)`)
  }

  private async downloadTelegramFile(
    fileId: string,
    mime: string,
    duration?: number,
    filename?: string,
  ): Promise<AudioAttachment | undefined> {
    try {
      const file = await this.bot.api.getFile(fileId)
      const filePath = file.file_path
      if (!filePath) {
        console.error("[Telegram] getFile returned no file_path")
        return undefined
      }

      const url = `https://api.telegram.org/file/bot${this.token}/${filePath}`
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) {
        console.error(`[Telegram] Failed to download file: ${res.status}`)
        return undefined
      }

      const buffer = Buffer.from(await res.arrayBuffer())
      return {
        data: buffer,
        mime,
        filename,
        size: buffer.length,
        duration,
      }
    } catch (err) {
      console.error("[Telegram] Audio download error:", err)
      return undefined
    }
  }

  async stop(): Promise<void> {
    this.bot.stop()
  }

  async sendMessage(channel: string, thread: string, text: string): Promise<void> {
    await this.bot.api.sendMessage(Number(channel), text, {
      reply_parameters: { message_id: Number(thread) },
    })
  }

  async uploadImage(
    channel: string,
    thread: string,
    imageBuffer: Buffer,
    filename: string,
    title?: string,
  ): Promise<void> {
    await this.bot.api.sendPhoto(
      Number(channel),
      new InputFile(imageBuffer, filename),
      {
        caption: title ?? filename,
        reply_parameters: { message_id: Number(thread) },
      },
    )
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler
  }
}
