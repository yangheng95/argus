/**
 * Zod-validated tool calls for the Goal Workload Analyst.
 *
 * Two tools: `register_workload_brief` (one per goal) accumulates into a single
 * collector; `submit_workload_analysis` is the terminal validator. The
 * orchestrator tool reads the finalized collector after the session ends and
 * persists one `goal_workload` artifact. Mirrors the architect output-tools
 * shape (rule 24) — small tool calls, single collector, terminal submit.
 *
 * index/lens enforcement (spec §2, rule 8): the brief REFERENCES surfaces and
 * contracts by id and ORIGINATES only the anti-underestimation fields. The
 * schema descriptions carry that discipline; the host cannot police prose, so
 * the core prompt + the §2 二次 review own the rest.
 */
import { tool } from "ai"
import z from "zod"
import { limitSummary, markdownList, requireReportString } from "@/agent/report"
import { FactCheckItemListSchema, type FactCheckItem } from "@/fact-check/schema"
import type { WorkloadBrief } from "./types"

export interface GoalWorkloadCollector {
  briefs: WorkloadBrief[]
  summary: string
  fact_check_items: FactCheckItem[]
  finalized: boolean
}

const WorkloadBriefSchema = z.object({
  goal_id: z.string().min(1).describe("Architect goal id (llmID) this brief covers, e.g. 'goal_visual_shell'."),
  decomposition_concern: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Set ONLY when this goal is too large or under-specified for ONE autonomous build. State the evidence " +
        "(why a single build should not swallow it); do NOT propose a concrete split — that is Architect's job. " +
        "Omit when the current sizing is adequate.",
    ),
  why_not_smaller: z
    .array(z.string().min(1))
    .min(1)
    .describe("Concrete reasons this goal is bigger than its title/objective implies. At least one."),
  underestimation_traps: z
    .array(z.string().min(1))
    .default([])
    .describe(
      "Specific 'do not stop at X' warnings, e.g. 'building Header/Sidebar is not enough; the chart region " +
        "includes grid + price axis + overlay + subpanels'.",
    ),
  execution_inventory: z
    .object({
      surfaces: z.number().int().nonnegative().describe("Distinct visual/render surfaces this goal must deliver."),
      states: z.number().int().nonnegative().describe("Interaction / loading / error / empty states."),
      data_contracts: z.number().int().nonnegative().describe("Data / mock / API contracts touched."),
      verification_points: z.number().int().nonnegative().describe("Distinct things that must be verified."),
    })
    .describe("Countable decomposition of the work surface — an anti-premature-minimization checklist."),
  verification_inventory: z
    .array(z.string().min(1))
    .default([])
    .describe("Concrete, observable checks build must run before reporting pass."),
  references: z
    .object({
      contract_ids: z.array(z.string().min(1)).default([]),
      reference_coverage_ids: z.array(z.string().min(1)).default([]),
      acceptance_spec_ids: z.array(z.string().min(1)).default([]),
      visual_spec_ids: z.array(z.string().min(1)).default([]),
      prd_sections: z.array(z.string().min(1)).default([]),
    })
    .describe(
      "Pointers into existing single sources (architect contract / reference_coverage / acceptance_spec ids, " +
        "optional design vis-* ids, frontend-template.md section headings). REFERENCE only — never restate surfaces or " +
        "contracts as new prose.",
    ),
})

export function buildGoalWorkloadReport(collector: GoalWorkloadCollector) {
  const flagged = collector.briefs.filter((b) => b.decomposition_concern?.trim())
  const fallbackSummary = `${collector.briefs.length} workload brief(s), ${flagged.length} flagged for re-sizing`
  const summary = collector.summary.trim().length > 0 ? collector.summary : fallbackSummary
  const lines = collector.briefs.map((b) => {
    const inv = b.execution_inventory
    const flag = b.decomposition_concern?.trim() ? " [decomposition_concern]" : ""
    return (
      `${b.goal_id}${flag}: ${inv.surfaces} surfaces / ${inv.states} states / ` +
      `${inv.data_contracts} data contracts / ${inv.verification_points} verification points`
    )
  })
  return {
    summary: limitSummary(summary),
    detail: [
      `## Summary\n${requireReportString(summary, "workload summary")}`,
      `## Goal Briefs\n${lines.length ? markdownList(lines) : "- no briefs submitted"}`,
    ].join("\n\n"),
  }
}

