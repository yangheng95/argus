// ── ProvidersPanel ──
// Solid.js component for managing custom LLM providers.
// Allows adding, editing, and removing OpenAI-compatible providers
// via the opencorvus config system (PATCH /config → provider field).

import { createMemo, createSignal, For, Show } from "solid-js"
import { t } from "../../utils/i18n"
import { appStore, dismissProviderAuth, setAppStore } from "../../store/app"
import { updateConfig } from "../../services/config"
import { apiJson, ApiError } from "../../services/api"
import { loadProviderInfo } from "../../services/init"
import {
  authenticateSelectedProvider,
  providerAuthMethods,
  providerEntry,
  providerState,
  testProviderConnection,
  type AuthDialogCallbacks,
  type ProviderTestResult,
} from "../../services/llm"
import { nativeConfirm, nativeOpen, nativePrompt, nativeSelect } from "../../utils/native"
import { nativeMessage } from "../../services/app-dialog"
import { Icon } from "../Icon"
import { Button } from "../ui/Button"
import { SurfaceHeader } from "../ui/SurfaceHeader"
import { SettingsGroup, SettingsPanel, SettingsPill, SettingsRow, type SettingsPillTone } from "./primitives"

function describeFailure(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return String(e)
}

function providerStatusTone(tone: string | undefined): SettingsPillTone {
  if (tone === "active" || tone === "ready") return "accent"
  if (tone === "error") return "bad"
  if (tone === "warn") return "warn"
  return "neutral"
}

interface ProviderModel {
  name: string
  tool_call: boolean
}

interface CustomProvider {
  name: string
  api: string
  env: string[]
  options?: {
    apiKey?: string
    [key: string]: unknown
  }
  models: Record<string, ProviderModel>
}

