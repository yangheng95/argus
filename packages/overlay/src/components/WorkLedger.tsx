import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import { loadWorkLedger, type WorkLedgerChatRow, type WorkLedgerMissionRow, type WorkLedgerRow, type WorkLedgerTaskRow } from "../services/work-ledger"
import { detailStamp, relativeTime } from "../utils/time"
import { t } from "../utils/i18n"
import { taskLifecycleStatusLabel } from "../utils/status-labels"
import { Icon, type IconName } from "./Icon"
import { Button } from "./ui/Button"
import { ArmedConfirmButton } from "./ui/ArmedConfirmButton"
import { LedgerList } from "./LedgerList"
import { LedgerRowMainButton } from "./LedgerRowMainButton"
import { createProjectLedgerGroupCollapseState, ProjectLedgerGroup } from "./ProjectLedgerGroup"
import { useTaskRowActionsKeyboard } from "./useTaskRowActionsKeyboard"

const WORK_LEDGER_PAGE_SIZE = 80
const CONFIRM_WINDOW_SECONDS = 3
const CONFIRM_WINDOW_MS = CONFIRM_WINDOW_SECONDS * 1000

type WorkLedgerGroup = {
  directory: string
  latest: number
  items: WorkLedgerRow[]
}

export interface WorkLedgerProps {
  selectedTaskID?: string
  selectedSessionID?: string
  refreshToken?: number
  onSelectMission: (row: WorkLedgerMissionRow) => void | Promise<void>
  onSelectTask: (row: WorkLedgerTaskRow) => void | Promise<void>
  onSelectChat: (row: WorkLedgerChatRow) => void | Promise<void>
  onAbortMission: (row: WorkLedgerMissionRow) => void | Promise<void>
  onDeleteMission: (row: WorkLedgerMissionRow) => void | Promise<void>
  onCancelTask: (row: WorkLedgerTaskRow) => void | Promise<void>
  onDeleteTask: (row: WorkLedgerTaskRow) => void | Promise<void>
  onCreateChat: (directory: string) => void | Promise<void>
  onStopChat: (row: WorkLedgerChatRow) => void | Promise<void>
  onDeleteChat: (row: WorkLedgerChatRow) => void | Promise<void>
}

function rowKey(row: Pick<WorkLedgerRow, "kind" | "id">): string {
  return `${row.kind}:${row.id}`
}

function rowTitle(row: WorkLedgerRow): string {
  return row.title || row.id
}

function rowDirectory(row: WorkLedgerRow): string {
  return row.directory || ""
}

function rowTip(row: WorkLedgerRow): string {
  return [rowTitle(row), `ID: ${row.id}`, rowDirectory(row)].filter(Boolean).join(" / ")
}

function kindIcon(kind: WorkLedgerRow["kind"]): IconName {
  if (kind === "mission") return "mission"
  if (kind === "chat") return "message"
  return "tasks"
}

function kindLabel(kind: WorkLedgerRow["kind"]): string {
  if (kind === "mission") return t("work_ledger.kind.mission")
  if (kind === "chat") return t("work_ledger.kind.chat")
  return t("work_ledger.kind.task")
}

function statusLabel(row: WorkLedgerRow): string {
  if (row.kind === "mission") {
    const stats = row.taskStats
    if (stats.total > 0) return `${stats.completed + stats.failed + stats.cancelled}/${stats.total}`
    return row.interruptible ? t("task.status.running") : t("task.status.idle")
  }
  if (row.kind === "task") return taskLifecycleStatusLabel(row.lifecycleStatus)
  if (row.status === "active") return t("task.status.running")
  if (row.status === "idle") return t("task.status.idle")
  return row.status
}

function statusTone(row: WorkLedgerRow): string {
  if (row.kind === "mission") {
    if (row.taskStats.failed > 0) return "failed"
    if (row.interruptible || row.taskStats.active > 0 || row.taskStats.queued > 0) return "active"
    return "completed"
  }
  if (row.kind === "task") return row.lifecycleStatus
  return row.status
}

