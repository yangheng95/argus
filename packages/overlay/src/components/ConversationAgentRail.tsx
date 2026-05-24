import { Index, Show, createMemo, type Accessor } from "solid-js"
import { cardTreeStore } from "../store/card-tree"
import { conversationAgentStore } from "../store/conversation-agents"
import { setCardExpanded } from "../store/conversation-ui"
import { notifyWarning } from "../services/notify"
import { buildAgentWorkflow, type AgentWorkflowRecord } from "../utils/agent-workflow"
import { buildAgentWorkflowLanes } from "../utils/agent-workflow-lanes"
import { orderedReachableCardIDs } from "../utils/card-tree"
import { stageAccent } from "../utils/card-color"
import { Avatar, avatarRole } from "./Avatar"

function compactLabel(record: AgentWorkflowRecord): string {
  const parts = [record.agentName, record.status]
  if (record.attempt) parts.push(`V${record.attempt}`)
  return parts.filter(Boolean).join(" · ")
}

function mergeAgentRecords(
  baseRecords: AgentWorkflowRecord[],
  liveRecords: AgentWorkflowRecord[],
): AgentWorkflowRecord[] {
  const merged = new Map<string, AgentWorkflowRecord>()
  for (const record of baseRecords) {
    merged.set(record.sessionID, { ...record })
  }
  for (const record of liveRecords) {
    const base = merged.get(record.sessionID)
    merged.set(record.sessionID, base ? { ...base, ...record } : { ...record })
  }
  return [...merged.values()].sort((left, right) => left.startedAt - right.startedAt)
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

function describeRecord(record: AgentWorkflowRecord): string {
  const lines = [
    `agent: ${record.agentName}`,
    `sessionID: ${record.sessionID}`,
    `status: ${record.status}`,
  ]
  if (record.attempt) lines.push(`attempt: V${record.attempt}`)
  if (record.renderedCardID) lines.push(`renderedCardID: ${record.renderedCardID}`)
  return lines.join("\n")
}

function locateRecord(record: AgentWorkflowRecord): void {
  if (!record.renderedCardID) {
    notifyWarning({
      title: "Agent card unavailable",
      message: `${record.agentName} has no rendered conversation card target.`,
      details: describeRecord(record),
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
          details: `${describeRecord(record)}\n\nselector: ${selector}`,
        })
        return
      }
      const head = renderedCardHead(target)
      if (!head) {
        notifyWarning({
          title: "Agent card unavailable",
          message: `Rendered card ${record.renderedCardID} has no mounted header target.`,
          details: `${describeRecord(record)}\n\nmatched element outerHTML head missing:\n${target.outerHTML.slice(0, 400)}`,
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
    </div>
  )
}

export function ConversationAgentRail() {
  const projection = createMemo(() => {
    const liveProjection = buildAgentWorkflow({
      cards: cardTreeStore.cards,
      order: orderedReachableCardIDs(),
      traceEvents: [],
    })
    return {
      ...liveProjection,
      records: mergeAgentRecords(conversationAgentStore.records, liveProjection.records),
    }
  })
  const lanes = createMemo(() => buildAgentWorkflowLanes(projection().records))
  const hasLanes = createMemo(() => lanes().length > 0)

  return (
    <Show when={hasLanes()}>
    <aside
      class="conversation-agent-rail"
      aria-label="Agent workflow"
    >
      <div class="conversation-agent-rail__lanes" role="list">
        <Index each={lanes()}>
          {(lane) => (
            <div class="conversation-agent-rail__lane" data-kind={lane().kind} role="listitem">
              <Index each={lane().records}>
                {(record) => (
                  <AgentRailRow
                    record={record}
                    onLocate={locateRecord}
                  />
                )}
              </Index>
            </div>
          )}
        </Index>
      </div>
    </aside>
    </Show>
  )
}
