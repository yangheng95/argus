// ── Executor Service ──
// TypeScript port of executor-related functions
// executorLabel, executorInfo, executorSelectable, executorSetupHint,
// executorTitle, executorCurrentModel, executorProcessKindTag,
// loadExecutors, setExecutorModel.
// DOM-rendering functions (renderExecutorModelPanel, openExecutorModelPanel,
// closeAllExecutorModelPanels, renderExecutor, syncExecutorWidth) are
// intentionally NOT ported here — they are dead code in the Solid.js world
// and are superseded by ExecutorModelPanel.tsx / ExecutorModelPanelController.

import { appStore, setAppStore, setExecutors } from "../store/app";
import { AppLog } from "../utils/log";
import { t } from "../utils/i18n";
import { apiJson } from "./api";

// ── Types ──

export interface ExecutorDescriptor {
  id: string;
  label?: string;
  version?: string;
  detail?: string;
  model?: string;
  selectable?: boolean;
  discovered?: boolean;
}

// ── Label helpers ──

/** Returns a human-readable display label for a known executor ID. */
export function executorLabel(value: string): string {
  if (value === "codex") return "Codex";
  if (value === "claude-code") return "Claude Code";
  return "MirrorCode";
}

/** Returns the full descriptor for an executor from the store, or undefined. */
export function executorInfo(value: string): ExecutorDescriptor | undefined {
  return appStore.executors.find((item: ExecutorDescriptor) => item.id === value);
}

/**
 * Returns true when the executor can be selected (i.e. it was discovered and
 * is marked as selectable, or falls back to the "opencode" default).
 */
export function executorSelectable(value: string): boolean {
  const item = executorInfo(value);
  if (item) return !!item.selectable;
  return value === "opencode";
}

/**
 * Returns a localised hint about manual installation requirements for
 * executors that cannot be auto-selected.
 */
export function executorSetupHint(value: string): string {
  if (value === "codex" || value === "claude-code") {
    return t("executor.manual_install_auth_required");
  }
  return "";
}

/**
 * Builds the multi-line tooltip title for an executor button, including
 * version, detail, and any setup hint.
 */
export function executorTitle(value: string): string {
  const item = executorInfo(value);
  const selectable = executorSelectable(value);
  const lines: string[] = [item?.label ?? executorLabel(value)];
  if (item?.version) lines.push(t("executor.version", { version: item.version }));
  if (item?.detail) lines.push(item.detail);
  if (!selectable) {
    lines.push(
      item
        ? item.discovered
          ? t("executor.detected_not_selectable")
          : t("executor.not_detected")
        : t("executor.not_detected"),
    );
    const hint = executorSetupHint(value);
    if (hint) lines.push(hint);
  }
  return lines.filter(Boolean).join("\n");
}

/** Returns the currently active model for an executor, or empty string. */
export function executorCurrentModel(executorID: string): string {
  const info = executorInfo(executorID);
  return info?.model ?? "";
}

/**
 * Maps a process kind string to its short tag label shown in the executor log.
 * Mirrors executorProcessKindTag.
 */
export function executorProcessKindTag(kind: string): string {
  if (kind === "command") return "CMD";
  if (kind === "approval") return "ASK";
  if (kind === "input") return "IN";
  if (kind === "mcp") return "MCP";
  if (kind === "error") return "ERR";
  return "TOOL";
}

// ── Loader ──

/**
 * Fetches the executor list from the server and updates the app store.
 * If the currently active executor is no longer selectable, falls back to
 * the first selectable executor or "opencode".
 * NOTE: `renderExecutor()` / `persistOverlaySettings()` calls are
 * omitted here because they belong to 's DOM world. Callers that need
 * to persist settings after loading should do so explicitly.
 */
export async function loadExecutors(): Promise<void> {
  try {
    const data = await apiJson("executor");
    setExecutors(Array.isArray(data) ? data : []);
  } catch (e) {
    AppLog.debug("executor", "loadExecutors failed, resetting to empty", {
      error: String(e),
    });
    setExecutors([]);
  }
}

// ── Model setter ──

/**
 * PATCHes the model for the given executor via the API, then reloads the
 * executor list.
 */
export async function setExecutorModel(
  executorID: string,
  model: string,
): Promise<void> {
  try {
    await apiJson(`executor/${encodeURIComponent(executorID)}/model`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    await loadExecutors();
  } catch (e) {
    AppLog.error("ui", "Failed to set executor model", {
      error: String(e),
      executorID,
      model,
    });
  }
}
