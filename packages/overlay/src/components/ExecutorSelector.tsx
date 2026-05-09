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
import { useHotkey } from "../solid/hotkey";
import { appStore } from "../store/app";
import { settingsStore, setSettingsStore, saveSettings, sanitizeExecutor } from "../store/settings";
import { Icon } from "./Icon";
import { useDisclosure } from "../solid/disclosure";
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
import { Button } from "./ui/Button";

interface ModelParts {
  provider: string;
  name: string;
}

// MirrorCode is the internal/orchestrator executor. Its model is the
// project default model from appStore.config.model, used for planning and
// evaluation. External executors carry their own editing model.
function projectModelFromConfig(): string {
  const cfg = appStore.config as { model?: unknown } | null | undefined
  return typeof cfg?.model === "string" ? cfg.model : ""
}

const INTERNAL_EXECUTOR_ID = "mirrorcode"

function splitModelID(modelID: string): ModelParts {
  const trimmed = modelID.trim();
  if (!trimmed) return { provider: "", name: "" };
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    return { provider: "", name: trimmed };
  }
  return {
    provider: trimmed.slice(0, slash),
    name: trimmed.slice(slash + 1),
  };
}

export function ExecutorSelector() {
  const menu = useDisclosure();

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
  const sameModel = createMemo(() =>
    !!orchestratorModel() && orchestratorModel() === executorModel(),
  )
  const orchestratorParts = createMemo(() => splitModelID(orchestratorModel()))
  const executorParts = createMemo(() => splitModelID(executorModel()))
  const executorModelText = createMemo(() =>
    sameModel() ? t("executor.same_as_plan") : executorModel(),
  )

  // Tooltip always names both models. The pair explainer reads
  // naturally even when the two values are equal (mirrorcode case).
  const chipTitle = createMemo(() => {
    const orch = orchestratorModel() || t("agent_models.option_not_set")
    const exec = executorModelText() || t("agent_models.option_not_set")
    const pair = t("executor.model_explainer_pair", {
      orchestrator: orch,
      executor: activeLabel(),
      external: exec,
    })
    return [executorTitle(activeID()), pair].filter(Boolean).join("\n")
  })
  const chipAriaLabel = createMemo(() => {
    const orch = orchestratorModel() || t("agent_models.option_not_set")
    const exec = executorModelText() || t("agent_models.option_not_set")
    return `${activeLabel()}: ${t("executor.role_plan")} ${orch}; ${t("executor.role_edit")} ${exec}. ${t("executor.change_model")}`
  })

  let rootRef: HTMLDivElement | undefined;

  const onDocClick = (event: MouseEvent) => {
    if (!menu.open()) return;
    const target = event.target as Node | null;
    if (rootRef && target && rootRef.contains(target)) return;
    menu.close();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("click", onDocClick, { capture: true });
    onCleanup(() => document.removeEventListener("click", onDocClick, { capture: true }));
  }
  useHotkey({ key: "Escape", when: () => menu.open(), run: () => menu.close() })

  function pickExecutor(id: string) {
    if (!executorSelectable(id)) return;
    if (id !== activeID()) {
      setSettingsStore("executor", sanitizeExecutor(id));
      saveSettings();
    }
    if (!executorHasModelChoice(id)) menu.close();
  }

  async function pickModel(executorID: string, model: string) {
    menu.close();
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
      data-open={menu.open() ? "true" : "false"}
      ref={(el) => (rootRef = el)}
    >
        <Button
          type="button"
          variant="outline"
          size="sm"
          tone="neutral"
          data-ui="executor-chip"
          data-active="true"
          data-has-external="true"
          aria-haspopup="listbox"
          aria-expanded={menu.open() ? "true" : "false"}
          title={chipTitle()}
          aria-label={chipAriaLabel()}
          onClick={(event) => {
            event.stopPropagation();
            menu.toggle();
          }}
        >
          <span class="executor-chip-identity">
            <span class="executor-chip-label">{activeLabel()}</span>
            <span class="executor-chip-action">{t("executor.change_model")}</span>
          </span>
          <span class="executor-chip-models" aria-hidden="true">
            <span
              class="executor-chip-model"
              data-source="orchestrator"
              data-empty={orchestratorModel() ? "false" : "true"}
              title={t("executor.model_explainer_internal")}
            >
              <span class="executor-chip-role">{t("executor.role_plan")}</span>
              <span class="executor-chip-provider">{orchestratorParts().provider}</span>
              <span class="executor-chip-name">
                {orchestratorParts().name || t("agent_models.option_not_set")}
              </span>
            </span>
            <span
              class="executor-chip-model"
              data-source="executor"
              data-empty={executorModel() ? "false" : "true"}
              data-same={sameModel() ? "true" : "false"}
              title={t("executor.model_explainer_external", {
                executor: activeLabel(),
              })}
            >
              <span class="executor-chip-role">{t("executor.role_edit")}</span>
              <Show
                when={!sameModel()}
                fallback={<span class="executor-chip-name">{t("executor.same_as_plan")}</span>}
              >
                <span class="executor-chip-provider">{executorParts().provider}</span>
                <span class="executor-chip-name">
                  {executorParts().name || t("agent_models.option_not_set")}
                </span>
              </Show>
            </span>
          </span>
          <span class="executor-chip-caret" aria-hidden="true">
            <Icon name="caret-up" size={8} />
          </span>
        </Button>

        <Show when={menu.open()}>
          <div class="executor-menu" role="listbox" aria-label={t("executor.group")}>
            <div class="executor-menu-summary">
              <div class="executor-menu-summary-title">
                <span>{activeLabel()}</span>
                <span>{t("executor.change_model")}</span>
              </div>
              <div class="executor-menu-summary-grid">
                <div class="executor-menu-summary-row">
                  <span>{t("executor.role_plan")}</span>
                  <strong>{orchestratorModel() || t("agent_models.option_not_set")}</strong>
                </div>
                <div class="executor-menu-summary-row">
                  <span>{t("executor.role_edit")}</span>
                  <strong>{executorModelText() || t("agent_models.option_not_set")}</strong>
                </div>
              </div>
            </div>
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
                              title={modelID}
                              onClick={() => void pickModel(id, modelID)}
                            >
                              <span class="executor-menu-model-provider">
                                {splitModelID(modelID).provider}
                              </span>
                              <span class="executor-menu-model-name">
                                {splitModelID(modelID).name}
                              </span>
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
