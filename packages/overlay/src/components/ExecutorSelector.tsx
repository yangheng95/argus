// ── ExecutorSelector ──
// Bottom-of-composer dual chip: OpenCorvus (left) and external executor
// (right). Each chip is an independent popover anchor with its own model
// picker.
//
//   - OpenCorvus picker lists only the models from providers that the
//     server reports as connected (auth'd). In task context it writes the
//     task root session overlay; outside task context it writes the project
//     default.
//   - External picker lists native CLI model IDs from the provider IDs mapped
//     to that executor. Provider buckets are only a taxonomy for the picker;
//     they must not be written into Codex / Claude Code model values.
//
// State sources (rule 8 single source):
//   - active external executor → settingsStore.executor
//   - per-executor model → appStore.executors via setExecutorModel
//   - OpenCorvus model → current task root session config when bound,
//     otherwise appStore.config.model via patchConfig

import * as Popover from "@kobalte/core/popover";
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { appStore } from "../store/app";
import { rootTaskSessionID, hasSelectedTask } from "../store/board";
import { settingsStore, setSettingsStore, saveSettings, sanitizeExecutor } from "../store/settings";
import { Icon } from "./Icon";
import { useDisclosure, type Disclosure } from "../solid/disclosure";
import {
  EXECUTOR_PROVIDER_MAP,
  executorCurrentModel,
  executorLabel,
  executorSelectable,
  executorTitle,
  setExecutorModel,
} from "../services/executor";
import {
  getSessionConfig,
  patchConfig,
  patchSessionConfig,
  sessionConfigRefreshToken,
  type SessionConfigResponse,
} from "../services/config";
import { loadProviderInfo } from "../services/init";
import { t } from "../utils/i18n";
import { Button } from "./ui/Button";

interface ModelParts {
  provider: string;
  name: string;
}

interface ProviderGroup {
  providerID: string;
  providerName: string;
  /** True when the server reports the provider as connected/auth'd. */
  available: boolean;
  /** Fully-qualified model IDs ("<provider>/<model>"). */
  models: string[];
}

const INTERNAL_EXECUTOR_ID = "opencorvus";
const EXTERNAL_EXECUTOR_IDS = ["codex", "claude-code"];

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

function projectModelFromConfig(): string {
  const cfg = appStore.config as { model?: unknown } | null | undefined;
  return typeof cfg?.model === "string" ? cfg.model : "";
}

function connectedProviderIDs(): Set<string> {
  const catalog = appStore.providerCatalog as { connected?: unknown } | null | undefined;
  const connected = catalog?.connected;
  if (!Array.isArray(connected)) return new Set();
  const out = new Set<string>();
  for (const id of connected) if (typeof id === "string" && id) out.add(id);
  return out;
}

function buildProviderGroups(
  filter?: (id: string) => boolean,
  prioritizeAvailable = true,
  modelIDFormat: "qualified" | "native" = "qualified",
): ProviderGroup[] {
  const catalog = appStore.providerCatalog as { all?: unknown } | null | undefined;
  const all = Array.isArray(catalog?.all) ? (catalog!.all as Array<Record<string, unknown>>) : [];
  const connected = connectedProviderIDs();
  const groups: ProviderGroup[] = [];
  for (const provider of all) {
    const id = typeof provider.id === "string" ? provider.id : "";
    if (!id) continue;
    if (filter && !filter(id)) continue;
    const modelsField = provider.models;
    if (!modelsField || typeof modelsField !== "object" || Array.isArray(modelsField)) continue;
    const modelIDs: string[] = [];
    for (const entry of Object.values(modelsField as Record<string, unknown>)) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const modelID = (entry as { id?: unknown }).id;
        if (typeof modelID === "string" && modelID) modelIDs.push(modelID);
      }
    }
    if (modelIDs.length === 0) continue;
    modelIDs.sort();
    groups.push({
      providerID: id,
      providerName: typeof provider.name === "string" && provider.name ? provider.name : id,
      available: connected.has(id),
      models: modelIDFormat === "qualified" ? modelIDs.map((modelID) => `${id}/${modelID}`) : modelIDs,
    });
  }
  groups.sort((a, b) => {
    if (prioritizeAvailable && a.available !== b.available) return a.available ? -1 : 1;
    return a.providerName.localeCompare(b.providerName);
  });
  return groups;
}

