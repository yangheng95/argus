// ── Entry Point ──
// Self-sufficient Solid.js entry point.
// Mounts all Solid components and initialises the application.
// No dependency on legacy app.js / workspace.js / interactions.js.

import { render } from "solid-js/web/dist/web";
import { createEffect, createRoot, createSignal } from "solid-js";
import { Conversation } from "./components/Conversation";
import { TaskList } from "./components/TaskList";
import { Board } from "./components/Board";
import { ChatComposer } from "./components/ChatComposer";
import { WindowControls } from "./components/WindowControls";
import { TitlebarMenu } from "./components/TitlebarMenu";
import { ConnectionBadge } from "./components/ConnectionBadge";
import { ChangesPanel } from "./components/ChangesPanel";
import { LogViewer } from "./components/LogViewer";
import { CodingTab } from "./components/CodingTab";
import { initApp } from "./services/init";
import { loadTasks, boardStore, loadBoard } from "./store/board";
import { messageStore } from "./store/messages";
import { appStore } from "./store/app";
import {
  selectTask,
  deleteTask,
  retryTask,
  replanTask,
  cancelTask,
  createTask,
} from "./services/task";
import { canComposeChat, stopChatRequest } from "./services/chat";
import { setLocale } from "./utils/i18n";
import { apiJson, configure as configureApi } from "./services/api";
import { t } from "./utils/i18n";
import { createOverlayInteractions } from "./services/interactions";
import { renderMarkdown, escapeHtml } from "./utils/markdown";
import { copyChatConversation } from "./utils/transcript";
import {
  applyTheme,
  applyZoom,
  applyWindowOpacity,
  sanitizeZoom,
} from "./services/theme";
import { settingsStore, setSettingsStore, saveSettings } from "./store/settings";
import { switchTab } from "./services/tabs";
import { initPaneResizers } from "./services/pane";
import { installLegacyGlobals, panelMessage, renderBudget } from "./services/legacy";
import PromptCatalog from "./components/settings/PromptCatalog";
import ChannelsPanel from "./components/settings/ChannelsPanel";
import SkillMarketPanel from "./components/settings/SkillMarketPanel";
import { MemoryPanel } from "./components/MemoryPanel";
import { PreferencesPanel } from "./components/PreferencesPanel";
import { InteractionPanel } from "./components/InteractionPanel";
import { waitForLogDrain } from "./utils/log";
import { openConfigDialog, setupDialogBackdropClose, installSettingsFormHandlers } from "./services/dialog";
import { installInlineLlmConfig, refreshInlineLlmConfig } from "./services/llm-inline";

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
}

installGlobalBridges();
installLegacyGlobals();
installInlineLlmConfig();
setupDialogBackdropClose();
installSettingsFormHandlers();

// ── Mount: Conversation ──

const chatScroll = document.getElementById("chatScroll");
if (chatScroll) {
  chatScroll.innerHTML = "";
  render(() => <Conversation container={chatScroll} />, chatScroll);
}

// ── Mount: CodingTab ──

const codingScrollEl = document.getElementById("codingScroll");
if (codingScrollEl) {
  codingScrollEl.innerHTML = "";
  render(() => <CodingTab active={codingActive()} />, codingScrollEl);
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
        onRetry={() => {
          const id = boardStore.selectedTaskID;
          if (id) void retryTask(id);
        }}
        onReplan={() => {
          const id = boardStore.selectedTaskID;
          if (id) void replanTask(id);
        }}
        onCancel={() => {
          const id = boardStore.selectedTaskID;
          if (id) void cancelTask(id);
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
        enabled={canComposeChat()}
        busy={!!messageStore.chatRequest}
        stopping={!!(messageStore.chatRequest as any)?.stopping}
        onSubmit={(text, attachments) => void panelMessage(text, attachments)}
        onStop={() => void stopChatRequest()}
      />
    ),
    composerEl,
  );
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
// Settings dialog (configDialog) close button — app.js no longer handles it.

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

  // ── Sidebar buttons ──
  document.getElementById("btnRefreshTasks")?.addEventListener("click", () => {
    void loadTasks();
  });
  document.getElementById("btnSidebarToggle")?.addEventListener("click", () => {
    const next = !settingsStore.sidebarCollapsed;
    setSettingsStore("sidebarCollapsed", next);
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.dataset.collapsed = String(next);
    saveSettings();
  });
  document.getElementById("btnCreateTask")?.addEventListener("click", () => {
    const showAppDialog = (window as any).showAppDialog;
    if (typeof showAppDialog !== "function") return;
    void (async () => {
      const result = await showAppDialog({
        title: t("task.new"),
        message: t("task.new_prompt"),
        cancel: true,
        input: true,
        inputLabel: t("task.new_label"),
        inputPlaceholder: t("task.new_placeholder"),
      });
      if (!result?.confirmed || !result.value?.trim()) return;
      const taskID = await createTask({ text: result.value.trim() });
      if (taskID) void selectTask(taskID);
    })();
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

// Interaction bridge: DOM rendering disabled (InteractionPanel handles UI).
// Bridge kept alive for resolveInteraction/rejectInteraction window globals
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

  createEffect(() => {
    const task = (boardStore.board as any)?.task;
    const taskStatus = document.getElementById("taskStatus");
    const statusIcon = document.getElementById("statusIcon");
    const statusLabel = document.getElementById("statusLabel");
    if (taskStatus) {
      (taskStatus as HTMLElement).hidden = !boardStore.selectedTaskID || codingActive();
    }
    if (statusIcon) statusIcon.dataset.status = task?.status || "idle";
    if (statusLabel) {
      statusLabel.textContent = boardStore.selectedTaskID
        ? t(`task.status.${task?.status || "idle"}`)
        : t("task.status.idle");
    }
  });

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

initPaneResizers({
  getState: () => ({
    sidebarCollapsed: settingsStore.sidebarCollapsed,
    sidebarWidth: settingsStore.sidebarWidth,
    sectionsWidth: settingsStore.sectionsWidth,
  }),
  onWidthsChanged: (sidebarWidth, sectionsWidth) => {
    setSettingsStore({
      sidebarWidth,
      sectionsWidth,
    });
    saveSettings();
  },
});

setActiveTab("control");

(window as any).__overlayInitSettled = false;
void (async () => {
  try {
    await initApp();
  } catch (error) {
    console.error(error);
  } finally {
    await waitForLogDrain();
    (window as any).__overlayInitSettled = true;
  }
})();
