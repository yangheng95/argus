import type z from "zod"
import { EvaluationCheck } from "./model"

type Check = z.infer<typeof EvaluationCheck>

function checkBase(name: string) {
  return name.replace(/#\d+$/, "")
}

function groupStatus(checks: Check[]) {
  if (checks.some((check) => check.status === "failed")) return "failed" as const
  if (checks.some((check) => check.status === "passed")) return "passed" as const
  return "skipped" as const
}

const GROUP_DEFS = [
  {
    id: "rules",
    label: "Rule Checks",
    include: (check: Check) => {
      const base = checkBase(check.name)
      return base !== "goal_check" && base !== "spec_check"
    },
  },
  {
    id: "goal_acceptance",
    label: "Goal Acceptance",
    include: (check: Check) => checkBase(check.name) === "goal_check",
  },
  {
    id: "spec_acceptance",
    label: "Spec Acceptance",
    include: (check: Check) => checkBase(check.name) === "spec_check",
  },
] as const

export function evaluationGroups(checks: Check[]) {
  return GROUP_DEFS.flatMap((group) => {
    const matches = checks.filter(group.include)
    if (matches.length === 0) return []
    return [{
      id: group.id,
      label: group.label,
      status: groupStatus(matches),
      checks: matches.map((check) => check.name),
    }]
  })
}
