import {
  createDeferred,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
  type Accessor,
} from "solid-js"
import { Virtualizer, type CustomContainerComponentProps, type CustomItemComponentProps } from "virtua/solid"
import { apiJson } from "../services/api"
import { openFileEditor, selectedFilePath, type FileNode } from "../services/file-workbench"
import { t } from "../utils/i18n"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"
import { SurfaceHeader } from "./ui/SurfaceHeader"

const VIRTUAL_EXPLORER_ROW_THRESHOLD = 120
const EXPLORER_ROW_HEIGHT = 26
const SEARCH_LIMIT = 80
const INITIAL_DIRECTORY_LOAD_DELAY_MS = 250
const ACTIVE_DIRECTORY_REFRESH_INTERVAL_MS = 15_000

type ExplorerRow =
  | { kind: "node"; key: string; node: FileNode; depth: number; expanded: boolean; loading: boolean; error: string }
  | { kind: "search"; key: string; path: string; depth: number }

export interface FileExplorerPanelProps {
  active?: Accessor<boolean>
  directory?: Accessor<string>
}

function ExplorerVirtualWindow(props: CustomContainerComponentProps) {
  const setRef = (node: HTMLDivElement) => {
    if (typeof props.ref === "function") props.ref(node)
  }
  return (
    <div ref={setRef} class="file-explorer-virtual-window" style={props.style}>
      {props.children}
    </div>
  )
}

function ExplorerVirtualItem(props: CustomItemComponentProps) {
  const setRef = (node: HTMLDivElement) => {
    if (typeof props.ref === "function") props.ref(node)
  }
  return (
    <div ref={setRef} class="file-explorer-virtual-item" style={props.style}>
      {props.children}
    </div>
  )
}

function parentPath(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean)
  parts.pop()
  return parts.join("/")
}

function fileName(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean)
  return parts.at(-1) || path
}

function dirname(path: string): string {
  return parentPath(path)
}

async function listDirectory(path: string): Promise<FileNode[]> {
  return (await apiJson(`file?path=${encodeURIComponent(path)}`)) as FileNode[]
}

async function searchFiles(query: string): Promise<string[]> {
  const params = new URLSearchParams({
    query,
    type: "file",
    limit: String(SEARCH_LIMIT),
  })
  return (await apiJson(`find/file?${params.toString()}`)) as string[]
}

