// ── TaskList Component ──
// Solid.js port of renderTaskList / taskSection / taskRow / visibleTasks
// Displays active and recently-completed tasks from boardStore.

import { createMemo, createSignal, onCleanup, For, Show } from "solid-js";
import { boardStore, visibleTasks, loadTasks } from "../store/board";
import { settingsStore } from "../store/settings";
import { reorderTaskQueue } from "../services/task-queue";
import { t } from "../utils/i18n";
import { stamp } from "../utils/time";

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

function taskUpdated(item: any): number {
  return item?.updated_at || item?.task?.time?.updated || item?.task?.time?.created || 0;
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
  return joinBullet([stamp(taskUpdated(item))]);
}

function queueOrder(item: any): number {
  const value = item?.task?.queue?.order;
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function queueRevision(items: any[]): string | undefined {
  for (const item of items) {
    const revision = item?.task?.queue?.revision;
    if (typeof revision === "string") return revision;
  }
  return undefined;
}

function priorityBucket(item: any): number {
  return item?.task?.priority === "critical" ? 0 : 1;
}

function sortActiveItems(items: any[]): any[] {
  return [...items].sort((a, b) => {
    const ap = a?._pending ? 0 : a?.task?.status === "active" ? 1 : a?.task?.status === "queued" ? 2 : 3;
    const bp = b?._pending ? 0 : b?.task?.status === "active" ? 1 : b?.task?.status === "queued" ? 2 : 3;
    if (ap !== bp) return ap - bp;
    if (ap === 2) {
      const priorityDelta = priorityBucket(a) - priorityBucket(b);
      if (priorityDelta !== 0) return priorityDelta;
      const orderDelta = queueOrder(a) - queueOrder(b);
      if (orderDelta !== 0) return orderDelta;
    }
    return taskUpdated(b) - taskUpdated(a);
  });
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
// icon; a second click within CONFIRM_WINDOW_MS fires the delete. The state
// auto-resets after the window or when the user clicks elsewhere, so there's
// no modal round-trip.

const CONFIRM_WINDOW_MS = 3000;

function DeleteButton(props: { id: string; onDelete: (id: string) => void }) {
  const [armed, setArmed] = createSignal(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  function disarm() {
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = undefined;
    }
    setArmed(false);
  }

  onCleanup(disarm);

  return (
    <button
      type="button"
      class="task-row-delete"
      data-task-delete={props.id}
      data-confirm={armed() ? "true" : undefined}
      title={t("task.delete_button_title")}
      aria-label={t("task.delete_button_title")}
      onClick={(e) => {
        e.stopPropagation();
        if (armed()) {
          disarm();
          props.onDelete(props.id);
          return;
        }
        setArmed(true);
        resetTimer = setTimeout(disarm, CONFIRM_WINDOW_MS);
      }}
      onBlur={disarm}
    >
      <span class="task-row-delete-icon" data-icon="delete" aria-hidden="true">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
          <path
            d="M4.5 4.5l7 7M11.5 4.5l-7 7"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
      </span>
      <span class="task-row-delete-icon" data-icon="confirm" aria-hidden="true">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
          <path
            d="M3.5 8.5l2.9 2.9 6.1-6.1"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}

// ── CancelButton (two-step inline confirm) ──
// Mirrors DeleteButton shape/behavior so the row's two actions read as a
// coherent pair. Shown only for interruptable tasks (queued / active).

function CancelButton(props: { id: string; onCancel: (id: string) => void }) {
  const [armed, setArmed] = createSignal(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  function disarm() {
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = undefined;
    }
    setArmed(false);
  }

  onCleanup(disarm);

  return (
    <button
      type="button"
      class="task-row-cancel"
      data-task-cancel={props.id}
      data-confirm={armed() ? "true" : undefined}
      title={t("task.cancel_button_title")}
      aria-label={t("task.cancel_button_title")}
      onClick={(e) => {
        e.stopPropagation();
        if (armed()) {
          disarm();
          props.onCancel(props.id);
          return;
        }
        setArmed(true);
        resetTimer = setTimeout(disarm, CONFIRM_WINDOW_MS);
      }}
      onBlur={disarm}
    >
      <span class="task-row-cancel-icon" data-icon="cancel" aria-hidden="true">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
          <rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor" />
        </svg>
      </span>
      <span class="task-row-cancel-icon" data-icon="confirm" aria-hidden="true">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
          <path
            d="M3.5 8.5l2.9 2.9 6.1-6.1"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}

// ── TaskRow ──

const INTERRUPTABLE_TASK_STATUSES = new Set(["queued", "active"]);

function TaskRow(props: {
  item: any;
  selectedTaskID: string;
  queuePos?: number;
  onSelectTask: (id: string) => void;
  onDeleteTask?: (id: string) => void;
  onCancelTask?: (id: string) => void;
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
  const isActive = () => !pending() && props.selectedTaskID === id();
  const badgeLabel = () => taskListBadge(props.item, props.queuePos);
  const canCancel = () =>
    !pending() && !!id() && !!props.onCancelTask && INTERRUPTABLE_TASK_STATUSES.has(status());
  const canDelete = () =>
    !pending() && !!id() && !!props.onDeleteTask;
  const hasActions = () => canCancel() || canDelete();
  const canDrag = () => props.canDrag === true && status() === "queued" && !pending();

  return (
    <div
      class="task-row-mini global-task-row"
      data-active={isActive() ? "true" : undefined}
      data-status={status()}
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
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M6 3h.01M10 3h.01M6 8h.01M10 8h.01M6 13h.01M10 13h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          </svg>
        </span>
      </Show>
      <button
        type="button"
        class="task-row-main"
        data-task-id={pending() ? undefined : id()}
        disabled={pending()}
        aria-disabled={pending() ? "true" : undefined}
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
          <small class="task-row-stamp">{taskListMeta(props.item)}</small>
        </div>
      </button>
      <Show when={hasActions()}>
        <div class="task-row-actions">
          <Show when={canCancel()}>
            <CancelButton id={id()} onCancel={props.onCancelTask!} />
          </Show>
          <Show when={canDelete()}>
            <DeleteButton id={id()} onDelete={props.onDeleteTask!} />
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ── TaskSection ──

function TaskSection(props: {
  label: string;
  items: any[];
  selectedTaskID: string;
  queuePositions?: Map<string, number>;
  onSelectTask: (id: string) => void;
  onDeleteTask?: (id: string) => void;
  onCancelTask?: (id: string) => void;
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
                selectedTaskID={props.selectedTaskID}
                queuePos={props.queuePositions?.get(item?.task?.id || "")}
                onSelectTask={props.onSelectTask}
                onDeleteTask={props.onDeleteTask}
                onCancelTask={props.onCancelTask}
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
  const sortedItems = createMemo<any[]>(() => visibleTasks());
  const [draggingID, setDraggingID] = createSignal("");
  const [dragOverID, setDragOverID] = createSignal("");

  // Queue positions mirror the backend's directory-scoped serial queue while
  // the UI still surfaces a unified task list.
  const queuePositions = createMemo<Map<string, number>>(() => {
    const queued = sortedItems()
      .filter((item) => item?.task?.status === "queued" && !item?._pending)
      .sort((a, b) => {
        const priorityDelta = priorityBucket(a) - priorityBucket(b);
        if (priorityDelta !== 0) return priorityDelta;
        const orderDelta = queueOrder(a) - queueOrder(b);
        if (orderDelta !== 0) return orderDelta;
        return (a?.task?.time?.created ?? 0) - (b?.task?.time?.created ?? 0);
      });
    const map = new Map<string, number>();
    queued.forEach((item, idx) => {
      const id = item?.task?.id;
      if (id) map.set(id, idx + 1);
    });
    return map;
  });

  // Group tasks by project directory. Active project first, then others by
  // most-recent activity. Within each project, active tasks precede recent.
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
      const updated = taskUpdated(item);
      if (updated > g.latest) g.latest = updated;
    }
    const activeDir = settingsStore.directory || "";
    return [...byDir.values()].map((group) => ({
      ...group,
      active: sortActiveItems(group.active),
    })).sort((a, b) => {
      if (a.directory === activeDir && b.directory !== activeDir) return -1;
      if (b.directory === activeDir && a.directory !== activeDir) return 1;
      return b.latest - a.latest;
    });
  });

  const selectedID = () => boardStore.selectedTaskID;
  const activeDir = () => settingsStore.directory || "";

  const [retrying, setRetrying] = createSignal(false);

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

  return (
    <div class="task-list-panel">
      <Show when={boardStore.tasksError}>
        <div class="task-list-error" role="alert">
          <div class="task-list-error-msg">
            {t("task.load_failed") || "Failed to load tasks"}: {boardStore.tasksError}
          </div>
          <button
            type="button"
            class="task-list-error-retry"
            disabled={retrying()}
            onClick={handleRetry}
          >
            {retrying() ? (t("common.loading") || "…") : (t("common.retry") || "Retry")}
          </button>
        </div>
      </Show>
      <Show
        when={sortedItems().length > 0}
        fallback={
          <Show when={!boardStore.tasksError}>
            <div class="empty-hint">{t("task.none")}</div>
          </Show>
        }
      >
        <For each={grouped()}>
          {(group) => {
            const label = projectLabel(group.directory);
            const isActiveProject = group.directory === activeDir();
            return (
              <section
                class="sidebar-list-group project-group"
                data-active-project={isActiveProject ? "true" : undefined}
              >
                <div class="project-group-heading" title={group.directory}>
                  <span class="project-group-name">{label.name}</span>
                  <Show when={label.parent}>
                    <span class="project-group-parent">{label.parent}</span>
                  </Show>
                </div>
                <Show when={group.active.length > 0}>
                  <TaskSection
                    label={t("task.group.active")}
                    items={group.active}
                    selectedTaskID={selectedID()}
                    queuePositions={queuePositions()}
                    onSelectTask={props.onSelectTask}
                    onDeleteTask={props.onDeleteTask}
                    onCancelTask={props.onCancelTask}
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
                    selectedTaskID={selectedID()}
                    onSelectTask={props.onSelectTask}
                    onDeleteTask={props.onDeleteTask}
                    onCancelTask={props.onCancelTask}
                  />
                </Show>
              </section>
            );
          }}
        </For>
      </Show>
    </div>
  );
}
