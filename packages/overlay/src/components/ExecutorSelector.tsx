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

  // Project default model — drives the MirrorCode side. Always shown in the
  // chip as long as the project has a default configured. Reads the same
  // appStore.config.model that AgentModelsPanel writes to (no two-source
  // drift; SSE config.changed refreshes both).
  const orchestratorModel = createMemo(projectModelFromConfig)
  const isExternalExecutor = createMemo(() => activeID() !== INTERNAL_EXECUTOR_ID)
  const externalExecutorModel = createMemo(() =>
    isExternalExecutor() ? activeModel() : "",
  )

  // Multi-line tooltip explaining the role of each model. iter41
  // follow-up: always include the explainer (was previously gated on
  // the model being non-empty, which collapsed the title down to just
  // the executor's auth/version line and gave the user no help when
  // the project default model was unset — exactly when the explainer
  // is most useful).
  const chipTitle = createMemo(() => {
    const orch = orchestratorModel() || t("agent_models.option_not_set")
    if (!isExternalExecutor()) {
      // Pure MirrorCode mode: executorTitle (auth / version / setup
      // hints) + the orchestrator-model explainer.
      return [executorTitle(activeID()), t("executor.model_explainer_internal")]
        .filter(Boolean)
        .join("\n")
    }
    // External executor: pair explainer with both model values populated.
    const ext = externalExecutorModel() || t("agent_models.option_not_set")
    const pair = t("executor.model_explainer_pair", {
      orchestrator: orch,
      executor: activeLabel(),
      external: ext,
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
          data-has-external={isExternalExecutor() ? "true" : "false"}
          aria-haspopup="listbox"
          aria-expanded={open() ? "true" : "false"}
          title={chipTitle()}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
        >
          <span class="executor-chip-label">{activeLabel()}</span>
          {/* Orchestrator (MirrorCode) model — ALWAYS rendered.
              iter41 unwrapped the iter35 conditional that gated this
              span on a non-empty orchestratorModel value: when the
              project default was unset the chip collapsed to bare
              "MirrorCode" and the user couldn't tell iter35 had ever
              shipped. The empty case now renders the i18n placeholder
              ("— not set —", same vocabulary AgentModelsPanel uses)
              plus a `[data-empty="true"]` attribute so CSS + regression
              tests can pin the empty state without re-introducing a
              gating wrap. */}
          <span class="executor-chip-sep" aria-hidden="true">·</span>
          <span
            class="executor-chip-model"
            data-source="orchestrator"
            data-empty={orchestratorModel() ? "false" : "true"}
            title={t("executor.model_explainer_internal")}
          >
            {orchestratorModel() || t("agent_models.option_not_set")}
          </span>
          {/* External executor model — only rendered when the active
              executor is external (codex / claude-code). The arrow
              communicates the orchestrator → executor handoff. */}
          <Show when={isExternalExecutor() && externalExecutorModel()}>
            <span class="executor-chip-arrow" aria-hidden="true">→</span>
            <span
              class="executor-chip-model"
              data-source="external"
              title={t("executor.model_explainer_external", {
                executor: activeLabel(),
              })}
            >
              {externalExecutorModel()}
            </span>
          </Show>
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
