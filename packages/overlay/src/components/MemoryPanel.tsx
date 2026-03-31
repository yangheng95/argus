// ── MemoryPanel Component ──
// Knowledge/memory panel that lists memory files for the current task, supports
// search, shows detail dialogs, and allows deletion.
// Ports renderMemory ( 10549–10582), loadMemory (10487–10509),
// searchMemory (10511–10540), openMemoryDetail (10586–10610), deleteMemory
// (10612–10621), and knowledgeScopeLabel (10542–10547).

import {
  createSignal,
  createMemo,
  createEffect,
  For,
  Show,
} from "solid-js";
import { t } from "../utils/i18n";
import { apiJson } from "../services/api";

// ── Types ──

export interface MemoryFile {
  id: string;
  title: string;
  scope: string;
  source: string;
  score?: number;
  snippet?: string;
  timeUpdated: number;
}

interface MemoryDetail {
  title: string;
  scope: string;
  source: string;
  timeCreated: number;
  timeUpdated: number;
  content: string;
}

// ── Helpers ──

function knowledgeScopeLabel(scope: string): string {
  if (scope === "session") return t("memory.scope.session");
  if (scope === "cwd") return t("memory.scope.cwd");
  if (scope === "global") return t("memory.scope.global");
  return scope || "";
}

function formatDate(ts: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString();
}

function formatDateTime(ts: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString();
}

// ── MemoryItemDetail dialog ──

interface MemoryDetailDialogProps {
  fileId: string;
  taskID?: string;
  onClose: () => void;
  onDeleted: () => void;
}

function MemoryDetailDialog(props: MemoryDetailDialogProps) {
  let dialogRef: HTMLDialogElement | undefined;

  const [detail, setDetail] = createSignal<MemoryDetail | null>(null);
  const [errorMsg, setErrorMsg] = createSignal("");
  const [loading, setLoading] = createSignal(true);

  const load = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const data = await apiJson(
        `panel/knowledge/memory/${encodeURIComponent(props.fileId)}`,
      );
      const f = data.file;
      setDetail({
        title: f.title,
        scope: f.scope,
        source: f.source,
        timeCreated: f.timeCreated,
        timeUpdated: f.timeUpdated,
        content: data.content || "",
      });
    } catch (e: any) {
      setErrorMsg(e?.message || t("memory.load_failed"));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      await apiJson(
        `panel/knowledge/memory/${encodeURIComponent(props.fileId)}`,
        { method: "DELETE" },
      );
      dialogRef?.close();
      props.onDeleted();
    } catch {
 // Silently ignore; the list will refresh on close.
    }
  };

 // Load on mount
  load();

  return (
    <dialog
      class="dialog"
      ref={(el) => {
        dialogRef = el;
        if (el) queueMicrotask(() => el.showModal());
      }}
      onClose={props.onClose}
    >
      <div class="dialog-form">
        <div class="dialog-head">
          <span class="dialog-title">
            {loading()
              ? t("common.loading")
              : errorMsg()
                ? t("common.error")
                : (detail()?.title ?? "")}
          </span>
        </div>

        <Show when={!loading() && !errorMsg() && detail() !== null}>
          {(_) => {
            const d = detail()!;
            return (
              <>
                <div class="memory-detail-meta">
                  <span
                    class="knowledge-scope"
                    data-scope={d.scope}
                  >
                    {knowledgeScopeLabel(d.scope)}
                  </span>
                  <span>{t("memory.source", { value: d.source })}</span>
                  <span>
                    {t("memory.created", {
                      value: formatDateTime(d.timeCreated),
                    })}
                  </span>
                  <span>
                    {t("memory.updated", {
                      value: formatDateTime(d.timeUpdated),
                    })}
                  </span>
                </div>
                <pre class="memory-detail-content">
                  {d.content || t("memory.empty_value")}
                </pre>
              </>
            );
          }}
        </Show>

        <Show when={!loading() && !!errorMsg()}>
          <div class="config-status-box" data-status="error">{errorMsg()}</div>
        </Show>

        <Show when={loading()}>
          <div class="loading-hint">{t("common.loading")}</div>
        </Show>

        <div class="dialog-actions">
          <button
            type="button"
            class="btn btn-ghost mini danger"
            onClick={() => void handleDelete()}
          >
            {t("common.delete")}
          </button>
          <button
            type="button"
            class="btn btn-ghost"
            onClick={() => {
              dialogRef?.close();
              props.onClose();
            }}
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </dialog>
  );
}

// ── MemoryPanel ──

export interface MemoryPanelProps {
  /** Currently selected task ID — passed in from the host view. */
  taskID?: string;
}

