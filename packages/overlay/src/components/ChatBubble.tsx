import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js"

import type { CardNode } from "../store/card-tree"
import { cardTreeStore, pruneCardsAfterCursor } from "../store/card-tree"
import { boardStore, rootTaskSessionID,
  activeTaskID,
} from "../store/board"
import { cardExpanded, setCardExpanded } from "../store/conversation-ui"
import {
  collapsedActivityPreviewText,
  collectActivityCounts,
  collectLatestActivityText,
  collectTodoSummary,
  defaultExpandedForNode,
  visibleChildIDsForCard,
} from "../utils/card-tree"
import { bubbleAlign } from "../utils/chat-bubble"
import { normalizeAgentRole, roleLabel } from "../utils/message"
import { canReceiveDirectAgentReply } from "../utils/direct-reply-kinds"
import { stageAccent } from "../utils/card-color"
import { formatDuration, fullStampWithRelative, stamp } from "../utils/time"
import { useNowTick } from "../services/clock"
import { apiRequest } from "../services/api"
import { cancelAgentSession, replyToAgentSession } from "../services/task"
import { t } from "../utils/i18n"
import { formatCostUSD, formatTokenCount } from "../utils/format-usage"
import { useCardHeadActions } from "../hooks/use-card-head-actions"
import { AgentSessionReplyBox } from "./AgentSessionReplyBox"
import { AgentFileChanges } from "./AgentFileChanges"
import { Avatar } from "./Avatar"
import { CardParts } from "./CardParts"
import { IntegrityBody } from "./IntegrityCard"
import { Icon } from "./Icon"
import { storeCardNode } from "./StoreCardNode"
import { TracePanel } from "./TracePanel"

async function writeClipboard(text: string): Promise<boolean> {
  if (!text) return false
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return true
  }
  return false
}

function UnsupportedChatBubbleChild(props: { child: CardNode; parentID: string }): null {
  throw new Error(`ChatBubble: unsupported child kind "${props.child.kind}" for ${props.parentID}`)
}

function ChatBubbleChild(props: { childID: string; depth: number; parentID: string }) {
  const child = () => storeCardNode(props.childID, props.parentID)

  return (
    <Switch fallback={<UnsupportedChatBubbleChild child={child()} parentID={props.parentID} />}>
      <Match when={child().kind === "message"}>
        <CardParts parts={child().parts} depth={props.depth + 1} streaming={child().status === "running"} />
      </Match>
      <Match when={child().kind === "agent" && child().integrity}>
        <IntegrityBody integrity={child().integrity!} />
      </Match>
      <Match when={child().kind === "integrity" && child().integrity}>
        <IntegrityBody integrity={child().integrity!} />
      </Match>
    </Switch>
  )
}

