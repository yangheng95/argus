// ── Task Service ──
// Responsibilities:
// - Select a task (stop SSE, clear messages, load board + transcript, start SSE)
// - Delete a task
// - Create a task (direct API)
// - Submit a message to the current task (direct API)
// - Retry / replan / cancel / interrupt a task (direct API)
// This module owns no render-side effects. Callers are responsible for
// driving UI updates through reactive Solid stores.

import { apiJson, apiRequest, ApiError } from "./api";
import { getHostTransport } from "./host-transport";
import { isSelectedTaskSSEConnected, startSSE, stopSSE } from "./sse";
import { showAppDialog } from "./app-dialog";
import { initGitCurrent } from "../utils/git";
import { t } from "../utils/i18n";
import {
  clearMessages,
  setSelectedTaskID,
  abortChatRequest,
  setChatAttachments,
} from "../store/messages";
import {
  loadTasks,
  loadBoard,
  clearBoard,
  boardStore,
  setBoardStore,
  setOrphanedSelectionHandler,
  taskByID,
  activeTaskID,
} from "../store/board";
import {
  settingsStore,
  setSettingsStore,
  saveSettings,
  sanitizeExecutor,
  workspaceRestoreDirectory,
} from "../store/settings";
import { appStore, setAppStore } from "../store/app";
import { taskScopedPath } from "./task-path";
import { applyDirectory } from "./workspace";
import { resetWriter } from "./tree-writer";
import { cancelConversationReplay, hydrateTaskConversation } from "./conversation";
import { resetSelectedLiveCursor } from "./selected-stream-cursor";
import { ackTaskNotificationIfPresent } from "./notify";

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
  queue?: boolean;
  kind?: "workflow" | "build";
  /** Optional priority override; the server defaults to "normal". */
  priority?: "critical" | "high" | "normal" | "low";
  /** Optional executor override. The server defaults to the project executor. */
  executor?: "opencorvus" | "codex" | "claude-code";
  /** Title override. Server falls back to the request body when omitted. */
  title?: string;
  signal?: AbortSignal;
  budget?: {
    maxExecutorGroups?: number;
  };
}

export interface SelectTaskOptions {
}

// ── Helpers ──

function taskPath(taskID: string, suffix = ""): string {
  const item = taskByID(taskID);
  const directory =
    typeof item?.task?.directory === "string" ? item.task.directory : "";
  return taskScopedPath(taskID, directory, suffix);
}

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

// ── Panel message request body builder ──

