import { Index, Show, createMemo, type Accessor } from "solid-js"
import { cardTreeStore } from "../store/card-tree"
import { conversationAgentStore } from "../store/conversation-agents"
import { setCardExpanded } from "../store/conversation-ui"
import { loadConversationHistoryUntilCard } from "../services/conversation"
import { requestConversationCardScroll } from "../services/conversation-scroll"
import { notifyWarning } from "../services/notify"
import { buildAgentWorkflow, type AgentWorkflowRecord } from "../utils/agent-workflow"
import { mergeAgentRecords } from "../utils/agent-workflow-records"
import { orderedReachableCardIDs } from "../utils/card-tree"
import { stageAccent } from "../utils/card-color"
import { Avatar, avatarRole } from "./Avatar"

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

async function locateRecord(record: AgentWorkflowRecord): Promise<void> {
  if (!record.renderedCardID) {
    notifyWarning({
      title: "Agent card unavailable",
      message: `${record.agentName} has no rendered conversation card target.`,
      details: describeRecord(record),
    })
    return
  }
  if (!cardTreeStore.cards[record.renderedCardID]) {
    await loadConversationHistoryUntilCard(record.renderedCardID)
  }
  for (const parentID of parentIDsForCard(record.renderedCardID)) {
    const parent = cardTreeStore.cards[parentID]
    setCardExpanded(parentID, true, parent?.status)
  }
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      void requestConversationCardScroll({
        cardID: record.renderedCardID!,
        behavior: "smooth",
        block: "start",
        focus: "header",
        highlight: true,
      }).then((found) => {
        if (found) return
        const selector = `[data-card-id="${CSS.escape(record.renderedCardID!)}"]`
        notifyWarning({
          title: "Agent card unavailable",
          message: `Rendered card ${record.renderedCardID} could not be located in the conversation.`,
          details: `${describeRecord(record)}\n\nselector: ${selector}`,
        })
      })
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
  const records = createMemo(() => projection().records)
  const hasRecords = createMemo(() => records().length > 0)

  return (
    <Show when={hasRecords()}>
    <aside
      class="conversation-agent-rail"
      aria-label="Agent workflow"
    >
      <div class="conversation-agent-rail__lanes" role="list">
        <div class="conversation-agent-rail__lane" data-kind="timeline" role="listitem">
          <Index each={records()}>
            {(record) => (
              <AgentRailRow
                record={record}
                onLocate={locateRecord}
              />
            )}
          </Index>
        </div>
      </div>
    </aside>
    </Show>
  )
}
