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
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { Database } from "@/storage/db"
import { BrowserPreviewCropIntent, type BrowserPreviewCropIntent as BrowserPreviewCropIntentValue } from "./region-schema"
import { BrowserPreviewViewport, normalizeBrowserPreviewViewports } from "./viewport"
import { NamedError } from "@opencorvus-ai/util/error"

export const BROWSER_PREVIEW_TARGET_KIND = "browser_preview_target" as const
export const BROWSER_PREVIEW_EVIDENCE_KIND = "browser_preview_evidence" as const
const BrowserPreviewEvidenceOperationKind = z.enum([
  "preview-capture",
  "reference-comparison",
  "source-binding",
  "layout-geometry",
])
const BrowserPreviewEvidenceStatus = z.enum(["passed", "failed"])
const REQUIRED_REFERENCE_COMPARISON_ARTIFACTS = ["source_crop", "implementation_crop", "side_by_side"] as const

export const BrowserPreviewEvidenceCorruptionError = NamedError.create(
  "BrowserPreviewEvidenceCorruptionError",
  z.object({
    message: z.string(),
    taskID: z.string(),
    evidenceID: z.string(),
    reason: z.string(),
    artifactPath: z.string().optional(),
    expectedSha: z.string().optional(),
    actualSha: z.string().optional(),
  }),
)

export const PersistedBrowserPreviewTarget = z.object({
  id: z.string(),
  taskID: z.string(),
  url: z.string(),
  source: z.literal("task-artifact"),
  viewports: BrowserPreviewViewport.array().min(1),
  timeCreated: z.number(),
  timeUpdated: z.number(),
})
export type PersistedBrowserPreviewTarget = z.infer<typeof PersistedBrowserPreviewTarget>

export const PersistedBrowserPreviewEvidence = z.object({
  id: z.string(),
  taskID: z.string(),
  targetID: z.string(),
  viewportID: z.string(),
  operationKind: BrowserPreviewEvidenceOperationKind,
  regionID: z.string().optional(),
  stateID: z.string().optional(),
  cropIntent: BrowserPreviewCropIntent.optional(),
  manifestPath: z.string().optional(),
  artifactPaths: z.record(z.string(), z.string()).optional(),
  status: BrowserPreviewEvidenceStatus,
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
  viewports: BrowserPreviewViewport.array().min(1),
})

const PersistedBrowserPreviewEvidencePayload = z
  .object({
    target_id: z.string().min(1),
    viewport_id: z.string().min(1),
    operation_kind: BrowserPreviewEvidenceOperationKind,
    region_id: z.string().optional(),
    state_id: z.string().optional(),
    crop_intent: BrowserPreviewCropIntent.optional(),
    manifest_path: z.string().optional(),
    artifact_paths: z.record(z.string(), z.string()).optional(),
    status: BrowserPreviewEvidenceStatus,
    summary: z.string().min(1),
    capture: z.unknown().optional().nullable(),
    diagnostics: z.string().array(),
    time_completed: z.number(),
  })
  .passthrough()

export function persistBrowserPreviewTarget(input: {
  taskID: string
  url: string
  viewports: readonly BrowserPreviewViewport[]
  now?: number
}): Promise<PersistedBrowserPreviewTarget> {
  const viewports = normalizeBrowserPreviewViewports(input.viewports)
  const existing = findBrowserPreviewTargetByUrl(input)
  const now = Math.max(input.now ?? Date.now(), existing ? existing.timeUpdated + 1 : 0)
  const payload = {
    url: input.url,
    source: "task-artifact" as const,
    viewports,
  }
  if (existing) {
    Database.use((db) =>
      db
        .update(EngineArtifactTable)
        .set({
          time_updated: now,
          label: "active",
          payload,
        })
        .where(eq(EngineArtifactTable.id, existing.id))
        .run(),
    )
    const persisted: PersistedBrowserPreviewTarget = {
      ...existing,
      viewports,
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
    viewports,
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
      viewports: payload.data.viewports,
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
    viewports: payload.data.viewports,
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
      viewports: payload.data.viewports,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    }
  }
  return undefined
}

