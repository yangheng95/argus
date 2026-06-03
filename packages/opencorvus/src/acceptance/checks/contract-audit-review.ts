import { contractAuditCriteriaName, contractAuditRequired } from "@/acceptance/contract-audit"
import type { AcceptanceSpec } from "@/acceptance/types"
import type { AcceptanceReviewEvidence } from "../manifest"

export type ContractAuditCriteriaStatus = "passed" | "failed" | "skipped" | "inconclusive"

export function buildContractAuditReviewEvidence(input: {
  goals: Array<{
    id?: string
    latest_goal_run_id?: string
    acceptance_specs?: AcceptanceSpec[]
  }>
  criteriaResults: Array<{
    name: string
    status: ContractAuditCriteriaStatus
    evidence?: string
    family?: string
    label?: string
    goal_id?: string
    goal_run_id?: string
  }>
}): AcceptanceReviewEvidence[] {
  const required: string[] = []
  const failures: string[] = []
  const passes: string[] = []
  const inconclusive: string[] = []
  const skips: string[] = []

  for (const goal of input.goals) {
    for (const spec of goal.acceptance_specs ?? []) {
      for (const scorer of spec.scorers) {
        if (scorer.type !== "contract_audit" || !contractAuditRequired(spec, scorer)) continue
        const name = contractAuditCriteriaName(spec, scorer)
        required.push(name)
        const criteria = latestCriteriaForGoal(input.criteriaResults, name, goal)
        if (!criteria) {
          failures.push(`${name}: no evidence in criteria_results`)
          continue
        }
        const evidence = criteria.evidence ? `: ${criteria.evidence}` : ""
        if (criteria.status === "failed") failures.push(`${name}${evidence}`)
        else if (criteria.status === "passed") passes.push(name)
        else if (criteria.status === "inconclusive") {
          inconclusive.push(`${name}${evidence}`)
          failures.push(`${name}: inconclusive evidence does not prove required contract compliance${evidence}`)
        } else {
          skips.push(`${name}${evidence}`)
          failures.push(`${name}: skipped evidence does not prove required contract compliance${evidence}`)
        }
      }
    }
  }

  if (required.length === 0) return []
  return [
    {
      id: "review:contract_audit",
      name: "Contract Audit",
      status: failures.length === 0 ? "passed" : "failed",
      evidence:
        failures.length > 0
          ? failures
          : [
              `passed=${passes.length}`,
              inconclusive.length > 0 ? `inconclusive=${inconclusive.join(" | ")}` : undefined,
              skips.length > 0 ? `skipped=${skips.join(" | ")}` : undefined,
            ].filter((item): item is string => Boolean(item)),
    },
  ]
}

function latestCriteriaForGoal(
  criteriaResults: Array<{
    name: string
    status: ContractAuditCriteriaStatus
    evidence?: string
    family?: string
    label?: string
    goal_id?: string
    goal_run_id?: string
  }>,
  name: string,
  goal: { id?: string; latest_goal_run_id?: string },
) {
  const candidates = criteriaResults.filter((item) => item.name === name)
  if (goal.latest_goal_run_id) {
    return candidates.find((item) => item.goal_run_id === goal.latest_goal_run_id)
  }
  if (goal.id) {
    const owned = candidates.filter((item) => item.goal_id === goal.id)
    if (owned.length > 0) return owned.at(-1)
  }
  return candidates.at(-1)
}
