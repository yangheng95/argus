import { appStore, dismissProviderAuth, setAppStore, setProviderTest } from "../store/app";
import { t } from "../utils/i18n";
import {
  authenticateSelectedProvider,
  authorizeProvider,
  defaultModelForProvider,
  llmSelectionKey,
  modelsForProvider,
  providerAuthMethods,
  providerAuthPrompt,
  providerLabel,
  providerPreferredOauthMethod,
  providerState,
  sortedProviders,
  testProviderConnection,
} from "./llm";
import { loadConfigInfo } from "./init";
import { updateConfig } from "./config";
import { nativeConfirm, nativeOpen, nativePrompt, nativeSelect } from "../utils/native";
import { nativeMessage } from "./app-dialog";
import { apiJson } from "./api";

const HIDE_EYE_SVG =
  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.1 2.1l11.8 11.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M6 6.3A2.8 2.8 0 019.7 10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M1.7 8c1.6-2.8 3.8-4.2 6.3-4.2 2.4 0 4.6 1.4 6.3 4.2-.5.9-1 1.6-1.6 2.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SHOW_EYE_SVG =
  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.7 8c1.6-2.8 3.8-4.2 6.3-4.2s4.7 1.4 6.3 4.2c-1.6 2.8-3.8 4.2-6.3 4.2S3.3 10.8 1.7 8z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.2"/></svg>';
const COPY_SVG =
  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.2" y="4.2" width="7.1" height="8.1" rx="1.4" stroke="currentColor" stroke-width="1.2"/><path d="M4.2 10.6H3.7A1.5 1.5 0 012.2 9.1V3.7a1.5 1.5 0 011.5-1.5h5.4a1.5 1.5 0 011.5 1.5v.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

type InlineLlmElements = {
  form: HTMLFormElement | null;
  provider: HTMLSelectElement | null;
  model: HTMLSelectElement | null;
  apiKey: HTMLInputElement | null;
  apiKeySummary: HTMLElement | null;
  apiKeyToggle: HTMLButtonElement | null;
  apiKeyCopy: HTMLButtonElement | null;
  authAction: HTMLButtonElement | null;
  status: HTMLElement | null;
  summary: HTMLElement | null;
  notice: HTMLElement | null;
  available: HTMLElement | null;
};

const elements: InlineLlmElements = {
  form: null,
  provider: null,
  model: null,
  apiKey: null,
  apiKeySummary: null,
  apiKeyToggle: null,
  apiKeyCopy: null,
  authAction: null,
  status: null,
  summary: null,
  notice: null,
  available: null,
};

let installed = false;
let apiKeyVisible = false;
let llmFormDirty = false;
let llmSavedValue = "";
let llmSaveTimer: ReturnType<typeof setTimeout> | undefined;
let llmSyncSerial = 0;
let llmNoticeTimer: ReturnType<typeof setTimeout> | undefined;