// OpenCorvus (OpenCorvus internal) only surfaces models from providers that
// are already authenticated — there is no point letting the user pick a
// model whose provider can't actually serve it.
function mirrorProviderGroups(): ProviderGroup[] {
  return buildProviderGroups(undefined, true).filter((group) => group.available);
}

// External executor groups: every provider mapped to that executor. These
// buckets only scope model families; executor availability comes from the
// executor registry, not from overlay provider auth state.
function externalProviderGroups(executorID: string): ProviderGroup[] {
  const wanted = EXECUTOR_PROVIDER_MAP[executorID];
  if (!wanted || wanted.length === 0) return [];
  const wantedSet = new Set(wanted);
  return buildProviderGroups((id) => wantedSet.has(id), false, "native");
}

function ChevronCaret(props: { open: boolean }) {
  return (
    <span class="executor-chip-caret" aria-hidden="true">
      <Icon name={props.open ? "caret-down" : "caret-up"} size={8} />
    </span>
  );
}

function ChipModel(props: { model: string; placeholder: string }) {
  const parts = createMemo(() => splitModelID(props.model));
  return (
    <span class="executor-chip-model" data-empty={props.model ? "false" : "true"}>
      <Show
        when={props.model}
        fallback={<span class="executor-chip-name">{props.placeholder}</span>}
      >
        <span class="executor-chip-provider">{parts().provider}</span>
        <span class="executor-chip-name">{parts().name || parts().provider}</span>
      </Show>
    </span>
  );
}

