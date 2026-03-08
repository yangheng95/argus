// ── OpenCorvus Overlay — Application Logic ──

const DEFAULT_SERVER = (() => {
  // When served from the opencorvus server itself (/ui/), use the same origin
  if (typeof window !== "undefined" && window.location.protocol.startsWith("http") && window.location.pathname.startsWith("/ui")) {
    return window.location.origin;
  }
  return "http://127.0.0.1:7878";
})();
const POLL_INTERVAL = 4000;
const SESSION_POLL = 6000;
const DEFAULT_OVERLAY_SETTINGS = {
  serverUrl: DEFAULT_SERVER,
  password: "",
  username: "opencorvus",
  executor: "opencode",
  alwaysOnTop: false,
  theme: "dark",
};
const OVERLAY_VERSION = "0.0.1";

// ── State ──

const state = {
  serverUrl: DEFAULT_OVERLAY_SETTINGS.serverUrl,
  password: DEFAULT_OVERLAY_SETTINGS.password,
  username: DEFAULT_OVERLAY_SETTINGS.username,
  executor: DEFAULT_OVERLAY_SETTINGS.executor,
  alwaysOnTop: DEFAULT_OVERLAY_SETTINGS.alwaysOnTop,
  theme: DEFAULT_OVERLAY_SETTINGS.theme,
  connected: false,
  tasks: [],
  selectedTaskID: "",
  path: null,
  vcs: null,
  config: null,
  executors: [],
  providerCatalog: null,
  providerAuth: null,
  providerTest: null,
  channels: [],
  skills: [],
  skillMarket: [],
  mcp: {},
  board: null,
  chatSessionID: "",
  sessions: [],
  managedSession: null,
  managedChildren: [],
  session: [],
  changes: [],
  sse: null,
  pollTimer: null,
  sessionTimer: null,
  elapsedTimer: null,
  changeKey: "",
  _renderedGroupKey: "",
};

// ── DOM Refs ──

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  connBadge: $("#connBadge"),
  brandVersion: $("#brandVersion"),
  btnTheme: $("#btnTheme"),
  taskSelect: $("#taskSelect"),
  taskDir: $("#taskDir"),
  taskGit: $("#taskGit"),
  engineBar: $("#engineBar"),
  engineStatus: $("#engineStatus"),
  taskSessionChip: $("#taskSessionChip"),
  btnManageTaskSession: $("#btnManageTaskSession"),
  btnDeleteTaskSession: $("#btnDeleteTaskSession"),
  extensionsBadge: $("#extensionsBadge"),
  btnOpenConfig: $("#btnOpenConfig"),
  cfgProviderStatus: $("#cfgProviderStatus"),
  cfgAvailableProviders: $("#cfgAvailableProviders"),
  channelList: $("#channelList"),
  skillList: $("#skillList"),
  btnSkillMarket: $("#btnSkillMarket"),
  btnOpenSkillRoot: $("#btnOpenSkillRoot"),
  btnReloadSkills: $("#btnReloadSkills"),
  mcpList: $("#mcpList"),
  btnAddSkill: $("#btnAddSkill"),
  btnAddMcp: $("#btnAddMcp"),
  statusDot: $(".status-dot"),
  statusLabel: $("#statusLabel"),
  elapsed: $("#elapsed"),
  planBadge: $("#planBadge"),
  planBody: $("#planBody"),
  goalsBadge: $("#goalsBadge"),
  goalsBody: $("#goalsBody"),
  criteriaBadge: $("#criteriaBadge"),
  criteriaList: $("#criteriaList"),
  evalBody: $("#evalBody"),
  changesBadge: $("#changesBadge"),
  changesBody: $("#changesBody"),
  chatScroll: $("#chatScroll"),
  chatEmpty: $("#chatEmpty"),
  chatCount: $("#chatCount"),
  chatForm: $("#chatForm"),
  chatTextarea: $("#chatTextarea"),
  chatSend: $("#chatSend"),
  sessionsDialog: $("#sessionsDialog"),
  sessionListPanel: $("#sessionListPanel"),
  sessionChildrenPanel: $("#sessionChildrenPanel"),
  sessionMetaCard: $("#sessionMetaCard"),
  btnRefreshSessions: $("#btnRefreshSessions"),
  btnCreateSession: $("#btnCreateSession"),
  btnUseTaskSession: $("#btnUseTaskSession"),
  btnOpenSession: $("#btnOpenSession"),
  btnForkSession: $("#btnForkSession"),
  btnCopySession: $("#btnCopySession"),
  btnExportSession: $("#btnExportSession"),
  btnDeleteSession: $("#btnDeleteSession"),
  btnCloseSessions: $("#btnCloseSessions"),
  skillDialog: $("#skillDialog"),
  skillForm: $("#skillForm"),
  skillType: $("#skillType"),
  skillValue: $("#skillValue"),
  skillPolicy: $("#skillPolicy"),
  btnPickSkillPath: $("#btnPickSkillPath"),
  btnCancelSkill: $("#btnCancelSkill"),
  skillMarketDialog: $("#skillMarketDialog"),
  skillMarketList: $("#skillMarketList"),
  btnCloseSkillMarket: $("#btnCloseSkillMarket"),
  mcpDialog: $("#mcpDialog"),
  mcpForm: $("#mcpForm"),
  mcpName: $("#mcpName"),
  mcpType: $("#mcpType"),
  mcpUrl: $("#mcpUrl"),
  mcpCommand: $("#mcpCommand"),
  mcpArgs: $("#mcpArgs"),
  mcpRemoteField: $("#mcpRemoteField"),
  mcpCommandField: $("#mcpCommandField"),
  mcpArgsField: $("#mcpArgsField"),
  btnCancelMcp: $("#btnCancelMcp"),
  goalDialog: $("#goalDialog"),
  goalForm: $("#goalForm"),
  goalDialogTitle: $("#goalDialogTitle"),
  goalId: $("#goalId"),
  goalDescription: $("#goalDescription"),
  goalCriteria: $("#goalCriteria"),
  btnCancelGoal: $("#btnCancelGoal"),
  diffDialog: $("#diffDialog"),
  diffDialogTitle: $("#diffDialogTitle"),
  diffDialogMeta: $("#diffDialogMeta"),
  diffDialogBody: $("#diffDialogBody"),
  btnCloseDiff: $("#btnCloseDiff"),
  appDialog: $("#appDialog"),
  appDialogTitle: $("#appDialogTitle"),
  appDialogBody: $("#appDialogBody"),
  appDialogInputField: $("#appDialogInputField"),
  appDialogInputLabel: $("#appDialogInputLabel"),
  appDialogInput: $("#appDialogInput"),
  btnAppDialogCancel: $("#btnAppDialogCancel"),
  btnAppDialogOk: $("#btnAppDialogOk"),
  llmDialog: $("#llmDialog"),
  llmForm: $("#llmForm"),
  llmProvider: $("#llmProvider"),
  llmModel: $("#llmModel"),
  llmApiKey: $("#llmApiKey"),
  llmStatus: $("#llmStatus"),
  llmHint: $("#llmHint"),
  btnTestProvider: $("#btnTestProvider"),
  btnCancelLlm: $("#btnCancelLlm"),
  channelDialog: $("#channelDialog"),
  channelForm: $("#channelForm"),
  channelDialogTitle: $("#channelDialogTitle"),
  channelId: $("#channelId"),
  channelFields: $("#channelFields"),
  btnCancelChannel: $("#btnCancelChannel"),
  settingsDialog: $("#settingsDialog"),
  settingsForm: $("#settingsForm"),
  serverUrl: $("#serverUrl"),
  serverPassword: $("#serverPassword"),
  serverUsername: $("#serverUsername"),
  themeMode: $("#themeMode"),
  settingsConfigRoot: $("#settingsConfigRoot"),
  settingsConfigFile: $("#settingsConfigFile"),
  settingsOverlayFile: $("#settingsOverlayFile"),
};

function sanitizeTheme(value) {
  if (value === "light" || value === "system") return value;
  return "dark";
}

const systemThemeMedia =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: light)")
    : null;

function resolvedTheme() {
  const theme = sanitizeTheme(state.theme);
  if (theme === "system") {
    return systemThemeMedia?.matches ? "light" : "dark";
  }
  return theme;
}

async function tauriInvoke(command, args) {
  const globalInvoke = window.__TAURI__?.core?.invoke;
  if (typeof globalInvoke === "function") {
    try {
      return await globalInvoke(command, args);
    } catch {}
  }
  try {
    const mod = await import("@tauri-apps/api/core");
    if (typeof mod.invoke === "function") {
      return await mod.invoke(command, args);
    }
  } catch {}
}

function browserOverlaySettings() {
  return {
    serverUrl: localStorage.getItem("oc_server_url") || DEFAULT_OVERLAY_SETTINGS.serverUrl,
    password: localStorage.getItem("oc_password") || DEFAULT_OVERLAY_SETTINGS.password,
    username: localStorage.getItem("oc_username") || DEFAULT_OVERLAY_SETTINGS.username,
    executor: localStorage.getItem("oc_executor") || DEFAULT_OVERLAY_SETTINGS.executor,
    alwaysOnTop: localStorage.getItem("oc_always_on_top") === "true",
    theme: sanitizeTheme(localStorage.getItem("oc_theme")),
  };
}

function applyOverlaySettings(settings) {
  state.serverUrl =
    typeof settings?.serverUrl === "string" && settings.serverUrl.trim()
      ? settings.serverUrl.trim()
      : DEFAULT_OVERLAY_SETTINGS.serverUrl;
  state.password = typeof settings?.password === "string" ? settings.password : DEFAULT_OVERLAY_SETTINGS.password;
  state.username =
    typeof settings?.username === "string" && settings.username.trim()
      ? settings.username.trim()
      : DEFAULT_OVERLAY_SETTINGS.username;
  state.executor =
    typeof settings?.executor === "string" && settings.executor.trim()
      ? settings.executor.trim()
      : DEFAULT_OVERLAY_SETTINGS.executor;
  state.alwaysOnTop = settings?.alwaysOnTop === true;
  state.theme = sanitizeTheme(settings?.theme);
}

async function loadOverlaySettings() {
  const saved = await tauriInvoke("overlay_settings_load").catch(() => undefined);
  if (saved && typeof saved === "object") {
    applyOverlaySettings(saved);
    return;
  }
  applyOverlaySettings(browserOverlaySettings());
}

async function persistOverlaySettings() {
  const settings = {
    serverUrl: state.serverUrl,
    password: state.password,
    username: state.username,
    executor: state.executor,
    alwaysOnTop: state.alwaysOnTop,
    theme: state.theme,
  };
  const saved = await tauriInvoke("overlay_settings_save", { settings }).catch(() => undefined);
  if (saved) return;
  localStorage.setItem("oc_server_url", settings.serverUrl);
  localStorage.setItem("oc_password", settings.password);
  localStorage.setItem("oc_username", settings.username);
  localStorage.setItem("oc_executor", settings.executor);
  localStorage.setItem("oc_always_on_top", String(settings.alwaysOnTop));
  localStorage.setItem("oc_theme", settings.theme);
}

function renderTheme() {
  const theme = sanitizeTheme(state.theme);
  const effective = theme === "system" ? resolvedTheme() : theme;
  state.theme = theme;
  document.body.dataset.theme = effective;
  if (dom.btnTheme) {
    dom.btnTheme.dataset.theme = effective;
    dom.btnTheme.dataset.mode = theme;
    dom.btnTheme.title = effective === "light" ? "Switch to dark mode" : "Switch to light mode";
    dom.btnTheme.setAttribute("aria-label", dom.btnTheme.title);
  }
  if (dom.themeMode) {
    dom.themeMode.value = theme;
  }
}

// ── API Client ──

function apiUrl(path) {
  const base = state.serverUrl.replace(/\/+$/, "");
  return `${base}/${path.replace(/^\/+/, "")}`;
}

function apiHeaders() {
  const headers = { Accept: "application/json" };
  if (state.password) {
    headers.Authorization = `Basic ${btoa(`${state.username}:${state.password}`)}`;
  }
  return headers;
}

async function apiFetch(path, opts = {}) {
  const url = apiUrl(path);
  const res = await fetch(url, {
    ...opts,
    headers: { ...apiHeaders(), ...opts.headers },
    signal: opts.signal || AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res;
}

async function apiJson(path, opts) {
  const res = await apiFetch(path, opts);
  return res.json();
}

async function deleteSessionApi(sessionID, opts = {}) {
  const params = new URLSearchParams();
  if (opts.deleteTasks) params.set("deleteTasks", "true");
  const query = params.toString();
  return apiJson(`session/${encodeURIComponent(sessionID)}${query ? `?${query}` : ""}`, {
    method: "DELETE",
  });
}

function panelRequestBody(text, metadata = {}) {
  const sessionID = currentSessionID() || undefined;
  return {
    surface: "panel",
    text,
    taskID: state.selectedTaskID || undefined,
    sessionID,
    executor: state.executor,
    allow_create: true,
    metadata: {
      selectedTaskID: state.selectedTaskID || undefined,
      selectedSessionID: sessionID,
      ...metadata,
    },
  };
}

async function applyPanelResult(result) {
  if (result?.local_action?.type === "set_executor") {
    state.executor = result.local_action.executor;
    await persistOverlaySettings();
    renderExecutor();
  }
  if (result?.local_action?.type === "select_task" && result.local_action.taskID) {
    await loadTasks();
    await selectTask(result.local_action.taskID);
    return;
  }
  if (result?.local_action?.type === "select_session" && result.local_action.sessionID) {
    state.chatSessionID = result.local_action.sessionID;
    await loadConversation();
    renderManagedSessionList();
    renderManagedSessionMeta();
    return;
  }
  if (result?.local_action?.type === "invalidate_session" && result.local_action.sessionID) {
    state.chatSessionID = state.chatSessionID === result.local_action.sessionID ? "" : state.chatSessionID;
  }
  if (result?.task_id && state.selectedTaskID !== result.task_id) {
    await loadTasks();
    await selectTask(result.task_id);
    return;
  }
  if (state.selectedTaskID) {
    await loadBoard();
  } else {
    await loadTasks();
  }
  await loadConversation();
}

async function panelMessage(text, metadata) {
  const result = await apiJson("panel/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(panelRequestBody(text, metadata)),
  });
  await applyPanelResult(result);
  return result;
}

async function updateConfig(mutator) {
  const current = await apiJson("config");
  const next = structuredClone(current || {});
  mutator(next);
  return apiJson("config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(next),
  });
}

function dedupe(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter(Boolean))];
}

