/**
 * Parse decompose agent text output.
 *
 * The decompose agent outputs structured text with section tags:
 *   <requirements>, <summary>, <decisions>, <goals>, <traceability>
 */
import {
  extractTag,
  parseYamlLikeList,
} from "@/util/parse-section-tags"

export interface ParsedRequirement {
  id: string
  type: "explicit" | "implicit"
  description: string
}

export interface DecomposeDecision {
  key: string
  value: string
  reason: string
}

export interface ParsedGoalContract {
  id: string
  title: string
  objective: string
  done_definition: string
  owned_paths: string[]
  depends_on: string[]
  exports: string[]
  imports: string[]
  priority: "blocking" | "advisory"
  kind: string
  requirement_ids: string[]
  source: "explicit" | "implicit"
}

export interface TraceabilityEntry {
  requirementID: string
  goalIDs: string[]
}

export interface DecomposeOutput {
  summary: string
  requirements: ParsedRequirement[]
  decisions: DecomposeDecision[]
  goals: ParsedGoalContract[]
  traceability: TraceabilityEntry[]
}

const VALID_KINDS = new Set(["bootstrap", "feature", "verification", "integration", "system"])

function splitCommaSeparated(value: string | undefined): string[] {
  if (!value || !value.trim()) return []
  return value.split(/[,，\n]\s*|\s+-\s+/)
    .map((s) => s.trim().replace(/^-\s+/, "").trim())
    .filter(Boolean)
}

/** Split on newlines only — for exports/imports which may contain commas in signatures */
function splitLines(value: string | undefined): string[] {
  if (!value || !value.trim()) return []
  return value.split(/\n/)
    .map((s) => s.trim().replace(/^-\s+/, "").trim())
    .filter(Boolean)
}

export function parseDecomposeText(text: string): DecomposeOutput {
  const summary = extractTag(text, "summary") || ""
  const requirementsRaw = extractTag(text, "requirements") || ""
  const decisionsRaw = extractTag(text, "decisions") || ""
  const goalsRaw = extractTag(text, "goals") || ""
  const traceabilityRaw = extractTag(text, "traceability") || ""

  return {
    summary,
    requirements: parseRequirements(requirementsRaw),
    decisions: parseDecisions(decisionsRaw),
    goals: parseGoals(goalsRaw),
    traceability: parseTraceability(traceabilityRaw),
  }
}

function parseDecisions(text: string): DecomposeDecision[] {
  if (!text.trim()) return []
  return parseYamlLikeList(text)
    .filter((item) => item.key && item.value)
    .map((item) => ({
      key: item.key!,
      value: item.value!,
      reason: item.reason || "",
    }))
}

function parseGoals(text: string): ParsedGoalContract[] {
  if (!text.trim()) return []

  return parseYamlLikeList(text)
    .filter((item) => item.id && item.title)
    .map((item) => {
      const kind = item.kind && VALID_KINDS.has(item.kind) ? item.kind : "feature"
      const reqIds = splitCommaSeparated(item.requirement_ids)
      const source = item.source === "implicit" || reqIds.length === 0 ? "implicit" : "explicit"

      // exports/imports may contain function signatures with commas — split on lines only
      const rawExports = item.exports
      const rawImports = item.imports
      const exports = rawExports ? splitLines(rawExports) : []
      const imports = rawImports ? splitLines(rawImports) : []

      // depends_on can appear as "depends_on" or "depends_on_goal_ids"
      const dependsOnRaw = item.depends_on || item.depends_on_goal_ids || ""

      return {
        id: item.id,
        title: item.title,
        objective: item.objective || item.title,
        done_definition: item.done_definition || "",
        owned_paths: splitCommaSeparated(item.owned_paths),
        depends_on: splitCommaSeparated(dependsOnRaw),
        exports,
        imports,
        priority: (item.priority === "advisory" ? "advisory" : "blocking") as "blocking" | "advisory",
        kind,
        requirement_ids: reqIds,
        source,
      }
    })
}

function parseRequirements(text: string): ParsedRequirement[] {
  if (!text.trim()) return []
  return text.split("\n")
    .map(line => line.trim().replace(/^-\s*/, ""))
    .filter(Boolean)
    .map(line => {
      // Parse "REQ-1: [explicit] description" or "REQ-1: description"
      const match = line.match(/^(REQ-\d+)\s*:\s*(?:\[(explicit|implicit)\]\s*)?(.+)/)
      if (!match) return null
      return {
        id: match[1],
        type: (match[2] as "explicit" | "implicit") ?? "explicit",
        description: match[3].trim(),
      }
    })
    .filter((r): r is ParsedRequirement => r !== null)
}

function parseTraceability(text: string): TraceabilityEntry[] {
  if (!text.trim()) return []
  return text.split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      // Parse "REQ-1 → goal_api" or "REQ-1 → goal_api, goal_types"
      const match = line.match(/^(REQ-\d+)\s*(?:→|->|→)+\s*(.+)/)
      if (!match) return null
      const goalIDs = match[2].split(/[,，]\s*/).map(s => s.trim().replace(/\s*\(.*\)/, "")).filter(Boolean)
      return { requirementID: match[1], goalIDs }
    })
    .filter((t): t is TraceabilityEntry => t !== null)
}
