import { AttachmentStore } from "@/storage/attachment-store"
import { EngineArtifactTable } from "@/engine/engine.sql"
import { Database, and, eq } from "@/storage/db"
import z from "zod"
import {
  buildEvidenceEntries,
  type BuildEvidenceEntry,
  type BuildEvidenceFile,
  type BuildEvidencePack,
  type BuildEvidenceRole,
} from "./evidence-pack"

export interface BuildInputEvidenceManifestEntry {
  role: BuildEvidenceRole
  project_id: string
  sha: string
  mime: string
  size: number
  filename?: string
  source?: string
  intent?: string
  source_task_id?: string
  source_goal_id?: string
  source_goal_run_id?: string
  legacy_attachment_url: string
  sha_verified_at: number
}

export interface BuildInputEvidenceManifest {
  version: 1
  project_id: string
  task_id: string
  goal_id?: string
  goal_run_id?: string
  session_id?: string
  entries: BuildInputEvidenceManifestEntry[]
}

const BuildEvidenceRoleSchema = z.enum([
  "target_reference",
  "previous_output",
  "comparison_artifact",
  "visual_qa_annotation",
  "visual_qa_diagnostic",
])

export const BuildInputEvidenceManifestEntrySchema = z
  .object({
    role: BuildEvidenceRoleSchema,
    project_id: z.string().min(1),
    sha: z.string().min(1),
    mime: z.string().min(1),
    size: z.number().int().nonnegative(),
    filename: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
    intent: z.string().min(1).optional(),
    source_task_id: z.string().min(1).optional(),
    source_goal_id: z.string().min(1).optional(),
    source_goal_run_id: z.string().min(1).optional(),
    legacy_attachment_url: z.string().min(1),
    sha_verified_at: z.number(),
  })
  .strict()

export const BuildInputEvidenceManifestSchema = z
  .object({
    version: z.literal(1),
    project_id: z.string().min(1),
    task_id: z.string().min(1),
    goal_id: z.string().min(1).optional(),
    goal_run_id: z.string().min(1).optional(),
    session_id: z.string().min(1).optional(),
    entries: z.array(BuildInputEvidenceManifestEntrySchema),
  })
  .strict()

export class BuildInputEvidenceValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BuildInputEvidenceValidationError"
  }
}

function issueSummary(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ")
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

export function parseBuildInputEvidenceManifest(input: unknown, context: string): BuildInputEvidenceManifest {
  const parsed = BuildInputEvidenceManifestSchema.safeParse(input)
  if (!parsed.success) {
    throw new BuildInputEvidenceValidationError(
      `${context} has invalid build_session_contract.input_evidence: ${issueSummary(parsed.error)}`,
    )
  }
  const manifest = parsed.data
  for (const entry of manifest.entries) {
    if (entry.project_id !== manifest.project_id) {
      throw new BuildInputEvidenceValidationError(
        `${context} input_evidence entry ${entry.role} ${entry.filename ?? entry.sha} belongs to project ${entry.project_id}, expected manifest project ${manifest.project_id}`,
      )
    }
  }
  return manifest
}

function assertManifestMatchesBuildSession(
  manifest: BuildInputEvidenceManifest,
  input: { context: string; sessionID: string; taskID: string; projectID: string; goalID?: string },
) {
  if (manifest.session_id !== input.sessionID) {
    throw new BuildInputEvidenceValidationError(
      `${input.context} input_evidence session_id=${manifest.session_id ?? "<unset>"} does not match build session ${input.sessionID}`,
    )
  }
  if (manifest.task_id !== input.taskID) {
    throw new BuildInputEvidenceValidationError(
      `${input.context} input_evidence task_id=${manifest.task_id} does not match task ${input.taskID}`,
    )
  }
  if (manifest.project_id !== input.projectID) {
    throw new BuildInputEvidenceValidationError(
      `${input.context} input_evidence project_id=${manifest.project_id} does not match task project ${input.projectID}`,
    )
  }
  const expectedGoalID = input.goalID
  if ((manifest.goal_id ?? undefined) !== expectedGoalID) {
    throw new BuildInputEvidenceValidationError(
      `${input.context} input_evidence goal_id=${manifest.goal_id ?? "<unset>"} does not match ${expectedGoalID ?? "<unset>"}`,
    )
  }
}

export function findOriginalBuildSessionInputEvidenceManifest(input: {
  sessionID: string
  taskID: string
  projectID: string
  goalID?: string
}): BuildInputEvidenceManifest | undefined {
  const rows = Database.use((db) =>
    db
      .select({
        id: EngineArtifactTable.id,
        payload: EngineArtifactTable.payload,
      })
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, input.taskID), eq(EngineArtifactTable.kind, "build_session_contract")))
      .orderBy(EngineArtifactTable.time_created, EngineArtifactTable.id)
      .all(),
  )
  const context = `Build session ${input.sessionID}`
  const row = rows.find((candidate) => {
    const payload = recordValue(candidate.payload)
    return payload?.session_id === input.sessionID
  })
  if (!row) return undefined
  const payload = recordValue(row.payload)
  if (!payload) {
    throw new BuildInputEvidenceValidationError(`${context} contract ${row.id} payload is not an object`)
  }
  if (payload.task_id !== input.taskID) {
    throw new BuildInputEvidenceValidationError(
      `${context} contract ${row.id} task_id=${String(payload.task_id)} does not match task ${input.taskID}`,
    )
  }
  const expectedGoalID = input.goalID ?? null
  const actualGoalID = typeof payload.goal_id === "string" ? payload.goal_id : null
  if (actualGoalID !== expectedGoalID) {
    throw new BuildInputEvidenceValidationError(
      `${context} contract ${row.id} goal_id=${actualGoalID ?? "<unset>"} does not match ${expectedGoalID ?? "<unset>"}`,
    )
  }
  if (payload.input_evidence === null || payload.input_evidence === undefined) return undefined
  const manifest = parseBuildInputEvidenceManifest(payload.input_evidence, `${context} contract ${row.id}`)
  assertManifestMatchesBuildSession(manifest, {
    context: `${context} contract ${row.id}`,
    sessionID: input.sessionID,
    taskID: input.taskID,
    projectID: input.projectID,
    goalID: input.goalID,
  })
  return manifest
}

