import {
  AttachmentBuilder,
  ChannelType,
  Client,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  type Message,
  type MessageCreateOptions,
  type TextBasedChannel,
} from "discord.js"
import type { BotAdapter, MessageHandler } from "../adapter"

type SendChannel = TextBasedChannel & {
  send: (options: MessageCreateOptions) => Promise<unknown>
}

function root(msg: Message<true>): string {
  if (msg.type === 19 && msg.reference?.messageId) return msg.reference.messageId
  if (msg.channel.isThread()) return msg.channel.id
  return msg.id
}

function allow(msg: Message): msg is Message<true> {
  if (msg.author.bot) return false
  if (!msg.inGuild() && msg.channel.type !== ChannelType.DM) return false
  return true
}

export class DiscordAdapter implements BotAdapter {
  readonly platform = "discord"
  private client: Client
  private handler?: MessageHandler

  constructor(opts: { token: string }) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    })

    this.client.once("ready", () => {
      console.log(`[Discord] Logged in as ${this.client.user?.tag}`)
    })

    this.client.on("messageCreate", async (msg: Message) => {
      if (!allow(msg)) return
      if (!this.handler) return

      await this.handler({
        platform: this.platform,
        channel: msg.channelId,
        thread: root(msg),
        user: msg.author.id,
        text: msg.content ?? "",
      })
    })

    this.token = opts.token
  }

  private token: string

  async start(): Promise<void> {
    await this.client.login(this.token)
  }

  async stop(): Promise<void> {
    await this.client.destroy()
  }

  private async textChannel(id: string): Promise<SendChannel> {
    const ch = await this.client.channels.fetch(id)
    if (!ch || !ch.isTextBased() || typeof (ch as any).send !== "function") {
      throw new Error(`Channel ${id} not found or not text-based`)
    }
    return ch as SendChannel
  }

  private async sendReply(channel: SendChannel, thread: string, text: string) {
    const opts: MessageCreateOptions = {
      content: text,
      allowedMentions: { parse: [] },
    }

    try {
      await channel.send({
        ...opts,
        reply: {
          messageReference: thread,
          failIfNotExists: false,
        },
      })
      return
    } catch {}

    await channel.send(opts)
  }

  async sendMessage(channel: string, thread: string, text: string): Promise<void> {
    const ch = await this.textChannel(channel)
    await this.sendReply(ch, thread, text)
  }

  async uploadImage(channel: string, thread: string, imageBuffer: Buffer, filename: string, title?: string): Promise<void> {
    const ch = await this.textChannel(channel)
    const file = new AttachmentBuilder(imageBuffer, { name: filename })

    try {
      await ch.send({
        content: title,
        files: [file],
        reply: {
          messageReference: thread,
          failIfNotExists: false,
        },
        allowedMentions: { parse: [] },
      })
      return
    } catch {
      await ch.send({
        content: title,
        files: [file],
        flags: MessageFlags.SuppressNotifications,
        allowedMentions: { parse: [] },
      })
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler
  }
}
