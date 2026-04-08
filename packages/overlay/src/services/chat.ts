// ── Chat Service ──
// Responsibilities:
// - Manage staged chat attachments (add / remove / take metadata)
// - Manage the active chat AbortController (stop / abort targets)
// - Expose pure predicates: canComposeChat, chatAbortTargets, chatAbortTarget
// - Provide conversationTarget / conversationTargetKey helpers
// - Expose panelResultNavigates predicate
// This module owns no render-side effects. Callers drive UI updates through
// reactive Solid stores.

import { apiJson } from "./api";
import {
  messageStore,
  setChatRequest,
  abortChatRequest,
  setChatAttachments,
  setMessages,
  mergeLoadedConversationMessages,
} from "../store/messages";
import { boardStore, setTasksData, loadBoard } from "../store/board";
import { appStore, setConnectionStatus } from "../store/app";
import { workspaceMode } from "./workspace";
import {
  selectTask,
  submitMessage,
  createTask,
} from "./task";
import { syntheticTextMessage } from "../utils/transcript";
import { draftBudget } from "../utils/budget";

// ── Types ──

export interface ChatAbortTarget {
  kind: "run" | "session" | "task";
  runID?: string;
  sessionID?: string;
  taskID?: string;
}

export interface ConversationTarget {
  kind: "task" | "empty";
  taskID?: string;
}

// ── Constants ──

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB

// ── Helpers ──

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function currentTaskSessionID(): string {
  return (
    boardStore.board?.task?.sessionID ||
    boardStore.tasks.find(
      (item: any) => item?.task?.id === boardStore.selectedTaskID,
    )?.task?.sessionID ||
    ""
  );
}

// ── Public: conversationTarget ──

/**
 * Returns the current conversation target (task or empty).
 */
export function conversationTarget(): ConversationTarget {
  if (boardStore.selectedTaskID) {
    return {
      kind: "task",
      taskID: boardStore.selectedTaskID,
    };
  }
  return { kind: "empty" };
}

// ── Public: conversationTargetKey ──

/**
 * Stable string key for the current conversation target.
 */
export function conversationTargetKey(
  target: ConversationTarget = conversationTarget(),
): string {
  if (target.taskID) return `task:${target.taskID}`;
  return "empty";
}

// ── Public: panelResultNavigates ──

/**
 * Returns true if the panel result should trigger task navigation.
 */
export function panelResultNavigates(result: any): boolean {
  if (!result || typeof result !== "object") return false;
  const action = result.local_action?.type;
  if (action === "select_task") return true;
  if (result.task_id) return true;
  return false;
}

// ── Public: canComposeChat ──

/**
 * Returns true when the chat composer should be enabled.
 */
export function canComposeChat(): boolean {
  if (!appStore.connected) return false;
 // Derive workspace mode from store state.
 // "task" mode: a task is selected.
 // "empty" mode: no task selected, no session-only workspace.
 // Both allow composing. All other modes (e.g. a pure session workspace
 // with no associated task) are not represented in the Solid stores yet,
 // so we fall back to checking the helper if available.
  const mode = workspaceMode();
  return mode === "empty" || mode === "task";
}

// ── Public: chatAbortTargets ──

/**
 * Returns ordered list of abort targets for the active chat request.
 * @param seed Optional initial target to prepend (from the request object).
 */
