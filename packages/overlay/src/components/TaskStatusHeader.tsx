// ── TaskStatusHeader ──
// Replaces the previous imperative createEffects in main.tsx that toggled
// `#taskStatus[hidden]`, wrote `#statusIcon.innerHTML`, set `#statusLabel`'s
// textContent, and ticked `#taskElapsed` every second via getElementById.
// The whole block is now driven by Solid signals: a single reactive subtree
// that updates only the affected text/attribute when boardStore changes.

import { createEffect, createMemo, Show } from "solid-js"
import { boardStore, activeTaskID } from "../store/board"
import { statusIconName } from "../utils/status-mapping"
import { taskLifecycleStatusOrIdleLabel } from "../utils/status-labels"
import { Icon } from "./Icon"
import { formatDuration } from "../utils/time"
import { AppLog } from "../utils/log"
import { selectedTaskSseActiveElapsedMs, taskRuntimeActivityKey } from "../services/task-runtime-activity"

const ACTIVE_STATUS = "active"
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"])
const loggedRuntimeTimeErrors = new Set<string>()

export function TaskStatusHeader() {
  const task = createMemo(() => (boardStore.board as any)?.task)
  const status = createMemo<string>(() => task()?.status || "")
  const iconStatus = createMemo<string>(() => status() || "idle")
  const startedTime = createMemo<number>(() => task()?.time?.started || 0)
  const completedTime = createMemo<number>(() => task()?.time?.completed || 0)
  const isActive = createMemo(() => status() === ACTIVE_STATUS)
  const visible = createMemo(() => Boolean(activeTaskID()))
  const elapsedKey = createMemo(() => {
    const taskID = String(task()?.id || activeTaskID() || "")
    if (!taskID || !startedTime()) return ""
    return taskRuntimeActivityKey({ taskID, startedAt: startedTime() })
  })
  const missingStartedTime = createMemo(() => {
    const taskID = String(task()?.id || activeTaskID() || "")
    return Boolean(visible() && taskID && (isActive() || TERMINAL_STATUSES.has(status())) && !(startedTime() > 0))
  })
  const missingCompletionTime = createMemo(() => {
    const taskID = String(task()?.id || activeTaskID() || "")
    return Boolean(visible() && taskID && startedTime() > 0 && TERMINAL_STATUSES.has(status()) && !(completedTime() > 0))
  })
  const invalidCompletionTime = createMemo(() => {
    const taskID = String(task()?.id || activeTaskID() || "")
    return Boolean(
        visible() &&
        taskID &&
        startedTime() > 0 &&
        TERMINAL_STATUSES.has(status()) &&
        completedTime() > 0 &&
        completedTime() <= startedTime(),
    )
  })
  const runtimeTimeError = createMemo(() => {
    if (missingStartedTime()) return "missing start time"
    if (missingCompletionTime()) return "missing completion time"
    if (invalidCompletionTime()) return "invalid completion time"
    return ""
  })

  const elapsedText = createMemo(() => {
    const start = startedTime()
    if (!visible()) return ""
    const timeError = runtimeTimeError()
    if (timeError) return timeError
    if (isActive()) return formatDuration(selectedTaskSseActiveElapsedMs(elapsedKey()))
    if (TERMINAL_STATUSES.has(status())) return formatDuration(completedTime() - start)
    return ""
  })

  createEffect(() => {
    const timeError = runtimeTimeError()
    if (!timeError) return
    const taskID = String(task()?.id || activeTaskID() || "")
    const key = `${taskID}:${status()}:${startedTime()}:${completedTime()}:${timeError}`
    if (loggedRuntimeTimeErrors.has(key)) return
    loggedRuntimeTimeErrors.add(key)
    AppLog.error("ui", `Task status ${timeError}`, {
      taskID,
      status: status(),
      startedAt: startedTime() || undefined,
      completedAt: completedTime() || undefined,
      notificationID: `task-status:${timeError.replace(/\s+/g, "-")}:${taskID}`,
      notificationTitle: "Task status timestamp invalid",
      notificationMessage: `Task ${taskID} has an invalid runtime timestamp.`,
      notificationDetails:
        timeError === "missing start time"
          ? `task.time.started is required for task status ${status()}.`
          : timeError === "missing completion time"
          ? `task.time.completed is required for terminal task status ${status()}.`
          : `task.time.completed must be greater than task.time.started for terminal task status ${status()}.`,
    })
  })

  const labelText = createMemo(() => (visible() ? taskLifecycleStatusOrIdleLabel(status()) : ""))

  return (
    <Show when={visible()}>
      <div class="task-status chat-task-status" id="taskStatus">
        <span class="status-icon" id="statusIcon" data-status={iconStatus()} aria-hidden="true">
          <Icon name={statusIconName(iconStatus())} />
        </span>
        <span class="status-copy">
          <span class="status-label" id="statusLabel">
            {labelText()}
          </span>
          <span class="elapsed" id="taskElapsed">
            {elapsedText()}
          </span>
        </span>
      </div>
    </Show>
  )
}
