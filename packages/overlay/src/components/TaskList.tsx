// ── TaskList Component ──
// Solid.js port of renderTaskList / taskSection / taskRow / visibleTasks
// Displays tasks from boardStore in stable creation-time order.

import { createMemo, createSelector, createSignal, For, Show } from "solid-js"
import { boardStore, visibleTasks, loadTasks, loadMoreTasks, taskCreatedAt, activeTaskID } from "../store/board"
import { buildTaskTree, flattenGroup as flattenGroupPure, type TaskTreeEntry, type TaskTreeShape } from "./taskTree"
import { settingsStore } from "../store/settings"
import { reorderTaskQueue, startQueuedTaskNow } from "../services/task-queue"
import { downloadTaskProjectArchive } from "../services/task"
import { deleteProject, renameProject } from "../services/workspace"
import { showAppDialog } from "../services/app-dialog"
import {
  notifyError,
  notifySuccess,
  notifyWarning,
  taskHasUnreadNotification,
  formatErrorDetails,
} from "../services/notify"
import { t } from "../utils/i18n"
import { taskLifecycleStatusLabel, taskLifecycleStatusLabelFromString } from "../utils/status-labels"
import { stamp, fullStampWithRelative } from "../utils/time"
import { projectDirectoryKey } from "../utils/project-directory"
import { Icon } from "./Icon"
import { LedgerLoadingStatus } from "./LedgerList"
import { LedgerRowMainButton } from "./LedgerRowMainButton"
import { createProjectLedgerGroupCollapseState, ProjectLedgerGroup } from "./ProjectLedgerGroup"
import { Button } from "./ui/Button"
import { ArmedConfirmButton } from "./ui/ArmedConfirmButton"
import { useTaskRowActionsKeyboard } from "./useTaskRowActionsKeyboard"

const COMPACT_GROUP_VISIBLE_LIMIT = 5

// ── Inline helpers (ports of functions) ──

