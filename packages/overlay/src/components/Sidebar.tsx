// ── Sidebar Component ──
// Solid.js port of renderSidebar / renderTaskList from app.js.
// Renders the left-side task navigation panel including the header toolbar
// (refresh, collapse, new-task buttons) and the scrollable task list.

import { createMemo, Show } from "solid-js";
import { boardStore } from "../store/board";
import { settingsStore } from "../store/settings";
import { t } from "../utils/i18n";
import { TaskList } from "./TaskList";

// ── Sidebar ──

export interface SidebarProps {
  /** Called when the user clicks the collapse/expand toggle button. */
  onToggleCollapse: () => void;
  /** Called when the user clicks the "Refresh" button. */
  onRefresh: () => void;
  /** Called when the user clicks the "New Task" button. */
  onCreateTask: () => void;
  /** Called when the user selects a task row. */
  onSelectTask: (taskID: string) => void;
  /** Called when the user clicks the delete button on a task row. */
  onDeleteTask?: (taskID: string) => void;
}

export function Sidebar(props: SidebarProps) {
  const collapsed = () => settingsStore.sidebarCollapsed;

  const toggleLabel = createMemo(() =>
    collapsed() ? t("sidebar.open") : t("sidebar.close"),
  );

  return (
    <aside
      class="sidebar"
      id="sidebar"
      data-collapsed={collapsed() ? "true" : "false"}
    >
      {/* ── Header ── */}
      <div class="sidebar-header">
        <div class="sidebar-copy">
          <div class="sidebar-title">{t("sidebar.title")}</div>
          <div class="sidebar-subtitle" id="sidebarSubtitle">
            {t("sidebar.subtitle")}
          </div>
        </div>

        <div
          class="sidebar-header-actions"
          role="toolbar"
          aria-label={t("sidebar.subtitle")}
        >
          <div class="sidebar-toolset">
            {/* Refresh button */}
            <button
              type="button"
              class="sidebar-tool"
              id="btnRefreshTasks"
              title={t("common.refresh")}
              aria-label={t("common.refresh")}
              onClick={props.onRefresh}
            >
              <span class="sidebar-btn-icon" aria-hidden="true">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                >
                  <path
                    d="M13 4.5V8h-3.5"
                    stroke="currentColor"
                    stroke-width="1.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M12.6 8A5 5 0 103.8 10.5"
                    stroke="currentColor"
                    stroke-width="1.2"
                    stroke-linecap="round"
                  />
                </svg>
              </span>
            </button>

            {/* Collapse/expand toggle */}
            <button
              type="button"
              class="sidebar-tool sidebar-toggle"
              id="btnSidebarToggle"
              title={toggleLabel()}
              aria-label={toggleLabel()}
              onClick={props.onToggleCollapse}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M10.5 3.5L5.5 8l5 4.5"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </div>

          {/* New Task button */}
          <button
            type="button"
            class="sidebar-btn sidebar-btn-primary"
            id="btnCreateTask"
            title={t("task.new")}
            aria-label={t("task.new")}
            onClick={props.onCreateTask}
          >
            <span class="sidebar-btn-icon" aria-hidden="true">
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
              >
                <path
                  d="M8 3v10M3 8h10"
                  stroke="currentColor"
                  stroke-width="1.3"
                  stroke-linecap="round"
                />
              </svg>
            </span>
            <span class="sidebar-btn-label">{t("task.new")}</span>
          </button>
        </div>
      </div>

      {/* ── Body: task list ── */}
      <div class="sidebar-body">
        <div
          class="sidebar-list session-list-panel sidebar-session-list"
          id="taskListPanel"
        >
          <TaskList
            onSelectTask={props.onSelectTask}
            onDeleteTask={props.onDeleteTask}
          />
        </div>
      </div>
    </aside>
  );
}
