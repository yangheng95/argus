// ── Config Service ──
// Exact port of config/criteria/project-scope helpers from app.js.
//
// Functions ported (with original line numbers):
//   checkConfig            (line 6679)
//   hasExplicitChecks      (line 6685)
//   checkCanToggle         (line 6700)
//   checkSelectionConfig   (line 6704)
//   buildCheckConfig       (line 6874) — DOM-dependent; see note below
//   configUnattended       (line 2394)
//   syncUnattendedConfig   (line 2399)
//   updateConfig           (line 2383)
//   scaffoldProjectConfig  (line 1597)
//   reloadProjectScope     (line 4278) — bridged to legacy during migration
//
// NOTE: buildCheckConfig reads DOM checkboxes directly. In the Solid migration
// the criteria spec list lives in appStore.criteriaSpecs; callers that need to
// build a config diff from the current UI should call buildCheckConfigFromSpecs
// instead of reading the DOM.

import { apiJson } from "./api";
import { appStore, setAppStore } from "../store/app";
import { settingsStore } from "../store/settings";
import { AppLog } from "../utils/log";
import { t } from "../utils/i18n";

// ── Helpers ──

function hasTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as any).__TAURI__?.core?.invoke === "function"
  );
}

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const globalInvoke = (window as any).__TAURI__?.core?.invoke;
  if (typeof globalInvoke === "function") {
    return globalInvoke(command, args) as Promise<T>;
  }
  throw new Error(`Tauri runtime unavailable for ${command}`);
}

// ── Check Config Accessors ──

/**
 * Extract the `checks` config object from a task's metadata.
 * Returns a clone so callers can mutate the result safely.
 *
 * Mirrors app.js checkConfig (line 6679).
 */
export function checkConfig(task: any): Record<string, any> {
  const checks = task?.metadata?.checks;
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) return {};
  return structuredClone(checks);
}

/**
 * Returns true when the config object has at least one key (i.e. the user has
 * explicitly configured one or more checks).
 *
 * Mirrors app.js hasExplicitChecks (line 6685).
 */
export function hasExplicitChecks(config: Record<string, any>): boolean {
  return Object.keys(config).length > 0;
}

/**
 * Returns true when `key` names a check that can be freely toggled on/off by
 * the user (as opposed to command-type checks whose enabled state is implicit).
 *
 * Mirrors app.js checkCanToggle (line 6700).
 */
export function checkCanToggle(key: string): boolean {
  return ["artifact", "ui_review", "code_quality", "code_review", "dead_code_review", "spec_check"].includes(key);
}

/**
 * Build the config value to store when `key` is toggled on.
 * Returns `undefined` for keys that have no structured representation (i.e.
 * they are handled elsewhere or do not need an object value).
 *
 * Mirrors app.js checkSelectionConfig (line 6704).
 */
export function checkSelectionConfig(
  key: string,
  current: any,
): Record<string, any> | undefined {
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? structuredClone(current)
      : undefined;
  if (key === "artifact") return base || {};
  if (key === "ui_review") return { ...(base || {}), target: "web" };
  if (["code_quality", "code_review", "dead_code_review", "spec_check"].includes(key)) {
    return { ...(base || {}), enabled: true };
  }
  if (["startup", "visual", "puppeteer"].includes(key)) return base;
  return { ...(base || {}), enabled: true };
}

/**
 * Build an updated checks config from the current criteriaSpecs in appStore
 * and a map of `{ [specKey]: enabled }` selection values.
 *
 * This is the Solid-store equivalent of the DOM-reading buildCheckConfig
 * (app.js line 6874).  Pass `selection` as a plain object keyed by spec key.
 *
 * Mirrors app.js buildCheckConfig (line 6874) but without DOM reads.
 */