function clipText(value: string, limit = 80): string {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
  if (!text) return ""
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function reloadFailureDetails(primary: unknown, reloadError?: unknown): string {
  return [formatErrorDetails(primary), reloadError ? formatErrorDetails(reloadError) : ""]
    .filter(Boolean)
    .join("\n\npost-action reload error:\n")
}

function joinBullet(values: (string | undefined | null | false)[]): string {
  return values.filter(Boolean).join(" / ")
}

function taskListTitle(item: any): string {
  return clipText(item?.task?.title || item?.overview?.headline || item?.task?.id || "", 72)
}

function taskListBadge(item: any, queuePos?: number): string {
  if (item?._pending) return taskLifecycleStatusLabel("active")
  const pending = Number(item?.pending_interactions || 0) > 0
  if (pending) return t("detail.pending_interactions")
  const status = String(item?.task?.status || "")
  if (status === "queued" && queuePos !== undefined && queuePos > 0) {
    return `${taskLifecycleStatusLabel("queued")} #${queuePos}`
  }
  return taskLifecycleStatusLabelFromString(status)
}

function taskListMeta(item: any): string {
  return joinBullet([stamp(taskCreatedAt(item))])
}

function taskListFullTip(item: any, queuePos?: number): string {
  return joinBullet([
    item?.task?.title || item?.overview?.headline || item?.task?.id || "",
    taskListBadge(item, queuePos),
    fullStampWithRelative(taskCreatedAt(item)),
    item?.task?.id ? `ID: ${item.task.id}` : "",
    item?.task?.directory || "",
  ])
}

function queueRevision(items: any[]): string | undefined {
  for (const item of items) {
    const revision = item?.task?.queue?.revision
    if (typeof revision === "string") return revision
  }
  return undefined
}

function sortTaskItemsByCreated(items: any[]): any[] {
  return [...items].sort((a, b) => taskCreatedAt(b) - taskCreatedAt(a))
}

function taskIDOf(item: any): string {
  const id = String(item?.task?.id || "").trim()
  if (!id) throw new Error("queued task is missing id")
  return id
}

function taskPriorityRank(item: any): number {
  const priority = String(item?.task?.priority || "").trim()
  if (priority === "critical") return 0
  if (priority === "high" || priority === "normal" || priority === "low") return 1
  throw new Error(`queued task ${taskIDOf(item)} has unsupported priority: ${priority}`)
}

function taskQueueOrder(item: any): number {
  const order = Number(item?.task?.queue?.order)
  if (!Number.isInteger(order) || order < 0) {
    throw new Error(`queued task ${taskIDOf(item)} is missing backend queue.order`)
  }
  return order
}

function compareQueuedTaskItems(a: any, b: any): number {
  return (
    taskPriorityRank(a) - taskPriorityRank(b) ||
    taskQueueOrder(a) - taskQueueOrder(b) ||
    taskCreatedAt(a) - taskCreatedAt(b) ||
    taskIDOf(a).localeCompare(taskIDOf(b))
  )
}

function sortQueuedTaskItems(items: any[]): any[] {
  return [...items].sort(compareQueuedTaskItems)
}

function moveBefore(ids: string[], sourceID: string, targetID: string): string[] {
  if (sourceID === targetID) return ids
  const next = ids.filter((id) => id !== sourceID)
  const targetIndex = next.indexOf(targetID)
  if (targetIndex < 0) return ids
  next.splice(targetIndex, 0, sourceID)
  return next
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

function projectDirectoryOf(item: any): string {
  const dir = item?.task?.directory
  if (typeof dir === "string" && dir.trim()) return dir
  // Pending tasks have no server-assigned directory yet; attribute them to the
  // currently active project so the user sees them grouped correctly.
  return settingsStore.directory || ""
}

function projectNameOf(item: any): string {
  const name = item?.project?.name
  return typeof name === "string" ? name.trim() : ""
}

// ── DeleteButton (two-step inline confirm) ──
// First click arms the button (data-confirm="true") and shows the confirm
// icon; a second click within the confirm window fires the delete. The state
// auto-resets after the window or when the user clicks elsewhere, so there's
// no modal round-trip.

const CONFIRM_WINDOW_SECONDS = 3
const CONFIRM_WINDOW_MS = CONFIRM_WINDOW_SECONDS * 1000 // confirm window length in milliseconds.

function DeleteButton(props: { id: string; onDelete: (id: string) => void; tabIndex?: number }) {
  return (
    <ArmedConfirmButton
      type="button"
      variant="ghost"
      size="icon"
      tone="danger"
      data-chrome="icon-action"
      data-ui="task-row-delete"
      data-task-delete={props.id}
      label={t("task.delete_button_title")}
      armedDescription={t("armed_confirm.task.delete", { seconds: CONFIRM_WINDOW_SECONDS })}
      tabIndex={props.tabIndex}
      confirmWindowMs={CONFIRM_WINDOW_MS}
      onConfirm={() => props.onDelete(props.id)}
      confirmChildren={
        <span class="task-row-delete-icon" data-icon="confirm" aria-hidden="true">
          <Icon name="check" size={11} />
        </span>
      }
    >
      <span class="task-row-delete-icon" data-icon="delete" aria-hidden="true">
        <Icon name="close" size={11} />
      </span>
    </ArmedConfirmButton>
  )
}

// ── CancelButton (two-step inline confirm) ──
// Mirrors DeleteButton shape/behavior so the row's two actions read as a
// coherent pair. Shown only for interruptable tasks (queued / active).

function CancelButton(props: { id: string; onCancel: (id: string) => void; tabIndex?: number }) {
  return (
    <ArmedConfirmButton
      type="button"
      variant="ghost"
      size="icon"
      tone="neutral"
      data-chrome="icon-action"
      data-ui="task-row-cancel"
      data-task-cancel={props.id}
      label={t("task.cancel_button_title")}
      armedDescription={t("armed_confirm.task.cancel", { seconds: CONFIRM_WINDOW_SECONDS })}
      tabIndex={props.tabIndex}
      confirmWindowMs={CONFIRM_WINDOW_MS}
      onConfirm={() => props.onCancel(props.id)}
      confirmChildren={
        <span class="task-row-cancel-icon" data-icon="confirm" aria-hidden="true">
          <Icon name="check" size={11} />
        </span>
      }
    >
      <span class="task-row-cancel-icon" data-icon="cancel" aria-hidden="true">
        <Icon name="stop" size={11} />
      </span>
    </ArmedConfirmButton>
  )
}

function RenameButton(props: { id: string; onClick: () => void; tabIndex?: number }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      tone="neutral"
      data-chrome="icon-action"
      data-ui="task-row-rename"
      data-task-rename={props.id}
      title={t("task.rename_button_title")}
      aria-label={t("task.rename_button_title")}
      tabIndex={props.tabIndex}
      onClick={(e) => {
        e.stopPropagation()
        props.onClick()
      }}
    >
      <Icon name="edit" size={11} />
    </Button>
  )
}

function StartNowButton(props: { id: string; busy?: boolean; onStartNow: (id: string) => void; tabIndex?: number }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      tone="accent"
      data-chrome="icon-action"
      data-ui="task-row-start-now"
      data-task-start-now={props.id}
      data-busy={props.busy ? "true" : undefined}
      disabled={props.busy}
      title={t("task.start_now_button_title")}
      aria-label={t("task.start_now_button_title")}
      tabIndex={props.tabIndex}
      onClick={(e) => {
        e.stopPropagation()
        props.onStartNow(props.id)
      }}
    >
      <Icon name="send" size={11} />
    </Button>
  )
}

function DownloadProjectButton(props: {
  id: string
  directory: string
  busy?: boolean
  onDownload: (id: string, directory: string) => void
  tabIndex?: number
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      tone="neutral"
      data-chrome="icon-action"
      data-ui="task-row-download"
      data-task-download={props.id}
      data-busy={props.busy ? "true" : undefined}
      disabled={props.busy}
      title={t("task.download_project_button_title")}
      aria-label={t("task.download_project_button_title")}
      tabIndex={props.tabIndex}
      onClick={(e) => {
        e.stopPropagation()
        props.onDownload(props.id, props.directory)
      }}
    >
      <Icon name="download" size={11} />
    </Button>
  )
}

// ── TaskRow ──

const INTERRUPTABLE_TASK_STATUSES = new Set(["queued", "active"])

function taskTreeEntryKey(entry: TaskTreeEntry, index: number): string {
  const id = entry.item?.task?.id
  if (typeof id === "string" && id) return `task:${id}`
  return `entry:${index}`
}

