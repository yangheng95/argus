// ── Chat Service ──
// Responsibilities:
// - Manage staged chat attachments (add / remove / take metadata)
// - Manage the active chat AbortController (stop / abort targets)
// - Expose pure predicates: canComposeChat, chatAbortTargets, chatAbortTarget
// - Provide conversationTarget / conversationTargetKey helpers
// - Expose panelResultNavigates predicate
// This module owns no render-side effects. Callers drive UI updates through
// reactive Solid stores.

import { apiJson } from "./api"
import {
  messageStore,
  setChatRequest,
  abortChatRequest,
  setChatAttachments,
  mergeLoadedConversationMessages,
} from "../store/messages"
import { boardStore, setTasksData, loadBoard, loadTasks, activeTaskID, activeSessionID } from "../store/board"
import { appStore, setConnectionStatus } from "../store/app"
import { workspaceMode } from "./workspace"
import { selectTask, createTask, currentOpenCorvusModel } from "./task"
import { setSessionExpertSquadActive } from "./expert-squad"
import { ingestPersistedConversationMessage } from "./tree-writer"
import { conversationSourceDirectory } from "./conversation"
import { taskOwningDirectory } from "./task-directory"
import { directoryScopedPath, taskScopedPath } from "./task-path"
import { activeProjectDirectory } from "./project-directory"

// ── Types ──

export interface ChatAbortTarget {
  kind: "run" | "session" | "task"
  runID?: string
  sessionID?: string
  taskID?: string
  directory?: string
}

export interface ConversationTarget {
  kind: "task" | "empty"
  taskID?: string
}

// ── Constants ──

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024 // 10 MB

// ── Helpers ──

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function currentTaskSessionID(): string {
  return (
    boardStore.board?.task?.sessionID ||
    boardStore.tasks.find((item: any) => item?.task?.id === activeTaskID())?.task?.sessionID ||
    ""
  )
}

function taskPath(taskID: string, suffix = ""): string {
  return taskScopedPath(taskID, taskOwningDirectory(taskID), suffix)
}

export function classifyPanelMessageTarget(input: {
  selectedTaskID?: string
  boardTaskID?: string
  tasks?: any[]
}): "create" | "task" | "reload" | "orphan" {
  const selectedTaskID = String(input.selectedTaskID || "").trim()
  if (!selectedTaskID) return "create"
  if (selectedTaskID === String(input.boardTaskID || "").trim()) return "task"
  const tasks = Array.isArray(input.tasks) ? input.tasks : []
  return tasks.some((item: any) => item?.task?.id === selectedTaskID) ? "reload" : "orphan"
}

async function resolvePanelMessageTaskID(): Promise<string> {
  const selectedTaskID = String(activeTaskID() || "").trim()
  if (!selectedTaskID) return ""

  let target = classifyPanelMessageTarget({
    selectedTaskID,
    boardTaskID: boardStore.board?.task?.id,
    tasks: boardStore.tasks,
  })

  if (target === "orphan") {
    await loadTasks()
    target = classifyPanelMessageTarget({
      selectedTaskID,
      boardTaskID: boardStore.board?.task?.id,
      tasks: boardStore.tasks,
    })
  }

  if (target === "task") return selectedTaskID

  if (target === "reload") {
    await selectTask(selectedTaskID)
    return String(activeTaskID() || "").trim()
  }

  await selectTask("")
  return ""
}

// ── Public: conversationTarget ──

/**
 * Returns the current conversation target (task or empty).
 */
export function conversationTarget(): ConversationTarget {
  if (activeTaskID()) {
    return {
      kind: "task",
      taskID: activeTaskID(),
    }
  }
  return { kind: "empty" }
}

// ── Public: conversationTargetKey ──

/**
 * Stable string key for the current conversation target.
 */
export function conversationTargetKey(target: ConversationTarget = conversationTarget()): string {
  if (target.taskID) return `task:${target.taskID}`
  return "empty"
}

