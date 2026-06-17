import type { ToolAdapter, ToolCallInfo, ToolContextInfo, ToolDefinitionInfo, ToolResultInfo } from "../tool"

const names = ["bash", "shell", "shell_command", "command", "exec", "command_execution"]

export const ShellToolAdapter: ToolAdapter = {
  id: "shell",
  kind: "shell",
  aliases: names,
  supports() {
    return true
  },
  declare() {
    return [
      {
        name: "shell_command",
        description: "Execute a shell command in the active workspace and return stdout/stderr and exit status.",
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "Shell command to execute in the active workspace.",
            },
            cwd: {
              type: "string",
              description: "Optional working directory for the shell command.",
            },
          },
          required: ["command"],
          additionalProperties: false,
        },
        metadata: {
          tool_kind: "shell",
        },
      },
    ] satisfies ToolDefinitionInfo[]
  },
  accept(call) {
    return matches(call.name, this.aliases || [])
  },
  projectCall(call) {
    return [
      {
        provider: call.metadata?.provider as "opencorvus" | "codex" | "claude-code",
        kind: "tool_call",
        summary: `Shell command: ${call.name}`,
        refs: call.refs,
        payload: {
          adapter: this.id,
          tool_kind: this.kind,
          name: call.name,
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
        summary: result.summary ?? "Shell command completed",
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

function matches(input: string, aliases: string[]) {
  const value = input.trim().toLowerCase()
  return aliases.some((item) => value === item || value.includes(item))
}
