/**
 * Render a complete integrity review as markdown text. Every issue, every
 * correction proposal (with action / goalID / reason / updates fields), every
 * missing-goal proposal (with title / objective / acceptance hints / owned
 * paths), and every per-dimension verdict is included verbatim.
 *
 * No truncation, no count-only summarisation. The orchestrator LLM is the
 * single decision maker for follow-up actions and needs the same evidence the
 * integrity LLM produced. Compact rendering (one fact per line) keeps the
 * payload prompt-friendly.
 *
 * Lives in `src/integrity/` as a pure function so tests and the orchestrator's
 * runIntegrityReviewOnce() can both depend on it without dragging the full
 * orchestrator/tools.ts import graph into a unit-test process.
 */
import type { IntegrityResult } from "./agent"

export function renderIntegrityMarkdown(input: {
  verdict: IntegrityResult
  sessionID: string
}): string {
  const { verdict, sessionID } = input
  const lines: string[] = []
  lines.push(`### Architecture review (verdict=${verdict.verdict}; session ${sessionID})`)
  if (verdict.summary) lines.push(`Summary: ${verdict.summary}`)
  for (const dim of verdict.dimensions) {
    const issues = dim.issues ?? []
    const corrections = dim.corrections ?? []
    const graphCorrections = dim.graphCorrections ?? []
    const missingGoals = dim.missingGoals ?? []
    lines.push("")
    lines.push(`**${dim.id} = ${dim.verdict}**`)
    if (issues.length === 0 && corrections.length === 0 && graphCorrections.length === 0 && missingGoals.length === 0) {
      lines.push("- (no findings)")
      continue
    }
    if (issues.length > 0) {
      lines.push("- issues:")
      for (const i of issues) {
        const goalRef = i.goalIDs && i.goalIDs.length > 0 ? ` goal_ids=[${i.goalIDs.join(", ")}]` : ""
        const reqRef = i.requirementIDs && i.requirementIDs.length > 0
          ? ` requirement_ids=[${i.requirementIDs.join(", ")}]`
          : ""
        const specRef = i.specIDs && i.specIDs.length > 0
          ? ` spec_ids=[${i.specIDs.join(", ")}]`
          : ""
        const evidence = i.evidence ? ` _evidence: ${i.evidence}_` : ""
        lines.push(`  - [${i.type}] ${i.description}${reqRef}${specRef}${goalRef}${evidence}`)
      }
    }
    if (corrections.length > 0) {
      lines.push("- corrections (proposed by integrity, NOT yet applied):")
      for (const c of corrections) {
        const updates = c.updates ? ` updates=${JSON.stringify(c.updates)}` : ""
        lines.push(`  - ${c.action} goal=${c.goalID} — ${c.reason}${updates}`)
      }
    }
    if (graphCorrections.length > 0) {
      lines.push("- graph_corrections (proposed by integrity, NOT yet applied):")
      for (const c of graphCorrections) {
        if (c.kind === "contract") {
          const contractID = c.contractID ?? c.contract?.id ?? "(new)"
          lines.push(`  - ${c.action} contract=${contractID} — ${c.reason}`)
        } else if (c.kind === "dependency") {
          const fromGoalID = c.fromGoalID ?? c.dependency?.from_goal_id ?? "(new)"
          const toGoalID = c.toGoalID ?? c.dependency?.to_goal_id ?? "(new)"
          const nextReason = c.newReason ? ` new_reason=${c.newReason}` : ""
          lines.push(`  - ${c.action} dependency=${fromGoalID}->${toGoalID}${nextReason} — ${c.reason}`)
        } else {
          lines.push(`  - attach contract_audit goal=${c.goalID} contracts=[${c.contractIDs.join(", ")}] — ${c.reason}`)
        }
      }
    }
    if (missingGoals.length > 0) {
      lines.push("- missing_goals (proposed by integrity, NOT yet applied):")
      for (const m of missingGoals) {
        const ownedPaths = m.owned_paths ?? []
        const hints = m.acceptance_spec_hints ?? []
        lines.push(
          `  - title="${m.title}" kind=${m.kind} priority=${m.priority} owned_paths=[${ownedPaths.join(", ")}] — ${m.reason}`,
        )
        if (hints.length > 0) {
          for (const h of hints) lines.push(`    * acceptance hint: ${h}`)
        }
      }
    }
  }
  return lines.join("\n")
}
