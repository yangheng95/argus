// ── MCP Service ──
// disconnectMcp, removeMcpAuth, deleteAllMcp.
// DOM-rendering is handled by declarative Solid.js components.

import { appStore } from "../store/app"
import { apiJson } from "./api"
import { updateConfig } from "./config"

export interface AddMcpInput {
  name: string
  type: "remote" | "local"
  url?: string
  command?: string
  args?: string
}

type McpAddRequest =
  | { name: string; config: { type: "remote"; url: string } }
  | { name: string; config: { type: "local"; command: string[] } }

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
    return { name, config: { type: "remote", url } }
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

export async function addMcpServer(input: AddMcpInput): Promise<void> {
  const request = buildMcpAddRequest(input)
  await updateConfig((current: any) => {
    const existing = current.mcp && typeof current.mcp === "object" && !Array.isArray(current.mcp) ? current.mcp : {}
    current.mcp = {
      ...existing,
      [request.name]: request.config,
    }
  })
  await apiJson(`mcp/${encodeURIComponent(request.name)}/connect`, {
    method: "POST",
  })
}

/** Disconnects an active MCP connection by name. */
export async function disconnectMcp(name: string): Promise<void> {
  await apiJson(`mcp/${encodeURIComponent(name)}/disconnect`, {
    method: "POST",
  }).catch(() => undefined)
}

/** Removes stored OAuth/auth credentials for an MCP server by name. */
export async function removeMcpAuth(name: string): Promise<void> {
  await apiJson(`mcp/${encodeURIComponent(name)}/auth`, {
    method: "DELETE",
  }).catch(() => undefined)
}

/**
 * Disconnects all MCP servers and removes their auth credentials.
 * Callers are responsible for confirming and persisting config changes.
 */
export async function deleteAllMcp(): Promise<void> {
  const names = Object.keys(appStore.mcp ?? {})
  if (names.length === 0) return
  await Promise.all(names.map((name) => disconnectMcp(name)))
  await Promise.all(names.map((name) => removeMcpAuth(name)))
}
