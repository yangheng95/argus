import { createMemo, createSignal, For, Show } from "solid-js"
import type { MissionRecord } from "../services/mission"
import { detailStamp, relativeTime } from "../utils/time"
import { t } from "../utils/i18n"
import { compactDirectory } from "../utils/mission-helpers"
import { projectDirectoryKey, projectDirectoryLabel } from "../utils/project-directory"
import { useArmedConfirm } from "../solid/armed-confirm"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"
import { LedgerList } from "./LedgerList"

export interface MissionListProps {
  missions: MissionRecord[]
  selectedSessionID?: string
  loading?: boolean
  error?: string
  searchQuery: string
  onSearchChange: (next: string) => void
  onSelectMission: (mission: MissionRecord) => void
  onAbortMission: (mission: MissionRecord) => void
  onDeleteMission: (mission: MissionRecord) => void
  onRenameMission: (mission: MissionRecord, title: string) => void | Promise<void>
  onBackToPanel: () => void
  onCreateMission: () => void
  onRetry: () => void
  actionBusy?: string
}

type MissionGroup = {
  directory: string
  latest: number
  items: MissionRecord[]
}

function missionProjectTip(directory: string, count: number): string {
  return [directory || t("task.project.unknown"), String(count)].filter(Boolean).join(" / ")
}

const CONFIRM_WINDOW_MS = 3000

function MissionAbortButton(props: { mission: MissionRecord; onAbort: (mission: MissionRecord) => void }) {
  const confirmAbort = useArmedConfirm(CONFIRM_WINDOW_MS)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      tone="neutral"
      data-chrome="icon-action"
      data-ui="mission-row-abort"
      data-confirm={confirmAbort.armed() ? "true" : undefined}
      title={t("mission.ledger.abort_title")}
      aria-label={t("mission.ledger.abort_title")}
      onClick={(event) => {
        event.stopPropagation()
        confirmAbort.confirm(() => props.onAbort(props.mission))
      }}
      onBlur={confirmAbort.disarm}
    >
      <span class="mission-row-abort-icon" data-icon="abort" aria-hidden="true">
        <Icon name="stop" size={11} />
      </span>
      <span class="mission-row-abort-icon" data-icon="confirm" aria-hidden="true">
        <Icon name="check" size={11} />
      </span>
    </Button>
  )
}

function MissionDeleteButton(props: { mission: MissionRecord; onDelete: (mission: MissionRecord) => void }) {
  const confirmDelete = useArmedConfirm(CONFIRM_WINDOW_MS)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      tone="danger"
      data-chrome="icon-action"
      data-ui="mission-row-delete"
      data-confirm={confirmDelete.armed() ? "true" : undefined}
      title={t("mission.ledger.delete_title")}
      aria-label={t("mission.ledger.delete_title")}
      onClick={(event) => {
        event.stopPropagation()
        confirmDelete.confirm(() => props.onDelete(props.mission))
      }}
      onBlur={confirmDelete.disarm}
    >
      <span class="mission-row-delete-icon" data-icon="delete" aria-hidden="true">
        <Icon name="close" size={11} />
      </span>
      <span class="mission-row-delete-icon" data-icon="confirm" aria-hidden="true">
        <Icon name="check" size={11} />
      </span>
    </Button>
  )
}

function MissionRenameButton(props: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      tone="neutral"
      data-chrome="icon-action"
      data-ui="mission-row-rename"
      title={t("mission.ledger.rename_title")}
      aria-label={t("mission.ledger.rename_title")}
      onClick={(event) => {
        event.stopPropagation()
        props.onClick()
      }}
    >
      <Icon name="edit" size={11} />
    </Button>
  )
}

