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

// MirrorCode is the internal OpenCorvus executor. Its model is the project
// default model from appStore.config.model. External executors carry their
// own model and should only appear in the chip when that value exists.
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

function agentModelOverridesFromConfig(): string[] {
  const cfg = appStore.config as { agent?: unknown } | null | undefined
  const agents = cfg?.agent
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) return []
  const out: string[] = []
  for (const entry of Object.values(agents as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const model = (entry as { model?: unknown }).model
    if (typeof model === "string" && model.trim()) out.push(model.trim())
  }
  return out
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

  // The chip has two semantic model surfaces:
  // - OpenCorvus model: appStore.config.model, annotated when the Agent
  //   Models panel contains per-agent overrides.
  // - External executor model: active external executor's own model, rendered
  //   only when that value exists. Empty external values should not produce a
  //   visible "-- not set --" slot.
  const openCorvusModel = createMemo(projectModelFromConfig)
  const isExternalExecutor = createMemo(() => activeID() !== INTERNAL_EXECUTOR_ID)
  const externalExecutorModel = createMemo(() => (isExternalExecutor() ? activeModel().trim() : ""))
  const hasExternalExecutorModel = createMemo(() => externalExecutorModel().length > 0)
  const hasCustomAgentModels = createMemo(() => {
    const project = openCorvusModel().trim()
    const overrides = agentModelOverridesFromConfig()
    if (overrides.length === 0) return false
    const distinctOverrides = new Set(overrides)
    if (distinctOverrides.size > 1) return true
    if (!project) return true
    return overrides.some((model) => model !== project)
  })
  const customSuffix = createMemo(() => (hasCustomAgentModels() ? t("executor.custom_agent_models") : ""))
  const openCorvusDisplayModel = createMemo(() => {
    const model = openCorvusModel() || t("agent_models.option_not_set")
    return customSuffix() ? `${model}${customSuffix()}` : model
  })
  const openCorvusParts = createMemo(() => splitModelID(openCorvusModel()))
  const externalExecutorParts = createMemo(() => splitModelID(externalExecutorModel()))

  // Tooltip names the external executor model only when one is configured.
  const chipTitle = createMemo(() => {
    const openCorvus = openCorvusDisplayModel()
    if (!hasExternalExecutorModel()) {
      return [executorTitle(activeID()), t("executor.model_explainer_opencorvus", { model: openCorvus })]
        .filter(Boolean)
        .join("\n")
    }
    const pair = t("executor.model_explainer_pair", {
      opencorvus: openCorvus,
      executor: activeLabel(),
      external: externalExecutorModel(),
    })
    return [executorTitle(activeID()), pair].filter(Boolean).join("\n")
  })
  const chipAriaLabel = createMemo(() => {
    const base = `${activeLabel()}: ${t("executor.role_opencorvus")} ${openCorvusDisplayModel()}`
    const external = hasExternalExecutorModel()
      ? `; ${activeLabel()} ${t("executor.role_external")} ${externalExecutorModel()}`
      : ""
    return `${base}${external}. ${t("executor.change_model")}`
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
          data-has-external={hasExternalExecutorModel() ? "true" : "false"}
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
              data-source="opencorvus"
              data-empty={openCorvusModel() ? "false" : "true"}
              data-custom={hasCustomAgentModels() ? "true" : "false"}
              title={t("executor.model_explainer_opencorvus", {
                model: openCorvusDisplayModel(),
              })}
            >
              <span class="executor-chip-role">{t("executor.role_opencorvus")}</span>
              <span class="executor-chip-provider">{openCorvusParts().provider}</span>
              <span class="executor-chip-name">
                {openCorvusParts().name || t("agent_models.option_not_set")}
                <Show when={customSuffix()}>
                  <span class="executor-chip-custom">{customSuffix()}</span>
                </Show>
              </span>
            </span>
            <Show when={hasExternalExecutorModel()}>
              <span
                class="executor-chip-model"
                data-source="executor"
                data-empty="false"
                title={t("executor.model_explainer_external", {
                  executor: activeLabel(),
                  model: externalExecutorModel(),
                })}
              >
                <span class="executor-chip-role">{activeLabel()}</span>
                <span class="executor-chip-provider">{externalExecutorParts().provider}</span>
                <span class="executor-chip-name">
                  {externalExecutorParts().name}
                </span>
              </span>
            </Show>
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
                  <span>{t("executor.role_opencorvus")}</span>
                  <strong>{openCorvusDisplayModel()}</strong>
                </div>
                <Show when={hasExternalExecutorModel()}>
                  <div class="executor-menu-summary-row">
                    <span>{activeLabel()}</span>
                    <strong>{externalExecutorModel()}</strong>
                  </div>
                </Show>
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
