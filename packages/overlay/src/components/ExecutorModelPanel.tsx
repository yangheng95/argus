// ── ExecutorModelPanel Component ──
// Solid.js port of renderExecutorModelPanel / openExecutorModelPanel /
// closeAllExecutorModelPanels / setExecutorModel from app.js.
// Shows a floating dropdown of known models for a given executor (codex / claude-code).

import { createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { apiJson } from "../services/api";
import { t } from "../utils/i18n";

// ── Known models (mirrors EXECUTOR_KNOWN_MODELS in app.js) ──

const EXECUTOR_KNOWN_MODELS: Record<string, string[]> = {
  codex: [
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex",
    "gpt-5.2-codex",
    "gpt-5.2",
    "gpt-5.1-codex-max",
    "gpt-5.1-codex-mini",
  ],
  "claude-code": [
    "claude-sonnet-4-6",
    "claude-opus-4-6",
    "claude-haiku-4-5-20251001",
  ],
};

// ── Types ──

export interface ExecutorModelPanelProps {
  /** The executor ID — currently "codex" or "claude-code". */
  executorID: string;
  /** The model currently active on this executor (may be empty string). */
  currentModel: string;
  /** Whether the panel is visible. */
  open: boolean;
  /** Position override — top/left in px, set by the caller after measuring the caret button. */
  top?: number;
  left?: number;
  /** Called when the user picks a model. */
  onSelect: (model: string) => void;
  /** Called when the panel should close (e.g. Escape, outside click). */
  onClose: () => void;
}

// ── Component ──

export function ExecutorModelPanel(props: ExecutorModelPanelProps) {
  const knownModels = () => EXECUTOR_KNOWN_MODELS[props.executorID] ?? [];

  // Close on Escape key
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") props.onClose();
  }

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });
  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <Show when={props.open}>
      <div
        class="engine-model-panel"
        style={{
          position: "fixed",
          top: props.top !== undefined ? `${props.top}px` : undefined,
          left: props.left !== undefined ? `${props.left}px` : undefined,
          transform: "translateX(-50%)",
          "z-index": "1000",
        }}
        role="listbox"
        aria-label={t("model_picker.select")}
      >
        <Show when={!!props.currentModel}>
          <div class="engine-model-current">
            {t("executor.current_model")}:{" "}
            <strong>{props.currentModel}</strong>
          </div>
        </Show>
        <For each={knownModels()}>
          {(mid) => (
            <button
              type="button"
              class="engine-model-item"
              data-executor-model={mid}
              data-active={mid === props.currentModel ? "true" : "false"}
              role="option"
              aria-selected={mid === props.currentModel}
              onClick={() => props.onSelect(mid)}
            >
              {mid}
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}

// ── Controlled wrapper with async model-set logic ──

export interface ExecutorModelPanelControllerProps {
  /** Executor ID — "codex" | "claude-code". */
  executorID: string;
  /** Current model for this executor (read from executor info). */
  currentModel: string;
  /**
   * Whether the panel is open — caller controls open/close by passing a
   * boolean signal value.
   */
  open: boolean;
  /** Pixel coordinates for positioning the panel under the caret button. */
  top?: number;
  left?: number;
  /**
   * Called after a model is successfully patched via the API, so the caller
   * can refresh its executor list.
   */
  onModelChanged: () => void;
  /** Notify the caller to close the panel. */
  onClose: () => void;
}

export function ExecutorModelPanelController(
  props: ExecutorModelPanelControllerProps,
) {
  async function handleSelect(model: string) {
    try {
      await apiJson(
        `executor/${encodeURIComponent(props.executorID)}/model`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model }),
        },
      );
      props.onModelChanged();
    } catch (e) {
      console.error(
        "[ExecutorModelPanel] Failed to set executor model",
        props.executorID,
        model,
        e,
      );
    }
    props.onClose();
  }

  return (
    <ExecutorModelPanel
      executorID={props.executorID}
      currentModel={props.currentModel}
      open={props.open}
      top={props.top}
      left={props.left}
      onSelect={handleSelect}
      onClose={props.onClose}
    />
  );
}
