import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk"
import type { BotAdapter, IncomingMessage } from "./adapter"
import type { SlackAdapter } from "./adapters/slack"
import { formatToolUpdate } from "./format"

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
  /** Set to false by stop() to terminate the reconnect loop */
  private running = false

  constructor(private options?: BotCoreOptions) {}

  register(adapter: BotAdapter): this {
    this.adapters.push(adapter)
    return this
  }

  async start(): Promise<void> {
    this.running = true
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
    this.running = false
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

  /**
   * Inject a prompt directly into a Slack channel, bypassing the Slack message listener.
   * This creates a session bound to the channel so SSE events flow back to Slack.
   * Useful for automated testing with bot tokens.
   */
  async injectPrompt(platform: string, channel: string, text: string): Promise<void> {
    const adapter = this.adapters.find((a) => a.platform === platform) as SlackAdapter | undefined
    if (!adapter) throw new Error(`No adapter for platform: ${platform}`)

    // Post the prompt as a visible message and get its ts for threading
    const ts = await adapter.postAndGetTs(channel, `[Argus Task] ${text}`)

    // Treat it as an incoming message — this creates session + sends prompt
    await this.handleMessage({
      platform,
      channel,
      thread: ts,
      user: "system",
      text,
    })
  }

  private findSession(sessionId: string): SessionEntry | undefined {
    const threadKey = this.sessionIndex.get(sessionId)
    if (!threadKey) return undefined
    return this.sessions.get(threadKey)
  }

  /**
   * Fetch screenshot attachment from API and upload to Slack.
   * SSE events may not reliably carry large base64 payloads (4MB+ screenshots),
   * so we fetch the full message via REST API instead.
   */
  private async fetchAndUploadScreenshot(
    session: SessionEntry,
    sessionId: string,
    messageId: string,
    partId: string,
    title: string,
  ): Promise<void> {
    try {
      const msgResult = await this.client.session.message({
        path: { id: sessionId, messageID: messageId },
      })
      if (msgResult.error) return

      const parts = (msgResult.data as any).parts ?? []
      for (const p of parts) {
        if (p.id !== partId) continue
        for (const att of p.state?.attachments ?? []) {
          if (att.type === "file" && att.mime?.startsWith("image/")) {
            const match = att.url?.match(/^data:[^;]+;base64,(.+)$/)
            if (!match) continue
            const buffer = Buffer.from(match[1], "base64")
            const ext = att.mime === "image/png" ? "png" : "jpg"
            await session.adapter.uploadImage(
              session.channel,
              session.thread,
              buffer,
              att.filename ?? `screenshot.${ext}`,
              title,
            )
            console.log(`[BotCore] Uploaded screenshot (${(buffer.length / 1024).toFixed(0)}KB)`)
          }
        }
      }
    } catch (err) {
      console.error("[BotCore] fetchAndUploadScreenshot error:", err)
    }
  }

  private async handleEvent(event: any): Promise<void> {
    // Track user message IDs so we can skip their parts
    if (event.type === "message.updated") {
      const info = event.properties.info

      if (info.role === "user") {
        this.userMessageIds.add(info.id)
        return
      }

      // Flush buffered text when assistant message is complete
      if (info.role === "assistant" && info.time.completed) {
        const session = this.findSession(info.sessionID)
        if (!session) return

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
      if (this.userMessageIds.has(part.messageID)) return

      const session = this.findSession(part.sessionID)
      if (!session) return

      // Buffer text parts keyed by messageID (flushed on message.updated)
      if (part.type === "text") {
        this.textBuffers.set(part.messageID, part.text)
      }

      // Handle tool updates
      if (part.type === "tool") {
        const update = formatToolUpdate(part)
        if (update.text) {
          await session.adapter.sendMessage(session.channel, session.thread, update.text).catch(() => {})
        }

        // For completed screen tool: fetch screenshot via API and upload
        if (part.tool === "screen" && part.state.status === "completed") {
          await this.fetchAndUploadScreenshot(
            session,
            part.sessionID,
            part.messageID,
            part.id,
            part.state.title,
          )
        }
      }
    }
  }

  private subscribeEvents(): void {
    const reconnect = async () => {
      let delay = 1000
      while (this.running) {
        try {
          const events = await this.client.event.subscribe()
          delay = 1000 // reset backoff on successful connection
          for await (const event of events.stream) {
            try {
              await this.handleEvent(event)
            } catch (err) {
              console.error("[BotCore] event handler error:", err)
            }
          }
          console.warn("[BotCore] event stream ended, reconnecting...")
        } catch (err) {
          console.error(`[BotCore] event stream error, retrying in ${delay}ms:`, err)
        }
        if (this.running) {
          await new Promise(resolve => setTimeout(resolve, delay))
          delay = Math.min(delay * 2, 60_000) // exponential backoff, cap 60s
        }
      }
    }
    reconnect().catch(err => console.error("[BotCore] fatal reconnect error:", err))
  }
}
