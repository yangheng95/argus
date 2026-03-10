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
const SSE_BACKSTOP = 15000;
const BOARD_EVENT_DEBOUNCE = 150;
const SESSION_EVENT_DEBOUNCE = 150;
const ZOOM_STEP = 0.1;
const MIN_UI_ZOOM = 0.8;
const MAX_UI_ZOOM = 1.6;
const SUPPORTED_LOCALES = ["zh-CN", "en-US"];
const DEFAULT_LOCALE = sanitizeLocale(
  typeof document !== "undefined"
    ? document.documentElement.lang
    : typeof navigator !== "undefined"
      ? navigator.language
      : "zh-CN",
);
const DEFAULT_OVERLAY_SETTINGS = {
  serverUrl: DEFAULT_SERVER,
  password: "",
  username: "opencorvus",
  executor: "opencode",
  initGit: true,
  alwaysOnTop: false,
  sidebarCollapsed: false,
  sidebarWidth: null,
  sectionsWidth: null,
  zoom: 1,
  theme: "dark",
  locale: DEFAULT_LOCALE,
  directory: "",
};
const OVERLAY_VERSION = "0.0.1-alpha";
const OVERLAY_AUTHOR_URL = "https://github.com/yangheng95";
const OPENCLAW_DOCS = Object.freeze({
  overview: "https://docs.openclaw.ai/channels",
  credit: "OpenClaw Docs",
  slack: "https://docs.openclaw.ai/channels/slack",
  telegram: "https://docs.openclaw.ai/channels/telegram",
  discord: "https://docs.openclaw.ai/channels/discord",
  feishu: "https://docs.openclaw.ai/channels/feishu",
  whatsapp: "https://docs.openclaw.ai/channels/whatsapp",
  googlechat: "https://docs.openclaw.ai/channels/googlechat",
  msteams: "https://docs.openclaw.ai/channels/msteams",
  line: "https://docs.openclaw.ai/channels/line",
  matrix: "https://docs.openclaw.ai/channels/matrix",
  mattermost: "https://docs.openclaw.ai/channels/mattermost",
  signal: "https://docs.openclaw.ai/channels/signal",
  wecom: "https://docs.openclaw.ai/channels",
  dingtalk: "https://docs.openclaw.ai/channels",
});

// ── State ──

const state = {
  serverUrl: DEFAULT_OVERLAY_SETTINGS.serverUrl,
  password: DEFAULT_OVERLAY_SETTINGS.password,
  username: DEFAULT_OVERLAY_SETTINGS.username,
  executor: DEFAULT_OVERLAY_SETTINGS.executor,
  initGit: DEFAULT_OVERLAY_SETTINGS.initGit,
  alwaysOnTop: DEFAULT_OVERLAY_SETTINGS.alwaysOnTop,
  sidebarCollapsed: DEFAULT_OVERLAY_SETTINGS.sidebarCollapsed,
  sidebarWidth: DEFAULT_OVERLAY_SETTINGS.sidebarWidth,
  sectionsWidth: DEFAULT_OVERLAY_SETTINGS.sectionsWidth,
  zoom: DEFAULT_OVERLAY_SETTINGS.zoom,
  theme: DEFAULT_OVERLAY_SETTINGS.theme,
  locale: DEFAULT_OVERLAY_SETTINGS.locale,
  directory: DEFAULT_OVERLAY_SETTINGS.directory,
  localeSeq: 0,
  i18n: {},
  i18nReady: false,
  coreVersion: "",
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
  boardEtag: "",
  boardLoading: null,
  boardQueued: false,
  boardKick: null,
  boardUpdatedAt: 0,
  chatSessionID: "",
  sessions: [],
  managedSession: null,
  session: [],
  sessionLoading: null,
  sessionQueued: false,
  sessionKick: null,
  sessionUpdatedAt: 0,
  changes: [],
  sse: null,
  sseConnected: false,
  pollTimer: null,
  sessionTimer: null,
  elapsedTimer: null,
  changeKey: "",
  _renderedGroupKey: "",
  memoryFiles: [],
  memorySearchMode: false,
  preferences: [],
  criteriaSpecs: [],
  sectionDetail: "",
};

// ── DOM Refs ──

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  titlebar: $("#titlebar"),
  connBadge: $("#connBadge"),
  brandVersion: $("#brandVersion"),
  chatVersion: $("#chatVersion"),
  chatAuthor: $("#chatAuthor"),
  btnLocale: $("#btnLocale"),
  btnLocaleLabel: $("#btnLocaleLabel"),
  btnTheme: $("#btnTheme"),
  panelBody: $("#panelBody"),
  sidebar: $("#sidebar"),
  btnSidebarToggle: $("#btnSidebarToggle"),
  leftPaneResizer: $("#leftPaneResizer"),
  workspaceMain: $("#workspaceMain"),
  rightPaneResizer: $("#rightPaneResizer"),
  sections: $("#sections"),
  taskDir: $("#taskDir"),
  taskGit: $("#taskGit"),
  btnBrowseCwd: $("#btnBrowseCwd"),
  btnCreateCwd: $("#btnCreateCwd"),
  btnOpenCwd: $("#btnOpenCwd"),
  btnResetCwd: $("#btnResetCwd"),
  engineBar: $("#engineBar"),
  taskStatus: $("#taskStatus"),
  extensionsBadge: $("#extensionsBadge"),
  btnConfigToggle: $("#btnConfigToggle"),
  configToggleMeta: $("#configToggleMeta"),
  configDialog: $("#configDialog"),
  btnCloseConfigDialog: $("#btnCloseConfigDialog"),
  channelSection: $("#channelSection"),
  channelConfigBody: $("#channelConfigBody"),
  channelPublicUrl: $("#channelPublicUrl"),
  btnSaveChannelPublicUrl: $("#btnSaveChannelPublicUrl"),
  cfgAvailableProviders: $("#cfgAvailableProviders"),
  channelList: $("#channelList"),
  skillList: $("#skillList"),
  btnSkillMarket: $("#btnSkillMarket"),
  btnOpenSkillRoot: $("#btnOpenSkillRoot"),
  btnReloadSkills: $("#btnReloadSkills"),
  btnDeleteAllSkills: $("#btnDeleteAllSkills"),
  mcpList: $("#mcpList"),
  btnAddSkill: $("#btnAddSkill"),
  btnAddMcp: $("#btnAddMcp"),
  btnDeleteAllMcp: $("#btnDeleteAllMcp"),
  statusDot: $("#statusIcon"),
  statusLabel: $("#statusLabel"),
  elapsed: $("#elapsed"),
  overviewBadge: $("#overviewBadge"),
  overviewBody: $("#overviewBody"),
  specBadge: $("#specBadge"),
  specBody: $("#specBody"),
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
  btnChatCopyAll: $("#btnChatCopyAll"),
  chatForm: $("#chatForm"),
  chatTextarea: $("#chatTextarea"),
  chatSend: $("#chatSend"),
  sessionListPanel: $("#sessionListPanel"),
  btnRefreshSessions: $("#btnRefreshSessions"),
  btnCreateSession: $("#btnCreateSession"),
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
  sectionDialog: $("#sectionDialog"),
  sectionDialogTitle: $("#sectionDialogTitle"),
  sectionDialogMeta: $("#sectionDialogMeta"),
  sectionDialogBody: $("#sectionDialogBody"),
  btnCloseSectionDialog: $("#btnCloseSectionDialog"),
  appDialog: $("#appDialog"),
  appDialogTitle: $("#appDialogTitle"),
  appDialogBody: $("#appDialogBody"),
  appDialogInputField: $("#appDialogInputField"),
  appDialogInputLabel: $("#appDialogInputLabel"),
  appDialogInput: $("#appDialogInput"),
  btnAppDialogCancel: $("#btnAppDialogCancel"),
  btnAppDialogOk: $("#btnAppDialogOk"),
  llmForm: $("#llmForm"),
  llmSection: $("#llmSection"),
  llmSummary: $("#llmSummary"),
  llmProvider: $("#llmProvider"),
  llmModel: $("#llmModel"),
  llmApiKey: $("#llmApiKey"),
  btnLlmApiKeyToggle: $("#btnLlmApiKeyToggle"),
  btnLlmApiKeyCopy: $("#btnLlmApiKeyCopy"),
  llmStatus: $("#llmStatus"),
  llmNotice: $("#llmNotice"),
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
  localeMode: $("#localeMode"),
  themeMode: $("#themeMode"),
  // Knowledge: Memory & Preferences
  memoryBadge: $("#memoryBadge"),
  memoryList: $("#memoryList"),
  memorySearch: $("#memorySearch"),
  btnMemorySearch: $("#btnMemorySearch"),
  btnMemoryRefresh: $("#btnMemoryRefresh"),
  preferenceBadge: $("#preferenceBadge"),
  preferenceList: $("#preferenceList"),
  btnPreferenceRefresh: $("#btnPreferenceRefresh"),
  btnPreferenceAdd: $("#btnPreferenceAdd"),
  memoryDialog: $("#memoryDialog"),
  memoryDialogTitle: $("#memoryDialogTitle"),
  memoryDialogMeta: $("#memoryDialogMeta"),
  memoryDialogContent: $("#memoryDialogContent"),
  btnDeleteMemory: $("#btnDeleteMemory"),
  btnCloseMemory: $("#btnCloseMemory"),
  logDialog: $("#logDialog"),
  logViewerBody: $("#logViewerBody"),
  logLevelFilter: $("#logLevelFilter"),
  btnLog: $("#btnLog"),
  btnLogRefresh: $("#btnLogRefresh"),
  btnLogCopy: $("#btnLogCopy"),
  btnLogClear: $("#btnLogClear"),
  btnCloseLog: $("#btnCloseLog"),
  prefEditDialog: $("#prefEditDialog"),
  prefEditForm: $("#prefEditForm"),
  prefEditTitle: $("#prefEditTitle"),
  prefEditId: $("#prefEditId"),
  prefEditKey: $("#prefEditKey"),
  prefEditValue: $("#prefEditValue"),
  btnCancelPrefEdit: $("#btnCancelPrefEdit"),
};

let llmSaveTimer;
let llmNoticeTimer;
let llmSyncSerial = 0;
let llmSavedValue = "";

// ── AppLog ──

const AppLog = (() => {
  const MAX_ENTRIES = 2000;
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  const entries = [];
  let filterLevel = "debug";
  let _flushQueue = [];
  let _flushTimer = null;

  function now() {
    return new Date().toISOString().split(".")[0];
  }

  function add(level, service, message, extra) {
    const entry = { ts: now(), level, service, message, extra };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    return entry;
  }

  function persist(entry) {
    _flushQueue.push(entry);
    if (!_flushTimer) {
      _flushTimer = setTimeout(flush, 500);
    }
  }

  function flush() {
    _flushTimer = null;
    const batch = _flushQueue.splice(0);
    for (const entry of batch) {
      const extraObj = entry.extra && typeof entry.extra === "object" ? entry.extra : undefined;
      const msg = entry.extra && !extraObj ? `${entry.message} ${entry.extra}` : entry.message;
      fetch(apiUrl("log"), {
        method: "POST",
        headers: { ...apiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          service: "overlay:" + entry.service,
          level: entry.level,
          message: msg,
          extra: extraObj,
        }),
      }).catch(() => {});
    }
  }

  function log(level, service, message, extra) {
    const entry = add(level, service, message, extra);
    const prefix = `[${entry.ts}] [${level.toUpperCase()}] [${service}]`;
    if (level === "error") console.error(prefix, message, extra || "");
    else if (level === "warn") console.warn(prefix, message, extra || "");
    else if (level === "debug") console.debug(prefix, message, extra || "");
    else console.log(prefix, message, extra || "");
    persist(entry);
    return entry;
  }

  return {
    debug: (service, msg, extra) => log("debug", service, msg, extra),
    info: (service, msg, extra) => log("info", service, msg, extra),
    warn: (service, msg, extra) => log("warn", service, msg, extra),
    error: (service, msg, extra) => log("error", service, msg, extra),
    entries,
    get filterLevel() { return filterLevel; },
    set filterLevel(v) { filterLevel = v; },
    filtered() {
      const min = levels[filterLevel] || 0;
      return entries.filter((e) => (levels[e.level] || 0) >= min);
    },
    clear() { entries.length = 0; },
  };
})();

function sanitizeLocale(value) {
  const text = String(value || "").trim();
  if (SUPPORTED_LOCALES.includes(text)) return text;
  if (/^zh\b/i.test(text)) return "zh-CN";
  return "en-US";
}

function record(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function localeValue(key, locale = state.locale) {
  const source = state.i18n[locale];
  if (record(source) && Object.hasOwn(source, key)) return source[key];
  return key.split(".").reduce((acc, part) => (record(acc) ? acc[part] : undefined), source);
}

function fillTemplate(text, vars = {}) {
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = key.split(".").reduce((acc, part) => (record(acc) ? acc[part] : undefined), vars);
    return value == null ? "" : String(value);
  });
}

function t(key, vars) {
  const value = localeValue(key) ?? localeValue(key, "en-US");
  if (typeof value !== "string") return key;
  return fillTemplate(value, vars);
}

function tc(key, count, vars) {
  const value = localeValue(key) ?? localeValue(key, "en-US");
  if (record(value)) {
    const text = value[count === 1 ? "one" : "other"] ?? value.other ?? value.one;
    if (typeof text === "string") return fillTemplate(text, { count, ...vars });
  }
  return t(key, { count, ...vars });
}

function localeTag() {
  return sanitizeLocale(state.locale);
}

function i18nTargets(root, selector) {
  const items = [];
  if (root instanceof Element && root.matches(selector)) items.push(root);
  root.querySelectorAll?.(selector)?.forEach((node) => items.push(node));
  return items;
}

function applyI18n(root = document) {
  i18nTargets(root, "[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  i18nTargets(root, "[data-i18n-html]").forEach((node) => {
    node.innerHTML = t(node.dataset.i18nHtml);
  });
  i18nTargets(root, "[data-i18n-placeholder]").forEach((node) => {
    node.setAttribute("placeholder", t(node.dataset.i18nPlaceholder));
  });
  i18nTargets(root, "[data-i18n-title]").forEach((node) => {
    node.setAttribute("title", t(node.dataset.i18nTitle));
  });
  i18nTargets(root, "[data-i18n-aria-label]").forEach((node) => {
    node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
  });
  i18nTargets(root, "[data-i18n-alt]").forEach((node) => {
    node.setAttribute("alt", t(node.dataset.i18nAlt));
  });
}

async function loadI18n() {
  const entries = await Promise.all(
    SUPPORTED_LOCALES.map(async (locale) => {
      const data = await fetch(`i18n/${locale}.json`)
        .then((res) => (res.ok ? res.json() : {}))
        .catch(() => ({}));
      return [locale, record(data) ? data : {}];
    }),
  );
  state.i18n = Object.fromEntries(entries);
  state.i18nReady = true;
}

function renderLocale() {
  state.locale = sanitizeLocale(state.locale);
  document.documentElement.lang = state.locale;
  if (dom.localeMode) dom.localeMode.value = state.locale;
  applyI18n(document);
  if (dom.btnLocale && dom.btnLocaleLabel) {
    const next = state.locale === "zh-CN" ? "en-US" : "zh-CN";
    const title = next === "zh-CN" ? t("settings.switch_to_zh") : t("settings.switch_to_en");
    dom.btnLocale.title = title;
    dom.btnLocale.setAttribute("aria-label", title);
    dom.btnLocaleLabel.textContent = next === "zh-CN" ? "ZH" : "EN";
  }
  renderSidebar();
}

function joinBullet(values) {
  return values.filter(Boolean).join(" / ");
}

function channelStatusLabel(status) {
  if (status === "configured") return t("channel.status.configured");
  if (status === "partial") return t("channel.status.partial");
  if (status === "missing") return t("channel.status.missing");
  if (status === "disabled") return t("channel.status.disabled");
  return status || "";
}

function mcpStatusLabel(status) {
  if (status === "connected") return t("mcp.status.connected");
  if (status === "disabled") return t("mcp.status.disabled");
  if (status === "error") return t("mcp.status.error");
  return status || t("llm.status.unknown");
}

function deliveryStatusLabel(status) {
  if (status === "delivered") return t("delivery.status.delivered");
  if (status === "publishing") return t("delivery.status.publishing");
  if (status === "failed") return t("delivery.status.failed");
  return t("delivery.status.candidate");
}

function evaluationVerdictLabel(status) {
  if (status === "accepted") return t("evaluation.verdict.accepted");
  if (status === "rejected") return t("evaluation.verdict.rejected");
  return t("evaluation.verdict.pending");
}

function checkResultLabel(status) {
  if (status === "passed") return t("checks.pass");
  if (status === "failed") return t("checks.fail");
  if (status === "skipped") return t("checks.skip");
  if (status === "off") return t("checks.off");
  return t("checks.pending");
}

function toolStatusLabel(status) {
  if (status === "completed") return t("task.status.completed");
  if (status === "running") return t("task.status.running");
  if (status === "error") return t("common.error");
  return t("checks.pending");
}

function roleLabel(role) {
  if (role === "user") return t("chat.role.user");
  if (role === "assistant") return t("chat.role.assistant");
  if (role === "planner") return t("chat.role.planner");
  if (role === "scheduler") return t("chat.role.scheduler");
  if (role === "spec") return t("chat.role.spec");
  if (role === "system") return t("chat.role.system");
  if (role === "goal_gate") return t("chat.role.goal");
  if (role === "task_tool") return t("chat.role.task");
  return t("chat.role.message");
}

function timeLocaleOptions(includeSeconds = true) {
  return includeSeconds
    ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" };
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(localeTag());
}

function formatDateTime(value, options) {
  if (!value) return "";
  return new Date(value).toLocaleString(localeTag(), options);
}

function errorText(key, error) {
  const detail = error instanceof Error ? error.message : String(error || "");
  return `${t(key)}: ${detail}`;
}

function refreshLocalizedState() {
  renderLocale();
  renderTheme();
  setConnStatus(dom.connBadge?.dataset.status || (state.connected ? "online" : "offline"));
  renderVersions();
  renderSidebar();
  renderExecutor();
  renderMeta();
  renderExtensions();
  renderChannels();
  renderManagedSessionList();
  renderMemory();
  renderPreferences();
  renderLlmSummary();
  renderLlmApiKeyTools();
  if (state.config && state.providerCatalog) populateProviderSelect(state.config, state.providerCatalog);
  if (state.board) {
    renderBoard();
  } else {
    renderOverview(null, null);
    renderSpec(null);
    renderPlan(null);
    renderChanges();
  }
  renderSession();
  if (dom.skillMarketDialog?.open) renderSkillMarket();
  refreshSectionDetail();
}

async function setLocale(value, options = {}) {
  const next = sanitizeLocale(value);
  if (state.locale === next && options.force !== true) {
    renderLocale();
    return;
  }
  state.locale = next;
  state.localeSeq += 1;
  refreshLocalizedState();
  if (options.persist === false) return;
  await persistOverlaySettings();
}

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
    return globalInvoke(command, args);
  }
  throw new Error(`Tauri runtime unavailable for ${command}`);
}

function hasTauriRuntime() {
  return typeof window !== "undefined" && typeof window.__TAURI__?.core?.invoke === "function";
}

