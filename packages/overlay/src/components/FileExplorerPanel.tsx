import { createDeferred, createEffect, createMemo, createResource, createSignal, For, onMount, Show } from "solid-js"
import { Virtualizer, type CustomContainerComponentProps, type CustomItemComponentProps } from "virtua/solid"
import { apiJson } from "../services/api"
import { openFileEditor, selectedFilePath, type FileNode } from "../services/file-workbench"
import { t } from "../utils/i18n"
import { Icon } from "./Icon"

const VIRTUAL_EXPLORER_ROW_THRESHOLD = 120
const EXPLORER_ROW_HEIGHT = 26
const SEARCH_LIMIT = 80

type ExplorerRow =
  | { kind: "node"; key: string; node: FileNode; depth: number; expanded: boolean; loading: boolean }
  | { kind: "search"; key: string; path: string; depth: number }

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
  return await apiJson(`file?path=${encodeURIComponent(path)}`) as FileNode[]
}

async function searchFiles(query: string): Promise<string[]> {
  const params = new URLSearchParams({
    query,
    type: "file",
    limit: String(SEARCH_LIMIT),
  })
  return await apiJson(`find/file?${params.toString()}`) as string[]
}

export function FileExplorerPanel() {
  const [query, setQuery] = createSignal("")
  const deferredQuery = createDeferred(() => query().trim())
  const [expandedPaths, setExpandedPaths] = createSignal(new Set<string>([""]))
  const [childrenByPath, setChildrenByPath] = createSignal(new Map<string, FileNode[]>())
  const [loadingPaths, setLoadingPaths] = createSignal(new Set<string>())

  const loadDirectory = async (path: string) => {
    if (childrenByPath().has(path) || loadingPaths().has(path)) return
    setLoadingPaths((prev) => new Set(prev).add(path))
    try {
      const nodes = await listDirectory(path)
      setChildrenByPath((prev) => {
        const next = new Map(prev)
        next.set(path, nodes)
        return next
      })
    } catch (error) {
      console.error("[file-explorer] list failed", path, error)
      setChildrenByPath((prev) => {
        const next = new Map(prev)
        next.set(path, [])
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

  onMount(() => {
    void loadDirectory("")
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
        })
        if (nodeExpanded) pushChildren(node.path, depth + 1)
      }
    }
    pushChildren("", 0)
    return output
  })

  const shouldVirtualize = createMemo(() => rows().length > VIRTUAL_EXPLORER_ROW_THRESHOLD)

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
        <Icon name={isDirectory ? row.expanded ? "folder-open" : "folder" : "file-document"} size={13} />
        <span class="file-explorer-name">{node.name}</span>
        <Show when={row.loading}>
          <span class="file-explorer-meta">{t("common.loading")}</span>
        </Show>
      </button>
    )
  }

  return (
    <section class="file-explorer-panel" aria-label={t("explorer.title")}>
      <div class="file-explorer-toolbar">
        <label class="file-explorer-search">
          <Icon name="search" size={12} />
          <input
            class="file-explorer-search-input field-input"
            type="search"
            value={query()}
            placeholder={t("explorer.search_placeholder")}
            aria-label={t("explorer.search_placeholder")}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      </div>
      <div
        class="file-explorer-list"
        data-virtualized={shouldVirtualize() ? "true" : "false"}
        data-searching={deferredQuery() ? "true" : "false"}
        role="tree"
        aria-label={t("explorer.title")}
      >
        <Show
          when={rows().length > 0}
          fallback={
            <p class="empty-hint file-explorer-empty">
              {deferredQuery() ? t("explorer.no_matches") : t("explorer.empty")}
            </p>
          }
        >
          <Show
            when={shouldVirtualize()}
            fallback={<For each={rows()}>{renderRow}</For>}
          >
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
      </div>
    </section>
  )
}
