import { Index, Show, createMemo, onCleanup, type Accessor } from "solid-js"
import { cardTreeStore } from "../store/card-tree"
import { boardStore } from "../store/board"
import { conversationAgentRecordsForSource } from "../store/conversation-agents"
import { setCardExpanded } from "../store/conversation-ui"
import { conversationCardContainsMessage, loadConversationHistoryUntilCard } from "../services/conversation"
import { requestConversationCardScroll } from "../services/conversation-scroll"
import { notifyWarning } from "../services/notify"
import { buildAgentWorkflow, type AgentWorkflowRecord, type AgentWorkflowStatus } from "../utils/agent-workflow"
import { mergeAgentRecords } from "../utils/agent-workflow-records"
import { orderedReachableCardIDs } from "../utils/card-tree"
import { stageAccent } from "../utils/card-color"
import { Avatar, avatarRole } from "./Avatar"
import { Button } from "./ui/Button"
import { t } from "../utils/i18n"

const AGENT_RAIL_STATUS_LABELS: Record<AgentWorkflowStatus, () => string> = {
  pending: () => t("agent_rail.status.pending"),
  running: () => t("agent_rail.status.running"),
  idle: () => t("agent_rail.status.idle"),
  completed: () => t("agent_rail.status.completed"),
  error: () => t("agent_rail.status.error"),
  skipped: () => t("agent_rail.status.skipped"),
}

function agentRailStatusLabel(status: AgentWorkflowStatus): string {
  return AGENT_RAIL_STATUS_LABELS[status]()
}

function compactLabel(record: AgentWorkflowRecord): string {
  const parts = [record.agentName, agentRailStatusLabel(record.status)]
  if (record.attempt) parts.push(t("agent_rail.attempt", { value: record.attempt }))
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

function describeRecord(record: AgentWorkflowRecord, selector?: string): string {
  const lines = [
    t("agent_rail.detail.agent", { value: record.agentName }),
    t("agent_rail.detail.session_id", { value: record.sessionID }),
    t("agent_rail.detail.status", { value: agentRailStatusLabel(record.status) }),
  ]
  if (record.attempt) lines.push(t("agent_rail.detail.attempt", { value: record.attempt }))
  if (record.renderedCardID) lines.push(t("agent_rail.detail.rendered_card_id", { value: record.renderedCardID }))
  if (selector) lines.push(t("agent_rail.detail.selector", { value: selector }))
  return lines.join("\n")
}

async function locateRecord(record: AgentWorkflowRecord): Promise<void> {
  if (!record.renderedCardID) {
    notifyWarning({
      title: t("agent_rail.card_unavailable_title"),
      message: t("agent_rail.no_rendered_card_target", { agent: record.agentName }),
      details: describeRecord(record),
    })
    return
  }
  const targetMessageID = String(record.targetMessageID || "")
  const needsHistory =
    !cardTreeStore.cards[record.renderedCardID] ||
    (!!targetMessageID && !conversationCardContainsMessage(record.renderedCardID, targetMessageID))
  if (needsHistory) {
    const directory = String(boardStore.board?.task?.directory || "").trim()
    if (!directory) {
      notifyWarning({
        title: t("agent_rail.card_unavailable_title"),
        message: t("agent_rail.no_rendered_card_target", { agent: record.agentName }),
        details: describeRecord(record),
      })
      return
    }
    await loadConversationHistoryUntilCard(record.renderedCardID, undefined, {
      messageID: targetMessageID,
      sessionID: record.sessionID,
      directory,
    })
  }
  const target = cardTreeStore.cards[record.renderedCardID]
  setCardExpanded(record.renderedCardID, true, target?.status)
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
          title: t("agent_rail.card_unavailable_title"),
          message: t("agent_rail.rendered_card_missing", { id: record.renderedCardID }),
          details: describeRecord(record, selector),
        })
      })
    })
  })
}

/** Wire up pointer-driven drag-to-scroll on the rail's lanes container.
 *  Press-and-drag horizontally scrolls the rail like a trackpad; a real
 *  click (no drag past the 4px threshold) still reaches the avatar
 *  button and triggers `locateRecord`. The dataset flag `data-dragging`
 *  lets CSS swap the cursor between `grab` and `grabbing` and disable
 *  text selection during the drag. */
