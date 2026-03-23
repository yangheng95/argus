/**
 * Parse spec agent text output into SpecOutputType.
 *
 * The spec agent outputs structured text with section tags:
 *   <summary>, <scope>, <out_of_scope>, <content>, <spec_items>,
 *   <assumptions>, <risks>, <evidence>, <unresolved>, <clarifications>
 *
 * Each section is independently parseable — truncation only loses
 * the last incomplete section, not the entire output.
 */
import type { SpecOutputType, SpecItem } from "./agent"
import {
  extractTag,
  parseYamlLikeList,
  parseList,
  parseAssumptions,
  parseClarifications,
} from "@/util/parse-section-tags"

export function parseSpecText(text: string): SpecOutputType {
  return {
    summary: extractTag(text, "summary") || "",
    scope: extractTag(text, "scope") || "",
    out_of_scope: extractTag(text, "out_of_scope") || undefined,
    content: extractTag(text, "content") || "",
    spec_items: parseSpecItems(extractTag(text, "spec_items") || ""),
    assumptions: parseAssumptions(extractTag(text, "assumptions") || ""),
    risks: parseList(extractTag(text, "risks") || ""),
    evidence_sources: parseList(extractTag(text, "evidence") || ""),
    unresolved_questions: parseList(extractTag(text, "unresolved") || ""),
    clarifications: parseClarifications(extractTag(text, "clarifications") || ""),
  }
}

function parseSpecItems(text: string): SpecItem[] {
  if (!text.trim()) return []

  return parseYamlLikeList(text)
    .filter((item) => item.title)
    .map((item) => ({
      title: item.title,
      description: item.description || item.title,
      check_selector: item.check_selector
        ? item.check_selector.split(/[,，]\s*/).map((s) => s.trim()).filter(Boolean)
        : undefined,
      priority: (item.priority === "advisory" ? "advisory" : "blocking") as "blocking" | "advisory",
    }))
}
