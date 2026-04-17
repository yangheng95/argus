// ── Entry Point ──
// Self-sufficient Solid.js entry point.
// Mounts all Solid components and initialises the application.
// Self-sufficient — no external script dependencies.

import { render } from "solid-js/web";
import { createEffect, createRoot, createSignal, onCleanup } from "solid-js";
import { Conversation } from "./components/Conversation";
import { TaskList } from "./components/TaskList";
import { Board, statusIcon as statusIconSvg } from "./components/Board";
import { ChatComposer } from "./components/ChatComposer";
import { WindowControls } from "./components/WindowControls";
import { TitlebarMenu } from "./components/TitlebarMenu";
import { ConnectionBadge } from "./components/ConnectionBadge";
import { SessionTokenBadge } from "./components/SessionTokenBadge";
import { ChangesPanel } from "./components/ChangesPanel";
import { LogViewer } from "./components/LogViewer";
import {
  WorkspacePanel,
  type WorkspaceView,
} from "./components/WorkspacePanel";
import { initApp } from "./services/init";
import { loadTasks, boardStore, loadBoard, setBoardStore, setBoardData } from "./store/board";
import {
  messageStore,
  setAgentEvents,
  setMessages,
  setSelectedTaskID,
  setSseConnected,
} from "./store/messages";
import { appStore, setAppStore } from "./store/app";
import {
  selectTask,
  retryTask,
  replanTask,
  cancelTask,
  createTask,
  deleteTask,
} from "./services/task";
import { canComposeChat, stopChatRequest } from "./services/chat";
import { isTaskInterruptable } from "./store/board";
import { setLocale } from "./utils/i18n";
import { apiJson, configure as configureApi } from "./services/api";
import { t } from "./utils/i18n";
import { formatDuration } from "./utils/time";
import { renderMarkdown, escapeHtml } from "./utils/markdown";
import { copyChatConversation } from "./utils/transcript";
import {
  applyTheme,
  applyZoom,
  applyWindowOpacity,
  sanitizeZoom,
  handleZoomHotkey,
  installSystemThemeListener,
  toggleDevtools,
} from "./services/theme";
import { settingsStore, setSettingsStore, saveSettings } from "./store/settings";
import { initPaneResizers, cancelPaneResize, currentUIScale } from "./services/pane";
import { installBudgetBindings, renderBudget } from "./services/budget";
import { panelMessage } from "./services/chat";
import PromptCatalog from "./components/settings/PromptCatalog";
import ChannelsPanel from "./components/settings/ChannelsPanel";
import SkillMarketPanel from "./components/settings/SkillMarketPanel";
import ProvidersPanel from "./components/settings/ProvidersPanel";
import GeneralPanel from "./components/settings/GeneralPanel";
import AgentModelsPanel from "./components/settings/AgentModelsPanel";
import { PermissionsPanel } from "./components/settings/PermissionsPanel";
import { MemoryPanel } from "./components/MemoryPanel";
import { PermissionAutoResolver } from "./components/PermissionAutoResolver";
import { WelcomeToast } from "./components/WelcomeToast";
import { waitForLogDrain, AppLog } from "./utils/log";
import { teardownApp } from "./services/init";
import { stopTimers } from "./services/sync";
import { nativePrompt } from "./utils/native";
import { installAppDialogBridge } from "./services/app-dialog";
import { eventClosest } from "./utils/dom-utils";
import { shortPath } from "./utils/tool";
import { initGitCurrent } from "./utils/git";
import {
  applyDirectory,
  browseDirectory,
  createDirectory,
  openDirectory,
  setDirectory,
  activeDirectory,
  loadRecentDirectories,
  removeRecentDirectory,
} from "./services/workspace";
import { openConfigDialog, switchConfigTab, setupDialogBackdropClose, installSettingsFormHandlers, renderAboutVersion } from "./services/dialog";
import { installInlineLlmConfig, refreshInlineLlmConfig } from "./services/llm-inline";
import { loadConversation } from "./store/messages";
import { executorSelectable, executorCurrentModel, setExecutorModel } from "./services/executor";
import { syncExecutorWidth } from "./services/window";
import {
  mainMessages,
  userContextMessages,
  agentCardItems,
  combineConversation,
} from "./utils/conversation";

// ── Module teardown ──
// Centralised cleanup for top-level document/window listeners and Solid roots.
// Triggered on beforeunload and on Vite HMR dispose so subsequent module
// re-executions don't stack duplicate handlers and effects.
const moduleTeardown = new AbortController();
const disposers: Array<() => void> = [];
function runModuleTeardown() {
  if (!moduleTeardown.signal.aborted) moduleTeardown.abort();
  for (const d of disposers.splice(0)) {
    try { d(); } catch { /* best-effort cleanup */ }
  }
}
if ((import.meta as any).hot) {
  (import.meta as any).hot.dispose(runModuleTeardown);
}
const listenerOpts = { signal: moduleTeardown.signal } as const;

// ── Application-level signals (shared across mount points) ──

const [logOpen, setLogOpen] = createSignal(false);

