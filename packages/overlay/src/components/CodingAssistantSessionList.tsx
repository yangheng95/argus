import { createMemo, createSignal, For, Show } from "solid-js"
import type { CodingAssistantSessionInfo } from "../store/coding-assistant"
import { useArmedConfirm } from "../solid/armed-confirm"
import { t } from "../utils/i18n"
import { projectDirectoryKey, projectDirectoryLabel } from "../utils/project-directory"
import { detailStamp, relativeTime } from "../utils/time"
import { Icon } from "./Icon"
import { LedgerList } from "./LedgerList"
import { Button } from "./ui/Button"

export interface CodingAssistantSessionListProps {
  sessions: CodingAssistantSessionInfo[]
  selectedSessionID?: string
  loading?: boolean
  loadingMore?: boolean
  error?: string
  searchQuery: string
  hasMore?: boolean
  actionBusyID?: string
  onSearchChange: (next: string) => void
  onSelectSession: (session: CodingAssistantSessionInfo) => void
  onRenameSession: (session: CodingAssistantSessionInfo, title: string) => void | Promise<void>
  onDeleteSession: (session: CodingAssistantSessionInfo) => void
  onStopSession: (session: CodingAssistantSessionInfo) => void
  onRetry: () => void
  onLoadMore?: () => void
}

const CONFIRM_WINDOW_MS = 3000

type CodingAssistantGroup = {
  directory: string
  latest: number
  items: CodingAssistantSessionInfo[]
}

function sessionTitle(session: CodingAssistantSessionInfo): string {
  return session.title?.trim() || session.id
}

function sessionUpdated(session: CodingAssistantSessionInfo): number {
  return Number(session.time?.updated || session.time?.created || 0)
}

function sessionProjectDirectory(session: CodingAssistantSessionInfo): string {
  return session.directory || ""
}

function sessionProjectTip(directory: string, count: number): string {
  return [directory || t("task.project.unknown"), String(count)].filter(Boolean).join(" / ")
}

function sessionRowTip(session: CodingAssistantSessionInfo): string {
  return [sessionTitle(session), session.id ? `ID: ${session.id}` : "", sessionProjectDirectory(session)]
    .filter(Boolean)
    .join(" / ")
}

function CodingAssistantStopButton(props: {
  session: CodingAssistantSessionInfo
  disabled?: boolean
  onStop: (session: CodingAssistantSessionInfo) => void
}) {
  const confirmStop = useArmedConfirm(CONFIRM_WINDOW_MS)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      tone="neutral"
      disabled={props.disabled}
      data-chrome="icon-action"
      data-ui="coding-assistant-row-stop"
      data-confirm={confirmStop.armed() ? "true" : undefined}
      title={t("coding_assistant.ledger.stop_title")}
      aria-label={t("coding_assistant.ledger.stop_title")}
      onClick={(event) => {
        event.stopPropagation()
        confirmStop.confirm(() => props.onStop(props.session))
      }}
      onBlur={confirmStop.disarm}
    >
      <span class="coding-assistant-row-stop-icon" data-icon="stop" aria-hidden="true">
        <Icon name="stop" size={11} />
      </span>
      <span class="coding-assistant-row-stop-icon" data-icon="confirm" aria-hidden="true">
        <Icon name="check" size={11} />
      </span>
    </Button>
  )
}

function CodingAssistantDeleteButton(props: {
  session: CodingAssistantSessionInfo
  disabled?: boolean
  onDelete: (session: CodingAssistantSessionInfo) => void
}) {
  const confirmDelete = useArmedConfirm(CONFIRM_WINDOW_MS)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      tone="danger"
      disabled={props.disabled}
      data-chrome="icon-action"
      data-ui="coding-assistant-row-delete"
      data-confirm={confirmDelete.armed() ? "true" : undefined}
      title={t("coding_assistant.ledger.delete_title")}
      aria-label={t("coding_assistant.ledger.delete_title")}
      onClick={(event) => {
        event.stopPropagation()
        confirmDelete.confirm(() => props.onDelete(props.session))
      }}
      onBlur={confirmDelete.disarm}
    >
      <span class="coding-assistant-row-delete-icon" data-icon="delete" aria-hidden="true">
        <Icon name="close" size={11} />
      </span>
      <span class="coding-assistant-row-delete-icon" data-icon="confirm" aria-hidden="true">
        <Icon name="check" size={11} />
      </span>
    </Button>
  )
}

