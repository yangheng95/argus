import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Virtualizer, type CustomContainerComponentProps, type CustomItemComponentProps, type VirtualizerHandle } from "virtua/solid"
import type { ChangeGroup } from "../services/diff"
import { useDisclosure } from "../solid/disclosure"
import { useHotkey } from "../solid/hotkey"
import { t, tc } from "../utils/i18n"
import { changeStatusLabel, type FileChange } from "./DiffView"
import { Icon } from "./Icon"

export interface FileChangesViewProps {
  groups: ChangeGroup[]
  hasSelectedTask?: boolean
  showHeading?: boolean
  focusEvent?: string
  onRowClick?: (group: ChangeGroup, item: FileChange) => void
}

const VIRTUAL_CHANGE_ROW_THRESHOLD = 80
const VIRTUAL_CHANGE_ROW_OVERSCAN = 10
const ESTIMATED_CHANGE_ROW_HEIGHT = 28

type ChangeStatusFilter = "all" | FileChange["status"]

const CHANGE_STATUS_FILTERS: ChangeStatusFilter[] = ["all", "modified", "added", "deleted"]

interface ChangeRowModel {
  group: ChangeGroup
  item: FileChange
  key: string
  index: number
  fileName: string
  directory: string
  searchText: string
}

function splitFilePath(file: string): { fileName: string; directory: string } {
  const normalized = String(file || "").replace(/\\/g, "/")
  const idx = normalized.lastIndexOf("/")
  if (idx < 0) return { fileName: normalized, directory: "" }
  return {
    fileName: normalized.slice(idx + 1) || normalized,
    directory: normalized.slice(0, idx),
  }
}

function ChangeRowContent(props: { row: ChangeRowModel }) {
  return (
    <>
      <span class="change-main">
        <span class="change-path-stack">
          <span class="change-file-name">{props.row.fileName}</span>
          <Show when={props.row.directory}>
            <span class="change-directory">{props.row.directory}</span>
          </Show>
        </span>
      </span>
      <span class="change-meta">
        <span class="change-status" data-status={props.row.item.status}>
          {changeStatusLabel(props.row.item.status)}
        </span>
        <span class="diff-dialog-stat" data-tone="add">
          +{props.row.item.additions ?? 0}
        </span>
        <span class="diff-dialog-stat" data-tone="del">
          -{props.row.item.deletions ?? 0}
        </span>
      </span>
    </>
  )
}

function ChangeRow(props: {
  row: ChangeRowModel
  selected: boolean
  onSelect: (key: string) => void
  onRowClick?: (group: ChangeGroup, item: FileChange) => void
}) {
  return (
    <>
      <Show when={!props.onRowClick}>
        <div
          class="change-row"
          data-clickable="false"
          data-change-index={props.row.index}
          data-selected={props.selected ? "true" : "false"}
          title={props.row.item.file}
          id={`change-row-${props.row.index}`}
          role="option"
          aria-selected={props.selected}
        >
          <ChangeRowContent row={props.row} />
        </div>
      </Show>
      <Show when={props.onRowClick} keyed>
        {(onRowClick) => (
          <button
            type="button"
            class="change-row"
            data-clickable="true"
            data-change-index={props.row.index}
            data-selected={props.selected ? "true" : "false"}
            aria-current={props.selected ? "true" : undefined}
            title={props.row.item.file}
            id={`change-row-${props.row.index}`}
            role="option"
            aria-selected={props.selected}
            onClick={() => {
              props.onSelect(props.row.key)
              onRowClick(props.row.group, props.row.item)
            }}
          >
            <ChangeRowContent row={props.row} />
          </button>
        )}
      </Show>
    </>
  )
}

function ChangesVirtualWindow(props: CustomContainerComponentProps) {
  const setRef = (node: HTMLDivElement) => {
    if (typeof props.ref === "function") props.ref(node)
  }
  return (
    <div ref={setRef} class="changes-list-virtual-window" style={props.style}>
      {props.children}
    </div>
  )
}

function ChangesVirtualItem(props: CustomItemComponentProps) {
  const setRef = (node: HTMLDivElement) => {
    if (typeof props.ref === "function") props.ref(node)
  }
  return (
    <div ref={setRef} class="changes-list-virtual-item" style={props.style}>
      {props.children}
    </div>
  )
}

function shortCommit(ref: string | undefined): string {
  const value = String(ref || "").trim()
  return value.length > 12 ? value.slice(0, 12) : value
}