export function buildCheckConfigFromSpecs(
  task: any,
  selection: Record<string, boolean>,
): Record<string, any> {
  const current = checkConfig(task);
  const next = structuredClone(current);
  const named: Record<string, any> =
    next.named && typeof next.named === "object" && !Array.isArray(next.named)
      ? structuredClone(next.named)
      : {};

  for (const spec of appStore.criteriaSpecs as any[]) {
    if (spec.readOnly) continue;
    const enabled = selection[spec.key];
    if (enabled === undefined) continue;
    if (spec.kind === "named") {
      const currentNamed = named[spec.name];
      if (!currentNamed || typeof currentNamed !== "object" || Array.isArray(currentNamed)) continue;
      named[spec.name] = { ...currentNamed, enabled };
      continue;
    }
    if (spec.kind === "command") {
      if (enabled) {
        if (next[spec.name] === false) delete next[spec.name];
        continue;
      }
      next[spec.name] = false;
      continue;
    }
    if (enabled) {
      const currentValue = next[spec.name];
      const value = checkSelectionConfig(spec.name, currentValue);
      if (value) next[spec.name] = value;
      continue;
    }
    delete next[spec.name];
  }

  if (Object.keys(named).length > 0) next.named = named;
  else delete next.named;

  return next;
}

// ── Config Unattended Sync ──

/**
 * Extract the `experimental.unattended` boolean from a server config object.
 * Returns null when the field is absent or not a boolean.
 *
 * Mirrors app.js configUnattended (line 2394).
 */
export function configUnattended(config: any): boolean | null {
  const value = config?.experimental?.unattended;
  return typeof value === "boolean" ? value : null;
}

/**
 * PATCH /config to set `experimental.unattended` to the current
 * `settingsStore.unattended` value.  Skips the request when not connected,
 * or when the remote value already matches (unless `force` is true).
 *
 * Mirrors app.js syncUnattendedConfig (line 2399).
 */
export async function syncUnattendedConfig(force = false): Promise<boolean> {
  if (!appStore.connected) return false;
  const unattended = settingsStore.unattended ?? true;
  const remote = configUnattended(appStore.config);
  if (!force && remote === unattended) return false;
  try {
    const saved = await updateConfig((current) => {
      current.experimental = current.experimental || {};
      current.experimental.unattended = unattended;
    });
    setAppStore("config", saved);
    return true;
  } catch (e) {
    console.error("[config] Failed to sync unattended mode", e);
    return false;
  }
}

/**
 * Fetch the current server config, apply `mutator` to a clone, then PATCH the
 * result back.  Returns the saved config.
 *
 * Mirrors app.js updateConfig (line 2383).
 */
export async function updateConfig(mutator: (config: Record<string, any>) => void): Promise<any> {
  const current = await apiJson("config");
  const next = structuredClone(current || {});
  mutator(next);
  return apiJson("config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(next),
  });
}

// ── Project Config Scaffold ──

/**
 * Write a default `opencorvus.jsonc` file into `dir/.opencorvus/` via the
 * Tauri `overlay_write_file` command.  Silently no-ops when `dir` is empty.
 *
 * Mirrors app.js scaffoldProjectConfig (line 1597).
 */
export async function scaffoldProjectConfig(dir: string): Promise<void> {
  if (!dir) return;
  const base = dir.replace(/[\\/]+$/, "");
  const configFile = base + "/.opencorvus/opencorvus.jsonc";
  const username = settingsStore.username || "";
  const unattended = settingsStore.unattended !== false;
  const config = {
    $schema: "https://opencorvus.ai/config.json",
    experimental: {
      unattended,
    },
    lsp: {
      biome: { disabled: true },
      eslint: { disabled: true },
    },
    orchestrator: {
      spec: { max_steps: 30, timeout_ms: 300000, min_tool_calls: 3, quality_threshold: 0.6, max_attempts: 3 },
      planner: { max_steps: 30, timeout_ms: 300000, min_tool_calls: 3, quality_threshold: 0.5, max_attempts: 3 },
      evaluator: { max_steps: 25, timeout_ms: 240000, min_tool_calls: 3 },
      delivery: { max_steps: 40, timeout_ms: 600000, max_retries: 2, min_tool_calls: 3 },
      max_runs: 10,
      max_replans: 3,
      same_plan_retry_limit: 2,
      stage_max_retries: 2,
    },
    compaction: {
      auto: true,
      prune: true,
    },
    agent: {},
    mode: {},
    plugin: [],
    command: {},
    username,
  };
  try {
    await tauriInvoke("overlay_write_file", { path: configFile, content: JSON.stringify(config, null, 2) });
  } catch (e) {
    console.warn("[scaffold] Failed to scaffold project config", e);
  }
}

