import { dynamicTool, type Tool, jsonSchema, type JSONSchema7 } from "ai"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { getDefaultEnvironment, type StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import {
  type CallToolResult,
  CallToolResultSchema,
  GetPromptResultSchema,
  type GetPromptRequest,
  type JSONRPCMessage,
  ReadResourceResultSchema,
  type ReadResourceRequest,
  type Tool as MCPToolDef,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { AsyncLocalStorage } from "node:async_hooks"
import { PassThrough, type Stream } from "node:stream"
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
import { browserMcpBridgeEnvironment } from "./browser/proxy-env"
import { Env } from "@/runtime/env"
import { ProcessSupervisor } from "@/shell/process-supervisor"

export namespace MCP {
  const log = Log.create({ service: "mcp" })
  const DEFAULT_TIMEOUT = 30_000
  const STDIO_GRACEFUL_CLOSE_TIMEOUT_MS = 5_000

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

  const ProjectionPromptPayloadSchema = z
    .object({
      description: z.unknown().optional(),
      messages: z.array(
        z
          .object({
            role: z.unknown(),
            content: z.unknown(),
          })
          .passthrough(),
      ),
    })
    .passthrough()
  export type ProjectionPromptPayload = z.infer<typeof ProjectionPromptPayloadSchema>

  const ProjectionResourcePayloadSchema = z
    .object({
      contents: z.array(z.object({}).passthrough()),
    })
    .passthrough()
  export type ProjectionResourcePayload = z.infer<typeof ProjectionResourcePayloadSchema>

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
  function inputSchemaForMcpTool(mcpTool: MCPToolDef): JSONSchema7 {
    const inputSchema = mcpTool.inputSchema

    return {
      ...(inputSchema as JSONSchema7),
      type: "object",
      properties: (inputSchema.properties ?? {}) as JSONSchema7["properties"],
      additionalProperties: false,
    }
  }

  async function convertMcpTool(mcpTool: MCPToolDef, client: MCPClient, timeout: number): Promise<Tool> {
    const schema = inputSchemaForMcpTool(mcpTool)

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

  export interface ScopedConnectionInput {
    key: string
    mcp: Config.Mcp
    cwd: string
    globalTimeout?: number
  }

  export interface ScopedToolInput extends ScopedConnectionInput {
    toolName: string
  }

  export interface ScopedPromptInput extends ScopedConnectionInput {
    promptName: string
  }

  export interface ScopedResourceInput extends ScopedConnectionInput {
    resourceName: string
  }

  export async function scopedTool(input: ScopedToolInput): Promise<Tool> {
    const mcpTool = await scopedToolInfo(input)
    const schema = inputSchemaForMcpTool(mcpTool)
    return dynamicTool({
      description: mcpTool.description ?? "",
      inputSchema: jsonSchema(schema),
      execute: async (args: unknown) =>
        callScopedTool({
          ...input,
          args: (args || {}) as Record<string, unknown>,
        }),
    })
  }

  export async function scopedToolInfo(input: ScopedToolInput): Promise<MCPToolDef> {
    return withScopedClient(input, async (_client, _timeout, connection) => {
      const mcpTool = connection.tools.find((item) => item.name === input.toolName)
      if (!mcpTool) throw new Error(`Scoped MCP server ${input.key} does not expose tool ${input.toolName}`)
      return mcpTool
    })
  }

  export async function callScopedTool(
    input: ScopedToolInput & { args: Record<string, unknown> },
  ): Promise<CallToolResult> {
    return withScopedClient(
      input,
      async (client, timeout) =>
        CallToolResultSchema.parse(
          await client.callTool(
            {
              name: input.toolName,
              arguments: input.args,
            },
            undefined,
            mcpRequestOptions(timeout),
          ),
        ),
      { skipToolListVerification: true },
    )
  }

  async function scopedPromptInfoFromClient(
    client: MCPClient,
    timeout: number,
    input: ScopedPromptInput,
  ): Promise<PromptInfo> {
    if (!client.getServerCapabilities()?.prompts) {
      throw new Error(`Scoped MCP server ${input.key} does not expose prompts`)
    }
    const result = await client.listPrompts(undefined, mcpRequestOptions(timeout))
    const prompt = result.prompts.find((item) => item.name === input.promptName)
    if (!prompt) throw new Error(`Scoped MCP server ${input.key} does not expose prompt ${input.promptName}`)
    return prompt
  }

  export async function scopedPromptInfo(input: ScopedPromptInput): Promise<PromptInfo> {
    return withScopedClient(input, async (client, timeout) => scopedPromptInfoFromClient(client, timeout, input), {
      skipToolListVerification: true,
    })
  }

  export async function getScopedPrompt(
    input: ScopedPromptInput & { args?: Record<string, string> },
  ): Promise<GetPromptResult> {
    return withScopedClient(
      input,
      async (client, timeout) =>
        GetPromptResultSchema.parse(
          await client.getPrompt(
            {
              name: input.promptName,
              arguments: input.args,
            },
            mcpRequestOptions(timeout),
          ),
        ),
      { skipToolListVerification: true },
    )
  }

  export async function getScopedPromptProjectionPayload(
    input: ScopedPromptInput & { args?: Record<string, string> },
  ): Promise<ProjectionPromptPayload> {
    return withScopedClient(
      input,
      async (client, timeout) =>
        client.request(
          {
            method: "prompts/get",
            params: {
              name: input.promptName,
              arguments: input.args,
            },
          } satisfies GetPromptRequest,
          ProjectionPromptPayloadSchema,
          mcpRequestOptions(timeout),
        ),
      { skipToolListVerification: true },
    )
  }

  async function scopedResourceInfoFromClient(
    client: MCPClient,
    timeout: number,
    input: ScopedResourceInput,
  ): Promise<ResourceInfo> {
    if (!client.getServerCapabilities()?.resources) {
      throw new Error(`Scoped MCP server ${input.key} does not expose resources`)
    }
    const result = await client.listResources(undefined, mcpRequestOptions(timeout))
    const resource = result.resources.find((item) => item.name === input.resourceName)
    if (!resource) throw new Error(`Scoped MCP server ${input.key} does not expose resource ${input.resourceName}`)
    return resource
  }

  export async function scopedResourceInfo(input: ScopedResourceInput): Promise<ResourceInfo> {
    return withScopedClient(input, async (client, timeout) => scopedResourceInfoFromClient(client, timeout, input), {
      skipToolListVerification: true,
    })
  }

  export async function readScopedResource(input: ScopedResourceInput): Promise<ReadResourceResult> {
    return withScopedClient(
      input,
      async (client, timeout) => {
        const resource = await scopedResourceInfoFromClient(client, timeout, input)
        return ReadResourceResultSchema.parse(
          await client.readResource(
            {
              uri: resource.uri,
            },
            mcpRequestOptions(timeout),
          ),
        )
      },
      { skipToolListVerification: true },
    )
  }

  export async function readScopedResourceProjectionPayload(
    input: ScopedResourceInput,
  ): Promise<ProjectionResourcePayload> {
    return withScopedClient(
      input,
      async (client, timeout) => {
        const resource = await scopedResourceInfoFromClient(client, timeout, input)
        return client.request(
          {
            method: "resources/read",
            params: {
              uri: resource.uri,
            },
          } satisfies ReadResourceRequest,
          ProjectionResourcePayloadSchema,
          mcpRequestOptions(timeout),
        )
      },
      { skipToolListVerification: true },
    )
  }

  async function withScopedClient<T>(
    input: ScopedConnectionInput,
    run: (client: MCPClient, timeout: number, connection: McpConnection) => Promise<T>,
    options: Pick<CreateOptions, "skipToolListVerification"> = {},
  ): Promise<T> {
    const poolKey = scopedLocalPoolKey(input, options)
    const pool = scopedLocalConnectionPoolStorage.getStore()
    if (poolKey && pool) {
      const pooled = await acquireScopedLocalConnection(pool, poolKey, input, options)
      try {
        const timeout = effectiveTimeout(input.mcp, input.globalTimeout)
        return await run(pooled.connection.client, timeout, pooled.connection)
      } finally {
        releaseScopedLocalConnection(pooled.entry)
      }
    }
    const result = await createSafely(input.key, input.mcp, {
      cwd: input.cwd,
      authKey: false,
      globalTimeout: input.globalTimeout,
      ...options,
    })
    if (!result.mcpConnection) {
      const status = result.status
      const detail = "error" in status ? `: ${status.error}` : `: ${status.status}`
      throw new Error(`Scoped MCP server ${input.key} did not connect${detail}`)
    }
    try {
      const timeout = effectiveTimeout(input.mcp, input.globalTimeout)
      return await run(result.mcpConnection.client, timeout, result.mcpConnection)
    } finally {
      await closeConnection(input.key, result.mcpConnection)
    }
  }

  type ScopedLocalPoolEntry = {
    connecting: Promise<McpConnection>
    connection?: McpConnection
    active: number
  }

  type ScopedLocalPoolLease = {
    entry: ScopedLocalPoolEntry
    connection: McpConnection
  }

  const scopedLocalConnectionPoolStorage = new AsyncLocalStorage<Map<string, ScopedLocalPoolEntry>>()

  export async function withScopedConnectionPool<T>(run: () => Promise<T>): Promise<T> {
    if (scopedLocalConnectionPoolStorage.getStore()) return run()
    const pool = new Map<string, ScopedLocalPoolEntry>()
    let runResult: T | undefined
    let runError: unknown
    try {
      runResult = await scopedLocalConnectionPoolStorage.run(pool, run)
    } catch (error) {
      runError = error
    }
    let closeError: unknown
    try {
      await closeScopedLocalConnectionPool(pool)
    } catch (error) {
      closeError = error
    }
    if (runError && closeError) {
      throw new AggregateError([runError, closeError], "Scoped MCP projection failed and connection cleanup failed.")
    }
    if (runError) throw runError
    if (closeError) throw closeError
    return runResult as T
  }

  async function closeScopedLocalConnectionPool(pool: Map<string, ScopedLocalPoolEntry>): Promise<void> {
    const entries = [...pool.values()]
    pool.clear()
    const connectionResults = await Promise.allSettled(
      entries.map(async (entry) => entry.connection ?? (await entry.connecting)),
    )
    const closeResults = await Promise.allSettled(
      connectionResults
        .filter((result): result is PromiseFulfilledResult<McpConnection> => result.status === "fulfilled")
        .map((result) => closeConnection(result.value.key, result.value)),
    )
    const errors = [...connectionResults, ...closeResults].flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    )
    if (errors.length > 0) throw new AggregateError(errors, "Failed to close scoped MCP projection connections.")
  }

  function scopedLocalPoolKey(
    input: ScopedConnectionInput,
    options: Pick<CreateOptions, "skipToolListVerification">,
  ): string | undefined {
    if (input.mcp.type !== "local" || options.skipToolListVerification !== true) return undefined
    return JSON.stringify({
      command: input.mcp.command,
      cwd: input.cwd,
      environment: input.mcp.environment ?? {},
      globalTimeout: input.globalTimeout,
      timeout: input.mcp.timeout,
    })
  }

  async function acquireScopedLocalConnection(
    pool: Map<string, ScopedLocalPoolEntry>,
    poolKey: string,
    input: ScopedConnectionInput,
    options: Pick<CreateOptions, "skipToolListVerification">,
  ): Promise<ScopedLocalPoolLease> {
    const existing = pool.get(poolKey)
    if (existing) {
      existing.active++
      const connection = existing.connection ?? (await existing.connecting)
      existing.connection = connection
      connection.lastUsedAt = Date.now()
      return { entry: existing, connection }
    }
    const connecting = createSafely(input.key, input.mcp, {
      cwd: input.cwd,
      authKey: false,
      globalTimeout: input.globalTimeout,
      ...options,
    }).then((result) => {
      if (!result.mcpConnection) {
        const status = result.status
        const detail = "error" in status ? `: ${status.error}` : `: ${status.status}`
        throw new Error(`Scoped MCP server ${input.key} did not connect${detail}`)
      }
      return result.mcpConnection
    })
    const entry: ScopedLocalPoolEntry = {
      connecting,
      active: 1,
    }
    pool.set(poolKey, entry)
    try {
      const connection = await connecting
      entry.connection = connection
      connection.lastUsedAt = Date.now()
      return { entry, connection }
    } catch (error) {
      if (pool.get(poolKey) === entry) pool.delete(poolKey)
      throw error
    }
  }

  function releaseScopedLocalConnection(entry: ScopedLocalPoolEntry) {
    entry.active--
    if (entry.connection) entry.connection.lastUsedAt = Date.now()
  }

  const pendingOAuthFlows = new Set<string>()

  // Prompt cache types
  export type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]
  export type GetPromptResult = Awaited<ReturnType<MCPClient["getPrompt"]>>

  export type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]
  export type ReadResourceResult = Awaited<ReturnType<MCPClient["readResource"]>>
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

  export function createRemoteTransport(
    mcp: RemoteMcpConfig,
    authProvider?: McpOAuthProvider,
    requestInit?: RequestInit,
  ) {
    const headers = new Headers(requestInit?.headers)
    let hasHeaders = requestInit?.headers !== undefined
    for (const [name, value] of Object.entries(mcp.headers ?? {})) {
      headers.set(name, value)
      hasHeaders = true
    }
    const mergedRequestInit =
      requestInit || hasHeaders ? { ...requestInit, ...(hasHeaders ? { headers } : {}) } : undefined
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

  function supervisorStreamClosed(stream: NodeJS.ReadableStream | NodeJS.WritableStream | null): boolean {
    if (!stream) return true
    const state = stream as {
      closed?: boolean
      destroyed?: boolean
    }
    return Boolean(state.closed || state.destroyed)
  }

  async function waitForSupervisorStreamClose(
    stream: NodeJS.ReadableStream | NodeJS.WritableStream | null,
    label: string,
  ) {
    if (supervisorStreamClosed(stream)) return
    await ProcessSupervisor.awaitWithTimeout(
      new Promise<void>((resolve) => {
        stream?.once("close", () => resolve())
      }),
      ProcessSupervisor.TERMINATION_EXIT_TIMEOUT_MS,
      `${label} did not close after process exit`,
    )
  }

  class SupervisedStdioClientTransport implements Transport {
    private readBuffer = new ReadBuffer()
    private handle?: ProcessSupervisor.Handle
    private lastHandle?: ProcessSupervisor.Handle
    private closePromise?: Promise<void>
    private exitObserved?: Promise<void>
    private stderrStream: PassThrough | Stream | null = null

    onclose?: () => void
    onerror?: (error: Error) => void
    onmessage?: (message: JSONRPCMessage) => void

    constructor(private readonly server: StdioServerParameters) {
      if (server.stderr === "pipe" || server.stderr === "overlapped") {
        this.stderrStream = new PassThrough()
      } else if (server.stderr && typeof server.stderr === "object") {
        this.stderrStream = server.stderr
      }
    }

    get stderr(): Stream | null {
      return this.stderrStream
    }

    get pid(): number | null {
      return this.handle?.pid ?? null
    }

    async start(): Promise<void> {
      if (this.handle) throw new Error("SupervisedStdioClientTransport already started.")
      const handle = await ProcessSupervisor.spawnCommand({
        executable: this.server.command,
        args: this.server.args ?? [],
        cwd: this.server.cwd,
        env: {
          ...getDefaultEnvironment(),
          ...this.server.env,
        },
        stdin: "pipe",
      })
      this.handle = handle
      this.lastHandle = handle
      handle.stdout?.on("data", (chunk: Buffer) => {
        this.readBuffer.append(chunk)
        this.processReadBuffer()
      })
      handle.stdout?.on("error", (error) => {
        this.onerror?.(error)
      })
      handle.stderr?.on("data", (chunk: Buffer) => {
        if (writableSupervisorStream(this.stderrStream)) {
          this.stderrStream.write(chunk)
        } else if (this.server.stderr === undefined || this.server.stderr === "inherit") {
          process.stderr.write(chunk)
        }
      })
      handle.stderr?.on("error", (error) => {
        this.onerror?.(error)
      })
      this.exitObserved = handle.exited
        .then(
          () => undefined,
          (error) => {
            this.onerror?.(error instanceof Error ? error : new Error(String(error)))
          },
        )
        .finally(() => {
          if (this.handle === handle) this.handle = undefined
          if (this.stderrStream instanceof PassThrough) this.stderrStream.end()
          this.onclose?.()
        })
    }

    private processReadBuffer() {
      while (true) {
        try {
          const message = this.readBuffer.readMessage()
          if (message === null) break
          this.onmessage?.(message)
        } catch (error) {
          this.onerror?.(error instanceof Error ? error : new Error(String(error)))
        }
      }
    }

    async close(): Promise<void> {
      this.closePromise ??= this.closeOnce()
      await this.closePromise
    }

    private async closeOnce(): Promise<void> {
      const handle = this.handle ?? this.lastHandle
      this.handle = undefined
      this.readBuffer.clear()
      if (!handle) return
      try {
        handle.stdin?.end()
      } catch {
        // The MCP process may have already exited after a startup failure.
      }
      const exitedGracefully = await ProcessSupervisor.awaitWithTimeout(
        handle.exited.then(() => true),
        STDIO_GRACEFUL_CLOSE_TIMEOUT_MS,
        `MCP stdio process ${handle.pid} did not exit after stdin close`,
      ).catch(() => false)
      let disposed = false
      if (!exitedGracefully) {
        await ProcessSupervisor.disposeAndWaitForExit(handle, `MCP stdio process ${handle.pid}`)
        disposed = true
      }
      await this.exitObserved
      if (!disposed) {
        await ProcessSupervisor.disposeAndWaitForExit(handle, `MCP stdio process ${handle.pid}`)
      }
      await Promise.all([
        waitForSupervisorStreamClose(handle.stdin, `MCP stdio process ${handle.pid} stdin`),
        waitForSupervisorStreamClose(handle.stdout, `MCP stdio process ${handle.pid} stdout`),
        waitForSupervisorStreamClose(handle.stderr, `MCP stdio process ${handle.pid} stderr`),
      ])
      await settleClosedProcessHandle()
    }

    send(message: JSONRPCMessage): Promise<void> {
      return new Promise((resolve) => {
        const stdin = this.handle?.stdin
        if (!stdin) throw new Error("Not connected")
        const payload = serializeMessage(message)
        if (stdin.write(payload)) {
          resolve()
        } else {
          stdin.once("drain", resolve)
        }
      })
    }
  }

  type McpState = {
    status: Record<string, Status>
    clients: Record<string, MCPClient>
    connections: Record<string, McpConnection>
    connecting: Record<string, Promise<void> | undefined>
  }

  type ClosableTransport = { close: () => Promise<void> | void }
  type StdioStream = {
    closed?: boolean
    destroyed?: boolean
    once(event: "close", listener: () => void): unknown
  }
  type WritableSupervisorStream = Stream & {
    write(chunk: Buffer): boolean
  }
  function writableSupervisorStream(stream: PassThrough | Stream | null): stream is WritableSupervisorStream {
    return !!stream && typeof (stream as WritableSupervisorStream).write === "function"
  }
  type StdioChildProcess = {
    pid?: number
    exitCode: number | null
    signalCode?: NodeJS.Signals | null
    stdin?: StdioStream | null
    stdout?: StdioStream | null
    stderr?: StdioStream | null
    once(event: "close", listener: () => void): unknown
  }
  type ClosableTransportWithStdioProcess = ClosableTransport & {
    _process?: StdioChildProcess
    __opencorvusProcessToClose?: StdioChildProcess
    start?: () => Promise<void>
  }
  const closedStdioProcesses = new WeakSet<StdioChildProcess>()

  type McpConnection = {
    key: string
    type: Config.Mcp["type"]
    client: MCPClient
    tools: MCPToolDef[]
    transport?: ClosableTransport
    command?: string[]
    cwd?: string
    createdAt: number
    lastUsedAt: number
    sharedProjectScoped: boolean
  }

  interface CreateOptions {
    cwd?: string
    authKey?: string | false
    globalTimeout?: number
    skipToolListVerification?: boolean
  }

  function stdioProcessForTransport(transport: ClosableTransport): StdioChildProcess | undefined {
    const tracked = transport as ClosableTransportWithStdioProcess
    return tracked.__opencorvusProcessToClose ?? tracked._process
  }

  function stdioProcessHasExited(processToClose: StdioChildProcess | undefined) {
    return !processToClose || processToClose.exitCode !== null || processToClose.signalCode !== null
  }

  function stdioProcessHasClosed(processToClose: StdioChildProcess | undefined) {
    return !processToClose || closedStdioProcesses.has(processToClose)
  }

  function trackStdioProcessClose(processToClose: StdioChildProcess | undefined) {
    if (!processToClose || stdioProcessHasClosed(processToClose)) return
    processToClose.once("close", () => {
      closedStdioProcesses.add(processToClose)
    })
  }

  function trackStdioTransportProcess<T extends ClosableTransport>(transport: T): T {
    const tracked = transport as ClosableTransportWithStdioProcess
    const originalStart = tracked.start?.bind(transport)
    if (originalStart) {
      tracked.start = async () => {
        try {
          await originalStart()
        } finally {
          if (tracked._process) {
            tracked.__opencorvusProcessToClose = tracked._process
            trackStdioProcessClose(tracked._process)
          }
        }
      }
    }
    const originalClose = tracked.close.bind(transport)
    let closePromise: Promise<void> | undefined
    tracked.close = async () => {
      if (tracked._process) tracked.__opencorvusProcessToClose = tracked._process
      closePromise ??= Promise.resolve(originalClose())
      await closePromise
    }
    return transport
  }

  async function terminateStdioProcessTree(processToClose: StdioChildProcess | undefined, label: string) {
    if (!processToClose?.pid || stdioProcessHasExited(processToClose)) return
    await ProcessSupervisor.terminateProcessTree(processToClose.pid, `${label} process tree ${processToClose.pid}`)
  }

  async function waitForStdioProcessClose(processToClose: StdioChildProcess | undefined): Promise<boolean> {
    if (stdioProcessHasClosed(processToClose)) return true
    try {
      await ProcessSupervisor.awaitWithTimeout(
        new Promise<void>((resolve) => {
          processToClose?.once("close", () => resolve())
        }),
        ProcessSupervisor.TERMINATION_EXIT_TIMEOUT_MS,
        `MCP stdio process ${processToClose?.pid ?? "unknown"} did not close after transport cleanup`,
      )
      return true
    } catch {
      return stdioProcessHasClosed(processToClose)
    }
  }

  async function waitForStdioStreamClose(stream: StdioStream | null | undefined) {
    if (stream && !stream.closed && !stream.destroyed) {
      await ProcessSupervisor.awaitWithTimeout(
        new Promise<void>((resolve) => {
          stream.once("close", () => resolve())
        }),
        ProcessSupervisor.TERMINATION_EXIT_TIMEOUT_MS,
        "MCP stdio stream did not close after transport cleanup",
      )
    }
  }

  async function waitForStdioStreamsClosed(processToClose: StdioChildProcess | undefined) {
    if (!processToClose) return
    await Promise.all([
      waitForStdioStreamClose(processToClose.stdin),
      waitForStdioStreamClose(processToClose.stdout),
      waitForStdioStreamClose(processToClose.stderr),
    ])
  }

  async function settleClosedProcessHandle() {
    await new Promise<void>((resolve) => setImmediate(resolve))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }

  async function closeTransport(
    name: string,
    transport: ClosableTransport,
    processToClose: StdioChildProcess | undefined = stdioProcessForTransport(transport),
  ) {
    await Promise.resolve(transport.close()).catch((error) => {
      log.error("Failed to close MCP transport", { name, error })
    })
    const processAfterClose = processToClose ?? stdioProcessForTransport(transport)
    const processClosedAfterClose = await waitForStdioProcessClose(processAfterClose)
    if (!processClosedAfterClose && !stdioProcessHasExited(processAfterClose)) {
      await terminateStdioProcessTree(processAfterClose, "MCP stdio transport")
    }
    const processClosedAfterTerminate = await waitForStdioProcessClose(processAfterClose)
    if (!processClosedAfterTerminate) {
      throw new Error(`MCP stdio process ${processAfterClose?.pid ?? "unknown"} did not close after transport cleanup`)
    }
    await waitForStdioStreamsClosed(processAfterClose)
    await settleClosedProcessHandle()
  }

  async function closeConnection(name: string, connection: McpConnection | undefined) {
    if (!connection) return
    const processToClose = connection.transport ? stdioProcessForTransport(connection.transport) : undefined
    await connection.client.close().catch((error) => {
      log.error("Failed to close MCP client", { name, error })
    })
    if (connection.transport) {
      await closeTransport(name, connection.transport, processToClose)
    }
  }

  async function closeClientAndTransport(
    name: string,
    client: Client | undefined,
    transport: ClosableTransport | undefined,
  ) {
    const processToClose = transport ? stdioProcessForTransport(transport) : undefined
    await client?.close().catch((error) => {
      log.error("Failed to close MCP client", { name, error })
    })
    if (transport) await closeTransport(name, transport, processToClose)
  }

  async function createSafely(key: string, mcp: Config.Mcp, options: CreateOptions = {}) {
    try {
      return await create(key, mcp, options)
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
      const connecting = objectValues(state.connecting).filter((item): item is Promise<void> => Boolean(item))
      const settledConnections = await Promise.allSettled(connecting)
      for (const key of Object.keys(state.connecting)) delete state.connecting[key]
      await Promise.all(objectValues(state.connections).map((connection) => closeConnection(connection.key, connection)))
      for (const key of Object.keys(state.connections)) delete state.connections[key]
      for (const key of Object.keys(state.clients)) delete state.clients[key]
      pendingOAuthFlows.clear()
      const connectionError = settledConnections.find((result): result is PromiseRejectedResult => result.status === "rejected")
      if (connectionError) throw connectionError.reason
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

  async function markClientListFailure(
    state: McpState,
    clientName: string,
    label: "tools" | "prompts" | "resources",
    error: unknown,
  ): Promise<Status> {
    const message = errorMessage(error)
    log.error(`failed to get ${label}`, { clientName, error: message })
    const status = {
      status: "failed" as const,
      error: message,
    }
    state.status[clientName] = status
    await closeConnection(clientName, state.connections[clientName])
    delete state.connections[clientName]
    delete state.clients[clientName]
    return status
  }

  async function failClientList(
    state: McpState,
    clientName: string,
    label: "tools" | "prompts" | "resources",
    error: unknown,
  ): Promise<never> {
    await markClientListFailure(state, clientName, label, error)
    throw error
  }

  async function validateConnectedClientsForStatus(
    state: McpState,
    config: NonNullable<Config.Info["mcp"]>,
    defaultTimeout?: number,
  ) {
    await Promise.all(
      entries(config).map(async ([clientName, entry]) => {
        if (!isMcpConfigured(entry)) return
        if (entry.enabled === false) return
        if (state.status[clientName]?.status !== "connected") return
        const client = state.clients[clientName]
        if (!client) {
          state.status[clientName] = {
            status: "failed",
            error: "MCP status connected without an active client",
          }
          delete state.connections[clientName]
          return
        }
        const timeout = effectiveTimeout(entry, defaultTimeout)
        try {
          await client.listTools(undefined, mcpRequestOptions(timeout))
        } catch (error) {
          await markClientListFailure(state, clientName, "tools", error)
        }
      }),
    )
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

  async function create(key: string, mcp: Config.Mcp, options: CreateOptions = {}) {
    if (mcp.enabled === false) {
      log.info("mcp server disabled", { key })
      return {
        mcpClient: undefined,
        mcpConnection: undefined,
        status: { status: "disabled" as const },
      }
    }

    const cfg = options.cwd ? undefined : await Config.get()
    const globalTimeout = options.globalTimeout ?? cfg?.experimental?.mcp_timeout
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
      const authKey = oauthDisabled
        ? undefined
        : options.authKey === false
          ? undefined
          : (options.authKey ?? mcpAuthKey(key))
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
          await closeClientAndTransport(key, client, transport)
        } else {
          await closeClientAndTransport(key, client, transport)

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
      const cwd = options.cwd ?? Instance.directory
      connectionCwd = cwd
      const env = await localMcpEnvironment(key, cmd, mcp)
      const transport = new SupervisedStdioClientTransport({
        stderr: "pipe",
        command: cmd,
        args,
        cwd,
        env,
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
        await closeClientAndTransport(key, client, transport)
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
    if (!options.skipToolListVerification) {
      try {
        result = await mcpClient.listTools(undefined, mcpRequestOptions(requestTimeout))
      } catch (err) {
        listToolsError = errorMessage(err)
        log.error("failed to get tools from client", { key, error: listToolsError })
      }
    }
    if (!result && !options.skipToolListVerification) {
      const failureMessage = listToolsError || "MCP listTools returned no result"
      await closeClientAndTransport(key, mcpClient, mcpTransport)
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

    const tools = result?.tools ?? []
    log.info("create() successfully created client", { key, toolCount: tools.length })
    const mcpConnection: McpConnection = {
      key,
      type: mcp.type,
      client: mcpClient,
      tools,
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

  async function localMcpEnvironment(key: string, cmd: string, mcp: Extract<Config.Mcp, { type: "local" }>) {
    const env: Record<string, string> = {
      ...Env.snapshot(),
      ...(cmd === "opencorvus" ? { BUN_BE_BUN: "1" } : {}),
      ...mcp.environment,
    }
    if (key !== BrowserMCPBuiltin.ServerName) return env
    return browserMcpBridgeEnvironment(env)
  }

  export async function status() {
    const s = await state()
    const cfg = await Config.get()
    const config = (cfg.mcp ?? {}) as NonNullable<Config.Info["mcp"]>
    startConfiguredConnections(s, config)
    await validateConnectedClientsForStatus(s, config, cfg.experimental?.mcp_timeout)
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
      return await client.getPrompt(
        {
          name: name,
          arguments: args,
        },
        mcpRequestOptions(timeout),
      )
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
      return await client.readResource(
        {
          uri: resourceUri,
        },
        mcpRequestOptions(timeout),
      )
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

    const { transport } = createRemoteTransport(mcpConfig, authProvider, mcpFetchRequestInit(authTimeout))
    let client: Client | undefined
    let retainOAuthState = false

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
        retainOAuthState = true
        return { authorizationUrl: capturedUrl.toString() }
      }
      throw error
    } finally {
      if (!retainOAuthState) {
        pendingOAuthFlows.delete(authKey)
        await McpAuth.clearOAuthState(authKey)
      }
      await closeClientAndTransport(mcpName, client, transport)
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
    const { transport } = createRemoteTransport(mcpConfig, authProvider, mcpFetchRequestInit(authTimeout))

    try {
      // Call finishAuth on the transport
      await transport.finishAuth(authorizationCode)

      // Clear the code verifier after successful auth
      await McpAuth.clearCodeVerifier(authKey)
      await McpAuth.clearOAuthState(authKey)

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
      await closeTransport(mcpName, transport)
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
