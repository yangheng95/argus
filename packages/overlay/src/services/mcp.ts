// ── MCP Service ──
// TypeScript port of MCP-related functions from app.js:
//   disconnectMcp, removeMcpAuth, deleteAllMcp, toggleMcpFields.
//
// DOM-rendering functions (renderExtensions, renderMcpList) are intentionally
// NOT ported here — they are superseded by declarative Solid.js components.

import { appStore } from "../store/app";
import { AppLog } from "../utils/log";
import { apiJson } from "./api";

// ── API helpers ──

/**
 * Disconnects an active MCP connection by name.
 * Mirrors disconnectMcp in app.js.
 */
export async function disconnectMcp(name: string): Promise<void> {
  await apiJson(`mcp/${encodeURIComponent(name)}/disconnect`, {
    method: "POST",
  }).catch(() => undefined);
}

/**
 * Removes stored OAuth/auth credentials for an MCP server by name.
 * Mirrors removeMcpAuth in app.js.
 */
export async function removeMcpAuth(name: string): Promise<void> {
  await apiJson(`mcp/${encodeURIComponent(name)}/auth`, {
    method: "DELETE",
  }).catch(() => undefined);
}

/**
 * Disconnects all MCP servers and removes their auth credentials.
 * NOTE: The native confirm dialog call and updateConfig call from app.js are
 * omitted — callers are responsible for confirming and persisting config
 * changes before calling this function.
 * Mirrors the API call portion of deleteAllMcp in app.js.
 */
export async function deleteAllMcp(): Promise<void> {
  const names = Object.keys(appStore.mcp ?? {});
  if (names.length === 0) return;
  await Promise.all(names.map((name) => disconnectMcp(name)));
  await Promise.all(names.map((name) => removeMcpAuth(name)));
}

// ── UI helper ──

/**
 * Toggles the visibility of MCP dialog fields based on the selected type
 * ("local" vs remote).
 *
 * NOTE: This function manipulates legacy DOM elements from app.js's
 * non-Solid UI (dom.mcpType, dom.mcpRemoteField, etc.).  It is provided
 * here for completeness during the migration period.  Once the MCP dialog
 * is ported to Solid.js this function should be removed.
 *
 * @deprecated Use Solid.js reactive state to drive MCP dialog field
 *   visibility instead of calling this function directly.
 */
export function toggleMcpFields(
  mcpTypeEl: HTMLSelectElement | null,
  mcpRemoteFieldEl: HTMLElement | null,
  mcpCommandFieldEl: HTMLElement | null,
  mcpArgsFieldEl: HTMLElement | null,
  mcpUrlEl: HTMLInputElement | null,
  mcpCommandEl: HTMLInputElement | null,
): void {
  if (!mcpTypeEl) return;
  const local = mcpTypeEl.value === "local";
  mcpRemoteFieldEl?.classList.toggle("hidden", local);
  mcpCommandFieldEl?.classList.toggle("hidden", !local);
  mcpArgsFieldEl?.classList.toggle("hidden", !local);
  if (mcpUrlEl) mcpUrlEl.required = !local;
  if (mcpCommandEl) mcpCommandEl.required = local;
}
