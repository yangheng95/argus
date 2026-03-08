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

// ── State ──

const state = {
  serverUrl: localStorage.getItem("oc_server_url") || DEFAULT_SERVER,
  password: localStorage.getItem("oc_password") || "",
  username: localStorage.getItem("oc_username") || "opencorvus",
  executor: localStorage.getItem("oc_executor") || "opencode",
  connected: false,
  tasks: [],
  selectedTaskID: "",
  path: null,
  vcs: null,
  config: null,
  providerCatalog: null,
  providerAuth: null,
  providerTest: null,
  channels: [],
  skills: [],
  mcp: {},
  board: null,
  chatSessionID: "",
  sessions: [],
  managedSession: null,
  managedChildren: [],
  session: [],
  sse: null,
  pollTimer: null,
  sessionTimer: null,
  elapsedTimer: null,
  _renderedGroupKey: "",
};

// ── DOM Refs ──

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  connBadge: $("#connBadge"),
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
  chatScroll: $("#chatScroll"),
  chatEmpty: $("#chatEmpty"),
  chatCount: $("#chatCount"),
  chatForm: $("#chatForm"),
  chatTextarea: $("#chatTextarea"),
  chatSend: $("#chatSend"),
  btnSessions: $("#btnSessions"),
  sessionsDialog: $("#sessionsDialog"),
  sessionListPanel: $("#sessionListPanel"),
  sessionChildrenPanel: $("#sessionChildrenPanel"),
  sessionMetaCard: $("#sessionMetaCard"),
  btnRefreshSessions: $("#btnRefreshSessions"),
  btnCreateSession: $("#btnCreateSession"),
  btnUseTaskSession: $("#btnUseTaskSession"),
  btnOpenSession: $("#btnOpenSession"),
  btnForkSession: $("#btnForkSession"),
  btnExportSession: $("#btnExportSession"),
  btnDeleteSession: $("#btnDeleteSession"),
  btnCloseSessions: $("#btnCloseSessions"),
  skillDialog: $("#skillDialog"),
  skillForm: $("#skillForm"),
  skillType: $("#skillType"),
  skillValue: $("#skillValue"),
  btnCancelSkill: $("#btnCancelSkill"),
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
};

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
          <span class="extension-status" data-state="connected">loaded</span>
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

async function nativeConfirm(message) {
  return window.confirm(message);
}

// ── Connection ──

async function checkConnection() {
  setConnStatus("connecting");
  try {
    await apiJson("tasks");
    setConnStatus("online");
    state.connected = true;
    return true;
  } catch {
    setConnStatus("offline");
    state.connected = false;
    return false;
  }
}

function setConnStatus(status) {
  dom.connBadge.dataset.status = status;
  dom.connBadge.textContent =
    status === "online" ? "Online" : status === "connecting" ? "..." : "Offline";
}

function executorLabel(value) {
  if (value === "codex") return "Codex";
  if (value === "claude-code") return "Claude Code";
  return "Opencode";
}

function renderExecutor() {
  const buttons = dom.engineBar.querySelectorAll("[data-executor]");
  for (const button of buttons) {
    button.dataset.active = button.dataset.executor === state.executor ? "true" : "false";
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
  renderExecutor();
  renderTaskSession();
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
    return;
  }

  await loadBoard();
  await loadSession();
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
  } catch {
    // silent
  }
}

// ── Session Messages ──

async function loadSession() {
  const sessionID = currentSessionID();
  if (!sessionID) return;
  try {
    const messages = await apiJson(`session/${sessionID}/message`);
    state.session = Array.isArray(messages) ? messages : [];
    renderSession();
  } catch {
    // silent
  }
}

function currentSessionID() {
  if (state.chatSessionID) return state.chatSessionID;
  return state.board?.task?.sessionID || "";
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
    loadSession();
  }
}