function TaskRow(props: {
  item: any
  /** Solid createSelector function — returns true only for the currently
   *  selected task id. Lets only the previously-selected and newly-selected
   *  rows reconcile when activeTaskID() changes, instead of
   *  re-running every row's `isActive` memo. */
  isSelected: (id: string) => boolean
  queuePos?: number
  onSelectTask: (id: string, directory: string) => void
  onDeleteTask?: (id: string) => void
  onCancelTask?: (id: string) => void
  onStartNow?: (id: string, directory: string) => void
  onDownloadProject?: (id: string, directory: string) => void
  onRenameTask?: (id: string, title: string) => void | Promise<void>
  startNowBusyID?: string
  downloadBusyID?: string
  canDrag?: boolean
  dragging?: boolean
  dragOver?: boolean
  onDragStart?: (id: string) => void
  onDragOver?: (id: string, event: DragEvent) => void
  onDrop?: (id: string, event: DragEvent) => void
  onDragEnd?: () => void
  /** Tree nesting depth (0 = top-level). Applies left padding so the row
   *  visually indents under its parent. */
  depth?: number
  /** Direct child tasks visible in the current filtered set. Drives the
   *  chevron toggle and badge count + active/failed accents. */
  directChildren?: any[]
  /** Whether the chevron is in the expanded state (children rendered). */
  expanded?: boolean
  onToggleExpand?: () => void
  /** True when this row is a cross-directory nested child — its own
   *  `task.directory` differs from the directory of the group it renders
   *  inside. Drag is force-disabled in that case because `handleDrop`
   *  closes over the group's directory, which would mis-route the reorder. */
  crossDirectory?: boolean
}) {
  const id = () => props.item?.task?.id || ""
  const pending = () => props.item?._pending === true
  const directory = () => String(props.item?.task?.directory || "").trim()
  const status = () => (pending() ? "active" : props.item?.task?.status || "idle")
  const rawTitle = () => props.item?.task?.title || props.item?.overview?.headline || id()
  const title = () => taskListTitle(props.item) || id()
  const isActive = () => !pending() && props.isSelected(id())
  const hasUnreadNotification = () => !pending() && taskHasUnreadNotification(props.item)
  const badgeLabel = () => taskListBadge(props.item, props.queuePos)
  const rowTip = () => taskListFullTip(props.item, props.queuePos)
  const canCancel = () => !pending() && !!id() && !!props.onCancelTask && INTERRUPTABLE_TASK_STATUSES.has(status())
  const canStartNow = () => !pending() && !!id() && !!props.onStartNow && status() === "queued"
  const canDownload = () => !pending() && !!id() && !!directory() && !!props.onDownloadProject
  const canDelete = () => !pending() && !!id() && !!props.onDeleteTask
  const canRename = () => !pending() && !!id() && !!props.onRenameTask
  const hasActions = () => canStartNow() || canDownload() || canCancel() || canDelete() || canRename()
  // Drag is disabled on any nested row (depth > 0). The drop handler at
  // handleDrop() reorders within a single directory's queue, computed from
  // the directory group's top-level items; nested children — whether
  // cross-directory or same-directory — are not in that queue, so dragging
  // would either be a silent no-op (same-directory nested) or mis-route
  // the reorder to the wrong directory (cross-directory nested). Reordering
  // a child also contradicts the lineage model: a child task follows its
  // parent, not a sibling-queue position. (codex review 2026-05-27.)
  const canDrag = () => props.canDrag === true && status() === "queued" && !pending() && (props.depth ?? 0) === 0
  const directChildCount = () => props.directChildren?.length ?? 0
  const hasActiveChild = () =>
    !!props.directChildren?.some((child) => child?.task?.status === "active" || child?._pending)
  const hasFailedChild = () => !!props.directChildren?.some((child) => child?.task?.status === "failed")
  const [editing, setEditing] = createSignal(false)
  const [draftTitle, setDraftTitle] = createSignal("")
  let inputRef: HTMLInputElement | undefined
  const rowActions = useTaskRowActionsKeyboard(hasActions)

  function beginRename(): void {
    if (!canRename()) return
    setDraftTitle(rawTitle())
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
    if (!next || next === rawTitle().trim()) return
    void Promise.resolve(props.onRenameTask?.(id(), next)).catch((error) => {
      notifyError({
        id: `task:rename:${id()}`,
        title: t("common.error"),
        message: error instanceof Error ? error.message : String(error),
        details: formatErrorDetails(error),
      })
    })
  }

  return (
    <div
      ref={(el) => rowActions.setRowRef(el)}
      class="task-row-mini global-task-row"
      data-task-row-id={pending() ? undefined : id()}
      data-actions-keyboard-open={rowActions.actionsKeyboardOpenData()}
      data-active={isActive() ? "true" : undefined}
      data-status={status()}
      data-notification-unread={hasUnreadNotification() ? "true" : undefined}
      data-draggable={canDrag() ? "true" : undefined}
      data-dragging={props.dragging ? "true" : undefined}
      data-drag-over={props.dragOver ? "true" : undefined}
      data-depth={(props.depth ?? 0) > 0 ? String(props.depth) : undefined}
      data-cross-directory={props.crossDirectory ? "true" : undefined}
      style={
        (props.depth ?? 0) > 0
          ? `padding-inline-start: calc(${(props.depth ?? 0) * 16}px * var(--ui-scale))`
          : undefined
      }
      draggable={canDrag()}
      title={rowTip()}
      onClick={(event) => {
        if (event.defaultPrevented || editing()) return
        if (!pending() && id()) props.onSelectTask(id(), directory())
      }}
      onDragStart={(event) => {
        if (!canDrag()) return
        event.dataTransfer?.setData("text/plain", id())
        event.dataTransfer?.setDragImage(event.currentTarget, 10, 10)
        props.onDragStart?.(id())
      }}
      onDragOver={(event) => {
        if (!canDrag()) return
        props.onDragOver?.(id(), event)
      }}
      onDrop={(event) => {
        if (!canDrag()) return
        props.onDrop?.(id(), event)
      }}
      onDragEnd={() => props.onDragEnd?.()}
      onFocusOut={(event) => {
        rowActions.closeActionsOnFocusOut(event)
      }}
    >
      <span
        class="task-row-badge"
        data-status={status()}
        aria-live="polite"
        aria-atomic="true"
        aria-label={badgeLabel()}
        title={badgeLabel()}
      >
        <span class="task-row-badge-text">{badgeLabel()}</span>
      </span>
      <Show when={canDrag()}>
        <span class="task-row-drag-handle" title={t("task.reorder_button_title")} aria-hidden="true">
          <Icon name="drag-handle" size={12} />
        </span>
      </Show>
      <div class="task-row-body">
        <Show when={directChildCount() > 0}>
          {/* Chevron lives in .task-row-body (row-head, after the badge
              / drag handle, before .task-row-main) instead of inside
              .task-row-right. .task-row-actions is position:absolute;
              right:0; width:var(--task-row-actions-width); z-index:2 — on row hover its buttons
              gain pointer-events:auto and overlay the right column,
              including any chevron rendered there. User reported "点不了"
              because cancel/rename were sitting on top of the chevron
              and intercepting clicks. Row-head placement removes the
              chevron from the action panel's coverage area entirely
              (sibling layout puts it on the OPPOSITE side of the row).

              Three guards still needed because .task-row-mini is itself
              draggable for queue reorder, and a button inside a
              draggable parent has the browser treat mousedown as a
              drag-start — the click event gets swallowed and dragStart
              fires on the outer div. draggable={false} opts the button
              out, onMouseDown stopPropagation keeps the outer div from
              seeing the press, onDragStart preventDefault is belt-and-
              suspenders for browsers that still try to initiate. */}
          <Button
            type="button"
            variant="ghost"
            size="mini"
            tone="neutral"
            data-ui="task-row-children-toggle"
            draggable={false}
            data-expanded={props.expanded ? "true" : undefined}
            data-has-active={hasActiveChild() ? "true" : undefined}
            data-has-failed={hasFailedChild() ? "true" : undefined}
            aria-expanded={props.expanded ? "true" : "false"}
            aria-label={
              props.expanded
                ? t("task.tree.collapse_children", { count: String(directChildCount()) })
                : t("task.tree.expand_children", { count: String(directChildCount()) })
            }
            title={t("task.tree.children_count", { count: String(directChildCount()) })}
            onMouseDown={(event) => {
              event.stopPropagation()
            }}
            onDragStart={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              props.onToggleExpand?.()
            }}
          >
            <Icon name={props.expanded ? "chevron-down" : "chevron"} size={11} />
            <span class="task-row-children-count">{directChildCount()}</span>
          </Button>
        </Show>
        <Show
          when={!editing()}
          fallback={
            <div class="task-row-main task-row-main--editing" data-ui="task-row-rename-editor">
              <div class="task-row-head">
                <input
                  ref={(el) => (inputRef = el)}
                  class="task-row-rename-input"
                  data-ui="task-row-rename-input"
                  type="text"
                  maxLength={200}
                  value={draftTitle()}
                  aria-label={t("task.rename_placeholder")}
                  placeholder={t("task.rename_placeholder")}
                  onInput={(e) => setDraftTitle(e.currentTarget.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      commitRename()
                    } else if (e.key === "Escape") {
                      e.preventDefault()
                      cancelRename()
                    }
                  }}
                  onBlur={() => {
                    // Microtask: if the blur was caused by clicking the
                    // confirm button, that click handler runs immediately
                    // after blur — committing here would race. Defer one
                    // tick and re-check whether the editor is still open.
                    queueMicrotask(() => {
                      if (editing()) commitRename()
                    })
                  }}
                />
              </div>
            </div>
          }
        >
          <LedgerRowMainButton
            ref={(el) => rowActions.setMainButtonRef(el)}
            data-task-id={pending() ? undefined : id()}
            disabled={pending()}
            aria-disabled={pending() ? "true" : undefined}
            aria-current={isActive() ? "page" : undefined}
            aria-keyshortcuts={hasActions() ? "ArrowRight" : undefined}
            title={rowTip()}
            onKeyDown={rowActions.openActionsFromKeyboard}
            onClick={(event) => {
              event.stopPropagation()
              if (!pending() && id()) props.onSelectTask(id(), directory())
            }}
            onDblClick={(e) => {
              if (!canRename()) return
              e.stopPropagation()
              e.preventDefault()
              beginRename()
            }}
          >
            <div class="task-row-head">
              <strong>{title()}</strong>
            </div>
          </LedgerRowMainButton>
        </Show>
      </div>
      <div class="task-row-right">
        <small class="task-row-stamp" title={fullStampWithRelative(taskCreatedAt(props.item))}>
          {taskListMeta(props.item)}
        </small>
        <Show when={hasActions()}>
          <div class="task-row-actions" onKeyDown={rowActions.closeActionsFromKeyboardEvent}>
            <Show when={canStartNow()}>
              <StartNowButton
                id={id()}
                busy={props.startNowBusyID === id()}
                onStartNow={(taskID) => props.onStartNow!(taskID, projectDirectoryOf(props.item))}
                tabIndex={rowActions.actionButtonTabIndex()}
              />
            </Show>
            <Show when={canCancel()}>
              <CancelButton id={id()} onCancel={props.onCancelTask!} tabIndex={rowActions.actionButtonTabIndex()} />
            </Show>
            <Show when={canDownload()}>
              <DownloadProjectButton
                id={id()}
                directory={directory()}
                busy={props.downloadBusyID === id()}
                onDownload={props.onDownloadProject!}
                tabIndex={rowActions.actionButtonTabIndex()}
              />
            </Show>
            <Show when={canRename() && !editing()}>
              <RenameButton id={id()} onClick={beginRename} tabIndex={rowActions.actionButtonTabIndex()} />
            </Show>
            <Show when={canDelete()}>
              <DeleteButton id={id()} onDelete={props.onDeleteTask!} tabIndex={rowActions.actionButtonTabIndex()} />
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}

