import {
  boardStore,
  setBoardStore,
  setTasksData,
  setPendingTasks,
  setPath,
  setVcs,
  setChanges,
  bumpTasksSeq,
  loadBoard,
  loadTasks,
  scheduleBoard as scheduleBoardStore,
  setTaskSequence,
  activeDirectory as boardActiveDirectory,
} from "../store/board";
import {
  messageStore,
  setMessages,
  setAgentEvents,
  setSelectedTaskID,
  setSseConnected,
  appendAgentEvent,
  currentSessionID,
  enqueueEvent,
  setChatRequest,
  syncTask,
  shouldReloadConversationForMessageEvent,
  mergeLoadedConversationMessages,
} from "../store/messages";
import {
  executorStore,
  appendExecutorEvent as appendExecutorStoreEvent,
  clearExecutorEvents,
} from "../store/executor";
import {
  appStore,
  setAppStore,
  setConnectionStatus,
  setProviderCatalog,
  setProviderAuth,
  setExecutors,
} from "../store/app";
import {
  settingsStore,
  setSettingsStore,
  saveSettings,
  sanitizeOpacity,
} from "../store/settings";
import { sameBudget, draftBudget, budgetMinutes, type Budget } from "../utils/budget";
import { apiJson, apiUrl } from "./api";
import { checkConnection } from "./connection";
import {
  selectTask,
  deleteTask,
  submitMessage,
  panelRequestBody,
  startTaskRecovery,
  forgetPendingTask,
  rememberPendingTask,
} from "./task";
import { stopChatRequest, chatAbortTarget } from "./chat";
import { startSSE, stopSSE } from "./sse";
import {
  ensureWorkspaceDirectory,
  setWorkspaceDirectory,
  restoreWorkspaceDirectory,
  enterEmptyWorkspace,
  enterTaskWorkspace,
  enterSessionWorkspace,
  activeDirectory,
} from "./workspace";
import { loadMeta, deriveChanges } from "./meta";
import { loadMemory } from "./memory";
import { loadConfigInfo, restoreInitialWorkspace } from "./init";
import { loadExecutors } from "./executor";
import { t, setLocale } from "../utils/i18n";
import { syncSectionPhases } from "../utils/section";
import { pathBreadcrumb } from "../utils/dom-utils";
import { touchReasoningPart as trackReasoningPart } from "../store/reasoning";
import { executorEventEntry } from "../utils/executor-events";
import {
  syntheticTextMessage,
  specContextText,
  planContextText,
  goalContextText,
  evaluationContextText,
} from "../utils/transcript";
// providerAuthMethods, providerState removed — renderProviderStatus deleted (Phase 4).

const runtimeState: Record<string, any> = {
  _renderedGroupKey: "",
  executorEvents: [],
  executorEventsFetchedAt: 0,
  executorRunID: "",
  globalView: false,
  settings: null,
  sse: null,
  temp: [],
  workspaceSessionID: "",
  taskSequence: 0,
  boardRetryTimer: null,
  pollTimer: null,
  conversationTimer: null,
  conversationQueued: false,
  conversationLoading: false,
  boardLoading: false,
};

function ensureBoard(): any {
  if (boardStore.board) return boardStore.board;
  const next = {
    task: null,
    overview: null,
    spec: null,
    plan: null,
    lanes: [],
    interactions: [],
    evaluation: null,
    delivery: null,
    acceptedDelivery: null,
    candidateDelivery: null,
    goalRuns: [],
    changes: [],
  };
  setBoardStore("board", next);
  return boardStore.board;
}

function upsertBoard(patch: Record<string, any>): void {
  const current = ensureBoard();
  setBoardStore("board", {
    ...current,
    ...patch,
  });
}

function goalsLane(cards: any[]): any {
  return {
    id: "goals",
    cards: Array.isArray(cards) ? cards : [],
  };
}

