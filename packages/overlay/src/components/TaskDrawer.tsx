// ── TaskDrawer (Phase 6) ──
// Right-side task list shown alongside the Gateway main panel.
//
// Wraps the existing <TaskList> rendering (Active / Recent buckets,
// statuses, queue positions) with a cwd filter so only the current
// project's tasks appear. Click → push hash route #task/<id>; main.tsx
// renders TaskDetailOverlay on top.

import { Show } from "solid-js";
import { TaskList } from "./TaskList";
import { settingsStore } from "../store/settings";

export interface TaskDrawerProps {
  /** When true, drawer is collapsed to a thin strip; the main panel takes
   *  full width. Toggled by the Gateway view's collapse button. */
  collapsed?: boolean;
  onToggle?: () => void;
}

function selectTask(id: string) {
  // Same hash convention used by GatewayPanel's task-ref chips.
  window.location.hash = `task/${encodeURIComponent(id)}`;
}

export function TaskDrawer(props: TaskDrawerProps) {
  const cwd = () => settingsStore.directory ?? "";
  return (
    <aside
      class="task-drawer"
      data-collapsed={props.collapsed ? "true" : "false"}
      role="complementary"
      aria-label="Task list"
    >
      <div class="task-drawer-header">
        <div class="task-drawer-title">Tasks</div>
        <div class="task-drawer-cwd" title={cwd()}>
          {cwd().split(/[\\/]/).filter(Boolean).slice(-2).join("/") || "no project"}
        </div>
        <Show when={props.onToggle}>
          <button
            type="button"
            class="task-drawer-toggle"
            onClick={props.onToggle}
            title={props.collapsed ? "Expand" : "Collapse"}
          >
            {props.collapsed ? "›" : "‹"}
          </button>
        </Show>
      </div>
      <div class="task-drawer-body">
        {/* Existing TaskList already filters via boardStore.visibleTasks; the
            server-side board fetch is already cwd-scoped because it goes
            through Instance.provide({ directory }), so any task surfaced
            here belongs to the current cwd by construction. */}
        <TaskList onSelectTask={selectTask} />
      </div>
    </aside>
  );
}