// ── Public: panelResultNavigates ──

/**
 * Returns true if the panel result should trigger task navigation.
 */
export function panelResultNavigates(result: any): boolean {
  if (!result || typeof result !== "object") return false
  const action = result.local_action?.type
  if (action === "select_task") return true
  if (result.task_id) return true
  return false
}

// ── Public: canComposeChat ──

/**
 * Returns true when the chat composer should be enabled.
 */
export function canComposeChat(): boolean {
  if (!appStore.connected) return false
  if (activeSessionID()) return true
  // Derive workspace mode from store state.
  // "task" mode: a task is selected.
  // "empty" mode: no task selected, no session-only workspace.
  // Both allow composing. All other modes (e.g. a pure session workspace
  // with no associated task) are not represented in the Solid stores yet,
  // so we fall back to checking the helper if available.
  const mode = workspaceMode()
  return mode === "empty" || mode === "task"
}

// ── Public: chatAbortTargets ──

/**
 * Returns ordered list of abort targets for the active chat request.
 * @param seed Optional initial target to prepend (from the request object).
 */
export function chatAbortTargets(seed?: ChatAbortTarget): ChatAbortTarget[] {
  const items: ChatAbortTarget[] = []
  const seen = new Set<string>()

  const push = (target: ChatAbortTarget | undefined | null): void => {
    if (!target) return
    const key =
      target.kind === "run"
        ? `run:${target.runID}`
        : target.kind === "session"
          ? `session:${target.sessionID}`
          : target.kind === "task"
            ? `task:${target.taskID}`
            : ""
    if (!key || seen.has(key)) return
    seen.add(key)
    items.push(target)
  }

  push(seed)
  const taskID = activeTaskID()
  if (!taskID) return items
  const directory = taskOwningDirectory(taskID)

  const runID = boardStore.board?.task?.activeRunID || ""
  if (runID) {
    push({ kind: "run", runID, directory })
  }
  const sessionID = currentTaskSessionID()
  if (sessionID) {
    push({ kind: "session", sessionID, directory })
  }
  push({ kind: "task", taskID, directory })

  return items
}

// ── Public: chatAbortTarget ──

/**
 * Returns the first (highest-priority) abort target, or null if none.
 */
export function chatAbortTarget(seed?: ChatAbortTarget): ChatAbortTarget | null {
  return chatAbortTargets(seed)[0] || null
}

// ── Internal: abortChatTarget ──

/**
 * Send a remote abort/cancel request for a single target.
 */
async function abortChatTargetRemote(target: ChatAbortTarget): Promise<boolean> {
  if (!target) return false
  if (target.kind === "run" && target.runID) {
    await apiJson(
      directoryScopedPath(`run/${encodeURIComponent(target.runID)}/abort`, target.directory || "", "abort run"),
      {
        method: "POST",
      },
    )
    return true
  }
  if (target.kind === "task" && target.taskID) {
    await apiJson(taskScopedPath(target.taskID, target.directory || taskOwningDirectory(target.taskID), "/cancel"), {
      method: "POST",
    })
    return true
  }
  if (target.kind === "session" && target.sessionID) {
    await apiJson(
      directoryScopedPath(
        `session/${encodeURIComponent(target.sessionID)}/abort`,
        target.directory || "",
        "abort session",
      ),
      {
        method: "POST",
      },
    )
    return true
  }
  return false
}

// ── Public: stopChatRequest ──

export interface StopChatRequestOptions {
  /** If false, skip sending remote abort.  Defaults to true. */
  remote?: boolean
  /** If false, this is not a manual user abort.  Defaults to true. */
  manual?: boolean
}

/**
 * Abort the active chat request and optionally cancel the remote run/task.
 * Returns true if the abort was dispatched, false if no active request.
 */