export function renderMeta(): void {
  const dirNode = document.getElementById("taskDir");
  const workspaceNode = document.getElementById("taskWorkspaceDir");
  const gitNode = document.getElementById("taskGit");
  if (dirNode) {
    const dir = settingsStore.directory || "";
    dirNode.innerHTML = pathBreadcrumb(dir);
    dirNode.setAttribute("title", dir || t("cwd.unavailable"));
    (dirNode as HTMLElement).dataset.empty = dir ? "false" : "true";
    const path = dirNode.querySelector(".task-dir-path");
    if (path instanceof HTMLElement) path.scrollLeft = path.scrollWidth;
  }
  if (workspaceNode) {
    const executionDir =
      Array.isArray((boardStore.board as any)?.goalRuns) &&
      (boardStore.board as any).goalRuns.find((item: any) => item?.workspaceDir)?.workspaceDir;
    const text = typeof executionDir === "string" ? executionDir : "";
    workspaceNode.textContent = text;
    workspaceNode.setAttribute("title", text);
    (workspaceNode as HTMLElement).hidden = !text;
  }
  if (gitNode) {
    const branch = boardStore.vcs?.branch || "";
    gitNode.textContent = branch ? `Git: ${branch}` : t("git.unavailable");
    gitNode.toggleAttribute("disabled", !branch);
    gitNode.setAttribute("data-actionable", branch ? "true" : "false");
  }
}

export function renderWorkspaceState(): void {
  document.body.dataset.workspace = !appStore.connected
    ? "offline"
    : boardStore.selectedTaskID
      ? "task"
      : "empty";
  document.body.dataset.connection = appStore.connectionStatus;
}

// renderVersions, renderExecutor, renderScale, setTitlebarMenu,
// showProviderMethodPicker, renderProviderStatus — REMOVED (Phase 4 cleanup).
// These DOM-rendering functions operated on elements now managed by Solid
// components (ConnectionBadge, TitlebarMenu, inline LLM config).

function renderTaskList(): void {
  bumpTasksSeq();
}

function renderConversation(): void {
  setMessages([...messageStore.messages]);
  syncSectionPhases(boardStore.board, boardStore.changes.length);
}

function renderSpec(spec?: any): void {
  if (spec !== undefined) upsertBoard({ spec });
}

function renderPlan(plan?: any): void {
  if (plan !== undefined) upsertBoard({ plan });
}

function renderGoals(cards?: any[]): void {
  if (cards !== undefined) {
    const lanes = Array.isArray((boardStore.board as any)?.lanes)
      ? (boardStore.board as any).lanes.filter((item: any) => item?.id !== "goals")
      : [];
    upsertBoard({ lanes: [goalsLane(cards), ...lanes] });
  }
}

function renderCriteria(task?: any, evaluation?: any): void {
  const patch: Record<string, any> = {};
  if (task !== undefined) patch.task = task;
  if (evaluation !== undefined) patch.evaluation = evaluation;
  if (Object.keys(patch).length > 0) upsertBoard(patch);
}

function renderEvaluation(evaluation?: any, delivery?: any): void {
  const patch: Record<string, any> = {};
  if (evaluation !== undefined) patch.evaluation = evaluation;
  if (delivery !== undefined) patch.delivery = delivery;
  if (Object.keys(patch).length > 0) upsertBoard(patch);
}

function renderOverview(overview?: any, task?: any): void {
  const patch: Record<string, any> = {};
  if (overview !== undefined) patch.overview = overview;
  if (task !== undefined) patch.task = { ...(boardStore.board?.task || {}), ...task };
  if (Object.keys(patch).length > 0) upsertBoard(patch);
}

function renderChanges(changes?: any[]): void {
  if (changes !== undefined) {
    setChanges(Array.isArray(changes) ? changes : []);
    upsertBoard({ changes: Array.isArray(changes) ? changes : [] });
  }
}

function taskBudget(task: any = boardStore.board?.task): Budget | undefined {
  const budget = task?.budget;
  if (!budget || typeof budget !== "object") return undefined;
  return {
    maxRuns: Number.isFinite(budget.maxRuns) ? budget.maxRuns : undefined,
    maxReplans: Number.isFinite(budget.maxReplans) ? budget.maxReplans : undefined,
    maxEvaluations: Number.isFinite(budget.maxEvaluations) ? budget.maxEvaluations : undefined,
    maxWallTimeMs: Number.isFinite(budget.maxWallTimeMs) ? budget.maxWallTimeMs : undefined,
  };
}

function setBudgetInputs(budget?: Budget): void {
  const setValue = (id: string, value: string): void => {
    const node = document.getElementById(id) as HTMLInputElement | null;
    if (node) node.value = value;
  };
  setValue("budgetMaxRuns", budget?.maxRuns === undefined ? "" : String(budget.maxRuns));
  setValue("budgetMaxReplans", budget?.maxReplans === undefined ? "" : String(budget.maxReplans));
  setValue(
    "budgetMaxEvaluations",
    budget?.maxEvaluations === undefined ? "" : String(budget.maxEvaluations),
  );
  setValue(
    "budgetMaxWallTime",
    budget?.maxWallTimeMs === undefined ? "" : budgetMinutes(budget.maxWallTimeMs),
  );
}

