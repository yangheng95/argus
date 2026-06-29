// ── MCP Service ──
// connectMcp, disconnectMcp, removeMcpAuth, deleteAllMcp.
// DOM-rendering is handled by declarative Solid.js components.

import { appStore } from "../store/app"
import { apiJson } from "./api"
import { updateConfig } from "./config"
import type { ConfigRequestOptions } from "./config"

export type RemoteMcpTransport = "streamable-http" | "sse"

export type AddMcpInput = {
  name: string
} & (
  | {
      type: "remote"
      transport: RemoteMcpTransport
      url?: string
    }
  | {
      type: "local"
      command?: string
      args?: string
    }
)

const remoteMcpTransports = new Set<RemoteMcpTransport>(["streamable-http", "sse"])

function requireRemoteMcpTransport(transport: unknown): RemoteMcpTransport {
  if (remoteMcpTransports.has(transport as RemoteMcpTransport)) return transport as RemoteMcpTransport
  throw new Error("MCP remote transport is required")
}

type McpAddRequest =
  | { name: string; config: { type: "remote"; transport: RemoteMcpTransport; url: string } }
  | { name: string; config: { type: "local"; command: string[] } }

type McpRequestOptions = ConfigRequestOptions

function mcpPath(path: string, options: McpRequestOptions = {}): string {
  const directory = options.directory?.trim()
  return directory ? `${path}?directory=${encodeURIComponent(directory)}` : path
}

export function parseMcpArguments(input: string): string[] {
  const args: string[] = []
  let current = ""
  let quote: "'" | '"' | "" = ""

  for (const char of input) {
    if (quote) {
      if (char === quote) {
        quote = ""
      } else {
        current += char
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current)
        current = ""
      }
      continue
    }
    current += char
  }

  if (quote) throw new Error("MCP arguments contain an unterminated quote")
  if (current) args.push(current)
  return args
}

export function buildMcpAddRequest(input: AddMcpInput): McpAddRequest {
  const name = input.name.trim()
  if (!name) throw new Error("MCP name is required")

  if (input.type === "remote") {
    const url = (input.url ?? "").trim()
    if (!url) throw new Error("MCP remote URL is required")
    const transport = requireRemoteMcpTransport(input.transport)
    return { name, config: { type: "remote", transport, url } }
  }

  const command = (input.command ?? "").trim()
  if (!command) throw new Error("MCP command is required")
  return {
    name,
    config: {
      type: "local",
      command: [command, ...parseMcpArguments(input.args ?? "")],
    },
  }
}

export async function addMcpServer(input: AddMcpInput, options: McpRequestOptions = {}): Promise<void> {
  const request = buildMcpAddRequest(input)
  await updateConfig((current: any) => {
    const existing = current.mcp && typeof current.mcp === "object" && !Array.isArray(current.mcp) ? current.mcp : {}
    current.mcp = {
      ...existing,
      [request.name]: request.config,
    }
  }, options)
  await connectMcp(request.name, options)
}

/** Connects a configured MCP server by name. */
export async function connectMcp(name: string, options: McpRequestOptions = {}): Promise<void> {
  await apiJson(mcpPath(`mcp/${encodeURIComponent(name)}/connect`, options), {
    method: "POST",
  })
}

/** Disconnects an active MCP connection by name. */
export async function disconnectMcp(name: string, options: McpRequestOptions = {}): Promise<void> {
  await apiJson(mcpPath(`mcp/${encodeURIComponent(name)}/disconnect`, options), {
    method: "POST",
  })
}

/** Removes stored OAuth/auth credentials for an MCP server by name. */
export async function removeMcpAuth(name: string, options: McpRequestOptions = {}): Promise<void> {
  await apiJson(mcpPath(`mcp/${encodeURIComponent(name)}/auth`, options), {
    method: "DELETE",
  })
}

/**
 * Disconnects all MCP servers and removes their auth credentials.
 * Callers are responsible for confirming and persisting config changes.
 */
export async function deleteAllMcp(options: McpRequestOptions & { names?: readonly string[] } = {}): Promise<void> {
  const names = options.names ? [...options.names] : Object.keys(appStore.mcp ?? {})
  if (names.length === 0) return
  for (const name of names) {
    await disconnectMcp(name, options)
  }
  for (const name of names) {
    await removeMcpAuth(name, options)
  }
}
