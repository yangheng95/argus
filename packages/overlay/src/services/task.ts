// ── Task Service ──
// Responsibilities:
// - Select a task (stop SSE, clear messages, load board + transcript, start SSE)
// - Delete a task
// - Create a task (direct API)
// - Submit a message to the current task (direct API)
// - Retry / replan / cancel / interrupt a task (direct API)
// This module owns no render-side effects. Callers are responsible for
// driving UI updates through reactive Solid stores.

import { apiJson, apiUrl, apiHeaders } from "./api";
import { startSSE, stopSSE } from "./sse";
import {
  syncTask,
  clearMessages,
  clearAgentEvents,
  setSelectedTaskID,
} from "../store/messages";
import {
  loadBoard,
  loadTasks,
  boardStore,
  setBoardStore,
} from "../store/board";
import { settingsStore } from "../store/settings";
import { appStore, setAppStore } from "../store/app";

// ── Types ──

export interface Attachment {
  mime: string;
  url: string;
  filename?: string;
}

export interface SubmitMessageOptions {
  /** Pre-allocated requestID (UUID). Generated internally if omitted. */
  requestID?: string;
  /** Metadata forwarded to the panel message endpoint. */
  metadata?: Record<string, unknown>;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Workspace epoch guard — if supplied, response is ignored on mismatch. */
  workspaceEpoch?: number;
  /** Called once the panel stream response is accepted and ready to read. */
  onOpen?: () => void | Promise<void>;
  /** Called for each parsed panel stream event before the final result resolves. */
  onEvent?: (event: any) => void | Promise<void>;
}

export interface CreateTaskOptions {
  text: string;
  attachments?: Attachment[];
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface SelectTaskOptions {
}

// ── Helpers ──

/**
 * Default chat request timeout: 10 minutes.
 */
function chatRequestTimeoutMs(): number {
  const overlayTiming = (window as any).__ocOverlayTiming;
  const testTiming = (window as any).__overlayTest;
  const override =
    typeof overlayTiming?.chatTimeoutMs === "number"
      ? overlayTiming.chatTimeoutMs
      : typeof testTiming?.chatTimeoutMs === "number"
        ? testTiming.chatTimeoutMs
        : undefined;
  const value = typeof override === "number" ? override : 10 * 60 * 1000;
  return Math.max(value, 1000);
}

function activeDirectory(): string {
  return boardStore.board?.task?.directory || settingsStore.directory || "";
}

function inactivityTimeoutError(timeoutMs: number): DOMException {
  return new DOMException(
    `Panel stream inactive for ${timeoutMs}ms`,
    "TimeoutError",
  );
}

function relayAbort(
  source: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (!source) return () => undefined;
  const abort = () => {
    controller.abort(
      source.reason instanceof Error ? source.reason : source.reason ?? undefined,
    );
  };
  if (source.aborted) {
    abort();
    return () => undefined;
  }
  source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

async function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) {
    await reader.cancel(signal.reason).catch(() => undefined);
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      void reader.cancel(signal.reason).catch(() => undefined);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    reader.read().then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

// ── Panel message request body builder ──

export function panelRequestBody(
  text: string,
  metadata: Record<string, unknown> = {},
  requestID: string = "",
  attachments: Attachment[] = [],
  executor: string = "opencode",
): Record<string, unknown> {
  const taskID = boardStore.selectedTaskID || undefined;
  const body: Record<string, unknown> = {
    surface: "panel",
    text,
    time_created: Date.now(),
    taskID,
    executor,
    request_id: requestID || undefined,
    allow_create: true,
    allow_session_mutation: false,
    directory: activeDirectory() || undefined,
    metadata: {
      selectedTaskID: taskID,
      ...metadata,
    },
  };
  if (attachments.length > 0) {
    body.attachments = attachments.map((att) => ({
      mime: att.mime,
      url: att.url,
      ...(att.filename ? { filename: att.filename } : {}),
    }));
  }
  return body;
}

// ── Public: selectTask ──

/**
 * Switch to a task: stop SSE, reset message state, load board + transcript,
 * start SSE for the new task.
 * Pass an empty string to deselect all tasks.
 */
export async function selectTask(
  taskID: string,
  options: SelectTaskOptions = {},
): Promise<void> {
  const nextTaskID = taskID || "";

 // Guard: skip if already on this task and board is loaded
  if (nextTaskID === boardStore.selectedTaskID && boardStore.board) {
    return;
  }

 // Stop any running SSE stream
  stopSSE();

 // Clear board and message state immediately
  setBoardStore("board", null);
  clearMessages();
  clearAgentEvents();
  // Reset budget dirty flag so the new task's budget values populate correctly.
  // Without this, stale budgetDirty=true from a previous task edit would
  // prevent setBudgetInputs from running inside renderBudget.
  if (appStore.budgetDirty) {
    setAppStore("budgetDirty", false);
  }
  setSelectedTaskID(nextTaskID);
  setBoardStore("selectedTaskID", nextTaskID);

  if (!nextTaskID) {
 // Deselecting — nothing further to load
    return;
  }

 // Load board + transcript in parallel (best-effort; failures are logged)
  await Promise.all([
    loadBoard({ sync: true }).catch((e) =>
      console.error("[selectTask] loadBoard failed:", e),
    ),
    syncTask(nextTaskID).catch((e) =>
      console.error("[selectTask] syncTask failed:", e),
    ),
  ]);

 // Start SSE for the newly selected task
  startSSE(nextTaskID);
}

// ── Public: deleteTask ──

/**
 * Delete a task by ID.
 * Does NOT show a confirmation dialog — callers must confirm before calling.
 * Returns true on success, false on failure.
 */
export async function deleteTask(taskID: string): Promise<boolean> {
  if (!taskID) return false;
  try {
    await apiJson(`task/${encodeURIComponent(taskID)}`, {
      method: "DELETE",
    });
    if (boardStore.selectedTaskID === taskID) {
      await selectTask("");
    }
    await loadTasks();
    return true;
  } catch (e) {
    console.error("[deleteTask] failed", { error: String(e), taskID });
    return false;
  }
}

// ── Public: submitMessage ──

/**
 * Send a message to the current task (or create a new task if none is
 * selected). Uses the panel/message/stream endpoint.
 * This is a lean version of panelMessage that omits
 * placeholder mutations. The caller is responsible for pre-inserting
 * optimistic messages into the Solid message store if desired.
 */
export async function submitMessage(
  text: string,
  attachments: Attachment[] = [],
  options: SubmitMessageOptions = {},
): Promise<unknown> {
  const requestID = options.requestID ?? crypto.randomUUID();
  const timeoutMs = chatRequestTimeoutMs();
  const controller = new AbortController();
  const cleanupRelay = relayAbort(options.signal, controller);
  const executor =
    settingsStore.executor ?? "opencode";
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  const markActivity = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      controller.abort(inactivityTimeoutError(timeoutMs));
    }, timeoutMs);
  };

  const body = JSON.stringify(
    panelRequestBody(
      text,
      options.metadata ?? {},
      requestID,
      attachments,
      executor,
    ),
  );

  markActivity();

  try {
    const res = await fetch(apiUrl("panel/message/stream"), {
      method: "POST",
      headers: { ...apiHeaders(), "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });

    markActivity();

    if (!res.ok || !res.body) {
      throw new Error(`Panel stream failed: ${res.status} ${res.statusText}`);
    }
    await options.onOpen?.();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let result: unknown = null;

    const consume = async (chunk: string, flush = false) => {
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
          markActivity();
          await options.onEvent?.(ev);
          if (ev.type === "done") {
            result = ev.result;
          }
        } catch {
 // malformed SSE event — skip
        }
      }
    };

    while (true) {
      const { done, value } = await readWithAbort(reader, controller.signal);
      if (done) {
        await consume(decoder.decode(), true);
        break;
      }
      markActivity();
      await consume(decoder.decode(value, { stream: true }));
    }

    if (!result) {
      throw new Error("Panel stream ended without a final result");
    }

    return result;
  } finally {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    cleanupRelay();
  }
}

