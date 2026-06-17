// ── ExecutorSelector ──
// Bottom-of-composer dual chip: OpenCorvus (left) and external executor
// (right). Each chip is an independent popover anchor with its own model
// picker.
//
//   - OpenCorvus picker lists only the models from providers that the
//     server reports as connected (auth'd). In task context it writes the
//     current operator agent's task root session overlay; outside task
//     context it writes the project default.
//   - External picker lists native CLI model IDs from the provider IDs mapped
//     to that executor. Provider buckets are only a taxonomy for the picker;
//     they must not be written into Codex / Claude Code model values.
//
// State sources (rule 8 single source):
//   - active external executor → settingsStore.executor
//   - per-executor model → appStore.executors via setExecutorModel
//   - OpenCorvus model → backend task operator model context when bound,
//     otherwise appStore.config.model via patchConfig

import * as Popover from "@kobalte/core/popover"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { appStore } from "../store/app"
import { activeTaskID, hasSelectedTask } from "../store/board"
import { settingsStore, setSettingsStore, saveSettings, sanitizeExecutor } from "../store/settings"
import { Icon } from "./Icon"
import { useDisclosure, type Disclosure } from "../solid/disclosure"
import {
  EXECUTOR_PROVIDER_MAP,
  executorCurrentModel,
  executorLabel,
  executorSelectable,
  executorTitle,
  setExecutorModel,
} from "../services/executor"
import {
  getTaskOperatorModelContext,
  getHexinBudget,
  modelContextID,
  patchConfig,
  patchSessionConfig,
  sessionConfigRefreshToken,
  type HexinBudgetResponse,
  type TaskOperatorModelContext,
} from "../services/config"
import { loadProviderInfo } from "../services/init"
import { activeDirectory } from "../services/workspace"
import { localeTag, t } from "../utils/i18n"
import { Button } from "./ui/Button"
import { Tab, Tabs } from "./ui/Tabs"

interface ModelParts {
  provider: string
  name: string
}

interface ProviderGroup {
  providerID: string
  providerName: string
  /** True when the server reports the provider as connected/auth'd. */
  available: boolean
  /** Fully-qualified model IDs ("<provider>/<model>"). */
  models: string[]
}

const INTERNAL_EXECUTOR_ID = "opencorvus"
const EXTERNAL_DISABLED_TAB_ID = "disabled"
const EXTERNAL_EXECUTOR_IDS = ["codex", "claude-code"]
const HEXIN_BUDGET_REFRESH_MS = 10 * 60 * 1000
const HEXIN_BUDGET_LOW_USD = 20

function splitModelID(modelID: string): ModelParts {
  const trimmed = modelID.trim()
  if (!trimmed) return { provider: "", name: "" }
  const slash = trimmed.indexOf("/")
  if (slash <= 0 || slash === trimmed.length - 1) {
    return { provider: "", name: trimmed }
  }
  return {
    provider: trimmed.slice(0, slash),
    name: trimmed.slice(slash + 1),
  }
}

function projectModelFromConfig(): string {
  const cfg = appStore.config as { model?: unknown } | null | undefined
  return typeof cfg?.model === "string" ? cfg.model : ""
}

function connectedProviderIDs(): Set<string> {
  const catalog = appStore.providerCatalog as { connected?: unknown } | null | undefined
  const connected = catalog?.connected
  if (!Array.isArray(connected)) return new Set()
  const out = new Set<string>()
  for (const id of connected) if (typeof id === "string" && id) out.add(id)
  return out
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error || "")
}

