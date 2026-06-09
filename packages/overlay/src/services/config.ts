// ── Config Service ──
// Check config accessors, config update helpers, project scaffold, prompt catalog.

import { apiJson } from "./api"
import { appStore, setAppStore } from "../store/app"
import { settingsStore } from "../store/settings"
import { AppLog } from "../utils/log"
import { t } from "../utils/i18n"
import { loadConfigInfo } from "./init"
import { loadExtensions } from "./extensions"
import { loadMeta } from "./meta"
import { loadExecutors } from "./executor"
import { restoreWorkspaceDirectory } from "./workspace"
import { loadTasks, clearTasksForMissingDirectory } from "../store/board"
import { getHostTransport } from "./host-transport"
import { sanitizeLocale } from "../utils/i18n"
import { createSignal } from "solid-js"

// ── Check Config Accessors ──

/**
 * Extract the `checks` config object from a task's metadata.
 * Returns a clone so callers can mutate the result safely.
 */
export function checkConfig(task: any): Record<string, any> {
  const checks = task?.metadata?.checks
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) return {}
  return structuredClone(checks)
}

/**
 * Returns true when the config object has at least one key (i.e. the user has
 * explicitly configured one or more checks).
 */
export function hasExplicitChecks(config: Record<string, any>): boolean {
  return Object.keys(config).length > 0
}

/**
 * Returns true when `key` names a check that can be freely toggled on/off by
 * the user (as opposed to command-type checks whose enabled state is implicit).
 */
export function checkCanToggle(key: string): boolean {
  return ["artifact", "ui_review", "code_quality", "code_review", "dead_code_review", "spec_check"].includes(key)
}

/**
 * Build the config value to store when `key` is toggled on.
 * Returns `undefined` for keys that have no structured representation (i.e.
 * they are handled elsewhere or do not need an object value).
 */
export function checkSelectionConfig(key: string, current: any): Record<string, any> | undefined {
  const base = current && typeof current === "object" && !Array.isArray(current) ? structuredClone(current) : undefined
  if (key === "artifact") return base || {}
  if (key === "ui_review") return { ...(base || {}), target: "web" }
  if (["code_quality", "code_review", "dead_code_review", "spec_check"].includes(key)) {
    return { ...(base || {}), enabled: true }
  }
  if (["startup", "visual", "playwright"].includes(key)) return base
  return { ...(base || {}), enabled: true }
}

/**
 * Build an updated checks config from the current criteriaSpecs in appStore
 * and a map of `{ [specKey]: enabled }` selection values.
 * This is the Solid-store equivalent of the DOM-reading buildCheckConfig
 * ( line 6874). Pass `selection` as a plain object keyed by spec key.
 */
export function buildCheckConfigFromSpecs(task: any, selection: Record<string, boolean>): Record<string, any> {
  const current = checkConfig(task)
  const next = structuredClone(current)
  const named: Record<string, any> =
    next.named && typeof next.named === "object" && !Array.isArray(next.named) ? structuredClone(next.named) : {}

  for (const spec of appStore.criteriaSpecs as any[]) {
    if (spec.readOnly) continue
    const enabled = selection[spec.key]
    if (enabled === undefined) continue
    if (spec.kind === "named") {
      const currentNamed = named[spec.name]
      if (!currentNamed || typeof currentNamed !== "object" || Array.isArray(currentNamed)) continue
      named[spec.name] = { ...currentNamed, enabled }
      continue
    }
    if (spec.kind === "command") {
      if (enabled) {
        if (next[spec.name] === false) delete next[spec.name]
        continue
      }
      next[spec.name] = false
      continue
    }
    if (enabled) {
      const currentValue = next[spec.name]
      const value = checkSelectionConfig(spec.name, currentValue)
      if (value) next[spec.name] = value
      continue
    }
    delete next[spec.name]
  }

  if (Object.keys(named).length > 0) next.named = named
  else delete next.named

  return next
}

// ── Config Update ──

/**
 * Send a partial config diff to the server (JSON Merge Patch).
 * Updates appStore.config with the server response.
 */
export async function patchConfig(diff: Record<string, any>): Promise<any> {
  if (!appStore.connected) return null
  try {
    const saved = await apiJson("config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(diff),
    })
    setAppStore("config", saved)
    return saved
  } catch (e) {
    console.error("[config] patchConfig failed", e)
    return null
  }
}

export interface SessionConfigResponse {
  config: Record<string, any>
  origin: Record<string, any>
}

export interface TaskOperatorModelContext {
  taskID: string
  sessionID: string
  agent: string
  model: {
    providerID: string
    modelID: string
  }
}

