const DIRECT_REPLY_AGENT_KIND_VALUES = [
  "assistant",
  "intent-analysis",
  "requirements",
  "design-analyst",
  "goal",
  "architect",
  "integrity",
  "delivery",
  "evaluator",
]

export const DIRECT_REPLY_AGENT_KINDS = new Set(DIRECT_REPLY_AGENT_KIND_VALUES)

export const DIRECT_AGENT_SESSION_CONTROL_KINDS = new Set([...DIRECT_REPLY_AGENT_KIND_VALUES, "build"])

export function canReceiveDirectAgentReply(kind: string | undefined): boolean {
  return !!kind && DIRECT_REPLY_AGENT_KINDS.has(kind)
}

export function canReceiveDirectAgentSessionControl(kind: string | undefined): boolean {
  return !!kind && DIRECT_AGENT_SESSION_CONTROL_KINDS.has(kind)
}
