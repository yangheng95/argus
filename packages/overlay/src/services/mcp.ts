// ── MCP Service ──
// disconnectMcp, removeMcpAuth, deleteAllMcp.
// DOM-rendering is handled by declarative Solid.js components.

import { appStore } from "../store/app";
import { apiJson } from "./api";

/** Disconnects an active MCP connection by name. */
export async function disconnectMcp(name: string): Promise<void> {
  await apiJson(`mcp/${encodeURIComponent(name)}/disconnect`, {
    method: "POST",
  }).catch(() => undefined);
}

/** Removes stored OAuth/auth credentials for an MCP server by name. */
export async function removeMcpAuth(name: string): Promise<void> {
  await apiJson(`mcp/${encodeURIComponent(name)}/auth`, {
    method: "DELETE",
  }).catch(() => undefined);
}

/**
 * Disconnects all MCP servers and removes their auth credentials.
 * Callers are responsible for confirming and persisting config changes.
 */
export async function deleteAllMcp(): Promise<void> {
  const names = Object.keys(appStore.mcp ?? {});
  if (names.length === 0) return;
  await Promise.all(names.map((name) => disconnectMcp(name)));
  await Promise.all(names.map((name) => removeMcpAuth(name)));
}