export function panelRequestBody(
  text: string,
  metadata: Record<string, unknown> = {},
  requestID: string = "",
  attachments: Attachment[] = [],
  executor: string = "opencorvus",
): Record<string, unknown> {
  const taskID = activeTaskID() || undefined;
  const body: Record<string, unknown> = {
    surface: "panel",
    text,
    time_created: Date.now(),
    taskID,
    executor: sanitizeExecutor(executor),
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
// Task IDs are opencorvus identifiers: a lowercase prefix, an underscore, and
// a ULID/base32 body, optionally with hyphens (requestIDs). Anything outside
// [A-Za-z0-9_-] (path separators, whitespace, colons, etc.) indicates the
// caller passed a corrupted value — for example a mission message metadata
// field polluted with a filesystem path. Fail loudly so the call stack points
// directly at the source instead of triggering silent 400-request floods.
const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const TASK_DECISION_COUNTDOWN_SECONDS = 8;
const TASK_SELECTION_INITIAL_TAIL_LIMIT = 8;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function selectTask(
  taskID: string,
  options: SelectTaskOptions = {},
): Promise<void> {
  const nextTaskID = taskID || "";

  if (nextTaskID && !TASK_ID_PATTERN.test(nextTaskID)) {
    throw new Error(
      `selectTask: invalid taskID ${JSON.stringify(nextTaskID)} — expected [A-Za-z0-9_-]{1,128}`,
    );
  }

  // Guard: skip if already on this task. Board-loaded OR switch-in-flight
  // both count as "nothing to do" — without the taskSwitching check a user
  // clicking the same task before the first load finishes would interrupt
  // and restart their own load.
  if (
    nextTaskID === activeTaskID() &&
    (boardStore.board || boardStore.taskSwitching)
  ) {
    if (nextTaskID && boardStore.board && !boardStore.taskSwitching && !isSelectedTaskSSEConnected(nextTaskID)) {
      startSSE({ kind: "task", id: nextTaskID }, boardStore.taskSequence);
    }
    if (nextTaskID && boardStore.board && !boardStore.taskSwitching) {
      ackTaskNotificationIfPresent(nextTaskID);
    }
    return;
  }

  const epoch = boardStore.selectEpoch + 1;

  // ── Synchronous phase ────────────────────────────────────────────────
  // Everything the UI needs to feel "switched instantly" happens here:
  // cancel in-flight work, wipe task-scoped stores, flip the selected ID,
  // flip taskSwitching=true so the top progress bar appears. Any async work
  // is deferred to the next phase under epoch guard so rapid-fire clicks
  // don't trample each other.
  abortChatRequest();
  cancelConversationReplay();
  setChatAttachments([]);
  stopSSE();
  resetSelectedLiveCursor();
  clearBoard();
  clearMessages();
  // Drop cardTreeStore + the writer's internal session/message/integrity
  // indices so the conversation panel doesn't carry stale cards into the
  // next task. resetWriter() was documented for task-switch use but had no
  // production call site — the old pipeline's derivation from messageStore
  // masked the leak until the new writer became source-of-truth.
  resetWriter({ scrollIntent: "bottom", cause: "task-switch" });
  setSelectedTaskID(nextTaskID);
  setBoardStore("selectedSource", nextTaskID ? { kind: "task", id: nextTaskID } : null);
  setBoardStore("selectEpoch", epoch);

  if (!nextTaskID) {
    // Deselection has no async work; make sure any lingering progress UI
    // from a superseded switch is cleared.
    setBoardStore("taskSwitching", false);
    // Clear persisted workspace identity so next launch does not resume a
    // task the user just deselected.
    setSettingsStore("workspaceTaskID", "");
    setSettingsStore("workspaceDirectory", "");
    saveSettings();
    return;
  }

  setBoardStore("taskSwitching", true);

  // ── Async phase ──────────────────────────────────────────────────────
  const stale = () => boardStore.selectEpoch !== epoch;

  try {
    // Cross-project switch: apply the new directory so every project-scoped
    // API (config, permissions, meta, executors) targets the correct
    // backend Instance before we load the new task's board.
    const taskItem = taskByID(nextTaskID);
    const taskDirectory =
      typeof taskItem?.task?.directory === "string" ? taskItem.task.directory : "";
    if (taskDirectory && taskDirectory !== settingsStore.directory) {
      await applyDirectory(taskDirectory, { save: true });
      if (stale()) return;
    }

    const lastSequence = await hydrateTaskConversation(nextTaskID, {
      scrollIntent: "bottom",
      resetCause: "task-switch-hydrate",
      tailLimit: TASK_SELECTION_INITIAL_TAIL_LIMIT,
    });
    if (stale()) return;

    startSSE({ kind: "task", id: nextTaskID }, lastSequence);

    // Persist the active task so initApp -> restoreInitialWorkspace() can
    // resume it on the next launch. Without this write the localStorage key
    // stays empty and the overlay always boots into an empty workspace.
    const restoreDir = workspaceRestoreDirectory(
      taskDirectory || settingsStore.directory || "",
    );
    setSettingsStore("workspaceTaskID", nextTaskID);
    setSettingsStore("workspaceDirectory", restoreDir);
    saveSettings();
    ackTaskNotificationIfPresent(nextTaskID);
  } catch (error) {
    if (stale() && isAbortError(error)) return;
    throw error;
  } finally {
    // Only clear the progress flag if we are still the active selection.
    // A newer selectTask() call has taken over and will manage its own flag.
    if (boardStore.selectEpoch === epoch) {
      setBoardStore("taskSwitching", false);
    }
  }
}

// ── Public: deleteTask ──

/**
 * Delete a task by ID.
 * Does NOT show a confirmation dialog — callers must confirm before calling.
 * Returns true on success, false on failure.
 */
export async function deleteTask(taskID: string): Promise<boolean> {
  if (!taskID) return false;
  const wasActive = activeTaskID() === taskID;
  if (wasActive) {
    await selectTask("");
  }
  try {
    await apiJson(taskPath(taskID), {
      method: "DELETE",
    });
    await loadTasks();
    return true;
  } catch (e) {
    console.error("[deleteTask] failed", { error: String(e), taskID });
    if (wasActive && e instanceof ApiError && e.status === 404) {
      await loadTasks().catch(() => undefined);
      return true;
    }
    return false;
  }
}

// ── Public: renameTask ──

/**
 * Rename a task in place. Trimming and length enforcement match the server-side
 * Zod schema (1–200 chars after trim). Returns true on success, false on any
 * failure so the caller can revert the optimistic UI edit and surface a notice.
 */
export async function renameTask(taskID: string, title: string): Promise<boolean> {
  if (!taskID) return false;
  const trimmed = title.trim();
  if (!trimmed || trimmed.length > 200) return false;
  try {
    await apiJson(taskPath(taskID, "/title"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });
    await loadTasks();
    if (activeTaskID() === taskID) {
      await loadBoard();
    }
    return true;
  } catch (e) {
    console.error("[renameTask] failed", { error: String(e), taskID });
    return false;
  }
}

function contentDispositionFilename(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /filename="([^"]+)"/i.exec(header) || /filename=([^;]+)/i.exec(header);
  const raw = match?.[1]?.trim();
  if (!raw) return undefined;
  return raw.replace(/[\\/:*?"<>|]+/g, "-") || undefined;
}

function defaultArchiveFilename(taskID: string): string {
  const safe = taskID.replace(/[^A-Za-z0-9._-]+/g, "-") || "task";
  return `${safe}-project.zip`;
}

function saveBytesAsDownload(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function decodeBinaryErrorBody(body: Uint8Array): unknown {
  const text = new TextDecoder().decode(body).trim();
  if (!text) return body;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── Public: downloadTaskProjectArchive ──

/**
 * Download a ZIP containing the task's project files plus its persisted
 * execution-flow projections.
 */
export async function downloadTaskProjectArchive(taskID: string): Promise<boolean> {
  if (!taskID) return false;
  const archivePath = taskPath(taskID, "/project-archive");
  const response = await apiRequest<Uint8Array>(archivePath, {
    responseKind: "binary",
  });
  if (!response.ok) {
    throw new ApiError(response.status, archivePath, decodeBinaryErrorBody(response.body));
  }
  const filename =
    contentDispositionFilename(response.headers["content-disposition"] || response.headers["Content-Disposition"])
    || defaultArchiveFilename(taskID);
  saveBytesAsDownload(response.body, filename);
  return true;
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
  const executor = sanitizeExecutor(settingsStore.executor);
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  const markActivity = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      controller.abort(inactivityTimeoutError(timeoutMs));
    }, timeoutMs);
  };

  const requestPayload = panelRequestBody(
    text,
    options.metadata ?? {},
    requestID,
    attachments,
    executor,
  );

  markActivity();

  const selectedSource = boardStore.selectedSource;
  if (selectedSource?.kind === "session") {
    try {
      return await apiJson(`session/${encodeURIComponent(selectedSource.id)}/prompt_async`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parts: [
            {
              type: "text",
              text,
              ...(options.metadata ? { metadata: options.metadata } : {}),
            },
          ],
          ...(attachments.length > 0 ? { attachments } : {}),
        }),
        signal: controller.signal,
      });
    } finally {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      cleanupRelay();
    }
  }

  // Route through HostTransport.openStream so this POST-stream pattern
  // works identically under Tauri (fetch + ReadableStream + manual
  // SSE block parsing in tauri-transport) and under VS Code (M4
  // postMessage bridge with sidecar-side SSE forwarding). Per-event
  // activity tracking replaces the historical per-chunk tracking;
  // events arrive frequently enough that the granularity loss is
  // imperceptible while removing reader-level abort plumbing.
  return new Promise<unknown>((resolve, reject) => {
    let result: unknown = null;
    let settled = false;

    const handle = getHostTransport().openStream(
      {
        path: "panel/message/stream",
        method: "POST",
        body: { kind: "json", value: requestPayload },
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      },
      {
        onOpen: () => {
          markActivity();
          void options.onOpen?.();
        },
        onEvent: (data) => {
          let ev: any;
          try {
            ev = JSON.parse(data);
          } catch {
            return; // malformed SSE event — skip
          }
          markActivity();
          void options.onEvent?.(ev);
          if (ev?.type === "done") result = ev.result;
        },
        onError: (err) => {
          if (settled) return;
          settled = true;
          if (inactivityTimer) clearTimeout(inactivityTimer);
          cleanupRelay();
          reject(err);
        },
        onClose: (_reason) => {
          if (settled) return;
          settled = true;
          if (inactivityTimer) clearTimeout(inactivityTimer);
          cleanupRelay();
          if (result !== null && result !== undefined) {
            resolve(result);
          } else {
            reject(new Error("Panel stream ended without a final result"));
          }
        },
      },
    );

    // Mirror prior abort behaviour: caller-side abort closes the stream.
    const abortListener = () => handle.close();
    if (controller.signal.aborted) {
      handle.close();
    } else {
      controller.signal.addEventListener("abort", abortListener, { once: true });
    }
  });
}