// ── Workspace (secondary panel, stacked above composer) state ──
// workspaceOpen drives layout visibility; workspaceView is remembered across
// open/close cycles so reopening restores the last active view.
const [workspaceOpen, setWorkspaceOpen] = createSignal(false);
const [workspaceView, setWorkspaceView] = createSignal<WorkspaceView>({
  kind: "diff",
  filePath: "",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Open the workspace panel, optionally with a specific view. If no view is
 * supplied, the last-used view is restored.
 */
function openWorkspace(view?: WorkspaceView): void {
  if (view) setWorkspaceView(view);
  setWorkspaceOpen(true);
}

/** Close the workspace panel. */
function closeWorkspace(): void {
  setWorkspaceOpen(false);
}

/** Toggle the workspace open/closed, restoring the remembered view. */
function toggleWorkspace(): void {
  if (workspaceOpen()) closeWorkspace();
  else openWorkspace();
}

/** Open (or switch to) a diff file in the workspace. */
function openWorkspaceDiff(filePath: string): void {
  openWorkspace({ kind: "diff", filePath });
}

/** Open (or switch to) a file preview in the workspace. */
function openWorkspaceFile(filePath: string): void {
  openWorkspace({ kind: "file", filePath });
}

// Exposed for services and window-level bridges that need to trigger the
// workspace from outside this module (e.g. ChangesPanel clicks).
(window as any).openWorkspaceDiff = openWorkspaceDiff;
(window as any).openWorkspaceFile = openWorkspaceFile;

// Delegate clicks on rendered-markdown file links (see utils/markdown.ts —
// codespans that look like file paths are emitted with data-file-path).
// A single document-level listener keeps this decoupled from the message
// rendering path, which re-runs on every stream tick.
document.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement | null;
  if (!target) return;
  const link = target.closest<HTMLElement>("[data-file-path]");
  if (!link) return;
  const path = link.getAttribute("data-file-path");
  if (!path) return;
  ev.preventDefault();
  openWorkspaceFile(path);
}, listenerOpts);

function installGlobalBridges(): void {
  installAppDialogBridge();
  (window as any).renderMarkdown = renderMarkdown;
  (window as any).persistOverlaySettings = async () => {
    saveSettings();
  };
  (window as any).stepZoom = (delta: number) => {
    const next = sanitizeZoom((settingsStore.zoom || 1) + delta);
    setSettingsStore("zoom", next);
    applyZoom(next);
    saveSettings();
  };
  // Benchmark / test instrumentation: direct bridge into reactive stores.
  // Tests mutate this proxy and expect the real Solid UI to update immediately.
  const testStateTarget: Record<string, unknown> = {};
  const readState = (prop: PropertyKey): unknown => {
    if (typeof prop !== "string") return Reflect.get(testStateTarget, prop);
    if (prop === "directory") return activeDirectory();
    if (prop === "board") return boardStore.board;
    if (prop === "tasks") return boardStore.tasks;
    if (prop === "pendingTasks") return boardStore.pendingTasks;
    if (prop === "selectedTaskID") return boardStore.selectedTaskID;
    if (prop === "path") return boardStore.path;
    if (prop === "vcs") return boardStore.vcs;
    if (prop === "changes") return boardStore.changes;
    if (prop === "messages") return messageStore.messages;
    if (prop === "agentEvents") return messageStore.agentEvents;
    if (prop === "sseConnected") return messageStore.sseConnected;
    if (prop in appStore) return (appStore as unknown as Record<string, unknown>)[prop];
    if (prop === "settings") return settingsStore;
    if (prop in settingsStore) return (settingsStore as unknown as Record<string, unknown>)[prop];
    return Reflect.get(testStateTarget, prop);
  };
  const writeState = (prop: PropertyKey, value: unknown): boolean => {
    if (typeof prop !== "string") return Reflect.set(testStateTarget, prop, value);
    if (prop === "directory") {
      setSettingsStore("directory", typeof value === "string" ? value : "");
      return true;
    }
    if (prop === "board") {
      setBoardData(value as any);
      return true;
    }
    if (prop === "tasks") {
      setBoardStore("tasks", Array.isArray(value) ? (value as any[]) : []);
      return true;
    }
    if (prop === "pendingTasks") {
      setBoardStore("pendingTasks", Array.isArray(value) ? (value as any[]) : []);
      return true;
    }
    if (prop === "selectedTaskID") {
      const next = typeof value === "string" ? value : "";
      setBoardStore("selectedTaskID", next);
      setSelectedTaskID(next);
      return true;
    }
    if (prop === "path") {
      setBoardStore("path", value as any);
      return true;
    }
    if (prop === "vcs") {
      setBoardStore("vcs", value as any);
      return true;
    }
    if (prop === "changes") {
      setBoardStore("changes", Array.isArray(value) ? (value as any[]) : []);
      return true;
    }
    if (prop === "messages") {
      setMessages(Array.isArray(value) ? (value as any[]) : []);
      return true;
    }
    if (prop === "agentEvents") {
      setAgentEvents(Array.isArray(value) ? (value as any[]) : []);
      return true;
    }
    if (prop === "sseConnected") {
      setSseConnected(value === true);
      return true;
    }
    if (prop in appStore) {
      setAppStore(prop as any, value as any);
      return true;
    }
    if (prop in settingsStore) {
      setSettingsStore(prop as any, value as any);
      return true;
    }
    return Reflect.set(testStateTarget, prop, value);
  };
  (window as any).state = new Proxy(testStateTarget, {
    get(_target, prop) {
      return readState(prop);
    },
    set(_target, prop, value) {
      return writeState(prop, value);
    },
    ownKeys() {
      return Array.from(
        new Set([
          ...Reflect.ownKeys(testStateTarget),
          ...Object.keys(boardStore),
          ...Object.keys(messageStore),
          ...Object.keys(appStore),
          ...Object.keys(settingsStore),
          "directory",
          "settings",
        ]),
      );
    },
    getOwnPropertyDescriptor(_target, prop) {
      return {
        configurable: true,
        enumerable: true,
        writable: true,
        value: readState(prop),
      };
    },
  });
  (window as any).renderConversation = () =>
    combineConversation(mainMessages(), userContextMessages(), agentCardItems());
  (window as any).applyDirectory = applyDirectory;
  (window as any).loadTasks = loadTasks;
  (window as any).selectTask = selectTask;
  (window as any).loadBoard = loadBoard;
  (window as any).loadConversation = loadConversation;
}