function buildProviderGroups(
  filter?: (id: string) => boolean,
  prioritizeAvailable = true,
  modelIDFormat: "qualified" | "native" = "qualified",
): ProviderGroup[] {
  const catalog = appStore.providerCatalog as { all?: unknown } | null | undefined
  const all = Array.isArray(catalog?.all) ? (catalog!.all as Array<Record<string, unknown>>) : []
  const connected = connectedProviderIDs()
  const groups: ProviderGroup[] = []
  for (const provider of all) {
    const id = typeof provider.id === "string" ? provider.id : ""
    if (!id) continue
    if (filter && !filter(id)) continue
    const modelsField = provider.models
    if (!modelsField || typeof modelsField !== "object" || Array.isArray(modelsField)) continue
    const modelIDs: string[] = []
    for (const entry of Object.values(modelsField as Record<string, unknown>)) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const modelID = (entry as { id?: unknown }).id
        if (typeof modelID === "string" && modelID) modelIDs.push(modelID)
      }
    }
    if (modelIDs.length === 0) continue
    modelIDs.sort()
    groups.push({
      providerID: id,
      providerName: typeof provider.name === "string" && provider.name ? provider.name : id,
      available: connected.has(id),
      models: modelIDFormat === "qualified" ? modelIDs.map((modelID) => `${id}/${modelID}`) : modelIDs,
    })
  }
  groups.sort((a, b) => {
    if (prioritizeAvailable && a.available !== b.available) return a.available ? -1 : 1
    return a.providerName.localeCompare(b.providerName)
  })
  return groups
}

// OpenCorvus (OpenCorvus internal) only surfaces models from providers that
// are already authenticated — there is no point letting the user pick a
// model whose provider can't actually serve it.
function mirrorProviderGroups(): ProviderGroup[] {
  return buildProviderGroups(undefined, true).filter((group) => group.available)
}

// External executor groups: every provider mapped to that executor. These
// buckets only scope model families; executor availability comes from the
// executor registry, not from overlay provider auth state.
function externalProviderGroups(executorID: string): ProviderGroup[] {
  const wanted = EXECUTOR_PROVIDER_MAP[executorID]
  if (!wanted || wanted.length === 0) return []
  const wantedSet = new Set(wanted)
  return buildProviderGroups((id) => wantedSet.has(id), false, "native")
}

function ChevronCaret(props: { open: boolean }) {
  return (
    <span class="executor-chip-caret" aria-hidden="true">
      <Icon name={props.open ? "caret-down" : "caret-up"} size={8} />
    </span>
  )
}

function ChipModel(props: { model: string; placeholder: string }) {
  const parts = createMemo(() => splitModelID(props.model))
  const displayText = createMemo(() => {
    if (!props.model) return props.placeholder
    const provider = parts().provider
    const name = parts().name
    if (provider && name) return `${provider}/${name}`
    return name || provider || props.model
  })
  return (
    <span class="executor-chip-value" data-empty={props.model ? "false" : "true"} title={displayText()}>
      {displayText()}
    </span>
  )
}

function formatBudgetAmount(value: number): string {
  return new Intl.NumberFormat(localeTag(), {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value)
}

function budgetErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error || "")
}

function HexinBudgetInline(props: {
  response: HexinBudgetResponse | undefined
  loading: boolean
  error: unknown
}) {
  const budget = createMemo(() => (props.response?.ok ? props.response.budget : undefined))
  const lowBudget = createMemo(() => {
    const value = budget()
    return !!value && value.remaining < HEXIN_BUDGET_LOW_USD
  })
  const providerError = createMemo(() => {
    const response = props.response
    return response?.ok === false ? response.error : ""
  })
  const transportError = createMemo(() => budgetErrorMessage(props.error))
  const displayText = createMemo(() => {
    const value = budget()
    if (props.loading) return t("executor.hexin_budget_inline_loading")
    if (value) {
      return t("executor.hexin_budget_inline", {
        remaining: formatBudgetAmount(value.remaining),
        max: formatBudgetAmount(value.maxBudget),
      })
    }
    if (providerError() || transportError()) return t("executor.hexin_budget_inline_error")
    return ""
  })
  const title = createMemo(() => {
    const value = budget()
    if (value) {
      return t("executor.hexin_budget_value", {
        remaining: formatBudgetAmount(value.remaining),
        max: formatBudgetAmount(value.maxBudget),
        spend: formatBudgetAmount(value.spend),
      })
    }
    return providerError() || transportError() || t("executor.hexin_budget_label")
  })
  return (
    <span
      class="executor-budget-inline"
      data-ui="executor-hexin-budget"
      data-loading={props.loading ? "true" : "false"}
      data-over-budget={budget()?.overBudget ? "true" : "false"}
      data-low-budget={lowBudget() ? "true" : "false"}
      title={title()}
      role="status"
      aria-live="polite"
    >
      <span class="executor-budget-value">{displayText()}</span>
    </span>
  )
}

