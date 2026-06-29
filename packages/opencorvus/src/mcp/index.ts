import { dynamicTool, type Tool, jsonSchema, type JSONSchema7 } from "ai"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import {
  CallToolResultSchema,
  type Tool as MCPToolDef,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { NamedError } from "@opencorvus-ai/util/error"
import z from "zod/v4"
import { NotFoundError } from "../storage/db"
import { Instance, lazyInstanceState } from "../project/instance"
import { Installation } from "../installation"
import { McpOAuthProvider } from "./oauth-provider"
import { McpOAuthCallback } from "./oauth-callback"
import { McpAuth } from "./auth"
import { BrowserMCPBuiltin } from "./browser/builtin"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "@/bus"
import open from "open"
import { entries, values as objectValues } from "@/util/object"
import { ServeRuntimeMemoryMetrics } from "@/runtime/memory-metrics"
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js"

export namespace MCP {
  const log = Log.create({ service: "mcp" })
  const DEFAULT_TIMEOUT = 30_000

  ServeRuntimeMemoryMetrics.register({
    id: "host-mcp",
    snapshot: () => connectionStats(),
  })

  export const Resource = z
    .object({
      name: z.string(),
      uri: z.string(),
      description: z.string().optional(),
      mimeType: z.string().optional(),
      client: z.string(),
    })
    .meta({ ref: "McpResource" })
  export type Resource = z.infer<typeof Resource>

  export const ToolsChanged = BusEvent.define(
    "mcp.tools.changed",
    z.object({
      server: z.string(),
    }),
  )

  export const BrowserOpenFailed = BusEvent.define(
    "mcp.browser.open.failed",
    z.object({
      mcpName: z.string(),
      url: z.string(),
    }),
  )

  export const AuthRequired = BusEvent.define(
    "mcp.auth.required",
    z.object({
      name: z.string(),
      message: z.string(),
      reason: z.enum(["needs_auth", "needs_client_registration"]),
    }),
    { tier: 2, badge: true },
  )

  export const Failed = NamedError.create(
    "MCPFailed",
    z.object({
      name: z.string(),
    }),
  )

  export const OAuthStateError = NamedError.create(
    "MCPOAuthStateError",
    z.object({
      mcpName: z.string(),
      message: z.string(),
    }),
  )

  type MCPClient = Client

  export const Status = z
    .discriminatedUnion("status", [
      z
        .object({
          status: z.literal("connected"),
        })
        .meta({
          ref: "MCPStatusConnected",
        }),
      z
        .object({
          status: z.literal("disabled"),
        })
        .meta({
          ref: "MCPStatusDisabled",
        }),
      z
        .object({
          status: z.literal("disconnected"),
        })
        .meta({
          ref: "MCPStatusDisconnected",
        }),
      z
        .object({
          status: z.literal("connecting"),
        })
        .meta({
          ref: "MCPStatusConnecting",
        }),
      z
        .object({
          status: z.literal("failed"),
          error: z.string(),
        })
        .meta({
          ref: "MCPStatusFailed",
        }),
      z
        .object({
          status: z.literal("needs_auth"),
        })
        .meta({
          ref: "MCPStatusNeedsAuth",
        }),
      z
        .object({
          status: z.literal("needs_client_registration"),
          error: z.string(),
        })
        .meta({
          ref: "MCPStatusNeedsClientRegistration",
        }),
    ])
    .meta({
      ref: "MCPStatus",
    })
  export type Status = z.infer<typeof Status>

  // Register notification handlers for MCP client
  function registerNotificationHandlers(client: MCPClient, serverName: string) {
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      log.info("tools list changed notification received", { server: serverName })
      Bus.publish(ToolsChanged, { server: serverName })
    })
  }

  // Convert MCP tool definition to AI SDK Tool type
  async function convertMcpTool(mcpTool: MCPToolDef, client: MCPClient, timeout: number): Promise<Tool> {
    const inputSchema = mcpTool.inputSchema

    // Spread first, then override type to ensure it's always "object"
    const schema: JSONSchema7 = {
      ...(inputSchema as JSONSchema7),
      type: "object",
      properties: (inputSchema.properties ?? {}) as JSONSchema7["properties"],
      additionalProperties: false,
    }

    return dynamicTool({
      description: mcpTool.description ?? "",
      inputSchema: jsonSchema(schema),
      execute: async (args: unknown) => {
        return client.callTool(
          {
            name: mcpTool.name,
            arguments: (args || {}) as Record<string, unknown>,
          },
          CallToolResultSchema,
          mcpRequestOptions(timeout),
        )
      },
    })
  }

  const pendingOAuthFlows = new Set<string>()

  // Prompt cache types
  type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]

  type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]
  type McpEntry = NonNullable<Config.Info["mcp"]>[string]
  export type RemoteMcpConfig = Extract<Config.Mcp, { type: "remote" }>
  function isMcpConfigured(entry: McpEntry): entry is Config.Mcp {
    return typeof entry === "object" && entry !== null && "type" in entry
  }
  function isMcpDisabledOverride(entry: McpEntry) {
    return (
      typeof entry === "object" &&
      entry !== null &&
      !("type" in entry) &&
      (entry as { enabled?: unknown }).enabled === false
    )
  }
  function builtinConfigForDisabledOverride(name: string, entry: McpEntry): Config.Mcp | undefined {
    if (!isMcpDisabledOverride(entry)) return
    if (name === BrowserMCPBuiltin.ServerName) return BrowserMCPBuiltin.localConfig()
  }

  function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }

  function mcpNotFound(name: string) {
    return new NotFoundError({ message: `MCP server not found: ${name}` })
  }

  function mcpAuthKey(mcpName: string): string {
    return McpAuth.scopedKey({ projectID: Instance.project.id, mcpName })
  }

  function requireMcpEntry(config: NonNullable<Config.Info["mcp"]>, name: string): McpEntry {
    const entry = config[name]
    if (!entry) throw mcpNotFound(name)
    return entry
  }

  export function effectiveTimeout(mcp?: Config.Mcp, globalTimeout?: number): number {
    return mcp?.timeout ?? globalTimeout ?? DEFAULT_TIMEOUT
  }

  export function mcpRequestOptions(timeout: number): RequestOptions {
    return {
      resetTimeoutOnProgress: true,
      timeout,
    }
  }

  export function mcpFetchRequestInit(timeout: number): RequestInit {
    return { signal: AbortSignal.timeout(timeout) }
  }

  function unsupportedRemoteTransport(transport: never): never {
    throw new Error(`Unsupported remote MCP transport: ${String(transport)}`)
  }

  async function timeoutForClient(clientName: string): Promise<number> {
    const cfg = await Config.get()
    const config = (cfg.mcp ?? {}) as NonNullable<Config.Info["mcp"]>
    const entry = config[clientName]
    return effectiveTimeout(isMcpConfigured(entry) ? entry : undefined, cfg.experimental?.mcp_timeout)
  }

  export function createRemoteTransport(mcp: RemoteMcpConfig, authProvider?: McpOAuthProvider, requestInit?: RequestInit) {
    const headers = new Headers(requestInit?.headers)
    let hasHeaders = requestInit?.headers !== undefined
    for (const [name, value] of Object.entries(mcp.headers ?? {})) {
      headers.set(name, value)
      hasHeaders = true
    }
    const mergedRequestInit = requestInit || hasHeaders ? { ...requestInit, ...(hasHeaders ? { headers } : {}) } : undefined
    const options = {
      authProvider,
      requestInit: mergedRequestInit,
    }
    switch (mcp.transport) {
      case "sse":
        return {
          name: "SSE",
          transport: new SSEClientTransport(new URL(mcp.url), options),
        }
      case "streamable-http":
        return {
          name: "StreamableHTTP",
          transport: new StreamableHTTPClientTransport(new URL(mcp.url), options),
        }
    }
    return unsupportedRemoteTransport(mcp.transport)
  }

  type McpState = {
    status: Record<string, Status>
    clients: Record<string, MCPClient>
    connections: Record<string, McpConnection>
    connecting: Record<string, Promise<void> | undefined>
  }

  type ClosableTransport = { close: () => Promise<void> | void }

  type McpConnection = {
    key: string
    type: Config.Mcp["type"]
    client: MCPClient
    transport?: ClosableTransport
    command?: string[]
    cwd?: string
    createdAt: number
    lastUsedAt: number
    sharedProjectScoped: boolean
  }

  async function closeConnection(name: string, connection: McpConnection | undefined) {
    if (!connection) return
    await connection.client.close().catch((error) => {
      log.error("Failed to close MCP client", { name, error })
    })
    if (connection.transport) {
      await Promise.resolve(connection.transport.close()).catch((error) => {
        log.error("Failed to close MCP transport", { name, error })
      })
    }
  }

  async function createSafely(key: string, mcp: Config.Mcp) {
    try {
      return await create(key, mcp)
    } catch (error) {
      const message = errorMessage(error)
      log.error("mcp startup failed before status was available", {
        key,
        type: mcp.type,
        error: message,
      })
      return {
        mcpClient: undefined,
        mcpConnection: undefined,
        status: {
          status: "failed" as const,
          error: message,
        },
      }
    }
  }

  const state = lazyInstanceState(
    async () => {
      const cfg = await Config.get()
      const config = (cfg.mcp ?? {}) as NonNullable<Config.Info["mcp"]>
      const clients: Record<string, MCPClient> = {}
      const connections: Record<string, McpConnection> = {}
      const status: Record<string, Status> = {}
      const connecting: Record<string, Promise<void> | undefined> = {}

      for (const [key, mcp] of entries(config)) {
        if (isMcpDisabledOverride(mcp)) {
          status[key] = { status: "disabled" }
          continue
        }
        if (!isMcpConfigured(mcp)) {
          log.error("Ignoring MCP config entry without type", { key })
          continue
        }

        status[key] = mcp.enabled === false ? { status: "disabled" } : { status: "disconnected" }
      }
      const snapshot = {
        status,
        clients,
        connections,
        connecting,
      }
      return snapshot
    },
    async (state) => {
      await Promise.all(
        objectValues(state.connections).map((connection) => closeConnection(connection.key, connection)),
      )
      pendingOAuthFlows.clear()
    },
  )

  function startConnection(state: McpState, key: string, mcp: Config.Mcp) {
    if (state.connecting[key]) return state.connecting[key]
    state.status[key] = { status: "connecting" }

    let connection!: Promise<void>
    connection = new Promise<void>((resolve) => setTimeout(resolve, 0))
      .then(async () => {
        const result = await createSafely(key, mcp)
        state.status[key] = result.status
        const existingConnection = state.connections[key]
        if (existingConnection && existingConnection !== result.mcpConnection) {
          await closeConnection(key, existingConnection)
        }
        if (result.mcpConnection) {
          state.connections[key] = result.mcpConnection
          state.clients[key] = result.mcpConnection.client
        } else {
          delete state.connections[key]
          delete state.clients[key]
        }
      })
      .finally(() => {
        if (state.connecting[key] === connection) delete state.connecting[key]
      })
    state.connecting[key] = connection
    return connection
  }

  async function ensureConfiguredConnections(state: McpState, config: NonNullable<Config.Info["mcp"]>) {
    const tasks: Promise<void>[] = []
    for (const [key, mcp] of entries(config)) {
      if (!isMcpConfigured(mcp)) continue
      if (mcp.enabled === false) continue
      if (state.status[key]?.status === "connected") continue
      if (state.status[key]?.status === "connecting" && state.connecting[key]) {
        tasks.push(state.connecting[key])
        continue
      }
      if (state.status[key]?.status !== "disconnected") continue
      tasks.push(startConnection(state, key, mcp))
    }
    await Promise.all(tasks)
    assertConfiguredConnectionsSucceeded(state, config)
  }

  function assertConfiguredConnectionsSucceeded(state: McpState, config: NonNullable<Config.Info["mcp"]>) {
    for (const [key, mcp] of entries(config)) {
      if (!isMcpConfigured(mcp)) continue
      if (mcp.enabled === false) continue
      const status = state.status[key]
      if (status?.status !== "failed") continue
      throw new Error(`MCP server ${key} failed to connect: ${status.error}`)
    }
  }

  function startConfiguredConnections(state: McpState, config: NonNullable<Config.Info["mcp"]>) {
    for (const [key, mcp] of entries(config)) {
      if (!isMcpConfigured(mcp)) continue
      if (mcp.enabled === false) continue
      if (state.status[key]?.status === "connected") continue
      if (state.status[key]?.status === "connecting") continue
      if (state.status[key]?.status !== "disconnected") continue
      startConnection(state, key, mcp)
    }
  }

  async function failClientList(
    state: McpState,
    clientName: string,
    label: "tools" | "prompts" | "resources",
    error: unknown,
  ): Promise<never> {
    const message = errorMessage(error)
    log.error(`failed to get ${label}`, { clientName, error: message })
    state.status[clientName] = {
      status: "failed" as const,
      error: message,
    }
    await closeConnection(clientName, state.connections[clientName])
    delete state.connections[clientName]
    delete state.clients[clientName]
    throw error
  }

  // Helper function to fetch prompts for a specific client
  async function fetchPromptsForClient(state: McpState, clientName: string, client: Client, timeout: number) {
    if (!client.getServerCapabilities()?.prompts) return {}
    let prompts: Awaited<ReturnType<Client["listPrompts"]>>
    try {
      prompts = await client.listPrompts(undefined, mcpRequestOptions(timeout))
    } catch (error) {
      return failClientList(state, clientName, "prompts", error)
    }

    const commands: Record<string, PromptInfo & { client: string }> = {}

    for (const prompt of prompts.prompts) {
      const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
      const sanitizedPromptName = prompt.name.replace(/[^a-zA-Z0-9_-]/g, "_")
      const key = sanitizedClientName + ":" + sanitizedPromptName

      commands[key] = { ...prompt, client: clientName }
    }
    return commands
  }

  async function fetchResourcesForClient(state: McpState, clientName: string, client: Client, timeout: number) {
    if (!client.getServerCapabilities()?.resources) return {}
    let resources: Awaited<ReturnType<Client["listResources"]>>
    try {
      resources = await client.listResources(undefined, mcpRequestOptions(timeout))
    } catch (error) {
      return failClientList(state, clientName, "resources", error)
    }

    const commands: Record<string, ResourceInfo & { client: string }> = {}

    for (const resource of resources.resources) {
      const encodedClientName = Buffer.from(clientName, "utf8").toString("base64url")
      const encodedResourceURI = Buffer.from(resource.uri, "utf8").toString("base64url")
      const key = "client:" + encodedClientName + ":uri:" + encodedResourceURI

      commands[key] = { ...resource, client: clientName }
    }
    return commands
  }

  export async function add(name: string, mcp: Config.Mcp) {
    const s = await state()
    const result = await createSafely(name, mcp)
    if (!result.mcpConnection) {
      s.status[name] = result.status
      delete s.connections[name]
      delete s.clients[name]
      return {
        status: s.status,
      }
    }
    await closeConnection(name, s.connections[name])
    s.connections[name] = result.mcpConnection
    s.clients[name] = result.mcpConnection.client
    s.status[name] = result.status

    return {
      status: s.status,
    }
  }

  async function create(key: string, mcp: Config.Mcp) {
    if (mcp.enabled === false) {
      log.info("mcp server disabled", { key })
      return {
        mcpClient: undefined,
        mcpConnection: undefined,
        status: { status: "disabled" as const },
      }
    }

    const cfg = await Config.get()
    const globalTimeout = cfg.experimental?.mcp_timeout
    const requestTimeout = effectiveTimeout(mcp, globalTimeout)

    log.info("found", { key, type: mcp.type })
    let mcpClient: MCPClient | undefined
    let mcpTransport: ClosableTransport | undefined
    let connectionCwd: string | undefined
    let status: Status | undefined = undefined

    if (mcp.type === "remote") {
      // OAuth is enabled by default for remote servers unless explicitly disabled with oauth: false
      const oauthDisabled = mcp.oauth === false
      const oauthConfig = typeof mcp.oauth === "object" ? mcp.oauth : undefined
      const authKey = oauthDisabled ? undefined : mcpAuthKey(key)
      let authProvider: McpOAuthProvider | undefined

      if (authKey) {
        authProvider = new McpOAuthProvider(
          key,
          authKey,
          mcp.url,
          {
            clientId: oauthConfig?.clientId,
            clientSecret: oauthConfig?.clientSecret,
            scope: oauthConfig?.scope,
          },
          {
            onRedirect: async (url) => {
              log.info("oauth redirect requested", { key, url: url.toString() })
              // Store the URL - actual browser opening is handled by startAuth
            },
          },
        )
      }

      const { name: transportName, transport } = createRemoteTransport(
        mcp,
        authProvider,
        mcpFetchRequestInit(requestTimeout),
      )

      let client: Client | undefined
      try {
        client = new Client({
          name: "opencorvus",
          version: Installation.VERSION,
        })
        await client.connect(transport, mcpRequestOptions(requestTimeout))
        registerNotificationHandlers(client, key)
        mcpClient = client
        mcpTransport = transport
        log.info("connected", { key, transport: transportName })
        status = { status: "connected" }
      } catch (error) {
        const lastError = error instanceof Error ? error : new Error(String(error))

        // Handle OAuth-specific errors
        if (error instanceof UnauthorizedError && authKey) {
          log.info("mcp server requires authentication", { key, transport: transportName })

          // Check if this is a "needs registration" error
          if (lastError.message.includes("registration") || lastError.message.includes("client_id")) {
            status = {
              status: "needs_client_registration" as const,
              error: "Server does not support dynamic client registration. Please provide clientId in config.",
            }
            Bus.publish(AuthRequired, {
              name: key,
              message: `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
              reason: "needs_client_registration",
            }).catch((e) => log.debug("failed to publish MCP auth notice", { error: e }))
          } else {
            status = { status: "needs_auth" as const }
            Bus.publish(AuthRequired, {
              name: key,
              message: `Server "${key}" requires authentication. Run: opencorvus mcp auth ${key}`,
              reason: "needs_auth",
            }).catch((e) => log.debug("failed to publish MCP auth notice", { error: e }))
          }
          await client?.close().catch((closeError) => {
            log.error("Failed to close auth-required remote MCP client", { key, transport: transportName, error: closeError })
          })
          await transport.close().catch((closeError) => {
            log.error("Failed to close auth-required remote MCP transport", {
              key,
              transport: transportName,
              error: closeError,
            })
          })
        } else {
          await client?.close().catch((closeError) => {
            log.error("Failed to close failed remote MCP client", { key, transport: transportName, error: closeError })
          })
          await transport.close().catch((closeError) => {
            log.error("Failed to close failed remote MCP transport", {
              key,
              transport: transportName,
              error: closeError,
            })
          })

          log.debug("transport connection failed", {
            key,
            transport: transportName,
            url: mcp.url,
            error: lastError.message,
          })
          status = {
            status: "failed" as const,
            error: lastError.message,
          }
        }
      }
    }

    if (mcp.type === "local") {
      const [cmd, ...args] = mcp.command
      const cwd = Instance.directory
      connectionCwd = cwd
      const transport = new StdioClientTransport({
        stderr: "pipe",
        command: cmd,
        args,
        cwd,
        env: {
          ...process.env,
          ...(cmd === "opencorvus" ? { BUN_BE_BUN: "1" } : {}),
          ...mcp.environment,
        },
      })
      let stderrText = ""
      transport.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString()
        stderrText = (stderrText + text).slice(-4_000)
        log.info(`mcp stderr: ${text}`, { key })
      })

      let client: Client | undefined
      try {
        client = new Client({
          name: "opencorvus",
          version: Installation.VERSION,
        })
        await client.connect(transport, mcpRequestOptions(requestTimeout))
        registerNotificationHandlers(client, key)
        mcpClient = client
        mcpTransport = transport
        status = {
          status: "connected",
        }
      } catch (error) {
        log.error("local mcp startup failed", {
          key,
          command: mcp.command,
          cwd,
          error: error instanceof Error ? error.message : String(error),
          stderr: stderrText,
        })
        const message = error instanceof Error ? error.message : String(error)
        const detail = stderrText.trim()
        status = {
          status: "failed" as const,
          error: detail ? `${message}\n${detail}` : message,
        }
        await client?.close().catch((closeError) => {
          log.error("Failed to close failed local MCP client", { key, error: closeError })
        })
        await transport.close().catch((closeError) => {
          log.error("Failed to close failed local MCP transport", { key, error: closeError })
        })
      }
    }

    if (!status) {
      status = {
        status: "failed" as const,
        error: "Unknown error",
      }
    }

    if (!mcpClient) {
      return {
        mcpClient: undefined,
        mcpConnection: undefined,
        status,
      }
    }

    let result: Awaited<ReturnType<Client["listTools"]>> | undefined
    let listToolsError = ""
    try {
      result = await mcpClient.listTools(undefined, mcpRequestOptions(requestTimeout))
    } catch (err) {
      listToolsError = errorMessage(err)
      log.error("failed to get tools from client", { key, error: listToolsError })
    }
    if (!result) {
      const failureMessage = listToolsError || "MCP listTools returned no result"
      await mcpClient.close().catch((error) => {
        log.error("Failed to close MCP client", {
          error,
        })
      })
      if (mcpTransport) {
        await Promise.resolve(mcpTransport.close()).catch((error) => {
          log.error("Failed to close MCP transport", { key, error })
        })
      }
      status = {
        status: "failed",
        error: failureMessage,
      }
      return {
        mcpClient: undefined,
        mcpConnection: undefined,
        status: {
          status: "failed" as const,
          error: failureMessage,
        },
      }
    }

    log.info("create() successfully created client", { key, toolCount: result.tools.length })
    const mcpConnection: McpConnection = {
      key,
      type: mcp.type,
      client: mcpClient,
      transport: mcpTransport,
      command: mcp.type === "local" ? mcp.command : undefined,
      cwd: connectionCwd,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      sharedProjectScoped: key === BrowserMCPBuiltin.ServerName,
    }
    return {
      mcpClient,
      mcpConnection,
      status,
    }
  }

  export async function status() {
    const s = await state()
    const cfg = await Config.get()
    const config = (cfg.mcp ?? {}) as NonNullable<Config.Info["mcp"]>
    startConfiguredConnections(s, config)
    const result: Record<string, Status> = {}

    // Include all configured MCPs from config, not just connected ones
    for (const [key, mcp] of entries(config)) {
      if (isMcpDisabledOverride(mcp)) {
        result[key] = { status: "disabled" }
        continue
      }
      if (!isMcpConfigured(mcp)) continue
      result[key] = s.status[key] ?? (mcp.enabled === false ? { status: "disabled" } : { status: "disconnected" })
    }

    return result
  }

  export async function clients() {
    return state().then((state) => state.clients)
  }

  export async function connectionStats() {
    const s = await state()
    const connections = objectValues(s.connections)
    return {
      connected: connections.length,
      local: connections.filter((connection) => connection.type === "local").length,
      remote: connections.filter((connection) => connection.type === "remote").length,
      localStdioTransports: connections.filter((connection) => connection.type === "local" && connection.transport)
        .length,
      connecting: objectValues(s.connecting).filter(Boolean).length,
    }
  }

  export async function connect(name: string) {
    const cfg = await Config.get()
    const config = (cfg.mcp ?? {}) as NonNullable<Config.Info["mcp"]>
    const mcp = requireMcpEntry(config, name)

    const mcpToConnect = isMcpConfigured(mcp) ? mcp : builtinConfigForDisabledOverride(name, mcp)
    if (!mcpToConnect) {
      throw mcpNotFound(name)
    }

    const s = await state()
    await startConnection(s, name, { ...mcpToConnect, enabled: true })
    const status = s.status[name]
    if (status?.status !== "connected") {
      const reason =
        status && "error" in status && status.error ? `: ${status.error}` : `: ${status?.status ?? "unknown"}`
      throw new Error(`MCP server ${name} did not connect${reason}`)
    }
  }

  export async function disconnect(name: string) {
    const cfg = await Config.get()
    const config = (cfg.mcp ?? {}) as NonNullable<Config.Info["mcp"]>
    requireMcpEntry(config, name)
    const s = await state()
    await closeConnection(name, s.connections[name])
    delete s.connections[name]
    delete s.clients[name]
    s.status[name] = { status: "disabled" }
  }

  export async function tools() {
    const result: Record<string, Tool> = {}
    const s = await state()
    const cfg = await Config.get()
    const config = cfg.mcp ?? {}
    const defaultTimeout = cfg.experimental?.mcp_timeout
    await ensureConfiguredConnections(s, config)
    const clientsSnapshot = await clients()

    const connectedClients = entries(clientsSnapshot).filter(
      ([clientName]) => s.status[clientName]?.status === "connected",
    )

    const toolsResults = await Promise.all(
      connectedClients.map(async ([clientName, client]) => {
        let toolsResult: Awaited<ReturnType<Client["listTools"]>>
        try {
          const entry = config[clientName]
          const timeout = effectiveTimeout(isMcpConfigured(entry) ? entry : undefined, defaultTimeout)
          toolsResult = await client.listTools(undefined, mcpRequestOptions(timeout))
        } catch (error) {
          return failClientList(s, clientName, "tools", error)
        }
        return { clientName, client, toolsResult }
      }),
    )

    for (const { clientName, client, toolsResult } of toolsResults) {
      if (!toolsResult) continue
      const mcpConfig = config[clientName]
      const timeout = effectiveTimeout(isMcpConfigured(mcpConfig) ? mcpConfig : undefined, defaultTimeout)
      for (const mcpTool of toolsResult.tools) {
        const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
        const sanitizedToolName = mcpTool.name.replace(/[^a-zA-Z0-9_-]/g, "_")
        result[sanitizedClientName + "_" + sanitizedToolName] = await convertMcpTool(mcpTool, client, timeout)
      }
    }
    return result
  }

  export async function prompts() {
    const s = await state()
    const cfg = await Config.get()
    const config = cfg.mcp ?? {}
    const defaultTimeout = cfg.experimental?.mcp_timeout
    await ensureConfiguredConnections(s, config)
    const clientsSnapshot = await clients()

    const prompts = Object.fromEntries(
      (
        await Promise.all(
          entries(clientsSnapshot).map(async ([clientName, client]) => {
            if (s.status[clientName]?.status !== "connected") {
              return []
            }

            const entry = config[clientName]
            const timeout = effectiveTimeout(isMcpConfigured(entry) ? entry : undefined, defaultTimeout)
            return entries(await fetchPromptsForClient(s, clientName, client, timeout))
          }),
        )
      ).flat(),
    ) as Record<string, PromptInfo & { client: string }>

    return prompts
  }

  export async function resources() {
    const s = await state()
    const cfg = await Config.get()
    const config = cfg.mcp ?? {}
    const defaultTimeout = cfg.experimental?.mcp_timeout
    await ensureConfiguredConnections(s, config)
    const clientsSnapshot = await clients()

    const result = Object.fromEntries(
      (
        await Promise.all(
          entries(clientsSnapshot).map(async ([clientName, client]) => {
            if (s.status[clientName]?.status !== "connected") {
              return []
            }

            const entry = config[clientName]
            const timeout = effectiveTimeout(isMcpConfigured(entry) ? entry : undefined, defaultTimeout)
            return entries(await fetchResourcesForClient(s, clientName, client, timeout))
          }),
        )
      ).flat(),
    ) as Record<string, ResourceInfo & { client: string }>

    return result
  }

  export async function getPrompt(clientName: string, name: string, args?: Record<string, string>) {
    const clientsSnapshot = await clients()
    const client = clientsSnapshot[clientName]
    const timeout = await timeoutForClient(clientName)

    if (!client) {
      log.warn("client not found for prompt", {
        clientName,
      })
      throw mcpNotFound(clientName)
    }

    try {
      return await client.getPrompt({
        name: name,
        arguments: args,
      }, mcpRequestOptions(timeout))
    } catch (error) {
      log.error("failed to get prompt from MCP server", {
        clientName,
        promptName: name,
        error: errorMessage(error),
      })
      throw error
    }
  }

  export async function readResource(clientName: string, resourceUri: string) {
    const clientsSnapshot = await clients()
    const client = clientsSnapshot[clientName]
    const timeout = await timeoutForClient(clientName)

    if (!client) {
      log.warn("client not found for prompt", {
        clientName: clientName,
      })
      throw mcpNotFound(clientName)
    }

    try {
      return await client.readResource({
        uri: resourceUri,
      }, mcpRequestOptions(timeout))
    } catch (error) {
      log.error("failed to read resource from MCP server", {
        clientName: clientName,
        resourceUri: resourceUri,
        error: errorMessage(error),
      })
      throw error
    }
  }

  /**
   * Start OAuth authentication flow for an MCP server.
   * Returns the authorization URL that should be opened in a browser.
   */
  export async function startAuth(mcpName: string): Promise<{ authorizationUrl: string }> {
    const cfg = await Config.get()
    const config = (cfg.mcp ?? {}) as NonNullable<Config.Info["mcp"]>
    const mcpConfig = requireMcpEntry(config, mcpName)

    if (!isMcpConfigured(mcpConfig)) {
      throw new Error(`MCP server ${mcpName} is disabled or missing configuration`)
    }

    if (mcpConfig.type !== "remote") {
      throw new Error(`MCP server ${mcpName} is not a remote server`)
    }

    if (mcpConfig.oauth === false) {
      throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`)
    }
    const authTimeout = effectiveTimeout(mcpConfig, cfg.experimental?.mcp_timeout)

    // Start the callback server
    await McpOAuthCallback.ensureRunning()

    // Generate and store a cryptographically secure state parameter BEFORE creating the provider
    // The SDK will call provider.state() to read this value
    const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    const authKey = mcpAuthKey(mcpName)
    await McpAuth.updateOAuthState(authKey, oauthState)

    // Create a new auth provider for this flow
    // OAuth config is optional - if not provided, we'll use auto-discovery
    const oauthConfig = typeof mcpConfig.oauth === "object" ? mcpConfig.oauth : undefined
    let capturedUrl: URL | undefined
    const authProvider = new McpOAuthProvider(
      mcpName,
      authKey,
      mcpConfig.url,
      {
        clientId: oauthConfig?.clientId,
        clientSecret: oauthConfig?.clientSecret,
        scope: oauthConfig?.scope,
      },
      {
        onRedirect: async (url) => {
          capturedUrl = url
        },
      },
    )

    const { name: transportName, transport } = createRemoteTransport(
      mcpConfig,
      authProvider,
      mcpFetchRequestInit(authTimeout),
    )
    let client: Client | undefined

    // Try to connect - this will trigger the OAuth flow
    try {
      client = new Client({
        name: "opencorvus",
        version: Installation.VERSION,
      })
      await client.connect(transport, mcpRequestOptions(authTimeout))
      // If we get here, we're already authenticated
      return { authorizationUrl: "" }
    } catch (error) {
      if (error instanceof UnauthorizedError && capturedUrl) {
        pendingOAuthFlows.add(authKey)
        return { authorizationUrl: capturedUrl.toString() }
      }
      throw error
    } finally {
      await client?.close().catch((closeError) => {
        log.error("Failed to close OAuth probe MCP client", { mcpName, transport: transportName, error: closeError })
      })
      await transport.close().catch((closeError) => {
        log.error("Failed to close OAuth probe MCP transport", { mcpName, transport: transportName, error: closeError })
      })
    }
  }

  /**
   * Complete OAuth authentication after user authorizes in browser.
   * Opens the browser and waits for callback.
   */
  export async function authenticate(mcpName: string): Promise<Status> {
    const { authorizationUrl } = await startAuth(mcpName)

    if (!authorizationUrl) {
      // Already authenticated
      const s = await state()
      return s.status[mcpName] ?? { status: "connected" }
    }

    // Get the state that was already generated and stored in startAuth()
    const authKey = mcpAuthKey(mcpName)
    const oauthState = await McpAuth.getOAuthState(authKey)
    if (!oauthState) {
      throw new Error("OAuth state not found - this should not happen")
    }

    // The SDK has already added the state parameter to the authorization URL
    // We just need to open the browser
    log.info("opening browser for oauth", { mcpName, url: authorizationUrl, state: oauthState })

    // Register the callback BEFORE opening the browser to avoid race condition
    // when the IdP has an active SSO session and redirects immediately
    // Register under the project-scoped auth key so same-name MCP servers
    // in different active projects keep independent callback ownership.
    const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, authKey)

    try {
      const subprocess = await open(authorizationUrl)
      // The open package spawns a detached process and returns immediately.
      // We need to listen for errors which fire asynchronously:
      // - "error" event: command not found (ENOENT)
      // - "exit" with non-zero code: command exists but failed (e.g., no display)
      await new Promise<void>((resolve, reject) => {
        // Give the process a moment to fail if it's going to
        const timeout = setTimeout(() => resolve(), 500)
        subprocess.on("error", (error) => {
          clearTimeout(timeout)
          reject(error)
        })
        subprocess.on("exit", (code) => {
          if (code !== null && code !== 0) {
            clearTimeout(timeout)
            reject(new Error(`Browser open failed with exit code ${code}`))
          }
        })
      })
    } catch (error) {
      // Browser opening failed (e.g., in remote/headless sessions like SSH, devcontainers)
      // Emit event so CLI can display the URL for manual opening
      log.warn("failed to open browser, user must open URL manually", { mcpName, error })
      Bus.publish(BrowserOpenFailed, { mcpName, url: authorizationUrl })
    }

    // Wait for callback using the already-registered promise
    const code = await callbackPromise

    return finishAuthCallback(mcpName, code, oauthState)
  }

  async function assertOAuthState(mcpName: string, authKey: string, oauthState: string): Promise<void> {
    const storedState = await McpAuth.getOAuthState(authKey)
    if (!storedState) {
      pendingOAuthFlows.delete(authKey)
      throw new OAuthStateError({ mcpName, message: "OAuth state not found" })
    }
    if (storedState !== oauthState) {
      await McpAuth.clearOAuthState(authKey)
      pendingOAuthFlows.delete(authKey)
      throw new OAuthStateError({ mcpName, message: "OAuth state mismatch - potential CSRF attack" })
    }
  }

  export async function finishAuthCallback(
    mcpName: string,
    authorizationCode: string,
    oauthState: string,
  ): Promise<Status> {
    const cfg = await Config.get()
    const config = (cfg.mcp ?? {}) as NonNullable<Config.Info["mcp"]>
    const mcpConfig = requireMcpEntry(config, mcpName)
    if (!isMcpConfigured(mcpConfig)) {
      throw new Error(`MCP server ${mcpName} is disabled or missing configuration`)
    }
    if (mcpConfig.type !== "remote") {
      throw new Error(`MCP server ${mcpName} is not a remote server`)
    }
    const authKey = mcpAuthKey(mcpName)
    await assertOAuthState(mcpName, authKey, oauthState)
    try {
      return await finishAuth(mcpName, authorizationCode)
    } finally {
      await McpAuth.clearOAuthState(authKey)
    }
  }

  /**
   * Complete OAuth authentication with the authorization code.
   */
  export async function finishAuth(mcpName: string, authorizationCode: string): Promise<Status> {
    const cfg = await Config.get()
    const config = (cfg.mcp ?? {}) as NonNullable<Config.Info["mcp"]>
    const mcpConfig = requireMcpEntry(config, mcpName)
    const authKey = mcpAuthKey(mcpName)

    if (!pendingOAuthFlows.has(authKey)) {
      throw new Error(`No pending OAuth flow for MCP server: ${mcpName}`)
    }
    if (!isMcpConfigured(mcpConfig)) {
      throw new Error(`MCP server ${mcpName} is disabled or missing configuration`)
    }
    if (mcpConfig.type !== "remote") {
      throw new Error(`MCP server ${mcpName} is not a remote server`)
    }
    const oauthConfig = typeof mcpConfig.oauth === "object" ? mcpConfig.oauth : undefined
    const authProvider = new McpOAuthProvider(
      mcpName,
      authKey,
      mcpConfig.url,
      {
        clientId: oauthConfig?.clientId,
        clientSecret: oauthConfig?.clientSecret,
        scope: oauthConfig?.scope,
      },
      {
        onRedirect: async () => {},
      },
    )
    const authTimeout = effectiveTimeout(mcpConfig, cfg.experimental?.mcp_timeout)
    const { name: transportName, transport } = createRemoteTransport(
      mcpConfig,
      authProvider,
      mcpFetchRequestInit(authTimeout),
    )

    try {
      // Call finishAuth on the transport
      await transport.finishAuth(authorizationCode)

      // Clear the code verifier after successful auth
      await McpAuth.clearCodeVerifier(authKey)

      // Re-add the MCP server to establish connection
      pendingOAuthFlows.delete(authKey)
      const result = await add(mcpName, mcpConfig)

      const statusRecord = result.status as Record<string, Status>
      const status = statusRecord[mcpName]
      if (!status) throw new Error("Unknown error after auth")
      if (status.status === "failed") throw new Error(status.error)
      return status
    } catch (error) {
      log.error("failed to finish oauth", { mcpName, error })
      throw error
    } finally {
      pendingOAuthFlows.delete(authKey)
      await transport.close().catch((closeError) => {
        log.error("Failed to close OAuth finish MCP transport", { mcpName, transport: transportName, error: closeError })
      })
    }
  }

  /**
   * Remove OAuth credentials for an MCP server.
   */
  export async function removeAuth(mcpName: string): Promise<void> {
    const cfg = await Config.get()
    const config = (cfg.mcp ?? {}) as NonNullable<Config.Info["mcp"]>
    requireMcpEntry(config, mcpName)
    const authKey = mcpAuthKey(mcpName)
    try {
      await McpAuth.remove(authKey)
      await McpAuth.clearOAuthState(authKey)
      log.info("removed oauth credentials", { mcpName })
    } finally {
      McpOAuthCallback.cancelPending(authKey)
      pendingOAuthFlows.delete(authKey)
    }
  }

  /**
   * Check if an MCP server supports OAuth (remote servers support OAuth by default unless explicitly disabled).
   */
  export async function supportsOAuth(mcpName: string): Promise<boolean> {
    const cfg = await Config.get()
    const config = (cfg.mcp ?? {}) as NonNullable<Config.Info["mcp"]>
    const mcpConfig = requireMcpEntry(config, mcpName)
    if (!isMcpConfigured(mcpConfig)) return false
    return mcpConfig.type === "remote" && mcpConfig.oauth !== false
  }

  /**
   * Check if an MCP server has stored OAuth tokens.
   */
  export async function hasStoredTokens(mcpName: string): Promise<boolean> {
    const entry = await McpAuth.get(mcpAuthKey(mcpName))
    return !!entry?.tokens
  }

  export type AuthStatus = "authenticated" | "expired" | "not_authenticated"

  /**
   * Get the authentication status for an MCP server.
   */
  export async function getAuthStatus(mcpName: string): Promise<AuthStatus> {
    const hasTokens = await hasStoredTokens(mcpName)
    if (!hasTokens) return "not_authenticated"
    const expired = await McpAuth.isTokenExpired(mcpAuthKey(mcpName))
    return expired ? "expired" : "authenticated"
  }

  // ---------------------------------------------------------------------------
  // Server-side adapter functions (used by MCPServe to expose proxied tools)
  // ---------------------------------------------------------------------------

  export const PromptsChanged = BusEvent.define("mcp.prompts.changed", z.object({ server: z.string().optional() }))

  export const ResourcesChanged = BusEvent.define("mcp.resources.changed", z.object({ server: z.string().optional() }))

  export async function serverTools() {
    const toolsMap = await tools()
    return Object.entries(toolsMap).map(([key, tool]) => ({
      key,
      name: key,
      description: tool.description ?? "",
      inputSchema: (tool as { inputSchema?: Record<string, unknown> }).inputSchema ?? {
        type: "object" as const,
        properties: {},
      },
      annotations: (tool as { annotations?: Record<string, unknown> }).annotations,
      client: key.split("_")[0] ?? key,
      execute: (tool as { execute?: (args: unknown) => unknown }).execute,
      _tool: tool,
    }))
  }

  export async function serverPrompts() {
    const promptsMap = await prompts()
    return Object.entries(promptsMap).map(([key, prompt]) => ({
      key,
      name: ((prompt as Record<string, unknown>).name as string) ?? key,
      title: (prompt as Record<string, unknown>).description as string | undefined,
      description: (prompt as Record<string, unknown>).description as string | undefined,
      arguments: (prompt as Record<string, unknown>).arguments,
      client: (prompt as { client?: string }).client ?? key.split("_")[0] ?? key,
    }))
  }

  export async function serverResources() {
    const resourcesMap = await resources()
    return Object.entries(resourcesMap).map(([key, resource]) => ({
      key,
      name: ((resource as Record<string, unknown>).name as string) ?? key,
      title: (resource as Record<string, unknown>).description as string | undefined,
      description: (resource as Record<string, unknown>).description as string | undefined,
      mimeType: (resource as Record<string, unknown>).mimeType as string | undefined,
      uri: ((resource as Record<string, unknown>).uri as string) ?? key,
      client: (resource as { client?: string }).client ?? key.split("_")[0] ?? key,
    }))
  }

  export async function callTool(input: { key: string; args: Record<string, unknown> }) {
    const toolsMap = await tools()
    const tool = toolsMap[input.key]
    if (!tool) throw new Error(`MCP tool not found: ${input.key}`)
    const execute = (tool as { execute?: (args: unknown) => unknown }).execute
    if (typeof execute !== "function") throw new Error(`MCP tool ${input.key} is not executable`)
    return execute(input.args)
  }
}