// ── Public: createTask ──

/**
 * Create a new task via direct API. Returns the task_id immediately.
 * No LLM round-trip — the backend persists the task in ~10ms.
 */
export async function createTask(options: CreateTaskOptions): Promise<string> {
  const { text, attachments = [], metadata = {}, signal } = options;
  if (!text) throw new Error("createTask: text is required");
  const requestID = crypto.randomUUID();
  const executor = settingsStore.executor ?? "opencode";
  const result = (await apiJson("task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      request: text,
      executor,
      requestID,
      metadata,
      source: "panel",
      ...(attachments.length > 0
        ? {
            attachments: attachments.map((att) => ({
              mime: att.mime,
              url: att.url,
              ...(att.filename ? { filename: att.filename } : {}),
            })),
          }
        : {}),
    }),
    signal,
  })) as any;
  return typeof result?.task_id === "string" ? result.task_id : "";
}

// ── Public: retryTask ──

/**
 * Retry a failed task. Direct API call, no LLM involvement.
 */
export async function retryTask(taskID: string): Promise<void> {
  if (!taskID) return;
  await apiJson(`task/${encodeURIComponent(taskID)}/retry`, {
    method: "POST",
  });
  await loadBoard();
}

// ── Public: replanTask ──

/**
 * Trigger a replan for the given task. Direct API call, no LLM involvement.
 */
export async function replanTask(taskID: string): Promise<void> {
  if (!taskID) return;
  await apiJson(`task/${encodeURIComponent(taskID)}/replan`, {
    method: "POST",
  });
  await loadBoard();
}

// ── Public: cancelTask ──

/**
 * Cancel the given task. Direct API call, no LLM involvement.
 */
export async function cancelTask(taskID: string): Promise<void> {
  if (!taskID) return;
  await apiJson(`task/${encodeURIComponent(taskID)}/cancel`, {
    method: "POST",
  });
  await loadBoard();
}

// ── Public: interruptTask ──

/**
 * Interrupt an active task: abort any in-flight chat request, then cancel
 * the task via direct API. This is the unified "stop" operation.
 */
export async function interruptTask(taskID: string): Promise<boolean> {
  if (!taskID) return false;
  try {
    await apiJson(`task/${encodeURIComponent(taskID)}/cancel`, {
      method: "POST",
    });
    await loadBoard();
    return true;
  } catch (e) {
    console.error("[interruptTask] failed", { error: String(e), taskID });
    return false;
  }
}

