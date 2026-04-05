import z from "zod"
import { asSchema, jsonSchema, tool, type Tool as AITool, type ToolCallOptions } from "ai"
import { Log } from "../util/log"
import { Identifier } from "../id/id"
import { Message } from "./message"
import { Session } from "."
import { ProviderTransform } from "../provider/transform"
import { Plugin } from "../plugin"
import { ToolRegistry } from "../tool/registry"
import { MCP } from "../mcp"
import { Truncate } from "../tool/truncation"
import { Tool } from "../tool/tool"
import { PermissionNext } from "../permission/next"
import type { Agent } from "../agent/agent"
import type { Provider } from "../provider/provider"
import type { SessionProcessor } from "./processor"

const log = Log.create({ service: "session.tool-resolver" })

type ResolveToolsInput = {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  tools?: Record<string, boolean>
  processor: SessionProcessor.Info
  bypassAgentCheck: boolean
  messages: Message.WithParts[]
  extra?: Record<string, any>
}

function toolContext(input: ResolveToolsInput) {
  return (args: unknown, options: ToolCallOptions): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal!,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    extra: {
      model: input.model,
      bypassAgentCheck: input.bypassAgentCheck,
      ...(input.agent.name === "plan" || input.agent.name === "spec" || input.extra?.planMode === true
        ? { planMode: true }
        : {}),
      ...(input.extra ?? {}),
    },
    agent: input.agent.name,
    messages: input.messages,
    metadata: async (val: { title?: string; metadata?: Record<string, any> }) => {
      const match = input.processor.partFromToolCall(options.toolCallId)
      if (match && match.state.status === "running") {
        await Session.updatePart({
          ...match,
          state: {
            title: val.title,
            metadata: val.metadata,
            status: "running",
            input: args as Record<string, any>,
            time: {
              start: Date.now(),
            },
          },
        })
      }
    },
    async ask(req) {
      await PermissionNext.ask({
        ...req,
        sessionID: input.session.id,
        tool: { messageID: input.processor.message.id, callID: options.toolCallId },
        ruleset: PermissionNext.merge(input.agent.permission, input.session.permission ?? []),
      })
    },
  })
}

function attachFiles(
  attachments: Omit<Message.FilePart, "id" | "sessionID" | "messageID">[] | undefined,
  sessionID: string,
  messageID: string,
) {
  return attachments?.map((attachment) => ({
    ...attachment,
    id: Identifier.ascending("part"),
    sessionID,
    messageID,
  }))
}

export async function resolveTools(input: ResolveToolsInput) {
  using _ = log.time("resolveTools")
  const tools: Record<string, AITool> = {}
  const context = toolContext(input)

  const allRegistryTools = await ToolRegistry.tools(
    { modelID: input.model.api.id, providerID: input.model.providerID },
    input.agent,
  )
  // When a tools filter is provided (e.g. from ControlMessage), only include
  // tools explicitly set to true.  This prevents sending 30+ tool definitions
  // to the LLM when only a small subset is needed (e.g. panel-only mode).
  const filteredTools = input.tools
    ? allRegistryTools.filter((t) => input.tools![t.id] === true)
    : allRegistryTools

  for (const item of filteredTools) {
    const schema = ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters))
    tools[item.id] = tool({
      id: item.id as any,
      description: item.description,
      inputSchema: jsonSchema(schema as any),
      async execute(args, options) {
        const ctx = context(args, options)
        await Plugin.trigger(
          "tool.execute.before",
          {
            tool: item.id,
            sessionID: ctx.sessionID,
            callID: ctx.callID,
          },
          {
            args,
          },
        )
        const result = await item.execute(args, ctx)
        const output = {
          ...result,
          attachments: attachFiles(result.attachments, ctx.sessionID, input.processor.message.id),
        }
        await Plugin.trigger(
          "tool.execute.after",
          {
            tool: item.id,
            sessionID: ctx.sessionID,
            callID: ctx.callID,
            args,
          },
          output,
        )
        return output
      },
    })
  }

  for (const [key, item] of Object.entries(await MCP.tools())) {
    const execute = item.execute
    if (!execute) continue

    const transformed = ProviderTransform.schema(input.model, asSchema(item.inputSchema).jsonSchema)
    tools[key] = {
      ...item,
      inputSchema: jsonSchema(transformed),
      execute: async (args, options) => {
        const ctx = context(args, options)

        await Plugin.trigger(
          "tool.execute.before",
          {
            tool: key,
            sessionID: ctx.sessionID,
            callID: options.toolCallId,
          },
          {
            args,
          },
        )

        await ctx.ask({
          permission: key,
          metadata: {},
          patterns: ["*"],
          always: ["*"],
        })

        const result = await execute(args, options)

        await Plugin.trigger(
          "tool.execute.after",
          {
            tool: key,
            sessionID: ctx.sessionID,
            callID: options.toolCallId,
            args,
          },
          result,
        )

        const textParts: string[] = []
        const attachments: Omit<Message.FilePart, "id" | "sessionID" | "messageID">[] = []

        for (const contentItem of result.content) {
          if (contentItem.type === "text") {
            textParts.push(contentItem.text)
            continue
          }
          if (contentItem.type === "image") {
            attachments.push({
              type: "file",
              mime: contentItem.mimeType,
              url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
            })
            continue
          }
          if (contentItem.type !== "resource") {
            continue
          }
          const resource = contentItem.resource
          if (resource.text) {
            textParts.push(resource.text)
          }
          if (!resource.blob) {
            continue
          }
          attachments.push({
            type: "file",
            mime: resource.mimeType ?? "application/octet-stream",
            url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
            filename: resource.uri,
          })
        }

        const truncated = await Truncate.output(textParts.join("\n\n"), {}, input.agent)
        const metadata = {
          ...(result.metadata ?? {}),
          truncated: truncated.truncated,
          ...(truncated.truncated ? { outputPath: truncated.outputPath } : {}),
        }

        return {
          title: "",
          metadata,
          output: truncated.content,
          attachments: attachFiles(attachments, ctx.sessionID, input.processor.message.id),
          content: result.content,
        }
      },
    }
  }

  return tools
}
