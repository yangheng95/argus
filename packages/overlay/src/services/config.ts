// ── Config Service ──
// Check config accessors, config update helpers, project scaffold, prompt catalog.

import { apiJson, configure as configureApi } from "./api"
import { appStore, setAppStore } from "../store/app"
import { settingsStore } from "../store/settings"
import { AppLog } from "../utils/log"
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

/**
 * Send a partial config diff to the server (JSON Merge Patch).
 * Updates appStore.config with the server response.
 */
export async function patchConfig(diff: Record<string, any>): Promise<any> {
  if (!appStore.connected) throw new Error("Cannot patch config while disconnected")
  const saved = await apiJson("config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(diff),
  })
  setAppStore("config", saved)
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

export interface PromptProfileDraft {
  id: string
  label: string
  description?: string
  agents: Record<string, string>
}

export interface PromptProfileImportPreview {
  active?: string
  profiles: PromptProfileDraft[]
}

const PROMPT_PROFILE_IMPORT_ID_PATTERN = /^(?!.*--)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

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
  return await apiJson(directoryScopedPath(`session/${encodeURIComponent(sessionID)}/config`, input.directory, "getSessionConfig"))
}

export async function patchSessionConfig(input: SessionConfigPatchRequest): Promise<SessionConfigResponse> {
  if (!appStore.connected) {
    throw new Error("Cannot patch session config while disconnected")
  }
  const sessionID = input.sessionID.trim()
  if (!sessionID) throw new Error("patchSessionConfig: sessionID is required")
  const saved = await apiJson(directoryScopedPath(`session/${encodeURIComponent(sessionID)}/config`, input.directory, "patchSessionConfig"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.diff),
  })
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
    directoryScopedPath(`task/${encodeURIComponent(taskID)}/operator-model-context`, input.directory, "getTaskOperatorModelContext"),
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

export async function resetDatabase(projectDir: string): Promise<DatabaseResetResponse> {
  const directory = projectDir.trim()
  if (!appStore.connected) {
    throw new Error("Cannot reset database while disconnected")
  }
  if (!directory) {
    throw new Error("Cannot reset database without an active project directory")
  }
  return await apiJson("global/db/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectDir: directory }),
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

function promptProfileConfigShape(
  config: Record<string, any>,
  defaultActive: string,
): { active: string; profiles: Record<string, any> } {
  const promptProfile =
    config.prompt_profile && typeof config.prompt_profile === "object" && !Array.isArray(config.prompt_profile)
      ? config.prompt_profile
      : {}
  const profiles =
    promptProfile.profiles && typeof promptProfile.profiles === "object" && !Array.isArray(promptProfile.profiles)
      ? { ...promptProfile.profiles }
      : {}
  const active =
    typeof promptProfile.active === "string" && promptProfile.active.trim().length > 0
      ? promptProfile.active
      : defaultActive
  return { active, profiles }
}

function compactPromptProfileAgents(agents: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(agents).flatMap(([agentID, prompt]) => {
      if (typeof prompt !== "string" || prompt.trim().length === 0) return []
      return [[agentID, prompt]]
    }),
  )
}

function readImportString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string.`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${field} cannot be empty.`)
  }
  return trimmed
}

function readImportProfileID(value: unknown, field: string): string {
  const id = readImportString(value, field)
  if (id !== value || !PROMPT_PROFILE_IMPORT_ID_PATTERN.test(id)) {
    throw new Error(`${field} must use lowercase kebab-case.`)
  }
  return id
}

export function parsePromptProfileImportPayload(payload: unknown): PromptProfileImportPreview {
  if (!isRecord(payload)) {
    throw new Error("Prompt profile import must be a JSON object.")
  }
  if (!isRecord(payload.prompt_profile)) {
    throw new Error("Prompt profile import must contain a prompt_profile object.")
  }
  const promptProfile = payload.prompt_profile
  const rawProfiles = promptProfile.profiles
  if (!isRecord(rawProfiles) || Object.keys(rawProfiles).length === 0) {
    throw new Error("Prompt profile import must contain prompt_profile.profiles.")
  }
  const active =
    promptProfile.active === undefined
      ? undefined
      : readImportProfileID(promptProfile.active, "prompt_profile.active")
  const profiles: PromptProfileDraft[] = []
  for (const [profileID, rawProfile] of Object.entries(rawProfiles)) {
    const canonicalProfileID = readImportProfileID(profileID, `prompt_profile.profiles.${profileID}`)
    if (!isRecord(rawProfile)) {
      throw new Error(`prompt_profile.profiles.${profileID} must be an object.`)
    }
    const label = readImportString(rawProfile.label, `prompt_profile.profiles.${profileID}.label`)
    const description =
      rawProfile.description === undefined
        ? undefined
        : readImportString(rawProfile.description, `prompt_profile.profiles.${profileID}.description`)
    const rawAgents = rawProfile.agents === undefined ? {} : rawProfile.agents
    if (!isRecord(rawAgents)) {
      throw new Error(`prompt_profile.profiles.${profileID}.agents must be an object.`)
    }
    const agents: Record<string, string> = {}
    for (const [targetID, prompt] of Object.entries(rawAgents)) {
      if (!targetID || targetID.trim() !== targetID) {
        throw new Error(`prompt_profile.profiles.${profileID}.agents contains an invalid target id.`)
      }
      agents[targetID] = readImportString(prompt, `prompt_profile.profiles.${profileID}.agents.${targetID}`)
    }
    profiles.push({ id: canonicalProfileID, label, description, agents })
  }
  return { ...(active ? { active } : {}), profiles }
}

