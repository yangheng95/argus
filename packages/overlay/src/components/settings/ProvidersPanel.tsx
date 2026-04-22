// ── ProvidersPanel ──
// Solid.js component for managing custom LLM providers.
// Allows adding, editing, and removing OpenAI-compatible providers
// via the opencorvus config system (PATCH /config → provider field).

import { createSignal, For, Show } from "solid-js";
import { t } from "../../utils/i18n";
import { appStore, setAppStore } from "../../store/app";
import { updateConfig } from "../../services/config";
import { apiJson } from "../../services/api";

interface ProviderModel {
  name: string;
  tool_call: boolean;
}

interface CustomProvider {
  name: string;
  api: string;
  env: string[];
  models: Record<string, ProviderModel>;
}

export default function ProvidersPanel() {
  const [saving, setSaving] = createSignal(false);
  const [editing, setEditing] = createSignal<string | null>(null);
  const [showAdd, setShowAdd] = createSignal(false);

  // Form state for add/edit
  const [formId, setFormId] = createSignal("");
  const [formName, setFormName] = createSignal("");
  const [formApi, setFormApi] = createSignal("");
  const [formEnvKey, setFormEnvKey] = createSignal("");
  const [formModels, setFormModels] = createSignal("");

  function configProviders(): Record<string, CustomProvider> {
    const cfg = appStore.config;
    const p = cfg?.provider;
    if (!p || typeof p !== "object" || Array.isArray(p)) return {};
    return p as Record<string, CustomProvider>;
  }

  function catalogProviders(): Record<string, any> {
    return appStore.providerCatalog || {};
  }

  function resetForm() {
    setFormId("");
    setFormName("");
    setFormApi("");
    setFormEnvKey("");
    setFormModels("");
  }

  function startAdd() {
    resetForm();
    setEditing(null);
    setShowAdd(true);
  }

  function startEdit(id: string) {
    const p = configProviders()[id];
    if (!p) return;
    setFormId(id);
    setFormName(p.name || "");
    setFormApi(p.api || "");
    setFormEnvKey(p.env?.[0] || "");
    const modelStr = Object.entries(p.models || {})
      .map(([mid, m]) => `${mid}:${m.name || mid}`)
      .join("\n");
    setFormModels(modelStr);
    setEditing(id);
    setShowAdd(true);
  }

  function parseModels(text: string): Record<string, ProviderModel> {
    const models: Record<string, ProviderModel> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(":");
      const id = colonIdx > 0 ? trimmed.slice(0, colonIdx).trim() : trimmed;
      const name = colonIdx > 0 ? trimmed.slice(colonIdx + 1).trim() : id;
      if (id) {
        models[id] = { name: name || id, tool_call: true };
      }
    }
    return models;
  }

  async function handleSave() {
    const id = editing() || formId().trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-");
    if (!id || !formApi().trim()) return;

    setSaving(true);
    try {
      const provider: CustomProvider = {
        name: formName().trim() || id,
        api: formApi().trim().replace(/\/+$/, ""),
        env: formEnvKey().trim() ? [formEnvKey().trim()] : [],
        models: parseModels(formModels()),
      };

      await updateConfig((cfg) => {
        cfg.provider = cfg.provider || {};
        cfg.provider[id] = provider;
      });

      // Reload config
      const newCfg = await apiJson("config");
      setAppStore("config", newCfg);

      setShowAdd(false);
      resetForm();
      setEditing(null);
    } catch (e) {
      console.error("[providers] save failed", e);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setSaving(true);
    try {
      await updateConfig((cfg) => {
        if (cfg.provider) {
          delete cfg.provider[id];
          if (Object.keys(cfg.provider).length === 0) delete cfg.provider;
        }
      });

      const newCfg = await apiJson("config");
      setAppStore("config", newCfg);
    } catch (e) {
      console.error("[providers] delete failed", e);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setShowAdd(false);
    resetForm();
    setEditing(null);
  }

  const providerEntries = () => Object.entries(configProviders());
  const catalogEntries = () => {
    const custom = new Set(Object.keys(configProviders()));
    return Object.entries(catalogProviders())
      .filter(([id]) => !custom.has(id))
      .map(([id, p]) => ({ id, name: p.name || id, source: p.source || "auto", modelCount: Object.keys(p.models || {}).length }));
  };

  return (
    <div class="general-panel">
      {/* ── Custom Providers ── */}
      <div class="config-panel-group">
        <div class="config-panel-group-head">
          <h4 class="config-panel-group-title">Custom Providers</h4>
          <button
            type="button"
            class="btn btn-primary mini"
            onClick={startAdd}
          >
            + Add
          </button>
        </div>

        <Show when={providerEntries().length === 0 && !showAdd()}>
          <div class="config-panel-card" style="opacity: 0.6; font-size: var(--ui-font-control); padding: 12px;">
            No custom providers configured. Click "+ Add" to add an OpenAI-compatible provider.
          </div>
        </Show>

        <For each={providerEntries()}>
          {([id, provider]) => (
            <div class="config-panel-card" style="margin-bottom: 8px;">
              <div class="config-panel-card-head">
                <strong class="config-panel-card-title">{provider.name || id}</strong>
                <div class="config-panel-card-actions">
                  <button
                    type="button"
                    class="btn mini"
                    onClick={() => startEdit(id)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    class="btn mini danger"
                    onClick={() => handleDelete(id)}
                    disabled={saving()}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div style="font-size: var(--ui-font-control); opacity: 0.7; margin-bottom: 2px;">
                API: {provider.api}
              </div>
              <Show when={provider.env?.length}>
                <div style="font-size: var(--ui-font-control); opacity: 0.7; margin-bottom: 2px;">
                  Env: {provider.env.join(", ")}
                </div>
              </Show>
              <div style="font-size: var(--ui-font-control); opacity: 0.7;">
                Models: {Object.keys(provider.models || {}).join(", ") || "none"}
              </div>
            </div>
          )}
        </For>

        {/* ── Add / Edit Form ── */}
        <Show when={showAdd()}>
          <div class="config-panel-card" style="margin-top: 8px; border: 1px solid var(--color-border, #444);">
            <h4 style="font-size: var(--ui-font-title); margin: 0 0 8px 0;">
              {editing() ? `Edit: ${editing()}` : "Add Custom Provider"}
            </h4>

            <Show when={!editing()}>
              <label class="field">
                <span class="field-label">Provider ID</span>
                <input
                  class="field-input"
                  type="text"
                  placeholder="e.g. hexin, my-gateway"
                  value={formId()}
                  onInput={(e) => setFormId(e.currentTarget.value)}
                />
              </label>
            </Show>

            <label class="field">
              <span class="field-label">Display Name</span>
              <input
                class="field-input"
                type="text"
                placeholder="e.g. Hexin OpenAI Gateway"
                value={formName()}
                onInput={(e) => setFormName(e.currentTarget.value)}
              />
            </label>

            <label class="field">
              <span class="field-label">API Base URL</span>
              <input
                class="field-input"
                type="url"
                placeholder="e.g. https://my-gateway.com/v1"
                value={formApi()}
                onInput={(e) => setFormApi(e.currentTarget.value)}
              />
            </label>

            <label class="field">
              <span class="field-label">API Key Env Variable</span>
              <input
                class="field-input"
                type="text"
                placeholder="e.g. MY_API_KEY"
                value={formEnvKey()}
                onInput={(e) => setFormEnvKey(e.currentTarget.value)}
              />
            </label>

            <label class="field">
              <span class="field-label">Models (one per line: id:display_name)</span>
              <textarea
                class="field-input"
                rows={4}
                placeholder={"gpt-5.4-mini:GPT-5.4 Mini\ngpt-5.4:GPT-5.4"}
                value={formModels()}
                onInput={(e) => setFormModels(e.currentTarget.value)}
                style="font-family: var(--mono); font-size: var(--ui-font-control); resize: vertical;"
              />
            </label>

            <div class="dialog-actions compact" style="margin-top: 8px;">
              <button type="button" class="btn mini" onClick={cancel}>
                Cancel
              </button>
              <button
                type="button"
                class="btn btn-primary mini"
                onClick={handleSave}
                disabled={saving() || (!editing() && !formId().trim()) || !formApi().trim()}
              >
                {saving() ? "Saving..." : editing() ? "Update" : "Add Provider"}
              </button>
            </div>
          </div>
        </Show>
      </div>

      {/* ── Connected Providers (read-only) ── */}
      <Show when={catalogEntries().length > 0}>
        <div class="config-panel-group">
          <h4 class="config-panel-group-title">Connected Providers</h4>
          <div class="config-panel-card">
            <div style="font-size: var(--ui-font-control); opacity: 0.6; margin-bottom: 6px;">
              Auto-detected providers from models.dev, env vars, and auth.
            </div>
            <div class="config-panel-list">
              <For each={catalogEntries()}>
                {(p) => (
                  <div class="config-panel-list-row">
                    <span class="config-panel-list-main">{p.name}</span>
                    <span class="config-panel-list-meta">{p.modelCount} models</span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
