// ── TaskStatusHeader ──
// Replaces the previous imperative createEffects in main.tsx that toggled
// `#taskStatus[hidden]`, wrote `#statusIcon.innerHTML`, set `#statusLabel`'s
// textContent, and ticked `#taskElapsed` every second via getElementById.
// The whole block is now driven by Solid signals: a single reactive subtree
// that updates only the affected text/attribute when boardStore changes.

import { createMemo, Show } from "solid-js"
import { boardStore, activeTaskID } from "../store/board"
import { statusIconName } from "../utils/status-mapping"
import { taskLifecycleStatusOrIdleLabel } from "../utils/status-labels"
import { Icon } from "./Icon"
import { formatDuration } from "../utils/time"
import { useNowTick } from "../services/clock"

const LIVE_STATUSES = new Set(["active", "queued"])

export function TaskStatusHeader() {
  const task = createMemo(() => (boardStore.board as any)?.task)
  const status = createMemo<string>(() => task()?.status || "")
  const iconStatus = createMemo<string>(() => status() || "idle")
  const startTime = createMemo<number>(() => task()?.time?.created || 0)
  const completedTime = createMemo<number>(() => task()?.time?.completed || 0)
  const isLive = createMemo(() => LIVE_STATUSES.has(status()))
  const visible = createMemo(() => Boolean(activeTaskID()))

  // Shared 1Hz tick from services/clock.ts. The clock module owns the
  // visibility-gated setInterval and reference-counts subscribers so
  // every running CardHeader chip and this header share one timer.
  const now = useNowTick()

  const elapsedText = createMemo(() => {
    const start = startTime()
    if (!visible() || !start) return ""
    if (!isLive()) return formatDuration((completedTime() || Date.now()) - start)
    return formatDuration(now() - start)
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
