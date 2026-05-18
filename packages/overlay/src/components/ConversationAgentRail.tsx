import { Index, Show, createMemo, createResource, createSignal, onCleanup, type Accessor } from "solid-js"
import { boardStore } from "../store/board"
import { cardTreeStore } from "../store/card-tree"
import { setCardExpanded } from "../store/conversation-ui"
import { fetchTaskTrace, invalidateTraceCache } from "../services/trace"
import { notifyWarning } from "../services/notify"
import { buildAgentWorkflow, type AgentWorkflowRecord } from "../utils/agent-workflow"
import { buildAgentWorkflowLanes } from "../utils/agent-workflow-lanes"
import { orderedReachableCardIDs } from "../utils/card-tree"
import { stageAccent } from "../utils/card-color"
import { Avatar, avatarRole } from "./Avatar"
import { Icon } from "./Icon"
import { AgentReportDialog } from "./AgentReportDialog"

function compactLabel(record: AgentWorkflowRecord): string {
  const parts = [record.agentName, record.status]
  if (record.attempt) parts.push(`V${record.attempt}`)
  return parts.filter(Boolean).join(" · ")
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
  onLocate: (record: AgentWorkflowRecord) => void
  onReport: (record: AgentWorkflowRecord) => void
}) {
  const record = props.record

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
      <button
        type="button"
        class="conversation-agent-rail__report"
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
  const [selectedReport, setSelectedReport] = createSignal<AgentWorkflowRecord | null>(null)

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
  const hasLanes = createMemo(() => lanes().length > 0)
  const traceError = createMemo(() => {
    const result = trace()
    return result?.ok === false ? result.error : ""
  })

  let timer: ReturnType<typeof setInterval> | undefined
  timer = setInterval(() => {
    const id = taskID()
    if (!id || trace.loading || (typeof document !== "undefined" && document.hidden)) return
    invalidateTraceCache({ taskID: id })
    setRefreshTick((tick) => tick + 1)
  }, 4_000)
  onCleanup(() => {
    if (timer) clearInterval(timer)
  })

  return (
    <Show when={hasLanes()}>
    <aside
      class="conversation-agent-rail"
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
                    onLocate={locateRecord}
                    onReport={setSelectedReport}
                  />
                )}
              </Index>
            </div>
          )}
        </Index>
      </div>
      <Show when={selectedReport()}>
        {(record) => <AgentReportDialog record={record()} onClose={() => setSelectedReport(null)} />}
      </Show>
    </aside>
    </Show>
  )
}
