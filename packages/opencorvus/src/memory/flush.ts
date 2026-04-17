import { Memory } from "./index"
import { Session } from "@/session"
import { Message } from "@/session"
import { Instance } from "@/project/instance"
import { Config } from "@/config/config"
import { Log } from "@/util/log"

export namespace MemoryFlush {
  const log = Log.create({ service: "memory.flush" })

  /**
   * Extract key knowledge from a compacted session and persist to memory store.
   * Called after compaction completes successfully.
   */
  export async function flush(sessionID: string): Promise<void> {
    const config = await Config.get()
    if (config.experimental?.memory?.enabled === false) return

    try {
      // Find the compaction summary message (the most recent assistant message with summary=true)
      let summaryMsg: Message.WithParts | null = null
      for await (const msg of Message.stream(sessionID)) {
        if (msg.info.role === "assistant" && (msg.info as any).summary === true) {
          summaryMsg = msg
          break // stream returns newest first
        }
      }

      if (!summaryMsg) {
        log.info("no compaction summary found", { sessionID })
        return
      }

      // Extract text content from the summary
      const textParts = summaryMsg.parts
        .filter((p): p is Message.TextPart => p.type === "text")
        .map((p) => p.text)
        .filter(Boolean)

      const summaryText = textParts.join("\n\n")
      if (!summaryText || summaryText.length < 50) {
        log.info("compaction summary too short to flush", { sessionID, length: summaryText.length })
        return
      }

      const projectId = Instance.project.id
      const session = await Session.get(sessionID)
      const title = `Compaction: ${session.title} (${new Date().toISOString().slice(0, 10)})`
      const result = Memory.captureEpisode({
        title,
        content: summaryText,
        source: "compaction",
        projectId,
        scope: "session",
        sessionID,
        promoteScope: "global",
      })
      log.info("flushed compaction to memory", {
        sessionID,
        fileId: result.episode.id,
        derived: result.derived.length,
        title,
      })
    } catch (err) {
      log.warn("memory flush failed", { sessionID, err })
    }
  }
}
