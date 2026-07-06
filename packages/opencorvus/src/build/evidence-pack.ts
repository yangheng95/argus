import {
  validateAgentContextPackets,
  type AgentContextMediaRefPart,
  type AgentContextPacket,
  type AgentContextStructuredPart,
} from "@/agent/context-packet"

export type BuildEvidenceRole =
  | "target_reference"
  | "previous_output"
  | "comparison_artifact"
  | "visual_qa_annotation"
  | "visual_qa_diagnostic"

export interface BuildEvidenceFile {
  url: string
  mime: string
  sha?: string
  size?: number
  filename?: string
  intent?: string
  source?: string
  label?: string
  scope?: {
    kind: "task" | "goal" | "goal_run"
    taskID?: string
    goalID?: string
    goalRunID?: string
  }
}

export interface BuildEvidencePack {
  targetReferences?: BuildEvidenceFile[]
  previousOutputs?: BuildEvidenceFile[]
  comparisonArtifacts?: BuildEvidenceFile[]
  visualQaAnnotations?: BuildEvidenceFile[]
  visualQaDiagnostics?: BuildEvidenceFile[]
}

export type BuildEvidenceEntry = BuildEvidenceFile & { role: BuildEvidenceRole }

export const BUILD_EVIDENCE_CONTEXT_PACKET_SCHEMA = "opencorvus.build.evidence.v1"

const BUILD_EVIDENCE_ROLE_SET = new Set<BuildEvidenceRole>([
  "target_reference",
  "previous_output",
  "comparison_artifact",
  "visual_qa_annotation",
  "visual_qa_diagnostic",
])

function assertEvidenceFile(file: BuildEvidenceFile, role: BuildEvidenceRole): BuildEvidenceFile {
  if (!file || typeof file.url !== "string" || file.url.length === 0) {
    throw new Error(`BuildEvidencePack ${role} entry requires a non-empty url`)
  }
  if (typeof file.mime !== "string" || file.mime.length === 0) {
    throw new Error(
      `BuildEvidencePack ${role} entry ${file.filename ?? file.sha ?? file.url} requires a non-empty mime`,
    )
  }
  return file
}

function roleEntries(role: BuildEvidenceRole, files: readonly BuildEvidenceFile[] | undefined): BuildEvidenceEntry[] {
  return (files ?? []).map((file) => ({ ...assertEvidenceFile(file, role), role }))
}

export function buildEvidenceEntries(pack: BuildEvidencePack | undefined): BuildEvidenceEntry[] {
  if (!pack) return []
  return [
    ...roleEntries("target_reference", pack.targetReferences),
    ...roleEntries("previous_output", pack.previousOutputs),
    ...roleEntries("comparison_artifact", pack.comparisonArtifacts),
    ...roleEntries("visual_qa_annotation", pack.visualQaAnnotations),
    ...roleEntries("visual_qa_diagnostic", pack.visualQaDiagnostics),
  ]
}

export function buildEvidenceTargetReferences(pack: BuildEvidencePack | undefined): BuildEvidenceFile[] {
  return roleEntries("target_reference", pack?.targetReferences)
}

export function hasBuildEvidence(pack: BuildEvidencePack | undefined): boolean {
  return buildEvidenceEntries(pack).length > 0
}

export function buildEvidenceContextPacket(pack: BuildEvidencePack | undefined): AgentContextPacket | undefined {
  const entries = buildEvidenceEntries(pack)
  if (entries.length === 0) return undefined
  const normalizedPack = buildEvidencePackFromEntries(entries)
  const structuredPart: AgentContextStructuredPart = {
    type: "structured",
    schema: BUILD_EVIDENCE_CONTEXT_PACKET_SCHEMA,
    label: "build_evidence_pack",
    summary: buildEvidenceSummary(entries),
    data: normalizedPack,
  }
  return {
    id: "build-evidence-context",
    title: "Build Evidence Context",
    scope: "task",
    parts: [
      structuredPart,
      ...entries.map((entry): AgentContextMediaRefPart => {
      return {
        type: "media_ref",
        url: entry.url,
        mime: entry.mime,
        ...(entry.filename ? { filename: entry.filename } : {}),
        ...(entry.label ? { label: entry.label } : {}),
        ...(entry.sha ? { sha: entry.sha } : {}),
        ...(typeof entry.size === "number" ? { size: entry.size } : {}),
        ...(entry.scope ? { scope: entry.scope } : {}),
      }
    }),
    ],
  }
}

