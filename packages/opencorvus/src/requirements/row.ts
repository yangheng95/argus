import type { RequirementRow } from "@/engine/store"
import type { ParsedRequirement } from "./types"

function parseAcceptance(raw: string): string[] {
  const text = typeof raw === "string" ? raw.trim() : ""
  if (text.length === 0) return []
  const parsed = JSON.parse(text) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error("engine_requirement.acceptance must be a JSON string array")
  }
  return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function parseNonGoals(raw: RequirementRow["non_goals"]): string[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) {
    throw new Error("engine_requirement.non_goals must be a string array when present")
  }
  return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function parseEvidenceRefs(raw: RequirementRow["evidence_refs"]): string[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) {
    throw new Error("engine_requirement.evidence_refs must be a string array when present")
  }
  return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

export function parsedRequirementFromRow(row: RequirementRow): ParsedRequirement {
  const meta = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {}
  const sourceID = typeof meta.source_requirement_id === "string" ? meta.source_requirement_id : row.id
  return {
    id: sourceID,
    type: row.priority === "advisory" ? "implicit" : "explicit",
    description: row.description,
    acceptance: parseAcceptance(row.acceptance).join("; "),
    non_goals: parseNonGoals(row.non_goals).join("; "),
    evidence_refs: parseEvidenceRefs(row.evidence_refs),
  }
}
