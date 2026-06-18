// ── MemoryPanel Component ──
// Knowledge/memory panel that lists memory files for the current task, supports
// search, inline detail expansion, and deletion.
// Ports renderMemory ( 10549–10582), loadMemory (10487–10509),
// searchMemory (10511–10540), openMemoryDetail (10586–10610), deleteMemory
// (10612–10621), and knowledgeScopeLabel (10542–10547).

import { createSignal, createMemo, createEffect, For, Show } from "solid-js"
import { t } from "../utils/i18n"
import { apiJson, configure as configureApi } from "../services/api"
import { nativeMessage } from "../services/app-dialog"
import { syncActiveDirectoryApiContext } from "../services/workspace"
import { Button } from "./ui/Button"
import { Icon } from "./Icon"

// ── Types ──

export interface MemoryFile {
  id: string
  title: string
  scope: string
  source: string
  score?: number
  snippet?: string
  timeUpdated: number
}

interface MemoryDetail {
  title: string
  scope: string
  source: string
  timeCreated: number
  timeUpdated: number
  content: string
}

interface MemoryDetailState {
  loading: boolean
  error: string
  detail: MemoryDetail | null
}

// ── Helpers ──

function knowledgeScopeLabel(scope: string): string {
  if (scope === "session") return t("memory.scope.session")
  if (scope === "cwd") return t("memory.scope.cwd")
  if (scope === "global") return t("memory.scope.global")
  return scope || ""
}

function formatDate(ts: number): string {
  if (!ts) return ""
  return new Date(ts).toLocaleDateString()
}

function formatDateTime(ts: number): string {
  if (!ts) return ""
  return new Date(ts).toLocaleString()
}

// ── MemoryPanel ──

export interface MemoryPanelProps {
  taskID?: string | (() => string | undefined)
  directory?: string | (() => string | undefined)
  active?: boolean
  compact?: boolean
}

