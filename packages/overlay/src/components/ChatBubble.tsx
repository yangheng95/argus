import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js"

import type { CardNode } from "../store/card-tree"
import { rootTaskSessionID, activeTaskID } from "../store/board"
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
import { stageAccent } from "../utils/card-color"
import { fullStampWithRelative, stamp } from "../utils/time"
import { cancelAgentSession, replyToAgentSession, sendTaskOperatorMessage } from "../services/task"
import { submitTaskRewind } from "../services/rewind"
import { currentTraceDirectory } from "../services/trace-directory"
import { t } from "../utils/i18n"
import { AgentSessionReplyBox } from "./AgentSessionReplyBox"
import { Avatar } from "./Avatar"
import { CardDurationChip, CardHeaderChrome } from "./CardHeaderChrome"
import { CardParts } from "./CardParts"
import { CardTodoSummary } from "./CardTodoSummary"
import { IntegrityBody } from "./IntegrityCard"
import { ReviewStreamSection } from "./ReviewStreamSection"
import { storeCardNode } from "./StoreCardNode"
import { TracePanel } from "./TracePanel"
import { Button } from "./ui/Button"

function UnsupportedChatBubbleChild(props: { child: CardNode; parentID: string }): null {
  throw new Error(`ChatBubble: unsupported child kind "${props.child.kind}" for ${props.parentID}`)
}

function ChatBubbleAgentChildBody(props: { child: CardNode; depth: number }) {
  const visibleChildIDs = createMemo(() => visibleChildIDsForCard(props.child))

  return (
    <>
      <Show when={props.child.integrity}>
        <IntegrityBody integrity={props.child.integrity!} />
      </Show>
      <Show when={props.child.reviewStream}>
        <ReviewStreamSection reviewStream={props.child.reviewStream!} />
      </Show>
      <Show when={props.child.parts.length > 0}>
        <CardParts parts={props.child.parts} depth={props.depth + 1} streaming={props.child.status === "running"} />
      </Show>
      <Show when={visibleChildIDs().length > 0}>
        <div class="chat-bubble__children">
          <For each={visibleChildIDs()}>
            {(childID) => <ChatBubbleChild childID={childID} depth={props.depth + 1} parentID={props.child.id} />}
          </For>
        </div>
      </Show>
    </>
  )
}

function ChatBubbleChild(props: { childID: string; depth: number; parentID: string }) {
  const child = () => storeCardNode(props.childID, props.parentID)

  return (
    <div
      class="chat-bubble__child"
      data-card-id={child().id}
      data-kind={child().kind}
      data-stage={child().stage || child().role || ""}
      data-status={child().status || "none"}
      data-depth={props.depth + 1}
    >
      <Switch fallback={<UnsupportedChatBubbleChild child={child()} parentID={props.parentID} />}>
        <Match when={child().kind === "message"}>
          <CardParts parts={child().parts} depth={props.depth + 1} streaming={child().status === "running"} />
        </Match>
        <Match when={child().kind === "integrity" && child().integrity}>
          <IntegrityBody integrity={child().integrity!} />
        </Match>
        <Match when={child().kind === "agent"}>
          <ChatBubbleAgentChildBody child={child()} depth={props.depth} />
        </Match>
      </Switch>
    </div>
  )
}

