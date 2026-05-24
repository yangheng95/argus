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

export type SanitizedPromptTextField =
  | "user_request_quote"
  | "finding_description"
  | "finding_repair"
  | "reviewer_text"
  | "changed_evidence"
  | "generic"

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
  const sanitizerReports: SanitizedPromptTextReport[] = []
  const chunks: string[] = []
  let renderedChars = 0
  let capHit = false
  const sanitize: PromptSanitizer = (text, field, markdownContext, maxChars) => {
    const report = sanitizeIntegrityPromptText({ text, field, markdownContext, maxChars })
    sanitizerReports.push(report)
    return report.text
  }

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
    append(
      clipText(
        renderFullAttemptMarkdown(input.latestAttempt, budget, input.surface, sanitize),
        budget.latestAttemptFullTextCharCap,
      ),
    )
  } else {
    append(
      "No prior integrity attempts exist for this task/spec snapshot lineage. Treat this as a first review and choose reviewers from the actual request, goals, requirements, changed files, runtime evidence, and risk surface.",
    )
  }

  if (input.persistentRoots?.length) {
    append(clipText(renderPersistentRootsMarkdown(input.persistentRoots, sanitize), budget.persistentRootsCharCap))
  }

  append(renderChangedEvidenceMarkdown(input, budget, sanitize))

  for (const quote of input.userRequestQuotes ?? []) {
    append(`## User Request Quote\n\n${sanitize(quote, "user_request_quote", "block")}`)
  }
  for (const block of input.reviewerTextBlocks ?? []) {
    append(`## Reviewer Text\n\n${sanitize(block, "reviewer_text", "block")}`)
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

    const summary = clipText(
      sanitize(attempt.summary ?? attempt.teamReportMarkdown ?? "(no summary)", "generic", "block"),
      budget.oldAttemptSummaryCharCap,
    )
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
    sanitizerReport: aggregateSanitizerReports(promptMarkdown, sanitizerReports, capHit),
  }
}