// ── Public: createTask ──

/**
 * Server-side: W2-V32 (commit aa14f20e7) removed every auto git-init in the
 * project bootstrap, so task creation throws WorktreeNotGitError when the
 * active directory is not a git repo. Detect that single error and offer the
 * user the explicit init gesture, then retry once. Any other failure (or a
 * declined prompt) propagates to the caller so the existing handlers in
 * panelMessage / submitChat surface it normally.
 */
function isWorktreeNotGitError(err: unknown): err is ApiError {
  if (!(err instanceof ApiError)) return false;
  if (err.status !== 412) return false;
  const body = err.body as { name?: unknown } | null;
  return !!body && typeof body === "object" && body.name === "WorktreeNotGitError";
}

async function offerInitGitAndRetry(): Promise<boolean> {
  const result = await showAppDialog({
    title: t("git.init"),
    message: t("git.init_required"),
    cancel: true,
    okLabel: t("common.ok"),
  });
  if (!result.confirmed) return false;
  return await initGitCurrent({ notify: false });
}

async function resolveTaskQueueDecision(input: { queue?: boolean; signal?: AbortSignal }): Promise<boolean> {
  if (typeof input.queue === "boolean") return input.queue;
  if (input.signal?.aborted) {
    throw input.signal.reason instanceof Error ? input.signal.reason : new DOMException("Task creation aborted", "AbortError");
  }
  const result = await showAppDialog({
    kind: "task-queue-decision",
    title: t("task.queue_decision.title"),
    message: t("task.queue_decision.message"),
    selectLabel: t("task.queue_decision.label"),
    selectValue: "start",
    recommendedValue: "start",
    countdownSeconds: TASK_DECISION_COUNTDOWN_SECONDS,
    selectOptions: [
      { value: "start", label: t("task.queue_decision.start") },
      { value: "queue", label: t("task.queue_decision.queue") },
    ],
  });
  if (!result.confirmed) {
    throw new DOMException("Task creation cancelled before queue decision", "AbortError");
  }
  if (result.value === "start") return false;
  if (result.value === "queue") return true;
  throw new Error(`Unknown task queue decision: ${String(result.value)}`);
}

