// ── Entry Point ──
// Self-sufficient Solid.js entry point.
// Mounts all Solid components and initialises the application.
// No dependency on legacy app.js / workspace.js / interactions.js.

import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { Conversation } from "./components/Conversation";
import { TaskList } from "./components/TaskList";
import { Board } from "./components/Board";
import { ChatComposer } from "./components/ChatComposer";
import { WindowControls } from "./components/WindowControls";
import { TitlebarMenu } from "./components/TitlebarMenu";
import { ConnectionBadge } from "./components/ConnectionBadge";
import { ChangesPanel } from "./components/ChangesPanel";
import { LogViewer } from "./components/LogViewer";
import { initApp, loadConfigInfo } from "./services/init";
import { loadTasks, boardStore, loadBoard } from "./store/board";
import { messageStore } from "./store/messages";
import {
  selectTask,
  deleteTask,
  submitMessage,
  retryTask,
  replanTask,
  cancelTask,
} from "./services/task";
import { canComposeChat, stopChatRequest } from "./services/chat";
import { setLocale } from "./utils/i18n";
import { apiJson } from "./services/api";

// ── Application-level signals (shared across mount points) ──

const [logOpen, setLogOpen] = createSignal(false);

// ── Mount: Conversation ──

const chatScroll = document.getElementById("chatScroll");
if (chatScroll) {
  chatScroll.innerHTML = "";
  render(() => <Conversation container={chatScroll} />, chatScroll);
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
        onSubmit={(text, attachments) => void submitMessage(text, attachments)}
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
        onLocaleChange={(locale) => void setLocale(locale)}
        onOpenLog={() => setLogOpen(true)}
        onOpenSettings={() => {
          const d = document.getElementById(
            "configDialog",
          ) as HTMLDialogElement | null;
          d?.showModal?.();
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

// ── Native dialog close handlers ──
// Settings dialog (configDialog) close button — app.js no longer handles it.

document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("btnCloseConfigDialog")
    ?.addEventListener("click", () => {
      (
        document.getElementById("configDialog") as HTMLDialogElement | null
      )?.close();
    });
});

// ── Initialise application ──

void initApp({
  onConnected: async () => {
    await loadConfigInfo();
  },
});

void loadTasks().catch(console.error);
