import path from "node:path"
import { mkdir } from "node:fs/promises"
import type { OpencodeClient } from "@opencorvus-ai/sdk/v2"
import type { BotAdapter, IncomingMessage } from "./adapter"
import type { SessionEntry } from "./types"
import type { SessionCoordinator } from "./session-coordinator"

export interface SharedSessionOptions {
  sharedMode?: boolean
  sharedFile?: string
}

export class SharedSessionManager {
  private sharedSessionId?: string
  /** Prevent creating duplicate overlay mirror threads */
  private overlayMirrorBound = false

  constructor(private options?: SharedSessionOptions) {}

  getSharedSessionId() {
    return this.sharedSessionId
  }

  setSharedSessionId(id: string) {
    this.sharedSessionId = id
  }

  sharedMode() {
    if (this.options?.sharedMode !== undefined) return this.options.sharedMode
    return process.env.OPENCORVUS_SHARED_SESSION_MODE === "1"
  }

  private sharedFile() {
    const fromOption = this.options?.sharedFile?.trim()
    if (fromOption) return fromOption
    const fromEnv = process.env.OPENCORVUS_SHARED_SESSION_FILE?.trim()
    if (fromEnv) return fromEnv
    return path.resolve(process.cwd(), ".opencorvus/shared-session.json")
  }

  async readSharedSessionFile() {
    const file = this.sharedFile()
    const raw = (await Bun.file(file)
      .json()
      .catch(() => undefined)) as { session_id?: unknown } | undefined
    if (!raw) return undefined
    if (typeof raw.session_id !== "string") return undefined
    const id = raw.session_id.trim()
    if (!id) return undefined
    return id
  }

  private async writeSharedSessionFile(sessionId: string) {
    const file = this.sharedFile()
    const dir = path.dirname(file)
    await mkdir(dir, { recursive: true })
    const payload = {
      session_id: sessionId,
      updated_at: Date.now(),
    }
    await Bun.write(file, JSON.stringify(payload, null, 2) + "\n")
  }

  async ensureSharedSession(msg: IncomingMessage, client: OpencodeClient) {
    if (!this.sharedMode()) return undefined
    if (this.sharedSessionId) return this.sharedSessionId

    const fromFile = await this.readSharedSessionFile()
    if (fromFile) {
      this.sharedSessionId = fromFile
      return fromFile
    }

    const createResult = await client.session.create({
      title: `${msg.platform} shared session`,
    })
    if (createResult.error) {
      console.error("[BotCore] shared session.create error:", JSON.stringify(createResult.error).slice(0, 500))
      return undefined
    }

    this.sharedSessionId = createResult.data.id
    await this.writeSharedSessionFile(createResult.data.id).catch((err) => {
      console.warn("[BotCore] shared session file write failed:", err)
    })
    console.log(`[BotCore] Created shared session ${createResult.data.id}`)
    return createResult.data.id
  }

  /**
   * In shared mode, when no Slack thread is bound to the shared session yet
   * (e.g. overlay sends a prompt before any Slack message arrives), create a
   * dedicated mirror thread in SLACK_CHANNEL_ID and bind it.  Called lazily on
   * the first event that needs a Slack target.
   */
  async bindOverlayMirrorIfNeeded(
    sessionId: string,
    adapters: BotAdapter[],
    session: SessionCoordinator<SessionEntry, IncomingMessage>,
    findSessions: (sessionId: string) => SessionEntry[],
  ): Promise<SessionEntry[]> {
    // Already bound — just look up what SessionCoordinator has
    if (this.overlayMirrorBound) return findSessions(sessionId)

    const channel = process.env.SLACK_CHANNEL_ID
    if (!channel) return []

    const adapter = adapters.find((a) => typeof a.startThread === "function")
    if (!adapter?.startThread) return []

    // Set flag before await to prevent concurrent calls from creating multiple threads
    this.overlayMirrorBound = true
    try {
      const ts = await adapter.startThread(channel, "[Overlay Console] Session started")
      const entry: SessionEntry = { sessionId, adapter, channel, thread: ts }
      session.bind(`overlay-mirror:${sessionId}`, entry)
      console.log(`[BotCore] Overlay mirror thread created: ${channel}:${ts} for session ${sessionId}`)
      return [entry]
    } catch (err) {
      this.overlayMirrorBound = false
      console.warn("[BotCore] Failed to create overlay mirror thread:", err)
      return []
    }
  }

  /** Pre-load shared session ID from file (called during start) */
  async preload() {
    if (this.sharedMode() && !this.sharedSessionId) {
      const fromFile = await this.readSharedSessionFile()
      if (fromFile) {
        this.sharedSessionId = fromFile
        console.log(`[BotCore] Pre-loaded shared session: ${fromFile}`)
      }
    }
  }

  reset() {
    this.overlayMirrorBound = false
  }
}
