import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { CardNode } from "../store/card-tree"
import { cardTreeStore, pruneCardsAfterCursor } from "../store/card-tree"
import {
  buildPhaseChildForStep,
  collectActivityCounts,
  defaultExpandedForNode,
  stepHeaderNodeWithBuildPhase,
  visibleChildIDsForCard,
} from "../utils/card-tree"
import { cardExpanded, setCardExpanded } from "../store/conversation-ui"
import { boardStore, rootTaskSessionID, activeTaskID } from "../store/board"
import { loadConversationSessionHistory } from "../services/conversation"
import { cancelAgentSession, replyToAgentSession } from "../services/task"
import { apiRequest } from "../services/api"
import { normalizeAgentRole } from "../utils/message"
import { AgentSessionReplyBox } from "./AgentSessionReplyBox"
import { CardHeader } from "./CardHeader"
import { CardParts } from "./CardParts"
import { InlineToolPart } from "./InlineToolPart"
import { StaticTextPart } from "./TextPart"
import { StepPayloadBody } from "./StepPayloadBody"
import { IntegrityBody } from "./IntegrityCard"
import { ReviewStreamSection } from "./ReviewStreamSection"
import { TracePanel } from "./TracePanel"
import { t } from "../utils/i18n"
import { StoreCardNode } from "./StoreCardNode"
import { createAnimationFrameScheduler } from "../utils/animation-frame"

const inFlightBuildHistorySessions = new Set<string>()

/**
 * Recursive structured-card primitive for non-bubble conversation items.
 * Conversation.tsx routes top-level `message` / `agent` nodes into
 * <ChatBubble/>; this component retains the step / phase / tool /
 * integrity surfaces plus nested transient tool cards.
 *
 * Folding state lives in the unified `expandedCards` store. The
 * (status, statusAtSet) stale-override protocol is preserved: when
 * `node.status` transitions, any manual override is silently discarded
 * and the default expansion policy resumes.
 */
