import { Identifier } from "@/id/id"
import { Database, desc, eq } from "@/storage/db"
import { WorkbenchTaskNoteTable } from "./workbench.sql"

export function taskNotes(taskID: string, limit = 8) {
  return Database.use((db) =>
    db
      .select()
      .from(WorkbenchTaskNoteTable)
      .where(eq(WorkbenchTaskNoteTable.task_id, taskID))
      .orderBy(desc(WorkbenchTaskNoteTable.time_created))
      .limit(limit)
      .all()
      .reverse(),
  )
}

export function recordNote(input: {
  taskID: string
  kind: "user_request" | "operator_note" | "goal_update" | "constraint" | "decision" | "summary"
  content: string
  source: string
  userID?: string
}) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(WorkbenchTaskNoteTable)
      .values({
        id: Identifier.ascending("note"),
        task_id: input.taskID,
        kind: input.kind,
        source: input.source,
        user_id: input.userID,
        content: input.content,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}
