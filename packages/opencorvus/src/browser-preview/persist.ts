import { and, desc, eq } from "drizzle-orm"
import z from "zod"
import { EngineArtifactTable } from "@/engine/engine.sql"
import { Event } from "@/engine/model"
import { EngineProtocol } from "@/engine/protocol"
import { requireTask } from "@/engine/store"
import { deriveTaskStatus } from "@/engine/task-status"
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
}): Promise<PersistedBrowserPreviewTarget> {
  const existing = findBrowserPreviewTargetByUrl(input)
  const now = Math.max(input.now ?? Date.now(), existing ? existing.timeUpdated + 1 : 0)
  if (existing) {
    Database.use((db) =>
      db
        .update(EngineArtifactTable)
        .set({
          time_updated: now,
          label: "active",
        })
        .where(eq(EngineArtifactTable.id, existing.id))
        .run(),
    )
    const persisted: PersistedBrowserPreviewTarget = {
      ...existing,
      timeUpdated: now,
    }
    return EngineProtocol.emit(
      Event.TaskUpdated,
      {
        taskID: input.taskID,
        status: deriveTaskStatus(requireTask(input.taskID)),
        summary: "Browser preview target updated",
      },
      { source: "browser-preview.target" },
    ).then(() => persisted)
  }
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
  const persisted: PersistedBrowserPreviewTarget = {
    id,
    taskID: input.taskID,
    url: input.url,
    source: "task-artifact",
    timeCreated: now,
    timeUpdated: now,
  }
  return EngineProtocol.emit(
    Event.TaskUpdated,
    {
      taskID: input.taskID,
      status: deriveTaskStatus(requireTask(input.taskID)),
      summary: "Browser preview target updated",
    },
    { source: "browser-preview.target" },
  ).then(() => persisted)
}

export function findLatestBrowserPreviewTarget(taskID: string): PersistedBrowserPreviewTarget | undefined {
  return findRecentBrowserPreviewTargets(taskID, 1)[0]
}

export function findRecentBrowserPreviewTargets(taskID: string, limit = 12): PersistedBrowserPreviewTarget[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, BROWSER_PREVIEW_TARGET_KIND)))
      .orderBy(
        desc(EngineArtifactTable.time_updated),
        desc(EngineArtifactTable.time_created),
        desc(EngineArtifactTable.id),
      )
      .limit(Math.max(limit * 3, limit))
      .all(),
  )
  const seen = new Set<string>()
  const targets: PersistedBrowserPreviewTarget[] = []
  for (const row of rows) {
    const payload = PersistedBrowserPreviewTargetPayload.safeParse(row.payload)
    if (!payload.success) continue
    const key = payload.data.url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({
      id: row.id,
      taskID: row.task_id,
      url: payload.data.url,
      source: payload.data.source,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    })
    if (targets.length >= limit) break
  }
  return targets
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

function findBrowserPreviewTargetByUrl(input: {
  taskID: string
  url: string
}): PersistedBrowserPreviewTarget | undefined {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(eq(EngineArtifactTable.task_id, input.taskID), eq(EngineArtifactTable.kind, BROWSER_PREVIEW_TARGET_KIND)),
      )
      .orderBy(
        desc(EngineArtifactTable.time_updated),
        desc(EngineArtifactTable.time_created),
        desc(EngineArtifactTable.id),
      )
      .limit(30)
      .all(),
  )
  for (const row of rows) {
    const payload = PersistedBrowserPreviewTargetPayload.safeParse(row.payload)
    if (!payload.success) continue
    if (payload.data.url !== input.url) continue
    return {
      id: row.id,
      taskID: row.task_id,
      url: payload.data.url,
      source: payload.data.source,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    }
  }
  return undefined
}

export function persistBrowserPreviewEvidence(input: {
  taskID: string
  targetID: string
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
          target_id: input.targetID,
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

export function latestBrowserPreviewEvidenceID(input: { taskID: string; targetID?: string }): string | undefined {
  const rows = Database.use((db) =>
    db
      .select({ id: EngineArtifactTable.id, payload: EngineArtifactTable.payload })
      .from(EngineArtifactTable)
      .where(
        and(eq(EngineArtifactTable.task_id, input.taskID), eq(EngineArtifactTable.kind, BROWSER_PREVIEW_EVIDENCE_KIND)),
      )
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
