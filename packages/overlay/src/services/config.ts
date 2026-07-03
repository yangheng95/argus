// ── Config Service ──
// Check config accessors, config update helpers, and project scaffold.

import { apiJson, configure as configureApi } from "./api"
import { appStore, setAppStore } from "../store/app"
import { settingsStore } from "../store/settings"
import { t } from "../utils/i18n"
import { loadConfigInfo } from "./init"
import { loadExtensions } from "./extensions"
import { loadMeta } from "./meta"
import { loadExecutors } from "./executor"
import { activeDirectory, restoreWorkspaceDirectory } from "./workspace"
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

export interface ConfigRequestOptions {
  directory?: string
  isCurrentDirectory?: (directory: string) => boolean
}

export function currentProjectConfigRequestOptions(): ConfigRequestOptions {
  const directory = activeDirectory().trim()
  if (!directory) throw new Error("Project config update requires an active directory")
  return {
    directory,
    isCurrentDirectory: (candidate) => activeDirectory().trim() === candidate,
  }
}

function configRequestPath(options: ConfigRequestOptions = {}): string {
  const directory = options.directory?.trim()
  return directory ? `config?directory=${encodeURIComponent(directory)}` : "config"
}

function configResponseStillOwned(options: ConfigRequestOptions): boolean {
  const directory = options.directory?.trim()
  return !directory || !options.isCurrentDirectory || options.isCurrentDirectory(directory)
}

/**
 * Send a partial config diff to the server (JSON Merge Patch).
 * Updates appStore.config with the server response.
 */
export async function patchConfig(diff: Record<string, any>, options: ConfigRequestOptions = {}): Promise<any> {
  if (!appStore.connected) throw new Error("Cannot patch config while disconnected")
  const saved = await apiJson(configRequestPath(options), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(diff),
  })
  if (configResponseStillOwned(options)) setAppStore("config", saved)
  return saved
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

export interface HexinBudget {
  maxBudget: number
  spend: number
  remaining: number
  overBudget: boolean
}

export type HexinBudgetResponse = { ok: true; budget: HexinBudget } | { ok: false; error: string }

export interface SessionConfigRequest {
  sessionID: string
  directory: string
}

export interface SessionConfigPatchRequest extends SessionConfigRequest {
  diff: Record<string, any>
}

export interface TaskOperatorModelContextRequest {
  taskID: string
  directory: string
}

export interface DirectoryScopedRequest {
  directory: string
}

export interface NetworkProxyDraft {
  url: string
  llmProvider: boolean
  webResearch: boolean
  username?: string
  password?: string
}

export interface NetworkProxyTestResult {
  ok: boolean
  status: "connected" | "error"
  targetUrl: string
  statusCode?: number
  durationMs: number
  message: string
}

export interface DatabaseResetTarget {
  label: string
  path: string
  ok: boolean
  error?: string
}

export interface DatabaseResetResponse {
  ok: boolean
  restarting: boolean
  targets: DatabaseResetTarget[]
}

export interface PromptProfileOption {
  id: string
  label: string
  description?: string
  built_in?: boolean
  editable?: boolean
  agents?: Record<string, string>
}

export interface PromptProfileTarget {
  id: string
  label: string
  description?: string
  editable: boolean
  built_in_only: boolean
}

export interface PromptProfileCatalog {
  active: string
  project_active: string
  session_active: string | null
  default: string
  targets: PromptProfileTarget[]
  profiles: PromptProfileOption[]
}

export type PromptProfileCatalogScope =
  | { kind: "project"; directory: string }
  | { kind: "session"; sessionID: string; directory: string }

export function modelContextID(context: TaskOperatorModelContext | null | undefined): string {
  const providerID = context?.model?.providerID
  const modelID = context?.model?.modelID
  return providerID && modelID ? `${providerID}/${modelID}` : ""
}

const [sessionConfigRefreshTokenValue, setSessionConfigRefreshTokenValue] = createSignal(0)
const [promptProfileCatalogRefreshTokenValue, setPromptProfileCatalogRefreshTokenValue] = createSignal(0)
let pendingPromptProfileCatalogLoad: { key: string; promise: Promise<PromptProfileCatalog> } | null = null

export function sessionConfigRefreshToken(): number {
  return sessionConfigRefreshTokenValue()
}

export function markSessionConfigStale(_sessionID?: string): void {
  setSessionConfigRefreshTokenValue((value) => value + 1)
}

export function promptProfileCatalogRefreshToken(): number {
  return promptProfileCatalogRefreshTokenValue()
}

export function markPromptProfileCatalogStale(): void {
  setPromptProfileCatalogRefreshTokenValue((value) => value + 1)
}

function directoryScopedPath(path: string, directory: string, label: string): string {
  const trimmed = directory.trim()
  if (!trimmed) throw new Error(`${label}: directory is required`)
  const params = new URLSearchParams({ directory: trimmed })
  return `${path}?${params.toString()}`
}

export async function getSessionConfig(input: SessionConfigRequest): Promise<SessionConfigResponse> {
  if (!appStore.connected) {
    throw new Error("Cannot load session config while disconnected")
  }
  const sessionID = input.sessionID.trim()
  if (!sessionID) throw new Error("getSessionConfig: sessionID is required")
  return await apiJson(
    directoryScopedPath(`session/${encodeURIComponent(sessionID)}/config`, input.directory, "getSessionConfig"),
  )
}