export function ChatBubble(props: { node: CardNode; depth: number }) {
  let articleRef: HTMLElement | undefined
  const [traceOpen, setTraceOpen] = createSignal(false)

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

  const traceSessionID = createMemo(() => (props.node.kind === "agent" ? props.node.sessionID || undefined : undefined))
  const directAgentSessionID = createMemo(() => {
    if (props.node.kind !== "agent") return undefined
    const sessionID = traceSessionID()
    if (!sessionID || sessionID === rootTaskSessionID()) return undefined
    return sessionID
  })
  const directAgentReplyMode = createMemo<"session" | "task">(() =>
    normalizeAgentRole(props.node.stage || props.node.role || "") === "build" ? "task" : "session",
  )

  const onTraceToggle = () => {
    if (!traceSessionID()) return
    if (!expanded()) setExpanded(true)
    setTraceOpen((value) => !value)
  }

  const onRewind = async (cursorTime: number, anchorID: string, opts: { resetWorktree: boolean }) => {
    const taskID = activeTaskID()
    if (!taskID) return
    await submitTaskRewind({ taskID, cursorTime, anchorID, resetWorktree: opts.resetWorktree })
  }

  const onAgentReply = async (sessionID: string, message: string) => {
    const taskID = activeTaskID()
    if (!taskID) return
    if (directAgentReplyMode() === "task") {
      const context = [
        "Build session steering from overlay.",
        `Target build session: ${sessionID}.`,
        props.node.goalID ? `Target goal: ${props.node.goalID}.` : "",
        "",
        message,
      ]
        .filter((line) => line.length > 0)
        .join("\n")
      await sendTaskOperatorMessage(taskID, context, {
        source: "overlay_build_steer",
        target: {
          kind: "build_session",
          sessionID,
          ...(props.node.goalID ? { goalID: props.node.goalID } : {}),
        },
      })
      return
    }
    await replyToAgentSession(taskID, sessionID, message)
  }

  const onAgentCancel = async (sessionID: string) => {
    const taskID = activeTaskID()
    if (!taskID) return
    await cancelAgentSession(taskID, sessionID)
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
          >
            <div class="chat-bubble__title-row">
              <Button
                type="button"
                variant="ghost"
                size="mini"
                tone="neutral"
                class="chat-bubble__head-main"
                data-ui="chat-bubble-head-main"
                data-align={align()}
                aria-expanded={expanded()}
                onClick={toggleExpanded}
              >
                <span class="chat-bubble__identity" data-align={align()}>
                  <Avatar role={normalizedRole()} status={props.node.status} class="chat-bubble__head-avatar" />
                  <span class="chat-bubble__identity-copy">
                    <span class="chat-bubble__title-line" data-align={align()}>
                      <span class="chat-bubble__title">{roleTitle()}</span>
                      <CardDurationChip node={props.node} />
                    </span>
                  </span>
                </span>
                <Show when={collapsedPreview()}>
                  <span class="card__preview-row">
                    <span class="card__collapsed-preview" title={collapsedPreview()}>
                      {collapsedPreview()}
                    </span>
                  </span>
                </Show>
                <Show when={todoSummary()}>
                  {(summary) => <CardTodoSummary summary={summary()} />}
                </Show>
              </Button>
              <CardHeaderChrome
                node={props.node}
                actionsClass="chat-bubble__actions"
                onRewind={onRewind}
                traceSessionID={traceSessionID()}
                traceOpen={traceOpen()}
                onTrace={traceSessionID() ? onTraceToggle : undefined}
                agentSessionID={directAgentSessionID()}
                onAgentCancel={directAgentSessionID() ? onAgentCancel : undefined}
              />
            </div>
          </div>
          <Show when={expanded()}>
            <div class="chat-bubble__body">
              <Show when={traceOpen() && traceSessionID()}>
                <TracePanel
                  sessionID={traceSessionID()!}
                  directory={currentTraceDirectory()}
                  onClose={() => setTraceOpen(false)}
                />
              </Show>
              <div class="chat-bubble__body-inner">
                <Show when={props.node.parts.length > 0}>
                  <CardParts parts={props.node.parts} depth={props.depth} streaming={props.node.status === "running"} />
                </Show>
                <Show when={props.node.integrity}>
                  <IntegrityBody integrity={props.node.integrity!} />
                </Show>
                <Show when={props.node.reviewStream}>
                  <ReviewStreamSection reviewStream={props.node.reviewStream!} />
                </Show>
                <Show when={visibleChildIDs().length > 0}>
                  <div class="chat-bubble__children">
                    <For each={visibleChildIDs()}>
                      {(childID) => <ChatBubbleChild childID={childID} depth={props.depth} parentID={props.node.id} />}
                    </For>
                  </div>
                </Show>
                <Show when={directAgentSessionID()}>
                  <AgentSessionReplyBox onSend={(message) => onAgentReply(directAgentSessionID()!, message)} />
                </Show>
              </div>
            </div>
          </Show>
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
