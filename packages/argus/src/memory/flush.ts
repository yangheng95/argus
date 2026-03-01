import { Memory } from "./index"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message"
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
      let summaryMsg: MessageV2.WithParts | null = null
      for await (const msg of MessageV2.stream(sessionID)) {
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
        .filter((p): p is MessageV2.TextPart => p.type === "text")
        .map((p) => p.text)
        .filter(Boolean)

      const summaryText = textParts.join("\n\n")
      if (!summaryText || summaryText.length < 50) {
        log.info("compaction summary too short to flush", { sessionID, length: summaryText.length })
        return
      }

      // Create a memory file for this compaction
      const projectId = Instance.project.id
      const session = await Session.get(sessionID)
      const title = `Compaction: ${session.title} (${new Date().toISOString().slice(0, 10)})`

      const file = Memory.createFile({
        title,
        source: "compaction",
        projectId,
      })

      Memory.writeChunks(file.id, projectId, summaryText)
      log.info("flushed compaction to memory", { sessionID, fileId: file.id, title })
    } catch (err) {
      log.warn("memory flush failed", { sessionID, err })
    }
  }
}
