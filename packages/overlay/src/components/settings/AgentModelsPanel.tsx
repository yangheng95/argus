// ── AgentModelsPanel ──
// LLM model configuration panel — a read/write mirror of opencorvus.jsonc.
//
// Two sections:
//   1. Project default — the top-level `model` field. Every agent resolves
//      to this when it has no explicit override. Missing this field is a
//      hard error: `resolveAgentModel` throws `MissingModelConfigError` and
//      the backend refuses to dispatch any agent work. The panel shows a
//      prominent warning in that state.
//   2. Per-agent overrides — `agent.<name>.model`. Optional; empty means
//      "inherit the project default".
//
// Strict contract: the panel IS the source of truth for what the backend
// will use. No hidden fallbacks (env vars, `~/.local/state/argus/model.json`
// recent list, session user-message propagation) exist anymore — those were
// removed because they silently switched provider/model between goal retries
// and collapsed prompt cache.

import * as Select from "@kobalte/core/select"
import { createSignal, createMemo, createResource, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import {
  getSessionConfig,
  patchConfig,
  patchSessionConfig,
  sessionConfigRefreshToken,
  type SessionConfigResponse,
} from "../../services/config"
import { appStore } from "../../store/app"
import { settingsStore } from "../../store/settings"
import { t } from "../../utils/i18n"
import { loadAgentModelsData, type AgentInfo, type ProvidersPayload } from "./agent-models-data"
import { Button } from "../ui/Button"
import { SurfaceHeader } from "../ui/SurfaceHeader"
import { Icon } from "../Icon"

// Tier groupings are display-only: they organize the UI list but no longer
// affect default model resolution (all agents inherit the project default).
const CORE_AGENTS = ["orchestrator", "build", "integrity", "general"]
const INTERNAL_AGENTS = ["compaction", "title", "summary"]

function tierOf(name: string): "core" | "internal" | "lightweight" {
  if (CORE_AGENTS.includes(name)) return "core"
  if (INTERNAL_AGENTS.includes(name)) return "internal"
  return "lightweight"
}

const TIER_ORDER: Array<"core" | "lightweight" | "internal"> = ["core", "lightweight", "internal"]

const TIER_LABEL: Record<string, string> = {
  core: "Core — main coding agents",
  lightweight: "Lightweight — spec/plan/explore/etc.",
  internal: "Internal — background tasks",
}

export default function AgentModelsPanel(props: { scope?: "project" | "session"; sessionID?: string }) {
  const [savingAgents, setSavingAgents] = createSignal<Set<string>>(new Set())
  const [savingDefault, setSavingDefault] = createSignal(false)
  const [sessionRefreshToken, setSessionRefreshToken] = createSignal(0)
  const scope = () => props.scope ?? "project"
  const sessionID = () => (props.sessionID ?? "").trim()
  const providerConfigVersion = createMemo(() => JSON.stringify(appStore.config?.provider ?? null))
  const providerCatalogVersion = createMemo(() =>
    JSON.stringify({
      connected: [...(appStore.providerCatalog?.connected ?? [])].sort(),
    }),
  )

  // Agents + providers change rarely and are fetched via createResource with a
  // refreshToken knob. The project default `model` is deliberately NOT fetched
  // here — it is read directly from `appStore.config`, which the SSE
  // `config.changed` event keeps current. Keeping two independent sources of
  // truth for the same field (local createResource + global appStore.config)
  // was the original bug: after a save we set one and not the other, the UI
  // briefly flashed the new value, then the SSE-driven appStore refresh (or a
  // subsequent re-render reading stale createResource data) snapped it back.
  const [refreshToken, setRefreshToken] = createSignal(0)

  const [sessionConfig, { mutate: mutateSessionConfig }] = createResource(
    () =>
      scope() === "session" && sessionID()
        ? `${sessionID()}:${sessionRefreshToken()}:${sessionConfigRefreshToken()}`
        : null,
    async (key): Promise<SessionConfigResponse> => {
      const sid = String(key).split(":")[0]
      return await getSessionConfig(sid)
    },
  )

  const [data] = createResource(
    () => `${refreshToken()}:${settingsStore.directory.trim()}:${providerConfigVersion()}:${providerCatalogVersion()}`,
    () => loadAgentModelsData(),
  )
  const readyData = createMemo(() => {
    if (data.loading || data.error) return undefined
    return data()
  })
  const readyPayload = createMemo(() => {
    const payload = readyData()
    if (!payload) return undefined
    if (scope() === "session" && !sessionConfig()) return undefined
    return payload
  })

  const sourceConfig = createMemo<Record<string, any>>(() => {
    if (scope() === "session") return sessionConfig()?.config ?? {}
    return (appStore.config as Record<string, any> | null | undefined) ?? {}
  })

  // Single source of truth for the currently-persisted project default model.
  // Reads directly from appStore.config.model — the same value SSE
  // `config.changed` refreshes via loadConfigInfo(). Any write path below must
  // update appStore.config so this memo reflects reality without a re-fetch.
  const projectModel = createMemo<string>(() => {
    const m = sourceConfig().model
    return typeof m === "string" ? m : ""
  })

  async function patchActiveConfig(diff: Record<string, any>) {
    if (scope() === "session") {
      const sid = sessionID()
      if (!sid) throw new Error("Session model settings require a sessionID")
      const saved = await patchSessionConfig(sid, diff)
      mutateSessionConfig(saved)
      return saved.config
    }
    return await patchConfig(diff)
  }

  async function onSelectProjectDefault(value: string) {
    setSavingDefault(true)
    try {
      // patchConfig sends only the diff (RFC 7396) and writes the returned
      // config to appStore.config. projectModel() is a memo over
      // appStore.config.model, so the UI reflects the new value the moment
      // the PATCH returns — no re-fetch window, no two-source drift.
      await patchActiveConfig({ model: value ? value : null })
    } catch (e) {
      console.error("[project-default-model] save failed", e)
    } finally {
      setSavingDefault(false)
    }
  }

  function configAgentEntry(agentName: string): Record<string, any> | null {
    const agents = sourceConfig().agent
    if (!agents || typeof agents !== "object" || Array.isArray(agents)) return null
    const entry = (agents as Record<string, unknown>)[agentName]
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null
    return entry as Record<string, any>
  }

  function configAgentModel(agentName: string): string {
    const model = configAgentEntry(agentName)?.model
    return typeof model === "string" ? model : ""
  }

  function configAgentHasNonModelFields(agentName: string): boolean {
    const entry = configAgentEntry(agentName)
    if (!entry) return false
    return Object.keys(entry).some((key) => key !== "model")
  }

  function setAgentSaving(agentName: string, saving: boolean): void {
    setSavingAgents((prev) => {
      const next = new Set(prev)
      if (saving) next.add(agentName)
      else next.delete(agentName)
      return next
    })
  }

  async function onSelect(agentName: string, value: string) {
    setAgentSaving(agentName, true)
    try {
      await patchActiveConfig({
        agent: {
          [agentName]: value ? { model: value } : configAgentHasNonModelFields(agentName) ? { model: null } : null,
        },
      })
      if (scope() === "session") setSessionRefreshToken((x) => x + 1)
      else setRefreshToken((x) => x + 1)
    } catch (e) {
      console.error("[agent-models] save failed", e)
    } finally {
      setAgentSaving(agentName, false)
    }
  }

  interface ProviderGroup {
    id: string
    name: string
    models: Array<{ value: string; label: string }>
  }

  interface ModelSelectOption {
    value: string
    label: string
    groupLabel?: string
  }

  function providerGroups(payload: ProvidersPayload | undefined): ProviderGroup[] {
    if (!payload) return []
    const groups: ProviderGroup[] = []
    const sortedProviders = [...payload.providers].sort((a, b) => a.name.localeCompare(b.name))
    for (const p of sortedProviders) {
      const modelIDs = Object.keys(p.models).sort()
      if (modelIDs.length === 0) continue
      groups.push({
        id: p.id,
        name: p.name || p.id,
        models: modelIDs.map((modelID) => ({
          value: `${p.id}/${modelID}`,
          label: modelID,
        })),
      })
    }
    return groups
  }

  function allModelValues(groups: ProviderGroup[]): Set<string> {
    const out = new Set<string>()
    for (const g of groups) for (const m of g.models) out.add(m.value)
    return out
  }

  function groupedAgents(agents: AgentInfo[]) {
    const byTier: Record<string, AgentInfo[]> = { core: [], lightweight: [], internal: [] }
    for (const a of agents) byTier[tierOf(a.name)].push(a)
    for (const tier of Object.keys(byTier)) {
      byTier[tier].sort((x, y) => x.name.localeCompare(y.name))
    }
    return byTier
  }

  function modelOptions(props: {
    value: string
    groups: ProviderGroup[]
    unavailable: boolean
    emptyLabel: string
    unavailableLabel: string
  }): ModelSelectOption[] {
    const options: ModelSelectOption[] = [{ value: "", label: props.emptyLabel }]
    const selectedAvailable = props.groups.some((group) => group.models.some((model) => model.value === props.value))
    if (props.value && (props.unavailable || !selectedAvailable)) {
      options.push({ value: props.value, label: props.unavailableLabel })
    }
    for (const group of props.groups) {
      for (const model of group.models) {
        options.push({ value: model.value, label: model.label, groupLabel: group.name })
      }
    }
    return options
  }

  function ModelSelectOptionItem(props: Select.SelectRootItemComponentProps<ModelSelectOption>): JSX.Element {
    const option = () => props.item.rawValue
    return (
      <Select.Item
        item={props.item}
        class="oc-select-option agent-model-select-option"
        data-model-value={option().value}
      >
        <span class="agent-model-select-option-text">
          <Select.ItemLabel>{option().label}</Select.ItemLabel>
          <Show when={option().groupLabel}>{(groupLabel) => <small>{groupLabel()}</small>}</Show>
        </span>
        <Select.ItemIndicator class="oc-select-indicator">
          <Icon name="status-completed" size={12} />
        </Select.ItemIndicator>
      </Select.Item>
    )
  }

  function ModelSelect(props: {
    id: string
    testid: string
    value: string
    groups: ProviderGroup[]
    unavailable: boolean
    disabled: boolean
    emptyLabel: string
    unavailableLabel: string
    onSelect: (value: string) => void
  }) {
    const options = createMemo(() => modelOptions(props))
    const selectedOption = () => options().find((option) => option.value === props.value) ?? options()[0] ?? null
    const setSelectedOption = (option: ModelSelectOption | null) => {
      if (!option) return
      if (option.value === props.value) return
      props.onSelect(option.value)
    }
    return (
      <Select.Root<ModelSelectOption>
        class="agent-model-select"
        options={options()}
        optionValue="value"
        optionTextValue="label"
        value={selectedOption()}
        onChange={setSelectedOption}
        itemComponent={ModelSelectOptionItem}
        disabled={props.disabled}
        disallowEmptySelection
        gutter={4}
        sameWidth
      >
        <Select.Trigger class="field-input oc-select-trigger agent-model-select-trigger" data-testid={props.testid}>
          <Select.Value<ModelSelectOption>>
            {(state) => <span>{state.selectedOption()?.label ?? props.emptyLabel}</span>}
          </Select.Value>
          <Select.Icon>
            <Icon name="caret-down" size={12} />
          </Select.Icon>
        </Select.Trigger>
        <Select.HiddenSelect />
        <Select.Portal>
          <Select.Content class="oc-select-content agent-model-select-content">
            <Select.Listbox class="oc-select-listbox agent-model-select-listbox" />
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    )
  }

  return (
    <div class="general-panel">
      <div class="config-panel-group">
        <SurfaceHeader variant="settings-group" title="Agent Models" />
        <p class="agent-models-info">{t("agent_models.intro")}</p>

        <Show when={data.loading || (scope() === "session" && sessionConfig.loading)}>
          <div class="agent-models-loading" role="status" aria-live="polite">
            <span class="agent-models-loading-spinner" aria-hidden="true" />
            <span>{t("agent_models.loading")}</span>
          </div>
        </Show>

        <Show when={data.error}>
          <div class="agent-models-error" role="alert">
            <div class="agent-models-error-msg">
              {t("agent_models.load_failed", { error: String((data.error as any)?.message ?? data.error) })}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              tone="neutral"
              onClick={() => setRefreshToken((x) => x + 1)}
              disabled={data.loading}
            >
              {data.loading ? t("common.retrying") : t("common.retry")}
            </Button>
          </div>
        </Show>

        <Show when={scope() === "session" && sessionConfig.error}>
          <div class="agent-models-error" role="alert">
            <div class="agent-models-error-msg">
              {t("agent_models.load_failed", {
                error: String((sessionConfig.error as any)?.message ?? sessionConfig.error),
              })}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              tone="neutral"
              onClick={() => setSessionRefreshToken((x) => x + 1)}
              disabled={sessionConfig.loading}
            >
              {sessionConfig.loading ? t("common.retrying") : t("common.retry")}
            </Button>
          </div>
        </Show>

        <Show when={readyPayload()} keyed>
          {(payload) => {
            const groups = providerGroups(payload.providers)
            const available = allModelValues(groups)
            const grouped = groupedAgents(payload.agents)
            // projectModel() is a memo over appStore.config.model — re-reads
            // each render, so UI stays in sync with the canonical store.
            const currentProjectModel = () => projectModel()
            const projectModelMissing = () => !currentProjectModel()
            const projectModelUnavailable = () => {
              const current = currentProjectModel()
              return !!current && !available.has(current)
            }
            return (
              <>
                <div class="agent-model-project-default">
                  <div class="agent-model-row" title={t("agent_models.project_default_title")}>
                    <span class="agent-model-name">{t("agent_models.project_default")}</span>
                    <ModelSelect
                      id="project"
                      testid="agent-model-select-project"
                      value={currentProjectModel()}
                      disabled={savingDefault()}
                      groups={groups}
                      unavailable={projectModelUnavailable()}
                      emptyLabel={t("agent_models.option_not_set")}
                      unavailableLabel={t("agent_models.option_unavailable", { model: currentProjectModel() })}
                      onSelect={onSelectProjectDefault}
                    />
                    <span class="agent-model-status">
                      <Show when={savingDefault()}>{t("agent_models.saving")}</Show>
                    </span>
                  </div>
                  <Show when={projectModelMissing()}>
                    <div class="config-panel-card agent-models-warning">
                      {t("agent_models.warning_no_default_prefix")}
                      <code> MissingModelConfigError </code>
                      {t("agent_models.warning_no_default_suffix")}
                    </div>
                  </Show>
                </div>
                <div class="agent-model-table">
                  <For each={TIER_ORDER}>
                    {(tier) => (
                      <Show when={grouped[tier].length > 0}>
                        <div class="agent-model-tier-label">{TIER_LABEL[tier]}</div>
                        <For each={grouped[tier]}>
                          {(agent) => {
                            const current = () => configAgentModel(agent.name)
                            const missing = () => {
                              const selected = current()
                              return selected !== "" && !available.has(selected)
                            }
                            return (
                              <div class="agent-model-row" title={agent.description || ""}>
                                <span class="agent-model-name">{agent.name}</span>
                                <ModelSelect
                                  id={`agent:${agent.name}`}
                                  testid={`agent-model-select-${agent.name}`}
                                  value={current()}
                                  disabled={savingAgents().has(agent.name)}
                                  groups={groups}
                                  unavailable={missing()}
                                  emptyLabel="— inherit project default —"
                                  unavailableLabel={`${current()} (unavailable)`}
                                  onSelect={(value) => onSelect(agent.name, value)}
                                />
                                <span class="agent-model-status">
                                  <Show when={savingAgents().has(agent.name)}>saving…</Show>
                                </span>
                              </div>
                            )
                          }}
                        </For>
                      </Show>
                    )}
                  </For>
                </div>
              </>
            )
          }}
        </Show>
      </div>
    </div>
  )
}