export function modelContextID(context: TaskOperatorModelContext | null | undefined): string {
  const providerID = context?.model?.providerID
  const modelID = context?.model?.modelID
  return providerID && modelID ? `${providerID}/${modelID}` : ""
}

const [sessionConfigRefreshTokenValue, setSessionConfigRefreshTokenValue] = createSignal(0)

export function sessionConfigRefreshToken(): number {
  return sessionConfigRefreshTokenValue()
}

export function markSessionConfigStale(_sessionID?: string): void {
  setSessionConfigRefreshTokenValue((value) => value + 1)
}

export async function getSessionConfig(sessionID: string): Promise<SessionConfigResponse> {
  if (!appStore.connected) {
    throw new Error("Cannot load session config while disconnected")
  }
  return await apiJson(`session/${encodeURIComponent(sessionID)}/config`)
}

export async function patchSessionConfig(sessionID: string, diff: Record<string, any>): Promise<SessionConfigResponse> {
  if (!appStore.connected) {
    throw new Error("Cannot patch session config while disconnected")
  }
  const saved = await apiJson(`session/${encodeURIComponent(sessionID)}/config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(diff),
  })
  markSessionConfigStale(sessionID)
  return saved
}

export async function getTaskOperatorModelContext(taskID: string): Promise<TaskOperatorModelContext> {
  if (!appStore.connected) {
    throw new Error("Cannot load task operator model context while disconnected")
  }
  return await apiJson(`task/${encodeURIComponent(taskID)}/operator-model-context`)
}

export async function syncAgentPromptLocale(locale: string): Promise<void> {
  await patchConfig({ locale: sanitizeLocale(locale) })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function mergePatchDiff(before: unknown, after: unknown): unknown {
  if (!isRecord(before) || !isRecord(after)) {
    return sameJsonValue(before, after) ? undefined : after
  }

  const patch: Record<string, unknown> = {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    if (!Object.hasOwn(after, key)) {
      patch[key] = null
      continue
    }
    const nextValue = after[key]
    if (nextValue === undefined) {
      patch[key] = null
      continue
    }
    if (!Object.hasOwn(before, key)) {
      patch[key] = nextValue
      continue
    }
    const child = mergePatchDiff(before[key], nextValue)
    if (child !== undefined) patch[key] = child
  }
  return Object.keys(patch).length > 0 ? patch : undefined
}

/**
 * Fetch the current server config, apply `mutator` to a clone, then PATCH the
 * resulting JSON Merge Patch back. Returns the saved config.
 * Use patchConfig() for simple field updates; use this for complex mutations
 * that need the current state (e.g., conditional delete of nested keys).
 */
export async function updateConfig(mutator: (config: Record<string, any>) => void): Promise<any> {
  const current = await apiJson("config")
  const next = structuredClone(current || {})
  mutator(next)
  const diff = mergePatchDiff(current || {}, next)
  if (diff === undefined) {
    setAppStore("config", current)
    return current
  }
  const saved = await apiJson("config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(diff),
  })
  setAppStore("config", saved)
  return saved
}

// ── Project Config Scaffold ──

/**
 * Write a default `opencorvus.jsonc` file into `dir/.opencorvus/` via the
 * Tauri `overlay_write_file` command. Silently no-ops when `dir` is empty.
 */
export async function scaffoldProjectConfig(dir: string): Promise<void> {
  if (!dir) return
  const base = dir.replace(/[\\/]+$/, "")
  const configFile = base + "/.opencorvus/opencorvus.jsonc"
  const username = settingsStore.username || ""
  // Scaffold intentionally leaves `assistant` empty so the server's
  // EngineConfig.DEFAULTS is the single source of truth. Writing explicit
  // values here would shadow DEFAULTS via the `??` merge in
  // packages/opencorvus/src/orchestrator/config.ts and silently drift over time.
  // Project authors who want to customize agent behavior should add fields
  // explicitly — the empty `{}` is just a discoverability hint.
  const config = {
    $schema: "https://opencorvus.ai/config.json",
    lsp: {
      biome: { disabled: true },
      eslint: { disabled: true },
    },
    assistant: {},
    compaction: {
      auto: true,
      prune: true,
    },
    agent: {},
    plugin: [],
    command: {},
    username,
  }
  try {
    await getHostTransport().native({
      kind: "config.write-file",
      path: configFile,
      content: JSON.stringify(config, null, 2),
    })
  } catch (e) {
    console.warn("[scaffold] Failed to scaffold project config", e)
  }
}

// ── Project Scope Reload ──

/**
 * Reset and then reload project-scope data (tasks, meta, extensions, config,
 * executors). Delegates to the during the Solid migration; direct
 * port available for post-migration use.
 */
export async function reloadProjectScope(options: { restoreWorkspace?: boolean } = {}): Promise<void> {
  if (!settingsStore.directory.trim()) {
    clearTasksForMissingDirectory()
    return
  }
  // Mirrors loadInitialData's parallel reload — must load all project-scope
  // data including tasks and executors so the UI fully reflects the new directory.
  await Promise.all([
    loadConfigInfo(undefined, { includeSettingsData: false }).catch((e: unknown) =>
      console.error("[reloadProjectScope] loadConfigInfo", e),
    ),
    loadExtensions().catch((e: unknown) => console.error("[reloadProjectScope] loadExtensions", e)),
    loadMeta().catch((e: unknown) => console.error("[reloadProjectScope] loadMeta", e)),
    loadTasks().catch((e: unknown) => console.error("[reloadProjectScope] loadTasks", e)),
    loadExecutors().catch((e: unknown) => console.error("[reloadProjectScope] loadExecutors", e)),
  ])
  if (options.restoreWorkspace) {
    try {
      restoreWorkspaceDirectory()
    } catch (e: unknown) {
      console.error("[reloadProjectScope] restoreWorkspaceDirectory", e)
    }
  }
}

// ── Prompt Catalog ──
// (lines 2677, 2683, 2694).

/**
 * Apply a raw prompt-entry list into the app store.
 * DOM side-effect (renderPromptCatalog) remains.
 */
export function applyPromptEntries(items: any[]): void {
  const entries = Array.isArray(items) ? items : []
  setAppStore("promptEntries", entries)
}

/**
 * Load prompt entries from the server and push them into the store.
 */
export async function loadPromptCatalog(): Promise<void> {
  try {
    const items = await apiJson("config/prompt")
    applyPromptEntries(items)
  } catch (e) {
    AppLog.debug("prompt", "loadPromptCatalog failed, resetting to empty", { error: String(e) })
    applyPromptEntries([])
  }
}

/**
 * Persist a single prompt entry override to the server config,
 * then reload the catalog.
 * @param entry The prompt entry to save
 * @param value The new prompt text (empty string to clear the override)
 */
export async function savePromptEntry(entry: any, value: string): Promise<void> {
  if (!entry) return
  try {
    await updateConfig((current: any) => {
      if (entry.scope === "system") {
        current.prompt = current.prompt || {}
        if (value.trim()) current.prompt[entry.key] = value
        else delete current.prompt[entry.key]
        if (Object.keys(current.prompt).length === 0) delete current.prompt
        return
      }
      current.agent = current.agent || {}
      const item =
        current.agent?.[entry.key] && typeof current.agent[entry.key] === "object"
          ? { ...current.agent[entry.key] }
          : {}
      const field = entry.prompt_mode === "append" ? "prompt_append" : "prompt"
      if (value.trim()) item[field] = value
      else delete (item as any)[field]
      if (Object.keys(item).length === 0) delete current.agent[entry.key]
      else current.agent[entry.key] = item
      if (Object.keys(current.agent).length === 0) delete current.agent
    })
    await loadPromptCatalog()
  } catch (e) {
    AppLog.error("ui", "Failed to save prompt override", { error: String(e) })
    throw e
  }
}

/**
 * Reset a prompt entry override back to its default value.
 * Removes the override from the server config, then reloads the catalog.
 */
export async function resetPromptEntry(entry: any): Promise<void> {
  if (!entry) return
  if (entry.configured_prompt === null) return
  const entryID = `${entry.scope}:${entry.key}`
  try {
    await updateConfig((current: any) => {
      if (entry.scope === "system") {
        if (current.prompt && typeof current.prompt === "object") {
          delete current.prompt[entry.key]
          if (Object.keys(current.prompt).length === 0) delete current.prompt
        }
        return
      }
      if (current.agent && typeof current.agent === "object" && current.agent[entry.key]) {
        const item =
          current.agent[entry.key] && typeof current.agent[entry.key] === "object"
            ? { ...current.agent[entry.key] }
            : {}
        const field = entry.prompt_mode === "append" ? "prompt_append" : "prompt"
        delete (item as any)[field]
        if (Object.keys(item).length === 0) delete current.agent[entry.key]
        else current.agent[entry.key] = item
        if (Object.keys(current.agent).length === 0) delete current.agent
      }
    })
    await loadPromptCatalog()
  } catch (e) {
    AppLog.error("ui", "Failed to reset prompt override", { error: String(e) })
    throw e
  }
}