export function ExecutorSelector() {
  // Two independent disclosures — opening one closes the other so the
  // popover stack never overlaps.
  const mirror = useDisclosure()
  const external = useDisclosure()
  const [providerLoading, setProviderLoading] = createSignal(false)

  const activeID = createMemo(() => sanitizeExecutor(settingsStore.executor))
  const isExternalActive = createMemo(() => activeID() !== INTERNAL_EXECUTOR_ID)
  const externalActiveID = createMemo(() => (isExternalActive() ? activeID() : ""))
  const taskID = createMemo(() => activeTaskID().trim())

  const taskOperatorContextKey = createMemo((): { taskID: string; refresh: number } | null => {
    if (!appStore.connected) return null
    const id = taskID()
    if (!id) return null
    return { taskID: id, refresh: sessionConfigRefreshToken() }
  })
  const [taskOperatorContext, { mutate: mutateTaskOperatorContext, refetch: refetchTaskOperatorContext }] =
    createResource(taskOperatorContextKey, async (key): Promise<TaskOperatorModelContext> => {
      return await getTaskOperatorModelContext(key.taskID)
    })

  const currentTaskOperatorContext = createMemo(() => {
    if (taskOperatorContext.error) return null
    const ctx = taskOperatorContext()
    if (!ctx) return null
    if (ctx.taskID !== taskID()) return null
    return ctx
  })

  const openCorvusModel = createMemo(() => {
    if (hasSelectedTask()) {
      return modelContextID(currentTaskOperatorContext())
    }
    return projectModelFromConfig()
  })
  const [hexinBudgetRefreshTick, setHexinBudgetRefreshTick] = createSignal(0)
  const hexinBudgetBaseKey = createMemo(() => {
    if (!appStore.connected) return null
    const parts = splitModelID(openCorvusModel())
    if (parts.provider !== "hexin" || !parts.name) return null
    return {
      directory: activeDirectory().trim(),
      model: parts.name,
      refresh: sessionConfigRefreshToken(),
      taskID: taskID(),
    }
  })
  createEffect(() => {
    if (!hexinBudgetBaseKey()) return
    const timer = window.setInterval(
      () => setHexinBudgetRefreshTick((value) => value + 1),
      HEXIN_BUDGET_REFRESH_MS,
    )
    onCleanup(() => window.clearInterval(timer))
  })
  const hexinBudgetKey = createMemo(() => {
    const key = hexinBudgetBaseKey()
    return key ? { ...key, tick: hexinBudgetRefreshTick() } : null
  })
  const [hexinBudget] = createResource(hexinBudgetKey, async () => {
    return await getHexinBudget()
  })
  const openCorvusModelPlaceholder = createMemo(() => {
    if (!hasSelectedTask()) return t("agent_models.option_not_set")
    if (taskOperatorContext.error) return t("common.error")
    if (taskOperatorContext.loading) return t("common.loading")
    return t("agent_models.option_not_set")
  })
  const openCorvusModelLabel = createMemo(() => openCorvusModel() || openCorvusModelPlaceholder())
  const mirrorContextError = createMemo(() => (hasSelectedTask() ? taskOperatorContext.error : null))
  const mirrorContextLoading = createMemo(
    () => hasSelectedTask() && taskOperatorContext.loading && !mirrorContextError(),
  )
  const externalModel = createMemo(() => {
    const id = externalActiveID()
    return id ? executorCurrentModel(id) : ""
  })
  const externalChipLabel = createMemo(() =>
    isExternalActive() ? executorLabel(activeID()) : t("executor.external_popover_title"),
  )
  const externalModelPlaceholder = createMemo(() =>
    isExternalActive() ? t("agent_models.option_not_set") : t("executor.external_disabled"),
  )

  const mirrorGroups = createMemo(mirrorProviderGroups)
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
  )
  // The "focused" external executor inside the popover defaults to the active
  // one when there is one, otherwise the first selectable tab so the picker
  // always has something to show. Tracked separately from settingsStore so
  // peeking at another executor's model list doesn't auto-switch the active
  // executor.
  const defaultFocusedExternalID = createMemo(() => {
    const id = externalActiveID()
    if (id) return id
    const firstSelectable = externalTabs().find((tab) => tab.selectable)
    return firstSelectable?.id ?? EXTERNAL_EXECUTOR_IDS[0]
  })
  const [focusedExternalID, setFocusedExternalID] = createSignal(defaultFocusedExternalID())
  createEffect(() => {
    const next = defaultFocusedExternalID()
    if (!external.open()) setFocusedExternalID(next)
  })
  const focusedGroups = createMemo(() => externalProviderGroups(focusedExternalID()))
  const focusedCurrentModel = createMemo(() => executorCurrentModel(focusedExternalID()))

  function openMirror() {
    external.close()
    void ensureProviderInfoLoaded()
    mirror.openIt()
  }
  function openExternal() {
    mirror.close()
    void ensureProviderInfoLoaded()
    setFocusedExternalID(defaultFocusedExternalID())
    external.openIt()
  }

  async function ensureProviderInfoLoaded(): Promise<void> {
    if (providerLoading()) return
    if (appStore.providerCatalog) return
    setProviderLoading(true)
    try {
      await loadProviderInfo()
    } finally {
      setProviderLoading(false)
    }
  }

  async function pickMirrorModel(value: string) {
    if (value === openCorvusModel()) {
      mirror.close()
      return
    }
    // R5.1 item 9: under a selected task the model picker writes ONLY the
    // task-root session overlay returned by the backend task operator model
    // context, never the project /config. If that context is still loading
    // or failed, the picker is disabled instead of falling back to /config.
    if (hasSelectedTask()) {
      const ctx = currentTaskOperatorContext()
      if (!ctx?.agent || !ctx.sessionID) {
        mirror.close()
        return
      }
      await patchSessionConfig(ctx.sessionID, {
        agent: {
          [ctx.agent]: {
            model: value ? value : null,
          },
        },
      })
      if (value) {
        const slash = value.indexOf("/")
        if (slash > 0) {
          mutateTaskOperatorContext({
            ...ctx,
            model: {
              providerID: value.slice(0, slash),
              modelID: value.slice(slash + 1),
            },
          })
        }
      }
      mirror.close()
      return
    }
    await patchConfig({ model: value ? value : null })
    mirror.close()
  }

  // True when a task is selected but the backend task operator context is not
  // yet resolved: the OpenCorvus model picker must be disabled rather than
  // silently writing the project /config.
  const mirrorWriteDisabled = createMemo(() => hasSelectedTask() && !currentTaskOperatorContext()?.sessionID)

  function retryTaskOperatorContext() {
    void refetchTaskOperatorContext()
  }

  async function pickExternalModel(executorID: string, model: string) {
    if (executorID !== activeID()) {
      setSettingsStore("executor", sanitizeExecutor(executorID))
      saveSettings()
    }
    setFocusedExternalID(executorID)
    await setExecutorModel(executorID, model)
    external.close()
  }

  function disableExternal() {
    if (activeID() !== INTERNAL_EXECUTOR_ID) {
      setSettingsStore("executor", sanitizeExecutor(INTERNAL_EXECUTOR_ID))
      saveSettings()
    }
    external.close()
  }

  function changeExternalTab(value: string) {
    if (value === EXTERNAL_DISABLED_TAB_ID) {
      disableExternal()
      return
    }
    setFocusedExternalID(value)
  }

  return (
    <div class="executor-selector-stack" data-ui="executor-selector-stack" data-ui-group="executor-selector">
      <div class="executor-dualbar" data-ui="executor-dualbar">
        <ExecutorChip
          side="mirror"
          disclosure={mirror}
          onActivate={openMirror}
          label={executorLabel(INTERNAL_EXECUTOR_ID)}
          model={openCorvusModel()}
          modelPlaceholder={openCorvusModelPlaceholder()}
          title={t("executor.mirror_chip_title", {
            model: openCorvusModelLabel(),
          })}
          ariaLabel={t("executor.mirror_chip_aria", {
            model: openCorvusModelLabel(),
          })}
          meta={
            <Show when={hexinBudgetKey()}>
              <HexinBudgetInline response={hexinBudget()} loading={hexinBudget.loading} error={hexinBudget.error} />
            </Show>
          }
        >
          <>
            <div class="executor-popover-header">
              <span class="executor-popover-title">{t("executor.mirror_popover_title")}</span>
              <span class="executor-popover-hint">{t("executor.mirror_popover_hint")}</span>
            </div>
            <Show
              when={mirrorGroups().length > 0}
              fallback={
                <div class="executor-popover-empty">
                  {providerLoading() ? t("common.loading") : t("executor.mirror_no_connected_providers")}
                </div>
              }
            >
              <Show
                when={!mirrorContextLoading()}
                fallback={<div class="executor-popover-empty">{t("common.loading")}</div>}
              >
                <Show
                  when={!mirrorContextError()}
                  fallback={
                    <div class="executor-popover-empty executor-popover-error" data-ui="executor-mirror-context-error">
                      <span>{errorMessage(mirrorContextError()) || t("common.error")}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="mini"
                        tone="neutral"
                        onClick={retryTaskOperatorContext}
                      >
                        {t("common.retry")}
                      </Button>
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
              </Show>
            </Show>
          </>
        </ExecutorChip>

        <ExecutorChip
          side="external"
          disclosure={external}
          onActivate={openExternal}
          label={externalChipLabel()}
          model={externalModel()}
          modelPlaceholder={externalModelPlaceholder()}
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
              <span class="executor-popover-title">{t("executor.external_popover_title")}</span>
              <span class="executor-popover-hint">{t("executor.external_popover_hint")}</span>
            </div>
            <Tabs
              size="sm"
              tone="neutral"
              value={isExternalActive() ? focusedExternalID() : EXTERNAL_DISABLED_TAB_ID}
              onValueChange={changeExternalTab}
              data-ui="executor-popover-tabs"
            >
              <Tab
                value={EXTERNAL_DISABLED_TAB_ID}
                active={!isExternalActive()}
                size="sm"
                tone="neutral"
                data-ui="executor-popover-tab"
              >
                {t("executor.external_disabled")}
              </Tab>
              <For each={externalTabs()}>
                {(tab) => (
                  <Tab
                    value={tab.id}
                    active={tab.id === focusedExternalID()}
                    size="sm"
                    tone="neutral"
                    data-ui="executor-popover-tab"
                    disabled={!tab.selectable}
                    title={tab.title}
                  >
                    {tab.label}
                  </Tab>
                )}
              </For>
            </Tabs>
            <Show
              when={isExternalActive()}
              fallback={<div class="executor-popover-empty">{t("executor.external_disabled_hint")}</div>}
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
    </div>
  )
}

