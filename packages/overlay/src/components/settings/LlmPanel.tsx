// ── LlmPanel ──
// Solid.js component that mirrors the LLM provider configuration from app.js:
//   providerEntry, providerLabel, providerConnected, providerAuthMethods,
//   providerState, renderProviderStatus, renderLlmAuthAction,
//   renderLlmSummary, renderLlmApiKeyTools, populateProviderSelect,
//   populateModelSelect, syncLlmSettings, setLlmBusy, showLlmNotice,
//   authenticateSelectedProvider, testProviderConnection.
//
// Uses established CSS patterns from styles.css: .config-panel-card,
// .config-panel-group, .field-input-group, .field-input-actions,
// .field-input-icon, .config-status-box, etc.

import {
  createSignal,
  createMemo,
  For,
  Show,
  onMount,
  onCleanup,
  batch,
} from "solid-js";
import { t, tc } from "../../utils/i18n";
import { apiJson } from "../../services/api";
import { updateConfig } from "../../services/config";

// ── Types ──

interface ProviderEntry {
  id: string;
  name?: string;
  key?: string;
  env?: string[];
  models?: Record<string, any>;
}

interface ProviderCatalog {
  all?: ProviderEntry[];
  connected?: string[];
  default?: Record<string, string>;
}

interface AuthMethodItem {
  type: "oauth" | "api";
  label: string;
  index: number;
}

interface ProviderTest {
  providerID: string;
  modelID: string;
  ok: boolean;
  message: string;
}

function recordGuard(value: any): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// ── Helpers ──

function parseProviderAuthMethods(
  providerAuth: Record<string, any[]> | null,
  providerID: string,
): AuthMethodItem[] {
  const items = Array.isArray(providerAuth?.[providerID])
    ? providerAuth![providerID]
    : [];
  const result: AuthMethodItem[] = [];
  let index = 0;
  for (const item of items) {
    if (recordGuard(item)) {
      const type = item.type === "oauth" ? "oauth" : "api";
      const label =
        typeof item.label === "string" && item.label.trim()
          ? item.label.trim()
          : type === "oauth"
            ? "OAuth"
            : "API key";
      result.push({ type, label, index });
    } else if (typeof item === "string") {
      const value = item.trim();
      if (!value) {
        index++;
        continue;
      }
      const type = /oauth/i.test(value) ? "oauth" : "api";
      const label = value === "api_key" ? "API key" : value;
      result.push({ type, label, index });
    }
    index++;
  }
  return result;
}

// ── SVG icons (mirrors app.js llmToggleIcon / llmCopyIcon) ──

const hideEyeSvg = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.1 2.1l11.8 11.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M6 6.3A2.8 2.8 0 019.7 10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M1.7 8c1.6-2.8 3.8-4.2 6.3-4.2 2.4 0 4.6 1.4 6.3 4.2-.5.9-1 1.6-1.6 2.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const showEyeSvg = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.7 8c1.6-2.8 3.8-4.2 6.3-4.2s4.7 1.4 6.3 4.2c-1.6 2.8-3.8 4.2-6.3 4.2S3.3 10.8 1.7 8z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.2"/></svg>`;
const copySvg = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.2" y="4.2" width="7.1" height="8.1" rx="1.4" stroke="currentColor" stroke-width="1.2"/><path d="M4.2 10.6H3.7A1.5 1.5 0 012.2 9.1V3.7a1.5 1.5 0 011.5-1.5h5.4a1.5 1.5 0 011.5 1.5v.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;

// ── LlmPanel ──