// ── TaskSection ──

function TaskSection(props: {
  entries: TaskTreeEntry[]
  isSelected: (id: string) => boolean
  queuePositions?: Map<string, number>
  onSelectTask: (id: string, directory: string) => void
  onDeleteTask?: (id: string) => void
  onCancelTask?: (id: string) => void
  onStartNow?: (id: string, directory: string) => void
  onDownloadProject?: (id: string, directory: string) => void
  onRenameTask?: (id: string, title: string) => void | Promise<void>
  startNowBusyID?: string
  downloadBusyID?: string
  draggingID?: string
  dragOverID?: string
  canReorder?: boolean
  onDragStart?: (id: string) => void
  onDragOver?: (id: string, event: DragEvent) => void
  onDrop?: (id: string, event: DragEvent) => void
  onDragEnd?: () => void
  onToggleExpand?: (id: string) => void
}) {
  const entryKeys = createMemo(() => props.entries.map(taskTreeEntryKey))
  const entriesByKey = createMemo(() => {
    const byKey = new Map<string, TaskTreeEntry>()
    props.entries.forEach((entry, index) => byKey.set(taskTreeEntryKey(entry, index), entry))
    return byKey
  })

  return (
    <Show when={props.entries.length > 0}>
      <section class="sidebar-list-group">
        <div class="sidebar-list-cluster">
          <For each={entryKeys()}>
            {(key) => {
              const entry = () => entriesByKey().get(key)
              const taskID = () => entry()?.item?.task?.id || ""
              return (
                <TaskRow
                  item={entry()?.item}
                  isSelected={props.isSelected}
                  queuePos={props.queuePositions?.get(taskID())}
                  onSelectTask={props.onSelectTask}
                  onDeleteTask={props.onDeleteTask}
                  onCancelTask={props.onCancelTask}
                  onStartNow={props.onStartNow}
                  onDownloadProject={props.onDownloadProject}
                  onRenameTask={props.onRenameTask}
                  startNowBusyID={props.startNowBusyID}
                  downloadBusyID={props.downloadBusyID}
                  canDrag={props.canReorder}
                  dragging={props.draggingID === taskID()}
                  dragOver={props.dragOverID === taskID()}
                  onDragStart={props.onDragStart}
                  onDragOver={props.onDragOver}
                  onDrop={props.onDrop}
                  onDragEnd={props.onDragEnd}
                  depth={entry()?.depth}
                  directChildren={entry()?.directChildren}
                  expanded={entry()?.expanded ?? false}
                  crossDirectory={entry()?.crossDirectory}
                  onToggleExpand={() => {
                    const id = taskID()
                    if (id) props.onToggleExpand?.(id)
                  }}
                />
              )
            }}
          </For>
        </div>
      </section>
    </Show>
  )
}
// ── TaskList ──

