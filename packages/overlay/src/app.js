// ── OpenCorvus Overlay — Application Logic ──

const DEFAULT_SERVER = (() => {
  // When served from the opencorvus server itself (/ui/), use the same origin
  if (typeof window !== "undefined" && window.location.protocol.startsWith("http") && window.location.pathname.startsWith("/ui")) {
    return window.location.origin;
  }
  return "http://127.0.0.1:7878";
})();
const POLL_INTERVAL = 4000;
const CONVERSATION_POLL = 6000;
const SSE_BACKSTOP = 15000;
const BOARD_EVENT_DEBOUNCE = 150;
const CONVERSATION_EVENT_DEBOUNCE = 150;
const ZOOM_STEP = 0.1;
const MIN_UI_ZOOM = 0.8;
const MAX_UI_ZOOM = 1.6;
const MIN_WINDOW_OPACITY = 0.7;
const CLOSE_HINT_KEY = "oc_close_hint_seen";
const OPACITY_MIGRATION_KEY = "oc_opacity_migrated_v1";
const LEGACY_WINDOW_OPACITY = 0.3;
const SUPPORTED_LOCALES = ["zh-CN", "en-US"];
const BRAND_LOGO = Object.freeze({
  light: "opencorvus-logo-light.svg",
  dark: "opencorvus-logo-dark.svg",
});
const DEFAULT_LOCALE = sanitizeLocale(
  typeof document !== "undefined"
    ? document.documentElement.lang
    : typeof navigator !== "undefined"
      ? navigator.language
      : "zh-CN",
);
const DEFAULT_OVERLAY_SETTINGS = {
  serverUrl: DEFAULT_SERVER,
  autoServer: true,
  password: "",
  username: "opencorvus",
  executor: "opencode",
  initGit: true,
  alwaysOnTop: false,
  unattended: true,
  autoPermission: false,
  autoQuestion: false,
  showTranscriptDetails: false,
  sidebarCollapsed: false,
  sidebarWidth: null,
  sectionsWidth: null,
  opacity: 0.8,
  zoom: 1,
  theme: "dark",
  locale: DEFAULT_LOCALE,
  directoryMode: "temp",
  directory: "",
  workspaceTaskID: "",
  workspaceDirectory: "",
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
  autoServer: DEFAULT_OVERLAY_SETTINGS.autoServer,
  password: DEFAULT_OVERLAY_SETTINGS.password,
  username: DEFAULT_OVERLAY_SETTINGS.username,
  executor: DEFAULT_OVERLAY_SETTINGS.executor,
  initGit: DEFAULT_OVERLAY_SETTINGS.initGit,
  alwaysOnTop: DEFAULT_OVERLAY_SETTINGS.alwaysOnTop,
  unattended: DEFAULT_OVERLAY_SETTINGS.unattended,
  autoPermission: DEFAULT_OVERLAY_SETTINGS.autoPermission,
  autoQuestion: DEFAULT_OVERLAY_SETTINGS.autoQuestion,
  showTranscriptDetails: DEFAULT_OVERLAY_SETTINGS.showTranscriptDetails,
  sidebarCollapsed: DEFAULT_OVERLAY_SETTINGS.sidebarCollapsed,
  sidebarWidth: DEFAULT_OVERLAY_SETTINGS.sidebarWidth,
  sectionsWidth: DEFAULT_OVERLAY_SETTINGS.sectionsWidth,
  opacity: DEFAULT_OVERLAY_SETTINGS.opacity,
  zoom: DEFAULT_OVERLAY_SETTINGS.zoom,
  theme: DEFAULT_OVERLAY_SETTINGS.theme,
  locale: DEFAULT_OVERLAY_SETTINGS.locale,
  directoryMode: DEFAULT_OVERLAY_SETTINGS.directoryMode,
  directory: DEFAULT_OVERLAY_SETTINGS.directory,
  savedDirectory: DEFAULT_OVERLAY_SETTINGS.directory,
  tempDirectory: "",
  workspaceTaskID: DEFAULT_OVERLAY_SETTINGS.workspaceTaskID,
  workspaceDirectory: DEFAULT_OVERLAY_SETTINGS.workspaceDirectory,
  workspaceEpoch: 0,
  directoryEpoch: 0,
  localeSeq: 0,
  i18n: {},
  i18nReady: false,
  coreVersion: "",
  connected: false,
  tasks: [],
  pendingTasks: [],
  selectedTaskID: "",
  path: null,
  vcs: null,
  config: null,
  executors: [],
  providerCatalog: null,
  providerAuth: null,
  providerAuthDismissed: {},
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
  boardRetryTimer: null,
  boardRetryCount: 0,
  boardSyncPending: false,
  boardUpdatedAt: 0,
  snapshotVersion: "",
  taskSequence: 0,
  reconnectTimer: null,
  tasksSeq: 0,
  tasksKick: null,
  messages: [],
  pendingTaskMessages: null,
  agentEvents: [],
  executorEvents: [],
  ndjsonEvents: [],
  ndjsonStartMs: 0,
  executorRunID: "",
  executorEventsFetchedAt: 0,
  conversationLoading: null,
  conversationQueued: false,
  conversationKick: null,
  conversationBootstrapPending: false,
  conversationUpdatedAt: 0,
  changes: [],
  chatRequest: null,
  chatAttachments: [],
  sse: null,
  sseRetryTimer: null,
  sseConnected: false,
  pollTimer: null,
  conversationTimer: null,
  elapsedTimer: null,
  changeKey: "",
  _renderedGroupKey: "",
  _renderedMetaKey: "",
  _executorMeasureKey: "",
  memoryFiles: [],
  memorySearchMode: false,
  preferences: [],
  promptEntries: [],
  promptDrafts: {},
  criteriaSpecs: [],
  budgetDirty: false,
  budgetSaving: false,
};

const liveTextStreams = new Map();
const reasoningVisibility = new Map();
const reasoningHideTimers = new Map();
let chatScrollPaused = false;
const TECH_FX_ENABLED = false;
const LIVE_TEXT_INTERVAL = 0;
const LIVE_TEXT_MIN_CHUNK = 9999;
const LIVE_TEXT_MAX_CHUNK = 9999;
const DEFAULT_REASONING_AUTO_CLOSE_MS = 5000;

function stopLiveText(key) {
  const entry = liveTextStreams.get(key);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  liveTextStreams.delete(key);
}

function clearLiveTextStreams() {
  for (const key of [...liveTextStreams.keys()]) {
    stopLiveText(key);
  }
}

function messageLiveTextKey(part, field = "text") {
  if (!record(part)) return "";
  return `message:${part.sessionID || ""}:${part.messageID || ""}:${part.id}:${field}`;
}

function stopReasoningHideTimer(key) {
  const timer = reasoningHideTimers.get(key);
  if (!timer) return;
  clearTimeout(timer);
  reasoningHideTimers.delete(key);
}

function reasoningPartKey(part) {
  if (!record(part)) return "";
  const id = typeof part.id === "string" ? part.id : "";
  const messageID = typeof part.messageID === "string" ? part.messageID : "";
  const sessionID = typeof part.sessionID === "string" ? part.sessionID : "";
  if (!id && !messageID && !sessionID) return "";
  return `reasoning:${sessionID}:${messageID}:${id}`;
}

function reasoningPartHidden(part) {
  const key = reasoningPartKey(part);
  return key ? reasoningVisibility.get(key)?.hidden === true : false;
}

function reasoningAutoCloseMs() {
  const value = Number(overlayTestConfig()?.reasoningAutoCloseMs);
  if (Number.isFinite(value)) return Math.max(0, Math.floor(value));
  return DEFAULT_REASONING_AUTO_CLOSE_MS;
}

function scheduleReasoningAutoHide(key) {
  if (!key) return;
  stopReasoningHideTimer(key);
  const timer = setTimeout(() => {
    reasoningHideTimers.delete(key);
    const current = reasoningVisibility.get(key) || { hidden: false };
    if (current.hidden) return;
    reasoningVisibility.set(key, { ...current, hidden: true });
    state.conversationUpdatedAt = Date.now();
    renderConversation();
  }, reasoningAutoCloseMs());
  reasoningHideTimers.set(key, timer);
}

function touchReasoningPart(part) {
  const key = reasoningPartKey(part);
  if (!key) return;
  const current = reasoningVisibility.get(key);
  reasoningVisibility.set(key, { ...(current || {}), hidden: false });
  stopReasoningHideTimer(key);
  scheduleReasoningAutoHide(key);
  if (current?.hidden) {
    state.conversationUpdatedAt = Date.now();
    renderConversation();
  }
}

function liveTextChunk(target, current = "") {
  const remaining = Math.max(0, target.length - current.length);
  if (!remaining) return 0;
  return Math.min(
    remaining,
    Math.max(LIVE_TEXT_MIN_CHUNK, Math.min(LIVE_TEXT_MAX_CHUNK, Math.ceil(target.length / 12))),
  );
}

function advanceLiveText(key) {
  const entry = liveTextStreams.get(key);
  if (!entry) return;
  entry.timer = null;
  if (!entry.target) {
    entry.apply("");
    liveTextStreams.delete(key);
    return;
  }
  if (!entry.target.startsWith(entry.current)) {
    entry.current = "";
  }
  const next = entry.target.slice(0, entry.current.length + liveTextChunk(entry.target, entry.current));
  entry.current = next;
  entry.apply(next);
  state.conversationUpdatedAt = Date.now();
  renderConversation();
  if (entry.current.length >= entry.target.length) {
    liveTextStreams.delete(key);
    return;
  }
  entry.timer = setTimeout(() => advanceLiveText(key), LIVE_TEXT_INTERVAL);
}

function startLiveText(key, target, current, apply) {
  const nextTarget = typeof target === "string" ? target : "";
  const nextCurrent =
    typeof current === "string" && nextTarget.startsWith(current)
      ? current
      : "";
  if (!nextTarget) {
    stopLiveText(key);
    apply("");
    return;
  }
  const entry = liveTextStreams.get(key);
  if (!entry) {
    const created = {
      current: nextCurrent,
      target: nextTarget,
      apply,
      timer: null,
    };
    liveTextStreams.set(key, created);
    if (!created.current) {
      created.current = nextTarget.slice(0, liveTextChunk(nextTarget));
      created.apply(created.current);
    }
    if (created.current.length < created.target.length) {
      created.timer = setTimeout(() => advanceLiveText(key), LIVE_TEXT_INTERVAL);
    } else {
      liveTextStreams.delete(key);
    }
    return;
  }
  if (entry.timer) clearTimeout(entry.timer);
  entry.target = nextTarget;
  entry.apply = apply;
  entry.current = nextTarget.startsWith(entry.current) ? entry.current : nextCurrent;
  if (!entry.current) {
    entry.current = nextTarget.slice(0, liveTextChunk(nextTarget));
    entry.apply(entry.current);
  }
  if (entry.current.length < entry.target.length) {
    entry.timer = setTimeout(() => advanceLiveText(key), LIVE_TEXT_INTERVAL);
    return;
  }
  entry.apply(entry.target);
  liveTextStreams.delete(key);
}

function streamMessagePart(part, target, field = "text", current = "") {
  if (!record(part)) return;
  const nextTarget = typeof target === "string" ? target : "";
  if (field === "text") part._targetText = nextTarget;
  if (field === "output") part._targetOutput = nextTarget;
  const key = messageLiveTextKey(part, field);
  startLiveText(key, nextTarget, current, (value) => {
    if (field === "text") part.text = value;
    if (field === "output" && record(part.state)) part.state.output = value;
  });
}

function hydrateLivePart(existing, part) {
  if (!record(part)) return part;
  if ((part.type === "text" || part.type === "reasoning") && typeof part.text === "string") {
    const current = existing?.type === part.type && typeof existing.text === "string" ? existing.text : "";
    const next = {
      ...part,
      text: part.text.startsWith(current) ? current : "",
    };
    streamMessagePart(next, part.text, "text", next.text);
    if (part.type === "reasoning" && part.text.trim()) touchReasoningPart(next);
    return next;
  }
  if (part.type === "tool" && record(part.state) && typeof part.state.output === "string" && part.state.output) {
    const previous =
      existing?.type === "tool" &&
      record(existing.state) &&
      typeof existing.state.output === "string"
        ? existing.state.output
        : "";
    const stateCopy = {
      ...part.state,
      output: part.state.output.startsWith(previous) ? previous : "",
    };
    const next = {
      ...part,
      state: stateCopy,
    };
    streamMessagePart(next, part.state.output, "output", stateCopy.output);
    return next;
  }
  return part;
}

function ensureMessageReasoningPart(message, id) {
  if (!record(message)) return null;
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const existing = parts.find((part) => part?.type === "reasoning" && (!id || part.id === id))
    || parts.find((part) => part?.type === "reasoning");
  if (existing) return existing;
  const next = {
    id: id || `reasoning:${Date.now()}`,
    type: "reasoning",
    text: "",
    messageID: message.info?.id || "",
    sessionID: "",
  };
  message.parts = [...parts, next];
  return next;
}

// ── DOM Refs ──

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  techAtlasCanvas: $("#techAtlasCanvas"),
  titlebar: $("#titlebar"),
  connBadge: $("#connBadge"),
  brandLogo: $(".brand-logo"),
  brandVersion: $("#brandVersion"),
  chatVersion: $("#chatVersion"),
  chatAuthor: $("#chatAuthor"),
  btnTitlebarMenu: $("#btnTitlebarMenu"),
  titlebarMenu: $("#titlebarMenu"),
  btnLocale: $("#btnLocale"),
  btnLocaleLabel: $("#btnLocaleLabel"),
  btnTheme: $("#btnTheme"),
  btnThemeValue: $("#btnThemeValue"),
  btnSettings: $("#btnSettings"),
  btnPin: $("#btnPin"),
  btnPinValue: $("#btnPinValue"),
  chkUnattended: $("#chkUnattended"),
  chkAutoPermission: $("#chkAutoPermission"),
  chkAutoQuestion: $("#chkAutoQuestion"),
  chkShowTranscriptDetails: $("#chkShowTranscriptDetails"),
  opacityRange: $("#opacityRange"),
  opacityValue: $("#opacityValue"),
  btnMinimize: $("#btnMinimize"),
  btnMaximize: $("#btnMaximize"),
  btnClose: $("#btnClose"),
  panelBody: $("#panelBody"),
  sidebar: $("#sidebar"),
  btnSidebarToggle: $("#btnSidebarToggle"),
  leftPaneResizer: $("#leftPaneResizer"),
  workspaceMain: $("#workspaceMain"),
  rightPaneResizer: $("#rightPaneResizer"),
  sections: $("#sections"),
  taskDir: $("#taskDir"),
  recentDirPanel: $("#recentDirPanel"),
  taskWorkspaceDir: $("#taskWorkspaceDir"),
  taskGit: $("#taskGit"),
  btnBrowseCwd: $("#btnBrowseCwd"),
  btnCreateCwd: $("#btnCreateCwd"),
  btnOpenCwd: $("#btnOpenCwd"),
  btnResetCwd: $("#btnResetCwd"),
  engineBar: $("#engineBar"),
  codexModelPanel: $("#codexModelPanel"),
  claudeCodeModelPanel: $("#claudeCodeModelPanel"),
  taskStatus: $("#taskStatus"),
  extensionsBadge: $("#extensionsBadge"),
  btnConfigToggle: $("#btnConfigToggle"),
  configToggleMeta: $("#configToggleMeta"),
  configDialog: $("#configDialog"),
  btnCloseConfigDialog: $("#btnCloseConfigDialog"),
  promptSection: $("#promptSection"),
  promptBody: $("#promptBody"),
  promptBadge: $("#promptBadge"),
  taskActionsBar: $("#taskActionsBar"),
  specSection: $("#specSection"),
  planSection: $("#planSection"),
  goalsSection: $("#goalsSection"),
  criteriaSection: $("#criteriaSection"),
  deliverySection: $("#deliverySection"),
  deliveryBadge: $("#deliveryBadge"),
  deliveryBody: $("#deliveryBody"),
  changesSection: $("#changesSection"),
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
  btnTerminateRun: $("#btnTerminateRun"),
  specBadge: $("#specBadge"),
  specBody: $("#specBody"),
  planBadge: $("#planBadge"),
  planBody: $("#planBody"),
  goalsBadge: $("#goalsBadge"),
  btnCreateGoal: $("#btnCreateGoal"),
  goalsBody: $("#goalsBody"),
  criteriaBadge: $("#criteriaBadge"),
  criteriaList: $("#criteriaList"),
  evalBody: $("#evalBody"),
  budgetConfigBody: $("#budgetConfigBody"),
  budgetHint: $("#budgetHint"),
  budgetMaxRuns: $("#budgetMaxRuns"),
  budgetMaxReplans: $("#budgetMaxReplans"),
  budgetMaxEvaluations: $("#budgetMaxEvaluations"),
  budgetMaxWallTime: $("#budgetMaxWallTime"),
  btnBudgetReset: $("#btnBudgetReset"),
  btnBudgetSave: $("#btnBudgetSave"),
  changesBadge: $("#changesBadge"),
  changesBody: $("#changesBody"),
  chatGoalsStrip: $("#chatGoalsStrip"),
  chatScroll: $("#chatScroll"),
  chatEmpty: $("#chatEmpty"),
  chatCount: $("#chatCount"),
  btnChatCopyAll: $("#btnChatCopyAll"),
  chatTabs: $("#chatTabs"),
  tabControl: $("#tabControl"),
  tabCoding: $("#tabCoding"),
  codingScroll: $("#codingScroll"),
  codingEmpty: $("#codingEmpty"),
  chatForm: $("#chatForm"),
  chatTextarea: $("#chatTextarea"),
  chatAttachments: $("#chatAttachments"),
  chatFileInput: $("#chatFileInput"),
  btnChatAttach: $("#btnChatAttach"),
  btnTaskInterrupt: $("#btnTaskInterrupt"),
  chatSend: $("#chatSend"),
  taskListPanel: $("#taskListPanel"),
  btnRefreshTasks: $("#btnRefreshTasks"),
  btnCreateTask: $("#btnCreateTask"),
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
  appDialogSelectField: $("#appDialogSelectField"),
  appDialogSelectLabel: $("#appDialogSelectLabel"),
  appDialogSelect: $("#appDialogSelect"),
  btnAppDialogCancel: $("#btnAppDialogCancel"),
  btnAppDialogOk: $("#btnAppDialogOk"),
  llmForm: $("#llmForm"),
  llmSection: $("#llmSection"),
  llmAdvanced: $("#llmAdvanced"),
  llmSummary: $("#llmSummary"),
  llmProvider: $("#llmProvider"),
  llmModel: $("#llmModel"),
  llmApiKey: $("#llmApiKey"),
  llmApiKeySummary: $("#llmApiKeySummary"),
  btnLlmApiKeyToggle: $("#btnLlmApiKeyToggle"),
  btnLlmApiKeyCopy: $("#btnLlmApiKeyCopy"),
  btnLlmAuthAction: $("#btnLlmAuthAction"),
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
  btnLogServerLogs: $("#btnLogServerLogs"),
  prefEditDialog: $("#prefEditDialog"),
  prefEditForm: $("#prefEditForm"),
  prefEditTitle: $("#prefEditTitle"),
  prefEditId: $("#prefEditId"),
  prefEditKey: $("#prefEditKey"),
  prefEditValue: $("#prefEditValue"),
  btnCancelPrefEdit: $("#btnCancelPrefEdit"),
};

const workspace = window.createOverlayWorkspace?.({
  state,
  dom,
  document,
  stopPolling,
  stopChatRequest,
  renderChatComposer,
  renderMeta,
  renderTaskList,
  onDirectoryChange() {
    void persistOverlaySettings();
  },
});

if (!workspace) {
  throw new Error("Overlay workspace helpers failed to initialize");
}

const {
  workspaceMode,
  renderWorkspaceState,
  hasWorkspaceSelection,
  setWorkspaceDirectory,
  restoreWorkspaceDirectory,
  clearWorkspaceRuntime,
  clearProjectScopeData,
  enterEmptyWorkspace,
  enterSessionWorkspace,
  enterTaskWorkspace,
} = workspace;

Object.assign(window, {
  workspaceMode,
  renderWorkspaceState,
  hasWorkspaceSelection,
  setWorkspaceDirectory,
  restoreWorkspaceDirectory,
  clearWorkspaceRuntime,
  clearProjectScopeData,
  enterEmptyWorkspace,
  enterSessionWorkspace,
  enterTaskWorkspace,
});

let llmSaveTimer;
let llmNoticeTimer;
let llmSyncSerial = 0;
let llmSavedValue = "";
let bootstrapSettings = { ...DEFAULT_OVERLAY_SETTINGS };
let settingsSeq = 0;

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

  let _flushFailCount = 0;
  const MAX_FLUSH_FAILURES = 5;

  function flush() {
    _flushTimer = null;
    const batch = _flushQueue.splice(0);
    if (batch.length === 0) return;
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
      }).then(() => {
        _flushFailCount = 0;
      }).catch(() => {
        _flushFailCount++;
        if (_flushFailCount <= MAX_FLUSH_FAILURES) {
          _flushQueue.push(entry);
        }
      });
    }
  }

  function log(level, service, message, extra) {
    const entry = add(level, service, message, extra);
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

const interactions = window.createOverlayInteractions?.({
  state,
  dom,
  document,
  record,
  t,
  escapeHtml,
  renderMarkdown,
  nativePrompt,
  apiJson,
  loadBoard,
  AppLog,
  setTrayAttention,
});

if (!interactions) {
  throw new Error("Overlay interaction helpers failed to initialize");
}

const {
  interactionAlertHtml: interactionAlertHtmlHelper,
  renderInteractions: renderInteractionsHelper,
  showInteractionModal: showInteractionModalHelper,
  dismissInteractionModal: dismissInteractionModalHelper,
  resolveInteraction: resolveInteractionHelper,
  rejectInteraction: rejectInteractionHelper,
  isInteractionBusy,
  refreshInteractionAttention,
} = interactions;

Object.assign(window, {
  interactionAlertHtml: interactionAlertHtmlHelper,
  renderInteractions: renderInteractionsHelper,
  showInteractionModal: showInteractionModalHelper,
  dismissInteractionModal: dismissInteractionModalHelper,
  resolveInteraction: resolveInteractionHelper,
  rejectInteraction: rejectInteractionHelper,
  isInteractionBusy,
  refreshInteractionAttention,
});

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
    dom.btnLocaleLabel.textContent = state.locale === "zh-CN" ? t("settings.language.zh_cn") : t("settings.language.en_us");
  }
  renderTheme();
  renderTitlebarMenu();
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

function toolStatusLabel(status) {
  if (status === "completed") return t("task.status.completed");
  if (status === "running") return t("task.status.running");
  if (status === "error") return t("common.error");
  return t("checks.pending");
}

function processStatusLabel(status) {
  if (status === "completed") return t("task.status.completed");
  if (status === "failed") return t("task.status.failed");
  if (status === "blocked") return t("task.status.blocked");
  if (status === "queued") return t("task.status.queued");
  return t("task.status.running");
}

function roleLabel(role) {
  if (role === "user") return t("chat.role.user");
  if (role === "assistant") return t("chat.role.assistant");
  if (role === "planner") return t("chat.role.planner");
  if (role === "scheduler") return t("chat.role.scheduler");
  if (role === "delivery") return t("chat.role.delivery");
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
  renderPromptCatalog();
  renderTaskList();
  renderMemory();
  renderPreferences();
  renderLlmSummary();
  renderLlmApiKeyTools();
  if (state.config && state.providerCatalog) populateProviderSelect(state.config, state.providerCatalog);
  if (state.board) {
    renderBoard();
  } else {
    clearSectionPhases();
    renderTaskActions(null);
    renderSpec(null);
    renderPlan(null);
    renderChanges();
  }
  renderConversation();
  renderChatComposer();
  if (dom.skillMarketDialog?.open) renderSkillMarket();
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

function sanitizeOpacity(value) {
  const next = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(next)) return DEFAULT_OVERLAY_SETTINGS.opacity;
  return Math.max(MIN_WINDOW_OPACITY, Math.min(1, Math.round(next * 100) / 100));
}

function shouldMigrateOpacity(value) {
  if (typeof localStorage === "undefined") return false;
  if (localStorage.getItem(OPACITY_MIGRATION_KEY) === "true") return false;
  const next = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(next) && next <= LEGACY_WINDOW_OPACITY;
}

const systemThemeMedia =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: light)")
    : null;
const reducedMotionMedia =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

const techFx = {
  colors: {
    glow: "#8bc1b5",
    line: "#93a39c",
    soft: "#d7ddd7",
    warm: "#cf8b57",
  },
  ctx: null,
  dpr: 1,
  frame: 0,
  height: 0,
  last: 0,
  points: [],
  running: false,
  width: 0,
};

function clearTechFxCanvas() {
  if (!(dom.techAtlasCanvas instanceof HTMLCanvasElement)) return;
  if (techFx.frame) cancelAnimationFrame(techFx.frame);
  techFx.frame = 0;
  techFx.last = 0;
  techFx.running = false;
  techFx.points = [];
  techFx.width = 0;
  techFx.height = 0;
  techFx.ctx = null;
  dom.techAtlasCanvas.width = 0;
  dom.techAtlasCanvas.height = 0;
  dom.techAtlasCanvas.style.width = "0px";
  dom.techAtlasCanvas.style.height = "0px";
}

function reduceMotion() {
  return reducedMotionMedia?.matches === true;
}

function techColor(name, fallback) {
  if (typeof document === "undefined") return fallback;
  const node = document.body || document.documentElement;
  return getComputedStyle(node).getPropertyValue(name).trim() || fallback;
}

function refreshTechFxPalette() {
  techFx.colors = {
    glow: techColor("--accent", "#8bc1b5"),
    line: techColor("--text-soft", "#93a39c"),
    soft: techColor("--border-strong", "#d7ddd7"),
    warm: techColor("--accent-start", "#cf8b57"),
  };
}

function createTechPoint(width, height) {
  return {
    alpha: 0.018 + Math.random() * 0.028,
    layer: "mid",
    links: 0,
    link_dist: 0,
    orbit: 28 + Math.random() * 48,
    phase: Math.random() * Math.PI * 2,
    pulse: 0.00018 + Math.random() * 0.00032,
    r: 55 + Math.random() * 95,
    speed: 0.0000028 + Math.random() * 0.0000055,
    warm: Math.random() > 0.68,
    x: Math.random() * (width + 220) - 110,
    y: Math.random() * (height + 220) - 110,
  };
}

function rebuildTechFxPoints() {
  const total = clampNumber(Math.round((techFx.width * techFx.height) / 130000), 5, 10);
  const count = reduceMotion() ? Math.max(3, Math.round(total * 0.5)) : total;
  techFx.points = Array.from({ length: count }, () => createTechPoint(techFx.width, techFx.height));
}

function wrapTechCoord(value, size, margin) {
  const span = size + margin * 2;
  const next = (value + margin) % span;
  return (next < 0 ? next + span : next) - margin;
}

function syncTechFxSize(force = false) {
  if (!(dom.techAtlasCanvas instanceof HTMLCanvasElement)) return false;
  const width = Math.max(1, Math.round(window.innerWidth || window.visualViewport?.width || 1));
  const height = Math.max(1, Math.round(window.innerHeight || window.visualViewport?.height || 1));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resized =
    force
    || !techFx.ctx
    || techFx.width !== width
    || techFx.height !== height
    || techFx.dpr !== dpr;
  if (!resized) return false;
  const ctx = dom.techAtlasCanvas.getContext("2d");
  if (!ctx) return false;
  dom.techAtlasCanvas.width = Math.round(width * dpr);
  dom.techAtlasCanvas.height = Math.round(height * dpr);
  dom.techAtlasCanvas.style.width = `${width}px`;
  dom.techAtlasCanvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  techFx.ctx = ctx;
  techFx.dpr = dpr;
  techFx.width = width;
  techFx.height = height;
  rebuildTechFxPoints();
  return true;
}

