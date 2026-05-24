// ── TaskList Component ──
// Solid.js port of renderTaskList / taskSection / taskRow / visibleTasks
// Displays active and recently-completed tasks from boardStore.

import { createMemo, createSelector, createSignal, For, Show } from "solid-js";
import { boardStore, visibleTasks, loadTasks, taskCreatedAt } from "../store/board";
import { settingsStore } from "../store/settings";
import { reorderTaskQueue, startQueuedTaskNow } from "../services/task-queue";
import { exportTaskArchive, importTaskArchive } from "../services/task-archive";
import { notifyError, notifyProgress, notifySuccess, notifyWarning, taskHasUnreadNotification, formatErrorDetails } from "../services/notify";
import { useArmedConfirm } from "../solid/armed-confirm";
import { useAsyncAction } from "../solid/async-action";
import { t } from "../utils/i18n";
import { stamp, fullStampWithRelative } from "../utils/time";
import { Icon } from "./Icon";
import { Button } from "./ui/Button";

// ── Task status constants ──

const COMPLETED_STATUSES = new Set(["completed", "failed", "cancelled"]);

// ── Inline helpers (ports of functions) ──

function clipText(value: string, limit = 80): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function shortPath(p: string): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.length > 3 ? ".../" + parts.slice(-3).join("/") : p;
}

function joinBullet(values: (string | undefined | null | false)[]): string {
  return values.filter(Boolean).join(" / ");
}

function taskListTitle(item: any): string {
  return clipText(item?.task?.title || item?.overview?.headline || item?.task?.id || "", 72);
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    idle: t("task.status.idle"),
    queued: t("task.status.queued"),
    active: t("task.status.active"),
    completed: t("task.status.completed"),
    failed: t("task.status.failed"),
    cancelled: t("task.status.cancelled"),
  };
  return map[status] || status;
}

function taskListBadge(item: any, queuePos?: number): string {
  if (item?._pending) return statusLabel("active");
  const pending = Number(item?.pending_interactions || 0) > 0;
  if (pending) return t("detail.pending_interactions");
  const status = item?.task?.status || "idle";
  if (status === "queued" && queuePos !== undefined && queuePos > 0) {
    return `${statusLabel("queued")} #${queuePos}`;
  }
  return statusLabel(status);
}

function taskListMeta(item: any): string {
  return joinBullet([stamp(taskCreatedAt(item))]);
}

function queueRevision(items: any[]): string | undefined {
  for (const item of items) {
    const revision = item?.task?.queue?.revision;
    if (typeof revision === "string") return revision;
  }
  return undefined;
}

function sortTaskItemsByCreated(items: any[]): any[] {
  return [...items].sort((a, b) => taskCreatedAt(b) - taskCreatedAt(a));
}

