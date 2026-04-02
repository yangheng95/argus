import { Identifier } from "@/id/id"
import { Memory } from "@/memory"
import { Database, desc, eq } from "@/storage/db"
import {
  OrchestratorGoalTable,
  OrchestratorPlanVersionTable,
  OrchestratorTaskTable,
} from "@/orchestrator/orchestrator.sql"
import { WorkbenchBriefSnapshotTable, WorkbenchTaskNoteTable } from "./workbench.sql"
import { planHints } from "./note-store"

const BRIEF_VERSION = "brief-v2"

/** Simple cache key for brief snapshots — avoids regenerating when inputs haven't changed. */
function briefSignature(input: {
  task: { id: string; request: string }
  plan: { id: string; summary?: string | null } | undefined
  runID?: string
  goals: Array<{ id: string; status: string }>
  notes: Array<{ id: string }>
}): string {
  const parts = [
    BRIEF_VERSION,
    input.task.id,
    input.task.request.slice(0, 64),
    input.plan?.id ?? "no-plan",
    input.runID ?? "no-run",
    input.goals.map((g) => `${g.id}:${g.status}`).join(","),
    input.notes.length.toString(),
  ]
  return parts.join("|")
}

export function compileBrief(input: {
  taskID: string
  runID?: string
  planVersionID?: string
  sessionID?: string
}) {
  const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, input.taskID)).get())
  if (!task) throw new Error(`Task not found: ${input.taskID}`)
  const planID = input.planVersionID ?? task.active_plan_version_id ?? undefined
  const plan = planID
    ? Database.use((db) => db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.id, planID)).get())
    : undefined
  const goals = planID
    ? Database.use((db) =>
        db
          .select()
          .from(OrchestratorGoalTable)
          .where(eq(OrchestratorGoalTable.plan_version_id, planID))
          .orderBy(OrchestratorGoalTable.order_index)
          .all(),
      )
    : []
  const notes = Database.use((db) =>
    db
      .select()
      .from(WorkbenchTaskNoteTable)
      .where(eq(WorkbenchTaskNoteTable.task_id, task.id))
      .orderBy(desc(WorkbenchTaskNoteTable.time_created))
      .limit(8)
      .all()
      .reverse(),
  )
  const signature = briefSignature({
    task,
    plan,
    runID: input.runID,
    goals,
    notes,
  })
  const snapshot = Database.use((db) =>
    db
      .select()
      .from(WorkbenchBriefSnapshotTable)
      .where(eq(WorkbenchBriefSnapshotTable.task_id, task.id))
      .orderBy(WorkbenchBriefSnapshotTable.time_created)
      .all()
      .at(-1),
  )
  if (snapshot?.inputs?.signature === signature) {
    return {
      content: snapshot.content,
      updatedAt: snapshot.time_created,
      notes,
      goals,
    }
  }

  const memory = recallMemory(task)
  const content = [
    "<assistant-brief>",
    `Task: ${task.title}`,
    `Request: ${task.request}`,
    plan ? `Plan summary: ${plan.summary}` : "",
    [
      "Git workflow:",
      "- The workspace is auto-managed with git when needed.",
      "- A startup checkpoint is captured before the first execution run.",
      "- The orchestrator may record internal checkpoint commits automatically.",
      "- Do not create extra user-facing commits unless explicitly requested.",
      "- If you do create a commit, use a concise, meaningful message grounded in the task request and plan.",
    ].join("\n"),
    planHints(plan?.metadata).length > 0
      ? "Plan hints:\n" + planHints(plan?.metadata).map((item) => `- ${item}`).join("\n")
      : "",
    goals.length > 0
      ? "Goals:\n" +
        goals
          .map((goal) =>
            `- ${goal.title} (criteria: ${goal.done_definition}${
              Array.isArray((goal.metadata as Record<string, unknown> | null | undefined)?.check_selector)
                ? `; checks: ${(((goal.metadata as Record<string, unknown>).check_selector as unknown[]) ?? [])
                    .filter((item): item is string => typeof item === "string")
                    .join(", ")}`
                : ""
            })`,
          )
          .join("\n")
      : "",
    notes.length > 0
      ? "Recent task notes:\n" + notes.slice(-6).map((note) => `- [${note.kind}] ${note.content}`).join("\n")
      : "",
    memory.length > 0
      ? "Relevant memory:\n" +
        memory
          .map((item) => `- [${item.scope}] ${item.fileTitle}: ${item.content.slice(0, 200)}`)
          .join("\n")
      : "",
    "</assistant-brief>",
    "Use the brief above to align your work before executing the task.",
  ]
    .filter(Boolean)
    .join("\n\n")

  const now = Date.now()
  Database.use((db) =>
    db
      .insert(WorkbenchBriefSnapshotTable)
      .values({
        id: Identifier.ascending("brief"),
        task_id: task.id,
        plan_version_id: planID ?? null,
        run_id: input.runID ?? null,
        content,
        inputs: {
          signature,
          template: BRIEF_VERSION,
          notes: notes.length,
          memory: memory.length,
        },
        time_created: now,
        time_updated: now,
      })
      .run(),
  )

  return {
    content,
    updatedAt: now,
    notes,
    goals,
  }
}

function recallMemory(task: typeof OrchestratorTaskTable.$inferSelect) {
  const query = [task.title, task.request]
    .join(" ")
    .replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
    .split(/\s+/)
    .filter((item) => item.length > 2)
    .slice(0, 6)
    .join(" ")
  if (!query) return []
  try {
    const primary = Memory.recall({
      query,
      projectId: task.project_id,
      sessionID: task.session_id ?? undefined,
      scope: "all",
      limit: 5,
    })
    // Secondary search using first line of request for broader recall
    const requestLine = task.request.split("\n").find(Boolean)?.trim()
    if (!requestLine || requestLine === query) return primary
    const secondary = Memory.recall({
      query: requestLine.slice(0, 120),
      projectId: task.project_id,
      sessionID: task.session_id ?? undefined,
      scope: "all",
      limit: 3,
    })
    // Merge and deduplicate by chunkId
    const seen = new Set(primary.map((item) => item.chunkId))
    for (const item of secondary) {
      if (!seen.has(item.chunkId)) {
        primary.push(item)
        seen.add(item.chunkId)
      }
    }
    return primary.slice(0, 8)
  } catch {
    return []
  }
}
