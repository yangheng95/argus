// ── LLM Service ──
// Pure logic extracted
// and provider authentication flows.
// Replaces functions:
// providerEntry, providerLabel, providerConnected, providerAuthMethods,
// providerState, providerPreferredOauthMethod, providerAuthPrompt,
// providerAuthInputs, authorizeProvider, executeProviderAuth,
// runProviderAuthMethod, authenticateSelectedProvider, testProviderConnection,
// llmSelection, llmSelectionKey, llmCurrent.
// DOM-dependent functions (llmSelection, llmCurrent, etc.) have their DOM
// reads replaced with explicit parameters; the original DOM-coupled call sites
// are marked with // TODO: DOM side.
// This module reads provider state from appStore; it does NOT write to appStore
// directly — callers are responsible for store mutations after API calls.

import { appStore } from "../store/app"
import { apiJson } from "./api"
import { t } from "../utils/i18n"

// ── Local helpers ──

function record(value: any): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

// ── Types ──

export interface ProviderEntry {
  id: string
  name?: string
  key?: string
  env?: string[]
  models?: Record<string, any>
}

export interface AuthMethodItem {
  type: "oauth" | "api"
  label: string
  index: number
}

export interface ProviderStatusInfo {
  tone: "" | "active" | "ready" | "warn" | "error"
  label: string
  detail: string
}

export interface LlmSelection {
  providerID: string
  modelID: string
  apiKey: string
}

export interface ProviderTestResult {
  ok: boolean
  message?: string
}

/** Prompt descriptor returned by providerAuthPrompt */
export type AuthPrompt =
  | {
      type: "text"
      key: string
      message: string
      placeholder: string
    }
  | {
      type: "select"
      key: string
      message: string
      options: Array<{ label: string; value: string; hint?: string }>
    }

/** Callbacks injected by DOM-side callers into auth flows. */
export interface AuthDialogCallbacks {
  /** Show a text input dialog and return the entered value, or null if cancelled. */
  nativePrompt: (
    message: string,
    opts: {
      title: string
      inputLabel: string
      inputPlaceholder: string
      okLabel: string
      cancelLabel: string
    },
  ) => Promise<string | null>

  /** Show a select/radio dialog and return the chosen value, or null if cancelled. */
  nativeSelect: (
    message: string,
    opts: {
      title: string
      selectLabel: string
      options: Array<{ label: string; value: string; hint?: string }>
      okLabel?: string
      cancelLabel?: string
    },
  ) => Promise<string | null>

  /** Show a confirm dialog and return true if user clicked OK. */
  nativeConfirm: (
    message: string,
    opts: {
      title: string
      okLabel: string
      cancelLabel: string
      kind?: string
    },
  ) => Promise<boolean>

  /** Open a URL in an external browser. */
  nativeOpen: (url: string) => Promise<boolean | void>

  /**
   * Show the LLM notice banner.
   * TODO: DOM side — remove once notice is fully reactive in Solid.
   */
  showLlmNotice: (message: string, tone?: string, duration?: number) => void
}

// ── Provider catalog helpers ──

/** Find a provider entry by ID from the current catalog. */
export function providerEntry(providerID: string): ProviderEntry | undefined {
  return (appStore.providerCatalog?.all ?? []).find((item: any) => item.id === providerID) as ProviderEntry | undefined
}

/** Return the display name for a provider, falling back to its ID. */
export function providerLabel(providerID: string): string {
  return providerEntry(providerID)?.name || providerID
}

/** Return true if the given provider is in the connected list. */
export function providerConnected(providerID: string): boolean {
  return Array.isArray(appStore.providerCatalog?.connected) && appStore.providerCatalog.connected.includes(providerID)
}

/**
 * Return the available auth methods for a provider.
 * Each item has { type, label, index }.
 */
export function providerAuthMethods(providerID: string): AuthMethodItem[] {
  const items: any[] = Array.isArray(appStore.providerAuth?.[providerID]) ? appStore.providerAuth[providerID] : []

  const result: AuthMethodItem[] = []
  let index = 0
  for (const item of items) {
    if (record(item)) {
      const type: "oauth" | "api" = item.type === "oauth" ? "oauth" : "api"
      const label =
        typeof item.label === "string" && item.label.trim() ? item.label.trim() : type === "oauth" ? "OAuth" : "API key"
      result.push({ type, label, index })
    } else if (typeof item === "string") {
      const value = item.trim()
      if (value) {
        const type: "oauth" | "api" = /oauth/i.test(value) ? "oauth" : "api"
        const label = value === "api_key" ? "API key" : value
        result.push({ type, label, index })
      }
    }
    index++
  }
  return result
}