function renderBudgetState(task: any = boardStore.board?.task): void {
  const budget = taskBudget(task);
  const changed = !sameBudget(draftBudget(), budget);
  const enabled = !!task?.id && !appStore.budgetSaving;
  const saveButton = document.getElementById("btnBudgetSave") as HTMLButtonElement | null;
  const resetButton = document.getElementById("btnBudgetReset") as HTMLButtonElement | null;
  const hint = document.getElementById("budgetHint");
  if (saveButton) saveButton.disabled = !enabled || !changed;
  if (resetButton) resetButton.disabled = !enabled || (!changed && !appStore.budgetDirty);
  if (hint) {
    hint.textContent = task?.id ? t("budget.hint") : t("budget.empty");
  }
  for (const input of [
    document.getElementById("budgetMaxRuns"),
    document.getElementById("budgetMaxReplans"),
    document.getElementById("budgetMaxEvaluations"),
    document.getElementById("budgetMaxWallTime"),
  ]) {
    if (input instanceof HTMLInputElement) input.disabled = !enabled;
  }
}

export function renderBudget(task?: any): void {
  const budget = taskBudget(task);
  if (!appStore.budgetDirty) setBudgetInputs(budget);
  renderBudgetState(task);
}

function budgetSaveError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error || "").trim();
  return detail ? `${t("budget.save_failed")}: ${detail}` : t("budget.save_failed");
}

function installBudgetBindings(): void {
  const body = document.getElementById("budgetConfigBody");
  if (!(body instanceof HTMLElement) || body.dataset.boundBudget === "true") return;
  body.dataset.boundBudget = "true";

  body.addEventListener("input", () => {
    setAppStore("budgetDirty", true);
    renderBudgetState(boardStore.board?.task);
  });

  document.getElementById("btnBudgetReset")?.addEventListener("click", () => {
    setAppStore("budgetDirty", false);
    setBudgetInputs(taskBudget());
    renderBudgetState(boardStore.board?.task);
  });

  document.getElementById("btnBudgetSave")?.addEventListener("click", async () => {
    if (!boardStore.selectedTaskID || appStore.budgetSaving) return;
    setAppStore("budgetSaving", true);
    renderBudgetState(boardStore.board?.task);
    try {
      await apiJson(`task/${encodeURIComponent(boardStore.selectedTaskID)}/budget`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          budget: draftBudget() || null,
        }),
      });
      setAppStore("budgetDirty", false);
      const refreshBoard = loadBoard;
      if (typeof refreshBoard === "function") {
        await refreshBoard({ sync: true });
      }
    } catch (error) {
      console.error("Failed to update task budget", error);
      const nativeMessage = (window as any).nativeMessage;
      if (typeof nativeMessage === "function") {
        await nativeMessage(budgetSaveError(error), {
          title: t("section.budget"),
          kind: "error",
        });
      }
    } finally {
      setAppStore("budgetSaving", false);
      renderBudgetState(boardStore.board?.task);
    }
  });
}

function renderClear(): void {
  setAppStore({
    budgetDirty: false,
    budgetSaving: false,
  });
  setBudgetInputs(undefined);
  renderBudgetState(null);
  renderWorkspaceState();
  renderConversation();
}

function clearProjectScopeData(): void {
  setPath(null);
  setVcs(null);
  setTasksData([]);
  setPendingTasks([]);
  setAppStore({
    memoryFiles: [],
    memorySearchMode: false,
    preferences: [],
  });
}

function mergeMessages(left: any[], right: any[]): any[] {
  return mergeLoadedConversationMessages(left, right);
}

function touchReasoningPart(part: any): any {
  if (!part || part.type !== "reasoning") return part;
  if (typeof part.text !== "string") part.text = "";
  trackReasoningPart(part);
  return part;
}

