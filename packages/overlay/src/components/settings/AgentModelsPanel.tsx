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

import { createSignal, createMemo, createResource, For, Show } from "solid-js";
import { apiJson } from "../../services/api";
import { patchConfig, updateConfig } from "../../services/config";
import { appStore } from "../../store/app";

interface AgentInfo {
  name: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  hidden?: boolean;
  native?: boolean;
  model?: { providerID: string; modelID: string };
}

interface ProviderModel {
  id: string;
  name?: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  models: Record<string, ProviderModel>;
}

interface ProvidersPayload {
  providers: ProviderInfo[];
  default: Record<string, string>;
}

// Tier groupings are display-only: they organize the UI list but no longer
// affect default model resolution (all agents inherit the project default).
const CORE_AGENTS = ["orchestrator", "build", "delivery", "general"];
const INTERNAL_AGENTS = ["compaction", "title", "summary"];

function tierOf(name: string): "core" | "internal" | "lightweight" {
  if (CORE_AGENTS.includes(name)) return "core";
  if (INTERNAL_AGENTS.includes(name)) return "internal";
  return "lightweight";
}

const TIER_ORDER: Array<"core" | "lightweight" | "internal"> = [
  "core",
  "lightweight",
  "internal",
];

const TIER_LABEL: Record<string, string> = {
  core: "Core — main coding agents",
  lightweight: "Lightweight — spec/plan/explore/etc.",
  internal: "Internal — background tasks",
};

