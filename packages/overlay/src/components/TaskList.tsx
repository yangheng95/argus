// ── TaskList Component ──
// Solid.js port of renderTaskList / taskSection / taskRow / visibleTasks
// Displays active and recently-completed tasks from boardStore.

import { createMemo, For, Show } from "solid-js";
import { boardStore, visibleTasks } from "../store/board";
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
  return joinBullet([stamp(taskUpdated(item)), shortPath(item?.task?.directory || "")]);
}

// ── DeleteButton (SVG) ──

function DeleteButton(props: { id: string; onDelete: (id: string) => void }) {
  return (
    <button
      type="button"
      class="task-row-delete"
      data-task-delete={props.id}
      title={t("task.delete_button_title")}
      aria-label={t("task.delete_button_title")}
      onClick={(e) => {
        e.stopPropagation();
        props.onDelete(props.id);
      }}
    >
      <span class="task-row-delete-icon" data-icon="delete" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M3.5 4.5h9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          <path
            d="M6 4.5V3.6c0-.5.4-.9.9-.9h2.2c.5 0 .9.4.9.9v.9"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
          />
          <path
            d="M5.2 6.2l.4 5.4c0 .5.4.9.9.9h2.9c.5 0 .9-.4.9-.9l.4-5.4"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
          />
        </svg>
      </span>
    </button>
  );
}

// ── TaskRow ──

function TaskRow(props: {
  item: any;
  selectedTaskID: string;
  queuePos?: number;
  onSelectTask: (id: string) => void;
  onDeleteTask?: (id: string) => void;
}) {
  const id = () => props.item?.task?.id || "";
  const pending = () => props.item?._pending === true;
  const status = () => (pending() ? "active" : props.item?.task?.status || "idle");
  const title = () => taskListTitle(props.item) || id();
  const isActive = () => !pending() && props.selectedTaskID === id();

  return (
    <div
      class="task-row-mini global-task-row"
      data-active={isActive() ? "true" : undefined}
      title={title()}
    >
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
          <span class="status-dot" data-status={status()} aria-hidden="true" />
          <strong>{title()}</strong>
        </div>
        <span class="task-row-badge" aria-live="polite" aria-atomic="true">
          {taskListBadge(props.item, props.queuePos)}
        </span>
        <small>{taskListMeta(props.item)}</small>
      </button>
      <Show when={!!id() && !!props.onDeleteTask}>
        <DeleteButton id={id()} onDelete={props.onDeleteTask!} />
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
  /** Optional: called when the user clicks the delete button on a task row. */
  onDeleteTask?: (taskID: string) => void;
}

export function TaskList(props: TaskListProps) {
  const sortedItems = createMemo<any[]>(() => visibleTasks());

  const activeTasks = createMemo(() =>
    sortedItems().filter((item) => !COMPLETED_STATUSES.has(item?.task?.status || "")),
  );

  const recentTasks = createMemo(() =>
    sortedItems().filter((item) => COMPLETED_STATUSES.has(item?.task?.status || "")),
  );

  // Compute queue positions for "queued" tasks: sort by priority (high=0,normal=1,low=2)
  // then by creation time (FIFO), assign 1-based position numbers.
  const queuePositions = createMemo<Map<string, number>>(() => {
    const PRIORITY_ORDER: Record<string, number> = { high: 0, normal: 1, low: 2 };
    const queued = sortedItems()
      .filter((item) => item?.task?.status === "queued" && !item?._pending)
      .sort((a, b) => {
        const pa = PRIORITY_ORDER[a?.task?.priority ?? "normal"] ?? 1;
        const pb = PRIORITY_ORDER[b?.task?.priority ?? "normal"] ?? 1;
        if (pa !== pb) return pa - pb;
        return (a?.task?.time?.created ?? 0) - (b?.task?.time?.created ?? 0);
      });
    const map = new Map<string, number>();
    queued.forEach((item, idx) => {
      const id = item?.task?.id;
      if (id) map.set(id, idx + 1);
    });
    return map;
  });

  const selectedID = () => boardStore.selectedTaskID;

  return (
    <div class="task-list-panel">
      <Show
        when={sortedItems().length > 0}
        fallback={<div class="empty-hint">{t("task.none")}</div>}
      >
        <TaskSection
          label={t("task.group.active")}
          items={activeTasks()}
          selectedTaskID={selectedID()}
          queuePositions={queuePositions()}
          onSelectTask={props.onSelectTask}
          onDeleteTask={props.onDeleteTask}
        />
        <TaskSection
          label={t("task.group.recent")}
          items={recentTasks()}
          selectedTaskID={selectedID()}
          onSelectTask={props.onSelectTask}
          onDeleteTask={props.onDeleteTask}
        />
      </Show>
    </div>
  );
}
