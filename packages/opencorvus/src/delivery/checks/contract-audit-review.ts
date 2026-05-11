import { contractAuditCriteriaName, contractAuditRequired } from "@/acceptance/contract-audit"
import type { AcceptanceSpec } from "@/acceptance/types"
import type { DeliveryReviewEvidence } from "../manifest"

export type ContractAuditCriteriaStatus = "passed" | "failed" | "skipped" | "inconclusive"

export function buildContractAuditReviewEvidence(input: {
  goals: Array<{
    imports?: string[]
    exports?: string[]
    acceptance_specs?: AcceptanceSpec[]
  }>
  criteriaResults: Array<{
    name: string
    status: ContractAuditCriteriaStatus
    evidence?: string
    family?: string
    label?: string
  }>
}): DeliveryReviewEvidence[] {
  const criteriaByName = new Map(input.criteriaResults.map((item) => [item.name, item]))
  const required: string[] = []
  const failures: string[] = []
  const passes: string[] = []
  const inconclusive: string[] = []
  const skips: string[] = []

  for (const goal of input.goals) {
    const hasBoundary = (goal.imports?.length ?? 0) > 0 || (goal.exports?.length ?? 0) > 0
    if (!hasBoundary) continue
    for (const spec of goal.acceptance_specs ?? []) {
      for (const scorer of spec.scorers) {
        if (scorer.type !== "contract_audit" || !contractAuditRequired(spec, scorer)) continue
        const name = contractAuditCriteriaName(spec, scorer)
        required.push(name)
        const criteria = criteriaByName.get(name)
        if (!criteria) {
          failures.push(`${name}: no evidence in criteria_results`)
          continue
        }
        const evidence = criteria.evidence ? `: ${criteria.evidence}` : ""
        if (criteria.status === "failed") failures.push(`${name}${evidence}`)
        else if (criteria.status === "passed") passes.push(name)
        else if (criteria.status === "inconclusive") inconclusive.push(`${name}${evidence}`)
        else skips.push(`${name}${evidence}`)
      }
    }
  }

  if (required.length === 0) return []
  return [{
    id: "review:contract_audit",
    name: "Contract Audit",
    status: failures.length === 0 ? "passed" : "failed",
    evidence: failures.length > 0
      ? failures
      : [
          `passed=${passes.length}`,
          inconclusive.length > 0 ? `inconclusive=${inconclusive.join(" | ")}` : undefined,
          skips.length > 0 ? `skipped=${skips.join(" | ")}` : undefined,
        ].filter((item): item is string => Boolean(item)),
  }]
}
