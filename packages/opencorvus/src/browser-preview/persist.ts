import { and, desc, eq } from "drizzle-orm"
import z from "zod"
import { EngineArtifactTable } from "@/engine/engine.sql"
import { Identifier } from "@/id/id"
import { Database } from "@/storage/db"

export const BROWSER_PREVIEW_TARGET_KIND = "browser_preview_target" as const
export const BROWSER_PREVIEW_EVIDENCE_KIND = "browser_preview_evidence" as const

export const PersistedBrowserPreviewTarget = z.object({
  id: z.string(),
  taskID: z.string(),
  url: z.string(),
  source: z.literal("task-artifact"),
  timeCreated: z.number(),
  timeUpdated: z.number(),
})
export type PersistedBrowserPreviewTarget = z.infer<typeof PersistedBrowserPreviewTarget>

const PersistedBrowserPreviewTargetPayload = z.object({
  url: z.string(),
  source: z.literal("task-artifact"),
})

export function persistBrowserPreviewTarget(input: {
  taskID: string
  url: string
  now?: number
}): PersistedBrowserPreviewTarget {
  const now = input.now ?? Date.now()
  const id = Identifier.ascending("artifact")
  const payload = {
    url: input.url,
    source: "task-artifact" as const,
  }
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id,
        task_id: input.taskID,
        run_id: null,
        goal_run_id: null,
        acceptance_id: null,
        kind: BROWSER_PREVIEW_TARGET_KIND,
        label: "active",
        payload,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  return {
    id,
    taskID: input.taskID,
    url: input.url,
    source: "task-artifact",
    timeCreated: now,
    timeUpdated: now,
  }
}

export function findLatestBrowserPreviewTarget(taskID: string): PersistedBrowserPreviewTarget | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, BROWSER_PREVIEW_TARGET_KIND)))
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .limit(1)
      .get(),
  )
  if (!row) return undefined
  const payload = PersistedBrowserPreviewTargetPayload.safeParse(row.payload)
  if (!payload.success) return undefined
  return {
    id: row.id,
    taskID: row.task_id,
    url: payload.data.url,
    source: payload.data.source,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

export function findBrowserPreviewTargetByID(input: {
  taskID: string
  targetID: string
}): PersistedBrowserPreviewTarget | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.id, input.targetID),
          eq(EngineArtifactTable.kind, BROWSER_PREVIEW_TARGET_KIND),
        ),
      )
      .limit(1)
      .get(),
  )
  if (!row) return undefined
  const payload = PersistedBrowserPreviewTargetPayload.safeParse(row.payload)
  if (!payload.success) return undefined
  return {
    id: row.id,
    taskID: row.task_id,
    url: payload.data.url,
    source: payload.data.source,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

export function persistBrowserPreviewEvidence(input: {
  taskID: string
  targetID?: string
  viewportID: string
  status: "passed" | "failed"
  summary: string
  capture?: unknown
  diagnostics: string[]
  now?: number
}): string {
  const now = input.now ?? Date.now()
  const id = Identifier.ascending("artifact")
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id,
        task_id: input.taskID,
        run_id: null,
        goal_run_id: null,
        acceptance_id: null,
        kind: BROWSER_PREVIEW_EVIDENCE_KIND,
        label: "capture",
        payload: {
          target_id: input.targetID ?? null,
          viewport_id: input.viewportID,
          status: input.status,
          summary: input.summary,
          capture: input.capture ?? null,
          diagnostics: input.diagnostics,
          time_completed: now,
        },
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  return id
}

export function latestBrowserPreviewEvidenceID(input: {
  taskID: string
  targetID?: string
}): string | undefined {
  const rows = Database.use((db) =>
    db
      .select({ id: EngineArtifactTable.id, payload: EngineArtifactTable.payload })
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, input.taskID), eq(EngineArtifactTable.kind, BROWSER_PREVIEW_EVIDENCE_KIND)))
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .limit(20)
      .all(),
  )
  if (!input.targetID) return rows[0]?.id
  return rows.find((row) => sqlTargetID(row.payload) === input.targetID)?.id
}

function sqlTargetID(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined
  const value = (payload as Record<string, unknown>).target_id
  return typeof value === "string" ? value : undefined
}