async function loadExtensions() {
  try {
    const [skills, mcp] = await Promise.all([apiJson("skill"), apiJson("mcp")]);
    state.skills = Array.isArray(skills) ? skills : [];
    state.mcp = mcp && typeof mcp === "object" ? mcp : {};
    renderExtensions();
  } catch {
    state.skills = [];
    state.mcp = {};
    renderExtensions();
  }
}

function renderExtensions() {
  const custom = state.skills.filter((item) => !item.builtin);
  const builtin = state.skills.length - custom.length;
  const mcpEntries = Object.entries(state.mcp || {});

  dom.extensionsBadge.textContent = `${custom.length} skill · ${mcpEntries.length} mcp`;

  if (!custom.length) {
    dom.skillList.innerHTML = `<div class="empty-hint">No custom skills configured${builtin > 0 ? ` · ${builtin} builtin loaded` : ""}</div>`;
  } else {
    dom.skillList.innerHTML = custom
      .map(
        (item) => `<div class="extension-row">
          <div class="extension-row-main">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.description || "")}</span>
            <small>${escapeHtml(item.location || "")}</small>
          </div>
          <div class="extension-row-actions">
            ${item.location && item.location !== "builtin"
              ? `<button type="button" class="btn btn-ghost mini" data-skill-open="${escapeHtml(item.location)}">Open</button>`
              : ""}
            <span class="extension-status" data-state="connected">loaded</span>
          </div>
        </div>`,
      )
      .join("");
  }

  if (!mcpEntries.length) {
    dom.mcpList.innerHTML = '<div class="empty-hint">No MCP servers configured</div>';
    return;
  }

  dom.mcpList.innerHTML = mcpEntries
    .map(([name, item]) => {
      const status = item?.status || "disabled";
      const detail = item?.error || "";
      return `<div class="extension-row">
        <div class="extension-row-main">
          <strong>${escapeHtml(name)}</strong>
          ${detail ? `<span>${escapeHtml(detail)}</span>` : `<span>${escapeHtml(status)}</span>`}
        </div>
        <span class="extension-status" data-state="${escapeHtml(status)}">${escapeHtml(status)}</span>
      </div>`;
    })
    .join("");
}

async function loadSkillMarket() {
  if (!dom.skillMarketDialog || !dom.skillMarketList) return;
  dom.skillMarketList.innerHTML = '<div class="empty-hint">Loading curated skill markets...</div>';
  dom.skillMarketDialog.showModal();
  try {
    const items = await apiJson("skill/market");
    state.skillMarket = Array.isArray(items) ? items : [];
    renderSkillMarket();
  } catch (e) {
    console.error("Failed to load skill market:", e);
    dom.skillMarketList.innerHTML = `<div class="empty-hint">${escapeHtml(e.message || "Failed to load skill market")}</div>`;
  }
}

function renderSkillMarket() {
  if (!dom.skillMarketList) return;
  if (!state.skillMarket.length) {
    dom.skillMarketList.innerHTML = '<div class="empty-hint">No skill market entries available</div>';
    return;
  }
  dom.skillMarketList.innerHTML = state.skillMarket
    .map((item) => {
      const installable = !!item.source && item.install_kind !== "manual";
      const action = installable
        ? `<button type="button" class="btn btn-primary mini" data-market-install="${escapeHtml(item.id)}">Install</button>`
        : `<button type="button" class="btn btn-ghost mini" data-market-homepage="${escapeHtml(item.homepage)}">Open Site</button>`;
      return `<div class="market-card">
        <div class="market-card-main">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.provider)} · ${escapeHtml(item.trust)} · ${escapeHtml(item.install_kind)}</span>
          <small>${escapeHtml(item.description || "")}</small>
          ${item.notes ? `<small>${escapeHtml(item.notes)}</small>` : ""}
        </div>
        <div class="market-card-actions">
          <span class="extension-status" data-state="${escapeHtml(item.recommended_policy)}">${escapeHtml(item.recommended_policy)}</span>
          ${action}
        </div>
      </div>`;
    })
    .join("");
}

async function installSkill(kind, value, policy) {
  await apiJson("skill/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, value, policy: policy || undefined }),
  });
}

function renderChannels() {
  if (!Array.isArray(state.channels) || state.channels.length === 0) {
    dom.channelList.innerHTML = '<div class="empty-hint">No channels available</div>';
    return;
  }
  dom.channelList.innerHTML = state.channels
    .map(
      (item) => `<div class="extension-row">
        <div class="extension-row-main">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.summary)}</span>
        </div>
        <div class="channel-row-actions">
          <span class="extension-status" data-state="${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
          <button type="button" class="btn btn-primary mini" data-channel-edit="${escapeHtml(item.id)}">Edit</button>
        </div>
      </div>`,
    )
    .join("");
}

function configValueForChannel(channelID, key) {
  return state.config?.channel?.[channelID]?.[key];
}

function renderChannelFields(channelID) {
  const entry = state.channels.find((item) => item.id === channelID);
  if (!entry) {
    dom.channelFields.innerHTML = '<div class="empty-hint">No channel fields available</div>';
    return;
  }
  dom.channelDialogTitle.textContent = `${entry.name} Configuration`;
  dom.channelId.value = entry.id;
  dom.channelFields.innerHTML = entry.fields
    .map((field) => {
      const name = `channel_${entry.id}_${field.key}`;
      const value = configValueForChannel(entry.id, field.key);
      if (field.type === "boolean") {
        return `<label class="field field-inline">
          <span class="field-label">${escapeHtml(field.label)}</span>
          <input type="checkbox" name="${escapeHtml(name)}" ${value !== false ? "checked" : ""}>
        </label>`;
      }
      const type = field.type === "secret" ? "password" : "text";
      return `<label class="field">
        <span class="field-label">${escapeHtml(field.label)}</span>
        <input class="field-input" type="${type}" name="${escapeHtml(name)}" value="${escapeHtml(String(value || ""))}" placeholder="${escapeHtml(field.placeholder || "")}">
      </label>`;
    })
    .join("");
}

function providerEntry(providerID) {
  return state.providerCatalog?.all?.find((item) => item.id === providerID);
}

function providerState(providerID, configOverride) {
  const config = configOverride || state.config || {};
  const item = providerEntry(providerID);
  const connected = Array.isArray(state.providerCatalog?.connected) && state.providerCatalog.connected.includes(providerID);
  const authMethods = Array.isArray(state.providerAuth?.[providerID]) ? state.providerAuth[providerID] : [];
  const configKey = config?.provider?.[providerID]?.options?.apiKey;
  const key = configKey || item?.key;

  if (connected) {
    return {
      tone: "active",
      label: "Connected",
      detail: "Provider is loaded and reachable in the current runtime.",
    };
  }
  if (key) {
    return {
      tone: "ready",
      label: "Configured",
      detail: "Credential is configured. Use Test Connection to verify it.",
    };
  }
  if (authMethods.length > 0) {
    return {
      tone: "warn",
      label: "Auth Required",
      detail: `This provider supports ${authMethods.length} auth method${authMethods.length > 1 ? "s" : ""}.`,
    };
  }
  if ((item?.env?.length || 0) > 0) {
    return {
      tone: "warn",
      label: "Needs API Key",
      detail: `Expected key via config or env: ${item.env.join(", ")}`,
    };
  }
  return {
    tone: "",
    label: "Available",
    detail: "Provider is listed but not configured for this runtime.",
  };
}

function renderProviderStatus(providerID, configOverride) {
  const info = providerState(providerID, configOverride);
  dom.llmStatus.textContent = info.label;
  dom.llmStatus.dataset.status = info.tone;
  dom.llmHint.textContent = info.detail;
  dom.cfgProviderStatus.textContent = info.label;
  dom.cfgProviderStatus.dataset.status = info.tone;
}

function populateProviderSelect(config, catalog) {
  const providers = Array.isArray(catalog?.all) ? [...catalog.all] : [];
  providers.sort((a, b) => {
    const aConnected = catalog?.connected?.includes(a.id) ? 0 : 1;
    const bConnected = catalog?.connected?.includes(b.id) ? 0 : 1;
    if (aConnected !== bConnected) return aConnected - bConnected;
    return (a.name || a.id).localeCompare(b.name || b.id);
  });
  const current = typeof config?.model === "string" && config.model.includes("/") ? config.model.split("/")[0] : "";
  dom.llmProvider.innerHTML = providers
    .map((item) => {
      const state = providerState(item.id, config).label;
      return `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || item.id)} · ${escapeHtml(state)}</option>`;
    })
    .join("");
  const fallback = current || providers[0]?.id || "";
  dom.llmProvider.value = providers.some((item) => item.id === fallback) ? fallback : providers[0]?.id || "";
  populateModelSelect(config, catalog);
}

function populateModelSelect(config, catalog) {
  const providerID = dom.llmProvider.value;
  const providers = Array.isArray(catalog?.all) ? catalog.all : [];
  const provider = providers.find((item) => item.id === providerID);
  const models = Object.keys(provider?.models || {}).sort((a, b) => a.localeCompare(b));
  const current = typeof config?.model === "string" && config.model.startsWith(`${providerID}/`)
    ? config.model.slice(providerID.length + 1)
    : catalog?.default?.[providerID] || models[0] || "";
  dom.llmModel.innerHTML = models.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
  dom.llmModel.value = models.includes(current) ? current : models[0] || "";
  const key = config?.provider?.[providerID]?.options?.apiKey || "";
  dom.llmApiKey.value = key;
  renderProviderStatus(providerID, config);
}

function toggleMcpFields() {
  const local = dom.mcpType.value === "local";
  dom.mcpRemoteField.classList.toggle("hidden", local);
  dom.mcpCommandField.classList.toggle("hidden", !local);
  dom.mcpArgsField.classList.toggle("hidden", !local);
  dom.mcpUrl.required = !local;
  dom.mcpCommand.required = local;
}