export async function loadConversation(): Promise<void> {
  if (!boardStore.selectedTaskID) {
    setMessages([]);
    return;
  }
  if (runtimeState.conversationLoading) {
    runtimeState.conversationQueued = true;
    await runtimeState.conversationLoading;
    return;
  }
  const requestTaskID = String(boardStore.selectedTaskID || "");
  const loading = (async () => {
    do {
      runtimeState.conversationQueued = false;
      const taskID = String(boardStore.selectedTaskID || "");
      if (!taskID) {
        setMessages([]);
        return;
      }
      const transcript = await fetch(
        apiUrl(`task/${encodeURIComponent(taskID)}/transcript`),
        {
          headers: { Accept: "application/json" },
        },
      )
        .then((res) => (res.ok ? res.json() : []))
        .catch(() => []);
      const timeline = await fetch(
        apiUrl(`control/timeline?taskID=${encodeURIComponent(taskID)}`),
        {
          headers: { Accept: "application/json" },
        },
      )
        .then((res) => (res.ok ? res.json() : []))
        .catch(() => []);
      if (taskID !== boardStore.selectedTaskID) continue;
      const merged = mergeMessages(
        Array.isArray(timeline) ? timeline : [],
        Array.isArray(transcript) ? transcript : [],
      ).map((message: any) => ({
        ...message,
        parts: Array.isArray(message?.parts)
          ? message.parts.map((part: any) => touchReasoningPart(part))
          : [],
      }));
      setMessages(merged);
      const activeRunID = String(boardStore.board?.task?.activeRunID || "");
      if (activeRunID) {
        await loadExecutorEvents(activeRunID);
      } else {
        runtimeState.executorRunID = "";
        runtimeState.executorEvents = [];
        runtimeState.executorEventsFetchedAt = 0;
        clearExecutorEvents();
      }
      syncSectionPhases(boardStore.board, boardStore.changes.length);
    } while (runtimeState.conversationQueued && requestTaskID === boardStore.selectedTaskID);
  })();
  runtimeState.conversationLoading = loading;
  try {
    await loading;
  } finally {
    if (runtimeState.conversationLoading === loading) {
      runtimeState.conversationLoading = null;
    }
  }
}

function appendExecutorEvent(event: any): void {
  const normalized = executorEventEntry(event);
  if (!normalized) return;
  const runID = String(normalized.runID || "");
  if (!runID || (runtimeState.executorRunID && runtimeState.executorRunID !== runID)) return;
  appendExecutorStoreEvent(normalized);
  runtimeState.executorRunID = executorStore.runID || runID;
  runtimeState.executorEvents = [...executorStore.events];
  runtimeState.executorEventsFetchedAt = executorStore.fetchedAt;
}

function buildExecutorMessages(): any[] {
  return (Array.isArray(runtimeState.executorEvents) ? runtimeState.executorEvents : [])
    .filter((item: any) =>
      item?.runID === runtimeState.executorRunID &&
      item?.visible !== false &&
      item?.kind !== "status",
    )
    .map((item: any) => {
      const created = item.time?.created || Date.now();
      if (item.kind === "tool_call" || item.kind === "tool_result") {
        const payload =
          item?.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
            ? item.payload
            : {};
        const toolName =
          String(payload.name || payload.toolName || payload.tool || item.toolName || "").trim();
        const rawInput =
          typeof payload.input === "string"
            ? payload.input
            : typeof payload.text === "string"
              ? payload.text
              : "";
        let input =
          payload.input && typeof payload.input === "object" && !Array.isArray(payload.input)
            ? payload.input
            : {};
        if ((!input || Object.keys(input).length === 0) && rawInput.trim()) {
          try {
            const parsed = JSON.parse(rawInput);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              input = parsed;
            }
          } catch {
            input = { raw: rawInput };
          }
        }
        return {
          _synthetic: true,
          info: {
            id: String(item?.id || ""),
            role: "task_tool",
            time: { created },
          },
          parts: [{
            id: `executor-tool:${String(item?.id || created)}`,
            type: "tool",
            tool: toolName || "tool",
            state: {
              status: item.kind === "tool_result" ? "completed" : "running",
              input,
              raw: rawInput,
              title: String(item?.summary || "").trim(),
              output:
                item.kind === "tool_result"
                  ? String(payload.output || payload.result || item.output || item.summary || "")
                  : "",
            },
          }],
        };
      }
      const text = String(item?.text || item?.summary || item?.output || "").trim();
      if (!text) return null;
      return {
        _synthetic: true,
        info: {
          id: String(item?.id || ""),
          role: item.kind === "reasoning" || item.kind === "reasoning_delta" ? "planner" : "assistant",
          time: { created },
        },
        parts: [{ type: "text", text }],
      };
    })
    .filter(Boolean);
}

