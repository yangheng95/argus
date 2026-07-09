import { Index, Show, createMemo, createSignal, type Accessor } from "solid-js"
import { cardTreeStore } from "../store/card-tree"
import { boardStore } from "../store/board"
import { conversationAgentRecordsForSource } from "../store/conversation-agents"
import { setCardExpanded } from "../store/conversation-ui"
import {
  conversationCardContainsMessage,
  loadConversationHistoryUntilCard,
  loadConversationSessionHistory,
} from "../services/conversation"
import { requestConversationCardScroll } from "../services/conversation-scroll"
import { formatErrorDetails, notifyWarning } from "../services/notify"
import { AppLog } from "../utils/log"
import type { AgentWorkflowRecord, AgentWorkflowStatus } from "../utils/agent-workflow"
import { parentIDChainForCard } from "../utils/card-tree"
import { stageAccent } from "../utils/card-color"
import { avatarRole } from "./Avatar"
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
  const summary = agentRailSummary(record)
  if (summary) parts.push(summary)
  return parts.filter(Boolean).join(" · ")
}

interface AgentRailStack {
  id: string
  stage: string
  agentName: string
  records: AgentWorkflowRecord[]
}

function agentRailStage(record: AgentWorkflowRecord): string {
  return avatarRole(record.stage)
}

function agentRailSummary(record: AgentWorkflowRecord): string {
  return String(record.displaySummary?.text || "").trim()
}

function buildAdjacentAgentRailStacks(records: AgentWorkflowRecord[]): AgentRailStack[] {
  const stacks: AgentRailStack[] = []
  for (const record of records) {
    const stage = agentRailStage(record)
    const previous = stacks[stacks.length - 1]
    if (previous?.stage === stage) {
      previous.records.push(record)
      previous.agentName = record.agentName || previous.agentName
      continue
    }
    stacks.push({
      id: `${stage}:${record.sessionID}`,
      stage,
      agentName: record.agentName,
      records: [record],
    })
  }
  return stacks
}

function parentIDsForCard(cardID: string): string[] {
  return parentIDChainForCard(cardID)
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

function reportLocateFailure(record: AgentWorkflowRecord, error: unknown): void {
  const details = `${describeRecord(record)}\n\n${formatErrorDetails(error)}`
  AppLog.error("ui", "Agent rail locate failed", {
    sessionID: record.sessionID,
    renderedCardID: record.renderedCardID,
    targetMessageID: record.targetMessageID,
    error: formatErrorDetails(error),
    notificationID: `agent-rail:locate-failed:${record.sessionID}`,
    notificationTitle: t("agent_rail.card_unavailable_title"),
    notificationMessage: t("agent_rail.locate_failed", { agent: record.agentName }),
    notificationDetails: details,
  })
  notifyWarning({
    id: `agent-rail:locate-failed:${record.sessionID}`,
    title: t("agent_rail.card_unavailable_title"),
    message: t("agent_rail.locate_failed", { agent: record.agentName }),
    details,
  })
}

function currentRecordForSession(sessionID: string): AgentWorkflowRecord | undefined {
  const targetSessionID = String(sessionID || "")
  if (!targetSessionID) return undefined
  return conversationAgentRecordsForSource(boardStore.selectedSource).find(
    (record) => record.sessionID === targetSessionID,
  )
}

async function materializeRecordTarget(record: AgentWorkflowRecord): Promise<AgentWorkflowRecord> {
  if (record.renderedCardID) return record
  const sessionID = String(record.sessionID || "")
  const source = boardStore.selectedSource
  if (!sessionID || source?.kind !== "task") return record
  const directory = String(boardStore.board?.task?.directory || "").trim()
  if (!directory) return record
  const loaded = await loadConversationSessionHistory(sessionID, source.id, { directory })
  if (!loaded) return currentRecordForSession(sessionID) || record
  return currentRecordForSession(sessionID) || record
}

async function locateRecord(record: AgentWorkflowRecord): Promise<void> {
  const targetRecord = await materializeRecordTarget(record)
  if (!targetRecord.renderedCardID) {
    notifyWarning({
      title: t("agent_rail.card_unavailable_title"),
      message: t("agent_rail.no_rendered_card_target", { agent: targetRecord.agentName }),
      details: describeRecord(targetRecord),
    })
    return
  }
  const targetMessageID = String(targetRecord.targetMessageID || "")
  const needsHistory =
    !cardTreeStore.cards[targetRecord.renderedCardID] ||
    (!!targetMessageID && !conversationCardContainsMessage(targetRecord.renderedCardID, targetMessageID))
  if (needsHistory) {
    const directory = String(boardStore.board?.task?.directory || "").trim()
    if (!directory) {
      notifyWarning({
        title: t("agent_rail.card_unavailable_title"),
        message: t("agent_rail.no_rendered_card_target", { agent: targetRecord.agentName }),
        details: describeRecord(targetRecord),
      })
      return
    }
    try {
      await loadConversationHistoryUntilCard(targetRecord.renderedCardID, undefined, {
        messageID: targetMessageID,
        sessionID: targetRecord.sessionID,
        directory,
      })
    } catch (error) {
      reportLocateFailure(targetRecord, error)
      return
    }
  }
  const target = cardTreeStore.cards[targetRecord.renderedCardID]
  setCardExpanded(targetRecord.renderedCardID, true, target?.status)
  for (const parentID of parentIDsForCard(targetRecord.renderedCardID)) {
    const parent = cardTreeStore.cards[parentID]
    setCardExpanded(parentID, true, parent?.status)
  }
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      void requestConversationCardScroll({
        cardID: targetRecord.renderedCardID!,
        behavior: "smooth",
        block: "start",
        focus: "header",
        highlight: true,
      })
        .then((found) => {
          if (found) return
          const selector = `[data-card-id="${CSS.escape(targetRecord.renderedCardID!)}"]`
          notifyWarning({
            title: t("agent_rail.card_unavailable_title"),
            message: t("agent_rail.rendered_card_missing", { id: targetRecord.renderedCardID }),
            details: describeRecord(targetRecord, selector),
          })
        })
        .catch((error) => {
          reportLocateFailure(targetRecord, error)
        })
    })
  })
}

