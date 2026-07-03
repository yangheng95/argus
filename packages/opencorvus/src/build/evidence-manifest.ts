import { AttachmentStore } from "@/storage/attachment-store"
import { buildEvidenceEntries, type BuildEvidenceEntry, type BuildEvidencePack, type BuildEvidenceRole } from "./evidence-pack"

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

export class BuildInputEvidenceValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BuildInputEvidenceValidationError"
  }
}

function entryLabel(entry: BuildEvidenceEntry) {
  return entry.filename ?? entry.sha ?? entry.url
}

function assertStringMatches(input: {
  field: "sha" | "mime" | "filename"
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
  assertStringMatches({
    field: "filename",
    role: input.entry.role,
    label,
    candidate: input.entry.filename,
    canonical: reference.filename,
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
