import { createDecisionLog } from "@/decision-log"
import { DecisionLogBundle } from "@/decision-log/bundle"
import { renderFrontendDesignHandoffReference } from "@/frontend-design/handoff"
import { findActiveSpecForTask, findLatestArchitectContractGraph, findRequirements, listGoals } from "@/engine/store"
import { renderContractGraphForPrompt } from "@/architect/contract-graph"
import { Instance } from "@/project/instance"

const ARCHITECT_CONTRACT_VALUE_CAP = 4_000

function hasContent(section: string): boolean {
  return section.trim().length > 0
}

/**
 * Per-goal context for build/executor sub-agents — narrative phase summaries
 * scoped to one goal. NOT a contract surface; for that, sub-agents read
 * acceptance_specs + the goal contract block off the goal row directly.
 */
export function buildGoalUpstreamAgentContextSections(taskID: string, goalID: string): string[] {
  const decisionLog = createDecisionLog(taskID)
  return [
    decisionLog.phasePromptSectionForGoal("requirements", goalID, "Requirements Decisions"),
    renderFrontendDesignHandoffReference(taskID, { valueCap: 300 }),
    decisionLog.phasePromptSectionForGoal("architect", goalID, "Architect Consensus", {
      valueCap: ARCHITECT_CONTRACT_VALUE_CAP,
    }),
  ].filter(hasContent)
}

/**
 * Task-level upstream surfaces for the **acceptance** agent — the final acceptance
 * gate. Two ground-truth catalogs (rendered from canonical DB tables, not
 * decision-log summaries) plus a narrative frontend-design section.
 *
 * Rationale: acceptance verdicts must trace every accept/reject to a concrete
 * contract. Decision-log phase summaries are LLM-written narrative — they drift,
 * truncate, and re-summarise across iterations. The catalogs go straight from
 * `engine_requirement` and `engine_goal` so the contract surface acceptance
 * evaluates against is exactly what the writers persisted (rule 22 single
 * source: DB row, not phasePromptSection summary).
 */
export function buildTaskUpstreamAgentContextSections(taskID: string): string[] {
  return [
    buildRequirementsCatalogSection(taskID),
    buildArchitectureContractCatalogSection(taskID),
    // frontend_design is authoritative, but hot-path prompts should carry the
    // materialized frontend template source location instead of cloning the full template.
    renderFrontendDesignHandoffReference(taskID, { valueCap: 500 }),
    // Acceptance runs in-process with sessionDirectory = Instance.directory and
    // reads via the OpenCorvus `read` tool (resolves relative paths against
    // Instance.directory — tool/read.ts), so the RELATIVE bundle path is
    // reachable. The inline Decision Log summary is truncated; this points
    // acceptance at the complete on-disk projection for the full WHY.
    DecisionLogBundle.reference({ projectDir: Instance.directory, taskID, mode: "relative" }),
  ].filter(hasContent)
}

/**
 * Ground-truth REQ-N catalog: renders every requirement row attached to the
 * task's active spec snapshot. Gating: every REQ must trace to ≥1 PASSED
 * acceptance_spec via goal.requirement_ids — an unsatisfied REQ is a reject
 * regardless of acceptance_specs status.
 */
export function buildRequirementsCatalogSection(taskID: string): string {
  const snapshot = findActiveSpecForTask(taskID)
  if (!snapshot) return ""
  const reqs = findRequirements(snapshot.id)
  if (reqs.length === 0) return ""
  const lines: string[] = []
  lines.push("# Requirements Catalog (GATING)")
  lines.push("")
  lines.push(
    `Authoritative REQ-N list pulled from \`engine_requirement\` (active spec ` +
      `snapshot v${snapshot.version}). Every entry below is a hard contract: it must ` +
      `trace to at least one PASSED \`acceptance_spec\` on a goal whose ` +
      `\`requirement_ids\` includes it. An REQ with no covering spec — or whose ` +
      `covering specs all FAIL — is a reject with category="missing_requirement", ` +
      `regardless of how the rest of the goal evaluates. Cite the REQ id in ` +
      `\`rejection_details[].requirement_id\` when you reject on this basis.`,
  )
  lines.push("")
  lines.push(`**Total**: ${reqs.length} requirement(s).`)
  for (const r of reqs) {
    lines.push("")
    lines.push(`## ${r.id} [${r.priority}] ${r.title}`)
    if (r.description.trim().length > 0) {
      lines.push("")
      lines.push(`**Description**: ${r.description}`)
    }
    lines.push("")
    lines.push(`**Acceptance**: ${r.acceptance}`)
    if (r.non_goals && r.non_goals.length > 0) {
      lines.push("")
      lines.push(`**Non-goals**: ${r.non_goals.join("; ")}`)
    }
  }
  return lines.join("\n")
}

/**
 * Ground-truth per-goal architecture contract catalog. Gating: cross-goal
 * contract violations (graph mismatch, owned-path overlap,
 * missing dep) reject regardless of acceptance_specs PASS — those would be
 * "the goal works in isolation but breaks the system" failures.
 */
export function buildArchitectureContractCatalogSection(taskID: string): string {
  const goals = listGoals(taskID)
  if (goals.length === 0) return ""
  const lines: string[] = []
  lines.push("# Architecture Contract Catalog (GATING)")
  lines.push("")
  lines.push(
    `Authoritative per-goal interface contract pulled from \`engine_goal\`. ` +
      `Each goal advertises responsibility paths and dep ordering; cross-goal handoffs live in the Architect Contract Graph — these ` +
      `are CROSS-GOAL gates. A acceptance where every \`acceptance_spec\` PASSES but ` +
      `a graph contract is missing, or a shared file edit contradicts ` +
      `another goal's declared responsibility, is still a reject (category="contract_violation"). Verify by reading ` +
      `the merged worktree, not by trusting goal-local self-reports. Cite the ` +
      `goal id in \`rejection_details[].goal_id\` and the violated field name ` +
      `(contract_graph / owned_paths / depends_on) in \`evidence\`.`,
  )
  const graph = findLatestArchitectContractGraph(taskID)
  if (!graph) {
    throw new Error(
      `Cannot build acceptance architecture context for task ${taskID}: missing architect_contract_graph artifact.`,
    )
  }
  lines.push("")
  lines.push(renderContractGraphForPrompt(graph))
  lines.push("")
  lines.push(`**Total**: ${goals.length} goal(s).`)
  for (const g of goals) {
    lines.push("")
    lines.push(`## ${g.id} [${g.priority}] ${g.title}`)
    lines.push("")
    lines.push(`**Kind**: ${g.kind}`)
    if (g.objective.trim().length > 0) {
      lines.push(`**Objective**: ${g.objective}`)
    }
    if (g.requirement_ids.length > 0) {
      lines.push(`**Covers requirements**: ${g.requirement_ids.join(", ")}`)
    }
    if (g.depends_on.length > 0) {
      lines.push(`**Depends on**: ${g.depends_on.join(", ")}`)
    }
    if (g.owned_paths.length > 0) {
      lines.push(`**Responsibility paths**: ${g.owned_paths.join(", ")}`)
    }
  }
  return lines.join("\n")
}