async function loadExecutorEvents(runID: string): Promise<void> {
  const now = Date.now();
  if (runtimeState.executorRunID === runID && now - Number(runtimeState.executorEventsFetchedAt || 0) < 3000) {
    return;
  }
  runtimeState.executorRunID = runID;
  runtimeState.executorEventsFetchedAt = now;
  const data = await fetch(apiUrl(`run/${encodeURIComponent(runID)}/executor-events`), {
    headers: { Accept: "application/json" },
  })
    .then((res) => (res.ok ? res.json() : []))
    .catch(() => []);
  runtimeState.executorEvents = (Array.isArray(data) ? data : [])
    .map((item) => executorEventEntry(item))
    .filter(Boolean);
  clearExecutorEvents();
  for (const item of runtimeState.executorEvents) {
    appendExecutorStoreEvent(item);
  }
}

function scheduleBoardCompat(delay = 0): void {
  scheduleBoardStore(delay);
}

function scheduleTasksCompat(delay = 0): void {
  if (runtimeState.tasksKick) clearTimeout(runtimeState.tasksKick);
  runtimeState.tasksKick = setTimeout(() => {
    runtimeState.tasksKick = null;
    void loadTasks();
  }, delay);
}

function scheduleConversationCompat(): void {
  renderConversation();
}

// requireLegacyGlobal removed — all callers now use direct function calls.

function stopPolling(): void {
  if (runtimeState.pollTimer) {
    clearInterval(runtimeState.pollTimer);
    runtimeState.pollTimer = null;
  }
  if (runtimeState.conversationTimer) {
    clearInterval(runtimeState.conversationTimer);
    runtimeState.conversationTimer = null;
  }
  if (runtimeState.boardRetryTimer) {
    clearTimeout(runtimeState.boardRetryTimer);
    runtimeState.boardRetryTimer = null;
  }
  stopSSE();
  runtimeState.pollTimer = null;
}

const BOARD_EVENT_DEBOUNCE = 150;

function normalizedEventType(event: any): string {
  const raw = String(event?.type || "").trim();
  return raw.startsWith("orchestrator.") ? raw.slice("orchestrator.".length) : raw;
}

function eventTaskID(event: any): string {
  return String(event?.properties?.taskID || event?.payload?.taskID || "");
}

function eventSequence(event: any): number {
  const value = Number(event?.sequence);
  return Number.isFinite(value) ? value : 0;
}

function boardInvalidatingEvent(type: string): boolean {
  return (
    type === "task.updated" ||
    type === "task.completed" ||
    type === "task.failed" ||
    type === "task.cancelled" ||
    type === "task.blocked" ||
    type.startsWith("run.") ||
    type.startsWith("plan.") ||
    type.startsWith("goal.") ||
    type.startsWith("delivery.") ||
    type.startsWith("evaluation.") ||
    type.startsWith("interaction.")
  );
}

export function handleEventStreamEvent(event: any): void {
  const type = normalizedEventType(event);
  if (type.startsWith("message.")) {
    if (shouldReloadConversationForMessageEvent({ ...event, type })) {
      void loadConversation();
      return;
    }
    enqueueEvent({
      ...event,
      type,
    });
    return;
  }
  if (type === "task.replay_expired") {
    if (boardStore.selectedTaskID) void syncTask(boardStore.selectedTaskID);
    scheduleTasksCompat(0);
    scheduleBoardCompat(0);
    return;
  }
  const taskID = eventTaskID(event);
  const sequence = eventSequence(event);
  if (taskID && taskID === boardStore.selectedTaskID && sequence > 0) {
    const current = boardStore.taskSequence;
    if (current > 0 && sequence <= current) return;
    if (current > 0 && sequence > current + 1) {
      scheduleBoardCompat(BOARD_EVENT_DEBOUNCE);
      scheduleTasksCompat(BOARD_EVENT_DEBOUNCE);
      startSSE(taskID);
      return;
    }
    setTaskSequence(sequence);
  }
  if (boardInvalidatingEvent(type)) {
    scheduleTasksCompat(BOARD_EVENT_DEBOUNCE);
    if (taskID && taskID === boardStore.selectedTaskID) {
      scheduleBoardCompat(BOARD_EVENT_DEBOUNCE);
    }
  }
}

function handleSSEEvent(event: any): void {
  const type = String(event?.type || "");
  if (type) {
    handleEventStreamEvent({
      type,
      payload: event.payload || event.properties || event,
      properties: event.properties || event.payload || event,
    });
    return;
  }
  const tool = event?.tool_call || event?.tool || null;
  const delta = event?.delta || "";
  if (tool) {
    appendExecutorEvent({
      id: event.event_id || crypto.randomUUID(),
      runID: runtimeState.executorRunID,
      kind: "tool",
      text: typeof tool === "string" ? tool : JSON.stringify(tool),
      time: { created: Date.now() },
    });
  } else if (delta) {
    appendExecutorEvent({
      id: event.event_id || crypto.randomUUID(),
      runID: runtimeState.executorRunID,
      kind: "message",
      text: String(delta),
      time: { created: Date.now() },
    });
  }
}