export function FileExplorerPanel(props: FileExplorerPanelProps = {}) {
  const [query, setQuery] = createSignal("")
  const deferredQuery = createDeferred(() => query().trim())
  const [expandedPaths, setExpandedPaths] = createSignal(new Set<string>([""]))
  const [childrenByPath, setChildrenByPath] = createSignal(new Map<string, FileNode[]>())
  const [loadingPaths, setLoadingPaths] = createSignal(new Set<string>())
  const [directoryErrors, setDirectoryErrors] = createSignal(new Map<string, string>())
  const active = createMemo(() => props.active?.() ?? true)
  const directory = createMemo(() => (props.directory ? props.directory().trim() : "unscoped"))

  const loadDirectory = async (path: string, opts?: { force?: boolean }) => {
    if ((!opts?.force && childrenByPath().has(path)) || loadingPaths().has(path)) return
    setLoadingPaths((prev) => new Set(prev).add(path))
    setDirectoryErrors((prev) => {
      const next = new Map(prev)
      next.delete(path)
      return next
    })
    try {
      const nodes = await listDirectory(path)
      setChildrenByPath((prev) => {
        const next = new Map(prev)
        next.set(path, nodes)
        return next
      })
    } catch (error) {
      console.error("[file-explorer] list failed", path, error)
      setDirectoryErrors((prev) => {
        const next = new Map(prev)
        next.set(path, error instanceof Error ? error.message : String(error))
        return next
      })
    } finally {
      setLoadingPaths((prev) => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    }
  }

  createEffect(() => {
    const currentDirectory = directory()
    if (!active() || !currentDirectory) return
    setChildrenByPath(new Map())
    setLoadingPaths(new Set<string>())
    setDirectoryErrors(new Map())
    const timer = window.setTimeout(() => void loadDirectory(""), INITIAL_DIRECTORY_LOAD_DELAY_MS)
    onCleanup(() => window.clearTimeout(timer))
  })

  createEffect(() => {
    const currentDirectory = directory()
    if (!active() || !currentDirectory) return
    const interval = window.setInterval(() => {
      const paths = new Set(["", ...expandedPaths()])
      for (const path of paths) {
        if (path === "" || childrenByPath().has(path) || directoryErrors().has(path)) {
          void loadDirectory(path, { force: true })
        }
      }
    }, ACTIVE_DIRECTORY_REFRESH_INTERVAL_MS)
    onCleanup(() => window.clearInterval(interval))
  })

  createEffect(() => {
    const selected = selectedFilePath()
    if (!selected) return
    const ancestors: string[] = []
    let current = parentPath(selected)
    while (current) {
      ancestors.unshift(current)
      current = parentPath(current)
    }
    setExpandedPaths((prev) => new Set([...prev, "", ...ancestors]))
    for (const path of ["", ...ancestors]) void loadDirectory(path)
  })

  const [searchResults] = createResource(
    () => deferredQuery(),
    async (value) => {
      if (!value) return []
      return searchFiles(value)
    },
  )

  const rows = createMemo<ExplorerRow[]>(() => {
    const search = deferredQuery()
    if (search) {
      return (searchResults() ?? []).map((path) => ({
        kind: "search",
        key: `search:${path}`,
        path,
        depth: 0,
      }))
    }

    const expanded = expandedPaths()
    const children = childrenByPath()
    const loading = loadingPaths()
    const errors = directoryErrors()
    const output: ExplorerRow[] = []
    const pushChildren = (path: string, depth: number) => {
      for (const node of children.get(path) ?? []) {
        const nodeExpanded = node.type === "directory" && expanded.has(node.path)
        output.push({
          kind: "node",
          key: `node:${node.path}`,
          node,
          depth,
          expanded: nodeExpanded,
          loading: loading.has(node.path),
          error: errors.get(node.path) ?? "",
        })
        if (nodeExpanded) pushChildren(node.path, depth + 1)
      }
    }
    pushChildren("", 0)
    return output
  })

  const shouldVirtualize = createMemo(() => rows().length > VIRTUAL_EXPLORER_ROW_THRESHOLD)
  const rootLoading = createMemo(() => !deferredQuery() && loadingPaths().has("") && !childrenByPath().has(""))
  const searchLoading = createMemo(() => !!deferredQuery() && searchResults.loading)
  const rootError = createMemo(() => (!deferredQuery() ? (directoryErrors().get("") ?? "") : ""))

  const toggleDirectory = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    void loadDirectory(path)
  }

  const renderRow = (row: ExplorerRow) => {
    if (row.kind === "search") {
      return (
        <button
          type="button"
          class="file-explorer-row"
          data-kind="file"
          data-active={selectedFilePath() === row.path ? "true" : "false"}
          style={{ "padding-left": `calc(${row.depth * 14 + 3}px * var(--ui-scale))` }}
          title={row.path}
          onClick={() => openFileEditor(row.path)}
        >
          <span class="file-explorer-chevron" />
          <Icon name="file-document" size={13} />
          <span class="file-explorer-name">{fileName(row.path)}</span>
          <span class="file-explorer-dir">{dirname(row.path)}</span>
        </button>
      )
    }

    const node = row.node
    const isDirectory = node.type === "directory"
    return (
      <button
        type="button"
        class="file-explorer-row"
        data-kind={node.type}
        data-active={selectedFilePath() === node.path ? "true" : "false"}
        data-ignored={node.ignored ? "true" : "false"}
        style={{ "padding-left": `calc(${row.depth * 14 + 3}px * var(--ui-scale))` }}
        title={node.path}
        onClick={() => {
          if (isDirectory) toggleDirectory(node.path)
          else openFileEditor(node.path)
        }}
      >
        <span class="file-explorer-chevron" data-open={row.expanded ? "true" : "false"}>
          <Show when={isDirectory}>
            <Icon name="chevron" size={11} />
          </Show>
        </span>
        <Icon name={isDirectory ? (row.expanded ? "folder-open" : "folder") : "file-document"} size={13} />
        <span class="file-explorer-name">{node.name}</span>
        <Show when={row.loading}>
          <span class="file-explorer-meta">{t("common.loading")}</span>
        </Show>
        <Show when={!row.loading && row.error}>
          <span class="file-explorer-meta">{t("common.error")}</span>
        </Show>
      </button>
    )
  }

  return (
    <section class="file-explorer-panel" aria-label={t("explorer.title")}>
      <SurfaceHeader
        variant="panel"
        title={t("explorer.title")}
        actions={
          <label class="file-explorer-toolbar file-explorer-search search-field">
            <Icon name="search" size={12} class="search-field-icon" />
            <input
              class="file-explorer-search-input search-field-input field-input"
              type="search"
              value={query()}
              placeholder={t("explorer.search_placeholder")}
              aria-label={t("explorer.search_placeholder")}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
            <Show when={query()}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                tone="neutral"
                data-chrome="icon-action"
                data-ui="file-explorer-search-clear"
                onClick={() => setQuery("")}
                title={t("common.clear")}
                aria-label={t("common.clear")}
              >
                <Icon name="close" />
              </Button>
            </Show>
          </label>
        }
      />
      <div
        class="file-explorer-list"
        data-virtualized={shouldVirtualize() ? "true" : "false"}
        data-searching={deferredQuery() ? "true" : "false"}
        role="tree"
        aria-label={t("explorer.title")}
      >
        <Show
          when={!rootLoading() && !searchLoading()}
          fallback={<p class="empty-hint file-explorer-empty">{t("common.loading")}</p>}
        >
          <Show
            when={!rootError()}
            fallback={
              <div class="empty-hint file-explorer-empty">
                <p>{t("explorer.load_failed")}</p>
                <button type="button" class="file-explorer-retry" onClick={() => void loadDirectory("")}>
                  {t("common.retry")}
                </button>
              </div>
            }
          >
            <Show
              when={rows().length > 0}
              fallback={
                <p class="empty-hint file-explorer-empty">
                  {deferredQuery() ? t("explorer.no_matches") : t("explorer.empty")}
                </p>
              }
            >
              <Show when={shouldVirtualize()} fallback={<For each={rows()}>{renderRow}</For>}>
                <Virtualizer
                  data={rows()}
                  itemSize={EXPLORER_ROW_HEIGHT}
                  overscan={12}
                  as={ExplorerVirtualWindow}
                  item={ExplorerVirtualItem}
                >
                  {renderRow}
                </Virtualizer>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
    </section>
  )
}
