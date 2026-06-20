import { setAppStore } from "../store/app"
import { t } from "../utils/i18n"
import { apiJson } from "./api"
import { directoryScopedPath } from "./task-path"

// ── Memory ──

export interface MemoryTaskRequest {
  taskID: string
  directory: string
}

export interface MemoryFileRequest {
  fileId: string
  directory: string
}

function memoryTaskPath(path: string, input: MemoryTaskRequest): string {
  const taskID = input.taskID.trim()
  if (!taskID) throw new Error("memory request requires a taskID")
  const base = directoryScopedPath(path, input.directory, "memory request")
  const separator = base.includes("?") ? "&" : "?"
  return `${base}${separator}taskID=${encodeURIComponent(taskID)}`
}

/**
 * Loads memory files for an explicit task/project scope and updates the app store.
 */
export async function loadMemory(input: MemoryTaskRequest): Promise<void> {
  const files = await apiJson(memoryTaskPath("panel/knowledge/memory", input))
  setAppStore({
    memoryFiles: Array.isArray(files) ? files : [],
    memorySearchMode: false,
  })
}

/**
 * Searches memory files using a query string and updates the app store.
 */
export async function searchMemory(input: MemoryTaskRequest, query: string): Promise<void> {
  if (!query || !query.trim()) {
    return loadMemory(input)
  }
  const results = await apiJson(directoryScopedPath("panel/knowledge/memory/search", input.directory, "memory search"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: query.trim(), taskID: input.taskID.trim(), limit: 20 }),
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
}

/**
 * Deletes a memory file by ID via the API, then reloads the memory list.
 */
export async function deleteMemory(input: MemoryFileRequest & Partial<MemoryTaskRequest>): Promise<void> {
  const fileId = input.fileId.trim()
  if (!fileId) throw new Error("deleteMemory requires a fileId")
  await apiJson(directoryScopedPath(`panel/knowledge/memory/${encodeURIComponent(fileId)}`, input.directory, "deleteMemory"), {
    method: "DELETE",
  })
  if (input.taskID) await loadMemory({ taskID: input.taskID, directory: input.directory })
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
export async function fetchMemoryDetail(input: MemoryFileRequest): Promise<{
  file: any
  content: string
}> {
  const fileId = input.fileId.trim()
  if (!fileId) throw new Error("fetchMemoryDetail requires a fileId")
  const data = await apiJson(
    directoryScopedPath(`panel/knowledge/memory/${encodeURIComponent(fileId)}`, input.directory, "fetchMemoryDetail"),
  )
  return { file: data.file, content: data.content ?? "" }
}
