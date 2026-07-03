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
