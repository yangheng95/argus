import { and, desc, eq } from "drizzle-orm"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { EngineArtifactTable } from "@/engine/engine.sql"
import { Event } from "@/engine/model"
import { EngineProtocol } from "@/engine/protocol"
import { requireTask } from "@/engine/store"
import { deriveTaskStatus } from "@/engine/task-status"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
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
  operationKind: z.enum(["preview-capture", "reference-comparison"]).default("preview-capture"),
  regionID: z.string().optional(),
  manifestPath: z.string().optional(),
  artifactPaths: z.record(z.string(), z.string()).optional(),
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
  const operationKind =
    payload.operation_kind === "reference-comparison" || payload.operation_kind === "preview-capture"
      ? payload.operation_kind
      : "preview-capture"
  const regionID = typeof payload.region_id === "string" ? payload.region_id : undefined
  const manifestPath = typeof payload.manifest_path === "string" ? payload.manifest_path : undefined
  const artifactPaths =
    payload.artifact_paths && typeof payload.artifact_paths === "object" && !Array.isArray(payload.artifact_paths)
      ? Object.fromEntries(
          Object.entries(payload.artifact_paths as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : undefined
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
    operationKind,
    regionID,
    manifestPath,
    artifactPaths,
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

export async function findReadableBrowserPreviewEvidenceArtifactPath(input: {
  taskID: string
  evidenceID: string
  artifactName: "source" | "implementation" | "side-by-side" | "diff"
}): Promise<string | undefined> {
  const evidence = await findReadableBrowserPreviewEvidenceByID(input)
  if (!evidence) return undefined
  const keyByName: Record<typeof input.artifactName, string> = {
    source: "source_crop",
    implementation: "implementation_crop",
    "side-by-side": "side_by_side",
    diff: "diff",
  }
  return evidence.artifactPaths?.[keyByName[input.artifactName]]
}

export function persistBrowserPreviewEvidence(input: {
  projectRoot: string
  taskID: string
  targetID: string
  viewportID: string
  operationKind?: "preview-capture" | "reference-comparison"
  regionID?: string
  manifestPath?: string
  artifactPaths?: Record<string, string | undefined>
  status: "passed" | "failed"
  summary: string
  capture?: unknown
  diagnostics: string[]
  now?: number
}): string {
  const now = input.now ?? Date.now()
  const id = Identifier.ascending("artifact")
  const projectRoot = input.projectRoot
  const artifactPaths = input.artifactPaths
    ? Object.fromEntries(
        Object.entries(input.artifactPaths)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
          .map(([key, value]) => [key, toRuntimeRelativePath(projectRoot, value)]),
      )
    : undefined
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
          operation_kind: input.operationKind ?? "preview-capture",
          ...(input.regionID ? { region_id: input.regionID } : {}),
          ...(input.manifestPath ? { manifest_path: toRuntimeRelativePath(projectRoot, input.manifestPath) } : {}),
          ...(artifactPaths ? { artifact_paths: artifactPaths } : {}),
          status: input.status,
          summary: input.summary,
          capture: input.capture === undefined ? null : normalizeRuntimePathRefs(projectRoot, input.capture),
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
  const artifacts: Array<{ path: string; sha?: string }> = [
    ...browserPreviewCaptureArtifacts(evidence.capture),
    ...Object.values(evidence.artifactPaths ?? {}).map((artifactPath) => ({ path: artifactPath })),
  ]
  if (evidence.status === "passed" && artifacts.length === 0) return false
  for (const artifact of artifacts) {
    const filePath = resolveRuntimeRelativePath(Instance.directory, artifact.path)
    let bytes: Buffer
    try {
      bytes = await fs.readFile(filePath)
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

export function toRuntimeRelativePath(projectRoot: string, input: string): string {
  const normalized = input.replaceAll("\\", "/")
  if (
    normalized === ProjectRuntimePaths.relativeRuntimeRoot() ||
    normalized.startsWith(`${ProjectRuntimePaths.relativeRuntimeRoot()}/`)
  ) {
    return normalized
  }
  if (!path.isAbsolute(input)) {
    throw new Error(`Browser preview artifact path must be runtime-relative or absolute: ${input}`)
  }
  const absolute = path.resolve(input)
  const runtimeRoot = path.resolve(ProjectRuntimePaths.projectRuntimeRoot(projectRoot))
  if (absolute !== runtimeRoot && !absolute.startsWith(runtimeRoot + path.sep)) {
    throw new Error(`Browser preview artifact path is outside task runtime: ${input}`)
  }
  return path.relative(path.resolve(projectRoot), absolute).replaceAll(path.sep, "/")
}

export function resolveRuntimeRelativePath(projectRoot: string, input: string): string {
  const normalized = input.replaceAll("\\", "/")
  if (
    !(
      normalized === ProjectRuntimePaths.relativeRuntimeRoot() ||
      normalized.startsWith(`${ProjectRuntimePaths.relativeRuntimeRoot()}/`)
    )
  ) {
    throw new Error(`Browser preview artifact path is not a runtime-relative path: ${input}`)
  }
  if (normalized.split("/").includes("..")) {
    throw new Error(`Browser preview artifact path escapes runtime root: ${input}`)
  }
  return path.resolve(projectRoot, ...normalized.split("/"))
}

export function normalizeRuntimePathRefs(projectRoot: string, input: unknown): unknown {
  if (Array.isArray(input)) return input.map((item) => normalizeRuntimePathRefs(projectRoot, item))
  if (!input || typeof input !== "object") return input
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === "artifactPaths" && Array.isArray(value)) {
      out[key] = value.map((item) => (typeof item === "string" ? toRuntimeRelativePath(projectRoot, item) : item))
    } else if (typeof value === "string" && isPathRefKey(key)) {
      out[key] = toRuntimeRelativePath(projectRoot, value)
    } else {
      out[key] = normalizeRuntimePathRefs(projectRoot, value)
    }
  }
  return out
}

export function stripRuntimePathRefs(input: unknown): unknown {
  if (Array.isArray(input)) return input.map((item) => stripRuntimePathRefs(item))
  if (!input || typeof input !== "object") return input
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (isPathRefKey(key) || key === "artifactPaths" || key === "artifact_paths") continue
    out[key] = stripRuntimePathRefs(value)
  }
  return out
}

function isPathRefKey(key: string): boolean {
  return (
    key === "path" ||
    key === "screenshot_path" ||
    key === "manifestPath" ||
    key === "manifest_path" ||
    key === "diagnosticsPath" ||
    key === "source_crop" ||
    key === "implementation_crop" ||
    key === "side_by_side" ||
    key === "diff"
  )
}

export function latestBrowserPreviewEvidenceIDs(input: {
  taskID: string
  targetID: string
}): Partial<Record<string, string>> {
  const rows = Database.use((db) =>
    db
      .select({ id: EngineArtifactTable.id, payload: EngineArtifactTable.payload })
      .from(EngineArtifactTable)
      .where(
        and(eq(EngineArtifactTable.task_id, input.taskID), eq(EngineArtifactTable.kind, BROWSER_PREVIEW_EVIDENCE_KIND)),
      )
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all(),
  )
  const latest: Partial<Record<string, string>> = {}
  for (const row of rows) {
    const meta = sqlEvidenceMeta(row.payload)
    if (meta?.targetID !== input.targetID) continue
    latest[meta.viewportID] ??= row.id
  }
  return latest
}

function sqlEvidenceMeta(payload: unknown): { targetID: string; viewportID: string } | undefined {
  if (!payload || typeof payload !== "object") return undefined
  const record = payload as Record<string, unknown>
  if (record.operation_kind === "reference-comparison") return undefined
  const targetID = typeof record.target_id === "string" ? record.target_id : undefined
  const viewportID = typeof record.viewport_id === "string" ? record.viewport_id : undefined
  if (!targetID || !viewportID) return undefined
  return { targetID, viewportID }
}