function moveBefore(ids: string[], sourceID: string, targetID: string): string[] {
  if (sourceID === targetID) return ids;
  const next = ids.filter((id) => id !== sourceID);
  const targetIndex = next.indexOf(targetID);
  if (targetIndex < 0) return ids;
  next.splice(targetIndex, 0, sourceID);
  return next;
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function projectDirectoryOf(item: any): string {
  const dir = item?.task?.directory;
  if (typeof dir === "string" && dir.trim()) return dir;
  // Pending tasks have no server-assigned directory yet; attribute them to the
  // currently active project so the user sees them grouped correctly.
  return settingsStore.directory || "";
}

function projectLabel(directory: string): { name: string; parent: string } {
  const normalized = (directory || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return { name: t("task.project.unknown"), parent: "" };
  const parts = normalized.split("/").filter(Boolean);
  const name = parts[parts.length - 1] || normalized;
  const parent =
    parts.length > 1
      ? parts.length > 3
        ? ".../" + parts.slice(-3, -1).join("/")
        : parts.slice(0, -1).join("/")
      : "";
  return { name, parent };
}

// ── DeleteButton (two-step inline confirm) ──
// First click arms the button (data-confirm="true") and shows the confirm
// icon; a second click within the confirm window fires the delete. The state
// auto-resets after the window or when the user clicks elsewhere, so there's
// no modal round-trip.

const CONFIRM_WINDOW_MS = 3000; // confirm window length in milliseconds.

function DeleteButton(props: { id: string; onDelete: (id: string) => void }) {
  const confirmDelete = useArmedConfirm(CONFIRM_WINDOW_MS);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      tone="danger"
      data-chrome="icon-action"
      data-ui="task-row-delete"
      data-task-delete={props.id}
      data-confirm={confirmDelete.armed() ? "true" : undefined}
      title={t("task.delete_button_title")}
      aria-label={t("task.delete_button_title")}
      onClick={(e) => {
        e.stopPropagation();
        confirmDelete.confirm(() => props.onDelete(props.id));
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
  );
}

// ── ExportButton (single-click, no confirm) ──
// Exporting is non-destructive — bytes flow OUT only — so unlike
// cancel/delete we don't gate it behind a two-step confirm. The button is
// visible on every persisted task.

function ExportButton(props: { id: string; directory?: string }) {
  const exportAction = useAsyncAction(async () => {
    return await exportTaskArchive({ taskID: props.id, directory: props.directory });
  });
  const noticeID = () => `task-archive:export:${props.id}`;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      tone="accent"
      data-chrome="icon-action"
      data-ui="task-row-export"
      data-task-export={props.id}
      data-busy={exportAction.pending() ? "true" : undefined}
      disabled={exportAction.pending()}
      title={t("task.export_button_title")}
      aria-label={t("task.export_button_title")}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          notifyProgress({
            id: noticeID(),
            title: t("task.export_started"),
            message: props.id,
          });
          const result = await exportAction.run();
          notifySuccess({
            id: noticeID(),
            title: t("task.export_done_title"),
            message: t("task.export_done", { filename: result.filename }),
          });
        } catch (err) {
          notifyError({
            id: noticeID(),
            title: t("task.export_failed_title"),
            message: t("task.export_failed", { error: err instanceof Error ? err.message : String(err) }),
            details: formatErrorDetails(err),
          });
        }
      }}
    >
      <Icon name="download" size={11} />
    </Button>
  );
}

// ── CancelButton (two-step inline confirm) ──
// Mirrors DeleteButton shape/behavior so the row's two actions read as a
// coherent pair. Shown only for interruptable tasks (queued / active).

function CancelButton(props: { id: string; onCancel: (id: string) => void }) {
  const confirmCancel = useArmedConfirm(CONFIRM_WINDOW_MS);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      tone="neutral"
      data-chrome="icon-action"
      data-ui="task-row-cancel"
      data-task-cancel={props.id}
      data-confirm={confirmCancel.armed() ? "true" : undefined}
      title={t("task.cancel_button_title")}
      aria-label={t("task.cancel_button_title")}
      onClick={(e) => {
        e.stopPropagation();
        confirmCancel.confirm(() => props.onCancel(props.id));
      }}
      onBlur={confirmCancel.disarm}
    >
      <span class="task-row-cancel-icon" data-icon="cancel" aria-hidden="true">
        <Icon name="stop" size={11} />
      </span>
      <span class="task-row-cancel-icon" data-icon="confirm" aria-hidden="true">
        <Icon name="check" size={11} />
      </span>
    </Button>
  );
}

function StartNowButton(props: { id: string; busy?: boolean; onStartNow: (id: string) => void }) {
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
      onClick={(e) => {
        e.stopPropagation();
        props.onStartNow(props.id);
      }}
    >
      <Icon name="send" size={11} />
    </Button>
  );
}

// ── TaskRow ──

const INTERRUPTABLE_TASK_STATUSES = new Set(["queued", "active"]);