export function Card(props: { node: CardNode; depth: number }) {
  let articleRef: HTMLElement | undefined
  const defaultExpanded = () => defaultExpandedForNode(props.node)
  const [stickyInlineSize, setStickyInlineSize] = createSignal<number | undefined>()

  const isStageCard = () => props.node.kind === "phase" || props.node.kind === "step"

  const expanded = () => cardExpanded(props.node.id, props.node.status, defaultExpanded())

  const promotedBuildPhase = createMemo(() => buildPhaseChildForStep(props.node))
  const headerNode = createMemo(() => stepHeaderNodeWithBuildPhase(props.node))
  const visibleChildIDs = createMemo(() => visibleChildIDsForCard(props.node))
  const buildHistorySessionID = createMemo(() => {
    if (props.node.kind === "phase" && props.node.phaseID === "build") {
      return props.node.phaseSessionID
    }
    if (props.node.kind !== "step") return undefined
    return promotedBuildPhase()?.phaseSessionID || props.node.stepPayload?.buildSessionID
  })

  // Foot stats are collapsed-only. Expanded stage cards render their actual
  // body and children, so a recursive descendant scan here would only add
  // per-delta work on the streaming hot path.
  const footActivity = createMemo(() => {
    if (!isStageCard() || props.node.kind === "tool") return null
    if (expanded()) return null
    if (props.node.status === "running") return null
    const counts = collectActivityCounts(props.node)
    if (counts.messages + counts.tools + counts.agents + counts.skills === 0) return null
    return counts
  })

  const shouldLockInlineSize = () => props.node.kind === "tool" && expanded()

  const collapsible = () => true

  const setExpanded = (value: boolean) => {
    if (!collapsible()) return
    setCardExpanded(props.node.id, value, props.node.status)
  }

  const toggleExpanded = () => {
    setExpanded(!expanded())
  }

  const canCardSurfaceToggle = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    if (!target || !articleRef) return false
    if (target.closest(".card") !== articleRef) return false
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

  const traceSessionID = createMemo(() =>
    props.node.kind === "phase"
      ? props.node.phaseSessionID
      : props.node.kind === "step"
        ? promotedBuildPhase()?.phaseSessionID
        : undefined,
  )
  const directAgentSessionID = createMemo(() => {
    let sessionID: string | undefined
    if (props.node.kind === "phase") {
      sessionID = props.node.phaseSessionID
    } else if (props.node.kind === "step") {
      const phase = promotedBuildPhase()
      sessionID = phase?.phaseSessionID
    }
    if (!sessionID) return undefined
    if (sessionID === rootTaskSessionID()) return undefined
    return sessionID
  })
  const [traceOpen, setTraceOpen] = createSignal(false)
  const onTraceToggle = () => {
    if (!traceSessionID()) return
    // Auto-expand the card when opening the trace panel — collapsed cards
    // hide their body, which is where the panel renders.
    if (!expanded()) setExpanded(true)
    setTraceOpen((v) => !v)
  }

  /**
   * Rewind handler — issues POST /task/:id/rewind and immediately prunes
   * the local card tree so the UI reflects the rollback without waiting
   * for the server's task.rewound SSE event to arrive. The backend also
   * emits that event so any other subscribers (sidebars, peers) stay in
   * sync. No full-refresh — we walk the store incrementally.
   */
  const onRewind = async (cursorTime: number, anchorID: string, opts: { resetWorktree: boolean }) => {
    const taskID = activeTaskID()
    if (!taskID) return
    // Optimistic local prune — user feels instant feedback. If the HTTP
    // call fails the cards are gone until selected-task recovery reloads, which is
    // acceptable (worst case: user reloads). We avoid a full-refresh
    // because that was the source of the "user message → overlay 卡顿"
    // symptom the operator flagged.
    pruneCardsAfterCursor(cursorTime)
    // Pre-M3 this called fetch() with a relative URL (`/task/...`) which
    // worked under "/ui" but not under any other origin (e.g. Tauri).
    // Routing through apiRequest() also gives us the VS Code webview
    // path for free in M4.
    try {
      const resp = await apiRequest<unknown>(`task/${encodeURIComponent(taskID)}/rewind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anchor: { kind: "cursorTime", cursorTime, anchorEventID: anchorID },
          resetWorktree: opts.resetWorktree,
          reason: "user rewind card",
        }),
        responseKind: "text",
      })
      if (!resp.ok) {
        console.error("rewind request failed", resp.status, resp.body)
      }
    } catch (err) {
      console.error("rewind request errored", err)
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

  const toolCancelSessionID = () => {
    const part = toolPart()
    const sessionID = typeof part?.sessionID === "string" ? part.sessionID.trim() : ""
    if (!sessionID || sessionID === rootTaskSessionID()) return undefined
    return sessionID
  }

  // Tool-kind nodes render their body via InlineToolPart(mode="body"),
  // not via CardParts — header already summarises the tool call.
  const isTool = () => props.node.kind === "tool"
  const toolPart = () => props.node.toolPart
  const bodyParts = createMemo(() => {
    return visibleBodyParts(props.node)
  })
  const promotedBuildParts = createMemo(() => {
    const phase = promotedBuildPhase()
    return phase ? visibleBodyParts(phase) : []
  })

  function visibleBodyParts(node: CardNode): any[] {
    const parts = node.parts ?? []
    if (node.kind !== "phase" || parts.length === 0) return parts
    const phaseRole = node.phaseSessionKind || node.stage || ""
    const first = parts[0]
    if (!phaseRole || first?.type !== "boundary") return parts
    return normalizeAgentRole(String(first.role || "")) === normalizeAgentRole(phaseRole) ? parts.slice(1) : parts
  }

  const articleStyle = createMemo<Record<string, string> | undefined>(() => {
    const style: Record<string, string> = {}
    if (props.node.accent) style["--card-stage"] = props.node.accent
    const stickyWidth = stickyInlineSize()
    if (stickyWidth && shouldLockInlineSize()) {
      style["--card-sticky-inline-size"] = `${stickyWidth}px`
    }
    return Object.keys(style).length > 0 ? style : undefined
  })

  createEffect(() => {
    const article = articleRef
    if (!article || !shouldLockInlineSize()) return

    const updateStickyInlineSize = () => {
      const nextWidth = Math.ceil(article.getBoundingClientRect().width)
      if (!Number.isFinite(nextWidth) || nextWidth <= 0) return
      setStickyInlineSize((current) => (typeof current === "number" && current >= nextWidth ? current : nextWidth))
    }

    const updateStickyInlineSizeOnFrame = createAnimationFrameScheduler(updateStickyInlineSize)
    const observer = new ResizeObserver(updateStickyInlineSizeOnFrame.schedule)

    observer.observe(article)
    updateStickyInlineSize()

    onCleanup(() => {
      observer.disconnect()
      updateStickyInlineSizeOnFrame.cancel()
    })
  })

  createEffect(() => {
    if (!expanded()) return
    const sessionID = String(buildHistorySessionID() || "")
    const taskID = activeTaskID()
    if (!sessionID || !taskID) return
    const phase = props.node.kind === "phase" ? props.node : promotedBuildPhase()
    if ((phase?.parts?.length || 0) > 0) return
    const key = `${taskID}:${sessionID}`
    if (inFlightBuildHistorySessions.has(key)) return
    inFlightBuildHistorySessions.add(key)
    void loadConversationSessionHistory(sessionID, taskID)
      .catch((error) => {
        console.warn("[conversation] build session history hydrate failed", error)
      })
      .finally(() => {
        inFlightBuildHistorySessions.delete(key)
      })
  })

  return (
    <article
      ref={articleRef}
      class="card"
      data-card-id={props.node.id}
      data-kind={props.node.kind}
      data-role={props.node.role || undefined}
      data-stage={props.node.stage || undefined}
      data-status={props.node.status || "none"}
      data-depth={props.depth}
      style={articleStyle()}
      classList={{ "card--expanded": expanded(), "card--collapsed": !expanded() }}
      onDblClick={(event) => {
        if (!canCardSurfaceToggle(event)) return
        event.stopPropagation()
        toggleExpanded()
      }}
    >
      <CardHeader
        node={headerNode()}
        expanded={expanded()}
        collapsible={collapsible()}
        onToggle={toggleExpanded}
        onRewind={onRewind}
        traceSessionID={traceSessionID()}
        traceOpen={traceOpen()}
        onTrace={traceSessionID() ? onTraceToggle : undefined}
        agentSessionID={directAgentSessionID() ?? toolCancelSessionID()}
        onAgentCancel={(directAgentSessionID() ?? toolCancelSessionID()) ? onAgentCancel : undefined}
        onAgentModelSettings={undefined}
      />
      <Show when={expanded()}>
        <div class="card__body">
          <Show when={traceOpen() && traceSessionID()}>
            <TracePanel sessionID={traceSessionID()!} onClose={() => setTraceOpen(false)} />
          </Show>
          <Show when={props.node.kind === "step" && props.node.goalDescription}>
            <section class="card__goal-desc" aria-label={t("goal.field.objective")}>
              <div class="card__goal-desc-label">{t("goal.field.objective")}</div>
              <div class="card__goal-desc-text">
                <StaticTextPart text={props.node.goalDescription!} />
              </div>
            </section>
          </Show>

          {/* Tool card body: delegate to InlineToolPart body mode */}
          <Show when={isTool() && toolPart()}>
            <InlineToolPart part={toolPart()} mode="body" />
          </Show>

          {/* Step payload: plan nodes / evaluation checks / verdict. */}
          <Show when={props.node.kind === "step" && props.node.stepPayload && props.node.stepID}>
            <StepPayloadBody payload={props.node.stepPayload} stepID={props.node.stepID!} />
          </Show>

          {/* Integrity verdict: renders the parsed IntegrityResult (verdict
              badge + summary + per-dimension pills + issues list +
              corrections diff) on the integrity agent card while still
              preserving the underlying reasoning/tool parts. */}
          <Show when={props.node.integrity}>
            <IntegrityBody integrity={props.node.integrity!} />
          </Show>
          <Show when={props.node.reviewStream}>
            <ReviewStreamSection reviewStream={props.node.reviewStream!} />
          </Show>

          {/* Generic parts */}
          <Show when={!isTool() && bodyParts().length > 0}>
            <CardParts parts={bodyParts()} depth={props.depth} streaming={props.node.status === "running"} />
          </Show>

          {/* Recursive children.
              Store-backed cards use `childIDs` — the renderer dereferences
              each id through the `cardTreeStore.cards` proxy so targeted
              writes to a single descendant don't re-run any intermediate
              memo. Transient cards (tool promotion in CardParts) still
              carry inline `children`; when both are set `childIDs` wins. */}
          <Show
            when={visibleChildIDs().length > 0}
            fallback={
              <Show when={(props.node.children?.length ?? 0) > 0}>
                <div class="card__children">
                  <For each={props.node.children}>{(child) => <Card node={child} depth={props.depth + 1} />}</For>
                </div>
              </Show>
            }
          >
            <div class="card__children">
              <For each={visibleChildIDs()}>
                {(id) => (
                  <StoreCardNode id={id} ownerID={props.node.id}>
                    {(node) => <Card node={node} depth={props.depth + 1} />}
                  </StoreCardNode>
                )}
              </For>
            </div>
          </Show>

          <Show when={promotedBuildParts().length > 0}>
            <CardParts
              parts={promotedBuildParts()}
              depth={props.depth + 1}
              streaming={promotedBuildPhase()?.status === "running"}
            />
          </Show>

          {/* Inline reply box at the END of every direct-replyable agent
              session card. Always visible (no toggle) — replaces the
              previous CardHeader collapsible reply form so the input
              sits where the user expects: directly after the agent's
              latest output. */}
          <Show when={directAgentSessionID()}>
            <AgentSessionReplyBox onSend={(message) => onAgentReply(directAgentSessionID()!, message)} />
          </Show>
        </div>
      </Show>
      <Show when={footActivity()}>
        {(counts) => (
          <div
            class="card__foot"
            title={t("card.activity_summary", {
              messages: counts().messages,
              tools: counts().tools,
              agents: counts().agents,
              skills: counts().skills,
            })}
          >
            <Show when={counts().tools > 0}>
              <span class="card__stat" data-kind="tools" title={t("card.activity.tools", { count: counts().tools })}>
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
          </div>
        )}
      </Show>
    </article>
  )
}