export interface TaskListProps {
  /** Optional pre-filtered source. Omit to render the global visibleTasks() projection. */
  items?: any[]
  /** Disable the component-owned search box when the parent already owns filtering. */
  showSearch?: boolean
  /** Disable the component-owned load error block when the parent renders it. */
  showError?: boolean
  /** Empty text for externally-filtered usages such as Mission. */
  emptyLabel?: string
  /** Called when the user clicks a task row. */
  onSelectTask: (taskID: string, directory: string) => void
  /** Called when the user confirms deletion via the row's delete button. */
  onDeleteTask?: (taskID: string) => void
  /** Called when the user confirms cancellation via the row's cancel button. */
  onCancelTask?: (taskID: string) => void
  /** Called when the user commits a new task title via the inline rename
   *  editor. Passing this enables the rename action (button + double-click). */
  onRenameTask?: (taskID: string, title: string) => void | Promise<void>
}

export function TaskList(props: TaskListProps) {
  const allItems = createMemo<any[]>(() => props.items ?? visibleTasks())
  const showSearch = () => props.showSearch !== false
  const showError = () => props.showError !== false
  // searchQuery survives only as long as the component is mounted — that's
  // the right scope: a stale filter on cold start would hide tasks the
  // operator forgot they typed about.
  const [searchQuery, setSearchQuery] = createSignal("")
  const [expandedDirectories, setExpandedDirectories] = createSignal<Record<string, boolean>>({})
  const matchesQuery = (item: any, q: string): boolean => {
    if (!q) return true
    const haystack = [
      item?.task?.title,
      item?.task?.id,
      item?.overview?.headline,
      item?.task?.directory,
      item?.task?.status,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
    return haystack.includes(q)
  }
  const sortedItems = createMemo<any[]>(() => {
    const q = searchQuery().trim().toLowerCase()
    const items = allItems()
    if (!showSearch() || !q) return items
    return items.filter((item) => matchesQuery(item, q))
  })
  const [draggingID, setDraggingID] = createSignal("")
  const [dragOverID, setDragOverID] = createSignal("")
  // Per-task expand state for the lineage tree. Per-session only; local-
  // storage persistence is intentionally out of scope (see spec
  // docs/superpowers/specs/2026-05-27-task-tree-display.md §3.2).
  const [expandedTasks, setExpandedTasks] = createSignal<Set<string>>(new Set())
  const directoryCollapse = createProjectLedgerGroupCollapseState()

  function toggleTaskExpand(id: string): void {
    if (!id) return
    setExpandedTasks((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Queue badges follow the backend queue comparator. Search only filters
  // which rows are rendered; it must not renumber the loaded queue source.
  const queuePositions = createMemo<Map<string, number>>(() => {
    if (props.items || boardStore.tasksHasMore || searchQuery().trim()) return new Map()
    const queued = sortQueuedTaskItems(
      allItems().filter((item) => item?.task?.status === "queued" && !item?._pending),
    )
    const map = new Map<string, number>()
    queued.forEach((item, idx) => {
      const id = item?.task?.id
      if (id) map.set(id, idx + 1)
    })
    return map
  })

  // Tree lineage: parentID → direct visible children. Pure data transform
  // extracted to ./taskTree.ts so cycle / orphan / dedup behaviour is
  // exercised by real unit tests (rule 36) instead of source-string
  // contract assertions. Wraps it in a createMemo so the shape is shared
  // by `grouped` and `flattenGroup` without redoing the walk.
  const tree = createMemo<TaskTreeShape>(() => buildTaskTree(sortedItems()))

  // Group tasks by project directory; each project renders one stable
  // creation-time stream. Lifecycle changes must not move rows between
  // "active" and "recent" sections. Top-level items only — nested children
  // are appended below their parent by `flattenGroup` instead.
  type Group = { directory: string; projectName: string; latest: number; items: any[] }
  const grouped = createMemo<Group[]>(() => {
    const byDir = new Map<string, Group>()
    for (const item of tree().topLevelItems) {
      const dir = projectDirectoryOf(item)
      let g = byDir.get(dir)
      if (!g) {
        g = { directory: dir, projectName: "", latest: 0, items: [] }
        byDir.set(dir, g)
      }
      if (!g.projectName) g.projectName = projectNameOf(item)
      g.items.push(item)
      const created = taskCreatedAt(item)
      if (created > g.latest) g.latest = created
    }
    return [...byDir.values()]
      .map((group) => ({
        ...group,
        items: sortTaskItemsByCreated(group.items),
      }))
      .sort((a, b) => {
        return b.latest - a.latest
      })
  })

  // Bind the pure flattenGroup helper to this component's reactive
  // tree() shape, expandedTasks() signal, and projectDirectoryOf helper
  // so callers see the same call-site idiom as before.
  function flattenGroup(topLevel: any[], groupDirectory: string): TaskTreeEntry[] {
    return flattenGroupPure(topLevel, groupDirectory, tree().childMap, expandedTasks(), projectDirectoryOf)
  }

  // createSelector returns a function that's true only for the currently
  // selected task id. With this in place, selecting a different task
  // re-runs the `isActive` memo on exactly two rows (previously selected,
  // newly selected) instead of all N rows in the list. Wins scale with N.
  const isSelected = createSelector(() => activeTaskID())

  function isDirectoryExpanded(directory: string): boolean {
    return expandedDirectories()[projectDirectoryKey(directory)] === true
  }

  function expandDirectoryGroup(directory: string): void {
    const key = projectDirectoryKey(directory)
    setExpandedDirectories((current) => ({ ...current, [key]: true }))
  }

  const [retrying, setRetrying] = createSignal(false)
  const [startNowBusyID, setStartNowBusyID] = createSignal("")
  const [downloadBusyID, setDownloadBusyID] = createSignal("")

  function queuedItems(directory: string): any[] {
    const group = grouped().find((item) => item.directory === directory)
    if (!group) return []
    return sortQueuedTaskItems(group.items.filter((item) => item?.task?.status === "queued" && !item?._pending))
  }

  function canReorderGroup(group: Group): boolean {
    if (props.items) return false
    if (searchQuery().trim()) return false
    if (boardStore.tasksHasMore) return false
    return group.items.filter((item) => item?.task?.status === "queued" && !item?._pending).length > 1
  }

  async function handleDrop(directory: string, targetID: string, event: DragEvent) {
    event.preventDefault()
    const sourceID = draggingID()
    setDraggingID("")
    setDragOverID("")
    if (!sourceID || sourceID === targetID) return
    const items = queuedItems(directory)
    const ids = items.map((item) => item?.task?.id).filter(Boolean)
    if (!ids.includes(sourceID) || !ids.includes(targetID)) return
    const orderedTaskIDs = moveBefore(ids, sourceID, targetID)
    if (sameOrder(orderedTaskIDs, ids)) return
    try {
      await reorderTaskQueue({
        directory,
        orderedTaskIDs,
        revision: queueRevision(items),
      })
    } catch (error) {
      let reloadError: unknown
      try {
        await loadTasks({ requireFresh: true })
      } catch (err) {
        reloadError = err
      }
      notifyError({
        id: `task:queue-reorder:${projectDirectoryKey(directory)}`,
        title: t("task.reorder_failed_title"),
        message: reloadError
          ? t("task.reorder_failed_reload", { error: errorText(error), reloadError: errorText(reloadError) })
          : t("task.reorder_failed", { error: errorText(error) }),
        details: reloadFailureDetails(error, reloadError),
      })
      return
    }
    try {
      await loadTasks({ requireFresh: true })
    } catch (error) {
      notifyError({
        id: `task:queue-reorder:${projectDirectoryKey(directory)}`,
        title: t("task.reorder_reload_failed_title"),
        message: t("task.reorder_reload_failed", { error: errorText(error) }),
        details: formatErrorDetails(error),
      })
    }
  }

  async function handleRetry() {
    if (retrying()) return
    setRetrying(true)
    try {
      await loadTasks()
    } catch {
      // error surface already lives in boardStore.tasksError — re-render
      // will pick it up; no need to swallow/transform here.
    } finally {
      setRetrying(false)
    }
  }

  async function handleLoadMoreTasks() {
    try {
      await loadMoreTasks()
    } catch (err) {
      notifyError({
        id: "task:list:load-more",
        title: t("task.load_failed"),
        message: err instanceof Error ? err.message : String(err),
        details: formatErrorDetails(err),
      })
    }
  }

  async function handleStartNow(taskID: string, directory: string) {
    if (startNowBusyID()) return
    setStartNowBusyID(taskID)
    const noticeID = `task:start-now:${taskID}`
    try {
      const result = await startQueuedTaskNow({ taskID, directory })
      try {
        await loadTasks({ requireFresh: true })
      } catch (reloadError) {
        notifyError({
          id: noticeID,
          title: t("task.action_reload_failed_title"),
          message: t("task.action_reload_failed", {
            action: result.started ? t("task.start_now_started_title") : t("task.start_now_not_started_title"),
            error: errorText(reloadError),
          }),
          details: formatErrorDetails(reloadError),
        })
        return
      }
      if (result.started) {
        notifySuccess({
          id: noticeID,
          title: t("task.start_now_started_title"),
          message: result.task?.title || taskID,
        })
      } else {
        notifyWarning({
          id: noticeID,
          title: t("task.start_now_not_started_title"),
          message: t("task.start_now_not_started"),
        })
      }
    } catch (err) {
      notifyError({
        id: noticeID,
        title: t("task.start_now_failed_title"),
        message: t("task.start_now_failed", { error: err instanceof Error ? err.message : String(err) }),
        details: formatErrorDetails(err),
      })
      try {
        await loadTasks({ requireFresh: true })
      } catch (reloadError) {
        notifyError({
          id: `${noticeID}:reload`,
          title: t("task.load_failed"),
          message: errorText(reloadError),
          details: reloadFailureDetails(err, reloadError),
        })
      }
    } finally {
      setStartNowBusyID("")
    }
  }

  async function handleDownloadProject(taskID: string, directory: string) {
    if (downloadBusyID()) return
    setDownloadBusyID(taskID)
    const noticeID = `task:download-project:${taskID}`
    try {
      const ok = await downloadTaskProjectArchive({ taskID, directory })
      if (ok) {
        const taskTitle = allItems().find((item) => item?.task?.id === taskID)?.task?.title || taskID
        notifySuccess({
          id: noticeID,
          title: t("task.download_project_started_title"),
          message: taskTitle,
        })
      } else {
        notifyError({
          id: noticeID,
          title: t("task.download_project_failed_title"),
          message: t("task.download_project_failed", { error: taskID }),
        })
      }
    } catch (err) {
      notifyError({
        id: noticeID,
        title: t("task.download_project_failed_title"),
        message: t("task.download_project_failed", { error: err instanceof Error ? err.message : String(err) }),
        details: formatErrorDetails(err),
      })
    } finally {
      setDownloadBusyID("")
    }
  }

  async function handleDeleteProject(directory: string): Promise<void> {
    const target = String(directory || "").trim()
    const noticeID = `project:delete:${projectDirectoryKey(target)}`
    try {
      const result = await deleteProject(target)
      if (!result.deletedActive) {
        try {
          await loadTasks({ requireFresh: true })
        } catch (reloadError) {
          notifyError({
            id: noticeID,
            title: t("project.reload_after_delete_failed_title"),
            message: t("project.reload_after_delete_failed", {
              directory: result.directory,
              error: errorText(reloadError),
            }),
            details: formatErrorDetails(reloadError),
          })
          return
        }
      }
      notifySuccess({
        id: noticeID,
        title: t("project.delete_success_title"),
        message: t("project.delete_success", { directory: result.directory }),
      })
    } catch (err) {
      notifyError({
        id: noticeID,
        title: t("project.delete_failed_title"),
        message: t("project.delete_failed", { error: err instanceof Error ? err.message : String(err) }),
        details: formatErrorDetails(err),
      })
    }
  }

  async function handleCopyProject(directory: string): Promise<void> {
    const target = String(directory || "").trim()
    const noticeID = `project:copy:${projectDirectoryKey(target)}`
    try {
      if (!target) throw new Error("Project directory is required")
      if (!navigator.clipboard?.writeText) throw new Error(t("project.copy_clipboard_unavailable"))
      await navigator.clipboard.writeText(target)
      notifySuccess({
        id: noticeID,
        title: t("project.copy_success_title"),
        message: t("project.copy_success", { directory: target }),
      })
    } catch (err) {
      notifyError({
        id: noticeID,
        title: t("project.copy_failed_title"),
        message: t("project.copy_failed", { error: err instanceof Error ? err.message : String(err) }),
        details: formatErrorDetails(err),
      })
    }
  }

  async function handleRenameProject(directory: string, currentName: string): Promise<void> {
    const target = String(directory || "").trim()
    const noticeID = `project:rename:${projectDirectoryKey(target)}`
    try {
      if (!target) throw new Error("Project directory is required")
      const dialog = await showAppDialog({
        title: t("project.rename_dialog_title"),
        input: true,
        inputLabel: t("project.rename_input_label"),
        inputValue: currentName,
        cancel: true,
        okLabel: t("project.rename_confirm"),
      })
      if (!dialog.confirmed) return
      const nextName = String(dialog.value || "").trim()
      if (!nextName || nextName === currentName.trim()) return
      const result = await renameProject(target, nextName)
      try {
        await loadTasks({ requireFresh: true })
      } catch (reloadError) {
        notifyError({
          id: noticeID,
          title: t("project.reload_after_rename_failed_title"),
          message: t("project.reload_after_rename_failed", { name: result.name, error: errorText(reloadError) }),
          details: formatErrorDetails(reloadError),
        })
        return
      }
      notifySuccess({
        id: noticeID,
        title: t("project.rename_success_title"),
        message: t("project.rename_success", { name: result.name }),
      })
    } catch (err) {
      notifyError({
        id: noticeID,
        title: t("project.rename_failed_title"),
        message: t("project.rename_failed", { error: err instanceof Error ? err.message : String(err) }),
        details: formatErrorDetails(err),
      })
    }
  }

  return (
    <div class="task-list-panel">
      <Show when={showSearch() && (allItems().length > 4 || searchQuery())}>
        <div class="task-list-search search-field">
          <Icon name="search" size={12} class="task-list-search-icon search-field-icon" />
          <input
            type="search"
            class="task-list-search-input search-field-input"
            placeholder={t("task.search_placeholder")}
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            aria-label={t("task.search_placeholder")}
          />
          <Show when={searchQuery()}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              tone="neutral"
              data-chrome="icon-action"
              data-ui="task-list-search-clear"
              onClick={() => setSearchQuery("")}
              title={t("common.clear")}
              aria-label={t("common.clear")}
            >
              <Icon name="close" />
            </Button>
          </Show>
        </div>
      </Show>
      <Show when={showError() && boardStore.tasksError}>
        <div class="task-list-error" role="alert">
          <div class="task-list-error-msg">
            {t("task.load_failed")}: {boardStore.tasksError}
          </div>
          <Button
            type="button"
            variant="outline"
            size="md"
            tone="danger"
            data-ui="task-list-error-retry"
            disabled={retrying()}
            onClick={handleRetry}
          >
            {retrying() ? t("common.loading") : t("common.retry")}
          </Button>
        </div>
      </Show>
      <Show
        when={sortedItems().length > 0}
        fallback={
          <Show when={!boardStore.tasksError}>
            <Show
              when={boardStore.tasksLoaded}
              fallback={
                <LedgerLoadingStatus
                  label={t("common.loading")}
                  class="task-list-skeleton"
                  dataUi="task-list-loading"
                />
              }
            >
              <div class="empty-hint">
                {searchQuery()
                  ? t("task.search_empty", { query: searchQuery() })
                  : (props.emptyLabel ?? t("task.ledger.empty"))}
              </div>
            </Show>
          </Show>
        }
      >
        <For each={grouped()}>
          {(group) => {
            const expanded = () => isDirectoryExpanded(group.directory)
            const collapsed = () => directoryCollapse.isCollapsed(group.directory)
            // Compact quota bounds the *top-level* row count of the
            // directory group. Expanded subtrees push children below their
            // parent without consuming that quota — they only appear after
            // explicit user action via the per-task chevron.
            const visibleGroupItems = () =>
              expanded() ? group.items : group.items.slice(0, COMPACT_GROUP_VISIBLE_LIMIT)
            const hiddenCount = () => Math.max(0, group.items.length - visibleGroupItems().length)
            const entries = () => flattenGroup(visibleGroupItems(), group.directory)
            return (
              <ProjectLedgerGroup
                directory={group.directory}
                projectName={group.projectName}
                count={group.items.length}
                collapsed={collapsed()}
                onToggle={() => directoryCollapse.toggle(group.directory)}
                onCopyProject={handleCopyProject}
                onRenameProject={handleRenameProject}
                onDeleteProject={handleDeleteProject}
              >
                <TaskSection
                  entries={entries()}
                  isSelected={isSelected}
                  queuePositions={queuePositions()}
                  onSelectTask={props.onSelectTask}
                  onDeleteTask={props.onDeleteTask}
                  onCancelTask={props.onCancelTask}
                  onRenameTask={props.onRenameTask}
                  onStartNow={handleStartNow}
                  onDownloadProject={handleDownloadProject}
                  startNowBusyID={startNowBusyID()}
                  downloadBusyID={downloadBusyID()}
                  canReorder={canReorderGroup(group)}
                  draggingID={draggingID()}
                  dragOverID={dragOverID()}
                  onDragStart={setDraggingID}
                  onDragOver={(id, event) => {
                    event.preventDefault()
                    if (draggingID() && id !== draggingID()) setDragOverID(id)
                  }}
                  onDrop={(id, event) => handleDrop(group.directory, id, event)}
                  onDragEnd={() => {
                    setDraggingID("")
                    setDragOverID("")
                  }}
                  onToggleExpand={toggleTaskExpand}
                />
                <Show when={hiddenCount() > 0}>
                  <span class="project-group-show-more">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      tone="neutral"
                      onClick={() => expandDirectoryGroup(group.directory)}
                      aria-label={t("progress.expand_more", { count: String(hiddenCount()) })}
                    >
                      {t("acceptance.show_more")}
                    </Button>
                  </span>
                </Show>
              </ProjectLedgerGroup>
            )
          }}
        </For>
      </Show>
      <Show when={!props.items && boardStore.tasksHasMore}>
        <div class="project-group-show-more task-list-load-more">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            tone="neutral"
            data-ui="task-list-load-more"
            disabled={boardStore.tasksLoadingMore}
            onClick={handleLoadMoreTasks}
          >
            {boardStore.tasksLoadingMore ? t("common.loading") : t("acceptance.show_more")}
          </Button>
        </div>
      </Show>
    </div>
  )
}
