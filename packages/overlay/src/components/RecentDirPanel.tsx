// ── RecentDirPanel Component ──
// Solid.js port of renderRecentDirPanel / openRecentDirPanel /
// closeRecentDirPanel from app.js.
// Shows a floating list of recently-used directories so the user can
// quickly switch context.

import { createSignal, createMemo, For, Show, onMount, onCleanup } from "solid-js";
import { t } from "../utils/i18n";

// ── localStorage key (mirrors app.js RECENT_DIRS_KEY) ──

const RECENT_DIRS_KEY = "oc_recent_directories";

// ── Helpers ──

function loadRecentDirectories(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_DIRS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((d) => typeof d === "string" && d.trim())
      : [];
  } catch {
    return [];
  }
}

function shortPath(p: string): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.length > 3 ? ".../" + parts.slice(-3).join("/") : p;
}

// ── RecentDirPanel ──

export interface RecentDirPanelProps {
  /** Whether the panel is visible. */
  open: boolean;
  /** The currently active directory — used to highlight the active item. */
  currentDir: string;
  /**
   * Pixel position for the panel (set by the caller after measuring the
   * history button in the directory breadcrumb).
   */
  top?: number;
  left?: number;
  /** Called when the user selects a directory. */
  onSelect: (dir: string) => void;
  /** Called when the panel should close. */
  onClose: () => void;
}

export function RecentDirPanel(props: RecentDirPanelProps) {
  // Re-read localStorage every time the panel opens so the list is fresh.
  const dirs = createMemo(() => (props.open ? loadRecentDirectories() : []));

  // Close on Escape
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") props.onClose();
  }

  onMount(() => document.addEventListener("keydown", handleKeyDown));
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown));

  return (
    <Show when={props.open}>
      <div
        class="recent-dir-panel"
        style={{
          position: "fixed",
          top: props.top !== undefined ? `${props.top}px` : undefined,
          left: props.left !== undefined ? `${props.left}px` : undefined,
          "z-index": "1000",
        }}
        role="listbox"
        aria-label={t("cwd.recent")}
      >
        <Show
          when={dirs().length > 0}
          fallback={
            <div class="recent-dir-empty">{t("cwd.recent_empty")}</div>
          }
        >
          <For each={dirs()}>
            {(dir) => {
              const isActive = () =>
                !!props.currentDir &&
                dir.toLowerCase() === props.currentDir.toLowerCase();
              return (
                <button
                  type="button"
                  class="recent-dir-item"
                  data-recent-dir={dir}
                  data-active={isActive() ? "true" : "false"}
                  role="option"
                  aria-selected={isActive()}
                  title={dir}
                  onClick={() => {
                    props.onSelect(dir);
                    props.onClose();
                  }}
                >
                  {shortPath(dir)}
                </button>
              );
            }}
          </For>
        </Show>
      </div>
    </Show>
  );
}