export function readOriginalBuildSessionInputEvidenceManifest(input: {
  sessionID: string
  taskID: string
  projectID: string
  goalID?: string
}): BuildInputEvidenceManifest {
  const manifest = findOriginalBuildSessionInputEvidenceManifest(input)
  if (!manifest) {
    throw new BuildInputEvidenceValidationError(
      `Build session ${input.sessionID} has no build_session_contract.input_evidence for task ${input.taskID}`,
    )
  }
  return manifest
}

function entryLabel(entry: BuildEvidenceEntry) {
  return entry.filename ?? entry.sha ?? entry.url
}

function assertStringMatches(input: {
  field: "sha" | "mime"
  role: BuildEvidenceRole
  label: string
  candidate?: string
  canonical?: string
}) {
  if (input.candidate === undefined) return
  if (input.candidate === input.canonical) return
  throw new BuildInputEvidenceValidationError(
    `Build input evidence ${input.role} entry ${input.label} ${input.field} does not match canonical AttachmentStore metadata: expected ${input.canonical ?? "<unset>"}, got ${input.candidate}`,
  )
}

function assertNumberMatches(input: {
  field: "size"
  role: BuildEvidenceRole
  label: string
  candidate?: number
  canonical: number
}) {
  if (input.candidate === undefined) return
  if (input.candidate === input.canonical) return
  throw new BuildInputEvidenceValidationError(
    `Build input evidence ${input.role} entry ${input.label} ${input.field} does not match canonical AttachmentStore metadata: expected ${input.canonical}, got ${input.candidate}`,
  )
}

