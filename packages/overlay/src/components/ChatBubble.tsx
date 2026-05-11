import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"

import type { CardNode } from "../store/card-tree"
import { cardTreeStore, pruneCardsAfterCursor } from "../store/card-tree"
import { boardStore, rootTaskSessionID } from "../store/board"
import { cardExpanded, setCardExpanded } from "../store/conversation-ui"
import {
  collectActivityCounts,
  collectCardText,
  collectLatestActivityText,
  collectTodoSummary,
  defaultExpandedForNode,
  visibleChildIDsForCard,
} from "../utils/card-tree"
import { bubbleAlign } from "../utils/chat-bubble"
import { normalizeAgentRole, roleLabel } from "../utils/message"
import { stageAccent } from "../utils/card-color"
import { statusBadge } from "../utils/status-badge"
import { formatDuration, fullStampWithRelative, stamp } from "../utils/time"
import { useNowTick } from "../services/clock"
import { apiRequest } from "../services/api"
import { cancelAgentSession, replyToAgentSession } from "../services/task"
import { t } from "../utils/i18n"
import { useCardHeadActions } from "../hooks/use-card-head-actions"
import { AgentSessionReplyBox } from "./AgentSessionReplyBox"
import { Avatar } from "./Avatar"
import { CardParts } from "./CardParts"
import { IntegrityBody } from "./IntegrityCard"
import { Icon } from "./Icon"
import { TracePanel } from "./TracePanel"

function sessionIDFromCardID(id: string): string | undefined {
  const idx = id.indexOf(":session:")
  if (idx < 0) return undefined
  const sessionID = id.slice(idx + ":session:".length)
  return sessionID || undefined
}

function previewPlainText(text: string): string {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, (block) =>
      block
        .replace(/^```[^\n]*\n?/, "")
        .replace(/\n?```$/, "")
        .trim(),
    )
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[A-Za-z][\w:-]*>/g, " ")
}

function collapsedPreviewText(text: string, title?: string): string {
  const sanitized = previewPlainText(text)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "")
  if (!sanitized) return ""
  const normalizedTitle = String(title || "").replace(/\s+/g, " ").trim()
  let preview = sanitized
  if (normalizedTitle) {
    const firstLine = preview.split("\n", 1)[0]
    if (firstLine.toLowerCase().startsWith(normalizedTitle.toLowerCase())) {
      const stripped = firstLine.slice(normalizedTitle.length).replace(/^[\s:：-]+/, "")
      preview = (stripped + preview.slice(firstLine.length)).replace(/^\s+/, "")
    }
  }
  return preview
}

async function writeClipboard(text: string): Promise<boolean> {
  if (!text) return false
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return true
  }
  return false
}

function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—"
  if (n < 1000) return String(n)
  if (n < 10_000) return (n / 1000).toFixed(1) + "k"
  return Math.round(n / 1000) + "k"
}

function formatCostUSD(n: number): string {
  if (!Number.isFinite(n) || n < 0) return ""
  if (n === 0) return "$0"
  if (n < 0.01) return "<$0.01"
  if (n < 1) return "$" + n.toFixed(3)
  return "$" + n.toFixed(2)
}

