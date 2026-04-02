import { Database, eq } from "@/storage/db"
import { ScratchpadTable } from "./scratchpad.sql"
import { Log } from "@/util/log"

/**
 * Session-scoped working memory (scratchpad).
 *
 * Each session has a single scratchpad for the agent to store
 * intermediate thoughts, reasoning steps, and temporary notes.
 * Content is persisted across turns within a session.
 */
export namespace Scratchpad {
  const log = Log.create({ service: "scratchpad" })

  export function get(sessionID: string): string {
    const row = Database.use((db) =>
      db.select().from(ScratchpadTable).where(eq(ScratchpadTable.session_id, sessionID)).get(),
    )
    return row?.content ?? ""
  }

  export function set(sessionID: string, content: string): void {
    Database.use((db) =>
      db
        .insert(ScratchpadTable)
        .values({ session_id: sessionID, content })
        .onConflictDoUpdate({ target: ScratchpadTable.session_id, set: { content } })
        .run(),
    )
    log.info("scratchpad set", { sessionID, length: content.length })
  }

  export function append(sessionID: string, text: string): void {
    const current = get(sessionID)
    const newContent = current ? current + "\n" + text : text
    set(sessionID, newContent)
  }

  /**
   * Generate a system prompt section for the scratchpad.
   * Returns null if the scratchpad is empty.
   */
  export function systemPromptSection(sessionID: string): string | null {
    const content = get(sessionID)
    if (!content.trim()) return null
    return `<scratchpad>
${content}
</scratchpad>

The scratchpad above contains your working notes from this session. You can update it using the planner tool's scratchpad_write or scratchpad_append actions.`
  }
}
