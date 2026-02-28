import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk"
import type { BotAdapter, IncomingMessage } from "./adapter"
import { formatToolUpdate, type ImageAttachment } from "./format"

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
  /** Reverse lookup: sessionId → threadKey */
  private sessionIndex = new Map<string, string>()
  private adapters: BotAdapter[] = []
  private client!: OpencodeClient
  private server!: { url: string; close(): void }
  /** Buffer assistant text per messageID until message.updated signals completion */
  private textBuffers = new Map<string, string>()
  /** Track user message IDs to skip their parts */
  private userMessageIds = new Set<string>()

  constructor(private options?: BotCoreOptions) {}

  register(adapter: BotAdapter): this {
    this.adapters.push(adapter)
    return this
  }

  async start(): Promise<void> {
    const argus = await createOpencode({ port: this.options?.port ?? 0 })
    this.client = argus.client
    this.server = argus.server
    console.log(`[BotCore] Argus server running at ${argus.server.url}`)

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
        console.error("[BotCore] session.create error:", JSON.stringify(createResult.error).slice(0, 500))
        await adapter.sendMessage(msg.channel, msg.thread, "Failed to create session.")
        return
      }

      session = {
        sessionId: createResult.data.id,
        adapter,
        channel: msg.channel,
        thread: msg.thread,
      }
      this.sessions.set(threadKey, session)
      this.sessionIndex.set(createResult.data.id, threadKey)
      console.log(`[BotCore] Created session ${createResult.data.id} for ${threadKey}`)
    }

    // Use promptAsync to bypass monitor command queue and execute directly.
    // The regular prompt() endpoint stages messages into CommandQueue when
    // monitor+brain is enabled, which requires screen changes to trigger processing.
    const result = await this.client.session.promptAsync({
      path: { id: session.sessionId },
      body: { parts: [{ type: "text", text: msg.text }] },
    })

    if (result.error) {
      console.error("[BotCore] session.promptAsync error:", JSON.stringify(result.error).slice(0, 500))
      await adapter.sendMessage(msg.channel, msg.thread, "Failed to send prompt.")
      return
    }

    console.log(`[BotCore] Prompt sent for session ${session.sessionId}`)
  }

  private findSession(sessionId: string): SessionEntry | undefined {
    const threadKey = this.sessionIndex.get(sessionId)
    if (!threadKey) return undefined
    return this.sessions.get(threadKey)
  }

  private subscribeEvents(): void {
    ;(async () => {
      const events = await this.client.event.subscribe()
      for await (const event of events.stream) {
        try {
          // Track user message IDs so we can skip their parts
          if (event.type === "message.updated") {
            const info = event.properties.info

            if (info.role === "user") {
              this.userMessageIds.add(info.id)
              continue
            }

            // Flush buffered text when assistant message is complete
            if (info.role === "assistant" && info.time.completed) {
              const session = this.findSession(info.sessionID)
              if (!session) continue

              const text = this.textBuffers.get(info.id)
              this.textBuffers.delete(info.id)

              if (text) {
                const truncated = text.length > 3900 ? text.slice(0, 3900) + "\n...(truncated)" : text
                await session.adapter.sendMessage(session.channel, session.thread, truncated).catch(() => {})
                console.log(`[BotCore] Sent response for session ${info.sessionID} (${text.length} chars)`)
              }

              if (info.error) {
                const errMsg = "error" in info.error ? (info.error as any).error : JSON.stringify(info.error)
                await session.adapter.sendMessage(session.channel, session.thread, `Error: ${errMsg}`).catch(() => {})
              }
            }
          }

          if (event.type === "message.part.updated") {
            const part = event.properties.part

            // Skip parts belonging to user messages
            if (this.userMessageIds.has(part.messageID)) continue

            const session = this.findSession(part.sessionID)
            if (!session) continue

            // Buffer text parts keyed by messageID (flushed on message.updated)
            if (part.type === "text") {
              this.textBuffers.set(part.messageID, part.text)
            }

            // Send tool updates + images in real-time
            if (part.type === "tool") {
              const update = formatToolUpdate(part)
              if (update.text) {
                await session.adapter.sendMessage(session.channel, session.thread, update.text).catch(() => {})
              }
              for (const image of update.images) {
                await session.adapter.uploadImage(session.channel, session.thread, image.buffer, image.filename, image.title).catch(() => {})
              }
            }
          }
        } catch (err) {
          console.error("[BotCore] event handler error:", err)
        }
      }
    })()
  }
}