interface ExecutorChipProps {
  side: "mirror" | "external"
  disclosure: Disclosure
  onActivate: () => void
  label: string
  model: string
  modelPlaceholder: string
  title: string
  ariaLabel: string
  disabled?: boolean
  meta?: any
  children: any
}

function ExecutorChip(props: ExecutorChipProps) {
  const [slotRef, setSlotRef] = createSignal<HTMLElement>()

  return (
    <Popover.Root
      open={props.disclosure.open()}
      onOpenChange={(open) => {
        if (open) {
          if (!props.disabled) props.onActivate()
          return
        }
        props.disclosure.close()
      }}
      anchorRef={slotRef}
      placement="top-start"
      gutter={6}
      slide={false}
    >
      <div
        ref={setSlotRef}
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
          <span class="executor-chip-copy">
            <span class="executor-chip-label-row">
              <span class="executor-chip-label">{props.label}</span>
              {props.meta}
            </span>
            <ChipModel model={props.model} placeholder={props.modelPlaceholder} />
          </span>
          <ChevronCaret open={props.disclosure.open()} />
        </Popover.Trigger>
        <Popover.Content class="executor-popover" data-section={props.side}>
          {props.children}
        </Popover.Content>
      </div>
    </Popover.Root>
  )
}

interface ProviderModelGroupProps {
  group: ProviderGroup
  currentModel: string
  disabled?: boolean
  onPick: (modelID: string) => void
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
              <span class="executor-popover-model-name">{splitModelID(modelID).name}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
