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
import { Session } from "@/session"
import { Installation } from "@/installation"
import { PermissionNext } from "@/permission/next"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import type { Message } from "@/session"
import { Tool } from "@/tool/tool"
import { MemoryTool } from "@/tool/memory"
import { TaskReportTool } from "@/tool/task-report"
import { SkillTool } from "@/tool/skill"
import { MCP } from "@/mcp"
import { Bus } from "@/bus"
import path from "path"
import z from "zod"
import { WEBPAGE_EVIDENCE_TOOL_IDS } from "@/webpage-evidence/tools/ids"

const log = Log.create({ service: "mcp.serve" })

const TOOLSET = z.enum(["executor"])
type Toolset = z.infer<typeof TOOLSET>
const DEFAULT_SERVER_NAME = "opencorvus"

// External coding executors (claude-code, codex) ship with their own
// shell/read/edit/write/glob/grep/web-fetch/web-search tools. Re-exposing
// those over MCP creates a double-source surface (CLAUDE.md rule 22) and
// confuses the LLM about which one to call. Only expose the OpenCorvus
// toolset that the host environment doesn't provide natively. Mirror tools are
// intentionally absent here: frontend-design owns mirror extraction, and
// external coding executors implement the persisted frontend template rather than calling
// webpage_* / figma_* through MCP.
const EXECUTOR_TOOLS = {
  skill: {
    name: "skill",
    annotations: {},
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
const EXECUTOR_TOOL_IMPLS: Record<ExecutorToolID, Tool.Info> = {
  skill: SkillTool,
  memory: MemoryTool,
  task_report: TaskReportTool,
}

const EXECUTOR_PROXIED_TOOL_DENY_IDS = new Set([
  ...WEBPAGE_EVIDENCE_TOOL_IDS,
  "web_clone_prepare_context",
  "web_clone_generate_source_project",
])

export namespace MCPServe {
  export const Toolset = TOOLSET
  export const ServerName = DEFAULT_SERVER_NAME

  export function command(
    cwd: string,
    runtime: {
      execPath?: string
      moduleDir?: string
    } = {},
  ) {
    const execPath = runtime.execPath ?? process.execPath
    const moduleDir = runtime.moduleDir ?? import.meta.dir
    const args = isBunRuntime(execPath)
      ? [path.resolve(moduleDir, "stdio.ts"), "--cwd", cwd, "--toolset", "executor"]
      : ["mcp", "serve", "--cwd", cwd, "--toolset", "executor"]

    return {
      name: DEFAULT_SERVER_NAME,
      command: execPath,
      args,
    }
  }

  export function executorToolNames() {
    return Object.keys(EXECUTOR_TOOLS).map((id) => EXECUTOR_TOOLS[id as ExecutorToolID].name)
  }

  export function codingExecutorToolName(toolName: string, serverName = DEFAULT_SERVER_NAME) {
    return `mcp__${mcpSafeName(serverName)}__${mcpSafeName(toolName)}`
  }

  export function normalizeCodingExecutorToolName(toolName: string, serverName = DEFAULT_SERVER_NAME) {
    const prefix = `mcp__${mcpSafeName(serverName)}__`
    return toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName
  }

  export function codingExecutorPromptSection(serverName = DEFAULT_SERVER_NAME) {
    const aliases = executorToolNames()
      .map((name) => `- ${name} => ${codingExecutorToolName(name, serverName)}`)
      .join("\n")
    return [
      "# OpenCorvus MCP tools for external coding executors",
      "",
      `External coding executors expose the OpenCorvus executor MCP server as ${serverName}. When task prompts, skills, or architect contracts mention a bare OpenCorvus tool name, call the exact MCP-prefixed tool name below.`,
      "",
      aliases,
      "",
      "Mirror extraction artifacts are produced by the upstream frontend_design stage. If the build prompt needs facts that are absent from the persisted frontend template, report the missing frontend-design evidence instead of fabricating mirror artifacts.",
    ].join("\n")
  }

  export async function toolDefinitions(
    toolset: Toolset,
    options: {
      includeRuntime?: boolean
      includeProxied?: boolean
      proxiedTools?: Awaited<ReturnType<typeof MCP.serverTools>>
    } = {},
  ) {
    const tools = options.includeRuntime === false ? [] : await runtimeTools(toolset)
    const proxiedTools = filterExecutorProxiedTools(
      options.proxiedTools ?? (options.includeProxied === false ? [] : await MCP.serverTools()),
    )
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
      ...proxiedTools.map((item) => ({
        name: item.key,
        description: item.description,
        inputSchema: inputObjectSchema(item.inputSchema),
        metadata: {
          surface: "mcp",
          proxied_client: item.client,
          proxied_tool: item.name,
        },
      })),
    ]
  }

  export async function serve(raw: { cwd: string; toolset: Toolset }) {
    const input = z
      .object({
        cwd: z.string(),
        toolset: TOOLSET,
      })
      .parse(raw)

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
          name: DEFAULT_SERVER_NAME,
          version: Installation.VERSION,
        })
        await Promise.all([MCP.serverTools(), MCP.serverPrompts(), MCP.serverResources()]).catch((error) => {
          log.warn("mcp serve prewarm failed", { error: String(error) })
        })
        server.server.registerCapabilities({
          tools: { listChanged: true },
          prompts: { listChanged: true },
          resources: { listChanged: true },
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
            ...filterExecutorProxiedTools(await MCP.serverTools()).map((item) => ({
              name: item.key,
              description: item.description,
              inputSchema: inputObjectSchema(item.inputSchema),
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
            request.params.arguments &&
            typeof request.params.arguments === "object" &&
            !Array.isArray(request.params.arguments)
              ? (request.params.arguments as Record<string, unknown>)
              : {}
          const local = byName.get(request.params.name)
          if (local) return executeLocal(server, local, session.id, approved, args)
          const proxy = await MCP.serverTools().then((items) =>
            filterExecutorProxiedTools(items).find((item) => item.key === request.params.name)
          )
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
          const proxy = await MCP.serverPrompts().then((items) =>
            items.find((item) => item.key === request.params.name),
          )
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

function filterExecutorProxiedTools<T extends { key: string; name: string }>(tools: T[]): T[] {
  return tools.filter((tool) => !isExecutorDeniedProxiedTool(tool))
}

function isExecutorDeniedProxiedTool(tool: { key: string; name: string }): boolean {
  for (const id of EXECUTOR_PROXIED_TOOL_DENY_IDS) {
    if (tool.key === id || tool.name === id) return true
    if (tool.key.endsWith(`_${id}`) || tool.name.endsWith(`_${id}`)) return true
  }
  return false
}

function isBunRuntime(execPath: string) {
  const executable = path.basename(execPath).toLowerCase().replace(/\.exe$/, "")
  return executable === "bun"
}

function mcpSafeName(input: string) {
  return input.replace(/[^A-Za-z0-9_-]/g, "_")
}

async function runtimeTools(toolset: Toolset, sessionID = "ses_mcp", approved: PermissionNext.Ruleset = []) {
  const ids = toolset === "executor" ? (Object.keys(EXECUTOR_TOOLS) as ExecutorToolID[]) : []
  return Promise.all(
    ids.map(async (id) => {
      const item = EXECUTOR_TOOL_IMPLS[id]
      const initialized = await item.init()
      return {
        id: item.id,
        ...initialized,
        name: EXECUTOR_TOOLS[id].name,
        annotations: EXECUTOR_TOOLS[id].annotations,
        run: (server: McpServer, args: Record<string, unknown>) =>
          executeLocal(server, { id: item.id, ...initialized }, sessionID, approved, args),
      }
    }),
  )
}

function attachmentSummary(input: Array<{ filename?: string; mime?: string }> | undefined) {
  if (!input || input.length === 0) return ""
  const items = input.map((item) => item.filename || item.mime || "attachment")
  return `Attachments: ${items.join(", ")}`
}

function toolSchema(schema: z.ZodType) {
  const json = z.toJSONSchema(schema) as Record<string, unknown>
  return inputObjectSchema(json)
}

function inputObjectSchema(input: Record<string, unknown>) {
  const json =
    input.type === "object"
      ? { ...input }
      : {
          type: "object",
          ...(Array.isArray(input.required) ? { required: input.required } : {}),
          ...(input.properties && typeof input.properties === "object"
            ? { properties: input.properties }
            : { properties: {} }),
          ...(input.anyOf ? { anyOf: input.anyOf } : {}),
          ...(input.oneOf ? { oneOf: input.oneOf } : {}),
          ...(input.allOf ? { allOf: input.allOf } : {}),
          additionalProperties: input.additionalProperties ?? true,
        }
  return flattenTopLevelCombinators(json)
}

function flattenTopLevelCombinators(input: Record<string, unknown>) {
  const anyOf = objectBranches(input.anyOf)
  const oneOf = objectBranches(input.oneOf)
  const allOf = objectBranches(input.allOf)
  if (anyOf.length === 0 && oneOf.length === 0 && allOf.length === 0) return input

  const output = { ...input }
  delete output.anyOf
  delete output.oneOf
  delete output.allOf

  const properties: Record<string, unknown> = {
    ...(isRecord(input.properties) ? input.properties : {}),
  }
  const required = new Set(arrayOfStrings(input.required))
  for (const item of requiredForUnion(anyOf)) required.add(item)
  for (const item of requiredForUnion(oneOf)) required.add(item)
  for (const branch of allOf) {
    for (const item of arrayOfStrings(branch.required)) required.add(item)
  }
  for (const branch of [...anyOf, ...oneOf, ...allOf]) {
    if (!isRecord(branch.properties)) continue
    for (const [key, value] of Object.entries(branch.properties)) {
      properties[key] = mergePropertySchema(properties[key], value)
    }
  }

  output.type = "object"
  output.properties = properties
  output.required = [...required]
  output.additionalProperties = input.additionalProperties ?? true
  return output
}

function requiredForUnion(branches: Record<string, unknown>[]) {
  if (branches.length === 0) return []
  const counts = new Map<string, number>()
  for (const branch of branches) {
    for (const item of arrayOfStrings(branch.required)) {
      counts.set(item, (counts.get(item) ?? 0) + 1)
    }
  }
  return [...counts.entries()].filter(([, count]) => count === branches.length).map(([key]) => key)
}

function objectBranches(input: unknown) {
  if (!Array.isArray(input)) return []
  return input.filter((item): item is Record<string, unknown> => isRecord(item) && item.type === "object")
}

function mergePropertySchema(left: unknown, right: unknown): unknown {
  if (!isRecord(left)) return normalizePropertySchema(right)
  if (!isRecord(right)) return normalizePropertySchema(left)
  const values = [...literalValues(left), ...literalValues(right)]
  if (values.length > 0) {
    const next = {
      ...left,
      ...right,
      type: left.type ?? right.type ?? "string",
      enum: [...new Set(values)],
    } as Record<string, unknown>
    delete next["const"]
    return {
      ...next,
    }
  }
  return {
    ...left,
    ...right,
  }
}

function normalizePropertySchema(input: unknown): unknown {
  if (!isRecord(input)) return input
  const values = literalValues(input)
  if (values.length === 0) return input
  const output = {
    ...input,
    enum: [...new Set(values)],
  } as Record<string, unknown>
  delete output["const"]
  return output
}

function literalValues(input: Record<string, unknown>) {
  const out: unknown[] = []
  if ("const" in input) out.push(input["const"])
  if (Array.isArray(input.enum)) out.push(...input.enum)
  return out
}

function arrayOfStrings(input: unknown) {
  return Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : []
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input)
}

async function ask(
  server: McpServer,
  approved: PermissionNext.Ruleset,
  request: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">,
) {
  const allowed = request.patterns.every(
    (pattern) => PermissionNext.evaluate(request.permission, pattern, approved).action === "allow",
  )
  if (allowed) return

  const diff = typeof request.metadata?.diff === "string" ? request.metadata.diff.slice(0, 4000) : ""
  const filepath = typeof request.metadata?.filepath === "string" ? request.metadata.filepath : ""
  const message = [
    `OpenCorvus requires permission for: ${request.permission}`,
    request.patterns.length > 0 ? `Patterns: ${request.patterns.join(", ")}` : "",
    filepath ? `Path: ${filepath}` : "",
    diff ? `Preview:\n${diff}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")

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
  item: Awaited<ReturnType<Tool.Info["init"]>> & { id: string },
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
      output: result.output,
      text: body,
      metadata: {
        ...metadata,
        ...result.metadata,
      },
    },
  }
}
