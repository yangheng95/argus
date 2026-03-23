/**
 * Parse planner agent text output into PlannerOutputType.
 *
 * The planner agent outputs structured text with section tags:
 *   <summary>, <prd>, <goals>, <subtasks>, <milestones>,
 *   <risks>, <assumptions>, <clarifications>
 *
 * Each section is independently parseable — truncation only loses
 * the last incomplete section, not the entire output.
 */
import type { PlannerOutputType } from "./agent"
import {
  extractTag,
  parseYamlLikeList,
  parseList,
  parseAssumptions,
  parseClarifications,
} from "@/util/parse-section-tags"

export function parsePlanText(text: string): PlannerOutputType {
  return {
    summary: extractTag(text, "summary") || "",
    prd: extractTag(text, "prd") || "",
    goals: parseGoals(extractTag(text, "goals") || ""),
    subtasks: parseSubtasks(extractTag(text, "subtasks") || ""),
    milestones: parseMilestones(extractTag(text, "milestones") || ""),
    risks: parseList(extractTag(text, "risks") || ""),
    assumptions: parseAssumptions(extractTag(text, "assumptions") || ""),
    clarifications: parseClarifications(extractTag(text, "clarifications") || ""),
  }
}

function parseGoals(
  text: string,
): PlannerOutputType["goals"] {
  if (!text.trim()) return []

  return parseYamlLikeList(text)
    .filter((item) => item.description && item.criteria)
    .map((item) => ({
      description: item.description,
      criteria: item.criteria,
      priority: (item.priority === "advisory" ? "advisory" : "blocking") as "blocking" | "advisory",
      check_selector: item.check_selector
        ? item.check_selector.split(/[,，]\s*/).map((s) => s.trim()).filter(Boolean)
        : undefined,
    }))
}

function parseSubtasks(
  text: string,
): PlannerOutputType["subtasks"] {
  if (!text.trim()) return []

  return parseYamlLikeList(text)
    .filter((item) => item.title)
    .map((item, index) => ({
      title: item.title,
      description: item.description || item.title,
      order: item.order ? Number(item.order) : index + 1,
    }))
}

function parseMilestones(
  text: string,
): PlannerOutputType["milestones"] {
  if (!text.trim()) return undefined

  const items = parseYamlLikeList(text)
    .filter((item) => item.title)
    .map((item) => ({
      title: item.title,
      description: item.description || undefined,
      goal_indices: item.goals
        ? item.goals.split(/[,，]\s*/).map((s) => Number(s.trim())).filter((n) => !isNaN(n))
        : [],
    }))

  return items.length > 0 ? items : undefined
}
