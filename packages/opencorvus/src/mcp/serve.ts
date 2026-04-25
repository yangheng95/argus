import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { Instance } from "@/project/instance"
import { ToolRegistry } from "@/tool/registry"
import { Session } from "@/session"
import { Installation } from "@/installation"
import { PermissionNext } from "@/permission/next"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import type { Message } from "@/session"
import { MCP } from "@/mcp"
import { Bus } from "@/bus"
import path from "path"
import z from "zod"

const log = Log.create({ service: "mcp.serve" })

const EXECUTOR_MODEL = {
  providerID: "codex",
  modelID: "gpt-5.3-codex",
}

const TOOLSET = z.enum(["executor"])
type Toolset = z.infer<typeof TOOLSET>

const EXECUTOR_TOOLS = {
  bash: {
    name: "shell_command",
    annotations: {
      destructive: true,
      openWorld: true,
    },
  },
  read: {
    name: "read_file",
    annotations: {
      readOnly: true,
    },
  },
  glob: {
    name: "find_files",
    annotations: {
      readOnly: true,
    },
  },
  search_code: {
    name: "search_code",
    annotations: {
      readOnly: true,
    },
  },
  apply_patch: {
    name: "apply_patch",
    annotations: {
      destructive: true,
    },
  },
  webfetch: {
    name: "fetch_url",
    annotations: {
      readOnly: true,
      openWorld: true,
    },
  },
  websearch: {
    name: "web_search",
    annotations: {
      readOnly: true,
      openWorld: true,
    },
  },
  memory: {
    name: "memory",
    annotations: {
      destructive: true,
    },
  },
  task_report: {
    name: "task_report",
    annotations: {},
  },
} as const

type ExecutorToolID = keyof typeof EXECUTOR_TOOLS

export namespace MCPServe {
  export const Toolset = TOOLSET

  export function command(cwd: string) {
    return {
      name: "opencorvus",
      command: process.execPath,
      args: [path.resolve(import.meta.dir, "..", "..", "src", "index.ts"), "mcp", "serve", "--cwd", cwd, "--toolset", "executor"],
      env: {} as Record<string, string>,
    }
  }

  export async function toolDefinitions(toolset: Toolset) {
    const tools = await runtimeTools(toolset)
    return [
      ...tools.map((item) => ({
        name: item.name,
        description: item.description,
        inputSchema: toolSchema(item.parameters),
        metadata: {
          surface: "mcp",
          original_tool_id: item.id,
        },
      })),
      ...(await MCP.serverTools()).map((item) => ({
        name: item.key,
        description: item.description,
        inputSchema: item.inputSchema,
        metadata: {
          surface: "mcp",
          proxied_client: item.client,
          proxied_tool: item.name,
        },
      })),
    ]
  }

