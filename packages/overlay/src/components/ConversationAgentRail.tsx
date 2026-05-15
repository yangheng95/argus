import { Index, Show, createEffect, createMemo, createResource, createSignal, onCleanup, type Accessor } from "solid-js"
import { boardStore } from "../store/board"
import { cardTreeStore } from "../store/card-tree"
import { setCardExpanded } from "../store/conversation-ui"
import { fetchTaskTrace, invalidateTraceCache } from "../services/trace"
import { notifyWarning } from "../services/notify"
import { buildAgentWorkflow, type AgentWorkflowRecord } from "../utils/agent-workflow"
import { buildAgentWorkflowLanes } from "../utils/agent-workflow-lanes"
import { orderedReachableCardIDs, cardMessageSegments } from "../utils/card-tree"
import { orderedMessageParts } from "../utils/message"
import { stageAccent } from "../utils/card-color"
import { Avatar, avatarRole } from "./Avatar"
import { Icon } from "./Icon"
import { CardParts } from "./CardParts"
import { AgentReportDialog } from "./AgentReportDialog"

const NARROW_HEIGHT = 42
const WIDE_THRESHOLD = 88
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
      .filter(Boolean)[0] ||
    (record.goalDescription || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)[0] ||
    record.stepID ||
    record.stage ||
    record.agentName
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

function renderedCardHead(target: HTMLElement): HTMLElement | null {
  return target.querySelector<HTMLElement>(
    ":scope > .chat-bubble-shell > .chat-bubble > .chat-bubble__head, :scope > .card__head",
  )
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
      const head = renderedCardHead(target)
      if (!head) {
        notifyWarning({
          title: "Agent card unavailable",
          message: `Rendered card ${record.renderedCardID} has no mounted header target.`,
        })
        return
      }
      head.scrollIntoView({ block: "start", inline: "nearest", behavior: "smooth" })
      highlightCard(target)
    })
  })
}

function AgentRailRow(props: {
  record: Accessor<AgentWorkflowRecord>
  wide: boolean
  onLocate: (record: AgentWorkflowRecord) => void
  onReport: (record: AgentWorkflowRecord) => void
}) {
  const record = props.record
  let streamRef: HTMLDivElement | undefined

  // Latest agent message, reusing the conversation message-panel renderer
  // (CardParts) instead of a single clipped summary line. Source is the
  // same card-tree store the left conversation reads — we split the card's
  // flat parts at boundary markers (shared cardMessageSegments) and keep
  // only the final turn, which is the agent's most recent output.
  const latestParts = createMemo<any[]>(() => {
    const cardID = record().cardID
    if (!cardID) return []
    const card = cardTreeStore.cards[cardID]
    if (!card) return []
    const segments = cardMessageSegments(card)
    if (segments.length === 0) return []
    return orderedMessageParts(segments[segments.length - 1])
  })

  // Keep the newest content in view as it streams — "latest scrolling
  // message". Tracks the part count + status so a running agent's pane
  // pins to the bottom; once terminal it stops fighting manual scroll.
  createEffect(() => {
    const count = latestParts().length
    const running = record().status === "running"
    const el = streamRef
    if (!el || count === 0 || !running) return
    el.scrollTop = el.scrollHeight
  })

  return (
    <div
      class="conversation-agent-rail__row"
      data-status={record().status}
      style={{ "--card-stage": stageAccent(avatarRole(record().agentName)) }}
    >
      <button
        type="button"
        class="conversation-agent-rail__avatar-button"
        title={compactLabel(record())}
        onClick={() => props.onLocate(record())}
      >
        <Avatar role={record().agentName} status={record().status} />
      </button>
      <div
        class="conversation-agent-rail__run"
        aria-hidden={props.wide ? "false" : "true"}
      >
        <button
          type="button"
          class="conversation-agent-rail__run-head"
          tabIndex={props.wide ? 0 : -1}
          onClick={() => props.onLocate(record())}
          title={compactLabel(record())}
        >
          <strong>{record().agentName}</strong>
          <span>{record().status}</span>
          <Show when={durationLabel(record())}>
            <span>{durationLabel(record())}</span>
          </Show>
        </button>
        <Show
          when={props.wide && latestParts().length > 0}
          fallback={
            <button
              type="button"
              class="conversation-agent-rail__summary"
              tabIndex={props.wide ? 0 : -1}
              onClick={() => props.onLocate(record())}
            >
              {summaryText(record())}
            </button>
          }
        >
          <div
            ref={streamRef}
            class="conversation-agent-rail__stream"
            data-streaming={record().status === "running" ? "true" : "false"}
          >
            <CardParts
              parts={latestParts()}
              depth={1}
              streaming={record().status === "running"}
            />
          </div>
        </Show>
      </div>
      <button
        type="button"
        class="conversation-agent-rail__report"
        aria-hidden={props.wide ? "false" : "true"}
        tabIndex={props.wide ? 0 : -1}
        onClick={() => props.onReport(record())}
        title="Open report"
        aria-label="Open report"
      >
        <Icon name="file-document" size={14} />
      </button>
    </div>
  )
}

export function ConversationAgentRail() {
  const taskID = createMemo(() => boardStore.selectedTaskID || boardStore.board?.task?.id || "")
  const [refreshTick, setRefreshTick] = createSignal(0)
  const [height, setHeight] = createSignal(NARROW_HEIGHT)
  const [selectedReport, setSelectedReport] = createSignal<AgentWorkflowRecord | null>(null)
  const wide = createMemo(() => height() >= WIDE_THRESHOLD)
  const shouldFetchTrace = createMemo(() => wide())

  const [trace] = createResource(
    () => ({ taskID: taskID(), tick: refreshTick(), shouldFetchTrace: shouldFetchTrace() }),
    async ({ taskID, shouldFetchTrace }) => {
      if (!taskID || !shouldFetchTrace) return { ok: true as const, events: [], traceDir: "", enabled: true }
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
  const hasLanes = createMemo(() => lanes().length > 0)
  const traceError = createMemo(() => {
    const result = trace()
    return result?.ok === false ? result.error : ""
  })

  let timer: ReturnType<typeof setInterval> | undefined
  timer = setInterval(() => {
    const id = taskID()
    if (!id || !shouldFetchTrace() || trace.loading || (typeof document !== "undefined" && document.hidden)) return
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
      const next = Math.max(MIN_HEIGHT, startHeight + startY - move.clientY)
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
    <Show when={hasLanes()}>
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
      <div class="conversation-agent-rail__lanes" role="list">
        <Index each={lanes()}>
          {(lane) => (
            <div class="conversation-agent-rail__lane" data-kind={lane().kind} role="listitem">
              <Index each={lane().records}>
                {(record) => (
                  <AgentRailRow
                    record={record}
                    wide={wide()}
                    onLocate={locateRecord}
                    onReport={setSelectedReport}
                  />
                )}
              </Index>
            </div>
          )}
        </Index>
      </div>
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
    </Show>
  )
}
