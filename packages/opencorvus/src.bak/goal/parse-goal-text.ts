/**
 * Parse goal agent text output into GoalDraft.
 *
 * The goal agent outputs structured text with section tags:
 *   <summary>, <goals>
 *
 * Each goal is a YAML-like item with fields:
 *   id, title, objective, requirement_ids, depends_on_goal_ids,
 *   owned_paths, done_definition, qa_rule_selectors, goal_check_prompt,
 *   priority, kind
 */
import { GoalKind } from "@/orchestrator/model"
import {
  extractTag,
  parseYamlLikeList,
} from "@/util/parse-section-tags"

export interface GoalContract {
  id: string
  title: string
  objective: string
  requirement_ids: string[]
  /** "explicit" = covers spec requirements; "implicit" = infrastructure discovered by the agent */
  source: "explicit" | "implicit"
  depends_on_goal_ids: string[]
  owned_paths: string[]
  done_definition: string
  qa_profile: {
    rule_selectors: string[]
    goal_check_prompt?: string
    spec_scope: "mapped_requirements"
  }
  priority: "blocking" | "advisory"
  kind: string
}

export interface ParsedGoalDraft {
  summary: string
  goals: GoalContract[]
}

const VALID_KINDS = new Set(["bootstrap", "feature", "verification", "integration", "system"])

function splitCommaSeparated(value: string | undefined): string[] {
  if (!value || !value.trim()) return []
  // Split on commas, newlines, or " - " separators
  // Handles: "a, b", "a，b", "- a\n- b", "a - b" formats from LLM output
  return value.split(/[,，\n]\s*|\s+-\s+/)
    .map((s) => s.trim().replace(/^-\s+/, "").trim())
    .filter(Boolean)
}

export function parseGoalText(text: string): ParsedGoalDraft {
  const summary = extractTag(text, "summary") || ""
  const goalsRaw = extractTag(text, "goals") || ""

  return {
    summary,
    goals: parseGoalItems(goalsRaw),
  }
}

function parseGoalItems(text: string): GoalContract[] {
  if (!text.trim()) return []

  return parseYamlLikeList(text)
    .filter((item) => item.id && item.title)
    .map((item) => {
      const ruleSelectors = splitCommaSeparated(item.qa_rule_selectors)
      const kind = item.kind && VALID_KINDS.has(item.kind) ? item.kind : "feature"

      const reqIds = splitCommaSeparated(item.requirement_ids)
      // Infer source: if the agent wrote "implicit" OR the goal has no requirement_ids, it's implicit
      const source = item.source === "implicit" || reqIds.length === 0 ? "implicit" : "explicit"

      return {
        id: item.id,
        title: item.title,
        objective: item.objective || item.title,
        requirement_ids: reqIds,
        source,
        depends_on_goal_ids: splitCommaSeparated(item.depends_on_goal_ids),
        owned_paths: splitCommaSeparated(item.owned_paths),
        done_definition: item.done_definition || "",
        qa_profile: {
          rule_selectors: ruleSelectors.length > 0 ? ruleSelectors : ["build", "test"],
          goal_check_prompt: item.goal_check_prompt || undefined,
          spec_scope: "mapped_requirements" as const,
        },
        priority: (item.priority === "advisory" ? "advisory" : "blocking") as "blocking" | "advisory",
        kind,
      }
    })
}
