import { and, desc, eq } from "drizzle-orm"
import crypto from "node:crypto"
import fs from "node:fs/promises"
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

export const PersistedBrowserPreviewEvidence = z.object({
  id: z.string(),
  taskID: z.string(),
  targetID: z.string(),
  viewportID: z.string(),
  status: z.enum(["passed", "failed"]),
  summary: z.string(),
  capture: z.unknown().optional(),
  diagnostics: z.string().array(),
  timeCompleted: z.number(),
  timeCreated: z.number(),
})
export type PersistedBrowserPreviewEvidence = z.infer<typeof PersistedBrowserPreviewEvidence>

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

export function promoteBrowserPreviewTarget(input: {
  taskID: string
  targetID: string
  now?: number
}): Promise<PersistedBrowserPreviewTarget | undefined> {
  const existing = findBrowserPreviewTargetByID(input)
  if (!existing) return Promise.resolve(undefined)
  const now = Math.max(input.now ?? Date.now(), existing.timeUpdated + 1)
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

function findBrowserPreviewEvidenceByID(input: {
  taskID: string
  evidenceID: string
}): PersistedBrowserPreviewEvidence | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.id, input.evidenceID),
          eq(EngineArtifactTable.kind, BROWSER_PREVIEW_EVIDENCE_KIND),
        ),
      )
      .limit(1)
      .get(),
  )
  if (!row || !row.payload || typeof row.payload !== "object") return undefined
  const payload = row.payload as Record<string, unknown>
  const targetID = typeof payload.target_id === "string" ? payload.target_id : undefined
  const viewportID = typeof payload.viewport_id === "string" ? payload.viewport_id : undefined
  const status = payload.status === "passed" || payload.status === "failed" ? payload.status : undefined
  const summary = typeof payload.summary === "string" ? payload.summary : undefined
  const diagnostics = Array.isArray(payload.diagnostics)
    ? payload.diagnostics.filter((item): item is string => typeof item === "string")
    : []
  const timeCompleted = typeof payload.time_completed === "number" ? payload.time_completed : row.time_updated
  if (!targetID || !viewportID || !status || !summary) return undefined
  return {
    id: row.id,
    taskID: row.task_id,
    targetID,
    viewportID,
    status,
    summary,
    capture: payload.capture === null ? undefined : payload.capture,
    diagnostics,
    timeCompleted,
    timeCreated: row.time_created,
  }
}

export async function findReadableBrowserPreviewEvidenceByID(input: {
  taskID: string
  evidenceID: string
}): Promise<PersistedBrowserPreviewEvidence | undefined> {
  const evidence = findBrowserPreviewEvidenceByID(input)
  if (!evidence) return undefined
  if (!(await browserPreviewEvidenceArtifactsReadable(evidence))) return undefined
  return evidence
}

export async function findReadableBrowserPreviewEvidenceCapturePath(input: {
  taskID: string
  evidenceID: string
}): Promise<string | undefined> {
  const evidence = await findReadableBrowserPreviewEvidenceByID(input)
  if (!evidence) return undefined
  return browserPreviewCaptureArtifacts(evidence.capture)[0]?.path
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

async function browserPreviewEvidenceArtifactsReadable(evidence: PersistedBrowserPreviewEvidence): Promise<boolean> {
  const artifacts = browserPreviewCaptureArtifacts(evidence.capture)
  if (evidence.status === "passed" && artifacts.length === 0) return false
  for (const artifact of artifacts) {
    let bytes: Buffer
    try {
      bytes = await fs.readFile(artifact.path)
    } catch {
      return false
    }
    if (artifact.sha) {
      const actual = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16)
      if (actual !== artifact.sha) return false
    }
  }
  return true
}

function browserPreviewCaptureArtifacts(capture: unknown): Array<{ path: string; sha?: string }> {
  const artifacts: Array<{ path: string; sha?: string }> = []
  const seen = new Set<unknown>()
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 6) return
    seen.add(value)
    const record = value as Record<string, unknown>
    if (typeof record.path === "string" && record.path.trim()) {
      artifacts.push({
        path: record.path,
        sha: typeof record.sha === "string" && record.sha.trim() ? record.sha : undefined,
      })
    }
    for (const child of Object.values(record)) visit(child, depth + 1)
  }
  visit(capture, 0)
  return artifacts
}

export function latestBrowserPreviewEvidenceID(input: { taskID: string; targetID: string }): string | undefined {
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
  return rows.find((row) => sqlTargetID(row.payload) === input.targetID)?.id
}

function sqlTargetID(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined
  const value = (payload as Record<string, unknown>).target_id
  return typeof value === "string" ? value : undefined
}
