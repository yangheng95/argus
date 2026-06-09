import type { ToolAdapter, ToolDefinitionInfo } from "../tool"

const names = ["request_user_input", "ask_user_question", "askuserquestion", "elicitation", "prompt_user"]

export const RequestUserInputToolAdapter: ToolAdapter = {
  id: "request_user_input",
  kind: "input",
  aliases: names,
  supports() {
    return true
  },
  declare() {
    return [
      {
        name: "request_user_input",
        description: "Ask the operator for structured input when the task cannot proceed safely without it.",
        inputSchema: {
          type: "object",
          properties: {
            questions: {
              type: "array",
            },
          },
          additionalProperties: true,
        },
        metadata: {
          tool_kind: "input",
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
        kind: "input_request",
        summary: "User input requested",
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
        kind: "input_response",
        summary: result.summary ?? "User input received",
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
