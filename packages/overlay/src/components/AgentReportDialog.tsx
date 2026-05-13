import { Show } from "solid-js"
import { renderMarkdown } from "../utils/markdown"
import type { AgentWorkflowRecord } from "../utils/agent-workflow"
import { Icon } from "./Icon"

function compactID(id: string): string {
  return id ? id.slice(-10) : ""
}

function durationLabel(record: AgentWorkflowRecord): string {
  const end = record.completedAt || record.lastObservedAt
  if (!record.startedAt || !end || end <= record.startedAt) return ""
  const seconds = Math.max(1, Math.round((end - record.startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

export function AgentReportDialog(props: { record: AgentWorkflowRecord; onClose: () => void }) {
  const reportHtml = () => (props.record.traceReport ? renderMarkdown(props.record.traceReport.detail) : "")
  return (
    <div class="agent-report-dialog" role="dialog" aria-modal="true" aria-label="Agent report">
      <button type="button" class="agent-report-dialog__backdrop" onClick={props.onClose} aria-label="Close report" />
      <section class="agent-report-dialog__panel">
        <header class="agent-report-dialog__header">
          <div class="agent-report-dialog__title">
            <strong>{props.record.agentName}</strong>
            <span>{compactID(props.record.sessionID)}</span>
          </div>
          <button
            type="button"
            class="agent-report-dialog__close"
            onClick={props.onClose}
            aria-label="Close report"
            title="Close report"
          >
            <Icon name="close" size={14} />
          </button>
        </header>
        <div class="agent-report-dialog__meta">
          <span data-status={props.record.status}>{props.record.status}</span>
          <Show when={durationLabel(props.record)}>
            <span>{durationLabel(props.record)}</span>
          </Show>
          <Show when={props.record.goalID}>
            <span>{props.record.goalID}</span>
          </Show>
          <Show when={props.record.attempt}>
            <span>V{props.record.attempt}</span>
          </Show>
        </div>
        <Show
          when={props.record.traceReport}
          fallback={<div class="agent-report-dialog__empty">No report recorded.</div>}
        >
          <div class="agent-report-dialog__content md-content" innerHTML={reportHtml()} />
        </Show>
      </section>
    </div>
  )
}