export function chatAbortTargets(seed?: ChatAbortTarget): ChatAbortTarget[] {
  const items: ChatAbortTarget[] = [];
  const seen = new Set<string>();

  const push = (target: ChatAbortTarget | undefined | null): void => {
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
  if (!boardStore.selectedTaskID) return items;

  const runID = boardStore.board?.task?.activeRunID || "";
  if (runID) {
    push({ kind: "run", runID });
  }
  const sessionID = currentTaskSessionID();
  if (sessionID) {
    push({ kind: "session", sessionID });
  }
  push({ kind: "task", taskID: boardStore.selectedTaskID });

  return items;
}

// ── Public: chatAbortTarget ──

/**
 * Returns the first (highest-priority) abort target, or null if none.
 */
export function chatAbortTarget(seed?: ChatAbortTarget): ChatAbortTarget | null {
  return chatAbortTargets(seed)[0] || null;
}

// ── Internal: abortChatTarget ──

/**
 * Send a remote abort/cancel request for a single target.
 */
async function abortChatTargetRemote(target: ChatAbortTarget): Promise<boolean> {
  if (!target) return false;
  if (target.kind === "run" && target.runID) {
    await apiJson(`run/${encodeURIComponent(target.runID)}/abort`, {
      method: "POST",
    });
    return true;
  }
  if (target.kind === "task" && target.taskID) {
    await apiJson(`task/${encodeURIComponent(target.taskID)}/cancel`, {
      method: "POST",
    });
    return true;
  }
  if (target.kind === "session" && target.sessionID) {
    await apiJson(`session/${encodeURIComponent(target.sessionID)}/abort`, {
      method: "POST",
    });
    return true;
  }
  return false;
}

// ── Public: stopChatRequest ──

export interface StopChatRequestOptions {
  /** If false, skip sending remote abort.  Defaults to true. */
  remote?: boolean;
  /** If false, this is not a manual user abort.  Defaults to true. */
  manual?: boolean;
}

/**
 * Abort the active chat request and optionally cancel the remote run/task.
 * Returns true if the abort was dispatched, false if no active request.
 */
export async function stopChatRequest(
  options: StopChatRequestOptions = {},
): Promise<boolean> {
  const request = messageStore.chatRequest as any;
  if (!request || request.stopping) return false;

 // Mark as stopping to prevent re-entrant calls
  request.aborted = true;
  request.manualAbort = options.manual !== false;
  request.stopping = true;
  request.recovery?.stop();

 // Abort the local fetch
  request.controller?.abort?.();

 // Clear the store reference
  abortChatRequest();

  if (options.remote === false) return true;

  const targets = chatAbortTargets(request.target);
  if (targets.length === 0) return true;

  try {
    for (const target of targets) {
      try {
        await abortChatTargetRemote(target);
        return true;
      } catch (e) {
        console.warn("[stopChatRequest] Failed to abort target", {
          error: String(e),
          target,
        });
      }
    }
    return false;
  } finally {
    request.stopping = false;
  }
}

// ── Public: addChatAttachment ──

/**
 * Add a file attachment to the staged chat attachments list.
 * Returns an error string if validation fails, or null on success.
 */
export async function addChatAttachment(file: File): Promise<string | null> {
  if (!file) return "No file provided";
  if (file.size > MAX_ATTACHMENT_SIZE) {
    return "file_too_large";
  }
  const url = await fileToDataUrl(file);
  const next = [
    ...messageStore.chatAttachments,
    {
      mime: file.type || "application/octet-stream",
      url,
      filename: file.name,
    },
  ];
  setChatAttachments(next);
  return null;
}

// ── Public: removeChatAttachment ──

/**
 * Remove a staged attachment by index.
 */
export function removeChatAttachment(index: number): void {
  const next = messageStore.chatAttachments.filter(
    (_: any, i: number) => i !== index,
  );
  setChatAttachments(next);
}

// ── Public: takeChatMetadata ──

/**
 * Consume and return any pending metadata set via window.__ocNextChatMetadata.
 */
export function takeChatMetadata(): Record<string, unknown> | undefined {
  const win = window as any;
  const meta =
    win.__ocNextChatMetadata &&
    typeof win.__ocNextChatMetadata === "object" &&
    !Array.isArray(win.__ocNextChatMetadata)
      ? (win.__ocNextChatMetadata as Record<string, unknown>)
      : undefined;
  delete win.__ocNextChatMetadata;
  return meta;
}

// ── Panel message helpers ──

export function mergeMessages(left: any[], right: any[]): any[] {
  return mergeLoadedConversationMessages(left, right);
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

function insertPendingUserMessage(requestID: string, text: string): void {
  setMessages([
    ...messageStore.messages,
    {
      info: { id: `pending-user:${requestID}`, role: "user", time: { created: Date.now() } },
      parts: [{ type: "text", text }],
    },
  ]);
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
      status: task?.status || "active",
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
    ensureTaskListEntry(taskID, requestID, requestText, String(result?.message || ""));
    await selectTask(taskID);
    ensureTaskListEntry(taskID, requestID, requestText, String(result?.message || ""));
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

export async function panelMessage(text: string, attachmentsOrMeta: any[] | Record<string, any> = [], metadata: any = {}): Promise<any> {
  const attachments = Array.isArray(attachmentsOrMeta) ? attachmentsOrMeta : [];
  const meta = Array.isArray(attachmentsOrMeta) ? metadata : attachmentsOrMeta;
  const requestID = crypto.randomUUID();
  const controller = new AbortController();
  const request: any = {
    requestID,
    controller,
    stopping: false,
    aborted: false,
    manualAbort: false,
  };
  insertPendingUserMessage(requestID, text);
  setConnectionStatus("online");
  setChatRequest(request as any);
  try {
    // If no task is selected, create a new task via direct API (no LLM round-trip)
    if (!boardStore.selectedTaskID) {
      const taskID = await createTask({
        text,
        attachments,
        metadata: meta,
        signal: controller.signal,
        budget: draftBudget(),
      });
      if (taskID) {
        await selectTask(taskID);
        return { task_id: taskID };
      }
      throw new Error("Task creation returned no task_id");
    }
    // Fast-path: cancelled/failed tasks — direct API restart, no LLM streaming.
    const taskStatus = boardStore.board?.task?.status;
    if (taskStatus === "cancelled" || taskStatus === "failed") {
      const result = await apiJson(
        `task/${encodeURIComponent(boardStore.selectedTaskID)}/message`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, source: "panel" }),
          signal: controller.signal,
        },
      );
      await loadBoard();
      if ((result as any)?.message) {
        setMessages(
          mergeMessages(messageStore.messages, [
            syntheticTextMessage("assistant", Date.now(), String((result as any).message)),
          ]),
        );
      }
      return result;
    }
    // If a task is selected, send a follow-up message via the panel stream
    const result = await submitMessage(text, attachments, {
      requestID,
      metadata: meta,
      signal: controller.signal,
      onEvent: async (event) => {
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
    await applyPanelResult({ ...(result as any), _request: text, _requestID: requestID });
    return result;
  } catch (error) {
    if (request.manualAbort) throw error;
    throw error;
  } finally {
    if ((messageStore.chatRequest as any)?.requestID === request.requestID) {
      setChatRequest(null as any);
    }
  }
}

// ── Re-export store accessors used by consumers ──

export { setChatRequest, abortChatRequest, setChatAttachments };