export function importPromptProfileConfig(
  config: Record<string, any>,
  preview: PromptProfileImportPreview,
  catalog: PromptProfileCatalog,
): void {
  const catalogProfiles = new Map(catalog.profiles.map((profile) => [profile.id, profile]))
  const catalogTargets = new Map(catalog.targets.map((target) => [target.id, target]))
  const importedIDs = new Set(preview.profiles.map((profile) => profile.id))
  if (preview.active && !catalogProfiles.has(preview.active) && !importedIDs.has(preview.active)) {
    throw new Error(`Unknown prompt profile ${JSON.stringify(preview.active)}.`)
  }

  const { active, profiles } = promptProfileConfigShape(config, catalog.default)
  for (const profile of preview.profiles) {
    readImportProfileID(profile.id, `prompt_profile.profiles.${profile.id}`)
    const existing = catalogProfiles.get(profile.id)
    if (existing?.built_in) {
      throw new Error(`prompt_profile.profiles.${profile.id} cannot override a built-in prompt profile.`)
    }
    if (existing && !existing.built_in) {
      throw new Error(`Prompt profile ${profile.id} already exists.`)
    }
    if (Object.hasOwn(profiles, profile.id)) {
      throw new Error(`Prompt profile ${profile.id} already exists.`)
    }
    for (const targetID of Object.keys(profile.agents ?? {})) {
      const prompt = profile.agents[targetID]
      if (typeof prompt !== "string" || prompt.trim().length === 0) {
        throw new Error(`prompt_profile.profiles.${profile.id}.agents.${targetID} cannot be empty.`)
      }
      const target = catalogTargets.get(targetID)
      if (!target) {
        throw new Error(`Unknown prompt profile target ${JSON.stringify(targetID)}.`)
      }
      if (!target.editable || target.built_in_only) {
        throw new Error(`prompt profile target ${targetID} is built-in-only and cannot be imported.`)
      }
    }
    const nextLabel = profile.label.trim()
    if (!nextLabel) {
      throw new Error(`prompt_profile.profiles.${profile.id}.label cannot be empty.`)
    }
    const nextDescription = typeof profile.description === "string" ? profile.description.trim() : ""
    profiles[profile.id] = {
      label: nextLabel,
      ...(nextDescription ? { description: nextDescription } : {}),
      agents: compactPromptProfileAgents(profile.agents ?? {}),
    }
  }
  config.prompt_profile = {
    active: preview.active ?? active,
    profiles,
  }
}

export async function importPromptProfiles(
  preview: PromptProfileImportPreview,
  catalog: PromptProfileCatalog,
): Promise<any> {
  const saved = await updateConfig((current) => {
    importPromptProfileConfig(current, preview, catalog)
  })
  markPromptProfileCatalogStale()
  return saved
}

export function createPromptProfileID(existingIDs: Iterable<string>, baseLabel: string): string {
  const taken = new Set(Array.from(existingIDs, (value) => String(value)))
  const seed =
    baseLabel
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "custom-squad"
  let nextID = seed
  let suffix = 2
  while (taken.has(nextID)) {
    nextID = `${seed}-${suffix}`
    suffix += 1
  }
  return nextID
}

export function upsertPromptProfileConfig(
  config: Record<string, any>,
  profile: PromptProfileDraft,
  defaultActive: string,
): void {
  const nextLabel = profile.label.trim()
  if (!nextLabel) {
    throw new Error("Prompt profile label cannot be empty.")
  }
  const nextDescription = typeof profile.description === "string" ? profile.description.trim() : ""
  const { active, profiles } = promptProfileConfigShape(config, defaultActive)
  profiles[profile.id] = {
    label: nextLabel,
    ...(nextDescription ? { description: nextDescription } : {}),
    agents: compactPromptProfileAgents(profile.agents ?? {}),
  }
  config.prompt_profile = {
    active,
    profiles,
  }
}

export function deletePromptProfileConfig(
  config: Record<string, any>,
  profileID: string,
  nextActive: string,
  defaultActive: string,
): void {
  const { active, profiles } = promptProfileConfigShape(config, defaultActive)
  delete profiles[profileID]
  config.prompt_profile = {
    active: active === profileID ? nextActive : active,
    ...(Object.keys(profiles).length > 0 ? { profiles } : {}),
  }
}

export async function savePromptProfile(profile: PromptProfileDraft, defaultActive: string): Promise<any> {
  const saved = await updateConfig((current) => {
    upsertPromptProfileConfig(current, profile, defaultActive)
  })
  markPromptProfileCatalogStale()
  return saved
}

export async function deletePromptProfile(profileID: string, nextActive: string, defaultActive: string): Promise<any> {
  const saved = await updateConfig((current) => {
    deletePromptProfileConfig(current, profileID, nextActive, defaultActive)
  })
  markPromptProfileCatalogStale()
  return saved
}

export async function setProjectPromptProfileActive(profileID: string): Promise<any> {
  const saved = await updateConfig((current) => {
    const promptProfile =
      current.prompt_profile && typeof current.prompt_profile === "object" && !Array.isArray(current.prompt_profile)
        ? { ...current.prompt_profile }
        : {}
    current.prompt_profile = {
      ...promptProfile,
      active: profileID,
    }
  })
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
    loadExtensions(),
    loadMeta(),
    loadTasks(),
    loadExecutors(directory),
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
  const items = await apiJson("config/prompt")
  applyPromptEntries(items)
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
      const configValue = promptConfigValueForSave(entry, value)
      if (configValue.trim()) item[field] = configValue
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

export function promptConfigValueForSave(entry: any, value: string): string {
  return value
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