export async function stopChatRequest(options: StopChatRequestOptions = {}): Promise<boolean> {
  const request = messageStore.chatRequest as any
  if (!request || request.stopping) return false

  // Mark as stopping to prevent re-entrant calls
  request.aborted = true
  request.manualAbort = options.manual !== false
  request.stopping = true
  request.recovery?.stop()

  // Abort the local fetch
  request.controller?.abort?.()

  // Clear the store reference
  abortChatRequest()

  if (options.remote === false) return true

  const targets = chatAbortTargets(request.target)
  if (targets.length === 0) return true

  try {
    for (const target of targets) {
      try {
        await abortChatTargetRemote(target)
        return true
      } catch (e) {
        console.warn("[stopChatRequest] Failed to abort target", {
          error: String(e),
          target,
        })
      }
    }
    return false
  } finally {
    request.stopping = false
  }
}

// ── Public: addChatAttachment ──

/**
 * Add a file attachment to the staged chat attachments list.
 * Returns an error string if validation fails, or null on success.
 */
export async function addChatAttachment(file: File): Promise<string | null> {
  if (!file) return "No file provided"
  if (file.size > MAX_ATTACHMENT_SIZE) {
    return "file_too_large"
  }
  const url = await fileToDataUrl(file)
  const next = [
    ...messageStore.chatAttachments,
    {
      mime: file.type || "application/octet-stream",
      url,
      filename: file.name,
    },
  ]
  setChatAttachments(next)
  return null
}

// ── Public: removeChatAttachment ──

/**
 * Remove a staged attachment by index.
 */
export function removeChatAttachment(index: number): void {
  const next = messageStore.chatAttachments.filter((_: any, i: number) => i !== index)
  setChatAttachments(next)
}

// ── Public: takeChatMetadata ──

/**
 * Consume and return any pending metadata set via window.__ocNextChatMetadata.
 */
export function takeChatMetadata(): Record<string, unknown> | undefined {
  const win = window as any
  const meta =
    win.__ocNextChatMetadata && typeof win.__ocNextChatMetadata === "object" && !Array.isArray(win.__ocNextChatMetadata)
      ? (win.__ocNextChatMetadata as Record<string, unknown>)
      : undefined
  delete win.__ocNextChatMetadata
  return meta
}

// ── Panel message helpers ──

export function mergeMessages(left: any[], right: any[]): any[] {
  return mergeLoadedConversationMessages(left, right)
}

function ensureTaskListEntry(taskID: string, requestID: string, requestText: string, resultMessage: string): void {
  if (!taskID) return
  const task = boardStore.board?.task && boardStore.board.task.id === taskID ? boardStore.board.task : null
  const now = Date.now()
  const created = Number(task?.time?.created || now)
  const updated = Number(task?.time?.updated || created)
  const title = String(
    task?.title || boardStore.board?.overview?.headline || requestText || resultMessage || taskID,
  ).trim()
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
  }
  const rest = boardStore.tasks.filter((item: any) => item?.task?.id !== taskID)
  setTasksData([entry, ...rest])
}

function sessionPromptParts(text: string, attachments: any[], metadata: any): any[] {
  const parts: any[] = [
    {
      type: "text",
      text,
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    },
  ]
  for (const attachment of attachments) {
    if (!attachment?.url || !attachment?.mime) continue
    parts.push({
      type: "file",
      mime: String(attachment.mime),
      url: String(attachment.url),
      ...(attachment.filename ? { filename: String(attachment.filename) } : {}),
    })
  }
  return parts
}

async function applyPanelResult(result: any): Promise<void> {
  const taskID = String(result?.task_id || result?.taskID || "")
  const requestText = typeof result?._request === "string" ? result._request : ""
  const requestID = String(result?._requestID || "")
  if (taskID) {
    ensureTaskListEntry(taskID, requestID, requestText, String(result?.message || ""))
    await selectTask(taskID)
    ensureTaskListEntry(taskID, requestID, requestText, String(result?.message || ""))
    return
  }
}

