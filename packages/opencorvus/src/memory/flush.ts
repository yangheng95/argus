import { Memory } from "./index"
import { Session } from "@/session"
import { Message } from "@/session"
import { Instance } from "@/project/instance"
import { EffectiveConfig } from "@/config/effective"
import { Log } from "@/util/log"
import { CompactionHandoff } from "@/session/compaction-handoff"

export namespace MemoryFlush {
  const log = Log.create({ service: "memory.flush" })

  /**
   * Extract key knowledge from a compacted session and persist to memory store.
   * Called after compaction completes successfully.
   */
  export async function flush(input: { sessionID: string; messageID: string }): Promise<void> {
    const config = await EffectiveConfig.effective({ sessionID: input.sessionID })
    if (config.experimental?.memory?.enabled === false) return

    const summaryMsg = await Message.get({
      sessionID: input.sessionID,
      messageID: input.messageID,
    })

    if (summaryMsg.info.role !== "assistant" || !CompactionHandoff.isValidSummaryMessage(summaryMsg.info)) {
      throw new Error(`Invalid compaction handoff summary cannot be flushed: ${input.messageID}`)
    }

    const summaryText = CompactionHandoff.renderMemoryEpisode(summaryMsg.info.structured)
    if (!summaryText || summaryText.length < 50) {
      throw new Error(`Compaction handoff summary is too short to flush: ${input.messageID}`)
    }

    const projectId = Instance.project.id
    const session = await Session.get(input.sessionID)
    const title = `Compaction: ${session.title} (${new Date().toISOString().slice(0, 10)})`
    const result = Memory.captureEpisode({
      title,
      content: summaryText,
      source: "compaction",
      projectId,
      scope: "session",
      sessionID: input.sessionID,
      promoteScope: "global",
    })
    log.info("flushed compaction to memory", {
      sessionID: input.sessionID,
      fileId: result.episode.id,
      derived: result.derived.length,
      title,
    })
  }
}