function shellSplit(text) {
  const result = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s]+/g;
  for (const match of text.matchAll(re)) {
    result.push((match[1] ?? match[2] ?? match[0] ?? "").replace(/\\(["'])/g, "$1"));
  }
  return result.filter(Boolean);
}

async function nativeConfirm(message, options) {
  const result = await showAppDialog({
    title: options?.title || "Confirm",
    message,
    kind: options?.kind || "warning",
    okLabel: options?.okLabel || "OK",
    cancelLabel: options?.cancelLabel || "Cancel",
    cancel: true,
  });
  return result.confirmed;
}

async function nativeDeleteTaskSessionConfirm(taskID, sessionID) {
  return nativeConfirm(`Delete task ${taskID} and its bound session ${sessionID}?`, {
    title: "Delete Task Session",
    okLabel: "Delete",
    kind: "warning",
  });
}

async function nativeMessage(message, options) {
  await showAppDialog({
    title: options?.title || "Notice",
    message,
    kind: options?.kind || "info",
    okLabel: options?.okLabel || "OK",
  });
}

async function nativePrompt(message, options) {
  const result = await showAppDialog({
    title: options?.title || "Input",
    message,
    kind: options?.kind || "info",
    okLabel: options?.okLabel || "Submit",
    cancelLabel: options?.cancelLabel || "Cancel",
    cancel: true,
    input: true,
    inputLabel: options?.inputLabel || "Value",
    inputPlaceholder: options?.inputPlaceholder || "",
    inputValue: options?.inputValue || "",
  });
  return result.confirmed ? result.value : null;
}

async function copyText(text) {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  const ok = document.execCommand("copy");
  textarea.remove();
  return ok;
}

function showAppDialog(options = {}) {
  if (
    !dom.appDialog ||
    !dom.appDialogTitle ||
    !dom.appDialogBody ||
    !dom.appDialogInputField ||
    !dom.appDialogInputLabel ||
    !dom.appDialogInput ||
    !dom.btnAppDialogCancel ||
    !dom.btnAppDialogOk
  ) {
    return Promise.resolve({ confirmed: false, value: null });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (confirmed) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (dom.appDialog.open) dom.appDialog.close();
      resolve({
        confirmed,
        value: confirmed && options.input ? dom.appDialogInput.value : null,
      });
    };
    const onCancel = () => finish(false);
    const onOk = () => finish(true);
    const onClose = () => finish(false);
    const onKeydown = (event) => {
      if (event.key === "Enter" && options.input) {
        event.preventDefault();
        finish(true);
      }
    };
    const cleanup = () => {
      dom.btnAppDialogCancel.removeEventListener("click", onCancel);
      dom.btnAppDialogOk.removeEventListener("click", onOk);
      dom.appDialog.removeEventListener("close", onClose);
      dom.appDialogInput.removeEventListener("keydown", onKeydown);
    };

    dom.appDialogTitle.textContent = options.title || "Notice";
    dom.appDialogBody.textContent = options.message || "";
    dom.appDialog.dataset.kind = options.kind || "info";
    dom.btnAppDialogOk.textContent = options.okLabel || "OK";
    dom.btnAppDialogCancel.textContent = options.cancelLabel || "Cancel";
    dom.btnAppDialogCancel.classList.toggle("hidden", !options.cancel);
    dom.appDialogInputField.classList.toggle("hidden", !options.input);
    dom.appDialogInputLabel.textContent = options.inputLabel || "Value";
    dom.appDialogInput.placeholder = options.inputPlaceholder || "";
    dom.appDialogInput.value = options.inputValue || "";

    dom.btnAppDialogCancel.addEventListener("click", onCancel);
    dom.btnAppDialogOk.addEventListener("click", onOk);
    dom.appDialog.addEventListener("close", onClose);
    dom.appDialogInput.addEventListener("keydown", onKeydown);
    dom.appDialog.showModal();

    requestAnimationFrame(() => {
      if (options.input) dom.appDialogInput.focus();
      else dom.btnAppDialogOk.focus();
    });
  });
}

async function nativeOpen(target) {
  if (!target) return false;
  if (!/^https?:\/\//i.test(target)) {
    const opened = await tauriInvoke("overlay_open_path", { path: target }).catch(() => undefined);
    if (opened) return true;
  }
  try {
    const mod = await import("@tauri-apps/plugin-shell");
    if (typeof mod.open === "function") {
      await mod.open(target);
      return true;
    }
  } catch {}
  if (/^https?:\/\//i.test(target)) {
    window.open(target, "_blank", "noopener");
    return true;
  }
  return false;
}

async function pickDirectory() {
  try {
    const mod = await import("@tauri-apps/plugin-dialog");
    if (typeof mod.open === "function") {
      const selected = await mod.open({
        directory: true,
        multiple: false,
      });
      return typeof selected === "string" ? selected : "";
    }
  } catch {}
  return "";
}

// ── Connection ──

async function checkConnection() {
  setConnStatus("connecting");
  try {
    const [health] = await Promise.all([apiJson("global/health"), apiJson("tasks")]);
    setConnStatus("online");
    state.connected = true;
    renderVersions(health?.version);
    return true;
  } catch {
    setConnStatus("offline");
    state.connected = false;
    renderVersions();
    return false;
  }
}

function setConnStatus(status) {
  dom.connBadge.dataset.status = status;
  dom.connBadge.textContent =
    status === "online" ? "Online" : status === "connecting" ? "..." : "Offline";
}

function renderVersions(coreVersion) {
  if (!dom.brandVersion) return;
  dom.brandVersion.textContent = coreVersion
    ? `overlay v${OVERLAY_VERSION} · core v${coreVersion}`
    : `overlay v${OVERLAY_VERSION}`;
}

function executorLabel(value) {
  if (value === "codex") return "Codex";
  if (value === "claude-code") return "Claude Code";
  return "Opencode";
}

function executorInfo(value) {
  return state.executors.find((item) => item.id === value);
}

function executorSelectable(value) {
  const item = executorInfo(value);
  if (item) return item.selectable;
  return value === "opencode";
}

function executorTitle(value) {
  const item = executorInfo(value);
  if (!item) return executorLabel(value);
  const lines = [item.label];
  if (item.version) lines.push(`Version: ${item.version}`);
  lines.push(item.detail);
  if (!item.selectable) {
    lines.push(item.discovered ? "Detected but not selectable" : "Not detected");
  }
  return lines.filter(Boolean).join("\n");
}

async function loadExecutors() {
  try {
    const data = await apiJson("executor");
    state.executors = Array.isArray(data) ? data : [];
  } catch {
    state.executors = [];
  }
  const next = executorSelectable(state.executor)
    ? state.executor
    : state.executors.find((item) => item.selectable)?.id || "opencode";
  if (state.executor !== next) {
    state.executor = next;
    await persistOverlaySettings();
  }
  renderExecutor();
}

function renderExecutor() {
  const buttons = dom.engineBar.querySelectorAll("[data-executor]");
  for (const button of buttons) {
    const value = button.dataset.executor || "opencode";
    const selectable = executorSelectable(value);
    button.dataset.active = value === state.executor ? "true" : "false";
    button.dataset.available = selectable ? "true" : "false";
    button.disabled = !selectable;
    button.title = executorTitle(value);
  }
  const current = state.board?.run?.executor;
  dom.engineStatus.textContent = current
    ? `Current: ${executorLabel(current)} · New: ${executorLabel(state.executor)}`
    : `New task: ${executorLabel(state.executor)}`;
}

function currentTaskSessionID() {
  return state.board?.task?.sessionID || "";
}

function renderTaskSession() {
  const sessionID = currentTaskSessionID();
  if (!state.selectedTaskID) {
    dom.taskSessionChip.textContent = "Task session unavailable";
    dom.taskSessionChip.dataset.state = "idle";
    dom.taskSessionChip.title = "";
    dom.btnManageTaskSession.disabled = true;
    dom.btnDeleteTaskSession.disabled = true;
    return;
  }
  if (!sessionID) {
    dom.taskSessionChip.textContent = "Task session deleted";
    dom.taskSessionChip.dataset.state = "missing";
    dom.taskSessionChip.title = "";
    dom.btnManageTaskSession.disabled = true;
    dom.btnDeleteTaskSession.disabled = true;
    return;
  }
  dom.taskSessionChip.textContent = `Task session: ${sessionID}`;
  dom.taskSessionChip.dataset.state = "active";
  dom.taskSessionChip.title = sessionID;
  dom.btnManageTaskSession.disabled = false;
  dom.btnDeleteTaskSession.disabled = false;
}

async function loadMeta() {
  try {
    const [path, vcs] = await Promise.all([apiJson("path"), apiJson("vcs")]);
    state.path = path;
    state.vcs = vcs;
    renderMeta();
  } catch {
    state.path = null;
    state.vcs = null;
    renderMeta();
  }
}

function renderMeta() {
  const dir = state.path?.directory || "";
  dom.taskDir.textContent = dir || "Working directory unavailable";
  dom.taskDir.title = dir;

  const label = gitLabel(state.vcs);
  dom.taskGit.textContent = label;
  dom.taskGit.dataset.state = state.vcs?.dirty ? "dirty" : state.vcs?.clean ? "clean" : "idle";
  dom.taskGit.title = gitTitle(state.vcs);
  renderSettingsPaths();
  renderExecutor();
  renderTaskSession();
}

function configRootPath() {
  return state.path?.config || state.path?.directory || "";
}

function joinDisplayPath(base, file) {
  if (!base) return file;
  if (/[\\/]$/.test(base)) return `${base}${file}`;
  const sep = base.includes("\\") ? "\\" : "/";
  return `${base}${sep}${file}`;
}

function renderSettingsPaths() {
  const root = configRootPath();
  if (dom.settingsConfigRoot) dom.settingsConfigRoot.textContent = root || "Unavailable until connected";
  if (dom.settingsConfigFile) dom.settingsConfigFile.textContent = joinDisplayPath(root, "config.json");
  if (dom.settingsOverlayFile) dom.settingsOverlayFile.textContent = joinDisplayPath(root, "overlay.json");
}

function gitLabel(vcs) {
  if (!vcs?.branch) return "Git unavailable";
  const parts = [vcs.branch];
  if (vcs.ahead) parts.push(`+${vcs.ahead}`);
  if (vcs.behind) parts.push(`-${vcs.behind}`);
  if (vcs.conflicts) parts.push(`conflicts ${vcs.conflicts}`);
  if (vcs.dirty) {
    const changes = [];
    if (vcs.staged) changes.push(`staged ${vcs.staged}`);
    if (vcs.modified) changes.push(`modified ${vcs.modified}`);
    if (vcs.untracked) changes.push(`untracked ${vcs.untracked}`);
    parts.push(changes.join(" "));
  } else {
    parts.push("clean");
  }
  return parts.filter(Boolean).join(" · ");
}

function gitTitle(vcs) {
  if (!vcs?.branch) return "";
  return [
    `branch: ${vcs.branch}`,
    `clean: ${vcs.clean ? "yes" : "no"}`,
    `staged: ${vcs.staged ?? 0}`,
    `modified: ${vcs.modified ?? 0}`,
    `untracked: ${vcs.untracked ?? 0}`,
    `conflicts: ${vcs.conflicts ?? 0}`,
    `ahead: ${vcs.ahead ?? 0}`,
    `behind: ${vcs.behind ?? 0}`,
  ].join("\n");
}

// ── Task List ──

async function loadTasks() {
  try {
    const data = await apiJson("tasks");
    state.tasks = (data.tasks || [])
      .filter((item) => item.task?.sessionID)
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    if (state.selectedTaskID && !state.tasks.some((item) => item.task.id === state.selectedTaskID)) {
      state.selectedTaskID = "";
      state.board = null;
      state.chatSessionID = "";
      state.session = [];
      renderClear();
    }
    renderTaskSelect();
    // Auto-select first running/blocked task, or keep current selection
    if (!state.selectedTaskID && state.tasks.length > 0) {
      const active = state.tasks.find((t) =>
        ["running", "planning", "evaluating", "blocked", "queued"].includes(t.task.status)
      );
      if (active) selectTask(active.task.id);
      else selectTask(state.tasks[0].task.id);
    }
  } catch {
    // silent
  }
}

function renderTaskSelect() {
  const current = state.selectedTaskID;
  dom.taskSelect.innerHTML = '<option value="">-- Select Task --</option>';
  for (const t of state.tasks) {
    const opt = document.createElement("option");
    opt.value = t.task.id;
    opt.textContent = `${t.task.title || t.task.request.slice(0, 50)} [${t.task.status}]`;
    if (t.task.id === current) opt.selected = true;
    dom.taskSelect.appendChild(opt);
  }
}

// ── Task Selection ──

async function selectTask(taskID) {
  state.selectedTaskID = taskID;
  state.chatSessionID = "";
  stopPolling();
  stopSSE();
  state.board = null;
  state.session = [];
  renderClear();

  if (!taskID) {
    setTaskStatus("idle", "No task");
    await loadConversation();
    return;
  }

  await loadBoard();
  await loadConversation();
  await loadMeta();
  startPolling();

  // Start SSE for running tasks
  const status = state.board?.task?.status;
  if (["running", "planning", "evaluating", "blocked", "queued"].includes(status)) {
    startSSE(taskID);
  }
}

// ── Board Loading ──

async function loadBoard() {
  if (!state.selectedTaskID) return;
  // Don't reload while an interaction button click is in flight
  if (typeof _interactionBusy !== "undefined" && _interactionBusy) return;
  try {
    const board = await apiJson(`task/${state.selectedTaskID}/board`);
    state.board = board;
    renderBoard();
    await loadChanges();
  } catch {
    // silent
  }
}

// ── Control Conversation ──

async function loadConversation() {
  const target = conversationTarget();
  try {
    const params = new URLSearchParams();
    if (target.taskID) params.set("taskID", target.taskID);
    else if (target.sessionID) params.set("sessionID", target.sessionID);
    else params.set("surface", "panel");
    const messages = await apiJson(`control/timeline?${params.toString()}`);
    let result = Array.isArray(messages) ? messages : [];

    // Fallback: if control timeline is empty, load the underlying session messages
    // (headless API tasks don't write to the control timeline)
    if (result.length === 0) {
      const sessionID = currentSessionID();
      if (sessionID) {
        try {
          const sessionMsgs = await apiJson(`session/${sessionID}/message`);
          result = Array.isArray(sessionMsgs) ? sessionMsgs : [];
        } catch {}
      }
    }

    state.session = result;
    renderSession();
    if (!state.selectedTaskID || state.chatSessionID) {
      await loadChanges();
    }
  } catch (e) {
    console.error("Failed to load conversation:", e);
    state.session = [];
    renderSession();
    if (!state.selectedTaskID || state.chatSessionID) {
      await loadChanges();
    }
  }
}

function currentSessionID() {
  if (state.chatSessionID) return state.chatSessionID;
  return state.board?.task?.sessionID || "";
}

function conversationTarget() {
  if (state.chatSessionID) {
    return {
      key: `session:${state.chatSessionID}`,
      sessionID: state.chatSessionID,
    };
  }
  if (state.selectedTaskID) {
    return {
      key: `task:${state.selectedTaskID}`,
      taskID: state.selectedTaskID,
    };
  }
  return {
    key: "global:panel",
  };
}

async function loadChanges() {
  const sessionID = currentSessionID();
  const requestKey = sessionID || `fallback:${state.selectedTaskID || state.chatSessionID || "none"}`;
  state.changeKey = requestKey;

  if (!sessionID) {
    state.changes = normalizeDiffs(fallbackBoardDiffs());
    renderChanges();
    return;
  }

  try {
    const diff = await apiJson(`session/${sessionID}/diff`);
    if (state.changeKey !== requestKey) return;
    state.changes = normalizeDiffs(diff.length ? diff : fallbackBoardDiffs());
    renderChanges();
  } catch (e) {
    console.error("Failed to load session diff:", e);
    if (state.changeKey !== requestKey) return;
    state.changes = normalizeDiffs(fallbackBoardDiffs());
    renderChanges();
  }
}

function fallbackBoardDiffs() {
  return (
    state.board?.candidateDelivery?.result?.diffs ||
    state.board?.delivery?.result?.diffs ||
    state.board?.acceptedDelivery?.result?.diffs ||
    []
  );
}

function normalizeDiffs(list) {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && typeof item.file === "string")
    .map((item) => ({
      file: String(item.file || "").replace(/^[ab]\//, ""),
      before: typeof item.before === "string" ? item.before : "",
      after: typeof item.after === "string" ? item.after : "",
      additions: Number.isFinite(Number(item.additions)) ? Number(item.additions) : 0,
      deletions: Number.isFinite(Number(item.deletions)) ? Number(item.deletions) : 0,
      status: diffStatus(item),
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function diffStatus(item) {
  if (item.status === "added" || item.status === "deleted" || item.status === "modified") {
    return item.status;
  }
  if (!item.before && item.after) return "added";
  if (item.before && !item.after) return "deleted";
  return "modified";
}

// ── SSE Events ──

function startSSE(taskID) {
  stopSSE();
  const controller = new AbortController();
  state.sse = controller;

  (async () => {
    try {
      const res = await fetch(apiUrl(`task/${taskID}/events`), {
        headers: apiHeaders(),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data:")) {
            try {
              const event = JSON.parse(line.slice(5).trim());
              handleSSEEvent(event);
            } catch {}
          }
        }
      }
    } catch (e) {
      if (e.name === "AbortError") return;
      // Retry after delay
      setTimeout(() => {
        if (state.selectedTaskID === taskID) startSSE(taskID);
      }, 5000);
    }
  })();
}

function stopSSE() {
  if (state.sse) {
    state.sse.abort();
    state.sse = null;
  }
}

function handleSSEEvent(event) {
  const type = event.type || "";
  if (
    type.includes("task.updated") ||
    type.includes("task.completed") ||
    type.includes("task.failed") ||
    type.includes("run.updated") ||
    type.includes("plan.") ||
    type.includes("goal.") ||
    type.includes("delivery.") ||
    type.includes("evaluation.") ||
    type.includes("interaction.")
  ) {
    loadBoard();
    loadConversation();
  }
}

// ── Polling ──

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(() => {
    loadBoard();
    loadMeta();
  }, POLL_INTERVAL);
  state.sessionTimer = setInterval(() => loadConversation(), SESSION_POLL);
}

function stopPolling() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  if (state.sessionTimer) { clearInterval(state.sessionTimer); state.sessionTimer = null; }
  if (state.elapsedTimer) { clearInterval(state.elapsedTimer); state.elapsedTimer = null; }
}

// ── Rendering: Board ──

function renderBoard() {
  if (!state.board) return;
  const { task, plan, overview, lanes, evaluation, delivery, interactions } = state.board;

  // Status
  setTaskStatus(task.status, task.status);
  startElapsedTimer(task.time.started || task.time.created);
  syncCriteriaSelection(task);

  // Overview
  renderOverview(overview, task);

  // Plan
  renderPlan(plan);

  // Goals
  const goalsLane = (lanes || []).find((l) => l.id === "goals");
  renderGoals(goalsLane?.cards || []);

  // Criteria + Evaluation
  renderCriteria(evaluation);

  // Evaluation
  renderEvaluation(evaluation, delivery);

  // Interactions
  renderInteractions(interactions || []);
  renderExecutor();

  // Re-render session to include updated board context (goals, evaluation)
  renderSession();
}

function setTaskStatus(status, label) {
  dom.statusDot.dataset.status = status;
  dom.statusLabel.textContent = statusLabel(status);
}

function statusLabel(status) {
  const map = {
    idle: "No task",
    queued: "Queued",
    planning: "Planning",
    running: "Running",
    blocked: "Blocked",
    evaluating: "Evaluating",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return map[status] || status;
}

function startElapsedTimer(startTime) {
  if (state.elapsedTimer) clearInterval(state.elapsedTimer);
  if (!startTime) { dom.elapsed.textContent = ""; return; }
  const update = () => {
    const end = state.board?.task?.time?.completed || Date.now();
    dom.elapsed.textContent = formatDuration(end - startTime);
  };
  update();
  if (!state.board?.task?.time?.completed) {
    state.elapsedTimer = setInterval(update, 1000);
  }
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ── Overview Rendering ──

function renderOverview(overview, task) {
  const badge = $("#overviewBadge");
  const body = $("#overviewBody");
  if (!overview) {
    badge.textContent = "";
    body.innerHTML = '<p class="empty-hint">Select a task to view overview</p>';
    return;
  }

  badge.textContent = task.status;
  badge.dataset.tone =
    task.status === "completed" ? "good" :
    task.status === "failed" ? "bad" :
    ["running", "planning", "evaluating"].includes(task.status) ? "accent" :
    task.status === "blocked" ? "warn" : "";

  const controls = overview.controls || {};
  let actionsHtml = "";
  if (controls.canRetry || controls.canReplan || controls.canCancel) {
    actionsHtml = '<div class="section-actions">';
    if (controls.canRetry) actionsHtml += `<button class="btn btn-primary" onclick="taskAction('retry')">Retry</button>`;
    if (controls.canReplan) actionsHtml += `<button class="btn btn-ghost" onclick="taskAction('replan')">Replan</button>`;
    if (controls.canCancel) actionsHtml += `<button class="btn btn-ghost" onclick="taskAction('cancel')">Cancel</button>`;
    actionsHtml += "</div>";
  }

  let failureHtml = "";
  if (overview.currentFailure) {
    const f = overview.currentFailure;
    failureHtml = `<div class="interaction-alert" style="border-color:rgba(248,113,113,0.15);background:var(--bad-dim)">
      <div class="interaction-title" style="color:var(--bad)">${escapeHtml(f.title)}</div>
      <div class="interaction-body">${escapeHtml(f.summary)}</div>
    </div>`;
  }

  body.innerHTML = `
    <div class="plan-summary">${escapeHtml(overview.headline)}</div>
    <div style="font-size:12px;color:var(--text);margin-top:4px;line-height:1.5">${escapeHtml(overview.summary)}</div>
    ${overview.nextStep ? `<div style="margin-top:6px;padding:5px 8px;border-radius:var(--radius);background:var(--accent-dim);border-left:2px solid var(--accent);font-size:11px;color:var(--text)">
      <strong style="color:var(--text-strong)">${escapeHtml(overview.nextStep.title)}</strong>
      ${overview.nextStep.detail ? `<div style="margin-top:2px;color:var(--text-soft)">${escapeHtml(overview.nextStep.detail)}</div>` : ""}
    </div>` : ""}
    ${failureHtml}
    ${actionsHtml}
  `;
}

function renderChanges() {
  if (!dom.changesBody || !dom.changesBadge) return;
  const files = state.changes;
  if (!files.length) {
    dom.changesBadge.textContent = "";
    delete dom.changesBadge.dataset.tone;
    const hint = currentSessionID()
      ? "No file changes yet"
      : state.selectedTaskID || state.chatSessionID
        ? "File changes unavailable"
        : "Select a task or session to inspect file changes";
    dom.changesBody.innerHTML = `<p class="empty-hint">${escapeHtml(hint)}</p>`;
    return;
  }

  const additions = files.reduce((sum, item) => sum + item.additions, 0);
  const deletions = files.reduce((sum, item) => sum + item.deletions, 0);
  dom.changesBadge.textContent = String(files.length);
  dom.changesBadge.dataset.tone = "accent";
  dom.changesBody.innerHTML = `
    <div class="changes-summary">
      <span>${files.length} ${files.length === 1 ? "file" : "files"} changed</span>
      <span class="changes-total">
        <span data-tone="add">+${additions}</span>
        <span data-tone="del">-${deletions}</span>
      </span>
    </div>
    <div class="changes-list">
      ${files
        .map(
          (item, index) => `
        <button type="button" class="change-row" data-change-index="${index}" title="${escapeHtml(item.file)}">
          <span class="change-main">
            <span class="change-path">${escapeHtml(item.file)}</span>
            <span class="change-subline">${escapeHtml(changeStatusLabel(item.status))}</span>
          </span>
          <span class="change-meta">
            <span class="change-status" data-status="${item.status}">${escapeHtml(changeStatusLabel(item.status))}</span>
            <span class="diff-dialog-stat" data-tone="add">+${item.additions}</span>
            <span class="diff-dialog-stat" data-tone="del">-${item.deletions}</span>
          </span>
        </button>`,
        )
        .join("")}
    </div>
  `;
}

function changeStatusLabel(status) {
  if (status === "added") return "Created";
  if (status === "deleted") return "Deleted";
  return "Modified";
}

function openDiffDialog(index) {
  const item = state.changes[index];
  if (!item || !dom.diffDialog || !dom.diffDialogTitle || !dom.diffDialogMeta || !dom.diffDialogBody) return;
  dom.diffDialogTitle.textContent = item.file;
  dom.diffDialogMeta.innerHTML = `
    <span class="change-status" data-status="${item.status}">${escapeHtml(changeStatusLabel(item.status))}</span>
    <span class="diff-dialog-stat" data-tone="add">+${item.additions}</span>
    <span class="diff-dialog-stat" data-tone="del">-${item.deletions}</span>
  `;
  dom.diffDialogBody.innerHTML = renderDiffPreview(item);
  dom.diffDialog.showModal();
}

function renderDiffPreview(item) {
  if (!item.before && !item.after) {
    return '<div class="diff-empty"><p class="empty-hint">No text diff preview is available for this file.</p></div>';
  }
  const ops = collapseDiffOps(buildDiffOps(item.before, item.after));
  const changed = ops.some((item) => item.kind === "add" || item.kind === "del");
  if (!changed) {
    return '<div class="diff-empty"><p class="empty-hint">No text diff preview is available for this file.</p></div>';
  }
  return `<div class="diff-lines">
    ${ops
      .map((line) => {
        if (line.kind === "skip") {
          return `<div class="diff-row" data-kind="skip">
            <div class="diff-gutter">...</div>
            <div class="diff-num"></div>
            <div class="diff-num"></div>
            <div class="diff-code">${escapeHtml(`${line.count} unchanged ${line.count === 1 ? "line" : "lines"} hidden`)}</div>
          </div>`;
        }
        const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
        return `<div class="diff-row" data-kind="${line.kind}">
          <div class="diff-gutter">${marker}</div>
          <div class="diff-num">${line.left || ""}</div>
          <div class="diff-num">${line.right || ""}</div>
          <div class="diff-code">${escapeHtml(line.text || " ")}</div>
        </div>`;
      })
      .join("")}
  </div>`;
}

function buildDiffOps(before, after) {
  const left = splitDiffLines(before);
  const right = splitDiffLines(after);
  const ops = [];
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) {
    ops.push({ kind: "context", left: start + 1, right: start + 1, text: left[start] });
    start += 1;
  }

  let leftEnd = left.length - 1;
  let rightEnd = right.length - 1;
  const suffix = [];
  while (leftEnd >= start && rightEnd >= start && left[leftEnd] === right[rightEnd]) {
    suffix.push({ kind: "context", left: leftEnd + 1, right: rightEnd + 1, text: left[leftEnd] });
    leftEnd -= 1;
    rightEnd -= 1;
  }

  ops.push(
    ...diffMiddle(
      left.slice(start, leftEnd + 1),
      right.slice(start, rightEnd + 1),
      start + 1,
      start + 1,
    ),
  );
  ops.push(...suffix.reverse());
  return ops;
}

function diffMiddle(left, right, leftStart, rightStart) {
  if (!left.length && !right.length) return [];
  if (!left.length) {
    return right.map((text, index) => ({ kind: "add", left: "", right: rightStart + index, text }));
  }
  if (!right.length) {
    return left.map((text, index) => ({ kind: "del", left: leftStart + index, right: "", text }));
  }
  if (left.length * right.length > 120000) {
    return [
      ...left.map((text, index) => ({ kind: "del", left: leftStart + index, right: "", text })),
      ...right.map((text, index) => ({ kind: "add", left: "", right: rightStart + index, text })),
    ];
  }

  const grid = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      grid[i][j] = left[i] === right[j] ? grid[i + 1][j + 1] + 1 : Math.max(grid[i + 1][j], grid[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      ops.push({ kind: "context", left: leftStart + i, right: rightStart + j, text: left[i] });
      i += 1;
      j += 1;
      continue;
    }
    if (grid[i + 1][j] >= grid[i][j + 1]) {
      ops.push({ kind: "del", left: leftStart + i, right: "", text: left[i] });
      i += 1;
      continue;
    }
    ops.push({ kind: "add", left: "", right: rightStart + j, text: right[j] });
    j += 1;
  }
  while (i < left.length) {
    ops.push({ kind: "del", left: leftStart + i, right: "", text: left[i] });
    i += 1;
  }
  while (j < right.length) {
    ops.push({ kind: "add", left: "", right: rightStart + j, text: right[j] });
    j += 1;
  }
  return ops;
}

function collapseDiffOps(ops) {
  const next = [];
  let index = 0;
  while (index < ops.length) {
    if (ops[index].kind !== "context") {
      next.push(ops[index]);
      index += 1;
      continue;
    }
    let end = index;
    while (end < ops.length && ops[end].kind === "context") {
      end += 1;
    }
    const chunk = ops.slice(index, end);
    if (chunk.length <= 8) {
      next.push(...chunk);
    } else {
      next.push(...chunk.slice(0, 3));
      next.push({ kind: "skip", count: chunk.length - 6 });
      next.push(...chunk.slice(-3));
    }
    index = end;
  }
  return next;
}

function splitDiffLines(text) {
  const value = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!value) return [];
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

window.taskAction = async function (action) {
  if (!state.selectedTaskID) return;
  try {
    await panelMessage(`Perform ${action} on task ${state.selectedTaskID}.`, {
      taskID: state.selectedTaskID,
      ui_context: "task_controls",
    });
    await loadBoard();
  } catch (e) {
    console.error(`Failed to ${action} task:`, e);
  }
};

window.openGoalDialog = function () {
  if (!state.selectedTaskID) return;
  dom.goalDialogTitle.textContent = "New Goal";
  dom.goalId.value = "";
  dom.goalDescription.value = "";
  dom.goalCriteria.value = "";
  dom.goalDialog.showModal();
};

window.editGoal = function (id, description, criteria) {
  dom.goalDialogTitle.textContent = "Edit Goal";
  dom.goalId.value = id || "";
  dom.goalDescription.value = description || "";
  dom.goalCriteria.value = criteria || "";
  dom.goalDialog.showModal();
};

window.deleteGoalAction = async function (id) {
  if (!id) return;
  const accepted = await nativeConfirm("Delete this goal?", {
    title: "Delete Goal",
    okLabel: "Delete",
    kind: "warning",
  });
  if (!accepted) return;
  try {
    await panelMessage(`Delete goal ${id}.`, {
      goalID: id,
      taskID: state.selectedTaskID || undefined,
      ui_context: "goal_editor",
    });
    await loadBoard();
  } catch (e) {
    console.error("Failed to delete goal:", e);
    await nativeMessage("Failed to delete goal: " + e.message, {
      title: "Delete Goal",
      kind: "error",
    });
  }
};

// ── Plan Rendering ──

function renderPlan(plan) {
  if (!plan) {
    dom.planBadge.textContent = "";
    dom.planBody.innerHTML = '<p class="empty-hint">No plan yet</p>';
    return;
  }
  dom.planBadge.textContent = `v${plan.version}`;
  dom.planBadge.dataset.tone = "accent";
  dom.planBody.innerHTML = `
    <div class="plan-summary">${escapeHtml(plan.summary)}</div>
    <div class="plan-version">Version ${plan.version} &middot; ${stamp(plan.time.created)}</div>
  `;
}

// ── Goals Rendering ──

function renderGoals(cards) {
  const passed = cards.filter((c) => c.status === "passed").length;
  const total = cards.length;
  if (total === 0) {
    dom.goalsBadge.textContent = "";
    dom.goalsBody.innerHTML = `${goalToolbar()}<p class="empty-hint">No goals defined</p>`;
    return;
  }
  dom.goalsBadge.textContent = `${passed}/${total}`;
  dom.goalsBadge.dataset.tone = passed === total ? "good" : passed > 0 ? "warn" : "";

  dom.goalsBody.innerHTML = `${goalToolbar()}<div class="goals-list">
    ${cards
      .map(
        (c) => `
      <div class="goal-item">
        <span class="goal-status-icon" data-status="${c.status || "pending"}">${goalIcon(c.status)}</span>
        <div class="goal-content">
          <div class="goal-desc">${escapeHtml(c.title)}</div>
          ${c.detail ? `<div class="goal-criteria">${escapeHtml(c.detail)}</div>` : ""}
        </div>
        ${c.metadata?.priority ? `<span class="goal-priority" data-priority="${c.metadata.priority}">${c.metadata.priority}</span>` : ""}
        <div class="goal-actions">
          <button class="btn btn-ghost mini" onclick="editGoal('${c.id}', ${jsonAttr(c.title)}, ${jsonAttr(c.detail || "")})">Edit</button>
          <button class="btn btn-ghost mini danger" onclick="deleteGoalAction('${c.id}')">Delete</button>
        </div>
      </div>`
      )
      .join("")}
  </div>`;
}

function goalToolbar() {
  return `<div class="section-actions compact">
    <button class="btn btn-primary mini" onclick="openGoalDialog()">New Goal</button>
  </div>`;
}

function goalIcon(status) {
  if (status === "passed") return "\u2713";
  if (status === "failed") return "\u2717";
  return "\u2022";
}

// ── Criteria Rendering ──

function renderCriteria(evaluation) {
  const checks = evaluation?.checks || [];
  const checkMap = {};
  for (const c of checks) checkMap[c.name.toLowerCase().replace(/[^a-z_]/g, "_")] = c;

  const criteriaItems = dom.criteriaList.querySelectorAll(".criteria-item");
  let enabledCount = 0;
  let passedCount = 0;

  criteriaItems.forEach((item) => {
    const checkbox = item.querySelector("input[type=checkbox]");
    const statusDot = item.querySelector(".criteria-status");
    const checkName = checkbox?.dataset.check;
    if (!checkName || !statusDot) return;

    // Find matching evaluation check
    const evalCheck = findCheck(checkMap, checkName);
    if (!isCriteriaEnabled(item)) {
      setCriteriaResult(item, "off");
    } else if (evalCheck) {
      setCriteriaResult(item, evalCheck.status);
      if (evalCheck.status === "passed") passedCount++;
    } else {
      setCriteriaResult(item, "pending");
    }

    if (checkbox.checked) enabledCount++;
  });

  if (enabledCount > 0) {
    dom.criteriaBadge.textContent = `${passedCount}/${enabledCount}`;
    dom.criteriaBadge.dataset.tone = passedCount === enabledCount ? "good" : passedCount > 0 ? "warn" : "";
  } else {
    dom.criteriaBadge.textContent = "0 enabled";
    dom.criteriaBadge.dataset.tone = "";
  }
}

function buildCheckSelection() {
  const selection = {};
  dom.criteriaList.querySelectorAll("input[type=checkbox][data-check]").forEach((input) => {
    selection[input.dataset.check] = input.checked;
  });
  return selection;
}

function findCheck(checkMap, name) {
  // Try exact match, then fuzzy
  if (checkMap[name]) return checkMap[name];
  for (const [k, v] of Object.entries(checkMap)) {
    if (k.includes(name) || name.includes(k)) return v;
  }
  return null;
}

// ── Evaluation Rendering ──

function renderEvaluation(evaluation, delivery) {
  // Reset all criteria status dots
  document.querySelectorAll(".criteria-item").forEach((item) => {
    setCriteriaResult(item, isCriteriaEnabled(item) ? "pending" : "off");
  });

  if (!evaluation) {
    if (dom.criteriaBadge) { dom.criteriaBadge.textContent = ""; delete dom.criteriaBadge.dataset.tone; }
    if (dom.evalBody) dom.evalBody.innerHTML = delivery ? renderDeliveryCard(delivery) : "";
    return;
  }

  // Update section badge
  if (dom.criteriaBadge) {
    dom.criteriaBadge.textContent = evaluation.verdict;
    dom.criteriaBadge.dataset.tone =
      evaluation.verdict === "accepted" ? "good" :
      evaluation.verdict === "rejected" ? "bad" : "warn";
  }

  // Update criteria status dots from evaluation checks
  const errors = [];
  if (evaluation.checks?.length > 0) {
    for (const check of evaluation.checks) {
      // Match check name to criteria checkbox data-check attribute
      const key = check.name?.toLowerCase().replace(/[\s_-]+/g, "_");
      const item = document.querySelector(`[data-check="${key}"]`)?.closest(".criteria-item");
      if (item) {
        setCriteriaResult(item, check.status);
      }
      if (check.status === "failed" && check.evidence) {
        errors.push({ name: check.name, evidence: check.evidence });
      }
    }
  }

  // Build evalBody: only show errors and summary
  let html = "";

  if (errors.length > 0) {
    for (const err of errors) {
      html += `<div class="eval-error">
        <div class="eval-error-name">\u2717 ${escapeHtml(err.name)}</div>
        <div class="eval-error-detail">${escapeHtml(err.evidence.slice(0, 400))}</div>
      </div>`;
    }
  }

  if (evaluation.summary) {
    html += `<div class="eval-summary">${escapeHtml(evaluation.summary)}</div>`;
  }

  if (delivery) {
    html += renderDeliveryCard(delivery);
  }

  if (dom.evalBody) dom.evalBody.innerHTML = html;
}

function renderDeliveryCard(delivery) {
  if (!delivery) return "";
  const fileCount = delivery.result?.changedFiles?.length || 0;
  const title =
    delivery.status === "delivered" ? "Delivered" :
    delivery.status === "publishing" ? "Publishing Delivery" :
    delivery.status === "failed" ? "Delivery Failed" :
    "Candidate Delivery";
  return `<div class="delivery-card">
    <div class="delivery-title">${escapeHtml(title)}</div>
    <div class="delivery-summary">${escapeHtml(delivery.summary || delivery.result?.summary || "")}</div>
    ${fileCount > 0 ? `<div class="delivery-files">${fileCount} file${fileCount > 1 ? "s" : ""} changed</div>` : ""}
  </div>`;
}

function setCriteriaResult(item, status) {
  const statusDot = item?.querySelector(".criteria-status");
  const text = item?.querySelector(".criteria-result");
  if (!statusDot || !text) return;
  statusDot.dataset.result = status;
  text.textContent = criteriaResultText(status);
}

function criteriaResultText(status) {
  if (status === "off") return "OFF";
  if (status === "passed") return "PASS";
  if (status === "failed") return "FAIL";
  if (status === "skipped") return "SKIP";
  return "PENDING";
}

function isCriteriaEnabled(item) {
  const input = item?.querySelector('input[type="checkbox"][data-check]');
  return !!input?.checked;
}

function syncCriteriaSelection(task) {
  const checks =
    task?.metadata?.checks && typeof task.metadata.checks === "object" && !Array.isArray(task.metadata.checks)
      ? task.metadata.checks
      : {};

  dom.criteriaList?.querySelectorAll('input[type="checkbox"][data-check]').forEach((input) => {
    const key = input.dataset.check;
    if (!key) return;
    input.checked = criteriaEnabledFromConfig(key, checks);
  });
}

function criteriaEnabledFromConfig(key, checks) {
  const value = checks?.[key];
  if (key === "lint" || key === "build" || key === "test") {
    return value !== false;
  }
  if (value === true) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return value.enabled !== false;
}

// ── Session Manager ──

async function loadManagedSessions() {
  try {
    const data = await apiJson("session?roots=true&limit=80");
    state.sessions = Array.isArray(data)
      ? [...data].sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0))
      : [];
    renderManagedSessionList();
  } catch (e) {
    console.error("Failed to load sessions:", e);
  }
}

async function selectManagedSession(sessionID) {
  if (!sessionID) {
    state.managedSession = null;
    state.managedChildren = [];
    renderManagedSessionList();
    renderManagedSessionMeta();
    renderManagedSessionChildren();
    return;
  }
  try {
    state.managedSession = await apiJson(`session/${sessionID}`);
    state.managedChildren = await apiJson(`session/${sessionID}/children`).catch(() => []);
    renderManagedSessionList();
    renderManagedSessionMeta();
    renderManagedSessionChildren();
  } catch (e) {
    console.error("Failed to load managed session:", e);
  }
}

function renderManagedSessionList() {
  if (!state.sessions.length) {
    dom.sessionListPanel.innerHTML = '<div class="empty-hint">No sessions found</div>';
    return;
  }
  dom.sessionListPanel.innerHTML = state.sessions
    .map((item) => {
      const active = state.managedSession?.id === item.id ? ' data-active="true"' : "";
      return `<button class="session-row-mini"${active} onclick="selectManagedSessionById('${item.id}')">
        <strong>${escapeHtml(item.title || item.id)}</strong>
        <span>${stamp(item.time?.updated)}</span>
        <small>${escapeHtml(item.directory || "")}</small>
      </button>`;
    })
    .join("");
}

function renderManagedSessionMeta() {
  const session = state.managedSession;
  if (!session) {
    dom.sessionMetaCard.innerHTML = '<div class="empty-hint">Select a session to manage it.</div>';
    return;
  }
  const chatTarget = currentSessionID() === session.id ? '<span class="mini-badge">Chat target</span>' : "";
  dom.sessionMetaCard.innerHTML = `
    <div class="session-meta-row">
      <strong>${escapeHtml(session.title || session.id)}</strong>
      ${chatTarget}
    </div>
    <div class="session-meta-row"><span>ID</span><code>${escapeHtml(session.id)}</code></div>
    <div class="session-meta-row"><span>Updated</span><span>${stamp(session.time?.updated)}</span></div>
    <div class="session-meta-row"><span>Directory</span><span>${escapeHtml(session.directory || "")}</span></div>
  `;
}

function renderManagedSessionChildren() {
  const children = Array.isArray(state.managedChildren) ? state.managedChildren : [];
  if (!children.length) {
    dom.sessionChildrenPanel.innerHTML = '<div class="empty-hint">No forks yet</div>';
    return;
  }
  dom.sessionChildrenPanel.innerHTML = children
    .map((item) => {
      const active = currentSessionID() === item.id ? ' data-active="true"' : "";
      return `<button class="session-row-mini"${active} onclick="openManagedSession('${item.id}')">
        <strong>${escapeHtml(item.title || item.id)}</strong>
        <span>${stamp(item.time?.updated)}</span>
        <small>${escapeHtml(item.id)}</small>
      </button>`;
    })
    .join("");
}

async function createManagedSession() {
  try {
    await panelMessage("Create a new blank session and open it in the chat.", {
      ui_context: "session_manager",
    });
    await loadManagedSessions();
  } catch (e) {
    console.error("Failed to create session:", e);
    await nativeMessage("Failed to create session: " + e.message, {
      title: "Session",
      kind: "error",
    });
  }
}

async function forkManagedSession() {
  if (!state.managedSession?.id) return;
  try {
    await panelMessage(`Fork session ${state.managedSession.id} and open the fork in chat.`, {
      sessionID: state.managedSession.id,
      ui_context: "session_manager",
    });
    await loadManagedSessions();
  } catch (e) {
    console.error("Failed to fork session:", e);
    await nativeMessage("Failed to fork session: " + e.message, {
      title: "Session",
      kind: "error",
    });
  }
}

async function deleteManagedSession() {
  if (!state.managedSession?.id) return;
  const sessionID = state.managedSession.id;
  const accepted = await nativeConfirm(`Delete session ${state.managedSession.title || sessionID} and any bound tasks?`, {
    title: "Delete Session",
    okLabel: "Delete",
    kind: "warning",
  });
  if (!accepted) return;
  try {
    await deleteSessionApi(sessionID, { deleteTasks: true });
    if (state.chatSessionID === sessionID) state.chatSessionID = "";
    state.managedSession = null;
    state.managedChildren = [];
    await Promise.all([loadManagedSessions(), loadTasks()]);
    await loadConversation();
    renderManagedSessionMeta();
    renderManagedSessionChildren();
  } catch (e) {
    console.error("Failed to delete session:", e);
    await nativeMessage("Failed to delete session: " + e.message, {
      title: "Delete Session",
      kind: "error",
    });
  }
}

async function exportManagedSession() {
  if (!state.managedSession?.id) return;
  try {
    const result = await panelMessage(`Export session ${state.managedSession.id} as HTML.`, {
      sessionID: state.managedSession.id,
      ui_context: "session_manager",
    });
    if (result?.message) {
      await nativeMessage(result.message, {
        title: "Export Session",
        kind: "info",
      });
    }
  } catch (e) {
    console.error("Failed to export session:", e);
    await nativeMessage("Failed to export session: " + e.message, {
      title: "Export Session",
      kind: "error",
    });
  }
}

function transcriptRole(role) {
  if (role === "user") return "User";
  if (role === "assistant") return "Assistant";
  if (role === "system") return "System";
  return "Message";
}

function transcriptTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatTranscriptText(part, role) {
  let text = part?.text || "";
  if (!text.trim()) return "";
  if (part.audience && part.audience.ui === false) return "";
  if (part.kind === "trace" && !part.audience?.ui) return "";
  const orchestratorRoles = ["user", "planner", "scheduler", "system"];
  if (orchestratorRoles.includes(role) && text.includes("<assistant-brief>")) {
    text = stripAssistantBrief(text);
  }
  return text.trim();
}

function formatTranscriptTool(part) {
  const toolName = part?.tool || "unknown";
  const hiddenTools = ["planner", "todowrite", "todoupdate", "task_report"];
  if (hiddenTools.includes(toolName.toLowerCase())) return "";
  const st = part?.state || {};
  const detail = toolDetail(toolName, st.input || {}, st);
  const status = st.status || "pending";
  return [`[Tool:${status}] ${toolName}`, detail].filter(Boolean).join(" ");
}

function formatTranscriptPart(part, role) {
  if (!part || typeof part !== "object") return "";
  if (part.type === "text") return formatTranscriptText(part, role);
  if (part.type === "reasoning") return part.text?.trim() ? `[Reasoning]\n${part.text.trim()}` : "";
  if (part.type === "tool") return formatTranscriptTool(part);
  if (part.type === "file") return part.filename || part.url ? `[File] ${part.filename || part.url}` : "";
  if (part.type === "subtask") {
    const text = part.description || part.prompt || "";
    return text ? `[Subtask] ${text}` : "";
  }
  if (part.type === "patch") {
    const files = Array.isArray(part.files) ? part.files.filter(Boolean) : [];
    return files.length ? `[Patch] ${files.join(", ")}` : "[Patch]";
  }
  if (part.type === "compaction") return "[Compaction]";
  return "";
}

function formatSessionTranscript(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((item) => {
      const role = item?.info?.role || "assistant";
      const header = [transcriptRole(role), transcriptTime(item?.info?.time?.created)].filter(Boolean).join(" · ");
      const body = (Array.isArray(item?.parts) ? item.parts : [])
        .map((part) => formatTranscriptPart(part, role))
        .filter(Boolean)
        .join("\n\n")
        .trim();
      if (!body) return "";
      return `${header}\n${body}`;
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

async function copyManagedSessionDialogue() {
  if (!state.managedSession?.id) return;
  try {
    const messages = await apiJson(`session/${state.managedSession.id}/message`);
    const transcript = formatSessionTranscript(messages);
    if (!transcript) {
      await nativeMessage("Selected session has no dialogue content to copy.", {
        title: "Copy Dialogue",
        kind: "info",
      });
      return;
    }
    const ok = await copyText(transcript);
    if (!ok) throw new Error("Clipboard write failed");
    await nativeMessage("Session dialogue copied to clipboard.", {
      title: "Copy Dialogue",
      kind: "info",
    });
  } catch (e) {
    console.error("Failed to copy session dialogue:", e);
    await nativeMessage("Failed to copy session dialogue: " + e.message, {
      title: "Copy Dialogue",
      kind: "error",
    });
  }
}

async function openManagedSession(sessionID) {
  state.chatSessionID = sessionID;
  await loadConversation();
  renderManagedSessionList();
  renderManagedSessionMeta();
}

// ── Interactions ──

function renderInteractions(interactions) {
  const pending = interactions.filter((i) => i.status === "pending");
  const goalsBody = dom.goalsBody;

  // Remove existing alerts
  goalsBody.querySelectorAll(".interaction-alert").forEach((el) => el.remove());

  for (const interaction of pending) {
    const el = document.createElement("div");
    el.className = "interaction-alert";
    el.dataset.id = interaction.id;
    el.innerHTML = `
      <div class="interaction-title">${interaction.type === "permission" ? "\uD83D\uDD12" : "\u2753"} ${escapeHtml(interaction.title)}</div>
      <div class="interaction-body">${escapeHtml(interaction.body)}</div>
      <div class="interaction-actions">
        ${
          interaction.type === "permission"
            ? `<button class="btn btn-primary" data-action="once">Allow Once</button>
               <button class="btn btn-primary" data-action="always">Always Allow</button>
               <button class="btn btn-ghost" data-action="reject">Reject</button>`
            : `<button class="btn btn-primary" data-action="answer">Answer</button>
               <button class="btn btn-ghost" data-action="reject">Skip</button>`
        }
      </div>`;
    // Wire up buttons via addEventListener (safer than inline onclick)
    const iid = interaction.id;
    el.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.action;
        if (act === "reject") rejectInteraction(iid);
        else resolveInteraction(iid, act);
      });
    });
    goalsBody.appendChild(el);
  }
}