function attachRailDragScroll(el: HTMLElement): () => void {
  const DRAG_THRESHOLD_PX = 4
  let pointerId: number | null = null
  let capturedPointerId: number | null = null
  let capturedPointerTarget: Element | null = null
  let startX = 0
  let startScrollLeft = 0
  let dragging = false
  let suppressClick = false

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return
    if (pointerId !== null) return
    if (!(event.target instanceof Element)) return
    const captureTarget = event.target
    pointerId = event.pointerId
    startX = event.clientX
    startScrollLeft = el.scrollLeft
    dragging = false
    suppressClick = false
    captureTarget.setPointerCapture(pointerId)
    capturedPointerId = pointerId
    capturedPointerTarget = captureTarget
  }

  function onPointerMove(event: PointerEvent) {
    if (pointerId === null || event.pointerId !== pointerId) return
    const dx = event.clientX - startX
    if (!dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
      dragging = true
      suppressClick = true
      el.dataset.dragging = "true"
    }
    el.scrollLeft = startScrollLeft - dx
    event.preventDefault()
  }

  function onPointerEnd(event: PointerEvent) {
    if (pointerId === null || event.pointerId !== pointerId) return
    if (capturedPointerId === pointerId && capturedPointerTarget?.hasPointerCapture(pointerId)) {
      capturedPointerTarget.releasePointerCapture(pointerId)
    }
    capturedPointerId = null
    capturedPointerTarget = null
    if (dragging) {
      delete el.dataset.dragging
    }
    dragging = false
    pointerId = null
    // suppressClick stays true so the click event that follows the
    // pointerup gets swallowed; it resets itself inside onClickCapture.
  }

  function onClickCapture(event: MouseEvent) {
    if (!suppressClick) return
    event.stopPropagation()
    event.preventDefault()
    suppressClick = false
  }

  el.addEventListener("pointerdown", onPointerDown)
  el.addEventListener("pointermove", onPointerMove)
  el.addEventListener("pointerup", onPointerEnd)
  el.addEventListener("pointercancel", onPointerEnd)
  el.addEventListener("click", onClickCapture, true)

  return () => {
    el.removeEventListener("pointerdown", onPointerDown)
    el.removeEventListener("pointermove", onPointerMove)
    el.removeEventListener("pointerup", onPointerEnd)
    el.removeEventListener("pointercancel", onPointerEnd)
    el.removeEventListener("click", onClickCapture, true)
    if (capturedPointerId !== null && capturedPointerTarget?.hasPointerCapture(capturedPointerId)) {
      capturedPointerTarget.releasePointerCapture(capturedPointerId)
    }
    capturedPointerId = null
    capturedPointerTarget = null
    delete el.dataset.dragging
  }
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
      style={{ "--card-stage": stageAccent(avatarRole(record().stage)) }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        tone="neutral"
        data-ui="conversation-agent-rail-locate"
        aria-label={compactLabel(record())}
        title={compactLabel(record())}
        onClick={() => props.onLocate(record())}
      >
        <Avatar role={record().stage} status={record().status} />
      </Button>
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
      records: mergeAgentRecords(conversationAgentRecordsForSource(boardStore.selectedSource), liveProjection.records),
    }
  })
  const records = createMemo(() => projection().records)
  const hasRecords = createMemo(() => records().length > 0)

  return (
    <Show when={hasRecords()}>
      <aside class="conversation-agent-rail" aria-label={t("agent_rail.workflow_label")}>
        <div
          class="conversation-agent-rail__lanes"
          role="list"
          ref={(el) => {
            if (!el) return
            const dispose = attachRailDragScroll(el)
            onCleanup(dispose)
          }}
        >
          <div class="conversation-agent-rail__lane" data-kind="timeline" role="listitem">
            <Index each={records()}>{(record) => <AgentRailRow record={record} onLocate={locateRecord} />}</Index>
          </div>
        </div>
      </aside>
    </Show>
  )
}
