import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
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

function ChangeRowContent(props: { item: FileChange }) {
  return (
    <>
      <span class="change-main">
        <span class="change-path">{props.item.file}</span>
      </span>
      <span class="change-meta">
        <span class="change-status" data-status={props.item.status}>
          {changeStatusLabel(props.item.status)}
        </span>
        <span class="diff-dialog-stat" data-tone="add">
          +{props.item.additions ?? 0}
        </span>
        <span class="diff-dialog-stat" data-tone="del">
          -{props.item.deletions ?? 0}
        </span>
      </span>
    </>
  )
}

function shortCommit(ref: string | undefined): string {
  const value = String(ref || "").trim()
  return value.length > 12 ? value.slice(0, 12) : value
}

export function FileChangesView(props: FileChangesViewProps) {
  const [selectedGroupID, setSelectedGroupID] = createSignal("")
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
  const hideEmptySelection = createMemo(() => !!props.hasSelectedTask && files().length === 0)
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
    <Show when={!hideEmptySelection()}>
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

          <div class="changes-list" data-grouped={hasGoalGrouping() ? "true" : "false"}>
            <For each={hasGoalGrouping() ? groups() : [groups()[0]].filter(Boolean) as ChangeGroup[]}>
              {(group) => (
                <div
                  class="changes-list-chunk"
                  data-group-id={group.id}
                  data-active={
                    !hasGoalGrouping() || activeGroup()?.id === group.id ? "true" : "false"
                  }
                >
                  <For each={group.changes}>
                    {(item, index) => (
                      <>
                        <Show when={!props.onRowClick}>
                          <div
                            class="change-row"
                            data-clickable="false"
                            data-change-index={index()}
                            title={item.file}
                          >
                            <ChangeRowContent item={item} />
                          </div>
                        </Show>
                        <Show when={props.onRowClick} keyed>
                          {(onRowClick) => (
                            <button
                              type="button"
                              class="change-row"
                              data-clickable="true"
                              data-change-index={index()}
                              title={item.file}
                              onClick={() => onRowClick(group, item)}
                            >
                              <ChangeRowContent item={item} />
                            </button>
                          )}
                        </Show>
                      </>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={files().length === 0 && !props.hasSelectedTask}>
          <p class="empty-hint">{t("files.select_target")}</p>
        </Show>
      </div>
    </Show>
  )
}
