// ── Memory Service ──
// TypeScript port of knowledge/memory functions:
// loadMemory, searchMemory, deleteMemory, openMemoryDetail.
// DOM-rendering functions (renderMemory) are intentionally
// NOT ported here — they are superseded by declarative Solid.js components
// (MemoryPanel.tsx).

import { appStore, setAppStore } from "../store/app"
import { boardStore } from "../store/board"
import { AppLog } from "../utils/log"
import { t } from "../utils/i18n"
import { apiJson } from "./api"

// ── Memory ──

/**
 * Loads memory files for the currently selected task from the server and
 * updates the app store.
 * Mirrors loadMemory.selectedTaskID instead of
 * state.selectedTaskID, and directoryEpoch guard is not applied here because
 * that belongs to the coordination layer.
 */
export async function loadMemory(): Promise<void> {
  try {
    const sessionID = boardStore.board?.task?.sessionID
    const params = sessionID ? `?sessionID=${encodeURIComponent(sessionID)}` : ""
    const files = await apiJson(`panel/knowledge/memory${params}`)
    setAppStore({
      memoryFiles: Array.isArray(files) ? files : [],
      memorySearchMode: false,
    })
  } catch (e) {
    AppLog.debug("memory", "loadMemory failed, resetting to empty", {
      error: String(e),
    })
    setAppStore({ memoryFiles: [], memorySearchMode: false })
  }
}

/**
 * Searches memory files using a query string and updates the app store.
 * Falls back to loadMemory when the query is empty.
 * Mirrors searchMemory.
 */
export async function searchMemory(query: string): Promise<void> {
  if (!query || !query.trim()) {
    return loadMemory()
  }
  try {
    const sessionID = boardStore.board?.task?.sessionID || undefined
    const results = await apiJson("panel/knowledge/memory/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query.trim(), sessionID, limit: 20 }),
    })
    const files = (Array.isArray(results) ? results : []).map((r: any) => ({
      id: r.fileId,
      title: r.fileTitle,
      scope: r.scope || "global",
      source: t("memory.search_source"),
      score: r.score,
      snippet: r.content ? String(r.content).slice(0, 200) : "",
      timeUpdated: r.timeCreated || 0,
    }))
    setAppStore({ memoryFiles: files, memorySearchMode: true })
  } catch (searchErr) {
    AppLog.warn("memory", "searchMemory failed", {
      error: String(searchErr),
    })
  }
}

/**
 * Deletes a memory file by ID via the API, then reloads the memory list.
 * Mirrors deleteMemory.
 */
export async function deleteMemory(fileId: string): Promise<void> {
  if (!fileId) return
  try {
    await apiJson(`panel/knowledge/memory/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
    })
    await loadMemory()
  } catch (e) {
    AppLog.error("ui", "Failed to delete memory", { error: String(e) })
  }
}

// ── Memory detail ──

/**
 * Fetches the full content of a single memory file for display in a detail
 * dialog and returns the data.
 * NOTE: The original openMemoryDetail
 * (dom.memoryDialog etc.). This function returns the fetched data instead so
 * callers can drive a Solid.js dialog reactively.
 * Mirrors openMemoryDetail.
 */
export async function fetchMemoryDetail(fileId: string): Promise<{
  file: any
  content: string
} | null> {
  if (!fileId) return null
  try {
    const data = await apiJson(`panel/knowledge/memory/${encodeURIComponent(fileId)}`)
    return { file: data.file, content: data.content ?? "" }
  } catch (e) {
    AppLog.error("ui", "Failed to fetch memory detail", {
      error: String(e),
      fileId,
    })
    return null
  }
}
