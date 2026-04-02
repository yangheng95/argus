import z from "zod"
import { ExecutorName } from "../compat"
import { ProtocolCapabilities, ProtocolEvent, ProtocolRefs, ProtocolSettings, ProtocolToolKind } from "./model"

export const ToolDefinition = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type ToolDefinitionInfo = z.infer<typeof ToolDefinition>

export const ToolCall = z.object({
  id: z.string(),
  name: z.string(),
  kind: ProtocolToolKind,
  input: z.record(z.string(), z.unknown()).optional(),
  refs: ProtocolRefs.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
})
export type ToolCallInfo = z.infer<typeof ToolCall>

export const ToolResult = z.object({
  id: z.string(),
  output: z.record(z.string(), z.unknown()).optional(),
  summary: z.string().optional(),
  refs: ProtocolRefs.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
})
export type ToolResultInfo = z.infer<typeof ToolResult>

export const ToolContext = z.object({
  provider: ExecutorName,
  capabilities: ProtocolCapabilities,
  settings: ProtocolSettings.optional(),
})
export type ToolContextInfo = z.infer<typeof ToolContext>

export type ToolAdapter = {
  id: string
  kind: z.infer<typeof ProtocolToolKind>
  aliases?: string[]
  supports(input: ToolContextInfo): boolean
  declare(input: ToolContextInfo): Promise<ToolDefinitionInfo[] | undefined> | ToolDefinitionInfo[] | undefined
  accept(call: ToolCallInfo): boolean
  projectCall(call: ToolCallInfo): ProtocolEventInfo[]
  projectResult(result: ToolResultInfo): ProtocolEventInfo[]
}

type ProtocolEventInfo = z.infer<typeof ProtocolEvent>