function TaskRow(props: {
  item: any;
  /** Solid createSelector function — returns true only for the currently
   *  selected task id. Lets only the previously-selected and newly-selected
   *  rows reconcile when boardStore.selectedTaskID changes, instead of
   *  re-running every row's `isActive` memo. */
  isSelected: (id: string) => boolean;
  queuePos?: number;
  onSelectTask: (id: string) => void;
  onDeleteTask?: (id: string) => void;
  onCancelTask?: (id: string) => void;
  onStartNow?: (id: string) => void;
  startNowBusyID?: string;
  canDrag?: boolean;
  dragging?: boolean;
  dragOver?: boolean;
  onDragStart?: (id: string) => void;
  onDragOver?: (id: string, event: DragEvent) => void;
  onDrop?: (id: string, event: DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const id = () => props.item?.task?.id || "";
  const pending = () => props.item?._pending === true;
  const status = () => (pending() ? "active" : props.item?.task?.status || "idle");
  const title = () => taskListTitle(props.item) || id();
  const isActive = () => !pending() && props.isSelected(id());
  const hasUnreadNotification = () => !pending() && taskHasUnreadNotification(props.item);
  const badgeLabel = () => taskListBadge(props.item, props.queuePos);
  const canCancel = () =>
    !pending() && !!id() && !!props.onCancelTask && INTERRUPTABLE_TASK_STATUSES.has(status());
  const canStartNow = () =>
    !pending() && !!id() && !!props.onStartNow && status() === "queued";
  const canDelete = () =>
    !pending() && !!id() && !!props.onDeleteTask;
  // Export is offered for any persisted task — no status gate (you can
  // archive a completed/failed/cancelled task, that's the typical case).
  const canExport = () => !pending() && !!id();
  const directory = () =>
    typeof props.item?.task?.directory === "string" ? props.item.task.directory : undefined;
  const hasActions = () => canStartNow() || canCancel() || canDelete() || canExport();
  const canDrag = () => props.canDrag === true && status() === "queued" && !pending();

  return (
    <div
      class="task-row-mini global-task-row"
      data-active={isActive() ? "true" : undefined}
      data-status={status()}
      data-notification-unread={hasUnreadNotification() ? "true" : undefined}
      data-draggable={canDrag() ? "true" : undefined}
      data-dragging={props.dragging ? "true" : undefined}
      data-drag-over={props.dragOver ? "true" : undefined}
      draggable={canDrag()}
      title={title()}
      onDragStart={(event) => {
        if (!canDrag()) return;
        event.dataTransfer?.setData("text/plain", id());
        event.dataTransfer?.setDragImage(event.currentTarget, 10, 10);
        props.onDragStart?.(id());
      }}
      onDragOver={(event) => {
        if (!canDrag()) return;
        props.onDragOver?.(id(), event);
      }}
      onDrop={(event) => {
        if (!canDrag()) return;
        props.onDrop?.(id(), event);
      }}
      onDragEnd={() => props.onDragEnd?.()}
    >
      <Show when={canDrag()}>
        <span class="task-row-drag-handle" title={t("task.reorder_button_title")} aria-hidden="true">
          <Icon name="drag-handle" size={12} />
        </span>
      </Show>
      <button
        type="button"
        class="task-row-main"
        data-task-id={pending() ? undefined : id()}
        disabled={pending()}
        aria-disabled={pending() ? "true" : undefined}
        aria-current={isActive() ? "page" : undefined}
        title={title()}
        onClick={() => {
          if (!pending() && id()) props.onSelectTask(id());
        }}
      >
        <div class="task-row-head">
          <strong>{title()}</strong>
        </div>
        <div class="task-row-meta">
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
        </div>
      </button>
      {/* iter45: stamp + cancel/delete actions live in a right
          column (vertical stack), both anchored to the row's
          right edge. Pre-iter45 the stamp lived inline inside
          .task-row-meta (left-aligned next to the status badge)
          and the actions were a separate right-side cluster. The
          two split treatments meant the stamp and the actions
          for the SAME row were in different visual axes — the
          user requested they share the right column with stamp
          on top and actions below. */}
      <div class="task-row-right">
        <small
          class="task-row-stamp"
          title={fullStampWithRelative(taskCreatedAt(props.item))}
        >{taskListMeta(props.item)}</small>
        <Show when={hasActions()}>
          <div class="task-row-actions">
            <Show when={canStartNow()}>
              <StartNowButton
                id={id()}
                busy={props.startNowBusyID === id()}
                onStartNow={props.onStartNow!}
              />
            </Show>
            <Show when={canExport()}>
              <ExportButton id={id()} directory={directory()} />
            </Show>
            <Show when={canCancel()}>
              <CancelButton id={id()} onCancel={props.onCancelTask!} />
            </Show>
            <Show when={canDelete()}>
              <DeleteButton id={id()} onDelete={props.onDeleteTask!} />
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}

// ── TaskSection ──

function TaskSection(props: {
  label: string;
  items: any[];
  isSelected: (id: string) => boolean;
  queuePositions?: Map<string, number>;
  onSelectTask: (id: string) => void;
  onDeleteTask?: (id: string) => void;
  onCancelTask?: (id: string) => void;
  onStartNow?: (id: string) => void;
  startNowBusyID?: string;
  draggingID?: string;
  dragOverID?: string;
  canReorder?: boolean;
  onDragStart?: (id: string) => void;
  onDragOver?: (id: string, event: DragEvent) => void;
  onDrop?: (id: string, event: DragEvent) => void;
  onDragEnd?: () => void;
}) {
  return (
    <Show when={props.items.length > 0}>
      <section class="sidebar-list-group">
        <div class="sidebar-list-heading">{props.label}</div>
        <div class="sidebar-list-cluster">
          <For each={props.items}>
            {(item) => (
              <TaskRow
                item={item}
                isSelected={props.isSelected}
                queuePos={props.queuePositions?.get(item?.task?.id || "")}
                onSelectTask={props.onSelectTask}
                onDeleteTask={props.onDeleteTask}
                onCancelTask={props.onCancelTask}
                onStartNow={props.onStartNow}
                startNowBusyID={props.startNowBusyID}
                canDrag={props.canReorder}
                dragging={props.draggingID === (item?.task?.id || "")}
                dragOver={props.dragOverID === (item?.task?.id || "")}
                onDragStart={props.onDragStart}
                onDragOver={props.onDragOver}
                onDrop={props.onDrop}
                onDragEnd={props.onDragEnd}
              />
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}

// ── TaskList ──

export interface TaskListProps {
  /** Called when the user clicks a task row. */
  onSelectTask: (taskID: string) => void;
  /** Called when the user confirms deletion via the row's delete button. */
  onDeleteTask?: (taskID: string) => void;
  /** Called when the user confirms cancellation via the row's cancel button. */
  onCancelTask?: (taskID: string) => void;
}

export function TaskList(props: TaskListProps) {
  const allItems = createMemo<any[]>(() => visibleTasks());
  // searchQuery survives only as long as the component is mounted — that's
  // the right scope: a stale filter on cold start would hide tasks the
  // operator forgot they typed about.
  const [searchQuery, setSearchQuery] = createSignal("");
  const matchesQuery = (item: any, q: string): boolean => {
    if (!q) return true;
    const haystack = [
      item?.task?.title,
      item?.task?.id,
      item?.overview?.headline,
      item?.task?.directory,
      item?.task?.status,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  };
  const sortedItems = createMemo<any[]>(() => {
    const q = searchQuery().trim().toLowerCase();
    const items = allItems();
    if (!q) return items;
    return items.filter((item) => matchesQuery(item, q));
  });
  const [draggingID, setDraggingID] = createSignal("");
  const [dragOverID, setDragOverID] = createSignal("");
  const [collapsedDirectories, setCollapsedDirectories] = createSignal<Record<string, boolean>>({});

  // Queue badges follow the same creation-time row order as the sidebar list.
  const queuePositions = createMemo<Map<string, number>>(() => {
    const queued = sortTaskItemsByCreated(
      sortedItems().filter((item) => item?.task?.status === "queued" && !item?._pending),
    );
    const map = new Map<string, number>();
    queued.forEach((item, idx) => {
      const id = item?.task?.id;
      if (id) map.set(id, idx + 1);
    });
    return map;
  });

  // Group tasks by project directory; group order also follows latest task
  // creation time so the sidebar has one ordering source.
  type Group = { directory: string; latest: number; active: any[]; recent: any[] };
  const grouped = createMemo<Group[]>(() => {
    const byDir = new Map<string, Group>();
    for (const item of sortedItems()) {
      const dir = projectDirectoryOf(item);
      let g = byDir.get(dir);
      if (!g) {
        g = { directory: dir, latest: 0, active: [], recent: [] };
        byDir.set(dir, g);
      }
      const status = item?.task?.status || "";
      if (item?._pending || !COMPLETED_STATUSES.has(status)) g.active.push(item);
      else g.recent.push(item);
      const created = taskCreatedAt(item);
      if (created > g.latest) g.latest = created;
    }
    return [...byDir.values()].map((group) => ({
      ...group,
      active: sortTaskItemsByCreated(group.active),
      recent: sortTaskItemsByCreated(group.recent),
    })).sort((a, b) => {
      return b.latest - a.latest;
    });
  });

  // createSelector returns a function that's true only for the currently
  // selected task id. With this in place, selecting a different task
  // re-runs the `isActive` memo on exactly two rows (previously selected,
  // newly selected) instead of all N rows in the list. Wins scale with N.
  const isSelected = createSelector(() => boardStore.selectedTaskID);

  function directoryGroupKey(directory: string): string {
    return directory || "__opencorvus_unassigned_project__";
  }

  function isDirectoryCollapsed(directory: string): boolean {
    return collapsedDirectories()[directoryGroupKey(directory)] === true;
  }

  function toggleDirectoryGroup(directory: string): void {
    const key = directoryGroupKey(directory);
    setCollapsedDirectories((current) => {
      const next = { ...current };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  }

  const [retrying, setRetrying] = createSignal(false);
  const [startNowBusyID, setStartNowBusyID] = createSignal("");

  function queuedItems(directory: string): any[] {
    const group = grouped().find((item) => item.directory === directory);
    if (!group) return [];
    return group.active.filter((item) => item?.task?.status === "queued" && !item?._pending);
  }

  async function handleDrop(directory: string, targetID: string, event: DragEvent) {
    event.preventDefault();
    const sourceID = draggingID();
    setDraggingID("");
    setDragOverID("");
    if (!sourceID || sourceID === targetID) return;
    const items = queuedItems(directory);
    const ids = items.map((item) => item?.task?.id).filter(Boolean);
    if (!ids.includes(sourceID) || !ids.includes(targetID)) return;
    const orderedTaskIDs = moveBefore(ids, sourceID, targetID);
    if (sameOrder(orderedTaskIDs, ids)) return;
    try {
      await reorderTaskQueue({
        directory,
        orderedTaskIDs,
        revision: queueRevision(items),
      });
      await loadTasks();
    } catch (error) {
      console.error("[TaskList] reorder queue failed", error);
      await loadTasks().catch(() => undefined);
    }
  }

  async function handleRetry() {
    if (retrying()) return;
    setRetrying(true);
    try {
      await loadTasks();
    } catch {
      // error surface already lives in boardStore.tasksError — re-render
      // will pick it up; no need to swallow/transform here.
    } finally {
      setRetrying(false);
    }
  }

  async function handleStartNow(taskID: string) {
    if (startNowBusyID()) return;
    setStartNowBusyID(taskID);
    const noticeID = `task:start-now:${taskID}`;
    try {
      const result = await startQueuedTaskNow(taskID);
      if (result.started) {
        notifySuccess({
          id: noticeID,
          title: t("task.start_now_started_title"),
          message: result.task?.title || taskID,
        });
      } else {
        notifyWarning({
          id: noticeID,
          title: t("task.start_now_not_started_title"),
          message: t("task.start_now_not_started"),
        });
      }
      await loadTasks();
    } catch (err) {
      notifyError({
        id: noticeID,
        title: t("task.start_now_failed_title"),
        message: t("task.start_now_failed", { error: err instanceof Error ? err.message : String(err) }),
        details: formatErrorDetails(err),
      });
      await loadTasks().catch(() => undefined);
    } finally {
      setStartNowBusyID("");
    }
  }

  let importInputEl: HTMLInputElement | undefined;
  const [importing, setImporting] = createSignal(false);
  const [importOverwrite, setImportOverwrite] = createSignal(false);

  async function handleImportFile(file: File) {
    const directory = settingsStore.directory || "";
    if (!directory) {
      notifyWarning({
        id: "task-archive:import",
        title: t("task.import_no_directory_title"),
        message: t("task.import_no_directory"),
      });
      return;
    }
    setImporting(true);
    notifyProgress({
      id: "task-archive:import",
      title: t("task.import_started"),
      message: file.name,
    });
    try {
      const result = await importTaskArchive({ file, directory, overwrite: importOverwrite() });
      notifySuccess({
        id: "task-archive:import",
        title: t("task.import_done_title"),
        message: t("task.import_done", {
          restored: String(result.restoredFiles),
          skipped: String(result.skippedFiles.length),
        }),
      });
      await loadTasks();
    } catch (err) {
      notifyError({
        id: "task-archive:import",
        title: t("task.import_failed_title"),
        message: t("task.import_failed", { error: err instanceof Error ? err.message : String(err) }),
        details: formatErrorDetails(err),
      });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div class="task-list-panel">
      <div class="task-list-toolbar">
        <label
          class="task-list-import-overwrite"
          title={t("task.import_overwrite_title")}
        >
          <input
            type="checkbox"
            checked={importOverwrite()}
            disabled={importing()}
            onChange={(e) => setImportOverwrite(e.currentTarget.checked)}
            data-task-import-overwrite
          />
          <span>{t("task.import_overwrite_label")}</span>
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          tone="neutral"
          data-ui="task-list-import-button"
          data-task-import
          disabled={importing()}
          title={t("task.import_button_title")}
          aria-label={t("task.import_button_title")}
          onClick={() => importInputEl?.click()}
        >
          <Icon name="upload" size={11} />
          <span class="task-list-import-button-text">{t("task.import_button")}</span>
        </Button>
        <input
          ref={(el) => (importInputEl = el)}
          type="file"
          accept=".zip,application/zip"
          class="task-list-import-input"
          data-testid="task-import-input"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            // Reset value so picking the same file twice still fires onChange.
            e.currentTarget.value = "";
            if (file) void handleImportFile(file);
          }}
        />
      </div>
      <Show when={allItems().length > 4 || searchQuery()}>
        <div class="task-list-search">
          <Icon name="search" size={12} class="task-list-search-icon" />
          <input
            type="search"
            class="task-list-search-input"
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
      <Show when={boardStore.tasksError}>
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
                <div class="task-list-skeleton" aria-hidden="true">
                  <div class="task-list-skeleton-row" />
                  <div class="task-list-skeleton-row" />
                  <div class="task-list-skeleton-row" />
                </div>
              }
            >
              <div class="empty-hint">
                {searchQuery() ? t("task.search_empty", { query: searchQuery() }) : t("task.none")}
              </div>
            </Show>
          </Show>
        }
      >
        <For each={grouped()}>
          {(group) => {
            const label = projectLabel(group.directory);
            const taskCount = () => group.active.length + group.recent.length;
            const collapsed = () => isDirectoryCollapsed(group.directory);
            return (
              <section
                class="project-group"
                data-collapsed={collapsed() ? "true" : undefined}
              >
                <button
                  type="button"
                  class="project-group-heading"
                  title={group.directory}
                  aria-expanded={collapsed() ? "false" : "true"}
                  aria-label={collapsed() ? t("task.project.expand", { name: label.name }) : t("task.project.collapse", { name: label.name })}
                  onClick={() => toggleDirectoryGroup(group.directory)}
                >
                  <span class="project-group-icon" aria-hidden="true">
                    <Icon name={collapsed() ? "folder" : "folder-open"} size={14} />
                  </span>
                  <span class="project-group-copy">
                    <span class="project-group-name">{label.name}</span>
                    <Show when={label.parent}>
                      <span class="project-group-parent">{label.parent}</span>
                    </Show>
                  </span>
                  <span class="project-group-count" aria-label={t("task.project.count", { count: String(taskCount()) })}>
                    {taskCount()}
                  </span>
                  <span class="project-group-chevron" aria-hidden="true">
                    <Icon name={collapsed() ? "chevron" : "chevron-down"} size={12} />
                  </span>
                </button>
                <Show when={!collapsed()}>
                  <div class="project-group-body">
                    <Show when={group.active.length > 0}>
                      <TaskSection
                        label={t("task.group.active")}
                        items={group.active}
                        isSelected={isSelected}
                        queuePositions={queuePositions()}
                        onSelectTask={props.onSelectTask}
                        onDeleteTask={props.onDeleteTask}
                        onCancelTask={props.onCancelTask}
                        onStartNow={handleStartNow}
                        startNowBusyID={startNowBusyID()}
                        canReorder={group.active.filter((item) => item?.task?.status === "queued" && !item?._pending).length > 1}
                        draggingID={draggingID()}
                        dragOverID={dragOverID()}
                        onDragStart={setDraggingID}
                        onDragOver={(id, event) => {
                          event.preventDefault();
                          if (draggingID() && id !== draggingID()) setDragOverID(id);
                        }}
                        onDrop={(id, event) => handleDrop(group.directory, id, event)}
                        onDragEnd={() => {
                          setDraggingID("");
                          setDragOverID("");
                        }}
                      />
                    </Show>
                    <Show when={group.recent.length > 0}>
                      <TaskSection
                        label={t("task.group.recent")}
                        items={group.recent}
                        isSelected={isSelected}
                        onSelectTask={props.onSelectTask}
                        onDeleteTask={props.onDeleteTask}
                        onCancelTask={props.onCancelTask}
                        onStartNow={handleStartNow}
                        startNowBusyID={startNowBusyID()}
                      />
                    </Show>
                  </div>
                </Show>
              </section>
            );
          }}
        </For>
      </Show>
    </div>
  );
}