/**
 * Return the preferred OAuth method for a provider (browser-flow first).
 * Returns null if no OAuth methods exist.
 */
export function providerPreferredOauthMethod(providerID: string): AuthMethodItem | null {
  const methods = providerAuthMethods(providerID).filter((m) => m.type === "oauth")
  if (methods.length === 0) return null
  return methods.find((m) => /browser/i.test(m.label)) ?? methods[0]
}

/**
 * Compute the current status info for a provider.
 * Accepts an optional config override (
 * Accepts an optional modelID to match against providerTest.
 */
export function providerState(providerID: string, configOverride?: any, currentModelID?: string): ProviderStatusInfo {
  const config = configOverride ?? appStore.config ?? {}
  const item = providerEntry(providerID)
  const connected = providerConnected(providerID)
  const authMethods = providerAuthMethods(providerID)
  const configKey = config?.provider?.[providerID]?.options?.apiKey
  const key = configKey || item?.key
  const tested = appStore.providerTest

  // If a test result is available for this exact (provider, model) pair, use it.
  if (tested?.providerID === providerID && (currentModelID === undefined || tested?.modelID === currentModelID)) {
    return {
      tone: tested.ok ? "active" : "error",
      label: tested.ok ? t("llm.status.connected") : t("llm.status.error"),
      detail: tested.message ?? "",
    }
  }

  if (connected) {
    return {
      tone: "active",
      label: t("llm.status.connected"),
      detail: t("llm.detail.connected"),
    }
  }
  if (key) {
    return {
      tone: "ready",
      label: t("llm.status.configured"),
      detail: t("llm.detail.configured"),
    }
  }
  if (authMethods.length > 0) {
    return {
      tone: "warn",
      label: t("llm.status.auth_required"),
      detail: t("llm.detail.auth_methods", { value: authMethods.length }),
    }
  }
  if ((item?.env?.length ?? 0) > 0) {
    return {
      tone: "warn",
      label: t("llm.status.needs_api_key"),
      detail: t("llm.detail.needs_api_key", { names: item!.env!.join(", ") }),
    }
  }
  return {
    tone: "",
    label: t("llm.status.available"),
    detail: t("llm.detail.available"),
  }
}

// ── LLM selection helpers ──
// These helpers work with explicit values rather than DOM reads,
// so they are usable from both the Solid component and

/**
 * Build a stable string key for a (providerID, modelID, apiKey) triple.
 * Used to detect whether a save is actually needed.
 */
export function llmSelectionKey(providerID: string, modelID: string, apiKey: string): string {
  return JSON.stringify([providerID, modelID, apiKey])
}

/**
 * Derive the current (providerID, modelID) from the saved config when there
 * are no explicit form values selected.
 * Pass empty strings for formProviderID / formModelID when the form has not
 * been touched.
 * Solid callers pass the current form values as formProviderID / formModelID.
 */
export function llmCurrent(formProviderID: string, formModelID: string): { providerID: string; modelID: string } {
  if (formProviderID || formModelID) {
    return { providerID: formProviderID, modelID: formModelID }
  }
  const model = appStore.config?.model
  if (typeof model !== "string" || !model.includes("/")) {
    return { providerID: "", modelID: "" }
  }
  const parts = model.split("/")
  return {
    providerID: parts[0] ?? "",
    modelID: parts.slice(1).join("/") ?? "",
  }
}

// ── Provider selection data helpers ──
// Pure data logic extracted from populateProviderSelect / populateModelSelect.
// DOM mutations are left to the caller (marked // TODO: DOM side).

export interface SortedProvider extends ProviderEntry {
  stateLabel: string
}

/**
 * Return the sorted provider list (connected first, then alphabetical).
 * Each entry includes a `stateLabel` derived from providerState.
 * Mirrors the data portion of populateProviderSelect.
 * TODO: DOM side — callers must render the returned list into the
 * <select> element themselves.
 */
export function sortedProviders(config?: any): SortedProvider[] {
  const catalog = appStore.providerCatalog
  const all: ProviderEntry[] = Array.isArray(catalog?.all) ? [...catalog.all] : []
  const connected: string[] = catalog?.connected ?? []

  all.sort((a, b) => {
    const ac = connected.includes(a.id) ? 0 : 1
    const bc = connected.includes(b.id) ? 0 : 1
    if (ac !== bc) return ac - bc
    return (a.name ?? a.id).localeCompare(b.name ?? b.id)
  })

  return all.map((item) => ({
    ...item,
    stateLabel: providerState(item.id, config).label,
  }))
}

