// ── ExecutorSelector ──
// Compact executor + per-executor model picker that lives at the bottom-left
// of the chat composer (chat-compose-meta-left). Replaces the imperative
// engine-bar + #codexModelPanel/#claudeCodeModelPanel block in index.html
// + main.tsx's getElementById click delegation.
//
// State is unchanged (rule 22 single source):
//   - selected executor → settingsStore.executor (persisted via saveSettings)
//   - per-executor model → backend via setExecutorModel(...) → reloads
//     appStore.executors which surfaces the new model on the chip.
//
// Dropdown opens upward (composer is near viewport bottom). All DOM is
// JSX; outside-click + Escape close handlers attached at component scope
// with onCleanup so HMR / unmount disposes them cleanly.

import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { appStore } from "../store/app";
import { settingsStore, setSettingsStore, saveSettings, sanitizeExecutor } from "../store/settings";
import {
  executorCurrentModel,
  executorHasModelChoice,
  executorLabel,
  executorModels,
  executorSelectable,
  executorTitle,
  setExecutorModel,
  type ExecutorDescriptor,
} from "../services/executor";
import { t } from "../utils/i18n";

// MirrorCode is the internal/orchestrator executor — its "model" is the
// project default LLM (appStore.config.model) which drives planning +
// evaluation. External executors (codex / claude-code) carry their own
// model that does the actual editing. iter35 surfaces both in the chip
// when an external executor is active so the operator can see at a glance
// what's planning and what's editing.
function projectModelFromConfig(): string {
  const cfg = appStore.config as { model?: unknown } | null | undefined
  return typeof cfg?.model === "string" ? cfg.model : ""
}

const INTERNAL_EXECUTOR_ID = "mirrorcode"