function MissionRow(props: {
  mission: MissionRecord
  selected: boolean
  onSelectMission: (mission: MissionRecord) => void
  onAbortMission: (mission: MissionRecord) => void
  onDeleteMission: (mission: MissionRecord) => void
  onRenameMission: (mission: MissionRecord, title: string) => void | Promise<void>
}) {
  const [editing, setEditing] = createSignal(false)
  const [draftTitle, setDraftTitle] = createSignal("")
  let inputRef: HTMLInputElement | undefined
  const title = () => props.mission.title || props.mission.missionID

  function beginRename(): void {
    setDraftTitle(title())
    setEditing(true)
    queueMicrotask(() => {
      inputRef?.focus()
      inputRef?.select()
    })
  }

  function cancelRename(): void {
    setEditing(false)
    setDraftTitle("")
  }

  function commitRename(): void {
    const next = draftTitle().trim()
    setEditing(false)
    setDraftTitle("")
    if (!next || next === title().trim()) return
    void props.onRenameMission(props.mission, next)
  }

  return (
    <div
      role="button"
      tabindex={0}
      class="ledger-row mission-row"
      data-ui="mission-row"
      data-mission-id={props.mission.missionID}
      data-session-id={props.mission.sessionID}
      data-active={props.selected ? "true" : undefined}
      onClick={() => {
        if (editing()) return
        props.onSelectMission(props.mission)
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        if (!editing()) props.onSelectMission(props.mission)
      }}
      onDblClick={(event) => {
        event.stopPropagation()
        event.preventDefault()
        beginRename()
      }}
    >
      <span class="ledger-row-icon" aria-hidden="true">
        <Icon name="mission" size={14} />
      </span>
      <span class="ledger-row-main">
        <Show
          when={!editing()}
          fallback={
            <input
              ref={(el) => {
                inputRef = el
              }}
              class="mission-row-rename-input"
              data-ui="mission-row-rename-input"
              type="text"
              maxLength={200}
              value={draftTitle()}
              aria-label={t("mission.ledger.rename_placeholder")}
              placeholder={t("mission.ledger.rename_placeholder")}
              onInput={(event) => setDraftTitle(event.currentTarget.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  commitRename()
                } else if (event.key === "Escape") {
                  event.preventDefault()
                  cancelRename()
                }
              }}
              onBlur={() => {
                queueMicrotask(() => {
                  if (editing()) commitRename()
                })
              }}
            />
          }
        >
          <span class="ledger-row-title">{title()}</span>
        </Show>
        <span class="ledger-row-meta">
          <span>{props.mission.missionID}</span>
          <span>{compactDirectory(props.mission.directory)}</span>
        </span>
      </span>
      <span class="ledger-row-right">
        <span class="ledger-row-stamp" title={detailStamp(props.mission.updated)}>
          {relativeTime(props.mission.updated) || t("mission.ledger.updated_unknown")}
        </span>
        <span class="mission-row-actions">
          <MissionAbortButton mission={props.mission} onAbort={props.onAbortMission} />
          <MissionRenameButton onClick={beginRename} />
          <MissionDeleteButton mission={props.mission} onDelete={props.onDeleteMission} />
        </span>
      </span>
    </div>
  )
}

