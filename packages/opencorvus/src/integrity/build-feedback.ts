import fs from "node:fs"
import path from "node:path"
import { buildIntegrityRootHistory, type IntegrityRootSymptomVariation } from "./root-history"
import type { SpecSnapshotLineage } from "./replay-lineage"
import { sanitizeIntegrityPromptText, type SharedPromptBudget } from "./shared-prompt"

export type BuildIntegrityFeedback = {
  promptMarkdown: string
  runtimeMarkdownPath?: string
}

export function composeIntegrityFeedbackForBuild(input: {
  taskID: string
  specSnapshotLineage: SpecSnapshotLineage
  promptBudget: SharedPromptBudget
  runtimeMarkdownDir?: string
}): BuildIntegrityFeedback | undefined {
  const history = buildIntegrityRootHistory({
    taskID: input.taskID,
    specSnapshotLineage: input.specSnapshotLineage,
    phase: "post_build",
  })
  const latestAttempt = history.attempts.at(-1)
  if (!latestAttempt || latestAttempt.verdict === "pass") return undefined
  if (
    history.latestBlockingFindings.length === 0 &&
    history.latestAdvisoryFindings.length === 0 &&
    history.persistentBlockingRoots.length === 0
  ) {
    return undefined
  }

  const introSection = [
    "## Persistent Integrity Findings (Treat Blocking Items As Must-Fix)",
    "",
    `Integrity has reviewed this task ${history.totalAttempts} time(s) for the current spec snapshot lineage.`,
    `Lineage: active=${input.specSnapshotLineage.activeSpecSnapshotID}; inherited=${
      input.specSnapshotLineage.inheritedSpecSnapshotIDs.length > 0
        ? input.specSnapshotLineage.inheritedSpecSnapshotIDs.join(", ")
        : "(none)"
    }; reason=${input.specSnapshotLineage.reason}.`,
    `The latest post-build verdict is \`${latestAttempt.verdict ?? "unknown"}\` (R${latestAttempt.attemptNumber} at ${new Date(latestAttempt.timeCreated).toISOString()}).`,
    "Integrity reports are repair evidence, not a completion gate; repair every blocking finding below and let the orchestrator explicitly decide the next workflow action.",
    "Your terminal `report_build_result` must include `repair_report`: every blocking fingerprint must appear exactly once in either `repaired_findings[]` or `unrepaired_findings[]` with changed files and verification evidence.",
  ].join("\n")
  const rootSection = renderPersistentRootsSection(history.persistentBlockingRoots, input.promptBudget)
  const blockingSection = renderFindingSection({
    heading: "### All blocking findings from the latest review",
    emptyText: "No blocking findings were present in the latest review.",
    findings: history.latestBlockingFindings,
    promptBudget: input.promptBudget,
    includeMustFixLanguage: true,
  })
  const advisorySection = renderFindingSection({
    heading: "### Advisory findings from the latest review",
    emptyText: "No advisory findings were present in the latest review.",
    findings: history.latestAdvisoryFindings,
    promptBudget: input.promptBudget,
    includeMustFixLanguage: false,
  })
  const sourceSection = renderSourceSection(latestAttempt.artifactID)
  const reportContractSection = renderBuildRepairReportContract(history.latestBlockingFindings)
  const directPrompt = [
    introSection,
    rootSection,
    blockingSection,
    advisorySection,
    reportContractSection,
    sourceSection,
  ]
    .filter((section) => section.trim().length > 0)
    .join("\n\n")

  if (directPrompt.length <= input.promptBudget.totalCharCap) {
    return { promptMarkdown: directPrompt }
  }
  if (!input.runtimeMarkdownDir) {
    throw new Error(
      `Cannot dispatch build for task ${input.taskID}: integrity feedback exceeds shared prompt cap and no runtimeMarkdownDir was provided.`,
    )
  }

  const runtimeMarkdownPath = materializeRuntimeMarkdown({
    dir: input.runtimeMarkdownDir,
    attemptNumber: latestAttempt.attemptNumber,
    artifactID: latestAttempt.artifactID,
    content: directPrompt,
  })
  const materializedPrompt = [
    introSection,
    rootSection,
    "### All blocking findings from the latest review",
    "",
    "Complete bounded blocking feedback was materialized to a build-readable runtime markdown file because the shared prompt cap was reached.",
    `- runtime markdown: ${runtimeMarkdownPath}`,
    "",
    "Build must read that file before editing. Artifact ids are audit metadata only and are not a retrieval path for build.",
    reportContractSection,
    sourceSection,
  ]
    .filter((section) => section.trim().length > 0)
    .join("\n\n")

  return { promptMarkdown: materializedPrompt, runtimeMarkdownPath }
}

function renderPersistentRootsSection(
  roots: ReturnType<typeof buildIntegrityRootHistory>["persistentBlockingRoots"],
  promptBudget: SharedPromptBudget,
): string {
  if (roots.length === 0) return ""
  const lines = ["### Persistent blocking roots (from shared root history)", ""]
  for (const root of roots) {
    lines.push(`- **${sanitizeInline(root.rootID)}** (${sanitizeInline(root.canonicalLabel)}):`)
    lines.push(`  first seen R${root.firstSeenAttempt}; still reported in R${root.latestSeenAttempt}.`)
    lines.push(`  consecutive attempts: ${root.consecutiveAttempts.map((attempt) => `R${attempt}`).join(", ")}.`)
    if (root.reviewerIDs.length > 0) lines.push(`  reviewer ids: ${root.reviewerIDs.map(sanitizeInline).join(", ")}.`)
    lines.push("  symptom variations:")
    for (const variation of root.symptomVariations) {
      lines.push(
        `  - R${variation.attemptNumber} ${sanitizeInline(variation.findingID)}: ${sanitizeInline(variation.title)}`,
      )
    }
  }
  return clip(lines.join("\n"), promptBudget.persistentRootsCharCap)
}

