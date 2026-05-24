import type { IntegrityResult } from "./team-agent"

export function renderIntegrityMarkdown(input: {
  verdict: IntegrityResult
  sessionID: string
}): string {
  const { verdict, sessionID } = input
  const lines: string[] = []
  lines.push(`### Integrity team review (verdict=${verdict.verdict}; session ${sessionID})`)
  if (verdict.summary) lines.push(`Summary: ${verdict.summary}`)
  lines.push("", verdict.teamReportMarkdown.trim())

  lines.push("", "## Reviewers")
  for (const reviewer of verdict.reviewers) {
    lines.push(`- ${reviewer.reviewerID} (${reviewer.verdict}): ${reviewer.summary}`)
  }

  if (verdict.findings.length > 0) {
    lines.push("", "## Findings")
    for (const finding of verdict.findings) {
      const targets = finding.targetIDs.length > 0 ? ` targets=[${finding.targetIDs.join(", ")}]` : ""
      const files = finding.filePaths.length > 0 ? ` files=[${finding.filePaths.join(", ")}]` : ""
      const quotes =
        finding.userRequestQuotes && finding.userRequestQuotes.length > 0
          ? ` quotes=[${finding.userRequestQuotes.join(" | ")}]`
          : ""
      lines.push(`- [${finding.severity}/${finding.consensus}] ${finding.id}: ${finding.title}${targets}${files}${quotes}`)
      if (finding.fingerprint) lines.push(`  fingerprint: ${finding.fingerprint}`)
      if (finding.canonicalSymptom) lines.push(`  canonical symptom: ${finding.canonicalSymptom}`)
      lines.push(`  ${finding.description}`)
      lines.push(`  repair: ${finding.repair}`)
      for (const verify of finding.verify ?? []) lines.push(`  verify: ${verify}`)
      for (const evidence of finding.evidence) lines.push(`  evidence: ${evidence}`)
    }
  }

  if (verdict.requiredRepairs.length > 0) {
    lines.push("", "## Required Repairs")
    for (const repair of verdict.requiredRepairs) {
      const targets = repair.targetIDs.length > 0 ? ` targets=[${repair.targetIDs.join(", ")}]` : ""
      const files = repair.filePaths.length > 0 ? ` files=[${repair.filePaths.join(", ")}]` : ""
      lines.push(`- ${repair.id}:${targets}${files} ${repair.description}`)
      if (repair.fingerprint) lines.push(`  fingerprint: ${repair.fingerprint}`)
      if (repair.canonicalSymptom) lines.push(`  canonical symptom: ${repair.canonicalSymptom}`)
      for (const verify of repair.verify ?? []) lines.push(`  verify: ${verify}`)
      for (const evidence of repair.evidence) lines.push(`  evidence: ${evidence}`)
    }
  }

  if (verdict.unresolvedDisagreements.length > 0) {
    lines.push("", "## Unresolved Disagreements")
    for (const disagreement of verdict.unresolvedDisagreements) {
      lines.push(`- ${disagreement.id}: ${disagreement.description}`)
      lines.push(`  reviewers: ${disagreement.reviewerIDs.join(", ")}`)
      lines.push(`  consequence: ${disagreement.consequence}`)
    }
  }

  return lines.join("\n")
}
