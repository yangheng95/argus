// ── Executor Service ──
// State + helpers for the ExecutorSelector Solid component (ChatComposer
// bottom-left). The previous imperative engine-bar + #codexModelPanel /
// #claudeCodeModelPanel + getElementById click delegation in main.tsx
// has been replaced — the Solid component owns its own DOM, dropdown,
// and dismissal handlers. This service supplies the data accessors and
// the API setter only.

import { appStore, setAppStore, setExecutors } from "../store/app"
import { AppLog } from "../utils/log"
import { t } from "../utils/i18n"
import { apiJson } from "./api"

// ── Types ──

export interface ExecutorDescriptor {
  id: string
  label?: string
  version?: string
  detail?: string
  model?: string
  selectable?: boolean
  discovered?: boolean
}

export interface ExecutorModelUpdate {
  executorID: string
  model: string
  directory: string
  isCurrentDirectory?: (directory: string) => boolean
}

export interface ExecutorLoadOptions {
  isCurrentDirectory?: (directory: string) => boolean
}

// ── Label helpers ──

/** Returns a human-readable display label for a known executor ID. */
export function executorLabel(value: string): string {
  if (value === "codex") return "Codex"
  if (value === "claude-code") return "Claude Code"
  if (value === "opencorvus") return "OpenCorvus"
  return value
}

/** Returns the full descriptor for an executor from the store, or undefined. */
export function executorInfo(value: string): ExecutorDescriptor | undefined {
  return appStore.executors.find((item: ExecutorDescriptor) => item.id === value)
}

/**
 * Returns true when the executor can be selected (i.e. it was discovered and
 * is marked as selectable, or falls back to the OpenCorvus default
 * executor id ("opencorvus").
 */
export function executorSelectable(value: string): boolean {
  const item = executorInfo(value)
  if (item) return !!item.selectable
  return value === "opencorvus"
}

/**
 * Returns a localised hint about manual installation requirements for
 * executors that cannot be auto-selected.
 */
export function executorSetupHint(value: string): string {
  if (value === "codex" || value === "claude-code") {
    return t("executor.manual_install_auth_required")
  }
  return ""
}

/**
 * Builds the multi-line tooltip title for an executor button, including
 * version, detail, and any setup hint.
 */
export function executorTitle(value: string): string {
  const item = executorInfo(value)
  const selectable = executorSelectable(value)
  const lines: string[] = [item?.label ?? executorLabel(value)]
  if (item?.version) lines.push(t("executor.version", { version: item.version }))
  if (item?.detail) lines.push(item.detail)
  if (!selectable) {
    lines.push(
      item
        ? item.discovered
          ? t("executor.detected_not_selectable")
          : t("executor.not_detected")
        : t("executor.not_detected"),
    )
    const hint = executorSetupHint(value)
    if (hint) lines.push(hint)
  }
  return lines.filter(Boolean).join("\n")
}

/** Returns the currently active model for an executor, or empty string. */
export function executorCurrentModel(executorID: string): string {
  const info = executorInfo(executorID)
  return info?.model ?? ""
}

/** Maps executor ID → provider IDs whose models are relevant for that
 *  executor. Drives the model picker; OpenCorvus has no entry because its
 *  model is not user-selectable in the overlay (it follows project config). */
export const EXECUTOR_PROVIDER_MAP: Record<string, string[]> = {
  codex: ["openai-codex", "openai"],
  "claude-code": ["anthropic"],
}

/** Returns true when the executor has user-selectable models. OpenCorvus
 *  returns false (its model follows project config). */
export function executorHasModelChoice(executorID: string): boolean {
  return executorID in EXECUTOR_PROVIDER_MAP
}

/** Derive the live model list for an executor from the provider catalog. */
export function executorModels(executorID: string): string[] {
  const catalog = appStore.providerCatalog as any
  if (!catalog?.all) return []
  const providerIDs = EXECUTOR_PROVIDER_MAP[executorID]
  if (!providerIDs) return []
  const models: string[] = []
  for (const provider of catalog.all as any[]) {
    if (!providerIDs.includes(provider.id)) continue
    if (!provider.models || typeof provider.models !== "object") continue
    for (const model of Object.values(provider.models) as any[]) {
      if (model?.id) models.push(model.id)
    }
  }
  return models
}

/**
 * Maps a process kind string to its short tag label shown in the executor log.
 * Mirrors executorProcessKindTag.
 */
export function executorProcessKindTag(kind: string): string {
  if (kind === "command") return "CMD"
  if (kind === "approval") return "ASK"
  if (kind === "input") return "IN"
  if (kind === "mcp") return "MCP"
  if (kind === "error") return "ERR"
  return "TOOL"
}

// ── Loader ──

/**
 * Fetches the executor list from the server and updates the app store.
 * Request and payload failures reject so project-scope reload does not
 * silently present a stale or empty executor projection.
 * NOTE: `renderExecutor()` / `persistOverlaySettings()` calls are
 * omitted here because they belong to 's DOM world. Callers that need
 * to persist settings after loading should do so explicitly.
 */
function executorPath(directory: string, suffix = ""): string {
  const trimmed = directory.trim()
  if (!trimmed) throw new Error("executor service requires a project directory")
  const params = new URLSearchParams({ directory: trimmed })
  return `executor${suffix}?${params.toString()}`
}

function ownsExecutorDirectory(directory: string, options: ExecutorLoadOptions): boolean {
  return !options.isCurrentDirectory || options.isCurrentDirectory(directory.trim())
}

export async function loadExecutors(
  directory: string,
  options: ExecutorLoadOptions = {},
): Promise<ExecutorDescriptor[]> {
  const data = await apiJson(executorPath(directory))
  if (!Array.isArray(data)) {
    AppLog.debug("executor", "loadExecutors received non-array payload", {
      payloadType: typeof data,
    })
    throw new Error("executor returned a non-array payload")
  }
  if (ownsExecutorDirectory(directory, options)) setExecutors(data)
  return data
}

// ── Model setter ──

/**
 * PATCHes the model for the given executor via the API, then reloads the
 * executor list.
 */
export async function setExecutorModel(input: ExecutorModelUpdate): Promise<void> {
  const executorID = input.executorID.trim()
  if (!executorID) throw new Error("setExecutorModel: executorID is required")
  try {
    await apiJson(executorPath(input.directory, `/${encodeURIComponent(executorID)}/model`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: input.model }),
    })
    await loadExecutors(input.directory, { isCurrentDirectory: input.isCurrentDirectory })
  } catch (e) {
    AppLog.error("ui", "Failed to set executor model", {
      error: String(e),
      executorID,
      model: input.model,
    })
    throw e
  }
}
