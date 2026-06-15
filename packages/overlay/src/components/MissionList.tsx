import { createMemo, createSignal, For, Show } from "solid-js"
import type { MissionRecord, MissionTaskProjection, MissionTaskStatus } from "../services/mission"
import { detailStamp, relativeTime } from "../utils/time"
import { t } from "../utils/i18n"
import { projectDirectoryKey, projectDirectoryLabel } from "../utils/project-directory"
import { buildMissionDebugBlob, writeDebugClipboard } from "../utils/debug-info"
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
  onSelectTask: (taskID: string) => void
  onAbortMission: (mission: MissionRecord) => void
  onDeleteMission: (mission: MissionRecord) => void
  onRenameMission: (mission: MissionRecord, title: string) => void | Promise<void>
  onRetry: () => void
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
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

function missionRowTip(mission: MissionRecord): string {
  return [mission.title || mission.missionID, mission.missionID ? `ID: ${mission.missionID}` : "", mission.directory]
    .filter(Boolean)
    .join(" / ")
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
      data-ui="task-row-cancel"
      data-confirm={confirmAbort.armed() ? "true" : undefined}
      title={t("mission.ledger.abort_title")}
      aria-label={t("mission.ledger.abort_title")}
      onClick={(event) => {
        event.stopPropagation()
        confirmAbort.confirm(() => props.onAbort(props.mission))
      }}
      onBlur={confirmAbort.disarm}
    >
      <span class="task-row-cancel-icon" data-icon="cancel" aria-hidden="true">
        <Icon name="stop" size={11} />
      </span>
      <span class="task-row-cancel-icon" data-icon="confirm" aria-hidden="true">
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
      data-ui="task-row-delete"
      data-confirm={confirmDelete.armed() ? "true" : undefined}
      title={t("mission.ledger.delete_title")}
      aria-label={t("mission.ledger.delete_title")}
      onClick={(event) => {
        event.stopPropagation()
        confirmDelete.confirm(() => props.onDelete(props.mission))
      }}
      onBlur={confirmDelete.disarm}
    >
      <span class="task-row-delete-icon" data-icon="delete" aria-hidden="true">
        <Icon name="close" size={11} />
      </span>
      <span class="task-row-delete-icon" data-icon="confirm" aria-hidden="true">
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
      data-ui="task-row-rename"
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

function missionTaskStatusLabel(status: MissionTaskStatus): string {
  const value = t(`task.status.${status}`)
  return value === `task.status.${status}` ? status : value
}

function missionTaskProjectionTip(task: MissionTaskProjection): string {
  return [task.title || task.id, task.id ? `ID: ${task.id}` : "", task.directory].filter(Boolean).join(" / ")
}

function MissionTaskProjectionRow(props: { task: MissionTaskProjection; onSelectTask: (taskID: string) => void }) {
  return (
    <li
      class="mission-task-projection-row"
      data-ui="mission-task-projection"
      data-task-id={props.task.id}
      data-status={props.task.status}
    >
      <button
        type="button"
        class="mission-task-projection-button"
        data-ui="mission-task-projection-select"
        title={missionTaskProjectionTip(props.task)}
        onClick={(event) => {
          event.stopPropagation()
          props.onSelectTask(props.task.id)
        }}
      >
        <span class="mission-task-projection-main">
          <span class="mission-task-projection-title">{props.task.title || props.task.id}</span>
        </span>
        <span class="mission-task-projection-status" data-status={props.task.status}>
          {missionTaskStatusLabel(props.task.status)}
        </span>
      </button>
    </li>
  )
}

function MissionRow(props: {
  mission: MissionRecord
  selected: boolean
  onSelectMission: (mission: MissionRecord) => void
  onSelectTask: (taskID: string) => void
  onAbortMission: (mission: MissionRecord) => void
  onDeleteMission: (mission: MissionRecord) => void
  onRenameMission: (mission: MissionRecord, title: string) => void | Promise<void>
}) {
  const [editing, setEditing] = createSignal(false)
  const [draftTitle, setDraftTitle] = createSignal("")
  const [debugCopied, setDebugCopied] = createSignal(false)
  let inputRef: HTMLInputElement | undefined
  const title = () => props.mission.title || props.mission.missionID
  const canAbort = () => props.mission.interruptible

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

  async function copyMissionDebugInfo(): Promise<void> {
    await writeDebugClipboard(buildMissionDebugBlob(props.mission))
    setDebugCopied(true)
    setTimeout(() => setDebugCopied(false), 1200)
  }

  return (
    <div class="mission-row-shell" data-ui="mission-row-shell" data-mission-id={props.mission.missionID}>
      <div
        role="button"
        tabindex={0}
        class="task-row-mini global-task-row mission-row"
        data-ui="mission-row"
        data-mission-id={props.mission.missionID}
        data-session-id={props.mission.sessionID}
        data-active={props.selected ? "true" : undefined}
        data-copied={debugCopied() ? "true" : undefined}
        title={debugCopied() ? t("common.copied") : missionRowTip(props.mission)}
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
          if (editing()) return
          void copyMissionDebugInfo().catch((error) => {
            console.error("[mission-row dblclick] clipboard write failed", error)
          })
        }}
      >
        <span class="task-row-badge mission-row-kind-badge" aria-hidden="true">
          <Icon name="mission" size={14} />
        </span>
        <div class="task-row-body">
          <Show
            when={!editing()}
            fallback={
              <div class="task-row-main task-row-main--editing" data-ui="mission-row-rename-editor">
                <div class="task-row-head">
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
                </div>
              </div>
            }
          >
            <button
              type="button"
              class="task-row-main mission-row-main"
              title={debugCopied() ? t("common.copied") : missionRowTip(props.mission)}
              onClick={(event) => {
                event.stopPropagation()
                props.onSelectMission(props.mission)
              }}
              onDblClick={(event) => {
                event.stopPropagation()
                event.preventDefault()
                void copyMissionDebugInfo().catch((error) => {
                  console.error("[mission-row-title dblclick] clipboard write failed", error)
                })
              }}
            >
              <div class="task-row-head">
                <strong>{title()}</strong>
              </div>
            </button>
          </Show>
        </div>
        <div class="task-row-right">
          <small class="task-row-stamp mission-row-stamp" title={detailStamp(props.mission.updated)}>
            {relativeTime(props.mission.updated) || t("mission.ledger.updated_unknown")}
          </small>
          <div class="task-row-actions">
            <Show when={canAbort()}>
              <MissionAbortButton mission={props.mission} onAbort={props.onAbortMission} />
            </Show>
            <MissionRenameButton onClick={beginRename} />
            <MissionDeleteButton mission={props.mission} onDelete={props.onDeleteMission} />
          </div>
        </div>
      </div>
      <Show when={props.mission.tasks.length > 0}>
        <ul class="mission-task-projection-list" aria-label={t("mission.ledger.tasks_label")}>
          <For each={props.mission.tasks}>
            {(task) => <MissionTaskProjectionRow task={task} onSelectTask={props.onSelectTask} />}
          </For>
        </ul>
      </Show>
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
    <div class="mission-ledger" data-ui="mission-ledger">
      <div class="mission-ledger-controls">
        <div class="mission-ledger-search search-field">
          <Icon name="search" size={12} class="mission-ledger-search-icon search-field-icon" />
          <input
            type="search"
            class="mission-ledger-search-input search-field-input"
            placeholder={t("mission.ledger.search_placeholder")}
            value={props.searchQuery}
            onInput={(e) => props.onSearchChange(e.currentTarget.value)}
            aria-label={t("mission.ledger.search_placeholder")}
            data-ui="mission-search"
          />
          <Show when={props.searchQuery}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              tone="neutral"
              data-chrome="icon-action"
              data-ui="mission-ledger-search-clear"
              aria-label={t("mission.ledger.search_clear")}
              title={t("mission.ledger.search_clear")}
              onClick={() => props.onSearchChange("")}
            >
              <Icon name="close" />
            </Button>
          </Show>
        </div>
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
                          onSelectTask={props.onSelectTask}
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
        <Show when={props.hasMore}>
          <div class="project-group-show-more mission-ledger-load-more">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              tone="neutral"
              data-ui="mission-ledger-load-more"
              disabled={props.loadingMore}
              onClick={() => props.onLoadMore?.()}
            >
              {props.loadingMore ? t("common.loading") : t("acceptance.show_more")}
            </Button>
          </div>
        </Show>
      </div>
    </div>
  )
}