export function sanitizeIntegrityPromptText(input: {
  text: string
  field: SanitizedPromptTextField
  maxChars?: number
  markdownContext: "inline" | "block"
}): SanitizedPromptTextReport {
  const originalChars = input.text.length
  let removedAnsiEscapes = 0
  let removedControls = 0
  let removedBidirectionalControls = 0
  let escapedMarkdownControls = 0

  let text = input.text
  text = text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, () => {
    removedAnsiEscapes += 1
    return ""
  })
  text = text.replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)?/g, () => {
    removedAnsiEscapes += 1
    return ""
  })

  const chars: string[] = []
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code === 0) {
      removedControls += 1
      chars.push("[NUL REMOVED]")
      continue
    }
    if (isBidirectionalControl(code)) {
      removedBidirectionalControls += 1
      chars.push(`[BIDI U+${hexCode(code)} REMOVED]`)
      continue
    }
    if (isDisallowedControl(code)) {
      removedControls += 1
      chars.push(`[CTRL U+${hexCode(code)} REMOVED]`)
      continue
    }
    chars.push(char)
  }
  text = chars.join("")

  if (input.markdownContext === "block") {
    text = text
      .split("\n")
      .map((line) =>
        escapesMarkdownControl(line)
          ? escapeMarkdownControlLine(line, () => {
              escapedMarkdownControls += 1
            })
          : line,
      )
      .join("\n")
  }

  const maxChars = input.maxChars ?? defaultSanitizedPromptTextMaxChars(input.field)
  let truncated = false
  if (text.length > maxChars) {
    truncated = true
    const marker = "\n[truncated_by_integrity_prompt_sanitizer]"
    text = maxChars > marker.length ? `${text.slice(0, maxChars - marker.length)}${marker}` : text.slice(0, maxChars)
  }

  return {
    text,
    truncated,
    originalChars,
    renderedChars: text.length,
    removedAnsiEscapes,
    removedControls,
    removedBidirectionalControls,
    escapedMarkdownControls,
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

type PromptSanitizer = (
  text: string,
  field: SanitizedPromptTextField,
  markdownContext: "inline" | "block",
  maxChars?: number,
) => string

function renderFullAttemptMarkdown(
  attempt: IntegrityPriorAttemptSummary,
  budget: SharedPromptBudget,
  surface: SharedPromptSurface,
  sanitize: PromptSanitizer,
): string {
  const lines = [
    "## Latest Prior Integrity Attempt",
    "",
    `- attempt=${attempt.attemptNumber}`,
    `- artifact=${attempt.artifactID}`,
    `- time=${new Date(attempt.timeCreated).toISOString()}`,
    `- phase=${attempt.phase ?? "unknown"}`,
    `- verdict=${attempt.verdict ?? "unknown"}`,
  ]
  if (attempt.summary) lines.push("", "Summary:", sanitize(attempt.summary, "generic", "block"))
  if (attempt.teamReportMarkdown)
    lines.push("", "Team report:", sanitize(attempt.teamReportMarkdown, "reviewer_text", "block"))
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
      if (finding.fingerprint) lines.push(`  fingerprint: ${finding.fingerprint}`)
      if (finding.canonicalSymptom) lines.push(`  canonical symptom: ${finding.canonicalSymptom}`)
      if (finding.description) {
        lines.push(
          `  description: ${clipText(
            sanitize(finding.description, "finding_description", "block"),
            budget.findingDescriptionCharCap,
          )}`,
        )
      }
      if (finding.repair) {
        lines.push(
          `  repair: ${clipText(sanitize(finding.repair, "finding_repair", "block"), budget.findingRepairCharCap)}`,
        )
      }
      if (finding.verify?.length > 0) lines.push(`  verify: ${finding.verify.join(" | ")}`)
      if (finding.filePaths.length > 0) lines.push(`  files: ${finding.filePaths.join(", ")}`)
      if (finding.requirementIDs.length > 0) lines.push(`  requirements: ${finding.requirementIDs.join(", ")}`)
      if (finding.specIDs.length > 0) lines.push(`  specs: ${finding.specIDs.join(", ")}`)
    }
  }
  if (surface === "severity_context" && attempt.findings?.length) {
    lines.push("", "All prior findings for severity stability:")
    for (const finding of attempt.findings) {
      lines.push(`- [${finding.severity}] ${finding.id}: ${finding.title}`)
      if (finding.fingerprint) lines.push(`  fingerprint: ${finding.fingerprint}`)
      if (finding.canonicalSymptom) lines.push(`  canonical symptom: ${finding.canonicalSymptom}`)
      if (finding.description) {
        lines.push(
          `  description: ${clipText(
            sanitize(finding.description, "finding_description", "block"),
            budget.findingDescriptionCharCap,
          )}`,
        )
      }
      if (finding.repair) {
        lines.push(
          `  repair: ${clipText(sanitize(finding.repair, "finding_repair", "block"), budget.findingRepairCharCap)}`,
        )
      }
      if (finding.verify?.length > 0) lines.push(`  verify: ${finding.verify.join(" | ")}`)
      if (finding.filePaths.length > 0) lines.push(`  files: ${finding.filePaths.join(", ")}`)
      if (finding.requirementIDs.length > 0) lines.push(`  requirements: ${finding.requirementIDs.join(", ")}`)
      if (finding.specIDs.length > 0) lines.push(`  specs: ${finding.specIDs.join(", ")}`)
    }
  }
  if (attempt.requiredRepairs.length > 0) {
    lines.push("", "Required repairs:")
    for (const repair of attempt.requiredRepairs) {
      lines.push(
        `- ${repair.id}: ${clipText(sanitize(repair.description, "finding_repair", "block"), budget.findingRepairCharCap)}`,
      )
      if (repair.fingerprint) lines.push(`  fingerprint: ${repair.fingerprint}`)
      if (repair.canonicalSymptom) lines.push(`  canonical symptom: ${repair.canonicalSymptom}`)
      if (repair.verify?.length > 0) lines.push(`  verify: ${repair.verify.join(" | ")}`)
      if (repair.filePaths.length > 0) lines.push(`  files: ${repair.filePaths.join(", ")}`)
    }
  }
  if (attempt.unresolvedDisagreements.length > 0) {
    lines.push("", "Unresolved disagreements:")
    for (const disagreement of attempt.unresolvedDisagreements) {
      lines.push(
        `- ${disagreement.id}: ${clipText(sanitize(disagreement.description, "generic", "block"), budget.findingDescriptionCharCap)}`,
      )
    }
  }
  return lines.join("\n")
}