function AgentRailRow(props: {
  record: Accessor<AgentWorkflowRecord>
  proximity: Accessor<number | undefined>
  onActivate: (record: AgentWorkflowRecord) => void
  onDeactivate: (record: AgentWorkflowRecord) => void
  onLocate: (record: AgentWorkflowRecord) => Promise<void>
}) {
  const record = props.record
  const summary = () => agentRailSummary(record())
  const accessibleLabel = () => compactLabel(record())
  const proximity = () => {
    const value = props.proximity()
    return value === undefined ? undefined : String(value)
  }

  return (
    <div
      class="conversation-agent-rail__row"
      data-agent={agentRailStage(record())}
      data-status={record().status}
      data-has-summary={summary() ? "true" : "false"}
      data-proximity={proximity()}
      style={{ "--card-stage": stageAccent(agentRailStage(record())) }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        tone="neutral"
        data-ui="conversation-agent-rail-locate"
        data-session-id={record().sessionID}
        data-target-message-id={record().targetMessageID || ""}
        data-rendered-card-id={record().renderedCardID || ""}
        aria-label={accessibleLabel()}
        onPointerEnter={() => props.onActivate(record())}
        onPointerLeave={() => props.onDeactivate(record())}
        onFocus={() => props.onActivate(record())}
        onBlur={() => props.onDeactivate(record())}
        onClick={() => {
          const current = record()
          void props.onLocate(current).catch((error) => reportLocateFailure(current, error))
        }}
      >
        <span class="conversation-agent-rail__tick" aria-hidden="true">
          <span class="conversation-agent-rail__tick-line" />
        </span>
      </Button>
    </div>
  )
}

export function ConversationAgentRail() {
  const records = createMemo(() => conversationAgentRecordsForSource(boardStore.selectedSource))
  const stacks = createMemo(() => buildAdjacentAgentRailStacks(records()))
  const hasRecords = createMemo(() => records().length > 0)
  const [activeSessionID, setActiveSessionID] = createSignal<string | undefined>()
  const activeIndex = createMemo(() => {
    const sessionID = activeSessionID()
    if (!sessionID) return -1
    return records().findIndex((record) => record.sessionID === sessionID)
  })
  const proximityForRecord = (record: AgentWorkflowRecord): number | undefined => {
    const index = activeIndex()
    if (index < 0) return undefined
    const recordIndex = records().findIndex((candidate) => candidate.sessionID === record.sessionID)
    if (recordIndex < 0) return undefined
    const distance = Math.abs(recordIndex - index)
    return distance <= 2 ? distance : undefined
  }
  const activateRecord = (record: AgentWorkflowRecord) => setActiveSessionID(record.sessionID)
  const deactivateRecord = (record: AgentWorkflowRecord) => {
    if (activeSessionID() === record.sessionID) setActiveSessionID(undefined)
  }

  return (
    <Show when={hasRecords()}>
      <aside class="conversation-agent-rail" aria-label={t("agent_rail.workflow_label")}>
        <div class="conversation-agent-rail__lanes" role="list">
          <Index each={stacks()}>
            {(stack) => (
              <div
                class="conversation-agent-rail__stack"
                data-stack-id={stack().id}
                data-agent={stack().stage}
                data-agent-name={stack().agentName}
                data-count={stack().records.length}
                role="listitem"
                style={{ "--card-stage": stageAccent(stack().stage) }}
              >
                <Index each={stack().records}>
                  {(record) => (
                    <AgentRailRow
                      record={record}
                      proximity={() => proximityForRecord(record())}
                      onActivate={activateRecord}
                      onDeactivate={deactivateRecord}
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
