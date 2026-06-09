import type { VisualSpec } from "./types"

export function renderVisualContractPromptSection(input: {
  specs?: VisualSpec[]
  heading?: string
  instructions?: string[]
}): string {
  const specs = Array.isArray(input.specs) ? input.specs : []
  if (specs.length === 0) return ""

  const lines = specs.map((spec) => {
    const rationale = spec.rationale ? ` — why: ${spec.rationale}` : ""
    return `- [${spec.severity}] ${spec.category} :: ${spec.title} => ${spec.requirement} (applies_to: ${spec.applies_to})${rationale}`
  })

  return [
    input.heading ?? `# Visual Contract (${specs.length} specs)`,
    "",
    ...(input.instructions ?? []),
    "",
    ...lines,
  ].join("\n")
}
