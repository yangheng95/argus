// ── TaskDetailOverlay (Phase 6) ──
// Full-screen drawer that slides in over the Gateway view when the user
// opens a task (via Gateway message chip or the TaskListPane).
//
// Composes the existing <Board> component to show the task's pipeline panels
// (workflow / requirements / architect / criteria / deliveries). Closing the
// overlay clears the hash and returns to Gateway.

import { Show, createEffect, createSignal } from "solid-js";
import { Board } from "./Board";
import { Conversation } from "./Conversation";
import { selectTask } from "../services/task";
import { boardStore,
  activeTaskID,
} from "../store/board";
import { t } from "../utils/i18n";
import { useHotkey } from "../solid/hotkey";

export interface TaskDetailOverlayProps {
  /** Task ID extracted from the route hash. Empty / undefined → hidden. */
  taskID: string;
  onClose: () => void;
}

export function TaskDetailOverlay(props: TaskDetailOverlayProps) {
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string>("");

  // Keep the overlay's state in sync with the selected board task: when
  // the route ID changes (or on first mount), drive selectTask so the rest
  // of the app (board, conversation, agent stream) follows.
  function loadActiveTask(id: string) {
    if (!id) return;
    setLoading(true);
    setError("");
    selectTask(id)
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[task-overlay] selectTask failed", e);
        setError(msg);
      })
      .finally(() => setLoading(false));
  }

  createEffect(() => {
    const id = props.taskID;
    if (!id) return;
    if (activeTaskID() === id) {
      setError("");
      return;
    }
    loadActiveTask(id);
  });

  useHotkey({ key: "Escape", target: "window", run: () => props.onClose() });

  return (
    <div class="task-overlay" role="dialog" aria-modal="true">
      <div class="task-overlay-header">
        <button
          type="button"
          class="task-overlay-back"
          onClick={props.onClose}
          title={t("task_overlay.back_title")}
        >
          ← {t("task_overlay.back")}
        </button>
        <div class="task-overlay-title">{t("task_overlay.task_label")} <code>{props.taskID}</code></div>
        <Show when={loading()}>
          <span class="task-overlay-loading">{t("common.loading")}</span>
        </Show>
        <Show when={error() && !loading()}>
          <span class="task-overlay-error" role="alert">
            <span class="task-overlay-error-msg">{t("task_overlay.load_failed", { error: error() })}</span>
            <button
              type="button"
              class="task-overlay-error-retry"
              onClick={() => loadActiveTask(props.taskID)}
            >
              {t("common.retry")}
            </button>
          </span>
        </Show>
      </div>
      <div class="task-overlay-body task-overlay-body-split">
        <div class="task-overlay-board">
          {/* Board renders the goals / pipeline panels for whatever task is
              selectedTaskID in the messageStore. selectTask above keeps the
              two in sync. */}
          <Board />
        </div>
        <ConversationPane />
      </div>
    </div>
  );
}

// Conversation needs a host container reference for autoscroll, but JSX ref
// runs after the parent mounts. Wrap it so the container resolves before the
// child component renders.
function ConversationPane() {
  const [host, setHost] = createSignal<HTMLDivElement>();
  return (
    <div class="task-overlay-conversation chat-scroll" ref={setHost}>
      <Show when={host()}>
        <Conversation container={host()!} />
      </Show>
    </div>
  );
}