async function resolveTaskKindDecision(input: { kind?: "workflow" | "build"; signal?: AbortSignal }): Promise<"workflow" | "build"> {
  if (input.kind === "workflow" || input.kind === "build") return input.kind;
  if (input.signal?.aborted) {
    throw input.signal.reason instanceof Error ? input.signal.reason : new DOMException("Task creation aborted", "AbortError");
  }
  return "workflow";
}

/**
 * Create a new task via direct API. Returns the task_id immediately.
 * No LLM round-trip — the backend persists the task in ~10ms.
 */
export async function createTask(options: CreateTaskOptions): Promise<string> {
  const { text, attachments = [], metadata = {}, signal, budget } = options;
  if (!text) throw new Error("createTask: text is required");
  const kind = await resolveTaskKindDecision({ kind: options.kind, signal });
  const queue = await resolveTaskQueueDecision({ queue: options.queue, signal });
  const requestID = crypto.randomUUID();
  // Caller-provided executor wins when supplied (e.g. Mission-dispatched
  // task carries its own executor pick); otherwise inherit the
  // project setting so panel-driven creation behaves as before.
  const executor = options.executor
    ? sanitizeExecutor(options.executor)
    : sanitizeExecutor(settingsStore.executor);
  const body = JSON.stringify({
    request: text,
    executor,
    requestID,
    kind,
    queue,
    metadata,
    source: "panel",
    ...(options.priority ? { priority: options.priority } : {}),
    ...(options.title ? { title: options.title } : {}),
    ...(budget ? { budget } : {}),
    ...(attachments.length > 0
      ? {
          attachments: attachments.map((att) => ({
            mime: att.mime,
            // TaskAttachment schema expects pure base64 (no data URL prefix)
            data: att.url.includes(",") ? att.url.split(",")[1] : att.url,
            ...(att.filename ? { filename: att.filename } : {}),
          })),
        }
      : {}),
  });
  const post = () =>
    apiJson("task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal,
    });
  let result: any;
  try {
    result = await post();
  } catch (err) {
    if (!isWorktreeNotGitError(err)) throw err;
    const initialized = await offerInitGitAndRetry();
    if (!initialized) throw err;
    result = await post();
  }
  return typeof result?.task_id === "string" ? result.task_id : "";
}

