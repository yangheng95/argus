export const TASK_TOOL_SUBAGENT_METADATA_KEY = "taskToolSubagent"

export function taskToolSessionMetadata(agentName: string): Record<string, unknown> {
  return {
    [TASK_TOOL_SUBAGENT_METADATA_KEY]: agentName,
  }
}

export function taskToolSubagentNameFromMetadata(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined
  const value = (metadata as Record<string, unknown>)[TASK_TOOL_SUBAGENT_METADATA_KEY]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}