export default function LlmPanel() {
  // Catalog state
  const [catalog, setCatalog] = createSignal<ProviderCatalog>({});
  const [providerAuth, setProviderAuth] = createSignal<Record<string, any[]>>({});
  const [appConfig, setAppConfig] = createSignal<any>(null);

  // Form state
  const [selectedProvider, setSelectedProvider] = createSignal("");
  const [selectedModel, setSelectedModel] = createSignal("");
  const [apiKey, setApiKey] = createSignal("");
  const [apiKeyVisible, setApiKeyVisible] = createSignal(false);

  // UI state
  const [busy, setBusy] = createSignal(false);
  const [providerTest, setProviderTest] = createSignal<ProviderTest | null>(null);
  const [notice, setNotice] = createSignal("");
  const [noticeTone, setNoticeTone] = createSignal("");
  const [noticeOpen, setNoticeOpen] = createSignal(false);
  const [loading, setLoading] = createSignal(false);

  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  let syncSerial = 0;
  let savedKey = "";

  // ── Derived ──

  const providers = createMemo((): ProviderEntry[] => {
    const all: ProviderEntry[] = Array.isArray(catalog().all)
      ? [...catalog().all!]
      : [];
    const connected = catalog().connected || [];
    all.sort((a, b) => {
      const ac = connected.includes(a.id) ? 0 : 1;
      const bc = connected.includes(b.id) ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return (a.name || a.id).localeCompare(b.name || b.id);
    });
    return all;
  });

  const currentProvider = createMemo(
    () => providers().find((p) => p.id === selectedProvider()) ?? null,
  );

  const availableModels = createMemo((): string[] => {
    const p = currentProvider();
    return Object.keys(p?.models || {}).sort((a, b) => a.localeCompare(b));
  });

  const authMethods = createMemo((): AuthMethodItem[] => {
    return parseProviderAuthMethods(providerAuth(), selectedProvider());
  });

  const isConnected = createMemo((): boolean => {
    const connected = catalog().connected || [];
    return connected.includes(selectedProvider());
  });

  // ── providerState (mirrors app.js providerState) ──

  const statusInfo = createMemo(() => {
    const providerID = selectedProvider();
    const modelID = selectedModel();
    const tested = providerTest();
    if (!providerID) {
      return { tone: "", label: t("llm.status.unknown"), detail: "" };
    }
    if (tested?.providerID === providerID && tested?.modelID === modelID) {
      return {
        tone: tested.ok ? "active" : "error",
        label: tested.ok ? t("llm.status.connected") : t("llm.status.error"),
        detail: tested.message,
      };
    }
    if (isConnected()) {
      return {
        tone: "active",
        label: t("llm.status.connected"),
        detail: t("llm.detail.connected"),
      };
    }
    const configKey =
      appConfig()?.provider?.[providerID]?.options?.apiKey;
    const key = configKey || currentProvider()?.key;
    if (key) {
      return {
        tone: "ready",
        label: t("llm.status.configured"),
        detail: t("llm.detail.configured"),
      };
    }
    if (authMethods().length > 0) {
      return {
        tone: "warn",
        label: t("llm.status.auth_required"),
        detail: tc("llm.detail.auth_methods", authMethods().length),
      };
    }
    const envVars = currentProvider()?.env || [];
    if (envVars.length > 0) {
      return {
        tone: "warn",
        label: t("llm.status.needs_api_key"),
        detail: t("llm.detail.needs_api_key", { names: envVars.join(", ") }),
      };
    }
    return {
      tone: "",
      label: t("llm.status.available"),
      detail: t("llm.detail.available"),
    };
  });

  const summaryText = createMemo(() => {
    const pid = selectedProvider();
    const mid = selectedModel();
    if (!pid || !mid) return t("llm.summary_empty");
    const name =
      providers().find((p) => p.id === pid)?.name || pid;
    return t("llm.summary_value", { provider: name, model: mid });
  });

  const hasApiKey = createMemo(() => !!apiKey().trim());

  // ── Load ──

  async function load() {
    setLoading(true);
    try {
      const [catalogData, authData, configData] = await Promise.all([
        apiJson("provider").catch(() => ({})),
        apiJson("provider/auth").catch(() => ({})),
        apiJson("config").catch(() => ({})),
      ]);
      batch(() => {
        setCatalog(recordGuard(catalogData) ? catalogData : {});
        setProviderAuth(recordGuard(authData) ? authData : {});
        setAppConfig(recordGuard(configData) ? configData : null);
      });
      initSelections(configData, catalogData);
    } finally {
      setLoading(false);
    }
  }

  function initSelections(config: any, cat: ProviderCatalog) {
    const all: ProviderEntry[] = Array.isArray(cat?.all) ? [...cat.all] : [];
    const connected: string[] = cat?.connected || [];
    all.sort((a, b) => {
      const ac = connected.includes(a.id) ? 0 : 1;
      const bc = connected.includes(b.id) ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return (a.name || a.id).localeCompare(b.name || b.id);
    });

    const currentModel: string =
      typeof config?.model === "string" && config.model.includes("/")
        ? config.model
        : "";
    const currentProvID = currentModel ? currentModel.split("/")[0] : "";
    const currentModID = currentProvID
      ? currentModel.slice(currentProvID.length + 1)
      : "";

    const resolvedProv =
      all.find((p) => p.id === currentProvID)?.id ||
      all[0]?.id ||
      "";
    setSelectedProvider(resolvedProv);

    const modelsForProv = Object.keys(
      all.find((p) => p.id === resolvedProv)?.models || {},
    ).sort((a, b) => a.localeCompare(b));

    const defaultModel =
      cat?.default?.[resolvedProv] || modelsForProv[0] || "";
    const resolvedMod =
      resolvedProv === currentProvID &&
      modelsForProv.includes(currentModID)
        ? currentModID
        : defaultModel;

    setSelectedModel(
      modelsForProv.includes(resolvedMod) ? resolvedMod : modelsForProv[0] || "",
    );
    setApiKey(
      config?.provider?.[resolvedProv]?.options?.apiKey || "",
    );

    savedKey = selectionKey(
      resolvedProv,
      modelsForProv.includes(resolvedMod) ? resolvedMod : modelsForProv[0] || "",
      config?.provider?.[resolvedProv]?.options?.apiKey || "",
    );
  }

  onMount(load);

  // ── Selection key ──

  function selectionKey(pid: string, mid: string, key: string): string {
    return JSON.stringify([pid, mid, key]);
  }

  // ── Provider change ──

  function handleProviderChange(pid: string) {
    setSelectedProvider(pid);
    setProviderTest(null);

    const provEntry = providers().find((p) => p.id === pid);
    const models = Object.keys(provEntry?.models || {}).sort((a, b) =>
      a.localeCompare(b),
    );
    const defaultMod =
      catalog().default?.[pid] || models[0] || "";
    setSelectedModel(models.includes(defaultMod) ? defaultMod : models[0] || "");
    setApiKey(appConfig()?.provider?.[pid]?.options?.apiKey || "");
    queueSync();
  }

  function handleModelChange(mid: string) {
    setSelectedModel(mid);
    setProviderTest(null);
    queueSync();
  }

  function handleApiKeyChange(value: string) {
    setApiKey(value);
    setProviderTest(null);
    queueSync();
  }

  // ── Sync / save ──

  function queueSync(delay = 220) {
    setProviderTest(null);
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = undefined;
      void syncLlmSettings();
    }, delay);
  }

  onCleanup(() => {
    if (syncTimer) clearTimeout(syncTimer);
    if (noticeTimer) clearTimeout(noticeTimer);
  });

  async function syncLlmSettings() {
    const pid = selectedProvider();
    const mid = selectedModel();
    const key = apiKey();
    if (!pid || !mid) return;
    const nextKey = selectionKey(pid, mid, key);
    if (nextKey === savedKey) return;

    const serial = ++syncSerial;
    setProviderTest(null);
    setBusy(true);
    showNotice(
      t("llm.notice.saving", { provider: pid, model: mid }),
      "warn",
      0,
    );

    try {
      const saved = await updateConfig((config) => {
        config.model = `${pid}/${mid}`;
        config.provider = config.provider || {};
        const entry = config.provider[pid] || {};
        entry.options = entry.options || {};
        if (key.trim()) entry.options.apiKey = key.trim();
        else delete entry.options.apiKey;
        if (Object.keys(entry.options).length === 0) delete entry.options;
        if (Object.keys(entry).length > 0) config.provider[pid] = entry;
        else delete config.provider[pid];
        if (Object.keys(config.provider).length === 0) delete config.provider;
      });
      if (serial !== syncSerial) return;

      savedKey = nextKey;

      if (recordGuard(saved)) setAppConfig(saved);

      const result = await apiJson(`provider/${pid}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelID: mid }),
      });
      if (serial !== syncSerial) return;

      const testResult: ProviderTest = {
        providerID: pid,
        modelID: mid,
        ok: !!result?.ok,
        message:
          result?.message ||
          (result?.ok ? t("llm.status.connected") : t("llm.notice.test_failed")),
      };
      setProviderTest(testResult);
      showNotice(
        testResult.message,
        testResult.ok ? "active" : "error",
      );
    } catch (e) {
      if (serial !== syncSerial) return;
      const msg = e instanceof Error ? e.message : String(e);
      setProviderTest({
        providerID: pid,
        modelID: mid,
        ok: false,
        message: msg || t("llm.notice.update_failed"),
      });
      showNotice(msg || t("llm.notice.update_failed"), "error", 3200);
    } finally {
      if (serial === syncSerial) setBusy(false);
    }
  }

  // ── Auth connect ──

  async function handleAuthConnect() {
    const pid = selectedProvider();
    const methods = authMethods();
    if (!pid || methods.length === 0) return;

    let chosenMethod: AuthMethodItem | undefined;
    if (methods.length === 1) {
      chosenMethod = methods[0];
    } else {
      const idx = parseInt(
        prompt(
          t("llm.auth_choose_method") +
            "\n" +
            methods
              .map(
                (m, i) =>
                  `${i}: ${m.label} (${m.type === "oauth" ? t("llm.auth_type_oauth") : t("llm.auth_type_api")})`,
              )
              .join("\n"),
        ) || "-1",
        10,
      );
      chosenMethod = methods[idx];
    }
    if (!chosenMethod) return;

    setBusy(true);
    try {
      if (chosenMethod.type === "oauth") {
        const authorization = await apiJson(`provider/${pid}/oauth/authorize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: chosenMethod.index }),
        });
        if (authorization?.url) {
          window.open(authorization.url, "_blank");
        }
        showNotice(authorization?.instructions || t("llm.auth_connect_title"), "warn", 0);
        if (authorization?.method === "code") {
          const code = prompt(authorization.instructions || t("llm.auth_connect_title"));
          if (!code) {
            showNotice("", "");
            return;
          }
          await apiJson(`provider/${pid}/oauth/callback`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ method: chosenMethod.index, code }),
          });
        } else {
          await apiJson(`provider/${pid}/oauth/callback`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ method: chosenMethod.index }),
          });
        }
      } else {
        // API key type: collect any required prompts then execute
        const promptsList = await apiJson(`provider/${pid}/auth/prompts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: chosenMethod.index, inputs: {} }),
        });
        const inputs: Record<string, string> = {};
        if (Array.isArray(promptsList)) {
          for (const p of promptsList) {
            const value = prompt(typeof p.message === "string" ? p.message : String(p.key)) || "";
            inputs[p.key] = value;
          }
        }
        await apiJson(`provider/${pid}/auth/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: chosenMethod.index, inputs }),
        });
      }

      const [catalogData, authData, configData] = await Promise.all([
        apiJson("provider").catch(() => ({})),
        apiJson("provider/auth").catch(() => ({})),
        apiJson("config").catch(() => ({})),
      ]);
      batch(() => {
        setCatalog(recordGuard(catalogData) ? catalogData : {});
        setProviderAuth(recordGuard(authData) ? authData : {});
        setAppConfig(recordGuard(configData) ? configData : null);
      });
      setProviderTest(null);
      showNotice(t("llm.status.connected"), "active");
    } catch (e) {
      showNotice(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  // ── Notice ──

  function showNotice(msg: string, tone = "", duration = 2600) {
    if (noticeTimer) clearTimeout(noticeTimer);
    setNotice(msg);
    setNoticeTone(tone);
    setNoticeOpen(!!msg);
    if (msg && duration > 0) {
      noticeTimer = setTimeout(() => setNoticeOpen(false), duration);
    }
  }

  // ── Copy API key ──

  async function handleCopyKey() {
    const key = apiKey();
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      showNotice(t("llm.api_key_copy_done"), "active");
    } catch {
      // ignore
    }
  }

  // ── Provider status label per-option ──

  function providerOptionLabel(p: ProviderEntry): string {
    const connected = catalog().connected || [];
    const config = appConfig();
    const configKey = config?.provider?.[p.id]?.options?.apiKey;
    const key = configKey || p.key;
    const pAuthMethods = parseProviderAuthMethods(providerAuth(), p.id);
    if (connected.includes(p.id)) return t("llm.status.connected");
    if (key) return t("llm.status.configured");
    if (pAuthMethods.length > 0) return t("llm.status.auth_required");
    if ((p.env?.length || 0) > 0) return t("llm.status.needs_api_key");
    return t("llm.status.available");
  }

  return (
    <div class="llm-panel">
      <Show when={loading()}>
        <div class="loading-hint">{t("common.loading")}</div>
      </Show>

      {/* ── Summary + Status banner ── */}
      <div class="llm-summary-row">
        <span class="llm-summary" title={summaryText()}>
          {summaryText()}
        </span>
        <span
          class="llm-status"
          data-status={statusInfo().tone}
          title={statusInfo().detail || statusInfo().label}
        >
          {statusInfo().label}
        </span>
      </div>

      {/* ── Notice banner ── */}
      <div
        class="llm-notice"
        data-status={noticeTone()}
        data-open={noticeOpen() ? "true" : "false"}
        role="status"
      >
        {notice()}
      </div>

      {/* ── Provider & Model ── */}
      <div class="config-panel-group">
        <h4 class="config-panel-group-title">{t("llm.provider_label")}</h4>
        <div class="config-panel-card">
          <label class="field">
            <span class="field-label">{t("llm.provider_label")}</span>
            <select
              class="field-input"
              disabled={busy()}
              value={selectedProvider()}
              onChange={(e) => handleProviderChange(e.currentTarget.value)}
            >
              <For each={providers()}>
                {(p) => (
                  <option value={p.id}>
                    {p.name || p.id} · {providerOptionLabel(p)}
                  </option>
                )}
              </For>
            </select>
          </label>

          <label class="field">
            <span class="field-label">{t("llm.model_label")}</span>
            <div class="config-field-row" style="align-items: end">
              <select
                class="field-input"
                disabled={busy()}
                value={selectedModel()}
                onChange={(e) => handleModelChange(e.currentTarget.value)}
                style="flex: 1; min-width: 0"
              >
                <For each={availableModels()}>
                  {(m) => <option value={m}>{m}</option>}
                </For>
              </select>
              <div
                class="config-status-box"
                data-status={statusInfo().tone}
                title={statusInfo().detail || statusInfo().label}
                style="white-space: nowrap; min-width: fit-content"
              >
                {statusInfo().label}
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* ── API Key ── */}
      <div class="config-panel-group">
        <h4 class="config-panel-group-title">{t("llm.api_key_label")}</h4>
        <div class="config-panel-card">
          <div class="field">
            <div class="field-input-group">
              <input
                class="field-input"
                type={apiKeyVisible() ? "text" : "password"}
                disabled={busy()}
                value={apiKey()}
                placeholder={t("llm.api_key_placeholder")}
                onInput={(e) => handleApiKeyChange(e.currentTarget.value)}
              />
              <div class="field-input-actions">
                <button
                  type="button"
                  class="field-input-icon"
                  disabled={busy()}
                  title={t(apiKeyVisible() ? "llm.api_key_hide" : "llm.api_key_show")}
                  aria-label={t(
                    apiKeyVisible() ? "llm.api_key_hide" : "llm.api_key_show",
                  )}
                  onClick={() => setApiKeyVisible((v) => !v)}
                  innerHTML={apiKeyVisible() ? hideEyeSvg : showEyeSvg}
                />
                <button
                  type="button"
                  class="field-input-icon"
                  disabled={busy() || !hasApiKey()}
                  title={t("llm.api_key_copy")}
                  aria-label={t("llm.api_key_copy")}
                  onClick={handleCopyKey}
                  innerHTML={copySvg}
                />
              </div>
            </div>
            <Show when={hasApiKey()}>
              <span class="llm-api-key-summary">
                {t("llm.status.configured")}
              </span>
            </Show>
          </div>
        </div>
      </div>

      {/* ── Auth Connect ── */}
      <Show when={authMethods().length > 0}>
        <div class="llm-auth-row">
          <button
            type="button"
            class="btn btn-primary"
            disabled={busy()}
            title={t("llm.auth_connect_title")}
            aria-label={t("llm.auth_connect_title")}
            onClick={handleAuthConnect}
          >
            {t("llm.auth_connect")}
          </button>
        </div>
      </Show>
    </div>
  );
}