// ── Public: retryTask ──

/**
 * Retry a failed task. Direct API call, no LLM involvement.
 */
export async function retryTask(taskID: string): Promise<void> {
  if (!taskID) return;
  await apiJson(taskPath(taskID, "/retry"), {
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
  await apiJson(taskPath(taskID, "/replan"), {
    method: "POST",
  });
  await loadBoard();
}

// ── Public: replyToAgentSession ──

/**
 * Append scoped human input directly to a task child-agent session. This does
 * not route through the task-level panel message endpoint.
 */
export async function replyToAgentSession(
  taskID: string,
  sessionID: string,
  message: string,
): Promise<void> {
  const text = message.trim();
  if (!taskID || !sessionID || !text) return;
  await apiJson(
    taskPath(taskID, `/session/${encodeURIComponent(sessionID)}/reply`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    },
  );
}

// ── Public: cancelAgentSession ──

/**
 * Cancel a task child-agent session without changing global orchestration.
 * Running tool chips call this too because tools execute inside the session.
 */
export async function cancelAgentSession(
  taskID: string,
  sessionID: string,
): Promise<void> {
  if (!taskID || !sessionID) return;
  await apiJson(
    taskPath(taskID, `/session/${encodeURIComponent(sessionID)}/cancel`),
    {
      method: "POST",
    },
  );
}

// ── Public: cancelTask ──

/**
 * Cancel the given task. Direct API call, no LLM involvement.
 */
export async function cancelTask(taskID: string): Promise<void> {
  if (!taskID) return;
  await apiJson(taskPath(taskID, "/cancel"), {
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
    await apiJson(taskPath(taskID, "/cancel"), {
      method: "POST",
    });
    await loadBoard();
    return true;
  } catch (e) {
    console.error("[interruptTask] failed", { error: String(e), taskID });
    return false;
  }
}

// ── Orphan-selection reconciliation ──
// board.ts's applyTasks() is the single choke point for tasks-list writes.
// When it detects that `selectedTaskID` points to a task no longer present in
// the list (and not in pendingTasks), it calls this handler to fully reset
// the selection — driving the same cleanup path (clearBoard / clearMessages /
// stopSSE) that every intentional deselect uses. Registered at module load so
// it's in place before any tasks fetch completes.
setOrphanedSelectionHandler(() => {
  void selectTask("");
});