function inlineMeta(row: WorkLedgerRow): string {
  if (row.kind === "mission") {
    return t("work_ledger.mission_task_count", { count: String(row.taskStats.total) })
  }
  if (row.kind === "task" && row.missionID) return t("work_ledger.task_owned_by_mission")
  return ""
}

function WorkLedgerKindMark(props: { kind: WorkLedgerRow["kind"] }) {
  return (
    <span
      class="work-row-kind-mark"
      data-kind={props.kind}
      title={kindLabel(props.kind)}
      aria-label={kindLabel(props.kind)}
    >
      <Icon name={kindIcon(props.kind)} size={13} />
    </span>
  )
}

function RowDeleteAction(props: {
  label: string
  description: string
  onConfirm: () => void
  tabIndex?: number
  children?: JSX.Element
}) {
  return (
    <ArmedConfirmButton
      type="button"
      variant="ghost"
      size="icon"
      tone="danger"
      data-chrome="icon-action"
      data-ui="work-row-delete"
      label={props.label}
      armedDescription={props.description}
      confirmWindowMs={CONFIRM_WINDOW_MS}
      onConfirm={props.onConfirm}
      tabIndex={props.tabIndex}
      confirmChildren={<Icon name="check" size={10} />}
    >
      {props.children ?? <Icon name="close" size={11} />}
    </ArmedConfirmButton>
  )
}

function WorkLedgerTaskChildRow(props: { task: WorkLedgerTaskRow; onSelect: (row: WorkLedgerTaskRow) => void }) {
  return (
    <li
      class="work-row-child"
      data-ui="work-ledger-child-task"
      data-kind="task"
      data-task-id={props.task.id}
      data-status={props.task.lifecycleStatus}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        tone="neutral"
        class="work-row-child-main"
        title={rowTip(props.task)}
        onClick={() => props.onSelect(props.task)}
      >
        <WorkLedgerKindMark kind="task" />
        <span class="work-row-child-title">{props.task.title || props.task.id}</span>
        <span class="work-row-status-mark" data-status={props.task.lifecycleStatus}>
          {taskLifecycleStatusLabel(props.task.lifecycleStatus)}
        </span>
      </Button>
    </li>
  )
}

