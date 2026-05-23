import type { IntegrityPriorAttemptSummary } from "./replay-context"
import type { SpecSnapshotLineage } from "./replay-lineage"

export type SharedPromptBudget = {
  totalTokenCap: 12000
  totalCharCap: 48000
  maxRenderedPriorAttempts: 8
  latestAttemptFullTextCharCap: 16000
  persistentRootsCharCap: 12000
  changedEvidenceCharCap: 10000
  oldAttemptSummaryCharCap: 800
  findingDescriptionCharCap: 2400
  findingRepairCharCap: 1600
}

export type SharedPromptSurface =
  | "integrity_replay"
  | "build_integrity_feedback"
  | "orchestrator_integrity_history"
  | "severity_context"

export type SharedPromptCapInput = {
  surface: SharedPromptSurface
  lineage: SpecSnapshotLineage
  latestAttempt?: IntegrityPriorAttemptSummary
  persistentRoots?: Array<{
    rootID: string
    canonicalLabel: string
    firstSeenAttempt: number
    latestSeenAttempt: number
    consecutiveAttempts: number[]
    latestSeverity: "blocking" | "advisory"
    symptomSummaryMarkdown: string
  }>
  changedFiles: string[]
  changedEvidenceMarkdown?: string
  oldAttempts: IntegrityPriorAttemptSummary[]
  reviewerTextBlocks?: string[]
  userRequestQuotes?: string[]
  runtimeMarkdownDir?: string
}

export type SanitizedPromptTextReport = {
  text: string
  truncated: boolean
  originalChars: number
  renderedChars: number
  removedAnsiEscapes: number
  removedControls: number
  removedBidirectionalControls: number
  escapedMarkdownControls: number
}

export type SharedPromptCapOutput = {
  promptMarkdown: string
  capHit: boolean
  omittedAttempts: Array<{
    attemptNumber: number
    artifactID: string
    verdict?: string
    summary: string
  }>
  runtimeMarkdownPath?: string
  sanitizerReport: SanitizedPromptTextReport
}

const SHARED_INTEGRITY_PROMPT_BUDGET: SharedPromptBudget = {
  totalTokenCap: 12000,
  totalCharCap: 48000,
  maxRenderedPriorAttempts: 8,
  latestAttemptFullTextCharCap: 16000,
  persistentRootsCharCap: 12000,
  changedEvidenceCharCap: 10000,
  oldAttemptSummaryCharCap: 800,
  findingDescriptionCharCap: 2400,
  findingRepairCharCap: 1600,
}

export function getSharedIntegrityPromptBudget(): SharedPromptBudget {
  return SHARED_INTEGRITY_PROMPT_BUDGET
}

export function renderSharedIntegrityPromptContext(input: SharedPromptCapInput): SharedPromptCapOutput {
  const budget = getSharedIntegrityPromptBudget()
  const omittedAttempts: SharedPromptCapOutput["omittedAttempts"] = []
  const chunks: string[] = []
  let renderedChars = 0
  let capHit = false

  const append = (markdown: string) => {
    if (!markdown) return
    const remaining = budget.totalCharCap - renderedChars
    if (remaining <= 0) {
      capHit = true
      return
    }
    if (markdown.length <= remaining) {
      chunks.push(markdown)
      renderedChars += markdown.length
      return
    }
    capHit = true
    const marker = "\n[omitted_due_to_shared_prompt_cap]\n"
    chunks.push(markdown.slice(0, Math.max(0, remaining - marker.length)) + marker)
    renderedChars = budget.totalCharCap
  }

  append(renderSharedPromptHeader(input))
  if (input.latestAttempt) {
    append(clipText(renderFullAttemptMarkdown(input.latestAttempt, budget), budget.latestAttemptFullTextCharCap))
  } else {
    append(
      "No prior integrity attempts exist for this task/spec snapshot lineage. Treat this as a first review and choose reviewers from the actual request, goals, requirements, changed files, runtime evidence, and risk surface.",
    )
  }

  if (input.persistentRoots?.length) {
    append(clipText(renderPersistentRootsMarkdown(input.persistentRoots), budget.persistentRootsCharCap))
  }

  append(renderChangedEvidenceMarkdown(input, budget))

  for (const quote of input.userRequestQuotes ?? []) {
    append(`## User Request Quote\n\n${quote}`)
  }
  for (const block of input.reviewerTextBlocks ?? []) {
    append(`## Reviewer Text\n\n${block}`)
  }

  const maxOldAttemptSummaries = Math.max(0, budget.maxRenderedPriorAttempts - (input.latestAttempt ? 1 : 0))
  input.oldAttempts.forEach((attempt, index) => {
    if (index >= maxOldAttemptSummaries) {
      const summary = "omitted_due_to_shared_prompt_cap"
      omittedAttempts.push({
        attemptNumber: attempt.attemptNumber,
        artifactID: attempt.artifactID,
        verdict: attempt.verdict,
        summary,
      })
      append(renderOldAttemptPointer(attempt, summary))
      return
    }

    const summary = clipText(attempt.summary ?? attempt.teamReportMarkdown ?? "(no summary)", budget.oldAttemptSummaryCharCap)
    const before = renderedChars
    append(renderOldAttemptPointer(attempt, summary))
    if (renderedChars === before || renderedChars >= budget.totalCharCap) {
      omittedAttempts.push({
        attemptNumber: attempt.attemptNumber,
        artifactID: attempt.artifactID,
        verdict: attempt.verdict,
        summary: "omitted_due_to_shared_prompt_cap",
      })
    }
  })

  const promptMarkdown = chunks.join("\n\n")
  return {
    promptMarkdown,
    capHit,
    omittedAttempts,
    sanitizerReport: passthroughSanitizerReport(promptMarkdown),
  }
}

