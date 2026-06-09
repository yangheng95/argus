import type { ToolAdapter, ToolDefinitionInfo } from "../tool"

const names = ["structuredoutput", "structured_output", "taskoutput", "task_output", "json_schema_output", "final"]

export const StructuredOutputToolAdapter: ToolAdapter = {
  id: "structured_output",
  kind: "structured_output",
  aliases: names,
  supports(input) {
    return input.capabilities.structured_output
  },
  declare() {
    return [
      {
        name: "structured_output",
        description: "Return the final response as structured JSON matching the requested schema.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: true,
        },
        metadata: {
          tool_kind: "structured_output",
        },
      },
    ] satisfies ToolDefinitionInfo[]
  },
  accept(call) {
    const value = call.name.trim().toLowerCase()
    return (this.aliases || []).some((item) => value === item || value.includes(item))
  },
  projectCall(call) {
    return [
      {
        provider: call.metadata?.provider as "opencorvus" | "codex" | "claude-code",
        kind: "tool_call",
        summary: "Structured output requested",
        refs: call.refs,
        payload: {
          adapter: this.id,
          tool_kind: this.kind,
          input: call.input,
        },
        raw: call.raw,
      },
    ]
  },
  projectResult(result) {
    return [
      {
        provider: result.metadata?.provider as "opencorvus" | "codex" | "claude-code",
        kind: "tool_result",
        summary: result.summary ?? "Structured output returned",
        refs: result.refs,
        payload: {
          adapter: this.id,
          tool_kind: this.kind,
          output: result.output,
        },
        raw: result.raw,
      },
    ]
  },
}