// ── Project Scope Reload ──

/**
 * Reset and then reload project-scope data (tasks, meta, extensions, config,
 * executors, preferences).  Delegates to the legacy bridge during the Solid
 * migration; direct port available for post-migration use.
 *
 * Mirrors app.js reloadProjectScope (line 4278).
 */
export async function reloadProjectScope(options: { restoreWorkspace?: boolean } = {}): Promise<void> {
  // Direct implementation — replaces the legacy window bridge.
  // Mirrors the parallel reload in app.js reloadProjectScope (line 4278):
  // reload config, extensions, meta, and optionally restore workspace.
  const { loadConfigInfo } = await import("./init");
  const { loadExtensions } = await import("./extensions");
  const { loadMeta } = await import("./meta");
  await Promise.all([
    loadConfigInfo().catch((e: unknown) => console.error("[reloadProjectScope] loadConfigInfo", e)),
    loadExtensions().catch((e: unknown) => console.error("[reloadProjectScope] loadExtensions", e)),
    loadMeta().catch((e: unknown) => console.error("[reloadProjectScope] loadMeta", e)),
  ]);
  if (options.restoreWorkspace) {
    const { restoreWorkspaceDirectory } = await import("./workspace");
    await restoreWorkspaceDirectory().catch((e: unknown) =>
      console.error("[reloadProjectScope] restoreWorkspaceDirectory", e),
    );
  }
}

// ── Prompt Catalog ──
// Mirrors app.js applyPromptEntries / loadPromptCatalog / savePromptEntry
// (lines 2677, 2683, 2694).

/**
 * Apply a raw prompt-entry list into the app store.
 * Mirrors app.js applyPromptEntries (line 2677).
 * DOM side-effect (renderPromptCatalog) remains in app.js during migration.
 */
export function applyPromptEntries(items: any[]): void {
  const entries = Array.isArray(items) ? items : [];
  setAppStore("promptEntries", entries);
}

/**
 * Load prompt entries from the server and push them into the store.
 * Mirrors app.js loadPromptCatalog (line 2683).
 */
export async function loadPromptCatalog(): Promise<void> {
  try {
    const items = await apiJson("config/prompt");
    applyPromptEntries(items);
  } catch (e) {
    AppLog.debug("prompt", "loadPromptCatalog failed, resetting to empty", { error: String(e) });
    applyPromptEntries([]);
  }
}

/**
 * Persist a single prompt entry override to the server config,
 * then reload the catalog.
 * Mirrors app.js savePromptEntry (line 2694).
 *
 * @param entry  The prompt entry to save
 * @param value  The new prompt text (empty string to clear the override)
 */
export async function savePromptEntry(entry: any, value: string): Promise<void> {
  if (!entry) return;
  try {
    await updateConfig((current: any) => {
      if (entry.scope === "system") {
        current.prompt = current.prompt || {};
        if (value.trim()) current.prompt[entry.key] = value;
        else delete current.prompt[entry.key];
        if (Object.keys(current.prompt).length === 0) delete current.prompt;
        return;
      }
      current.agent = current.agent || {};
      const item =
        current.agent?.[entry.key] && typeof current.agent[entry.key] === "object"
          ? { ...current.agent[entry.key] }
          : {};
      if (value.trim()) item.prompt = value;
      else delete (item as any).prompt;
      if (Object.keys(item).length === 0) delete current.agent[entry.key];
      else current.agent[entry.key] = item;
      if (Object.keys(current.agent).length === 0) delete current.agent;
    });
    await loadPromptCatalog();
  } catch (e) {
    AppLog.error("ui", "Failed to save prompt override", { error: String(e) });
    throw e;
  }
}