/**
 * Return the sorted model list for a given provider.
 * Mirrors the data portion of populateModelSelect.
 * TODO: DOM side — callers must render the returned list into the
 * <select> element themselves.
 */
export function modelsForProvider(providerID: string): string[] {
  const catalog = appStore.providerCatalog
  const provider = (catalog?.all ?? []).find((p: any) => p.id === providerID)
  return Object.keys(provider?.models ?? {}).sort((a, b) => a.localeCompare(b))
}

/**
 * Resolve the default model to select for a provider.
 * Falls back to the first available model.
 */
export function defaultModelForProvider(providerID: string, config?: any): string {
  const models = modelsForProvider(providerID)
  const catalog = appStore.providerCatalog

  if (typeof config?.model === "string" && config.model.startsWith(`${providerID}/`)) {
    const candidate = config.model.slice(providerID.length + 1)
    if (models.includes(candidate)) return candidate
  }

  const catalogDefault = catalog?.default?.[providerID]
  if (catalogDefault && models.includes(catalogDefault)) return catalogDefault

  return models[0] ?? ""
}

// ── Provider connection test ──

/** Test connectivity for a (providerID, modelID) pair via the server API. */
export async function testProviderConnection(providerID: string, modelID: string): Promise<ProviderTestResult> {
  return apiJson(`provider/${providerID}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelID }),
  })
}

// ── Provider auth prompt parsing ──

/**
 * Validate and normalise a raw prompt descriptor from the server.
 * Returns null for invalid descriptors.
 */
export function providerAuthPrompt(prompt: any): AuthPrompt | null {
  if (!record(prompt) || typeof prompt.key !== "string" || typeof prompt.message !== "string") {
    return null
  }

  if (prompt.type === "text") {
    return {
      type: "text",
      key: prompt.key,
      message: prompt.message,
      placeholder: typeof prompt.placeholder === "string" ? prompt.placeholder : "",
    }
  }

  if (prompt.type !== "select" || !Array.isArray(prompt.options)) return null

  const options = (prompt.options as any[]).flatMap((item: any) => {
    if (!record(item) || typeof item.label !== "string" || typeof item.value !== "string") {
      return []
    }
    return [
      {
        label: item.label,
        value: item.value,
        ...(typeof item.hint === "string" ? { hint: item.hint } : {}),
      },
    ]
  })

  if (!options.length) return null

  return {
    type: "select",
    key: prompt.key,
    message: prompt.message,
    options,
  }
}

// ── Provider auth input collection ──

/**
 * Iteratively collect auth inputs for a provider method by fetching prompt
 * descriptors from the server and presenting native dialogs.
 * Returns the collected inputs map, or null if the user cancelled.
 */
export async function providerAuthInputs(
  providerID: string,
  methodIndex: number,
  callbacks: Pick<AuthDialogCallbacks, "nativePrompt" | "nativeSelect">,
): Promise<Record<string, string> | null> {
  const inputs: Record<string, string> = {}
  const label = providerLabel(providerID)

  while (true) {
    const prompts = await apiJson(`provider/${providerID}/auth/prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: methodIndex, inputs }),
      signal: AbortSignal.timeout(300_000),
    })

    const list: AuthPrompt[] = Array.isArray(prompts)
      ? (prompts.map(providerAuthPrompt).filter(Boolean) as AuthPrompt[])
      : []

    const prompt = list.find((item) => !Object.hasOwn(inputs, item.key))
    if (!prompt) return inputs

    let value: string | null
    if (prompt.type === "select") {
      value = await callbacks.nativeSelect(prompt.message, {
        title: label,
        selectLabel: prompt.message,
        options: prompt.options,
        okLabel: t("common.ok"),
        cancelLabel: t("common.cancel"),
      })
    } else {
      value = await callbacks.nativePrompt(prompt.message, {
        title: label,
        inputLabel: prompt.message,
        inputPlaceholder: prompt.placeholder,
        okLabel: t("common.submit"),
        cancelLabel: t("common.cancel"),
      })
    }

    if (value == null) return null
    inputs[prompt.key] = String(value).trim()
  }
}

// ── Execute provider auth ──

/**
 * Send collected auth inputs to the server for a given provider/method.
 * Returns true on success.
 */