export function FileChangesView(props: FileChangesViewProps) {
  let rowVirtualizer: VirtualizerHandle | undefined
  let filterInputEl: HTMLInputElement | undefined
  let listEl: HTMLDivElement | undefined
  const [selectedGroupID, setSelectedGroupID] = createSignal("")
  const [selectedRowKey, setSelectedRowKey] = createSignal("")
  const [filterQuery, setFilterQuery] = createSignal("")
  const [statusFilter, setStatusFilter] = createSignal<ChangeStatusFilter>("all")
  const goalMenu = useDisclosure()

  if (typeof document !== "undefined") {
    const onDocClick = (event: MouseEvent) => {
      if (!goalMenu.open()) return
      const target = event.target as Element | null
      if (target && target.closest && target.closest(".changes-goal-picker")) return
      goalMenu.close()
    }
    document.addEventListener("click", onDocClick, { capture: true })
    onCleanup(() => document.removeEventListener("click", onDocClick, { capture: true }))
  }
  useHotkey({ key: "Escape", when: () => goalMenu.open(), run: () => goalMenu.close() })

  const groups = createMemo<ChangeGroup[]>(() => props.groups.filter((group) => group.changes.length > 0))
  const files = createMemo<FileChange[]>(() => groups().flatMap((group) => group.changes))
  const hasGoalGrouping = createMemo(() => groups().some((group) => !!group.goalLabel))
  const activeGroup = createMemo<ChangeGroup | null>(() => {
    const currentGroups = groups()
    if (currentGroups.length === 0) return null
    const selectedID = selectedGroupID()
    return currentGroups.find((group) => group.id === selectedID) || currentGroups[0] || null
  })
  const totalAdditions = createMemo(() =>
    files().reduce((sum, item) => sum + (item.additions ?? 0), 0),
  )
  const totalDeletions = createMemo(() =>
    files().reduce((sum, item) => sum + (item.deletions ?? 0), 0),
  )
  const activeCommitRef = createMemo(() => activeGroup()?.commitRef || "")
  const activeRows = createMemo<ChangeRowModel[]>(() => {
    const group = activeGroup()
    if (!group) return []
    return group.changes.map((item, index) => {
      const path = splitFilePath(item.file)
      const status = changeStatusLabel(item.status)
      return {
        group,
        item,
        key: `${group.id}:${index}:${item.file}`,
        index,
        fileName: path.fileName,
        directory: path.directory,
        searchText: `${item.file} ${status}`.toLowerCase(),
      }
    })
  })
  const filteredRows = createMemo<ChangeRowModel[]>(() => {
    const query = filterQuery().trim().toLowerCase()
    const status = statusFilter()
    const rows = activeRows()
    return rows.filter((row) => {
      if (status !== "all" && row.item.status !== status) return false
      if (query && !row.searchText.includes(query)) return false
      return true
    })
  })
  const statusCounts = createMemo<Record<ChangeStatusFilter, number>>(() => {
    const counts: Record<ChangeStatusFilter, number> = {
      all: 0,
      modified: 0,
      added: 0,
      deleted: 0,
    }
    for (const row of activeRows()) {
      counts.all += 1
      counts[row.item.status] += 1
    }
    return counts
  })
  const shouldShowFilter = createMemo(() => activeRows().length > 8)
  const shouldVirtualizeRows = createMemo(() => filteredRows().length > VIRTUAL_CHANGE_ROW_THRESHOLD)
  const selectedRowPosition = createMemo(() =>
    filteredRows().findIndex((row) => row.key === selectedRowKey()),
  )
  const selectedRowID = createMemo(() => {
    const row = filteredRows()[selectedRowPosition()]
    return row ? `change-row-${row.index}` : undefined
  })
  const statusFilterLabel = (status: ChangeStatusFilter): string =>
    status === "all" ? t("files.status.all") : changeStatusLabel(status)
  const tabLabel = (group: ChangeGroup): string =>
    group.goalLabel || group.goalTitle || group.id
  const tabTitle = (group: ChangeGroup): string =>
    [group.goalLabel, group.goalTitle].filter(Boolean).join(" · ") || group.id

  createEffect(() => {
    const currentGroups = groups()
    const selectedID = selectedGroupID()
    if (currentGroups.length === 0) {
      if (selectedID) setSelectedGroupID("")
      return
    }
    if (selectedID && currentGroups.some((group) => group.id === selectedID)) return
    setSelectedGroupID(currentGroups[0]!.id)
  })

  createEffect(() => {
    activeGroup()
    setSelectedRowKey("")
    setFilterQuery("")
    setStatusFilter("all")
  })

  createEffect(() => {
    const rows = filteredRows()
    const current = selectedRowKey()
    if (rows.length === 0) {
      if (current) setSelectedRowKey("")
      return
    }
    if (current && rows.some((row) => row.key === current)) return
    setSelectedRowKey(rows[0]!.key)
  })

  const selectRowAt = (position: number) => {
    const rows = filteredRows()
    if (rows.length === 0) return
    const next = Math.max(0, Math.min(rows.length - 1, position))
    setSelectedRowKey(rows[next]!.key)
    if (shouldVirtualizeRows()) rowVirtualizer?.scrollToIndex(next)
  }

  const openSelectedRow = () => {
    if (!props.onRowClick) return
    const row = filteredRows()[Math.max(0, selectedRowPosition())]
    if (!row) return
    setSelectedRowKey(row.key)
    props.onRowClick(row.group, row.item)
  }

  const focusFilterInput = () => {
    if (!shouldShowFilter()) return false
    filterInputEl?.focus()
    filterInputEl?.select()
    return true
  }

  const onListKeyDown = (event: KeyboardEvent) => {
    if (event.key === "/" || (event.key.toLowerCase() === "f" && (event.ctrlKey || event.metaKey))) {
      if (focusFilterInput()) event.preventDefault()
      return
    }
    const rows = filteredRows()
    if (rows.length === 0) return
    const current = selectedRowPosition()
    const position = current >= 0 ? current : 0
    if (event.key === "ArrowDown") {
      event.preventDefault()
      selectRowAt(position + 1)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      selectRowAt(position - 1)
    } else if (event.key === "Home") {
      event.preventDefault()
      selectRowAt(0)
    } else if (event.key === "End") {
      event.preventDefault()
      selectRowAt(rows.length - 1)
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      openSelectedRow()
    }
  }

  const onFilterKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    if (filterQuery()) {
      setFilterQuery("")
      filterInputEl?.select()
      return
    }
    listEl?.focus()
  }

  onMount(() => {
    if (typeof window === "undefined" || !props.focusEvent) return
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ goalRunID?: string }>).detail
      const requestedRunID = detail?.goalRunID
      if (!requestedRunID) return
      const match = groups().find((group) => group.goalRunID === requestedRunID)
      if (match) setSelectedGroupID(match.id)
    }
    window.addEventListener(props.focusEvent, handler as EventListener)
    onCleanup(() => window.removeEventListener(props.focusEvent!, handler as EventListener))
  })

  return (
    <div class="file-changes-view">
      <Show when={props.showHeading}>
        <div class="file-changes-view__heading">
          <Icon name="file-document" />
          <span>{t("section.files")}</span>
        </div>
      </Show>
      <Show when={files().length > 0}>
        <div class="changes-summary">
          <span>{tc("files.changed", files().length)}</span>
          <span class="changes-total">
            <Show when={activeCommitRef()}>
              <span class="changes-commit" title={`commit ${activeCommitRef()}`}>
                commit {shortCommit(activeCommitRef())}
              </span>
            </Show>
            <span data-tone="add">+{totalAdditions()}</span>
            <span data-tone="del">-{totalDeletions()}</span>
          </span>
        </div>

          <Show when={hasGoalGrouping()}>
            <div
              class="changes-goal-picker"
              data-open={goalMenu.open() ? "true" : "false"}
            >
              <button
                type="button"
                class="changes-goal-picker-trigger"
                aria-haspopup="listbox"
                aria-expanded={goalMenu.open() ? "true" : "false"}
                title={activeGroup() ? tabTitle(activeGroup()!) : ""}
                onClick={(event) => {
                  event.stopPropagation()
                  goalMenu.toggle()
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    goalMenu.openIt()
                  }
                }}
              >
                <span class="changes-goal-picker-label">
                  {activeGroup() ? tabLabel(activeGroup()!) : ""}
                </span>
                <Show when={activeGroup()}>
                  <span class="changes-goal-picker-count" aria-hidden="true">
                    {activeGroup()!.changes.length}
                  </span>
                </Show>
                <span class="changes-goal-picker-caret" aria-hidden="true">
                  <Icon name="caret-down" size={8} />
                </span>
              </button>
              <Show when={goalMenu.open()}>
                <div
                  class="changes-goal-picker-menu"
                  role="listbox"
                  aria-label={t("section.files")}
                  onKeyDown={(event) => {
                    const list = groups()
                    if (list.length === 0) return
                    const currentIdx = Math.max(0, list.findIndex((group) => group.id === activeGroup()?.id))
                    let next = currentIdx
                    if (event.key === "ArrowDown") next = (currentIdx + 1) % list.length
                    else if (event.key === "ArrowUp") next = (currentIdx - 1 + list.length) % list.length
                    else if (event.key === "Home") next = 0
                    else if (event.key === "End") next = list.length - 1
                    else if (event.key === "Escape") {
                      goalMenu.close()
                      return
                    } else return
                    event.preventDefault()
                    setSelectedGroupID(list[next]!.id)
                  }}
                >
                  <For each={groups()}>
                    {(group) => {
                      const active = () => group.id === activeGroup()?.id
                      return (
                        <button
                          type="button"
                          class="changes-goal-picker-row"
                          role="option"
                          aria-selected={active()}
                          data-active={active() ? "true" : "false"}
                          title={tabTitle(group)}
                          onClick={() => {
                            setSelectedGroupID(group.id)
                            goalMenu.close()
                          }}
                        >
                          <span class="changes-goal-picker-row-label">{tabLabel(group)}</span>
                          <span class="changes-goal-picker-row-meta" aria-hidden="true">
                            <Show when={group.commitRef}>
                              <span class="changes-goal-picker-row-commit">
                                {shortCommit(group.commitRef)}
                              </span>
                            </Show>
                            <span class="changes-goal-picker-row-count">
                              {group.changes.length}
                            </span>
                          </span>
                        </button>
                      )
                    }}
                  </For>
                </div>
              </Show>
            </div>
          </Show>

          <Show when={shouldShowFilter()}>
            <div class="changes-toolbar">
              <label class="changes-filter-field">
                <Icon name="search" size={12} />
                <input
                  ref={filterInputEl}
                  class="changes-filter-input field-input"
                  type="search"
                  value={filterQuery()}
                  placeholder={t("files.filter_placeholder")}
                  aria-label={t("files.filter_placeholder")}
                  onInput={(event) => setFilterQuery(event.currentTarget.value)}
                  onKeyDown={onFilterKeyDown}
                />
              </label>
              <Show when={filterQuery().trim()}>
                <button
                  type="button"
                  class="changes-filter-clear"
                  aria-label={t("files.clear_filter")}
                  title={t("files.clear_filter")}
                  onClick={() => {
                    setFilterQuery("")
                    filterInputEl?.focus()
                  }}
                >
                  <Icon name="close" size={12} />
                </button>
              </Show>
            </div>
          </Show>

          <Show when={activeRows().length > 0}>
            <div class="changes-status-strip" role="toolbar" aria-label={t("files.status_filter_label")}>
              <For each={CHANGE_STATUS_FILTERS}>
                {(status) => {
                  const active = () => statusFilter() === status
                  const count = () => statusCounts()[status]
                  return (
                    <button
                      type="button"
                      class="changes-status-chip"
                      data-status={status}
                      data-active={active() ? "true" : "false"}
                      aria-pressed={active()}
                      onClick={() => setStatusFilter(status)}
                    >
                      <span class="changes-status-chip-label">{statusFilterLabel(status)}</span>
                      <span class="changes-status-chip-count" aria-hidden="true">{count()}</span>
                    </button>
                  )
                }}
              </For>
            </div>
          </Show>

          <div
            ref={listEl}
            class="changes-list"
            data-grouped={hasGoalGrouping() ? "true" : "false"}
            data-virtualized={shouldVirtualizeRows() ? "true" : "false"}
            role="listbox"
            aria-label={t("section.files")}
            aria-activedescendant={selectedRowID()}
            tabIndex={0}
            onKeyDown={onListKeyDown}
          >
            <Show when={filteredRows().length > 0} fallback={<p class="empty-hint changes-empty-hint">{t("files.no_matches")}</p>}>
              <Show
                when={shouldVirtualizeRows()}
                fallback={
                  <div
                    class="changes-list-chunk"
                    data-group-id={activeGroup()?.id || ""}
                    data-active="true"
                  >
                    <For each={filteredRows()}>
                      {(row) => (
                        <ChangeRow
                          row={row}
                          selected={selectedRowKey() === row.key}
                          onSelect={setSelectedRowKey}
                          onRowClick={props.onRowClick}
                        />
                      )}
                    </For>
                  </div>
                }
              >
                <Virtualizer
                  ref={(handle) => { rowVirtualizer = handle }}
                  data={filteredRows()}
                  overscan={VIRTUAL_CHANGE_ROW_OVERSCAN}
                  itemSize={ESTIMATED_CHANGE_ROW_HEIGHT}
                  as={ChangesVirtualWindow}
                  item={ChangesVirtualItem}
                >
                  {(row) => (
                    <ChangeRow
                      row={row}
                      selected={selectedRowKey() === row.key}
                      onSelect={setSelectedRowKey}
                      onRowClick={props.onRowClick}
                    />
                  )}
                </Virtualizer>
              </Show>
            </Show>
          </div>
      </Show>
      <Show when={files().length === 0}>
        <p class="empty-hint">{props.hasSelectedTask ? t("files.none") : t("files.select_target")}</p>
      </Show>
    </div>
  )
}