function appendPendingAssistantPart(
  requestID: string,
  type: "text" | "reasoning",
  delta: string,
): void {
  const chunk = typeof delta === "string" ? delta : "";
  if (!requestID || !chunk) return;
  const messageID = `pending-assistant:${requestID}`;
  const partID = `${messageID}:${type}`;
  let found = false;
  const next = messageStore.messages.map((message: any) => {
    if (message?.info?.id !== messageID) return message;
    found = true;
    const parts = Array.isArray(message?.parts) ? [...message.parts] : [];
    const index = parts.findIndex((part: any) => part?.id === partID);
    if (index >= 0) {
      const current = parts[index];
      parts[index] = {
        ...current,
        type,
        text: `${String(current?.text || "")}${chunk}`,
      };
    } else {
      parts.push({
        id: partID,
        type,
        text: chunk,
        messageID,
        sessionID: "",
      });
    }
    return {
      ...message,
      parts,
    };
  });
  if (!found) {
    next.push({
      _synthetic: true,
      info: {
        id: messageID,
        role: "assistant",
        time: { created: Date.now() },
      },
      parts: [
        {
          id: partID,
          type,
          text: chunk,
          messageID,
          sessionID: "",
        },
      ],
    });
  }
  setMessages(next);
}

function isRecoveryAwaitableError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "AbortError" || error.name === "TimeoutError";
  }
  return false;
}

export async function panelMessage(text: string, attachments: any[] = [], metadata: any = {}): Promise<any> {
  const requestID = crypto.randomUUID();
  rememberPendingTask(requestID, text);
  const controller = new AbortController();
  const target = chatAbortTarget() || undefined;
  const request: any = {
    requestID,
    controller,
    target,
    stopping: false,
    aborted: false,
    manualAbort: false,
  };
  const ensureRecovery = () => {
    if (!request.recovery) {
      request.recovery = startTaskRecovery(request);
    }
  };
  setMessages([
    ...messageStore.messages,
    {
      info: { id: `pending-user:${requestID}`, role: "user", time: { created: Date.now() } },
      parts: [{ type: "text", text }],
    },
  ]);
  setConnectionStatus("online");
  setChatRequest(request as any);
  try {
    const result = await submitMessage(text, attachments, {
      requestID,
      metadata,
      signal: controller.signal,
      onOpen: () => {
        ensureRecovery();
      },
      onEvent: async (event) => {
        ensureRecovery();
        const type = String(event?.type || "");
        if (type === "reasoning_delta") {
          appendPendingAssistantPart(requestID, "reasoning", String(event?.delta || ""));
          return;
        }
        if (type === "message_delta") {
          appendPendingAssistantPart(requestID, "text", String(event?.delta || ""));
        }
      },
    });
    request.recovery?.stop?.();
    await applyPanelResult({ ...(result as any), _request: text, _requestID: requestID });
    return result;
  } catch (error) {
    const recoveredTaskID = typeof request.recoveredTaskID === "string" && request.recoveredTaskID
      ? request.recoveredTaskID
      : !request.manualAbort &&
          isRecoveryAwaitableError(error) &&
          typeof request.recovery?.promise?.then === "function"
        ? await request.recovery.promise.catch(() => "")
        : "";
    if (!request.manualAbort && recoveredTaskID) {
      const result = { task_id: recoveredTaskID, _request: text, _requestID: requestID };
      await applyPanelResult(result);
      return result;
    }
    request.recovery?.stop?.();
    throw error;
  } finally {
    request.recovery?.stop?.();
    if ((messageStore.chatRequest as any)?.requestID === request.requestID) {
      setChatRequest(null as any);
    }
  }
}

