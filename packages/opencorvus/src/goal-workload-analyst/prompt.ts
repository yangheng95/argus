/**
 * User-prompt builder for the Goal Workload Analyst.
 *
 * The defining choice (spec §0): the FULL materialized frontend template is inlined here
 * — this is the one agent whose entire job is to digest the template, so we spend its
 * context budget on the full text rather than handing it a path it might skim.
 * Everything else (goal graph, contract graph, reference coverage) is rendered
 * as id-bearing anchors the brief must REFERENCE rather than restate (spec §2).
 */
import type { ArchitectContractGraph } from "@/architect/contract-graph"

export interface GoalWorkloadGoalInput {
  id: string
  title: string
  objective: string
  acceptance_specs: string[]
  owned_paths: string[]
  depends_on: string[]
  kind: string
  requirement_ids: string[]
}

export interface ReferenceCoverageInput {
  id: string
  surface: string
  visual_spec_ids: string[]
  expectation: string
}

export interface WorkloadPromptInput {
  taskTitle: string
  goals: GoalWorkloadGoalInput[]
  contractGraph?: ArchitectContractGraph
  referenceCoverage?: ReferenceCoverageInput[]
  requirements?: Array<{ id: string; type: string; description: string; acceptance: string; non_goals: string }>
  /** Full materialized frontend template text — inlined so the analyst deep-reads it. */
  prdFullText?: string
  /** Frontend-design handoff reference text supplied by the orchestrator. */
  frontendDesign?: string
}

export function buildWorkloadUserPrompt(input: WorkloadPromptInput): string {
  const sections: string[] = []

  sections.push(
    "# Delegation\n\nOrchestrator is asking the Goal Workload Analyst to deeply read the full frontend template and the " +
      "architect goal graph and produce a per-goal workload brief. You do not write code, you do not create or " +
      "modify goals, and you are not a gate. Fight underestimation, and flag goals too large or under-specified " +
      "for one autonomous build.",
  )

  if (input.prdFullText && input.prdFullText.trim().length > 0) {
    sections.push(
      "# Full frontend template (read this completely before scoring any goal)\n\n" + input.prdFullText.trim(),
    )
  } else if (input.frontendDesign && input.frontendDesign.trim().length > 0) {
    sections.push(input.frontendDesign.trim())
  }

  if (input.requirements && input.requirements.length > 0) {
    const reqText = input.requirements
      .map((r) => {
        const lines = [`- **${r.id}** (${r.type}): ${r.description}`]
        if (r.acceptance.trim().length > 0) lines.push(`  Acceptance: ${r.acceptance}`)
        if (r.non_goals.trim().length > 0) lines.push(`  Non-goals: ${r.non_goals}`)
        return lines.join("\n")
      })
      .join("\n")
    sections.push(`# Requirements (${input.requirements.length})\n\n${reqText}`)
  }

  const goalText = input.goals
    .map((g) => {
      const lines = [`## ${g.id}: ${g.title} [${g.kind}]`, `objective: ${g.objective}`]
      if (g.acceptance_specs.length > 0) {
        lines.push(`acceptance_specs:\n${g.acceptance_specs.map((s) => `  - ${s}`).join("\n")}`)
      }
      if (g.owned_paths.length > 0) lines.push(`owned_paths: ${g.owned_paths.join(", ")}`)
      if (g.depends_on.length > 0) lines.push(`depends_on: ${g.depends_on.join(", ")}`)
      if (g.requirement_ids.length > 0) lines.push(`requirement_ids: ${g.requirement_ids.join(", ")}`)
      return lines.join("\n")
    })
    .join("\n\n")
  sections.push(`# Goal graph under review (${input.goals.length} goals)\n\n${goalText}`)

  if (input.contractGraph && input.contractGraph.contracts.length > 0) {
    const contractText = input.contractGraph.contracts
      .map(
        (c) =>
          `- **${c.id}** [${c.kind}] ${c.name} — producer=${c.producer_goal_id} consumers=[${c.consumer_goal_ids.join(", ")}]`,
      )
      .join("\n")
    sections.push(
      `# Architect contract graph (REFERENCE these contract ids — do not restate the surfaces)\n\n${contractText}`,
    )
  }

  if (input.referenceCoverage && input.referenceCoverage.length > 0) {
    const rcText = input.referenceCoverage
      .map((r) => {
        const vis = r.visual_spec_ids.length > 0 ? ` visual_specs=[${r.visual_spec_ids.join(", ")}]` : ""
        return `- **${r.id}** surface=${r.surface}${vis} — ${r.expectation}`
      })
      .join("\n")
    sections.push(`# Reference coverage (REFERENCE these ids — do not restate the surfaces)\n\n${rcText}`)
  }

  sections.push(
    [
      "# Your task",
      "",
      "For EACH goal above, call `register_workload_brief`:",
      "- Read the template sections relevant to the goal; base your counts on evidence, not the goal title.",
      "- ORIGINATE: `why_not_smaller`, `underestimation_traps`, `execution_inventory` (counts), `verification_inventory`.",
      "- REFERENCE surfaces/contracts by id (`references.*`). Never restate a surface in your own prose.",
      "- Set `decomposition_concern` ONLY when the goal is too large or under-specified for one autonomous build — state the evidence, do not propose the split (that is Architect's job).",
      "- Watch for assembly-owner goals: a small-looking goal that stitches several sibling-produced surfaces is a classic underestimate.",
      "",
      "When every goal has a brief, call `submit_workload_analysis`.",
    ].join("\n"),
  )

  return sections.join("\n\n")
}
