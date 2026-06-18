import { Show, createMemo, createSignal } from "solid-js"
import { displayToolIcon } from "../utils/tool"
import {
  collapsedActivityPreviewText,
  collectLatestActivityText,
  collectTodoSummary,
  type CardNode,
} from "../utils/card-tree"
import { t } from "../utils/i18n"
import { formatDuration } from "../utils/time"
import { useNowTick } from "../services/clock"
import { goalRevisionLabel } from "../utils/goal-label"
import { useCardHeadActions } from "../hooks/use-card-head-actions"
import { formatCostUSD, formatTokenCount } from "../utils/format-usage"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"

function leadingGlyph(node: CardNode): string {
  if (node.kind === "tool") return displayToolIcon(node.stage || node.title)
  return ""
}

function isStageCard(node: CardNode): boolean {
  return node.kind === "phase" || node.kind === "step"
}

function cardTitleText(title: string): string {
  return /^[\w-]+(?:\.[\w-]+)+$/.test(title) ? t(title) : title
}

async function writeClipboard(text: string): Promise<boolean> {
  if (!text) return false
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return true
  }
  return false
}

export function CardHeader(props: {
  node: CardNode
  expanded: boolean
  collapsible: boolean
  onToggle: () => void
  /** Invoked when the user clicks the rewind (↶) button. Receives the
   *  card's `time` (ms — becomes cursorTime on the backend) and id
   *  (anchorEventID for audit). Parent routes it to POST /task/:id/rewind. */
  onRewind?: (cursorTime: number, anchorID: string, opts: { resetWorktree: boolean }) => Promise<void>
  /** Set on cards that map 1:1 to an opencorvus session (kind="agent"
   *  cards whose id follows `<stage>:session:<sid>`). When present the
   *  header renders a 🔍 button that calls `onTrace` to toggle the
   *  AgentTrace panel for that session inside the card body. */
  traceSessionID?: string
  /** Whether the trace panel is currently open in the parent. */
  traceOpen?: boolean
  /** Toggle the trace panel for this card. */
  onTrace?: () => void
  /** Child-agent cancel control. Root orchestrator/task session is not
   *  passed. Reply moved to <AgentSessionReplyBox/> at the END of the card
   *  body — see Card.tsx. */
  agentSessionID?: string
  onAgentCancel?: (sessionID: string) => Promise<void>
  onAgentModelSettings?: (sessionID: string) => void
}) {
  const glyph = () => leadingGlyph(props.node)
  const [reasonCopied, setReasonCopied] = createSignal(false)
  const headActions = useCardHeadActions({
    node: () => props.node,
    onRewind: props.onRewind,
    onAgentCancel: props.onAgentCancel,
    agentSessionID: () => props.agentSessionID,
  })
  const collapsedActive = () =>
    !props.expanded && props.node.status !== "running" && isStageCard(props.node) && props.node.kind !== "tool"
  const collapsedPreview = () =>
    collapsedActive() ? collapsedActivityPreviewText(collectLatestActivityText(props.node), props.node.title) : ""
  const todoSummary = () => (collapsedActive() ? collectTodoSummary(props.node) : null)
  const todoProgressPct = () => {
    const s = todoSummary()
    if (!s || s.total === 0) return 0
    return Math.round((s.completed / s.total) * 100)
  }
  // Drives `card__head--with-meta` (flex-start vs center). Only true when
  // we render a row BELOW the title row — subtitle is inline, so it does
  // not count toward "needs vertical alignment to top".
  const hasSecondaryText = () => !!collapsedPreview() || !!todoSummary()
  const stepRevisionLabel = () =>
    props.node.kind === "step" ? goalRevisionLabel(props.node.round, props.node.attempt) : ""

  // Single source for the card's elapsed/duration chip. Completed/error
  // cards subtract `timeCompleted - time`; running cards subtract
  // `now() - time` where `now` is a shared 1Hz tick (services/clock.ts).
  // The tick is reference-counted, so any number of running cards share
  // a single setInterval. Cards without a valid `time`, or finished
  // cards missing `timeCompleted`, render nothing.
  const now = useNowTick()
  const durationMs = createMemo<number | null>(() => {
    const start = props.node.time
    if (!Number.isFinite(start) || (start as number) <= 0) return null
    const end = props.node.timeCompleted
    if (Number.isFinite(end) && (end as number) > (start as number)) {
      return (end as number) - (start as number)
    }
    if (props.node.status === "running") {
      const ms = now() - (start as number)
      return ms > 0 ? ms : null
    }
    return null
  })
  const durationText = createMemo(() => {
    const ms = durationMs()
    return ms === null ? "" : formatDuration(ms)
  })
  const modelLabel = () => props.node.model?.display || ""
  const hasContextTokens = () =>
    typeof props.node.contextTokens === "number" && (props.node.contextTokens as number) > 0
  const hasUsage = () => {
    const usage = props.node.usage
    if (!usage) return false
    return (usage.totalTokens ?? 0) > 0 || (usage.costUSD ?? 0) > 0
  }
  const hasMetaActions = () => !!modelLabel() || hasContextTokens() || hasUsage()
  const hasControlActions = () =>
    (!!props.traceSessionID && !!props.onTrace) ||
    (!!props.agentSessionID && !!props.onAgentModelSettings) ||
    headActions.caps.canCancel() ||
    headActions.caps.canRewind()

  return (
    <div
      class="card__head"
      classList={{ "card__head--with-meta": hasSecondaryText() }}
    >
      <button
        type="button"
        class="card__head-main"
        aria-expanded={props.collapsible ? props.expanded : undefined}
        onClick={() => {
          if (!props.collapsible) return
          props.onToggle()
        }}
      >
        <Show when={glyph()}>
          <span class="card__icon">{glyph()}</span>
        </Show>
        <span class="card__main">
          <span class="card__title-row">
            <Show
              when={stepRevisionLabel()}
              fallback={
                <Show when={(props.node.round ?? 0) > 0}>
                  <span class="card__round card__round--lead">#{props.node.round}</span>
                </Show>
              }
            >
              <span class="card__round card__round--lead">{stepRevisionLabel()}</span>
            </Show>
            <span class="card__title">{cardTitleText(props.node.title)}</span>
            <Show when={durationText()}>
              <span class="card__duration" title={t("card.duration_tooltip", { value: durationText() })}>
                {durationText()}
              </span>
            </Show>
            <Show when={props.node.subtitle}>
              <span class="card__subtitle" title={props.node.subtitle}>
                {props.node.subtitle}
              </span>
            </Show>
            <span class="card__title-spacer" aria-hidden="true" />
          </span>
          <Show when={collapsedPreview()}>
            <span class="card__preview-row">
              <span class="card__collapsed-preview" title={collapsedPreview()}>
                {collapsedPreview()}
              </span>
            </span>
          </Show>
          <Show when={todoSummary()}>
            {(summary) => (
              <span
                class="card__todo-summary"
                title={`${summary().completed}/${summary().total} done${summary().current ? ` · ${summary().current}` : ""}`}
              >
                <span
                  class="card__todo-progress"
                  role="progressbar"
                  aria-valuenow={summary().completed}
                  aria-valuemin={0}
                  aria-valuemax={summary().total}
                  style={{ "--pct": `${todoProgressPct()}%` }}
                />
                <span class="card__todo-count">
                  {summary().completed}/{summary().total}
                </span>
                <Show when={summary().current}>
                  <span class="card__todo-current">{summary().current}</span>
                </Show>
              </span>
            )}
          </Show>
        </span>
      </button>
      <Show when={props.node.status === "error" && !!props.node.errorReason}>
        <Button
          type="button"
          variant="ghost"
          size="mini"
          tone={reasonCopied() ? "accent" : "danger"}
          data-ui="card-error-reason"
          data-state={reasonCopied() ? "copied" : "idle"}
          title={t("card.error_reason_title", { reason: props.node.errorReason || "" })}
          aria-label={t("card.error_reason", { reason: props.node.errorReason || "" })}
          onClick={async (e) => {
            e.stopPropagation()
            const reason = props.node.errorReason || ""
            if (!reason) return
            const ok = await writeClipboard(reason)
            if (!ok) return
            setReasonCopied(true)
            setTimeout(() => setReasonCopied(false), 1200)
          }}
        >
          <span data-ui="card-error-reason-text">{props.node.errorReason}</span>
        </Button>
      </Show>
      <div class="card__actions">
        <Show when={hasMetaActions()}>
          <div class="card__meta-actions">
            <Show when={modelLabel()}>
              <span
                class="card__model-hint"
                title={t("card.model_tooltip", { model: modelLabel() })}
                aria-label={t("card.model_tooltip", { model: modelLabel() })}
                onClick={(e) => e.stopPropagation()}
              >
                {modelLabel()}
              </span>
            </Show>
            <Show when={hasContextTokens()}>
              <span
                class="card__token-hint"
                data-estimated={props.node.contextTokensEstimated ? "true" : "false"}
                title={t(
                  props.node.contextTokensEstimated
                    ? "card.context_tokens_tooltip_estimated"
                    : "card.context_tokens_tooltip",
                  { value: String(props.node.contextTokens) },
                )}
                aria-label={t(
                  props.node.contextTokensEstimated
                    ? "card.context_tokens_tooltip_estimated"
                    : "card.context_tokens_tooltip",
                  { value: String(props.node.contextTokens) },
                )}
                onClick={(e) => e.stopPropagation()}
              >
                ~{formatTokenCount(props.node.contextTokens as number)} tok
                {props.node.contextTokensEstimated ? " · est." : ""}
              </span>
            </Show>
            <Show when={hasUsage()}>
              {(_) => {
                const u = () => props.node.usage!
                const totalLabel = () => {
                  const t = u().totalTokens ?? 0
                  const inT = u().inputTokens ?? 0
                  const outT = u().outputTokens ?? 0
                  if (t > 0) return formatTokenCount(t)
                  if (inT > 0 || outT > 0) return formatTokenCount(inT + outT)
                  return ""
                }
                const costLabel = () => {
                  const c = u().costUSD ?? 0
                  return c > 0 ? formatCostUSD(c) : ""
                }
                const tip = () => {
                  const u_ = u()
                  const parts: string[] = []
                  if ((u_.inputTokens ?? 0) > 0) parts.push(`↑ ${u_.inputTokens} in`)
                  if ((u_.outputTokens ?? 0) > 0) parts.push(`↓ ${u_.outputTokens} out`)
                  if ((u_.totalTokens ?? 0) > 0) parts.push(`Σ ${u_.totalTokens} total`)
                  if ((u_.costUSD ?? 0) > 0) parts.push(formatCostUSD(u_.costUSD!))
                  return parts.join(" · ")
                }
                return (
                  <span class="card__usage-hint" title={tip()} onClick={(e) => e.stopPropagation()}>
                    <Show when={totalLabel()}>
                      <span class="card__usage-tokens">{totalLabel()} tok</span>
                    </Show>
                    <Show when={costLabel()}>
                      <span class="card__usage-cost">{costLabel()}</span>
                    </Show>
                  </span>
                )
              }}
            </Show>
          </div>
        </Show>
        <Show when={hasControlActions()}>
          <div class="card__control-actions">
            <Show when={!!props.traceSessionID && !!props.onTrace}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                tone="neutral"
                data-ui="card-trace"
                data-state={props.traceOpen ? "open" : "closed"}
                title={t("card.inspect_agent_trace")}
                aria-label={t("card.inspect_agent_trace")}
                aria-pressed={!!props.traceOpen}
                onClick={(e) => {
                  e.stopPropagation()
                  props.onTrace?.()
                }}
              >
                <Icon name="inspect" size={13} />
              </Button>
            </Show>
            <Show when={!!props.agentSessionID && !!props.onAgentModelSettings}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                tone="neutral"
                data-ui="card-agent-model-settings"
                title="Session model settings"
                aria-label="Session model settings"
                data-testid="card-open-session-agent-models"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onAgentModelSettings?.(props.agentSessionID!)
                }}
              >
                <Icon name="executor" size={13} />
              </Button>
            </Show>
            <Show when={headActions.caps.canCancel()}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                tone="neutral"
                data-ui="card-agent-cancel"
                data-state={headActions.state.cancelling() ? "pending" : "idle"}
                title={headActions.labels.cancel()}
                aria-label={headActions.labels.cancel()}
                disabled={headActions.state.cancelling()}
                onClick={headActions.onAgentCancel}
              >
                <Icon name="cancel" size={13} />
              </Button>
            </Show>
            <Show when={headActions.caps.canRewind()}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                tone="neutral"
                data-ui="card-rewind"
                data-state={headActions.state.rewinding() ? "pending" : "idle"}
                title={headActions.labels.rewind()}
                aria-label={headActions.labels.rewindStep()}
                disabled={headActions.state.rewinding()}
                onClick={headActions.onRewind}
              >
                <Icon name="rewind" size={13} />
              </Button>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