// ── Interaction Handlers ──

// Guard: while resolving an interaction, suppress board reloads to prevent
// the DOM from being rebuilt (which would remove the button the user clicked).
let _interactionBusy = false;

function disableInteractionButtons(id) {
  document.querySelectorAll(`.interaction-alert button`).forEach((btn) => {
    btn.disabled = true;
    btn.style.opacity = "0.5";
  });
  // Mark the specific interaction as processing
  const alert = document.querySelector(`.interaction-alert[data-id="${id}"]`);
  if (alert) {
    const title = alert.querySelector(".interaction-title");
    if (title) title.textContent += " (processing...)";
  }
}

async function resolveInteraction(id, action) {
  if (_interactionBusy) return;
  _interactionBusy = true;
  disableInteractionButtons(id);
  try {
    if (action === "once" || action === "always") {
      await panelMessage(`Reply to interaction ${id} with ${action}.`, {
        interactionID: id,
        reply: action,
        ui_context: "interaction",
      });
    } else {
      const answer = await nativePrompt("Enter your answer:", {
        title: "Interaction Reply",
        okLabel: "Submit",
        cancelLabel: "Cancel",
        inputLabel: "Answer",
      });
      if (answer == null) {
        // User cancelled the prompt
        _interactionBusy = false;
        await loadBoard();
        return;
      }
      await panelMessage(`Reply to interaction ${id} with the following answer:\n${answer}`, {
        interactionID: id,
        answer,
        ui_context: "interaction",
      });
    }
  } catch (e) {
    console.error("Failed to resolve interaction:", e);
    showInteractionError(id, e.message);
  } finally {
    _interactionBusy = false;
    await loadBoard();
  }
}