export function ExecutorSelector() {
  const [open, setOpen] = createSignal(false);

  // Chip renders from settingsStore after the same executor-id validation
  // used by task submission. The menu still iterates appStore.executors
  // directly — whatever the backend reported from /executor.
  const activeID = createMemo(() => sanitizeExecutor(settingsStore.executor));
  const executors = createMemo(() => appStore.executors as ExecutorDescriptor[]);
  const activeLabel = createMemo(() => executorLabel(activeID()));
  const activeModel = createMemo(() => executorCurrentModel(activeID()));

  // iter50: user feedback (2026-05-03) "永远同时显示全局 LLM
  // 和内外部外部执行器的 LLM". Both model segments now ALWAYS
  // render — no more conditional based on executor type.
  //
  // - Global LLM = appStore.config.model (orchestrator-side
  //   model that drives planning + evaluation regardless of
  //   which executor edits the files).
  // - Executor LLM = the active executor's own model. For
  //   external executors (codex / claude-code) this is
  //   `executorCurrentModel(id)`. For the internal MirrorCode
  //   executor, mirrorcode follows the project config so the
  //   executor LLM == global LLM (same value rendered in both
  //   slots — visually consistent layout, semantically honest).
  const orchestratorModel = createMemo(projectModelFromConfig)
  const isExternalExecutor = createMemo(() => activeID() !== INTERNAL_EXECUTOR_ID)
  const executorModel = createMemo(() =>
    isExternalExecutor() ? activeModel() : orchestratorModel(),
  )

  // Tooltip always names both models. The pair explainer reads
  // naturally even when the two values are equal (mirrorcode case).
  const chipTitle = createMemo(() => {
    const orch = orchestratorModel() || t("agent_models.option_not_set")
    const exec = executorModel() || t("agent_models.option_not_set")
    const pair = t("executor.model_explainer_pair", {
      orchestrator: orch,
      executor: activeLabel(),
      external: exec,
    })
    return [executorTitle(activeID()), pair].filter(Boolean).join("\n")
  })

  let rootRef: HTMLDivElement | undefined;

  const onDocClick = (event: MouseEvent) => {
    if (!open()) return;
    const target = event.target as Node | null;
    if (rootRef && target && rootRef.contains(target)) return;
    setOpen(false);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open()) setOpen(false);
  };
  if (typeof document !== "undefined") {
    document.addEventListener("click", onDocClick, { capture: true });
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("click", onDocClick, { capture: true });
      document.removeEventListener("keydown", onKey);
    });
  }

  function pickExecutor(id: string) {
    if (!executorSelectable(id)) return;
    if (id !== activeID()) {
      setSettingsStore("executor", sanitizeExecutor(id));
      saveSettings();
    }
    if (!executorHasModelChoice(id)) setOpen(false);
  }

  async function pickModel(executorID: string, model: string) {
    setOpen(false);
    if (executorID !== activeID()) {
      setSettingsStore("executor", sanitizeExecutor(executorID));
      saveSettings();
    }
    await setExecutorModel(executorID, model);
  }

  return (
    // Chip is always rendered: activeID comes from settingsStore (never
    // empty, defaults to the MirrorCode executor id ("mirrorcode")) and
    // executorLabel handles the three
    // known ids without any backend round-trip. The menu body shows
    // whatever appStore.executors holds — empty during the brief
    // cold-start gap before loadExecutors() resolves, full afterwards.
    <div
      class="executor-selector"
      data-open={open() ? "true" : "false"}
      ref={(el) => (rootRef = el)}
    >
        <button
          type="button"
          class="executor-chip"
          data-active="true"
          data-has-external="true"
          aria-haspopup="listbox"
          aria-expanded={open() ? "true" : "false"}
          title={chipTitle()}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
        >
          <span class="executor-chip-label">{activeLabel()}</span>
          {/* iter50: BOTH model slots ALWAYS render — global LLM
              (orchestrator-side, drives planning) + executor LLM
              (active executor's editing model). MirrorCode active
              follows project config so executor LLM == global LLM
              (intentional visual consistency — same layout regardless
              of which executor is selected). External executors carry
              their own model that diverges from the global. */}
          <span class="executor-chip-sep" aria-hidden="true">G</span>
          <span
            class="executor-chip-model"
            data-source="orchestrator"
            data-empty={orchestratorModel() ? "false" : "true"}
            title={t("executor.model_explainer_internal")}
          >
            {orchestratorModel() || t("agent_models.option_not_set")}
          </span>
          <span class="executor-chip-sep" aria-hidden="true">E</span>
          <span
            class="executor-chip-model"
            data-source="executor"
            data-empty={executorModel() ? "false" : "true"}
            title={t("executor.model_explainer_external", {
              executor: activeLabel(),
            })}
          >
            {executorModel() || t("agent_models.option_not_set")}
          </span>
          <span class="executor-chip-caret" aria-hidden="true">
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
              <path
                d="M2 6.5L5 3.5L8 6.5"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
        </button>

        <Show when={open()}>
          <div class="executor-menu" role="listbox" aria-label={t("executor.group")}>
            <For each={executors()}>
              {(item) => {
                const id = item.id;
                const selectable = createMemo(() => executorSelectable(id));
                const isActive = createMemo(() => id === activeID());
                const hasModels = createMemo(() => executorHasModelChoice(id));
                const models = createMemo(() => (hasModels() ? executorModels(id) : []));
                const current = createMemo(() => executorCurrentModel(id));
                return (
                  <div
                    class="executor-menu-group"
                    data-active={isActive() ? "true" : "false"}
                    data-selectable={selectable() ? "true" : "false"}
                  >
                    <button
                      type="button"
                      class="executor-menu-row"
                      role="option"
                      aria-selected={isActive() ? "true" : "false"}
                      disabled={!selectable()}
                      title={executorTitle(id)}
                      onClick={() => pickExecutor(id)}
                    >
                      <span class="executor-menu-label">
                        {item.label || executorLabel(id)}
                      </span>
                      <Show when={current()}>
                        <span class="executor-menu-current">{current()}</span>
                      </Show>
                    </button>
                    <Show when={isActive() && hasModels() && models().length > 0}>
                      <div class="executor-menu-models">
                        <For each={models()}>
                          {(modelID) => (
                            <button
                              type="button"
                              class="executor-menu-model"
                              data-active={modelID === current() ? "true" : "false"}
                              onClick={() => void pickModel(id, modelID)}
                            >
                              {modelID}
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
  );
}