function renderPersistentRootsMarkdown(
  roots: NonNullable<SharedPromptCapInput["persistentRoots"]>,
  sanitize: PromptSanitizer,
): string {
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
        `  symptom=${sanitize(root.symptomSummaryMarkdown, "generic", "block")}`,
      ].join("\n"),
    ),
  ].join("\n")
}

function renderChangedEvidenceMarkdown(
  input: SharedPromptCapInput,
  budget: SharedPromptBudget,
  sanitize: PromptSanitizer,
): string {
  const lines = ["## Changed Files And Evidence", "", `- changed_files=${input.changedFiles.length}`]
  for (const file of input.changedFiles) lines.push(`- ${file}`)
  if (input.changedEvidenceMarkdown) {
    lines.push(
      "",
      clipText(sanitize(input.changedEvidenceMarkdown, "changed_evidence", "block"), budget.changedEvidenceCharCap),
    )
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

function aggregateSanitizerReports(
  text: string,
  reports: SanitizedPromptTextReport[],
  capHit: boolean,
): SanitizedPromptTextReport {
  return {
    text,
    truncated: capHit || reports.some((report) => report.truncated),
    originalChars: reports.reduce((sum, report) => sum + report.originalChars, 0),
    renderedChars: text.length,
    removedAnsiEscapes: reports.reduce((sum, report) => sum + report.removedAnsiEscapes, 0),
    removedControls: reports.reduce((sum, report) => sum + report.removedControls, 0),
    removedBidirectionalControls: reports.reduce((sum, report) => sum + report.removedBidirectionalControls, 0),
    escapedMarkdownControls: reports.reduce((sum, report) => sum + report.escapedMarkdownControls, 0),
  }
}

function defaultSanitizedPromptTextMaxChars(field: SanitizedPromptTextField): number {
  switch (field) {
    case "user_request_quote":
      return 2000
    case "finding_description":
      return 2400
    case "finding_repair":
      return 1600
    case "reviewer_text":
      return 3000
    case "changed_evidence":
    case "generic":
      return 12000
  }
}

function isBidirectionalControl(code: number): boolean {
  return (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
}

function isDisallowedControl(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false
  return (code >= 0x0000 && code <= 0x001f) || (code >= 0x007f && code <= 0x009f)
}

function hexCode(code: number): string {
  return code.toString(16).toUpperCase().padStart(4, "0")
}

function escapesMarkdownControl(line: string): boolean {
  return (
    /^\s{0,3}#{1,6}(\s|$)/.test(line) ||
    /^\s{0,3}(```|~~~)/.test(line) ||
    /^\s{0,3}<\/?[A-Za-z][^>]*>/.test(line) ||
    /^\s{0,3}([-*_]\s*){3,}$/.test(line) ||
    /^\s{0,3}(=+|-+)\s*$/.test(line)
  )
}

function escapeMarkdownControlLine(line: string, onEscape: () => void): string {
  onEscape()
  const indent = line.match(/^\s*/)?.[0] ?? ""
  return `${indent}\\${line.slice(indent.length)}`
}