async function rejectInteraction(id) {
  if (_interactionBusy) return;
  _interactionBusy = true;
  disableInteractionButtons(id);
  try {
    await panelMessage(`Reject interaction ${id}.`, {
      interactionID: id,
      ui_context: "interaction",
    });
  } catch (e) {
    console.error("Failed to reject interaction:", e);
    showInteractionError(id, e.message);
  } finally {
    _interactionBusy = false;
    await loadBoard();
  }
}

function showInteractionError(id, msg) {
  const alert = document.querySelector(`.interaction-alert[data-id="${id}"]`);
  if (alert) {
    const title = alert.querySelector(".interaction-title");
    if (title) title.textContent = `Error: ${msg}`;
    // Re-enable buttons so user can retry
    alert.querySelectorAll("button").forEach((btn) => {
      btn.disabled = false;
      btn.style.opacity = "";
    });
  }
}

// ── Session Rendering ──
//
// The API returns one message per tool-call step, so a single user request
// may produce 30+ consecutive "assistant" messages.  We group consecutive
// messages of the same role into a single visual "turn" so the chat looks
// like a natural conversation:
//   [User turn]  → all consecutive user messages
//   [Assistant turn] → all consecutive assistant messages (tool calls, text, patches)
//

function detectSource(msg) {
  const parts = msg.parts || [];
  for (const part of parts) {
    if (part.type === "text" && part.source) return part.source;
  }
  return undefined;
}