function drawTechFx(ts = performance.now(), staticMode = false) {
  if (!techFx.ctx || !techFx.width || !techFx.height) return;
  const ctx = techFx.ctx;
  const width = techFx.width;
  const height = techFx.height;
  const clock = staticMode ? 0 : ts;
  const margin = 220;
  ctx.clearRect(0, 0, width, height);
  const points = techFx.points
    .map((point) => ({
      ...point,
      cx: wrapTechCoord(
        point.x
          + Math.cos(clock * point.speed + point.phase) * point.orbit
          + Math.sin(clock * point.speed * 0.38 + point.phase * 1.4) * point.orbit * 0.52,
        width,
        margin,
      ),
      cy: wrapTechCoord(
        point.y
          + Math.sin(clock * point.speed * 0.88 + point.phase) * point.orbit * 0.88
          + Math.cos(clock * point.speed * 0.32 + point.phase * 1.1) * point.orbit * 0.42,
        height,
        margin,
      ),
    }))
    .sort((a, b) => b.r - a.r);

  points.forEach((point) => {
    const pulse = 0.9 + Math.sin(clock * point.pulse + point.phase) * 0.12;
    const r = point.r * pulse;
    const color = point.warm ? techFx.colors.warm : techFx.colors.glow;

    // Outer diffuse halo
    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.globalAlpha = point.alpha * 0.42;
    ctx.shadowBlur = r * 1.6;
    ctx.shadowColor = color;
    ctx.arc(point.cx, point.cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Soft inner core
    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = techFx.colors.soft;
    ctx.globalAlpha = point.alpha * 0.22;
    ctx.shadowBlur = r * 0.5;
    ctx.shadowColor = color;
    ctx.arc(point.cx, point.cy, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function stopTechFx() {
  if (techFx.frame) cancelAnimationFrame(techFx.frame);
  techFx.frame = 0;
  techFx.last = 0;
  techFx.running = false;
}

function techFxStep(ts) {
  if (!techFx.running) return;
  drawTechFx(ts);
  techFx.frame = requestAnimationFrame(techFxStep);
}

function syncTechFx(force = false) {
  if (!(dom.techAtlasCanvas instanceof HTMLCanvasElement)) return;
  if (!TECH_FX_ENABLED) {
    clearTechFxCanvas();
    return;
  }
  syncTechFxSize(force);
  refreshTechFxPalette();
  if (document.visibilityState === "hidden" || reduceMotion()) {
    stopTechFx();
    drawTechFx(performance.now(), true);
    return;
  }
  if (techFx.running && !force) return;
  stopTechFx();
  techFx.running = true;
  techFx.frame = requestAnimationFrame(techFxStep);
}

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

let trayAttentionEnabled = false;

async function setTrayAttention(active) {
  if (!hasTauriRuntime()) return false;
  if (trayAttentionEnabled === !!active) return true;
  const result = await tauriInvoke("overlay_attention_set", { active: !!active }).catch(() => false);
  if (result) trayAttentionEnabled = !!active;
  return !!result;
}

function normalizeUrl(value, fallback = DEFAULT_SERVER) {
  const input = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return input.replace(/\/+$/, "");
}

function defaultAutoServer(value) {
  const input = normalizeUrl(value, DEFAULT_SERVER);
  return input === normalizeUrl(DEFAULT_SERVER) || input === "http://127.0.0.1:7878";
}

function sanitizeAutoServer(value, serverUrl) {
  if (typeof value === "boolean") return value;
  return defaultAutoServer(serverUrl);
}

function resolveAutoServer(value, previous = {}) {
  const next = normalizeUrl(value, DEFAULT_SERVER);
  if (previous.autoServer && next === normalizeUrl(previous.serverUrl, DEFAULT_SERVER)) return true;
  return defaultAutoServer(next);
}

function isManagedLocalServerUrl(value) {
  const input = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_SERVER;
  try {
    const url = new URL(input);
    return url.protocol.startsWith("http") && ["127.0.0.1", "localhost"].includes(url.hostname);
  } catch {
    /* invalid URL — not a managed local server address */
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usesManagedLocalServer() {
  return state.autoServer && isManagedLocalServerUrl(state.serverUrl);
}

async function localServerInfo() {
  if (!hasTauriRuntime()) return null;
  const info = await tauriInvoke("overlay_server_info").catch(() => undefined);
  return info && typeof info.url === "string" ? info : null;
}

async function syncLocalServerUrl(options = {}) {
  if (!hasTauriRuntime()) return null;
  if (!options.force && !usesManagedLocalServer()) return null;
  const info = await localServerInfo();
  if (!info) return null;
  const next = normalizeUrl(info.url);
  if (normalizeUrl(state.serverUrl) === next) return info;
  state.serverUrl = next;
  await persistOverlaySettings();
  return info;
}

async function restartLocalServer() {
  if (!hasTauriRuntime() || !usesManagedLocalServer()) return null;
  const info = await tauriInvoke("overlay_server_restart").catch(() => undefined);
  if (!info || typeof info.url !== "string") return null;
  state.serverUrl = normalizeUrl(info.url);
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

function sanitizeDirectoryMode(value, directory) {
  if (value === "custom") return "custom";
  if (typeof value === "string" && value.trim() === "temp") return "temp";
  return typeof directory === "string" && directory.trim() ? "custom" : DEFAULT_OVERLAY_SETTINGS.directoryMode;
}

function savedDirectoryValue(directory, mode) {
  const next = typeof directory === "string" ? directory.trim() : "";
  if (!next) return "";
  return sanitizeDirectoryMode(mode, next) === "custom" ? next : "";
}

function settingsDirectory(settings) {
  return typeof settings?.directory === "string" ? settings.directory.trim() : "";
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
  const serverUrl = localStorage.getItem("oc_server_url") || DEFAULT_OVERLAY_SETTINGS.serverUrl;
  const autoServer = localStorage.getItem("oc_auto_server");
  const directory = savedDirectoryValue(
    localStorage.getItem("oc_directory") || DEFAULT_OVERLAY_SETTINGS.directory,
    localStorage.getItem("oc_directory_mode"),
  );
  return {
    serverUrl,
    autoServer: autoServer === null ? defaultAutoServer(serverUrl) : autoServer !== "false",
    password: localStorage.getItem("oc_password") || DEFAULT_OVERLAY_SETTINGS.password,
    username: localStorage.getItem("oc_username") || DEFAULT_OVERLAY_SETTINGS.username,
    executor: localStorage.getItem("oc_executor") || DEFAULT_OVERLAY_SETTINGS.executor,
    initGit: true,
    alwaysOnTop: localStorage.getItem("oc_always_on_top") === "true",
    unattended: localStorage.getItem("oc_unattended") !== "false",
    autoPermission: localStorage.getItem("oc_auto_permission") === "true",
    autoQuestion: localStorage.getItem("oc_auto_question") === "true",
    showTranscriptDetails: localStorage.getItem("oc_show_transcript_details") === "true",
    sidebarCollapsed: localStorage.getItem("oc_sidebar_collapsed") === "true",
    sidebarWidth: sanitizePaneWidth(localStorage.getItem("oc_sidebar_width")),
    sectionsWidth: sanitizePaneWidth(localStorage.getItem("oc_sections_width")),
    opacity: sanitizeOpacity(localStorage.getItem("oc_opacity")),
    zoom: sanitizeZoom(localStorage.getItem("oc_zoom")),
    theme: sanitizeTheme(localStorage.getItem("oc_theme")),
    locale: sanitizeLocale(localStorage.getItem("oc_locale") || DEFAULT_OVERLAY_SETTINGS.locale),
    directory,
    workspaceTaskID: localStorage.getItem("oc_workspace_task") || DEFAULT_OVERLAY_SETTINGS.workspaceTaskID,
    workspaceDirectory: localStorage.getItem("oc_workspace_directory") || DEFAULT_OVERLAY_SETTINGS.workspaceDirectory,
  };
}

function applyOverlaySettings(settings, options = {}) {
  const directory = savedDirectoryValue(settings?.directory, settings?.directoryMode);
  state.serverUrl =
    typeof settings?.serverUrl === "string" && settings.serverUrl.trim()
      ? settings.serverUrl.trim()
      : DEFAULT_OVERLAY_SETTINGS.serverUrl;
  state.autoServer = sanitizeAutoServer(settings?.autoServer, state.serverUrl);
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
  state.unattended = settings?.unattended !== false;
  state.autoPermission = settings?.autoPermission === true;
  state.autoQuestion = settings?.autoQuestion === true;
  state.sidebarCollapsed = settings?.sidebarCollapsed === true;
  state.sidebarWidth = sanitizePaneWidth(settings?.sidebarWidth);
  state.sectionsWidth = sanitizePaneWidth(settings?.sectionsWidth);
  state.opacity = sanitizeOpacity(settings?.opacity);
  state.zoom = sanitizeZoom(settings?.zoom);
  state.theme = sanitizeTheme(settings?.theme);
  state.locale = sanitizeLocale(settings?.locale || DEFAULT_OVERLAY_SETTINGS.locale);
  state.workspaceTaskID =
    typeof settings?.workspaceTaskID === "string" ? settings.workspaceTaskID.trim() : DEFAULT_OVERLAY_SETTINGS.workspaceTaskID;
  state.workspaceDirectory =
    typeof settings?.workspaceDirectory === "string"
      ? workspaceRestoreDirectory(settings.workspaceDirectory)
      : DEFAULT_OVERLAY_SETTINGS.workspaceDirectory;
  state.savedDirectory = directory;
  if (options.resetTemp === true) state.tempDirectory = "";
  if (options.preserveDirectory !== true || !state.directory) state.directory = directory;
  state.directoryMode = directory ? "custom" : "temp";
}

function bootstrapOverlaySettings(input = state) {
  return {
    serverUrl: input.serverUrl,
    autoServer: input.autoServer,
    password: input.password,
    username: input.username,
    executor: input.executor,
    initGit: true,
    alwaysOnTop: input.alwaysOnTop,
    unattended: input.unattended,
    autoPermission: input.autoPermission,
    autoQuestion: input.autoQuestion,
    showTranscriptDetails: input.showTranscriptDetails,
    sidebarCollapsed: input.sidebarCollapsed,
    sidebarWidth: input.sidebarWidth || undefined,
    sectionsWidth: input.sectionsWidth || undefined,
    opacity: input.opacity,
    zoom: input.zoom,
    theme: input.theme,
    locale: input.locale,
    directoryMode: input.savedDirectory ? "custom" : "temp",
    directory: input.savedDirectory || undefined,
    workspaceTaskID: input.workspaceTaskID || undefined,
    workspaceDirectory: input.workspaceDirectory || undefined,
  };
}

function rememberWorkspace(input = {}) {
  const taskID = typeof input.taskID === "string"
    ? input.taskID.trim()
    : state.selectedTaskID || state.workspaceTaskID || "";
  const directory = workspaceRestoreDirectory(
    typeof input.directory === "string"
      ? input.directory.trim()
      : state.savedDirectory || activeDirectory() || state.directory || "",
  ) || workspaceRestoreDirectory(state.savedDirectory || "") || "";
  state.workspaceTaskID = taskID;
  state.workspaceDirectory = taskID ? directory : "";
}

function looksLikeExecutionWorkspace(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return /(^|[\\/])goal-workspace([\\/]|$)/i.test(text);
}

function workspaceRestoreDirectory(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (looksLikeExecutionWorkspace(text)) return "";
  return text;
}

function clearWorkspaceMemory() {
  state.workspaceTaskID = "";
  state.workspaceDirectory = "";
}

async function loadOverlaySettings() {
  const browser = browserOverlaySettings();
  const saved = await tauriInvoke("overlay_settings_load", {
    directory: settingsDirectory(browser) || undefined,
  }).catch(() => undefined);
  const next = saved && typeof saved === "object"
    ? { ...browser, ...saved }
    : browser;
  bootstrapSettings = { ...DEFAULT_OVERLAY_SETTINGS, ...next };
  if (shouldMigrateOpacity(next.opacity)) {
    bootstrapSettings = { ...bootstrapSettings, opacity: DEFAULT_OVERLAY_SETTINGS.opacity };
    applyOverlaySettings(bootstrapSettings, { resetTemp: true });
    localStorage.setItem(OPACITY_MIGRATION_KEY, "true");
    await persistOverlaySettings();
    return;
  }
  applyOverlaySettings(bootstrapSettings, { resetTemp: true });
}

const RECENT_DIRS_KEY = "oc_recent_directories";
const MAX_RECENT_DIRS = 10;

function loadRecentDirectories() {
  try {
    const raw = localStorage.getItem(RECENT_DIRS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((d) => typeof d === "string" && d.trim()) : [];
  } catch {
    return [];
  }
}

function saveRecentDirectories(dirs) {
  try {
    localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(dirs));
  } catch { /* ignore quota errors */ }
}

function addRecentDirectory(dir) {
  if (!dir || typeof dir !== "string") return;
  const normalized = dir.trim();
  if (!normalized) return;
  const dirs = loadRecentDirectories().filter((d) => d.toLowerCase() !== normalized.toLowerCase());
  dirs.unshift(normalized);
  saveRecentDirectories(dirs.slice(0, MAX_RECENT_DIRS));
}

function removeRecentDirectory(dir) {
  if (!dir) return;
  const normalized = dir.trim().toLowerCase();
  saveRecentDirectories(loadRecentDirectories().filter((d) => d.toLowerCase() !== normalized));
}

async function persistOverlaySettings() {
  rememberWorkspace();
  const settings = bootstrapOverlaySettings();
  bootstrapSettings = {
    ...bootstrapSettings,
    ...settings,
  };
  localStorage.setItem("oc_server_url", settings.serverUrl);
  localStorage.setItem("oc_auto_server", String(settings.autoServer));
  localStorage.setItem("oc_password", settings.password);
  localStorage.setItem("oc_username", settings.username);
  localStorage.setItem("oc_executor", settings.executor || DEFAULT_OVERLAY_SETTINGS.executor);
  localStorage.removeItem("oc_init_git");
  localStorage.setItem("oc_always_on_top", String(settings.alwaysOnTop ?? DEFAULT_OVERLAY_SETTINGS.alwaysOnTop));
  localStorage.setItem("oc_unattended", String(settings.unattended ?? DEFAULT_OVERLAY_SETTINGS.unattended));
  localStorage.setItem("oc_auto_permission", String(settings.autoPermission ?? DEFAULT_OVERLAY_SETTINGS.autoPermission));
  localStorage.setItem("oc_auto_question", String(settings.autoQuestion ?? DEFAULT_OVERLAY_SETTINGS.autoQuestion));
  localStorage.setItem("oc_show_transcript_details", String(settings.showTranscriptDetails ?? DEFAULT_OVERLAY_SETTINGS.showTranscriptDetails));
  localStorage.setItem("oc_sidebar_collapsed", String(settings.sidebarCollapsed ?? DEFAULT_OVERLAY_SETTINGS.sidebarCollapsed));
  if (settings.sidebarWidth) localStorage.setItem("oc_sidebar_width", String(settings.sidebarWidth));
  else localStorage.removeItem("oc_sidebar_width");
  if (settings.sectionsWidth) localStorage.setItem("oc_sections_width", String(settings.sectionsWidth));
  else localStorage.removeItem("oc_sections_width");
  localStorage.setItem("oc_opacity", String(settings.opacity ?? DEFAULT_OVERLAY_SETTINGS.opacity));
  localStorage.setItem("oc_zoom", String(settings.zoom ?? DEFAULT_OVERLAY_SETTINGS.zoom));
  localStorage.setItem("oc_theme", settings.theme || DEFAULT_OVERLAY_SETTINGS.theme);
  localStorage.setItem("oc_locale", settings.locale || DEFAULT_OVERLAY_SETTINGS.locale);
  if (settings.workspaceTaskID) localStorage.setItem("oc_workspace_task", settings.workspaceTaskID);
  else localStorage.removeItem("oc_workspace_task");
  localStorage.removeItem("oc_workspace_session");
  if (settings.workspaceDirectory) localStorage.setItem("oc_workspace_directory", settings.workspaceDirectory);
  else localStorage.removeItem("oc_workspace_directory");
  if (settings.directory) localStorage.setItem("oc_directory", settings.directory);
  else localStorage.removeItem("oc_directory");
  localStorage.removeItem("oc_directory_mode");
  const saved = await tauriInvoke("overlay_settings_save", {
    settings,
    directory: settingsDirectory(settings) || undefined,
  }).catch(() => undefined);
  if (saved) return;
}

async function applyWindowPin() {
  const win = await currentTauriWindow();
  if (!win || typeof win.setAlwaysOnTop !== "function") {
    renderTitlebarMenu();
    return;
  }
  await win.setAlwaysOnTop(state.alwaysOnTop).catch(() => undefined);
  if (dom.btnPin) dom.btnPin.dataset.pinned = String(state.alwaysOnTop);
  renderTitlebarMenu();
}

async function createTempDirectory() {
  const created = await tauriInvoke("overlay_create_temp_dir").catch(() => undefined);
  return typeof created === "string" ? created.trim() : "";
}

async function scaffoldProjectConfig(dir) {
  if (!dir) return;
  const base = dir.replace(/[\\/]+$/, "");
  const configFile = base + "/.opencorvus/opencorvus.jsonc";
  const config = {
    $schema: "https://opencorvus.ai/config.json",
    experimental: {
      unattended: state.unattended !== false,
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
    username: state.username || "",
  };
  try {
    await tauriInvoke("overlay_write_file", { path: configFile, content: JSON.stringify(config, null, 2) });
  } catch (e) {
    AppLog.warn("scaffold", "Failed to scaffold project config", { error: String(e) });
  }
}

async function ensureDefaultDirectory() {
  if (state.savedDirectory) {
    state.directory = state.savedDirectory;
    state.directoryMode = "custom";
    return false;
  }
  if (state.tempDirectory) {
    state.directory = state.tempDirectory;
    state.directoryMode = "temp";
    return false;
  }
  if (!hasTauriRuntime()) return false;
  const next = await createTempDirectory();
  if (!next) return false;
  await scaffoldProjectConfig(next);
  state.tempDirectory = next;
  state.directory = next;
  state.savedDirectory = "";
  state.directoryMode = "temp";
  await persistOverlaySettings();
  return true;
}

function renderTheme() {
  const theme = sanitizeTheme(state.theme);
  const effective = theme === "system" ? resolvedTheme() : theme;
  state.theme = theme;
  document.body.dataset.theme = effective;
  if (dom.brandLogo) {
    dom.brandLogo.setAttribute("src", effective === "light" ? BRAND_LOGO.light : BRAND_LOGO.dark);
  }
  if (dom.btnTheme) {
    dom.btnTheme.dataset.theme = effective;
    dom.btnTheme.dataset.mode = theme;
    dom.btnTheme.title = effective === "light" ? t("titlebar.theme.dark") : t("titlebar.theme.light");
    dom.btnTheme.setAttribute("aria-label", dom.btnTheme.title);
  }
  if (dom.btnMaximize) {
    const label = maximizeLabel(dom.btnMaximize.dataset.maximized === "true");
    dom.btnMaximize.title = label;
    dom.btnMaximize.setAttribute("aria-label", label);
  }
  if (dom.themeMode) {
    dom.themeMode.value = theme;
  }
  renderTitlebarMenu();
  syncTechFx(true);
}

function setTitlebarMenu(open) {
  if (!dom.titlebarMenu || !dom.btnTitlebarMenu) return;
  const next = !!open;
  dom.titlebarMenu.hidden = !next;
  dom.btnTitlebarMenu.setAttribute("aria-expanded", String(next));
}

function closeTitlebarMenu() {
  setTitlebarMenu(false);
}

function renderTitlebarMenu() {
  if (dom.btnThemeValue) {
    const theme = sanitizeTheme(state.theme);
    dom.btnThemeValue.textContent =
      theme === "light"
        ? t("settings.theme.light")
        : theme === "system"
          ? t("settings.theme.system")
          : t("settings.theme.dark");
  }
  if (dom.btnPinValue) {
    dom.btnPinValue.textContent = state.alwaysOnTop ? t("common.yes") : t("common.no");
  }
  if (dom.chkUnattended) {
    dom.chkUnattended.checked = state.unattended;
  }
  if (dom.chkAutoPermission) {
    dom.chkAutoPermission.checked = state.autoPermission;
  }
  if (dom.chkAutoQuestion) {
    dom.chkAutoQuestion.checked = state.autoQuestion;
  }
  if (dom.chkShowTranscriptDetails) {
    dom.chkShowTranscriptDetails.checked = state.showTranscriptDetails;
  }
  if (dom.opacityRange) {
    dom.opacityRange.value = String(Math.round(sanitizeOpacity(state.opacity) * 100));
  }
  if (dom.opacityValue) {
    dom.opacityValue.textContent = `${Math.round(sanitizeOpacity(state.opacity) * 100)}%`;
  }
}

async function applyWindowOpacity() {
  state.opacity = sanitizeOpacity(state.opacity);
  renderTitlebarMenu();
  const value = String(state.opacity);
  const win = await currentTauriWindow();
  if (!win || typeof win.setOpacity !== "function") {
    document.documentElement.style.setProperty("--ui-window-opacity", value);
    return false;
  }
  const ok = await win.setOpacity(state.opacity).then(
    () => true,
    () => false,
  );
  document.documentElement.style.setProperty("--ui-window-opacity", ok ? "1" : value);
  return ok;
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
  renderExecutor({ measure: true });
  syncTechFx();
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

function apiUrl(path, input = {}) {
  const base = state.serverUrl.replace(/\/+$/, "");
  const next = path.replace(/^\/+/, "");
  const idx = next.indexOf("?");
  const pathname = idx >= 0 ? next.slice(0, idx) : next;
  const params = new URLSearchParams(idx >= 0 ? next.slice(idx + 1) : "");
  const dir = input.directory;
  const current = typeof dir === "string" ? dir : dir === false ? "" : state.directory;
  if (current) params.set("directory", current);
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

async function apiFetch(path, opts = {}, input) {
  const url = apiUrl(path, input);
  const res = await fetch(url, {
    ...opts,
    headers: { ...apiHeaders(), ...opts.headers },
    signal: opts.signal || AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res;
}

async function apiJson(path, opts, input) {
  const res = await apiFetch(path, opts, input);
  return res.json();
}

function canComposeChat() {
  if (!state.connected) return false;
  const mode = workspaceMode();
  if (mode === "empty") return true;
  if (mode === "task") return true;
  return false;
}

function chatInputText() {
  return dom.chatTextarea?.value?.trim() || "";
}

function isAbortError(error) {
  return error instanceof Error && error.name === "AbortError";
}

function chatAbortTarget() {
  return chatAbortTargets()[0] || null;
}

function chatAbortTargets(seed) {
  const items = [];
  const seen = new Set();
  const push = (target) => {
    if (!target) return;
    const key =
      target.kind === "run"
        ? `run:${target.runID}`
        : target.kind === "session"
          ? `session:${target.sessionID}`
          : target.kind === "task"
            ? `task:${target.taskID}`
            : "";
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push(target);
  };

  push(seed);
  if (!state.selectedTaskID) return items;

  const runID = state.board?.task?.activeRunID || state.executorRunID || "";
  if (runID) {
    push({
      kind: "run",
      runID,
    });
  }
  const sessionID = currentTaskSessionID();
  if (sessionID) {
    push({
      kind: "session",
      sessionID,
    });
  }
  push({
    kind: "task",
    taskID: state.selectedTaskID,
  });
  return items;
}

async function abortChatTarget(target) {
  if (!target) return false;
  if (target.kind === "run") {
    await apiJson(`run/${encodeURIComponent(target.runID)}/abort`, {
      method: "POST",
    });
    return true;
  }
  if (target.kind === "task") {
    await apiJson(`task/${encodeURIComponent(target.taskID)}/cancel`, {
      method: "POST",
    });
    return true;
  }
  await apiJson(`session/${encodeURIComponent(target.sessionID)}/abort`, {
    method: "POST",
  });
  return true;
}

function renderChatComposer() {
  if (!dom.chatTextarea || !dom.chatSend) return;
  const request = state.chatRequest;
  const busy = !!request;
  const enabled = canComposeChat();
  const hasText = !!chatInputText();
  const label = dom.chatSend.querySelector(".chat-send-label");
  const icon = dom.chatSend.querySelector(".chat-send-icon");
  dom.chatTextarea.disabled = !enabled;
  dom.chatTextarea.setAttribute("placeholder", enabled ? t("chat.placeholder") : t("chat.placeholder_disabled"));
  if (dom.btnTaskInterrupt) dom.btnTaskInterrupt.hidden = true;
  dom.chatSend.classList.toggle("chat-interrupt", busy);
  dom.chatSend.dataset.mode = busy ? "stop" : "send";
  dom.chatSend.type = busy ? "button" : "submit";
  dom.chatSend.disabled = busy ? request.stopping === true : !enabled || !hasText;
  dom.chatSend.title = busy ? t("chat.stop_title") : t("chat.send_title");
  dom.chatSend.setAttribute("aria-label", busy ? t("chat.stop_label") : t("chat.send_label"));
  if (label) {
    label.textContent = busy ? t("chat.stop_label") : t("chat.send_label");
  }
  if (icon) {
    icon.innerHTML = busy
      ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.2" fill="currentColor"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8l10-5-3 5 3 5z" fill="currentColor"/></svg>';
  }
}

async function stopChatRequest(options = {}) {
  const request = state.chatRequest;
  if (!request || request.stopping) return false;
  request.aborted = true;
  request.manualAbort = options.manual !== false;
  request.stopping = true;
  request.recovery?.stop();
  renderChatComposer();
  request.controller.abort();
  if (options.remote === false) return true;
  const targets = chatAbortTargets(request.target);
  if (targets.length === 0) return true;
  try {
    for (const target of targets) {
      try {
        await abortChatTarget(target);
        return true;
      } catch (e) {
        AppLog.warn("chat", "Failed to abort active conversation", { error: String(e), target });
      }
    }
    return false;
  } finally {
    request.stopping = false;
    renderChatComposer();
  }
}

function chatPlaceholder() {
  return state.messages.find((item) =>
    item.info?.role === "assistant" &&
    !item.info?.id &&
    Array.isArray(item.parts) &&
    item.parts.length === 1 &&
    item.parts[0]?.type === "text",
  ) || state.messages.find((item) => item.info?.role === "assistant" && item.parts?.[0]?.text === "……")
    || state.messages.find((item) => item.info?.role === "assistant" && item.parts?.[0]?.text === "...")
    || state.messages.find((item) => item.info?.role === "assistant" && item.parts?.[0]?.text === t("chat.thinking"));
}

function isPendingPlaceholderPart(part) {
  return part?.type === "text" && !part.id && ["……", "...", t("chat.thinking")].includes(part.text);
}

function overlayTestConfig() {
  const value = window.__overlayTest;
  return value && typeof value === "object" ? value : null;
}

function overlayTiming(name, fallback, min = 50) {
  const value = Number(overlayTestConfig()?.[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

function chatRequestTimeoutMs() {
  return overlayTiming("chatTimeoutMs", 10 * 60 * 1000, 1000);
}

function taskRecoveryTimeoutMs() {
  return overlayTiming("taskRecoveryTimeoutMs", 10 * 60 * 1000, 1000);
}

function taskRecoveryPollMs() {
  return overlayTiming("taskRecoveryPollMs", 2000, 50);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function addChatAttachment(file) {
  if (!file) return;
  if (file.size > MAX_ATTACHMENT_SIZE) {
    showLlmNotice(t("chat.file_too_large"), "error", 3000);
    return;
  }
  const url = await fileToDataUrl(file);
  state.chatAttachments.push({ mime: file.type || "application/octet-stream", url, filename: file.name });
  renderChatAttachments();
}

function removeChatAttachment(index) {
  state.chatAttachments.splice(index, 1);
  renderChatAttachments();
}

function clearChatAttachments() {
  state.chatAttachments = [];
  renderChatAttachments();
}

function renderChatAttachments() {
  const container = dom.chatAttachments;
  if (!container) return;
  if (!state.chatAttachments.length) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  container.hidden = false;
  container.innerHTML = state.chatAttachments.map((att, index) => {
    const isImage = att.mime.startsWith("image/");
    const thumb = isImage
      ? `<img class="chat-attachment-thumb" src="${escapeHtml(att.url)}" alt="${escapeHtml(att.filename || "")}">`
      : `<span class="chat-attachment-icon">${escapeHtml(att.filename?.split(".").pop()?.toUpperCase() || "FILE")}</span>`;
    const name = escapeHtml(att.filename || "file");
    return `<div class="chat-attachment-item" title="${escapeHtml(att.filename || "")}">${thumb}<span class="chat-attachment-name">${name}</span><button type="button" class="chat-attachment-remove" data-remove-attachment="${index}" aria-label="Remove">&times;</button></div>`;
  }).join("");
}

function panelRequestBody(text, metadata = {}, requestID) {
  const taskID = state.selectedTaskID || undefined;
  const body = {
    surface: "panel",
    text,
    time_created: Date.now(),
    taskID,
    executor: state.executor,
    request_id: requestID || undefined,
    allow_create: true,
    allow_session_mutation: false,
    directory: activeDirectory() || undefined,
    metadata: {
      selectedTaskID: taskID,
      ...metadata,
    },
  };
  if (state.chatAttachments.length > 0) {
    body.attachments = state.chatAttachments.map((att) => ({
      mime: att.mime,
      url: att.url,
      ...(att.filename ? { filename: att.filename } : {}),
    }));
  }
  return body;
}

function takeChatMetadata() {
  const meta = record(window.__ocNextChatMetadata) ? window.__ocNextChatMetadata : undefined;
  delete window.__ocNextChatMetadata;
  return meta;
}

function panelResultNavigates(result) {
  if (!result || typeof result !== "object") return false;
  const action = result.local_action?.type;
  if (action === "select_task") return true;
  if (result.task_id) return true;
  return false;
}

function cloneMessages(list) {
  if (!Array.isArray(list) || list.length === 0) return [];
  if (typeof structuredClone === "function") return structuredClone(list);
  return JSON.parse(JSON.stringify(list));
}

function mergeSnapshotFieldTarget(existing, field, snapshotValue) {
  const snapshotText = displayString(snapshotValue);
  const currentText =
    field === "output"
      ? displayString(existing?._targetOutput || existing?.state?.output)
      : displayString(existing?._targetText || existing?.text);
  if (!snapshotText) return currentText;
  if (!currentText) return snapshotText;
  if (snapshotText === currentText) return snapshotText;
  if (snapshotText.startsWith(currentText)) return snapshotText;
  if (currentText.startsWith(snapshotText)) return currentText;
  const key = messageLiveTextKey(existing, field);
  return key && liveTextStreams.has(key) ? currentText : snapshotText;
}

function shouldPreserveSnapshotLiveText(existing, field) {
  if (!record(existing)) return false;
  const key = messageLiveTextKey(existing, field);
  if (key && liveTextStreams.has(key)) return true;
  if (field === "output") {
    return typeof existing?._targetOutput === "string" && !!existing._targetOutput;
  }
  return typeof existing?._targetText === "string" && !!existing._targetText;
}

function mergeSnapshotPart(existing, part) {
  if (!record(part)) return part;
  if ((part.type === "text" || part.type === "reasoning") && typeof part.text === "string") {
    const nextPart = {
      ...part,
      text: mergeSnapshotFieldTarget(existing, "text", part.text),
    };
    if (!shouldPreserveSnapshotLiveText(existing, "text")) {
      const merged = {
        ...(record(existing) ? existing : {}),
        ...nextPart,
      };
      delete merged._targetText;
      return merged;
    }
    return hydrateLivePart(existing, nextPart);
  }
  if (part.type === "tool" && record(part.state) && typeof part.state.output === "string") {
    const nextPart = {
      ...part,
      state: {
        ...part.state,
        output: mergeSnapshotFieldTarget(existing, "output", part.state.output),
      },
    };
    if (!shouldPreserveSnapshotLiveText(existing, "output")) {
      const merged = {
        ...(record(existing) ? existing : {}),
        ...nextPart,
      };
      delete merged._targetOutput;
      return merged;
    }
    return hydrateLivePart(existing, nextPart);
  }
  return {
    ...(record(existing) ? existing : {}),
    ...part,
  };
}

function mergeSnapshotParts(existingParts, snapshotParts) {
  const current = Array.isArray(existingParts) ? existingParts : [];
  const next = Array.isArray(snapshotParts) ? snapshotParts : [];
  const currentByID = new Map(
    current
      .filter((part) => typeof part?.id === "string" && part.id)
      .map((part) => [part.id, part]),
  );
  const snapshotIDs = new Set(
    next
      .map((part) => (typeof part?.id === "string" ? part.id : ""))
      .filter(Boolean),
  );
  const merged = next.map((part) => mergeSnapshotPart(currentByID.get(part?.id), part));
  for (const part of current) {
    const id = typeof part?.id === "string" ? part.id : "";
    if (id && snapshotIDs.has(id)) continue;
    if (next.length > 0 && isPendingPlaceholderPart(part)) continue;
    merged.push(part);
  }
  return merged;
}

function mergeSnapshotMessage(existing, message) {
  const merged = {
    ...(record(existing) ? existing : {}),
    ...message,
    info: {
      ...(record(existing?.info) ? existing.info : {}),
      ...(record(message?.info) ? message.info : {}),
    },
  };
  merged.parts = mergeSnapshotParts(existing?.parts, message?.parts);
  return merged;
}

function pruneConversationLiveText(messages = []) {
  const keep = new Set();
  for (const message of Array.isArray(messages) ? messages : []) {
    for (const part of Array.isArray(message?.parts) ? message.parts : []) {
      const textKey = messageLiveTextKey(part, "text");
      const outputKey = messageLiveTextKey(part, "output");
      if (textKey && typeof part?._targetText === "string" && part._targetText) keep.add(textKey);
      if (outputKey && typeof part?._targetOutput === "string" && part._targetOutput) keep.add(outputKey);
    }
  }
  for (const key of [...liveTextStreams.keys()]) {
    if (!key.startsWith("message:")) continue;
    if (keep.has(key)) continue;
    stopLiveText(key);
  }
}

function mergeConversationSnapshot(snapshotMessages = []) {
  const current = Array.isArray(state.messages) ? state.messages : [];
  const snapshot = Array.isArray(snapshotMessages) ? snapshotMessages : [];
  const currentByID = new Map(
    current
      .filter((message) => typeof message?.info?.id === "string" && message.info.id)
      .map((message) => [message.info.id, message]),
  );
  const snapshotIDs = new Set(
    snapshot
      .map((message) => (typeof message?.info?.id === "string" ? message.info.id : ""))
      .filter(Boolean),
  );
  const merged = snapshot.map((message) => mergeSnapshotMessage(currentByID.get(message?.info?.id), message));
  for (const message of current) {
    const id = typeof message?.info?.id === "string" ? message.info.id : "";
    if (id && snapshotIDs.has(id)) continue;
    merged.push(message);
  }
  const next = sortMessages(mergeMessages(merged));
  pruneConversationLiveText(next);
  return next;
}

function stashPendingTaskMessages() {
  const next = cloneMessages(state.messages);
  state.pendingTaskMessages = next.length ? next : null;
}

function optimisticTask(taskID, result) {
  const now = Date.now();
  const request =
    typeof result?._request === "string" && result._request.trim()
      ? result._request.trim()
      : "";
  const title = clipText(request || result?.message || taskID, 72) || taskID;
  const directory = activeDirectory();
  return {
    task: {
      id: taskID,
      title,
      status: "queued",
      directory,
      sessionID: "",
      time: {
        created: now,
        updated: now,
      },
    },
    overview: {
      headline: title,
    },
    updated_at: now,
    pending_interactions: 0,
  };
}

function ensureTaskVisible(taskID, result) {
  if (!taskID || state.tasks.some((item) => item?.task?.id === taskID)) return;
  state.tasks = sortedTasks({
    tasks: [optimisticTask(taskID, result), ...state.tasks],
  });
  renderTaskList();
}

function taskByRequestID(requestID, list = state.tasks) {
  if (!requestID || !Array.isArray(list)) return null;
  return list.find((item) => item?.task?.requestID === requestID) || null;
}

function startTaskRecovery(request) {
  if (!request?.requestID) return null;
  const recovery = {
    active: true,
    stop() {
      recovery.active = false;
    },
  };
  recovery.promise = (async () => {
    const started = Date.now();
    while (recovery.active && Date.now() - started < taskRecoveryTimeoutMs()) {
      if (request.manualAbort) break;
      if (state.workspaceEpoch !== request.workspaceEpoch && !request.recoveredTaskID) break;
      const data = await apiJson("tasks").catch(() => null);
      const tasks = Array.isArray(data?.tasks) ? sortedTasks(data) : [];
      const match = taskByRequestID(request.requestID, tasks);
      const taskID = match?.task?.id || "";
      if (taskID) {
        forgetPendingTask(request.requestID);
        request.recoveredTaskID = taskID;
        state.tasks = tasks;
        renderTaskList();
        if (state.selectedTaskID !== taskID) {
          stashPendingTaskMessages();
          scheduleTasks(300);
          await selectTask(taskID, { preserveChatRequest: true });
        }
        if (!request.timedOut && !request.aborted) {
          request.aborted = true;
          request.controller.abort();
        }
        recovery.stop();
        return taskID;
      }
      await delay(taskRecoveryPollMs());
    }
    recovery.stop();
    if (request.timedOut && !request.manualAbort && !request.recoveredTaskID && state.workspaceEpoch === request.workspaceEpoch) {
      forgetPendingTask(request.requestID);
      const ph = chatPlaceholder();
      if (ph) ph.parts[0].text = t("chat.interrupted_notice");
      renderConversation();
    }
    return "";
  })();
  return recovery;
}

async function applyPanelResult(result) {
  if (result?.local_action?.type === "set_executor") {
    state.executor = result.local_action.executor;
    await persistOverlaySettings();
    renderExecutor();
  }
  if (result?.local_action?.type === "select_task" && result.local_action.taskID) {
    await loadTasks();
    await selectTask(result.local_action.taskID, { preserveChatRequest: true });
    return;
  }
  if (result?.task_id && state.selectedTaskID !== result.task_id) {
    stashPendingTaskMessages();
    await loadTasks();
    ensureTaskVisible(result.task_id, result);
    scheduleTasks(300);
    await selectTask(result.task_id, { preserveChatRequest: true });
    return;
  }
  if (state.selectedTaskID) {
    await loadBoard({ sync: true });
    await loadConversation();
    void loadMemory();
  } else {
    await loadTasks();
  }
}

async function panelMessage(text, metadata, signal, options = {}) {
  AppLog.debug("panel", "message: " + text.slice(0, 80));
  const requestSignal = signal ?? AbortSignal.timeout(chatRequestTimeoutMs());
  return panelMessageStream(
    text,
    metadata,
    requestSignal,
    options.workspaceEpoch ?? state.workspaceEpoch,
    options.requestID ?? crypto.randomUUID(),
  );
}

async function panelMessageStream(text, metadata, signal, workspaceEpoch = state.workspaceEpoch, requestID = crypto.randomUUID()) {
  const body = JSON.stringify(panelRequestBody(text, metadata, requestID));
  const requestSignal = signal ?? AbortSignal.timeout(chatRequestTimeoutMs());
  const res = await fetch(apiUrl("panel/message/stream"), {
    method: "POST",
    headers: { ...apiHeaders(), "Content-Type": "application/json" },
    body,
    signal: requestSignal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Panel stream failed: ${res.status} ${res.statusText}`);
  }

  // Replace "……" thinking placeholder with a live indicator
  const placeholder = state.messages.find((m) => m.info?.role === "assistant" && m.parts?.[0]?.text === "……");
  if (state.workspaceEpoch === workspaceEpoch) {
    if (placeholder) streamMessagePart(placeholder.parts[0], "...", "text", placeholder.parts[0].text || "");
    renderConversation();
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let result = null;
  let live = "";
  let reasoning = "";
  let streamed = false;
  const consume = (chunk, flush = false) => {
    buf += chunk;
    const blocks = buf.split(/\r?\n\r?\n/);
    if (!flush) {
      buf = blocks.pop() || "";
    } else {
      buf = "";
    }
    for (const block of blocks) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      try {
        const ev = JSON.parse(data);
        if (state.workspaceEpoch !== workspaceEpoch) continue;
        if (ev.type === "tool" && placeholder && !streamed) {
          streamMessagePart(placeholder.parts[0], t("chat.thinking"), "text", placeholder.parts[0].text || "");
          renderConversation();
        } else if (ev.type === "reasoning_delta" && placeholder && typeof ev.delta === "string") {
          reasoning += ev.delta;
          const part = ensureMessageReasoningPart(placeholder, `panel-reasoning:${requestID}`);
          if (!part) continue;
          streamMessagePart(part, reasoning, "text", part.text || "");
          if (reasoning.trim()) touchReasoningPart(part);
          renderConversation();
        } else if (ev.type === "reasoning_replace" && placeholder && typeof ev.text === "string") {
          reasoning = ev.text;
          const part = ensureMessageReasoningPart(placeholder, `panel-reasoning:${requestID}`);
          if (!part) continue;
          streamMessagePart(part, reasoning, "text", part.text || "");
          if (reasoning.trim()) touchReasoningPart(part);
          renderConversation();
        } else if (ev.type === "message_delta" && placeholder && typeof ev.delta === "string") {
          streamed = true;
          live += ev.delta;
          streamMessagePart(placeholder.parts[0], live, "text", placeholder.parts[0].text || "");
          renderConversation();
        } else if (ev.type === "message_replace" && placeholder && typeof ev.text === "string") {
          streamed = true;
          live = ev.text;
          streamMessagePart(placeholder.parts[0], live, "text", placeholder.parts[0].text || "");
          renderConversation();
        } else if (ev.type === "done") {
          result = ev.result;
        }
      } catch (e) { AppLog.debug("stream", "malformed SSE event: " + data, { error: String(e) }); }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      consume(decoder.decode(), true);
      break;
    }
    consume(decoder.decode(value, { stream: true }));
  }

  if (!result) {
    throw new Error("Panel stream ended without a final result");
  }

  if (result?.task_id) {
    forgetPendingTask(requestID);
  } else if (result?.kind && result.kind !== "created") {
    forgetPendingTask(requestID);
  }

  if (state.workspaceEpoch !== workspaceEpoch) {
    return result;
  }

  if (panelResultNavigates(result)) {
    const finalText1 = result.message || live;
    if (placeholder && finalText1) {
      streamMessagePart(placeholder.parts[0], finalText1, "text", placeholder.parts[0].text || "");
      renderConversation();
    } else if (placeholder && ["……", "...", t("chat.thinking")].includes(placeholder.parts[0]?.text)) {
      streamMessagePart(placeholder.parts[0], t("chat.task_navigated"), "text", placeholder.parts[0].text || "");
      renderConversation();
    }
    if (result && typeof result === "object") result._request = text;
    await applyPanelResult(result);
    return result;
  }

  // Finalize the streamed placeholder, then apply side-effects
  const finalText = result.message || live;
  if (placeholder && finalText) {
    streamMessagePart(placeholder.parts[0], finalText, "text", placeholder.parts[0].text || "");
    renderConversation();
  } else if (placeholder && ["……", "...", t("chat.thinking")].includes(placeholder.parts[0]?.text)) {
    placeholder.parts[0].text = "";
    renderConversation();
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

function configUnattended(config) {
  const value = config?.experimental?.unattended;
  return typeof value === "boolean" ? value : null;
}

async function syncUnattendedConfig(force = false) {
  if (!state.connected) return false;
  const remote = configUnattended(state.config);
  if (!force && remote === state.unattended) return false;
  try {
    const saved = await updateConfig((current) => {
      current.experimental = current.experimental || {};
      current.experimental.unattended = state.unattended;
    });
    state.config = saved;
    return true;
  } catch (e) {
    AppLog.error("ui", "Failed to sync unattended mode", { error: String(e) });
    return false;
  }
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
  } catch (e) {
    AppLog.debug("extensions", "loadExtensions failed, resetting to empty", { error: String(e) });
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
              ? `<button type="button" class="btn btn-ghost mini danger" data-skill-remove="${escapeHtml(item.source || "")}" data-skill-kind="${escapeHtml(skillRemoveKind(item) || "")}" data-skill-name="${escapeHtml(item.name || "")}" title="${escapeHtml(t("skill.delete_button_title"))}" aria-label="${escapeHtml(t("skill.delete_button_title"))}">${escapeHtml(t("common.delete"))}</button>`
              : ""}
            ${item.location && item.location !== "builtin"
              ? `<button type="button" class="btn btn-ghost mini" data-skill-open="${escapeHtml(item.location)}" title="${escapeHtml(t("skill.open_button_title"))}" aria-label="${escapeHtml(t("skill.open_button_title"))}">${escapeHtml(t("common.open"))}</button>`
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
    { label: t("prompt.title"), value: state.promptEntries.filter((item) => item.configured_prompt !== null).length },
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

function promptEntryID(entry) {
  return `${entry.scope}:${entry.key}`;
}

function promptEntry(entryID) {
  return state.promptEntries.find((item) => promptEntryID(item) === entryID) || null;
}

function promptEntryValue(entry) {
  const entryID = promptEntryID(entry);
  return Object.prototype.hasOwnProperty.call(state.promptDrafts, entryID)
    ? state.promptDrafts[entryID]
    : entry.prompt || "";
}

function syncPromptDrafts() {
  const next = {};
  for (const entry of state.promptEntries) {
    const entryID = promptEntryID(entry);
    next[entryID] = Object.prototype.hasOwnProperty.call(state.promptDrafts, entryID)
      ? state.promptDrafts[entryID]
      : entry.prompt || "";
  }
  state.promptDrafts = next;
}

function promptGroupLabel(group) {
  if (group === "core") return t("prompt.group.core");
  if (group === "generator") return t("prompt.group.generator");
  if (group === "orchestrator") return t("prompt.group.orchestrator");
  if (group === "subagent") return t("prompt.group.subagent");
  if (group === "hidden_agent") return t("prompt.group.hidden_agent");
  if (group === "custom_agent") return t("prompt.group.custom_agent");
  return t("prompt.group.primary_agent");
}

function promptDescription(entry) {
  if (entry.key === "core_header") return t("prompt.desc.core_header");
  if (entry.key === "agent_generate") return t("prompt.desc.agent_generate");
  if (entry.key === "planner_system") return t("prompt.desc.planner_system");
  if (entry.key === "spec_system") return t("prompt.desc.spec_system");
  if (entry.key === "evaluator_system") return t("prompt.desc.evaluator_system");
  if (entry.key === "delivery_system") return t("prompt.desc.delivery_system");
  return entry.description || "";
}

function promptStatus(entry) {
  if (entry.configured_prompt !== null) {
    return { label: t("prompt.status.custom"), tone: "active" };
  }
  if (entry.scope === "system") {
    return { label: t("prompt.status.default"), tone: "ready" };
  }
  if (entry.inherits_core) {
    return { label: t("prompt.status.inherits_core"), tone: "warn" };
  }
  if (entry.prompt) {
    return { label: t("prompt.status.default"), tone: "ready" };
  }
  return { label: t("prompt.status.empty"), tone: "" };
}

function promptHelper(entry) {
  if (entry.scope === "system") {
    return entry.configured_prompt !== null ? t("prompt.help.custom_system") : t("prompt.help.default_system");
  }
  if (entry.inherits_core) return t("prompt.help.inherits_core");
  if (entry.configured_prompt !== null) return t("prompt.help.custom_agent");
  if (entry.prompt) return t("prompt.help.default_agent");
  return t("prompt.help.optional_agent");
}

function promptDirty(entry) {
  return promptEntryValue(entry) !== (entry.prompt || "");
}

function renderPromptPreview(value) {
  if (!value.trim()) return `<p class="empty-hint">${escapeHtml(t("prompt.preview_empty"))}</p>`;
  return renderMarkdown(value);
}

function renderPromptCatalog() {
  if (dom.promptBadge) {
    dom.promptBadge.textContent = String(state.promptEntries.filter((item) => item.configured_prompt !== null).length);
  }
  renderConfigToggleMeta();
  if (!dom.promptBody) return;
  syncPromptDrafts();

  // Clone node to remove event listeners before re-rendering
  const newBody = dom.promptBody.cloneNode(false);

  if (!state.promptEntries.length) {
    newBody.innerHTML = `<div class="empty-hint">${escapeHtml(t("prompt.none"))}</div>`;
    dom.promptBody.parentNode?.replaceChild(newBody, dom.promptBody);
    dom.promptBody = newBody;
    return;
  }
  const activeStatuses = ["running", "planning", "evaluating", "delivering", "queued"];
  const taskActive = activeStatuses.includes(state.board?.task?.status);
  const activeBanner = taskActive
    ? `<div class="config-status-box" data-status="warn" style="margin-bottom:var(--sp-2)">${escapeHtml(t("prompt.active_task_notice"))}</div>`
    : "";
  newBody.innerHTML = activeBanner + `<div class="prompt-grid">${state.promptEntries
    .map((entry) => {
      const entryID = promptEntryID(entry);
      const value = promptEntryValue(entry);
      const status = promptStatus(entry);
      const description = promptDescription(entry);
      const dirty = promptDirty(entry);
      return `<div class="prompt-card" data-prompt-entry="${escapeHtml(entryID)}">
        <div class="prompt-card-head">
          <div class="prompt-card-copy">
            <strong>${escapeHtml(entry.label || entry.key)}</strong>
            <span>${escapeHtml(promptGroupLabel(entry.group))}${entry.mode ? ` · ${escapeHtml(entry.mode)}` : ""}${entry.inherits_core ? " · ← core_header" : ""}</span>
            ${description ? `<small>${escapeHtml(description)}</small>` : ""}
          </div>
          <span class="extension-status" data-state="${escapeHtml(status.tone)}">${escapeHtml(status.label)}</span>
        </div>
        <label class="field">
          <span class="field-label">${escapeHtml(t("prompt.editor_label"))}</span>
          <textarea class="field-input prompt-textarea" data-prompt-input="${escapeHtml(entryID)}" rows="8">${escapeHtml(value)}</textarea>
        </label>
        <div class="prompt-toolbar">
          <span class="config-status-box" data-status="${escapeHtml(status.tone)}">${escapeHtml(promptHelper(entry))}</span>
          <div class="dialog-actions compact">
            <button type="button" class="btn btn-ghost mini" data-prompt-reset="${escapeHtml(entryID)}"${entry.configured_prompt !== null || dirty ? "" : " disabled"}>${escapeHtml(t("prompt.reset"))}</button>
            <button type="button" class="btn btn-primary mini" data-prompt-save="${escapeHtml(entryID)}"${dirty ? "" : " disabled"}>${escapeHtml(t("common.save"))}</button>
          </div>
        </div>
        ${entry.configured_prompt !== null && entry.default_prompt ? `<details class="prompt-diff-details">
          <summary class="prompt-diff-summary">${escapeHtml(t("prompt.show_default"))}</summary>
          <div class="prompt-preview-card" style="margin-top:0;border-top:none;opacity:0.7">
            <div class="prompt-preview-head">${escapeHtml(t("prompt.default_label"))}</div>
            <div class="md-content prompt-preview-body">${renderPromptPreview(entry.default_prompt)}</div>
          </div>
        </details>` : ""}
        <details class="prompt-diff-details">
          <summary class="prompt-diff-summary">${escapeHtml(t("prompt.preview"))}</summary>
          <div class="prompt-preview-card" style="border-top:none;border-radius:0 0 var(--radius) var(--radius)">
            <div class="md-content prompt-preview-body" data-prompt-preview="${escapeHtml(entryID)}">${renderPromptPreview(value)}</div>
          </div>
        </details>
      </div>`;
    })
    .join("")}</div>`;
  dom.promptBody.parentNode?.replaceChild(newBody, dom.promptBody);
  dom.promptBody = newBody;
}

function applyPromptEntries(items) {
  state.promptEntries = Array.isArray(items) ? items : [];
  state.promptDrafts = Object.fromEntries(state.promptEntries.map((entry) => [promptEntryID(entry), entry.prompt || ""]));
  renderPromptCatalog();
}

async function loadPromptCatalog() {
  try {
    applyPromptEntries(await apiJson("config/prompt"));
  } catch (e) {
    AppLog.debug("prompt", "loadPromptCatalog failed, resetting to empty", { error: String(e) });
    state.promptEntries = [];
    state.promptDrafts = {};
    renderPromptCatalog();
  }
}

async function savePromptEntry(entryID) {
  const entry = promptEntry(entryID);
  if (!entry) return;
  const value = promptEntryValue(entry);
  try {
    const saved = await updateConfig((current) => {
      if (entry.scope === "system") {
        current.prompt = current.prompt || {};
        if (value.trim()) current.prompt[entry.key] = value;
        if (!value.trim()) delete current.prompt[entry.key];
        if (Object.keys(current.prompt).length === 0) delete current.prompt;
        return;
      }
      current.agent = current.agent || {};
      const item =
        current.agent?.[entry.key] && typeof current.agent[entry.key] === "object"
          ? { ...current.agent[entry.key] }
          : {};
      if (value.trim()) item.prompt = value;
      if (!value.trim()) delete item.prompt;
      if (Object.keys(item).length === 0) delete current.agent[entry.key];
      if (Object.keys(item).length > 0) current.agent[entry.key] = item;
      if (Object.keys(current.agent).length === 0) delete current.agent;
    });
    state.config = saved;
    await loadPromptCatalog();
  } catch (e) {
    AppLog.error("ui", "Failed to save prompt override", { error: String(e), entryID });
    await nativeMessage(errorText("prompt.save_failed", e), {
      title: t("prompt.title"),
      kind: "error",
    });
  }
}

async function resetPromptEntry(entryID) {
  const entry = promptEntry(entryID);
  if (!entry) return;
  if (entry.configured_prompt === null) {
    state.promptDrafts[entryID] = entry.prompt || "";
    renderPromptCatalog();
    return;
  }
  try {
    const saved = await updateConfig((current) => {
      if (entry.scope === "system") {
        if (current.prompt && typeof current.prompt === "object") {
          delete current.prompt[entry.key];
          if (Object.keys(current.prompt).length === 0) delete current.prompt;
        }
        return;
      }
      if (current.agent && typeof current.agent === "object" && current.agent[entry.key]) {
        const item =
          current.agent[entry.key] && typeof current.agent[entry.key] === "object"
            ? { ...current.agent[entry.key] }
            : {};
        delete item.prompt;
        if (Object.keys(item).length === 0) delete current.agent[entry.key];
        if (Object.keys(item).length > 0) current.agent[entry.key] = item;
        if (Object.keys(current.agent).length === 0) delete current.agent;
      }
    });
    state.config = saved;
    await loadPromptCatalog();
  } catch (e) {
    AppLog.error("ui", "Failed to reset prompt override", { error: String(e), entryID });
    await nativeMessage(errorText("prompt.reset_failed", e), {
      title: t("prompt.title"),
      kind: "error",
    });
  }
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
        ? `<button type="button" class="btn btn-primary mini" data-market-install="${escapeHtml(item.id)}" title="${escapeHtml(t("skill.market.install_button_title"))}" aria-label="${escapeHtml(t("skill.market.install_button_title"))}">${escapeHtml(t("skill.install"))}</button>`
        : `<button type="button" class="btn btn-ghost mini" data-market-homepage="${escapeHtml(item.homepage)}" title="${escapeHtml(t("skill.market.open_site_title"))}" aria-label="${escapeHtml(t("skill.market.open_site_title"))}">${escapeHtml(t("skill.market.open_site"))}</button>`;
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
          <button type="button" class="btn btn-primary mini" data-channel-edit="${escapeHtml(item.id)}" title="${escapeHtml(t("channel.edit_title"))}" aria-label="${escapeHtml(t("channel.edit_title"))}">${escapeHtml(t("common.edit"))}</button>
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
  return `<button type="button" class="${cls}" data-channel-docs="${escapeHtml(channelTutorial(channelID))}" title="${escapeHtml(t("channel.tutorial_hint"))}" aria-label="${escapeHtml(t("channel.tutorial_hint"))}">${escapeHtml(t("channel.tutorial"))}</button>`;
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

function providerConnected(providerID) {
  return Array.isArray(state.providerCatalog?.connected) && state.providerCatalog.connected.includes(providerID);
}

function providerAuthMethods(providerID) {
  const items = Array.isArray(state.providerAuth?.[providerID]) ? state.providerAuth[providerID] : [];
  return items.flatMap((item) => {
    if (record(item)) {
      const type = item.type === "oauth" ? "oauth" : "api";
      const label = typeof item.label === "string" && item.label.trim()
        ? item.label.trim()
        : type === "oauth"
          ? "OAuth"
          : "API key";
      return [{ type, label }];
    }
    if (typeof item === "string") {
      const value = item.trim();
      if (!value) return [];
      const type = /oauth/i.test(value) ? "oauth" : "api";
      const label = value === "api_key" ? "API key" : value;
      return [{ type, label }];
    }
    return [];
  });
}

function providerAuthPrompt(prompt) {
  if (!record(prompt) || typeof prompt.key !== "string" || typeof prompt.message !== "string") return null;
  if (prompt.type === "text") {
    return {
      type: "text",
      key: prompt.key,
      message: prompt.message,
      placeholder: typeof prompt.placeholder === "string" ? prompt.placeholder : "",
    };
  }
  if (prompt.type !== "select" || !Array.isArray(prompt.options)) return null;
  const options = prompt.options.flatMap((item) => {
    if (!record(item) || typeof item.label !== "string" || typeof item.value !== "string") return [];
    return [{
      label: item.label,
      value: item.value,
      ...(typeof item.hint === "string" ? { hint: item.hint } : {}),
    }];
  });
  if (!options.length) return null;
  return {
    type: "select",
    key: prompt.key,
    message: prompt.message,
    options,
  };
}

async function providerAuthInputs(providerID, methodIndex) {
  const inputs = {};
  while (true) {
    const prompts = await apiJson(`provider/${providerID}/auth/prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: methodIndex, inputs }),
      signal: AbortSignal.timeout(300000),
    });
    const list = Array.isArray(prompts) ? prompts.map(providerAuthPrompt).filter(Boolean) : [];
    const prompt = list.find((item) => !Object.hasOwn(inputs, item.key));
    if (!prompt) return inputs;
    const value = prompt.type === "select"
      ? await nativeSelect(prompt.message, {
        title: providerLabel(providerID),
        selectLabel: prompt.message,
        options: prompt.options,
        okLabel: t("common.ok"),
        cancelLabel: t("common.cancel"),
      })
      : await nativePrompt(prompt.message, {
        title: providerLabel(providerID),
        inputLabel: prompt.message,
        inputPlaceholder: prompt.placeholder || "",
        okLabel: t("common.submit"),
        cancelLabel: t("common.cancel"),
      });
    if (value == null) return null;
    inputs[prompt.key] = String(value).trim();
  }
}

function providerPreferredOauthMethod(providerID) {
  const methods = providerAuthMethods(providerID)
    .map((item, index) => ({ ...item, index }))
    .filter((item) => item.type === "oauth");
  if (methods.length === 0) return null;
  return methods.find((item) => /browser/i.test(item.label)) || methods[0];
}

async function authorizeProvider(providerID, methodIndex) {
  const methods = providerAuthMethods(providerID).map((item, index) => ({ ...item, index }));
  const explicitChoice = typeof methodIndex === "number";
  const match = explicitChoice
    ? methods.find((item) => item.index === methodIndex)
    : providerPreferredOauthMethod(providerID);
  if (!match) return false;

  // Skip confirm dialog when user already explicitly chose this method from the selection
  if (!explicitChoice) {
    const confirmed = await nativeConfirm(`${providerLabel(providerID)} ${t("llm.status.auth_required")}: ${match.label}`, {
      title: t("llm.title"),
      okLabel: t("common.open"),
      cancelLabel: t("common.cancel"),
      kind: "info",
    });
    if (!confirmed) {
      state.providerAuthDismissed[providerID] = true;
      return false;
    }
  }

  const inputs = await providerAuthInputs(providerID, match.index);
  if (inputs == null) {
    state.providerAuthDismissed[providerID] = true;
    return false;
  }

  const authorization = await apiJson(`provider/${providerID}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: match.index, inputs }),
    signal: AbortSignal.timeout(300000),
  });
  if (!record(authorization) || typeof authorization.url !== "string" || typeof authorization.method !== "string") {
    throw new Error("OAuth authorization unavailable");
  }

  await nativeOpen(authorization.url);

  if (authorization.method === "code") {
    const code = await nativePrompt(
      [authorization.instructions, authorization.url].filter(Boolean).join("\n\n"),
      {
        title: t("llm.title"),
        inputLabel: match.label,
        inputPlaceholder: "Redirect URL or authorization code (leave blank if it auto-completes)",
        okLabel: t("common.submit"),
        cancelLabel: t("common.cancel"),
      },
    );
    if (code == null) {
      state.providerAuthDismissed[providerID] = true;
      return false;
    }
    await apiJson(`provider/${providerID}/oauth/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: match.index, code }),
      signal: AbortSignal.timeout(300000),
    });
    delete state.providerAuthDismissed[providerID];
    return true;
  }

  showLlmNotice(authorization.instructions || authorization.url, "warn", 0);
  await apiJson(`provider/${providerID}/oauth/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: match.index }),
    signal: AbortSignal.timeout(300000),
  });
  delete state.providerAuthDismissed[providerID];
  return true;
}

async function executeProviderAuth(providerID, methodIndex, inputs) {
  await apiJson(`provider/${providerID}/auth/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: methodIndex, inputs }),
    signal: AbortSignal.timeout(300000),
  });
  delete state.providerAuthDismissed[providerID];
  return true;
}

async function runProviderAuthMethod(providerID, method) {
  if (method.type === "oauth") return authorizeProvider(providerID, method.index);
  const inputs = await providerAuthInputs(providerID, method.index);
  if (inputs == null) return false;
  if (Object.keys(inputs).length === 0) {
    dom.llmApiKey?.focus();
    return "input";
  }
  return executeProviderAuth(providerID, method.index, inputs);
}

function renderLlmAuthAction(providerID) {
  if (!dom.btnLlmAuthAction) return;
  const methods = providerAuthMethods(providerID);
  const visible = methods.length > 0;
  dom.btnLlmAuthAction.classList.toggle("hidden", !visible);
  dom.btnLlmAuthAction.disabled = !visible || !!dom.llmProvider?.disabled;
  if (!visible) return;
  dom.btnLlmAuthAction.textContent = t("llm.auth_connect");
  dom.btnLlmAuthAction.title = t("llm.auth_connect_title");
  dom.btnLlmAuthAction.setAttribute("aria-label", t("llm.auth_connect_title"));
}

async function authenticateSelectedProvider() {
  const providerID = dom.llmProvider?.value?.trim() || "";
  const methods = providerAuthMethods(providerID).map((item, index) => ({ ...item, index }));
  if (!providerID || methods.length === 0) return false;
  if (methods.length === 1 && methods[0]) return runProviderAuthMethod(providerID, methods[0]);
  const value = await nativeSelect(t("llm.auth_choose_method"), {
    title: providerLabel(providerID),
    selectLabel: t("llm.auth_method"),
    options: methods.map((item) => ({
      label: item.label,
      value: String(item.index),
      hint: item.type === "oauth" ? t("llm.auth_type_oauth") : t("llm.auth_type_api"),
    })),
  });
  if (value == null) return false;
  const method = methods.find((item) => String(item.index) === value);
  if (!method) return false;
  return runProviderAuthMethod(providerID, method);
}

function providerState(providerID, configOverride) {
  const config = configOverride || state.config || {};
  const item = providerEntry(providerID);
  const connected = providerConnected(providerID);
  const authMethods = providerAuthMethods(providerID);
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
    renderLlmAuthAction("");
    renderLlmSummary();
    return;
  }
  const info = providerState(providerID, configOverride);
  dom.llmStatus.textContent = info.label;
  dom.llmStatus.dataset.status = info.tone;
  dom.llmStatus.title = info.detail || info.label;
  renderLlmAuthAction(providerID);
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
  if (dom.llmApiKeySummary) {
    const text = hasKey ? t("llm.status.configured") : "";
    dom.llmApiKeySummary.textContent = text;
    dom.llmApiKeySummary.title = text;
    dom.llmApiKeySummary.dataset.tone = hasKey ? "good" : "";
  }
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
  renderLlmAuthAction(dom.llmProvider?.value || "");
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

    const configuredKey = state.config?.provider?.[current.providerID]?.options?.apiKey || providerEntry(current.providerID)?.key;
    const needsAuth = !configuredKey && !current.apiKey.trim() && !providerConnected(current.providerID)
      && providerAuthMethods(current.providerID).length > 0;
    if (needsAuth) {
      // Skip auto-auth when config dialog is open — let the user click the Connect button instead.
      // The button click path goes through showAppDialog which handles configDialog close/reopen.
      const configOpen = dom.configDialog?.open === true;
      const dismissed = state.providerAuthDismissed[current.providerID] === true;
      const ready = (dismissed || configOpen) ? false : await authenticateSelectedProvider();
      if (!ready && !dismissed && !configOpen) state.providerAuthDismissed[current.providerID] = true;
      if (serial !== llmSyncSerial) return;
      await loadConfigInfo();
      if (serial !== llmSyncSerial) return;
      if (!ready) {
        renderProviderStatus(current.providerID, state.config);
        showLlmNotice(t("llm.status.auth_required"), "warn", 2600);
        return;
      }
    }

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

async function nativeSelect(message, options) {
  const list = Array.isArray(options?.options) ? options.options : [];
  if (!list.length) return null;
  const result = await showAppDialog({
    title: options?.title || t("dialog.input"),
    message,
    kind: options?.kind || "info",
    okLabel: options?.okLabel || t("common.ok"),
    cancelLabel: options?.cancelLabel || t("common.cancel"),
    cancel: true,
    select: true,
    selectLabel: options?.selectLabel || t("dialog.value"),
    selectOptions: list,
    selectValue: options?.selectValue || list[0]?.value || "",
  });
  return result.confirmed ? result.value : null;
}

async function copyText(text) {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* clipboard API not available, fall back to execCommand */ }
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
    !dom.appDialogSelectField ||
    !dom.appDialogSelectLabel ||
    !dom.appDialogSelect ||
    !dom.btnAppDialogCancel ||
    !dom.btnAppDialogOk
  ) {
    return Promise.resolve({ confirmed: false, value: null });
  }

  return new Promise((resolve) => {
    const useInput = !!options.input;
    const useSelect = !!options.select;
    let settled = false;
    const finish = (confirmed) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (dom.appDialog.open) dom.appDialog.close();
      resolve({
        confirmed,
        value: confirmed ? (useInput ? dom.appDialogInput.value : useSelect ? dom.appDialogSelect.value : null) : null,
      });
    };
    const onCancel = () => finish(false);
    const onOk = () => finish(true);
    const onClose = () => finish(false);
    const onKeydown = (event) => {
      if (event.key === "Enter" && (useInput || useSelect)) {
        event.preventDefault();
        finish(true);
      }
    };
    const cleanup = () => {
      dom.btnAppDialogCancel.removeEventListener("click", onCancel);
      dom.btnAppDialogOk.removeEventListener("click", onOk);
      dom.appDialog.removeEventListener("close", onClose);
      dom.appDialogInput.removeEventListener("keydown", onKeydown);
      dom.appDialogSelect.removeEventListener("keydown", onKeydown);
    };

    dom.appDialogTitle.textContent = options.title || t("dialog.notice");
    dom.appDialogBody.textContent = options.message || "";
    dom.appDialog.dataset.kind = options.kind || "info";
    dom.btnAppDialogOk.textContent = options.okLabel || t("common.ok");
    dom.btnAppDialogCancel.textContent = options.cancelLabel || t("common.cancel");
    dom.btnAppDialogCancel.classList.toggle("hidden", !options.cancel);
    dom.appDialogInputField.classList.toggle("hidden", !useInput);
    dom.appDialogInputLabel.textContent = options.inputLabel || t("dialog.value");
    dom.appDialogInput.placeholder = options.inputPlaceholder || "";
    dom.appDialogInput.value = options.inputValue || "";
    dom.appDialogSelectField.classList.toggle("hidden", !useSelect);
    dom.appDialogSelectLabel.textContent = options.selectLabel || t("dialog.value");
    dom.appDialogSelect.innerHTML = (options.selectOptions || [])
      .map((item) => {
        const label = item?.hint ? `${item.label} · ${item.hint}` : item.label;
        return `<option value="${escapeHtml(item.value)}">${escapeHtml(label)}</option>`;
      })
      .join("");
    dom.appDialogSelect.value = options.selectValue || options.selectOptions?.[0]?.value || "";

    dom.btnAppDialogCancel.addEventListener("click", onCancel);
    dom.btnAppDialogOk.addEventListener("click", onOk);
    dom.appDialog.addEventListener("close", onClose);
    dom.appDialogInput.addEventListener("keydown", onKeydown);
    dom.appDialogSelect.addEventListener("keydown", onKeydown);
    if (dom.appDialog.open) dom.appDialog.close();
    try { dom.appDialog.showModal(); } catch { finish(false); return; }

    requestAnimationFrame(() => {
      if (useInput) dom.appDialogInput.focus();
      else if (useSelect) dom.appDialogSelect.focus();
      else dom.btnAppDialogOk.focus();
    });
  });
}

async function nativeOpen(target) {
  if (!target) return false;
  const url = /^https?:\/\//i.test(target);
  try {
    const opened = url
      ? await tauriInvoke("overlay_open_url", { url: target })
      : await tauriInvoke("overlay_open_path", { path: target });
    if (opened) return true;
  } catch { /* Tauri not available, try fallback */ }
  if (url) {
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
  } catch (openErr) {
    AppLog.debug("ui", "path/open fallback failed", { target, error: String(openErr) });
    return false;
  }
}

async function withUnpinned(run) {
  const win = await currentTauriWindow();
  if (!win || typeof win.isAlwaysOnTop !== "function" || typeof win.setAlwaysOnTop !== "function") {
    return run();
  }
  const pinned = await win.isAlwaysOnTop().catch(() => false);
  if (!pinned) return run();
  await win.setAlwaysOnTop(false).catch(() => undefined);
  try {
    return await run();
  } finally {
    await win.setAlwaysOnTop(true).catch(() => undefined);
    await win.setFocus?.().catch(() => undefined);
  }
}

async function pickDirectory(start) {
  const selected = await withUnpinned(() => tauriInvoke("overlay_pick_dir", { start: start || undefined }));
  return typeof selected === "string" ? selected : "";
}

async function pickFiles(start) {
  const result = await withUnpinned(() => tauriInvoke("overlay_pick_files", { start: start || undefined }));
  return Array.isArray(result) ? result : [];
}

// ── Connection ──

async function checkConnection() {
  const managed = usesManagedLocalServer();
  if (managed) {
    await syncLocalServerUrl();
  }
  setConnStatus("connecting");
  AppLog.debug("conn", "checking connection to " + state.serverUrl);
  let error;
  const attempts = managed ? 8 : 1;

  for (let i = 0; i < attempts; i++) {
    try {
      const health = await apiJson("global/health", undefined, { directory: false });
      setConnStatus("online");
      state.connected = true;
      renderWorkspaceState();
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
  renderWorkspaceState();
  AppLog.warn("conn", "connection failed", { error: String(error), serverUrl: state.serverUrl });
  renderVersions("");
  return false;
}

function setConnStatus(status) {
  document.body.dataset.connection = status;
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
  renderAboutVersion();

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
  const details = [
    {
      tone: "configured",
      text: configured.length > 0
        ? t("channel.configured", { names: configured.map((item) => item.name).join(", ") })
        : t("channel.configured_none"),
    },
    {
      tone: "partial",
      text: partial.length > 0 ? t("channel.needs_setup", { names: partial.map((item) => item.name).join(", ") }) : "",
    },
    {
      tone: "missing",
      text: missing.length > 0 ? t("channel.available", { names: missing.map((item) => item.name).join(", ") }) : "",
    },
    {
      tone: "disabled",
      text: disabled.length > 0 ? t("channel.disabled", { names: disabled.map((item) => item.name).join(", ") }) : "",
    },
  ].filter((item) => item.text);
  const hint = [...details.map((item) => item.text), t("channel.open_settings")].join(" | ");
  const card = details
    .map(
      (item) =>
        `<span class="brand-channel-tip-row" data-tone="${escapeHtml(item.tone)}">${escapeHtml(item.text)}</span>`,
    )
    .join("");
  const tone = configured.length > 0 ? "brand-channel brand-channel-summary" : "brand-channel brand-channel-summary brand-channel-empty";
  if (!dom.brandVersion) return;
  dom.brandVersion.innerHTML = `<button type="button" class="brand-channel-group" data-no-drag="true" data-open-channels="true" title="${escapeHtml(hint)}" aria-label="${escapeHtml(hint)}"><span class="brand-channel-label">${escapeHtml(t("channel.channels"))}</span><span class="${tone}">${escapeHtml(summary)}</span><span class="brand-channel-tip" aria-hidden="true"><span class="brand-channel-tip-title">${escapeHtml(t("channel.channels"))}</span>${card}<span class="brand-channel-tip-footer">${escapeHtml(t("channel.open_settings"))}</span></span></button>`;
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

function executorSetupHint(value) {
  if (value === "codex" || value === "claude-code") {
    return t("executor.manual_install_auth_required");
  }
  return "";
}

function executorTitle(value) {
  const item = executorInfo(value);
  const selectable = executorSelectable(value);
  const lines = [item?.label || executorLabel(value)];
  if (item?.version) lines.push(t("executor.version", { version: item.version }));
  if (item?.detail) lines.push(item.detail);
  if (!selectable) {
    lines.push(item ? (item.discovered ? t("executor.detected_not_selectable") : t("executor.not_detected")) : t("executor.not_detected"));
    const hint = executorSetupHint(value);
    if (hint) lines.push(hint);
  }
  return lines.filter(Boolean).join("\n");
}

async function loadExecutors() {
  try {
    const data = await apiJson("executor");
    state.executors = Array.isArray(data) ? data : [];
  } catch (e) {
    AppLog.debug("executor", "loadExecutors failed, resetting to empty", { error: String(e) });
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

function renderExecutor(options = {}) {
  const buttons = dom.engineBar?.querySelectorAll("[data-executor]") || [];
  const key = [currentUIScale().toFixed(3)];
  for (const button of buttons) {
    const value = button.dataset.executor || "opencode";
    const selectable = executorSelectable(value);
    button.dataset.active = value === state.executor ? "true" : "false";
    button.dataset.available = selectable ? "true" : "false";
    button.disabled = !selectable;
    const model = executorCurrentModel(value);
    const titleLines = [executorTitle(value)];
    if (model) titleLines.push(`Model: ${model}`);
    button.title = titleLines.join("\n");
    key.push(button.textContent?.trim() || "");
    // Sync caret button state
    const caret = dom.engineBar?.querySelector(`[data-executor-caret="${value}"]`);
    if (caret) {
      caret.disabled = !selectable;
      caret.title = model ? `Model: ${model}` : t("model_picker.select");
    }
  }
  const next = key.join("|");
  if (options.measure === true || state._executorMeasureKey !== next) {
    syncExecutorWidth();
    state._executorMeasureKey = next;
  }
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

// ── Executor Model Dropdowns ──

const EXECUTOR_KNOWN_MODELS = {
  "codex": [
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex",
    "gpt-5.2-codex",
    "gpt-5.2",
    "gpt-5.1-codex-max",
    "gpt-5.1-codex-mini",
  ],
  "claude-code": [
    "claude-sonnet-4-6",
    "claude-opus-4-6",
    "claude-haiku-4-5-20251001",
  ],
};

function executorModelPanel(executorID) {
  if (executorID === "codex") return dom.codexModelPanel;
  if (executorID === "claude-code") return dom.claudeCodeModelPanel;
  return null;
}

function executorCurrentModel(executorID) {
  const info = executorInfo(executorID);
  return info?.model || "";
}

function renderExecutorModelPanel(executorID) {
  const panel = executorModelPanel(executorID);
  if (!panel) return;
  const current = executorCurrentModel(executorID);
  const known = EXECUTOR_KNOWN_MODELS[executorID] || [];
  const currentLabel = current
    ? `<div class="engine-model-current">${escapeHtml(t("executor.current_model"))}: <strong>${escapeHtml(current)}</strong></div>`
    : "";
  const items = known.map((mid) => {
    const isActive = mid === current;
    return `<button type="button" class="engine-model-item" data-executor-model="${escapeHtml(mid)}" data-active="${isActive}">${escapeHtml(mid)}</button>`;
  }).join("");
  panel.innerHTML = currentLabel + items;
}

function openExecutorModelPanel(executorID) {
  closeAllExecutorModelPanels();
  const panel = executorModelPanel(executorID);
  if (!panel) return;
  renderExecutorModelPanel(executorID);
  const caret = dom.engineBar?.querySelector(`[data-executor-caret="${executorID}"]`);
  if (caret) {
    const rect = caret.getBoundingClientRect();
    panel.style.top = Math.round(rect.bottom + 6) + "px";
    panel.style.left = Math.round(rect.left + rect.width / 2) + "px";
    panel.style.transform = "translateX(-50%)";
  }
  panel.hidden = false;
}

function closeAllExecutorModelPanels() {
  if (dom.codexModelPanel) dom.codexModelPanel.hidden = true;
  if (dom.claudeCodeModelPanel) dom.claudeCodeModelPanel.hidden = true;
}

async function setExecutorModel(executorID, model) {
  try {
    await apiJson(`executor/${encodeURIComponent(executorID)}/model`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    await loadExecutors();
  } catch (e) {
    AppLog.error("ui", "Failed to set executor model", { error: String(e), executorID, model });
  }
}

function currentTaskSessionID() {
  return state.board?.task?.sessionID || taskItem(state.selectedTaskID)?.task?.sessionID || "";
}

async function loadMeta() {
  const epoch = state.directoryEpoch;
  try {
    const [path, vcs] = await Promise.all([apiJson("path"), apiJson("vcs")]);
    if (epoch !== state.directoryEpoch) return;
    state.path = path ? { directory: typeof path.directory === "string" ? path.directory.trim() : "" } : null;
    if (!state.savedDirectory && state.path?.directory) {
      setWorkspaceDirectory(state.path.directory, "auto");
    }
    state.vcs = vcs;
    renderMeta();
  } catch (e) {
    AppLog.debug("meta", "loadMeta failed, resetting path/vcs", { error: String(e) });
    if (epoch !== state.directoryEpoch) return;
    state.path = null;
    state.vcs = null;
    renderMeta();
  }
}

function activeDirectory() {
  return state.directory;
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

function relativePathFrom(base, target) {
  const baseText = typeof base === "string" ? base.replace(/[\\/]+$/, "") : "";
  const targetText = typeof target === "string" ? target.replace(/[\\/]+$/, "") : "";
  if (!baseText || !targetText) return "";
  const lBase = baseText.toLowerCase();
  const lTarget = targetText.toLowerCase();
  if (lTarget.startsWith(lBase + "/") || lTarget.startsWith(lBase + "\\")) {
    return targetText.slice(baseText.length + 1);
  }
  return "";
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
  if (kind === "history") {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 4v4l2.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M3.05 8a5 5 0 1 1 .5 2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M3 10.5L3.05 8 1 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
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
  const recent = escapeHtml(t("cwd.recent"));
  const actions = [
    `<button type="button" class="task-dir-tool" data-path-action="recent" title="${recent}" aria-label="${recent}">${pathIcon("history")}</button>`,
    `<button type="button" class="task-dir-tool" data-path-action="browse" title="${browse}" aria-label="${browse}">${pathIcon("browse")}</button>`,
    `<button type="button" class="task-dir-tool" data-path-action="create" title="${create}" aria-label="${create}">${pathIcon("new")}</button>`,
    state.directory
      ? `<button type="button" class="task-dir-tool danger" data-path-action="reset" title="${reset}" aria-label="${reset}">${pathIcon("reset")}</button>`
      : "",
  ]
    .filter(Boolean)
    .join("");
  if (!value) {
    return `
      <span class="task-dir-shell" data-empty="true">
        <span class="task-dir-empty">${escapeHtml(t("cwd.unavailable"))}</span>
        <span class="task-dir-actions">${actions}</span>
      </span>
    `;
  }
  const items = pathItems(value);
  const open = t("cwd.open");
  const choose = t("cwd.choose_level");
  const nodes = items.map((item, index) => {
    const current = index === items.length - 1 ? ' data-current="true"' : "";
    const step = index
      ? `<button type="button" class="task-dir-step" data-path-set=${jsonAttr(items[index - 1].path)} title="${escapeHtml(`${choose}: ${items[index - 1].path}`)}" aria-label="${escapeHtml(`${choose}: ${items[index - 1].path}`)}">/</button>`
      : "";
    return `${step}<button type="button" class="task-dir-node" data-path-open=${jsonAttr(item.path)} title="${escapeHtml(`${open}: ${item.path}`)}" aria-label="${escapeHtml(`${open}: ${item.path}`)}"${current}>${escapeHtml(item.label)}</button>`;
  }).join("");
  return `
    <span class="task-dir-shell">
      <span class="task-dir-path">${nodes}</span>
      <span class="task-dir-actions">${actions}</span>
    </span>
  `;
}

function closeRecentDirPanel() {
  if (dom.recentDirPanel) dom.recentDirPanel.hidden = true;
}

function renderRecentDirPanel() {
  const panel = dom.recentDirPanel;
  if (!panel) return;
  const dirs = loadRecentDirectories();
  const current = activeDirectory();
  if (!dirs.length) {
    panel.innerHTML = `<div class="recent-dir-empty">${escapeHtml(t("cwd.recent_empty"))}</div>`;
    return;
  }
  panel.innerHTML = dirs.map((dir) => {
    const isActive = current && dir.toLowerCase() === current.toLowerCase();
    return `<button type="button" class="recent-dir-item" data-recent-dir="${escapeHtml(dir)}" data-active="${isActive}" title="${escapeHtml(dir)}">${escapeHtml(shortPath(dir))}</button>`;
  }).join("");
}

function openRecentDirPanel() {
  const panel = dom.recentDirPanel;
  console.log("[recent] openRecentDirPanel called, panel=", panel, "hidden=", panel?.hidden);
  if (!panel) { console.log("[recent] panel is null"); return; }
  if (!panel.hidden) { console.log("[recent] panel already open, closing"); closeRecentDirPanel(); return; }
  renderRecentDirPanel();
  console.log("[recent] rendered, innerHTML length=", panel.innerHTML.length);
  const trigger = dom.taskDir?.querySelector('[data-path-action="recent"]');
  console.log("[recent] trigger=", trigger);
  if (trigger) {
    const rect = trigger.getBoundingClientRect();
    console.log("[recent] trigger rect=", JSON.stringify({ top: rect.top, bottom: rect.bottom, left: rect.left }));
    panel.style.top = Math.round(rect.bottom + 4) + "px";
    panel.style.left = Math.round(Math.max(4, rect.left - 60)) + "px";
  }
  panel.hidden = false;
  console.log("[recent] panel shown, computed display=", getComputedStyle(panel).display, "visibility=", getComputedStyle(panel).visibility);
}

function canInitGit() {
  return !!activeDirectory() && state.connected && !state.vcs?.branch;
}

function resetProjectScope() {
  enterEmptyWorkspace();
  clearProjectScopeData();
  state.memoryFiles = [];
  state.memorySearchMode = false;
  state.preferences = [];
  _currentMemoryId = "";
  dom.memoryDialog?.close();
  dom.prefEditDialog?.close();
  renderClear();
  renderMeta();
  renderMemory();
  renderPreferences();
  renderTaskList();
}

async function reloadProjectScope(options = {}) {
  const restoreWorkspace = options.restoreWorkspace !== false;
  await ensureWorkspaceDirectory();
  const jobs = [loadTasks(), loadMeta(), loadExtensions(), loadConfigInfo(), loadExecutors(), loadPreferences()];
  await Promise.all(jobs);
  if (restoreWorkspace) await restoreInitialWorkspace();
  if (!state.selectedTaskID) {
    state.memoryFiles = [];
    state.memorySearchMode = false;
    renderMemory();
    return;
  }
  await loadMemory();
}

async function ensureWorkspaceDirectory() {
  if (activeDirectory()) return activeDirectory();
  await loadMeta();
  if (!state.directory && state.path?.directory) state.directory = state.path.directory;
  return activeDirectory();
}

async function applyDirectory(next, options = {}) {
  const save = options.save === true ? next : options.save === false ? "" : null;
  const temp = options.temp === true ? next : options.temp === false ? "" : null;
  if (
    next === state.directory &&
    (save === null || save === state.savedDirectory) &&
    (temp === null || temp === state.tempDirectory)
  ) {
    console.log("[applyDir] skipped (same)", { next, save, temp, dir: state.directory, saved: state.savedDirectory, tempDir: state.tempDirectory });
    return;
  }
  console.log("[applyDir] switching", { from: state.directory, to: next, save, temp });
  state.directoryEpoch += 1;
  state.directory = next;
  if (save !== null) state.savedDirectory = save;
  if (temp !== null) state.tempDirectory = temp;
  state.directoryMode = state.savedDirectory ? "custom" : "temp";
  state.pendingTasks = [];
  // Clear stale workspace memory so restoreInitialWorkspace() won't revert the directory switch.
  clearWorkspaceMemory();
  resetProjectScope();

  if (options.persist !== false) await persistOverlaySettings();
  if (options.save === true && next) addRecentDirectory(next);
  const ok = await checkConnection();
  if (!ok) {
    console.warn("[applyDir] connection failed, aborting");
    return;
  }
  console.log("[applyDir] reloading project scope");
  await reloadProjectScope(options);
  console.log("[applyDir] done, tasks=", state.tasks.length);
}

async function setTempDirectory(options) {
  if (!hasTauriRuntime()) {
    await applyDirectory("", { ...options, save: false, temp: false });
    return;
  }
  const next = await createTempDirectory();
  if (!next) throw new Error(t("cwd.create_unavailable"));
  await scaffoldProjectConfig(next);
  await applyDirectory(next, { ...options, save: false, temp: true });
}

async function setDirectory(value, options) {
  const next = typeof value === "string" ? value.trim() : "";
  if (!next) {
    if (state.tempDirectory) {
      await applyDirectory(state.tempDirectory, { ...options, save: false });
      return;
    }
    await setTempDirectory(options);
    return;
  }
  await applyDirectory(next, { ...options, save: true, temp: false });
}

async function setActiveDirectory(value, options = {}) {
  const next = typeof value === "string" ? value.trim() : "";
  if (!next || next === state.directory) return;
  await applyDirectory(next, {
    ...options,
    persist: false,
  });
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
    await setTempDirectory();
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
  const workspace = currentExecutionDirectory();
  const key = hashText([state.locale, dir, workspace, signText(state.vcs)].join("\u001f"));
  if (state._renderedMetaKey === key) {
    renderExecutor();
    return;
  }
  closeRecentDirPanel();
  dom.taskDir.innerHTML = pathBreadcrumb(dir);
  dom.taskDir.title = dir || t("cwd.unavailable");
  dom.taskDir.dataset.empty = dir ? "false" : "true";
  const path = dom.taskDir.querySelector(".task-dir-path");
  if (path) path.scrollLeft = path.scrollWidth;
  if (dom.taskWorkspaceDir) {
    const dirText = typeof dir === "string" ? dir.trim().replace(/[\\/]+$/, "") : "";
    const workspaceText = typeof workspace === "string" ? workspace.trim().replace(/[\\/]+$/, "") : "";
    const sameWorkspace =
      !!dirText &&
      !!workspaceText &&
      dirText.toLowerCase() === workspaceText.toLowerCase();
    const workspaceLabel = relativePathFrom(dirText, workspaceText) || shortPath(workspaceText);
    const showWorkspace = !!workspaceText && !sameWorkspace;
    dom.taskWorkspaceDir.hidden = !showWorkspace;
    dom.taskWorkspaceDir.textContent = showWorkspace ? t("cwd.execution_workspace", { value: workspaceLabel }) : "";
    dom.taskWorkspaceDir.title = showWorkspace ? workspaceText : "";
  }

  const actionable = canInitGit();
  const label = gitLabel(state.vcs, dir);
  dom.taskGit.textContent = label;
  dom.taskGit.dataset.state = actionable ? "action" : state.vcs?.dirty ? "dirty" : state.vcs?.clean ? "clean" : "idle";
  dom.taskGit.dataset.actionable = String(actionable);
  dom.taskGit.disabled = !actionable;
  dom.taskGit.title = gitTitle(state.vcs, dir);
  state._renderedMetaKey = key;
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

// ── Task Helpers ──

function clipText(value, limit = 80) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function clipBlock(value, limit = 280) {
  const text = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function shellQuote(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^[\w./:=@-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function commandLine(value) {
  if (Array.isArray(value)) return value.map(shellQuote).filter(Boolean).join(" ").trim();
  if (typeof value === "string") return value.trim();
  return "";
}

function sortedTasks(data) {
  return [...(Array.isArray(data?.tasks) ? data.tasks : [])]
    .sort((a, b) => (b.updated_at || b.task?.time?.updated || 0) - (a.updated_at || a.task?.time?.updated || 0));
}

function pendingTaskKey(requestID) {
  const value = typeof requestID === "string" ? requestID.trim() : "";
  return value ? `pending:${value}` : "";
}

function rememberPendingTask(requestID, title) {
  const value = typeof requestID === "string" ? requestID.trim() : "";
  if (!value) return;
  const headline = clipText(title || value, 72) || value;
  const now = Date.now();
  state.pendingTasks = [
    {
      _pending: true,
      requestID: value,
      task: {
        id: pendingTaskKey(value),
        requestID: value,
        source: "panel",
        title: headline,
        status: "planning",
        directory: activeDirectory(),
        time: {
          created: now,
          updated: now,
        },
      },
      overview: {
        headline,
      },
      updated_at: now,
      pending_interactions: 0,
    },
    ...state.pendingTasks.filter((item) => item?.requestID !== value),
  ];
  renderTaskList();
}

function forgetPendingTask(requestID) {
  const value = typeof requestID === "string" ? requestID.trim() : "";
  if (!value || !state.pendingTasks.some((item) => item?.requestID === value)) return false;
  state.pendingTasks = state.pendingTasks.filter((item) => item?.requestID !== value);
  renderTaskList();
  return true;
}

function syncPendingTasks(items = state.tasks) {
  if (state.pendingTasks.length === 0) return;
  const seen = new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => item?.task?.requestID)
      .filter(Boolean),
  );
  if (seen.size === 0) return;
  const next = state.pendingTasks.filter((item) => !seen.has(item?.requestID));
  if (next.length === state.pendingTasks.length) return;
  state.pendingTasks = next;
}

function visibleTasks() {
  const seen = new Set(
    state.tasks
      .map((item) => item?.task?.requestID || item?.task?.id)
      .filter(Boolean),
  );
  return [...state.pendingTasks.filter((item) => !seen.has(item?.requestID || item?.task?.id)), ...state.tasks]
    .sort((a, b) => taskUpdated(b) - taskUpdated(a));
}

function taskItem(taskID, items = state.tasks) {
  if (!taskID) return null;
  return items.find((item) => item?.task?.id === taskID) || null;
}

function taskByID(taskID) {
  return taskItem(taskID, state.tasks);
}

function taskUpdated(item) {
  return item?.updated_at || item?.task?.time?.updated || item?.task?.time?.created || 0;
}

function taskListTitle(item) {
  return clipText(item?.task?.title || item?.overview?.headline || item?.task?.id || "", 72);
}

function taskListBadge(item) {
  if (item?._pending) return statusLabel("planning");
  const pending = Number(item?.pending_interactions || 0) > 0;
  return pending ? t("detail.pending_interactions") : statusLabel(item?.task?.status || "idle");
}

function taskListMeta(item) {
  return joinBullet([
    stamp(taskUpdated(item)),
    shortPath(item?.task?.directory || ""),
  ]);
}

function goalRunPriority(status) {
  if (status === "running") return 0;
  if (status === "blocked") return 1;
  if (status === "accepted") return 2;
  if (status === "queued") return 3;
  if (status === "completed") return 4;
  if (status === "failed") return 5;
  if (status === "aborted") return 6;
  return 7;
}

function currentExecutionDirectory() {
  const rows = (Array.isArray(state.board?.goalRuns) ? state.board.goalRuns : [])
    .filter((item) => typeof item?.workspaceDir === "string" && item.workspaceDir.trim())
    .toSorted((a, b) =>
      goalRunPriority(a?.status) - goalRunPriority(b?.status) ||
      (b?.time?.updated || 0) - (a?.time?.updated || 0),
    );
  return rows[0]?.workspaceDir?.trim() || "";
}

function taskDeleteButton(item) {
  if (item?._pending) return "";
  const id = item?.task?.id || "";
  if (!id) return "";
  return `<button type="button" class="task-row-delete" data-task-delete="${escapeHtml(id)}" title="${escapeHtml(t("task.delete_button_title"))}" aria-label="${escapeHtml(t("task.delete_button_title"))}">
    <span class="task-row-delete-icon" data-icon="delete" aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <path d="M3.5 4.5h9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M6 4.5V3.6c0-.5.4-.9.9-.9h2.2c.5 0 .9.4.9.9v.9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M5.2 6.2l.4 5.4c0 .5.4.9.9.9h2.9c.5 0 .9-.4.9-.9l.4-5.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
    </span>
  </button>`;
}

function taskRow(item) {
  const id = item?.task?.id || "";
  const pending = item?._pending === true;
  const status = pending ? "planning" : item?.task?.status || "idle";
  const active = !pending && state.selectedTaskID === id ? ' data-active="true"' : "";
  const title = escapeHtml(taskListTitle(item) || id);
  const target = pending ? "" : ` data-task-id="${escapeHtml(id)}"`;
  const disabled = pending ? ' disabled aria-disabled="true"' : "";
  return `<div class="task-row-mini global-task-row"${active} title="${title}">
    <button type="button" class="task-row-main"${target}${disabled} title="${title}">
      <div class="task-row-head">
        <span class="status-dot" data-status="${escapeHtml(status)}" aria-hidden="true"></span>
        <strong>${title}</strong>
      </div>
      <span>${escapeHtml(taskListBadge(item))}</span>
      <small>${escapeHtml(taskListMeta(item))}</small>
    </button>
    ${taskDeleteButton(item)}
  </div>`;
}

function taskSection(label, items) {
  if (!items.length) return "";
  return `<section class="sidebar-list-group">
    <div class="sidebar-list-heading">${escapeHtml(label)}</div>
    <div class="sidebar-list-cluster">${items.map((item) => taskRow(item)).join("")}</div>
  </section>`;
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

async function loadTasks() {
  const epoch = state.directoryEpoch;
  const seq = ++state.tasksSeq;
  try {
    const data = await apiJson("tasks");
    if (epoch !== state.directoryEpoch || seq !== state.tasksSeq) return;
    state.tasks = sortedTasks(data);
    syncPendingTasks(state.tasks);
    if (state.selectedTaskID && !state.tasks.some((item) => item.task.id === state.selectedTaskID)) {
      enterEmptyWorkspace();
      renderClear();
      clearWorkspaceMemory();
      renderMemory();
      void persistOverlaySettings();
    }
  } catch (e) {
    AppLog.debug("tasks", "loadTasks failed, keeping current state", { error: String(e) });
    if (epoch !== state.directoryEpoch || seq !== state.tasksSeq) return;
  }
  renderTaskList();
}

// ── Task Selection ──

async function selectTask(taskID, options = {}) {
  const nextTaskID = taskID || "";
  console.log("[selectTask]", { nextTaskID, currentTaskID: state.selectedTaskID, hasBoard: !!state.board });
  if (nextTaskID === state.selectedTaskID && state.board) {
    console.log("[selectTask] skipped (same task with board)");
    return;
  }
  state.board = null;
  state.boardEtag = "";
  state.snapshotVersion = "";
  state.taskSequence = 0;
  state.agentEvents = [];
  state.ndjsonEvents = [];
  state.ndjsonStartMs = Date.now();
  state.conversationBootstrapPending = !!nextTaskID;
  state._knownChildSessions = new Set();
  if (nextTaskID) {
    enterTaskWorkspace(nextTaskID, options);
  } else {
    enterEmptyWorkspace();
  }
  renderClear();

  if (!nextTaskID) {
    setTaskStatus("idle", { visible: false });
    state.messages = [];
    state.pendingTaskMessages = null;
    pruneConversationLiveText([]);
    renderConversation();
    renderTaskList();
    clearWorkspaceMemory();
    state.memoryFiles = [];
    state.memorySearchMode = false;
    renderMemory();
    await persistOverlaySettings();
    return;
  }

    if (Array.isArray(state.pendingTaskMessages) && state.pendingTaskMessages.length > 0) {
      state.messages = cloneMessages(state.pendingTaskMessages);
      renderConversation();
    }

  try {
    await Promise.all([loadBoard({ sync: true }), loadMeta(), loadMemory()]);
  } catch (e) {
    console.error("[selectTask] loadBoard/loadMeta/loadMemory failed:", e);
  }
  try {
    await loadConversation();
  } catch (e) {
    console.error("[selectTask] loadConversation failed:", e);
  }
  rememberWorkspace({
    taskID: nextTaskID,
  });
  await persistOverlaySettings();
  startPolling();

  // Start SSE for running tasks
  const status = state.board?.task?.status;
  if (["running", "planning", "evaluating", "delivering", "blocked", "queued"].includes(status)) {
    startSSE(nextTaskID);
  }
}

async function deleteTask(taskID) {
  const item = taskItem(taskID);
  if (!taskID || !item) return false;
  const accepted = await nativeConfirm(t("task.delete_confirm", { title: taskListTitle(item) }), {
    title: t("task.delete_title"),
    okLabel: t("common.delete"),
    kind: "warning",
  });
  if (!accepted) return false;
  try {
    await apiJson(`task/${encodeURIComponent(taskID)}`, {
      method: "DELETE",
    });
    if (state.selectedTaskID === taskID) {
      await selectTask("");
    }
    await loadTasks();
    return true;
  } catch (e) {
    AppLog.error("ui", "Failed to delete task", { error: String(e), taskID });
    await nativeMessage(errorText("task.delete_failed", e), {
      title: t("task.delete_title"),
      kind: "error",
    });
    return false;
  }
}

// ── Board Loading ──

function scheduleBoard(delay = 0) {
  state.boardSyncPending = true;
  if (state.boardRetryTimer) {
    clearTimeout(state.boardRetryTimer);
    state.boardRetryTimer = null;
  }
  if (state.boardKick) clearTimeout(state.boardKick);
  state.boardKick = setTimeout(() => {
    state.boardKick = null;
    loadBoard({ sync: true });
  }, delay);
}

function clearBoardRetry() {
  if (state.boardRetryTimer) {
    clearTimeout(state.boardRetryTimer);
    state.boardRetryTimer = null;
  }
  state.boardRetryCount = 0;
}

function retryBoard(sync) {
  if (!state.selectedTaskID || state.boardRetryTimer) return;
  if (sync) state.boardSyncPending = true;
  const delay = Math.min(1000 * Math.pow(2, Math.min(state.boardRetryCount, 4)), 15000);
  state.boardRetryCount += 1;
  state.boardRetryTimer = setTimeout(() => {
    state.boardRetryTimer = null;
    loadBoard({ sync: state.boardSyncPending });
  }, delay);
}

async function loadBoard(options = {}) {
  if (!state.selectedTaskID) return;
  if (isInteractionBusy()) return;
  if (options.sync) state.boardSyncPending = true;
  if (state.boardLoading) {
    state.boardQueued = true;
    if (options.sync) state.boardSyncPending = true;
    return state.boardLoading;
  }
  const taskID = state.selectedTaskID;
  const sync = options.sync === true || state.boardSyncPending;
  if (sync) state.boardSyncPending = true;
  state.boardLoading = (async () => {
    let failed = false;
    try {
      const headers = apiHeaders();
      if (state.boardEtag) headers["If-None-Match"] = state.boardEtag;
      const res = await fetch(apiUrl(`task/${taskID}/board?sync=${sync ? "1" : "0"}`), {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (taskID !== state.selectedTaskID) return;
      state.boardSyncPending = false;
      if (res.status === 304) {
        clearBoardRetry();
        state.boardUpdatedAt = Date.now();
        return;
      }
      if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
      const etag = res.headers.get("etag");
      if (etag) state.boardEtag = etag;
      const next = await res.json();
      const nextSequence = boardSequence(next);
      if (nextSequence > 0 && nextSequence < state.taskSequence) {
        AppLog.warn("board", "discarding stale board snapshot", {
          taskID,
          sequence: nextSequence,
          expected: state.taskSequence,
        });
        return;
      }
      state.board = next;
      state.snapshotVersion = boardSnapshot(next);
      state.taskSequence = Math.max(state.taskSequence, nextSequence);
      clearBoardRetry();
      state.boardUpdatedAt = Date.now();
      renderMeta();
      renderBoard();
      renderConversation();
      await Promise.all([
        loadChanges(),
        loadExecutorEvents(state.board?.task?.activeRunID || ""),
      ]);
    } catch (e) {
      failed = true;
      AppLog.warn("board", "loadBoard failed", { error: String(e) });
      if (taskID === state.selectedTaskID) retryBoard(sync);
    } finally {
      state.boardLoading = null;
      if (state.boardQueued) {
        state.boardQueued = false;
        if (!failed && !state.boardRetryTimer) queueMicrotask(() => loadBoard({ sync: state.boardSyncPending }));
      }
    }
  })();
  return state.boardLoading;
}

// ── Control Conversation ──

function scheduleConversation(delay = 0) {
  if (state.conversationKick) clearTimeout(state.conversationKick);
  state.conversationKick = setTimeout(() => {
    state.conversationKick = null;
    loadConversation();
  }, delay);
}

function scheduleTasks(delay = 0) {
  if (state.tasksKick) clearTimeout(state.tasksKick);
  state.tasksKick = setTimeout(() => {
    state.tasksKick = null;
    loadTasks();
  }, delay);
}

function messageTime(item) {
  return Number(item?.info?.time?.created || item?.info?.time?.updated || 0);
}

function sortMessages(list) {
  return [...(Array.isArray(list) ? list : [])]
    .map((item, index) => ({ item, index }))
    .sort((a, b) => messageTime(a.item) - messageTime(b.item) || a.index - b.index)
    .map((item) => item.item);
}

async function loadConversationSource(path) {
  try {
    const data = await apiJson(path);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    AppLog.debug("conversation", "load source failed", { error: String(e), path });
    return [];
  }
}

function conversationChanged(prev, next) {
  if (!Array.isArray(prev) || !Array.isArray(next)) return true;
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i]?.info?.id !== next[i]?.info?.id) return true;
    const pp = prev[i]?.parts || [];
    const np = next[i]?.parts || [];
    if (pp.length !== np.length) return true;
  }
  return false;
}

async function loadConversation() {
  const target = conversationTarget();
  const targetKey = conversationTargetKey(target);
  if (state.conversationLoading) {
    state.conversationQueued = true;
    return state.conversationLoading;
  }
  state.conversationLoading = (async () => {
    try {
      if (target.taskID) {
        const [transcript, timeline] = await Promise.all([
          loadConversationSource(`task/${encodeURIComponent(target.taskID)}/transcript`),
          loadConversationSource(`control/timeline?taskID=${encodeURIComponent(target.taskID)}`),
        ]);
        if (targetKey !== conversationTargetKey(conversationTarget())) return;
        const next = sortMessages(mergeMessages(timeline, transcript));
        let merged;
        if (next.length > 0) {
          state.pendingTaskMessages = null;
          merged = mergeConversationSnapshot(next);
        } else if (Array.isArray(state.pendingTaskMessages) && state.pendingTaskMessages.length > 0) {
          merged = cloneMessages(state.pendingTaskMessages);
        } else {
          merged = mergeConversationSnapshot([]);
        }
        state.conversationBootstrapPending = false;
        state.conversationUpdatedAt = Date.now();
        if (conversationChanged(state.messages, merged)) {
          state.messages = merged;
          renderConversation();
        }
        return;
      }
      if (targetKey !== conversationTargetKey(conversationTarget())) return;
      state.messages = [];
      pruneConversationLiveText([]);
      state.conversationBootstrapPending = false;
      state.conversationUpdatedAt = Date.now();
      renderConversation();
    } catch (e) {
      AppLog.error("ui", "Failed to load conversation", { error: String(e) });
      if (targetKey !== conversationTargetKey(conversationTarget())) return;
      if (!target.taskID) {
        state.messages = [];
        pruneConversationLiveText([]);
        state.conversationUpdatedAt = Date.now();
        renderConversation();
      }
      return;
    } finally {
      state.conversationLoading = null;
      if (state.conversationQueued) {
        state.conversationQueued = false;
        queueMicrotask(() => loadConversation());
      }
    }
  })();
  return state.conversationLoading;
}

function currentSessionID() {
  return currentTaskSessionID();
}

function rootTaskSessionID() {
  const sessionID = state.board?.task?.sessionID;
  return typeof sessionID === "string" ? sessionID : "";
}

function matchesCurrentSession(sessionID) {
  if (!sessionID) return false;
  const current = currentSessionID();
  if (!current) {
    const initialHydration =
      state.conversationBootstrapPending ||
      (!state.board && (!Array.isArray(state.messages) || state.messages.length === 0));
    if (state.selectedTaskID && initialHydration) scheduleConversation(0);
    return false;
  }
  if (current === sessionID) return true;
  // Check previously-discovered child sessions first (fast O(1) lookup)
  if (state._knownChildSessions && state._knownChildSessions.has(sessionID)) return true;
  // Also accept sessions that appear in already-loaded messages (e.g., goal run child sessions).
  // The task SSE is already task-scoped, so any session in state.messages is task-related.
  if (state.messages.some((msg) => msg.info?.sessionID === sessionID)) return true;
  // The SSE stream is task-scoped (backend matchesTaskEvent filters by taskID + goalRunSessionRegistry).
  // Any sessionID that arrives via SSE belongs to this task — accept it immediately and
  // remember it so subsequent events match without a transcript reload.
  if (state.selectedTaskID) {
    // Track this child session so future lookups don't need to re-discover it
    if (!state._knownChildSessions) state._knownChildSessions = new Set();
    state._knownChildSessions.add(sessionID);
    return true;
  }
  return false;
}

function conversationTarget() {
  if (state.selectedTaskID) {
    return {
      kind: "task",
      taskID: state.selectedTaskID,
    };
  }
  return {
    kind: "empty",
  };
}

function conversationTargetKey(target = conversationTarget()) {
  if (target.taskID) return `task:${target.taskID}`;
  return "empty";
}

async function loadChanges() {
  if (state.selectedTaskID) {
    const requestKey = `task:${state.selectedTaskID}`
    state.changeKey = requestKey
    const delivery =
      state.board?.acceptedDelivery?.result?.diffs ||
      state.board?.delivery?.result?.diffs ||
      state.board?.candidateDelivery?.result?.diffs ||
      []
    state.changes = normalizeDiffs(delivery)
    renderChanges()
    return
  }
  state.changeKey = "changes:none";
  state.changes = [];
  renderChanges();
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

function startSSE(taskID, retryCount = 0) {
  stopSSE();
  const controller = new AbortController();
  state.sse = controller;
  state.sseConnected = false;
  const MAX_SSE_RETRIES = 60;
  const after = Math.max(0, Number(state.taskSequence) || 0);

  (async () => {
    try {
      const path = after > 0
        ? `task/${taskID}/events?after=${after}`
        : `task/${taskID}/events`;
      const res = await fetch(apiUrl(path), {
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
      // Stream ended normally — reconnect with reset backoff
      state.sseConnected = false;
      const delay = 3000;
      AppLog.info("sse", `stream ended, reconnecting in ${delay}ms`, { taskID });
      if (state.sseRetryTimer) clearTimeout(state.sseRetryTimer);
      state.sseRetryTimer = setTimeout(() => {
        state.sseRetryTimer = null;
        if (state.selectedTaskID === taskID) startSSE(taskID, 0);
      }, delay);
    } catch (e) {
      state.sseConnected = false;
      if (e.name === "AbortError") return;
      if (retryCount >= MAX_SSE_RETRIES) {
        AppLog.error("sse", "max retries reached, giving up", { taskID, retryCount });
        return;
      }
      const delay = Math.min(5000 * Math.pow(1.5, retryCount), 60000);
      AppLog.warn("sse", `disconnected, retrying in ${Math.round(delay)}ms (attempt ${retryCount + 1})`, { taskID, error: String(e) });
      if (state.sseRetryTimer) clearTimeout(state.sseRetryTimer);
      state.sseRetryTimer = setTimeout(() => {
        state.sseRetryTimer = null;
        if (state.selectedTaskID === taskID) startSSE(taskID, retryCount + 1);
      }, delay);
    }
  })();
}

function stopSSE() {
  if (state.sseRetryTimer) {
    clearTimeout(state.sseRetryTimer);
    state.sseRetryTimer = null;
  }
  if (state.sse) {
    state.sse.abort();
    state.sse = null;
  }
  state.sseConnected = false;
}

function boardSequence(board) {
  const value = Number(board?.lastSequence);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function boardSnapshot(board) {
  return typeof board?.snapshotVersion === "string" ? board.snapshotVersion : "";
}

function eventSequence(event) {
  const value = Number(event?.sequence);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function acceptEventSequence(event) {
  const sequence = eventSequence(event);
  if (!sequence) return "ok";
  if (sequence <= state.taskSequence) return "duplicate";
  const gap = state.taskSequence > 0 && sequence > state.taskSequence + 1;
  if (gap) {
    AppLog.warn("sse", "task event sequence gap detected", {
      taskID: state.selectedTaskID,
      expected: state.taskSequence + 1,
      actual: sequence,
    });
    return "gap";
  }
  state.taskSequence = sequence;
  return "ok";
}

function repairEventGap(gap) {
  if (!gap) return;
  scheduleTasks(0);
  scheduleBoard(0);
  if (state.selectedTaskID) queueMicrotask(() => startSSE(state.selectedTaskID));
}

function eventData(event) {
  if (record(event?.properties)) return event.properties;
  if (record(event?.payload)) return event.payload;
  return {};
}

function mergeMessages(...lists) {
  const ids = new Set();
  return lists.flatMap((list) =>
    (Array.isArray(list) ? list : []).filter((item) => {
      const id = item?.info?.id;
      if (!id) return true;
      if (ids.has(id)) return false;
      ids.add(id);
      return true;
    }),
  );
}

function agentStageRole(stage) {
  const text = String(stage || "").trim().toLowerCase();
  if (text === "planner" || text === "plan") return "planner";
  if (text === "spec") return "spec";
  if (text === "judge" || text === "evaluation" || text === "scheduler") return "scheduler";
  if (text === "delivery" || text === "files") return "delivery";
  return "system";
}

// ── Agent Channel Classification ──
// Messages tagged with these agent stages are separated from the main conversation
// and rendered in collapsible agent cards instead.
const AGENT_STAGES = new Set(["spec", "planner", "goal", "judge", "delivery"]);

/** Classify a message as "main" conversation or an agent stage channel.
 *  Must be cheap — called once per message per render. Avoids expensive phaseFromMessage(). */
function classifyMessage(msg) {
  const agent = String(msg?.info?.agent || "").trim().toLowerCase();
  if (AGENT_STAGES.has(agent)) return agent;
  // Legacy: messages with agent="agent" from child sessions — separate from main
  if (agent === "agent") {
    const rootSession = rootTaskSessionID();
    const sessionID = typeof msg?.info?.sessionID === "string" ? msg.info.sessionID : "";
    if (rootSession && sessionID && sessionID !== rootSession) {
      // Child session with generic tag — put in "agent" bucket (shown as generic card)
      return "agent";
    }
  }
  return "main";
}

/** Get the display label for an agent stage used in card headers. */
function agentStageLabel(stage) {
  if (stage === "spec") return t("chat.role.spec");
  if (stage === "planner") return t("chat.role.planner");
  if (stage === "goal") return t("chat.role.goal");
  if (stage === "judge" || stage === "scheduler") return t("chat.role.scheduler");
  if (stage === "delivery") return t("chat.role.delivery");
  return t("chat.role.message");
}

function activeAgentStages() {
  const status = String(state.board?.task?.status || "").trim().toLowerCase();
  if (status === "planning") return new Set(["spec", "planner"]);
  if (status === "evaluating") return new Set(["judge"]);
  if (status === "delivering") return new Set(["delivery"]);
  if (!status && Array.isArray(state.agentEvents) && state.agentEvents.length > 0) {
    return new Set(state.agentEvents.map((item) => String(item?.stage || "").trim().toLowerCase()).filter(Boolean));
  }
  return new Set();
}

function agentEventEntry(raw) {
  const payload = record(raw?.payload) ? raw.payload : record(raw?.properties) ? raw.properties : {};
  const stage = String(payload.stage || "").trim().toLowerCase();
  const kind = String(payload.kind || "status").trim().toLowerCase();
  const created = Number(raw?.timestamp || payload.timestamp || Date.now());
  const toolName = typeof payload.toolName === "string" && payload.toolName.trim()
    ? payload.toolName.trim()
    : typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim()
      : "";
  const text = displayString(payload.text);
  const summary = displayString(raw?.summary || payload.summary || text);
  const id =
    typeof payload.id === "string" && payload.id
      ? payload.id
      : typeof raw?.event_id === "string" && raw.event_id
        ? raw.event_id
        : `${stage}:${kind}:${toolName || "event"}:${created}`;
  if (!stage) return null;
  if (!summary && !text && !toolName) return null;
  return {
    id,
    eventID: typeof raw?.event_id === "string" ? raw.event_id : "",
    stage,
    kind,
    toolName,
    text,
    summary,
    payload,
    time: {
      created: Number.isFinite(created) ? created : Date.now(),
    },
  };
}

function agentEventTargetText(event) {
  if (!event) return "";
  if (event.kind === "message_delta" || event.kind === "reasoning_delta" || event.kind === "status") {
    return displayString(event.text || event.summary);
  }
  if (event.kind === "tool_call" || event.kind === "tool_delta") {
    return displayString(event.text || event.payload?.text || event.summary);
  }
  if (event.kind === "tool_result") {
    return displayString(event.payload?.output || event.payload?.result || event.summary);
  }
  return displayString(event.summary);
}

function syncAgentText(event) {
  if (!event) return;
  const key = `agent:${event.stage}:${event.id || "unknown"}`;
  const target = agentEventTargetText(event);
  if (!target) {
    delete event._targetText;
    delete event._liveText;
    stopLiveText(key);
    return;
  }
  event._targetText = target;
  startLiveText(key, target, typeof event._liveText === "string" ? event._liveText : "", (value) => {
    event._liveText = value;
  });
}

function mergeAgentEvent(existing, next) {
  if (!existing) return next;
  if (next.kind === "message_delta" || next.kind === "reasoning_delta") {
    return {
      ...existing,
      ...next,
      text: `${displayString(existing._targetText || existing.text || existing.summary)}${displayString(next.text || next.summary)}`,
      summary: `${displayString(existing._targetText || existing.text || existing.summary)}${displayString(next.text || next.summary)}`,
      payload: {
        ...(record(existing.payload) ? existing.payload : {}),
        ...(record(next.payload) ? next.payload : {}),
      },
    };
  }
  if (next.kind === "tool_delta") {
    const mergedText = `${displayString(existing.text || existing.payload?.text || "")}${displayString(next.text || next.payload?.text || next.summary)}`;
    return {
      ...existing,
      ...next,
      kind: existing.kind === "tool_result" ? "tool_result" : "tool_call",
      text: mergedText,
      summary: displayString(existing.summary || next.summary),
      payload: {
        ...(record(existing.payload) ? existing.payload : {}),
        ...(record(next.payload) ? next.payload : {}),
        text: mergedText,
      },
    };
  }
  if (next.kind === "tool_result") {
    return {
      ...existing,
      ...next,
      payload: {
        ...(record(existing.payload) ? existing.payload : {}),
        ...(record(next.payload) ? next.payload : {}),
        text: displayString(existing.payload?.text || existing.text || next.payload?.text || ""),
      },
    };
  }
  return {
    ...existing,
    ...next,
    payload: {
      ...(record(existing.payload) ? existing.payload : {}),
      ...(record(next.payload) ? next.payload : {}),
    },
  };
}

function mergeAgentEventList(events = [], raw) {
  const event = agentEventEntry(raw);
  if (!event) return events;
  const index = events.findIndex((item) => item.id === event.id && item.stage === event.stage);
  const next = index >= 0
    ? [
      ...events.slice(0, index),
      mergeAgentEvent(events[index], event),
      ...events.slice(index + 1),
    ]
    : [...events, event];
  const target = index >= 0 ? next[index] : next[next.length - 1];
  syncAgentText(target);
  return next.sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0));
}

function appendAgentEvent(raw) {
  state.agentEvents = mergeAgentEventList(state.agentEvents, raw);
  state.conversationUpdatedAt = Date.now();
  renderConversation();
}

function agentMessage(event) {
  if (!event) return null;
  const created = event.time?.created || Date.now();
  if (event.kind === "tool_call" || event.kind === "tool_delta" || event.kind === "tool_result") {
    const part = eventToolPart(event, {
      status: event.kind === "tool_result" ? "completed" : "running",
      output: event.kind === "tool_result" ? agentEventTargetText(event) : "",
    });
    if (!part) return null;
    return {
      _synthetic: true,
      info: {
        id: `agent:${event.stage}:${event.id}`,
        role: "task_tool",
        agent: event.stage,
        time: { created },
      },
      parts: [part],
    };
  }
  const text = typeof event._liveText === "string" ? event._liveText : agentEventTargetText(event);
  if (!text.trim()) return null;
  const type = event.kind === "reasoning_delta" ? "reasoning" : "text";
  return {
    _synthetic: true,
    info: {
      id: `agent:${event.stage}:${event.id}`,
      role: agentStageRole(event.stage),
      agent: event.stage,
      time: { created },
    },
    parts: [{
      id: `agent-part:${event.stage}:${event.id}`,
      type,
      text,
      messageID: `agent:${event.stage}:${event.id}`,
      sessionID: "",
    }],
  };
}

function buildAgentMessages() {
  // Agent messages are now rendered in dedicated agent cards via classifyMessage().
  // No longer build synthetic messages from agentEvents — this was causing duplicates
  // and garbled content (.update noise) alongside real session-persisted messages.
  return [];
}


// Agent content display functions removed — agent output now goes through
// session/message system and is rendered via standard message handlers.

function toolNameKey(name) {
  return String(name || "").toLowerCase().replace(/[\s_-]+/g, "");
}

function toolInputCommand(input) {
  if (!record(input)) return "";
  const value = input.command ?? input.argv ?? input.cmd;
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : [])
    .join(" ")
    .trim();
}

function toolStateInput(value, fallback = "") {
  if (record(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback.trim() ? { raw: fallback.trim() } : {};
    try {
      const parsed = JSON.parse(trimmed);
      if (record(parsed)) return parsed;
    } catch {}
    return { raw: trimmed };
  }
  if (Array.isArray(value)) {
    const raw = value
      .flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : [])
      .join(" ")
      .trim();
    if (raw) return { raw };
  }
  return fallback.trim() ? { raw: fallback.trim() } : {};
}

function eventToolName(event) {
  const candidates = [
    event?.toolName,
    event?.payload?.toolName,
    event?.payload?.name,
    event?.sourceLabel,
  ];
  for (const item of candidates) {
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  const summary = displayString(event?.summary).trim();
  const match = summary.match(/^(?:tool call|tool result|shell command):\s*(.+)$/i);
  if (match?.[1]?.trim()) return match[1].trim();
  return "unknown";
}

function eventToolStatus(event, preferred = "") {
  const status = String(
    preferred ||
    event?.sourceStatus ||
    event?.payload?.status ||
    "",
  ).trim().toLowerCase();
  if (status.includes("fail") || status.includes("error")) return "error";
  if (status.includes("complete") || status.includes("done")) return "completed";
  if (status.includes("queue") || status.includes("pending")) return "pending";
  if (event?.kind === "tool_result") return "completed";
  return "running";
}

function eventToolPart(event, options = {}) {
  if (!event) return null;
  const created = Number(event?.time?.created || Date.now());
  const summary = displayString(event?.summary).trim();
  const inputText = displayString(event?.text || event?.payload?.text).trim();
  const input = toolStateInput(
    event?.payload?.input ?? event?.payload?.arguments ?? event?.payload?.args ?? "",
    inputText,
  );
  const id = typeof event?.id === "string" && event.id ? event.id : `tool:${created}:${eventToolName(event)}`;
  const callID = typeof event?.sourceID === "string" && event.sourceID
    ? event.sourceID
    : typeof event?.payload?.id === "string" && event.payload.id
      ? event.payload.id
      : id;
  const tool = eventToolName(event);
  const status = eventToolStatus(event, typeof options.status === "string" ? options.status : "");
  const output = clipBlock(displayString(options.output || event?.payload?.output || event?.payload?.result || summary));
  if (status === "completed") {
    return {
      id,
      type: "tool",
      callID,
      tool,
      state: {
        status: "completed",
        input,
        output: output || summary || tool,
        title: summary || tool,
        metadata: { synthetic: true },
        time: {
          start: created,
          end: created,
        },
      },
    };
  }
  if (status === "error") {
    return {
      id,
      type: "tool",
      callID,
      tool,
      state: {
        status: "error",
        input,
        error: output || summary || tool,
        metadata: { synthetic: true },
        time: {
          start: created,
          end: created,
        },
      },
    };
  }
  if (status === "pending") {
    return {
      id,
      type: "tool",
      callID,
      tool,
      state: {
        status: "pending",
        input,
        raw: inputText || summary || tool,
      },
    };
  }
  return {
    id,
    type: "tool",
    callID,
    tool,
    state: {
      status: "running",
      input,
      title: summary || tool,
      metadata: { synthetic: true },
      time: {
        start: created,
      },
    },
  };
}

function displayToolIcon(name) {
  const n = toolNameKey(name);
  if (n === "read" || n === "readfile") return "\uD83D\uDCC4";
  if (n === "edit" || n === "editfile" || n === "applypatch") return "\u270F\uFE0F";
  if (n === "write" || n === "writefile") return "\uD83D\uDCDD";
  if (n === "bash" || n === "shellcommand") return "\uD83D\uDCBB";
  if (n === "grep" || n === "searchcode") return "\uD83D\uDD0D";
  if (n === "glob" || n === "findfiles") return "\uD83D\uDCC2";
  if (n === "agent" || n === "spawnagent") return "\uD83E\uDD16";
  if (n === "todowrite" || n === "todoupdate" || n === "updateplan") return "\u2611\uFE0F";
  return "\u26A1";
}

function displayToolDetail(name, input, state) {
  const safeInput = record(input) ? input : {};
  const safeState = record(state) ? state : {};
  const n = toolNameKey(name);
  const path = safeInput.file_path || safeInput.filePath || safeInput.path || safeInput.filename || "";
  if (path) return shortRelativePath(path);
  if (n === "bash" || n === "shellcommand") return clipText(toolInputCommand(safeInput), 80);
  if (n === "grep" || n === "searchcode") return safeInput.pattern || safeInput.query || safeInput.q || "";
  if (n === "glob" || n === "findfiles") return safeInput.pattern || safeInput.glob || "";
  if (n === "agent" || n === "spawnagent") return clipText(safeInput.description || safeInput.prompt || "", 80);
  if (typeof safeInput.raw === "string" && safeInput.raw.trim()) return clipText(safeInput.raw, 80);
  if ((safeState.status === "completed" || safeState.status === "running") && typeof safeState.title === "string") return safeState.title;
  return "";
}

function handleEventStreamEvent(event) {
  // Buffer event in NDJSON format for log panel
  if (event && event.type && !event.type.includes("message.") && event.type !== "task.heartbeat") {
    const props = record(event.properties) ? event.properties : record(event.payload) ? event.payload : {};
    if (!state.ndjsonStartMs) state.ndjsonStartMs = Date.now();
    const ndjsonEntry = {
      at: new Date().toISOString(),
      elapsed_ms: Date.now() - state.ndjsonStartMs,
      type: event.type.startsWith("orchestrator.") ? event.type : "orchestrator." + event.type,
      taskID: state.selectedTaskID || "",
      runID: String(props.runID ?? event.run_id ?? ""),
      stage: String(props.stage ?? ""),
      kind: String(props.kind ?? ""),
      status: String(props.status ?? event.status ?? ""),
      toolName: String(props.toolName ?? ""),
      summary: String(props.summary ?? event.summary ?? ""),
      text: String(props.text ?? ""),
      progressType: String(props.progressType ?? props.type ?? ""),
      goalRunID: String(props.goalRunID ?? ""),
    };
    state.ndjsonEvents.push(ndjsonEntry);
  }
  const sync = acceptEventSequence(event);
  if (sync === "duplicate") return;
  if (sync === "gap") {
    repairEventGap(true);
    return;
  }
  const type = event.type || "";
  if (type === "task.heartbeat") return;
  if (type === "task.connected") return;
  if (type === "task.replay_expired") {
    // Server's replay buffer is too old — do a full transcript reload
    AppLog.warn("sse", "replay buffer expired, performing full reload");
    state.conversationBootstrapPending = true;
    loadConversation();
    scheduleTasks(0);
    scheduleBoard(0);
    return;
  }
  const properties = eventData(event);
  if (type === "message.updated") {
    const info = record(properties.info) ? properties.info : null;
    if (!matchesCurrentSession(info?.sessionID)) return;
    const existing = state.messages.find((item) => item.info?.id === info.id);
    if (existing) {
      // Metadata-only update (tokens, timestamps) — update silently, no re-render
      existing.info = info;
      return;
    }
    if (state.chatRequest) {
      const placeholder = chatPlaceholder();
      if (placeholder) {
        placeholder.info = { ...placeholder.info, ...info };
        state.conversationUpdatedAt = Date.now();
        renderConversation();
      } else {
        // Push message placeholder silently — don't render until parts arrive
        state.messages.push({ info, parts: [] });
      }
    } else {
      // Push message placeholder silently — parts will trigger render via message.part.updated
      state.messages.push({ info, parts: [] });
    }
    return;
  }
  if (type === "message.part.updated") {
    const part = record(properties.part) ? properties.part : null;
    if (!matchesCurrentSession(part?.sessionID)) return;
    let message = state.messages.find((item) => item.info?.id === part.messageID);
    if (!message) {
      // Event arrived before message.updated — create a placeholder message
      message = { info: { id: part.messageID, sessionID: part.sessionID, role: "assistant" }, parts: [] };
      state.messages.push(message);
    }
    const index = message.parts.findIndex((item) => item.id === part.id);
    if (index >= 0) {
      message.parts[index] = hydrateLivePart(message.parts[index], part);
    } else if (message.parts.length === 1 && isPendingPlaceholderPart(message.parts[0])) {
      message.parts = [hydrateLivePart(message.parts[0], part)];
    } else {
      message.parts.push(hydrateLivePart(null, part));
    }
    state.conversationUpdatedAt = Date.now();
    renderConversation();
    return;
  }
  if (type === "message.part.delta") {
    if (!matchesCurrentSession(properties.sessionID) || typeof properties.delta !== "string") return;
    if (properties.field !== "text" && properties.field !== "raw") return;

    if (properties.field === "raw") {
      let message = state.messages.find((item) => item.info?.id === properties.messageID);
      if (!message) return;
      let part = message.parts.find((item) => item.id === properties.partID && item.type === "tool");
      if (!part || !record(part.state)) return;
      const currentRaw = typeof part.state.raw === "string" ? part.state.raw : "";
      const targetRaw = `${typeof part._targetRaw === "string" ? part._targetRaw : currentRaw}${properties.delta}`;
      part._targetRaw = targetRaw;
      part.state.raw = targetRaw;  // Apply instantly (no animation for tool input)
      state.conversationUpdatedAt = Date.now();
      renderConversation();
      return;
    }

    let message = state.messages.find((item) => item.info?.id === properties.messageID);
    if (!message) {
      // Delta arrived before message.updated — create a placeholder message
      message = { info: { id: properties.messageID, sessionID: properties.sessionID, role: "assistant" }, parts: [] };
      state.messages.push(message);
    }
    let part = message.parts.find((item) =>
      item.id === properties.partID &&
      (item.type === "text" || item.type === "reasoning"),
    );
    if (!part) {
      // Delta arrived before part.updated — create a placeholder part
      part = { id: properties.partID, type: "text", text: "", sessionID: properties.sessionID, messageID: properties.messageID };
      message.parts.push(part);
    }
    if (part.type === "reasoning") touchReasoningPart(part);
    const target = `${typeof part._targetText === "string" ? part._targetText : part.text || ""}${properties.delta}`;
    streamMessagePart(part, target, "text", part.text || "");
    state.conversationUpdatedAt = Date.now();
    // Render all deltas immediately — agent cards need real-time streaming too
    renderConversation();
    return;
  }
  if (type === "run.progress") {
    // Skip internal message lifecycle events — these are metadata updates
    // (role, tokens, timestamps) already handled by message.updated/part.updated/part.delta
    const progressType = properties.type || "";
    if (progressType === "message.updated" || progressType === "message.part.updated" || progressType === "message.part.delta") return;
    // Drop protocol noise and lifecycle events (no user-visible content)
    if (progressType === "protocol.raw" || progressType === "executor.status" || progressType === "executor.progress") return;
    appendExecutorEvent({
      id: event.event_id,
      runID: event.run_id || properties.runID,
      type: properties.type,
      summary: event.summary || properties.summary,
      payload: properties,
      timestamp: event.timestamp,
    });
    return;
  }
  if (type === "run.output") {
    appendExecutorEvent({
      id: event.event_id,
      runID: event.run_id || properties.runID,
      type: "message_delta",
      summary: typeof properties.text === "string" ? properties.text : event.summary,
      payload: properties,
      timestamp: event.timestamp,
    });
    return;
  }
  if (type === "agent.updated") {
    const stage = properties.stage || "";
    const kind = properties.kind || "";
    const summary = typeof event.summary === "string" ? event.summary : typeof properties.summary === "string" ? properties.summary : "";
    appendAgentEvent(event);
    if (stage && summary) {
      state.agentStatus = { stage, kind, summary, timestamp: Date.now() };
      renderBoard();
      // Re-render conversation so the "thinking" placeholder updates with live agent status
      if (chatPlaceholder()) debouncedRenderConversation();
    }
    return;
  }
  if (
    type.includes("task.updated") ||
    type.includes("task.completed") ||
    type.includes("task.failed") ||
    type.includes("task.cancelled") ||
    type.includes("task.blocked") ||
    type.includes("run.") ||
    type.includes("plan.") ||
    type.includes("goal.") ||
    type.includes("delivery.") ||
    type.includes("evaluation.") ||
    type.includes("interaction.")
  ) {
    scheduleTasks(BOARD_EVENT_DEBOUNCE);
    scheduleBoard(BOARD_EVENT_DEBOUNCE);
    return;
  }
}

function handleSSEEvent(event) {
  handleEventStreamEvent(event);
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
  state.conversationTimer = setInterval(() => {
    if (!state.selectedTaskID) return;
    if (state.conversationBootstrapPending) {
      loadConversation();
      return;
    }
    // Only poll when SSE is disconnected
    if (!state.sseConnected) {
      loadConversation();
    }
  }, CONVERSATION_POLL);
}

function stopPolling() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  if (state.conversationTimer) { clearInterval(state.conversationTimer); state.conversationTimer = null; }
  if (state.elapsedTimer) { clearInterval(state.elapsedTimer); state.elapsedTimer = null; }
  if (state.boardKick) { clearTimeout(state.boardKick); state.boardKick = null; }
  if (state.boardRetryTimer) { clearTimeout(state.boardRetryTimer); state.boardRetryTimer = null; }
  if (state.tasksKick) { clearTimeout(state.tasksKick); state.tasksKick = null; }
  if (state.conversationKick) { clearTimeout(state.conversationKick); state.conversationKick = null; }
  state.boardRetryCount = 0;
  state.boardSyncPending = false;
  stopSSE();
}

// ── Rendering: Board ──

function renderBoard() {
  if (!state.board) {
    clearSectionPhases();
    return;
  }
  const { task, plan, overview, lanes, evaluation, delivery, interactions, spec } = state.board;

  // Status
  setTaskStatus(task.status);
  startElapsedTimer(task.time.started || task.time.created);

  // Task actions (retry / replan / cancel) + failure alert
  renderTaskActions(overview);

  // Spec
  renderSpec(spec);

  // Plan
  renderPlan(plan);

  // Goals
  const goalsLane = (lanes || []).find((l) => l.id === "goals");
  renderGoals(goalsLane?.cards || []);

  // Criteria + Evaluation
  renderCriteria(task, evaluation);
  renderBudget(task);

  // Evaluation
  renderEvaluation(evaluation);
  renderDeliverySection(delivery);
  syncSectionPhases();

  // Interactions
  renderInteractions(interactions || []);
  renderExecutor();

  // Re-render the task conversation to include updated board context.
  renderConversation();
}

function setTaskStatus(status, options = {}) {
  const visible = options.visible ?? true;
  const next = status || "idle";
  document.body.dataset.taskStatus = next;
  if (dom.taskStatus) dom.taskStatus.hidden = !visible;
  if (dom.taskStatus) dom.taskStatus.dataset.status = next;
  dom.statusDot.dataset.status = next;
  dom.statusDot.innerHTML = statusIcon(next);
  dom.statusLabel.textContent = statusLabel(next);
  // Show terminate button only for active (non-terminal) task states
  const activeStates = ["running", "planning", "queued", "evaluating", "delivering", "blocked"];
  if (dom.btnTerminateRun) {
    dom.btnTerminateRun.hidden = !visible || !activeStates.includes(next);
  }
  if (!visible) {
    dom.taskStatus?.removeAttribute("title");
    dom.taskStatus?.removeAttribute("aria-label");
    return;
  }
  updateTaskStatusDetail(next);
}

function statusLabel(status) {
  const map = {
    idle: t("task.status.idle"),
    queued: t("task.status.queued"),
    planning: t("task.status.planning"),
    running: t("task.status.running"),
    blocked: t("task.status.blocked"),
    evaluating: t("task.status.evaluating"),
    delivering: t("task.status.delivering"),
    completed: t("task.status.completed"),
    failed: t("task.status.failed"),
    cancelled: t("task.status.cancelled"),
  };
  return map[status] || status;
}

function statusIcon(status) {
  const map = {
    idle: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><circle data-fill="true" cx="8" cy="8" r="1.25"/></svg>`,
    queued: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><path data-stroke="true" d="M8 5.4v2.8l2.1 1.3"/></svg>`,
    planning: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path data-stroke="true" d="M5 3.5v9"/><path data-stroke="true" d="M5 5.5h6"/><path data-stroke="true" d="M5 10.5h4"/><circle data-fill="true" cx="5" cy="3.5" r="1.15"/><circle data-fill="true" cx="11" cy="5.5" r="1.15"/><circle data-fill="true" cx="9" cy="10.5" r="1.15"/></svg>`,
    running: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path data-fill="true" d="M6 4.6L11.3 8 6 11.4Z"/></svg>`,
    blocked: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path data-fill="true" d="M8 3.1L13 12H3Z"/><path data-stroke="true" d="M8 5.8v2.8"/><circle data-fill="true" cx="8" cy="10.8" r="0.9" style="fill: var(--surface-strong);"/></svg>`,
    evaluating: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="6.7" cy="6.7" r="3.5"/><path data-stroke="true" d="M9.5 9.5l2.9 2.9"/><circle data-fill="true" cx="6.7" cy="6.7" r="1.2"/></svg>`,
    delivering: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path data-stroke="true" d="M3.5 8h9"/><path data-stroke="true" d="M9 4.5L12.5 8 9 11.5"/><circle data-fill="true" cx="3.5" cy="8" r="1"/></svg>`,
    completed: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><path data-stroke="true" d="M5.1 8.2l2 2 3.8-3.8"/></svg>`,
    failed: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><path data-stroke="true" d="M5.4 5.4l5.2 5.2"/><path data-stroke="true" d="M10.6 5.4l-5.2 5.2"/></svg>`,
    cancelled: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><path data-stroke="true" d="M5.2 10.8l5.6-5.6"/></svg>`,
  };
  return map[status] || map.idle;
}

function maximizeLabel(maximized) {
  return t(maximized ? "titlebar.restore" : "titlebar.maximize");
}

function maximizeIcon(maximized) {
  if (maximized) {
    return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 5.5h6v6H5z" stroke="currentColor" stroke-width="1.2"/><path d="M7 3.5h4.5V8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.2" stroke="currentColor" stroke-width="1.2"/></svg>`;
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

function phaseSections() {
  return {
    spec: dom.specSection,
    plan: dom.planSection,
    goals: dom.goalsSection,
    evaluation: dom.criteriaSection,
    delivery: dom.deliverySection,
    files: dom.changesSection,
  };
}

function clearSectionPhases() {
  Object.values(phaseSections()).forEach((node) => {
    if (!node) return;
    delete node.dataset.phaseState;
  });
}

function markSectionPhase(kind, value) {
  const node = phaseSections()[kind];
  if (!node) return;
  if (!value) {
    delete node.dataset.phaseState;
    return;
  }
  node.dataset.phaseState = value;
}

function phaseFromAgent(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (text.includes("goal_gate") || text.includes("goal")) return "goals";
  if (text.includes("scheduler") || text.includes("evaluator") || text.includes("evaluation") || text.includes("evaluate") || text.includes("review")) return "evaluation";
  if (text.includes("planner") || text.includes("planning") || text.includes("replan") || text === "plan") return "plan";
  if (text.includes("spec")) return "spec";
  if (text.includes("deliver") || text.includes("delivery") || text.includes("publish")) return "files";
  return "";
}

function phaseFromMessage(message) {
  if (!message || typeof message !== "object") return "";
  const info = message.info && typeof message.info === "object" ? message.info : {};
  const direct = phaseFromAgent(info.agent) || phaseFromAgent(info.role);
  if (direct) return direct;
  const parts = Array.isArray(message.parts) ? message.parts : [];
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (!part || typeof part !== "object") continue;
    if (part.type === "subtask") {
      const mapped = phaseFromAgent(part.agent) || phaseFromAgent(part.description) || phaseFromAgent(part.prompt);
      if (mapped) return mapped;
      continue;
    }
    if (part.type === "agent") {
      const mapped = phaseFromAgent(part.name);
      if (mapped) return mapped;
      continue;
    }
    if (part.type !== "tool") continue;
    const state = part.state && typeof part.state === "object" ? part.state : {};
    const input = state.input && typeof state.input === "object" ? state.input : {};
    const mapped =
      phaseFromAgent(input.agent) ||
      phaseFromAgent(input.name) ||
      phaseFromAgent(input.description) ||
      phaseFromAgent(state.title) ||
      phaseFromAgent(part.tool);
    if (mapped) return mapped;
  }
  return "";
}

function liveConversationPhase(messages = state.messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    const running = parts.some((part) => part?.type === "tool" && ["running", "pending"].includes(part?.state?.status || ""));
    const incomplete = message?.info?.role === "assistant" && !message?.info?.time?.completed;
    if (!running && !incomplete) continue;
    // Prefer explicit agent tag over keyword matching
    const agent = String(message?.info?.agent || "").trim().toLowerCase();
    if (agent === "spec") return "spec";
    if (agent === "planner") return "plan";
    if (agent === "goal") return "goals";
    if (agent === "judge") return "evaluation";
    if (agent === "delivery") return "files";
    return phaseFromMessage(message);
  }
  return "";
}

function relatePhase(kind, related, board, goals) {
  if (!kind) return;
  if (kind === "plan") {
    if (board?.spec) related.push("spec");
    return;
  }
  if (kind === "goals") {
    if (board?.plan) related.push("plan");
    if (state.changes.length > 0) related.push("files");
    return;
  }
  if (kind === "evaluation") {
    if (goals.length > 0) related.push("goals");
    if (state.changes.length > 0) related.push("files");
    return;
  }
  if (kind === "files") {
    if (board?.evaluation) related.push("evaluation");
    if (goals.length > 0) related.push("goals");
    return;
  }
}

function syncSectionPhases(board = state.board) {
  clearSectionPhases();
  const live = liveConversationPhase();
  if (!board?.task && !live) return;

  const goals = (board?.lanes || []).find((lane) => lane.id === "goals")?.cards || [];
  const pending = (board?.interactions || []).some((item) => item.status === "pending");
  const planning = board?.task ? board.task.status === "planning" || board.run?.phase === "plan" || board.run?.phase === "replan" : false;
  const active = [];
  const related = [];

  if (live) {
    active.push(live);
    relatePhase(live, related, board, goals);
  }

  if (board?.task && (pending || board.task.status === "blocked")) {
    active.length = 0;
    if (board.plan) active.push("plan");
    else if (goals.length > 0) active.push("goals");
    else if (board.spec) active.push("spec");
  }

  if (board?.task && active.length === 0 && board.task.status === "queued") {
    if (board.spec) active.push("spec");
    else if (board.plan) active.push("plan");
  }

  if (board?.task && active.length === 0 && planning) {
    active.push(board.spec ? "plan" : "spec");
    if (board.spec) related.push("spec");
    if (board.plan) related.push("plan");
  }

  if (board?.task && active.length === 0 && board.task.status === "running") {
    active.push(goals.length > 0 ? "goals" : board.plan ? "plan" : "spec");
    if (board.plan) related.push("plan");
    if (state.changes.length > 0) related.push("files");
  }

  if (board?.task && active.length === 0 && board.task.status === "evaluating") {
    active.push("evaluation");
    if (goals.length > 0) related.push("goals");
    if (state.changes.length > 0) related.push("files");
  }

  if (board?.task && active.length === 0 && board.task.status === "delivering") {
    active.push("delivery");
    if (state.changes.length > 0) related.push("files");
    if (board.evaluation) related.push("evaluation");
    if (goals.length > 0) related.push("goals");
  }

  if (board?.task && active.length === 0 && board.task.status === "completed") {
    active.push(board.delivery ? "delivery" : state.changes.length > 0 ? "files" : "evaluation");
    if (board.delivery && state.changes.length > 0) related.push("files");
    if (board.evaluation) related.push("evaluation");
    if (goals.length > 0) related.push("goals");
  }

  if (board?.task && active.length === 0 && board.task.status === "failed") {
    active.push(board.evaluation ? "evaluation" : board.plan ? "plan" : "spec");
    if (board.plan) related.push("plan");
    if (goals.length > 0) related.push("goals");
  }

  if (board?.task && active.length === 0 && board.task.status === "cancelled") {
    if (board.plan) active.push("plan");
    else if (board.spec) active.push("spec");
  }

  const current = [...new Set(active.filter(Boolean))];
  const contextual = [...new Set(related.filter((kind) => kind && !current.includes(kind)))];

  current.forEach((kind) => markSectionPhase(kind, "active"));
  contextual.forEach((kind) => markSectionPhase(kind, "related"));
}

// ── Task Actions Bar (retry / replan / cancel + failure alert) ──

function renderTaskActions(overview) {
  const bar = dom.taskActionsBar;
  if (!bar) return;
  if (!overview) {
    bar.hidden = true;
    bar.innerHTML = "";
    return;
  }
  const controls = overview.controls || {};
  const hasButtons = controls.canRetry || controls.canReplan || controls.canCancel;
  const failure = overview.currentFailure;
  if (!hasButtons && !failure) {
    bar.hidden = true;
    bar.innerHTML = "";
    return;
  }
  let html = "";
  if (failure) {
    html += `<div class="interaction-alert task-failure-alert">
      <div class="interaction-title">${escapeHtml(failure.title)}</div>
      <div class="interaction-body md-content">${renderMarkdown(failure.summary)}</div>
    </div>`;
  }
  if (hasButtons) {
    html += '<div class="task-actions-buttons">';
    if (controls.canRetry) html += `<button type="button" class="btn btn-primary" data-task-action="retry" title="${escapeHtml(t("task.action.retry_title"))}" aria-label="${escapeHtml(t("task.action.retry_title"))}">${escapeHtml(t("task.action.retry"))}</button>`;
    if (controls.canReplan) html += `<button type="button" class="btn btn-ghost" data-task-action="replan" title="${escapeHtml(t("task.action.replan_title"))}" aria-label="${escapeHtml(t("task.action.replan_title"))}">${escapeHtml(t("task.action.replan"))}</button>`;
    if (controls.canCancel) html += `<button type="button" class="btn btn-ghost" data-task-action="cancel" title="${escapeHtml(t("task.action.cancel_title"))}" aria-label="${escapeHtml(t("task.action.cancel_title"))}">${escapeHtml(t("common.cancel"))}</button>`;
    html += "</div>";
  }
  bar.innerHTML = html;
  bar.hidden = false;
}

function goalItemsHtml(cards) {
  const runningGoalIDs = new Set(
    (state.board?.goalRuns || [])
      .filter((gr) => gr.status === "running" || gr.status === "accepted")
      .map((gr) => gr.goalID),
  );
  return cards
    .map(
      (card) => `
      <div class="goal-item">
        <span class="goal-status-icon" data-status="${card.status || "pending"}">${goalIcon(card.status)}</span>
      <div class="goal-content">
          <div class="goal-desc md-content">${renderMarkdown(card.title)}</div>
          ${card.detail ? `<div class="goal-criteria md-content">${renderMarkdown(card.detail)}</div>` : ""}
        </div>
        ${runningGoalIDs.has(card.id) ? `<span class="extension-status" data-state="active">${escapeHtml(t("goal.running"))}</span>` : ""}
        ${card.metadata?.priority ? `<span class="goal-priority" data-priority="${card.metadata.priority}">${card.metadata.priority}</span>` : ""}
        <div class="goal-actions">
          <button
            type="button"
            class="btn btn-ghost mini"
            data-goal-action="edit"
            data-goal-id=${jsonAttr(card.id)}
            data-goal-title=${jsonAttr(card.title)}
            data-goal-detail=${jsonAttr(card.detail || "")}
            title="${escapeHtml(t("goal.edit_button_title"))}"
            aria-label="${escapeHtml(t("goal.edit_button_title"))}"
          >${escapeHtml(t("common.edit"))}</button>
          <button type="button" class="btn btn-ghost mini danger" data-goal-action="delete" data-goal-id=${jsonAttr(card.id)} title="${escapeHtml(t("goal.delete_button_title"))}" aria-label="${escapeHtml(t("goal.delete_button_title"))}">${escapeHtml(t("common.delete"))}</button>
        </div>
      </div>`,
    )
    .join("");
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

  // Clone node to remove event listeners before re-rendering
  const newBody = dom.changesBody.cloneNode(false);

  if (!files.length) {
    dom.changesBadge.textContent = "";
    delete dom.changesBadge.dataset.tone;
    const hint = state.selectedTaskID ? t("files.unavailable") : t("files.select_target");
    newBody.innerHTML = `<p class="empty-hint">${escapeHtml(hint)}</p>`;
    dom.changesBody.parentNode?.replaceChild(newBody, dom.changesBody);
    dom.changesBody = newBody;
    syncSectionPhases();
    return;
  }

  const additions = files.reduce((sum, item) => sum + item.additions, 0);
  const deletions = files.reduce((sum, item) => sum + item.deletions, 0);
  dom.changesBadge.textContent = String(files.length);
  dom.changesBadge.dataset.tone = "accent";
  newBody.innerHTML = `
    <div class="changes-summary">
      <span>${tc("files.changed", files.length)}</span>
      <span class="changes-total">
        <span data-tone="add">+${additions}</span>
        <span data-tone="del">-${deletions}</span>
      </span>
    </div>
    <div class="changes-list">${changeRowsHtml()}</div>
  `;
  dom.changesBody.parentNode?.replaceChild(newBody, dom.changesBody);
  dom.changesBody = newBody;
  syncSectionPhases();
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
    if (action === "retry") {
      const note = await nativePrompt(t("task.action.retry_note_placeholder"), {
        title: t("task.action.retry_note_title"),
        inputLabel: t("task.action.retry_note_label"),
        inputPlaceholder: t("task.action.retry_note_placeholder"),
        kind: "info",
      });
      if (note === null) return;
      const message = note?.trim()
        ? `Retry task ${state.selectedTaskID} with this operator guidance: ${note}`
        : `Perform retry on task ${state.selectedTaskID}.`;
      await panelMessage(message, {
        taskID: state.selectedTaskID,
        ui_context: "task_controls",
        ...(note?.trim() ? { operator_note: note.trim() } : {}),
      });
    } else {
      await panelMessage(`Perform ${action} on task ${state.selectedTaskID}.`, {
        taskID: state.selectedTaskID,
        ui_context: "task_controls",
      });
    }
    await loadBoard({ sync: true });
  } catch (e) {
    AppLog.error("ui", `Failed to ${action} task`, { error: String(e) });
  }
};

const openGoalDialog = function () {
  if (!state.selectedTaskID) return;
  dom.goalId.value = "";
  dom.goalDescription.value = "";
  dom.goalCriteria.value = "";
  dom.goalDialog.showModal();
};

const editGoal = function (id, description, criteria) {
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
    await loadBoard({ sync: true });
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
    dom.goalsBody.innerHTML = `<p class="empty-hint">${escapeHtml(t("empty.goals"))}</p>`;
    return;
  }
  dom.goalsBadge.textContent = `${passed}/${total}`;
  dom.goalsBadge.dataset.tone = passed === total ? "good" : passed > 0 ? "warn" : "";

  dom.goalsBody.innerHTML = `<div class="goals-list">${goalItemsHtml(cards)}</div>`;
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
  if (base === "spec_check") return "acceptance";
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
  return ["artifact", "ui_review", "code_quality", "code_review", "dead_code_review", "spec_check"].includes(key);
}

function checkSelectionConfig(key, current) {
  const base = current && typeof current === "object" && !Array.isArray(current)
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
                <span class="criteria-desc">${escapeHtml(
                  spec.readOnly ? t("detail.observed") : spec.enabled ? t("detail.enabled") : t("detail.disabled")
                )}</span>
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

function renderEvaluation(evaluation) {
  if (!evaluation) {
    if (dom.criteriaBadge) { dom.criteriaBadge.textContent = ""; delete dom.criteriaBadge.dataset.tone; }
    if (dom.evalBody) dom.evalBody.innerHTML = "";
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

  if (dom.evalBody) dom.evalBody.innerHTML = html;
}

function taskBudget(task = state.board?.task) {
  const budget = task?.budget
  if (!budget || typeof budget !== "object") return undefined
  return {
    maxRuns: Number.isFinite(budget.maxRuns) ? budget.maxRuns : undefined,
    maxReplans: Number.isFinite(budget.maxReplans) ? budget.maxReplans : undefined,
    maxEvaluations: Number.isFinite(budget.maxEvaluations) ? budget.maxEvaluations : undefined,
    maxWallTimeMs: Number.isFinite(budget.maxWallTimeMs) ? budget.maxWallTimeMs : undefined,
  }
}

function sameBudget(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function budgetMinutes(value) {
  if (!Number.isFinite(value) || value <= 0) return ""
  const next = Math.round((value / 60000) * 10) / 10
  return Number.isInteger(next) ? String(next) : next.toFixed(1)
}


function setBudgetInputs(budget) {
  if (dom.budgetMaxRuns) dom.budgetMaxRuns.value = budget?.maxRuns === undefined ? "" : String(budget.maxRuns)
  if (dom.budgetMaxReplans) dom.budgetMaxReplans.value = budget?.maxReplans === undefined ? "" : String(budget.maxReplans)
  if (dom.budgetMaxEvaluations) dom.budgetMaxEvaluations.value = budget?.maxEvaluations === undefined ? "" : String(budget.maxEvaluations)
  if (dom.budgetMaxWallTime) dom.budgetMaxWallTime.value = budget?.maxWallTimeMs === undefined ? "" : budgetMinutes(budget.maxWallTimeMs)
}

function budgetNumber(input, options = {}) {
  const text = input?.value?.trim() || ""
  if (!text) return undefined
  const value = Number(text)
  if (!Number.isFinite(value)) return undefined
  if (options.allowZero ? value < 0 : value <= 0) return undefined
  return Math.round(value * (options.scale || 1))
}

function draftBudget() {
  const budget = {
    maxRuns: budgetNumber(dom.budgetMaxRuns),
    maxReplans: budgetNumber(dom.budgetMaxReplans, { allowZero: true }),
    maxEvaluations: budgetNumber(dom.budgetMaxEvaluations),
    maxWallTimeMs: budgetNumber(dom.budgetMaxWallTime, { scale: 60000 }),
  }
  if (Object.values(budget).every((value) => value === undefined)) return undefined
  return budget
}

function renderBudgetState(task = state.board?.task) {
  const budget = taskBudget(task)
  const changed = !sameBudget(draftBudget(), budget)
  const enabled = !!task?.id && !state.budgetSaving
  if (dom.btnBudgetSave) dom.btnBudgetSave.disabled = !enabled || !changed
  if (dom.btnBudgetReset) dom.btnBudgetReset.disabled = !enabled || (!changed && !state.budgetDirty)
  if (dom.budgetHint) {
    dom.budgetHint.textContent = task?.id
      ? t("budget.hint")
      : t("budget.empty")
  }
  for (const input of [dom.budgetMaxRuns, dom.budgetMaxReplans, dom.budgetMaxEvaluations, dom.budgetMaxWallTime]) {
    if (!input) continue
    input.disabled = !enabled
  }
}

function renderBudget(task) {
  const budget = taskBudget(task)
  if (!state.budgetDirty) setBudgetInputs(budget)
  renderBudgetState(task)
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

function renderDeliverySection(delivery) {
  if (!dom.deliveryBody || !dom.deliveryBadge || !dom.deliverySection) return;
  if (!delivery) {
    dom.deliveryBody.innerHTML = `<p class="empty-hint">${escapeHtml(t("empty.delivery"))}</p>`;
    dom.deliveryBadge.textContent = "";
    delete dom.deliveryBadge.dataset.tone;
    return;
  }
  const status = delivery.status;
  const label = deliveryStatusLabel(status);
  dom.deliveryBadge.textContent = label;
  dom.deliveryBadge.dataset.tone =
    status === "delivered" ? "good" :
    status === "failed" ? "bad" : "accent";
  dom.deliveryBody.innerHTML = renderDeliveryCard(delivery);
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

function renderTaskList() {
  if (!dom.taskListPanel) return;
  const items = visibleTasks();
  const active = items.filter((item) => !["completed", "failed", "cancelled"].includes(item?.task?.status || ""));
  const recent = items.filter((item) => ["completed", "failed", "cancelled"].includes(item?.task?.status || ""));
  const html = items.length === 0
    ? `<div class="empty-hint">${escapeHtml(t("task.none"))}</div>`
    : [
      taskSection(t("task.group.active"), active),
      taskSection(t("task.group.recent"), recent),
    ].filter(Boolean).join("");
  if (dom.taskListPanel.innerHTML === html) return;
  const top = dom.taskListPanel.scrollTop;
  dom.taskListPanel.innerHTML = html;
  dom.taskListPanel.scrollTop = top;
}

function unsupportedSessionWorkspace() {
  throw new Error("Overlay no longer supports session workspaces; use tasks instead.");
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
  const detail = displayToolDetail(toolName, st.input || {}, st);
  const status = st.status || "pending";
  return [t("transcript.tool", { status: toolStatusLabel(status), tool: toolName }), detail].filter(Boolean).join(" ");
}

function formatTranscriptExecutorProcess(part) {
  const process = record(part?.process) ? part.process : {};
  const title = String(process.title || process.id || "").trim();
  const detail = String(process.detail || "").trim();
  const note = String(process.note || "").trim();
  const output = String(process.output || "").trim();
  const header = [processStatusLabel(String(process.status || "running")), title].filter(Boolean).join(" ");
  return [header, detail, note, output].filter(Boolean).join("\n");
}

function formatTranscriptPart(part, role) {
  if (!part || typeof part !== "object") return "";
  if (part.type === "text") return formatTranscriptText(part, role);
  if (part.type === "reasoning") return part.text?.trim() ? `${t("transcript.reasoning")}\n${part.text.trim()}` : "";
  if (part.type === "tool") return formatTranscriptTool(part);
  if (part.type === "executor_process") return formatTranscriptExecutorProcess(part);
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

function formatConversationTranscript(messages) {
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

function orderedMessageParts(message) {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  if (parts.length < 2) return parts;
  const reasoning = [];
  const rest = [];
  for (const part of parts) {
    if (part?.type === "reasoning") reasoning.push(part);
    else rest.push(part);
  }
  return [...reasoning, ...rest];
}

async function createManagedSession() {
  unsupportedSessionWorkspace();
}

async function openManagedSession(sessionID, input) {
  unsupportedSessionWorkspace();
}

async function selectManagedSession(sessionID, input = {}) {
  unsupportedSessionWorkspace();
}

// ── Interactions ──

// ── Interaction Handlers ──

async function resolveInteraction(id, action, input = {}) {
  return resolveInteractionHelper(id, action, input);
}

async function rejectInteraction(id) {
  return rejectInteractionHelper(id);
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

// ── Conversation Rendering ──
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
    if (part.type !== "text") continue;
    if (part.audience && part.audience.ui === false) continue;
    if (part.kind === "trace" && !part.audience?.ui) continue;
    if (part.source) return part.source;
  }
  return undefined;
}

function effectiveRole(msg) {
  const role = msg.info?.role || "assistant";
  if (role !== "user") return role;
  const source = detectSource(msg);
  if (source) return source;
  const rootSession = rootTaskSessionID();
  const sessionID = typeof msg.info?.sessionID === "string" ? msg.info.sessionID : "";
  if (rootSession && sessionID && sessionID !== rootSession) {
    return agentStageRole(phaseFromMessage(msg) || msg.info?.agent || "system");
  }
  return role;
}

function groupMessagesByRole(sorted) {
  const groups = [];
  for (const msg of sorted) {
    // Agent card placeholders are always isolated groups
    if (msg._agentCard) {
      groups.push({ role: "agent-card", messages: [msg] });
      continue;
    }

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

function hashText(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function signText(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) || "";
  } catch {
    /* value contains circular references or is otherwise non-serializable */
    return String(value ?? "");
  }
}

function signPart(part) {
  if (!record(part)) return signText(part);
  if (part.type === "text" || part.kind === "trace") {
    if (typeof part._targetText === "string") {
      return ["text", part.id || "", "streaming"].join("\u001f");
    }
    return ["text", part.kind || "", part.source || "", part.audience?.ui === false ? "0" : "1", part.text || ""].join("\u001f");
  }
  if (part.type === "tool") {
    const st = record(part.state) ? part.state : {};
    if (st.status === "pending" && typeof part._targetRaw === "string") {
      return ["tool", part.tool || "", "streaming", part.id || ""].join("\u001f");
    }
    return ["tool", part.tool || "", st.status || "", signText(st.input || {}), signText(st.output || ""), st.title || ""].join("\u001f");
  }
  if (part.type === "reasoning") {
    if (typeof part._targetText === "string") {
      return ["reasoning", part.id || "", "streaming"].join("\u001f");
    }
    return ["reasoning", reasoningPartHidden(part) ? "0" : "1", part.text || ""].join("\u001f");
  }
  if (part.type === "patch") {
    return ["patch", ...(Array.isArray(part.files) ? part.files : [])].join("\u001f");
  }
  if (part.type === "file") {
    return ["file", part.filename || "", part.url || "", part.mime || part.mediaType || ""].join("\u001f");
  }
  return signText(part);
}

function signGroup(group) {
  // Agent cards: sign based on stage, status, and inner message count + latest part signatures
  if (group.role === "agent-card") {
    const card = group.messages[0];
    const innerMsgs = card?._agentMessages || [];
    const lastMsg = innerMsgs[innerMsgs.length - 1];
    const lastParts = Array.isArray(lastMsg?.parts) ? lastMsg.parts : [];
    return hashText(
      ["agent-card", card?._agentStage || "", card?._agentStatus || "",
       String(innerMsgs.length), ...lastParts.map(signPart)].join("\u001d"),
    );
  }
  return hashText(
    [group.role, ...group.messages.map((message) => [
      message._synthetic ? "1" : "0",
      message.info?.time?.created || 0,
      ...(Array.isArray(message.parts) ? message.parts : []).map(signPart),
    ].join("\u001e"))].join("\u001d"),
  );
}

function boardArtifact(board, label) {
  const list = board?.artifacts || [];
  return list.find((item) => item.label === label);
}

function syntheticTextMessage(role, time, text) {
  if (typeof text !== "string" || !text.trim()) return null;
  return {
    _synthetic: true,
    info: {
      id: `synthetic:${role}:${Number.isFinite(time) ? time : Date.now()}:${hashText(text)}`,
      role,
      time: { created: Number.isFinite(time) ? time : Date.now() },
    },
    parts: [{ type: "text", text }],
  };
}

function executorEventKind(type) {
  const text = String(type || "").trim().toLowerCase();
  if (!text) return "status";
  if (text.includes("tool")) return text.includes("result") ? "tool_result" : "tool_call";
  if (text.includes("reason")) return "reasoning_delta";
  if (text.includes("plan")) return "plan_delta";
  if (text.includes("diff")) return "diff_delta";
  if (text.includes("approval")) return "approval_request";
  if (text.includes("input")) return "input_request";
  if (text.includes("mcp")) return "mcp";
  if (text.includes("command")) return "command";
  if (text.includes("error")) return "error";
  if (text.includes("done") || text.includes("completed")) return "done";
  if (text.includes("delta") || text.includes("message")) return "message_delta";
  return "status";
}

function executorEventSourceKind(kind, payload = {}) {
  if (typeof payload.sourceKind === "string" && payload.sourceKind.trim()) return payload.sourceKind.trim();
  if (kind === "tool_call" || kind === "tool_result") return "tool";
  if (kind === "command") return "command";
  if (kind === "approval_request") return "approval";
  if (kind === "input_request") return "input";
  if (kind === "mcp") return "mcp";
  if (kind === "reasoning_delta") return "assistant";
  if (kind === "message_delta") return "assistant";
  if (kind === "error") return "error";
  return "status";
}

function executorEventEntry(raw) {
  const kind = typeof raw?.kind === "string" && raw.kind ? raw.kind : executorEventKind(raw?.type);
  const payload =
    record(raw?.payload) && record(raw.payload.payload)
      ? { ...raw.payload, ...raw.payload.payload }
      : record(raw?.payload)
        ? raw.payload
        : {};
  const summary = typeof raw?.summary === "string"
    ? raw.summary.trim()
    : typeof raw?.text === "string"
      ? raw.text.trim()
      : typeof payload.summary === "string"
        ? payload.summary.trim()
        : typeof payload.text === "string"
          ? payload.text.trim()
      : "";
  const created = Number(raw?.time?.created || raw?.timestamp || Date.now());
  if (!summary && Object.keys(payload).length === 0) return null;
  const marker =
    typeof payload.id === "string" && payload.id
      ? payload.id
      : typeof payload.name === "string" && payload.name
        ? payload.name
        : typeof raw?.type === "string" && raw.type
          ? raw.type
          : "event";
  const sourceID = typeof payload.sourceID === "string" && payload.sourceID
    ? payload.sourceID
    : typeof payload.id === "string" && payload.id
      ? payload.id
      : "";
  const goalRunID = typeof raw?.goalRunID === "string" && raw.goalRunID
    ? raw.goalRunID
    : typeof raw?.goal_run_id === "string" && raw.goal_run_id
      ? raw.goal_run_id
      : typeof payload.goalRunID === "string" && payload.goalRunID
        ? payload.goalRunID
        : typeof payload.goal_run_id === "string" && payload.goal_run_id
          ? payload.goal_run_id
          : "";
  const executorSessionID = typeof raw?.executorSessionID === "string" && raw.executorSessionID
    ? raw.executorSessionID
    : typeof raw?.executor_session_id === "string" && raw.executor_session_id
      ? raw.executor_session_id
      : typeof payload.executorSessionID === "string" && payload.executorSessionID
        ? payload.executorSessionID
        : typeof payload.executor_session_id === "string" && payload.executor_session_id
          ? payload.executor_session_id
          : "";
  const sourceKind = executorEventSourceKind(kind, payload);
  const sourceLabel = typeof payload.sourceLabel === "string" && payload.sourceLabel.trim()
    ? payload.sourceLabel.trim()
    : "";
  const sourceStatus = typeof payload.status === "string" && payload.status.trim()
    ? payload.status.trim()
    : "";
  const scope = goalRunID
    ? `goal:${goalRunID}`
    : executorSessionID
      ? `session:${executorSessionID}`
      : "";
  return {
    id: typeof raw?.id === "string" && raw.id
      ? raw.id
      : kind === "message_delta" && sourceID
        ? `executor:${scope || "global"}:${sourceID}`
        : `executor:${kind}:${created}:${summary || marker}`,
    runID: typeof raw?.runID === "string"
      ? raw.runID
      : typeof raw?.run_id === "string"
        ? raw.run_id
        : typeof raw?.payload?.runID === "string"
          ? raw.payload.runID
          : "",
    kind,
    summary,
    payload,
    sourceID,
    sourceKind,
    sourceLabel,
    sourceStatus,
    goalRunID,
    executorSessionID,
    time: { created: Number.isFinite(created) ? created : Date.now() },
  };
}

function executorEventScopeID(event) {
  if (!event) return "";
  if (typeof event.goalRunID === "string" && event.goalRunID) return `goal:${event.goalRunID}`;
  if (typeof event.executorSessionID === "string" && event.executorSessionID) return `session:${event.executorSessionID}`;
  if (typeof event.runID === "string" && event.runID) return `run:${event.runID}`;
  return "";
}

function sameExecutorEventScope(left, right) {
  const a = executorEventScopeID(left);
  const b = executorEventScopeID(right);
  if (!a || !b) return true;
  return a === b;
}

function genericExecutorSummary(event) {
  const summary = String(event?.summary || "").trim().toLowerCase();
  if (!summary) return true;
  if (event.kind === "tool_call") return /^(tool call|shell command):\s*\S+$/.test(summary);
  if (event.kind === "tool_result") {
    return summary.startsWith("tool result:") ||
      [
        "shell command completed",
        "structured output returned",
        "approval resolved",
        "user input received",
      ].includes(summary);
  }
  if (event.kind === "command") {
    return [
      "command",
      "running command",
      "command started",
      "command completed",
    ].includes(summary);
  }
  return false;
}

function executorCommand(event) {
  if (!record(event?.payload)) return "";
  const input = record(event.payload.input) ? event.payload.input : {};
  return commandLine(
    event.payload.command ??
    event.payload.argv ??
    event.payload.cmd ??
    input.command ??
    input.argv ??
    input.cmd ??
    "",
  );
}

function executorOutput(event) {
  if (!record(event?.payload)) return "";
  const output = event.payload.output;
  if (typeof output === "string") return clipBlock(output);
  if (record(output)) {
    const text = [
      output.output,
      output.stdout,
      output.stderr,
      output.result,
      output.message,
      output.content,
    ]
      .filter((item) => typeof item === "string" && item.trim())
      .join("\n");
    if (text) return clipBlock(text);
    return "";
  }
  if (typeof event.payload.text === "string") return clipBlock(event.payload.text);
  return "";
}

function executorCall(events, index, event) {
  const id = typeof event?.payload?.id === "string" ? event.payload.id : "";
  if (!id || !Array.isArray(events) || index <= 0) return null;
  return [...events.slice(0, index)]
    .reverse()
    .find((item) =>
      item?.kind === "tool_call" &&
      item?.payload?.id === id &&
      (!item.runID || !event.runID || item.runID === event.runID) &&
      sameExecutorEventScope(item, event),
    ) || null;
}

function executorTargetText(event, events = [], index = -1) {
  if (typeof event?._targetText === "string") return event._targetText;
  const summary = displayString(event?.summary).trim();
  const command = executorCommand(event);
  const output = executorOutput(event);

  if (event?.kind === "message_delta") {
    const text = displayString(event?.payload?.text);
    if (text.trim()) return text;
    return summary;
  }

  if (event?.kind === "reasoning_delta") {
    const text = displayString(event?.payload?.text);
    if (text.trim()) return text;
    return summary;
  }

  if (event?.kind === "tool_call") {
    if (!command) return summary;
    if (genericExecutorSummary(event)) return command;
    if (summary.includes(command)) return summary;
    return [summary, command].filter(Boolean).join("\n");
  }

  if (event?.kind === "command") {
    const lines = [];
    if (summary && (!genericExecutorSummary(event) || !command)) lines.push(summary);
    if (command && !lines.some((item) => item.includes(command))) lines.push(command);
    if (output) lines.push(output);
    if (lines.length > 0) return lines.join("\n");
    return summary;
  }

  if (event?.kind === "tool_result") {
    const call = executorCall(events, index, event);
    const linked = command || executorCommand(call);
    const lines = [];
    if (summary && (!genericExecutorSummary(event) || (!linked && !output))) lines.push(summary);
    if (linked && !lines.some((item) => item.includes(linked))) lines.push(linked);
    if (output) lines.push(output);
    if (lines.length > 0) return lines.join("\n");
    return summary;
  }

  return summary;
}

function executorText(event, events = [], index = -1) {
  if (typeof event?._liveText === "string") return event._liveText;
  return executorTargetText(event, events, index);
}

// Whitelist: only these event kinds are user-visible. Everything else is protocol noise.
const VISIBLE_EXECUTOR_KINDS = new Set([
  "message_delta", "reasoning_delta",
  "tool_call", "tool_result", "command",
  "approval_request", "input_request",
  "error", "mcp",
]);

function visibleExecutorEvent(event) {
  if (!event) return false;
  if (!VISIBLE_EXECUTOR_KINDS.has(event.kind)) return false;
  return !!executorText(event);
}

function executorMessage(event, events = [], index = -1) {
  const text = executorText(event, events, index);
  if (!text || !visibleExecutorEvent(event)) return null;
  const part = event.kind === "tool_call" || event.kind === "tool_result"
    ? eventToolPart(event, {
      status: event.kind === "tool_result" ? "completed" : "",
      output: event.kind === "tool_result" ? (executorOutput(event) || text) : "",
    })
    : {
      id: `${event.kind === "reasoning_delta" ? "reasoning" : "text"}:${event.id || index}`,
      type: event.kind === "reasoning_delta" ? "reasoning" : "text",
      text,
      messageID: event.id,
      sessionID: "",
    };
  if (part.type === "reasoning" && reasoningPartHidden(part)) return null;
  return {
    _synthetic: true,
    info: {
      id: event.id,
      role: event.kind === "message_delta" || event.kind === "reasoning_delta" ? "assistant" : "task_tool",
      time: { created: event.time?.created || Date.now() },
    },
    parts: [part],
  };
}

function executorProcessBaseID(event) {
  if (!event) return "";
  if (typeof event.sourceID === "string" && event.sourceID) return event.sourceID;
  if (typeof event?.payload?.sourceID === "string" && event.payload.sourceID) return event.payload.sourceID;
  if (typeof event?.payload?.id === "string" && event.payload.id) return event.payload.id;
  if (event.kind === "command") {
    const command = executorCommand(event);
    if (command) return `command:${command}`;
  }
  return "";
}

function executorProcessID(event) {
  const base = executorProcessBaseID(event);
  if (!base) return "";
  const scope = executorEventScopeID(event);
  return scope ? `${scope}:${base}` : base;
}

function executorProcessKind(event) {
  if (!event) return "";
  if (typeof event.sourceKind === "string" && event.sourceKind) return event.sourceKind;
  return executorEventSourceKind(event.kind, record(event?.payload) ? event.payload : {});
}

function executorProcessStatus(event) {
  const status = String(event?.sourceStatus || event?.payload?.status || "").trim().toLowerCase();
  if (status.includes("fail") || status.includes("error")) return "failed";
  if (status.includes("complete") || status.includes("done")) return "completed";
  if (status.includes("block")) return "blocked";
  if (status.includes("queue") || status.includes("pending")) return "queued";
  if (event?.kind === "tool_result") return "completed";
  if (event?.kind === "error") return "failed";
  if (event?.kind === "approval_request" || event?.kind === "input_request") return "blocked";
  const summary = String(event?.summary || "").trim().toLowerCase();
  if (summary.includes("fail") || summary.includes("error")) return "failed";
  if (summary.includes("complete") || summary.includes("done")) return "completed";
  if (summary.includes("block")) return "blocked";
  if (summary.includes("queue") || summary.includes("pending")) return "queued";
  return "running";
}

function executorProcessTitle(event, events = [], index = -1) {
  const call = event?.kind === "tool_result" ? executorCall(events, index, event) : null;
  const sourceLabel = displayString(event?.sourceLabel).trim();
  if (sourceLabel) return sourceLabel;
  const command = executorCommand(event);
  if (command) return command;
  const payloadName = displayString(event?.payload?.name).trim();
  if (payloadName) return payloadName;
  const callName = displayString(call?.payload?.name).trim();
  if (callName) return callName;
  return displayString(event?.summary).trim() || displayString(event?.id).trim();
}

function executorProcessDetail(event, events = [], index = -1) {
  const kind = executorProcessKind(event);
  const call = event?.kind === "tool_result" ? executorCall(events, index, event) : null;
  const command = executorCommand(event) || executorCommand(call);
  if (kind === "tool") {
    if (command && command !== executorProcessTitle(event, events, index)) return command;
    const input = displayString(event?.payload?.input);
    if (input.trim()) return clipText(input.replace(/\s+/g, " "), 120);
    const callInput = displayString(call?.payload?.input);
    if (callInput.trim()) return clipText(callInput.replace(/\s+/g, " "), 120);
  }
  const approvalMessage = displayString(event?.payload?.message).trim();
  if (kind === "approval" && approvalMessage) return approvalMessage;
  const summary = displayString(event?.summary).trim();
  if (kind === "input" && summary) return summary;
  return "";
}

function executorProcessNote(event, events = [], index = -1) {
  const summary = displayString(event?.summary).trim();
  if (!summary || genericExecutorSummary(event)) return "";
  const title = executorProcessTitle(event, events, index);
  const detail = executorProcessDetail(event, events, index);
  if (summary === title || summary === detail) return "";
  return summary;
}

function executorProcessProgress(event, events = [], index = -1) {
  const status = executorProcessStatus(event);
  if (event?.kind === "message_delta") return processStatusLabel(status);
  const summary = displayString(event?.summary).trim();
  const title = executorProcessTitle(event, events, index);
  const detail = executorProcessDetail(event, events, index);
  const output = event?.kind === "message_delta" ? "" : executorOutput(event);
  if (
    summary &&
    summary !== title &&
    summary !== detail &&
    summary !== output &&
    (!genericExecutorSummary(event) || event?.kind === "command" || event?.kind === "mcp")
  ) return summary;
  return processStatusLabel(status);
}

function mergeExecutorProcessOutput(current, next, replace = false) {
  if (!next) return current;
  if (!current) return next;
  if (replace && next.startsWith(current)) return next;
  if (current.includes(next)) return current;
  return `${current}\n${next}`.trim();
}

function buildExecutorProcesses(events = Array.isArray(state.executorEvents) ? state.executorEvents : []) {
  const items = new Map();
  events.forEach((event, index) => {
    const id = executorProcessID(event);
    const kind = executorProcessKind(event);
    if (!id || !kind || kind === "assistant" || kind === "status") return;
    const current = items.get(id) || {
      id,
      kind,
      title: executorProcessTitle(event, events, index),
      detail: "",
      progress: executorProcessProgress(event, events, index),
      note: "",
      output: "",
      status: executorProcessStatus(event),
      time: {
        created: event.time?.created || Date.now(),
        updated: event.time?.created || Date.now(),
      },
    };
    current.kind = kind;
    current.title = executorProcessTitle(event, events, index) || current.title;
    const detail = executorProcessDetail(event, events, index);
    if (detail) current.detail = detail;
    const progress = executorProcessProgress(event, events, index);
    if (progress) current.progress = progress;
    const note = executorProcessNote(event, events, index);
    if (note) current.note = note;
    current.status = executorProcessStatus(event) || current.status;
    const output = event.kind === "message_delta" ? executorText(event, events, index) : executorOutput(event);
    if (output) current.output = mergeExecutorProcessOutput(current.output, output, event.kind === "message_delta");
    current.time.updated = event.time?.created || current.time.updated;
    items.set(id, current);
  });
  return [...items.values()].sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0));
}

function executorProcessMessage(processes) {
  if (!Array.isArray(processes) || processes.length === 0) return null;
  return {
    _synthetic: true,
    info: {
      id: `executor:processes:${state.executorRunID || state.selectedTaskID || "active"}`,
      role: "task_tool",
      time: { created: processes[0]?.time?.created || Date.now() },
    },
    parts: processes.map((process) => ({
      type: "executor_process",
      process,
    })),
  };
}

function buildExecutorMessages() {
  if (!state.selectedTaskID) return [];
  const events = Array.isArray(state.executorEvents) ? state.executorEvents : [];
  const processes = buildExecutorProcesses(events);
  const processIDs = new Set(processes.map((item) => item.id));
  const messages = events
    .filter((event) => {
      const id = executorProcessID(event);
      const kind = executorProcessKind(event);
      return !(id && processIDs.has(id) && kind && kind !== "assistant" && kind !== "status");
    })
    .map((event, index) => executorMessage(event, events, index))
    .filter(Boolean);
  const processMessage = executorProcessMessage(processes);
  return processMessage ? [processMessage, ...messages] : messages;
}

function syncExecutorText(event, index = -1) {
  if (!event) return;
  const key = `executor:${event.id || "unknown"}`;
  const target = executorTargetText(event, state.executorEvents, index);
  if (!target) {
    delete event._targetText;
    delete event._liveText;
    stopLiveText(key);
    return;
  }
  event._targetText = target;
  if (event.kind === "reasoning_delta" && target.trim()) {
    touchReasoningPart({
      id: `reasoning:${event.id || index}`,
      type: "reasoning",
      text: target,
      messageID: event.id,
      sessionID: "",
    });
  }
  startLiveText(key, target, typeof event._liveText === "string" ? event._liveText : "", (value) => {
    event._liveText = value;
  });
}

function executorDeltaKind(kind) {
  return kind === "message_delta" || kind === "reasoning_delta";
}

function sameExecutorEventStream(left, right) {
  return (!left?.runID || !right?.runID || left.runID === right.runID) &&
    sameExecutorEventScope(left, right);
}

function mergeExecutorDelta(current, event, events, index) {
  const delta = typeof event.payload?.text === "string" ? event.payload.text : event.summary || "";
  const previous = executorTargetText(current, events, index);
  return {
    ...current,
    summary: previous + delta,
    payload: {
      ...(record(current.payload) ? current.payload : {}),
      ...(record(event.payload) ? event.payload : {}),
      text: previous + delta,
    },
    _targetText: previous + delta,
    _liveText: typeof current._liveText === "string" ? current._liveText : "",
  };
}

function mergeExecutorEventList(events = [], event) {
  const index = typeof event?.id === "string" && event.id
    ? events.findIndex((item) => item.id === event.id)
    : -1;
  if (index >= 0) {
    if (executorDeltaKind(event?.kind)) {
      const next = mergeExecutorDelta(events[index], event, events, index);
      return [
        ...events.slice(0, index),
        next,
        ...events.slice(index + 1),
      ];
    }
    return [
      ...events.slice(0, index),
      {
        ...events[index],
        ...event,
        payload: {
          ...(record(events[index]?.payload) ? events[index].payload : {}),
          ...(record(event?.payload) ? event.payload : {}),
        },
      },
      ...events.slice(index + 1),
    ];
  }
  const sourceIndex = executorDeltaKind(event?.kind) && event?.sourceID
    ? events.findIndex((item) =>
      item.kind === event.kind &&
      item.sourceID === event.sourceID &&
      sameExecutorEventStream(item, event),
    )
    : -1;
  const last = events[events.length - 1];
  if (sourceIndex >= 0) {
    const next = mergeExecutorDelta(events[sourceIndex], event, events, sourceIndex);
    return [
      ...events.slice(0, sourceIndex),
      next,
      ...events.slice(sourceIndex + 1),
    ];
  }
  if (
    executorDeltaKind(event?.kind) &&
    last?.kind === event.kind &&
    !event.sourceID &&
    !last.sourceID &&
    sameExecutorEventStream(last, event)
  ) {
    return [
      ...events.slice(0, -1),
      mergeExecutorDelta(last, event, events, events.length - 1),
    ];
  }
  return [...events, event].sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0));
}

async function loadExecutorEvents(runID = state.board?.task?.activeRunID || "") {
  const next = typeof runID === "string" ? runID : "";
  const activeTask = state.board?.task?.status;
  const activeRun = ["queued", "planning", "running", "blocked", "evaluating", "delivering"].includes(String(activeTask || ""));
  if (!state.selectedTaskID) {
    state.executorEvents = [];
    state.executorRunID = "";
    state.executorEventsFetchedAt = 0;
    return [];
  }
  if (!next) {
    state.executorEvents = [];
    state.executorRunID = "";
    state.executorEventsFetchedAt = 0;
    renderConversation();
    return [];
  }
  if (
    state.executorRunID === next &&
    (!activeRun || Date.now() - state.executorEventsFetchedAt < 3000)
  ) return state.executorEvents;
  try {
    const events = await apiJson(`run/${encodeURIComponent(next)}/executor-events`);
    if (state.selectedTaskID !== state.board?.task?.id) return state.executorEvents;
    if ((state.board?.task?.activeRunID || "") !== next) return state.executorEvents;
    state.executorEvents = (Array.isArray(events) ? events : [])
      .map(executorEventEntry)
      .filter((item) => !!item)
      .reduce((items, item) => mergeExecutorEventList(items, item), []);
    state.executorRunID = next;
    state.executorEventsFetchedAt = Date.now();
    renderConversation();
    return state.executorEvents;
  } catch (e) {
    AppLog.debug("executor", "loadExecutorEvents failed", { runID: next, error: String(e) });
    if ((state.board?.task?.activeRunID || "") !== next) return state.executorEvents;
    state.executorEvents = [];
    state.executorRunID = next;
    state.executorEventsFetchedAt = Date.now();
    renderConversation();
    return [];
  }
}

function appendExecutorEvent(raw) {
  const event = executorEventEntry(raw);
  if (!event) return;
  if (event.runID && state.executorRunID && state.executorRunID !== event.runID) {
    // New run started — discard stale events from the previous run and adopt the new runID.
    state.executorEvents = [];
    state.executorRunID = event.runID;
  }
  if (event.runID && !state.executorRunID) state.executorRunID = event.runID;
  state.executorEvents = mergeExecutorEventList(state.executorEvents, event);
  const target = executorDeltaKind(event.kind) && event.sourceID
    ? state.executorEvents.find((item) =>
      item.kind === event.kind &&
      item.sourceID === event.sourceID &&
      sameExecutorEventStream(item, event),
    ) || event
    : state.executorEvents.find((item) => item.id === event.id) || state.executorEvents[state.executorEvents.length - 1];
  syncExecutorText(target, state.executorEvents.findIndex((item) => item.id === target.id));
  state.executorEventsFetchedAt = Date.now();
  state.conversationUpdatedAt = Date.now();
  renderConversation();
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

function buildBoardContextMessages(preClassifiedMainMessages) {
  const board = state.board;
  if (!board) return [];
  const messages = [];
  const { task, plan, evaluation, delivery, lanes } = board;
  const activeStages = activeAgentStages();
  const liveStages = new Set(
    (Array.isArray(state.agentEvents) ? state.agentEvents : [])
      .map((event) => String(event?.stage || "").trim().toLowerCase())
      .filter((stage) => activeStages.has(stage)),
  );
  // Use pre-classified main messages if provided (avoids re-classifying all messages).
  const transcriptMessages = preClassifiedMainMessages
    || (Array.isArray(state.messages) ? state.messages : []);
  const hasStageMessage = (stage) => transcriptMessages.some((message) =>
    message?.info?.role !== "user" &&
    (
      effectiveRole(message) === stage ||
      phaseFromMessage(message) === phaseFromAgent(stage)
    ),
  );

  // 1. User request — show the original task request as a "user" turn
  if (task?.request && !hasConversationRequest(state.messages || [], task.request)) {
    messages.push({
      _synthetic: true,
      info: { role: "user", time: { created: (task.time?.created || 0) - 2 } },
      parts: [{ type: "text", text: task.request }],
    });
  }

  if (board.spec && !liveStages.has("spec") && !hasStageMessage("spec")) {
    const message = syntheticTextMessage("spec", board.spec.time?.created || task?.time?.updated || Date.now(), specContextText(board.spec));
    if (message) messages.push(message);
  }
  if (plan && !liveStages.has("planner") && !hasStageMessage("planner")) {
    const goals = (lanes || []).find((lane) => lane.id === "goals")?.cards || [];
    const message = syntheticTextMessage("planner", plan.time?.created || task?.time?.updated || Date.now(), planContextText(plan, goals));
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

function normalizeConversationText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function messageConversationText(message) {
  const role = effectiveRole(message);
  return normalizeConversationText((message.parts || [])
    .flatMap((part) => {
      if (part?.type !== "text") return [];
      if (part.audience && part.audience.ui === false) return [];
      if (part.kind === "trace" && !part.audience?.ui) return [];
      const text = typeof part.text === "string" ? part.text : "";
      if (!text.trim()) return [];
      if (["user", "planner", "scheduler", "system"].includes(role) && text.includes("<assistant-brief>")) {
        const cleaned = stripAssistantBrief(text);
        return cleaned ? [cleaned] : [];
      }
      return [text];
    })
    .join("\n"));
}

function hasConversationRequest(messages, request) {
  const target = normalizeConversationText(request);
  if (!target) return false;
  return messages.some((message) => effectiveRole(message) === "user" && messageConversationText(message) === target);
}

function conversationMessages() {
  const allMessages = state.messages || [];

  // Classify messages into main conversation vs agent channels — single pass
  const mainMessages = [];
  const agentChannels = {}; // { [stage]: { messages: [], startTime, endTime } }

  for (const msg of allMessages) {
    const channel = classifyMessage(msg);
    if (channel === "main") {
      mainMessages.push(msg);
    } else {
      if (!agentChannels[channel]) {
        agentChannels[channel] = { messages: [], startTime: Infinity, endTime: 0 };
      }
      agentChannels[channel].messages.push(msg);
      const created = msg.info?.time?.created || 0;
      if (created < agentChannels[channel].startTime) agentChannels[channel].startTime = created;
      const completed = msg.info?.time?.completed || created;
      if (completed > agentChannels[channel].endTime) agentChannels[channel].endTime = completed;
    }
  }

  // Build board context and executor messages AFTER classification
  // so we can pass pre-classified main messages (avoids double classification).
  const boardMsgs = buildBoardContextMessages(mainMessages);
  const executorMsgs = buildExecutorMessages();

  // Filter orchestrator boilerplate from main messages when board context is available
  let filteredMain = mainMessages;
  if (!state.showTranscriptDetails && boardMsgs.length > 0 && filteredMain.length > 0) {
    filteredMain = filteredMain.filter((message) => {
      const text = (message.parts || []).map((part) => part.text || "").join("");
      return !text.includes("<assistant-brief>") && !text.includes("You are executing a headless coding task");
    });
  }

  // Create synthetic agent-card placeholder messages for each active channel
  const agentCardMsgs = [];
  for (const [stage, channel] of Object.entries(agentChannels)) {
    if (channel.messages.length === 0) continue;
    // Determine status from agent events
    const stageEvents = (Array.isArray(state.agentEvents) ? state.agentEvents : [])
      .filter((e) => String(e?.stage || "").toLowerCase() === stage);
    // Check ANY event in the stage for finish/error — fire-and-forget tool status
    // events can land in the protocol store after the finish event (higher sequence),
    // so the chronologically-last event is not necessarily the finish event.
    const isFinished = stageEvents.some((e) => e.kind === "status" && /finished|completed|done/i.test(e?.summary || ""));
    const isError = stageEvents.some((e) => e.kind === "error") && !isFinished;
    const cardStatus = isError ? "error" : isFinished ? "completed" : "running";
    agentCardMsgs.push({
      _synthetic: true,
      _agentCard: true,
      _agentStage: stage,
      _agentStatus: cardStatus,
      _agentMessages: channel.messages,
      info: {
        role: "agent-card",
        agent: stage,
        time: { created: channel.startTime === Infinity ? Date.now() : channel.startTime },
      },
      parts: [],
    });
  }

  return [...filteredMain, ...executorMsgs, ...boardMsgs, ...agentCardMsgs]
    .sort((a, b) => (a.info?.time?.created || 0) - (b.info?.time?.created || 0));
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
  let text = displayString(part.text);
  if (!text.trim()) return "";

  // Replace static "thinking" placeholder with live agent status
  const thinkingTexts = ["……", "...", t("chat.thinking")];
  if (role === "assistant" && thinkingTexts.includes(text.trim()) && state.agentStatus?.summary) {
    const stage = agentStageLabel(state.agentStatus.stage) || state.agentStatus.stage;
    const detail = state.agentStatus.summary;
    return `<div class="msg-text msg-thinking-live"><span class="msg-thinking-dot"></span>${escapeHtml(stage)}${detail ? " — " + escapeHtml(detail) : ""}</div>`;
  }

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
  function unescapeUrl(url) { return url.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'); }
  function safeUrl(url, image = false) {
    const value = unescapeUrl(url).trim();
    if (!value) return null;
    const lower = value.toLowerCase();
    if (lower.startsWith("javascript:") || lower.startsWith("vbscript:")) return null;
    if (lower.startsWith("data:")) return image && lower.startsWith("data:image/") ? value : null;
    if (
      lower.startsWith("https://") ||
      lower.startsWith("http://") ||
      lower.startsWith("mailto:") ||
      value.startsWith("/") ||
      value.startsWith("./") ||
      value.startsWith("../") ||
      value.startsWith("#")
    ) return value;
    return null;
  }
  // Images: ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
    const value = safeUrl(url, true);
    return value ? `<img class="md-img" src="${value}" alt="${alt}" loading="lazy">` : alt;
  });
  // Links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const value = safeUrl(url);
    return value ? `<a class="md-link" href="${value}" target="_blank" rel="noopener">${label}</a>` : label;
  });
  // Bold: **text**
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic: *text*
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  // Inline code: `code`
  s = s.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
  return s;
}


function toolIcon(name) {
  const n = toolNameKey(name);
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
  if (n === "read" || n === "readfile") return shortRelativePath(input.file_path || input.filePath || input.path || "");
  if (n === "edit" || n === "editfile") return shortRelativePath(input.file_path || input.filePath || input.path || "");
  if (n === "write" || n === "writefile") return shortRelativePath(input.file_path || input.filePath || input.path || "");
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

function shortRelativePath(p) {
  if (!p) return "";
  const rel = relativePathFrom(activeDirectory(), p);
  return rel || shortPath(p);
}

function renderReasoningPart(part) {
  const text = displayString(part.text);
  if (!text.trim()) return "";
  if (reasoningPartHidden(part)) return "";
  return `<div class="msg-reasoning">
    <div class="reasoning-label">${escapeHtml(t("transcript.reasoning"))}</div>
    <div class="reasoning-text">${escapeHtml(text)}</div>
  </div>`;
}

function renderPatchPart(part) {
  const files = part.files || [];
  if (files.length === 0) return "";
  const display = files.map((f) => shortRelativePath(f)).join(", ");
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

// Debounced render for agent-channel updates — avoids re-rendering on every token
let _debouncedRenderTimer = null;
function debouncedRenderConversation() {
  if (_debouncedRenderTimer) return;
  _debouncedRenderTimer = setTimeout(() => {
    _debouncedRenderTimer = null;
    renderConversation();
  }, CONVERSATION_EVENT_DEBOUNCE);
}

function renderConversation() {
  const sorted = conversationMessages();
  if (sorted.length === 0) {
    dom.chatScroll.innerHTML = `<div class="chat-empty">${escapeHtml(t("chat.empty"))}</div>`;
    dom.chatCount.textContent = "";
    state._renderedGroupKey = "";
    syncSectionPhases();
    return;
  }

  const groups = groupMessagesByRole(sorted);
  const sigs = groups.map(signGroup);
  dom.chatCount.textContent = tc("chat.count", sorted.length, { count: sorted.length });

  const el = dom.chatScroll;
  const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  const target = conversationTarget();
  const targetKey = conversationTargetKey(target);
  const sessionChanged = state._renderedGroupKey !== targetKey;
  const nextNodes = groups.map((group, index) => renderTurn(group, sigs[index]));

  if (sessionChanged) {
    const frag = document.createDocumentFragment();
    for (const node of nextNodes) {
      if (node) frag.appendChild(node);
    }
    el.innerHTML = "";
    el.appendChild(frag);
  } else {
    const turns = [...el.querySelectorAll(".turn")];
    const limit = Math.min(turns.length, groups.length);
    for (let index = 0; index < limit; index += 1) {
      if (turns[index]?.dataset.groupSig === sigs[index]) continue;
      const node = nextNodes[index];
      if (node) turns[index].replaceWith(node);
    }
    if (turns.length > groups.length) {
      turns.slice(groups.length).forEach((node) => node.remove());
    }
    for (let index = turns.length; index < groups.length; index += 1) {
      const node = nextNodes[index];
      if (node) el.appendChild(node);
    }
  }

  state._renderedGroupKey = targetKey;
  syncSectionPhases();
  if (wasAtBottom && !chatScrollPaused) {
    requestAnimationFrame(() => {
      if (!chatScrollPaused) el.scrollTop = el.scrollHeight;
    });
  }
}

async function copyChatConversation() {
  try {
    const transcript = formatConversationTranscript(conversationMessages());
    if (!transcript) return;
    const ok = await copyText(transcript);
    if (!ok) throw new Error(t("chat.copy_failed"));
  } catch (e) {
    AppLog.error("ui", "Failed to copy chat conversation", { error: String(e) });
    await nativeMessage(errorText("chat.copy_failed", e), {
      title: t("chat.copy_title"),
      kind: "error",
    });
  }
}

function renderTurn(group, sig = "") {
  const { role, messages } = group;

  // Agent card: collapsible card for an agent stage's messages
  if (role === "agent-card") {
    return renderAgentCard(messages[0], sig);
  }

  let bodyHtml = "";
  for (const message of messages) {
    for (const part of orderedMessageParts(message)) {
      bodyHtml += renderPart(part, role);
    }
  }
  if (!bodyHtml.trim()) {
    const firstKind = messages[0]?.info?.kind;
    if (role === "assistant" && (firstKind === "task" || firstKind === "created")) {
      bodyHtml = `<div class="msg-text">${escapeHtml(t("chat.task_navigated"))}</div>`;
    } else {
      return null;
    }
  }

  const el = document.createElement("article");
  el.className = "turn msg";
  el.dataset.role = role;
  el.dataset.groupSig = sig;
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

/** Render a collapsible agent card that contains all messages for one agent stage.
 *  Body is rendered lazily — only built on first expand to avoid DOM cost for collapsed cards. */
function renderAgentCard(cardMsg, sig = "") {
  const stage = cardMsg._agentStage || "agent";
  const status = cardMsg._agentStatus || "running";
  const agentMessages = cardMsg._agentMessages || [];
  const label = agentStageLabel(stage);
  const timeStr = cardMsg.info?.time?.created ? stamp(cardMsg.info.time.created) : "";
  const msgCount = agentMessages.length;

  // Preserve expanded state from previous render
  const prevCard = dom.chatScroll?.querySelector(`.agent-card[data-stage="${stage}"]`);
  const wasExpanded = prevCard?.classList.contains("agent-card--expanded") || false;

  // Status badge
  const statusBadge = status === "completed"
    ? `<span class="agent-card-badge agent-card-badge--done" title="Completed">&#10003;</span>`
    : status === "error"
      ? `<span class="agent-card-badge agent-card-badge--error" title="Error">&#10007;</span>`
      : `<span class="agent-card-badge agent-card-badge--running" title="Running"><span class="agent-card-spinner"></span></span>`;

  const el = document.createElement("article");
  el.className = `turn msg agent-card${wasExpanded ? " agent-card--expanded" : ""}`;
  el.dataset.role = "agent-card";
  el.dataset.stage = stage;
  el.dataset.groupSig = sig;

  // Lazy rendering: only build body HTML when expanded.
  // For collapsed cards, start with an empty body placeholder.
  let bodyRendered = wasExpanded;
  let bodyHtml = "";
  if (wasExpanded) {
    bodyHtml = renderAgentCardBody(agentMessages);
  }

  el.innerHTML = `
    <div class="agent-card-header" role="button" tabindex="0" aria-expanded="${wasExpanded}">
      ${statusBadge}
      <span class="agent-card-label">${escapeHtml(label)}</span>
      <span class="agent-card-count">${msgCount > 0 ? `(${msgCount})` : ""}</span>
      <span class="agent-card-time">${escapeHtml(timeStr)}</span>
      <span class="agent-card-chevron" aria-hidden="true">&#9660;</span>
    </div>
    <div class="agent-card-body"${wasExpanded ? "" : " hidden"}>
      <div class="msg-body">${bodyHtml}</div>
    </div>
  `;

  // Toggle collapse on header click
  const header = el.querySelector(".agent-card-header");
  const body = el.querySelector(".agent-card-body");
  if (header && body) {
    const toggle = () => {
      const expanded = body.hidden === false;
      body.hidden = !body.hidden;
      header.setAttribute("aria-expanded", String(!expanded));
      el.classList.toggle("agent-card--expanded", !expanded);
      // Lazy render: build body content on first expand
      if (!expanded && !bodyRendered) {
        bodyRendered = true;
        const inner = body.querySelector(".msg-body");
        if (inner) inner.innerHTML = renderAgentCardBody(agentMessages);
      }
    };
    header.addEventListener("click", toggle);
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  }

  return el;
}

/** Build the inner HTML for an agent card's body. */
function renderAgentCardBody(agentMessages) {
  let html = "";
  for (const msg of agentMessages) {
    const innerRole = msg.info?.role || "assistant";
    for (const part of orderedMessageParts(msg)) {
      html += renderPart(part, innerRole);
    }
  }
  return html;
}

function renderPart(part, role) {
  switch (part.type) {
    case "text":
      return renderTextPart(part, role);
    case "executor_process":
      return renderExecutorProcessPart(part);
    case "tool":
      return renderToolPart(part);
    case "reasoning":
      return renderReasoningPart(part);
    case "patch":
      return renderPatchPart(part);
    case "step-start":
    case "step-finish":
      if (!state.showTranscriptDetails) return "";
      return `<div class="msg-step">${escapeHtml(part.type)} ${escapeHtml(part.name || "")}</div>`;
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

function executorProcessKindTag(kind) {
  if (kind === "command") return "CMD";
  if (kind === "approval") return "ASK";
  if (kind === "input") return "IN";
  if (kind === "mcp") return "MCP";
  if (kind === "error") return "ERR";
  return "TOOL";
}

function renderExecutorProcessPart(part) {
  const process = record(part?.process) ? part.process : {};
  const kind = String(process.kind || "tool");
  const status = String(process.status || "running");
  const live = status === "running" || status === "queued";
  const title = String(process.title || process.id || "").trim();
  if (!title) return "";
  const detail = String(process.detail || "").trim();
  const progress = String(process.progress || processStatusLabel(status) || "").trim();
  const note = String(process.note || "").trim();
  const output = stripAnsi(String(process.output || "")).trim();
  return `
    <section class="executor-process-card" data-kind="${escapeHtml(kind)}" data-status="${escapeHtml(status)}" data-live="${live ? "true" : "false"}">
      <div class="executor-process-head">
        <span class="executor-process-kind">${escapeHtml(executorProcessKindTag(kind))}</span>
        <div class="executor-process-meta">
          <div class="executor-process-row">
            <span class="executor-process-title">${escapeHtml(title)}</span>
            <span class="executor-process-status" data-status="${escapeHtml(status)}">${escapeHtml(processStatusLabel(status))}</span>
          </div>
          ${detail ? `<div class="executor-process-detail">${escapeHtml(detail)}</div>` : ""}
        </div>
      </div>
      <div class="executor-process-bar" aria-hidden="true"><span class="executor-process-bar-fill"></span></div>
      ${progress ? `<div class="executor-process-progress">${live ? '<span class="executor-process-activity" aria-hidden="true"></span>' : ""}${escapeHtml(progress)}</div>` : ""}
      ${note && note !== progress ? `<div class="executor-process-note">${escapeHtml(note)}</div>` : ""}
      ${output ? `<pre class="executor-process-output">${escapeHtml(output)}</pre>` : ""}
    </section>
  `;
}

function renderToolPart(part) {
  const toolName = part.tool || "unknown";
  const st = part.state || {};
  const status = st.status || "pending";
  const input = st.input || {};
  const hiddenTools = ["planner", "structuredoutput", "todowrite", "todoupdate", "task_report"];
  if (!state.showTranscriptDetails && hiddenTools.includes(toolName.toLowerCase())) return "";

  const rawDetail = displayToolDetail(toolName, input, st);
  // Suppress detail when it duplicates the tool name (e.g. "memory_search memory_search")
  const detail = rawDetail && rawDetail.toLowerCase() !== toolName.toLowerCase() ? rawDetail : "";
  const icon = displayToolIcon(toolName);
  const statusText = toolStatusLabel(status);

  let html = `<div class="msg-tool">
    <span class="tool-icon">${icon}</span>
    <span class="tool-name">${escapeHtml(toolName)}</span>
    ${detail ? `<span class="tool-detail">${escapeHtml(detail)}</span>` : ""}
    <span class="tool-status" data-status="${status}" title="${escapeHtml(statusText)}">${escapeHtml(statusText)}</span>
  </div>`;

  // Show streaming tool input (partial JSON being generated by the LLM)
  const raw = typeof st.raw === "string" ? (typeof part._targetRaw === "string" ? part._targetRaw : st.raw) : "";
  if (status === "pending" && raw) {
    html += `<div class="msg-tool-input">${escapeHtml(raw)}</div>`;
  }

  const output = stripAnsi(st.output || "");
  const error = stripAnsi(st.error || "") || output;
  if (output && status === "completed") {
    const lineCount = output.split("\n").length;
    const summary = lineCount > 6 ? ` title="${lineCount} lines — click to expand"` : "";
    html += `<div class="msg-tool-output"${summary} onclick="this.classList.toggle('msg-tool-output--expanded')">${escapeHtml(output)}</div>`;
  }
  if (status === "error" && error) {
    html += `<div class="msg-tool-error">${escapeHtml(error)}</div>`;
  }
  return html;
}

function renderClear() {
  renderMeta();
  setTaskStatus("idle", { visible: false });
  clearSectionPhases();
  state.messages = [];
  state.conversationUpdatedAt = 0;
  state.budgetDirty = false;
  state.budgetSaving = false;
  if (dom.taskActionsBar) { dom.taskActionsBar.hidden = true; dom.taskActionsBar.innerHTML = ""; }
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
  setBudgetInputs(undefined);
  renderBudgetState(null);
  if (dom.evalBody) dom.evalBody.innerHTML = `<p class="empty-hint">${escapeHtml(t("detail.no_evaluation"))}</p>`;
  dom.chatScroll.innerHTML = `<div class="chat-empty">${escapeHtml(t("chat.empty"))}</div>`;
  dom.chatCount.textContent = "";
  dom.elapsed.textContent = "";
  state._renderedGroupKey = "";
  renderChatComposer();
  renderExecutor();
}

async function ensureTaskSelection() {
  if (hasWorkspaceSelection()) return false;
  const taskID = state.tasks[0]?.task?.id || "";
  if (!taskID) return false;
  await selectTask(taskID);
  return true;
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
  if (state.chatRequest) return;
  if (!canComposeChat()) return;
  const text = chatInputText();
  if (!text) return;
  const metadata = takeChatMetadata();

  const emptyStart = workspaceMode() === "empty";
  const requestID = crypto.randomUUID();
  const request = {
    controller: new AbortController(),
    target: chatAbortTarget(),
    aborted: false,
    completed: false,
    manualAbort: false,
    recoveredTaskID: "",
    recovery: null,
    stopping: false,
    requestID,
    timedOut: false,
    workspaceEpoch: state.workspaceEpoch,
  };
  const timeout = setTimeout(() => {
    request.aborted = true;
    request.timedOut = true;
    request.controller.abort(new DOMException("Timed out", "AbortError"));
  }, chatRequestTimeoutMs());
  state.chatRequest = request;
  if (emptyStart) {
    rememberPendingTask(requestID, text);
    request.recovery = startTaskRecovery(request);
  }
  const sentAttachments = [...state.chatAttachments];
  dom.chatTextarea.value = "";
  clearChatAttachments();
  sizeChat();
  renderChatComposer();

  const now = Date.now();
  const userParts = [{ type: "text", text }];
  for (const att of sentAttachments) {
    if (att.mime.startsWith("image/")) userParts.push({ type: "image", url: att.url, filename: att.filename });
    else userParts.push({ type: "file", mime: att.mime, url: att.url, filename: att.filename });
  }
  state.messages = [
    ...state.messages,
    { parts: userParts, info: { role: "user", time: { created: now } } },
    { parts: [{ type: "text", text: "……" }], info: { role: "assistant", time: { created: now + 1 } } },
  ];
  renderConversation();

  try {
    await panelMessage(text, metadata, request.controller.signal, {
      requestID,
      workspaceEpoch: request.workspaceEpoch,
    });
    request.completed = true;
  } catch (err) {
    if (request.workspaceEpoch !== state.workspaceEpoch) {
      return;
    }
    if (request.aborted || isAbortError(err)) {
      const ph = chatPlaceholder();
      if (request.timedOut && request.recovery?.active && !request.manualAbort && !request.recoveredTaskID) {
        if (ph) ph.parts[0].text = t("chat.thinking");
      } else if (ph) {
        ph.parts[0].text = t("chat.interrupted_notice");
      }
      if (!request.timedOut || request.manualAbort || request.recoveredTaskID) {
        forgetPendingTask(requestID);
      }
      renderConversation();
      return;
    }
    if (emptyStart && workspaceMode() === "empty") {
      forgetPendingTask(requestID);
      enterEmptyWorkspace();
      renderClear();
      return;
    }
    const ph = state.messages.find((item) => item.info?.role === "assistant" && item.parts?.[0]?.text === "……");
    const msg = t("interaction.error", { message: err?.message || err });
    if (ph) ph.parts[0].text = msg;
    else state.messages.push({ parts: [{ type: "text", text: msg }], info: { role: "assistant", time: { created: Date.now() } } });
    forgetPendingTask(requestID);
    renderConversation();
  } finally {
    clearTimeout(timeout);
    const keepRecovery =
      request.recovery &&
      !request.manualAbort &&
      !request.recoveredTaskID &&
      state.pendingTasks.some((item) => item?.requestID === requestID);
    if (request.recovery && !keepRecovery && (request.completed || request.manualAbort || request.recoveredTaskID || !request.timedOut)) {
      request.recovery.stop();
    }
    if (state.chatRequest === request) {
      state.chatRequest = null;
    }
    renderChatComposer();
  }
});

// ── File Attachments ──

dom.btnChatAttach?.addEventListener("click", async () => {
  if (hasTauriRuntime()) {
    try {
      const files = await pickFiles(activeDirectory());
      for (const f of files) {
        state.chatAttachments.push({ mime: f.mime, url: f.url, filename: f.filename });
      }
      if (files.length) renderChatAttachments();
    } catch (e) {
      console.error("[attach] pickFiles failed:", e);
      dom.chatFileInput?.click();
    }
  } else {
    dom.chatFileInput?.click();
  }
});

dom.chatFileInput?.addEventListener("change", async () => {
  const files = dom.chatFileInput?.files;
  if (!files) return;
  for (const file of files) await addChatAttachment(file);
  dom.chatFileInput.value = "";
});

dom.chatAttachments?.addEventListener("click", (e) => {
  const btn = e.target?.closest?.("[data-remove-attachment]");
  if (!btn) return;
  const index = parseInt(btn.dataset.removeAttachment, 10);
  if (!isNaN(index)) removeChatAttachment(index);
});

dom.chatForm?.addEventListener("dragover", (e) => {
  e.preventDefault();
  dom.chatForm.dataset.dragover = "true";
});

dom.chatForm?.addEventListener("dragleave", (e) => {
  if (!dom.chatForm.contains(e.relatedTarget)) delete dom.chatForm.dataset.dragover;
});

dom.chatForm?.addEventListener("drop", async (e) => {
  e.preventDefault();
  delete dom.chatForm.dataset.dragover;
  const files = e.dataTransfer?.files;
  if (!files) return;
  for (const file of files) await addChatAttachment(file);
});

dom.chatTextarea?.addEventListener("paste", async (e) => {
  const files = e.clipboardData?.files;
  if (!files || !files.length) return;
  e.preventDefault();
  for (const file of files) await addChatAttachment(file);
});

// Enter to send, Shift+Enter for newline
dom.chatTextarea.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  if (state.chatRequest) return;
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!canComposeChat()) return;
    dom.chatForm.requestSubmit();
  }
});

dom.chatTextarea.addEventListener("input", () => {
  sizeChat();
  renderChatComposer();
});
dom.chatSend.addEventListener("click", async (e) => {
  if (!state.chatRequest) return;
  e.preventDefault();
  await stopChatRequest();
});
dom.btnChatCopyAll?.addEventListener("click", () => copyChatConversation());

dom.chatScroll?.addEventListener("scroll", () => {
  const el = dom.chatScroll;
  chatScrollPaused = el.scrollHeight - el.scrollTop - el.clientHeight >= 80;
}, { passive: true });

// Terminate button: cancel the current task and all its runs/sessions
dom.btnTerminateRun?.addEventListener("click", async () => {
  if (!state.selectedTaskID) return;
  const ok = await nativeConfirm(t("task.terminate_confirm"), {
    title: t("task.terminate_title"),
    okLabel: t("task.terminate"),
    kind: "warning",
  });
  if (!ok) return;
  dom.btnTerminateRun.disabled = true;
  try {
    const targets = chatAbortTargets();
    for (const target of targets) {
      try {
        await abortChatTarget(target);
        break; // first successful abort is enough
      } catch (e) {
        AppLog.warn("ui", "terminate target failed", { target, error: String(e) });
      }
    }
    scheduleTasks(0);
    scheduleBoard(0);
  } catch (e) {
    AppLog.error("ui", "terminate failed", { error: String(e) });
  } finally {
    dom.btnTerminateRun.disabled = false;
  }
});
sizeChat();
renderChatComposer();

// ── Connection Badge: double-click to restart core ──

dom.connBadge.addEventListener("dblclick", async () => {
  dom.connBadge.textContent = t("titlebar.connection.restarting");
  dom.connBadge.dataset.status = "connecting";
  try {
    const restarted = usesManagedLocalServer() ? await restartLocalServer() : null;
    if (!restarted) {
      await apiFetch("restart", { method: "POST", signal: AbortSignal.timeout(3000) });
    }
  } catch (restartErr) {
    AppLog.warn("ui", "restart request failed", { error: String(restartErr) });
  }
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

dom.taskListPanel?.addEventListener("click", async (event) => {
  const remove = eventClosest(event, "[data-task-delete]");
  if (remove) {
    event.preventDefault();
    event.stopPropagation();
    await deleteTask(remove.dataset.taskDelete || "");
    return;
  }
  const button = eventClosest(event, "[data-task-id]");
  if (!button) return;
  const taskId = button.dataset.taskId || "";
  console.log("[task-click] selecting task:", taskId);
  // Clicking a task → switch to task tab if on coding
  if (coding.active) switchTab("control");
  try {
    await selectTask(taskId);
    console.log("[task-click] selectTask done, selectedTaskID=", state.selectedTaskID);
  } catch (e) {
    console.error("[task-click] selectTask failed:", e);
    AppLog.error("ui", "Failed to select task", { taskId, error: String(e) });
  }
});

dom.taskDir?.addEventListener("click", async (event) => {
  const button = eventClosest(event, "[data-path-action],[data-path-open],[data-path-set]");
  if (!button || button.matches(":disabled")) return;
  const action = button.dataset.pathAction || "";
  if (action === "recent") {
    console.log("[recent] click handler fired");
    event.stopPropagation();
    openRecentDirPanel();
    return;
  }
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

dom.recentDirPanel?.addEventListener("click", async (event) => {
  const item = eventClosest(event, "[data-recent-dir]");
  console.log("[recent] panel click, item=", item, "target=", event.target);
  if (!item) return;
  const dir = item.dataset.recentDir;
  console.log("[recent] selected dir=", dir, "current=", state.directory);
  if (!dir) return;
  closeRecentDirPanel();
  try {
    await setDirectory(dir);
    console.log("[recent] setDirectory done, state.directory=", state.directory);
  } catch (e) {
    console.error("[recent] setDirectory failed:", e);
    removeRecentDirectory(dir);
    AppLog.error("ui", "Failed to switch to recent directory", { error: String(e) });
    await nativeMessage(errorText("cwd.set_failed", e), {
      title: t("cwd.title"),
      kind: "error",
    });
  }
});

document.addEventListener("click", (e) => {
  if (e.target?.closest?.('[data-path-action="recent"]') || e.target?.closest?.(".recent-dir-panel")) return;
  closeRecentDirPanel();
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
    await loadBoard({ sync: true });
  } catch (e) {
    AppLog.error("ui", "Failed to update task checks", { error: String(e) });
  }
});

dom.budgetConfigBody?.addEventListener("input", () => {
  state.budgetDirty = true;
  renderBudgetState(state.board?.task);
});

dom.btnBudgetReset?.addEventListener("click", () => {
  state.budgetDirty = false;
  setBudgetInputs(taskBudget());
  renderBudgetState(state.board?.task);
});

dom.btnBudgetSave?.addEventListener("click", async () => {
  if (!state.selectedTaskID || state.budgetSaving) return;
  state.budgetSaving = true;
  renderBudgetState(state.board?.task);
  try {
    await apiJson(`task/${encodeURIComponent(state.selectedTaskID)}/budget`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        budget: draftBudget() || null,
      }),
    });
    state.budgetDirty = false;
    await loadBoard({ sync: true });
  } catch (e) {
    AppLog.error("ui", "Failed to update task budget", { error: String(e) });
    await nativeMessage(errorText("budget.save_failed", e), {
      title: t("section.budget"),
      kind: "error",
    });
  } finally {
    state.budgetSaving = false;
    renderBudgetState(state.board?.task);
  }
});

// Delegate to changesSection (parent) because renderChanges() replaces changesBody via cloneNode.
dom.changesSection?.addEventListener("click", (e) => {
  const target = eventClosest(e, "[data-change-index]");
  if (!target) return;
  openDiffDialog(Number(target.dataset.changeIndex));
});

dom.engineBar.addEventListener("click", async (event) => {
  // Skip if clicking on model caret, model panel items, or within model panels
  if (eventClosest(event, "[data-executor-caret]") || eventClosest(event, "[data-executor-model]") || eventClosest(event, ".engine-model-panel")) return;
  const button = eventClosest(event, "[data-executor]");
  if (!button || button.disabled) return;
  const executor = button.dataset.executor || "opencode";
  state.executor = executor;
  renderExecutor();
  await persistOverlaySettings();
});

dom.btnRefreshTasks.addEventListener("click", async () => {
  await Promise.all([
    loadTasks(),
    loadMeta(),
    loadPreferences(),
    state.selectedTaskID ? loadBoard({ sync: true }) : Promise.resolve(),
    state.selectedTaskID ? loadConversation() : Promise.resolve(),
    state.selectedTaskID ? loadMemory() : Promise.resolve(),
  ]);
  if (!state.selectedTaskID) {
    state.memoryFiles = [];
    state.memorySearchMode = false;
    renderMemory();
  }
});
dom.btnCreateTask.addEventListener("click", async () => {
  await selectTask("");
  dom.chatTextarea?.focus();
});

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

if (dom.btnCreateGoal) {
  dom.btnCreateGoal.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openGoalDialog();
  });
}

if (dom.taskActionsBar) {
  dom.taskActionsBar.addEventListener("click", async (e) => {
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
    await loadBoard({ sync: true });
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
  dom.settingsDialog.showModal();
}

function switchConfigTab(tabName) {
  const sidebar = document.getElementById("configSidebar");
  const content = document.getElementById("configContent");
  if (!sidebar || !content) return;
  for (const btn of sidebar.querySelectorAll(".config-nav-item")) {
    btn.classList.toggle("active", btn.dataset.configTab === tabName);
  }
  for (const panel of content.querySelectorAll(".config-tab-panel")) {
    panel.classList.toggle("active", panel.dataset.configPanel === tabName);
  }
}

function focusConfigSection(name) {
  if (!name) return;
  switchConfigTab(name);
  if (name === "channel") dom.channelList?.scrollTo?.({ top: 0 });
}

function openConfigDialog(section) {
  if (!dom.configDialog) return;
  if (!dom.configDialog.open) {
    dom.configDialog.showModal();
  }
  renderAboutVersion();
  if (section) {
    focusConfigSection(section);
  }
}

document.getElementById("configSidebar")?.addEventListener("click", (event) => {
  const btn = event.target.closest(".config-nav-item");
  if (!btn?.dataset.configTab) return;
  switchConfigTab(btn.dataset.configTab);
});

dom.btnTheme?.addEventListener("click", async () => {
  state.theme = resolvedTheme() === "light" ? "dark" : "light";
  renderTheme();
  await persistOverlaySettings();
  closeTitlebarMenu();
});

dom.btnLocale?.addEventListener("click", async () => {
  await setLocale(state.locale === "zh-CN" ? "en-US" : "zh-CN");
  closeTitlebarMenu();
});

dom.btnSettings?.addEventListener("click", () => {
  openServerSettings();
  closeTitlebarMenu();
});

dom.btnTitlebarMenu?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  setTitlebarMenu(dom.titlebarMenu?.hidden);
});

document.addEventListener("pointerdown", (event) => {
  if (!dom.titlebarMenu || dom.titlebarMenu.hidden) return;
  if (!(event.target instanceof Element)) {
    closeTitlebarMenu();
    return;
  }
  if (event.target.closest("#titlebarMenu, #btnTitlebarMenu")) return;
  closeTitlebarMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeTitlebarMenu();
});

dom.chkAutoPermission?.addEventListener("change", async () => {
  state.autoPermission = dom.chkAutoPermission.checked;
  renderTitlebarMenu();
  await persistOverlaySettings();
  closeTitlebarMenu();
  if (state.autoPermission) void loadBoard({ sync: true });
});

dom.chkUnattended?.addEventListener("change", async () => {
  state.unattended = dom.chkUnattended.checked;
  renderTitlebarMenu();
  await persistOverlaySettings();
  await syncUnattendedConfig(true);
  closeTitlebarMenu();
  if (state.unattended) void loadBoard({ sync: true });
});

dom.chkAutoQuestion?.addEventListener("change", async () => {
  state.autoQuestion = dom.chkAutoQuestion.checked;
  renderTitlebarMenu();
  await persistOverlaySettings();
  closeTitlebarMenu();
  if (state.autoQuestion) void loadBoard({ sync: true });
});

dom.chkShowTranscriptDetails?.addEventListener("change", async () => {
  state.showTranscriptDetails = dom.chkShowTranscriptDetails.checked;
  renderTitlebarMenu();
  await persistOverlaySettings();
  closeTitlebarMenu();
  renderConversation();
});

dom.opacityRange?.addEventListener("input", () => {
  state.opacity = sanitizeOpacity(Number(dom.opacityRange.value) / 100);
  void applyWindowOpacity();
});

dom.opacityRange?.addEventListener("change", async () => {
  state.opacity = sanitizeOpacity(Number(dom.opacityRange.value) / 100);
  await applyWindowOpacity();
  await persistOverlaySettings();
  closeTitlebarMenu();
});

dom.btnConfigToggle?.addEventListener("click", () => {
  openConfigDialog();
});

dom.btnCloseConfigDialog?.addEventListener("click", () => {
  dom.configDialog?.close();
});

// ── Config sidebar resizer ──
{
  const configResizer = document.getElementById("configResizer");
  const configSidebar = document.getElementById("configSidebar");
  let configDrag = null;

  function resizeConfigSidebar(clientX) {
    if (!configSidebar) return;
    const layout = configSidebar.parentElement;
    if (!layout) return;
    const rect = layout.getBoundingClientRect();
    const scale = currentUIScale();
    const min = 140 * scale;
    const max = 320 * scale;
    const next = Math.round(clampNumber(clientX - rect.left, min, max));
    configSidebar.style.width = next + "px";
    configSidebar.style.minWidth = next + "px";
  }

  configResizer?.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    configDrag = true;
    configResizer.dataset.active = "true";
    document.body.dataset.resizing = "true";
    e.preventDefault();

    function onMove(ev) { resizeConfigSidebar(ev.clientX); }
    function onUp() {
      configDrag = null;
      delete configResizer.dataset.active;
      delete document.body.dataset.resizing;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
}

// ── About panel runtime info ──
function renderAboutVersion() {
  const grid = document.getElementById("aboutRuntimeGrid");
  if (!grid) return;
  const rows = [
    [t("about.rt_overlay"), "v" + OVERLAY_VERSION],
    [t("about.rt_core"), state.coreVersion || t("about.rt_unavailable")],
    [t("about.rt_server"), state.serverUrl || "-"],
    [t("about.rt_connection"), state.connected ? t("about.rt_connected") : t("about.rt_disconnected")],
    [t("about.rt_directory"), activeDirectory() || "-"],
    [t("about.rt_executor"), state.executor || "-"],
    [t("about.rt_tasks"), String(state.tasks?.length || 0)],
  ];
  grid.innerHTML = rows.map(([label, value]) =>
    `<span class="about-info-label">${escapeHtml(label)}</span><span class="about-info-value">${escapeHtml(value)}</span>`
  ).join("");
}

// Delegate to promptSection (parent) because renderPrompts() replaces promptBody via cloneNode.
dom.promptSection?.addEventListener("input", (event) => {
  const field = eventClosest(event, "[data-prompt-input]");
  if (!(field instanceof HTMLTextAreaElement)) return;
  const entryID = field.dataset.promptInput || "";
  if (!entryID) return;
  state.promptDrafts[entryID] = field.value;
  const preview = dom.promptBody?.querySelector(`[data-prompt-preview="${CSS.escape(entryID)}"]`);
  if (preview) preview.innerHTML = renderPromptPreview(field.value);
  const entry = promptEntry(entryID);
  const save = dom.promptBody?.querySelector(`[data-prompt-save="${CSS.escape(entryID)}"]`);
  const reset = dom.promptBody?.querySelector(`[data-prompt-reset="${CSS.escape(entryID)}"]`);
  const dirty = entry ? promptDirty(entry) : false;
  if (save instanceof HTMLButtonElement) save.disabled = !dirty;
  if (reset instanceof HTMLButtonElement && entry) reset.disabled = entry.configured_prompt === null && !dirty;
});

dom.promptSection?.addEventListener("click", (event) => {
  const save = eventClosest(event, "[data-prompt-save]");
  if (save) {
    void savePromptEntry(save.dataset.promptSave);
    return;
  }
  const reset = eventClosest(event, "[data-prompt-reset]");
  if (reset) {
    void resetPromptEntry(reset.dataset.promptReset);
  }
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
  delete state.providerAuthDismissed[dom.llmProvider.value];
  populateModelSelect(state.config, state.providerCatalog, false);
  renderLlmSummary();
  queueLlmSync(180);
});

dom.llmModel?.addEventListener("change", () => {
  renderLlmSummary();
  queueLlmSync(180);
});

// Executor model caret buttons
dom.engineBar?.addEventListener("click", async (event) => {
  const caret = eventClosest(event, "[data-executor-caret]");
  if (caret) {
    event.stopPropagation();
    const executorID = caret.dataset.executorCaret;
    const panel = executorModelPanel(executorID);
    if (!panel) return;
    if (panel.hidden) {
      openExecutorModelPanel(executorID);
    } else {
      closeAllExecutorModelPanels();
    }
    return;
  }
  const modelItem = eventClosest(event, "[data-executor-model]");
  if (modelItem) {
    event.stopPropagation();
    const model = modelItem.dataset.executorModel;
    const panel = modelItem.closest(".engine-model-panel");
    const wrap = panel?.closest("[data-executor-wrap]");
    const executorID = wrap?.dataset.executorWrap;
    if (executorID && model) {
      closeAllExecutorModelPanels();
      await setExecutorModel(executorID, model);
    }
    return;
  }
});

document.addEventListener("click", (e) => {
  if (e.target?.closest?.("[data-executor-caret]") || e.target?.closest?.(".engine-model-panel")) return;
  closeAllExecutorModelPanels();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeAllExecutorModelPanels();
    closeRecentDirPanel();
  }
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

dom.btnLlmAuthAction?.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopPropagation();
  try {
    const authenticated = await authenticateSelectedProvider();
    if (authenticated !== true) return;
    await loadConfigInfo();
    llmSavedValue = "";
    queueLlmSync(0);
  } catch (e) {
    AppLog.error("ui", "Provider auth failed", { error: String(e) });
    await nativeMessage(String(e instanceof Error ? e.message : e), {
      title: t("llm.title"),
      kind: "error",
    });
  }
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
      await Promise.all([loadTasks(), loadMeta(), loadExtensions(), loadConfigInfo(), loadExecutors()]);
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
  const serverUrl = fd.get("serverUrl")?.toString().trim() || DEFAULT_SERVER;
  state.autoServer = resolveAutoServer(serverUrl, {
    serverUrl: state.serverUrl,
    autoServer: state.autoServer,
  });
  state.serverUrl = serverUrl;
  state.password = fd.get("password")?.toString() || "";
  state.username = fd.get("username")?.toString().trim() || "opencorvus";
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
  const focusWindow = () => win.setFocus?.().catch(() => undefined);

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    void focusWindow();
  }, true);

  dom.titlebar?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('[data-no-drag="true"], button, input, textarea, select, a, label, summary, [contenteditable="true"]')) {
      return;
    }
    event.preventDefault();
    void focusWindow();
    win.startDragging?.().catch(() => undefined);
  });

  dom.btnMinimize?.addEventListener("click", () => win.minimize());
  const syncMaximize = async () => {
    if (!dom.btnMaximize) return false;
    const maximized = await win.isMaximized?.().catch(() => false);
    const label = maximizeLabel(maximized);
    dom.btnMaximize.dataset.maximized = String(maximized);
    dom.btnMaximize.title = label;
    dom.btnMaximize.setAttribute("aria-label", label);
    dom.btnMaximize.innerHTML = maximizeIcon(maximized);
    return maximized;
  };
  dom.btnMaximize?.addEventListener("click", async () => {
    const maximized = await syncMaximize();
    if (typeof win.toggleMaximize === "function") {
      await win.toggleMaximize().catch(() => undefined);
    } else if (maximized) {
      await win.unmaximize?.().catch(() => undefined);
    } else {
      await win.maximize?.().catch(() => undefined);
    }
    await syncMaximize();
  });
  const hideWindow = async () => {
    if (typeof win.hide === "function") {
      await win.hide().catch(() => undefined);
      return;
    }
    await win.minimize?.().catch(() => undefined);
  };
  dom.btnClose?.addEventListener("click", async () => {
    if (localStorage.getItem(CLOSE_HINT_KEY) !== "true") {
      localStorage.setItem(CLOSE_HINT_KEY, "true");
      await nativeMessage(t("titlebar.background_notice"), {
        title: t("titlebar.background_notice_title"),
      }).catch(() => undefined);
    }
    await hideWindow();
  });
  await syncMaximize();
  if (typeof win.onResized === "function") {
    await win.onResized(() => {
      void syncMaximize();
    }).catch(() => undefined);
  }

  // Always-on-top pin toggle
  if (dom.btnPin) {
    const syncPin = async () => {
      const pinned = await win.isAlwaysOnTop().catch(() => false);
      dom.btnPin.dataset.pinned = String(pinned);
      state.alwaysOnTop = pinned;
      renderTitlebarMenu();
      await persistOverlaySettings();
    };

    await win.setAlwaysOnTop(state.alwaysOnTop).catch(() => undefined);
    await syncPin();

    dom.btnPin.addEventListener("click", async () => {
      const current = dom.btnPin.dataset.pinned === "true";
      const next = !current;
      await win.setAlwaysOnTop(next).catch(() => undefined);
      await syncPin();
      closeTitlebarMenu();
    });
  }
}

async function currentTauriWindow() {
  const globalGetCurrentWindow = window.__TAURI__?.window?.getCurrentWindow;
  if (typeof globalGetCurrentWindow === "function") {
    try {
      return globalGetCurrentWindow();
    } catch (tauriErr) {
      AppLog.debug("tauri", "getCurrentWindow failed", { error: String(tauriErr) });
    }
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

/** Strip ANSI escape sequences (colors, cursor, etc.) from terminal output. */
function stripAnsi(str) {
  if (!str) return "";
  // Based on the strip-ansi npm package regex — covers CSI, OSC, and other escape sequences
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "");
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
  const epoch = state.directoryEpoch;
  if (!state.selectedTaskID) {
    state.memoryFiles = [];
    state.memorySearchMode = false;
    renderMemory();
    return;
  }
  try {
    const query = `?taskID=${encodeURIComponent(state.selectedTaskID)}`;
    const files = await apiJson(`panel/knowledge/memory${query}`);
    if (epoch !== state.directoryEpoch) return;
    state.memoryFiles = Array.isArray(files) ? files : [];
    state.memorySearchMode = false;
    renderMemory();
  } catch (e) {
    AppLog.debug("memory", "loadMemory failed, resetting to empty", { error: String(e) });
    if (epoch !== state.directoryEpoch) return;
    state.memoryFiles = [];
    state.memorySearchMode = false;
    renderMemory();
  }
}

async function searchMemory(query) {
  if (!query || !query.trim()) {
    return loadMemory();
  }
  const epoch = state.directoryEpoch;
  try {
    const taskID = state.selectedTaskID || undefined;
    const results = await apiJson("panel/knowledge/memory/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query.trim(), taskID, limit: 20 }),
    });
    if (epoch !== state.directoryEpoch) return;
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
  } catch (searchErr) {
    AppLog.warn("memory", "searchMemory failed", { error: String(searchErr) });
    if (epoch !== state.directoryEpoch) return;
  }
}

function knowledgeScopeLabel(scope) {
  if (scope === "session") return t("preference.scope.session");
  if (scope === "cwd") return t("preference.scope.cwd");
  if (scope === "global") return t("preference.scope.global");
  return scope || "";
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
      state.memorySearchMode ? t("memory.no_results") : state.selectedTaskID ? t("memory.none") : t("memory.none_unselected"),
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
          <span class="knowledge-scope" data-scope="${escapeHtml(f.scope)}">${escapeHtml(knowledgeScopeLabel(f.scope))}</span>
          <button type="button" class="btn btn-ghost mini danger knowledge-delete" data-action="delete-memory" data-id="${escapeHtml(f.id)}" title="${escapeHtml(t("memory.delete_button_title"))}" aria-label="${escapeHtml(t("memory.delete_button_title"))}">${escapeHtml(t("common.delete"))}</button>
        </div>
      </div>`;
    })
    .join("");
}

let _currentMemoryId = "";

async function openMemoryDetail(fileId) {
  _currentMemoryId = fileId;
  if (!dom.memoryDialog) return;
  dom.memoryDialog.dataset.memoryId = fileId;
  dom.memoryDialogTitle.textContent = t("common.loading");
  dom.memoryDialogMeta.innerHTML = "";
  dom.memoryDialogContent.textContent = t("common.loading");
  dom.memoryDialog.showModal();

  try {
    const data = await apiJson(`panel/knowledge/memory/${encodeURIComponent(fileId)}`);
    const f = data.file;
    dom.memoryDialogTitle.textContent = f.title;
    dom.memoryDialogMeta.innerHTML = [
      `<span class="knowledge-scope" data-scope="${escapeHtml(f.scope)}">${escapeHtml(knowledgeScopeLabel(f.scope))}</span>`,
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
  const epoch = state.directoryEpoch;
  try {
    const prefs = await apiJson("panel/knowledge/preference");
    if (epoch !== state.directoryEpoch) return;
    state.preferences = Array.isArray(prefs) ? prefs : [];
    renderPreferences();
  } catch (e) {
    AppLog.debug("preferences", "loadPreferences failed, resetting to empty", { error: String(e) });
    if (epoch !== state.directoryEpoch) return;
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
      const deleteBtn = `<button type="button" class="btn btn-ghost mini danger" data-pref-action="delete" data-pref-id=${jsonAttr(p.id)} title="${escapeHtml(t("preference.delete_button_title"))}" aria-label="${escapeHtml(t("preference.delete_button_title"))}">${escapeHtml(t("common.delete"))}</button>`;
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
  dom.btnDeleteMemory.addEventListener("click", () => {
    const id = dom.memoryDialog?.dataset?.memoryId || _currentMemoryId;
    deleteMemory(id);
  });
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

let _serverLogLines = [];
let _serverLogPath = "";

async function loadServerLogs() {
  try {
    const data = await apiJson("log/tail?n=500");
    _serverLogLines = Array.isArray(data?.lines) ? data.lines : [];
    _serverLogPath = typeof data?.path === "string" ? data.path : "";
  } catch (e) {
    AppLog.warn("log", "Failed to load server logs", { error: String(e) });
    _serverLogLines = [];
    _serverLogPath = "";
  }
}

function stringifyLogValue(value, space = 0) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, space); } catch { return String(value ?? ""); }
}

function displayString(value, space = 0) {
  if (typeof value === "string") return value.trim() === "[object Object]" ? "" : value;
  if (value === undefined || value === null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function parseLogValue(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (/^[\[{"]/.test(text)) { try { return JSON.parse(text); } catch {} }
  return text;
}

function scanBalancedLogValue(text, start) {
  if (text[start] === '"') {
    let escaped = false;
    for (let index = start + 1; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (char === '"') return index + 1;
    }
    return text.length;
  }
  const pairs = { "{": "}", "[": "]" };
  const stack = [text[start]];
  let quoted = false;
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === "{" || char === "[") { stack.push(char); continue; }
    if (char === "}" || char === "]") {
      const open = stack[stack.length - 1];
      if (pairs[open] === char) {
        stack.pop();
        if (stack.length === 0) return index + 1;
      }
    }
  }
  return text.length;
}

function scanLogValueEnd(text, start) {
  if (!text[start]) return start;
  const first = text[start];
  if (first === '"' || first === "{" || first === "[") return scanBalancedLogValue(text, start);
  let cursor = start;
  while (cursor < text.length) {
    const nextSpace = text.indexOf(" ", cursor);
    if (nextSpace < 0) return text.length;
    let probe = nextSpace;
    while (probe < text.length && text[probe] === " ") probe += 1;
    if (/^[A-Za-z0-9_.-]+=/.test(text.slice(probe))) return nextSpace;
    cursor = probe;
  }
  return text.length;
}

function parseLeadingLogFields(text) {
  const fields = {};
  let index = 0;
  while (index < text.length) {
    while (text[index] === " ") index += 1;
    const match = /^([A-Za-z0-9_.-]+)=/.exec(text.slice(index));
    if (!match) break;
    const key = match[1];
    index += match[0].length;
    const end = scanLogValueEnd(text, index);
    fields[key] = parseLogValue(text.slice(index, end));
    index = end;
  }
  return { fields, end: index };
}

function parseServerLogLine(raw) {
  const match = raw.match(/^(DEBUG|INFO|WARN|ERROR)\s+(\S+)\s+(\+\d+ms)\s+(.*)$/);
  if (!match) return { level: "info", ts: "", delta: "", service: "", message: raw, fields: {}, raw };
  const [, level, ts, delta, rest] = match;
  const parsed = parseLeadingLogFields(rest);
  const service = typeof parsed.fields.service === "string" ? parsed.fields.service : "";
  const message = rest.slice(parsed.end).trim() || rest.trim();
  return { level: level.toLowerCase(), ts, delta, service, message, fields: parsed.fields, raw };
}

function logDetailFields(fields) {
  if (!record(fields)) return {};
  return Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "service"));
}

function logPreviewValue(value) { return clipText(stringifyLogValue(value), 80); }

function logSourceLabel(source) {
  if (source === "server") return "Server";
  if (source === "pipeline") return "Pipeline";
  return "Overlay";
}

function renderLogEntryDetail(entry) {
  const fields = logDetailFields(entry.fields);
  const items = Object.entries(fields);
  const chips = items.length
    ? `<div class="log-fields">${items.slice(0, 6).map(([key, value]) => `<span class="log-chip">${escapeHtml(key)}=${escapeHtml(logPreviewValue(value))}</span>`).join("")}</div>`
    : "";
  const blocks = [];
  if (items.length) {
    blocks.push(`<div class="log-detail-block"><div class="log-detail-title">${escapeHtml(t("log.fields"))}</div><pre class="log-detail-pre">${escapeHtml(stringifyLogValue(fields, 2))}</pre></div>`);
  }
  if (entry.raw) {
    blocks.push(`<div class="log-detail-block"><div class="log-detail-title">${escapeHtml(t("log.raw"))}</div><pre class="log-detail-pre">${escapeHtml(entry.raw)}</pre></div>`);
  }
  const detail = blocks.length
    ? `<details class="log-detail"><summary>${escapeHtml(t("log.details"))}</summary>${blocks.join("")}</details>`
    : "";
  return chips + detail;
}

function logViewerEntries() {
  const minLevel = { debug: 0, info: 1, warn: 2, error: 3 };
  const threshold = minLevel[AppLog.filterLevel] || 0;
  // Overlay client logs
  const clientLines = AppLog.filtered().map((e) => ({
    level: e.level, ts: e.ts, service: e.service, delta: "", message: e.message,
    fields: record(e.extra) ? e.extra : e.extra == null ? {} : { extra: e.extra },
    raw: "", source: "overlay",
  }));
  // Server logs
  const serverLines = _serverLogLines
    .map(parseServerLogLine)
    .filter((e) => (minLevel[e.level] || 0) >= threshold)
    .map((e) => ({ ...e, source: "server" }));
  // Pipeline execution events → unified log entries
  const ndjsonLines = (state.ndjsonEvents || [])
    .filter((ev) => ev.kind !== "tool_delta")
    .map((ev) => {
      const level = ev.kind === "error" ? "error" : "info";
      if ((minLevel[level] || 0) < threshold) return null;
      const stage = ev.stage || "";
      const kind = ev.kind || "";
      const toolName = ev.toolName || "";
      const summary = ev.summary || ev.text || "";
      const parts = [];
      if (kind === "tool_call" && toolName) parts.push(`→ ${toolName}`);
      else if (kind === "tool_result" && toolName) parts.push(`← ${toolName}`);
      else if (kind === "status") parts.push(summary);
      else if (kind === "message_delta") parts.push("[text delta]");
      if (kind !== "status" && summary) parts.push(summary.length > 150 ? summary.slice(0, 150) + "…" : summary);
      const elapsed = typeof ev.elapsed_ms === "number" ? fmtElapsed(ev.elapsed_ms) : "";
      return {
        level, ts: ev.at || "", service: stage, delta: elapsed,
        message: parts.join(" "),
        fields: { kind, ...(toolName ? { tool: toolName } : {}), ...(ev.status ? { status: ev.status } : {}) },
        raw: "", source: "pipeline",
      };
    })
    .filter(Boolean);
  // Merge all sources, sort by timestamp (server logs first if no ts comparison possible)
  return [...serverLines, ...ndjsonLines, ...clientLines]
    .sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
}

function formatLogViewerText(entries) {
  return entries
    .map((e) => {
      const parts = [`[${String(e.source || "client").toUpperCase()}]`, `[${String(e.level || "info").toUpperCase()}]`];
      if (e.ts) parts.push(e.ts);
      if (e.service) parts.push(e.service);
      parts.push(e.message || "");
      const fields = logDetailFields(e.fields);
      if (Object.keys(fields).length) parts.push(stringifyLogValue(fields));
      return parts.join(" ");
    })
    .join("\n");
}

// ── NDJSON Event Colors ──

const NDJSON_STAGE_COLORS = {
  spec: "#3A86FF",
  planner: "#7B54C9",
  goal: "#2ECC71",
  judge: "#F39C12",
  delivery: "#28B4A0",
};

const NDJSON_TOOL_COLORS = {
  read_file: "#3498DB",
  list_directory: "#5DADE2",
  find_files: "#76D7EA",
  search_code: "#F39C12",
  memory_search: "#9B59B6",
  preference_list: "#8E44AD",
  web_search: "#E67E22",
  write_file: "#27AE60",
  edit_file: "#2ECC71",
  run_command: "#E8644A",
  bash: "#E74C3C",
};

function ndjsonToolColor(name) {
  return NDJSON_TOOL_COLORS[name] || "#95A5A6";
}

function fmtElapsed(ms) {
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + "s";
  const m = Math.floor(s / 60);
  return m + "m" + (s - m * 60).toFixed(0) + "s";
}

function ndjsonEventTypeLabel(type) {
  return (type || "").replace("orchestrator.", "").replace(/\./g, " › ");
}

function renderNdjsonEvent(ev) {
  const stage = ev.stage || "";
  const stageColor = NDJSON_STAGE_COLORS[stage] || "#6B7280";
  const kind = ev.kind || "";
  const toolName = ev.toolName || "";
  const summary = ev.summary || ev.text || "";

  let kindBadge = "";
  if (kind === "tool_call") kindBadge = `<span class="ndjson-badge tool-call">call</span>`;
  else if (kind === "tool_result") kindBadge = `<span class="ndjson-badge tool-result">result</span>`;
  else if (kind === "tool_delta") return ""; // skip deltas
  else if (kind === "message_delta") kindBadge = `<span class="ndjson-badge msg-delta">text</span>`;
  else if (kind === "status") kindBadge = `<span class="ndjson-badge status-badge">status</span>`;

  const typeLabel = ndjsonEventTypeLabel(ev.type);
  const elapsed = `<span class="ndjson-elapsed">${fmtElapsed(ev.elapsed_ms)}</span>`;

  let content = "";
  if (stage) {
    content += `<span class="ndjson-stage" style="color:${stageColor}">${escapeHtml(stage)}</span>`;
  }
  if (toolName && kind !== "message_delta") {
    content += `<span class="ndjson-tool" style="color:${ndjsonToolColor(toolName)}">${escapeHtml(toolName)}</span>`;
  }
  if (summary && summary.length > 0 && kind !== "tool_delta") {
    const summaryText = summary.length > 120 ? summary.slice(0, 120) + "…" : summary;
    content += `<span class="ndjson-summary">${escapeHtml(summaryText)}</span>`;
  }
  if (ev.status) {
    content += `<span class="ndjson-status ndjson-status-${ev.status}">${escapeHtml(ev.status)}</span>`;
  }

  return `<div class="ndjson-event">` +
    `<div class="ndjson-event-head">${elapsed}<span class="ndjson-type">${escapeHtml(typeLabel)}</span>${kindBadge}</div>` +
    (content ? `<div class="ndjson-event-body">${content}</div>` : "") +
    `</div>`;
}

function renderNdjsonLogPanel() {
  if (!dom.logViewerBody) return;
  const entries = logViewerEntries();

  if (entries.length === 0) {
    dom.logViewerBody.innerHTML = `<div class="empty-hint">${escapeHtml(t("log.empty"))}</div>`;
    return;
  }

  const html = entries.map((e) =>
    `<div class="log-line" data-source="${escapeHtml(e.source)}">` +
    `<div class="log-line-head">` +
    `<span class="log-source" data-source="${escapeHtml(e.source)}">${escapeHtml(logSourceLabel(e.source))}</span>` +
    `<span class="log-level log-level-${e.level}">[${escapeHtml(e.level.toUpperCase())}]</span>` +
    (e.delta ? `<span class="log-delta">${escapeHtml(e.delta)}</span>` : "") +
    (e.service ? `<span class="log-service">${escapeHtml(e.service)}</span>` : "") +
    `<span class="log-ts">${escapeHtml(e.ts)}</span>` +
    `</div>` +
    `<div class="log-msg">${escapeHtml(e.message || e.raw || "")}</div>` +
    renderLogEntryDetail(e) +
    `</div>`
  ).join("");

  dom.logViewerBody.innerHTML = html;
  dom.logViewerBody.scrollTop = dom.logViewerBody.scrollHeight;
}

function renderLogViewer() {
  renderNdjsonLogPanel();
}

async function openLogViewer() {
  await loadServerLogs();
  renderLogViewer();
  dom.logDialog?.showModal();
}

dom.btnLog?.addEventListener("click", () => {
  openLogViewer();
  closeTitlebarMenu();
});
dom.btnCloseLog?.addEventListener("click", () => dom.logDialog?.close());
dom.btnLogRefresh?.addEventListener("click", async () => {
  await loadServerLogs();
  renderLogViewer();
});
dom.btnLogCopy?.addEventListener("click", async () => {
  try {
    const text = formatLogViewerText(logViewerEntries());
    if (!text) return;
    const ok = await copyText(text);
    if (!ok) throw new Error(t("log.copy_failed"));
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
dom.btnLogServerLogs?.addEventListener("click", async () => {
  await loadServerLogs();
  renderLogViewer();
});

// ── Init ──

toggleMcpFields();
setupDialogBackdropClose();

// ── Config Area ──

async function loadConfigInfo() {
  try {
    const [config, catalog, auth, channels, prompts] = await Promise.all([
      apiJson("config"),
      apiJson("provider"),
      apiJson("provider/auth"),
      apiJson("channel"),
      apiJson("config/prompt").catch(() => []),
    ]);
    state.config = config;
    const remoteUnattended = configUnattended(config);
    if (typeof remoteUnattended === "boolean") {
      state.unattended = remoteUnattended;
      void persistOverlaySettings();
    } else {
      void syncUnattendedConfig();
    }
    state.providerCatalog = catalog;
    state.providerAuth = auth;
    state.channels = Array.isArray(channels) ? channels : [];
    applyPromptEntries(prompts);

    populateProviderSelect(config, catalog);
      if (dom.cfgAvailableProviders) {
      const total = Array.isArray(catalog?.all) ? catalog.all.length : 0;
      const connected = Array.isArray(catalog?.connected) ? catalog.connected.length : 0;
      const text = t("llm.available_count", { total, connected });
      dom.cfgAvailableProviders.textContent = text;
      dom.cfgAvailableProviders.title = text;
      dom.cfgAvailableProviders.dataset.status = connected > 0 ? "active" : total > 0 ? "ready" : "";
    }

    renderChannels();
    renderTitlebarMenu();
    renderVersions();
    renderLlmSummary();
    renderLlmApiKeyTools();
  } catch (e) { AppLog.warn("config", "loadConfigInfo failed", { error: String(e) }); }
}

async function restoreInitialWorkspace() {
  if (hasWorkspaceSelection()) return false;
  const base = activeDirectory() || "";
  const taskID = state.workspaceTaskID || "";
  const directory = workspaceRestoreDirectory(state.workspaceDirectory || "");
  const moved = !!directory && !!base && directory !== base;
  if (moved) {
    await setActiveDirectory(directory, {
      persist: false,
      restoreWorkspace: false,
    });
  }
  if (taskID && state.tasks.some((item) => item?.task?.id === taskID)) {
    await selectTask(taskID);
    return true;
  }
  if (moved && activeDirectory() !== base) {
    await setActiveDirectory(base, {
      persist: false,
      restoreWorkspace: false,
    });
  }
  return false;
}

async function init() {
  AppLog.info("init", "OpenCorvus overlay starting", { version: OVERLAY_VERSION });
  await loadOverlaySettings();
  await ensureDefaultDirectory();
  await syncLocalServerUrl();
  await loadI18n();
  renderLocale();
  renderTheme();
  renderWorkspaceState();
  renderTitlebarMenu();
  renderScale();
  renderVersions();
  renderLlmSummary();
  renderLlmApiKeyTools();
  await setupTauri();
  await applyWindowOpacity();
  renderExecutor();
  const ok = await checkConnection();
  if (ok) {
    AppLog.info("init", "loading initial data");
    await ensureWorkspaceDirectory();
    await Promise.all([loadTasks(), loadMeta(), loadExtensions(), loadConfigInfo(), loadExecutors(), loadPreferences()]);
    await restoreInitialWorkspace();
    if (!state.selectedTaskID) renderMemory();
    AppLog.info("init", "ready");
  } else {
    AppLog.warn("init", "starting offline");
    renderMeta();
    renderExtensions();
  }
  // Retry connection periodically
  if (state.reconnectTimer) clearInterval(state.reconnectTimer);
  state.reconnectTimer = setInterval(async () => {
    try {
      if (!state.connected) {
        const ok = await checkConnection();
        if (ok) {
          await ensureWorkspaceDirectory();
          await Promise.all([loadTasks(), loadMeta(), loadExtensions(), loadConfigInfo(), loadExecutors(), loadPreferences()]);
          await restoreInitialWorkspace();
          if (!state.selectedTaskID) renderMemory();
        }
      }
    } catch (retryErr) {
      AppLog.warn("init", "connection retry failed", { error: String(retryErr) });
    }
  }, 10000);
  syncTechFx(true);
}

init().catch((err) => {
  AppLog.error("init", "fatal initialization error", { error: String(err) });
});

window.addEventListener("resize", renderScale);
window.visualViewport?.addEventListener("resize", renderScale);
window.addEventListener("keydown", handleZoomHotkey);

// F12 → toggle devtools
window.addEventListener("keydown", (e) => {
  if (e.key === "F12" && hasTauriRuntime()) {
    e.preventDefault();
    tauriInvoke("overlay_toggle_devtools").catch(() => {});
  }
});
window.addEventListener("focus", () => {
  void refreshInteractionAttention?.();
});
window.addEventListener("blur", () => {
  stopPaneResize();
  void refreshInteractionAttention?.();
});
window.addEventListener("beforeunload", () => {
  if (state.reconnectTimer) {
    clearInterval(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  if (state.sseRetryTimer) {
    clearTimeout(state.sseRetryTimer);
    state.sseRetryTimer = null;
  }
  stopPolling();
});
document.addEventListener("visibilitychange", () => {
  syncTechFx();
  void refreshInteractionAttention?.();
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

if (reducedMotionMedia) {
  const onMotionChange = () => {
    syncTechFx(true);
  };
  if (typeof reducedMotionMedia.addEventListener === "function") {
    reducedMotionMedia.addEventListener("change", onMotionChange);
  } else if (typeof reducedMotionMedia.addListener === "function") {
    reducedMotionMedia.addListener(onMotionChange);
  }
}

// ══════════════════════════════════════════════════════════════
// ── Coding Tab ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

const coding = {
  active: false,
  sessionID: null,
  messages: [],
  busy: false,
  controller: null,
  textBuffer: new Map(), // partID → accumulated text
};

function isCodingTab() {
  return coding.active;
}

function switchTab(tab) {
  coding.active = tab === "coding";
  if (dom.tabControl) dom.tabControl.classList.toggle("active", !coding.active);
  if (dom.tabCoding) dom.tabCoding.classList.toggle("active", coding.active);
  if (dom.chatScroll) dom.chatScroll.hidden = coding.active;
  if (dom.codingScroll) dom.codingScroll.hidden = !coding.active;
  if (dom.chatGoalsStrip) dom.chatGoalsStrip.hidden = coding.active;
  // Hide task-specific header elements in coding mode
  if (dom.taskStatus) dom.taskStatus.hidden = coding.active || !state.selectedTaskID;
  // Update toggle button text
  const toggle = document.getElementById("modeToggle");
  if (toggle) toggle.textContent = coding.active ? "Build" : t("chat.title");
  if (coding.active) renderCodingMessages();
}

document.getElementById("modeToggle")?.addEventListener("click", () => {
  switchTab(coding.active ? "control" : "coding");
});

function codingMessageHTML(msg) {
  if (msg.role === "user") {
    return `<div class="message message-user"><div class="message-body"><p>${escapeHtml(msg.text)}</p></div></div>`;
  }
  // assistant
  const parts = [];
  for (const p of msg.parts || []) {
    if (p.type === "text" && p.text) {
      parts.push(`<div class="message-text">${renderMarkdown(p.text)}</div>`);
    } else if (p.type === "tool") {
      const status = p.state?.status || "running";
      const icon = status === "completed" ? "done" : status === "error" ? "err" : "run";
      const title = escapeHtml(p.state?.title || p.tool || "tool");
      const output = p.state?.output ? `<pre class="tool-output">${escapeHtml(stripAnsi(String(p.state.output)).slice(0, 2000))}</pre>` : "";
      parts.push(`<details class="tool-block tool-${status}"><summary>[${icon}] ${title}</summary>${output}</details>`);
    }
  }
  if (parts.length === 0 && msg.streaming) {
    parts.push(`<div class="message-text"><span class="typing">……</span></div>`);
  }
  return `<div class="message message-assistant"><div class="message-body">${parts.join("")}</div></div>`;
}

function renderMarkdown(text) {
  // Minimal markdown: code blocks, inline code, bold
  return escapeHtml(text)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="code-block"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function renderCodingMessages() {
  if (!dom.codingScroll) return;
  if (coding.messages.length === 0) {
    dom.codingScroll.innerHTML = `<div class="chat-empty">Build agent — ask anything about the codebase</div>`;
    return;
  }
  const wasAtBottom = dom.codingScroll.scrollHeight - dom.codingScroll.scrollTop - dom.codingScroll.clientHeight < 80;
  dom.codingScroll.innerHTML = coding.messages.map(codingMessageHTML).join("");
  if (wasAtBottom) {
    requestAnimationFrame(() => { dom.codingScroll.scrollTop = dom.codingScroll.scrollHeight; });
  }
}

async function sendCodingMessage(text) {
  if (coding.busy || !text.trim()) return;
  coding.busy = true;

  // Add user message
  coding.messages.push({ role: "user", text });
  // Add placeholder assistant message
  const assistantMsg = { role: "assistant", parts: [], streaming: true };
  coding.messages.push(assistantMsg);
  renderCodingMessages();

  const controller = new AbortController();
  coding.controller = controller;

  try {
    const body = JSON.stringify({
      text,
      sessionID: coding.sessionID || undefined,
    });
    const res = await fetch(apiUrl("coding/message/stream"), {
      method: "POST",
      headers: { ...apiHeaders(), "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`Coding stream failed: ${res.status}`);

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
        if (!line.startsWith("data:")) continue;
        try {
          const event = JSON.parse(line.slice(5).trim());
          handleCodingEvent(assistantMsg, event);
        } catch {}
      }
    }
    // process remaining buffer
    if (buffer.startsWith("data:")) {
      try {
        const event = JSON.parse(buffer.slice(5).trim());
        handleCodingEvent(assistantMsg, event);
      } catch {}
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      const errText = err.message || String(err);
      assistantMsg.parts.push({ type: "text", text: `Error: ${errText}` });
    }
  } finally {
    assistantMsg.streaming = false;
    coding.busy = false;
    coding.controller = null;
    renderCodingMessages();
  }
}

function handleCodingEvent(msg, event) {
  if (event.type === "session") {
    coding.sessionID = event.sessionID;
    return;
  }
  if (event.type === "delta") {
    // Accumulate text in buffer, update or create text part
    const current = coding.textBuffer.get(event.partID) || "";
    const next = current + (event.delta || "");
    coding.textBuffer.set(event.partID, next);
    // Find or create text part in message
    let part = msg.parts.find((p) => p.type === "text" && p._partID === event.partID);
    if (!part) {
      part = { type: "text", text: "", _partID: event.partID };
      msg.parts.push(part);
    }
    part.text = next;
    renderCodingMessages();
    return;
  }
  if (event.type === "part") {
    const p = event.part;
    if (p.type === "tool") {
      let existing = msg.parts.find((x) => x.type === "tool" && x._partID === p.id);
      if (!existing) {
        existing = { type: "tool", tool: p.tool, state: p.state, _partID: p.id };
        msg.parts.push(existing);
      } else {
        existing.state = p.state;
        existing.tool = p.tool;
      }
      renderCodingMessages();
    }
    return;
  }
  if (event.type === "error") {
    msg.parts.push({ type: "text", text: `Error: ${event.error?.message || JSON.stringify(event.error)}` });
    renderCodingMessages();
    return;
  }
  if (event.type === "done") {
    coding.textBuffer.clear();
    return;
  }
}

// Override chat form submit to route based on active tab
const _originalChatSubmit = dom.chatForm?.onsubmit;

dom.chatForm?.addEventListener("submit", (e) => {
  if (!isCodingTab()) return; // let original handler run
  e.preventDefault();
  e.stopImmediatePropagation();
  const text = dom.chatTextarea?.value?.trim();
  if (!text) return;
  dom.chatTextarea.value = "";
  sizeChat();
  sendCodingMessage(text);
}, true); // capture phase to intercept before existing handler