  export async function serve(raw: {
    cwd: string
    toolset: Toolset
  }) {
    const input = z.object({
      cwd: z.string(),
      toolset: TOOLSET,
    }).parse(raw)

    await Instance.provide({
      directory: input.cwd,
      fn: async () => {
        const session = await Session.createNext({
          kind: "assistant",
          title: `MCP ${input.toolset}`,
          directory: input.cwd,
        })
        const approved: PermissionNext.Ruleset = []
        const tools = await runtimeTools(input.toolset, session.id, approved)
        const byName = new Map<string, (typeof tools)[number]>(tools.map((item) => [item.name, item]))
        const server = new McpServer({
          name: "opencorvus",
          version: Installation.VERSION,
        })
        await Promise.all([
          MCP.serverTools(),
          MCP.serverPrompts(),
          MCP.serverResources(),
        ]).catch((error) => {
          log.warn("mcp serve prewarm failed", { error: String(error) })
        })
        server.server.registerCapabilities({
          tools: {
            listChanged: true,
          },
          prompts: {
            listChanged: true,
          },
          resources: {
            listChanged: true,
          },
        })
        server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: [
            ...tools.map((item) => ({
              name: item.name,
              description: item.description,
              inputSchema: toolSchema(item.parameters),
              annotations: item.annotations,
              _meta: {
                surface: "mcp",
                original_tool_id: item.id,
              },
            })),
            ...(await MCP.serverTools()).map((item) => ({
              name: item.key,
              description: item.description,
              inputSchema: item.inputSchema,
              annotations: item.annotations,
              _meta: {
                surface: "mcp",
                proxied_client: item.client,
                proxied_tool: item.name,
              },
            })),
          ],
        }))
        server.server.setRequestHandler(CallToolRequestSchema, async (request, _extra) => {
          const args =
            request.params.arguments && typeof request.params.arguments === "object" && !Array.isArray(request.params.arguments)
              ? request.params.arguments as Record<string, unknown>
              : {}
          const local = byName.get(request.params.name)
          if (local) return executeLocal(server, local, session.id, approved, args)
          const proxy = await MCP.serverTools().then((items) => items.find((item) => item.key === request.params.name))
          if (proxy) return MCP.callTool({ key: proxy.key, args }) as any
          throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found`)
        })
        server.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
          prompts: (await MCP.serverPrompts()).map((item) => ({
            name: item.key,
            title: item.title,
            description: item.description,
            arguments: item.arguments,
            _meta: {
              surface: "mcp",
              proxied_client: item.client,
              proxied_prompt: item.name,
            },
          })),
        }))
        server.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
          const proxy = await MCP.serverPrompts().then((items) => items.find((item) => item.key === request.params.name))
          if (!proxy) throw new McpError(ErrorCode.InvalidParams, `Prompt ${request.params.name} not found`)
          const result = await MCP.getPrompt(proxy.client, proxy.name, request.params.arguments)
          if (!result) throw new McpError(ErrorCode.InternalError, `Prompt ${proxy.name} failed`)
          return result
        })
        server.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
          resources: (await MCP.serverResources()).map((item) => ({
            uri: resourceUri(item.key),
            name: item.name,
            title: item.title,
            description: item.description,
            mimeType: item.mimeType,
            _meta: {
              surface: "mcp",
              proxied_client: item.client,
              proxied_uri: item.uri,
            },
          })),
        }))
        server.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
          const key = resourceKey(request.params.uri)
          if (!key) throw new McpError(ErrorCode.InvalidParams, `Resource ${request.params.uri} not found`)
          const proxy = await MCP.serverResources().then((items) => items.find((item) => item.key === key))
          if (!proxy) throw new McpError(ErrorCode.InvalidParams, `Resource ${request.params.uri} not found`)
          const result = await MCP.readResource(proxy.client, proxy.uri)
          if (!result) throw new McpError(ErrorCode.InternalError, `Resource ${proxy.uri} failed`)
          return {
            ...result,
            contents: result.contents.map((item) => ({
              ...item,
              uri: resourceUri(proxy.key),
            })),
          }
        })
        const unsubscribeTools = Bus.subscribe(MCP.ToolsChanged, () => server.sendToolListChanged())
        const unsubscribePrompts = Bus.subscribe(MCP.PromptsChanged, () => server.sendPromptListChanged())
        const unsubscribeResources = Bus.subscribe(MCP.ResourcesChanged, () => server.sendResourceListChanged())

        const transport = new StdioServerTransport()
        await server.connect(transport)
        log.info("mcp server connected", { cwd: input.cwd, toolset: input.toolset, tools: tools.length })
        process.stdin.resume()
        try {
          await new Promise<void>((resolve, reject) => {
            transport.onclose = resolve
            transport.onerror = reject
            process.stdin.once("end", resolve)
            process.stdin.once("close", resolve)
          })
        } finally {
          unsubscribeTools?.()
          unsubscribePrompts?.()
          unsubscribeResources?.()
          await server.close().catch(() => undefined)
          await Session.remove(session.id).catch(() => undefined)
        }
      },
    })
  }
}

async function runtimeTools(toolset: Toolset, sessionID = "ses_mcp", approved: PermissionNext.Ruleset = []) {
  const ids = toolset === "executor" ? Object.keys(EXECUTOR_TOOLS) as ExecutorToolID[] : []
  const tools = await ToolRegistry.tools(EXECUTOR_MODEL)
  return tools
    .filter((item): item is (typeof tools)[number] & { id: ExecutorToolID } => ids.includes(item.id as ExecutorToolID))
    .map((item) => ({
      ...item,
      name: EXECUTOR_TOOLS[item.id].name,
      annotations: EXECUTOR_TOOLS[item.id].annotations,
      run: (server: McpServer, args: Record<string, unknown>) => executeLocal(server, item, sessionID, approved, args),
    }))
}

function attachmentSummary(input: Array<{ filename?: string; mime?: string }> | undefined) {
  if (!input || input.length === 0) return ""
  const items = input.map((item) => item.filename || item.mime || "attachment")
  return `Attachments: ${items.join(", ")}`
}

function toolSchema(schema: z.ZodType) {
  const json = z.toJSONSchema(schema) as Record<string, unknown>
  if (json.type === "object") return json
  return {
    type: "object",
    ...(Array.isArray(json.required) ? { required: json.required } : {}),
    ...(json.properties && typeof json.properties === "object" ? { properties: json.properties } : { properties: {} }),
    ...(json.anyOf ? { anyOf: json.anyOf } : {}),
    ...(json.oneOf ? { oneOf: json.oneOf } : {}),
    ...(json.allOf ? { allOf: json.allOf } : {}),
    additionalProperties: json.additionalProperties ?? true,
  } as Record<string, unknown>
}

async function ask(
  server: McpServer,
  approved: PermissionNext.Ruleset,
  request: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">,
) {
  const allowed = request.patterns.every((pattern) => PermissionNext.evaluate(request.permission, pattern, approved).action === "allow")
  if (allowed) return

  const diff = typeof request.metadata?.diff === "string" ? request.metadata.diff.slice(0, 4000) : ""
  const filepath = typeof request.metadata?.filepath === "string" ? request.metadata.filepath : ""
  const message = [
    `OpenCorvus requires permission for: ${request.permission}`,
    request.patterns.length > 0 ? `Patterns: ${request.patterns.join(", ")}` : "",
    filepath ? `Path: ${filepath}` : "",
    diff ? `Preview:\n${diff}` : "",
  ].filter(Boolean).join("\n\n")

  const result = await server.server.elicitInput({
    mode: "form",
    message,
    requestedSchema: {
      type: "object",
      properties: {
        decision: {
          type: "string",
          enum: ["once", "always", "reject"],
          title: "Decision",
          description: "Allow once, always allow for this session, or reject.",
        },
      },
      required: ["decision"],
    },
  })

  if (result.action !== "accept" || !result.content || typeof result.content !== "object") {
    throw new PermissionNext.RejectedError()
  }

  const decision = (result.content as Record<string, unknown>).decision
  if (decision === "once") return
  if (decision === "always") {
    for (const pattern of request.always.length > 0 ? request.always : request.patterns) {
      approved.push({
        permission: request.permission,
        pattern,
        action: "allow",
      })
    }
    return
  }
  throw new PermissionNext.RejectedError()
}

function resourceUri(key: string) {
  return `opencorvus://mcp-resource/${encodeURIComponent(key)}`
}

function resourceKey(uri: string) {
  const prefix = "opencorvus://mcp-resource/"
  if (!uri.startsWith(prefix)) return ""
  return decodeURIComponent(uri.slice(prefix.length))
}

async function executeLocal(
  server: McpServer,
  item: Awaited<ReturnType<typeof ToolRegistry.tools>>[number],
  sessionID: string,
  approved: PermissionNext.Ruleset,
  args: Record<string, unknown>,
) {
  let title = ""
  let metadata: Record<string, unknown> = {}
  const result = await item.execute(args, {
    sessionID,
    messageID: Identifier.ascending("message"),
    callID: Identifier.ascending("part"),
    agent: "executor-mcp",
    abort: AbortSignal.any([]),
    extra: {},
    messages: [] as Message.WithParts[],
    metadata(input) {
      if (input.title) title = input.title
      if (input.metadata) metadata = input.metadata
    },
    ask: (request) => ask(server, approved, request),
  })

  const header = title || result.title
  const body = [header, result.output, attachmentSummary(result.attachments)].filter(Boolean).join("\n\n")
  return {
    content: [
      {
        type: "text",
        text: body,
      },
    ],
    structuredContent: {
      title: header,
      metadata: {
        ...metadata,
        ...result.metadata,
      },
    },
  }
}
