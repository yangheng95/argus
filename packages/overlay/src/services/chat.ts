// ── Chat Service ──
// Exact port of app.js chat composition, attachment, and abort logic.
//
// Responsibilities:
//   - Manage staged chat attachments (add / remove / take metadata)
//   - Manage the active chat AbortController (stop / abort targets)
//   - Expose pure predicates: canComposeChat, chatAbortTargets, chatAbortTarget
//   - Provide conversationTarget / conversationTargetKey helpers
//   - Expose panelResultNavigates predicate
//
// This module owns no render-side effects. Callers drive UI updates through
// reactive Solid stores.

import { apiJson } from "./api";
import {
  messageStore,
  setChatRequest,
  abortChatRequest,
  setChatAttachments,
} from "../store/messages";
import { boardStore } from "../store/board";
import { appStore } from "../store/app";
import { executorStore } from "../store/executor";
import { workspaceMode } from "./workspace";

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
 * Mirrors app.js conversationTarget.
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
 * Mirrors app.js conversationTargetKey.
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
 * Mirrors app.js panelResultNavigates.
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
 * Mirrors app.js canComposeChat: connected, and in "empty" or "task" mode.
 */
export function canComposeChat(): boolean {
  if (!appStore.connected) return false;
  // Derive workspace mode from store state.
  // "task" mode: a task is selected.
  // "empty" mode: no task selected, no session-only workspace.
  // Both allow composing. All other modes (e.g. a pure session workspace
  // with no associated task) are not represented in the Solid stores yet,
  // so we fall back to checking the legacy window helper if available.
  const mode = workspaceMode();
  return mode === "empty" || mode === "task";
}

// ── Public: chatAbortTargets ──

/**
 * Returns ordered list of abort targets for the active chat request.
 * Mirrors app.js chatAbortTargets.
 *
 * @param seed  Optional initial target to prepend (from the request object).
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

  const runID =
    boardStore.board?.task?.activeRunID || executorStore.runID || "";
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
 * Mirrors app.js chatAbortTarget.
 */
export function chatAbortTarget(seed?: ChatAbortTarget): ChatAbortTarget | null {
  return chatAbortTargets(seed)[0] || null;
}

// ── Internal: abortChatTarget ──

/**
 * Send a remote abort/cancel request for a single target.
 * Mirrors app.js abortChatTarget.
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
 * Mirrors app.js stopChatRequest (data layer only — no DOM effects).
 *
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
 * Mirrors app.js addChatAttachment (data layer only — no toast).
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
 * Mirrors app.js removeChatAttachment.
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
 * Mirrors app.js takeChatMetadata.
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

// ── Re-export store accessors used by consumers ──

export { setChatRequest, abortChatRequest, setChatAttachments };