function installGoalFormHandlers(): void {
  const form = document.getElementById("goalForm") as HTMLFormElement | null;
  const dialog = document.getElementById("goalDialog") as HTMLDialogElement | null;
  const cancelBtn = document.getElementById("btnCancelGoal");
  if (!form || !dialog) return;
  if ((form as any).__goalBound) return;
  (form as any).__goalBound = true;

  cancelBtn?.addEventListener("click", () => dialog.close());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!boardStore.selectedTaskID) return;
    const goalID = (document.getElementById("goalId") as HTMLInputElement | null)?.value.trim() || "";
    const title = (document.getElementById("goalDescription") as HTMLTextAreaElement | null)?.value.trim() || "";
    const acceptanceText = (document.getElementById("goalCriteria") as HTMLTextAreaElement | null)?.value.trim() || "";
    if (!title) return;

    try {
      if (goalID) {
        // The backend's UpdateGoalInput requires acceptance_specs[].min(1).
        // Wrap the operator's free-text criterion into a single essential
        // llm_judge spec — same shape that addOperatorGoal synthesizes when
        // an operator-defined goal arrives without structured specs. We
        // intentionally keep the form simple (one textarea) rather than
        // expose the full spec editor; richer authoring belongs to the
        // requirements agent's structured tools.
        const fallbackCriterion = "The requested change is implemented and acceptance checks pass.";
        const criterion = acceptanceText || fallbackCriterion;
        const acceptanceSpec = {
          id: `acc-operator-${goalID}-${Date.now()}`,
          source_requirement_id: "operator",
          goal_id: goalID,
          title: title.slice(0, 80),
          severity: "essential",
          scorers: [
            {
              type: "llm_judge",
              name: "operator-acceptance",
              criteria: criterion,
              inputs: ["delivery_summary", "changed_files"],
            },
          ],
        };
        await panelMessage(`Update goal ${goalID}.`, {
          goalID,
          description: title,
          acceptance_specs: [acceptanceSpec],
          taskID: boardStore.selectedTaskID || undefined,
        });
      } else {
        const payload = acceptanceText ? `/goal ${title}\nAcceptance: ${acceptanceText}` : `/goal ${title}`;
        await panelMessage(payload, {
          taskID: boardStore.selectedTaskID || undefined,
        });
      }
      dialog.close();
      await loadBoard({ sync: true });
    } catch (err) {
      console.error("Failed to save goal", err);
    }
  });
}

installGlobalBridges();
installBudgetBindings();
installInlineLlmConfig();
setupDialogBackdropClose();
installSettingsFormHandlers();
installGoalFormHandlers();

// ── Mount: Conversation ──

const chatScroll = document.getElementById("chatScroll");
if (chatScroll) {
  chatScroll.innerHTML = "";
  render(() => <Conversation container={chatScroll} />, chatScroll);
}

// ── Mount: WorkspacePanel (Diff / File / Trace) ──

const workspaceMountEl = document.getElementById("solidWorkspaceMount");
if (workspaceMountEl) {
  workspaceMountEl.innerHTML = "";
  render(
    () => (
      <WorkspacePanel
        view={workspaceView()}
        onSelectView={setWorkspaceView}
        onClose={closeWorkspace}
      />
    ),
    workspaceMountEl,
  );
}

// ── Mount: TaskList ──

const taskListEl = document.getElementById("taskListPanel");
if (taskListEl) {
  taskListEl.innerHTML = "";
  render(
    () => (
      <TaskList
        onSelectTask={(taskID) => void selectTask(taskID)}
        onDeleteTask={(taskID) => void deleteTask(taskID)}
        onCancelTask={(taskID) => void cancelTask(taskID)}
      />
    ),
    taskListEl,
  );
}

// ── Mount: Board (Spec / Plan / Goals / Criteria / Delivery / Interactions) ──

const boardEl = document.getElementById("solidBoardMount");
if (boardEl) {
  boardEl.innerHTML = "";
  render(
    () => (
      <Board
        onRetry={async () => {
          const id = boardStore.selectedTaskID;
          if (!id) return;
          void retryTask(id);
        }}
        onReplan={() => {
          const id = boardStore.selectedTaskID;
          if (id) void replanTask(id);
        }}
        onCancel={() => {
          const id = boardStore.selectedTaskID;
          if (id) void cancelTask(id);
        }}
        onEditGoal={(goalId, title, detail) => {
          const goalDialog = document.getElementById("goalDialog") as HTMLDialogElement | null;
          const goalIdInput = document.getElementById("goalId") as HTMLInputElement | null;
          const goalDesc = document.getElementById("goalDescription") as HTMLTextAreaElement | null;
          const goalCrit = document.getElementById("goalCriteria") as HTMLTextAreaElement | null;
          if (!goalDialog || !goalIdInput || !goalDesc || !goalCrit) return;
          goalIdInput.value = goalId || "";
          goalDesc.value = title || "";
          goalCrit.value = detail || "";
          goalDialog.showModal();
        }}
        onDeleteGoal={async (goalId) => {
          if (!goalId || !boardStore.selectedTaskID) return;
          const nativeConfirm = (window as any).nativeConfirm;
          if (typeof nativeConfirm === "function") {
            const ok = await nativeConfirm(t("goal.delete_button_title"), {
              title: t("goal.title"),
              okLabel: t("common.delete"),
              kind: "warning",
            });
            if (!ok) return;
          }
          try {
            await panelMessage(`Delete goal ${goalId}.`, {
              goalID: goalId,
              taskID: boardStore.selectedTaskID || undefined,
            });
            await loadBoard({ sync: true });
          } catch (e) {
            console.error("Failed to delete goal", e);
          }
        }}
      />
    ),
    boardEl,
  );
}

