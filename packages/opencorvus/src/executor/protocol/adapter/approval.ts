import type { ToolAdapter, ToolDefinitionInfo } from "../tool"

const names = [
  "approval",
  "commandexecutionrequestapproval",
  "filechangerequestapproval",
  "applypatchapproval",
  "can_use_tool",
]

export const ApprovalToolAdapter: ToolAdapter = {
  id: "approval",
  kind: "approval",
  aliases: names,
  supports() {
    return false
  },
  declare() {
    return undefined satisfies ToolDefinitionInfo[] | undefined
  },
  accept(call) {
    const value = call.name.trim().toLowerCase()
    return (this.aliases || []).some((item) => value === item || value.includes(item))
  },
  projectCall(call) {
    return [
      {
        provider: call.metadata?.provider as "opencorvus" | "codex" | "claude-code",
        kind: "approval_request",
        summary: "Approval requested",
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
        kind: "approval_response",
        summary: result.summary ?? "Approval resolved",
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