function effectiveRole(msg) {
  const role = msg.info?.role || "assistant";
  if (role !== "user") return role;
  const source = detectSource(msg);
  if (source) return source;
  return role;
}

function groupMessagesByRole(sorted) {
  const groups = [];
  for (const msg of sorted) {
    const role = effectiveRole(msg);
    const parts = msg.parts || [];
    // Skip completely empty messages
    if (parts.length === 0) continue;

    // For assistant messages, each message is a separate step — don't merge them.
    // This preserves the step-by-step flow of agent execution.
    if (role === "assistant") {
      groups.push({ role, messages: [msg] });
      continue;
    }

    const last = groups[groups.length - 1];
    if (last && last.role === role) {
      last.messages.push(msg);
    } else {
      groups.push({ role, messages: [msg] });
    }
  }
  return groups;
}

// ── Board Context Messages ──
// Inject synthetic messages from the board data so the chat shows the full
// task lifecycle: user request, plan, goal updates, evaluation results.

function buildBoardContextMessages() {
  const board = state.board;
  if (!board) return [];
  const msgs = [];
  const { task, plan, evaluation, delivery, lanes, snapshots } = board;

  // 1. User request — show the original task request as a "user" turn
  if (task?.request) {
    msgs.push({
      _synthetic: true,
      info: { role: "user", time: { created: (task.time?.created || 0) - 2 } },
      parts: [{ type: "text", text: task.request }],
    });
  }

  // 2. Plan — show plan steps and full context
  if (plan) {
    const steps = plan.metadata?.steps || [];
    let planText = `**Plan v${plan.version}**`;
    if (steps.length > 0) {
      planText += "\n\n" + steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
    } else if (plan.summary && !plan.summary.endsWith("...")) {
      // Only use summary if not truncated
      planText += `: ${plan.summary}`;
    }
    msgs.push({
      _synthetic: true,
      info: { role: "planner", time: { created: plan.time?.created || (task?.time?.created || 0) - 1 } },
      parts: [{ type: "text", text: planText }],
    });
  }

  // 3. Goals — show goal status as a "goal_gate" turn
  const goalsLane = (lanes || []).find((l) => l.id === "goals");
  const goals = goalsLane?.cards || [];
  if (goals.length > 0) {
    const resolvedGoals = goals.filter((g) => g.status === "passed" || g.status === "failed");
    const goalLines = goals.map((g) => {
      const icon = g.status === "passed" ? "\u2705" : g.status === "failed" ? "\u274C" : "\u23F3";
      return `${icon} **${g.title}** — ${g.detail || g.status || "pending"}`;
    });
    const header = resolvedGoals.length > 0
      ? `**Goal Results** (${resolvedGoals.filter(g => g.status === "passed").length}/${goals.length} passed)`
      : `**Goals** (${goals.length})`;
    const goalTime = evaluation?.time?.created || task?.time?.updated || Date.now();
    msgs.push({
      _synthetic: true,
      info: { role: "goal_gate", time: { created: goalTime - 1 } },
      parts: [{ type: "text", text: `${header}\n\n${goalLines.join("\n")}` }],
    });
  }

  // 4. Evaluation verdict — show as "scheduler" turn
  if (evaluation?.verdict) {
    const verdictIcon = evaluation.verdict === "accepted" ? "\u2705" : "\u274C";
    let evalText = `${verdictIcon} **Evaluation: ${evaluation.verdict}**`;
    const checks = evaluation.checks || [];
    if (checks.length > 0) {
      const checkLines = checks.map((c) => {
        const ci = c.status === "passed" ? "\u2713" : c.status === "failed" ? "\u2717" : c.status === "skipped" ? "\u2014" : "\u2022";
        const checkName = c.kind || c.name || c.status;
        return `- ${ci} **${checkName}**: ${c.summary || c.status}`;
      });
      evalText += "\n\n" + checkLines.join("\n");
    }
    // Evaluation summary
    if (evaluation.summary) {
      evalText += "\n\n" + evaluation.summary;
    }
    // Goal evaluations
    const goalEvals = evaluation.goals || [];
    if (goalEvals.length > 0) {
      const gLines = goalEvals.map((g) => {
        const gi = g.status === "passed" ? "\u2705" : "\u274C";
        return `- ${gi} ${g.description || g.title}`;
      });
      evalText += "\n\n**Goals:**\n" + gLines.join("\n");
    }
    msgs.push({
      _synthetic: true,
      info: { role: "scheduler", time: { created: evaluation.time?.created || Date.now() } },
      parts: [{ type: "text", text: evalText }],
    });
  }

  // 5. Delivery summary — show as "assistant" turn if delivery was accepted
  const finalDelivery = board.acceptedDelivery || delivery;
  if (finalDelivery?.summary && finalDelivery.status !== "candidate") {
    msgs.push({
      _synthetic: true,
      info: { role: "assistant", time: { created: (finalDelivery.time?.created || Date.now()) + 1 } },
      parts: [{ type: "text", text: `**Delivery (${finalDelivery.status})**\n\n${finalDelivery.summary}` }],
    });
  }

  return msgs;
}

function renderSession() {
  const messages = state.session;
  const boardMsgs = buildBoardContextMessages();
  const hasSyntheticUser = boardMsgs.some((m) => m.info?.role === "user");

  // Filter out orchestrator-injected messages that duplicate synthetic ones.
  // The orchestrator injects user msgs with <assistant-brief> (for planner/scheduler sources)
  // which duplicate the synthetic user/plan/evaluation turns.
  let realMessages = messages || [];
  if (boardMsgs.length > 0 && realMessages.length > 0) {
    realMessages = realMessages.filter((m) => {
      const text = (m.parts || []).map((p) => p.text || "").join("");
      // Filter orchestrator-injected prompt messages (contain <assistant-brief>)
      if (text.includes("<assistant-brief>") || text.includes("You are executing a headless coding task")) {
        return false;
      }
      return true;
    });
  }

  const allMessages = [...realMessages, ...boardMsgs];
  if (allMessages.length === 0) {
    dom.chatScroll.innerHTML = '<div class="chat-empty">Conversation messages appear here</div>';
    dom.chatCount.textContent = "";
    state._renderedGroupKey = "";
    return;
  }

  // Sort by time
  const sorted = [...allMessages].sort(
    (a, b) => (a.info?.time?.created || 0) - (b.info?.time?.created || 0)
  );

  const groups = groupMessagesByRole(sorted);
  dom.chatCount.textContent = `${sorted.length} msgs`;

  const el = dom.chatScroll;
  const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;

  // Build a key that summarises the current groups for incremental detection
  const target = conversationTarget();
  const boardSuffix = state.board ? "|" + (state.board.task?.status || "") + ":" + (state.board.evaluation?.verdict || "") : "";
  const groupKey = target.key + ":" + groups.map((g) => g.role + ":" + g.messages.length).join(",") + boardSuffix;
  const sessionChanged = !state._renderedGroupKey || !state._renderedGroupKey.startsWith(target.key + ":");
  const sameStructure = state._renderedGroupKey === groupKey;

  if (sessionChanged) {
    // Full re-render (different session or first load)
    const frag = document.createDocumentFragment();
    for (const group of groups) {
      const node = renderTurn(group);
      if (node) frag.appendChild(node);
    }
    el.innerHTML = "";
    el.appendChild(frag);
  } else if (!sameStructure) {
    // Structure changed (new groups appeared) — re-render last group + append new
    const existingTurns = el.querySelectorAll(".turn");
    const prevCount = existingTurns.length;

    // Update the last existing turn (may still be streaming)
    if (prevCount > 0 && groups.length >= prevCount) {
      const updatedNode = renderTurn(groups[prevCount - 1]);
      if (updatedNode) existingTurns[prevCount - 1].replaceWith(updatedNode);
    }

    // Append new turns
    for (let i = prevCount; i < groups.length; i++) {
      const node = renderTurn(groups[i]);
      if (node) el.appendChild(node);
    }
  } else {
    // Same structure — only update the last turn (streaming)
    const existingTurns = el.querySelectorAll(".turn");
    if (existingTurns.length > 0) {
      const lastGroup = groups[groups.length - 1];
      const updatedNode = renderTurn(lastGroup);
      if (updatedNode) existingTurns[existingTurns.length - 1].replaceWith(updatedNode);
    }
  }

  state._renderedGroupKey = groupKey;

  if (wasAtBottom) {
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }
}

// Render a "turn" — one visual block for a consecutive run of same-role messages.
function renderTurn(group) {
  const { role, messages } = group;

  // Collect all parts from all messages in this turn
  let bodyHtml = "";
  for (const msg of messages) {
    for (const part of msg.parts || []) {
      bodyHtml += renderPart(part, role);
    }
  }

  if (!bodyHtml.trim()) return null;

  const el = document.createElement("article");
  el.className = "turn msg";
  el.dataset.role = role;

  const firstTime = messages[0]?.info?.time?.created;
  const lastTime = messages[messages.length - 1]?.info?.time?.created;
  const ROLE_LABELS = {
    user: "User",
    assistant: "Assistant",
    planner: "Plan",
    scheduler: "Evaluator",
    system: "System",
    goal_gate: "Goal",
    task_tool: "Task",
  };
  const roleLabel = ROLE_LABELS[role] || "Assistant";
  const timeStr = firstTime ? stamp(firstTime) : "";

  el.innerHTML = `
    <div class="msg-head">
      <span class="msg-role">${roleLabel}</span>
      <span class="msg-time">${timeStr}</span>
    </div>
    <div class="msg-body">${bodyHtml}</div>
  `;

  return el;
}

function renderPart(part, role) {
  switch (part.type) {
    case "text":
      return renderTextPart(part, role);
    case "tool":
      return renderToolPart(part);
    case "reasoning":
      return renderReasoningPart(part);
    case "patch":
      return renderPatchPart(part);
    case "step-start":
    case "step-finish":
      return ""; // hidden — internal step boundaries
    case "file":
      return renderFilePart(part);
    case "subtask":
      return `<div class="msg-tool"><span class="tool-icon">\u2192</span><span class="tool-name">Subtask</span><span class="tool-detail">${escapeHtml(part.description || part.prompt || "")}</span></div>`;
    case "compaction":
      return '<div class="msg-step">Context compacted</div>';
    default:
      return "";
  }
}

function renderFilePart(part) {
  const url = part.url || part.filename || "";
  const name = part.filename || url || "file";
  const isImg = (part.mediaType && part.mediaType.startsWith("image/")) ||
    /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?|$)/i.test(url);
  if (isImg && url) {
    return `<div class="msg-img-wrap"><img class="md-img" src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy"></div>`;
  }
  return `<div class="msg-text" style="font-family:var(--mono);font-size:11px;color:var(--text-soft)">${escapeHtml(name)}</div>`;
}