export function ChatBubble(props: { node: CardNode; depth: number }) {
  let articleRef: HTMLElement | undefined
  const [stickyInlineSize, setStickyInlineSize] = createSignal<number | undefined>()
  const [traceOpen, setTraceOpen] = createSignal(false)
  const [reasonCopied, setReasonCopied] = createSignal(false)

  const defaultExpanded = () => defaultExpandedForNode(props.node)
  const expanded = () => cardExpanded(props.node.id, props.node.status, defaultExpanded())
  const align = () => bubbleAlign(props.node)
  const normalizedRole = () => normalizeAgentRole(props.node.role || props.node.stage || "")
  const roleTitle = () => roleLabel(normalizedRole())
  const badge = () => statusBadge(props.node)
  const visibleChildIDs = createMemo(() => visibleChildIDsForCard(props.node))

  const collapsible = () => !(props.node.kind === "message" && normalizedRole() === "user")
  const collapsedActive = () => !expanded() && collapsible()
  const collapsedPreview = () =>
    collapsedActive()
      ? collapsedPreviewText(collectLatestActivityText(props.node), props.node.title)
      : ""
  const todoSummary = () => (collapsedActive() ? collectTodoSummary(props.node) : null)
  const todoProgressPct = () => {
    const summary = todoSummary()
    if (!summary || summary.total === 0) return 0
    return Math.round((summary.completed / summary.total) * 100)
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
    if (!expanded()) return null
    const counts = collectActivityCounts(props.node)
    if ((counts.messages + counts.tools + counts.agents + counts.skills) === 0) return null
    return counts
  })

  const traceSessionID = createMemo(() =>
    props.node.kind === "agent" ? sessionIDFromCardID(props.node.id) : undefined,
  )
  const directAgentSessionID = createMemo(() => {
    if (props.node.kind !== "agent") return undefined
    const sessionID = traceSessionID()
    if (!sessionID || sessionID === rootTaskSessionID()) return undefined
    return sessionID
  })

  const expand = () => {
    if (!collapsible() || expanded()) return
    setCardExpanded(props.node.id, true, props.node.status)
  }
  const collapse = () => {
    if (!collapsible() || !expanded()) return
    setCardExpanded(props.node.id, false, props.node.status)
  }

  const onTraceToggle = () => {
    if (!traceSessionID()) return
    if (!expanded()) setCardExpanded(props.node.id, true, props.node.status)
    setTraceOpen((value) => !value)
  }

  const onRewind = async (cursorTime: number, anchorID: string, opts: { resetWorktree: boolean }) => {
    const taskID = boardStore.selectedTaskID
    if (!taskID) return
    pruneCardsAfterCursor(cursorTime)
    try {
      const response = await apiRequest<unknown>(
        `task/${encodeURIComponent(taskID)}/rewind`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            anchor: { kind: "cursorTime", cursorTime, anchorEventID: anchorID },
            resetWorktree: opts.resetWorktree,
            reason: "user rewind card",
          }),
          responseKind: "text",
        },
      )
      if (!response.ok) {
        console.error("rewind request failed", response.status, response.body)
      }
    } catch (error) {
      console.error("rewind request errored", error)
    }
  }

  const onAgentReply = async (sessionID: string, message: string) => {
    const taskID = boardStore.selectedTaskID
    if (!taskID) return
    await replyToAgentSession(taskID, sessionID, message)
  }

  const onAgentCancel = async (sessionID: string) => {
    const taskID = boardStore.selectedTaskID
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
    const stickyWidth = stickyInlineSize()
    if (stickyWidth) style["--card-sticky-inline-size"] = `${stickyWidth}px`
    return Object.keys(style).length > 0 ? style : undefined
  })

  createEffect(() => {
    const article = articleRef
    if (!article) return

    let frame = 0
    const updateStickyInlineSize = () => {
      frame = 0
      const nextWidth = Math.ceil(article.getBoundingClientRect().width)
      if (!Number.isFinite(nextWidth) || nextWidth <= 0) return
      setStickyInlineSize((current) =>
        typeof current === "number" && current >= nextWidth ? current : nextWidth,
      )
    }

    const observer = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updateStickyInlineSize)
    })

    observer.observe(article)
    updateStickyInlineSize()

    onCleanup(() => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    })
  })

  const canBubbleSurfaceCollapse = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    if (!target || !articleRef) return false
    if (target.closest(".chat-bubble-row") !== articleRef) return false
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
        "[data-card-dblclick-ignore='true']",
      ].join(","),
    )
    return interactive == null
  }

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
        if (!canBubbleSurfaceCollapse(event)) return
        event.stopPropagation()
        collapse()
      }}
    >
      <div class="chat-bubble-shell" data-align={align()}>
        <div class="chat-bubble__avatar-slot">
          <Avatar role={normalizedRole()} status={props.node.status} />
        </div>
        <div class="chat-bubble__column">
          <Show when={align() === "left"}>
            <div
              class="chat-bubble__head"
              role={collapsible() ? "button" : undefined}
              tabindex={collapsible() ? 0 : undefined}
              aria-expanded={collapsible() ? expanded() : undefined}
              onClick={() => {
                if (!collapsible() || expanded()) return
                expand()
              }}
              onKeyDown={(event) => {
                if (!collapsible() || expanded()) return
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  expand()
                }
              }}
            >
              <div class="chat-bubble__title-row">
                <Show
                  when={props.node.status === "running"}
                  fallback={
                    <Show when={badge().tone !== "neutral"}>
                      <span class={`card__badge card__badge--${badge().tone}`} title={props.node.status || ""}>
                        {badge().glyph}
                      </span>
                    </Show>
                  }
                >
                  <span class="card__badge card__badge--running" title="running">
                    <span class="card__spinner" />
                  </span>
                </Show>
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
                <span class="chat-bubble__title-spacer" aria-hidden="true" />
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
                      ~{formatTokenCount(props.node.contextTokens as number)} tok{props.node.contextTokensEstimated ? " · est." : ""}
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
                  <Show when={headActions.caps.canCopy()}>
                    <button
                      type="button"
                      class="card__copy"
                      classList={{ "card__copy--done": headActions.state.copied() }}
                      title={headActions.state.copied() ? headActions.labels.copied() : headActions.labels.copy()}
                      aria-label={headActions.state.copied() ? headActions.labels.copied() : headActions.labels.copy()}
                      onClick={headActions.onCopy}
                    >
                      <Show when={headActions.state.copied()} fallback={<Icon name="copy" size={13} />}>
                        <Icon name="check" size={13} />
                      </Show>
                    </button>
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
                <div class="chat-bubble__preview-row">
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
          </Show>

          <div class="chat-bubble" data-align={align()} data-stage={normalizedRole()} data-status={props.node.status || "none"}>
            <Show when={expanded()}>
              <div class="chat-bubble__body">
                <Show when={traceOpen() && traceSessionID()}>
                  <TracePanel sessionID={traceSessionID()!} onClose={() => setTraceOpen(false)} />
                </Show>
                <div class="chat-bubble__body-inner">
                  <Show when={props.node.parts.length > 0}>
                    <CardParts parts={props.node.parts} depth={props.depth} />
                  </Show>
                  <Show when={props.node.integrity}>
                    <IntegrityBody integrity={props.node.integrity!} />
                  </Show>
                  <Show when={visibleChildIDs().length > 0}>
                    <div class="chat-bubble__children">
                      <For each={visibleChildIDs()}>
                        {(childID) => {
                          const child = cardTreeStore.cards[childID]!
                          if (child.kind === "message") {
                            return <CardParts parts={child.parts} depth={props.depth + 1} />
                          }
                          if (child.kind === "agent" && child.integrity) {
                            return <IntegrityBody integrity={child.integrity} />
                          }
                          if (child.kind === "integrity" && child.integrity) {
                            return <IntegrityBody integrity={child.integrity} />
                          }
                          throw new Error(`ChatBubble: unsupported child kind "${child.kind}" for ${props.node.id}`)
                        }}
                      </For>
                    </div>
                  </Show>
                  <Show when={directAgentSessionID()}>
                    <AgentSessionReplyBox
                      onSend={(message) => onAgentReply(directAgentSessionID()!, message)}
                    />
                  </Show>
                </div>
              </div>
            </Show>
          </div>

          <div class="chat-bubble__foot">
            <span class="chat-bubble__stamp" title={fullStampWithRelative(props.node.time)}>
              {stamp(props.node.time)}
            </span>
            <Show when={footActivity()}>
              {(counts) => (
                <>
                  <Show when={counts().tools > 0}>
                    <span class="card__stat" data-kind="tools" title={t("card.activity.tools", { count: counts().tools })}>
                      <span class="card__stat-label">{t("card.activity.tools_short")}</span>
                      <span class="card__stat-value">{counts().tools}</span>
                    </span>
                  </Show>
                  <Show when={counts().messages > 0}>
                    <span class="card__stat" data-kind="messages" title={t("card.activity.messages", { count: counts().messages })}>
                      <span class="card__stat-label">{t("card.activity.messages_short")}</span>
                      <span class="card__stat-value">{counts().messages}</span>
                    </span>
                  </Show>
                  <Show when={counts().agents > 0}>
                    <span class="card__stat" data-kind="agents" title={t("card.activity.agents", { count: counts().agents })}>
                      <span class="card__stat-label">{t("card.activity.agents_short")}</span>
                      <span class="card__stat-value">{counts().agents}</span>
                    </span>
                  </Show>
                  <Show when={counts().skills > 0}>
                    <span class="card__stat" data-kind="skills" title={t("card.activity.skills", { count: counts().skills })}>
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
