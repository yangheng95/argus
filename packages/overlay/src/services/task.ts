// ── Task Service ──
// Exact port of app.js task management logic.
//
// Responsibilities:
//   - Select a task (stop SSE, clear messages, load board + transcript, start SSE)
//   - Delete a task
//   - Create a task (via panelMessage)
//   - Submit a message to the current task (panelMessage stream)
//   - Retry / replan / cancel a task (via panelMessage)
//   - Task recovery polling (startTaskRecovery)
//
// This module owns no render-side effects.  Callers are responsible for
// driving UI updates through reactive Solid stores.

import { apiJson, apiUrl, apiHeaders } from "./api";
import { startSSE, stopSSE } from "./sse";
import {
  syncTask,
  clearMessages,
  setSelectedTaskID,
} from "../store/messages";
import {
  loadBoard,
  loadTasks,
  boardStore,
  setBoardStore,
  setPendingTasks,
} from "../store/board";
import { clipText } from "../utils/string";
import { settingsStore } from "../store/settings";
import { getWorkspaceEpoch } from "./workspace";

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
  preserveMessages?: boolean;
}

// ── Helpers ──

/**
 * Default chat request timeout: 10 minutes.
 * Mirrors app.js chatRequestTimeoutMs.
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
  return boardStore.board?.task?.directory ?? "";
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
 *
 * Pass an empty string to deselect all tasks.
 *
 * Mirrors app.js selectTask, delegating SSE/transcript to Solid services.
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
  if (!options.preserveMessages) {
    clearMessages();
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
 *
 * Returns true on success, false on failure.
 * Mirrors app.js deleteTask (without UI dialogs).
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
 * selected).  Uses the panel/message/stream endpoint.
 *
 * This is a lean version of app.js panelMessage that omits legacy DOM
 * placeholder mutations.  The caller is responsible for pre-inserting
 * optimistic messages into the Solid message store if desired.
 *
 * Mirrors app.js panelMessage + panelMessageStream (data layer only).
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
 * Create a new task by submitting the initial message to the panel endpoint.
 * Returns the resolved task_id string, or empty string if not resolved.
 *
 * Mirrors app.js chat form submit handler (data layer only — no DOM side-effects).
 */
export async function createTask(options: CreateTaskOptions): Promise<string> {
  const { text, attachments = [], metadata = {}, signal } = options;
  if (!text) throw new Error("createTask: text is required");
  const requestID = crypto.randomUUID();
  const result = (await submitMessage(text, attachments, {
    requestID,
    metadata,
    signal,
  })) as any;
  return typeof result?.task_id === "string" ? result.task_id : "";
}

// ── Public: retryTask ──

/**
 * Retry a failed task, optionally with operator guidance.
 * Mirrors app.js performTaskAction("retry").
 */
export async function retryTask(
  taskID: string,
  note?: string,
): Promise<void> {
  if (!taskID) return;
  const message = note?.trim()
    ? `Retry task ${taskID} with this operator guidance: ${note}`
    : `Perform retry on task ${taskID}.`;
  await submitMessage(
    message,
    [],
    {
      metadata: {
        taskID,
        ui_context: "task_controls",
        ...(note?.trim() ? { operator_note: note.trim() } : {}),
      },
    },
  );
  await loadBoard();
}

// ── Public: replanTask ──

/**
 * Trigger a replan for the given task.
 * Mirrors app.js performTaskAction("replan").
 */
export async function replanTask(taskID: string): Promise<void> {
  if (!taskID) return;
  await submitMessage(
    `Perform replan on task ${taskID}.`,
    [],
    {
      metadata: {
        taskID,
        ui_context: "task_controls",
      },
    },
  );
  await loadBoard();
}

// ── Public: cancelTask ──

/**
 * Cancel the given task.
 * Mirrors app.js performTaskAction("cancel").
 */
export async function cancelTask(taskID: string): Promise<void> {
  if (!taskID) return;
  await submitMessage(
    `Perform cancel on task ${taskID}.`,
    [],
    {
      metadata: {
        taskID,
        ui_context: "task_controls",
      },
    },
  );
  await loadBoard();
}

// ── Task recovery timing helpers ──