// ── Polling ──

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(() => {
    loadBoard();
    loadMeta();
  }, POLL_INTERVAL);
  state.sessionTimer = setInterval(() => loadSession(), SESSION_POLL);
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

window.taskAction = async function (action) {
  if (!state.selectedTaskID) return;
  try {
    await apiFetch(`task/${state.selectedTaskID}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
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
  });
  if (!accepted) return;
  try {
    await apiFetch(`goal/${id}`, { method: "DELETE" });
    await loadBoard();
  } catch (e) {
    console.error("Failed to delete goal:", e);
    alert("Failed to delete goal: " + e.message);
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
    if (evalCheck) {
      statusDot.dataset.result = evalCheck.status;
      if (evalCheck.status === "passed") passedCount++;
    } else {
      statusDot.dataset.result = "pending";
    }

    if (checkbox.checked) enabledCount++;
  });

  const total = checks.length || enabledCount;
  if (total > 0) {
    dom.criteriaBadge.textContent = `${passedCount}/${total}`;
    dom.criteriaBadge.dataset.tone = passedCount === total ? "good" : passedCount > 0 ? "warn" : "";
  } else {
    dom.criteriaBadge.textContent = `${enabledCount} enabled`;
    dom.criteriaBadge.dataset.tone = "";
  }
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
  document.querySelectorAll(".criteria-status").forEach((el) => {
    el.dataset.result = "pending";
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
      const dot = document.querySelector(`.criteria-status[data-result]`)?.closest(`.criteria-item[data-check="${key}"]`)?.querySelector(".criteria-status")
        || document.querySelector(`[data-check="${key}"]`)?.closest(".criteria-item")?.querySelector(".criteria-status");
      if (dot) {
        dot.dataset.result = check.status;
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
  return `<div class="delivery-card">
    <div class="delivery-title">\u2713 Delivery Ready</div>
    <div class="delivery-summary">${escapeHtml(delivery.summary || delivery.result?.summary || "")}</div>
    ${fileCount > 0 ? `<div class="delivery-files">${fileCount} file${fileCount > 1 ? "s" : ""} changed</div>` : ""}
  </div>`;
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
    const created = await apiJson("session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await loadManagedSessions();
    await selectManagedSession(created.id);
  } catch (e) {
    console.error("Failed to create session:", e);
    alert("Failed to create session: " + e.message);
  }
}

async function forkManagedSession() {
  if (!state.managedSession?.id) return;
  try {
    const next = await apiJson(`session/${state.managedSession.id}/fork`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await selectManagedSession(state.managedSession.id);
    openManagedSession(next.id);
  } catch (e) {
    console.error("Failed to fork session:", e);
    alert("Failed to fork session: " + e.message);
  }
}

async function deleteManagedSession() {
  if (!state.managedSession?.id) return;
  const accepted = await nativeConfirm(`Delete session ${state.managedSession.title || state.managedSession.id}?`, {
    title: "Delete Session",
    okLabel: "Delete",
  });
  if (!accepted) return;
  try {
    await deleteSessionBinding(state.managedSession.id);
    state.managedSession = null;
    state.managedChildren = [];
    await loadManagedSessions();
    await loadTasks();
    await loadSession();
    renderManagedSessionMeta();
    renderManagedSessionChildren();
  } catch (e) {
    console.error("Failed to delete session:", e);
    alert("Failed to delete session: " + e.message);
  }
}

async function deleteSessionBinding(sessionID) {
  const linked = state.tasks.filter((item) => item.task?.sessionID === sessionID);
  await Promise.all(
    linked
      .filter((item) => !["completed", "failed", "cancelled"].includes(item.task.status))
      .map((item) =>
        apiFetch(`task/${item.task.id}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }).catch(() => undefined),
      ),
  );
  await apiFetch(`session/${sessionID}`, { method: "DELETE" });
  state.tasks = state.tasks.filter((item) => item.task?.sessionID !== sessionID);
  if (state.chatSessionID === sessionID) state.chatSessionID = "";
  if (currentTaskSessionID() === sessionID || (state.selectedTaskID && !state.tasks.some((item) => item.task.id === state.selectedTaskID))) {
    state.selectedTaskID = "";
    state.board = null;
    state.session = [];
    stopPolling();
    stopSSE();
    renderClear();
  }
  renderTaskSelect();
}

