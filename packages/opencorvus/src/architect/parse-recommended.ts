/**
 * Parse recommended_next from LLM text output.
 * Shared by all sub-agents (Decompose, Architect, Planner, Eval).
 */
import { extractTag, parseYamlLikeList } from "@/util/parse-section-tags"
import type { RecommendedNext } from "./types"

export function parseRecommendedNext(text: string): RecommendedNext[] {
  const raw = extractTag(text, "recommended_next") || ""
  if (!raw.trim()) return []

  const items = parseYamlLikeList(raw)
  return items
    .filter((item) => item.agent)
    .map((item) => {
      let args: Record<string, unknown> | undefined
      if (item.args) {
        try { args = JSON.parse(item.args) } catch { args = undefined }
      }
      return {
        agent: item.agent!,
        args,
        reason: item.reason || "",
        confidence: Math.min(1, Math.max(0, parseFloat(item.confidence || "0.5"))),
        priority: (["required", "suggested", "optional"].includes(item.priority || "")
          ? item.priority
          : "suggested") as RecommendedNext["priority"],
      }
    })
}