function renderSharedPromptHeader(input: SharedPromptCapInput): string {
  return [
    `## Shared Prompt Context (${input.surface})`,
    "",
    `- active_spec_snapshot=${input.lineage.activeSpecSnapshotID}`,
    `- inherited_spec_snapshots=${
      input.lineage.inheritedSpecSnapshotIDs.length > 0 ? input.lineage.inheritedSpecSnapshotIDs.join(", ") : "(none)"
    }`,
    `- lineage_reason=${input.lineage.reason}`,
  ].join("\n")
}

function renderFullAttemptMarkdown(attempt: IntegrityPriorAttemptSummary, budget: SharedPromptBudget): string {
  const lines = [
    "## Latest Prior Integrity Attempt",
    "",
    `- attempt=${attempt.attemptNumber}`,
    `- artifact=${attempt.artifactID}`,
    `- time=${new Date(attempt.timeCreated).toISOString()}`,
    `- phase=${attempt.phase ?? "unknown"}`,
    `- verdict=${attempt.verdict ?? "unknown"}`,
  ]
  if (attempt.summary) lines.push("", "Summary:", attempt.summary)
  if (attempt.teamReportMarkdown) lines.push("", "Team report:", attempt.teamReportMarkdown)
  if (attempt.reviewers.length > 0) {
    lines.push("", "Reviewer focuses:")
    for (const reviewer of attempt.reviewers) {
      lines.push(`- ${reviewer.reviewerID}: ${reviewer.scope}${reviewer.verdict ? ` (${reviewer.verdict})` : ""}`)
    }
  }
  if (attempt.blockingFindings.length > 0) {
    lines.push("", "Blocking findings:")
    for (const finding of attempt.blockingFindings) {
      lines.push(`- ${finding.id}: ${finding.title}`)
      if (finding.description) {
        lines.push(`  description: ${clipText(finding.description, budget.findingDescriptionCharCap)}`)
      }
      if (finding.repair) lines.push(`  repair: ${clipText(finding.repair, budget.findingRepairCharCap)}`)
      if (finding.filePaths.length > 0) lines.push(`  files: ${finding.filePaths.join(", ")}`)
      if (finding.requirementIDs.length > 0) lines.push(`  requirements: ${finding.requirementIDs.join(", ")}`)
      if (finding.specIDs.length > 0) lines.push(`  specs: ${finding.specIDs.join(", ")}`)
    }
  }
  if (attempt.requiredRepairs.length > 0) {
    lines.push("", "Required repairs:")
    for (const repair of attempt.requiredRepairs) {
      lines.push(`- ${repair.id}: ${clipText(repair.description, budget.findingRepairCharCap)}`)
      if (repair.filePaths.length > 0) lines.push(`  files: ${repair.filePaths.join(", ")}`)
    }
  }
  if (attempt.unresolvedDisagreements.length > 0) {
    lines.push("", "Unresolved disagreements:")
    for (const disagreement of attempt.unresolvedDisagreements) {
      lines.push(`- ${disagreement.id}: ${clipText(disagreement.description, budget.findingDescriptionCharCap)}`)
    }
  }
  return lines.join("\n")
}

function renderPersistentRootsMarkdown(roots: NonNullable<SharedPromptCapInput["persistentRoots"]>): string {
  const sorted = roots
    .slice()
    .sort(
      (left, right) =>
        right.consecutiveAttempts.length - left.consecutiveAttempts.length ||
        right.latestSeenAttempt - left.latestSeenAttempt,
    )
  return [
    "## Persistent Roots",
    "",
    ...sorted.map((root) =>
      [
        `- ${root.rootID}: ${root.canonicalLabel}`,
        `  latest_severity=${root.latestSeverity}; first_seen=${root.firstSeenAttempt}; latest_seen=${root.latestSeenAttempt}; consecutive_attempts=${root.consecutiveAttempts.join(",")}`,
        `  symptom=${root.symptomSummaryMarkdown}`,
      ].join("\n"),
    ),
  ].join("\n")
}

function renderChangedEvidenceMarkdown(input: SharedPromptCapInput, budget: SharedPromptBudget): string {
  const lines = ["## Changed Files And Evidence", "", `- changed_files=${input.changedFiles.length}`]
  for (const file of input.changedFiles) lines.push(`- ${file}`)
  if (input.changedEvidenceMarkdown) {
    lines.push("", clipText(input.changedEvidenceMarkdown, budget.changedEvidenceCharCap))
  }
  return lines.join("\n")
}

function renderOldAttemptPointer(attempt: IntegrityPriorAttemptSummary, summary: string): string {
  return [
    "## Older Integrity Attempt Pointer",
    "",
    `- attempt=${attempt.attemptNumber}`,
    `- artifact=${attempt.artifactID}`,
    `- time=${new Date(attempt.timeCreated).toISOString()}`,
    `- phase=${attempt.phase ?? "unknown"}`,
    `- verdict=${attempt.verdict ?? "unknown"}`,
    `- summary=${summary}`,
  ].join("\n")
}

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 39))}\n[truncated_by_shared_prompt_cap]`
}

function passthroughSanitizerReport(text: string): SanitizedPromptTextReport {
  return {
    text,
    truncated: false,
    originalChars: text.length,
    renderedChars: text.length,
    removedAnsiEscapes: 0,
    removedControls: 0,
    removedBidirectionalControls: 0,
    escapedMarkdownControls: 0,
  }
}