export function MemoryPanel(props: MemoryPanelProps) {
  const [files, setFiles] = createSignal<MemoryFile[]>([]);
  const [searchMode, setSearchMode] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [detailFileId, setDetailFileId] = createSignal<string | null>(null);

 // ── Data loading ──

  const loadMemory = async () => {
    if (!props.taskID) {
      setFiles([]);
      setSearchMode(false);
      return;
    }
    setLoading(true);
    try {
      const query = `?taskID=${encodeURIComponent(props.taskID)}`;
      const data = await apiJson(`panel/knowledge/memory${query}`);
      setFiles(Array.isArray(data) ? data : []);
      setSearchMode(false);
    } catch {
      setFiles([]);
      setSearchMode(false);
    } finally {
      setLoading(false);
    }
  };

  const doSearch = async (q: string) => {
    if (!q || !q.trim()) {
      return loadMemory();
    }
    setLoading(true);
    try {
      const results = await apiJson("panel/knowledge/memory/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q.trim(),
          taskID: props.taskID || undefined,
          limit: 20,
        }),
      });
      const mapped: MemoryFile[] = (
        Array.isArray(results) ? results : []
      ).map((r: any) => ({
        id: r.fileId,
        title: r.fileTitle,
        scope: r.scope || "global",
        source: t("memory.search_source"),
        score: r.score,
        snippet: r.content ? r.content.slice(0, 200) : "",
        timeUpdated: r.timeCreated || 0,
      }));
      setFiles(mapped);
      setSearchMode(true);
    } catch {
 // Leave current results in place on search error
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e: Event) => {
    e.preventDefault();
    void doSearch(searchQuery());
  };

  const handleRefresh = () => {
    setSearchQuery("");
    void loadMemory();
  };

  const handleDeleteInline = async (fileId: string) => {
    try {
      await apiJson(
        `panel/knowledge/memory/${encodeURIComponent(fileId)}`,
        { method: "DELETE" },
      );
      await loadMemory();
    } catch {
 // Silently ignore
    }
  };

  // Reload when taskID changes (reactive)
  createEffect(() => {
    const _ = props.taskID;
    void loadMemory();
  });

  const badge = createMemo(() => {
    const n = files().length;
    return n > 0 ? String(n) : "";
  });

  const emptyHint = createMemo(() => {
    if (searchMode()) return t("memory.no_results");
    if (props.taskID) return t("memory.none");
    return t("memory.none_unselected");
  });

  return (
    <>
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
              e.preventDefault();
              void doSearch(searchQuery());
            }
          }}
        />
        <button
          type="button"
          id="btnMemorySearch"
          class="btn btn-ghost mini"
          disabled={loading()}
          onClick={handleSearchSubmit}
        >
          {t("common.search")}
        </button>
        <button
          type="button"
          id="btnMemoryRefresh"
          class="btn btn-ghost mini"
          onClick={handleRefresh}
          disabled={loading()}
        >
          {t("common.refresh")}
        </button>
      </div>

      {/* List */}
      <div id="memoryList" class="knowledge-list">
        <Show
          when={files().length > 0}
          fallback={<div class="empty-hint">{emptyHint()}</div>}
        >
          <For each={files()}>
            {(f) => {
              const time = formatDate(f.timeUpdated);
              const mode = searchMode() ? "search" : "list";
              const scoreHint =
                f.score != null
                  ? ` · ${t("memory.score", { value: f.score.toFixed(2) })}`
                  : "";
              const meta = `${f.source}${scoreHint}${time ? ` · ${time}` : ""}`;

              return (
                <div
                  class="knowledge-item"
                  data-mode={mode}
                  data-id={f.id}
                  onClick={() => setDetailFileId(f.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setDetailFileId(f.id);
                  }}
                >
                  <div class="knowledge-item-main">
                    <div class="knowledge-item-title">{f.title}</div>
                    <div class="knowledge-item-meta">{meta}</div>
                    <Show when={!!f.snippet}>
                      <div class="knowledge-item-meta">{f.snippet}</div>
                    </Show>
                  </div>
                  <div class="knowledge-item-actions">
                    <span class="knowledge-scope" data-scope={f.scope}>
                      {knowledgeScopeLabel(f.scope)}
                    </span>
                    <button
                      type="button"
                      class="btn btn-ghost mini danger knowledge-delete"
                      data-action="delete-memory"
                      data-id={f.id}
                      title={t("memory.delete_button_title")}
                      aria-label={t("memory.delete_button_title")}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteInline(f.id);
                      }}
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                </div>
              );
            }}
          </For>
        </Show>
      </div>

      {/* Detail dialog (rendered conditionally) */}
      <Show when={detailFileId() !== null}>
        <MemoryDetailDialog
          fileId={detailFileId()!}
          taskID={props.taskID}
          onClose={() => setDetailFileId(null)}
          onDeleted={() => {
            setDetailFileId(null);
            void loadMemory();
          }}
        />
      </Show>
    </>
  );
}
