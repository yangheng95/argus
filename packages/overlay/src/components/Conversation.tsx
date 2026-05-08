import { For, Show, onMount, onCleanup, createSignal } from "solid-js";
import { Card } from "./Card";
import { TaskProgressBar } from "./TaskProgressBar";
import { cardTreeStore } from "../store/card-tree";
import { boardStore } from "../store/board";
import { t } from "../utils/i18n";
import { setupAutoScroll } from "../utils/dom-utils";

function clipText(value: string, limit = 96): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function compactPath(value: string): string {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 4) return normalized;
  return `.../${parts.slice(-3).join("/")}`;
}

function taskStatusLabel(status: string): string {
  const normalized = String(status || "idle").trim() || "idle";
  const key = `task.status.${normalized}`;
  const translated = t(key);
  return translated === key ? normalized : translated;
}

// ── Conversation Component ──
//
// Reads directly from `cardTreeStore`, the single reactive source of truth
// maintained by `services/tree-writer.ts`. Each top-level card id in
// `cardTreeStore.order` resolves to a CardNode via `cardTreeStore.cards[id]`;
// `<Card>` then walks the card's `childIDs` via the same proxy dereference,
// so targeted writes to any descendant update only that branch of the DOM.
// See specs/new-arch/07-panel-reactivity.md for the design rationale.

export function Conversation(props: { container: HTMLElement }) {
  const el = props.container;

  const hasItems = () => cardTreeStore.order.length > 0;

  const [tracking, setTracking] = createSignal(true);
  const currentTaskID = () => String(boardStore.selectedTaskID || boardStore.board?.task?.id || "");
  const taskContextItem = () => {
    const taskID = currentTaskID();
    const tasks = [...boardStore.tasks, ...boardStore.pendingTasks];
    if (taskID) {
      return tasks.find((item: any) => item?.task?.id === taskID || item?.id === taskID) || null;
    }
    return tasks[0] || null;
  };
  const taskContextID = () => {
    const item = taskContextItem();
    return currentTaskID() || String(item?.task?.id || item?.id || "");
  };
  const selectedTaskItem = () => {
    const taskID = currentTaskID();
    if (!taskID) return null;
    return (
      boardStore.tasks.find((item: any) => item?.task?.id === taskID)
      || boardStore.pendingTasks.find((item: any) => item?.task?.id === taskID || item?.id === taskID)
      || null
    );
  };
  const selectedBoardTask = () => boardStore.board?.task ?? null;
  const selectedTaskTitle = () => {
    const item = selectedTaskItem() || taskContextItem();
    return clipText(
      item?.task?.title
      || item?.overview?.headline
      || selectedBoardTask()?.title
      || currentTaskID(),
    );
  };
  const selectedTaskStatus = () => {
    const item = selectedTaskItem() || taskContextItem();
    if (item?._pending) return "active";
    return String(item?.task?.status || selectedBoardTask()?.status || "idle");
  };
  const selectedTaskDirectoryText = () => {
    const item = selectedTaskItem() || taskContextItem();
    return compactPath(item?.task?.directory || selectedBoardTask()?.directory || "");
  };

  onMount(() => {
    const c = setupAutoScroll(el, {
      isTracking: tracking,
      onUserScrollUp: () => setTracking(false),
    });
    const resumeTracking = () => {
      if (tracking()) return;
      const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
      if (distanceFromBottom <= 8) {
        setTracking(true);
      }
    };
    // Conversation is rendered directly into an existing `.chat-scroll`
    // host (see main.tsx and TaskDetailOverlay). Keeping the passive
    // listener on that host preserves `.chat-scroll > .card` layout and
    // browser scroll performance without introducing a wrapper element.
    el.addEventListener("scroll", resumeTracking, { passive: true });
    onCleanup(() => {
      el.removeEventListener("scroll", resumeTracking);
      c.cleanup();
    });
  });

  const emptyText = () => t("chat.empty");

  return (
    <>
      <TaskProgressBar />
      <Show when={!hasItems() && taskContextID()}>
        <div class="chat-empty chat-empty--task" data-status={selectedTaskStatus()}>
          <div class="chat-empty-marker" aria-hidden="true">
            <svg class="chat-empty-icon" width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect x="7" y="8" width="26" height="20" rx="3.5" stroke="currentColor" stroke-width="1.6" />
              <path d="M13 15h14M13 20h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              <path d="M10 31h20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.72" />
            </svg>
          </div>
          <div class="chat-empty-copy">
            <span class="chat-empty-kicker">{emptyText()}</span>
            <strong class="chat-empty-title">{selectedTaskTitle()}</strong>
            <div class="chat-empty-meta">
              <span class="chat-empty-status" data-status={selectedTaskStatus()}>{taskStatusLabel(selectedTaskStatus())}</span>
              <Show when={selectedTaskDirectoryText()}>
                <span class="chat-empty-path">{selectedTaskDirectoryText()}</span>
              </Show>
            </div>
          </div>
        </div>
      </Show>
      <Show when={!hasItems() && !taskContextID()}>
        <div class="chat-empty">
          <svg class="chat-empty-icon" width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <rect x="4" y="5" width="32" height="22" rx="3.5" stroke="currentColor" stroke-width="1.6"/>
            <path d="M4 27l7-6h22l7 6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            <path d="M13 15h14M13 19.5h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <span class="chat-empty-text">{emptyText()}</span>
        </div>
      </Show>
      <For each={cardTreeStore.order}>
        {(id) => (
          <Show when={cardTreeStore.cards[id]}>
            <Card node={cardTreeStore.cards[id]!} depth={0} />
          </Show>
        )}
      </For>
    </>
  );
}
