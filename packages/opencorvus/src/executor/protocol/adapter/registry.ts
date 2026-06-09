import { CodingTool, type CodingToolInfo, type ExecutorNameInfo } from "../../contract"
import { ProtocolCapabilities, ProtocolSettings } from "../model"
import type { ToolAdapter, ToolCallInfo, ToolContextInfo, ToolDefinitionInfo, ToolResultInfo } from "../tool"
import { ApprovalToolAdapter } from "./approval"
import { RequestUserInputToolAdapter } from "./request-user-input"
import { ShellToolAdapter } from "./shell"
import { StructuredOutputToolAdapter } from "./structured-output"

const adapters: ToolAdapter[] = [
  ApprovalToolAdapter,
  RequestUserInputToolAdapter,
  ShellToolAdapter,
  StructuredOutputToolAdapter,
]

export namespace ToolAdapterRegistry {
  export function all() {
    return adapters
  }

  export function context(input: {
    provider: ExecutorNameInfo
    capabilities: unknown
    settings?: unknown
  }): ToolContextInfo {
    return {
      provider: input.provider,
      capabilities: ProtocolCapabilities.parse(input.capabilities),
      settings: input.settings ? ProtocolSettings.parse(input.settings) : undefined,
    }
  }

  export async function declare(input: ToolContextInfo) {
    const result: ToolDefinitionInfo[] = []
    for (const adapter of adapters) {
      if (!adapter.supports(input)) continue
      const declared = await adapter.declare(input)
      if (!declared) continue
      result.push(...declared)
    }
    return result
  }

  export function declareSync(input: ToolContextInfo) {
    const result: ToolDefinitionInfo[] = []
    for (const adapter of adapters) {
      if (!adapter.supports(input)) continue
      const declared = adapter.declare(input)
      if (declared instanceof Promise) {
        throw new Error(`tool adapter ${adapter.id} requires async declaration but sync declaration was requested`)
      }
      if (!declared) continue
      result.push(...declared)
    }
    return result
  }

  export function toCodingTools(input: ToolContextInfo) {
    return declareSync(input).map((item) =>
      CodingTool.parse({
        type: "function",
        name: item.name,
        description: item.description,
        inputSchema: item.inputSchema,
      }),
    ) satisfies CodingToolInfo[]
  }

  export function matchCall(call: ToolCallInfo) {
    return adapters.find((adapter) => adapter.accept(call))
  }

  export function matchResult(result: ToolResultInfo) {
    return adapters.find((adapter) => {
      if (result.metadata?.adapter === adapter.id) return true
      const hint = typeof result.metadata?.tool_name === "string" ? result.metadata.tool_name : ""
      return hint
        ? adapter.accept({
            id: result.id,
            name: hint,
            kind: adapter.kind,
            refs: result.refs,
            metadata: result.metadata,
          })
        : false
    })
  }

  export function classify(name: string) {
    const adapter = adapters.find((item) =>
      item.aliases?.some((alias) => {
        const value = name.trim().toLowerCase()
        return value === alias || value.includes(alias)
      }),
    )
    return adapter
  }
}