function ensureTaskListEntry(
  taskID: string,
  requestID: string,
  requestText: string,
  resultMessage: string,
): void {
  if (!taskID) return;
  const task = boardStore.board?.task && boardStore.board.task.id === taskID
    ? boardStore.board.task
    : null;
  const now = Date.now();
  const created = Number(task?.time?.created || now);
  const updated = Number(task?.time?.updated || created);
  const title = String(
    task?.title ||
    boardStore.board?.overview?.headline ||
    requestText ||
    resultMessage ||
    taskID,
  ).trim();
  const entry = {
    task: {
      id: taskID,
      requestID: requestID || task?.requestID || "",
      title,
      status: task?.status || "planning",
      directory: task?.directory || "",
      time: {
        created,
        updated,
      },
    },
    updated_at: updated,
    pending_interactions: 0,
  };
  const rest = boardStore.tasks.filter((item: any) => item?.task?.id !== taskID);
  setTasksData([entry, ...rest]);
}

async function applyPanelResult(result: any): Promise<void> {
  const taskID = String(result?.task_id || result?.taskID || "");
  const requestText = typeof result?._request === "string" ? result._request : "";
  const requestID = String(result?._requestID || "");
  if (taskID) {
    const previousMessages = [...messageStore.messages];
    ensureTaskListEntry(taskID, requestID, requestText, String(result?.message || ""));
    if (requestID) {
      forgetPendingTask(requestID);
    }
    await selectTask(taskID, { preserveMessages: true });
    ensureTaskListEntry(taskID, requestID, requestText, String(result?.message || ""));
    if (messageStore.messages.length === 0 && previousMessages.length > 0) {
      setMessages(previousMessages);
    }
    if (result?.message) {
      const text = String(result.message);
      const alreadyVisible = messageStore.messages.some((item: any) =>
        (Array.isArray(item?.parts) ? item.parts : []).some(
          (part: any) => part?.type === "text" && String(part?.text || "") === text,
        ),
      );
      if (alreadyVisible) return;
      setMessages(
        mergeMessages(messageStore.messages, [
          syntheticTextMessage("assistant", Date.now(), text),
        ]),
      );
    }
    return;
  }
  if (result?.message) {
    setMessages(
      mergeMessages(messageStore.messages, [
        syntheticTextMessage("assistant", Date.now(), String(result.message)),
      ]),
    );
  }
}

async function nativeConfirm(message: string, options: { title?: string } = {}): Promise<boolean> {
  const showAppDialog = (window as any).showAppDialog;
  if (typeof showAppDialog !== "function") return false;
  const result = await showAppDialog({
    title: options.title || t("dialog.notice"),
    message,
    cancel: true,
  });
  return result?.confirmed === true;
}

function createManagedSession(): never {
  throw new Error("Overlay no longer supports session workspaces");
}

function openManagedSession(): never {
  throw new Error("Overlay no longer supports session workspaces");
}

function plainArray<T>(value: T[] | readonly T[] | null | undefined): T[] {
  if (!Array.isArray(value)) return [];
  return JSON.parse(JSON.stringify(value)) as T[];
}

function initSettled(): boolean {
  return (window as any).__overlayInitSettled !== false;
}