export function ExecutorSelector() {
  // Two independent disclosures — opening one closes the other so the
  // popover stack never overlaps.
  const mirror = useDisclosure();
  const external = useDisclosure();
  const [providerLoading, setProviderLoading] = createSignal(false);

  const activeID = createMemo(() => sanitizeExecutor(settingsStore.executor));
  const isExternalActive = createMemo(() => activeID() !== INTERNAL_EXECUTOR_ID);
  const externalActiveID = createMemo(() => (isExternalActive() ? activeID() : ""));
  const taskRootSessionID = createMemo(() => rootTaskSessionID().trim());

  const sessionConfigKey = createMemo((): { sessionID: string; baseModel: string; refresh: number } | null => {
    const sessionID = taskRootSessionID();
    if (!sessionID) return null;
    return { sessionID, baseModel: projectModelFromConfig(), refresh: sessionConfigRefreshToken() };
  });
  const [sessionConfig, { mutate: mutateSessionConfig }] = createResource(
    sessionConfigKey,
    async (key): Promise<SessionConfigResponse> => {
      return await getSessionConfig(key.sessionID);
    },
  );

  const openCorvusModel = createMemo(() => {
    if (hasSelectedTask() && !taskRootSessionID()) return "";
    if (taskRootSessionID()) {
      const model = sessionConfig()?.config?.model;
      return typeof model === "string" ? model : "";
    }
    return projectModelFromConfig();
  });
  const externalModel = createMemo(() => {
    const id = externalActiveID();
    return id ? executorCurrentModel(id) : "";
  });

  const mirrorGroups = createMemo(mirrorProviderGroups);
  // External popover always renders a tab strip across the available external
  // executor types, so the user can switch between Codex / Claude Code / None
  // without leaving the popover.
  const externalTabs = createMemo(() =>
    EXTERNAL_EXECUTOR_IDS.map((id) => ({
      id,
      label: executorLabel(id),
      selectable: executorSelectable(id),
      title: executorTitle(id),
    })),
  );
  // The "focused" external executor inside the popover defaults to the active
  // one when there is one, otherwise the first selectable tab so the picker
  // always has something to show. Tracked separately from settingsStore so
  // peeking at another executor's model list doesn't auto-switch the active
  // executor.
  const focusedExternalID = createMemo(() => {
    const id = externalActiveID();
    if (id) return id;
    const firstSelectable = externalTabs().find((tab) => tab.selectable);
    return firstSelectable?.id ?? EXTERNAL_EXECUTOR_IDS[0];
  });
  const focusedGroups = createMemo(() => externalProviderGroups(focusedExternalID()));
  const focusedCurrentModel = createMemo(() => executorCurrentModel(focusedExternalID()));

  function openMirror() {
    if (mirrorWriteDisabled()) return;
    external.close();
    void ensureProviderInfoLoaded();
    mirror.openIt();
  }
  function openExternal() {
    mirror.close();
    void ensureProviderInfoLoaded();
    external.openIt();
  }

  async function ensureProviderInfoLoaded(): Promise<void> {
    if (providerLoading()) return;
    if (appStore.providerCatalog) return;
    setProviderLoading(true);
    try {
      await loadProviderInfo();
    } finally {
      setProviderLoading(false);
    }
  }

  async function pickMirrorModel(value: string) {
    if (value === openCorvusModel()) {
      mirror.close();
      return;
    }
    // R5.1 item 9: under a selected task the model picker writes ONLY the
    // task-root session overlay, never the project /config. If a task is
    // selected but its root session is not yet resolved, the write is
    // suppressed entirely (no fallback to /config) — the picker is disabled
    // in that state (see mirrorWriteDisabled()).
    if (hasSelectedTask()) {
      const sessionID = taskRootSessionID();
      if (!sessionID) {
        mirror.close();
        return;
      }
      const saved = await patchSessionConfig(sessionID, { model: value ? value : null });
      mutateSessionConfig(saved);
      mirror.close();
      return;
    }
    await patchConfig({ model: value ? value : null });
    mirror.close();
  }

  // True when a task is selected but its root session is not yet resolved:
  // the OpenCorvus model picker must be disabled (R5.1 item 9) rather than
  // silently writing the project /config.
  const mirrorWriteDisabled = createMemo(() => hasSelectedTask() && !taskRootSessionID());

  async function pickExternalModel(executorID: string, model: string) {
    if (executorID !== activeID()) {
      setSettingsStore("executor", sanitizeExecutor(executorID));
      saveSettings();
    }
    await setExecutorModel(executorID, model);
    external.close();
  }

  function disableExternal() {
    if (activeID() !== INTERNAL_EXECUTOR_ID) {
      setSettingsStore("executor", sanitizeExecutor(INTERNAL_EXECUTOR_ID));
      saveSettings();
    }
    external.close();
  }

  function focusExternal(executorID: string) {
    // Switching the popover tab makes that executor active so subsequent
    // model picks land on the right executor descriptor.
    if (executorID !== activeID()) {
      setSettingsStore("executor", sanitizeExecutor(executorID));
      saveSettings();
    }
  }

  return (
    <div class="executor-dualbar" data-ui="executor-dualbar">
      <ExecutorChip
        side="mirror"
        disclosure={mirror}
        onActivate={openMirror}
        label={executorLabel(INTERNAL_EXECUTOR_ID)}
        model={openCorvusModel()}
        modelPlaceholder={t("agent_models.option_not_set")}
        title={t("executor.mirror_chip_title", {
          model: openCorvusModel() || t("agent_models.option_not_set"),
        })}
        ariaLabel={t("executor.mirror_chip_aria", {
          model: openCorvusModel() || t("agent_models.option_not_set"),
        })}
        disabled={mirrorWriteDisabled()}
      >
        <>
          <div class="executor-popover-header">
            <span class="executor-popover-title">
              {t("executor.mirror_popover_title")}
            </span>
            <span class="executor-popover-hint">
              {t("executor.mirror_popover_hint")}
            </span>
          </div>
          <Show
            when={mirrorGroups().length > 0}
            fallback={
              <div class="executor-popover-empty">
                {providerLoading() ? t("common.loading") : t("executor.mirror_no_connected_providers")}
              </div>
            }
          >
            <div class="executor-popover-body">
              <For each={mirrorGroups()}>
                {(group) => (
                  <ProviderModelGroup
                    group={group}
                    currentModel={openCorvusModel()}
                    disabled={mirrorWriteDisabled()}
                    onPick={(modelID) => void pickMirrorModel(modelID)}
                  />
                )}
              </For>
            </div>
          </Show>
        </>
      </ExecutorChip>

      <ExecutorChip
        side="external"
        disclosure={external}
        onActivate={openExternal}
        label={isExternalActive() ? executorLabel(activeID()) : t("executor.external_disabled")}
        model={externalModel()}
        modelPlaceholder={isExternalActive() ? t("agent_models.option_not_set") : ""}
        title={
          isExternalActive()
            ? t("executor.external_chip_title", {
                executor: executorLabel(activeID()),
                model: externalModel() || t("agent_models.option_not_set"),
              })
            : t("executor.external_chip_title_disabled")
        }
        ariaLabel={
          isExternalActive()
            ? t("executor.external_chip_aria_active", {
                executor: executorLabel(activeID()),
                model: externalModel() || t("agent_models.option_not_set"),
              })
            : t("executor.external_chip_aria_disabled")
        }
      >
        <>
          <div class="executor-popover-header">
            <span class="executor-popover-title">
              {t("executor.external_popover_title")}
            </span>
            <span class="executor-popover-hint">
              {t("executor.external_popover_hint")}
            </span>
          </div>
          <div class="executor-popover-tabs" role="tablist">
            {/* Popover tabs switch the in-popover view; they should not take focus
                away from Kobalte's dismissable layer and close the popover. */}
            <button
              type="button"
              role="tab"
              class="executor-popover-tab"
              data-active={!isExternalActive() ? "true" : "false"}
              aria-selected={!isExternalActive() ? "true" : "false"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={disableExternal}
            >
              {t("executor.external_disabled")}
            </button>
            <For each={externalTabs()}>
              {(tab) => (
                <button
                  type="button"
                  role="tab"
                  class="executor-popover-tab"
                  data-active={tab.id === focusedExternalID() ? "true" : "false"}
                  aria-selected={tab.id === focusedExternalID() ? "true" : "false"}
                  disabled={!tab.selectable}
                  title={tab.title}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => focusExternal(tab.id)}
                >
                  {tab.label}
                </button>
              )}
            </For>
          </div>
          <Show
            when={isExternalActive()}
            fallback={
              <div class="executor-popover-empty">
                {t("executor.external_disabled_hint")}
              </div>
            }
          >
            <Show
              when={focusedGroups().length > 0}
              fallback={
                <div class="executor-popover-empty">
                  {providerLoading() ? t("common.loading") : t("executor.external_no_models")}
                </div>
              }
            >
              <div class="executor-popover-body">
                <For each={focusedGroups()}>
                  {(group) => (
                    <ProviderModelGroup
                      group={group}
                      currentModel={focusedCurrentModel()}
                      onPick={(modelID) => void pickExternalModel(focusedExternalID(), modelID)}
                    />
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </>
      </ExecutorChip>
    </div>
  );
}

interface ExecutorChipProps {
  side: "mirror" | "external";
  disclosure: Disclosure;
  onActivate: () => void;
  label: string;
  model: string;
  modelPlaceholder: string;
  title: string;
  ariaLabel: string;
  disabled?: boolean;
  children: any;
}

function ExecutorChip(props: ExecutorChipProps) {
  return (
    <Popover.Root
      open={props.disclosure.open()}
      onOpenChange={(open) => {
        if (open) {
          if (!props.disabled) props.onActivate();
          return;
        }
        props.disclosure.close();
      }}
      placement="top-start"
      gutter={6}
    >
      <div
        class="executor-chip-slot"
        data-side={props.side}
        data-open={props.disclosure.open() ? "true" : "false"}
      >
        <Popover.Trigger
          as={Button}
          type="button"
          variant="outline"
          size="sm"
          tone="neutral"
          data-ui={`executor-chip-${props.side}`}
          title={props.title}
          aria-label={props.ariaLabel}
          disabled={props.disabled}
        >
          <span class="executor-chip-identity">
            <span class="executor-chip-label">{props.label}</span>
          </span>
          <ChipModel model={props.model} placeholder={props.modelPlaceholder} />
          <ChevronCaret open={props.disclosure.open()} />
        </Popover.Trigger>
        <Popover.Content class="executor-popover" data-section={props.side}>
          {props.children}
        </Popover.Content>
      </div>
    </Popover.Root>
  );
}

interface ProviderModelGroupProps {
  group: ProviderGroup;
  currentModel: string;
  disabled?: boolean;
  onPick: (modelID: string) => void;
}

function ProviderModelGroup(props: ProviderModelGroupProps) {
  return (
    <div class="executor-popover-group">
      <div class="executor-popover-group-header">
        <span class="executor-popover-group-name">{props.group.providerName}</span>
      </div>
      <div class="executor-popover-models">
        <For each={props.group.models}>
          {(modelID) => (
            <button
              type="button"
              class="executor-popover-model"
              data-active={modelID === props.currentModel ? "true" : "false"}
              title={modelID}
              disabled={props.disabled}
              onClick={() => props.onPick(modelID)}
            >
              <span class="executor-popover-model-name">
                {splitModelID(modelID).name}
              </span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