function CodingAssistantRenameButton(props: { disabled?: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      tone="neutral"
      disabled={props.disabled}
      data-chrome="icon-action"
      data-ui="coding-assistant-row-rename"
      title={t("coding_assistant.ledger.rename_title")}
      aria-label={t("coding_assistant.ledger.rename_title")}
      onClick={(event) => {
        event.stopPropagation()
        props.onClick()
      }}
    >
      <Icon name="edit" size={11} />
    </Button>
  )
}

function CodingAssistantSessionRow(props: {
  session: CodingAssistantSessionInfo
  selected: boolean
  busy: boolean
  onSelectSession: (session: CodingAssistantSessionInfo) => void
  onStopSession: (session: CodingAssistantSessionInfo) => void
  onDeleteSession: (session: CodingAssistantSessionInfo) => void
  onRenameSession: (session: CodingAssistantSessionInfo, title: string) => void | Promise<void>
}) {
  const [editing, setEditing] = createSignal(false)
  const [draftTitle, setDraftTitle] = createSignal("")
  let inputRef: HTMLInputElement | undefined
  const title = () => sessionTitle(props.session)
  const updated = () => sessionUpdated(props.session)

  function beginRename(): void {
    if (props.busy) return
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
    void props.onRenameSession(props.session, next)
  }

  return (
    <div
      role="button"
      tabindex={0}
      class="task-row-mini global-task-row coding-assistant-row"
      data-ui="coding-assistant-row"
      data-session-id={props.session.id}
      data-active={props.selected ? "true" : undefined}
      title={sessionRowTip(props.session)}
      onClick={() => {
        if (editing() || props.busy) return
        props.onSelectSession(props.session)
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        if (!editing() && !props.busy) props.onSelectSession(props.session)
      }}
      onDblClick={(event) => {
        event.stopPropagation()
        event.preventDefault()
        beginRename()
      }}
    >
      <span class="task-row-badge coding-assistant-row-kind-badge" aria-hidden="true">
        <Icon name="message" size={14} />
      </span>
      <div class="task-row-body">
        <Show
          when={!editing()}
          fallback={
            <div class="task-row-main task-row-main--editing" data-ui="coding-assistant-row-rename-editor">
              <div class="task-row-head">
                <input
                  ref={(el) => {
                    inputRef = el
                  }}
                  class="coding-assistant-row-rename-input"
                  data-ui="coding-assistant-row-rename-input"
                  type="text"
                  maxLength={200}
                  value={draftTitle()}
                  aria-label={t("coding_assistant.ledger.rename_placeholder")}
                  placeholder={t("coding_assistant.ledger.rename_placeholder")}
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
            class="task-row-main coding-assistant-row-main"
            title={sessionRowTip(props.session)}
            disabled={props.busy}
            aria-disabled={props.busy ? "true" : undefined}
            onClick={(event) => {
              event.stopPropagation()
              if (!props.busy) props.onSelectSession(props.session)
            }}
            onDblClick={(event) => {
              event.stopPropagation()
              event.preventDefault()
              beginRename()
            }}
          >
            <div class="task-row-head">
              <strong>{title()}</strong>
            </div>
          </button>
        </Show>
      </div>
      <div class="task-row-right">
        <small class="task-row-stamp coding-assistant-row-stamp" title={updated() ? detailStamp(updated()) : ""}>
          {updated() ? relativeTime(updated()) : t("coding_assistant.ledger.updated_unknown")}
        </small>
        <div class="task-row-actions coding-assistant-row-actions">
          <CodingAssistantStopButton session={props.session} disabled={props.busy} onStop={props.onStopSession} />
          <CodingAssistantRenameButton disabled={props.busy} onClick={beginRename} />
          <CodingAssistantDeleteButton session={props.session} disabled={props.busy} onDelete={props.onDeleteSession} />
        </div>
      </div>
    </div>
  )
}

export function CodingAssistantSessionList(props: CodingAssistantSessionListProps) {
  const [collapsedDirectories, setCollapsedDirectories] = createSignal<Record<string, boolean>>({})
  const groupedSessions = createMemo<CodingAssistantGroup[]>(() => {
    const groups = new Map<string, CodingAssistantGroup>()
    for (const session of props.sessions) {
      const directory = sessionProjectDirectory(session)
      let group = groups.get(directory)
      if (!group) {
        group = { directory, latest: 0, items: [] }
        groups.set(directory, group)
      }
      const updated = sessionUpdated(session)
      group.items.push(session)
      if (updated > group.latest) group.latest = updated
    }
    return [...groups.values()]
      .map((group) => ({
        ...group,
        items: [...group.items].sort((a, b) => sessionUpdated(b) - sessionUpdated(a)),
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
    <aside class="coding-assistant-ledger" data-ui="coding-assistant-ledger">
      <div class="coding-assistant-ledger-toolbar" role="toolbar" aria-label={t("coding_assistant.title")}>
        <div class="coding-assistant-ledger-search search-field">
          <Icon name="search" size={12} class="coding-assistant-ledger-search-icon search-field-icon" />
          <input
            type="search"
            class="coding-assistant-ledger-search-input search-field-input"
            placeholder={t("coding_assistant.ledger.search_placeholder")}
            value={props.searchQuery}
            onInput={(event) => props.onSearchChange(event.currentTarget.value)}
            aria-label={t("coding_assistant.ledger.search_placeholder")}
            data-ui="coding-assistant-search"
          />
          <Show when={props.searchQuery}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              tone="neutral"
              data-chrome="icon-action"
              data-ui="coding-assistant-search-clear"
              aria-label={t("coding_assistant.ledger.search_clear")}
              title={t("coding_assistant.ledger.search_clear")}
              onClick={() => props.onSearchChange("")}
            >
              <Icon name="close" />
            </Button>
          </Show>
        </div>
      </div>
      <div class="coding-assistant-ledger-list">
        <LedgerList
          items={groupedSessions()}
          loading={props.loading}
          error={props.error}
          emptyLabel={
            props.searchQuery ? t("coding_assistant.ledger.empty_filtered") : t("coding_assistant.ledger.empty")
          }
          retryLabel={t("coding_assistant.ledger.error_retry")}
          onRetry={props.onRetry}
        >
          {(group) => {
            const label = projectDirectoryLabel(group.directory, t("task.project.unknown"))
            const collapsed = () => isDirectoryCollapsed(group.directory)
            return (
              <section
                class="project-group coding-assistant-project-group"
                data-ui="coding-assistant-project-group"
                data-collapsed={collapsed() ? "true" : undefined}
              >
                <button
                  type="button"
                  class="project-group-heading"
                  title={sessionProjectTip(group.directory, group.items.length)}
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
                      {(session) => (
                        <CodingAssistantSessionRow
                          session={session}
                          selected={props.selectedSessionID === session.id}
                          busy={props.actionBusyID === session.id}
                          onSelectSession={props.onSelectSession}
                          onStopSession={props.onStopSession}
                          onDeleteSession={props.onDeleteSession}
                          onRenameSession={props.onRenameSession}
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
          <div class="project-group-show-more coding-assistant-ledger-load-more">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              tone="neutral"
              data-ui="coding-assistant-ledger-load-more"
              disabled={props.loadingMore}
              onClick={() => props.onLoadMore?.()}
            >
              {props.loadingMore ? t("common.loading") : t("acceptance.show_more")}
            </Button>
          </div>
        </Show>
      </div>
    </aside>
  )
}