export function MissionList(props: MissionListProps) {
  const [collapsedDirectories, setCollapsedDirectories] = createSignal<Record<string, boolean>>({})
  const groupedMissions = createMemo<MissionGroup[]>(() => {
    const groups = new Map<string, MissionGroup>()
    for (const mission of props.missions) {
      const directory = mission.directory || ""
      let group = groups.get(directory)
      if (!group) {
        group = { directory, latest: 0, items: [] }
        groups.set(directory, group)
      }
      group.items.push(mission)
      if (mission.updated > group.latest) group.latest = mission.updated
    }
    return [...groups.values()]
      .map((group) => ({
        ...group,
        items: [...group.items].sort((a, b) => b.updated - a.updated),
      }))
      .sort((a, b) => b.latest - a.latest)
  })

  function isDirectoryCollapsed(directory: string): boolean {
    return collapsedDirectories()[projectDirectoryKey(directory)] === true
  }

  function toggleDirectoryGroup(directory: string): void {
    const key = projectDirectoryKey(directory)
    setCollapsedDirectories((current) => {
      const next = { ...current }
      if (next[key]) delete next[key]
      else next[key] = true
      return next
    })
  }

  return (
    <aside class="mission-ledger" data-ui="mission-ledger">
      <header class="mission-ledger-header oc-surface-header">
        <span class="mission-ledger-title oc-surface-header__title">{t("mission.ledger.title")}</span>
        <div class="mission-ledger-header-actions oc-surface-header__actions" role="toolbar" aria-label={t("mission.ledger.title")}>
          <Button
            type="button"
            variant="ghost"
            size="md"
            tone="neutral"
            data-ui="mission-back-panel"
            title={t("mission.back_title")}
            aria-label={t("mission.back")}
            onClick={props.onBackToPanel}
          >
            <Icon name="panel-left" size={13} />
            <span>{t("mission.back")}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            tone="accent"
            data-ui="mission-new"
            title={t("mission.new_title")}
            aria-label={t("mission.new")}
            onClick={props.onCreateMission}
          >
            <Icon name="plus" size={13} />
            <span>{t("mission.new")}</span>
          </Button>
        </div>
      </header>

      <div class="mission-ledger-search">
        <Icon name="search" size={12} class="mission-ledger-search-icon" />
        <input
          type="search"
          class="mission-ledger-search-input"
          placeholder={t("mission.ledger.search_placeholder")}
          value={props.searchQuery}
          onInput={(e) => props.onSearchChange(e.currentTarget.value)}
          aria-label={t("mission.ledger.search_placeholder")}
          data-ui="mission-search"
        />
        <button
          type="button"
          class="mission-ledger-search-clear"
          aria-label={t("mission.ledger.search_clear")}
          title={t("mission.ledger.search_clear")}
          hidden={!props.searchQuery}
          onClick={() => props.onSearchChange("")}
        >
          <Icon name="close" size={10} />
        </button>
      </div>

      <div class="mission-ledger-list">
        <LedgerList
          items={groupedMissions()}
          loading={props.loading}
          error={props.error}
          emptyLabel={props.searchQuery ? t("mission.ledger.empty_filtered") : t("mission.ledger.empty")}
          retryLabel={t("mission.ledger.error_retry")}
          onRetry={props.onRetry}
        >
          {(group) => {
            const label = projectDirectoryLabel(group.directory, t("task.project.unknown"))
            const collapsed = () => isDirectoryCollapsed(group.directory)
            return (
              <section
                class="project-group mission-project-group"
                data-ui="mission-project-group"
                data-collapsed={collapsed() ? "true" : undefined}
              >
                <button
                  type="button"
                  class="project-group-heading"
                  title={missionProjectTip(group.directory, group.items.length)}
                  aria-expanded={collapsed() ? "false" : "true"}
                  aria-label={label.name}
                  onClick={() => toggleDirectoryGroup(group.directory)}
                >
                  <span class="project-group-icon" aria-hidden="true">
                    <Icon name={collapsed() ? "folder" : "folder-open"} size={15} />
                  </span>
                  <span class="project-group-copy">
                    <span class="project-group-name">{label.name}</span>
                    <Show when={label.parent}>
                      <span class="project-group-parent">{label.parent}</span>
                    </Show>
                  </span>
                  <span class="project-group-count" aria-label={String(group.items.length)}>
                    {group.items.length}
                  </span>
                  <span class="project-group-chevron" aria-hidden="true">
                    <Icon name={collapsed() ? "chevron" : "chevron-down"} size={12} />
                  </span>
                </button>
                <Show when={!collapsed()}>
                  <div class="project-group-body">
                    <For each={group.items}>
                      {(mission) => (
                        <MissionRow
                          mission={mission}
                          selected={props.selectedSessionID === mission.sessionID}
                          onSelectMission={props.onSelectMission}
                          onAbortMission={props.onAbortMission}
                          onDeleteMission={props.onDeleteMission}
                          onRenameMission={props.onRenameMission}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </section>
            )
          }}
        </LedgerList>
      </div>
    </aside>
  )
}