async function exportManagedSession() {
  if (!state.managedSession?.id) return;
  try {
    const result = await apiJson(`session/${state.managedSession.id}/export-html`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    alert(`Exported session HTML to ${result.file}`);
  } catch (e) {
    console.error("Failed to export session:", e);
    alert("Failed to export session: " + e.message);
  }
}

async function openManagedSession(sessionID) {
  state.chatSessionID = sessionID;
  await loadSession();
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
      await apiFetch(`interaction/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: action }),
      });
    } else {
      const answer = prompt("Enter your answer:");
      if (answer == null) {
        // User cancelled the prompt
        _interactionBusy = false;
        await loadBoard();
        return;
      }
      await apiFetch(`interaction/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: answer }),
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
    await apiFetch(`interaction/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
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
    const last = groups[groups.length - 1];
    if (last && last.role === role) {
      last.messages.push(msg);
    } else {
      groups.push({ role, messages: [msg] });
    }
  }
  return groups;
}

function renderSession() {
  const messages = state.session;
  if (!messages || messages.length === 0) {
    dom.chatScroll.innerHTML = '<div class="chat-empty">Session messages appear here</div>';
    dom.chatCount.textContent = "";
    state._renderedGroupKey = "";
    return;
  }

  // Sort by time
  const sorted = [...messages].sort(
    (a, b) => (a.info?.time?.created || 0) - (b.info?.time?.created || 0)
  );

  const groups = groupMessagesByRole(sorted);
  dom.chatCount.textContent = `${sorted.length} msgs`;

  const el = dom.chatScroll;
  const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;

  // Build a key that summarises the current groups for incremental detection
  const curSessionId = currentSessionID();
  const groupKey = curSessionId + ":" + groups.map((g) => g.role + ":" + g.messages.length).join(",");
  const sessionChanged = !state._renderedGroupKey || !state._renderedGroupKey.startsWith(curSessionId + ":");
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

  const detail = toolDetail(toolName, input, st);
  const statusIcon = status === "completed" ? "\u2713" : status === "running" ? "\u25B6" : status === "error" ? "\u2717" : "\u2022";
  const icon = toolIcon(toolName);

  return `<div class="msg-tool">
    <span class="tool-icon">${icon}</span>
    <span class="tool-name">${escapeHtml(toolName)}</span>
    <span class="tool-detail">${escapeHtml(detail)}</span>
    <span class="tool-status" data-status="${status}">${statusIcon}</span>
  </div>`;
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
  const display = text.length > 300 ? text.slice(0, 300) + "..." : text;
  return `<div class="msg-reasoning collapsed" onclick="this.classList.toggle('collapsed')">\uD83D\uDCAD ${escapeHtml(display)}</div>`;
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
  dom.planBadge.textContent = "";
  dom.planBody.innerHTML = '<p class="empty-hint">No plan yet</p>';
  dom.goalsBadge.textContent = "";
  dom.goalsBody.innerHTML = '<p class="empty-hint">No goals defined</p>';
  if (dom.criteriaBadge) { dom.criteriaBadge.textContent = ""; delete dom.criteriaBadge.dataset.tone; }
  if (dom.evalBody) dom.evalBody.innerHTML = '<p class="empty-hint">No evaluation results</p>';
  dom.chatScroll.innerHTML = '<div class="chat-empty">Session messages appear here</div>';
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
    const sessionID = currentSessionID();
    if (state.chatSessionID && sessionID) {
      // Send to existing chat session
      await apiFetch(`session/${sessionID}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parts: [{ type: "text", text }],
        }),
      });
    } else if (state.selectedTaskID) {
      // Send to existing task
      await apiFetch(`task/${state.selectedTaskID}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source: "overlay" }),
      });
    } else {
      // No task selected — create a new task from the message
      const result = await apiJson("task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: text,
          source: "overlay",
          executor: state.executor,
        }),
      });
      if (result.task_id) {
        await loadTasks();
        selectTask(result.task_id);
      }
    }
    dom.chatTextarea.value = "";
    sizeChat();
    if (state.selectedTaskID) {
      await loadBoard();
      await loadSession();
    }
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

dom.btnManageTaskSession.addEventListener("click", async () => {
  const sessionID = currentTaskSessionID();
  if (!sessionID) return;
  dom.sessionsDialog.showModal();
  await loadManagedSessions();
  await selectManagedSession(sessionID);
});

dom.btnDeleteTaskSession.addEventListener("click", async () => {
  const sessionID = currentTaskSessionID();
  if (!sessionID) return;
  const accepted = await nativeConfirm(`Delete task session ${sessionID}?`, {
    title: "Delete Task Session",
    okLabel: "Delete",
  });
  if (!accepted) return;
  try {
    await deleteSessionBinding(sessionID);
    await loadManagedSessions();
    await loadTasks();
    await loadSession();
  } catch (e) {
    console.error("Failed to delete task session:", e);
    alert("Failed to delete task session: " + e.message);
  }
});

dom.engineBar.addEventListener("click", (event) => {
  const button = event.target.closest("[data-executor]");
  if (!button) return;
  state.executor = button.dataset.executor || "opencode";
  localStorage.setItem("oc_executor", state.executor);
  renderExecutor();
});

dom.btnSessions.addEventListener("click", async () => {
  dom.sessionsDialog.showModal();
  await loadManagedSessions();
  if (state.board?.task?.sessionID && !state.managedSession) {
    await selectManagedSession(state.board.task.sessionID);
  }
});

dom.btnCloseSessions.addEventListener("click", () => {
  dom.sessionsDialog.close();
});

dom.btnRefreshSessions.addEventListener("click", () => loadManagedSessions());
dom.btnCreateSession.addEventListener("click", () => createManagedSession());
dom.btnUseTaskSession.addEventListener("click", async () => {
  state.chatSessionID = "";
  await loadSession();
  renderManagedSessionList();
  renderManagedSessionMeta();
});
dom.btnOpenSession.addEventListener("click", async () => {
  if (!state.managedSession?.id) return;
  await openManagedSession(state.managedSession.id);
});
dom.btnForkSession.addEventListener("click", () => forkManagedSession());
dom.btnExportSession.addEventListener("click", () => exportManagedSession());
dom.btnDeleteSession.addEventListener("click", () => deleteManagedSession());
dom.btnAddSkill.addEventListener("click", () => {
  dom.skillForm.reset();
  dom.skillType.value = "path";
  dom.skillDialog.showModal();
});
dom.btnAddMcp.addEventListener("click", () => {
  dom.mcpForm.reset();
  dom.mcpType.value = "remote";
  toggleMcpFields();
  dom.mcpDialog.showModal();
});
dom.btnCancelSkill.addEventListener("click", () => dom.skillDialog.close());
dom.btnCancelMcp.addEventListener("click", () => dom.mcpDialog.close());
dom.mcpType.addEventListener("change", toggleMcpFields);

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
      await apiFetch(`goal/${goalID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          criteria: criteria || "The requested change is implemented and acceptance checks pass.",
        }),
      });
    } else {
      const payload = criteria ? `/goal ${description}\nCriteria: ${criteria}` : `/goal ${description}`;
      await apiFetch(`task/${state.selectedTaskID}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: payload, source: "overlay" }),
      });
    }
    dom.goalDialog.close();
    await loadBoard();
  } catch (e) {
    console.error("Failed to save goal:", e);
    alert("Failed to save goal: " + e.message);
  }
});

dom.skillForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = dom.skillValue.value.trim();
  if (!value) return;

  try {
    await updateConfig((config) => {
      config.skills = config.skills || {};
      if (dom.skillType.value === "url") {
        config.skills.urls = dedupe([...(config.skills.urls || []), value]);
        return;
      }
      config.skills.paths = dedupe([...(config.skills.paths || []), value]);
    });
    dom.skillDialog.close();
    await loadExtensions();
  } catch (e) {
    console.error("Failed to add skill:", e);
    alert("Failed to add skill: " + e.message);
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
    alert("Failed to add MCP server: " + e.message);
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
  dom.settingsDialog.showModal();
}

$("#btnSettings").addEventListener("click", () => {
  openServerSettings();
});

dom.btnOpenConfig?.addEventListener("click", () => {
  openLlmSettings();
});

dom.channelList?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-channel-edit]");
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
      await Promise.all([loadTasks(), loadMeta(), loadExtensions(), loadConfigInfo()]);
      renderProviderStatus(providerID, config);
    }
  } catch (e) {
    console.error("Failed to save LLM settings:", e);
    alert("Failed to save LLM settings: " + e.message);
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
      await Promise.all([loadTasks(), loadMeta(), loadExtensions(), loadConfigInfo()]);
    }
  } catch (e) {
    console.error("Failed to save channel settings:", e);
    alert("Failed to save channel settings: " + e.message);
  }
});

dom.settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(dom.settingsForm);
  state.serverUrl = fd.get("serverUrl")?.toString().trim() || DEFAULT_SERVER;
  state.password = fd.get("password")?.toString() || "";
  state.username = fd.get("username")?.toString().trim() || "opencorvus";
  localStorage.setItem("oc_server_url", state.serverUrl);
  localStorage.setItem("oc_password", state.password);
  localStorage.setItem("oc_username", state.username);
  dom.settingsDialog.close();
  const ok = await checkConnection();
  if (ok) {
    await Promise.all([loadTasks(), loadMeta(), loadExtensions(), loadConfigInfo()]);
  }
});

// ── Window Controls (Tauri) ──

async function setupTauri() {
  let win;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    win = getCurrentWindow();
  } catch {
    return;
  }

  $("#btnMinimize")?.addEventListener("click", () => win.minimize());
  $("#btnClose")?.addEventListener("click", () => win.hide());

  // Always-on-top pin toggle
  const btnPin = $("#btnPin");
  if (btnPin) {
    const syncPin = async () => {
      const pinned = await win.isAlwaysOnTop().catch(() => false);
      btnPin.dataset.pinned = String(pinned);
      localStorage.setItem("oc_always_on_top", String(pinned));
    };

    const saved = localStorage.getItem("oc_always_on_top") === "true";
    await win.setAlwaysOnTop(saved).catch(() => undefined);
    await syncPin();

    btnPin.addEventListener("click", async () => {
      const current = btnPin.dataset.pinned === "true";
      const next = !current;
      await win.setAlwaysOnTop(next).catch(() => undefined);
      await syncPin();
    });
  }
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

// ── Init ──

toggleMcpFields();

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
  setupTauri();
  renderExecutor();
  const ok = await checkConnection();
  if (ok) {
    await Promise.all([loadTasks(), loadMeta(), loadExtensions(), loadConfigInfo()]);
  } else {
    renderMeta();
    renderExtensions();
  }
  // Retry connection periodically
  setInterval(async () => {
    if (!state.connected) {
      const ok = await checkConnection();
      if (ok) {
        await Promise.all([loadTasks(), loadMeta(), loadExtensions(), loadConfigInfo()]);
        if (state.selectedTaskID) selectTask(state.selectedTaskID);
      }
    }
  }, 10000);
}

init();