export function MemoryPanel(props: MemoryPanelProps) {
  const [files, setFiles] = createSignal<MemoryFile[]>([])
  const [searchMode, setSearchMode] = createSignal(false)
  const [searchQuery, setSearchQuery] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [errorMessage, setErrorMessage] = createSignal("")
  const [expandedFileId, setExpandedFileId] = createSignal<string | null>(null)
  const [detailStates, setDetailStates] = createSignal<Record<string, MemoryDetailState>>({})
  const currentTaskID = () => (typeof props.taskID === "function" ? props.taskID() : props.taskID)
  const isActive = () => props.active ?? true
  const currentDirectory = () => {
    if (props.directory !== undefined) {
      const value = typeof props.directory === "function" ? props.directory() : props.directory
      const directory = String(value || "").trim()
      configureApi({ directory })
      return directory
    }
    return syncActiveDirectoryApiContext().trim()
  }

  function memoryPath(path: string, directory: string, params: Record<string, string> = {}): string {
    const query = new URLSearchParams()
    if (directory) query.set("directory", directory)
    for (const [key, value] of Object.entries(params)) {
      if (value) query.set(key, value)
    }
    const suffix = query.toString()
    return suffix ? `${path}?${suffix}` : path
  }

  // ── Data loading ──

  const loadMemory = async (taskID = currentTaskID(), directory = currentDirectory()) => {
    if (!taskID || !directory) {
      setFiles([])
      setSearchMode(false)
      setExpandedFileId(null)
      setErrorMessage("")
      return
    }
    setLoading(true)
    try {
      const data = await apiJson(memoryPath("panel/knowledge/memory", directory, { taskID }))
      setFiles(Array.isArray(data) ? data : [])
      setSearchMode(false)
      setExpandedFileId(null)
      setErrorMessage("")
    } catch (err) {
      setFiles([])
      setSearchMode(false)
      setExpandedFileId(null)
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const doSearch = async (q: string) => {
    if (!q || !q.trim()) {
      return loadMemory()
    }
    const directory = currentDirectory()
    if (!currentTaskID() || !directory) {
      return loadMemory(currentTaskID(), directory)
    }
    setLoading(true)
    try {
      // Body-only branch — no implicit fallback to old results, every search
      // call either succeeds or surfaces the error to the operator below.
      const results = await apiJson(memoryPath("panel/knowledge/memory/search", directory), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q.trim(),
          taskID: currentTaskID() || undefined,
          limit: 20,
        }),
      })
      const mapped: MemoryFile[] = (Array.isArray(results) ? results : []).map((r: any) => ({
        id: r.fileId,
        title: r.fileTitle,
        scope: r.scope || "global",
        source: t("memory.search_source"),
        score: r.score,
        snippet: r.content ? r.content.slice(0, 200) : "",
        timeUpdated: r.timeCreated || 0,
      }))
      setFiles(mapped)
      setSearchMode(true)
      setExpandedFileId(null)
      setErrorMessage("")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMessage(msg)
      console.error("[MemoryPanel] search failed", err)
      void nativeMessage(t("memory.search_failed", { error: msg }), {
        title: t("memory.search_failed_title"),
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSearchSubmit = (e: Event) => {
    e.preventDefault()
    void doSearch(searchQuery())
  }

  const handleRefresh = () => {
    setSearchQuery("")
    void loadMemory()
  }

  const handleDeleteInline = async (fileId: string) => {
    try {
      await apiJson(memoryPath(`panel/knowledge/memory/${encodeURIComponent(fileId)}`, currentDirectory()), {
        method: "DELETE",
      })
      await loadMemory()
      setDetailStates((current) => {
        const next = { ...current }
        delete next[fileId]
        return next
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error("[MemoryPanel] inline delete failed", err)
      void nativeMessage(t("memory.delete_failed", { error: msg }), {
        title: t("memory.delete_failed_title"),
      })
    }
  }

  const loadMemoryDetail = async (fileId: string) => {
    setDetailStates((current) => ({
      ...current,
      [fileId]: { loading: true, error: "", detail: current[fileId]?.detail ?? null },
    }))
    try {
      const data = await apiJson(memoryPath(`panel/knowledge/memory/${encodeURIComponent(fileId)}`, currentDirectory()))
      const f = data.file
      setDetailStates((current) => ({
        ...current,
        [fileId]: {
          loading: false,
          error: "",
          detail: {
            title: f.title,
            scope: f.scope,
            source: f.source,
            timeCreated: f.timeCreated,
            timeUpdated: f.timeUpdated,
            content: data.content || "",
          },
        },
      }))
    } catch (e: any) {
      setDetailStates((current) => ({
        ...current,
        [fileId]: {
          loading: false,
          error: e?.message || t("memory.load_failed"),
          detail: null,
        },
      }))
    }
  }

  const toggleMemoryDetail = (fileId: string) => {
    const next = expandedFileId() === fileId ? null : fileId
    setExpandedFileId(next)
    if (next && !detailStates()[next]) void loadMemoryDetail(next)
  }

  // Reload when taskID changes (reactive)
  createEffect(() => {
    if (!isActive() && !props.compact) return
    const taskID = currentTaskID()
    const directory = currentDirectory()
    void loadMemory(taskID, directory)
  })

  const badge = createMemo(() => {
    const n = files().length
    return n > 0 ? String(n) : ""
  })

  const emptyHint = createMemo(() => {
    if (errorMessage()) return errorMessage()
    if (searchMode()) return t("memory.no_results")
    if (currentTaskID()) return t("memory.none")
    return t("memory.none_unselected")
  })

  return (
    <div class="memory-panel" data-compact={props.compact ? "true" : "false"}>
      {/* Search toolbar */}
      <div class="knowledge-toolbar">
        <input
          id="memorySearch"
          type="text"
          class="knowledge-search"
          placeholder={t("memory.search_placeholder")}
          value={searchQuery()}
          onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void doSearch(searchQuery())
            }
          }}
        />
        <Button
          type="button"
          id="btnMemorySearch"
          variant="ghost"
          size="sm"
          tone="neutral"
          title={t("common.search")}
          aria-label={t("common.search")}
          disabled={loading()}
          onClick={handleSearchSubmit}
        >
          <Icon name="search" />
          <span class="tool-panel-action-label">{t("common.search")}</span>
        </Button>
        <Button
          type="button"
          id="btnMemoryRefresh"
          variant="ghost"
          size="sm"
          tone="neutral"
          title={t("common.refresh")}
          aria-label={t("common.refresh")}
          onClick={handleRefresh}
          disabled={loading()}
        >
          <Icon name="refresh" />
          <span class="tool-panel-action-label">{t("common.refresh")}</span>
        </Button>
      </div>

      {/* List */}
      <div id="memoryList" class="knowledge-list">
        <Show when={files().length > 0} fallback={<div class="empty-hint">{emptyHint()}</div>}>
          <For each={files()}>
            {(f) => {
              const time = formatDate(f.timeUpdated)
              const mode = searchMode() ? "search" : "list"
              const scoreHint = f.score != null ? ` · ${t("memory.score", { value: f.score.toFixed(2) })}` : ""
              const meta = `${f.source}${scoreHint}${time ? ` · ${time}` : ""}`
              const detailState = () => detailStates()[f.id]
              const detail = () => detailState()?.detail ?? null
              const expanded = () => expandedFileId() === f.id
              const detailElementId = () => `memory-detail-${f.id.replace(/[^A-Za-z0-9_-]/g, "-")}`

              return (
                <div
                  class="knowledge-item"
                  data-mode={mode}
                  data-id={f.id}
                  data-expanded={expanded() ? "true" : "false"}
                >
                  <div class="knowledge-item-row">
                    <button
                      type="button"
                      class="knowledge-item-main"
                      aria-expanded={expanded()}
                      aria-controls={expanded() ? detailElementId() : undefined}
                      onClick={() => toggleMemoryDetail(f.id)}
                    >
                      <span class="knowledge-item-title">{f.title}</span>
                      <span class="knowledge-item-meta-row">
                        <span class="knowledge-item-meta">{meta}</span>
                        <span class="knowledge-scope" data-scope={f.scope}>
                          {knowledgeScopeLabel(f.scope)}
                        </span>
                      </span>
                      <Show when={!!f.snippet}>
                        <span class="knowledge-item-meta">{f.snippet}</span>
                      </Show>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      tone="danger"
                      data-action="delete-memory"
                      data-id={f.id}
                      title={t("memory.delete_button_title")}
                      aria-label={t("memory.delete_button_title")}
                      onClick={() => void handleDeleteInline(f.id)}
                    >
                      {t("common.delete")}
                    </Button>
                  </div>
                  <Show when={expanded()}>
                    <div id={detailElementId()} class="memory-inline-detail">
                      <Show when={detailState()?.loading}>
                        <div class="loading-hint">{t("common.loading")}</div>
                      </Show>
                      <Show when={!detailState()?.loading && !!detailState()?.error}>
                        <div class="config-status-box" data-status="error">
                          {detailState()?.error}
                        </div>
                      </Show>
                      <Show when={!detailState()?.loading && !detailState()?.error && detail()}>
                        {(d) => (
                          <>
                            <div class="memory-detail-meta">
                              <span>{t("memory.source", { value: d().source })}</span>
                              <span>{t("memory.created", { value: formatDateTime(d().timeCreated) })}</span>
                              <span>{t("memory.updated", { value: formatDateTime(d().timeUpdated) })}</span>
                            </div>
                            <pre class="memory-detail-content">{d().content || t("memory.empty_value")}</pre>
                          </>
                        )}
                      </Show>
                    </div>
                  </Show>
                </div>
              )
            }}
          </For>
        </Show>
      </div>
    </div>
  )
}
