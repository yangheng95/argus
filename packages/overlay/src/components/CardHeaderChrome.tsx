import { Show, createMemo, createSignal } from "solid-js"

import type { CardNode } from "../store/card-tree"
import { useCardHeadActions } from "../hooks/use-card-head-actions"
import { useNowTick } from "../services/clock"
import { formatCostUSD, formatTokenCount } from "../utils/format-usage"
import { t } from "../utils/i18n"
import { formatDuration } from "../utils/time"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"

async function writeClipboard(text: string): Promise<boolean> {
  if (!text) return false
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return true
  }
  return false
}

export function CardDurationChip(props: { node: CardNode }) {
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

  return (
    <Show when={durationText()}>
      <span class="card__duration" title={t("card.duration_tooltip", { value: durationText() })}>
        {durationText()}
      </span>
    </Show>
  )
}

export function CardHeaderChrome(props: {
  node: CardNode
  actionsClass: string
  onRewind?: (cursorTime: number, anchorID: string, opts: { resetWorktree: boolean }) => Promise<void>
  traceSessionID?: string
  traceOpen?: boolean
  onTrace?: () => void
  agentSessionID?: string
  onAgentCancel?: (sessionID: string) => Promise<void>
  onAgentModelSettings?: (sessionID: string) => void
}) {
  const [reasonCopied, setReasonCopied] = createSignal(false)
  const headActions = useCardHeadActions({
    node: () => props.node,
    onRewind: props.onRewind,
    onAgentCancel: props.onAgentCancel,
    agentSessionID: () => props.agentSessionID,
  })
  const modelLabel = () => props.node.model?.display || ""
  const hasContextTokens = () =>
    typeof props.node.contextTokens === "number" && (props.node.contextTokens as number) > 0
  const hasUsage = () => {
    const usage = props.node.usage
    if (!usage) return false
    return (usage.totalTokens ?? 0) > 0 || (usage.costUSD ?? 0) > 0
  }
  const usageTotalLabel = () => {
    const usage = props.node.usage
    if (!usage) return ""
    const total = usage.totalTokens ?? 0
    const input = usage.inputTokens ?? 0
    const output = usage.outputTokens ?? 0
    if (total > 0) return formatTokenCount(total)
    if (input > 0 || output > 0) return formatTokenCount(input + output)
    return ""
  }
  const usageCostLabel = () => {
    const usage = props.node.usage
    if (!usage) return ""
    const cost = usage.costUSD ?? 0
    return cost > 0 ? formatCostUSD(cost) : ""
  }
  const usageTip = () => {
    const usage = props.node.usage
    if (!usage) return ""
    const parts: string[] = []
    if ((usage.inputTokens ?? 0) > 0) parts.push(`↑ ${usage.inputTokens} in`)
    if ((usage.outputTokens ?? 0) > 0) parts.push(`↓ ${usage.outputTokens} out`)
    if ((usage.totalTokens ?? 0) > 0) parts.push(`Σ ${usage.totalTokens} total`)
    if ((usage.costUSD ?? 0) > 0) parts.push(formatCostUSD(usage.costUSD!))
    return parts.join(" · ")
  }
  const hasMetaActions = () => !!modelLabel() || hasContextTokens() || hasUsage()
  const hasControlActions = () =>
    (!!props.traceSessionID && !!props.onTrace) ||
    (!!props.agentSessionID && !!props.onAgentModelSettings) ||
    headActions.caps.canCancel() ||
    headActions.caps.canRewind()

  return (
    <>
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
          onClick={async (event) => {
            event.stopPropagation()
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
      <div class={props.actionsClass}>
        <Show when={hasMetaActions()}>
          <div class="card__meta-actions">
            <Show when={modelLabel()}>
              <span
                class="card__model-hint"
                title={t("card.model_tooltip", { model: modelLabel() })}
                aria-label={t("card.model_tooltip", { model: modelLabel() })}
                onClick={(event) => event.stopPropagation()}
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
                onClick={(event) => event.stopPropagation()}
              >
                ~{formatTokenCount(props.node.contextTokens as number)} tok
                {props.node.contextTokensEstimated ? " · est." : ""}
              </span>
            </Show>
            <Show when={hasUsage()}>
              <span class="card__usage-hint" title={usageTip()} onClick={(event) => event.stopPropagation()}>
                <Show when={usageTotalLabel()}>
                  <span class="card__usage-tokens">{usageTotalLabel()} tok</span>
                </Show>
                <Show when={usageCostLabel()}>
                  <span class="card__usage-cost">{usageCostLabel()}</span>
                </Show>
              </span>
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
                onClick={(event) => {
                  event.stopPropagation()
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
                onClick={(event) => {
                  event.stopPropagation()
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
    </>
  )
}
