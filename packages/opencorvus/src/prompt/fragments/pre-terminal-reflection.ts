export function renderPreTerminalReflectionPrompt(input: {
  agentName: string
  terminalToolName?: string
  usesStructuredOutput?: boolean
}): string | undefined {
  const finalizers = [input.terminalToolName, input.usesStructuredOutput ? "StructuredOutput" : undefined].filter(
    (name): name is string => typeof name === "string" && name.length > 0,
  )
  if (finalizers.length === 0) return undefined

  return [
    "# Pre-terminal Reflection",
    "",
    `Before calling ${finalizers.join(" or ")} as ${input.agentName}, re-check the prompt-visible original user request and any system-provided authoritative request-bundle path supplied by task context.`,
    renderPreTerminalReflectionContractLine(),
    "If the pending terminal payload would omit, narrow, contradict, or merely summarize away any required user-facing outcome, keep working with the available tools and correct the mismatch before finalizing.",
    "Do not emit a separate prose checklist unless the terminal schema explicitly asks for one; the reflection is a gate before finalization, not an additional deliverable.",
  ].join("\n")
}

export function renderPreTerminalReflectionReminder(toolName: string): string {
  return [
    `Before calling ${toolName}, re-check the prompt-visible original user request and upstream contracts.`,
    "If the payload would omit, narrow, contradict, or summarize away any required user-facing outcome, correct it before finalizing.",
  ].join(" ")
}

function renderPreTerminalReflectionContractLine(): string {
  return "Also re-check every upstream contract present in the prompt: generated REQ rows, foundational decisions, architect goals, contract graph, visual/reference specs, retry guidance, integrity feedback, and acceptance feedback. For UI/webpage work, re-check that visible content is componentized and data-fed where required, and that charts/maps/heatmaps/tables/tabs/components were not flattened into fixed-coded SVG/image/JSX content unless the evidence says they are static decoration."
}
