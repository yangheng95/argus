import { For, Show, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { boardStore } from "../store/board"
import { cardTreeStore } from "../store/card-tree"
import { setCardExpanded } from "../store/conversation-ui"
import { fetchTaskTrace, invalidateTraceCache } from "../services/trace"
import { notifyWarning } from "../services/notify"
import { buildAgentWorkflow, type AgentWorkflowRecord } from "../utils/agent-workflow"
import { buildAgentWorkflowLanes, type AgentWorkflowLane } from "../utils/agent-workflow-lanes"
import { orderedReachableCardIDs } from "../utils/card-tree"
import { stageAccent } from "../utils/card-color"
import { Avatar, avatarRole } from "./Avatar"
import { Icon } from "./Icon"
import { AgentReportDialog } from "./AgentReportDialog"

const NARROW_HEIGHT = 42
const WIDE_THRESHOLD = 88
const MAX_HEIGHT = 220
const MIN_HEIGHT = 42

function compactLabel(record: AgentWorkflowRecord): string {
  const parts = [record.agentName, record.status]
  if (record.attempt) parts.push(`V${record.attempt}`)
  return parts.filter(Boolean).join(" · ")
}

function summaryText(record: AgentWorkflowRecord): string {
  return (
    (record.displaySummary?.text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)[0] || "No summary"
  )
}

function durationLabel(record: AgentWorkflowRecord): string {
  const end = record.completedAt || record.lastObservedAt
  if (!record.startedAt || !end || end <= record.startedAt) return ""
  const seconds = Math.max(1, Math.round((end - record.startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function parentIDsForCard(cardID: string): string[] {
  const parents: string[] = []
  let current = cardID
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    const parent = Object.values(cardTreeStore.cards).find((card) => card.childIDs?.includes(current))
    if (!parent) break
    parents.unshift(parent.id)
    current = parent.id
  }
  return parents
}

function highlightCard(target: HTMLElement): void {
  target.classList.add("conversation-agent-target--pulse")
  window.setTimeout(() => target.classList.remove("conversation-agent-target--pulse"), 1400)
}

function locateRecord(record: AgentWorkflowRecord): void {
  if (!record.renderedCardID) {
    notifyWarning({
      title: "Agent card unavailable",
      message: `${record.agentName} has no rendered conversation card target.`,
    })
    return
  }
  for (const parentID of parentIDsForCard(record.renderedCardID)) {
    const parent = cardTreeStore.cards[parentID]
    setCardExpanded(parentID, true, parent?.status)
  }
  window.requestAnimationFrame(() => {
    const selector = `[data-card-id="${CSS.escape(record.renderedCardID!)}"]`
    const target = document.querySelector<HTMLElement>(selector)
    if (!target) {
      notifyWarning({
        title: "Agent card unavailable",
        message: `Rendered card ${record.renderedCardID} is not mounted in the conversation.`,
      })
      return
    }
    target.scrollIntoView({ block: "center", behavior: "smooth" })
    highlightCard(target)
  })
}

function LaneAvatarStack(props: { lane: AgentWorkflowLane; onLocate: (record: AgentWorkflowRecord) => void }) {
  const visible = () => props.lane.records.slice(0, 3)
  const primary = () => props.lane.records[0]
  return (
    <button
      type="button"
      class="conversation-agent-rail__stack"
      data-kind={props.lane.kind}
      title={props.lane.records.map(compactLabel).join("\n")}
      onClick={() => primary() && props.onLocate(primary()!)}
    >
      <For each={visible()}>
        {(record) => (
          <span class="conversation-agent-rail__stack-avatar">
            <Avatar role={record.agentName} status={record.status} />
          </span>
        )}
      </For>
      <Show when={props.lane.records.length > 1}>
        <span class="conversation-agent-rail__stack-count">{props.lane.records.length}</span>
      </Show>
    </button>
  )
}

function AgentRailRow(props: {
  record: AgentWorkflowRecord
  wide: boolean
  onLocate: (record: AgentWorkflowRecord) => void
  onReport: (record: AgentWorkflowRecord) => void
}) {
  return (
    <div
      class="conversation-agent-rail__row"
      data-status={props.record.status}
      style={{ "--card-stage": stageAccent(avatarRole(props.record.agentName)) }}
    >
      <button
        type="button"
        class="conversation-agent-rail__avatar-button"
        title={compactLabel(props.record)}
        onClick={() => props.onLocate(props.record)}
      >
        <Avatar role={props.record.agentName} status={props.record.status} />
      </button>
      <Show when={props.wide}>
        <button type="button" class="conversation-agent-rail__run" onClick={() => props.onLocate(props.record)}>
          <span class="conversation-agent-rail__run-head">
            <strong>{props.record.agentName}</strong>
            <span>{props.record.status}</span>
            <Show when={durationLabel(props.record)}>
              <span>{durationLabel(props.record)}</span>
            </Show>
          </span>
          <span class="conversation-agent-rail__summary">{summaryText(props.record)}</span>
        </button>
        <button
          type="button"
          class="conversation-agent-rail__report"
          onClick={() => props.onReport(props.record)}
          title="Open report"
          aria-label="Open report"
        >
          <Icon name="file-document" size={14} />
        </button>
      </Show>
    </div>
  )
}

export function ConversationAgentRail() {
  const taskID = createMemo(() => boardStore.selectedTaskID || boardStore.board?.task?.id || "")
  const [refreshTick, setRefreshTick] = createSignal(0)
  const [height, setHeight] = createSignal(NARROW_HEIGHT)
  const [selectedReport, setSelectedReport] = createSignal<AgentWorkflowRecord | null>(null)
  const wide = createMemo(() => height() >= WIDE_THRESHOLD)

  const [trace] = createResource(
    () => ({ taskID: taskID(), tick: refreshTick() }),
    async ({ taskID }) => {
      if (!taskID) return { ok: true as const, events: [], traceDir: "", enabled: true }
      return fetchTaskTrace(taskID, { force: refreshTick() > 0 })
    },
  )

  const projection = createMemo(() =>
    buildAgentWorkflow({
      cards: cardTreeStore.cards,
      order: orderedReachableCardIDs(),
      traceEvents: trace()?.events || [],
    }),
  )
  const lanes = createMemo(() => buildAgentWorkflowLanes(projection().records))
  const traceError = createMemo(() => {
    const result = trace()
    return result?.ok === false ? result.error : ""
  })

  let timer: ReturnType<typeof setInterval> | undefined
  timer = setInterval(() => {
    const id = taskID()
    if (!id || (typeof document !== "undefined" && document.hidden)) return
    invalidateTraceCache({ taskID: id })
    setRefreshTick((tick) => tick + 1)
  }, 4_000)
  onCleanup(() => {
    if (timer) clearInterval(timer)
  })

  const beginResize = (event: PointerEvent) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = height()
    const onMove = (move: PointerEvent) => {
      const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + startY - move.clientY))
      setHeight(next)
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  return (
    <aside
      class="conversation-agent-rail"
      data-wide={wide() ? "true" : "false"}
      style={{ "--conversation-agent-rail-height": String(height()) }}
      aria-label="Agent workflow"
    >
      <Show when={traceError()}>
        <div class="conversation-agent-rail__error" title={traceError()}>
          !
        </div>
      </Show>
      <Show when={lanes().length > 0} fallback={<div class="conversation-agent-rail__empty" aria-hidden="true" />}>
        <div class="conversation-agent-rail__lanes" role="list">
          <For each={lanes()}>
            {(lane) => (
              <div class="conversation-agent-rail__lane" data-kind={lane.kind} role="listitem">
                <Show when={wide()} fallback={<LaneAvatarStack lane={lane} onLocate={locateRecord} />}>
                  <For each={lane.records}>
                    {(record) => (
                      <AgentRailRow
                        record={record}
                        wide={wide()}
                        onLocate={locateRecord}
                        onReport={setSelectedReport}
                      />
                    )}
                  </For>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <button
        type="button"
        class="conversation-agent-rail__resize"
        onPointerDown={beginResize}
        aria-label="Resize agent workflow rail"
        title="Resize agent workflow rail"
      >
        <Icon name="drag-handle" size={14} />
      </button>
      <Show when={selectedReport()}>
        {(record) => <AgentReportDialog record={record()} onClose={() => setSelectedReport(null)} />}
      </Show>
    </aside>
  )
}