function overlayTiming(name: string, fallback: number, min = 50): number {
  const cfg = (window as any).__overlayTest;
  const value = Number(cfg?.[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

/**
 * Maximum time to spend polling for a task to appear after submission.
 * Mirrors app.js taskRecoveryTimeoutMs.
 */
export function taskRecoveryTimeoutMs(): number {
  return overlayTiming("taskRecoveryTimeoutMs", 10 * 60 * 1000, 1000);
}

/**
 * Interval between task-list polls during recovery.
 * Mirrors app.js taskRecoveryPollMs.
 */
export function taskRecoveryPollMs(): number {
  return overlayTiming("taskRecoveryPollMs", 2000, 50);
}

// ── Types ──

export interface TaskRecoveryRequest {
  requestID: string;
  workspaceEpoch?: number;
  manualAbort?: boolean;
  recoveredTaskID?: string;
  timedOut?: boolean;
  aborted?: boolean;
  controller?: AbortController;
}

export interface TaskRecovery {
  active: boolean;
  stop(): void;
  promise: Promise<string>;
}

// ── Internal helpers ──

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sortedTasks(data: any): any[] {
  return [...(Array.isArray(data?.tasks) ? data.tasks : [])].sort(
    (a, b) =>
      (b.updated_at || b.task?.time?.updated || 0) -
      (a.updated_at || a.task?.time?.updated || 0),
  );
}

function taskByRequestID(requestID: string, list: any[]): any {
  if (!requestID || !Array.isArray(list)) return null;
  return list.find((item) => item?.task?.requestID === requestID) || null;
}

// ── Public: startTaskRecovery ──

/**
 * Poll the task list until the pending request appears as a confirmed task,
 * then select it and stop the recovery loop.
 *
 * Mirrors app.js startTaskRecovery (data layer only).
 *
 * @param request  The pending chat request descriptor.
 * @returns  A recovery handle with `stop()` and `promise` (resolves to taskID or "").
 */
export function startTaskRecovery(
  request: TaskRecoveryRequest,
): TaskRecovery | null {
  if (!request?.requestID) return null;

  const recovery: TaskRecovery = {
    active: true,
    stop() {
      recovery.active = false;
    },
    promise: Promise.resolve(""),
  };

  recovery.promise = (async (): Promise<string> => {
    const started = Date.now();
    const epochAtStart = request.workspaceEpoch;

    while (
      recovery.active &&
      Date.now() - started < taskRecoveryTimeoutMs()
    ) {
      if (request.manualAbort) break;
      // Stop if workspace changed and task hasn't been recovered yet
      if (
        epochAtStart !== undefined &&
        // workspaceEpoch comparison: use window fallback for legacy state
        getWorkspaceEpoch() !== epochAtStart &&
        !request.recoveredTaskID
      ) {
        break;
      }

      const data = await apiJson("tasks").catch(() => null);
      const tasks = Array.isArray(data?.tasks) ? sortedTasks(data) : [];
      const match = taskByRequestID(request.requestID, tasks);
      const taskID: string = match?.task?.id || "";

      if (taskID) {
        // Mark as recovered before selecting
        request.recoveredTaskID = taskID;

        if (!request.timedOut && !request.aborted) {
          request.aborted = true;
          request.controller?.abort();
        }

        // Select the newly confirmed task
        await selectTask(taskID, { preserveMessages: true });

        recovery.stop();
        return taskID;
      }

      await delay(taskRecoveryPollMs());
    }

    recovery.stop();
    return "";
  })();

  return recovery;
}

// ── Pending task management ──
// Mirrors app.js pendingTaskKey / rememberPendingTask / forgetPendingTask / syncPendingTasks.
// These functions manage the client-side list of tasks that have been submitted
// locally but not yet confirmed by the server.

/**
 * Build the localStorage / state key for a pending task request.
 * Mirrors app.js pendingTaskKey.
 */
export function pendingTaskKey(requestID: string): string {
  const value = typeof requestID === "string" ? requestID.trim() : "";
  return value ? `pending:${value}` : "";
}

/**
 * Add (or refresh) a pending-task placeholder in boardStore.pendingTasks.
 * The placeholder is removed automatically by syncPendingTasks once the server
 * confirms the task.
 * Mirrors app.js rememberPendingTask.
 */
export function rememberPendingTask(requestID: string, title?: string): void {
  const value = typeof requestID === "string" ? requestID.trim() : "";
  if (!value) return;
  const headline = clipText(title || value, 72) || value;
  const now = Date.now();
  const next = [
    {
      _pending: true,
      requestID: value,
      task: {
        id: pendingTaskKey(value),
        requestID: value,
        source: "panel",
        title: headline,
        status: "planning",
        directory: boardStore.board?.task?.directory ?? "",
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
    ...boardStore.pendingTasks.filter((item: any) => item?.requestID !== value),
  ];
  setPendingTasks(next);
}

/**
 * Remove a pending-task placeholder from boardStore.pendingTasks.
 * Returns true if the placeholder was present and removed, false otherwise.
 * Mirrors app.js forgetPendingTask.
 */
export function forgetPendingTask(requestID: string): boolean {
  const value = typeof requestID === "string" ? requestID.trim() : "";
  if (
    !value ||
    !boardStore.pendingTasks.some((item: any) => item?.requestID === value)
  ) {
    return false;
  }
  setPendingTasks(
    boardStore.pendingTasks.filter((item: any) => item?.requestID !== value),
  );
  return true;
}

/**
 * Prune confirmed tasks from boardStore.pendingTasks.
 * Removes any pending placeholder whose requestID now appears in the given
 * confirmed task list (defaults to boardStore.tasks).
 * Mirrors app.js syncPendingTasks.
 */
export function syncPendingTasks(items: any[] = boardStore.tasks): void {
  if (boardStore.pendingTasks.length === 0) return;
  const seen = new Set(
    (Array.isArray(items) ? items : [])
      .map((item: any) => item?.task?.requestID)
      .filter(Boolean),
  );
  if (seen.size === 0) return;
  const next = boardStore.pendingTasks.filter(
    (item: any) => !seen.has(item?.requestID),
  );
  if (next.length === boardStore.pendingTasks.length) return;
  setPendingTasks(next);
}
