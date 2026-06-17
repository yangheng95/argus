import z from "zod"
import { ExecutorName } from "../contract"

export const ProtocolTransportKind = z.enum(["inproc", "stdio", "ws", "http"])
export type ProtocolTransportKindInfo = z.infer<typeof ProtocolTransportKind>

export const ProtocolTransport = z.object({
  kind: ProtocolTransportKind,
  endpoint: z.string().optional(),
})
export type ProtocolTransportInfo = z.infer<typeof ProtocolTransport>

export const ProtocolToolKind = z.enum([
  "builtin",
  "dynamic",
  "approval",
  "input",
  "mcp",
  "shell",
  "patch",
  "read",
  "review",
  "plan",
  "structured_output",
  "unknown",
])
export type ProtocolToolKindInfo = z.infer<typeof ProtocolToolKind>

export const ProtocolRefs = z.object({
  provider_session_id: z.string().optional(),
  thread_id: z.string().optional(),
  turn_id: z.string().optional(),
  item_id: z.string().optional(),
  response_id: z.string().optional(),
  conversation_id: z.string().optional(),
  queue_task_id: z.string().optional(),
  call_id: z.string().optional(),
})
export type ProtocolRefsInfo = z.infer<typeof ProtocolRefs>

export const ProtocolCapabilities = z.object({
  stream: z.boolean().default(false),
  resume: z.boolean().default(false),
  interrupt: z.boolean().default(false),
  builtin_tools: z.boolean().default(false),
  custom_tools: z.boolean().default(false),
  structured_output: z.boolean().default(false),
  approvals: z.array(z.string()).default([]),
  reasoning: z.boolean().default(false),
  plan_updates: z.boolean().default(false),
  diff_updates: z.boolean().default(false),
  mcp: z.boolean().default(false),
  usage: z.boolean().default(false),
  realtime: z.boolean().default(false),
  spec_generation: z.boolean().default(false),
  plan_generation: z.boolean().default(false),
  tool_kinds: ProtocolToolKind.array().default([]),
})
export type ProtocolCapabilitiesInfo = z.infer<typeof ProtocolCapabilities>

export const ProtocolSettings = z.object({
  model: z.string().optional(),
  cwd: z.string().optional(),
  system: z.string().optional(),
  max_turns: z.number().int().positive().optional(),
  structured_output_schema: z.record(z.string(), z.unknown()).optional(),
  profile: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type ProtocolSettingsInfo = z.infer<typeof ProtocolSettings>

export const ProtocolEventKind = z.enum([
  "message_delta",
  "reasoning_delta",
  "plan_delta",
  "diff_delta",
  "tool_call",
  "tool_result",
  "approval_request",
  "approval_response",
  "input_request",
  "input_response",
  "usage",
  "lifecycle",
  "error",
  "done",
])
export type ProtocolEventKindInfo = z.infer<typeof ProtocolEventKind>

export const ProtocolEvent = z.object({
  provider: ExecutorName,
  kind: ProtocolEventKind,
  summary: z.string().optional(),
  refs: ProtocolRefs.optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
  observed_at: z.number().int().optional(),
})
export type ProtocolEventInfo = z.infer<typeof ProtocolEvent>

export const ProtocolInfo = z.object({
  provider: ExecutorName,
  protocol: z.string(),
  version: z.string(),
  transport: ProtocolTransport,
  capabilities: ProtocolCapabilities,
})
export type ProtocolInfo = z.infer<typeof ProtocolInfo>

export function protocolInfo(provider: z.infer<typeof ExecutorName>) {
  if (provider === "codex") {
    const appServer = process.env.OPENCORVUS_EXECUTOR_CODEX_PROTOCOL !== "cli"
    return ProtocolInfo.parse({
      provider,
      protocol: appServer ? "codex-app-server" : "codex-cli-json",
      version: appServer ? "v2" : "v1",
      transport: { kind: "stdio" },
      capabilities: {
        stream: true,
        resume: true,
        interrupt: appServer,
        builtin_tools: true,
        custom_tools: appServer,
        structured_output: appServer,
        approvals: appServer ? ["command", "file_change", "patch", "user_input", "dynamic_tool"] : [],
        reasoning: appServer,
        plan_updates: appServer,
        diff_updates: appServer,
        mcp: appServer,
        usage: appServer,
        realtime: appServer,
        spec_generation: true,
        plan_generation: true,
        tool_kinds: appServer
          ? [
              "builtin",
              "dynamic",
              "approval",
              "input",
              "mcp",
              "shell",
              "patch",
              "read",
              "review",
              "plan",
              "structured_output",
            ]
          : ["builtin", "shell", "patch", "read", "unknown"],
      },
    })
  }
  if (provider === "claude-code") {
    return ProtocolInfo.parse({
      provider,
      protocol: "claude-agent-sdk",
      version: "0.2",
      transport: { kind: "inproc" },
      capabilities: {
        stream: true,
        resume: true,
        interrupt: true,
        builtin_tools: true,
        custom_tools: false,
        structured_output: true,
        approvals: ["permission", "elicitation"],
        reasoning: true,
        plan_updates: false,
        diff_updates: false,
        mcp: true,
        usage: true,
        realtime: false,
        spec_generation: true,
        plan_generation: true,
        tool_kinds: [
          "builtin",
          "approval",
          "input",
          "mcp",
          "shell",
          "patch",
          "read",
          "review",
          "structured_output",
          "unknown",
        ],
      },
    })
  }
  return ProtocolInfo.parse({
    provider,
    protocol: "session-prompt",
    version: "v1",
    transport: { kind: "inproc" },
    capabilities: {
      stream: true,
      resume: true,
      interrupt: true,
      builtin_tools: true,
      custom_tools: true,
      structured_output: true,
      approvals: ["permission", "question"],
      reasoning: true,
      plan_updates: true,
      diff_updates: true,
      mcp: true,
      usage: false,
      realtime: false,
      spec_generation: false,
      plan_generation: false,
      tool_kinds: [
        "builtin",
        "dynamic",
        "approval",
        "input",
        "mcp",
        "shell",
        "patch",
        "read",
        "review",
        "plan",
        "structured_output",
      ],
    },
  })
}
