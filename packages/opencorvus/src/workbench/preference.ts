import { Identifier } from "@/id/id"
import { Preference } from "@/preference"
import { Database, desc, eq } from "@/storage/db"
import { OrchestratorTaskTable } from "@/orchestrator/orchestrator.sql"
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

export function preferences(input: { projectID: string; sessionID?: string }) {
  return Preference.list({
    projectID: input.projectID,
    sessionID: input.sessionID,
    scope: "all",
  })
}

export function updatePreference(input: {
  preferenceID: string
  key: string
  value: string
}) {
  return Preference.update(input)
}

export function deletePreference(preferenceID: string) {
  return Preference.remove(preferenceID)
}

export function recordTaskRequest(input: {
  taskID: string
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
        kind: "user_request",
        source: input.source,
        user_id: input.userID,
        content: input.content,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

export function setPreference(input: {
  taskID: string
  userID?: string
  key: string
  value: string
  scope?: Exclude<Preference.Scope, "cwd">
}) {
  const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, input.taskID)).get())
  if (!task) throw new Error(`Task not found: ${input.taskID}`)
  Preference.set({
    projectID: task.project_id,
    taskID: task.id,
    sessionID: task.session_id ?? undefined,
    userID: input.userID,
    key: input.key,
    value: input.value,
    scope: input.scope ?? "global",
    source: "user_message",
    confidence: 100,
  })
}

export function recordNote(input: {
  taskID: string
  kind: "user_request" | "operator_note" | "plan_hint" | "goal_update" | "constraint" | "decision" | "summary"
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