async function waitForDialogTurn(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function authCallbacks() {
  return {
    nativePrompt: async (...args: Parameters<typeof nativePrompt>) => {
      await waitForDialogTurn();
      return nativePrompt(...args);
    },
    nativeSelect: async (...args: Parameters<typeof nativeSelect>) => {
      await waitForDialogTurn();
      return nativeSelect(...args);
    },
    nativeConfirm: async (...args: Parameters<typeof nativeConfirm>) => {
      await waitForDialogTurn();
      return nativeConfirm(...args);
    },
    nativeOpen,
    showLlmNotice,
  };
}

async function hasInitialOauthPrompts(providerID: string, methodIndex: number): Promise<boolean> {
  const prompts = await apiJson(`provider/${providerID}/auth/prompts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: methodIndex, inputs: {} }),
    signal: AbortSignal.timeout(300_000),
  });
  const parsed = Array.isArray(prompts)
    ? prompts.map(providerAuthPrompt).filter(Boolean)
    : [];
  return parsed.length > 0;
}

function bindElements(): void {
  elements.form = document.getElementById("llmForm") as HTMLFormElement | null;
  elements.provider = document.getElementById("llmProvider") as HTMLSelectElement | null;
  elements.model = document.getElementById("llmModel") as HTMLSelectElement | null;
  elements.apiKey = document.getElementById("llmApiKey") as HTMLInputElement | null;
  elements.apiKeySummary = document.getElementById("llmApiKeySummary");
  elements.apiKeyToggle = document.getElementById("btnLlmApiKeyToggle") as HTMLButtonElement | null;
  elements.apiKeyCopy = document.getElementById("btnLlmApiKeyCopy") as HTMLButtonElement | null;
  elements.authAction = document.getElementById("btnLlmAuthAction") as HTMLButtonElement | null;
  elements.status = document.getElementById("llmStatus");
  elements.summary = document.getElementById("llmSummary");
  elements.notice = document.getElementById("llmNotice");
  elements.available = document.getElementById("cfgAvailableProviders");
}

function currentSelection(): { providerID: string; modelID: string; apiKey: string } {
  return {
    providerID: elements.provider?.value?.trim() || "",
    modelID: elements.model?.value?.trim() || "",
    apiKey: elements.apiKey?.value ?? "",
  };
}

function clearProviderAuthDismissed(providerID: string): void {
  const next = { ...(appStore.providerAuthDismissed || {}) };
  delete next[providerID];
  setAppStore("providerAuthDismissed", next);
}

function renderLlmSummary(): void {
  if (!elements.summary) return;
  const { providerID, modelID } = currentSelection();
  if (!providerID || !modelID) {
    const text = t("llm.summary_empty");
    elements.summary.textContent = text;
    elements.summary.title = text;
    return;
  }
  const text = t("llm.summary_value", {
    provider: providerLabel(providerID),
    model: modelID,
  });
  elements.summary.textContent = text;
  elements.summary.title = text;
}

function renderAvailableProviders(): void {
  if (!elements.available) return;
  const total = Array.isArray(appStore.providerCatalog?.all)
    ? appStore.providerCatalog.all.length
    : 0;
  const connected = Array.isArray(appStore.providerCatalog?.connected)
    ? appStore.providerCatalog.connected.length
    : 0;
  const text = total === 0 ? t("llm.available_count_zero") : `${connected}/${total}`;
  elements.available.textContent = text;
  elements.available.title = text;
  elements.available.dataset.status = connected > 0 ? "active" : total > 0 ? "ready" : "";
}

function renderLlmApiKeyTools(): void {
  if (elements.apiKey) {
    elements.apiKey.type = apiKeyVisible ? "text" : "password";
  }
  if (elements.apiKeyToggle) {
    elements.apiKeyToggle.innerHTML = apiKeyVisible ? HIDE_EYE_SVG : SHOW_EYE_SVG;
    const title = t(apiKeyVisible ? "llm.api_key_hide" : "llm.api_key_show");
    elements.apiKeyToggle.title = title;
    elements.apiKeyToggle.setAttribute("aria-label", title);
  }
  if (elements.apiKeyCopy) {
    elements.apiKeyCopy.innerHTML = COPY_SVG;
    const title = t("llm.api_key_copy");
    elements.apiKeyCopy.title = title;
    elements.apiKeyCopy.setAttribute("aria-label", title);
    elements.apiKeyCopy.disabled =
      !!elements.apiKey?.disabled || !(elements.apiKey?.value?.trim());
  }
  if (elements.apiKeySummary) {
    const value = elements.apiKey?.value?.trim() || "";
    elements.apiKeySummary.textContent = value ? t("llm.status.configured") : "";
    elements.apiKeySummary.dataset.tone = value ? "good" : "";
  }
}

function renderLlmAuthAction(providerID: string): void {
  if (!elements.authAction) return;
  const visible = providerAuthMethods(providerID).length > 0;
  elements.authAction.classList.toggle("hidden", !visible);
  elements.authAction.disabled = !visible || !!elements.provider?.disabled;
  if (!visible) return;
  elements.authAction.textContent = t("llm.auth_connect");
  elements.authAction.title = t("llm.auth_connect_title");
  elements.authAction.setAttribute("aria-label", t("llm.auth_connect_title"));
}

export function renderInlineProviderStatus(providerID?: string, configOverride?: any): void {
  if (!elements.status) return;
  const resolvedProviderID = providerID || elements.provider?.value?.trim() || "";
  const modelID = elements.model?.value?.trim() || "";
  if (!resolvedProviderID) {
    elements.status.textContent = t("llm.status.unknown");
    elements.status.dataset.status = "";
    elements.status.title = "";
    renderLlmAuthAction("");
    renderLlmSummary();
    return;
  }
  const info = providerState(resolvedProviderID, configOverride ?? appStore.config, modelID);
  elements.status.textContent = info.label;
  elements.status.dataset.status = info.tone;
  elements.status.title = info.detail || info.label;
  renderLlmAuthAction(resolvedProviderID);
  renderLlmSummary();
}

function setLlmBusy(value: boolean): void {
  const busy = !!value;
  if (elements.provider) elements.provider.disabled = busy;
  if (elements.model) elements.model.disabled = busy;
  if (elements.apiKey) elements.apiKey.disabled = busy;
  if (elements.apiKeyToggle) elements.apiKeyToggle.disabled = busy;
  if (elements.apiKeyCopy) elements.apiKeyCopy.disabled = busy || !(elements.apiKey?.value?.trim());
  renderLlmAuthAction(elements.provider?.value || "");
  renderLlmApiKeyTools();
}

function showLlmNotice(message: string, tone = "", duration = 2600): void {
  if (!elements.notice) return;
  if (llmNoticeTimer) clearTimeout(llmNoticeTimer);
  elements.notice.textContent = message || "";
  elements.notice.dataset.status = tone;
  elements.notice.dataset.open = message ? "true" : "false";
  if (!message || duration <= 0) return;
  llmNoticeTimer = setTimeout(() => {
    if (!elements.notice) return;
    elements.notice.dataset.open = "false";
  }, duration);
}

function populateModelSelect(syncSaved = false, providerChanged = false): void {
  if (!elements.provider || !elements.model) return;
  const providerID = elements.provider.value.trim();
  const models = modelsForProvider(providerID);
  const previousModel = elements.model.value;
  elements.model.innerHTML = models
    .map((item) => `<option value="${item}">${item}</option>`)
    .join("");
  if (llmFormDirty && !providerChanged) {
    elements.model.value = models.includes(previousModel) ? previousModel : models[0] || "";
  } else {
    const current = defaultModelForProvider(providerID, appStore.config);
    elements.model.value = models.includes(current) ? current : models[0] || "";
  }
  if (!llmFormDirty || providerChanged) {
    if (elements.apiKey) {
      elements.apiKey.value =
        appStore.config?.provider?.[providerID]?.options?.apiKey || "";
    }
  }
  if (syncSaved) {
    const current = currentSelection();
    llmSavedValue = llmSelectionKey(current.providerID, current.modelID, current.apiKey);
  }
  renderInlineProviderStatus(providerID, appStore.config);
  renderLlmApiKeyTools();
}

function populateProviderSelect(syncSaved = false): void {
  if (!elements.provider) return;
  const providers = sortedProviders(appStore.config);
  const previousProvider = elements.provider.value;
  const currentModel = typeof appStore.config?.model === "string" ? appStore.config.model : "";
  const currentProvider =
    currentModel && currentModel.includes("/") ? currentModel.split("/")[0] : "";
  elements.provider.innerHTML = providers
    .map((item) => `<option value="${item.id}">${providerLabel(item.id)} · ${item.stateLabel}</option>`)
    .join("");
  if (llmFormDirty) {
    elements.provider.value = providers.some((item) => item.id === previousProvider)
      ? previousProvider
      : providers[0]?.id || "";
  } else {
    const fallback = currentProvider || providers[0]?.id || "";
    elements.provider.value = providers.some((item) => item.id === fallback)
      ? fallback
      : providers[0]?.id || "";
  }
  populateModelSelect(syncSaved, false);
}

async function syncLlmSettings(): Promise<void> {
  const current = currentSelection();
  const nextValue = llmSelectionKey(current.providerID, current.modelID, current.apiKey);
  if (nextValue === llmSavedValue) return;
  if (!current.providerID || !current.modelID) return;

  const serial = ++llmSyncSerial;
  setProviderTest(null);
  setLlmBusy(true);
  if (elements.status) {
    elements.status.textContent = t("llm.status.saving");
    elements.status.dataset.status = "warn";
    elements.status.title = `${current.providerID}/${current.modelID}`;
  }
  showLlmNotice(
    t("llm.notice.saving", {
      provider: current.providerID,
      model: current.modelID,
    }),
    "warn",
    0,
  );

  try {
    const saved = await updateConfig((config) => {
      config.model = `${current.providerID}/${current.modelID}`;
      config.provider = config.provider || {};
      const entry = config.provider[current.providerID] || {};
      entry.options = entry.options || {};
      if (current.apiKey.trim()) entry.options.apiKey = current.apiKey.trim();
      if (!current.apiKey.trim()) delete entry.options.apiKey;
      if (Object.keys(entry.options).length === 0) delete entry.options;
      if (Object.keys(entry).length > 0) config.provider[current.providerID] = entry;
      if (Object.keys(entry).length === 0) delete config.provider[current.providerID];
      if (Object.keys(config.provider).length === 0) delete config.provider;
    });
    if (serial !== llmSyncSerial) return;

    setAppStore("config", saved ?? null);
    llmSavedValue = nextValue;

    const connected = Array.isArray(appStore.providerCatalog?.connected)
      && appStore.providerCatalog.connected.includes(current.providerID);
    const needsAuth = !connected && providerAuthMethods(current.providerID).length > 0;
    if (needsAuth) {
      const oauthMethod = providerPreferredOauthMethod(current.providerID);
      if (!oauthMethod) {
        renderInlineProviderStatus(current.providerID, appStore.config);
        showLlmNotice(t("llm.status.auth_required"), "warn", 2600);
        return;
      }
      if (await hasInitialOauthPrompts(current.providerID, oauthMethod.index)) {
        renderInlineProviderStatus(current.providerID, appStore.config);
        showLlmNotice(t("llm.status.auth_required"), "warn", 2600);
        return;
      }
      const ready = await authorizeProvider(current.providerID, undefined, authCallbacks());
      if (serial !== llmSyncSerial) return;
      await loadConfigInfo();
      if (serial !== llmSyncSerial) return;
      if (!ready) {
        dismissProviderAuth(current.providerID);
        renderInlineProviderStatus(current.providerID, appStore.config);
        showLlmNotice(t("llm.status.auth_required"), "warn", 2600);
        return;
      }
      clearProviderAuthDismissed(current.providerID);
    }

    const result = await testProviderConnection(current.providerID, current.modelID);
    if (serial !== llmSyncSerial) return;

    setProviderTest({
      providerID: current.providerID,
      modelID: current.modelID,
      ok: !!result?.ok,
      message:
        result?.message ||
        (result?.ok ? t("llm.status.connected") : t("llm.notice.test_failed")),
    });
    llmFormDirty = false;
    renderInlineProviderStatus(current.providerID, appStore.config);
    showLlmNotice(
      appStore.providerTest?.message || "",
      appStore.providerTest?.ok ? "active" : "error",
    );
  } catch (error) {
    if (serial !== llmSyncSerial) return;
    const message = error instanceof Error ? error.message : String(error || "");
    setProviderTest({
      providerID: current.providerID,
      modelID: current.modelID,
      ok: false,
      message: message || t("llm.notice.update_failed"),
    });
    renderInlineProviderStatus(current.providerID, appStore.config);
    showLlmNotice(appStore.providerTest?.message || "", "error", 3200);
  } finally {
    if (serial === llmSyncSerial) setLlmBusy(false);
  }
}

function queueLlmSync(delay = 220): void {
  setProviderTest(null);
  renderInlineProviderStatus(elements.provider?.value || "", appStore.config);
  if (llmSaveTimer) clearTimeout(llmSaveTimer);
  llmSaveTimer = setTimeout(() => {
    llmSaveTimer = undefined;
    void syncLlmSettings();
  }, delay);
}

async function scheduleProviderSelectionSync(): Promise<void> {
  const providerID = elements.provider?.value?.trim() || "";
  setProviderTest(null);
  renderInlineProviderStatus(providerID, appStore.config);
  if (!providerID) return;

  const connected = Array.isArray(appStore.providerCatalog?.connected)
    && appStore.providerCatalog.connected.includes(providerID);
  const methods = providerAuthMethods(providerID);
  if (!connected && methods.length > 0) {
    const oauthMethod = providerPreferredOauthMethod(providerID);
    if (!oauthMethod) return;
    const currentProviderID = providerID;
    if (await hasInitialOauthPrompts(providerID, oauthMethod.index)) {
      if ((elements.provider?.value?.trim() || "") !== currentProviderID) return;
      return;
    }
    if ((elements.provider?.value?.trim() || "") !== currentProviderID) return;
  }

  queueLlmSync(180);
}

async function copyApiKey(): Promise<void> {
  const value = elements.apiKey?.value?.trim() || "";
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showLlmNotice(t("llm.api_key_copy_done"), "active", 1800);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    showLlmNotice(message || t("common.error"), "error", 3200);
  }
}

export function refreshInlineLlmConfig(syncSaved = !llmFormDirty): void {
  bindElements();
  if (!elements.provider || !elements.model || !elements.apiKey) return;
  populateProviderSelect(syncSaved);
  renderAvailableProviders();
  renderInlineProviderStatus(elements.provider.value, appStore.config);
}

export function installInlineLlmConfig(): void {
  if (installed) return;
  bindElements();
  if (!elements.provider || !elements.model || !elements.apiKey) return;
  installed = true;

  elements.form?.addEventListener("submit", (event) => {
    event.preventDefault();
  });

  elements.provider.addEventListener("change", () => {
    llmFormDirty = true;
    clearProviderAuthDismissed(elements.provider?.value || "");
    populateModelSelect(false, true);
    renderLlmSummary();
    void scheduleProviderSelectionSync();
  });

  elements.model.addEventListener("change", () => {
    llmFormDirty = true;
    renderLlmSummary();
    queueLlmSync(180);
  });

  elements.apiKey.addEventListener("input", () => {
    llmFormDirty = true;
    renderLlmApiKeyTools();
    queueLlmSync(220);
  });

  elements.apiKeyToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    apiKeyVisible = !apiKeyVisible;
    renderLlmApiKeyTools();
  });

  elements.apiKeyCopy?.addEventListener("click", (event) => {
    event.preventDefault();
    void copyApiKey();
  });

  elements.authAction?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (llmSaveTimer) {
      clearTimeout(llmSaveTimer);
      llmSaveTimer = undefined;
    }
    try {
      const providerID = elements.provider?.value?.trim() || "";
      const authenticated = await authenticateSelectedProvider(providerID, authCallbacks());
      if (authenticated !== true) {
        if (providerID) dismissProviderAuth(providerID);
        return;
      }
      if (providerID) clearProviderAuthDismissed(providerID);
      await loadConfigInfo();
      llmSavedValue = "";
      queueLlmSync(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "");
      showLlmNotice(message, "error", 3200);
      await nativeMessage(message, {
        title: t("llm.title"),
        kind: "error",
      });
    }
  });

  refreshInlineLlmConfig(true);
}
