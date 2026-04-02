import { Identifier } from "@/id/id"
import { Database, desc, eq } from "@/storage/db"
import { OrchestratorPlanVersionTable, OrchestratorTaskTable } from "@/orchestrator/orchestrator.sql"
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

export function appendPlanHint(input: { taskID: string; hint: string }) {
  const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, input.taskID)).get())
  if (!task?.active_plan_version_id) return
  const plan = Database.use((db) =>
    db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.id, task.active_plan_version_id!)).get(),
  )
  if (!plan) return
  const hints = planHints(plan.metadata)
  const next = [...hints, input.hint]
  Database.use((db) =>
    db
      .update(OrchestratorPlanVersionTable)
      .set({
        metadata: {
          ...(plan.metadata ?? {}),
          operator_hints: next,
        },
        time_updated: Date.now(),
      })
      .where(eq(OrchestratorPlanVersionTable.id, plan.id))
      .run(),
  )
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

export function rememberUser(input: { taskID: string; userID?: string }) {
  if (!input.userID) return
  const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, input.taskID)).get())
  if (!task) return
  const next = {
    ...(task.metadata ?? {}),
    workbench: {
      ...(((task.metadata as Record<string, unknown> | null | undefined)?.workbench as Record<string, unknown> | undefined) ?? {}),
      user: input.userID,
    },
  }
  Database.use((db) =>
    db
      .update(OrchestratorTaskTable)
      .set({
        metadata: next,
        time_updated: Date.now(),
      })
      .where(eq(OrchestratorTaskTable.id, task.id))
      .run(),
  )
}

export function planHints(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return []
  const hints = (metadata as Record<string, unknown>).operator_hints
  if (!Array.isArray(hints)) return []
  return hints.filter((item): item is string => typeof item === "string" && item.length > 0)
}