export function buildEvidencePackFromContextPackets(
  packets: readonly AgentContextPacket[] | undefined,
): BuildEvidencePack | undefined {
  validateAgentContextPackets(packets ?? [])
  const pack: BuildEvidencePack = {}
  for (const packet of packets ?? []) {
    for (const part of packet.parts) {
      if (part.type !== "structured" || part.schema !== BUILD_EVIDENCE_CONTEXT_PACKET_SCHEMA) continue
      mergeBuildEvidencePack(pack, parseBuildEvidencePackData(part.data))
    }
  }
  return hasBuildEvidence(pack) ? pack : undefined
}

function appendEvidenceFile(pack: BuildEvidencePack, role: BuildEvidenceRole, file: BuildEvidenceFile) {
  switch (role) {
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

function buildEvidencePackFromEntries(entries: readonly BuildEvidenceEntry[]): BuildEvidencePack {
  const pack: BuildEvidencePack = {}
  for (const entry of entries) {
    const { role, ...file } = entry
    appendEvidenceFile(pack, role, file)
  }
  return pack
}

function mergeBuildEvidencePack(target: BuildEvidencePack, source: BuildEvidencePack): void {
  for (const entry of buildEvidenceEntries(source)) {
    const { role, ...file } = entry
    appendEvidenceFile(target, role, file)
  }
}

const BUILD_EVIDENCE_PACK_FIELDS = [
  { field: "targetReferences", role: "target_reference" },
  { field: "previousOutputs", role: "previous_output" },
  { field: "comparisonArtifacts", role: "comparison_artifact" },
  { field: "visualQaAnnotations", role: "visual_qa_annotation" },
  { field: "visualQaDiagnostics", role: "visual_qa_diagnostic" },
] as const

function parseBuildEvidencePackData(data: unknown): BuildEvidencePack {
  const record = objectRecord(data, BUILD_EVIDENCE_CONTEXT_PACKET_SCHEMA)
  const allowedFields = new Set<string>(BUILD_EVIDENCE_PACK_FIELDS.map((entry) => entry.field))
  for (const field of Object.keys(record)) {
    if (!allowedFields.has(field)) {
      throw new Error(`${BUILD_EVIDENCE_CONTEXT_PACKET_SCHEMA} contains unsupported field ${field}`)
    }
  }
  const pack: BuildEvidencePack = {}
  for (const { field, role } of BUILD_EVIDENCE_PACK_FIELDS) {
    const value = record[field]
    if (value === undefined) continue
    if (!Array.isArray(value)) {
      throw new Error(`${BUILD_EVIDENCE_CONTEXT_PACKET_SCHEMA}.${field} must be an array`)
    }
    value.forEach((item, index) => appendEvidenceFile(pack, role, parseEvidenceFile(item, role, `${field}[${index}]`)))
  }
  return pack
}

function parseEvidenceFile(data: unknown, role: BuildEvidenceRole, path: string): BuildEvidenceFile {
  const record = objectRecord(data, `${BUILD_EVIDENCE_CONTEXT_PACKET_SCHEMA}.${path}`)
  assertObjectFields(record, ["url", "mime", "sha", "filename", "intent", "source", "label", "size", "scope"], path)
  const file: BuildEvidenceFile = {
    url: requiredString(record.url, `${path}.url`),
    mime: requiredString(record.mime, `${path}.mime`),
  }
  for (const key of ["sha", "filename", "intent", "source", "label"] as const) {
    const value = optionalString(record[key], `${path}.${key}`)
    if (value !== undefined) file[key] = value
  }
  if (record.size !== undefined) {
    if (typeof record.size !== "number" || !Number.isFinite(record.size) || record.size < 0) {
      throw new Error(`${BUILD_EVIDENCE_CONTEXT_PACKET_SCHEMA}.${path}.size must be a non-negative finite number`)
    }
    file.size = record.size
  }
  if (record.scope !== undefined) {
    file.scope = parseEvidenceScope(record.scope, `${path}.scope`)
  }
  return assertEvidenceFile(file, role)
}

function parseEvidenceScope(data: unknown, path: string): BuildEvidenceFile["scope"] {
  const record = objectRecord(data, `${BUILD_EVIDENCE_CONTEXT_PACKET_SCHEMA}.${path}`)
  assertObjectFields(record, ["kind", "taskID", "goalID", "goalRunID"], path)
  const kind = requiredString(record.kind, `${path}.kind`)
  if (kind !== "task" && kind !== "goal" && kind !== "goal_run") {
    throw new Error(`${BUILD_EVIDENCE_CONTEXT_PACKET_SCHEMA}.${path}.kind must be task, goal, or goal_run`)
  }
  return {
    kind,
    ...(optionalString(record.taskID, `${path}.taskID`) ? { taskID: optionalString(record.taskID, `${path}.taskID`) } : {}),
    ...(optionalString(record.goalID, `${path}.goalID`) ? { goalID: optionalString(record.goalID, `${path}.goalID`) } : {}),
    ...(optionalString(record.goalRunID, `${path}.goalRunID`) ? { goalRunID: optionalString(record.goalRunID, `${path}.goalRunID`) } : {}),
  }
}

function assertObjectFields(record: Record<string, unknown>, allowedFields: readonly string[], path: string): void {
  const allowed = new Set(allowedFields)
  const unsupported = Object.keys(record).filter((key) => !allowed.has(key))
  if (unsupported.length > 0) {
    throw new Error(`${BUILD_EVIDENCE_CONTEXT_PACKET_SCHEMA}.${path} contains unsupported field ${unsupported[0]}`)
  }
}

function objectRecord(data: unknown, path: string): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${path} must be an object`)
  }
  return data as Record<string, unknown>
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${BUILD_EVIDENCE_CONTEXT_PACKET_SCHEMA}.${path} requires a non-empty string`)
  }
  return value
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${BUILD_EVIDENCE_CONTEXT_PACKET_SCHEMA}.${path} must be a non-empty string when present`)
  }
  return value
}

function buildEvidenceSummary(entries: readonly BuildEvidenceEntry[]): string {
  const counts = new Map<BuildEvidenceRole, number>()
  for (const entry of entries) counts.set(entry.role, (counts.get(entry.role) ?? 0) + 1)
  return [...BUILD_EVIDENCE_ROLE_SET]
    .map((role) => {
      const count = counts.get(role) ?? 0
      return count > 0 ? `${role}=${count}` : ""
    })
    .filter(Boolean)
    .join("; ")
}

function evidenceDisplayName(file: BuildEvidenceFile, index: number): string {
  return file.filename ?? file.label ?? file.sha?.slice(0, 12) ?? `evidence-${index + 1}`
}

function scopeLabel(file: BuildEvidenceFile): string | undefined {
  const scope = file.scope
  if (!scope) return undefined
  const ids = [
    scope.taskID ? `task=${scope.taskID}` : "",
    scope.goalID ? `goal=${scope.goalID}` : "",
    scope.goalRunID ? `goal_run=${scope.goalRunID}` : "",
  ]
    .filter(Boolean)
    .join(", ")
  return ids.length > 0 ? `${scope.kind} (${ids})` : scope.kind
}

function evidenceLine(file: BuildEvidenceFile, index: number): string {
  const details = [
    file.mime,
    typeof file.size === "number" ? `${file.size} bytes` : "",
    file.sha ? `sha=${file.sha}` : "",
    file.source ? `source=${file.source}` : "",
    file.intent ? `intent=${file.intent}` : "",
    scopeLabel(file) ? `scope=${scopeLabel(file)}` : "",
  ].filter(Boolean)
  return `- ${evidenceDisplayName(file, index)} (${details.join("; ")}) url: ${file.url}`
}

function roleSection(title: string, intro: string, files: readonly BuildEvidenceFile[] | undefined): string[] {
  if (!files?.length) return []
  return ["", `### ${title}`, intro, "", ...files.map(evidenceLine)]
}