export function createGoalWorkloadOutputTools(input: { knownGoalIDs: string[]; knownContractIDs?: string[] }) {
  const knownGoals = new Set(input.knownGoalIDs)
  const knownContracts = new Set(input.knownContractIDs ?? [])

  function emptyCollector(): GoalWorkloadCollector {
    return { briefs: [], summary: "", fact_check_items: [], finalized: false }
  }
  let collector = emptyCollector()

  // Single source of truth for "is the output complete?" — both the terminal
  // predicate and submit's own validation go through this (rule 8).
  const validate = (): string[] => {
    const issues: string[] = []
    if (collector.briefs.length === 0) {
      issues.push("No workload briefs registered — call register_workload_brief at least once before submitting.")
    }
    return issues
  }

  const tools = {
    register_workload_brief: tool({
      description:
        "Register one goal's workload brief. index/lens discipline: ORIGINATE why_not_smaller / traps / " +
        "execution_inventory / verification_inventory / decomposition_concern; REFERENCE surfaces and contracts " +
        "by id (never restate them). Re-registering the same goal_id overwrites.",
      inputSchema: WorkloadBriefSchema,
      execute: async (raw) => {
        const brief = WorkloadBriefSchema.parse(raw) as WorkloadBrief
        if (!knownGoals.has(brief.goal_id)) {
          return (
            `Error: goal_id "${brief.goal_id}" is not a registered architect goal. ` +
            `Known goals: ${[...knownGoals].join(", ") || "(none)"}. Collector unchanged.`
          )
        }
        const unknownContracts =
          knownContracts.size > 0 ? brief.references.contract_ids.filter((id) => !knownContracts.has(id)) : []
        const warn =
          unknownContracts.length > 0
            ? `\nWarning: referenced contract id(s) not in the contract graph: ${unknownContracts.join(", ")}.`
            : ""
        const idx = collector.briefs.findIndex((b) => b.goal_id === brief.goal_id)
        if (idx >= 0) {
          collector.briefs[idx] = brief
          return `OK: workload brief for "${brief.goal_id}" updated (${collector.briefs.length} total).${warn}`
        }
        collector.briefs.push(brief)
        return `OK: workload brief for "${brief.goal_id}" registered (${collector.briefs.length} total).${warn}`
      },
    }),

    submit_workload_analysis: tool({
      description:
        "Finalize the workload analysis. Requires at least one workload brief. Reports goals flagged with a " +
        "decomposition_concern so the orchestrator can decide whether to send the graph back to Architect.",
      inputSchema: z.object({
        summary: z
          .string()
          .min(5)
          .describe("One-line summary: how many goals are sized OK vs flagged with a decomposition_concern."),
        fact_check_items: FactCheckItemListSchema.default([]).describe(
          "Every factual claim (API behaviour, library version, number, path, history) you have NOT verified via " +
            "tool calls this session. Empty when only in-session-verified statements or analysis judgements.",
        ),
      }),
      execute: async ({ summary, fact_check_items }) => {
        collector.summary = summary
        collector.fact_check_items = fact_check_items ?? []
        const issues = validate()
        if (issues.length > 0) {
          return `BLOCKERS (${issues.length}):\n${issues.map((m, i) => `${i + 1}. ${m}`).join("\n")}\nFix and call submit_workload_analysis again.`
        }
        collector.finalized = true
        const flagged = collector.briefs.filter((b) => b.decomposition_concern?.trim())
        const uncovered = [...knownGoals].filter((g) => !collector.briefs.some((b) => b.goal_id === g))
        return [
          "PASS: workload analysis finalized.",
          `  ${collector.briefs.length} goal brief(s); ${flagged.length} flagged with decomposition_concern.`,
          flagged.length > 0
            ? `  Flagged (consider Architect re-sizing): ${flagged.map((b) => b.goal_id).join(", ")}`
            : "",
          uncovered.length > 0 ? `  Note: ${uncovered.length} goal(s) without a brief: ${uncovered.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      },
    }),
  }

  return {
    tools,
    getCollector: () => collector,
    buildReport: () => buildGoalWorkloadReport(collector),
    /** Same predicate submit uses, for terminalTool.shouldExposeOnlyTerminalTool (rule 8). */
    isReadyToFinalize: () => validate().length === 0,
    reset() {
      collector = emptyCollector()
      return collector
    },
  }
}