function renderTextPart(part, role) {
  let text = part.text || "";
  if (!text.trim()) return "";

  // Skip system/scheduler messages that are not for UI
  if (part.audience && part.audience.ui === false) return "";
  if (part.kind === "trace" && !part.audience?.ui) return "";

  // Strip <assistant-brief> orchestrator blocks from orchestrator-injected user messages
  const orchestratorRoles = ["user", "planner", "scheduler", "system"];
  if (orchestratorRoles.includes(role) && text.includes("<assistant-brief>")) {
    text = stripAssistantBrief(text);
    if (!text.trim()) return "";
  }

  return `<div class="msg-text">${renderMarkdown(text)}</div>`;
}

/** Strip orchestrator-injected <assistant-brief> block and boilerplate from user messages.
 *  Extracts only the "Request:" field value as the actual user content. */
function stripAssistantBrief(text) {
  // Remove <assistant-brief>...</assistant-brief> block
  const briefRe = /<assistant-brief>[\s\S]*?<\/assistant-brief>/;
  let cleaned = text.replace(briefRe, "");

  // Remove orchestrator instruction lines that follow the brief
  cleaned = cleaned
    .replace(/Use the brief above to align your work before executing the task\.\s*/g, "")
    .replace(/You are executing a headless coding task[^\n]*\n?/g, "")
    .replace(/^Task:\s*[^\n]*\n?/gm, "")
    .replace(/^Goals:\n(?:- [^\n]*\n?)*/gm, "")
    .replace(/^Request:\s*\n?/gm, "");

  return cleaned.trim();
}

// ── Lightweight Markdown Renderer ──

function renderMarkdown(text) {
  // Split by fenced code blocks
  const segments = text.split(/(```[\s\S]*?```)/g);
  let html = "";
  for (const seg of segments) {
    if (seg.startsWith("```")) {
      const match = seg.match(/^```(\w*)\n?([\s\S]*?)```$/);
      const code = match ? match[2] : seg.slice(3, -3);
      html += `<pre class="md-code-block"><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`;
    } else {
      html += renderMarkdownBlock(seg);
    }
  }
  return html;
}

function renderMarkdownBlock(text) {
  const lines = text.split("\n");
  let html = "";
  let inList = false;
  let listTag = "ul";

  for (const line of lines) {
    const trimmed = line.trim();

    // Headers
    const hMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      if (inList) { html += `</${listTag}>`; inList = false; }
      const level = hMatch[1].length;
      html += `<div class="md-h${level}">${inlineMarkdown(hMatch[2])}</div>`;
      continue;
    }

    // Unordered list
    if (/^[-*]\s/.test(trimmed)) {
      if (!inList || listTag !== "ul") {
        if (inList) html += `</${listTag}>`;
        html += '<ul class="md-list">';
        inList = true;
        listTag = "ul";
      }
      html += `<li>${inlineMarkdown(trimmed.slice(2))}</li>`;
      continue;
    }

    // Ordered list
    const olMatch = trimmed.match(/^(\d+)\.\s(.+)$/);
    if (olMatch) {
      if (!inList || listTag !== "ol") {
        if (inList) html += `</${listTag}>`;
        html += '<ol class="md-list">';
        inList = true;
        listTag = "ol";
      }
      html += `<li>${inlineMarkdown(olMatch[2])}</li>`;
      continue;
    }

    // End list on blank line or non-list content
    if (inList) { html += `</${listTag}>`; inList = false; }

    // Blank line
    if (!trimmed) {
      html += '<div class="md-break"></div>';
      continue;
    }

    // Regular paragraph
    html += `<div class="md-p">${inlineMarkdown(trimmed)}</div>`;
  }

  if (inList) html += `</${listTag}>`;
  return html;
}

function inlineMarkdown(text) {
  let s = escapeHtml(text);
  // Images: ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img class="md-img" src="$2" alt="$1" loading="lazy">');
  // Links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noopener">$1</a>');
  // Bold: **text**
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic: *text*
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  // Inline code: `code`
  s = s.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
  return s;
}

function renderToolPart(part) {
  const toolName = part.tool || "unknown";
  const st = part.state || {};
  const status = st.status || "pending";
  const input = st.input || {};

  // Hide internal orchestrator tool calls that are noise for the user.
  // - planner (add_task, update_task): internal task tracking shown in board
  // - todowrite/todoupdate: internal todo tracking
  // - task_report: orchestrator completion signal shown in delivery
  const hiddenTools = ["planner", "todowrite", "todoupdate", "task_report"];
  if (hiddenTools.includes(toolName.toLowerCase())) return "";

  const detail = toolDetail(toolName, input, st);
  const statusIcon = status === "completed" ? "\u2713" : status === "running" ? "\u25B6" : status === "error" ? "\u2717" : "\u2022";
  const icon = toolIcon(toolName);

  let html = `<div class="msg-tool">
    <span class="tool-icon">${icon}</span>
    <span class="tool-name">${escapeHtml(toolName)}</span>
    <span class="tool-detail">${escapeHtml(detail)}</span>
    <span class="tool-status" data-status="${status}">${statusIcon}</span>
  </div>`;

  // Show tool output if available (truncated for readability)
  const output = st.output || "";
  if (output && status === "completed") {
    const maxLen = 500;
    const truncated = output.length > maxLen ? output.slice(0, maxLen) + "\n... (" + output.length + " chars)" : output;
    html += `<div class="msg-tool-output" onclick="this.classList.toggle('expanded')">${escapeHtml(truncated)}</div>`;
  }
  // Show error output
  if (status === "error" && output) {
    const maxLen = 300;
    const truncated = output.length > maxLen ? output.slice(0, maxLen) + "..." : output;
    html += `<div class="msg-tool-error">${escapeHtml(truncated)}</div>`;
  }

  return html;
}

function toolIcon(name) {
  const n = name.toLowerCase();
  if (n === "read" || n === "readfile") return "\uD83D\uDCC4";       // 📄
  if (n === "edit" || n === "editfile") return "\u270F\uFE0F";       // ✏️
  if (n === "write" || n === "writefile") return "\uD83D\uDCDD";     // 📝
  if (n === "bash") return "\uD83D\uDCBB";                           // 💻
  if (n === "grep") return "\uD83D\uDD0D";                           // 🔍
  if (n === "glob") return "\uD83D\uDCC2";                           // 📂
  if (n === "agent") return "\uD83E\uDD16";                          // 🤖
  if (n === "todowrite" || n === "todoupdate") return "\u2611\uFE0F"; // ☑️
  return "\u26A1";                                                    // ⚡
}

function toolDetail(name, input, state) {
  const n = name.toLowerCase();
  if (n === "read" || n === "readfile") return shortPath(input.file_path || input.filePath || input.path || "");
  if (n === "edit" || n === "editfile") return shortPath(input.file_path || input.filePath || input.path || "");
  if (n === "write" || n === "writefile") return shortPath(input.file_path || input.filePath || input.path || "");
  if (n === "bash") {
    const cmd = input.command || "";
    return cmd.length > 80 ? cmd.slice(0, 80) + "..." : cmd;
  }
  if (n === "grep") return input.pattern || "";
  if (n === "glob") return input.pattern || "";
  if (n === "agent") return (input.description || "").slice(0, 80);
  if (state.status === "completed" && state.title) return state.title;
  return "";
}

function shortPath(p) {
  // Show only last 2-3 path segments for readability
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.length > 3 ? ".../" + parts.slice(-3).join("/") : p;
}

function renderReasoningPart(part) {
  const text = part.text || "";
  if (!text.trim()) return "";
  // Show first 600 chars collapsed, full text on click
  const preview = text.length > 600 ? text.slice(0, 600) + "..." : text;
  return `<div class="msg-reasoning collapsed" onclick="this.classList.toggle('collapsed')">
    <span class="reasoning-preview">\uD83D\uDCAD ${escapeHtml(preview)}</span>
    <span class="reasoning-full">\uD83D\uDCAD ${escapeHtml(text)}</span>
  </div>`;
}

function renderPatchPart(part) {
  const files = part.files || [];
  if (files.length === 0) return "";
  const display = files.map((f) => shortPath(f)).join(", ");
  return `<div class="msg-patch">\u2699 ${escapeHtml(display)}</div>`;
}

// ── Render Clear ──

function renderClear() {
  renderMeta();
  $("#overviewBadge").textContent = "";
  $("#overviewBody").innerHTML = '<p class="empty-hint">Select a task to view overview</p>';
  state.changes = [];
  state.changeKey = "";
  renderChanges();
  dom.planBadge.textContent = "";
  dom.planBody.innerHTML = '<p class="empty-hint">No plan yet</p>';
  dom.goalsBadge.textContent = "";
  dom.goalsBody.innerHTML = '<p class="empty-hint">No goals defined</p>';
  if (dom.criteriaBadge) { dom.criteriaBadge.textContent = ""; delete dom.criteriaBadge.dataset.tone; }
  if (dom.evalBody) dom.evalBody.innerHTML = '<p class="empty-hint">No evaluation results</p>';
  dom.chatScroll.innerHTML = '<div class="chat-empty">Conversation messages appear here</div>';
  dom.chatCount.textContent = "";
  dom.elapsed.textContent = "";
  state._renderedGroupKey = "";
  renderExecutor();
}

function sizeChat() {
  dom.chatTextarea.style.height = "auto";
  const h = Math.min(dom.chatTextarea.scrollHeight, 180);
  dom.chatTextarea.style.height = `${Math.max(h, 72)}px`;
}

// ── Chat Input ──

dom.chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = dom.chatTextarea.value.trim();
  if (!text) return;

  dom.chatSend.disabled = true;
  try {
    await panelMessage(text);
    dom.chatTextarea.value = "";
    sizeChat();
  } catch (e) {
    console.error("Failed to send message:", e);
  } finally {
    dom.chatSend.disabled = false;
  }
});

// Enter to send, Shift+Enter for newline
dom.chatTextarea.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    dom.chatForm.requestSubmit();
  }
});

dom.chatTextarea.addEventListener("input", sizeChat);
sizeChat();

// ── Task Select ──

dom.taskSelect.addEventListener("change", () => {
  selectTask(dom.taskSelect.value);
});

dom.criteriaList?.addEventListener("change", async () => {
  if (!state.selectedTaskID) return;
  try {
    await panelMessage("Update the current task acceptance checks to match the selected criteria.", {
      taskID: state.selectedTaskID,
      selection: buildCheckSelection(),
      ui_context: "criteria",
    });
    await loadBoard();
  } catch (e) {
    console.error("Failed to update task checks:", e);
  }
});

dom.changesBody?.addEventListener("click", (e) => {
  const target = eventClosest(e, "[data-change-index]");
  if (!target) return;
  openDiffDialog(Number(target.dataset.changeIndex));
});

dom.btnManageTaskSession.addEventListener("click", async () => {
  const sessionID = currentTaskSessionID();
  if (!sessionID) return;
  dom.sessionsDialog.showModal();
  await loadManagedSessions();
  await selectManagedSession(sessionID);
});

dom.btnDeleteTaskSession.addEventListener("click", async () => {
  const sessionID = currentTaskSessionID();
  const taskID = state.selectedTaskID;
  if (!sessionID || !taskID) return;
  const accepted = await nativeDeleteTaskSessionConfirm(taskID, sessionID);
  if (!accepted) return;
  try {
    await deleteSessionApi(sessionID, { deleteTasks: true });
    if (state.chatSessionID === sessionID) state.chatSessionID = "";
    if (state.managedSession?.id === sessionID) {
      state.managedSession = null;
      state.managedChildren = [];
    }
    await loadTasks();
    await loadConversation();
    renderManagedSessionMeta();
    renderManagedSessionChildren();
  } catch (e) {
    console.error("Failed to delete task session:", e);
    await nativeMessage("Failed to delete task session: " + e.message, {
      title: "Delete Task Session",
      kind: "error",
    });
  }
});

dom.engineBar.addEventListener("click", async (event) => {
  const button = eventClosest(event, "[data-executor]");
  if (!button || button.disabled) return;
  const executor = button.dataset.executor || "opencode";
  state.executor = executor;
  renderExecutor();
  await persistOverlaySettings();
});

dom.btnCloseSessions.addEventListener("click", () => {
  dom.sessionsDialog.close();
});

dom.btnRefreshSessions.addEventListener("click", () => loadManagedSessions());
dom.btnCreateSession.addEventListener("click", () => createManagedSession());
dom.btnUseTaskSession.addEventListener("click", async () => {
  state.chatSessionID = "";
  await loadConversation();
  renderManagedSessionList();
  renderManagedSessionMeta();
});
dom.btnOpenSession.addEventListener("click", async () => {
  if (!state.managedSession?.id) return;
  await openManagedSession(state.managedSession.id);
});
dom.btnForkSession.addEventListener("click", () => forkManagedSession());
dom.btnCopySession.addEventListener("click", () => copyManagedSessionDialogue());
dom.btnExportSession.addEventListener("click", () => exportManagedSession());
dom.btnDeleteSession.addEventListener("click", () => deleteManagedSession());

dom.btnAddSkill.addEventListener("click", () => {
  dom.skillForm.reset();
  dom.skillType.value = "path";
  if (dom.skillPolicy) dom.skillPolicy.value = "ask";
  dom.skillDialog.showModal();
});
dom.btnSkillMarket?.addEventListener("click", () => {
  loadSkillMarket();
});
dom.btnOpenSkillRoot?.addEventListener("click", async () => {
  try {
    const dirs = await apiJson("skill/directories");
    const target = dirs?.global_config || dirs?.managed_skills;
    if (!target) return;
    const opened = await nativeOpen(target);
    if (!opened) throw new Error("Unable to open skill directory");
  } catch (e) {
    console.error("Failed to open skill directory:", e);
    await nativeMessage("Failed to open skill directory: " + e.message, {
      title: "Skills",
      kind: "error",
    });
  }
});
dom.btnReloadSkills?.addEventListener("click", async () => {
  await loadExtensions();
});
dom.btnAddMcp.addEventListener("click", () => {
  dom.mcpForm.reset();
  dom.mcpType.value = "remote";
  toggleMcpFields();
  dom.mcpDialog.showModal();
});
dom.btnPickSkillPath?.addEventListener("click", async () => {
  const selected = await pickDirectory();
  if (selected) dom.skillValue.value = selected;
});
dom.btnCancelSkill.addEventListener("click", () => dom.skillDialog.close());
dom.btnCancelMcp.addEventListener("click", () => dom.mcpDialog.close());
dom.btnCloseSkillMarket?.addEventListener("click", () => dom.skillMarketDialog?.close());
dom.btnCloseDiff?.addEventListener("click", () => dom.diffDialog?.close());
dom.mcpType.addEventListener("change", toggleMcpFields);
dom.skillMarketList?.addEventListener("click", async (event) => {
  const install = eventClosest(event, "[data-market-install]");
  if (install) {
    const entry = state.skillMarket.find((item) => item.id === install.dataset.marketInstall);
    if (!entry?.source || entry.install_kind === "manual") return;
    try {
      await installSkill(entry.install_kind, entry.source, entry.recommended_policy);
      await loadExtensions();
      dom.skillMarketDialog?.close();
    } catch (e) {
      console.error("Failed to install market skill:", e);
      await nativeMessage("Failed to install market skill: " + e.message, {
        title: "Skill Market",
        kind: "error",
      });
    }
    return;
  }

  const homepage = eventClosest(event, "[data-market-homepage]");
  if (!homepage) return;
  const opened = await nativeOpen(homepage.dataset.marketHomepage);
  if (!opened) {
    await nativeMessage(homepage.dataset.marketHomepage, {
      title: "Skill Market",
      kind: "info",
    });
  }
});
dom.skillList?.addEventListener("click", async (event) => {
  const button = eventClosest(event, "[data-skill-open]");
  if (!button) return;
  try {
    const opened = await nativeOpen(button.dataset.skillOpen);
    if (!opened) throw new Error("Unable to open skill directory");
  } catch (e) {
    console.error("Failed to open skill:", e);
    await nativeMessage("Failed to open skill directory: " + e.message, {
      title: "Skills",
      kind: "error",
    });
  }
});