function renderFindingSection(input: {
  heading: string
  emptyText: string
  findings: IntegrityRootSymptomVariation[]
  promptBudget: SharedPromptBudget
  includeMustFixLanguage: boolean
}): string {
  const lines = [input.heading, ""]
  if (input.findings.length === 0) {
    lines.push(input.emptyText)
    return lines.join("\n")
  }
  if (input.includeMustFixLanguage) {
    lines.push("Every blocking finding from the latest non-pass review is listed below; none may be skipped.")
    lines.push("")
  } else {
    lines.push(
      "Advisory findings rank below blockers. Fix them only when they do not pull scope away from blocking repairs.",
    )
    lines.push("")
  }
  for (const finding of input.findings) {
    lines.push(
      `- **${sanitizeInline(finding.findingID)}** (root: ${sanitizeInline(finding.rootID)}, R${finding.attemptNumber})`,
    )
    lines.push(`  fingerprint: ${sanitizeInline(finding.fingerprint)}`)
    lines.push(
      `  canonical symptom: ${sanitizeBlock(finding.canonicalSymptom, "generic", input.promptBudget.findingDescriptionCharCap)}`,
    )
    lines.push(`  title: ${sanitizeBlock(finding.title, "generic")}`)
    if (finding.description) {
      lines.push(
        `  description: ${sanitizeBlock(finding.description, "finding_description", input.promptBudget.findingDescriptionCharCap)}`,
      )
    }
    if (finding.evidence.length > 0) {
      lines.push("  evidence:")
      for (const evidence of finding.evidence) {
        lines.push(`  - ${sanitizeBlock(evidence, "generic", input.promptBudget.findingDescriptionCharCap)}`)
      }
    }
    if (finding.repair) {
      lines.push(
        `  required repair: ${sanitizeBlock(finding.repair, "finding_repair", input.promptBudget.findingRepairCharCap)}`,
      )
    }
    if (finding.verify.length > 0) {
      lines.push("  verify:")
      for (const verify of finding.verify) {
        lines.push(`  - ${sanitizeBlock(verify, "generic", input.promptBudget.findingDescriptionCharCap)}`)
      }
    }
    if (finding.filePaths.length > 0) lines.push(`  file paths: ${finding.filePaths.map(sanitizeInline).join(", ")}`)
    if (finding.requirementIDs.length > 0) {
      lines.push(`  requirement ids: ${finding.requirementIDs.map(sanitizeInline).join(", ")}`)
    }
    if (finding.specIDs.length > 0) lines.push(`  spec ids: ${finding.specIDs.map(sanitizeInline).join(", ")}`)
    if (finding.reviewerIDs.length > 0)
      lines.push(`  reviewer ids: ${finding.reviewerIDs.map(sanitizeInline).join(", ")}`)
  }
  return lines.join("\n")
}

function renderBuildRepairReportContract(findings: IntegrityRootSymptomVariation[]): string {
  if (findings.length === 0) return ""
  const lines = [
    "### Build repair report contract",
    "",
    "When you finish, `report_build_result` must include:",
    "- `repair_report.repaired_findings[]` for each fingerprint you fixed, with `finding_id`, `fingerprint`, `changed_files[]`, and `verification_commands[]`.",
    "- `repair_report.unrepaired_findings[]` for each fingerprint still not fixed, with a concrete `reason`.",
    '- `status="passed"` is only valid when every blocking fingerprint below is in `repaired_findings[]` and verification passed.',
    "",
    "Blocking fingerprints:",
  ]
  for (const finding of findings) {
    lines.push(
      `- ${sanitizeInline(finding.fingerprint)} (${sanitizeInline(finding.findingID)}): ${sanitizeInline(finding.canonicalLabel)}`,
    )
  }
  return lines.join("\n")
}

function renderSourceSection(artifactID: string): string {
  return [
    "### Source and full-text access",
    "",
    `Full audit metadata lives in engine_artifact \`${sanitizeInline(artifactID)}\`, but artifact ids are audit metadata only.`,
    "The build agent must rely on the prompt text above or the runtime markdown path when one is rendered.",
  ].join("\n")
}

function materializeRuntimeMarkdown(input: {
  dir: string
  attemptNumber: number
  artifactID: string
  content: string
}): string {
  fs.mkdirSync(input.dir, { recursive: true })
  const filePath = path.join(input.dir, `R${input.attemptNumber}-${safeFileSegment(input.artifactID)}.md`)
  fs.writeFileSync(filePath, input.content, "utf8")
  return filePath
}

function sanitizeInline(text: string): string {
  return sanitizeIntegrityPromptText({
    text,
    field: "generic",
    markdownContext: "inline",
  }).text.replace(/\s+/g, " ")
}

function sanitizeBlock(
  text: string,
  field: Parameters<typeof sanitizeIntegrityPromptText>[0]["field"],
  maxChars?: number,
): string {
  return sanitizeIntegrityPromptText({
    text,
    field,
    maxChars,
    markdownContext: "block",
  }).text
}

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const marker = "\n[truncated_by_shared_prompt_cap]"
  return `${text.slice(0, Math.max(0, maxChars - marker.length))}${marker}`
}

function safeFileSegment(input: string): string {
  const value = input.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return value.length > 0 ? value.slice(0, 80) : "integrity"
}