export function ChatBubble(props: { node: CardNode; depth: number }) {
  let articleRef: HTMLElement | undefined
  const [traceOpen, setTraceOpen] = createSignal(false)
  const [reasonCopied, setReasonCopied] = createSignal(false)

  const defaultExpanded = () => defaultExpandedForNode(props.node)
  const expanded = () => cardExpanded(props.node.id, props.node.status, defaultExpanded())
  const isAgentBubble = () => props.node.kind === "agent"
  const align = () => bubbleAlign(props.node)
  const normalizedRole = () => normalizeAgentRole(props.node.role || props.node.stage || "")
  const roleTitle = () => roleLabel(normalizedRole())
  const visibleChildIDs = createMemo(() => visibleChildIDsForCard(props.node))

  const setExpanded = (value: boolean) => {
    setCardExpanded(props.node.id, value, props.node.status)
  }
  const toggleExpanded = () => {
    setExpanded(!expanded())
  }

  const canBubbleSurfaceToggle = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    if (!target || !articleRef) return false
    const bubble = articleRef.querySelector<HTMLElement>(".chat-bubble")
    if (!bubble) return false
    if (target.closest(".chat-bubble") !== bubble) return false
    if (window.getSelection()?.type === "Range") return false
    const interactive = target.closest<HTMLElement>(
      [
        "button",
        "a",
        "input",
        "textarea",
        "select",
        "summary",
        "[contenteditable='true']",
        "[role='button']",
        "[role='menuitem']",
        "[role='checkbox']",
        "[role='tab']",
        "[role='textbox']",
        "[data-card-click-ignore='true']",
        "[data-card-dblclick-ignore='true']",
      ].join(","),
    )
    return interactive == null
  }

  const now = useNowTick()
  const durationText = createMemo(() => {
    const start = props.node.time
    if (!Number.isFinite(start) || (start as number) <= 0) return ""
    const end = props.node.timeCompleted
    if (Number.isFinite(end) && (end as number) > (start as number)) {
      return formatDuration((end as number) - (start as number))
    }
    if (props.node.status === "running") {
      const delta = now() - (start as number)
      return delta > 0 ? formatDuration(delta) : ""
    }
    return ""
  })

  const footActivity = createMemo(() => {
    if (expanded()) return null
    if (props.node.status === "running") return null
    const counts = collectActivityCounts(props.node)
    if (counts.messages + counts.tools + counts.agents + counts.skills === 0) return null
    return counts
  })
  const footActivityTitle = () => {
    const counts = footActivity()
    if (!counts) return undefined
    return t("card.activity_summary", {
      messages: counts.messages,
      tools: counts.tools,
      agents: counts.agents,
      skills: counts.skills,
    })
  }
  const collapsedPreview = createMemo(() =>
    !expanded() && props.node.status !== "running"
      ? collapsedActivityPreviewText(collectLatestActivityText(props.node), props.node.title)
      : "",
  )
  const todoSummary = createMemo(() =>
    !expanded() && props.node.status !== "running" && isAgentBubble() ? collectTodoSummary(props.node) : null,
  )
  const todoProgressPct = () => {
    const summary = todoSummary()
    if (!summary || summary.total === 0) return 0
    return Math.round((summary.completed / summary.total) * 100)
  }

  const traceSessionID = createMemo(() =>
    props.node.kind === "agent" ? props.node.sessionID || undefined : undefined,
  )
  const directAgentSessionID = createMemo(() => {
    if (props.node.kind !== "agent") return undefined
    const sessionID = traceSessionID()
    if (!sessionID || sessionID === rootTaskSessionID()) return undefined
    // Filter by the agent card's stage (the session kind it represents);
    // if it's not in the reply whitelist the backend route would 400 and
    // showing the reply box would just bait the user into a wasted click.
    // See utils/direct-reply-kinds.ts for the mirrored set.
    if (!canReceiveDirectAgentReply(props.node.stage)) return undefined
    return sessionID
  })

  const onTraceToggle = () => {
    if (!traceSessionID()) return
    if (!expanded()) setExpanded(true)
    setTraceOpen((value) => !value)
  }

  const onRewind = async (cursorTime: number, anchorID: string, opts: { resetWorktree: boolean }) => {
    const taskID = activeTaskID()
    if (!taskID) return
    pruneCardsAfterCursor(cursorTime)
    try {
      const response = await apiRequest<unknown>(`task/${encodeURIComponent(taskID)}/rewind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anchor: { kind: "cursorTime", cursorTime, anchorEventID: anchorID },
          resetWorktree: opts.resetWorktree,
          reason: "user rewind card",
        }),
        responseKind: "text",
      })
      if (!response.ok) {
        console.error("rewind request failed", response.status, response.body)
      }
    } catch (error) {
      console.error("rewind request errored", error)
    }
  }

  const onAgentReply = async (sessionID: string, message: string) => {
    const taskID = activeTaskID()
    if (!taskID) return
    await replyToAgentSession(taskID, sessionID, message)
  }

  const onAgentCancel = async (sessionID: string) => {
    const taskID = activeTaskID()
    if (!taskID) return
    await cancelAgentSession(taskID, sessionID)
  }

  const headActions = useCardHeadActions({
    node: () => props.node,
    onRewind,
    onAgentCancel,
    agentSessionID: directAgentSessionID,
  })
  const usageVisible = () => {
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
  const articleStyle = createMemo<Record<string, string> | undefined>(() => {
    const style: Record<string, string> = {}
    const accent = stageAccent(normalizedRole())
    if (accent) style["--card-stage"] = accent
    return Object.keys(style).length > 0 ? style : undefined
  })

  return (
    <article
      ref={articleRef}
      class="chat-bubble-row"
      data-card-id={props.node.id}
      data-kind={props.node.kind}
      data-role={normalizedRole()}
      data-stage={normalizedRole()}
      data-align={align()}
      data-status={props.node.status || "none"}
      data-depth={props.depth}
      style={articleStyle()}
      classList={{ "chat-bubble-row--expanded": expanded(), "chat-bubble-row--collapsed": !expanded() }}
      onDblClick={(event) => {
        if (!canBubbleSurfaceToggle(event)) return
        event.stopPropagation()
        toggleExpanded()
      }}
    >
      <div class="chat-bubble-shell" data-align={align()}>
        <div
          class="chat-bubble"
          data-align={align()}
          data-stage={normalizedRole()}
          data-status={props.node.status || "none"}
          classList={{ "chat-bubble--collapsed": !expanded() }}
        >
          <div
            class="chat-bubble__head"
            data-align={align()}
            role="button"
            tabindex={0}
            aria-expanded={expanded()}
            onClick={toggleExpanded}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              toggleExpanded()
            }}
          >
            <div class="chat-bubble__title-row">
              <div class="chat-bubble__identity" data-align={align()}>
                <Avatar role={normalizedRole()} status={props.node.status} class="chat-bubble__head-avatar" />
                <div class="chat-bubble__identity-copy">
                  <div class="chat-bubble__title-line" data-align={align()}>
                    <span class="chat-bubble__title">{roleTitle()}</span>
                    <Show when={durationText()}>
                      <span
                        class="card__duration"
                        title={t("card.duration_tooltip", { value: durationText() })}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {durationText()}
                      </span>
                    </Show>
                    <Show when={props.node.status === "error" && !!props.node.errorReason}>
                      <button
                        type="button"
                        class="card__error-reason"
                        classList={{ "card__error-reason--copied": reasonCopied() }}
                        title={t("card.error_reason_title", { reason: props.node.errorReason || "" })}
                        aria-label={t("card.error_reason", { reason: props.node.errorReason || "" })}
                        onClick={(event) => {
                          event.stopPropagation()
                          void (async () => {
                            const reason = props.node.errorReason || ""
                            if (!reason) return
                            const ok = await writeClipboard(reason)
                            if (!ok) return
                            setReasonCopied(true)
                            setTimeout(() => setReasonCopied(false), 1200)
                          })()
                        }}
                      >
                        {props.node.errorReason}
                      </button>
                    </Show>
                  </div>
                </div>
              </div>
              <div class="chat-bubble__actions">
                <Show when={typeof props.node.contextTokens === "number" && (props.node.contextTokens as number) > 0}>
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
                <Show when={usageVisible()}>
                  <span class="card__usage-hint" title={usageTip()} onClick={(event) => event.stopPropagation()}>
                    <Show when={usageTotalLabel()}>
                      <span class="card__usage-tokens">{usageTotalLabel()} tok</span>
                    </Show>
                    <Show when={usageCostLabel()}>
                      <span class="card__usage-cost">{usageCostLabel()}</span>
                    </Show>
                  </span>
                </Show>
                <Show when={!!traceSessionID()}>
                  <button
                    type="button"
                    class="card__trace"
                    classList={{ "card__trace--open": traceOpen() }}
                    title={t("card.inspect_agent_trace")}
                    aria-label={t("card.inspect_agent_trace")}
                    aria-pressed={traceOpen()}
                    onClick={(event) => {
                      event.stopPropagation()
                      onTraceToggle()
                    }}
                  >
                    <Icon name="inspect" size={13} />
                  </button>
                </Show>
                <Show when={headActions.caps.canCancel()}>
                  <button
                    type="button"
                    class="card__agent-cancel"
                    classList={{ "card__agent-cancel--pending": headActions.state.cancelling() }}
                    title={headActions.labels.cancel()}
                    aria-label={headActions.labels.cancel()}
                    disabled={headActions.state.cancelling()}
                    onClick={headActions.onAgentCancel}
                  >
                    <Icon name="cancel" size={13} />
                  </button>
                </Show>
                <Show when={headActions.caps.canRewind()}>
                  <button
                    type="button"
                    class="card__rewind"
                    classList={{ "card__rewind--pending": headActions.state.rewinding() }}
                    title={headActions.labels.rewind()}
                    aria-label={headActions.labels.rewindStep()}
                    disabled={headActions.state.rewinding()}
                    onClick={headActions.onRewind}
                  >
                    <Icon name="rewind" size={13} />
                  </button>
                </Show>
              </div>
            </div>
            <Show when={collapsedPreview()}>
              <div class="card__preview-row">
                <span class="card__collapsed-preview" title={collapsedPreview()}>{collapsedPreview()}</span>
              </div>
            </Show>
            <Show when={todoSummary()}>
              {(summary) => (
                <div
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
                </div>
              )}
            </Show>
          </div>
          <Show when={expanded()}>
            <div class="chat-bubble__body">
              <Show when={traceOpen() && traceSessionID()}>
                <TracePanel sessionID={traceSessionID()!} onClose={() => setTraceOpen(false)} />
              </Show>
              <div class="chat-bubble__body-inner">
                <Show when={props.node.parts.length > 0}>
                  <CardParts parts={props.node.parts} depth={props.depth} streaming={props.node.status === "running"} />
                </Show>
                <Show when={props.node.integrity}>
                  <IntegrityBody integrity={props.node.integrity!} />
                </Show>
                <Show when={visibleChildIDs().length > 0}>
                  <div class="chat-bubble__children">
                    <For each={visibleChildIDs()}>
                      {(childID) => (
                        <ChatBubbleChild childID={childID} depth={props.depth} parentID={props.node.id} />
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={directAgentSessionID()}>
                  <AgentSessionReplyBox onSend={(message) => onAgentReply(directAgentSessionID()!, message)} />
                </Show>
              </div>
            </div>
          </Show>
          <AgentFileChanges node={props.node} />
          <div class="chat-bubble__foot" title={footActivityTitle()}>
            <span class="chat-bubble__stamp" title={fullStampWithRelative(props.node.time)}>
              {stamp(props.node.time)}
            </span>
            <Show when={footActivity()}>
              {(counts) => (
                <>
                  <Show when={counts().tools > 0}>
                    <span
                      class="card__stat"
                      data-kind="tools"
                      title={t("card.activity.tools", { count: counts().tools })}
                    >
                      <span class="card__stat-label">{t("card.activity.tools_short")}</span>
                      <span class="card__stat-value">{counts().tools}</span>
                    </span>
                  </Show>
                  <Show when={counts().messages > 0}>
                    <span
                      class="card__stat"
                      data-kind="messages"
                      title={t("card.activity.messages", { count: counts().messages })}
                    >
                      <span class="card__stat-label">{t("card.activity.messages_short")}</span>
                      <span class="card__stat-value">{counts().messages}</span>
                    </span>
                  </Show>
                  <Show when={counts().agents > 0}>
                    <span
                      class="card__stat"
                      data-kind="agents"
                      title={t("card.activity.agents", { count: counts().agents })}
                    >
                      <span class="card__stat-label">{t("card.activity.agents_short")}</span>
                      <span class="card__stat-value">{counts().agents}</span>
                    </span>
                  </Show>
                  <Show when={counts().skills > 0}>
                    <span
                      class="card__stat"
                      data-kind="skills"
                      title={t("card.activity.skills", { count: counts().skills })}
                    >
                      <span class="card__stat-label">{t("card.activity.skills_short")}</span>
                      <span class="card__stat-value">{counts().skills}</span>
                    </span>
                  </Show>
                </>
              )}
            </Show>
          </div>
        </div>
      </div>
    </article>
  )
}