export async function panelMessage(
  text: string,
  attachmentsOrMeta: any[] | Record<string, any> = [],
  metadata: any = {},
): Promise<any> {
  const attachments = Array.isArray(attachmentsOrMeta) ? attachmentsOrMeta : []
  const meta = Array.isArray(attachmentsOrMeta) ? metadata : attachmentsOrMeta
  const promptProfile = typeof meta?.promptProfile === "string" ? meta.promptProfile : undefined
  const requestMetadata = { ...(meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {}) }
  delete requestMetadata.promptProfile
  const requestID = crypto.randomUUID()
  const controller = new AbortController()
  const request: any = {
    requestID,
    controller,
    stopping: false,
    aborted: false,
    manualAbort: false,
  }
  try {
    const sessionID = activeSessionID()
    if (sessionID) {
      const directory = conversationSourceDirectory({ kind: "session", id: sessionID })
      setConnectionStatus("online")
      request.target = { kind: "session", sessionID, directory }
      setChatRequest(request as any)
      if (promptProfile) {
        await setSessionExpertSquadActive(sessionID, promptProfile, directory)
      }
      const result = await apiJson(
        directoryScopedPath(`session/${encodeURIComponent(sessionID)}/prompt_async`, directory, "session prompt"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parts: sessionPromptParts(text, attachments, requestMetadata),
          }),
          signal: controller.signal,
        },
      )
      ingestPersistedConversationMessage(result.user_message)
      return result
    }
    const taskID = await resolvePanelMessageTaskID()
    setConnectionStatus("online")
    setChatRequest(request as any)
    // If no task is selected, create a new task via direct API (no LLM round-trip)
    if (!taskID) {
      const creationDirectory = activeProjectDirectory()
      if (!creationDirectory) throw new Error("panelMessage: task creation requires a project directory")
      const createdTaskID = await createTask({
        text,
        attachments,
        metadata: requestMetadata,
        model: currentOpenCorvusModel(),
        promptProfile,
        signal: controller.signal,
      })
      if (createdTaskID) {
        await selectTask(createdTaskID, { directory: creationDirectory })
        return { task_id: createdTaskID }
      }
      throw new Error("Task creation returned no task_id")
    }
    // Every status (active, queued, blocked, cancelled, completed, failed) →
    // send message directly to the task. Status is display/audit context, not
    // a routing gate; users sending a follow-up to any task expect the same
    // conversation to continue, not a brand-new task.
    const directory = taskOwningDirectory(taskID)
    request.target = { kind: "task", taskID, directory }
    const result = await apiJson(taskPath(taskID, "/message"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        source: "panel",
        ...(promptProfile ? { promptProfile } : {}),
        ...(attachments.length > 0
          ? {
              attachments: attachments.map((att) => ({
                mime: att.mime,
                data: att.url.includes(",") ? att.url.split(",")[1] : att.url,
                ...(att.filename ? { filename: att.filename } : {}),
              })),
            }
          : {}),
      }),
      signal: controller.signal,
    })
    // Server returned the persisted user Message + parts. Project them
    // through tree-writer immediately so the user sees their bubble before
    // the SSE round-trip lands; messageStore live ingestion is retired.
    ingestPersistedConversationMessage(result.user_message)
    await loadBoard()
    // The server may return a control-plane acknowledgement here
    // (e.g. operator note recorded). The real conversation already comes
    // from board/transcript rehydration, so mirroring the ack locally only
    // creates a fake assistant turn with mismatched chrome.
    return result
  } catch (error) {
    if (request.manualAbort) throw error
    throw error
  } finally {
    if ((messageStore.chatRequest as any)?.requestID === request.requestID) {
      setChatRequest(null as any)
    }
  }
}

// ── Re-export store accessors used by consumers ──

export { setChatRequest, abortChatRequest, setChatAttachments }