function isManagedLocalServerUrl(value) {
  const input = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_SERVER;
  try {
    const url = new URL(input);
    return url.protocol.startsWith("http") && ["127.0.0.1", "localhost"].includes(url.hostname);
  } catch {
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function localServerInfo() {
  if (!hasTauriRuntime()) return null;
  const info = await tauriInvoke("overlay_server_info").catch(() => undefined);
  return info && typeof info.url === "string" ? info : null;
}

async function syncLocalServerUrl(options = {}) {
  if (!hasTauriRuntime()) return null;
  if (!options.force && !isManagedLocalServerUrl(state.serverUrl)) return null;
  const info = await localServerInfo();
  if (!info) return null;
  const next = info.url.replace(/\/+$/, "");
  if (state.serverUrl === next) return info;
  state.serverUrl = next;
  await persistOverlaySettings();
  return info;
}

async function restartLocalServer() {
  if (!hasTauriRuntime()) return null;
  const info = await tauriInvoke("overlay_server_restart").catch(() => undefined);
  if (!info || typeof info.url !== "string") return null;
  state.serverUrl = info.url.replace(/\/+$/, "");
  await persistOverlaySettings();
  return info;
}

function sanitizePaneWidth(value) {
  const next = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(next) && next > 0 ? Math.round(next) : null;
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sanitizeZoom(value) {
  const next = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(next) ? clampNumber(next, MIN_UI_ZOOM, MAX_UI_ZOOM) : 1;
}

function currentUIScale() {
  if (typeof document === "undefined") return 1;
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;
}

function paneHandleWidth(node) {
  if (!node) return 0;
  const style = getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return 0;
  const width = node.getBoundingClientRect().width;
  if (width > 0) return width;
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-resizer-width")) || 0;
}

function defaultRailWidth() {
  const scale = currentUIScale();
  const panelWidth = dom.panelBody?.clientWidth || window.visualViewport?.width || window.innerWidth || 900;
  return clampNumber(panelWidth * 0.24, 240 * scale, 420 * scale);
}

function resolvedPaneWidths() {
  const scale = currentUIScale();
  const panelWidth = dom.panelBody?.clientWidth || window.visualViewport?.width || window.innerWidth || 900;
  const railMin = 180 * scale;
  const railMax = 520 * scale;
  const chatPreferred = 520 * scale;
  const chatMin = 420 * scale;
  const collapsedSidebar = 62 * scale;
  const leftHandle = state.sidebarCollapsed ? 0 : paneHandleWidth(dom.leftPaneResizer);
  const rightHandle = paneHandleWidth(dom.rightPaneResizer);
  let sidebar = clampNumber(state.sidebarWidth || defaultRailWidth(), railMin, railMax);
  let sections = clampNumber(state.sectionsWidth || defaultRailWidth(), railMin, railMax);
  const total = panelWidth - leftHandle - rightHandle;
  let actualSidebar = state.sidebarCollapsed ? collapsedSidebar : sidebar;
  const sidebarFloor = state.sidebarCollapsed ? collapsedSidebar : railMin;

  if (actualSidebar + sections + chatPreferred > total) {
    let overflow = actualSidebar + sections + chatPreferred - total;
    const sidebarCap = Math.max(0, actualSidebar - sidebarFloor);
    const sectionsCap = Math.max(0, sections - railMin);
    const totalCap = sidebarCap + sectionsCap;
    if (totalCap > 0) {
      const sidebarShrink = Math.min(sidebarCap, overflow * (sidebarCap / totalCap));
      actualSidebar -= sidebarShrink;
      overflow -= sidebarShrink;
      const sectionsShrink = Math.min(sectionsCap, overflow);
      sections -= sectionsShrink;
      overflow -= sectionsShrink;
      if (overflow > 0 && !state.sidebarCollapsed) {
        const extraSidebar = Math.min(Math.max(0, actualSidebar - railMin), overflow);
        actualSidebar -= extraSidebar;
      }
    }
  }

  if (actualSidebar + sections + chatMin > total) {
    const overflow = actualSidebar + sections + chatMin - total;
    const sectionsShrink = Math.min(Math.max(0, sections - railMin), overflow);
    sections -= sectionsShrink;
    const remaining = overflow - sectionsShrink;
    if (remaining > 0 && !state.sidebarCollapsed) {
      actualSidebar -= Math.min(Math.max(0, actualSidebar - railMin), remaining);
    }
  }

  sidebar = clampNumber(actualSidebar, sidebarFloor, railMax);
  sections = clampNumber(sections, railMin, railMax);
  return {
    sidebar: Math.round(sidebar),
    sections: Math.round(sections),
  };
}

function renderPaneLayout() {
  if (typeof document === "undefined") return;
  const widths = resolvedPaneWidths();
  document.documentElement.style.setProperty("--ui-sidebar-width", `${widths.sidebar}px`);
  document.documentElement.style.setProperty("--ui-sections-width", `${widths.sections}px`);
}

function browserOverlaySettings() {
  return {
    serverUrl: localStorage.getItem("oc_server_url") || DEFAULT_OVERLAY_SETTINGS.serverUrl,
    password: localStorage.getItem("oc_password") || DEFAULT_OVERLAY_SETTINGS.password,
    username: localStorage.getItem("oc_username") || DEFAULT_OVERLAY_SETTINGS.username,
    executor: localStorage.getItem("oc_executor") || DEFAULT_OVERLAY_SETTINGS.executor,
    initGit: true,
    alwaysOnTop: localStorage.getItem("oc_always_on_top") === "true",
    sidebarCollapsed: localStorage.getItem("oc_sidebar_collapsed") === "true",
    sidebarWidth: sanitizePaneWidth(localStorage.getItem("oc_sidebar_width")),
    sectionsWidth: sanitizePaneWidth(localStorage.getItem("oc_sections_width")),
    zoom: sanitizeZoom(localStorage.getItem("oc_zoom")),
    theme: sanitizeTheme(localStorage.getItem("oc_theme")),
    locale: sanitizeLocale(localStorage.getItem("oc_locale") || DEFAULT_OVERLAY_SETTINGS.locale),
    directory: localStorage.getItem("oc_directory") || DEFAULT_OVERLAY_SETTINGS.directory,
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
  state.initGit = true;
  state.alwaysOnTop = settings?.alwaysOnTop === true;
  state.sidebarCollapsed = settings?.sidebarCollapsed === true;
  state.sidebarWidth = sanitizePaneWidth(settings?.sidebarWidth);
  state.sectionsWidth = sanitizePaneWidth(settings?.sectionsWidth);
  state.zoom = sanitizeZoom(settings?.zoom);
  state.theme = sanitizeTheme(settings?.theme);
  state.locale = sanitizeLocale(settings?.locale || DEFAULT_OVERLAY_SETTINGS.locale);
  state.directory =
    typeof settings?.directory === "string" ? settings.directory.trim() : DEFAULT_OVERLAY_SETTINGS.directory;
}

async function loadOverlaySettings() {
  const browser = browserOverlaySettings();
  const saved = await tauriInvoke("overlay_settings_load", {
    directory: browser.directory || undefined,
  }).catch(() => undefined);
  if (saved && typeof saved === "object") {
    applyOverlaySettings({ ...browser, ...saved });
    return;
  }
  applyOverlaySettings(browser);
}

async function persistOverlaySettings() {
  const settings = {
    serverUrl: state.serverUrl,
    password: state.password,
    username: state.username,
    executor: state.executor,
    initGit: true,
    alwaysOnTop: state.alwaysOnTop,
    sidebarCollapsed: state.sidebarCollapsed,
    sidebarWidth: state.sidebarWidth || undefined,
    sectionsWidth: state.sectionsWidth || undefined,
    zoom: state.zoom,
    theme: state.theme,
    locale: state.locale,
    directory: state.directory || undefined,
  };
  localStorage.setItem("oc_server_url", settings.serverUrl);
  localStorage.setItem("oc_password", settings.password);
  localStorage.setItem("oc_username", settings.username);
  localStorage.setItem("oc_executor", settings.executor);
  localStorage.removeItem("oc_init_git");
  localStorage.setItem("oc_always_on_top", String(settings.alwaysOnTop));
  localStorage.setItem("oc_sidebar_collapsed", String(settings.sidebarCollapsed));
  if (settings.sidebarWidth) localStorage.setItem("oc_sidebar_width", String(settings.sidebarWidth));
  else localStorage.removeItem("oc_sidebar_width");
  if (settings.sectionsWidth) localStorage.setItem("oc_sections_width", String(settings.sectionsWidth));
  else localStorage.removeItem("oc_sections_width");
  localStorage.setItem("oc_zoom", String(settings.zoom));
  localStorage.setItem("oc_theme", settings.theme);
  localStorage.setItem("oc_locale", settings.locale);
  localStorage.setItem("oc_directory", state.directory || "");
  const saved = await tauriInvoke("overlay_settings_save", {
    settings,
    directory: state.directory || undefined,
  }).catch(() => undefined);
  if (saved) return;
}

function renderTheme() {
  const theme = sanitizeTheme(state.theme);
  const effective = theme === "system" ? resolvedTheme() : theme;
  state.theme = theme;
  document.body.dataset.theme = effective;
  if (dom.btnTheme) {
    dom.btnTheme.dataset.theme = effective;
    dom.btnTheme.dataset.mode = theme;
    dom.btnTheme.title = effective === "light" ? t("titlebar.theme.dark") : t("titlebar.theme.light");
    dom.btnTheme.setAttribute("aria-label", dom.btnTheme.title);
  }
  if (dom.themeMode) {
    dom.themeMode.value = theme;
  }
}

function renderScale() {
  const width = window.visualViewport?.width || window.innerWidth || 900;
  const height = window.visualViewport?.height || window.innerHeight || 760;
  const scale = Math.min(width / 1040, height / 820);
  const base = Math.max(0.82, Math.min(1.04, scale));
  const next = base * state.zoom;
  document.documentElement.style.setProperty("--ui-scale", next.toFixed(3));
  renderPaneLayout();
  fitBrandVersion();
  sizeChat();
  renderExecutor();
}

function setZoom(value) {
  const next = sanitizeZoom(value);
  if (Math.abs(next - state.zoom) < 0.001) return;
  state.zoom = next;
  renderScale();
  void persistOverlaySettings();
}

function stepZoom(delta) {
  setZoom(Math.round((state.zoom + delta) * 100) / 100);
}

function handleZoomHotkey(event) {
  if (!hasTauriRuntime() || event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey) return;
  const plus = event.code === "Equal" || event.code === "NumpadAdd" || event.key === "+" || event.key === "=";
  if (plus) {
    event.preventDefault();
    stepZoom(ZOOM_STEP);
    return;
  }
  const minus = event.code === "Minus" || event.code === "NumpadSubtract" || event.key === "-" || event.key === "_";
  if (minus) {
    event.preventDefault();
    stepZoom(-ZOOM_STEP);
    return;
  }
  const reset = event.code === "Digit0" || event.code === "Numpad0" || event.key === "0";
  if (!reset) return;
  event.preventDefault();
  setZoom(1);
}

// ── API Client ──

function apiUrl(path) {
  const base = state.serverUrl.replace(/\/+$/, "");
  const next = path.replace(/^\/+/, "");
  const idx = next.indexOf("?");
  const pathname = idx >= 0 ? next.slice(0, idx) : next;
  const params = new URLSearchParams(idx >= 0 ? next.slice(idx + 1) : "");
  if (state.directory) params.set("directory", state.directory);
  const query = params.toString();
  return `${base}/${pathname}${query ? `?${query}` : ""}`;
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
  const taskID = sessionID ? undefined : state.selectedTaskID || undefined;
  return {
    surface: "panel",
    text,
    taskID,
    sessionID,
    executor: state.executor,
    allow_create: true,
    metadata: {
      selectedTaskID: taskID,
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
    await openManagedSession(result.local_action.sessionID);
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
    await loadConversation();
  } else {
    await loadTasks();
  }
}

async function panelMessage(text, metadata) {
  AppLog.debug("panel", "message: " + text.slice(0, 80));
  if (!state.selectedTaskID) {
    return panelMessageStream(text, metadata);
  }
  const result = await apiJson("panel/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(panelRequestBody(text, metadata)),
    signal: AbortSignal.timeout(120000),
  });
  await applyPanelResult(result);
  return result;
}

async function panelMessageStream(text, metadata) {
  const body = JSON.stringify(panelRequestBody(text, metadata));
  let res;
  try {
    res = await fetch(apiUrl("panel/message/stream"), {
      method: "POST",
      headers: { ...apiHeaders(), "Content-Type": "application/json" },
      body,
    });
  } catch {}
  if (!res?.ok || !res.body) {
    const result = await apiJson("panel/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(120000),
    });
    await applyPanelResult(result);
    return result;
  }

  // Replace "……" thinking placeholder with a live indicator
  const placeholder = state.session.find((m) => m.info?.role === "assistant" && m.parts?.[0]?.text === "……");
  if (placeholder) placeholder.parts[0].text = "...";
  renderSession();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let result = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim());
        if (ev.type === "tool" && placeholder) {
          placeholder.parts[0].text = `${ev.tool}...`;
          renderSession();
        } else if (ev.type === "done") {
          result = ev.result;
        }
      } catch (e) { AppLog.debug("stream", "malformed SSE event: " + line, { error: String(e) }); }
    }
  }

  if (!result) return null;

  // Show final message with typewriter, then apply side-effects
  if (placeholder && result.message) {
    const msg = result.message;
    let i = 0;
    await new Promise((resolve) => {
      const step = () => {
        i = Math.min(i + 2 + Math.floor(Math.random() * 2), msg.length);
        placeholder.parts[0].text = msg.slice(0, i);
        renderSession();
        if (i >= msg.length) { resolve(); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

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
    const [skills, mcp] = await Promise.all([
      apiJson("skill/installed").catch(() => apiJson("skill")),
      apiJson("mcp"),
    ]);
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
  const removable = custom.filter(skillRemovable);
  const builtin = state.skills.length - custom.length;
  const mcpEntries = Object.entries(state.mcp || {});

  dom.extensionsBadge.textContent = `${custom.length} skill · ${mcpEntries.length} mcp`;
  if (dom.btnDeleteAllSkills) dom.btnDeleteAllSkills.disabled = removable.length === 0;
  if (dom.btnDeleteAllMcp) dom.btnDeleteAllMcp.disabled = mcpEntries.length === 0;
  dom.extensionsBadge.textContent = t("extensions.badge", {
    skills: custom.length,
    mcp: mcpEntries.length,
  });
  renderConfigToggleMeta();

  if (!custom.length) {
    dom.skillList.innerHTML = `<div class="empty-hint">${escapeHtml(
      builtin > 0 ? t("skill.none_custom_with_builtin", { count: builtin }) : t("skill.none_custom"),
    )}</div>`;
    dom.skillList.innerHTML = `<div class="empty-hint">${escapeHtml(
      builtin > 0 ? t("skill.none_custom_with_builtin", { count: builtin }) : t("skill.none_custom"),
    )}</div>`;
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
            ${skillRemovable(item)
              ? `<button type="button" class="btn btn-ghost mini danger" data-skill-remove="${escapeHtml(item.source || "")}" data-skill-kind="${escapeHtml(skillRemoveKind(item) || "")}" data-skill-name="${escapeHtml(item.name || "")}">${escapeHtml(t("common.delete"))}</button>`
              : ""}
            ${item.location && item.location !== "builtin"
              ? `<button type="button" class="btn btn-ghost mini" data-skill-open="${escapeHtml(item.location)}">${escapeHtml(t("common.open"))}</button>`
              : ""}
            <span class="extension-status" data-state="connected">${escapeHtml(t("common.loaded"))}</span>
          </div>
        </div>`,
      )
      .join("");
  }

  if (!mcpEntries.length) {
    dom.mcpList.innerHTML = `<div class="empty-hint">${escapeHtml(t("mcp.none"))}</div>`;
    return;
  }

  dom.mcpList.innerHTML = mcpEntries
    .map(([name, item]) => {
      const status = item?.status || "disabled";
      const detail = item?.error || "";
      return `<div class="extension-row">
        <div class="extension-row-main">
          <strong>${escapeHtml(name)}</strong>
          ${detail ? `<span>${escapeHtml(detail)}</span>` : `<span>${escapeHtml(mcpStatusLabel(status))}</span>`}
        </div>
        <span class="extension-status" data-state="${escapeHtml(status)}">${escapeHtml(mcpStatusLabel(status))}</span>
      </div>`;
    })
    .join("");
}

function skillRemoveKind(item) {
  if (item?.source_type === "managed_git") return "git";
  if (item?.source_type === "config_url") return "url";
  if (item?.source_type === "config_path") return "path";
  return "";
}

function skillRemovable(item) {
  return !item?.builtin && !!item?.source && !!skillRemoveKind(item);
}

function renderConfigToggleMeta() {
  if (!dom.configToggleMeta) return;
  const items = [
    { label: t("skill.title"), value: state.skills.filter((item) => !item.builtin).length },
    { label: t("mcp.title"), value: Object.keys(state.mcp || {}).length },
    { label: t("memory.title"), value: state.memoryFiles.length },
    { label: t("preference.title"), value: state.preferences.length },
  ];
  dom.configToggleMeta.innerHTML = items
    .map(
      (item) =>
        `<span class="config-toggle-stat"><span class="config-toggle-stat-label">${escapeHtml(item.label)}</span><span class="config-toggle-stat-value">${escapeHtml(String(item.value))}</span></span>`,
    )
    .join(`<span class="config-toggle-sep" aria-hidden="true">·</span>`);
  dom.configToggleMeta.title = items.map((item) => `${item.label} ${item.value}`).join(" · ");
}

async function removeSkillSource(source, kind) {
  await apiJson("skill/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, kind }),
  });
}

async function deleteSkill(source, kind, name) {
  if (!source || !kind) return;
  const accepted = await nativeConfirm(t("skill.delete_confirm", { name: name || source }), {
    title: t("skill.delete_title"),
    okLabel: t("common.delete"),
    kind: "warning",
  });
  if (!accepted) return;
  await removeSkillSource(source, kind);
}

async function deleteAllSkills() {
  const custom = state.skills.filter((item) => !item.builtin);
  const list = custom.filter(skillRemovable);
  if (list.length === 0) return;
  const message =
    list.length === custom.length
      ? t("skill.delete_all_confirm_all", { count: list.length })
      : t("skill.delete_all_confirm_partial", {
          removable: list.length,
          blocked: custom.length - list.length,
        });
  const accepted = await nativeConfirm(message, {
    title: t("skill.delete_all_title"),
    okLabel: t("common.delete_all"),
    kind: "warning",
  });
  if (!accepted) return;
  await list.reduce(
    (promise, item) => promise.then(() => removeSkillSource(item.source, skillRemoveKind(item))),
    Promise.resolve(),
  );
}

async function disconnectMcp(name) {
  await apiJson(`mcp/${encodeURIComponent(name)}/disconnect`, {
    method: "POST",
  }).catch(() => undefined);
}

async function removeMcpAuth(name) {
  await apiJson(`mcp/${encodeURIComponent(name)}/auth`, {
    method: "DELETE",
  }).catch(() => undefined);
}

async function deleteAllMcp() {
  const names = Object.keys(state.mcp || {});
  if (names.length === 0) return;
  const accepted = await nativeConfirm(t("mcp.delete_all_confirm", { count: names.length }), {
    title: t("mcp.delete_all_title"),
    okLabel: t("common.delete_all"),
    kind: "warning",
  });
  if (!accepted) return;
  await Promise.all(names.map((name) => disconnectMcp(name)));
  await Promise.all(names.map((name) => removeMcpAuth(name)));
  await updateConfig((current) => {
    delete current.mcp;
  });
}

async function loadSkillMarket() {
  if (!dom.skillMarketDialog || !dom.skillMarketList) return;
  dom.skillMarketList.innerHTML = `<div class="empty-hint">${escapeHtml(t("skill.market.loading"))}</div>`;
  dom.skillMarketDialog.showModal();
  try {
    const items = await apiJson("skill/market");
    state.skillMarket = Array.isArray(items) ? items : [];
    renderSkillMarket();
  } catch (e) {
    AppLog.error("ui", "Failed to load skill market", { error: String(e) });
    dom.skillMarketList.innerHTML = `<div class="empty-hint">${escapeHtml(e.message || t("skill.market.load_failed"))}</div>`;
  }
}

function renderSkillMarket() {
  if (!dom.skillMarketList) return;
  if (!state.skillMarket.length) {
    dom.skillMarketList.innerHTML = `<div class="empty-hint">${escapeHtml(t("skill.market.none"))}</div>`;
    return;
  }
  dom.skillMarketList.innerHTML = state.skillMarket
    .map((item) => {
      const installable = !!item.source && item.install_kind !== "manual";
      const action = installable
        ? `<button type="button" class="btn btn-primary mini" data-market-install="${escapeHtml(item.id)}">${escapeHtml(t("skill.install"))}</button>`
        : `<button type="button" class="btn btn-ghost mini" data-market-homepage="${escapeHtml(item.homepage)}">${escapeHtml(t("skill.market.open_site"))}</button>`;
      const policy =
        item.recommended_policy === "ask"
          ? t("skill.policy.ask")
          : item.recommended_policy === "allow"
            ? t("skill.policy.allow")
            : item.recommended_policy === "deny"
              ? t("skill.policy.deny")
              : item.recommended_policy;
      return `<div class="market-card">
        <div class="market-card-main">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.provider)} · ${escapeHtml(item.trust)} · ${escapeHtml(item.install_kind)}</span>
          <small>${escapeHtml(item.description || "")}</small>
          ${item.notes ? `<small>${escapeHtml(item.notes)}</small>` : ""}
        </div>
        <div class="market-card-actions">
          <span class="extension-status" data-state="${escapeHtml(item.recommended_policy)}">${escapeHtml(policy)}</span>
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
  renderChannelPublicUrl();
  if (!Array.isArray(state.channels) || state.channels.length === 0) {
    dom.channelList.innerHTML = `<div class="empty-hint">${escapeHtml(t("channel.none"))}</div>`;
    return;
  }
  dom.channelList.innerHTML = state.channels
    .map(
      (item) => `<div class="extension-row">
        <div class="extension-row-main">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.summary)}</span>
          <small class="channel-doc-credit">${escapeHtml(channelTutorialCredit())}</small>
        </div>
        <div class="channel-row-actions">
          <span class="extension-status" data-state="${escapeHtml(item.status)}">${escapeHtml(channelStatusLabel(item.status))}</span>
          ${channelTutorialButton(item.id, true)}
          <button type="button" class="btn btn-primary mini" data-channel-edit="${escapeHtml(item.id)}">${escapeHtml(t("common.edit"))}</button>
        </div>
      </div>`,
    )
    .join("");
}

function renderChannelPublicUrl() {
  if (!dom.channelPublicUrl) return;
  dom.channelPublicUrl.value = state.config?.server?.publicUrl || "";
}

function configValueForChannel(channelID, key) {
  return state.config?.channel?.[channelID]?.[key];
}

function channelTutorial(channelID) {
  return OPENCLAW_DOCS[channelID] || OPENCLAW_DOCS.overview;
}

function channelTutorialCredit() {
  return t("channel.tutorial_credit", { source: OPENCLAW_DOCS.credit });
}

function channelTutorialButton(channelID, mini = false) {
  const cls = mini ? "btn btn-ghost mini" : "btn btn-ghost";
  return `<button type="button" class="${cls}" data-channel-docs="${escapeHtml(channelTutorial(channelID))}">${escapeHtml(t("channel.tutorial"))}</button>`;
}

function channelTutorialCard(channelID) {
  return `<div class="channel-doc-card">
    <div class="channel-doc-copy">
      <span class="channel-doc-title">${escapeHtml(t("channel.tutorial_hint"))}</span>
      <small class="channel-doc-credit">${escapeHtml(channelTutorialCredit())}</small>
    </div>
    ${channelTutorialButton(channelID)}
  </div>`;
}

function renderChannelFields(channelID) {
  const entry = state.channels.find((item) => item.id === channelID);
  if (!entry) {
    dom.channelFields.innerHTML = `<div class="empty-hint">${escapeHtml(t("channel.fields_none"))}</div>`;
    return;
  }
  dom.channelDialogTitle.textContent = t("channel.configuration_title", { name: entry.name });
  dom.channelId.value = entry.id;
  dom.channelFields.innerHTML = [
    channelTutorialCard(entry.id),
    ...entry.fields.map((field) => {
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
    }),
  ].join("");
}

function providerEntry(providerID) {
  return state.providerCatalog?.all?.find((item) => item.id === providerID);
}

function providerLabel(providerID) {
  return providerEntry(providerID)?.name || providerID;
}

function providerState(providerID, configOverride) {
  const config = configOverride || state.config || {};
  const item = providerEntry(providerID);
  const connected = Array.isArray(state.providerCatalog?.connected) && state.providerCatalog.connected.includes(providerID);
  const authMethods = Array.isArray(state.providerAuth?.[providerID]) ? state.providerAuth[providerID] : [];
  const configKey = config?.provider?.[providerID]?.options?.apiKey;
  const key = configKey || item?.key;
  const tested = state.providerTest;
  if (tested?.providerID === providerID && tested?.modelID === dom.llmModel?.value) {
    return {
      tone: tested.ok ? "active" : "error",
      label: tested.ok ? t("llm.status.connected") : t("llm.status.error"),
      detail: tested.message,
    };
  }

  if (connected) {
    return {
      tone: "active",
      label: t("llm.status.connected"),
      detail: t("llm.detail.connected"),
    };
  }
  if (key) {
    return {
      tone: "ready",
      label: t("llm.status.configured"),
      detail: t("llm.detail.configured"),
    };
  }
  if (authMethods.length > 0) {
    return {
      tone: "warn",
      label: t("llm.status.auth_required"),
      detail: tc("llm.detail.auth_methods", authMethods.length),
    };
  }
  if ((item?.env?.length || 0) > 0) {
    return {
      tone: "warn",
      label: t("llm.status.needs_api_key"),
      detail: t("llm.detail.needs_api_key", { names: item.env.join(", ") }),
    };
  }
  return {
    tone: "",
    label: t("llm.status.available"),
    detail: t("llm.detail.available"),
  };
}

function renderProviderStatus(providerID, configOverride) {
  if (!providerID) {
    dom.llmStatus.textContent = t("llm.status.unknown");
    dom.llmStatus.dataset.status = "";
    dom.llmStatus.title = "";
    renderLlmSummary();
    return;
  }
  const info = providerState(providerID, configOverride);
  dom.llmStatus.textContent = info.label;
  dom.llmStatus.dataset.status = info.tone;
  dom.llmStatus.title = info.detail || info.label;
  renderLlmSummary();
}

function llmSelection() {
  return {
    providerID: dom.llmProvider?.value?.trim() || "",
    modelID: dom.llmModel?.value?.trim() || "",
    apiKey: dom.llmApiKey?.value ?? "",
  };
}

function llmSelectionKey() {
  const current = llmSelection();
  return JSON.stringify([current.providerID, current.modelID, current.apiKey]);
}

function llmCurrent() {
  const providerID = dom.llmProvider?.value?.trim() || "";
  const modelID = dom.llmModel?.value?.trim() || "";
  if (providerID || modelID) {
    return { providerID, modelID };
  }
  if (typeof state.config?.model !== "string" || !state.config.model.includes("/")) {
    return { providerID: "", modelID: "" };
  }
  const parts = state.config.model.split("/");
  return {
    providerID: parts[0] || "",
    modelID: parts.slice(1).join("/") || "",
  };
}

function llmToggleIcon(visible) {
  if (visible) {
    return `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.1 2.1l11.8 11.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M6 6.3A2.8 2.8 0 019.7 10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M1.7 8c1.6-2.8 3.8-4.2 6.3-4.2 2.4 0 4.6 1.4 6.3 4.2-.5.9-1 1.6-1.6 2.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  return `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M1.7 8c1.6-2.8 3.8-4.2 6.3-4.2s4.7 1.4 6.3 4.2c-1.6 2.8-3.8 4.2-6.3 4.2S3.3 10.8 1.7 8z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
    <circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.2"/>
  </svg>`;
}

function llmCopyIcon() {
  return `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="5.2" y="4.2" width="7.1" height="8.1" rx="1.4" stroke="currentColor" stroke-width="1.2"/>
    <path d="M4.2 10.6H3.7A1.5 1.5 0 012.2 9.1V3.7a1.5 1.5 0 011.5-1.5h5.4a1.5 1.5 0 011.5 1.5v.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`;
}

function renderLlmSummary() {
  if (!dom.llmSummary) return;
  const current = llmCurrent();
  if (!current.providerID || !current.modelID) {
    dom.llmSummary.textContent = t("llm.summary_empty");
    dom.llmSummary.title = t("llm.summary_empty");
    dom.llmSummary.dataset.status = "";
    return;
  }
  const text = t("llm.summary_value", {
    provider: providerLabel(current.providerID),
    model: current.modelID,
  });
  dom.llmSummary.textContent = text;
  dom.llmSummary.title = text;
  dom.llmSummary.dataset.status = dom.llmStatus?.dataset.status || "";
}

function renderLlmApiKeyTools() {
  if (!dom.llmApiKey) return;
  const visible = dom.llmApiKey.type === "text";
  const busy = !!dom.llmApiKey.disabled;
  const hasKey = !!dom.llmApiKey.value.trim();
  if (dom.btnLlmApiKeyToggle) {
    dom.btnLlmApiKeyToggle.innerHTML = llmToggleIcon(visible);
    const label = t(visible ? "llm.api_key_hide" : "llm.api_key_show");
    dom.btnLlmApiKeyToggle.title = label;
    dom.btnLlmApiKeyToggle.setAttribute("aria-label", label);
    dom.btnLlmApiKeyToggle.disabled = busy;
  }
  if (dom.btnLlmApiKeyCopy) {
    dom.btnLlmApiKeyCopy.innerHTML = llmCopyIcon();
    const label = t("llm.api_key_copy");
    dom.btnLlmApiKeyCopy.title = label;
    dom.btnLlmApiKeyCopy.setAttribute("aria-label", label);
    dom.btnLlmApiKeyCopy.disabled = busy || !hasKey;
  }
}

function setLlmBusy(value) {
  const busy = !!value;
  if (dom.llmProvider) dom.llmProvider.disabled = busy;
  if (dom.llmModel) dom.llmModel.disabled = busy;
  if (dom.llmApiKey) dom.llmApiKey.disabled = busy;
  if (dom.btnLlmApiKeyToggle) dom.btnLlmApiKeyToggle.disabled = busy;
  if (dom.btnLlmApiKeyCopy) dom.btnLlmApiKeyCopy.disabled = busy || !dom.llmApiKey?.value?.trim();
  renderLlmApiKeyTools();
}

function showLlmNotice(message, tone = "", duration = 2600) {
  if (!dom.llmNotice) return;
  if (llmNoticeTimer) clearTimeout(llmNoticeTimer);
  dom.llmNotice.textContent = message || "";
  dom.llmNotice.dataset.status = tone;
  dom.llmNotice.dataset.open = message ? "true" : "false";
  if (!message || duration <= 0) return;
  llmNoticeTimer = setTimeout(() => {
    if (!dom.llmNotice) return;
    dom.llmNotice.dataset.open = "false";
  }, duration);
}

async function testProviderConnection(providerID, modelID) {
  return apiJson(`provider/${providerID}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelID }),
  });
}

async function syncLlmSettings() {
  const nextValue = llmSelectionKey();
  if (nextValue === llmSavedValue) return;

  const current = llmSelection();
  if (!current.providerID || !current.modelID) return;

  const serial = ++llmSyncSerial;
  state.providerTest = null;
  setLlmBusy(true);
  dom.llmStatus.textContent = t("llm.status.saving");
  dom.llmStatus.dataset.status = "warn";
  dom.llmStatus.title = `${current.providerID}/${current.modelID}`;
  showLlmNotice(t("llm.notice.saving", { provider: current.providerID, model: current.modelID }), "warn", 0);

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

    state.config = saved;
    llmSavedValue = nextValue;
    await loadConfigInfo();

    const result = await testProviderConnection(current.providerID, current.modelID);
    if (serial !== llmSyncSerial) return;

    state.providerTest = {
      providerID: current.providerID,
      modelID: current.modelID,
      ok: !!result?.ok,
      message: result?.message || (result?.ok ? t("llm.status.connected") : t("llm.notice.test_failed")),
    };
    renderProviderStatus(current.providerID, state.config);
    showLlmNotice(state.providerTest.message, state.providerTest.ok ? "active" : "error");
  } catch (e) {
    if (serial !== llmSyncSerial) return;
    const message = e instanceof Error ? e.message : String(e);
    state.providerTest = {
      providerID: current.providerID,
      modelID: current.modelID,
      ok: false,
      message: message || t("llm.notice.update_failed"),
    };
    dom.llmStatus.textContent = t("llm.status.error");
    dom.llmStatus.dataset.status = "error";
    dom.llmStatus.title = state.providerTest.message;
    showLlmNotice(state.providerTest.message, "error", 3200);
  } finally {
    if (serial === llmSyncSerial) setLlmBusy(false);
  }
}

function queueLlmSync(delay = 220) {
  state.providerTest = null;
  renderProviderStatus(dom.llmProvider?.value || "", state.config);
  if (llmSaveTimer) clearTimeout(llmSaveTimer);
  llmSaveTimer = setTimeout(() => {
    llmSaveTimer = undefined;
    syncLlmSettings();
  }, delay);
}

function populateProviderSelect(config, catalog, syncSaved = true) {
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
  populateModelSelect(config, catalog, syncSaved);
}

function populateModelSelect(config, catalog, syncSaved = true) {
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
  if (syncSaved) llmSavedValue = llmSelectionKey();
  renderProviderStatus(providerID, config);
  renderLlmApiKeyTools();
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
    title: options?.title || t("dialog.confirm"),
    message,
    kind: options?.kind || "warning",
    okLabel: options?.okLabel || t("common.ok"),
    cancelLabel: options?.cancelLabel || t("common.cancel"),
    cancel: true,
  });
  return result.confirmed;
}

async function nativeMessage(message, options) {
  await showAppDialog({
    title: options?.title || t("dialog.notice"),
    message,
    kind: options?.kind || "info",
    okLabel: options?.okLabel || t("common.ok"),
  });
}

async function nativePrompt(message, options) {
  const result = await showAppDialog({
    title: options?.title || t("dialog.input"),
    message,
    kind: options?.kind || "info",
    okLabel: options?.okLabel || t("common.submit"),
    cancelLabel: options?.cancelLabel || t("common.cancel"),
    cancel: true,
    input: true,
    inputLabel: options?.inputLabel || t("dialog.value"),
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

    dom.appDialogTitle.textContent = options.title || t("dialog.notice");
    dom.appDialogBody.textContent = options.message || "";
    dom.appDialog.dataset.kind = options.kind || "info";
    dom.btnAppDialogOk.textContent = options.okLabel || t("common.ok");
    dom.btnAppDialogCancel.textContent = options.cancelLabel || t("common.cancel");
    dom.btnAppDialogCancel.classList.toggle("hidden", !options.cancel);
    dom.appDialogInputField.classList.toggle("hidden", !options.input);
    dom.appDialogInputLabel.textContent = options.inputLabel || t("dialog.value");
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
  try {
    const opened = await tauriInvoke("overlay_open_path", { path: target });
    if (opened) return true;
  } catch {}
  if (/^https?:\/\//i.test(target)) {
    window.open(target, "_blank", "noopener");
    return true;
  }
  try {
    const result = await apiJson("path/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: target }),
    });
    return result?.opened === true;
  } catch {
    return false;
  }
}

async function pickDirectory(start) {
  const selected = await tauriInvoke("overlay_pick_dir", { start: start || undefined });
  return typeof selected === "string" ? selected : "";
}

// ── Connection ──

async function checkConnection() {
  const managed = isManagedLocalServerUrl(state.serverUrl);
  if (managed) {
    await syncLocalServerUrl();
  }
  setConnStatus("connecting");
  AppLog.debug("conn", "checking connection to " + state.serverUrl);
  let error;
  const attempts = managed ? 8 : 1;

  for (let i = 0; i < attempts; i++) {
    try {
      const [health] = await Promise.all([apiJson("global/health"), apiJson("tasks")]);
      setConnStatus("online");
      state.connected = true;
      AppLog.info("conn", "connected", { version: health?.version, serverUrl: state.serverUrl });
      renderVersions(health?.version || "");
      return true;
    } catch (e) {
      error = e;
      if (i >= attempts - 1) break;
      await wait(350);
      await syncLocalServerUrl();
    }
  }

  setConnStatus("offline");
  state.connected = false;
  AppLog.warn("conn", "connection failed", { error: String(error), serverUrl: state.serverUrl });
  renderVersions("");
  return false;
}

function setConnStatus(status) {
  dom.connBadge.dataset.status = status;
  dom.connBadge.textContent =
    status === "online"
      ? t("titlebar.connection.online")
      : status === "connecting"
        ? t("titlebar.connection.connecting")
        : t("titlebar.connection.offline");
}

function renderVersions(coreVersion) {
  if (coreVersion !== undefined) {
    state.coreVersion = typeof coreVersion === "string" ? coreVersion : "";
  }
  const parts = [t("version.overlay", { version: OVERLAY_VERSION })];
  parts.push(state.coreVersion ? t("version.core", { version: state.coreVersion }) : t("version.core_unknown"));
  const version = parts.join(" / ");
  if (dom.chatVersion) {
    dom.chatVersion.textContent = version;
    dom.chatVersion.title = version;
  }
  if (dom.chatAuthor) {
    const author = t("version.author");
    dom.chatAuthor.textContent = author;
    dom.chatAuthor.title = author;
    dom.chatAuthor.href = OVERLAY_AUTHOR_URL;
  }
  const configured = state.channels.filter((item) => item.status === "configured");
  const partial = state.channels.filter((item) => item.status === "partial");
  const missing = state.channels.filter((item) => item.status === "missing");
  const disabled = state.channels.filter((item) => item.status === "disabled");
  const summary =
    configured.length === 0
      ? t("channel.setup_needed")
      : configured.length === 1
        ? configured[0].name
        : t("channel.summary_plus", { name: configured[0].name, count: configured.length - 1 });
  const hint = [
    configured.length > 0
      ? t("channel.configured", { names: configured.map((item) => item.name).join(", ") })
      : t("channel.configured_none"),
    partial.length > 0 ? t("channel.needs_setup", { names: partial.map((item) => item.name).join(", ") }) : "",
    missing.length > 0 ? t("channel.available", { names: missing.map((item) => item.name).join(", ") }) : "",
    disabled.length > 0 ? t("channel.disabled", { names: disabled.map((item) => item.name).join(", ") }) : "",
    t("channel.open_settings"),
  ]
    .filter(Boolean)
    .join(" | ");
  const tone = configured.length > 0 ? "brand-channel brand-channel-summary" : "brand-channel brand-channel-summary brand-channel-empty";
  if (!dom.brandVersion) return;
  dom.brandVersion.innerHTML = `<button type="button" class="brand-channel-group" data-no-drag="true" data-open-channels="true" title="${escapeHtml(hint)}" aria-label="${escapeHtml(hint)}"><span class="brand-channel-label">${escapeHtml(t("channel.channels"))}</span><span class="${tone}">${escapeHtml(summary)}</span></button>`;
  fitBrandVersion();
}

function fitBrandVersion() {
  if (!dom.brandVersion) return;
  dom.brandVersion.style.setProperty("--brand-version-scale", "1");
  requestAnimationFrame(() => {
    const width = dom.brandVersion.clientWidth;
    const scroll = dom.brandVersion.scrollWidth;
    if (!width || scroll <= width) return;
    const next = Math.max(0.72, Math.min(1, width / scroll));
    dom.brandVersion.style.setProperty("--brand-version-scale", next.toFixed(3));
  });
}

function executorLabel(value) {
  if (value === "codex") return "Codex";
  if (value === "claude-code") return "Claude Code";
  return "OpenCorvus";
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
  if (item.version) lines.push(t("executor.version", { version: item.version }));
  lines.push(item.detail);
  if (!item.selectable) {
    lines.push(item.discovered ? t("executor.detected_not_selectable") : t("executor.not_detected"));
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
  const buttons = dom.engineBar?.querySelectorAll("[data-executor]") || [];
  for (const button of buttons) {
    const value = button.dataset.executor || "opencode";
    const selectable = executorSelectable(value);
    button.dataset.active = value === state.executor ? "true" : "false";
    button.dataset.available = selectable ? "true" : "false";
    button.disabled = !selectable;
    button.title = executorTitle(value);
  }
  syncExecutorWidth();
}

function syncExecutorWidth() {
  if (!dom.engineBar) return;
  dom.engineBar.style.removeProperty("--engine-chip-width");
  const buttons = [...dom.engineBar.querySelectorAll("[data-executor]")];
  const width = buttons.reduce((max, button) => Math.max(max, Math.ceil(button.getBoundingClientRect().width)), 0);
  if (width > 0) {
    dom.engineBar.style.setProperty("--engine-chip-width", `${width}px`);
  }
}

function currentTaskSessionID() {
  return state.board?.task?.sessionID || "";
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

function activeDirectory() {
  return state.directory || state.path?.directory || "";
}

function absolutePath(value) {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(value);
}

function joinPath(base, value) {
  if (!base) return value;
  if (absolutePath(value)) return value;
  if (/[\\/]$/.test(base)) return `${base}${value}`;
  const sep = base.includes("\\") ? "\\" : "/";
  return `${base}${sep}${value}`;
}

function pathItems(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const windows = /^[A-Za-z]:[\\/]/.test(text);
  const unix = text.startsWith("/");
  const parts = text.split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return [];
  if (windows) {
    let path = `${parts[0]}\\`;
    const items = [{ label: parts[0], path }];
    return items.concat(parts.slice(1).map((part) => {
      path = joinPath(path, part);
      return { label: part, path };
    }));
  }
  if (unix) {
    let path = "/";
    const items = [{ label: "/", path }];
    return items.concat(parts.map((part) => {
      path = path === "/" ? `/${part}` : `${path}/${part}`;
      return { label: part, path };
    }));
  }
  let path = parts[0];
  const items = [{ label: parts[0], path }];
  return items.concat(parts.slice(1).map((part) => {
    path = joinPath(path, part);
    return { label: part, path };
  }));
}

function pathIcon(kind) {
  if (kind === "browse") {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 4.5h4l1.2 1.5h5.8v5.2a1.3 1.3 0 01-1.3 1.3H3.8a1.3 1.3 0 01-1.3-1.3V5.8a1.3 1.3 0 011.3-1.3z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
    </svg>`;
  }
  if (kind === "new") {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>`;
  }
  return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
  </svg>`;
}

function pathBreadcrumb(value) {
  const browse = escapeHtml(t("cwd.browse"));
  const create = escapeHtml(t("cwd.new"));
  const reset = escapeHtml(t("cwd.reset"));
  if (!value) {
    return `
      <span class="task-dir-shell" data-empty="true">
        <span class="task-dir-actions">
          <button type="button" class="task-dir-tool" data-path-action="browse" title="${browse}" aria-label="${browse}">${pathIcon("browse")}</button>
          <button type="button" class="task-dir-tool" data-path-action="create" title="${create}" aria-label="${create}">${pathIcon("new")}</button>
        </span>
        <button type="button" class="task-dir-empty" data-path-action="browse" title="${browse}" aria-label="${browse}">${escapeHtml(t("cwd.unavailable"))}</button>
      </span>
    `;
  }
  const items = pathItems(value);
  const open = t("cwd.open");
  const choose = t("cwd.choose_level");
  const resetTool = state.directory
    ? `<span class="task-dir-actions"><button type="button" class="task-dir-tool danger" data-path-action="reset" title="${reset}" aria-label="${reset}">${pathIcon("reset")}</button></span>`
    : "";
  const nodes = items.map((item, index) => {
    const current = index === items.length - 1 ? ' data-current="true"' : "";
    const step = index
      ? `<button type="button" class="task-dir-step" data-path-set=${jsonAttr(items[index - 1].path)} title="${escapeHtml(`${choose}: ${items[index - 1].path}`)}" aria-label="${escapeHtml(`${choose}: ${items[index - 1].path}`)}">/</button>`
      : "";
    return `${step}<button type="button" class="task-dir-node" data-path-open=${jsonAttr(item.path)} title="${escapeHtml(`${open}: ${item.path}`)}" aria-label="${escapeHtml(`${open}: ${item.path}`)}"${current}>${escapeHtml(item.label)}</button>`;
  }).join("");
  return `
    <span class="task-dir-shell">
      <span class="task-dir-actions">
        <button type="button" class="task-dir-tool" data-path-action="browse" title="${browse}" aria-label="${browse}">${pathIcon("browse")}</button>
        <button type="button" class="task-dir-tool" data-path-action="create" title="${create}" aria-label="${create}">${pathIcon("new")}</button>
      </span>
      <span class="task-dir-path">${nodes}</span>
      ${resetTool}
    </span>
  `;
}

function canInitGit() {
  return !!activeDirectory() && state.connected && !state.vcs?.branch;
}

function resetProjectScope() {
  state.selectedTaskID = "";
  state.chatSessionID = "";
  state.tasks = [];
  state.sessions = [];
  state.managedSession = null;
  state.path = null;
  state.vcs = null;
  stopPolling();
  stopSSE();
  state.board = null;
  state.boardEtag = "";
  state.boardUpdatedAt = 0;
  state.sessionUpdatedAt = 0;
  state.session = [];
  renderClear();
  renderMeta();
  renderManagedSessionList();
}

async function reloadProjectScope() {
  await Promise.all([loadTasks(), loadManagedSessions(), loadMeta(), loadExtensions(), loadConfigInfo(), loadExecutors(), loadKnowledge()]);
}

async function setDirectory(value) {
  const next = typeof value === "string" ? value.trim() : "";
  if (next === state.directory) return;

  state.directory = next;
  resetProjectScope();

  await persistOverlaySettings();
  const ok = await checkConnection();
  if (!ok) return;
  await reloadProjectScope();
}

async function initGitCurrent(options = {}) {
  const dir = activeDirectory();
  if (!dir || !canInitGit()) return false;
  try {
    const result = await apiJson("project/current/init-git", {
      method: "POST",
    });
    resetProjectScope();
    await reloadProjectScope();
    if (options.notify !== false) {
      await nativeMessage(result?.created ? t("git.init_done", { dir }) : t("git.init_exists", { dir }), {
        title: t("git.init"),
        kind: "info",
      });
    }
    return true;
  } catch (e) {
    AppLog.error("ui", "Failed to initialize Git", { error: String(e) });
    await nativeMessage(errorText("git.init_failed", e), {
      title: t("git.init"),
      kind: "error",
    });
    return false;
  }
}

async function browseDirectory() {
  try {
    const selected = await pickDirectory(activeDirectory());
    if (!selected) return;
    await setDirectory(selected);
  } catch (e) {
    AppLog.error("ui", "Failed to set working directory", { error: String(e) });
    await nativeMessage(errorText("cwd.set_failed", e), {
      title: t("cwd.title"),
      kind: "error",
    });
  }
}

async function createDirectory() {
  try {
    const parent = await pickDirectory(activeDirectory());
    if (!parent) return;
    const name = await nativePrompt(t("cwd.create_prompt"), {
      title: t("cwd.create_title"),
      okLabel: t("common.create"),
      inputLabel: t("cwd.folder"),
      inputPlaceholder: t("cwd.folder_placeholder"),
    });
    const value = name?.trim();
    if (!value) return;
    const target = joinPath(parent, value);
    const created = await tauriInvoke("overlay_create_dir", { path: target }).catch(() => undefined);
    if (!created) throw new Error(t("cwd.create_unavailable"));
    await setDirectory(target);
    if (state.initGit) {
      await initGitCurrent({ notify: false });
    }
  } catch (e) {
    AppLog.error("ui", "Failed to create working directory", { error: String(e) });
    await nativeMessage(errorText("cwd.create_failed", e), {
      title: t("cwd.title"),
      kind: "error",
    });
  }
}

async function openDirectory(target = activeDirectory()) {
  try {
    if (!target) return;
    const opened = await nativeOpen(target);
    if (opened) return;
    await nativeMessage(target, {
      title: t("cwd.title"),
      kind: "info",
    });
  } catch (e) {
    AppLog.error("ui", "Failed to open working directory", { error: String(e) });
    await nativeMessage(errorText("cwd.open_failed", e), {
      title: t("cwd.title"),
      kind: "error",
    });
  }
}

async function resetDirectory() {
  try {
    await setDirectory("");
  } catch (e) {
    AppLog.error("ui", "Failed to reset working directory", { error: String(e) });
    await nativeMessage(errorText("cwd.reset_failed", e), {
      title: t("cwd.title"),
      kind: "error",
    });
  }
}

function renderMeta() {
  const dir = activeDirectory();
  dom.taskDir.innerHTML = pathBreadcrumb(dir);
  dom.taskDir.title = dir || t("cwd.unavailable");
  dom.taskDir.dataset.empty = dir ? "false" : "true";
  const path = dom.taskDir.querySelector(".task-dir-path");
  if (path) path.scrollLeft = path.scrollWidth;

  const actionable = canInitGit();
  const label = gitLabel(state.vcs, dir);
  dom.taskGit.textContent = label;
  dom.taskGit.dataset.state = actionable ? "action" : state.vcs?.dirty ? "dirty" : state.vcs?.clean ? "clean" : "idle";
  dom.taskGit.dataset.actionable = String(actionable);
  dom.taskGit.disabled = !actionable;
  dom.taskGit.title = gitTitle(state.vcs, dir);
  renderExecutor();
}

function gitLabel(vcs, dir) {
  if (!dir) return t("git.unavailable");
  if (!vcs?.branch) return t("git.init");
  const parts = [vcs.branch];
  if (vcs.ahead) parts.push(`+${vcs.ahead}`);
  if (vcs.behind) parts.push(`-${vcs.behind}`);
  if (vcs.conflicts) parts.push(t("git.conflicts", { count: vcs.conflicts }));
  if (vcs.dirty) {
    const changes = [];
    if (vcs.staged) changes.push(t("git.staged", { count: vcs.staged }));
    if (vcs.modified) changes.push(t("git.modified", { count: vcs.modified }));
    if (vcs.untracked) changes.push(t("git.untracked", { count: vcs.untracked }));
    parts.push(changes.join(" "));
  } else {
    parts.push(t("git.clean"));
  }
  return parts.filter(Boolean).join(" · ");
}

function gitTitle(vcs, dir) {
  if (!dir) return "";
  if (!vcs?.branch) return t("git.init_title");
  return [
    t("git.branch", { value: vcs.branch }),
    t("git.clean_title", { value: vcs.clean ? t("common.yes") : t("common.no") }),
    t("git.staged", { count: vcs.staged ?? 0 }),
    t("git.modified", { count: vcs.modified ?? 0 }),
    t("git.untracked", { count: vcs.untracked ?? 0 }),
    t("git.conflicts", { count: vcs.conflicts ?? 0 }),
    t("git.ahead", { count: vcs.ahead ?? 0 }),
    t("git.behind", { count: vcs.behind ?? 0 }),
  ].join("\n");
}

// ── Task and Session Helpers ──

function clipText(value, limit = 80) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function sortedTasks(data) {
  return [...(Array.isArray(data?.tasks) ? data.tasks : [])]
    .sort((a, b) => (b.updated_at || b.task?.time?.updated || 0) - (a.updated_at || a.task?.time?.updated || 0));
}

function sessionTitle(session) {
  return clipText(session?.title || session?.id || "", 72);
}

function sessionItem(sessionID) {
  if (!sessionID) return null;
  return [state.managedSession, ...state.sessions]
    .find((item) => item?.id === sessionID) || null;
}

function sessionRow(item, meta = "") {
  const active = currentSessionID() === item.id ? ' data-active="true"' : "";
  const badge = "";
  const title = escapeHtml(item.title || item.id);
  return `<div class="session-row-mini"${active} title="${title}">
    <button type="button" class="session-row-main" data-session-id="${escapeHtml(item.id)}" title="${title}">
      <div class="session-row-head">
        <strong>${escapeHtml(sessionTitle(item) || item.id)}</strong>
        ${badge}
      </div>
      <span>${escapeHtml(clipText(item.id, 24))}</span>
      <small>${escapeHtml(meta)}</small>
    </button>
    <button
      type="button"
      class="session-row-delete"
      data-session-delete="${escapeHtml(item.id)}"
      title="${escapeHtml(t("common.delete"))}"
      aria-label="${escapeHtml(t("common.delete"))}"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3.5 4.5h9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M6.5 2.75h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M5.25 4.5v7.25a1 1 0 001 1h3.5a1 1 0 001-1V4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>`;
}

function taskIDForSession(sessionID, items = state.tasks) {
  if (!sessionID) return "";
  return items.find((item) => item?.task?.sessionID === sessionID)?.task?.id || "";
}

async function resolveTaskIDForSession(sessionID) {
  const taskID = taskIDForSession(sessionID);
  if (taskID) return taskID;
  try {
    const data = await apiJson("tasks?limit=200");
    const items = sortedTasks(data);
    const next = taskIDForSession(sessionID, items);
    if (!next) return "";
    state.tasks = items;
    return next;
  } catch {
    return "";
  }
}

function renderSidebar() {
  if (!dom.sidebar || !dom.btnSidebarToggle) return;
  dom.sidebar.dataset.collapsed = state.sidebarCollapsed ? "true" : "false";
  const label = state.sidebarCollapsed ? t("sidebar.open") : t("sidebar.close");
  dom.btnSidebarToggle.title = label;
  dom.btnSidebarToggle.setAttribute("aria-label", label);
  renderPaneLayout();
}

let paneDrag = null;

function resizePane(side, clientX) {
  const scale = currentUIScale();
  const railMin = 180 * scale;
  const railMax = 520 * scale;
  const chatMin = 420 * scale;
  if (side === "left") {
    const rect = dom.panelBody?.getBoundingClientRect();
    if (!rect) return;
    const { sections } = resolvedPaneWidths();
    const leftHandle = paneHandleWidth(dom.leftPaneResizer);
    const rightHandle = paneHandleWidth(dom.rightPaneResizer);
    const max = Math.max(railMin, rect.width - sections - leftHandle - rightHandle - chatMin);
    state.sidebarWidth = Math.round(clampNumber(clientX - rect.left, railMin, Math.min(railMax, max)));
    renderPaneLayout();
    return;
  }
  const rect = dom.workspaceMain?.getBoundingClientRect();
  if (!rect) return;
  const rightHandle = paneHandleWidth(dom.rightPaneResizer);
  const max = Math.max(railMin, rect.width - rightHandle - chatMin);
  state.sectionsWidth = Math.round(clampNumber(rect.right - clientX, railMin, Math.min(railMax, max)));
  renderPaneLayout();
}

function onPaneResizeMove(event) {
  if (!paneDrag) return;
  resizePane(paneDrag.side, event.clientX);
}

async function stopPaneResize() {
  if (!paneDrag) return;
  const handle = paneDrag.side === "left" ? dom.leftPaneResizer : dom.rightPaneResizer;
  if (handle) delete handle.dataset.active;
  paneDrag = null;
  delete document.body.dataset.resizing;
  window.removeEventListener("pointermove", onPaneResizeMove);
  window.removeEventListener("pointerup", stopPaneResize);
  window.removeEventListener("pointercancel", stopPaneResize);
  await persistOverlaySettings();
}

function startPaneResize(side, event) {
  if (event.button != null && event.button !== 0) return;
  if (side === "left" && (state.sidebarCollapsed || paneHandleWidth(dom.leftPaneResizer) === 0)) return;
  if (side === "right" && paneHandleWidth(dom.rightPaneResizer) === 0) return;
  paneDrag = { side };
  const handle = side === "left" ? dom.leftPaneResizer : dom.rightPaneResizer;
  if (handle) handle.dataset.active = "true";
  document.body.dataset.resizing = "true";
  window.addEventListener("pointermove", onPaneResizeMove);
  window.addEventListener("pointerup", stopPaneResize);
  window.addEventListener("pointercancel", stopPaneResize);
  resizePane(side, event.clientX);
  event.preventDefault();
}

async function syncManagedSession(sessionID = currentSessionID()) {
  if (!sessionID) {
    state.managedSession = null;
    renderManagedSessionList();
    return;
  }
  if (state.managedSession?.id === sessionID) {
    renderManagedSessionList();
    return;
  }
  await selectManagedSession(sessionID);
}

async function loadTasks() {
  try {
    const data = await apiJson("tasks");
    state.tasks = sortedTasks(data);
    if (state.selectedTaskID && !state.tasks.some((item) => item.task.id === state.selectedTaskID)) {
      state.selectedTaskID = "";
      state.board = null;
      state.chatSessionID = "";
      state.session = [];
      renderClear();
    }
    // Auto-select only if there is an active (in-progress) task
    if (!state.selectedTaskID && !state.chatSessionID && state.tasks.length > 0) {
      const active = state.tasks.find((t) =>
        ["running", "planning", "evaluating", "blocked", "queued"].includes(t.task.status)
      );
      if (active) selectTask(active.task.id);
    }
  } catch {
    // silent
  }
}

// ── Task Selection ──

async function selectTask(taskID) {
  if (taskID === state.selectedTaskID && !state.chatSessionID && state.board) return;
  state.selectedTaskID = taskID;
  state.chatSessionID = "";
  stopPolling();
  stopSSE();
  state.board = null;
  state.boardEtag = "";
  state.boardUpdatedAt = 0;
  state.sessionUpdatedAt = 0;
  state.session = [];
  renderClear();

  if (!taskID) {
    setTaskStatus("idle", { visible: false });
    state.session = [];
    renderSession();
    await syncManagedSession("");
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

function scheduleBoard(delay = 0) {
  if (state.boardKick) clearTimeout(state.boardKick);
  state.boardKick = setTimeout(() => {
    state.boardKick = null;
    loadBoard();
  }, delay);
}

async function loadBoard() {
  if (!state.selectedTaskID) return;
  // Don't reload while an interaction button click is in flight
  if (typeof _interactionBusy !== "undefined" && _interactionBusy) return;
  if (state.boardLoading) {
    state.boardQueued = true;
    return state.boardLoading;
  }
  const taskID = state.selectedTaskID;
  state.boardLoading = (async () => {
    try {
      const headers = apiHeaders();
      if (state.boardEtag) headers["If-None-Match"] = state.boardEtag;
      const res = await fetch(apiUrl(`task/${taskID}/board?sync=0`), {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (taskID !== state.selectedTaskID) return;
      if (res.status === 304) {
        state.boardUpdatedAt = Date.now();
        return;
      }
      if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
      const etag = res.headers.get("etag");
      if (etag) state.boardEtag = etag;
      state.board = await res.json();
      state.boardUpdatedAt = Date.now();
      renderBoard();
      await loadChanges();
      if (!state.chatSessionID) await syncManagedSession(currentTaskSessionID());
    } catch {
      // silent
    } finally {
      state.boardLoading = null;
      if (state.boardQueued) {
        state.boardQueued = false;
        queueMicrotask(() => loadBoard());
      }
    }
  })();
  return state.boardLoading;
}

// ── Control Conversation ──

function scheduleConversation(delay = 0) {
  if (state.sessionKick) clearTimeout(state.sessionKick);
  state.sessionKick = setTimeout(() => {
    state.sessionKick = null;
    loadConversation();
  }, delay);
}

async function loadConversation() {
  const target = conversationTarget();
  const targetKey = conversationTargetKey(target);
  if (state.sessionLoading) {
    state.sessionQueued = true;
    return state.sessionLoading;
  }
  state.sessionLoading = (async () => {
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

      if (targetKey !== conversationTargetKey(conversationTarget())) return;
      state.session = result;
      state.sessionUpdatedAt = Date.now();
      renderSession();
      if (!state.selectedTaskID || state.chatSessionID) {
        await loadChanges();
      }
    } catch (e) {
      AppLog.error("ui", "Failed to load conversation", { error: String(e) });
      if (targetKey !== conversationTargetKey(conversationTarget())) return;
      state.session = [];
      state.sessionUpdatedAt = Date.now();
      renderSession();
      if (!state.selectedTaskID || state.chatSessionID) {
        await loadChanges();
      }
    } finally {
      state.sessionLoading = null;
      if (state.sessionQueued) {
        state.sessionQueued = false;
        queueMicrotask(() => loadConversation());
      }
    }
  })();
  return state.sessionLoading;
}

function currentSessionID() {
  if (state.chatSessionID) return state.chatSessionID;
  return state.board?.task?.sessionID || "";
}

function conversationTarget() {
  if (state.chatSessionID) {
    return {
      kind: "session",
      sessionID: state.chatSessionID,
    };
  }
  if (state.selectedTaskID) {
    return {
      kind: "task",
      taskID: state.selectedTaskID,
    };
  }
  return {
    kind: "fallback",
  };
}

function conversationTargetKey(target = conversationTarget()) {
  if (target.sessionID) return `session:${target.sessionID}`;
  if (target.taskID) return `task:${target.taskID}`;
  return "";
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
    AppLog.error("ui", "Failed to load session diff", { error: String(e) });
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
  state.sseConnected = false;

  (async () => {
    try {
      const res = await fetch(apiUrl(`task/${taskID}/events`), {
        headers: apiHeaders(),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) return;
      state.sseConnected = true;
      AppLog.info("sse", "connected", { taskID });
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
            } catch (e) { AppLog.debug("sse", "malformed event: " + line, { error: String(e) }); }
          }
        }
      }
    } catch (e) {
      state.sseConnected = false;
      if (e.name === "AbortError") return;
      AppLog.warn("sse", "disconnected, retrying in 5s", { taskID, error: String(e) });
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
  state.sseConnected = false;
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
    scheduleBoard(BOARD_EVENT_DEBOUNCE);
    if (type.includes("interaction.")) {
      scheduleConversation(SESSION_EVENT_DEBOUNCE);
    }
  }
}

// ── Polling ──

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(() => {
    if (!state.sseConnected || Date.now() - state.boardUpdatedAt > SSE_BACKSTOP) {
      loadBoard();
    }
    loadMeta();
  }, POLL_INTERVAL);
  state.sessionTimer = setInterval(() => {
    if (!state.sseConnected || Date.now() - state.sessionUpdatedAt > SSE_BACKSTOP) {
      loadConversation();
    }
  }, SESSION_POLL);
}

function stopPolling() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  if (state.sessionTimer) { clearInterval(state.sessionTimer); state.sessionTimer = null; }
  if (state.elapsedTimer) { clearInterval(state.elapsedTimer); state.elapsedTimer = null; }
  if (state.boardKick) { clearTimeout(state.boardKick); state.boardKick = null; }
  if (state.sessionKick) { clearTimeout(state.sessionKick); state.sessionKick = null; }
}

// ── Rendering: Board ──

function renderBoard() {
  if (!state.board) return;
  const { task, plan, overview, lanes, evaluation, delivery, interactions, spec } = state.board;

  // Status
  setTaskStatus(task.status);
  startElapsedTimer(task.time.started || task.time.created);

  // Overview
  renderOverview(overview, task);

  // Spec
  renderSpec(spec);

  // Plan
  renderPlan(plan);

  // Goals
  const goalsLane = (lanes || []).find((l) => l.id === "goals");
  renderGoals(goalsLane?.cards || []);

  // Criteria + Evaluation
  renderCriteria(task, evaluation);

  // Evaluation
  renderEvaluation(evaluation, delivery);

  // Interactions
  renderInteractions(interactions || []);
  renderExecutor();

  // Re-render session to include updated board context (goals, evaluation)
  renderSession();
  refreshSectionDetail();
}

function setTaskStatus(status, options = {}) {
  const visible = options.visible ?? true;
  if (dom.taskStatus) dom.taskStatus.hidden = !visible;
  dom.statusDot.dataset.status = status;
  dom.statusDot.innerHTML = statusIcon(status);
  dom.statusLabel.textContent = statusLabel(status);
  if (!visible) {
    dom.taskStatus?.removeAttribute("title");
    dom.taskStatus?.removeAttribute("aria-label");
    return;
  }
  updateTaskStatusDetail(status);
}

function statusLabel(status) {
  const map = {
    idle: t("task.status.idle"),
    queued: t("task.status.queued"),
    planning: t("task.status.planning"),
    running: t("task.status.running"),
    blocked: t("task.status.blocked"),
    evaluating: t("task.status.evaluating"),
    completed: t("task.status.completed"),
    failed: t("task.status.failed"),
    cancelled: t("task.status.cancelled"),
  };
  return map[status] || status;
}

function statusIcon(status) {
  const map = {
    idle: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="4.5"/></svg>`,
    queued: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="4.5"/><path d="M8 5.6v2.8l2 1.2"/></svg>`,
    planning: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 3.5v9"/><path d="M5 5.5h6"/><path d="M5 10.5h4"/><circle cx="5" cy="3.5" r="1"/><circle cx="11" cy="5.5" r="1"/><circle cx="9" cy="10.5" r="1"/></svg>`,
    running: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 4.8v6.4l4.8-3.2z"/></svg>`,
    blocked: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3.6l4.3 7.8H3.7z"/><path d="M8 6.2v2.5"/></svg>`,
    evaluating: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="3.5"/><path d="M9.8 9.8l2.7 2.7"/></svg>`,
    completed: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.5 8.3l2.1 2.1 4.9-4.9"/></svg>`,
    failed: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 5l6 6"/><path d="M11 5l-6 6"/></svg>`,
    cancelled: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="4.5"/><path d="M5.4 10.6l5.2-5.2"/></svg>`,
  };
  return map[status] || map.idle;
}

function updateTaskStatusDetail(status = dom.statusDot?.dataset.status || "idle") {
  const detail = [statusLabel(status), dom.elapsed?.textContent?.trim() || ""].filter(Boolean).join(" · ");
  if (!dom.taskStatus) return;
  dom.taskStatus.title = detail;
  dom.taskStatus.setAttribute("aria-label", detail);
}

function startElapsedTimer(startTime) {
  if (state.elapsedTimer) clearInterval(state.elapsedTimer);
  if (!startTime) {
    dom.elapsed.textContent = "";
    updateTaskStatusDetail();
    return;
  }
  const update = () => {
    const end = state.board?.task?.time?.completed || Date.now();
    dom.elapsed.textContent = formatDuration(end - startTime);
    updateTaskStatusDetail();
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
  if (h > 0) return t("time.duration.hour_minute", { hours: h, minutes: m % 60 });
  if (m > 0) return t("time.duration.minute_second", { minutes: m, seconds: s % 60 });
  return t("time.duration.second", { seconds: s });
}

// ── Overview Rendering ──

function overviewActionsHtml(controls) {
  if (!controls?.canRetry && !controls?.canReplan && !controls?.canCancel) return "";
  let html = '<div class="section-actions">';
  if (controls.canRetry) html += `<button type="button" class="btn btn-primary" data-task-action="retry">${escapeHtml(t("task.action.retry"))}</button>`;
  if (controls.canReplan) html += `<button type="button" class="btn btn-ghost" data-task-action="replan">${escapeHtml(t("task.action.replan"))}</button>`;
  if (controls.canCancel) html += `<button type="button" class="btn btn-ghost" data-task-action="cancel">${escapeHtml(t("common.cancel"))}</button>`;
  html += "</div>";
  return html;
}

function overviewFailureHtml(failure) {
  if (!failure) return "";
  return `<div class="interaction-alert" style="border-color:rgba(248,113,113,0.15);background:var(--bad-dim)">
    <div class="interaction-title" style="color:var(--bad)">${escapeHtml(failure.title)}</div>
    <div class="interaction-body md-content">${renderMarkdown(failure.summary)}</div>
  </div>`;
}

function renderOverview(overview, task) {
  const badge = dom.overviewBadge;
  const body = dom.overviewBody;
  if (!badge || !body) return;
  if (!overview) {
    badge.textContent = "";
    body.innerHTML = `<p class="empty-hint">${escapeHtml(t("empty.overview"))}</p>`;
    return;
  }

  badge.textContent = statusLabel(task.status);
  badge.dataset.tone =
    task.status === "completed" ? "good" :
    task.status === "failed" ? "bad" :
    ["running", "planning", "evaluating"].includes(task.status) ? "accent" :
    task.status === "blocked" ? "warn" : "";

  body.innerHTML = `
    <div class="plan-summary md-content">${renderMarkdown(overview.headline)}</div>
    <div class="md-content" style="font-size:var(--ui-font-meta);color:var(--text);margin-top:4px;line-height:1.5">${renderMarkdown(overview.summary)}</div>
    ${overview.nextStep ? `<div style="margin-top:6px;padding:5px 8px;border-radius:var(--radius);background:var(--accent-dim);border-left:2px solid var(--accent);font-size:var(--ui-font-small);color:var(--text)">
      <strong style="color:var(--text-strong)">${escapeHtml(overview.nextStep.title)}</strong>
      ${overview.nextStep.detail ? `<div class="md-content" style="margin-top:2px;color:var(--text-soft)">${renderMarkdown(overview.nextStep.detail)}</div>` : ""}
    </div>` : ""}
    ${overviewFailureHtml(overview.currentFailure)}
    ${overviewActionsHtml(overview.controls || {})}
  `;
}

function detailMetaHtml(values) {
  return values
    .filter(Boolean)
    .map((value) => `<span class="detail-meta-chip">${escapeHtml(value)}</span>`)
    .join("");
}

function detailPre(value, extra = "") {
  if (extra) {
    return `<pre class="detail-pre ${extra}">${escapeHtml(value || "")}</pre>`;
  }
  return `<div class="detail-md md-content">${renderMarkdown(value || "")}</div>`;
}

function goalItemsHtml(cards) {
  return cards
    .map(
      (card) => `
      <div class="goal-item">
        <span class="goal-status-icon" data-status="${card.status || "pending"}">${goalIcon(card.status)}</span>
      <div class="goal-content">
          <div class="goal-desc md-content">${renderMarkdown(card.title)}</div>
          ${card.detail ? `<div class="goal-criteria md-content">${renderMarkdown(card.detail)}</div>` : ""}
        </div>
        ${card.metadata?.priority ? `<span class="goal-priority" data-priority="${card.metadata.priority}">${card.metadata.priority}</span>` : ""}
        <div class="goal-actions">
          <button
            type="button"
            class="btn btn-ghost mini"
            data-goal-action="edit"
            data-goal-id=${jsonAttr(card.id)}
            data-goal-title=${jsonAttr(card.title)}
            data-goal-detail=${jsonAttr(card.detail || "")}
          >${escapeHtml(t("common.edit"))}</button>
          <button type="button" class="btn btn-ghost mini danger" data-goal-action="delete" data-goal-id=${jsonAttr(card.id)}>${escapeHtml(t("common.delete"))}</button>
        </div>
      </div>`,
    )
    .join("");
}

function interactionAlertHtml(interaction) {
  const actions =
    interaction.type === "permission"
      ? `<button class="btn btn-primary" data-action="always">${escapeHtml(t("interaction.always_allow"))}</button>
         <button class="btn btn-ghost" data-action="once">${escapeHtml(t("interaction.allow_once"))}</button>
         <button class="btn btn-ghost" data-action="reject">${escapeHtml(t("interaction.reject"))}</button>`
      : `<button class="btn btn-primary" data-action="answer">${escapeHtml(t("interaction.answer"))}</button>
         <button class="btn btn-ghost" data-action="reject">${escapeHtml(t("interaction.skip"))}</button>`;
  return `<div class="interaction-alert" data-id="${escapeHtml(interaction.id)}">
    <div class="interaction-title">${interaction.type === "permission" ? "\uD83D\uDD12" : "\u2753"} ${escapeHtml(interaction.title)}</div>
    <div class="interaction-body md-content">${renderMarkdown(interaction.body)}</div>
    <div class="interaction-actions">${actions}</div>
  </div>`;
}

function bindInteractionActions(root) {
  root?.querySelectorAll?.(".interaction-alert [data-action]")?.forEach((btn) => {
    if (btn.dataset.bound === "true") return;
    btn.dataset.bound = "true";
    btn.addEventListener("click", () => {
      const alert = btn.closest(".interaction-alert");
      const id = alert?.dataset.id;
      if (!id) return;
      const action = btn.dataset.action;
      if (action === "reject") rejectInteraction(id);
      else resolveInteraction(id, action);
    });
  });
}

function changeRowsHtml(attr = "data-change-index") {
  return state.changes
    .map(
      (item, index) => `
        <button type="button" class="change-row" ${attr}="${index}" title="${escapeHtml(item.file)}">
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
    .join("");
}

function renderChanges() {
  if (!dom.changesBody || !dom.changesBadge) return;
  const files = state.changes;
  if (!files.length) {
    dom.changesBadge.textContent = "";
    delete dom.changesBadge.dataset.tone;
    const hint = currentSessionID()
      ? t("empty.files")
      : state.selectedTaskID || state.chatSessionID
        ? t("files.unavailable")
        : t("files.select_target");
    dom.changesBody.innerHTML = `<p class="empty-hint">${escapeHtml(hint)}</p>`;
    return;
  }

  const additions = files.reduce((sum, item) => sum + item.additions, 0);
  const deletions = files.reduce((sum, item) => sum + item.deletions, 0);
  dom.changesBadge.textContent = String(files.length);
  dom.changesBadge.dataset.tone = "accent";
  dom.changesBody.innerHTML = `
    <div class="changes-summary">
      <span>${tc("files.changed", files.length)}</span>
      <span class="changes-total">
        <span data-tone="add">+${additions}</span>
        <span data-tone="del">-${deletions}</span>
      </span>
    </div>
    <div class="changes-list">${changeRowsHtml()}</div>
  `;
}

function changeStatusLabel(status) {
  if (status === "added") return t("files.status.added");
  if (status === "deleted") return t("files.status.deleted");
  return t("files.status.modified");
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
    return `<div class="diff-empty"><p class="empty-hint">${escapeHtml(t("diff.no_preview"))}</p></div>`;
  }
  const ops = collapseDiffOps(buildDiffOps(item.before, item.after));
  const changed = ops.some((item) => item.kind === "add" || item.kind === "del");
  if (!changed) {
    return `<div class="diff-empty"><p class="empty-hint">${escapeHtml(t("diff.no_preview"))}</p></div>`;
  }
  return `<div class="diff-lines">
    ${ops
      .map((line) => {
        if (line.kind === "skip") {
          return `<div class="diff-row" data-kind="skip">
            <div class="diff-gutter">...</div>
            <div class="diff-num"></div>
            <div class="diff-num"></div>
            <div class="diff-code">${escapeHtml(tc("diff.unchanged_hidden", line.count))}</div>
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

const performTaskAction = async function (action) {
  if (!state.selectedTaskID) return;
  try {
    await panelMessage(`Perform ${action} on task ${state.selectedTaskID}.`, {
      taskID: state.selectedTaskID,
      ui_context: "task_controls",
    });
    await loadBoard();
  } catch (e) {
    AppLog.error("ui", `Failed to ${action} task`, { error: String(e) });
  }
};

const openGoalDialog = function () {
  if (!state.selectedTaskID) return;
  dom.goalDialogTitle.textContent = t("goal.new_title");
  dom.goalId.value = "";
  dom.goalDescription.value = "";
  dom.goalCriteria.value = "";
  dom.goalDialog.showModal();
};

const editGoal = function (id, description, criteria) {
  dom.goalDialogTitle.textContent = t("goal.edit_title");
  dom.goalId.value = id || "";
  dom.goalDescription.value = description || "";
  dom.goalCriteria.value = criteria || "";
  dom.goalDialog.showModal();
};

const deleteGoalAction = async function (id) {
  if (!id) return;
  const accepted = await nativeConfirm(t("goal.delete_confirm"), {
    title: t("goal.delete_title"),
    okLabel: t("common.delete"),
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
    AppLog.error("ui", "Failed to delete goal", { error: String(e) });
    await nativeMessage(errorText("goal.delete_failed", e), {
      title: t("goal.delete_title"),
      kind: "error",
    });
  }
};

// ── Spec Rendering ──

function renderSpec(spec) {
  if (!spec) {
    dom.specBadge.textContent = "";
    dom.specBody.innerHTML = `<p class="empty-hint">${escapeHtml(t("empty.spec"))}</p>`;
    return;
  }
  dom.specBadge.textContent = t("common.active");
  dom.specBadge.dataset.tone = "accent";
  dom.specBody.innerHTML = `
    <div class="plan-summary md-content">${renderMarkdown(spec.content || "")}</div>
    <div class="plan-version">${stamp(spec.time?.created)}</div>
  `;
}

// ── Plan Rendering ──

function renderPlan(plan) {
  if (!plan) {
    dom.planBadge.textContent = "";
    dom.planBody.innerHTML = `<p class="empty-hint">${escapeHtml(t("empty.plan"))}</p>`;
    return;
  }
  dom.planBadge.textContent = `v${plan.version}`;
  dom.planBadge.dataset.tone = "accent";
  dom.planBody.innerHTML = `
    <div class="plan-summary md-content">${renderMarkdown(plan.summary)}</div>
    <div class="plan-version">${escapeHtml(t("plan.version", { version: plan.version }))} &middot; ${stamp(plan.time.created)}</div>
  `;
}

// ── Goals Rendering ──

function renderGoals(cards) {
  const passed = cards.filter((c) => c.status === "passed").length;
  const total = cards.length;
  if (total === 0) {
    dom.goalsBadge.textContent = "";
    dom.goalsBody.innerHTML = `${goalToolbar()}<p class="empty-hint">${escapeHtml(t("empty.goals"))}</p>`;
    return;
  }
  dom.goalsBadge.textContent = `${passed}/${total}`;
  dom.goalsBadge.dataset.tone = passed === total ? "good" : passed > 0 ? "warn" : "";

  dom.goalsBody.innerHTML = `${goalToolbar()}<div class="goals-list">${goalItemsHtml(cards)}</div>`;
}

function goalToolbar() {
  return `<div class="section-actions compact">
    <button type="button" class="btn btn-primary mini" data-goal-action="create">${escapeHtml(t("goal.new"))}</button>
  </div>`;
}

function goalIcon(status) {
  if (status === "passed") return "\u2713";
  if (status === "failed") return "\u2717";
  return "\u2022";
}

// ── Criteria Rendering ──

const COMMAND_CHECKS = [
  { key: "build", label: "Build", kind: "command", family: "build" },
  { key: "test", label: "Unit Tests", kind: "command", family: "test" },
  { key: "lint", label: "Lint", kind: "command", family: "lint" },
  { key: "verify_cmd", label: "Verify Command", kind: "command", family: "verify_cmd" },
];

const TOGGLE_CHECKS = [
  { key: "startup", label: "Startup", kind: "toggle", family: "runtime" },
  { key: "artifact", label: "Artifacts", kind: "toggle", family: "artifact" },
  { key: "visual", label: "Visual Check", kind: "toggle", family: "runtime" },
  { key: "puppeteer", label: "Puppeteer", kind: "toggle", family: "runtime" },
  { key: "ui_review", label: "UI Review", kind: "toggle", family: "review" },
  { key: "code_quality", label: "Code Quality", kind: "toggle", family: "review" },
  { key: "code_review", label: "Code Review", kind: "toggle", family: "review" },
  { key: "dead_code_review", label: "Dead Code Review", kind: "toggle", family: "review" },
  { key: "judge", label: "LLM Judge", kind: "toggle", family: "acceptance" },
  { key: "spec_check", label: "Spec Check", kind: "toggle", family: "acceptance" },
];

const CHECK_FAMILIES = [
  { key: "command", order: 0 },
  { key: "runtime", order: 1 },
  { key: "artifact", order: 2 },
  { key: "review", order: 3 },
  { key: "acceptance", order: 4 },
  { key: "custom", order: 5 },
];

function normalizeCheckName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_#:-]/g, "_");
}

function baseCheckName(value) {
  return normalizeCheckName(value).replace(/#\d+$/, "");
}

function checkLabel(key) {
  const known = {
    build: t("checks.build"),
    test: t("checks.test"),
    lint: t("checks.lint"),
    verify_cmd: t("checks.verify_cmd"),
    py_compile: t("checks.py_compile"),
    pytest: t("checks.pytest"),
    typecheck: t("checks.typecheck"),
    ruff: t("checks.ruff"),
    mypy: t("checks.mypy"),
    startup: t("checks.startup"),
    artifact: t("checks.artifact"),
    visual: t("checks.visual"),
    puppeteer: t("checks.puppeteer"),
    ui_review: t("checks.ui_review"),
    code_quality: t("checks.code_quality"),
    code_review: t("checks.code_review"),
    dead_code_review: t("checks.dead_code_review"),
    judge: t("checks.judge"),
    spec_check: t("checks.spec_check"),
  };
  if (known[key]) return known[key];
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((item) => item[0]?.toUpperCase() + item.slice(1))
    .join(" ");
}

function checkFamilyKey(family, name) {
  const base = baseCheckName(name);
  if (["build", "test", "lint", "verify_cmd"].includes(family) || ["build", "test", "lint", "verify_cmd"].includes(base)) {
    return "command";
  }
  if (["runtime", "artifact", "review", "acceptance", "custom"].includes(family)) return family;
  if (["startup", "visual", "puppeteer"].includes(base)) return "runtime";
  if (base === "artifact") return "artifact";
  if (["ui_review", "code_quality", "code_review", "dead_code_review"].includes(base)) return "review";
  if (["judge", "spec_check"].includes(base)) return "acceptance";
  return "custom";
}

function checkFamilyText(key) {
  if (key === "command") return t("checks.family.command");
  if (key === "runtime") return t("checks.family.runtime");
  if (key === "artifact") return t("checks.family.artifact");
  if (key === "review") return t("checks.family.review");
  if (key === "acceptance") return t("checks.family.acceptance");
  return t("checks.family.custom");
}

function checkFamilyLabel(family, name) {
  return checkFamilyText(checkFamilyKey(family, name));
}

function groupChecks(items, resolve) {
  const groups = new Map();
  const order = new Map(CHECK_FAMILIES.map((item) => [item.key, item.order]));
  for (const item of items) {
    const key = resolve(item);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: checkFamilyText(key),
        items: [],
      });
    }
    groups.get(key).items.push(item);
  }
  return [...groups.values()].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
}

function checkConfig(task) {
  const checks = task?.metadata?.checks;
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) return {};
  return structuredClone(checks);
}

function hasExplicitChecks(config) {
  return Object.keys(config).length > 0;
}

function criteriaEnabledValue(key, value, fallback) {
  if (["build", "test", "lint", "verify_cmd"].includes(key)) {
    return value !== false && (value !== undefined || fallback);
  }
  // Per design doc: spec_check defaults to enabled (默认勾选)
  if (key === "spec_check" && value === undefined) return true;
  if (value === true) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return value.enabled !== false;
}

function checkCanToggle(key) {
  return ["artifact", "ui_review", "code_quality", "code_review", "dead_code_review", "judge", "spec_check"].includes(key);
}

function checkSelectionConfig(key, current) {
  const base = current && typeof current === "object" && !Array.isArray(current)
    ? structuredClone(current)
    : undefined;
  if (key === "artifact") return base || {};
  if (key === "ui_review") return { ...(base || {}), target: "web" };
  if (["code_quality", "code_review", "dead_code_review", "judge", "spec_check"].includes(key)) {
    return { ...(base || {}), enabled: true };
  }
  if (["startup", "visual", "puppeteer"].includes(key)) return base;
  return { ...(base || {}), enabled: true };
}

function aggregateCheckStatus(checks, key) {
  const matches = (Array.isArray(checks) ? checks : []).filter((item) => baseCheckName(item.name || item.label) === key);
  if (matches.length === 0) return "pending";
  if (matches.some((item) => item.status === "failed")) return "failed";
  if (matches.some((item) => item.status === "passed")) return "passed";
  if (matches.every((item) => item.status === "skipped")) return "skipped";
  return "pending";
}

function criteriaSpecs(task, evaluation) {
  const config = checkConfig(task);
  const named =
    config.named && typeof config.named === "object" && !Array.isArray(config.named)
      ? config.named
      : {};
  const seen = new Set();
  const specs = [];
  const showDefault = !hasExplicitChecks(config) && (!evaluation?.checks || evaluation.checks.length === 0);

  const push = (spec) => {
    if (seen.has(spec.key)) return;
    seen.add(spec.key);
    specs.push(spec);
  };

  for (const item of COMMAND_CHECKS) {
    const value = config[item.key];
    const visible =
      value !== undefined ||
      aggregateCheckStatus(evaluation?.checks, item.key) !== "pending" ||
      (showDefault && ["build", "test", "lint"].includes(item.key));
    if (!visible) continue;
    push({
      key: item.key,
      name: item.key,
      label: checkLabel(item.key),
      kind: item.kind,
      family: item.family,
      group: checkFamilyKey(item.family, item.key),
      enabled: criteriaEnabledValue(item.key, value, showDefault),
      readOnly: false,
    });
  }

  for (const item of TOGGLE_CHECKS) {
    const value = config[item.key];
    const visible =
      value !== undefined ||
      aggregateCheckStatus(evaluation?.checks, item.key) !== "pending" ||
      checkCanToggle(item.key);
    if (!visible) continue;
    push({
      key: item.key,
      name: item.key,
      label: checkLabel(item.key),
      kind: item.kind,
      family: item.family,
      group: checkFamilyKey(item.family, item.key),
      enabled: criteriaEnabledValue(item.key, value, false),
      readOnly: false,
    });
  }

  for (const [key, value] of Object.entries(named)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    push({
      key: `named:${key}`,
      name: key,
      label: value.label || checkLabel(key),
      kind: "named",
      family: value.family || undefined,
      group: checkFamilyKey(value.family || "", key),
      enabled: value.enabled !== false,
      readOnly: false,
    });
  }

  for (const check of evaluation?.checks || []) {
    const key = baseCheckName(check.name || check.label);
    if (!key) continue;
    if (seen.has(key) || seen.has(`named:${key}`)) continue;
    push({
      key: key,
      name: key,
      label: check.label || checkLabel(key),
      kind: "named",
      family: check.family || undefined,
      group: checkFamilyKey(check.family || "", key),
      enabled: true,
      readOnly: true,
    });
  }

  return specs;
}

function renderCriteria(task, evaluation) {
  const specs = criteriaSpecs(task, evaluation);
  state.criteriaSpecs = specs;

  if (specs.length === 0) {
    dom.criteriaList.innerHTML = `<div class="empty-hint">${escapeHtml(t("empty.checks"))}</div>`;
    dom.criteriaBadge.textContent = "";
    delete dom.criteriaBadge.dataset.tone;
    return;
  }

  dom.criteriaList.innerHTML = groupChecks(specs, (spec) => spec.group || "custom")
    .map((group) => `
      <section class="criteria-group" data-family="${escapeHtml(group.key)}">
        <div class="criteria-group-head">
          <div class="criteria-group-title">${escapeHtml(group.label)}</div>
          <div class="criteria-group-count">${escapeHtml(tc("checks.group_count", group.items.length, { count: group.items.length }))}</div>
        </div>
        <div class="criteria-group-list">
          ${group.items.map((spec) => `
            <label class="criteria-item"${spec.readOnly ? ' data-readonly="true"' : ""}>
              <input type="checkbox" data-check="${escapeHtml(spec.key)}"${spec.enabled ? " checked" : ""}${spec.readOnly ? " disabled" : ""}>
              <span class="check-mark"></span>
              <span class="criteria-copy">
                <span class="criteria-name">${escapeHtml(spec.label)}</span>
                <span class="criteria-desc">${escapeHtml(joinBullet([
                  checkFamilyLabel(spec.family || "", spec.name),
                  spec.readOnly ? t("detail.observed") : spec.enabled ? t("detail.enabled") : t("detail.disabled"),
                ]))}</span>
              </span>
              <span class="criteria-status" data-result="pending"></span>
              <span class="criteria-result">${escapeHtml(t("checks.pending"))}</span>
            </label>
          `).join("")}
        </div>
      </section>
    `)
    .join("");

  let enabledCount = 0;
  let passedCount = 0;
  dom.criteriaList.querySelectorAll(".criteria-item").forEach((item) => {
    const key = item.querySelector("input[type=checkbox]")?.dataset.check;
    const spec = specs.find((entry) => entry.key === key);
    if (!key || !spec) return;
    const enabled = isCriteriaEnabled(item);
    const status = enabled ? aggregateCheckStatus(evaluation?.checks, spec.name) : "off";
    setCriteriaResult(item, status);
    if (!enabled) return;
    enabledCount += 1;
    if (status === "passed") passedCount += 1;
  });

  if (enabledCount > 0) {
    dom.criteriaBadge.textContent = `${passedCount}/${enabledCount}`;
    dom.criteriaBadge.dataset.tone = passedCount === enabledCount ? "good" : passedCount > 0 ? "warn" : "";
    return;
  }
  dom.criteriaBadge.textContent = t("checks.zero_enabled");
  dom.criteriaBadge.dataset.tone = "";
}

function buildCheckConfig() {
  const current = checkConfig(state.board?.task);
  const next = structuredClone(current);
  const named =
    next.named && typeof next.named === "object" && !Array.isArray(next.named)
      ? structuredClone(next.named)
      : {};
  const selection = {};
  dom.criteriaList.querySelectorAll("input[type=checkbox][data-check]").forEach((input) => {
    selection[input.dataset.check] = input.checked;
  });

  for (const spec of state.criteriaSpecs) {
    if (spec.readOnly) continue;
    const enabled = selection[spec.key];
    if (enabled === undefined) continue;
    if (spec.kind === "named") {
      const currentNamed = named[spec.name];
      if (!currentNamed || typeof currentNamed !== "object" || Array.isArray(currentNamed)) continue;
      named[spec.name] = {
        ...currentNamed,
        enabled,
      };
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

// ── Evaluation Rendering ──

function renderEvaluation(evaluation, delivery) {
  if (!evaluation) {
    if (dom.criteriaBadge) { dom.criteriaBadge.textContent = ""; delete dom.criteriaBadge.dataset.tone; }
    if (dom.evalBody) dom.evalBody.innerHTML = delivery ? renderDeliveryCard(delivery) : "";
    return;
  }

  // Update section badge
  if (dom.criteriaBadge) {
    dom.criteriaBadge.textContent = evaluationVerdictLabel(evaluation.verdict);
    dom.criteriaBadge.dataset.tone =
      evaluation.verdict === "accepted" ? "good" :
      evaluation.verdict === "rejected" ? "bad" : "warn";
  }

  const errors = [];
  for (const check of evaluation.checks || []) {
    if (check.status === "failed" && check.evidence) {
      errors.push({
        name: check.label || checkLabel(baseCheckName(check.name || check.label)),
        family: checkFamilyLabel(check.family || "", check.name || check.label || ""),
        evidence: check.evidence,
      });
    }
  }

  // Build evalBody: only show errors and summary
  let html = "";

  if (errors.length > 0) {
    for (const err of errors) {
      html += `<div class="eval-error">
        <div class="eval-error-name">\u2717 ${escapeHtml(err.name)}</div>
        ${err.family ? `<div class="eval-error-meta">${escapeHtml(err.family)}</div>` : ""}
        <div class="eval-error-detail md-content">${renderMarkdown(err.evidence.slice(0, 400))}</div>
      </div>`;
    }
  }

  if (evaluation.summary) {
    html += `<div class="eval-summary md-content">${renderMarkdown(evaluation.summary)}</div>`;
  }

  if (delivery) {
    html += renderDeliveryCard(delivery);
  }

  if (dom.evalBody) dom.evalBody.innerHTML = html;
}

function renderDeliveryCard(delivery) {
  if (!delivery) return "";
  const fileCount = delivery.result?.changedFiles?.length || 0;
  const title = deliveryStatusLabel(delivery.status);
  return `<div class="delivery-card">
    <div class="delivery-title">${escapeHtml(title)}</div>
    <div class="delivery-summary md-content">${renderMarkdown(delivery.summary || delivery.result?.summary || "")}</div>
    ${fileCount > 0 ? `<div class="delivery-files">${escapeHtml(tc("delivery.files_changed", fileCount, { count: fileCount }))}</div>` : ""}
  </div>`;
}

function sectionDetail(kind) {
  if (kind === "spec") return specDetail();
  if (kind === "plan") return planDetail();
  if (kind === "goals") return goalsDetail();
  if (kind === "evaluation") return evaluationDetail();
  if (kind === "files") return filesDetail();
  if (kind === "overview") return overviewDetail();
  return null;
}

function specDetail() {
  const spec = state.board?.spec;
  if (!spec) {
    return {
      title: t("section.spec"),
      meta: "",
      html: `<p class="empty-hint">${escapeHtml(t("empty.spec"))}</p>`,
    };
  }
  return {
    title: t("section.spec"),
    meta: detailMetaHtml([detailStamp(spec.time?.created)]),
    html: `<div class="detail-stack">
      <section class="detail-card">
        <div class="detail-kicker">${escapeHtml(t("detail.specification"))}</div>
        ${detailPre(spec.content || t("detail.empty_value"))}
      </section>
    </div>`,
  };
}

function planDetail() {
  const plan = state.board?.plan;
  if (!plan) {
    return {
      title: t("section.plan"),
      meta: "",
      html: `<p class="empty-hint">${escapeHtml(t("empty.plan"))}</p>`,
    };
  }
  return {
    title: t("section.plan"),
    meta: detailMetaHtml([t("plan.version", { version: plan.version }), plan.status, detailStamp(plan.time.created)]),
    html: `<div class="detail-stack">
      <section class="detail-card">
        <div class="detail-kicker">${escapeHtml(t("detail.summary"))}</div>
        <div class="plan-summary detail-copy md-content">${renderMarkdown(plan.summary)}</div>
      </section>
      ${plan.prompt ? `<section class="detail-card">
        <div class="detail-kicker">${escapeHtml(t("detail.planner_prompt"))}</div>
        ${detailPre(plan.prompt)}
      </section>` : ""}
      ${plan.metadata ? `<section class="detail-card">
        <div class="detail-kicker">${escapeHtml(t("detail.metadata"))}</div>
        ${detailPre(JSON.stringify(plan.metadata, null, 2), "detail-pre-json")}
      </section>` : ""}
    </div>`,
  };
}

function goalsDetail() {
  const cards = (state.board?.lanes || []).find((lane) => lane.id === "goals")?.cards || [];
  const pending = (state.board?.interactions || []).filter((item) => item.status === "pending");
  const passed = cards.filter((card) => card.status === "passed").length;
  const total = cards.length;
  return {
    title: t("section.goals"),
    meta: detailMetaHtml([
      total > 0 ? t("detail.goal_progress", { passed, total }) : t("empty.goals"),
      pending.length > 0 ? tc("detail.pending_interactions_meta", pending.length, { count: pending.length }) : "",
    ]),
    html: `<div class="detail-stack">
      <section class="detail-card">
        <div class="detail-kicker">${escapeHtml(t("detail.goal_management"))}</div>
        ${goalToolbar()}
        ${total > 0 ? `<div class="goals-list detail-goals-list">${goalItemsHtml(cards)}</div>` : `<p class="empty-hint">${escapeHtml(t("empty.goals"))}</p>`}
      </section>
      ${pending.length > 0 ? `<section class="detail-card">
        <div class="detail-kicker">${escapeHtml(t("detail.pending_interactions"))}</div>
        <div class="detail-stack">${pending.map(interactionAlertHtml).join("")}</div>
      </section>` : ""}
    </div>`,
  };
}

function evaluationDetail() {
  const evaluation = state.board?.evaluation;
  const delivery = state.board?.delivery;
  const specs = state.criteriaSpecs || [];
  const checks = groupChecks(specs, (spec) => spec.group || "custom")
    .map((group) => `<section class="detail-card">
      <div class="detail-group-head">
        <div class="detail-kicker">${escapeHtml(group.label)}</div>
        <div class="detail-group-count">${escapeHtml(tc("checks.group_count", group.items.length, { count: group.items.length }))}</div>
      </div>
      <div class="detail-stack detail-check-group">
        ${group.items.map((spec) => {
          const status = spec.enabled ? aggregateCheckStatus(evaluation?.checks, spec.name) : "off";
          const note = joinBullet([
            spec.name,
            checkFamilyLabel(spec.family || "", spec.name),
            spec.readOnly ? t("detail.observed") : spec.enabled ? t("detail.enabled") : t("detail.disabled"),
          ]);
          return `<div class="detail-check-row">
            <span class="detail-check-dot" data-result="${status}"></span>
            <div class="detail-check-main">
              <div class="detail-check-title">${escapeHtml(spec.label)}</div>
              <div class="detail-check-note">${escapeHtml(note)}</div>
            </div>
            <span class="detail-check-pill" data-result="${status}">${escapeHtml(checkResultLabel(status))}</span>
          </div>`;
        }).join("")}
      </div>
    </section>`)
    .join("");
  const results = groupChecks(evaluation?.checks || [], (check) => checkFamilyKey(check.family || "", check.name || check.label || ""))
    .map((group) => `<section class="detail-card">
      <div class="detail-group-head">
        <div class="detail-kicker">${escapeHtml(group.label)}</div>
        <div class="detail-group-count">${escapeHtml(tc("checks.group_count", group.items.length, { count: group.items.length }))}</div>
      </div>
      <div class="detail-stack detail-check-group">
        ${group.items.map((check) => `<section class="detail-card detail-card-tight" data-result="${check.status}">
          <div class="detail-check-head">
            <div class="detail-check-title">${escapeHtml(check.label || checkLabel(baseCheckName(check.name || check.label)))}</div>
            <span class="detail-check-pill" data-result="${check.status}">${escapeHtml(checkResultLabel(check.status))}</span>
          </div>
          <div class="detail-check-note">${escapeHtml(joinBullet([check.name, checkFamilyLabel(check.family || "", check.name || check.label || "")]))}</div>
          ${check.evidence ? detailPre(check.evidence, "detail-pre-evidence") : `<div class="detail-copy detail-copy-soft">${escapeHtml(t("detail.no_evidence"))}</div>`}
        </section>`).join("")}
      </div>
    </section>`)
    .join("");
  return {
    title: t("section.evaluation"),
    meta: detailMetaHtml([
      evaluation?.verdict ? evaluationVerdictLabel(evaluation.verdict) : t("evaluation.verdict.pending"),
      evaluation?.status || "",
      evaluation?.time?.completed ? detailStamp(evaluation.time.completed) : "",
    ]),
    html: `<div class="detail-stack">
      <section class="detail-card">
        <div class="detail-kicker">${escapeHtml(t("detail.configured_checks"))}</div>
        ${checks || `<p class="empty-hint">${escapeHtml(t("empty.checks"))}</p>`}
      </section>
      ${evaluation ? `<section class="detail-card">
        <div class="detail-kicker">${escapeHtml(t("detail.verdict_summary"))}</div>
        <div class="detail-copy md-content">${renderMarkdown(evaluation.summary)}</div>
      </section>` : ""}
      ${results ? `<div class="detail-stack">${results}</div>` : evaluation ? "" : `<p class="empty-hint">${escapeHtml(t("detail.no_evaluation"))}</p>`}
      ${delivery ? `<section class="detail-card">
        <div class="detail-kicker">${escapeHtml(t("detail.delivery"))}</div>
        ${renderDeliveryCard(delivery)}
      </section>` : ""}
    </div>`,
  };
}

function filesDetail() {
  const files = state.changes;
  const adds = files.reduce((sum, item) => sum + item.additions, 0);
  const dels = files.reduce((sum, item) => sum + item.deletions, 0);
  return {
    title: t("section.files"),
    meta: detailMetaHtml([
      files.length > 0 ? tc("files.changed", files.length, { count: files.length }) : t("detail.no_changes"),
      files.length > 0 ? `+${adds} / -${dels}` : "",
    ]),
    html: files.length === 0
      ? `<p class="empty-hint">${escapeHtml(t("empty.files"))}</p>`
      : `<div class="detail-stack">
          <section class="detail-card">
            <div class="detail-kicker">${escapeHtml(t("detail.changed_files"))}</div>
            <div class="changes-list">${changeRowsHtml("data-detail-change-index")}</div>
          </section>
        </div>`,
  };
}

function overviewDetail() {
  const overview = state.board?.overview;
  const task = state.board?.task;
  const run = state.board?.run;
  if (!overview) {
    return {
      title: t("section.overview"),
      meta: "",
      html: `<p class="empty-hint">${escapeHtml(t("empty.overview"))}</p>`,
    };
  }
  return {
    title: t("section.overview"),
    meta: detailMetaHtml([
      task?.status ? statusLabel(task.status) : "",
      run?.phase || "",
      task?.time?.updated ? detailStamp(task.time.updated) : "",
    ]),
    html: `<div class="detail-stack">
      <section class="detail-card">
        <div class="detail-kicker">${escapeHtml(t("detail.headline"))}</div>
        <div class="plan-summary detail-copy md-content">${renderMarkdown(overview.headline)}</div>
        <div class="detail-copy detail-copy-soft md-content">${renderMarkdown(overview.summary)}</div>
      </section>
      ${overview.nextStep ? `<section class="detail-card detail-card-accent">
        <div class="detail-kicker">${escapeHtml(t("detail.next_step"))}</div>
        <div class="detail-copy md-content">${renderMarkdown(overview.nextStep.title)}</div>
        ${overview.nextStep.detail ? `<div class="detail-copy detail-copy-soft md-content">${renderMarkdown(overview.nextStep.detail)}</div>` : ""}
      </section>` : ""}
      ${overview.currentFailure ? `<section class="detail-card detail-card-danger">
        <div class="detail-kicker">${escapeHtml(t("detail.current_failure"))}</div>
        <div class="detail-copy md-content">${renderMarkdown(overview.currentFailure.title)}</div>
        <div class="detail-copy detail-copy-soft md-content">${renderMarkdown(overview.currentFailure.summary)}</div>
      </section>` : ""}
      ${overviewActionsHtml(overview.controls || {}) ? `<section class="detail-card">
        <div class="detail-kicker">${escapeHtml(t("detail.task_actions"))}</div>
        ${overviewActionsHtml(overview.controls || {})}
      </section>` : ""}
      ${task ? `<section class="detail-card">
        <div class="detail-kicker">${escapeHtml(t("detail.task_context"))}</div>
        <div class="detail-grid">
          <div class="detail-grid-row"><span>${escapeHtml(t("detail.id"))}</span><strong>${escapeHtml(task.id)}</strong></div>
          <div class="detail-grid-row"><span>${escapeHtml(t("detail.status"))}</span><strong>${escapeHtml(statusLabel(task.status))}</strong></div>
          ${run?.executor ? `<div class="detail-grid-row"><span>${escapeHtml(t("detail.executor"))}</span><strong>${escapeHtml(executorLabel(run.executor))}</strong></div>` : ""}
          ${task.time.created ? `<div class="detail-grid-row"><span>${escapeHtml(t("detail.created"))}</span><strong>${escapeHtml(detailStamp(task.time.created))}</strong></div>` : ""}
          ${task.time.updated ? `<div class="detail-grid-row"><span>${escapeHtml(t("detail.updated"))}</span><strong>${escapeHtml(detailStamp(task.time.updated))}</strong></div>` : ""}
        </div>
      </section>` : ""}
    </div>`,
  };
}

function renderSectionDetail(kind) {
  const detail = sectionDetail(kind);
  if (!detail || !dom.sectionDialogTitle || !dom.sectionDialogMeta || !dom.sectionDialogBody) return;
  dom.sectionDialogTitle.textContent = detail.title;
  dom.sectionDialogMeta.innerHTML = detail.meta || "";
  dom.sectionDialogBody.innerHTML = detail.html;
}

function refreshSectionDetail() {
  if (!dom.sectionDialog?.open || !state.sectionDetail) return;
  renderSectionDetail(state.sectionDetail);
}

function openSectionDetail(kind) {
  if (!kind || !dom.sectionDialog) return;
  state.sectionDetail = kind;
  renderSectionDetail(kind);
  if (!dom.sectionDialog.open) dom.sectionDialog.showModal();
  dom.sectionDialogBody?.scrollTo?.({ top: 0 });
}

function closeSectionDetail() {
  state.sectionDetail = "";
  if (dom.sectionDialog?.open) dom.sectionDialog.close();
}

function shouldOpenSectionDetail(event) {
  const target = event?.target;
  if (!(target instanceof Element)) return false;
  if (window.getSelection?.()?.toString()) return false;
  return !target.closest("button, input, textarea, select, label, a, summary, [data-action]");
}

function setCriteriaResult(item, status) {
  const statusDot = item?.querySelector(".criteria-status");
  const text = item?.querySelector(".criteria-result");
  if (!statusDot || !text) return;
  statusDot.dataset.result = status;
  text.textContent = criteriaResultText(status);
}

function criteriaResultText(status) {
  if (status === "off") return t("checks.off");
  if (status === "passed") return t("checks.pass");
  if (status === "failed") return t("checks.fail");
  if (status === "skipped") return t("checks.skip");
  return t("checks.pending");
}

function isCriteriaEnabled(item) {
  const input = item?.querySelector('input[type="checkbox"][data-check]');
  return !!input?.checked;
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
    AppLog.error("ui", "Failed to load sessions", { error: String(e) });
  }
}

async function selectManagedSession(sessionID) {
  if (!sessionID) {
    state.managedSession = null;
    renderManagedSessionList();
    return;
  }
  try {
    state.managedSession = await apiJson(`session/${sessionID}`);
    renderManagedSessionList();
  } catch (e) {
    AppLog.error("ui", "Failed to load managed session", { error: String(e) });
  }
}

function renderManagedSessionList() {
  if (!dom.sessionListPanel) return;
  const html = !state.sessions.length
    ? `<div class="empty-hint">${escapeHtml(t("session.none_loaded"))}</div>`
    : state.sessions
      .map((item) => sessionRow(item, joinBullet([stamp(item.time?.updated), shortPath(item.directory || "")])))
      .join("");
  if (dom.sessionListPanel.innerHTML === html) return;
  const top = dom.sessionListPanel.scrollTop;
  dom.sessionListPanel.innerHTML = html;
  dom.sessionListPanel.scrollTop = top;
}

async function createManagedSession() {
  try {
    const session = await apiJson("session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await openManagedSession(session?.id || "");
    await loadManagedSessions();
  } catch (e) {
    AppLog.error("ui", "Failed to create session", { error: String(e) });
    await nativeMessage(errorText("session.create_failed", e), {
      title: t("chat.title"),
      kind: "error",
    });
  }
}

async function deleteManagedSession(sessionID = state.managedSession?.id) {
  if (!sessionID) return;
  const session = sessionItem(sessionID);
  const accepted = await nativeConfirm(t("session.delete_confirm", { name: session?.title || sessionID }), {
    title: t("session.delete_title"),
    okLabel: t("common.delete"),
    kind: "warning",
  });
  if (!accepted) return;
  try {
    await deleteSessionApi(sessionID, { deleteTasks: true });
    if (state.chatSessionID === sessionID) state.chatSessionID = "";
    if (state.managedSession?.id === sessionID) {
      state.managedSession = null;
    }
    await Promise.all([loadManagedSessions(), loadTasks()]);
    if (state.chatSessionID) {
      await Promise.all([loadConversation(), selectManagedSession(state.chatSessionID)]);
      return;
    }
    if (state.selectedTaskID) {
      await loadConversation();
      return;
    }
    if (state.sessions[0]?.id) {
      await openManagedSession(state.sessions[0].id);
      return;
    }
    await selectTask("");
  } catch (e) {
    AppLog.error("ui", "Failed to delete session", { error: String(e) });
    await nativeMessage(errorText("session.delete_failed", e), {
      title: t("session.delete_title"),
      kind: "error",
    });
  }
}

function transcriptRole(role) {
  return roleLabel(role);
}

function transcriptTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString(localeTag(), {
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
  return [t("transcript.tool", { status: toolStatusLabel(status), tool: toolName }), detail].filter(Boolean).join(" ");
}

function formatTranscriptPart(part, role) {
  if (!part || typeof part !== "object") return "";
  if (part.type === "text") return formatTranscriptText(part, role);
  if (part.type === "reasoning") return part.text?.trim() ? `${t("transcript.reasoning")}\n${part.text.trim()}` : "";
  if (part.type === "tool") return formatTranscriptTool(part);
  if (part.type === "file") return part.filename || part.url ? t("transcript.file", { value: part.filename || part.url }) : "";
  if (part.type === "subtask") {
    const text = part.description || part.prompt || "";
    return text ? t("transcript.subtask", { value: text }) : "";
  }
  if (part.type === "patch") {
    const files = Array.isArray(part.files) ? part.files.filter(Boolean) : [];
    return files.length ? t("transcript.patch", { value: files.join(", ") }) : t("transcript.patch_empty");
  }
  if (part.type === "compaction") return t("transcript.compaction");
  return "";
}

function formatSessionTranscript(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((item) => {
      const role = item?.info?.role || "assistant";
      const header = joinBullet([transcriptRole(role), transcriptTime(item?.info?.time?.created)]);
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

async function openManagedSession(sessionID) {
  if (!sessionID) return;
  const taskID = await resolveTaskIDForSession(sessionID);
  if (taskID) {
    await selectTask(taskID);
    state.chatSessionID = sessionID;
    state.sessionUpdatedAt = 0;
    state.session = [];
    renderManagedSessionList();
    renderSession();
    await selectManagedSession(sessionID);
    await Promise.all([loadConversation(), loadMemory()]);
    return;
  }
  state.selectedTaskID = "";
  state.chatSessionID = sessionID;
  stopPolling();
  stopSSE();
  state.board = null;
  state.boardEtag = "";
  state.boardUpdatedAt = 0;
  state.sessionUpdatedAt = 0;
  state.session = [];
  renderClear();
  await selectManagedSession(sessionID);
  await Promise.all([loadConversation(), loadMemory()]);
}

// ── Interactions ──

function renderInteractions(interactions) {
  const pending = interactions.filter((i) => i.status === "pending");
  const goalsBody = dom.goalsBody;

  // Remove existing inline alerts
  goalsBody.querySelectorAll(".interaction-alert").forEach((el) => el.remove());

  if (pending.length === 0) {
    dismissInteractionModal();
    return;
  }

  // Inline alerts in goals section
  goalsBody.insertAdjacentHTML("beforeend", pending.map(interactionAlertHtml).join(""));
  bindInteractionActions(goalsBody);

  // Show modal popup for the first pending interaction (more prominent)
  if (!_interactionBusy) {
    showInteractionModal(pending[0]);
  }
}

function showInteractionModal(interaction) {
  let modal = document.getElementById("interaction-modal");
  // Don't re-show if already showing for the same interaction
  if (modal && modal.dataset.interactionId === interaction.id) return;
  dismissInteractionModal();
  const actions =
    interaction.type === "permission"
      ? `<button class="btn btn-primary" data-action="always">${escapeHtml(t("interaction.always_allow"))}</button>
         <button class="btn btn-ghost" data-action="once">${escapeHtml(t("interaction.allow_once"))}</button>
         <button class="btn btn-ghost" data-action="reject">${escapeHtml(t("interaction.reject"))}</button>`
      : `<button class="btn btn-primary" data-action="answer">${escapeHtml(t("interaction.answer"))}</button>
         <button class="btn btn-ghost" data-action="reject">${escapeHtml(t("interaction.skip"))}</button>`;
  const icon = interaction.type === "permission" ? "\uD83D\uDD12" : "\u2753";
  const html = `<div id="interaction-modal" class="interaction-modal-overlay" data-interaction-id="${escapeHtml(interaction.id)}">
    <div class="interaction-modal">
      <div class="interaction-modal-title">${icon} ${escapeHtml(interaction.title)}</div>
      <div class="interaction-modal-body md-content">${renderMarkdown(interaction.body)}</div>
      <div class="interaction-modal-actions">${actions}</div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
  modal = document.getElementById("interaction-modal");
  modal.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "reject") rejectInteraction(interaction.id);
      else resolveInteraction(interaction.id, action);
    });
  });
}

function dismissInteractionModal() {
  const modal = document.getElementById("interaction-modal");
  if (modal) modal.remove();
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
    if (title) title.textContent += t("interaction.processing_suffix");
  }
}

async function resolveInteraction(id, action) {
  if (_interactionBusy) return;
  _interactionBusy = true;
  disableInteractionButtons(id);
  try {
    if (action === "once" || action === "always") {
      // Direct API call — bypasses the panel agent for faster, more reliable resolution
      await apiJson(`interaction/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: action }),
        signal: AbortSignal.timeout(30000),
      });
    } else {
      const answer = await nativePrompt(t("interaction.reply_prompt"), {
        title: t("interaction.reply_title"),
        okLabel: t("common.submit"),
        cancelLabel: t("common.cancel"),
        inputLabel: t("interaction.answer_label"),
      });
      if (answer == null) {
        // User cancelled the prompt
        _interactionBusy = false;
        await loadBoard();
        return;
      }
      // Direct API call for answers too
      await apiJson(`interaction/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: answer }),
        signal: AbortSignal.timeout(30000),
      });
    }
  } catch (e) {
    AppLog.error("ui", "Failed to resolve interaction", { error: String(e) });
    showInteractionError(id, e.message);
  } finally {
    _interactionBusy = false;
    dismissInteractionModal();
    await loadBoard();
  }
}

async function rejectInteraction(id) {
  if (_interactionBusy) return;
  _interactionBusy = true;
  disableInteractionButtons(id);
  try {
    // Direct API call — bypasses the panel agent for faster, more reliable rejection
    await apiJson(`interaction/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    AppLog.error("ui", "Failed to reject interaction", { error: String(e) });
    showInteractionError(id, e.message);
  } finally {
    _interactionBusy = false;
    dismissInteractionModal();
    await loadBoard();
  }
}

function showInteractionError(id, msg) {
  const alert = document.querySelector(`.interaction-alert[data-id="${id}"]`);
  if (alert) {
    const title = alert.querySelector(".interaction-title");
    if (title) title.textContent = t("interaction.error", { message: msg });
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

    // Synthetic board turns should remain isolated so spec, git checkpoints,
    // and interaction prompts show up as distinct lifecycle events.
    if (msg._synthetic) {
      groups.push({ role, messages: [msg] });
      continue;
    }

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

function boardArtifact(board, label) {
  const list = board?.artifacts || [];
  return list.find((item) => item.label === label);
}

function syntheticTextMessage(role, time, text) {
  if (typeof text !== "string" || !text.trim()) return null;
  return {
    _synthetic: true,
    info: { role, time: { created: Number.isFinite(time) ? time : Date.now() } },
    parts: [{ type: "text", text }],
  };
}

function gitCheckpointTitle(stage, mode) {
  if (stage === "baseline") {
    return mode === "created_commit"
      ? t("chat.git.baseline_created")
      : t("chat.git.baseline_recorded");
  }
  return mode === "created_commit"
    ? t("chat.git.result_created")
    : t("chat.git.result_recorded");
}

function gitCheckpointLine(key, value, options = {}) {
  if (!value) return "";
  const text = options.code ? `\`${value}\`` : String(value);
  return `- ${t(key)}: ${text}`;
}

function gitCheckpointText(item) {
  return [
    `**${gitCheckpointTitle(item.stage, item.mode)}**`,
    "",
    gitCheckpointLine("chat.git.message", item.message),
    gitCheckpointLine("chat.git.branch", item.branch, { code: true }),
    gitCheckpointLine("chat.git.commit", item.commit ? String(item.commit).slice(0, 8) : "", { code: true }),
    item.stage === "baseline"
      ? gitCheckpointLine("chat.git.snapshot", item.snapshot ? String(item.snapshot).slice(0, 8) : "", { code: true })
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function boardGitCheckpoints(board) {
  const out = [];
  const seen = new Set();
  const meta = record(board?.task?.metadata) ? board.task.metadata : null;
  const git = record(meta?.git) ? meta.git : null;
  for (const stage of ["baseline", "result"]) {
    const item = record(git?.[stage]) ? git[stage] : null;
    if (!item) continue;
    const time = Number(item.time);
    if (!Number.isFinite(time)) continue;
    out.push({
      stage,
      mode: typeof item.mode === "string" ? item.mode : "recorded_head",
      branch: typeof item.branch === "string" ? item.branch : "",
      commit: typeof item.commit === "string" ? item.commit : "",
      message: typeof item.message === "string" ? item.message : "",
      snapshot: typeof item.snapshot === "string" ? item.snapshot : "",
      time,
    });
    seen.add(stage);
  }
  for (const snap of Array.isArray(board?.snapshots) ? board.snapshots : []) {
    const payload = record(snap?.payload) ? snap.payload : null;
    const stage = typeof payload?.stage === "string" ? payload.stage : "";
    if (payload?.kind !== "git" || !stage || seen.has(stage)) continue;
    const time = Number(snap?.time?.created);
    if (!Number.isFinite(time)) continue;
    out.push({
      stage,
      mode: typeof payload.mode === "string" ? payload.mode : "recorded_head",
      branch: typeof payload.branch === "string" ? payload.branch : "",
      commit: typeof payload.commit === "string" ? payload.commit : "",
      message: typeof payload.message === "string" ? payload.message : "",
      snapshot: typeof payload.snapshot === "string" ? payload.snapshot : "",
      time,
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

function specContextText(spec) {
  const text = typeof spec?.content === "string" ? spec.content.trim() : "";
  return text;
}

function interactionRequestText(interaction) {
  const title = typeof interaction?.title === "string" && interaction.title.trim()
    ? interaction.title.trim()
    : t("detail.pending_interactions");
  const body = typeof interaction?.body === "string" ? interaction.body.trim() : "";
  return [title, body].filter(Boolean).join("\n\n");
}

function interactionReplyLabel(reply) {
  if (reply === "always") return t("interaction.always_allow");
  if (reply === "reject") return t("interaction.reject");
  return t("interaction.allow_once");
}

function interactionAnswerLines(interaction) {
  const response = record(interaction?.response) ? interaction.response : null;
  const payload = record(interaction?.payload) ? interaction.payload : null;
  const questions = Array.isArray(payload?.questions) ? payload.questions : [];
  if (Array.isArray(response?.answers)) {
    return response.answers.flatMap((answer, index) => {
      const value = Array.isArray(answer)
        ? answer
          .filter((item) => typeof item === "string" && item.trim())
          .join(", ")
        : "";
      if (!value) return [];
      const question = record(questions[index]) ? questions[index] : null;
      const label = typeof question?.header === "string" && question.header.trim()
        ? question.header.trim()
        : typeof question?.question === "string" && question.question.trim()
          ? question.question.trim()
          : "";
      return [label ? `- **${label}**: ${value}` : `- ${value}`];
    });
  }
  if (record(response?.answers)) {
    return Object.entries(response.answers).flatMap(([key, item], index) => {
      const answer = record(item) ? item : null;
      const value = Array.isArray(answer?.answers)
        ? answer.answers
          .filter((entry) => typeof entry === "string" && entry.trim())
          .join(", ")
        : "";
      if (!value) return [];
      const question = record(questions[index]) ? questions[index] : null;
      const label = typeof question?.header === "string" && question.header.trim()
        ? question.header.trim()
        : typeof question?.question === "string" && question.question.trim()
          ? question.question.trim()
          : key;
      return [label ? `- **${label}**: ${value}` : `- ${value}`];
    });
  }
  const message = typeof response?.message === "string" ? response.message.trim() : "";
  return message ? [message] : [];
}

function interactionResponseText(interaction) {
  if (interaction?.type === "permission") {
    if (interaction.status === "rejected") return t("interaction.reject");
    const response = record(interaction?.response) ? interaction.response : null;
    return interactionReplyLabel(typeof response?.reply === "string" ? response.reply : "once");
  }
  if (interaction?.status === "rejected") return t("interaction.skip");
  const answers = interactionAnswerLines(interaction);
  if (answers.length > 0) return answers.join("\n");
  return t("interaction.answer");
}

function buildBoardContextMessages() {
  const board = state.board;
  if (!board) return [];
  const messages = [];
  const { task, plan, evaluation, delivery, lanes } = board;

  // 1. User request — show the original task request as a "user" turn
  if (task?.request) {
    messages.push({
      _synthetic: true,
      info: { role: "user", time: { created: (task.time?.created || 0) - 2 } },
      parts: [{ type: "text", text: task.request }],
    });
  }

  if (board.spec?.content) {
    const message = syntheticTextMessage(
      "spec",
      board.spec.time?.created || (task?.time?.created || Date.now()) - 1,
      specContextText(board.spec),
    );
    if (message) messages.push(message);
  }

  // 2. Plan — show plan steps and full context
  if (plan) {
    const goalsLane = (lanes || []).find((lane) => lane.id === "goals");
    const goals = goalsLane?.cards || [];
    const message = syntheticTextMessage(
      "planner",
      plan.time?.created || (task?.time?.created || 0) - 1,
      planContextText(plan, goals),
    );
    if (message) messages.push(message);
  }

  for (const interaction of Array.isArray(board.interactions) ? board.interactions : []) {
    const request = syntheticTextMessage("system", interaction.time?.created || Date.now(), interactionRequestText(interaction));
    if (request) messages.push(request);
    if (interaction.status === "answered" || interaction.status === "rejected") {
      const response = syntheticTextMessage(
        "user",
        interaction.time?.resolved || interaction.time?.updated || Date.now(),
        interactionResponseText(interaction),
      );
      if (response) messages.push(response);
    }
  }

  // 3. Goals — show goal status as a "goal_gate" turn
  for (const item of boardGitCheckpoints(board)) {
    const message = syntheticTextMessage("system", item.time, gitCheckpointText(item));
    if (message) messages.push(message);
  }

  const goalsLane = (lanes || []).find((lane) => lane.id === "goals");
  const goals = goalsLane?.cards || [];
  if (goals.length > 0) {
    const goalTime = evaluation?.time?.created || task?.time?.updated || Date.now();
    const message = syntheticTextMessage("goal_gate", goalTime - 1, goalContextText(goals));
    if (message) messages.push(message);
  }

  // 4. Evaluation verdict — show as "scheduler" turn
  if (evaluation?.verdict) {
    const message = syntheticTextMessage("scheduler", evaluation.time?.created || Date.now(), evaluationContextText(board, goals));
    if (message) messages.push(message);
  }

  // 5. Delivery summary — show as "assistant" turn if delivery was accepted
  const finalDelivery = board.acceptedDelivery || delivery;
  if (finalDelivery?.summary && finalDelivery.status !== "candidate") {
    const message = syntheticTextMessage(
      "assistant",
      (finalDelivery.time?.created || Date.now()) + 1,
      `**${t("detail.delivery")} (${deliveryStatusLabel(finalDelivery.status)})**\n\n${finalDelivery.summary}`,
    );
    if (message) messages.push(message);
  }

  return messages;
}

function conversationMessages() {
  const boardMsgs = buildBoardContextMessages();
  let realMessages = state.session || [];
  if (boardMsgs.length > 0 && realMessages.length > 0) {
    realMessages = realMessages.filter((message) => {
      const text = (message.parts || []).map((part) => part.text || "").join("");
      return !text.includes("<assistant-brief>") && !text.includes("You are executing a headless coding task");
    });
  }
  return [...realMessages, ...boardMsgs].sort((a, b) => (a.info?.time?.created || 0) - (b.info?.time?.created || 0));
}

function renderFilePart(part) {
  const url = part.url || part.filename || "";
  const name = part.filename || url || "file";
  const mime = part.mime || part.mediaType || "";
  const isImg = (mime && mime.startsWith("image/")) ||
    /^data:image\//i.test(url) ||
    /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?|$)/i.test(url);
  if (isImg && url) {
    return `<div class="msg-img-wrap"><img class="md-img" src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy"></div>`;
  }
  return `<div class="msg-text" style="font-family:var(--mono);font-size:var(--ui-font-small);color:var(--text-soft)">${escapeHtml(name)}</div>`;
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
  return `<div class="msg-reasoning">
    <div class="reasoning-label">${escapeHtml(t("transcript.reasoning"))}</div>
    <div class="reasoning-text">${escapeHtml(text)}</div>
  </div>`;
}

function renderPatchPart(part) {
  const files = part.files || [];
  if (files.length === 0) return "";
  const display = files.map((f) => shortPath(f)).join(", ");
  return `<div class="msg-patch">\u2699 ${escapeHtml(display)}</div>`;
}

// ── Render Clear ──

function planContextText(plan, goals) {
  const planner = plan.metadata?.planner || {};
  const steps = Array.isArray(plan.metadata?.steps) ? plan.metadata.steps : [];
  const milestones = Array.isArray(plan.metadata?.milestones) ? plan.metadata.milestones : [];
  const risks = Array.isArray(plan.metadata?.risks) ? plan.metadata.risks : [];
  const warnings = Object.values(plan.metadata?.stage_sources || {})
    .flatMap((stage) =>
      stage && typeof stage === "object" && typeof stage.warning === "string" && stage.warning.trim()
        ? [stage.warning.trim()]
        : [],
    )
    .filter((value, index, list) => list.indexOf(value) === index);
  const clarification = plan.metadata?.clarification;
  const spec = plan.metadata?.spec_analysis;
  const assumptions = Array.isArray(spec?.assumptions) ? spec.assumptions : [];

  const lines = [t("plan.context.title", { version: plan.version })];
  if (plan.summary) lines.push("", t("plan.context.summary", { value: plan.summary }));
  if (planner.role || planner.quality || planner.source) {
    lines.push("", t("plan.context.planner", { value: [planner.role, planner.quality, planner.source].filter(Boolean).join(" / ") }));
  }
  if (warnings.length > 0) {
    lines.push("", t("plan.context.warnings"));
    lines.push(...warnings.map((warning) => `- ${warning}`));
  }
  if (steps.length > 0) {
    lines.push("", t("plan.context.execution"));
    lines.push(...steps.slice(0, 8).map((step, index) => `${index + 1}. ${step}`));
  }
  if (milestones.length > 0) {
    lines.push("", t("plan.context.milestones"));
    lines.push(...milestones.map((item, index) => `- ${index + 1}. ${item.title}`));
  }
  if (goals.length > 0) lines.push("", t("plan.context.goal_count", { count: goals.length }));
  if (risks.length > 0) {
    lines.push("", t("plan.context.risks"));
    lines.push(...risks.slice(0, 5).map((risk) => `- ${risk}`));
  }
  if (assumptions.length > 0) {
    lines.push("", t("plan.context.assumptions"));
    lines.push(
      ...assumptions.slice(0, 5).map((item) => {
        const question = typeof item?.question === "string" ? item.question.trim() : "";
        const assumption = typeof item?.assumption === "string" ? item.assumption.trim() : "";
        if (question && assumption) return `- ${question}: ${assumption}`;
        return `- ${question || assumption}`;
      }),
    );
  }
  if (clarification?.questions?.length) {
    lines.push("", tc("plan.context.clarification", clarification.questions.length, { count: clarification.questions.length }));
  }
  return lines.join("\n");
}

function goalContextText(goals) {
  const passed = goals.filter((goal) => goal.status === "passed").length;
  const failed = goals.filter((goal) => goal.status === "failed").length;
  const pending = goals.filter((goal) => goal.status !== "passed" && goal.status !== "failed").length;
  const header =
    passed + failed > 0
      ? t("goal.context.results", { passed, total: goals.length, failed, pending })
      : t("goal.context.list", { total: goals.length });
  const lines = [header, ""];
  for (const goal of goals) {
    const icon = goal.status === "passed" ? "\u2705" : goal.status === "failed" ? "\u274C" : "\u23F3";
    lines.push(`${icon} **${goal.title}**`);
    if (goal.detail) lines.push(t("goal.context.criteria", { value: goal.detail }));
    if (goal.metadata?.origin) lines.push(t("goal.context.origin", { value: goal.metadata.origin }));
  }
  return lines.join("\n");
}

function evaluationContextText(board, goals) {
  const evaluation = board.evaluation;
  const analysis = boardArtifact(board, "evaluator-agent-analysis")?.payload || {};
  const error = boardArtifact(board, "evaluator-agent-error")?.payload || {};
  const verdictIcon = evaluation.verdict === "accepted" ? "\u2705" : evaluation.verdict === "rejected" ? "\u274C" : "\u26A0";
  const lines = [`${verdictIcon} ${t("evaluation.context.title", { verdict: evaluationVerdictLabel(evaluation.verdict) })}`];
  if (analysis.classification) lines.push("", t("evaluation.context.classification", { value: analysis.classification }));
  if (evaluation.summary) lines.push("", evaluation.summary);
  if (error.error) lines.push("", t("evaluation.context.error", { value: error.error }));

  const checks = evaluation.checks || [];
  if (checks.length > 0) {
    lines.push("", t("evaluation.context.checks"));
    for (const check of checks) {
      const icon = check.status === "passed" ? "\u2713" : check.status === "failed" ? "\u2717" : "\u2014";
      lines.push(`- ${icon} ${check.name}: ${check.evidence || check.status}`);
    }
  }

  const goalStatuses = Array.isArray(analysis.goal_statuses) ? analysis.goal_statuses : [];
  if (goalStatuses.length > 0) {
    lines.push("", t("evaluation.context.goal_assessments"));
    for (const item of goalStatuses) {
      const goal = goals[item.goal_index];
      const icon = item.status === "passed" ? "\u2705" : item.status === "failed" ? "\u274C" : "\u23F3";
      const label = goal?.title || t("evaluation.context.goal_fallback", { index: item.goal_index + 1 });
      lines.push(`- ${icon} ${label}: ${item.evidence || item.status}`);
    }
  }

  if (analysis.replan_guidance?.root_cause || analysis.replan_guidance?.suggested_strategy) {
    lines.push("", t("evaluation.context.replan"));
    if (analysis.replan_guidance.root_cause) lines.push(t("evaluation.context.root_cause", { value: analysis.replan_guidance.root_cause }));
    if (analysis.replan_guidance.suggested_strategy) lines.push(t("evaluation.context.strategy", { value: analysis.replan_guidance.suggested_strategy }));
  }

  return lines.join("\n");
}

function renderSession() {
  const sorted = conversationMessages();
  if (sorted.length === 0) {
    dom.chatScroll.innerHTML = `<div class="chat-empty">${escapeHtml(t("chat.empty"))}</div>`;
    dom.chatCount.textContent = "";
    state._renderedGroupKey = "";
    return;
  }

  const groups = groupMessagesByRole(sorted);
  dom.chatCount.textContent = tc("chat.count", sorted.length, { count: sorted.length });

  const el = dom.chatScroll;
  const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  const target = conversationTarget();
  const targetKey = conversationTargetKey(target);
  const boardSuffix = state.board ? `|${state.board.task?.status || ""}:${state.board.evaluation?.verdict || ""}` : "";
  const groupKey = `${targetKey}:${groups.map((group) => `${group.role}:${group.messages.length}`).join(",")}${boardSuffix}`;
  const sessionChanged = !state._renderedGroupKey || !state._renderedGroupKey.startsWith(`${targetKey}:`);
  const sameStructure = state._renderedGroupKey === groupKey;

  if (sessionChanged) {
    const frag = document.createDocumentFragment();
    for (const group of groups) {
      const node = renderTurn(group);
      if (node) frag.appendChild(node);
    }
    el.innerHTML = "";
    el.appendChild(frag);
  } else if (!sameStructure) {
    const existingTurns = el.querySelectorAll(".turn");
    const prevCount = existingTurns.length;
    if (prevCount > 0 && groups.length >= prevCount) {
      const updatedNode = renderTurn(groups[prevCount - 1]);
      if (updatedNode) existingTurns[prevCount - 1].replaceWith(updatedNode);
    }
    for (let index = prevCount; index < groups.length; index += 1) {
      const node = renderTurn(groups[index]);
      if (node) el.appendChild(node);
    }
  } else {
    const existingTurns = el.querySelectorAll(".turn");
    if (existingTurns.length > 0) {
      const updatedNode = renderTurn(groups[groups.length - 1]);
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

async function copyChatConversation() {
  try {
    const transcript = formatSessionTranscript(conversationMessages());
    if (!transcript) {
      await nativeMessage(t("chat.copy_empty"), {
        title: t("chat.copy_title"),
        kind: "info",
      });
      return;
    }
    const ok = await copyText(transcript);
    if (!ok) throw new Error(t("chat.copy_failed"));
    await nativeMessage(t("chat.copy_done"), {
      title: t("chat.copy_title"),
      kind: "info",
    });
  } catch (e) {
    AppLog.error("ui", "Failed to copy chat conversation", { error: String(e) });
    await nativeMessage(errorText("chat.copy_failed", e), {
      title: t("chat.copy_title"),
      kind: "error",
    });
  }
}

function renderTurn(group) {
  const { role, messages } = group;
  let bodyHtml = "";
  for (const message of messages) {
    for (const part of message.parts || []) {
      bodyHtml += renderPart(part, role);
    }
  }
  if (!bodyHtml.trim()) return null;

  const el = document.createElement("article");
  el.className = "turn msg";
  el.dataset.role = role;
  const firstTime = messages[0]?.info?.time?.created;
  const timeStr = firstTime ? stamp(firstTime) : "";

  el.innerHTML = `
    <div class="msg-head">
      <span class="msg-role">${escapeHtml(roleLabel(role))}</span>
      <span class="msg-time">${escapeHtml(timeStr)}</span>
    </div>
    <div class="msg-bubble">
      <div class="msg-body">${bodyHtml}</div>
    </div>
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
      return "";
    case "file":
      return renderFilePart(part);
    case "subtask":
      return `<div class="msg-tool"><span class="tool-icon">\u2192</span><span class="tool-name">${escapeHtml(t("transcript.subtask_label"))}</span><span class="tool-detail">${escapeHtml(part.description || part.prompt || "")}</span></div>`;
    case "compaction":
      return `<div class="msg-step">${escapeHtml(t("transcript.compaction_short"))}</div>`;
    default:
      return "";
  }
}

function renderToolPart(part) {
  const toolName = part.tool || "unknown";
  const st = part.state || {};
  const status = st.status || "pending";
  const input = st.input || {};
  const hiddenTools = ["planner", "todowrite", "todoupdate", "task_report"];
  if (hiddenTools.includes(toolName.toLowerCase())) return "";

  const detail = toolDetail(toolName, input, st);
  const icon = toolIcon(toolName);
  const statusText = toolStatusLabel(status);

  let html = `<div class="msg-tool">
    <span class="tool-icon">${icon}</span>
    <span class="tool-name">${escapeHtml(toolName)}</span>
    <span class="tool-detail">${escapeHtml(detail)}</span>
    <span class="tool-status" data-status="${status}" title="${escapeHtml(statusText)}">${escapeHtml(statusText)}</span>
  </div>`;

  const output = st.output || "";
  if (output && status === "completed") {
    html += `<div class="msg-tool-output">${escapeHtml(output)}</div>`;
  }
  if (status === "error" && output) {
    html += `<div class="msg-tool-error">${escapeHtml(output)}</div>`;
  }
  return html;
}

function renderClear() {
  renderMeta();
  setTaskStatus("idle", { visible: false });
  dom.overviewBadge.textContent = "";
  dom.overviewBody.innerHTML = `<p class="empty-hint">${escapeHtml(t("empty.overview"))}</p>`;
  state.changes = [];
  state.changeKey = "";
  renderChanges();
  dom.specBadge.textContent = "";
  dom.specBody.innerHTML = `<p class="empty-hint">${escapeHtml(t("empty.spec"))}</p>`;
  dom.planBadge.textContent = "";
  dom.planBody.innerHTML = `<p class="empty-hint">${escapeHtml(t("empty.plan"))}</p>`;
  dom.goalsBadge.textContent = "";
  dom.goalsBody.innerHTML = `<p class="empty-hint">${escapeHtml(t("empty.goals"))}</p>`;
  if (dom.criteriaBadge) {
    dom.criteriaBadge.textContent = "";
    delete dom.criteriaBadge.dataset.tone;
  }
  if (dom.evalBody) dom.evalBody.innerHTML = `<p class="empty-hint">${escapeHtml(t("detail.no_evaluation"))}</p>`;
  dom.chatScroll.innerHTML = `<div class="chat-empty">${escapeHtml(t("chat.empty"))}</div>`;
  dom.chatCount.textContent = "";
  dom.elapsed.textContent = "";
  state._renderedGroupKey = "";
  renderExecutor();
  refreshSectionDetail();
}

function sizeChat() {
  dom.chatTextarea.style.height = "auto";
  const style = getComputedStyle(document.documentElement);
  const min = Number.parseFloat(style.getPropertyValue("--ui-chat-min-height")) || 72;
  const max = Number.parseFloat(style.getPropertyValue("--ui-chat-max-height")) || 180;
  const h = Math.min(dom.chatTextarea.scrollHeight, max);
  dom.chatTextarea.style.height = `${Math.max(h, min)}px`;
}

// ── Chat Input ──

dom.chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = dom.chatTextarea.value.trim();
  if (!text) return;

  dom.chatSend.disabled = true;
  dom.chatTextarea.value = "";
  sizeChat();

  // When no task is selected, each exchange is isolated — clear previous messages
  if (!state.selectedTaskID) {
    state.session = [];
  }

  // Immediately show user message + thinking indicator
  const now = Date.now();
  state.session = [
    ...state.session,
    { parts: [{ type: "text", text }], info: { role: "user", time: { created: now } } },
    { parts: [{ type: "text", text: "……" }], info: { role: "assistant", time: { created: now + 1 } } },
  ];
  renderSession();

  try {
    await panelMessage(text);
  } catch (err) {
    const ph = state.session.find((m) => m.info?.role === "assistant" && m.parts?.[0]?.text === "……");
    const msg = t("interaction.error", { message: err?.message || err });
    if (ph) ph.parts[0].text = msg;
    else state.session.push({ parts: [{ type: "text", text: msg }], info: { role: "assistant", time: { created: Date.now() } } });
    renderSession();
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
dom.btnChatCopyAll?.addEventListener("click", () => copyChatConversation());
sizeChat();

// ── Connection Badge: double-click to restart core ──

dom.connBadge.addEventListener("dblclick", async () => {
  dom.connBadge.textContent = t("titlebar.connection.restarting");
  dom.connBadge.dataset.status = "connecting";
  try {
    const restarted = isManagedLocalServerUrl(state.serverUrl) ? await restartLocalServer() : null;
    if (!restarted) {
      await apiFetch("restart", { method: "POST", signal: AbortSignal.timeout(3000) });
    }
  } catch {}
  // Wait for new process to come up, then reload UI
  setTimeout(() => location.reload(), 2000);
});

// ── Task Select ──

dom.btnSidebarToggle?.addEventListener("click", async () => {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  renderSidebar();
  await persistOverlaySettings();
});

dom.leftPaneResizer?.addEventListener("pointerdown", (event) => {
  startPaneResize("left", event);
});

dom.rightPaneResizer?.addEventListener("pointerdown", (event) => {
  startPaneResize("right", event);
});

dom.sessionListPanel?.addEventListener("click", async (event) => {
  const remove = eventClosest(event, "[data-session-delete]");
  if (remove) {
    await deleteManagedSession(remove.dataset.sessionDelete || "");
    return;
  }
  const button = eventClosest(event, "[data-session-id]");
  if (!button) return;
  await openManagedSession(button.dataset.sessionId || "");
});

dom.taskDir?.addEventListener("click", async (event) => {
  const button = eventClosest(event, "[data-path-action],[data-path-open],[data-path-set]");
  if (!button || button.matches(":disabled")) return;
  const action = button.dataset.pathAction || "";
  if (action === "browse") {
    await browseDirectory();
    return;
  }
  if (action === "create") {
    await createDirectory();
    return;
  }
  if (action === "reset") {
    await resetDirectory();
    return;
  }
  if (button.dataset.pathOpen) {
    await openDirectory(button.dataset.pathOpen);
    return;
  }
  const target = button.dataset.pathSet || "";
  if (!target) return;
  try {
    await setDirectory(target);
  } catch (e) {
    AppLog.error("ui", "Failed to set working directory", { error: String(e) });
    await nativeMessage(errorText("cwd.set_failed", e), {
      title: t("cwd.title"),
      kind: "error",
    });
  }
});

dom.taskGit?.addEventListener("click", () => {
  initGitCurrent({ notify: true });
});

dom.criteriaList?.addEventListener("change", async () => {
  if (!state.selectedTaskID) return;
  try {
    await apiJson(`task/${encodeURIComponent(state.selectedTaskID)}/checks`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        checks: buildCheckConfig(),
      }),
    });
    await loadBoard();
  } catch (e) {
    AppLog.error("ui", "Failed to update task checks", { error: String(e) });
  }
});

$$(".section-body[data-section-detail]").forEach((body) => {
  body.addEventListener("click", (event) => {
    if (!shouldOpenSectionDetail(event)) return;
    openSectionDetail(body.dataset.sectionDetail || "");
  });
});

dom.changesBody?.addEventListener("click", (e) => {
  const target = eventClosest(e, "[data-change-index]");
  if (!target) return;
  openDiffDialog(Number(target.dataset.changeIndex));
});

dom.sectionDialogBody?.addEventListener("click", (event) => {
  const change = eventClosest(event, "[data-detail-change-index]");
  if (change) {
    closeSectionDetail();
    openDiffDialog(Number(change.dataset.detailChangeIndex));
    return;
  }

  const button = eventClosest(event, ".interaction-alert [data-action]");
  if (!button) return;
  const alert = button.closest(".interaction-alert");
  const id = alert?.dataset.id;
  if (!id) return;
  const action = button.dataset.action;
  if (action === "reject") rejectInteraction(id);
  else resolveInteraction(id, action);
});

dom.engineBar.addEventListener("click", async (event) => {
  const button = eventClosest(event, "[data-executor]");
  if (!button || button.disabled) return;
  const executor = button.dataset.executor || "opencode";
  state.executor = executor;
  renderExecutor();
  await persistOverlaySettings();
});

dom.btnRefreshSessions.addEventListener("click", async () => {
  await Promise.all([loadTasks(), loadManagedSessions()]);
  await syncManagedSession(currentSessionID());
});
dom.btnCreateSession.addEventListener("click", () => createManagedSession());

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
    if (!opened) throw new Error(t("skill.open_unavailable"));
  } catch (e) {
    AppLog.error("ui", "Failed to open skill directory", { error: String(e) });
    await nativeMessage(errorText("skill.open_failed", e), {
      title: t("skill.title"),
      kind: "error",
    });
  }
});
dom.btnReloadSkills?.addEventListener("click", async () => {
  await loadExtensions();
});
dom.btnDeleteAllSkills?.addEventListener("click", async () => {
  try {
    await deleteAllSkills();
    await loadExtensions();
  } catch (e) {
    AppLog.error("ui", "Failed to delete all skills", { error: String(e) });
    await nativeMessage(errorText("skill.delete_all_failed", e), {
      title: t("skill.title"),
      kind: "error",
    });
  }
});
dom.btnAddMcp.addEventListener("click", () => {
  dom.mcpForm.reset();
  dom.mcpType.value = "remote";
  toggleMcpFields();
  dom.mcpDialog.showModal();
});
dom.btnDeleteAllMcp?.addEventListener("click", async () => {
  try {
    await deleteAllMcp();
    await loadExtensions();
  } catch (e) {
    AppLog.error("ui", "Failed to delete all MCP servers", { error: String(e) });
    await nativeMessage(errorText("mcp.delete_all_failed", e), {
      title: t("mcp.title"),
      kind: "error",
    });
  }
});
dom.btnPickSkillPath?.addEventListener("click", async () => {
  const selected = await pickDirectory();
  if (selected) dom.skillValue.value = selected;
});
dom.btnCancelSkill.addEventListener("click", () => dom.skillDialog.close());
dom.btnCancelMcp.addEventListener("click", () => dom.mcpDialog.close());
dom.btnCloseSkillMarket?.addEventListener("click", () => dom.skillMarketDialog?.close());
dom.btnCloseDiff?.addEventListener("click", () => dom.diffDialog?.close());
dom.btnCloseSectionDialog?.addEventListener("click", () => closeSectionDetail());
dom.sectionDialog?.addEventListener("close", () => {
  state.sectionDetail = "";
});
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
      AppLog.error("ui", "Failed to install market skill", { error: String(e) });
      await nativeMessage(errorText("skill.market.install_failed", e), {
        title: t("skill.market.title"),
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
      title: t("skill.market.title"),
      kind: "info",
    });
  }
});
dom.skillList?.addEventListener("click", async (event) => {
  const remove = eventClosest(event, "[data-skill-remove]");
  if (remove) {
    try {
      await deleteSkill(remove.dataset.skillRemove, remove.dataset.skillKind, remove.dataset.skillName);
      await loadExtensions();
    } catch (e) {
      AppLog.error("ui", "Failed to delete skill", { error: String(e) });
      await nativeMessage(errorText("skill.delete_failed", e), {
        title: t("skill.title"),
        kind: "error",
      });
    }
    return;
  }

  const button = eventClosest(event, "[data-skill-open]");
  if (!button) return;
  try {
    const opened = await nativeOpen(button.dataset.skillOpen);
    if (!opened) throw new Error(t("skill.open_unavailable"));
  } catch (e) {
    AppLog.error("ui", "Failed to open skill", { error: String(e) });
    await nativeMessage(errorText("skill.open_failed", e), {
      title: t("skill.title"),
      kind: "error",
    });
  }
});

dom.btnCancelGoal.addEventListener("click", () => {
  dom.goalDialog.close();
});

if (dom.overviewBody) {
  dom.overviewBody.addEventListener("click", async (e) => {
    const button = eventClosest(e, "[data-task-action]");
    if (!(button instanceof HTMLElement)) return;
    await performTaskAction(button.dataset.taskAction || "");
  });
}

if (dom.goalsBody) {
  dom.goalsBody.addEventListener("click", async (e) => {
    const button = eventClosest(e, "[data-goal-action]");
    if (!(button instanceof HTMLElement)) return;
    const action = button.dataset.goalAction || "";
    if (action === "create") {
      openGoalDialog();
      return;
    }
    const goalID = button.dataset.goalId || "";
    if (action === "edit") {
      editGoal(goalID, button.dataset.goalTitle || "", button.dataset.goalDetail || "");
      return;
    }
    if (action === "delete") {
      await deleteGoalAction(goalID);
    }
  });
}

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
    AppLog.error("ui", "Failed to save goal", { error: String(e) });
    await nativeMessage(errorText("goal.save_failed", e), {
      title: t("goal.title"),
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
    AppLog.error("ui", "Failed to add skill", { error: String(e) });
    await nativeMessage(errorText("skill.add_failed", e), {
      title: t("skill.title"),
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
    AppLog.error("ui", "Failed to add MCP server", { error: String(e) });
    await nativeMessage(errorText("mcp.add_failed", e), {
      title: t("mcp.title"),
      kind: "error",
    });
  }
});

// ── Settings ──

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
  if (dom.localeMode) dom.localeMode.value = sanitizeLocale(state.locale);
  dom.themeMode.value = sanitizeTheme(state.theme);
  dom.settingsDialog.showModal();
}

function focusConfigSection(name) {
  if (name !== "channel" || !dom.channelSection) return;
  dom.channelSection.open = true;
  requestAnimationFrame(() => {
    dom.channelSection?.scrollIntoView?.({ block: "nearest" });
    dom.channelList?.scrollTo?.({ top: 0 });
  });
}

function openConfigDialog(section) {
  if (!dom.configDialog) return;
  if (!dom.configDialog.open) {
    dom.configDialog.showModal();
  }
  focusConfigSection(section);
}

dom.btnTheme?.addEventListener("click", async () => {
  state.theme = resolvedTheme() === "light" ? "dark" : "light";
  renderTheme();
  await persistOverlaySettings();
});

dom.btnLocale?.addEventListener("click", async () => {
  await setLocale(state.locale === "zh-CN" ? "en-US" : "zh-CN");
});

$("#btnSettings").addEventListener("click", () => {
  openServerSettings();
});

dom.btnConfigToggle?.addEventListener("click", () => {
  openConfigDialog();
});

dom.btnCloseConfigDialog?.addEventListener("click", () => {
  dom.configDialog?.close();
});

dom.channelList?.addEventListener("click", (event) => {
  const docs = eventClosest(event, "[data-channel-docs]");
  if (docs) {
    nativeOpen(docs.dataset.channelDocs);
    return;
  }
  const button = eventClosest(event, "[data-channel-edit]");
  if (!button) return;
  openChannelSettings(button.dataset.channelEdit);
});

dom.channelDialog?.addEventListener("click", (event) => {
  const docs = eventClosest(event, "[data-channel-docs]");
  if (!docs) return;
  nativeOpen(docs.dataset.channelDocs);
});

dom.btnSaveChannelPublicUrl?.addEventListener("click", async () => {
  const value = dom.channelPublicUrl?.value?.trim() || "";
  try {
    const saved = await updateConfig((current) => {
      current.server = current.server || {};
      if (value) current.server.publicUrl = value;
      if (!value) delete current.server.publicUrl;
      if (Object.keys(current.server).length === 0) delete current.server;
    });
    state.config = saved;
    renderChannelPublicUrl();
  } catch (e) {
    AppLog.error("ui", "Failed to save public channel URL", { error: String(e) });
    await nativeMessage(errorText("channel.public_url_save_failed", e), {
      title: t("channel.title"),
      kind: "error",
    });
  }
});

dom.brandVersion?.addEventListener("click", (event) => {
  const button = eventClosest(event, "[data-open-channels]");
  if (!button) return;
  openConfigDialog("channel");
});

dom.llmForm?.addEventListener("submit", (e) => {
  e.preventDefault();
});

dom.llmProvider?.addEventListener("change", () => {
  populateModelSelect(state.config, state.providerCatalog, false);
  renderLlmSummary();
  queueLlmSync(180);
});

dom.llmModel?.addEventListener("change", () => {
  renderLlmSummary();
  queueLlmSync(180);
});

dom.llmApiKey?.addEventListener("input", () => {
  renderLlmApiKeyTools();
  queueLlmSync(320);
});

dom.llmApiKey?.addEventListener("change", () => {
  renderLlmApiKeyTools();
  queueLlmSync(0);
});

dom.btnLlmApiKeyToggle?.addEventListener("click", () => {
  if (!dom.llmApiKey) return;
  dom.llmApiKey.type = dom.llmApiKey.type === "password" ? "text" : "password";
  renderLlmApiKeyTools();
  dom.llmApiKey.focus();
});

dom.btnLlmApiKeyCopy?.addEventListener("click", async () => {
  const value = dom.llmApiKey?.value?.trim() || "";
  if (!value) return;
  const ok = await copyText(value);
  showLlmNotice(t(ok ? "llm.notice.api_key_copied" : "llm.notice.api_key_copy_failed"), ok ? "active" : "error", ok ? 1800 : 3200);
});

dom.localeMode?.addEventListener("change", async () => {
  await setLocale(dom.localeMode.value);
});

dom.btnCancelChannel?.addEventListener("click", () => {
  dom.channelDialog.close();
});

$("#btnCancelSettings").addEventListener("click", () => {
  dom.settingsDialog.close();
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
      await Promise.all([loadTasks(), loadManagedSessions(), loadMeta(), loadExtensions(), loadConfigInfo(), loadExecutors()]);
    }
  } catch (e) {
    AppLog.error("ui", "Failed to save channel settings", { error: String(e) });
    await nativeMessage(errorText("channel.save_failed", e), {
      title: t("channel.title"),
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
  state.locale = sanitizeLocale(fd.get("localeMode")?.toString().trim());
  state.theme = sanitizeTheme(fd.get("themeMode")?.toString().trim());
  renderLocale();
  renderTheme();
  await persistOverlaySettings();
  dom.settingsDialog.close();
  const ok = await checkConnection();
  if (ok) {
    await Promise.all([loadTasks(), loadManagedSessions(), loadMeta(), loadExtensions(), loadConfigInfo(), loadExecutors()]);
  }
});

// ── Window Controls (Tauri) ──

async function setupTauri() {
  const win = await currentTauriWindow();
  if (!win) return;

  dom.titlebar?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('[data-no-drag="true"], button, input, textarea, select, a, label, summary, [contenteditable="true"]')) {
      return;
    }
    event.preventDefault();
    win.startDragging?.().catch(() => undefined);
  });

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
  return d.toLocaleTimeString(localeTag(), timeLocaleOptions());
}

function detailStamp(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString(localeTag(), {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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

// ── Knowledge: Memory & Preferences ──

async function loadMemory() {
  try {
    const sessionID = currentSessionID();
    const query = sessionID ? `?sessionID=${encodeURIComponent(sessionID)}` : "";
    const files = await apiJson(`panel/knowledge/memory${query}`);
    state.memoryFiles = Array.isArray(files) ? files : [];
    state.memorySearchMode = false;
    renderMemory();
  } catch {
    state.memoryFiles = [];
    renderMemory();
  }
}

async function searchMemory(query) {
  if (!query || !query.trim()) {
    return loadMemory();
  }
  try {
    const sessionID = currentSessionID() || undefined;
    const results = await apiJson("panel/knowledge/memory/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query.trim(), sessionID, limit: 20 }),
    });
    // Convert search results to a display-friendly format
    state.memoryFiles = (Array.isArray(results) ? results : []).map((r) => ({
      id: r.fileId,
      title: r.fileTitle,
      scope: r.scope || "global",
        source: t("memory.search_source"),
      score: r.score,
      snippet: r.content ? r.content.slice(0, 200) : "",
      timeUpdated: r.timeCreated || 0,
    }));
    state.memorySearchMode = true;
    renderMemory();
  } catch {
    // fallback
  }
}

function renderMemory() {
  const files = state.memoryFiles;
  if (dom.memoryBadge) {
    dom.memoryBadge.textContent = files.length ? String(files.length) : "";
  }
  renderConfigToggleMeta();
  if (!dom.memoryList) return;

  if (!files.length) {
    dom.memoryList.innerHTML = `<div class="empty-hint">${escapeHtml(
      state.memorySearchMode ? t("memory.no_results") : t("memory.none"),
    )}</div>`;
    return;
  }

  dom.memoryList.innerHTML = files
    .map((f) => {
      const time = formatDate(f.timeUpdated);
      const mode = state.memorySearchMode ? "search" : "list";
      const scoreHint = f.score != null ? ` · ${t("memory.score", { value: f.score.toFixed(2) })}` : "";
      return `<div class="knowledge-item" data-mode="${mode}" data-id="${escapeHtml(f.id)}">
        <div class="knowledge-item-main">
          <div class="knowledge-item-title">${escapeHtml(f.title)}</div>
          <div class="knowledge-item-meta">${escapeHtml(f.source)}${scoreHint}${time ? ` · ${escapeHtml(time)}` : ""}</div>
          ${f.snippet ? `<div class="knowledge-item-meta">${escapeHtml(f.snippet)}</div>` : ""}
        </div>
        <div class="knowledge-item-actions">
          <span class="knowledge-scope" data-scope="${escapeHtml(f.scope)}">${escapeHtml(f.scope)}</span>
          <button type="button" class="btn btn-ghost mini danger knowledge-delete" data-action="delete-memory" data-id="${escapeHtml(f.id)}">${escapeHtml(t("common.delete"))}</button>
        </div>
      </div>`;
    })
    .join("");
}

let _currentMemoryId = "";

async function openMemoryDetail(fileId) {
  _currentMemoryId = fileId;
  if (!dom.memoryDialog) return;
  dom.memoryDialogTitle.textContent = t("common.loading");
  dom.memoryDialogMeta.innerHTML = "";
  dom.memoryDialogContent.textContent = t("common.loading");
  dom.memoryDialog.showModal();

  try {
    const data = await apiJson(`panel/knowledge/memory/${encodeURIComponent(fileId)}`);
    const f = data.file;
    dom.memoryDialogTitle.textContent = f.title;
    dom.memoryDialogMeta.innerHTML = [
      `<span class="knowledge-scope" data-scope="${escapeHtml(f.scope)}">${escapeHtml(f.scope)}</span>`,
      `<span>${escapeHtml(t("memory.source", { value: f.source }))}</span>`,
      `<span>${escapeHtml(t("memory.created", { value: formatDateTime(f.timeCreated) }))}</span>`,
      `<span>${escapeHtml(t("memory.updated", { value: formatDateTime(f.timeUpdated) }))}</span>`,
    ].join("");
    dom.memoryDialogContent.textContent = data.content || t("memory.empty_value");
  } catch (e) {
    dom.memoryDialogTitle.textContent = t("common.error");
    dom.memoryDialogContent.textContent = e.message || t("memory.load_failed");
  }
}

async function deleteMemory(fileId) {
  if (!fileId) return;
  try {
    await apiJson(`panel/knowledge/memory/${encodeURIComponent(fileId)}`, { method: "DELETE" });
    dom.memoryDialog?.close();
    await loadMemory();
  } catch (e) {
    AppLog.error("ui", "Failed to delete memory", { error: String(e) });
  }
}

async function loadPreferences() {
  try {
    const prefs = await apiJson("panel/knowledge/preference");
    state.preferences = Array.isArray(prefs) ? prefs : [];
    renderPreferences();
  } catch {
    state.preferences = [];
    renderPreferences();
  }
}

function renderPreferences() {
  const prefs = state.preferences;
  if (dom.preferenceBadge) {
    dom.preferenceBadge.textContent = prefs.length ? String(prefs.length) : "";
  }
  renderConfigToggleMeta();
  if (!dom.preferenceList) return;

  if (!prefs.length) {
    dom.preferenceList.innerHTML = `<div class="empty-hint">${escapeHtml(t("preference.none"))}</div>`;
    return;
  }

  dom.preferenceList.innerHTML = prefs
    .map((p) => {
      const deleteBtn = `<button type="button" class="btn btn-ghost mini danger" data-pref-action="delete" data-pref-id=${jsonAttr(p.id)}>${escapeHtml(t("common.delete"))}</button>`;
      return `<div class="pref-item" data-pref-id=${jsonAttr(p.id)}>
        <div class="pref-item-head">
          <span class="pref-item-key">${escapeHtml(p.key)}</span>
          <span class="knowledge-scope" data-scope="${escapeHtml(p.scope)}" data-source="${escapeHtml(p.source)}">${escapeHtml(preferenceScopeLabel(p))}</span>
          <div class="pref-item-actions">
            ${deleteBtn}
          </div>
        </div>
        <div class="pref-item-value">${escapeHtml(p.value)}</div>
      </div>`;
    })
    .join("");
}

function preferenceScopeLabel(pref) {
  if (pref?.scope === "cwd") return t("preference.scope.cwd");
  if (pref?.scope === "session") return t("preference.scope.session");
  if (pref?.scope === "global") return t("preference.scope.global");
  return pref?.scope || "";
}

function openPrefEdit(prefId) {
  if (!dom.prefEditDialog) return;
  if (prefId) {
    const pref = state.preferences.find((p) => p.id === prefId);
    if (!pref) return;
    dom.prefEditTitle.textContent = t("preference.edit");
    dom.prefEditId.value = prefId;
    dom.prefEditKey.value = pref.key;
    dom.prefEditValue.value = pref.value;
  } else {
    dom.prefEditTitle.textContent = t("preference.add");
    dom.prefEditId.value = "";
    dom.prefEditKey.value = "";
    dom.prefEditValue.value = "";
  }
  dom.prefEditDialog.showModal();
}

async function savePrefEdit() {
  const key = dom.prefEditKey?.value?.trim();
  const value = dom.prefEditValue?.value?.trim();
  const prefId = dom.prefEditId?.value?.trim();
  if (!key || !value) return;
  try {
    await apiJson(prefId ? `panel/knowledge/preference/${encodeURIComponent(prefId)}` : "panel/knowledge/preference", {
      method: prefId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    dom.prefEditDialog?.close();
    await loadPreferences();
  } catch (e) {
    AppLog.error("ui", "Failed to save preference", { error: String(e) });
  }
}

async function deletePreference(prefId) {
  if (!prefId) return;
  try {
    await apiJson(`panel/knowledge/preference/${encodeURIComponent(prefId)}`, { method: "DELETE" });
    await loadPreferences();
  } catch (e) {
    AppLog.error("ui", "Failed to delete preference", { error: String(e) });
  }
}

async function loadKnowledge() {
  await Promise.all([loadMemory(), loadPreferences()]);
}

// Knowledge event listeners
if (dom.btnMemorySearch) {
  dom.btnMemorySearch.addEventListener("click", () => searchMemory(dom.memorySearch?.value));
}
if (dom.memorySearch) {
  dom.memorySearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      searchMemory(dom.memorySearch.value);
    }
  });
}
if (dom.memoryList) {
  dom.memoryList.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('[data-action="delete-memory"]');
    if (button instanceof HTMLElement) {
      e.stopPropagation();
      deleteMemory(button.dataset.id || "");
      return;
    }
    const item = target.closest(".knowledge-item[data-id]");
    if (!(item instanceof HTMLElement)) return;
    openMemoryDetail(item.dataset.id || "");
  });
}
if (dom.btnMemoryRefresh) {
  dom.btnMemoryRefresh.addEventListener("click", () => {
    if (dom.memorySearch) dom.memorySearch.value = "";
    loadMemory();
  });
}
if (dom.btnCloseMemory) {
  dom.btnCloseMemory.addEventListener("click", () => dom.memoryDialog?.close());
}
if (dom.btnDeleteMemory) {
  dom.btnDeleteMemory.addEventListener("click", () => deleteMemory(_currentMemoryId));
}
if (dom.btnPreferenceRefresh) {
  dom.btnPreferenceRefresh.addEventListener("click", () => loadPreferences());
}
if (dom.btnPreferenceAdd) {
  dom.btnPreferenceAdd.addEventListener("click", () => openPrefEdit(null));
}
if (dom.preferenceList) {
  dom.preferenceList.addEventListener("click", async (e) => {
    const button = eventClosest(e, "[data-pref-action]");
    if (button instanceof HTMLElement) {
      const prefId = button.dataset.prefId || "";
      if (button.dataset.prefAction === "delete") {
        e.stopPropagation();
        await deletePreference(prefId);
        return;
      }
    }
    const item = eventClosest(e, ".pref-item[data-pref-id]");
    if (!(item instanceof HTMLElement)) return;
    openPrefEdit(item.dataset.prefId || "");
  });
}
if (dom.prefEditForm) {
  dom.prefEditForm.addEventListener("submit", (e) => {
    e.preventDefault();
    savePrefEdit();
  });
}
if (dom.btnCancelPrefEdit) {
  dom.btnCancelPrefEdit.addEventListener("click", () => dom.prefEditDialog?.close());
}

// ── Log Viewer ──

let _serverLogLines = [];

async function loadServerLogs() {
  try {
    const data = await apiJson("log/tail?n=500");
    _serverLogLines = Array.isArray(data?.lines) ? data.lines : [];
    AppLog.info("log", `Loaded ${_serverLogLines.length} server log lines`);
  } catch (e) {
    AppLog.warn("log", "Failed to load server logs", { error: String(e) });
    _serverLogLines = [];
  }
}

function parseServerLogLine(raw) {
  // Format: "LEVEL  YYYY-MM-DDTHHMSS +Xms key=value ... message"
  const match = raw.match(/^(DEBUG|INFO|WARN|ERROR)\s+(\S+)\s+(\+\d+ms)\s+(.*)$/);
  if (!match) return { level: "info", ts: "", service: "", message: raw };
  const [, level, ts, , rest] = match;
  const svcMatch = rest.match(/service=(\S+)\s*/);
  const service = svcMatch ? svcMatch[1] : "";
  const message = svcMatch ? rest.slice(svcMatch.index + svcMatch[0].length) : rest;
  return { level: level.toLowerCase(), ts, service, message };
}

function logViewerEntries() {
  const minLevel = { debug: 0, info: 1, warn: 2, error: 3 };
  const threshold = minLevel[AppLog.filterLevel] || 0;

  const clientLines = AppLog.filtered().map((e) => ({
    level: e.level,
    ts: e.ts,
    service: e.service,
    message: e.extra ? `${e.message} ${JSON.stringify(e.extra)}` : e.message,
    source: "client",
  }));

  const serverLines = _serverLogLines
    .map(parseServerLogLine)
    .filter((e) => (minLevel[e.level] || 0) >= threshold)
    .map((e) => ({ ...e, source: "server" }));

  return [...serverLines, ...clientLines];
}

function formatLogViewerText(entries) {
  return entries
    .map((e) => {
      const parts = [`[${String(e.source || "client").toUpperCase()}]`, `[${String(e.level || "info").toUpperCase()}]`];
      if (e.ts) parts.push(e.ts);
      if (e.service) parts.push(e.service);
      parts.push(e.message || "");
      return parts.join(" ");
    })
    .join("\n");
}

function renderLogViewer() {
  if (!dom.logViewerBody) return;
  const entries = logViewerEntries();
  if (entries.length === 0) {
    dom.logViewerBody.innerHTML = `<div class="empty-hint">${escapeHtml(t("log.empty"))}</div>`;
    return;
  }

  const html = entries
    .map(
      (e) =>
        `<div class="log-line"><span class="log-level log-level-${e.level}">${e.level.toUpperCase().padEnd(5)}</span>` +
        `<span class="log-ts">${escapeHtml(e.ts)}</span>` +
        (e.service ? `<span class="log-service">${escapeHtml(e.service)}</span>` : "") +
        `<span class="log-msg">${escapeHtml(e.message)}</span></div>`,
    )
    .join("");
  dom.logViewerBody.innerHTML = html;
  dom.logViewerBody.scrollTop = dom.logViewerBody.scrollHeight;
}

async function openLogViewer() {
  await loadServerLogs();
  renderLogViewer();
  dom.logDialog?.showModal();
}

dom.btnLog?.addEventListener("click", () => openLogViewer());
dom.btnCloseLog?.addEventListener("click", () => dom.logDialog?.close());
dom.btnLogRefresh?.addEventListener("click", async () => {
  await loadServerLogs();
  renderLogViewer();
});
dom.btnLogCopy?.addEventListener("click", async () => {
  try {
    const text = formatLogViewerText(logViewerEntries());
    if (!text) {
      await nativeMessage(t("log.copy_empty"), {
        title: t("log.title"),
        kind: "info",
      });
      return;
    }
    const ok = await copyText(text);
    if (!ok) throw new Error(t("log.copy_failed"));
    await nativeMessage(t("log.copy_done"), {
      title: t("log.title"),
      kind: "info",
    });
  } catch (e) {
    AppLog.error("ui", "Failed to copy logs", { error: String(e) });
    await nativeMessage(errorText("log.copy_failed", e), {
      title: t("log.title"),
      kind: "error",
    });
  }
});
dom.btnLogClear?.addEventListener("click", () => {
  AppLog.clear();
  _serverLogLines = [];
  renderLogViewer();
});
dom.logLevelFilter?.addEventListener("change", () => {
  AppLog.filterLevel = dom.logLevelFilter.value;
  renderLogViewer();
});

// ── Init ──

toggleMcpFields();
setupDialogBackdropClose();

// ── Config Area ──

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

    populateProviderSelect(config, catalog);
    if (dom.cfgAvailableProviders) {
      const total = Array.isArray(catalog?.all) ? catalog.all.length : 0;
      const connected = Array.isArray(catalog?.connected) ? catalog.connected.length : 0;
      dom.cfgAvailableProviders.textContent = t("llm.available_count", { total, connected });
    }

    renderChannels();
    renderVersions();
    renderLlmSummary();
    renderLlmApiKeyTools();
  } catch (e) { AppLog.warn("config", "loadConfigInfo failed", { error: String(e) }); }
}

async function init() {
  AppLog.info("init", "OpenCorvus overlay starting", { version: OVERLAY_VERSION });
  await loadOverlaySettings();
  await syncLocalServerUrl();
  await loadI18n();
  renderLocale();
  renderTheme();
  renderScale();
  renderVersions();
  renderLlmSummary();
  renderLlmApiKeyTools();
  await setupTauri();
  renderExecutor();
  const ok = await checkConnection();
  if (ok) {
    AppLog.info("init", "loading initial data");
    await Promise.all([loadTasks(), loadManagedSessions(), loadMeta(), loadExtensions(), loadConfigInfo(), loadExecutors(), loadKnowledge()]);
    AppLog.info("init", "ready");
  } else {
    AppLog.warn("init", "starting offline");
    renderMeta();
    renderExtensions();
  }
  // Retry connection periodically
  setInterval(async () => {
    if (!state.connected) {
      const ok = await checkConnection();
      if (ok) {
        await Promise.all([loadTasks(), loadManagedSessions(), loadMeta(), loadExtensions(), loadConfigInfo(), loadExecutors(), loadKnowledge()]);
        if (state.selectedTaskID) selectTask(state.selectedTaskID);
      }
    }
  }, 10000);
}

init();

window.addEventListener("resize", renderScale);
window.visualViewport?.addEventListener("resize", renderScale);
window.addEventListener("keydown", handleZoomHotkey);
window.addEventListener("blur", () => {
  stopPaneResize();
});

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