function browserPreviewEvidenceCorruption(
  input: { taskID: string; evidenceID?: string; id?: string },
  detail: {
    reason: string
    artifactPath?: string
    expectedSha?: string
    actualSha?: string
  },
): InstanceType<typeof BrowserPreviewEvidenceCorruptionError> {
  const evidenceID = input.evidenceID ?? input.id
  if (!evidenceID) throw new Error("browserPreviewEvidenceCorruption requires evidenceID or id")
  return new BrowserPreviewEvidenceCorruptionError({
    taskID: input.taskID,
    evidenceID,
    reason: detail.reason,
    message: `Browser preview evidence corrupt: ${evidenceID} (${detail.reason})`,
    ...(detail.artifactPath ? { artifactPath: detail.artifactPath } : {}),
    ...(detail.expectedSha ? { expectedSha: detail.expectedSha } : {}),
    ...(detail.actualSha ? { actualSha: detail.actualSha } : {}),
  })
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
  if (!row) return undefined
  const parsed = PersistedBrowserPreviewEvidencePayload.safeParse(row.payload)
  if (!parsed.success) {
    throw browserPreviewEvidenceCorruption(input, {
      reason: `payload schema invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "payload"} ${issue.message}`)
        .join("; ")}`,
    })
  }
  const payload = parsed.data
  if (payload.operation_kind === "reference-comparison" && payload.status === "passed" && !payload.crop_intent) {
    throw browserPreviewEvidenceCorruption(input, {
      reason: "passed reference-comparison missing crop_intent",
    })
  }
  return {
    id: row.id,
    taskID: row.task_id,
    targetID: payload.target_id,
    viewportID: payload.viewport_id,
    operationKind: payload.operation_kind,
    regionID: payload.region_id,
    stateID: payload.state_id,
    cropIntent: payload.crop_intent,
    manifestPath: payload.manifest_path,
    artifactPaths: payload.artifact_paths,
    status: payload.status,
    summary: payload.summary,
    capture: payload.capture === null ? undefined : payload.capture,
    diagnostics: payload.diagnostics,
    timeCompleted: payload.time_completed,
    timeCreated: row.time_created,
  }
}

export async function findReadableBrowserPreviewEvidenceByID(input: {
  projectRoot: string
  taskID: string
  evidenceID: string
}): Promise<PersistedBrowserPreviewEvidence | undefined> {
  const evidence = findBrowserPreviewEvidenceByID(input)
  if (!evidence) return undefined
  await assertBrowserPreviewEvidenceArtifactsReadable(input.projectRoot, evidence)
  return evidence
}

export async function findReadableBrowserPreviewEvidenceCapturePath(input: {
  projectRoot: string
  taskID: string
  evidenceID: string
}): Promise<string | undefined> {
  const evidence = await findReadableBrowserPreviewEvidenceByID(input)
  if (!evidence) return undefined
  if (evidence.operationKind !== "preview-capture") return undefined
  return browserPreviewCaptureArtifacts(evidence.capture)[0]?.path
}

export async function findReadableBrowserPreviewEvidenceArtifactPath(input: {
  projectRoot: string
  taskID: string
  evidenceID: string
  artifactName: "source" | "implementation" | "side-by-side" | "diff"
}): Promise<string | undefined> {
  const evidence = await findReadableBrowserPreviewEvidenceByID(input)
  if (!evidence) return undefined
  if (evidence.operationKind !== "reference-comparison") return undefined
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
  operationKind: "preview-capture" | "reference-comparison" | "source-binding" | "layout-geometry"
  regionID?: string
  stateID?: string
  cropIntent?: BrowserPreviewCropIntentValue
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
  const operationKind = BrowserPreviewEvidenceOperationKind.parse(input.operationKind)
  const status = BrowserPreviewEvidenceStatus.parse(input.status)
  const artifactPaths = input.artifactPaths
    ? Object.fromEntries(
        Object.entries(input.artifactPaths)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
          .map(([key, value]) => [key, toBrowserPreviewRuntimeRelativePath(projectRoot, input.taskID, value)]),
      )
    : undefined
  if (operationKind === "reference-comparison" && status === "passed") {
    if (!input.cropIntent) {
      throw new Error("passed reference-comparison evidence requires cropIntent")
    }
    const missing = REQUIRED_REFERENCE_COMPARISON_ARTIFACTS.filter((key) => !artifactPaths?.[key])
    if (missing.length > 0) {
      throw new Error(`passed reference-comparison evidence requires artifact path(s): ${missing.join(", ")}`)
    }
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
        kind: BROWSER_PREVIEW_EVIDENCE_KIND,
        label: "capture",
        payload: {
          target_id: input.targetID,
          viewport_id: input.viewportID,
          operation_kind: operationKind,
          ...(input.regionID ? { region_id: input.regionID } : {}),
          ...(input.stateID ? { state_id: input.stateID } : {}),
          ...(input.cropIntent ? { crop_intent: input.cropIntent } : {}),
          ...(input.manifestPath
            ? { manifest_path: toBrowserPreviewRuntimeRelativePath(projectRoot, input.taskID, input.manifestPath) }
            : {}),
          ...(artifactPaths ? { artifact_paths: artifactPaths } : {}),
          status,
          summary: input.summary,
          capture:
            input.capture === undefined
              ? null
              : normalizeBrowserPreviewRuntimePathRefs(projectRoot, input.taskID, input.capture),
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

async function assertBrowserPreviewEvidenceArtifactsReadable(
  projectRoot: string,
  evidence: PersistedBrowserPreviewEvidence,
): Promise<void> {
  const artifacts: Array<{ path: string; sha?: string }> = [
    ...browserPreviewCaptureArtifacts(evidence.capture),
    ...Object.values(evidence.artifactPaths ?? {}).map((artifactPath) => ({ path: artifactPath })),
  ]
  if (evidence.status === "passed" && evidence.operationKind === "reference-comparison") {
    for (const key of REQUIRED_REFERENCE_COMPARISON_ARTIFACTS) {
      const artifactPath = evidence.artifactPaths?.[key]
      if (!artifactPath) {
        throw browserPreviewEvidenceCorruption(evidence, {
          reason: `passed reference-comparison missing required artifact path: ${key}`,
        })
      }
      artifacts.push({ path: artifactPath })
    }
  }
  if (evidence.status === "passed" && artifacts.length === 0) {
    throw browserPreviewEvidenceCorruption(evidence, {
      reason: "passed evidence has no artifact paths",
    })
  }
  for (const artifact of artifacts) {
    let bytes: Buffer
    try {
      const filePath = resolveBrowserPreviewRuntimeRelativePath(projectRoot, evidence.taskID, artifact.path)
      bytes = await fs.readFile(filePath)
    } catch (error) {
      throw browserPreviewEvidenceCorruption(evidence, {
        reason: error instanceof Error ? error.message : String(error),
        artifactPath: artifact.path,
      })
    }
    if (artifact.sha) {
      const actual = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16)
      if (actual !== artifact.sha) {
        throw browserPreviewEvidenceCorruption(evidence, {
          reason: "artifact sha mismatch",
          artifactPath: artifact.path,
          expectedSha: artifact.sha,
          actualSha: actual,
        })
      }
    }
  }
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
    for (const key of ["screenshot_path", "implementation_screenshot_path"]) {
      const directPath = record[key]
      if (typeof directPath === "string" && directPath.trim()) {
        artifacts.push({ path: directPath })
      }
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

function toBrowserPreviewRuntimeRelativePath(projectRoot: string, taskID: string, input: string): string {
  const normalized = input.replaceAll("\\", "/")
  const browserPreviewRoot = ProjectRuntimePaths.taskRelative(taskID, "bp").replaceAll("\\", "/")
  if (normalized === browserPreviewRoot || normalized.startsWith(`${browserPreviewRoot}/`)) {
    return normalized
  }
  if (
    normalized === ProjectRuntimePaths.relativeRuntimeRoot() ||
    normalized.startsWith(`${ProjectRuntimePaths.relativeRuntimeRoot()}/`)
  ) {
    throw new Error(`Browser preview artifact path must be under task browser-preview job root: ${input}`)
  }
  if (!path.isAbsolute(input)) {
    throw new Error(`Browser preview artifact path must be runtime-relative or absolute: ${input}`)
  }
  const absolute = path.resolve(input)
  const absoluteBrowserPreviewRoot = path.resolve(ProjectRuntimePaths.taskAbsolute(projectRoot, taskID, "bp"))
  if (absolute !== absoluteBrowserPreviewRoot && !absolute.startsWith(absoluteBrowserPreviewRoot + path.sep)) {
    throw new Error(`Browser preview artifact path must be under task browser-preview job root: ${input}`)
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

function resolveBrowserPreviewRuntimeRelativePath(projectRoot: string, taskID: string, input: string): string {
  const normalized = input.replaceAll("\\", "/")
  const browserPreviewRoot = ProjectRuntimePaths.taskRelative(taskID, "bp").replaceAll("\\", "/")
  if (!(normalized === browserPreviewRoot || normalized.startsWith(`${browserPreviewRoot}/`))) {
    throw new Error(`Browser preview artifact path is outside task browser-preview job root: ${input}`)
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

function normalizeBrowserPreviewRuntimePathRefs(projectRoot: string, taskID: string, input: unknown): unknown {
  if (Array.isArray(input))
    return input.map((item) => normalizeBrowserPreviewRuntimePathRefs(projectRoot, taskID, item))
  if (!input || typeof input !== "object") return input
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === "artifactPaths" && Array.isArray(value)) {
      out[key] = value.map((item) =>
        typeof item === "string" ? toBrowserPreviewRuntimeRelativePath(projectRoot, taskID, item) : item,
      )
    } else if (typeof value === "string" && isPathRefKey(key)) {
      out[key] = toBrowserPreviewRuntimeRelativePath(projectRoot, taskID, value)
    } else {
      out[key] = normalizeBrowserPreviewRuntimePathRefs(projectRoot, taskID, value)
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

export function collectRuntimePathRefs(input: unknown): string[] {
  const refs: string[] = []
  const seen = new Set<object>()
  const push = (value: string) => {
    const trimmed = value.trim()
    if (trimmed && !refs.includes(trimmed)) refs.push(trimmed)
  }
  const visit = (value: unknown, depth: number) => {
    if (!value || depth > 8) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (typeof value !== "object") return
    if (seen.has(value)) return
    seen.add(value)
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string" && isPathRefKey(key)) push(child)
      if ((key === "artifactPaths" || key === "artifact_paths") && Array.isArray(child)) {
        for (const item of child) {
          if (typeof item === "string") push(item)
        }
      }
      visit(child, depth + 1)
    }
  }
  visit(input, 0)
  return refs
}

function isPathRefKey(key: string): boolean {
  return (
    key === "path" ||
    key === "screenshot_path" ||
    key === "implementation_screenshot_path" ||
    key === "manifestPath" ||
    key === "manifest_path" ||
    key === "diagnosticsPath" ||
    key === "source_crop" ||
    key === "implementation_crop" ||
    key === "module_comparison" ||
    key === "side_by_side" ||
    key === "diff"
  )
}

export async function latestBrowserPreviewEvidenceIDs(input: {
  projectRoot: string
  taskID: string
  targetID: string
}): Promise<Partial<Record<string, string>>> {
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
    if (latest[meta.viewportID]) continue
    const readable = await findReadableBrowserPreviewEvidenceByID({
      projectRoot: input.projectRoot,
      taskID: input.taskID,
      evidenceID: row.id,
    })
    if (!readable) continue
    latest[meta.viewportID] = row.id
  }
  return latest
}

function sqlEvidenceMeta(payload: unknown): { targetID: string; viewportID: string } | undefined {
  if (!payload || typeof payload !== "object") return undefined
  const record = payload as Record<string, unknown>
  if (record.operation_kind !== "preview-capture") return undefined
  const targetID = typeof record.target_id === "string" ? record.target_id : undefined
  const viewportID = typeof record.viewport_id === "string" ? record.viewport_id : undefined
  if (!targetID || !viewportID) return undefined
  return { targetID, viewportID }
}