export async function patchSessionConfig(input: SessionConfigPatchRequest): Promise<SessionConfigResponse> {
  if (!appStore.connected) {
    throw new Error("Cannot patch session config while disconnected")
  }
  const sessionID = input.sessionID.trim()
  if (!sessionID) throw new Error("patchSessionConfig: sessionID is required")
  const saved = await apiJson(
    directoryScopedPath(`session/${encodeURIComponent(sessionID)}/config`, input.directory, "patchSessionConfig"),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.diff),
    },
  )
  markSessionConfigStale(sessionID)
  return saved
}

export async function getTaskOperatorModelContext(
  input: TaskOperatorModelContextRequest,
): Promise<TaskOperatorModelContext> {
  if (!appStore.connected) {
    throw new Error("Cannot load task operator model context while disconnected")
  }
  const taskID = input.taskID.trim()
  if (!taskID) throw new Error("getTaskOperatorModelContext: taskID is required")
  return await apiJson(
    directoryScopedPath(
      `task/${encodeURIComponent(taskID)}/operator-model-context`,
      input.directory,
      "getTaskOperatorModelContext",
    ),
  )
}

export async function getHexinBudget(input: DirectoryScopedRequest): Promise<HexinBudgetResponse> {
  if (!appStore.connected) {
    throw new Error("Cannot load Hexin budget while disconnected")
  }
  return await apiJson(directoryScopedPath("provider/hexin/budget", input.directory, "getHexinBudget"))
}

export async function testNetworkProxy(proxy: NetworkProxyDraft): Promise<NetworkProxyTestResult> {
  if (!appStore.connected) {
    throw new Error("Cannot test network proxy while disconnected")
  }
  return await apiJson("config/proxy/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proxy }),
  })
}

export async function resetDatabase(database: string): Promise<DatabaseResetResponse> {
  if (!appStore.connected) {
    throw new Error("Cannot reset database while disconnected")
  }
  const currentDatabase = database.trim()
  if (!currentDatabase) throw new Error("resetDatabase: database is required")
  return await apiJson("global/db/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ database: currentDatabase }),
  })
}

export async function loadPromptProfileCatalog(scope: PromptProfileCatalogScope): Promise<PromptProfileCatalog> {
  if (!appStore.connected) {
    throw new Error("Cannot load prompt profiles while disconnected")
  }
  const directory = scope.directory.trim()
  if (!directory) throw new Error("loadPromptProfileCatalog: directory is required")
  const sessionID = scope.kind === "session" ? scope.sessionID.trim() : ""
  if (scope.kind === "session" && !sessionID) throw new Error("loadPromptProfileCatalog: sessionID is required")
  const key = `${directory}\n${sessionID}`
  if (pendingPromptProfileCatalogLoad?.key === key) return await pendingPromptProfileCatalogLoad.promise
  const params = new URLSearchParams({ directory })
  if (sessionID) params.set("sessionID", sessionID)
  const promise = apiJson(`config/prompt-profile?${params.toString()}`) as Promise<PromptProfileCatalog>
  pendingPromptProfileCatalogLoad = { key, promise }
  try {
    return await promise
  } finally {
    if (pendingPromptProfileCatalogLoad?.promise === promise) pendingPromptProfileCatalogLoad = null
  }
}

export async function setProjectPromptProfileActive(profileID: string, directory: string): Promise<any> {
  const saved = await updateConfig((current) => {
    const promptProfile =
      current.prompt_profile && typeof current.prompt_profile === "object" && !Array.isArray(current.prompt_profile)
        ? { ...current.prompt_profile }
        : {}
    current.prompt_profile = {
      ...promptProfile,
      active: profileID,
    }
  }, { directory })
  markPromptProfileCatalogStale()
  return saved
}

export async function setSessionPromptProfileActive(
  sessionID: string,
  profileID: string,
  directory: string,
): Promise<SessionConfigResponse> {
  const saved = await patchSessionConfig({ sessionID, directory, diff: { prompt_profile: { active: profileID } } })
  markPromptProfileCatalogStale()
  return saved
}

export async function syncAgentPromptLocale(
  locale: string,
  options: ConfigRequestOptions = currentProjectConfigRequestOptions(),
): Promise<void> {
  await patchConfig({ locale: sanitizeLocale(locale) }, options)
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
export async function updateConfig(
  mutator: (config: Record<string, any>) => void,
  options: ConfigRequestOptions = {},
): Promise<any> {
  const configPath = configRequestPath(options)
  const current = await apiJson(configPath)
  const next = structuredClone(current || {})
  mutator(next)
  const diff = mergePatchDiff(current || {}, next)
  if (diff === undefined) {
    if (configResponseStillOwned(options)) setAppStore("config", current)
    return current
  }
  const saved = await apiJson(configPath, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(diff),
  })
  if (configResponseStillOwned(options)) setAppStore("config", saved)
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
  const directory = activeDirectory().trim()
  if (!directory) {
    clearTasksForMissingDirectory()
    return
  }
  configureApi({ directory })
  // Mirrors loadInitialData's parallel reload — must load all project-scope
  // data including tasks and executors so the UI fully reflects the new directory.
  await Promise.all([
    loadConfigInfo(undefined, { includeSettingsData: false }),
    loadExtensions({
      directory,
      isCurrentDirectory: (candidate) => activeDirectory().trim() === candidate,
    }),
    loadMeta(),
    loadTasks(),
    loadExecutors(directory, {
      isCurrentDirectory: (candidate) => activeDirectory().trim() === candidate,
    }),
  ])
  if (options.restoreWorkspace) {
    try {
      restoreWorkspaceDirectory()
    } catch (e: unknown) {
      console.error("[reloadProjectScope] restoreWorkspaceDirectory", e)
    }
  }
}