function WorkLedgerRowView(props: {
  row: WorkLedgerRow
  selected: boolean
  onSelect: (row: WorkLedgerRow) => void
  onAfterAction: () => void
  onAbortMission: (row: WorkLedgerMissionRow) => void | Promise<void>
  onDeleteMission: (row: WorkLedgerMissionRow) => void | Promise<void>
  onCancelTask: (row: WorkLedgerTaskRow) => void | Promise<void>
  onDeleteTask: (row: WorkLedgerTaskRow) => void | Promise<void>
  onStopChat: (row: WorkLedgerChatRow) => void | Promise<void>
  onDeleteChat: (row: WorkLedgerChatRow) => void | Promise<void>
}) {
  const [busy, setBusy] = createSignal(false)
  const row = () => props.row
  const canStop = () => {
    const current = row()
    if (current.kind === "mission") return current.interruptible
    if (current.kind === "task") return current.lifecycleStatus === "queued" || current.lifecycleStatus === "active"
    return current.status === "active"
  }
  const hasActions = () => true
  const rowActions = useTaskRowActionsKeyboard(hasActions)

  async function runAction(action: () => void | Promise<void>) {
    if (busy()) return
    setBusy(true)
    try {
      await action()
      props.onAfterAction()
    } finally {
      setBusy(false)
    }
  }

  function stopLabel() {
    if (row().kind === "mission") return t("mission.ledger.abort_title")
    if (row().kind === "chat") return t("coding_assistant.ledger.stop_title")
    return t("task.cancel_button_title")
  }

  return (
    <div class="work-row-shell" data-ui="work-ledger-row-shell" data-kind={row().kind}>
      <div
        class="task-row-mini global-task-row work-row"
        data-ui="work-ledger-row"
        data-kind={row().kind}
        data-row-key={rowKey(row())}
        data-active={props.selected ? "true" : undefined}
        data-status={statusTone(row())}
        data-actions-keyboard-open={rowActions.actionsKeyboardOpenData()}
        title={rowTip(row())}
        ref={(el) => rowActions.setRowRef(el)}
        onFocusOut={(event) => rowActions.closeActionsOnFocusOut(event)}
      >
        <WorkLedgerKindMark kind={row().kind} />
        <div class="task-row-body work-row-body">
          <LedgerRowMainButton
            class="work-row-main"
            ref={(el) => rowActions.setMainButtonRef(el)}
            aria-current={props.selected ? "page" : undefined}
            aria-keyshortcuts={hasActions() ? "ArrowRight" : undefined}
            title={rowTip(row())}
            onKeyDown={rowActions.openActionsFromKeyboard}
            onClick={() => props.onSelect(row())}
          >
            <div class="task-row-head work-row-head">
              <strong>{rowTitle(row())}</strong>
              <Show when={inlineMeta(row())}>
                <span class="work-row-inline-meta">{inlineMeta(row())}</span>
              </Show>
            </div>
          </LedgerRowMainButton>
        </div>
        <div class="task-row-right work-row-right">
          <span class="work-row-status-mark" data-status={statusTone(row())}>
            {statusLabel(row())}
          </span>
          <small class="task-row-stamp work-row-stamp" title={detailStamp(row().updated)}>
            {relativeTime(row().updated) || t("work_ledger.updated_unknown")}
          </small>
          <div class="task-row-actions work-row-actions" onKeyDown={rowActions.closeActionsFromKeyboardEvent}>
            <Show when={canStop()}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                tone="neutral"
                data-chrome="icon-action"
                data-ui="work-row-stop"
                disabled={busy()}
                tabIndex={rowActions.actionButtonTabIndex()}
                title={stopLabel()}
                aria-label={stopLabel()}
                onClick={(event) => {
                  event.stopPropagation()
                  void runAction(() => {
                    const current = row()
                    if (current.kind === "mission") return props.onAbortMission(current)
                    if (current.kind === "chat") return props.onStopChat(current)
                    return props.onCancelTask(current)
                  })
                }}
              >
                <Icon name="stop" size={11} />
              </Button>
            </Show>
            <RowDeleteAction
              label={
                row().kind === "mission"
                  ? t("mission.ledger.delete_title")
                  : row().kind === "chat"
                    ? t("coding_assistant.ledger.delete_title")
                    : t("task.delete_button_title")
              }
              description={
                row().kind === "mission"
                  ? t("armed_confirm.mission.delete", { seconds: CONFIRM_WINDOW_SECONDS })
                  : row().kind === "chat"
                    ? t("armed_confirm.coding_assistant.delete", { seconds: CONFIRM_WINDOW_SECONDS })
                    : t("armed_confirm.task.delete", { seconds: CONFIRM_WINDOW_SECONDS })
              }
              onConfirm={() =>
                void runAction(() => {
                  const current = row()
                  if (current.kind === "mission") return props.onDeleteMission(current)
                  if (current.kind === "chat") return props.onDeleteChat(current)
                  return props.onDeleteTask(current)
                })
              }
              tabIndex={rowActions.actionButtonTabIndex()}
            />
          </div>
        </div>
      </div>
      <Show when={row().kind === "mission" && (row() as WorkLedgerMissionRow).tasks.length > 0}>
        <ul class="work-row-child-list" aria-label={t("mission.ledger.tasks_label")}>
          <For each={(row() as WorkLedgerMissionRow).tasks}>
            {(task) => <WorkLedgerTaskChildRow task={task} onSelect={(next) => props.onSelect(next)} />}
          </For>
        </ul>
      </Show>
    </div>
  )
}