export default function ProvidersPanel() {
  const [saving, setSaving] = createSignal(false)
  const [editing, setEditing] = createSignal<string | null>(null)
  const [showAdd, setShowAdd] = createSignal(false)
  // Per-provider connectivity-test state. testing/results are keyed by
  // provider id so the operator can run several tests in parallel and
  // see each result tagged to its row. Cleared when the provider is
  // edited or removed (covered by row remount via the For key).
  const [testing, setTesting] = createSignal<Set<string>>(new Set())
  const [testResults, setTestResults] = createSignal<Map<string, ProviderTestResult>>(new Map())
  const [authing, setAuthing] = createSignal<Set<string>>(new Set())
  const [savingKey, setSavingKey] = createSignal<Set<string>>(new Set())
  const [apiKeyInputs, setApiKeyInputs] = createSignal<Map<string, string>>(new Map())
  // Surface every save / delete / form-validation failure into the UI.
  // Before this signal existed, handleSave/handleDelete only `console.error`d
  // (Tauri WebView users have no devtools), and a silent `return` on missing
  // id / api in handleSave produced a button that did nothing. Anything
  // user-visible writes here; clearForm / startAdd / startEdit / cancel
  // resets it so a new attempt starts clean.
  const [formError, setFormError] = createSignal<string | null>(null)
  // Manual catalog refresh state. The runtime no longer hits models.dev
  // on startup or on a timer — `handleRefreshCatalog` is the only path
  // that touches the network for the registry, so the UI is the
  // authoritative trigger and needs to expose the result + timing back
  // to the operator. `null` lastRefreshedAt = never refreshed in this
  // session; we deliberately don't persist across reloads to keep the
  // signal honest about what the running process saw.
  const [refreshing, setRefreshing] = createSignal(false)
  const [lastRefreshedAt, setLastRefreshedAt] = createSignal<number | null>(null)
  const [providerSearch, setProviderSearch] = createSignal("")
  const [discoveringModels, setDiscoveringModels] = createSignal(false)
  const [formNotice, setFormNotice] = createSignal<string | null>(null)

  function formatRelative(ms: number): string {
    const diff = Date.now() - ms
    if (diff < 60_000) return t("provider.refresh.just_now")
    const mins = Math.floor(diff / 60_000)
    if (mins < 60) return t("provider.refresh.minutes_ago", { n: mins })
    const hours = Math.floor(mins / 60)
    return t("provider.refresh.hours_ago", { n: hours })
  }

  async function handleRefreshCatalog() {
    if (refreshing()) return
    setFormError(null)
    setRefreshing(true)
    try {
      const result = (await apiJson("provider/refresh", { method: "POST" })) as {
        ok: boolean
        fetchedAt?: number
        error?: string
      }
      if (!result.ok) {
        setFormError(t("provider.refresh.failed", { reason: result.error || "unknown" }))
        return
      }
      setLastRefreshedAt(result.fetchedAt ?? Date.now())
      await loadProviderInfo()
    } catch (e) {
      setFormError(t("provider.refresh.failed", { reason: describeFailure(e) }))
    } finally {
      setRefreshing(false)
    }
  }

  async function handleTest(providerId: string, models: Record<string, ProviderModel>) {
    const modelID = Object.keys(models)[0]
    if (!modelID) {
      setTestResults((prev) => {
        const next = new Map(prev)
        next.set(providerId, { ok: false, message: t("provider.test.no_models") })
        return next
      })
      return
    }
    setTesting((prev) => new Set(prev).add(providerId))
    try {
      const result = await testProviderConnection(providerId, modelID)
      setTestResults((prev) => {
        const next = new Map(prev)
        next.set(providerId, result)
        return next
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setTestResults((prev) => {
        const next = new Map(prev)
        next.set(providerId, { ok: false, message: msg })
        return next
      })
    } finally {
      setTesting((prev) => {
        const next = new Set(prev)
        next.delete(providerId)
        return next
      })
    }
  }

  const authCallbacks: AuthDialogCallbacks = {
    nativePrompt: (message, opts) => nativePrompt(message, opts),
    nativeSelect: (message, opts) =>
      nativeSelect(message, {
        ...opts,
        options: opts.options.map((item) => ({
          value: item.value,
          label: item.hint ? `${item.label} - ${item.hint}` : item.label,
        })),
      }),
    nativeConfirm: (message, opts) => nativeConfirm(message, opts),
    nativeOpen,
    showLlmNotice: (message, tone = "info") => {
      void nativeMessage(message, { title: t("llm.title"), kind: tone })
    },
    onAuthCancelled: dismissProviderAuth,
  }

  async function refreshAuthState() {
    await loadProviderInfo()
  }

  async function handleAuth(providerId: string) {
    if (!providerAuthMethods(providerId).length || authing().has(providerId)) return
    setFormError(null)
    setAuthing((prev) => new Set(prev).add(providerId))
    try {
      const ok = await authenticateSelectedProvider(providerId, authCallbacks)
      if (ok) {
        await refreshAuthState()
        await nativeMessage(t("llm.status.connected"), {
          title: t("llm.title"),
          kind: "success",
        })
      }
    } catch (e) {
      setFormError(t("provider.auth.failed", { reason: describeFailure(e) }))
    } finally {
      setAuthing((prev) => {
        const next = new Set(prev)
        next.delete(providerId)
        return next
      })
    }
  }

  // Form state for add/edit
  const [formId, setFormId] = createSignal("")
  const [formName, setFormName] = createSignal("")
  const [formApi, setFormApi] = createSignal("")
  const [formEnvKey, setFormEnvKey] = createSignal("")
  const [formApiKey, setFormApiKey] = createSignal("")
  const [formModels, setFormModels] = createSignal("")

  function providerConfigs(): Record<string, any> {
    const cfg = appStore.config
    const p = cfg?.provider
    if (!p || typeof p !== "object" || Array.isArray(p)) return {}
    return p as Record<string, any>
  }

  function isCustomProviderConfig(value: any): value is CustomProvider {
    return (
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (typeof value.api === "string" ||
        (value.models && typeof value.models === "object" && !Array.isArray(value.models)))
    )
  }

  function disabledProviderIds(): Set<string> {
    const disabled = appStore.config?.disabled_providers
    if (!Array.isArray(disabled)) return new Set()
    return new Set(disabled.filter((id: unknown): id is string => typeof id === "string"))
  }

  function configProviders(): Record<string, CustomProvider> {
    const out: Record<string, CustomProvider> = {}
    const disabled = disabledProviderIds()
    for (const [id, value] of Object.entries(providerConfigs())) {
      if (disabled.has(id)) continue
      if (isCustomProviderConfig(value)) out[id] = value
    }
    return out
  }

  function catalogProviders(): any[] {
    const cat = appStore.providerCatalog as any
    return Array.isArray(cat?.all) ? cat.all : []
  }

  function normalizeSearch(value: unknown): string {
    return String(value ?? "")
      .trim()
      .toLowerCase()
  }

  function providerModelIds(models: Record<string, unknown> | undefined): string[] {
    if (!models || typeof models !== "object" || Array.isArray(models)) return []
    return Object.keys(models)
  }

  function providerMatchesSearch(parts: Array<unknown>): boolean {
    const q = normalizeSearch(providerSearch())
    if (!q) return true
    return parts.some((part) => normalizeSearch(part).includes(q))
  }

  function resetForm() {
    setFormId("")
    setFormName("")
    setFormApi("")
    setFormEnvKey("")
    setFormApiKey("")
    setFormModels("")
    setFormError(null)
    setFormNotice(null)
  }

  function startAdd() {
    resetForm()
    setEditing(null)
    setShowAdd(true)
  }

  function startEdit(id: string) {
    const p = configProviders()[id]
    if (!p) return
    setFormId(id)
    setFormName(p.name || "")
    setFormApi(p.api || "")
    setFormEnvKey(p.env?.[0] || "")
    setFormApiKey("")
    const modelStr = Object.entries(p.models || {})
      .map(([mid, m]) => `${mid}:${m.name || mid}`)
      .join("\n")
    setFormModels(modelStr)
    setEditing(id)
    setShowAdd(true)
    setFormError(null)
    setFormNotice(null)
  }

  function parseModels(text: string): Record<string, ProviderModel> {
    const models: Record<string, ProviderModel> = {}
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const colonIdx = trimmed.indexOf(":")
      const id = colonIdx > 0 ? trimmed.slice(0, colonIdx).trim() : trimmed
      const name = colonIdx > 0 ? trimmed.slice(colonIdx + 1).trim() : id
      if (id) {
        models[id] = { name: name || id, tool_call: true }
      }
    }
    return models
  }

  function sanitizeProviderId(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
  }

  function providerIdFromApi(value: string): string {
    try {
      const host = new URL(value.trim()).hostname
      const parts = host.split(".").filter(Boolean)
      const source = parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? "")
      return sanitizeProviderId(source)
    } catch {
      return ""
    }
  }

  function formProviderId(): string {
    return editing() || sanitizeProviderId(formId()) || sanitizeProviderId(formName()) || providerIdFromApi(formApi())
  }

  async function handleDiscoverModels() {
    if (discoveringModels()) return
    setFormError(null)
    setFormNotice(null)
    const api = formApi().trim()
    if (!api) {
      setFormError(t("provider.form.error.api_required"))
      return
    }
    setDiscoveringModels(true)
    try {
      const result = (await apiJson("provider/discover-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api,
          apiKey: formApiKey().trim() || undefined,
          providerID: formProviderId() || undefined,
        }),
      })) as { ok: boolean; models: string[]; count: number; error?: string }
      if (!result.ok) {
        setFormError(t("provider.form.discover.failed", { reason: result.error || "unknown" }))
        return
      }
      setFormModels(result.models.join("\n"))
      setFormNotice(t("provider.form.discover.success", { count: result.count }))
    } catch (e) {
      setFormError(t("provider.form.discover.failed", { reason: describeFailure(e) }))
    } finally {
      setDiscoveringModels(false)
    }
  }

  async function handleSave() {
    setFormError(null)
    setFormNotice(null)
    const id = formProviderId()
    if (!id) {
      setFormError(t("provider.form.error.id_required"))
      return
    }
    if (!formApi().trim()) {
      setFormError(t("provider.form.error.api_required"))
      return
    }
    const models = parseModels(formModels())
    if (Object.keys(models).length === 0) {
      setFormError(t("provider.form.error.models_required"))
      return
    }

    setSaving(true)
    try {
      const baseConfig = providerConfigWithoutApiKey(id)
      const provider: CustomProvider = {
        name: formName().trim() || id,
        api: formApi().trim().replace(/\/+$/, ""),
        env: formEnvKey().trim() ? [formEnvKey().trim()] : [],
        options:
          baseConfig.options && typeof baseConfig.options === "object" && !Array.isArray(baseConfig.options)
            ? { ...(baseConfig.options as Record<string, unknown>) }
            : {},
        models,
      }
      const apiKey = formApiKey().trim()
      if (provider.options && Object.keys(provider.options).length === 0) delete provider.options

      await updateConfig((cfg) => {
        removeDisabledProvider(cfg, id)
        cfg.provider = cfg.provider || {}
        cfg.provider[id] = provider
      })
      if (apiKey) {
        await apiJson(`auth/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "api", key: apiKey }),
        })
        await refreshAuthState()
      }

      setShowAdd(false)
      resetForm()
      setEditing(null)
    } catch (e) {
      console.error("[providers] save failed", e)
      setFormError(t("provider.form.error.save_failed", { reason: describeFailure(e) }))
    } finally {
      setSaving(false)
    }
  }

  function providerConfig(id: string): any {
    return providerConfigs()[id]
  }

  function providerConfigWithoutApiKey(id: string): Record<string, unknown> {
    const current = providerConfig(id)
    if (!current || typeof current !== "object" || Array.isArray(current)) return {}
    const next = { ...current } as Record<string, unknown>
    const options =
      next.options && typeof next.options === "object" && !Array.isArray(next.options)
        ? { ...(next.options as Record<string, unknown>) }
        : null
    if (options && Object.hasOwn(options, "apiKey")) delete options.apiKey
    if (options && Object.keys(options).length > 0) next.options = options
    else delete next.options
    return next
  }

  function removeProjectApiKeyOverride(cfg: Record<string, any>, providerId: string): void {
    const providers =
      cfg.provider && typeof cfg.provider === "object" && !Array.isArray(cfg.provider) ? cfg.provider : null
    if (!providers) return
    const current =
      providers[providerId] && typeof providers[providerId] === "object" && !Array.isArray(providers[providerId])
        ? { ...providers[providerId] }
        : null
    if (!current) return
    const options =
      current.options && typeof current.options === "object" && !Array.isArray(current.options)
        ? { ...current.options }
        : null
    if (options && Object.hasOwn(options, "apiKey")) delete options.apiKey
    if (options && Object.keys(options).length > 0) current.options = options
    else delete current.options
    if (Object.keys(current).length === 0) delete providers[providerId]
    else providers[providerId] = current
    if (Object.keys(providers).length === 0) delete cfg.provider
  }

  function removeDisabledProvider(cfg: Record<string, any>, providerId: string): void {
    if (!Array.isArray(cfg.disabled_providers)) return
    cfg.disabled_providers = cfg.disabled_providers.filter((id: unknown) => id !== providerId)
    if (cfg.disabled_providers.length === 0) delete cfg.disabled_providers
  }

  function addDisabledProvider(cfg: Record<string, any>, providerId: string): void {
    const disabled = Array.isArray(cfg.disabled_providers)
      ? cfg.disabled_providers.filter((id: unknown): id is string => typeof id === "string")
      : []
    if (!disabled.includes(providerId)) disabled.push(providerId)
    cfg.disabled_providers = disabled
  }

  function modelBelongsToProvider(value: unknown, providerId: string): boolean {
    return typeof value === "string" && value.startsWith(`${providerId}/`)
  }

  function removeProviderModelReferences(cfg: Record<string, any>, providerId: string): void {
    if (modelBelongsToProvider(cfg.model, providerId)) delete cfg.model
    if (modelBelongsToProvider(cfg.small_model, providerId)) delete cfg.small_model
    const agents = cfg.agent && typeof cfg.agent === "object" && !Array.isArray(cfg.agent) ? cfg.agent : null
    if (!agents) return
    for (const [agentId, agent] of Object.entries(agents)) {
      if (!agent || typeof agent !== "object" || Array.isArray(agent)) continue
      if (modelBelongsToProvider((agent as Record<string, unknown>).model, providerId)) {
        const next = { ...(agent as Record<string, unknown>) }
        delete next.model
        if (Object.keys(next).length === 0) delete agents[agentId]
        else agents[agentId] = next
      }
    }
    if (Object.keys(agents).length === 0) delete cfg.agent
  }

  function providerHasSavedApiKey(id: string): boolean {
    const override = providerConfig(id)?.options?.apiKey
    if (typeof override === "string" && override.trim() !== "") return true
    const entry = providerEntry(id)
    return typeof entry?.key === "string" && entry.key.trim() !== ""
  }

  function apiKeyInput(id: string): string {
    return apiKeyInputs().get(id) ?? ""
  }

  function setApiKeyInput(id: string, value: string): void {
    setApiKeyInputs((prev) => {
      const next = new Map(prev)
      next.set(id, value)
      return next
    })
  }

  function clearApiKeyInput(id: string): void {
    setApiKeyInputs((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }

  async function handleSaveApiKey(providerId: string) {
    const value = apiKeyInput(providerId).trim()
    if (!value || savingKey().has(providerId)) return
    setFormError(null)
    setSavingKey((prev) => new Set(prev).add(providerId))
    try {
      await apiJson(`auth/${providerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "api", key: value }),
      })
      await updateConfig((cfg) => {
        removeProjectApiKeyOverride(cfg, providerId)
      })
      if (providerId === "hexin") {
        try {
          const refresh = (await apiJson("provider/hexin/refresh", { method: "POST" })) as {
            ok: boolean
            error?: string
          }
          if (!refresh.ok) {
            setFormError(t("provider.refresh.failed", { reason: refresh.error || "unknown" }))
          }
        } catch (error) {
          setFormError(t("provider.refresh.failed", { reason: describeFailure(error) }))
        }
      }
      await refreshAuthState()
      clearApiKeyInput(providerId)
    } catch (e) {
      setFormError(t("provider.api_key.save_failed", { reason: describeFailure(e) }))
    } finally {
      setSavingKey((prev) => {
        const next = new Set(prev)
        next.delete(providerId)
        return next
      })
    }
  }

  function ApiKeyEditor(props: { providerId: string }) {
    const id = () => props.providerId
    return (
      <div class="provider-api-key-row">
        <label class="field provider-api-key-field">
          <span class="field-label">{t("provider.api_key.label")}</span>
          <input
            class="field-input"
            type="password"
            autocomplete="off"
            placeholder={
              providerHasSavedApiKey(id())
                ? t("provider.api_key.placeholder_configured")
                : t("provider.api_key.placeholder_empty")
            }
            value={apiKeyInput(id())}
            onInput={(e) => setApiKeyInput(id(), e.currentTarget.value)}
            data-testid={`provider-api-key-input-${id()}`}
          />
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          tone="neutral"
          onClick={() => void handleSaveApiKey(id())}
          disabled={savingKey().has(id()) || !apiKeyInput(id()).trim()}
          data-testid={`provider-api-key-save-${id()}`}
        >
          {savingKey().has(id()) ? t("common.loading") : t("provider.api_key.save")}
        </Button>
      </div>
    )
  }

  async function handleDelete(id: string) {
    setFormError(null)
    setSaving(true)
    try {
      await updateConfig((cfg) => {
        if (cfg.provider) {
          delete cfg.provider[id]
          if (Object.keys(cfg.provider).length === 0) delete cfg.provider
        }
        addDisabledProvider(cfg, id)
        removeProviderModelReferences(cfg, id)
      })
      await apiJson(`auth/${id}`, { method: "DELETE" })
      await refreshAuthState()
      clearApiKeyInput(id)
      setTestResults((prev) => {
        const next = new Map(prev)
        next.delete(id)
        return next
      })
    } catch (e) {
      console.error("[providers] delete failed", e)
      setFormError(t("provider.form.error.delete_failed", { id, reason: describeFailure(e) }))
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setShowAdd(false)
    resetForm()
    setEditing(null)
  }

  const providerEntries = createMemo(() =>
    Object.entries(configProviders()).filter(([id, provider]) =>
      providerMatchesSearch([
        id,
        provider.name,
        provider.api,
        provider.env?.join(" "),
        providerModelIds(provider.models).join(" "),
      ]),
    ),
  )
  const catalogEntries = createMemo(() => {
    const custom = new Set(Object.keys(configProviders()))
    return catalogProviders()
      .filter((p: any) => p && typeof p.id === "string" && !custom.has(p.id))
      .map((p: any) => ({
        id: p.id,
        name: p.name || p.id,
        source: p.source || "auto",
        modelIds: providerModelIds(p.models),
        modelCount: providerModelIds(p.models).length,
        authMethods: providerAuthMethods(p.id).length,
        status: providerState(p.id),
      }))
      .filter((p) =>
        providerMatchesSearch([p.id, p.name, p.source, p.status.label, p.status.detail, p.modelIds.join(" ")]),
      )
  })
  const totalProviderCount = createMemo(() => Object.keys(configProviders()).length + catalogProviders().length)
  const visibleProviderCount = createMemo(() => providerEntries().length + catalogEntries().length)
  const hasProviderSearch = createMemo(() => providerSearch().trim().length > 0)
  const configuredProviderCount = createMemo(() => {
    const configured = new Set(Object.keys(providerConfigs()))
    const connected = appStore.providerCatalog?.connected
    if (Array.isArray(connected)) {
      for (const providerId of connected) {
        if (typeof providerId === "string" && providerId.trim()) configured.add(providerId)
      }
    }
    return configured.size
  })
  const catalogProviderCount = createMemo(() => catalogProviders().length)

  function modelSummary(modelIds: string[]): string {
    if (modelIds.length === 0) return t("provider.label.no_models")
    return modelIds.slice(0, 8).join(", ")
  }

  function hasMoreModels(modelIds: string[]): boolean {
    return modelIds.length > 8
  }

  return (
    <SettingsPanel class="general-panel provider-panel">
      <SettingsGroup class="provider-settings-flat">
        <div class="provider-command">
          <div class="provider-command-main">
            <div class="provider-title-block">
              <SurfaceHeader
                variant="settings-group"
                title={t("provider.title")}
                actions={
                  <div class="provider-toolbar-count">
                    {t("provider.search.count", { shown: visibleProviderCount(), total: totalProviderCount() })}
                  </div>
                }
              />
            </div>
            <div class="provider-stat-strip" aria-label={t("provider.stats.label")}>
              <div class="provider-stat">
                <span class="provider-stat-value">{configuredProviderCount()}</span>
                <span class="provider-stat-label">{t("provider.stats.configured")}</span>
              </div>
              <div class="provider-stat">
                <span class="provider-stat-value">{catalogProviderCount()}</span>
                <span class="provider-stat-label">{t("provider.stats.catalog")}</span>
              </div>
            </div>
          </div>
          <div class="provider-head-actions">
            <Show when={lastRefreshedAt()}>
              {(ts) => (
                <span class="provider-refresh-meta" title={new Date(ts()).toLocaleString()}>
                  {t("provider.refresh.last", { when: formatRelative(ts()) })}
                </span>
              )}
            </Show>
            <Button
              type="button"
              variant="outline"
              size="sm"
              tone="neutral"
              data-ui="provider-refresh-button"
              onClick={() => void handleRefreshCatalog()}
              disabled={refreshing()}
              title={t("provider.refresh.title")}
              data-spinning={refreshing() ? "true" : "false"}
            >
              <span class="provider-refresh-icon" aria-hidden="true">
                <Icon name="refresh" size={13} />
              </span>
              {refreshing() ? t("provider.refresh.refreshing") : t("provider.refresh.button")}
            </Button>
            <Button type="button" variant="solid" size="sm" tone="accent" onClick={startAdd}>
              <Icon name="plus" size={13} />
              {t("provider.action.add")}
            </Button>
          </div>
          <label class="provider-search-field">
            <span class="provider-search-icon" aria-hidden="true">
              <Icon name="search" size={14} />
            </span>
            <input
              class="field-input provider-search-input"
              type="search"
              value={providerSearch()}
              placeholder={t("provider.search.placeholder")}
              aria-label={t("provider.search.label")}
              onInput={(e) => setProviderSearch(e.currentTarget.value)}
              data-testid="provider-search-input"
            />
            <Show when={hasProviderSearch()}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                tone="neutral"
                data-chrome="icon-action"
                data-ui="provider-search-clear"
                onClick={() => setProviderSearch("")}
                title={t("common.clear")}
                aria-label={t("common.clear")}
                data-testid="provider-search-clear"
              >
                <Icon name="close" size={11} />
              </Button>
            </Show>
          </label>
        </div>

        <Show when={providerEntries().length === 0 && catalogEntries().length === 0 && !showAdd()}>
          <div class="provider-empty">
            {hasProviderSearch()
              ? t("provider.search.no_results", { query: providerSearch().trim() })
              : t("provider.empty_message")}
          </div>
        </Show>

        <Show when={formError() && !showAdd()}>
          {(msg) => (
            <div class="provider-form-error" role="alert" aria-live="polite">
              {msg()}
            </div>
          )}
        </Show>

        <Show when={providerEntries().length > 0}>
          <div class="provider-flat-section">
            <div class="provider-section-head">
              <div>
                <div class="provider-section-label">{t("provider.section.custom")}</div>
                <div class="provider-section-count">
                  {t("provider.section.count", { count: providerEntries().length })}
                </div>
              </div>
            </div>
            <div class="provider-flat-list">
              <For each={providerEntries()}>
                {([id, provider]) => {
                  const modelIds = Object.keys(provider.models || {})
                  const status = providerAuthMethods(id).length > 0 ? providerState(id, undefined) : null
                  return (
                    <SettingsRow
                      class="provider-settings-row"
                      data-testid={`provider-custom-row-${id}`}
                      customContent
                      interactive
                    >
                      <div class="provider-row-main">
                        <div class="provider-row-title-line">
                          <strong class="provider-row-title">{provider.name || id}</strong>
                          <span class="provider-row-id">{id}</span>
                        </div>
                        <div class="provider-row-meta">
                          <span>
                            {t("provider.label.api")}: {provider.api}
                          </span>
                          <Show when={provider.env?.length}>
                            <span>
                              {t("provider.label.env")}: {provider.env.join(", ")}
                            </span>
                          </Show>
                        </div>
                      </div>
                      <div class="provider-row-summary">
                        <SettingsPill class="provider-model-count">
                          {t("provider.models.count", { count: modelIds.length })}
                        </SettingsPill>
                        <Show when={status}>
                          {(s) => (
                            <SettingsPill class="provider-auth-status" tone={providerStatusTone(s().tone)}>
                              {s().label}: {s().detail}
                            </SettingsPill>
                          )}
                        </Show>
                      </div>
                      <div class="provider-row-actions">
                        <Show when={providerAuthMethods(id).length > 0}>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            tone="neutral"
                            onClick={() => void handleAuth(id)}
                            disabled={authing().has(id)}
                            title={t("llm.auth_connect_title")}
                            data-testid={`provider-auth-${id}`}
                          >
                            {authing().has(id) ? t("common.loading") : t("llm.auth_connect")}
                          </Button>
                        </Show>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          tone="neutral"
                          onClick={() => void handleTest(id, provider.models || {})}
                          disabled={testing().has(id)}
                          title={t("provider.test.button_title")}
                        >
                          {testing().has(id) ? t("provider.test.testing") : t("provider.test.button")}
                        </Button>
                        <Button type="button" variant="outline" size="sm" tone="neutral" onClick={() => startEdit(id)}>
                          {t("common.edit")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          tone="danger"
                          onClick={() => handleDelete(id)}
                          disabled={saving()}
                        >
                          {t("common.delete")}
                        </Button>
                      </div>
                      <div class="provider-row-key">
                        <ApiKeyEditor providerId={id} />
                      </div>
                      <Show when={testResults().get(id)}>
                        {(result) => (
                          <div
                            class="provider-test-result"
                            data-ok={result().ok ? "true" : "false"}
                            role="status"
                            aria-live="polite"
                          >
                            <span class="provider-test-result-icon" aria-hidden="true">
                              <Icon name={result().ok ? "status-completed" : "status-failed"} size={13} />
                            </span>
                            <span class="provider-test-result-msg">
                              {result().ok
                                ? result().message || t("provider.test.success")
                                : result().message || t("provider.test.failed")}
                            </span>
                          </div>
                        )}
                      </Show>
                      <div class="provider-row-models" title={modelIds.join(", ")}>
                        {modelSummary(modelIds)}
                        <Show when={hasMoreModels(modelIds)}>
                          <span class="provider-model-overflow">
                            {t("provider.models.more", { count: modelIds.length - 8 })}
                          </span>
                        </Show>
                      </div>
                    </SettingsRow>
                  )
                }}
              </For>
            </div>
          </div>
        </Show>

        {/* ── Add / Edit Form ── */}
        <Show when={showAdd()}>
          <div class="provider-add-card">
            <h4 class="provider-add-title">
              {editing() ? t("provider.form.edit_title", { id: editing() ?? "" }) : t("provider.form.add_title")}
            </h4>

            <label class="field">
              <span class="field-label">{t("provider.form.api_label")}</span>
              <input
                class="field-input"
                type="url"
                pattern="https?://.+"
                required
                placeholder={t("provider.form.api_placeholder", { value: "https://my-gateway.com/v1" })}
                value={formApi()}
                onInput={(e) => setFormApi(e.currentTarget.value)}
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim()
                  e.currentTarget.setCustomValidity(
                    v && !/^https?:\/\/.+/i.test(v) ? "API base URL must start with http:// or https://" : "",
                  )
                }}
              />
            </label>

            <label class="field">
              <span class="field-label">{t("provider.api_key.label")}</span>
              <input
                class="field-input"
                type="password"
                autocomplete="off"
                placeholder={
                  editing() && providerHasSavedApiKey(editing()!)
                    ? t("provider.api_key.placeholder_configured")
                    : t("provider.api_key.placeholder_empty")
                }
                value={formApiKey()}
                onInput={(e) => setFormApiKey(e.currentTarget.value)}
              />
            </label>

            <details class="provider-advanced-fields">
              <summary class="provider-advanced-summary">
                <span>{t("provider.form.advanced")}</span>
                <span class="provider-advanced-derived">
                  {t("provider.form.advanced_id", { id: formProviderId() || t("provider.form.advanced_id_pending") })}
                </span>
              </summary>

              <div class="provider-advanced-grid">
                <Show when={!editing()}>
                  <label class="field">
                    <span class="field-label">{t("provider.form.id_label")}</span>
                    <input
                      class="field-input"
                      type="text"
                      placeholder={t("provider.form.id_placeholder", { value: "opentoken" })}
                      value={formId()}
                      onInput={(e) => setFormId(e.currentTarget.value)}
                    />
                  </label>
                </Show>

                <label class="field">
                  <span class="field-label">{t("provider.form.name_label")}</span>
                  <input
                    class="field-input"
                    type="text"
                    placeholder={t("provider.form.name_placeholder", { value: "OpenToken CN2" })}
                    value={formName()}
                    onInput={(e) => setFormName(e.currentTarget.value)}
                  />
                </label>

                <label class="field">
                  <span class="field-label">{t("provider.form.env_label")}</span>
                  <input
                    class="field-input"
                    type="text"
                    placeholder={t("provider.form.env_placeholder", { value: "OPENTOKEN_API_KEY" })}
                    value={formEnvKey()}
                    onInput={(e) => setFormEnvKey(e.currentTarget.value)}
                  />
                </label>
              </div>
            </details>

            <label class="field">
              <span class="field-label">{t("provider.form.models_label")}</span>
              <div class="provider-model-field-head">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  tone="neutral"
                  onClick={() => void handleDiscoverModels()}
                  disabled={discoveringModels() || !formApi().trim()}
                  data-testid="provider-discover-models"
                >
                  <Icon name="refresh" size={13} />
                  {discoveringModels() ? t("provider.form.discover.running") : t("provider.form.discover.button")}
                </Button>
              </div>
              <textarea
                class="field-input provider-models-textarea"
                rows={4}
                placeholder={"gpt-5.4-mini:GPT-5.4 Mini\ngpt-5.4:GPT-5.4"}
                value={formModels()}
                onInput={(e) => {
                  setFormModels(e.currentTarget.value)
                  setFormNotice(null)
                }}
              />
            </label>

            <Show when={formNotice()}>
              {(msg) => (
                <div class="provider-form-notice" role="status" aria-live="polite">
                  {msg()}
                </div>
              )}
            </Show>

            <Show when={formError()}>
              {(msg) => (
                <div class="provider-form-error" role="alert" aria-live="polite">
                  {msg()}
                </div>
              )}
            </Show>

            <div class="dialog-actions compact provider-form-actions">
              <Button type="button" variant="outline" size="sm" tone="neutral" onClick={cancel}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="solid"
                size="sm"
                tone="accent"
                onClick={handleSave}
                disabled={saving() || !formProviderId() || !formApi().trim()}
              >
                {saving() ? t("common.saving") : editing() ? t("provider.form.update") : t("provider.form.add")}
              </Button>
            </div>
          </div>
        </Show>
        <Show when={catalogEntries().length > 0}>
          <div class="provider-flat-section">
            <div class="provider-section-head">
              <div>
                <div class="provider-section-label">{t("provider.section.catalog")}</div>
                <div class="provider-section-count">
                  {t("provider.section.count", { count: catalogEntries().length })}
                </div>
              </div>
              <div class="provider-catalog-hint">{t("provider.catalog.hint")}</div>
            </div>
            <div class="provider-flat-list">
              <For each={catalogEntries()}>
                {(p) => (
                  <SettingsRow
                    class="provider-settings-row provider-catalog-row"
                    data-testid={`provider-catalog-row-${p.id}`}
                    customContent
                    interactive
                  >
                    <div class="provider-row-main">
                      <div class="provider-row-title-line">
                        <strong class="provider-row-title">{p.name}</strong>
                        <span class="provider-row-id">{p.id}</span>
                      </div>
                      <div class="provider-row-meta">
                        <span>{p.source}</span>
                      </div>
                    </div>
                    <div class="provider-row-summary">
                      <SettingsPill class="provider-model-count">
                        {t("provider.models.count", { count: p.modelCount })}
                      </SettingsPill>
                      <SettingsPill class="provider-auth-status" tone={providerStatusTone(p.status.tone)}>
                        {p.status.label}: {p.status.detail}
                      </SettingsPill>
                    </div>
                    <div class="provider-row-actions">
                      <Show when={p.authMethods > 0}>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          tone="neutral"
                          onClick={() => void handleAuth(p.id)}
                          disabled={authing().has(p.id)}
                          title={t("llm.auth_connect_title")}
                          data-testid={`provider-auth-${p.id}`}
                        >
                          {authing().has(p.id) ? t("common.loading") : t("llm.auth_connect")}
                        </Button>
                      </Show>
                    </div>
                    <div class="provider-row-key">
                      <ApiKeyEditor providerId={p.id} />
                    </div>
                  </SettingsRow>
                )}
              </For>
            </div>
          </div>
        </Show>
      </SettingsGroup>
    </SettingsPanel>
  )
}
