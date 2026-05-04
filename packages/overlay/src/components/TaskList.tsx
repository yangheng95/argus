// ── TaskList Component ──
// Solid.js port of renderTaskList / taskSection / taskRow / visibleTasks
// Displays active and recently-completed tasks from boardStore.

import { createMemo, createSelector, createSignal, onCleanup, For, Show } from "solid-js";
import { boardStore, visibleTasks, loadTasks } from "../store/board";
import { settingsStore } from "../store/settings";
import { reorderTaskQueue } from "../services/task-queue";
import { exportTaskArchive, importTaskArchive } from "../services/task-archive";
import { t } from "../utils/i18n";
import { stamp, fullStampWithRelative } from "../utils/time";
import { Icon } from "./Icon";

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
        <Icon name="close" size={11} />
      </span>
      <span class="task-row-delete-icon" data-icon="confirm" aria-hidden="true">
        <Icon name="check" size={11} />
      </span>
    </button>
  );
}

// ── ExportButton (single-click, no confirm) ──
// Exporting is non-destructive — bytes flow OUT only — so unlike
// cancel/delete we don't gate it behind a two-step confirm. The button is
// visible on every task that has a directory; failures surface via
// alert() for now (matches the rest of TaskList's error-surfacing style).

function ExportButton(props: { id: string; directory?: string }) {
  const [busy, setBusy] = createSignal(false);
  return (
    <button
      type="button"
      class="task-row-export"
      data-task-export={props.id}
      data-busy={busy() ? "true" : undefined}
      disabled={busy()}
      title={t("task.export_button_title")}
      aria-label={t("task.export_button_title")}
      onClick={async (e) => {
        e.stopPropagation();
        if (busy()) return;
        setBusy(true);
        try {
          await exportTaskArchive({ taskID: props.id, directory: props.directory });
        } catch (err) {
          window.alert(
            t("task.export_failed", { error: err instanceof Error ? err.message : String(err) }),
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon name="download" size={11} />
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
        <Icon name="stop" size={11} />
      </span>
      <span class="task-row-cancel-icon" data-icon="confirm" aria-hidden="true">
        <Icon name="check" size={11} />
      </span>
    </button>
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
  const badgeLabel = () => taskListBadge(props.item, props.queuePos);
  const canCancel = () =>
    !pending() && !!id() && !!props.onCancelTask && INTERRUPTABLE_TASK_STATUSES.has(status());
  const canDelete = () =>
    !pending() && !!id() && !!props.onDeleteTask;
  // Export is offered for any persisted task — no status gate (you can
  // archive a completed/failed/cancelled task, that's the typical case).
  const canExport = () => !pending() && !!id();
  const directory = () =>
    typeof props.item?.task?.directory === "string" ? props.item.task.directory : undefined;
  const hasActions = () => canCancel() || canDelete() || canExport();
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
          title={fullStampWithRelative(taskUpdated(props.item))}
        >{taskListMeta(props.item)}</small>
        <Show when={hasActions()}>
          <div class="task-row-actions">
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

  // createSelector returns a function that's true only for the currently
  // selected task id. With this in place, selecting a different task
  // re-runs the `isActive` memo on exactly two rows (previously selected,
  // newly selected) instead of all N rows in the list. Wins scale with N.
  const isSelected = createSelector(() => boardStore.selectedTaskID);
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

  let importInputEl: HTMLInputElement | undefined;
  const [importing, setImporting] = createSignal(false);

  async function handleImportFile(file: File) {
    const directory = settingsStore.directory || "";
    if (!directory) {
      window.alert(t("task.import_no_directory"));
      return;
    }
    setImporting(true);
    try {
      const result = await importTaskArchive({ file, directory, overwrite: true });
      window.alert(
        t("task.import_done", {
          restored: String(result.restoredFiles),
          skipped: String(result.skippedFiles.length),
        }),
      );
      await loadTasks();
    } catch (err) {
      window.alert(
        t("task.import_failed", { error: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <div class="task-list-panel">
      <div class="task-list-toolbar">
        <button
          type="button"
          class="task-list-import-button"
          data-task-import
          disabled={importing()}
          title={t("task.import_button_title")}
          aria-label={t("task.import_button_title")}
          onClick={() => importInputEl?.click()}
        >
          <Icon name="upload" size={11} />
          <span class="task-list-import-button-text">{t("task.import_button")}</span>
        </button>
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
            <button
              type="button"
              class="task-list-search-clear"
              onClick={() => setSearchQuery("")}
              title={t("common.clear")}
              aria-label={t("common.clear")}
            >
              <Icon name="close" />
            </button>
          </Show>
        </div>
      </Show>
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
                    isSelected={isSelected}
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
                    isSelected={isSelected}
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