export function WorkLedger(props: WorkLedgerProps) {
  const [rows, setRows] = createSignal<WorkLedgerRow[]>([])
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal("")
  const [search, setSearch] = createSignal("")
  const directoryCollapse = createProjectLedgerGroupCollapseState()
  let controller: AbortController | null = null
  let loadSequence = 0

  async function reload(): Promise<void> {
    controller?.abort()
    const nextController = new AbortController()
    controller = nextController
    const sequence = ++loadSequence
    setLoading(true)
    setError("")
    try {
      const result = await loadWorkLedger({
        search: search(),
        limit: WORK_LEDGER_PAGE_SIZE,
        signal: nextController.signal,
      })
      if (sequence !== loadSequence) return
      setRows(result.rows)
    } catch (nextError) {
      if (nextError instanceof DOMException && nextError.name === "AbortError") return
      if (sequence !== loadSequence) return
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      if (sequence === loadSequence) setLoading(false)
    }
  }

  createEffect((previousKey: string | undefined) => {
    const key = `${props.refreshToken ?? 0}:${search()}`
    if (key === previousKey) return key
    const timer = setTimeout(() => void reload(), 120)
    onCleanup(() => clearTimeout(timer))
    return key
  })

  onCleanup(() => controller?.abort())

  const groups = createMemo<WorkLedgerGroup[]>(() => {
    const grouped = new Map<string, WorkLedgerGroup>()
    for (const row of rows()) {
      const directory = rowDirectory(row)
      const group = grouped.get(directory) ?? { directory, latest: 0, items: [] }
      group.items.push(row)
      if (row.updated > group.latest) group.latest = row.updated
      grouped.set(directory, group)
    }
    return [...grouped.values()]
      .map((group) => ({
        ...group,
        items: [...group.items].sort((a, b) => b.updated - a.updated || rowKey(b).localeCompare(rowKey(a))),
      }))
      .sort((a, b) => b.latest - a.latest)
  })

  function selected(row: WorkLedgerRow): boolean {
    if (row.kind === "task") return props.selectedTaskID === row.id
    return props.selectedSessionID === row.id || ("sessionID" in row && props.selectedSessionID === row.sessionID)
  }

  function selectRow(row: WorkLedgerRow): void {
    if (row.kind === "mission") void props.onSelectMission(row)
    else if (row.kind === "chat") void props.onSelectChat(row)
    else void props.onSelectTask(row)
  }

  return (
    <div class="work-ledger" data-ui="work-ledger">
      <div class="work-ledger-controls">
        <div class="work-ledger-search search-field">
          <Icon name="search" size={12} class="work-ledger-search-icon search-field-icon" />
          <input
            type="search"
            class="work-ledger-search-input search-field-input"
            placeholder={t("work_ledger.search_placeholder")}
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
            aria-label={t("work_ledger.search_placeholder")}
            data-ui="work-ledger-search"
          />
          <Show when={search()}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              tone="neutral"
              data-chrome="icon-action"
              data-ui="work-ledger-search-clear"
              aria-label={t("work_ledger.search_clear")}
              onClick={() => setSearch("")}
            >
              <Icon name="close" size={11} />
            </Button>
          </Show>
        </div>
      </div>
      <LedgerList
        items={groups()}
        loading={loading()}
        loadingLabel={t("work_ledger.loading")}
        error={error()}
        emptyLabel={t("work_ledger.empty")}
        retryLabel={t("common.retry")}
        onRetry={() => void reload()}
      >
        {(group) => {
          const collapsed = directoryCollapse.isCollapsed(group.directory)
          return (
            <ProjectLedgerGroup
              directory={group.directory}
              count={group.items.length}
              collapsed={collapsed}
              onToggle={() => directoryCollapse.toggle(group.directory)}
              onCreateChat={props.onCreateChat}
              dataUi="work-ledger-project-group"
            >
              <For each={group.items}>
                {(row) => (
                  <WorkLedgerRowView
                    row={row}
                    selected={selected(row)}
                    onSelect={selectRow}
                    onAfterAction={() => void reload()}
                    onAbortMission={props.onAbortMission}
                    onDeleteMission={props.onDeleteMission}
                    onCancelTask={props.onCancelTask}
                    onDeleteTask={props.onDeleteTask}
                    onStopChat={props.onStopChat}
                    onDeleteChat={props.onDeleteChat}
                  />
                )}
              </For>
            </ProjectLedgerGroup>
          )
        }}
      </LedgerList>
    </div>
  )
}