export async function executeProviderAuth(
  providerID: string,
  methodIndex: number,
  inputs: Record<string, string>,
): Promise<true> {
  await apiJson(`provider/${providerID}/auth/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: methodIndex, inputs }),
    signal: AbortSignal.timeout(300_000),
  })
  return true
}

// ── OAuth authorization flow ──

/**
 * Run the full OAuth authorization flow for a provider.
 * Returns true on success, false if the user cancelled.
 * Note: the caller is responsible for updating appStore.providerAuthDismissed
 * based on the returned value.
 */
export async function authorizeProvider(
  providerID: string,
  methodIndex: number | undefined,
  callbacks: AuthDialogCallbacks,
): Promise<boolean> {
  const methods = providerAuthMethods(providerID)
  const explicitChoice = typeof methodIndex === "number"
  const match = explicitChoice ? methods.find((m) => m.index === methodIndex) : providerPreferredOauthMethod(providerID)

  if (!match) return false

  if (!explicitChoice) {
    const confirmed = await callbacks.nativeConfirm(
      `${providerLabel(providerID)} ${t("llm.status.auth_required")}: ${match.label}`,
      {
        title: t("llm.title"),
        okLabel: t("common.open"),
        cancelLabel: t("common.cancel"),
        kind: "info",
      },
    )
    if (!confirmed) {
      // TODO: DOM side — caller should set appStore.providerAuthDismissed[providerID] = true
      return false
    }
  }

  const collected = await providerAuthInputs(providerID, match.index, callbacks)
  if (collected == null) {
    // TODO: DOM side — caller should set appStore.providerAuthDismissed[providerID] = true
    return false
  }

  const authorization = await apiJson(`provider/${providerID}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: match.index, inputs: collected }),
    signal: AbortSignal.timeout(300_000),
  })

  if (!record(authorization) || typeof authorization.url !== "string" || typeof authorization.method !== "string") {
    throw new Error("OAuth authorization unavailable")
  }

  await callbacks.nativeOpen(authorization.url)

  if (authorization.method === "code") {
    const code = await callbacks.nativePrompt(
      [authorization.instructions, authorization.url].filter(Boolean).join("\n\n"),
      {
        title: t("llm.title"),
        inputLabel: match.label,
        inputPlaceholder: "Redirect URL or authorization code (leave blank if it auto-completes)",
        okLabel: t("common.submit"),
        cancelLabel: t("common.cancel"),
      },
    )
    if (code == null) {
      // TODO: DOM side — caller should set appStore.providerAuthDismissed[providerID] = true
      return false
    }
    await apiJson(`provider/${providerID}/oauth/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: match.index, code }),
      signal: AbortSignal.timeout(300_000),
    })
    return true
  }

  // Implicit / device-code flow: show instructions and wait for server callback
  callbacks.showLlmNotice(authorization.instructions || authorization.url, "warn", 0)
  await apiJson(`provider/${providerID}/oauth/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: match.index }),
    signal: AbortSignal.timeout(300_000),
  })
  return true
}

// ── Run a single auth method ──

/**
 * Dispatch to the correct auth flow (OAuth vs API-key prompt) for one method.
 * Returns true on success, false if cancelled, or "input" if the caller should
 * focus its API key field.
 */
export async function runProviderAuthMethod(
  providerID: string,
  method: AuthMethodItem,
  callbacks: AuthDialogCallbacks,
): Promise<boolean | "input"> {
  if (method.type === "oauth") {
    return authorizeProvider(providerID, method.index, callbacks)
  }
  const inputs = await providerAuthInputs(providerID, method.index, callbacks)
  if (inputs == null) return false
  if (Object.keys(inputs).length === 0) {
    // No server-side prompts — the caller should focus the API key field.
    return "input"
  }
  await executeProviderAuth(providerID, method.index, inputs)
  return true
}

// ── Authenticate the currently selected provider ──

/**
 * Authenticate a provider by prompting the user to choose an auth method and
 * running the appropriate flow.
 * The providerID must be passed explicitly by the canonical provider UI.
 */
export async function authenticateSelectedProvider(
  providerID: string,
  callbacks: AuthDialogCallbacks,
): Promise<boolean> {
  const methods = providerAuthMethods(providerID)
  if (!providerID || methods.length === 0) return false

  if (methods.length === 1 && methods[0]) {
    const result = await runProviderAuthMethod(providerID, methods[0], callbacks)
    return result === true
  }

  const value = await callbacks.nativeSelect(t("llm.auth_choose_method"), {
    title: providerLabel(providerID),
    selectLabel: t("llm.auth_method"),
    options: methods.map((m) => ({
      label: m.label,
      value: String(m.index),
      hint: m.type === "oauth" ? t("llm.auth_type_oauth") : t("llm.auth_type_api"),
    })),
  })

  if (value == null) return false
  const method = methods.find((m) => String(m.index) === value)
  if (!method) return false

  const result = await runProviderAuthMethod(providerID, method, callbacks)
  return result === true
}