function installState(): void {
  const state = new Proxy(runtimeState, {
    get(target, prop: string) {
      switch (prop) {
        case "connected": return appStore.connected;
        case "connectionStatus": return appStore.connectionStatus;
        case "i18nReady": return appStore.i18nReady && initSettled();
        case "locale": return settingsStore.locale;
        case "serverUrl": return settingsStore.serverUrl;
        case "directory": return settingsStore.directory;
        case "directoryMode": return settingsStore.directoryMode;
        case "savedDirectory": return settingsStore.savedDirectory;
        case "tempDirectory": return settingsStore.tempDirectory;
        case "workspaceDirectory": return settingsStore.workspaceDirectory;
        case "workspaceTaskID": return settingsStore.workspaceTaskID;
        case "workspaceEpoch": return settingsStore.workspaceEpoch;
        case "unattended": return settingsStore.unattended;
        case "autoQuestion": return settingsStore.autoQuestion;
        case "autoPermission": return settingsStore.autoPermission;
        case "selectedTaskID": return boardStore.selectedTaskID;
        case "board": return boardStore.board;
        case "tasks": return plainArray(boardStore.tasks);
        case "pendingTasks": return plainArray(boardStore.pendingTasks);
        case "path": return boardStore.path;
        case "vcs": return boardStore.vcs;
        case "changes": return plainArray(boardStore.changes);
        case "boardEtag": return boardStore.boardEtag;
        case "boardSyncPending": return boardStore.boardSyncPending;
        case "boardRetryCount": return boardStore.boardRetryCount;
        case "snapshotVersion": return boardStore.snapshotVersion;
        case "taskSequence": return boardStore.taskSequence;
        case "messages": return plainArray(messageStore.messages);
        case "agentEvents": return plainArray(messageStore.agentEvents);
        case "chatRequest": return messageStore.chatRequest;
        case "sseConnected": return messageStore.sseConnected;
        case "providerCatalog": return appStore.providerCatalog;
        case "providerAuth": return appStore.providerAuth;
        case "executors": return plainArray(appStore.executors);
        case "memoryFiles": return plainArray(appStore.memoryFiles);
        case "memorySearchMode": return appStore.memorySearchMode;
        case "preferences": return plainArray(appStore.preferences);
        case "budgetDirty": return appStore.budgetDirty;
        case "budgetSaving": return appStore.budgetSaving;
        default: return target[prop];
      }
    },
    set(target, prop: string, value) {
      switch (prop) {
        case "connected":
          setConnectionStatus(value ? "online" : "offline");
          renderWorkspaceState();
          return true;
        case "locale":
          setSettingsStore("locale", String(value || ""));
          void setLocale(String(value || ""));
          return true;
        case "serverUrl":
          setSettingsStore("serverUrl", String(value || ""));
          return true;
        case "directory":
          setSettingsStore("directory", String(value || ""));
          renderMeta();
          return true;
        case "directoryMode":
          setSettingsStore("directoryMode", String(value || "temp"));
          return true;
        case "savedDirectory":
          setSettingsStore("savedDirectory", String(value || ""));
          return true;
        case "tempDirectory":
          setSettingsStore("tempDirectory", String(value || ""));
          return true;
        case "workspaceDirectory":
          setSettingsStore("workspaceDirectory", String(value || ""));
          return true;
        case "workspaceTaskID":
          setSettingsStore("workspaceTaskID", String(value || ""));
          return true;
        case "workspaceEpoch":
          setSettingsStore("workspaceEpoch", Number(value || 0));
          return true;
        case "unattended":
          setSettingsStore("unattended", value !== false);
          saveSettings();
          return true;
        case "autoQuestion":
          setSettingsStore("autoQuestion", value === true);
          return true;
        case "autoPermission":
          setSettingsStore("autoPermission", value === true);
          return true;
        case "selectedTaskID":
          setSelectedTaskID(String(value || ""));
          setBoardStore("selectedTaskID", String(value || ""));
          renderWorkspaceState();
          return true;
        case "board":
          setBoardStore("board", value ?? null);
          renderWorkspaceState();
          return true;
        case "taskSequence":
          setTaskSequence(Number(value || 0));
          return true;
        case "tasks":
          setTasksData(Array.isArray(value) ? value : []);
          return true;
        case "pendingTasks":
          setPendingTasks(Array.isArray(value) ? value : []);
          return true;
        case "path":
          setPath(value ?? null);
          return true;
        case "vcs":
          setVcs(value ?? null);
          return true;
        case "changes":
          setChanges(Array.isArray(value) ? value : []);
          return true;
        case "messages":
          setMessages(Array.isArray(value) ? value : []);
          return true;
        case "agentEvents":
          setAgentEvents(Array.isArray(value) ? value : []);
          return true;
        case "chatRequest":
          setChatRequest(value ?? null);
          return true;
        case "sseConnected":
          setSseConnected(value === true);
          return true;
        case "providerCatalog":
          setProviderCatalog(value);
          return true;
        case "providerAuth":
          setProviderAuth(value);
          return true;
        case "executors":
          setExecutors(Array.isArray(value) ? value : []);
          return true;
        case "memoryFiles":
          setAppStore("memoryFiles", Array.isArray(value) ? value : []);
          return true;
        case "memorySearchMode":
          setAppStore("memorySearchMode", value === true);
          return true;
        case "preferences":
          setAppStore("preferences", Array.isArray(value) ? value : []);
          return true;
        case "budgetDirty":
          setAppStore("budgetDirty", value === true);
          return true;
        case "budgetSaving":
          setAppStore("budgetSaving", value === true);
          return true;
        default:
          target[prop] = value;
          return true;
      }
    },
  });
  (window as any).state = state;
}

export function installLegacyGlobals(): void {
  // installState() removed — state proxy had no readers after bridge elimination.
  // runtimeState is still accessed directly within this module.
  installBudgetBindings();
  // __legacyConv: used by conversation.ts for transcript conversion helpers.
  (window as any).__legacyConv = {
    t,
    syntheticTextMessage,
    specContextText,
    planContextText,
    goalContextText,
    evaluationContextText,
    deliveryStatusLabel: (status: string) => status,
  };
  // All other window globals eliminated — callers use direct imports.
}
