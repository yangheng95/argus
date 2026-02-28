import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk"
import type { BotAdapter, IncomingMessage } from "./adapter"
import { formatResponse, formatToolUpdate } from "./format"

interface SessionEntry {
  sessionId: string
  adapter: BotAdapter
  channel: string
  thread: string
}

export interface BotCoreOptions {
  port?: number
}

export class BotCore {
  private sessions = new Map<string, SessionEntry>()
  private adapters: BotAdapter[] = []
  private client!: OpencodeClient
  private server!: { url: string; close(): void }

  constructor(private options?: BotCoreOptions) {}

  register(adapter: BotAdapter): this {
    this.adapters.push(adapter)
    return this
  }

  async start(): Promise<void> {
    const argus = await createOpencode({ port: this.options?.port ?? 0 })
    this.client = argus.client
    this.server = argus.server

    this.subscribeEvents()

    for (const adapter of this.adapters) {
      adapter.onMessage((msg) => this.handleMessage(msg))
      await adapter.start()
    }
  }

  async stop(): Promise<void> {
    for (const adapter of this.adapters) {
      await adapter.stop()
    }
    this.server.close()
  }

  async handleMessage(msg: IncomingMessage): Promise<void> {
    const threadKey = `${msg.platform}:${msg.channel}:${msg.thread}`
    const adapter = this.adapters.find((a) => a.platform === msg.platform)
    if (!adapter) return

    let session = this.sessions.get(threadKey)

    if (!session) {
      const createResult = await this.client.session.create({
        body: { title: `${msg.platform} thread ${msg.thread}` },
      })

      if (createResult.error) {
        await adapter.sendMessage(msg.channel, msg.thread, "Sorry, I had trouble creating a session. Please try again.")
        return
      }

      session = {
        sessionId: createResult.data.id,
        adapter,
        channel: msg.channel,
        thread: msg.thread,
      }
      this.sessions.set(threadKey, session)

      const shareResult = await this.client.session.share({ path: { id: createResult.data.id } })
      if (!shareResult.error && shareResult.data?.share?.url) {
        await adapter.sendMessage(msg.channel, msg.thread, shareResult.data.share.url)
      }
    }

    const result = await this.client.session.prompt({
      path: { id: session.sessionId },
      body: { parts: [{ type: "text", text: msg.text }] },
    })

    if (result.error) {
      console.error("[BotCore] prompt error:", JSON.stringify(result.error).slice(0, 500))
      await adapter.sendMessage(msg.channel, msg.thread, "Sorry, I had trouble processing your message. Please try again.")
      return
    }

    const parts = result.data?.parts
    if (!parts || parts.length === 0) {
      console.warn("[BotCore] prompt returned no parts, data:", JSON.stringify(result.data).slice(0, 500))
      await adapter.sendMessage(msg.channel, msg.thread, "I processed your message but didn't produce a response.")
      return
    }

    const response = formatResponse(parts)
    await adapter.sendMessage(msg.channel, msg.thread, response.text)
    for (const image of response.images) {
      await adapter.uploadImage(msg.channel, msg.thread, image.buffer, image.filename, image.title)
    }
  }

  private subscribeEvents(): void {
    ;(async () => {
      const events = await this.client.event.subscribe()
      for await (const event of events.stream) {
        if (event.type === "message.part.updated") {
          const part = event.properties.part
          if (part.type === "tool") {
            const update = formatToolUpdate(part)
            if (!update.text && update.images.length === 0) continue

            for (const session of this.sessions.values()) {
              if (session.sessionId === part.sessionID) {
                if (update.text) {
                  await session.adapter.sendMessage(session.channel, session.thread, update.text).catch(() => {})
                }
                for (const image of update.images) {
                  await session.adapter.uploadImage(session.channel, session.thread, image.buffer, image.filename, image.title).catch(() => {})
                }
                break
              }
            }
          }
        }
      }
    })()
  }
}