window.openManagedSession = openManagedSession;

window.selectManagedSessionById = async function (id) {
  await selectManagedSession(id);
};

dom.btnCancelGoal.addEventListener("click", () => {
  dom.goalDialog.close();
});

dom.goalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.selectedTaskID) return;
  const goalID = dom.goalId.value.trim();
  const description = dom.goalDescription.value.trim();
  const criteria = dom.goalCriteria.value.trim();
  if (!description) return;

  try {
    if (goalID) {
      await panelMessage(`Update goal ${goalID}.`, {
        goalID,
        description,
        criteria: criteria || "The requested change is implemented and acceptance checks pass.",
        taskID: state.selectedTaskID || undefined,
        ui_context: "goal_editor",
      });
    } else {
      const payload = criteria ? `/goal ${description}\nCriteria: ${criteria}` : `/goal ${description}`;
      await panelMessage(payload, {
        taskID: state.selectedTaskID || undefined,
        ui_context: "goal_editor",
      });
    }
    dom.goalDialog.close();
    await loadBoard();
  } catch (e) {
    console.error("Failed to save goal:", e);
    await nativeMessage("Failed to save goal: " + e.message, {
      title: "Goal",
      kind: "error",
    });
  }
});

dom.skillForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = dom.skillValue.value.trim();
  if (!value) return;

  try {
    await installSkill(dom.skillType.value, value, dom.skillPolicy?.value || "ask");
    dom.skillDialog.close();
    await loadExtensions();
  } catch (e) {
    console.error("Failed to add skill:", e);
    await nativeMessage("Failed to add skill: " + e.message, {
      title: "Skills",
      kind: "error",
    });
  }
});

dom.mcpForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = dom.mcpName.value.trim();
  if (!name) return;

  const config =
    dom.mcpType.value === "local"
      ? {
          type: "local",
          command: [dom.mcpCommand.value.trim(), ...shellSplit(dom.mcpArgs.value.trim())].filter(Boolean),
          enabled: true,
        }
      : {
          type: "remote",
          url: dom.mcpUrl.value.trim(),
          enabled: true,
        };

  if (config.type === "local" && config.command.length === 0) return;
  if (config.type === "remote" && !config.url) return;

  try {
    await updateConfig((current) => {
      current.mcp = current.mcp || {};
      current.mcp[name] = config;
    });
    await apiJson("mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, config }),
    });
    dom.mcpDialog.close();
    await loadExtensions();
  } catch (e) {
    console.error("Failed to add MCP server:", e);
    await nativeMessage("Failed to add MCP server: " + e.message, {
      title: "MCP",
      kind: "error",
    });
  }
});

// ── Settings ──

async function openLlmSettings() {
  await loadConfigInfo();
  populateProviderSelect(state.config, state.providerCatalog);
  dom.llmDialog.showModal();
}

async function openChannelSettings(channelID) {
  await loadConfigInfo();
  const target = channelID || state.channels[0]?.id;
  if (!target) return;
  renderChannelFields(target);
  dom.channelDialog.showModal();
}

function openServerSettings() {
  dom.serverUrl.value = state.serverUrl;
  dom.serverPassword.value = state.password;
  dom.serverUsername.value = state.username;
  dom.themeMode.value = sanitizeTheme(state.theme);
  renderSettingsPaths();
  dom.settingsDialog.showModal();
}

dom.btnTheme?.addEventListener("click", async () => {
  state.theme = resolvedTheme() === "light" ? "dark" : "light";
  renderTheme();
  await persistOverlaySettings();
});

$("#btnSettings").addEventListener("click", () => {
  openServerSettings();
});

dom.btnOpenConfig?.addEventListener("click", () => {
  openLlmSettings();
});

dom.channelList?.addEventListener("click", (event) => {
  const button = eventClosest(event, "[data-channel-edit]");
  if (!button) return;
  openChannelSettings(button.dataset.channelEdit);
});

dom.llmProvider?.addEventListener("change", () => {
  populateModelSelect(state.config, state.providerCatalog);
});

dom.btnTestProvider?.addEventListener("click", async () => {
  const providerID = dom.llmProvider.value;
  const modelID = dom.llmModel.value;
  if (!providerID || !modelID) return;
  dom.btnTestProvider.disabled = true;
  dom.llmStatus.textContent = "Testing...";
  dom.llmStatus.dataset.status = "warn";
  dom.llmHint.textContent = `Testing ${providerID}/${modelID}...`;
  try {
    const result = await apiJson(`provider/${providerID}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelID }),
    });
    state.providerTest = result;
    dom.llmStatus.textContent = result.ok ? "Connected" : "Error";
    dom.llmStatus.dataset.status = result.ok ? "active" : "error";
    dom.llmHint.textContent = result.message;
  } catch (e) {
    dom.llmStatus.textContent = "Error";
    dom.llmStatus.dataset.status = "error";
    dom.llmHint.textContent = e.message;
  } finally {
    dom.btnTestProvider.disabled = false;
  }
});

dom.btnCancelLlm?.addEventListener("click", () => {
  dom.llmDialog.close();
});

dom.btnCancelChannel?.addEventListener("click", () => {
  dom.channelDialog.close();
});

$("#btnCancelSettings").addEventListener("click", () => {
  dom.settingsDialog.close();
});

dom.llmForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(dom.llmForm);
  try {
    const config = await apiJson("config");
    const providerID = fd.get("llmProvider")?.toString().trim() || "";
    const modelID = fd.get("llmModel")?.toString().trim() || "";
    const apiKey = fd.get("llmApiKey")?.toString().trim() || "";
    if (providerID && modelID) {
      config.model = `${providerID}/${modelID}`;
    }
    config.provider = config.provider || {};
    if (providerID) {
      const current = config.provider[providerID] || {};
      current.options = current.options || {};
      if (apiKey) current.options.apiKey = apiKey;
      if (!apiKey) delete current.options.apiKey;
      config.provider[providerID] = current;
    }
    await apiJson("config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    dom.llmDialog.close();
    const ok = await checkConnection();
    if (ok) {
      await Promise.all([loadTasks(), loadMeta(), loadExtensions(), loadConfigInfo(), loadExecutors()]);
      renderProviderStatus(providerID, config);
    }
  } catch (e) {
    console.error("Failed to save LLM settings:", e);
    await nativeMessage("Failed to save LLM settings: " + e.message, {
      title: "LLM",
      kind: "error",
    });
  }
});

dom.channelForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(dom.channelForm);
  try {
    const config = await apiJson("config");
    const channelID = fd.get("channelId")?.toString().trim() || "";
    const entry = state.channels.find((item) => item.id === channelID);
    if (!entry) throw new Error("Channel definition not found");
    config.channel = config.channel || {};
    const next = {};
    for (const field of entry.fields) {
      const name = `channel_${channelID}_${field.key}`;
      if (field.type === "boolean") {
        next[field.key] = fd.get(name) === "on";
        continue;
      }
      const value = fd.get(name)?.toString().trim() || "";
      if (value) next[field.key] = value;
    }
    config.channel[channelID] = next;
    await apiJson("config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    dom.channelDialog.close();
    const ok = await checkConnection();
    if (ok) {
      await Promise.all([loadTasks(), loadMeta(), loadExtensions(), loadConfigInfo(), loadExecutors()]);
    }
  } catch (e) {
    console.error("Failed to save channel settings:", e);
    await nativeMessage("Failed to save channel settings: " + e.message, {
      title: "Channel",
      kind: "error",
    });
  }
});

dom.settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(dom.settingsForm);
  state.serverUrl = fd.get("serverUrl")?.toString().trim() || DEFAULT_SERVER;
  state.password = fd.get("password")?.toString() || "";
  state.username = fd.get("username")?.toString().trim() || "opencorvus";
  state.theme = sanitizeTheme(fd.get("themeMode")?.toString().trim());
  renderTheme();
  await persistOverlaySettings();
  dom.settingsDialog.close();
  const ok = await checkConnection();
  if (ok) {
    await Promise.all([loadTasks(), loadMeta(), loadExtensions(), loadConfigInfo(), loadExecutors()]);
  }
});

// ── Window Controls (Tauri) ──

async function setupTauri() {
  const win = await currentTauriWindow();
  if (!win) return;

  $("#btnMinimize")?.addEventListener("click", () => win.minimize());
  $("#btnClose")?.addEventListener("click", () => win.close());

  // Always-on-top pin toggle
  const btnPin = $("#btnPin");
  if (btnPin) {
    const syncPin = async () => {
      const pinned = await win.isAlwaysOnTop().catch(() => false);
      btnPin.dataset.pinned = String(pinned);
      state.alwaysOnTop = pinned;
      await persistOverlaySettings();
    };

    await win.setAlwaysOnTop(state.alwaysOnTop).catch(() => undefined);
    await syncPin();

    btnPin.addEventListener("click", async () => {
      const current = btnPin.dataset.pinned === "true";
      const next = !current;
      await win.setAlwaysOnTop(next).catch(() => undefined);
      await syncPin();
    });
  }
}

async function currentTauriWindow() {
  const globalGetCurrentWindow = window.__TAURI__?.window?.getCurrentWindow;
  if (typeof globalGetCurrentWindow === "function") {
    try {
      return globalGetCurrentWindow();
    } catch {}
  }
  try {
    const mod = await import("@tauri-apps/api/window");
    if (typeof mod.getCurrentWindow === "function") {
      return mod.getCurrentWindow();
    }
  } catch {}
  return null;
}

// ── Utilities ──

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function jsonAttr(value) {
  return JSON.stringify(String(value ?? ""));
}

function eventClosest(event, selector) {
  const target = event?.target;
  if (target instanceof Element) return target.closest(selector);
  const parent = target?.parentElement;
  if (parent instanceof Element) return parent.closest(selector);
  return null;
}

function setupDialogBackdropClose() {
  $$("dialog.dialog").forEach((dialog) => {
    if (dialog.dataset.backdropClose === "true") return;
    dialog.dataset.backdropClose = "true";
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      dialog.close();
    });
  });
}

// ── Init ──

toggleMcpFields();
setupDialogBackdropClose();

// ── Config Area ──

const configBody = $("#configBody");
const btnConfigToggle = $("#btnConfigToggle");

if (btnConfigToggle && configBody) {
  btnConfigToggle.classList.toggle("active", configBody.dataset.open === "true");
  btnConfigToggle.addEventListener("click", () => {
    const isOpen = configBody.dataset.open === "true";
    configBody.dataset.open = String(!isOpen);
    btnConfigToggle.classList.toggle("active", !isOpen);
  });
}

async function loadConfigInfo() {
  try {
    const [config, catalog, auth, channels] = await Promise.all([
      apiJson("config"),
      apiJson("provider"),
      apiJson("provider/auth"),
      apiJson("channel"),
    ]);
    state.config = config;
    state.providerCatalog = catalog;
    state.providerAuth = auth;
    state.channels = Array.isArray(channels) ? channels : [];

    // LLM info: model field is "provider/model-name"
    const modelStr = config?.model || "";
    const cfgProvider = $("#cfgProvider");
    const cfgModel = $("#cfgModel");
    const cfgKey = $("#cfgKey");
    if (modelStr && modelStr.includes("/")) {
      const [prov, ...rest] = modelStr.split("/");
      if (cfgProvider) cfgProvider.textContent = prov;
      if (cfgModel) cfgModel.textContent = rest.join("/");
      if (cfgKey) {
        const hasKey = !!config?.provider?.[prov]?.options?.apiKey;
        cfgKey.textContent = hasKey ? "Configured" : "Not set";
        cfgKey.dataset.status = hasKey ? "ready" : "";
      }
      renderProviderStatus(prov, config);
    } else {
      if (cfgProvider) cfgProvider.textContent = modelStr || "—";
      if (cfgModel) cfgModel.textContent = "—";
      if (cfgKey) {
        cfgKey.textContent = "Not set";
        cfgKey.dataset.status = "";
      }
      if (dom.cfgProviderStatus) {
        dom.cfgProviderStatus.textContent = "Unknown";
        dom.cfgProviderStatus.dataset.status = "";
      }
    }
    if (dom.cfgAvailableProviders) {
      const total = Array.isArray(catalog?.all) ? catalog.all.length : 0;
      const connected = Array.isArray(catalog?.connected) ? catalog.connected.length : 0;
      dom.cfgAvailableProviders.textContent = `${total} providers · ${connected} connected`;
    }

    renderChannels();
  } catch {}
}

async function init() {
  await loadOverlaySettings();
  renderTheme();
  renderVersions();
  await setupTauri();
  renderExecutor();
  const ok = await checkConnection();
  if (ok) {
    await Promise.all([loadTasks(), loadMeta(), loadExtensions(), loadConfigInfo(), loadExecutors()]);
  } else {
    renderMeta();
    renderExtensions();
  }
  // Retry connection periodically
  setInterval(async () => {
    if (!state.connected) {
      const ok = await checkConnection();
      if (ok) {
        await Promise.all([loadTasks(), loadMeta(), loadExtensions(), loadConfigInfo(), loadExecutors()]);
        if (state.selectedTaskID) selectTask(state.selectedTaskID);
      }
    }
  }, 10000);
}

init();

if (systemThemeMedia) {
  const onThemeChange = () => {
    if (state.theme !== "system") return;
    renderTheme();
  };
  if (typeof systemThemeMedia.addEventListener === "function") {
    systemThemeMedia.addEventListener("change", onThemeChange);
  } else if (typeof systemThemeMedia.addListener === "function") {
    systemThemeMedia.addListener(onThemeChange);
  }
}
