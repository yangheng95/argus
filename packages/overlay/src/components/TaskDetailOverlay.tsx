// ── TaskDetailOverlay (Phase 6) ──
// Full-screen drawer that slides in over the Gateway view when the user
// opens a task (via Gateway message chip or right-side TaskDrawer).
//
// Composes the existing <Board> component to show the task's pipeline panels
// (workflow / requirements / architect / criteria / deliveries). Closing the
// overlay clears the hash and returns to Gateway.

import { Show, createEffect, onCleanup, createSignal } from "solid-js";
import { Board } from "./Board";
import { selectTask } from "../services/task";
import { messageStore } from "../store/messages";

export interface TaskDetailOverlayProps {
  /** Task ID extracted from the route hash. Empty / undefined → hidden. */
  taskID: string;
  onClose: () => void;
}

export function TaskDetailOverlay(props: TaskDetailOverlayProps) {
  const [loading, setLoading] = createSignal(false);

  // Keep the overlay's state in sync with the underlying messageStore: when
  // the route ID changes (or on first mount), drive selectTask so the rest
  // of the app (board, conversation, agent stream) follows.
  createEffect(() => {
    const id = props.taskID;
    if (!id) return;
    if (messageStore.selectedTaskID === id) return;
    setLoading(true);
    selectTask(id)
      .catch((e) => console.warn("[task-overlay] selectTask failed", e))
      .finally(() => setLoading(false));
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") props.onClose();
  }
  window.addEventListener("keydown", onKey);
  onCleanup(() => window.removeEventListener("keydown", onKey));

  return (
    <div class="task-overlay" role="dialog" aria-modal="true">
      <div class="task-overlay-header">
        <button
          type="button"
          class="task-overlay-back"
          onClick={props.onClose}
          title="Back to Gateway (Esc)"
        >
          ← Gateway
        </button>
        <div class="task-overlay-title">Task <code>{props.taskID}</code></div>
        <Show when={loading()}>
          <span class="task-overlay-loading">loading…</span>
        </Show>
      </div>
      <div class="task-overlay-body">
        {/* Board renders the goals / pipeline panels for whatever task is
            selectedTaskID in the messageStore. selectTask above keeps the
            two in sync. */}
        <Board />
      </div>
    </div>
  );
}
