import * as Tooltip from "@kobalte/core/tooltip"
import { Show, createMemo, createSignal, type JSX } from "solid-js"

import type { CardNode } from "../store/card-tree"
import { useCardHeadActions } from "../hooks/use-card-head-actions"
import { useNowTick } from "../services/clock"
import { formatCostUSD, formatTokenCount } from "../utils/format-usage"
import { t } from "../utils/i18n"
import { formatDuration } from "../utils/time"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"

function stopMetaClick(event: MouseEvent): void {
  event.stopPropagation()
}

async function writeClipboard(text: string): Promise<boolean> {
  if (!text) return false
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return true
  }
  return false
}

function CardMetaHint(props: {
  class: string
  dataUi: string
  detail: string
  estimated?: boolean
  children: JSX.Element
}) {
  return (
    <Tooltip.Root openDelay={0} closeDelay={0} placement="top" gutter={6}>
      <Tooltip.Trigger
        as="span"
        tabIndex={0}
        class={`card__meta-chip ${props.class}`}
        data-ui={props.dataUi}
        data-estimated={props.estimated ? "true" : undefined}
        title={props.detail}
        aria-label={props.detail}
        onClick={stopMetaClick}
      >
        {props.children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="card-meta-tooltip">{props.detail}</Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
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
    if ((usage.inputTokens ?? 0) > 0) {
      parts.push(t("card.usage_input_tokens", { value: String(usage.inputTokens) }))
    }
    if ((usage.outputTokens ?? 0) > 0) {
      parts.push(t("card.usage_output_tokens", { value: String(usage.outputTokens) }))
    }
    if ((usage.totalTokens ?? 0) > 0) {
      parts.push(t("card.usage_total_tokens", { value: String(usage.totalTokens) }))
    }
    if ((usage.costUSD ?? 0) > 0) {
      parts.push(t("card.usage_cost", { value: formatCostUSD(usage.costUSD!) }))
    }
    return parts.length > 0 ? t("card.usage_tooltip", { detail: parts.join(t("card.meta_separator")) }) : ""
  }
  const contextTokensTip = () =>
    t(props.node.contextTokensEstimated ? "card.context_tokens_tooltip_estimated" : "card.context_tokens_tooltip", {
      value: String(props.node.contextTokens),
    })
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
              <CardMetaHint
                class="card__model-hint"
                dataUi="card-model-hint"
                detail={t("card.model_tooltip", { model: modelLabel() })}
              >
                {modelLabel()}
              </CardMetaHint>
            </Show>
            <Show when={hasContextTokens()}>
              <CardMetaHint
                class="card__token-hint"
                dataUi="card-token-hint"
                detail={contextTokensTip()}
                estimated={!!props.node.contextTokensEstimated}
              >
                ~{formatTokenCount(props.node.contextTokens as number)} tok
                {props.node.contextTokensEstimated ? " · est." : ""}
              </CardMetaHint>
            </Show>
            <Show when={hasUsage()}>
              <CardMetaHint class="card__usage-hint" dataUi="card-usage-hint" detail={usageTip()}>
                <Show when={usageTotalLabel()}>
                  <span class="card__usage-tokens">{usageTotalLabel()} tok</span>
                </Show>
                <Show when={usageCostLabel()}>
                  <span class="card__usage-cost">{usageCostLabel()}</span>
                </Show>
              </CardMetaHint>
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
                title={t("card.session_model_settings")}
                aria-label={t("card.session_model_settings")}
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
                data-state="disabled"
                title={headActions.labels.rewindDisabled()}
                aria-label={headActions.labels.rewindDisabled()}
                disabled
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
