import { tool } from "ai"
import type { Tool } from "./tool"

type InitializedTool = Awaited<ReturnType<Tool.Info["init"]>>
type ToolExecutionResult = Awaited<ReturnType<InitializedTool["execute"]>>

type AiSdkExecutionOptions = {
  abortSignal?: AbortSignal
  opencorvus?: {
    sessionID?: unknown
    messageID?: unknown
    toolCallID?: unknown
  }
}

export type ToolInfoAiSdkAdapterInput = {
  info: Tool.Info
  agent: string
  taskID?: string
  signal?: AbortSignal
  initCtx?: Tool.InitContext
  beforeExecute?: (args: unknown) => void | Promise<void>
  afterExecute?: (args: unknown, result: ToolExecutionResult) => void | Promise<void>
  onExecuteError?: (args: unknown, error: unknown) => void | Promise<void>
}

export async function createAiSdkToolFromInfo(input: ToolInfoAiSdkAdapterInput) {
  const initialized = await input.info.init(input.initCtx)
  return tool({
    description: initialized.description,
    inputSchema: initialized.parameters,
    execute: async (args, options) => {
      const execution = requireAiSdkToolExecutionContext(options, input.info.id)
      const abort =
        (options as AiSdkExecutionOptions | undefined)?.abortSignal ?? input.signal ?? new AbortController().signal
      await input.beforeExecute?.(args)
      try {
        const result = await initialized.execute(args as never, {
          sessionID: execution.sessionID,
          messageID: execution.messageID,
          callID: execution.toolCallID,
          agent: input.agent,
          abort,
          messages: [],
          extra: { taskID: input.taskID },
          metadata: () => {},
          ask: async () => {},
        })
        await input.afterExecute?.(args, result)
        return result
      } catch (error) {
        await input.onExecuteError?.(args, error)
        throw error
      }
    },
  })
}

function requireAiSdkToolExecutionContext(options: unknown, toolName: string) {
  const meta = (options as AiSdkExecutionOptions | undefined)?.opencorvus
  const sessionID = typeof meta?.sessionID === "string" ? meta.sessionID : ""
  const messageID = typeof meta?.messageID === "string" ? meta.messageID : ""
  const toolCallID = typeof meta?.toolCallID === "string" ? meta.toolCallID : undefined
  if (!sessionID || !messageID) {
    throw new Error(
      `${toolName}: missing real tool execution identity; refusing to run because ownership cannot be tied to a persisted message.`,
    )
  }
  return { sessionID, messageID, toolCallID }
}
