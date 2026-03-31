// ── Entry Point ──
// Self-sufficient Solid.js entry point.
// Mounts all Solid components and initialises the application.
// Self-sufficient — no external script dependencies.

import { render } from "solid-js/web/dist/web";
import { createEffect, createRoot, createSignal, onCleanup } from "solid-js";
import { Conversation } from "./components/Conversation";
import { TaskList } from "./components/TaskList";
import { Board, statusIcon as statusIconSvg } from "./components/Board";
import { ChatComposer } from "./components/ChatComposer";
import { WindowControls } from "./components/WindowControls";
import { TitlebarMenu } from "./components/TitlebarMenu";
import { ConnectionBadge } from "./components/ConnectionBadge";
import { ChangesPanel } from "./components/ChangesPanel";
import { LogViewer } from "./components/LogViewer";
import { CodingTab } from "./components/CodingTab";
import { initApp } from "./services/init";
import { loadTasks, boardStore, loadBoard, setBoardStore } from "./store/board";
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
  deleteTask,
  retryTask,
  replanTask,
  cancelTask,
  createTask,
  forgetPendingTask,
} from "./services/task";
import { canComposeChat, stopChatRequest } from "./services/chat";
import { setLocale } from "./utils/i18n";
import { apiJson, configure as configureApi } from "./services/api";
import { t } from "./utils/i18n";
import { formatDuration } from "./utils/time";
import { createOverlayInteractions } from "./services/interactions";
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
import { switchTab } from "./services/tabs";
import { initPaneResizers, cancelPaneResize, currentUIScale } from "./services/pane";
import { installBudgetBindings, renderBudget } from "./services/budget";
import { panelMessage } from "./services/chat";
import PromptCatalog from "./components/settings/PromptCatalog";
import ChannelsPanel from "./components/settings/ChannelsPanel";
import SkillMarketPanel from "./components/settings/SkillMarketPanel";
import ProvidersPanel from "./components/settings/ProvidersPanel";
import { MemoryPanel } from "./components/MemoryPanel";
import { PreferencesPanel } from "./components/PreferencesPanel";
import { InteractionPanel } from "./components/InteractionPanel";
import { waitForLogDrain, AppLog } from "./utils/log";
import { teardownApp } from "./services/init";
import { stopTimers } from "./services/sync";
import { nativePrompt } from "./utils/native";
import { eventClosest } from "./utils/dom-utils";
import { shortPath } from "./utils/tool";
import { initGitCurrent } from "./utils/git";
import {
  applyDirectory,
  browseDirectory,
  createDirectory,
  openDirectory,
  resetDirectory,
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
import { conversationMessages } from "./utils/conversation";

// ── Application-level signals (shared across mount points) ──

const [logOpen, setLogOpen] = createSignal(false);
const [codingActive, setCodingActive] = createSignal(false);

type AppDialogOptions = {
  title?: string;
  message?: string;
  kind?: string;
  okLabel?: string;
  cancelLabel?: string;
  cancel?: boolean;
  input?: boolean;
  inputLabel?: string;
  inputPlaceholder?: string;
  inputValue?: string;
  select?: boolean;
  selectLabel?: string;
  selectValue?: string;
  selectOptions?: Array<{ value: string; label?: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function setActiveTab(tab: "control" | "coding"): void {
  setCodingActive(tab === "coding");
  switchTab(tab);
}

function installAppDialogBridge(): void {
  const dialog = document.getElementById("appDialog") as HTMLDialogElement | null;
  const titleEl = document.getElementById("appDialogTitle");
  const bodyEl = document.getElementById("appDialogBody");
  const inputField = document.getElementById("appDialogInputField");
  const inputLabel = document.getElementById("appDialogInputLabel");
  const inputEl = document.getElementById("appDialogInput") as HTMLInputElement | null;
  const selectField = document.getElementById("appDialogSelectField");
  const selectLabel = document.getElementById("appDialogSelectLabel");
  const selectEl = document.getElementById("appDialogSelect") as HTMLSelectElement | null;
  const okBtn = document.getElementById("btnAppDialogOk") as HTMLButtonElement | null;
  const cancelBtn = document.getElementById("btnAppDialogCancel") as HTMLButtonElement | null;
  if (!dialog || !titleEl || !bodyEl || !okBtn || !cancelBtn) return;
  if (dialog.dataset.bridgeBound === "true") return;
  dialog.dataset.bridgeBound = "true";

  let resolver:
    | ((value: { confirmed: boolean; value: string | null }) => void)
    | null = null;
  let restoreConfigDialog = false;

  const settle = (confirmed: boolean) => {
    const resolve = resolver;
    resolver = null;
    const value = inputField?.classList.contains("hidden")
      ? selectField?.classList.contains("hidden")
        ? null
        : (selectEl?.value ?? null)
      : (inputEl?.value ?? null);
    dialog.close();
    resolve?.({ confirmed, value });
  };

  cancelBtn.addEventListener("click", () => settle(false));
  okBtn.addEventListener("click", () => settle(true));
  dialog.addEventListener("close", () => {
    const shouldRestoreConfigDialog = restoreConfigDialog;
    restoreConfigDialog = false;
    if (resolver) {
      const resolve = resolver;
      resolver = null;
      resolve({ confirmed: false, value: null });
    }
    if (shouldRestoreConfigDialog) {
      queueMicrotask(() => openConfigDialog());
    }
  });

  const showAppDialog = (options: AppDialogOptions = {}) => {
    if (resolver) {
      const resolve = resolver;
      resolver = null;
      resolve({ confirmed: false, value: null });
    }

    const configDialog = document.getElementById(
      "configDialog",
    ) as HTMLDialogElement | null;
    restoreConfigDialog = configDialog?.open === true;
    if (restoreConfigDialog) {
      configDialog?.close();
    }

    titleEl.textContent = options.title || t("dialog.notice");
    bodyEl.textContent = options.message || "";
    okBtn.textContent = options.okLabel || t("common.ok");
    cancelBtn.textContent = options.cancelLabel || t("common.cancel");
    cancelBtn.hidden = options.cancel !== true;

    if (inputField && inputEl && inputLabel) {
      inputField.classList.toggle("hidden", options.input !== true);
      inputLabel.textContent = options.inputLabel || t("dialog.input");
      inputEl.placeholder = options.inputPlaceholder || "";
      inputEl.value = options.inputValue || "";
    }

    if (selectField && selectEl && selectLabel) {
      selectField.classList.toggle("hidden", options.select !== true);
      selectLabel.textContent = options.selectLabel || t("dialog.input");
      selectEl.innerHTML = "";
      for (const item of options.selectOptions || []) {
        if (!item?.value) continue;
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label || item.value;
        option.selected = item.value === (options.selectValue || "");
        selectEl.appendChild(option);
      }
      if (!selectEl.value && selectEl.options.length > 0) {
        selectEl.value = options.selectValue || selectEl.options[0].value;
      }
    }

    dialog.showModal();
    if (options.input && inputEl) {
      queueMicrotask(() => inputEl.focus());
    } else {
      queueMicrotask(() => okBtn.focus());
    }

    return new Promise<{ confirmed: boolean; value: string | null }>((resolve) => {
      resolver = resolve;
    });
  };

  (window as any).showAppDialog = showAppDialog;
  (window as any).nativeMessage = async (
    message: string,
    options: { title?: string; kind?: string; okLabel?: string } = {},
  ) =>
    showAppDialog({
      title: options.title,
      message,
      kind: options.kind,
      okLabel: options.okLabel,
    });
}

function installGlobalBridges(): void {
  installAppDialogBridge();
  (window as any).createOverlayInteractions = createOverlayInteractions;
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
    if (prop in appStore) return (appStore as Record<string, unknown>)[prop];
    if (prop === "settings") return settingsStore;
    if (prop in settingsStore) return (settingsStore as Record<string, unknown>)[prop];
    return Reflect.get(testStateTarget, prop);
  };
  const writeState = (prop: PropertyKey, value: unknown): boolean => {
    if (typeof prop !== "string") return Reflect.set(testStateTarget, prop, value);
    if (prop === "directory") {
      setSettingsStore("directory", typeof value === "string" ? value : "");
      return true;
    }
    if (prop === "board") {
      setBoardStore("board", value as any);
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
  (window as any).renderConversation = () => conversationMessages();
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
    const description = (document.getElementById("goalDescription") as HTMLTextAreaElement | null)?.value.trim() || "";
    const criteria = (document.getElementById("goalCriteria") as HTMLTextAreaElement | null)?.value.trim() || "";
    if (!description) return;

    try {
      if (goalID) {
        await panelMessage(`Update goal ${goalID}.`, {
          goalID,
          description,
          criteria: criteria || "The requested change is implemented and acceptance checks pass.",
          taskID: boardStore.selectedTaskID || undefined,
        });
      } else {
        const payload = criteria ? `/goal ${description}\nCriteria: ${criteria}` : `/goal ${description}`;
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

// ── Mount: CodingTab ──

import type { CodingTabAPI } from "./components/CodingTab";
let codingAPI: CodingTabAPI | null = null;

const codingScrollEl = document.getElementById("codingScroll");
if (codingScrollEl) {
  codingScrollEl.innerHTML = "";
  render(
    () => (
      <CodingTab
        active={codingActive()}
        onReady={(api) => {
          codingAPI = api;
        }}
      />
    ),
    codingScrollEl,
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
        onDeleteTask={(taskID) => {
          if (taskID.startsWith("pending:")) {
            forgetPendingTask(taskID.slice("pending:".length));
          } else {
            void deleteTask(taskID);
          }
        }}
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
          const note = await nativePrompt(t("task.action.retry_title"), {
            title: t("task.action.retry"),
          });
          if (note === null) return;
          void retryTask(id, note || undefined);
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
        onOpenSession={async (sessionID, goalTitle) => {
          const dialog = document.getElementById("sessionDialog") as HTMLDialogElement | null;
          const titleEl = document.getElementById("sessionDialogTitle");
          const bodyEl = document.getElementById("sessionDialogBody");
          if (!dialog || !titleEl || !bodyEl) return;
          titleEl.textContent = goalTitle || "Executor Session";
          bodyEl.innerHTML = '<p class="empty-hint">Loading…</p>';
          dialog.showModal();
          try {
            // API returns Message.WithParts[]: each element is { info: { role, ... }, parts: [...] }
            const messages: any[] = await apiJson(`session/${sessionID}/message`);
            if (!messages || messages.length === 0) {
              bodyEl.innerHTML = '<p class="empty-hint">No messages yet.</p>';
              return;
            }
            const html = messages.map((msg: any) => {
              const role: string = msg.info?.role ?? msg.role ?? "unknown";
              const parts: any[] = Array.isArray(msg.parts) ? msg.parts : [];
              const textParts = parts
                .filter((p) => p.type === "text" && p.text && p.audience?.ui !== false)
                .map((p) => `<p class="session-msg-text">${escapeHtml(p.text)}</p>`)
                .join("");
              const toolParts = parts
                .filter((p) => p.type === "tool-invocation" || p.type === "tool-call")
                .map((p) => {
                  const name = p.toolName ?? p.tool ?? "tool";
                  return `<p class="session-msg-tool">⚙ ${escapeHtml(name)}</p>`;
                })
                .join("");
              if (!textParts && !toolParts) return "";
              return `<div class="session-msg" data-role="${escapeHtml(role)}">
                <span class="session-msg-role">${escapeHtml(role)}</span>
                ${textParts}${toolParts}
              </div>`;
            }).filter(Boolean).join("");
            bodyEl.innerHTML = html || '<p class="empty-hint">No displayable messages.</p>';
          } catch (e) {
            bodyEl.innerHTML = `<p class="empty-hint">Failed to load session: ${escapeHtml(String(e))}</p>`;
          }
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
        onResolveInteraction={async (id, action) => {
          try {
            await apiJson(`interaction/${id}/reply`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reply: action }),
              signal: AbortSignal.timeout(30_000),
            });
          } catch (err) {
            console.error("[main] resolveInteraction failed", err);
          } finally {
            await loadBoard();
          }
        }}
        onRejectInteraction={async (id) => {
          try {
            await apiJson(`interaction/${id}/reject`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
              signal: AbortSignal.timeout(30_000),
            });
          } catch (err) {
            console.error("[main] rejectInteraction failed", err);
          } finally {
            await loadBoard();
          }
        }}
      />
    ),
    boardEl,
  );
}

// ── Mount: ChatComposer ──

const composerEl = document.getElementById("solidChatComposer");
if (composerEl) {
  render(
    () => (
      <ChatComposer
        enabled={codingActive() ? true : canComposeChat()}
        busy={codingActive() ? (codingAPI?.busy() ?? false) : !!messageStore.chatRequest}
        stopping={codingActive() ? false : !!(messageStore.chatRequest as any)?.stopping}
        onSubmit={(text, attachments) => {
          if (codingActive() && codingAPI) {
            codingAPI.send(text);
          } else {
            void panelMessage(text, attachments);
          }
        }}
        onStop={() => {
          if (codingActive() && codingAPI) {
            codingAPI.stop();
          } else {
            void stopChatRequest();
          }
        }}
        canCancel={!!(boardStore.board?.overview?.controls?.canCancel)}
        onCancel={() => {
          const id = boardStore.selectedTaskID;
          if (id) void cancelTask(id);
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

const channelConfigBody = document.getElementById("channelConfigBody");
if (channelConfigBody) {
  channelConfigBody.innerHTML = "";
  render(() => <ChannelsPanel />, channelConfigBody);
}

const extensionsBody = document.getElementById("extensionsBody");
if (extensionsBody) {
  extensionsBody.innerHTML = "";
  render(() => <SkillMarketPanel />, extensionsBody);
}

const memoryBody = document.getElementById("memoryBody");
if (memoryBody) {
  memoryBody.innerHTML = "";
  render(
    () => <MemoryPanel taskID={boardStore.selectedTaskID || undefined} />,
    memoryBody,
  );
}

const preferenceBody = document.getElementById("preferenceBody");
if (preferenceBody) {
  preferenceBody.innerHTML = "";
  render(() => <PreferencesPanel />, preferenceBody);
}

const providersConfigBody = document.getElementById("providersConfigBody");
if (providersConfigBody) {
  providersConfigBody.innerHTML = "";
  render(() => <ProvidersPanel />, providersConfigBody);
}

// ── Mount: InteractionPanel (auto-resolve layer) ──
// Uses a dedicated mount point independent of Board's internal DOM.

const interactionMountEl = document.getElementById("solidInteractionMount");
if (interactionMountEl) {
  render(
    () => (
      <InteractionPanel
        onRespond={async () => {
          await loadBoard();
        }}
      />
    ),
    interactionMountEl,
  );
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
    if (codingActive()) setActiveTab("control");
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
      ? `<div class="engine-model-current">${escapeHtml(t("executor.current_model") || "Current")}: <strong>${escapeHtml(current)}</strong></div>`
      : "";
    const items = models.map((mid) =>
      `<button type="button" class="engine-model-item" data-executor-model="${escapeHtml(mid)}" data-active="${mid === current}">${escapeHtml(mid)}</button>`,
    ).join("");
    panel.innerHTML = currentLabel + (items || `<div class="engine-model-current">${escapeHtml(t("empty.overview") || "No models available")}</div>`);
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
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllModelPanels();
  });
});

// ── Initialise application ──

document.getElementById("tabControl")?.addEventListener("click", () => {
  setActiveTab("control");
});
document.getElementById("tabCoding")?.addEventListener("click", () => {
  setActiveTab("coding");
});
document.getElementById("modeToggle")?.addEventListener("click", () => {
  setActiveTab(codingActive() ? "control" : "coding");
});
document.getElementById("btnChatCopyAll")?.addEventListener("click", () => {
  void copyChatConversation();
});

// Interaction DOM rendering disabled (InteractionPanel handles UI).
// Kept alive for resolveInteraction/rejectInteraction window globals
// consumed by services/session.ts.
const interactionBridge = createOverlayInteractions({
  document,
  dom: { goalsBody: null },
  escapeHtml,
  renderMarkdown,
  t,
  record: isRecord,
  loadBoard,
  nativePrompt: async (message, options = {}) => {
    const showAppDialog = (window as any).showAppDialog;
    if (typeof showAppDialog !== "function") return null;
    const result = await showAppDialog({
      title: options.title,
      message,
      cancel: true,
      input: true,
      okLabel: options.okLabel,
      cancelLabel: options.cancelLabel,
      inputLabel: options.inputLabel,
    });
    return result?.confirmed ? result.value : null;
  },
});

Object.assign(window as any, {
  renderInteractions: interactionBridge.renderInteractions,
  showInteractionModal: interactionBridge.showInteractionModal,
  dismissInteractionModal: interactionBridge.dismissInteractionModal,
  resolveInteraction: interactionBridge.resolveInteraction,
  rejectInteraction: interactionBridge.rejectInteraction,
  isInteractionBusy: interactionBridge.isInteractionBusy,
  refreshInteractionAttention: interactionBridge.refreshInteractionAttention,
});

createRoot(() => {
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

  // ── Task status header (reactive) ──
  createEffect(() => {
    const task = (boardStore.board as any)?.task;
    const taskStatus = document.getElementById("taskStatus");
    const statusIconEl = document.getElementById("statusIcon");
    const statusLabelEl = document.getElementById("statusLabel");
    const status = task?.status || "idle";

    if (taskStatus) {
      (taskStatus as HTMLElement).hidden = !boardStore.selectedTaskID || codingActive();
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
    const isActive = ["running", "planning", "evaluating", "delivering", "queued"].includes(status);
    const end = completedTime && !isActive ? completedTime : Date.now();
    elapsedEl.textContent = formatDuration(end - startTime);
  }, 1000);
  onCleanup(() => clearInterval(elapsedInterval));

 // interactionBridge.renderInteractions removed — InteractionPanel handles
 // interaction display and auto-resolve reactively. Keeping both active
 // would cause double auto-resolve race conditions.

  createEffect(() => {
    settingsStore.locale;
    appStore.budgetDirty;
    appStore.budgetSaving;
    renderBudget((boardStore.board as any)?.task);
  });
});

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

setActiveTab("control");

// ── Global event listeners (

window.addEventListener("keydown", handleZoomHotkey);
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "F12") { e.preventDefault(); void toggleDevtools(); }
});
const onResize = () => applyZoom(settingsStore.zoom);
window.addEventListener("resize", onResize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize);
window.addEventListener("focus", () => { void (window as any).refreshInteractionAttention?.(); });
window.addEventListener("blur", () => {
  void cancelPaneResize(paneCallbacks);
  void (window as any).refreshInteractionAttention?.();
});
window.addEventListener("beforeunload", () => { teardownApp(); stopTimers(); });
document.addEventListener("visibilitychange", () => { void (window as any).refreshInteractionAttention?.(); });
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
      return `<button type="button" class="recent-dir-item" data-recent-dir="${escapeHtml(dir)}" data-active="${isActive}" title="${escapeHtml(dir)}">${escapeHtml(shortPath(dir))}</button>`;
    })
    .join("");
}

function openRecentDirPanel(): void {
  const panel = document.getElementById("recentDirPanel");
  if (!panel) return;
  if (!panel.hidden) { panel.hidden = true; return; }
  renderRecentDirPanel();
  const trigger = document.getElementById("taskDir")?.querySelector('[data-path-action="recent"]');
  if (trigger) {
    const rect = trigger.getBoundingClientRect();
    panel.style.top = Math.round(rect.bottom + 4) + "px";
    panel.style.left = Math.round(Math.max(4, rect.left - 60)) + "px";
  }
  panel.hidden = false;
}

function closeRecentDirPanel(): void {
  const panel = document.getElementById("recentDirPanel");
  if (panel) panel.hidden = true;
}

document.getElementById("taskDir")?.addEventListener("click", async (event) => {
  const button = eventClosest(event, "[data-path-action],[data-path-open],[data-path-set]");
  if (!button || (button as HTMLButtonElement).disabled) return;
  const el = button as HTMLElement;
  const action = el.dataset.pathAction || "";
  if (action === "recent") { event.stopPropagation(); openRecentDirPanel(); return; }
  if (action === "browse") { await browseDirectory(); return; }
  if (action === "create") { await createDirectory(); return; }
  if (action === "reset") { await resetDirectory(); return; }
  if (el.dataset.pathOpen) { await openDirectory(el.dataset.pathOpen); return; }
  const target = el.dataset.pathSet || "";
  if (!target) return;
  try { await setDirectory(target); } catch (e) {
    AppLog.error("ui", "Failed to set working directory", { error: String(e) });
  }
});

document.getElementById("recentDirPanel")?.addEventListener("click", async (event) => {
  const item = eventClosest(event, "[data-recent-dir]");
  if (!item) return;
  const dir = (item as HTMLElement).dataset.recentDir;
  if (!dir) return;
  closeRecentDirPanel();
  try { await setDirectory(dir); } catch (e) {
    removeRecentDirectory(dir);
    AppLog.error("ui", "Failed to switch to recent directory", { error: String(e) });
  }
});

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement | null;
  if (target?.closest?.('[data-path-action="recent"]') || target?.closest?.(".recent-dir-panel")) return;
  closeRecentDirPanel();
});

document.getElementById("taskGit")?.addEventListener("click", () => {
  void initGitCurrent({ notify: true });
});

// ── Init ──

(window as any).__overlayInitSettled = false;
void (async () => {
  try {
    await initApp();
    renderAboutVersion();
  } catch (error) {
    console.error(error);
  } finally {
    await waitForLogDrain();
    (window as any).__overlayInitSettled = true;
  }
})();