async function manifestEntryFromEvidence(input: {
  projectID: string
  taskID: string
  entry: BuildEvidenceEntry
  now: number
}): Promise<BuildInputEvidenceManifestEntry> {
  const label = entryLabel(input.entry)
  const located = AttachmentStore.nameFromUrl(input.entry.url)
  if (!located) {
    throw new BuildInputEvidenceValidationError(
      `Build input evidence ${input.entry.role} entry ${label} is not a canonical /attachment/<projectID>/<name> URL: ${input.entry.url}`,
    )
  }
  if (located.projectID !== input.projectID) {
    throw new BuildInputEvidenceValidationError(
      `Build input evidence ${input.entry.role} entry ${label} belongs to project ${located.projectID}, expected task project ${input.projectID}: ${input.entry.url}`,
    )
  }

  let reference: AttachmentStore.Reference
  try {
    reference = await AttachmentStore.readReference(located.projectID, located.name)
  } catch (error) {
    throw new BuildInputEvidenceValidationError(
      `Build input evidence ${input.entry.role} entry ${label} canonical metadata is unreadable for ${located.projectID}/${located.name}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  assertStringMatches({
    field: "sha",
    role: input.entry.role,
    label,
    candidate: input.entry.sha,
    canonical: reference.sha,
  })
  assertStringMatches({
    field: "mime",
    role: input.entry.role,
    label,
    candidate: input.entry.mime,
    canonical: reference.mime,
  })
  assertNumberMatches({
    field: "size",
    role: input.entry.role,
    label,
    candidate: input.entry.size,
    canonical: reference.size,
  })

  try {
    const bytes = await AttachmentStore.read(located.projectID, located.name)
    const actualSize = bytes.byteLength
    if (actualSize !== reference.size) {
      throw new BuildInputEvidenceValidationError(
        `Build input evidence ${input.entry.role} entry ${label} byte size does not match canonical metadata: expected ${reference.size}, got ${actualSize}`,
      )
    }
  } catch (error) {
    if (error instanceof BuildInputEvidenceValidationError) throw error
    throw new BuildInputEvidenceValidationError(
      `Build input evidence ${input.entry.role} entry ${label} bytes are unreadable for ${located.projectID}/${located.name}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  return {
    role: input.entry.role,
    project_id: input.projectID,
    sha: reference.sha,
    mime: reference.mime,
    size: reference.size,
    ...(reference.filename ? { filename: reference.filename } : {}),
    ...(input.entry.source ? { source: input.entry.source } : {}),
    ...(input.entry.intent ? { intent: input.entry.intent } : {}),
    source_task_id: input.entry.scope?.taskID ?? input.taskID,
    ...(input.entry.scope?.goalID ? { source_goal_id: input.entry.scope.goalID } : {}),
    ...(input.entry.scope?.goalRunID ? { source_goal_run_id: input.entry.scope.goalRunID } : {}),
    legacy_attachment_url: reference.url,
    sha_verified_at: input.now,
  }
}

export async function composeBuildInputEvidenceManifest(input: {
  projectID: string
  taskID: string
  goalID?: string
  goalRunID?: string
  sessionID?: string
  evidencePack?: BuildEvidencePack
  now?: number
}): Promise<BuildInputEvidenceManifest> {
  const now = input.now ?? Date.now()
  const entries: BuildInputEvidenceManifestEntry[] = []
  for (const entry of buildEvidenceEntries(input.evidencePack)) {
    entries.push(
      await manifestEntryFromEvidence({
        projectID: input.projectID,
        taskID: input.taskID,
        entry,
        now,
      }),
    )
  }
  return {
    version: 1,
    project_id: input.projectID,
    task_id: input.taskID,
    ...(input.goalID ? { goal_id: input.goalID } : {}),
    ...(input.goalRunID ? { goal_run_id: input.goalRunID } : {}),
    ...(input.sessionID ? { session_id: input.sessionID } : {}),
    entries,
  }
}

export function bindBuildInputEvidenceManifest(
  manifest: BuildInputEvidenceManifest,
  input: { sessionID: string; goalRunID?: string },
): BuildInputEvidenceManifest {
  return {
    ...manifest,
    session_id: input.sessionID,
    ...(input.goalRunID ? { goal_run_id: input.goalRunID } : {}),
  }
}

function fileFromManifestEntry(entry: BuildInputEvidenceManifestEntry): BuildEvidenceFile {
  return {
    url: entry.legacy_attachment_url,
    mime: entry.mime,
    sha: entry.sha,
    size: entry.size,
    ...(entry.filename ? { filename: entry.filename } : {}),
    ...(entry.intent ? { intent: entry.intent } : {}),
    ...(entry.source ? { source: entry.source } : {}),
    scope: {
      kind: entry.source_goal_run_id ? "goal_run" : entry.source_goal_id ? "goal" : "task",
      ...(entry.source_task_id ? { taskID: entry.source_task_id } : {}),
      ...(entry.source_goal_id ? { goalID: entry.source_goal_id } : {}),
      ...(entry.source_goal_run_id ? { goalRunID: entry.source_goal_run_id } : {}),
    },
  }
}

export function buildEvidencePackFromInputManifest(
  manifest: BuildInputEvidenceManifest | undefined,
): BuildEvidencePack | undefined {
  if (!manifest || manifest.entries.length === 0) return undefined
  const pack: BuildEvidencePack = {}
  for (const entry of manifest.entries) {
    const file = fileFromManifestEntry(entry)
    switch (entry.role) {
      case "target_reference":
        pack.targetReferences = [...(pack.targetReferences ?? []), file]
        break
      case "previous_output":
        pack.previousOutputs = [...(pack.previousOutputs ?? []), file]
        break
      case "comparison_artifact":
        pack.comparisonArtifacts = [...(pack.comparisonArtifacts ?? []), file]
        break
      case "visual_qa_annotation":
        pack.visualQaAnnotations = [...(pack.visualQaAnnotations ?? []), file]
        break
      case "visual_qa_diagnostic":
        pack.visualQaDiagnostics = [...(pack.visualQaDiagnostics ?? []), file]
        break
    }
  }
  return pack
}