export default function AgentModelsPanel() {
  const [refreshing, setRefreshing] = createSignal(false);
  const [refreshMsg, setRefreshMsg] = createSignal<string>("");
  const [savingAgent, setSavingAgent] = createSignal<string>("");
  const [savingDefault, setSavingDefault] = createSignal(false);

  // Agents + providers change rarely and are fetched via createResource with a
  // refreshToken knob. The project default `model` is deliberately NOT fetched
  // here — it is read directly from `appStore.config`, which the SSE
  // `config.changed` event keeps current. Keeping two independent sources of
  // truth for the same field (local createResource + global appStore.config)
  // was the original bug: after a save we set one and not the other, the UI
  // briefly flashed the new value, then the SSE-driven appStore refresh (or a
  // subsequent re-render reading stale createResource data) snapped it back.
  const [refreshToken, setRefreshToken] = createSignal(0);

  const [data] = createResource(refreshToken, async () => {
    const [agents, providers] = await Promise.all([
      apiJson("agent") as Promise<AgentInfo[]>,
      apiJson("config/providers") as Promise<ProvidersPayload>,
    ]);
    return {
      agents: agents ?? [],
      providers: providers ?? { providers: [], default: {} },
    };
  });

  // Single source of truth for the currently-persisted project default model.
  // Reads directly from appStore.config.model — the same value SSE
  // `config.changed` refreshes via loadConfigInfo(). Any write path below must
  // update appStore.config so this memo reflects reality without a re-fetch.
  const projectModel = createMemo<string>(() => {
    const m = (appStore.config as { model?: unknown } | null | undefined)?.model;
    return typeof m === "string" ? m : "";
  });

  async function onSelectProjectDefault(value: string) {
    setSavingDefault(true);
    try {
      // patchConfig sends only the diff (RFC 7396) and writes the returned
      // config to appStore.config. projectModel() is a memo over
      // appStore.config.model, so the UI reflects the new value the moment
      // the PATCH returns — no re-fetch window, no two-source drift.
      await patchConfig({ model: value ? value : null });
    } catch (e) {
      console.error("[project-default-model] save failed", e);
    } finally {
      setSavingDefault(false);
    }
  }

  function modelKey(m: { providerID: string; modelID: string } | undefined): string {
    return m ? `${m.providerID}/${m.modelID}` : "";
  }

  async function onSelect(agentName: string, value: string) {
    setSavingAgent(agentName);
    try {
      await updateConfig((cfg) => {
        cfg.agent = cfg.agent || {};
        const existing = cfg.agent[agentName];
        const existingKeys =
          existing && typeof existing === "object" && !Array.isArray(existing)
            ? Object.keys(existing).filter((k) => k !== "model")
            : [];
        if (!value) {
          // Clear override — use null sentinel (RFC 7396) so the server truly
          // removes the field from the config file instead of leaving a stub.
          if (existingKeys.length > 0) {
            // Agent has other overrides (prompt/permission/etc) — only delete .model.
            cfg.agent[agentName] = { ...existing, model: null };
          } else {
            // Entry exists only because of .model — drop the whole agent key.
            cfg.agent[agentName] = null;
          }
        } else {
          cfg.agent[agentName] = {
            ...(existing && typeof existing === "object" ? existing : {}),
            model: value,
          };
        }
      });
      setRefreshToken((x) => x + 1);
    } catch (e) {
      console.error("[agent-models] save failed", e);
    } finally {
      setSavingAgent("");
    }
  }

  async function handleRefreshHexin() {
    setRefreshing(true);
    setRefreshMsg("");
    try {
      const result = (await apiJson("provider/hexin/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })) as { ok: boolean; count: number; error?: string };
      if (result.ok) {
        setRefreshMsg(`Refreshed: ${result.count} hexin models`);
        setRefreshToken((x) => x + 1);
      } else {
        setRefreshMsg(`Refresh failed: ${result.error ?? "unknown"}`);
      }
    } catch (e) {
      setRefreshMsg(`Refresh error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRefreshing(false);
    }
  }

  interface ProviderGroup {
    id: string;
    name: string;
    models: Array<{ value: string; label: string }>;
  }

  function providerGroups(payload: ProvidersPayload | undefined): ProviderGroup[] {
    if (!payload) return [];
    const groups: ProviderGroup[] = [];
    const sortedProviders = [...payload.providers].sort((a, b) => a.name.localeCompare(b.name));
    for (const p of sortedProviders) {
      const modelIDs = Object.keys(p.models).sort();
      if (modelIDs.length === 0) continue;
      groups.push({
        id: p.id,
        name: p.name || p.id,
        models: modelIDs.map((modelID) => ({
          value: `${p.id}/${modelID}`,
          label: modelID,
        })),
      });
    }
    return groups;
  }

  function allModelValues(groups: ProviderGroup[]): Set<string> {
    const out = new Set<string>();
    for (const g of groups) for (const m of g.models) out.add(m.value);
    return out;
  }

  function groupedAgents(agents: AgentInfo[]) {
    const byTier: Record<string, AgentInfo[]> = { core: [], lightweight: [], internal: [] };
    for (const a of agents) byTier[tierOf(a.name)].push(a);
    for (const tier of Object.keys(byTier)) {
      byTier[tier].sort((x, y) => x.name.localeCompare(y.name));
    }
    return byTier;
  }

  return (
    <div class="general-panel">
      <div class="config-panel-group">
        <h4 class="config-panel-group-title">
          Agent Models
          <button
            type="button"
            class="btn btn-ghost mini"
            style="margin-left: auto; font-size: var(--ui-font-meta);"
            onClick={handleRefreshHexin}
            disabled={refreshing()}
          >
            {refreshing() ? "Refreshing…" : "Refresh Hexin Models"}
          </button>
        </h4>
        <p style="margin: 4px 0 12px 0; font-size: var(--ui-font-meta); opacity: 0.75;">
          Choose which LLM each agent uses. Leave unset to inherit the
          project default (top-level `model` in opencorvus.jsonc).
        </p>
        <Show when={refreshMsg()}>
          <div
            class="config-panel-card"
            style="margin-bottom: 10px; padding: 6px 10px; font-size: var(--ui-font-meta); opacity: 0.85;"
          >
            {refreshMsg()}
          </div>
        </Show>

        <Show when={data.loading}>
          <div class="empty-hint">Loading agents…</div>
        </Show>

        <Show when={data.error}>
          <div class="empty-hint" style="color: var(--color-danger, #e55);">
            Failed to load: {String(data.error)}
          </div>
        </Show>

        <Show when={data() && !data.loading}>
          {(() => {
            const payload = data()!;
            const groups = providerGroups(payload.providers);
            const available = allModelValues(groups);
            const grouped = groupedAgents(payload.agents);
            // projectModel() is a memo over appStore.config.model — re-reads
            // each render, so UI stays in sync with the canonical store.
            const currentModel = projectModel();
            const projectModelMissing = !currentModel;
            const projectModelUnavailable =
              !!currentModel && !available.has(currentModel);
            return (
              <>
                <div class="agent-model-project-default">
                  <div class="agent-model-row" title="Top-level `model` in opencorvus.jsonc">
                    <span class="agent-model-name">Project default</span>
                    <select
                      class="field-input agent-model-select"
                      value={currentModel}
                      disabled={savingDefault()}
                      onChange={(e) =>
                        onSelectProjectDefault(
                          (e.currentTarget as HTMLSelectElement).value,
                        )
                      }
                    >
                      <option value="">— not set —</option>
                      <Show when={projectModelUnavailable}>
                        <option value={currentModel}>{currentModel} (unavailable)</option>
                      </Show>
                      <For each={groups}>
                        {(g) => (
                          <optgroup label={g.name}>
                            <For each={g.models}>
                              {(opt) => (
                                <option value={opt.value}>{opt.label}</option>
                              )}
                            </For>
                          </optgroup>
                        )}
                      </For>
                    </select>
                    <span class="agent-model-status">
                      <Show when={savingDefault()}>saving…</Show>
                    </span>
                  </div>
                  <Show when={projectModelMissing}>
                    <div
                      class="config-panel-card"
                      style="margin-top: 8px; padding: 6px 10px; font-size: var(--ui-font-meta); border-left: 3px solid var(--color-danger, #e55); color: var(--color-danger, #e55);"
                    >
                      No project default model set. Every agent will fail with
                      <code> MissingModelConfigError </code>
                      on dispatch until a model is chosen here (or each agent is
                      individually overridden below).
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
                            const current = modelKey(agent.model);
                            const missing = current !== "" && !available.has(current);
                            return (
                              <div class="agent-model-row" title={agent.description || ""}>
                                <span class="agent-model-name">{agent.name}</span>
                                <select
                                  class="field-input agent-model-select"
                                  value={current}
                                  disabled={savingAgent() === agent.name}
                                  onChange={(e) =>
                                    onSelect(
                                      agent.name,
                                      (e.currentTarget as HTMLSelectElement).value,
                                    )
                                  }
                                >
                                  <option value="">— inherit project default —</option>
                                  <Show when={missing}>
                                    <option value={current}>{current} (unavailable)</option>
                                  </Show>
                                  <For each={groups}>
                                    {(g) => (
                                      <optgroup label={g.name}>
                                        <For each={g.models}>
                                          {(opt) => (
                                            <option value={opt.value}>{opt.label}</option>
                                          )}
                                        </For>
                                      </optgroup>
                                    )}
                                  </For>
                                </select>
                                <span class="agent-model-status">
                                  <Show when={savingAgent() === agent.name}>saving…</Show>
                                </span>
                              </div>
                            );
                          }}
                        </For>
                      </Show>
                    )}
                  </For>
                </div>
              </>
            );
          })()}
        </Show>
      </div>
    </div>
  );
}