// ── Mount: ChatComposer ──

// One-shot follow-up suggestion the composer should pre-fill after a task
// finishes. Populated by a busy→idle effect below; cleared by the composer
// via onSuggestionConsumed after it either injects or drops the value.
const [pendingSuggestion, setPendingSuggestion] = createSignal("");
// Track the previous task-busy state so we only fire once per finish edge.
let lastTaskBusy = false;
let lastSuggestionTaskID: string | null = null;
createEffect(() => {
  const busyNow =
    !!messageStore.chatRequest || isTaskInterruptable();
  const wasBusy = lastTaskBusy;
  lastTaskBusy = busyNow;
  // Each busy→true edge resets the guard so the next finish is eligible for
  // a fresh suggestion even if it's the same task.
  if (busyNow && !wasBusy) {
    lastSuggestionTaskID = null;
    return;
  }
  if (!wasBusy || busyNow) return;
  const taskID = boardStore.selectedTaskID;
  if (!taskID) return;
  if (lastSuggestionTaskID === taskID) return;
  lastSuggestionTaskID = taskID;
  void apiJson(`task/${encodeURIComponent(taskID)}/followup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
    .then((data: any) => {
      const text = typeof data?.suggestion === "string" ? data.suggestion.trim() : "";
      if (text) setPendingSuggestion(text);
    })
    .catch((err) => {
      AppLog.warn("main", "followup suggestion failed", err);
    });
});

const composerEl = document.getElementById("solidChatComposer");
if (composerEl) {
  render(
    () => (
      <ChatComposer
        enabled={canComposeChat()}
        // Composer busy ≡ a send request is in flight (SSE stream open).
        // A running task no longer disables the composer: the user can queue
        // additional messages; `panelMessage` routes them as operator notes /
        // inject via `task/:id/message`. Task cancellation lives on the task
        // row's CancelButton, not in the composer.
        busy={!!messageStore.chatRequest}
        stopping={!!(messageStore.chatRequest as any)?.stopping}
        pendingSuggestion={pendingSuggestion()}
        onSuggestionConsumed={() => setPendingSuggestion("")}
        onSubmit={(text, attachments, webSearch) => {
          void panelMessage(text, attachments, webSearch ? { web_search: true } : {});
        }}
        onStop={() => {
          // Abort the in-flight send request ONLY — no remote cancel. Task-level
          // interrupt is an explicit action on the task row's CancelButton so a
          // stray composer stop never tears down the underlying task.
          if (messageStore.chatRequest) {
            void stopChatRequest({ remote: false });
          }
        }}
      />
    ),
    composerEl,
  );
}

// ── Wire: Terminate button ──

const btnTerminateRun = document.getElementById("btnTerminateRun");
if (btnTerminateRun) {
  btnTerminateRun.addEventListener("click", () => {
    // If there's an active chat request (SSE stream), stop it first
    if (messageStore.chatRequest) {
      void stopChatRequest();
      return;
    }
    // Otherwise cancel the active task
    const taskID = boardStore.selectedTaskID;
    if (taskID) void cancelTask(taskID);
  });
}

// ── Mount: WindowControls ──

const windowControlsEl = document.getElementById("solidWindowControls");
if (windowControlsEl) {
  render(() => <WindowControls />, windowControlsEl);
}

// ── Mount: TitlebarMenu ──

const titlebarMenuEl = document.getElementById("solidTitlebarMenu");
if (titlebarMenuEl) {
  render(
    () => (
      <TitlebarMenu
        onLocaleChange={(locale) => {
          setSettingsStore("locale", locale);
          saveSettings();
        }}
        onOpenLog={() => setLogOpen(true)}
        onOpenSettings={() => {
          openConfigDialog();
        }}
      />
    ),
    titlebarMenuEl,
  );
}

// ── Mount: ConnectionBadge ──

const connBadgeEl = document.getElementById("solidConnBadge");
if (connBadgeEl) {
  render(() => <ConnectionBadge />, connBadgeEl);
}

// ── Mount: SessionTokenBadge ──

const sessionTokenBadgeEl = document.getElementById("solidSessionTokenBadge");
if (sessionTokenBadgeEl) {
  render(() => <SessionTokenBadge />, sessionTokenBadgeEl);
}

// ── Mount: ChangesPanel ──

const changesPanelEl = document.getElementById("solidChangesPanel");
if (changesPanelEl) {
  render(
    () => <ChangesPanel hasSelectedTask={!!boardStore.selectedTaskID} />,
    changesPanelEl,
  );
}

// ── Mount: LogViewer (renders its own <dialog id="logDialog">) ──

const logViewerEl = document.getElementById("solidLogViewer");
if (logViewerEl) {
  render(
    () => (
      <LogViewer
        open={logOpen()}
        onClose={() => setLogOpen(false)}
      />
    ),
    logViewerEl,
  );
}

// ── Mount: Config Dialog Panels ──

const promptBody = document.getElementById("promptBody");
if (promptBody) {
  promptBody.innerHTML = "";
  render(() => <PromptCatalog />, promptBody);
}

const generalBody = document.getElementById("generalBody");
if (generalBody) {
  generalBody.innerHTML = "";
  render(() => <GeneralPanel />, generalBody);
}

const permissionsBody = document.getElementById("permissionsBody");
if (permissionsBody) {
  permissionsBody.innerHTML = "";
  render(() => <PermissionsPanel />, permissionsBody);
}

const channelConfigBody = document.getElementById("channelConfigBody");
if (channelConfigBody) {
  channelConfigBody.innerHTML = "";
  render(() => <ChannelsPanel />, channelConfigBody);
}

const extensionsConfigBody = document.getElementById("extensionsConfigBody");
if (extensionsConfigBody) {
  extensionsConfigBody.innerHTML = "";
  render(() => <SkillMarketPanel />, extensionsConfigBody);
}

const memoryBody = document.getElementById("memoryBody");
if (memoryBody) {
  memoryBody.innerHTML = "";
  render(
    () => <MemoryPanel taskID={boardStore.selectedTaskID || undefined} />,
    memoryBody,
  );
}

const providersConfigBody = document.getElementById("providersConfigBody");
if (providersConfigBody) {
  providersConfigBody.innerHTML = "";
  render(() => <ProvidersPanel />, providersConfigBody);
}

// AgentModelsPanel auto-fetches at mount via createResource. Defer mount until
// initApp() has run syncApiConfig(), otherwise the initial /agent +
// /config/providers fetches go out before credentials/serverUrl are set —
// which hangs the WebView when Basic auth is configured.

// ── Mount: PermissionAutoResolver (headless) ──
// Permission cards render inline in the conversation via InteractionCard.
// This mount only drives auto-approval when experimental.auto_permission
// is enabled — it renders nothing.

const interactionMountEl = document.getElementById("solidInteractionMount");
if (interactionMountEl) {
  render(() => <PermissionAutoResolver />, interactionMountEl);
}

// ── Native dialog close handlers ──
// Settings dialog (configDialog) close button — no longer handles it.

document.addEventListener("DOMContentLoaded", () => {
  const openSettings = () => openConfigDialog();
  document.getElementById("btnConfigToggle")?.addEventListener("click", openSettings);
  document.getElementById("btnConfigToggle")?.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openSettings();
  });
  document
    .getElementById("btnCloseConfigDialog")
    ?.addEventListener("click", () => {
      (
        document.getElementById("configDialog") as HTMLDialogElement | null
      )?.close();
    });
  document
    .getElementById("btnCloseSession")
    ?.addEventListener("click", () => {
      (document.getElementById("sessionDialog") as HTMLDialogElement | null)?.close();
    });

 // ── Config tab navigation ──
  document.getElementById("configSidebar")?.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>(".config-nav-item");
    const tab = btn?.dataset.configTab;
    if (tab) switchConfigTab(tab);
  });

 // ── Brand version → open channel config ──
  document.getElementById("brandVersion")?.addEventListener("click", () => {
    openConfigDialog("channel");
  });

 // ── Config sidebar resizer ──
  {
    const configResizer = document.getElementById("configResizer");
    const configSidebar = document.getElementById("configSidebar");
    configResizer?.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !configSidebar) return;
      configResizer.dataset.active = "true";
      document.body.dataset.resizing = "true";
      e.preventDefault();
      const layout = configSidebar.parentElement;
      function onMove(ev: PointerEvent) {
        if (!layout) return;
        const rect = layout.getBoundingClientRect();
        const scale = currentUIScale();
        const min = 140 * scale;
        const max = 320 * scale;
        const next = Math.round(Math.min(max, Math.max(min, ev.clientX - rect.left)));
        configSidebar!.style.width = next + "px";
        configSidebar!.style.minWidth = next + "px";
      }
      function onUp() {
        delete configResizer!.dataset.active;
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

 // ── Workspace panel resizer ──
 // Drag the horizontal divider above the workspace to adjust its height.
 // Height is persisted to settings.workspacePanelHeight and applied as an
 // inline style on #solidWorkspaceMount. The workspace is stacked inside
 // #chatSection between #chatScroll and #solidChatComposer.
  {
    const resizer = document.getElementById("workspaceResizer");
    const mount = document.getElementById("solidWorkspaceMount");
    const applyHeight = (px: number) => {
      if (!mount) return;
      mount.style.height = px + "px";
      mount.style.minHeight = px + "px";
      mount.style.maxHeight = px + "px";
    };
    // Restore persisted height on startup.
    if (settingsStore.workspacePanelHeight != null) {
      applyHeight(settingsStore.workspacePanelHeight);
    }
    resizer?.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !mount) return;
      resizer.dataset.active = "true";
      // "row" — use row-resize cursor globally during the drag, distinct
      // from column resizers which set data-resizing="true".
      document.body.dataset.resizing = "row";
      e.preventDefault();
      const chatSection = document.getElementById("chatSection");
      const composer = document.getElementById("solidChatComposer");
      function onMove(ev: PointerEvent) {
        if (!chatSection) return;
        const rect = chatSection.getBoundingClientRect();
        const scale = currentUIScale();
        // Leave room for chat-scroll (minimum) and the composer above/below.
        const composerH = composer?.getBoundingClientRect().height ?? 0;
        const chatScrollMin = 160 * scale;
        const min = 160 * scale;
        const max = Math.max(
          min + 40,
          rect.height - chatScrollMin - composerH,
        );
        // Workspace is directly above the composer — its height is measured
        // from the top edge of the composer upward to the pointer.
        const composerTop = composer
          ? composer.getBoundingClientRect().top
          : rect.bottom;
        const next = Math.round(
          Math.min(max, Math.max(min, composerTop - ev.clientY)),
        );
        applyHeight(next);
      }
      function onUp() {
        delete resizer!.dataset.active;
        delete document.body.dataset.resizing;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        // Persist the final height.
        const height = mount && mount.style.height
          ? parseInt(mount.style.height, 10)
          : null;
        if (Number.isFinite(height) && height! > 0) {
          setSettingsStore("workspacePanelHeight", height);
          saveSettings();
        }
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  }

 // ── Sidebar buttons ──
  document.getElementById("btnRefreshTasks")?.addEventListener("click", () => {
    void loadTasks();
  });
  document.getElementById("btnSidebarToggle")?.addEventListener("click", () => {
    const next = !settingsStore.sidebarCollapsed;
    setSettingsStore("sidebarCollapsed", next);
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.dataset.collapsed = String(next);
    const toggleBtn = document.getElementById("btnSidebarToggle");
    if (toggleBtn) toggleBtn.title = next ? t("sidebar.open") : t("sidebar.close");
    saveSettings();
  });
  document.getElementById("btnCreateTask")?.addEventListener("click", () => {
    // Deselect current task and focus the composer — the user types their
    // request directly in the ChatComposer, no modal dialog needed.
    void selectTask("");
    const textarea = document.querySelector<HTMLTextAreaElement>("#solidChatComposer textarea");
    textarea?.focus();
  });

  // ── Executor selection ──

  /** Map executor ID → provider IDs whose models are relevant for that executor. */
  const EXECUTOR_PROVIDER_MAP: Record<string, string[]> = {
    codex: ["openai-codex", "openai"],
    "claude-code": ["anthropic"],
  };

  /** Derive model list from the live provider catalog instead of a hardcoded list. */
  function executorModels(executorID: string): string[] {
    const catalog = appStore.providerCatalog;
    if (!catalog?.all) return [];
    const providerIDs = EXECUTOR_PROVIDER_MAP[executorID];
    if (!providerIDs) return [];
    const models: string[] = [];
    for (const provider of (catalog.all as any[])) {
      if (!providerIDs.includes(provider.id)) continue;
      if (!provider.models || typeof provider.models !== "object") continue;
      for (const model of Object.values(provider.models) as any[]) {
        if (model?.id) models.push(model.id);
      }
    }
    return models;
  }

  function syncExecutorUI() {
    const active = settingsStore.executor || "opencode";
    document.querySelectorAll<HTMLElement>("[data-executor]").forEach((btn) => {
      btn.dataset.active = String(btn.dataset.executor === active);
    });
  }
  syncExecutorUI();
  syncExecutorWidth();

  function executorModelPanel(id: string): HTMLElement | null {
    if (id === "codex") return document.getElementById("codexModelPanel");
    if (id === "claude-code") return document.getElementById("claudeCodeModelPanel");
    return null;
  }

  function closeAllModelPanels() {
    document.getElementById("codexModelPanel")?.setAttribute("hidden", "");
    document.getElementById("claudeCodeModelPanel")?.setAttribute("hidden", "");
  }

  function renderModelPanel(executorID: string) {
    const panel = executorModelPanel(executorID);
    if (!panel) return;
    const current = executorCurrentModel(executorID);
    const models = executorModels(executorID);
    const currentLabel = current
      ? `<div class="engine-model-current">${escapeHtml(t("executor.current_model"))}: <strong>${escapeHtml(current)}</strong></div>`
      : "";
    const items = models.map((mid) =>
      `<button type="button" class="engine-model-item" data-executor-model="${escapeHtml(mid)}" data-active="${mid === current}">${escapeHtml(mid)}</button>`,
    ).join("");
    panel.innerHTML = currentLabel + (items || `<div class="engine-model-current">${escapeHtml(t("empty.overview"))}</div>`);
  }

  function openModelPanel(executorID: string) {
    closeAllModelPanels();
    const panel = executorModelPanel(executorID);
    if (!panel) return;
    renderModelPanel(executorID);
    const caret = document.querySelector<HTMLElement>(`[data-executor-caret="${executorID}"]`);
    if (caret) {
      const rect = caret.getBoundingClientRect();
      panel.style.top = `${Math.round(rect.bottom + 6)}px`;
      panel.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
      panel.style.transform = "translateX(-50%)";
    }
    panel.removeAttribute("hidden");
  }

  const engineBar = document.getElementById("engineBar");
  engineBar?.addEventListener("click", async (event) => {
    // Model panel caret toggle
    const caret = (event.target as HTMLElement).closest<HTMLElement>("[data-executor-caret]");
    if (caret) {
      event.stopPropagation();
      const id = caret.dataset.executorCaret;
      if (!id) return;
      const panel = executorModelPanel(id);
      if (!panel) return;
      if (panel.hasAttribute("hidden")) {
        openModelPanel(id);
      } else {
        closeAllModelPanels();
      }
      return;
    }
    // Model item selection
    const modelItem = (event.target as HTMLElement).closest<HTMLElement>("[data-executor-model]");
    if (modelItem) {
      event.stopPropagation();
      const model = modelItem.dataset.executorModel;
      const wrap = modelItem.closest<HTMLElement>("[data-executor-wrap]");
      const executorID = wrap?.dataset.executorWrap;
      if (executorID && model) {
        closeAllModelPanels();
        await setExecutorModel(executorID, model);
      }
      return;
    }
    // Executor chip selection
    const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-executor]");
    if (!chip || chip.classList.contains("engine-chip-caret")) return;
    const id = chip.dataset.executor;
    if (!id) return;
    if (!executorSelectable(id)) return;
    setSettingsStore("executor", id);
    saveSettings();
    syncExecutorUI();
  });

  // Close model panels on outside click / Escape
  document.addEventListener("click", (e) => {
    if ((e.target as HTMLElement)?.closest?.("[data-executor-caret]") || (e.target as HTMLElement)?.closest?.(".engine-model-panel")) return;
    closeAllModelPanels();
  }, listenerOpts);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllModelPanels();
  }, listenerOpts);
});

// ── Initialise application ──

document.getElementById("btnWorkspaceToggle")?.addEventListener("click", () => {
  toggleWorkspace();
});
document.getElementById("btnChatCopyAll")?.addEventListener("click", () => {
  void copyChatConversation();
});

disposers.push(createRoot((dispose) => {
  createEffect(() => {
    document.body.dataset.workspace = !appStore.connected
      ? "offline"
      : boardStore.selectedTaskID
        ? "task"
        : "empty";
    document.body.dataset.connection = appStore.connectionStatus;
  });

  createEffect(() => {
    applyTheme(settingsStore.theme);
    applyZoom(settingsStore.zoom);
    void applyWindowOpacity(settingsStore.opacity);
  });

  createEffect(() => {
    configureApi({
      serverUrl: settingsStore.serverUrl,
      username: settingsStore.username,
      password: settingsStore.password,
      directory: settingsStore.directory,
    });
  });

  createEffect(() => {
    void setLocale(settingsStore.locale);
  });

  createEffect(() => {
    settingsStore.locale;
    appStore.config;
    appStore.providerCatalog;
    appStore.providerAuth;
    appStore.providerTest;
    refreshInlineLlmConfig();
  });

  createEffect(() => {
    const count = messageStore.messages.length;
    const chatCount = document.getElementById("chatCount");
    const copyBtn = document.getElementById("btnChatCopyAll") as HTMLButtonElement | null;
    if (chatCount) chatCount.textContent = count > 0 ? String(count) : "";
    if (copyBtn) copyBtn.disabled = count === 0;
  });

  // ── Task-switch progress bar (non-blocking) ──
  // Reflects boardStore.taskSwitching (set synchronously at selectTask entry,
  // cleared when the async load chain completes). The bar lives in a fixed
  // slot above the chat header so user input is never gated on load.
  createEffect(() => {
    const active = boardStore.taskSwitching;
    const bar = document.getElementById("taskSwitchProgress");
    if (!bar) return;
    bar.setAttribute("data-active", active ? "true" : "false");
    bar.setAttribute("aria-busy", active ? "true" : "false");
  });

  // ── Workspace visibility ──
  // Drives the show/hide of the workspace mount + resizer.
  createEffect(() => {
    const open = workspaceOpen();

    const mount = document.getElementById("solidWorkspaceMount");
    const resizer = document.getElementById("workspaceResizer");
    if (mount) (mount as HTMLElement).hidden = !open;
    if (resizer) (resizer as HTMLElement).hidden = !open;

    // Reflect open state on the toggle button for visual/a11y feedback.
    const toggleBtn = document.getElementById("btnWorkspaceToggle");
    if (toggleBtn) toggleBtn.setAttribute("aria-pressed", open ? "true" : "false");
  });

  // ── Task status header (reactive) ──
  createEffect(() => {
    const task = (boardStore.board as any)?.task;
    const taskStatus = document.getElementById("taskStatus");
    const statusIconEl = document.getElementById("statusIcon");
    const statusLabelEl = document.getElementById("statusLabel");
    const status = task?.status || "idle";

    if (taskStatus) {
      (taskStatus as HTMLElement).hidden = !boardStore.selectedTaskID;
    }
    if (statusIconEl) {
      statusIconEl.dataset.status = status;
      statusIconEl.innerHTML = statusIconSvg(status);
    }
    if (statusLabelEl) {
      statusLabelEl.textContent = boardStore.selectedTaskID
        ? t(`task.status.${status}`)
        : t("task.status.idle");
    }
  });

  // ── Elapsed duration (standalone interval, decoupled from reactive updates) ──
  const elapsedInterval = setInterval(() => {
    const elapsedEl = document.getElementById("taskElapsed");
    if (!elapsedEl) return;
    const task = (boardStore.board as any)?.task;
    const startTime = task?.time?.created || 0;
    if (!boardStore.selectedTaskID || !startTime) {
      if (elapsedEl.textContent) elapsedEl.textContent = "";
      return;
    }
    const completedTime = task?.time?.completed || 0;
    const status = task?.status || "idle";
    const isActive = ["active", "queued"].includes(status);
    const end = completedTime && !isActive ? completedTime : Date.now();
    elapsedEl.textContent = formatDuration(end - startTime);
  }, 1000);
  onCleanup(() => clearInterval(elapsedInterval));

 // interactionBridge.renderInteractions removed — the unified InteractionCard
 // renders the UI in both inline conversation and sidebar surfaces, and
 // PermissionAutoResolver handles auto-approval.

  createEffect(() => {
    settingsStore.locale;
    appStore.budgetDirty;
    appStore.budgetSaving;
    renderBudget((boardStore.board as any)?.task);
  });

  return dispose;
}));

const paneCallbacks = {
  getState: () => ({
    sidebarCollapsed: settingsStore.sidebarCollapsed,
    sidebarWidth: settingsStore.sidebarWidth,
    sectionsWidth: settingsStore.sectionsWidth,
  }),
  onWidthsChanged: (sidebarWidth: number | null, sectionsWidth: number | null) => {
    setSettingsStore({
      ...(sidebarWidth != null ? { sidebarWidth } : {}),
      ...(sectionsWidth != null ? { sectionsWidth } : {}),
    });
    saveSettings();
  },
};
initPaneResizers(paneCallbacks);

// ── Global event listeners (

window.addEventListener("keydown", handleZoomHotkey, listenerOpts);
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "F12") { e.preventDefault(); void toggleDevtools(); }
}, listenerOpts);
const onResize = () => applyZoom(settingsStore.zoom);
window.addEventListener("resize", onResize, listenerOpts);
if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize, listenerOpts);
window.addEventListener("blur", () => {
  void cancelPaneResize(paneCallbacks);
}, listenerOpts);
window.addEventListener("beforeunload", () => {
  runModuleTeardown();
  teardownApp();
  stopTimers();
});
installSystemThemeListener(() => applyTheme(settingsStore.theme));

// ── Directory action buttons (#taskDir, #recentDirPanel, #taskGit) ──

function renderRecentDirPanel(): void {
  const panel = document.getElementById("recentDirPanel");
  if (!panel) return;
  const dirs = loadRecentDirectories();
  const current = activeDirectory();
  if (!dirs.length) {
    panel.innerHTML = `<div class="recent-dir-empty">${escapeHtml(t("cwd.recent_empty"))}</div>`;
    return;
  }
  panel.innerHTML = dirs
    .map((dir) => {
      const isActive = current && dir.toLowerCase() === current.toLowerCase();
      return `<div class="recent-dir-row" data-active="${isActive}"><button type="button" class="recent-dir-item" data-recent-dir="${escapeHtml(dir)}" title="${escapeHtml(dir)}">${escapeHtml(shortPath(dir))}</button><button type="button" class="recent-dir-remove" data-recent-remove="${escapeHtml(dir)}" title="${escapeHtml(t("common.delete"))}" aria-label="${escapeHtml(t("common.delete"))}">×</button></div>`;
    })
    .join("");
}

function openRecentDirPanel(): void {
  const panel = document.getElementById("recentDirPanel");
  if (!panel) return;
  if (!panel.hidden) { closeRecentDirPanel(); return; }
  renderRecentDirPanel();
  const wrap = document.getElementById("taskCwdDropdown");
  if (wrap) {
    const rect = wrap.getBoundingClientRect();
    panel.style.top = Math.round(rect.bottom + 4) + "px";
    panel.style.left = Math.round(Math.max(4, rect.left)) + "px";
    panel.style.width = Math.round(rect.width) + "px";
    wrap.dataset.open = "true";
    wrap.setAttribute("aria-expanded", "true");
  }
  panel.hidden = false;
}

function closeRecentDirPanel(): void {
  const panel = document.getElementById("recentDirPanel");
  if (panel) panel.hidden = true;
  const wrap = document.getElementById("taskCwdDropdown");
  if (wrap) {
    wrap.dataset.open = "false";
    wrap.setAttribute("aria-expanded", "false");
  }
}

document.getElementById("taskCwdDropdown")?.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  if (target.closest("[data-path-action],[data-path-open],[data-path-set]")) return;
  event.stopPropagation();
  openRecentDirPanel();
});
document.getElementById("taskCwdDropdown")?.addEventListener("keydown", (event) => {
  const e = event as KeyboardEvent;
  if (e.key !== "Enter" && e.key !== " ") return;
  const target = event.target as HTMLElement | null;
  if (target && target.closest("[data-path-action],[data-path-open],[data-path-set]")) return;
  e.preventDefault();
  openRecentDirPanel();
});

document.getElementById("taskDir")?.addEventListener("click", async (event) => {
  const button = eventClosest(event, "[data-path-action],[data-path-open],[data-path-set]");
  if (!button || (button as HTMLButtonElement).disabled) return;
  const el = button as HTMLElement;
  const action = el.dataset.pathAction || "";
  if (action === "browse") { await browseDirectory(); return; }
  if (action === "create") { await createDirectory(); return; }
  if (el.dataset.pathOpen) { await openDirectory(el.dataset.pathOpen); return; }
  const target = el.dataset.pathSet || "";
  if (!target) return;
  try { await setDirectory(target); } catch (e) {
    AppLog.error("ui", "Failed to set working directory", { error: String(e) });
  }
});

document.getElementById("recentDirPanel")?.addEventListener("click", async (event) => {
  const removeBtn = eventClosest(event, "[data-recent-remove]");
  if (removeBtn) {
    const dir = (removeBtn as HTMLElement).dataset.recentRemove;
    if (dir) {
      removeRecentDirectory(dir);
      renderRecentDirPanel();
      // Close panel when list becomes empty
      if (!loadRecentDirectories().length) closeRecentDirPanel();
    }
    return;
  }
  const item = eventClosest(event, "[data-recent-dir]");
  if (!item) return;
  const dir = (item as HTMLElement).dataset.recentDir;
  if (!dir) return;
  closeRecentDirPanel();
  try { await setDirectory(dir); } catch (e) {
    AppLog.error("ui", "Failed to switch to recent directory", { dir, error: String(e) });
  }
});

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement | null;
  if (target?.closest?.("#taskCwdDropdown") || target?.closest?.(".recent-dir-panel")) return;
  closeRecentDirPanel();
}, listenerOpts);

document.getElementById("taskGit")?.addEventListener("click", () => {
  void initGitCurrent({ notify: true });
});

// ── Init ──

(window as any).__overlayInitSettled = false;
void (async () => {
  try {
    await initApp();
    const agentModelsBody = document.getElementById("agentModelsBody");
    if (agentModelsBody) {
      agentModelsBody.innerHTML = "";
      render(() => <AgentModelsPanel />, agentModelsBody);
    }
    renderAboutVersion();
    const welcomeHost = document.createElement("div");
    welcomeHost.id = "welcomeHost";
    document.body.appendChild(welcomeHost);
    render(() => <WelcomeToast />, welcomeHost);
  } catch (error) {
    console.error(error);
  } finally {
    await waitForLogDrain();
    (window as any).__overlayInitSettled = true;
  }
})();