export function renderBuildEvidenceRoleSections(pack: BuildEvidencePack | undefined): string {
  if (!hasBuildEvidence(pack)) return ""
  const lines: string[] = [
    "",
    "",
    "## Build Evidence Pack",
    "Evidence is grouped by role. Only Target Visual References are the visual target contract.",
    ...roleSection(
      "Target Visual References",
      "Authoritative target assets for this dispatch. These are the only files listed in the Visual Reference Contract.",
      pack?.targetReferences,
    ),
    ...roleSection(
      "Previous Build Output Evidence",
      "Rendered output from an earlier attempt. Use it to diagnose deltas and regressions; do not clone it as the target reference.",
      pack?.previousOutputs,
    ),
    ...roleSection(
      "Comparison And Verification Artifacts",
      "Diagnostic artifacts for investigation and verification. They are not target references. Consume visual feedback comparison artifacts for repair and list their urls in consumed_visual_feedback_comparison_refs before reporting status='passed'.",
      pack?.comparisonArtifacts,
    ),
    ...roleSection(
      "Visual QA Annotated Problem Screenshots",
      "Host-generated annotations from failed Visual Quality Assurance (QA) Document Object Model (DOM) regions. Consume these exact diagnostic images for repair and list their urls in consumed_visual_qa_annotation_refs before reporting status='passed'. They are not target references.",
      pack?.visualQaAnnotations,
    ),
    ...roleSection(
      "Visual QA Diagnostic Artifacts",
      "Host-forwarded diagnostic artifacts from failed Visual Quality Assurance (QA), such as layout-geometry manifests. Consume these exact files for repair and list their urls in consumed_visual_qa_diagnostic_refs before reporting status='passed'. They are not target references and are not formal reference-comparison proof.",
      pack?.visualQaDiagnostics,
    ),
  ]
  return lines.join("\n")
}
