import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { CardNode } from "../store/card-tree";
import { cardTreeStore, pruneCardsAfterCursor } from "../store/card-tree";
import { defaultExpandedForNode } from "../utils/card-tree";
import { cardExpanded, toggleCard } from "../store/conversation-ui";
import { boardStore, rootTaskSessionID } from "../store/board";
import { cancelAgentSession, replyToAgentSession } from "../services/task";
import { apiRequest } from "../services/api";
import { normalizeAgentRole } from "../utils/message";
import { roleOf } from "../utils/card-color";
import { AgentSessionReplyBox } from "./AgentSessionReplyBox";
import { CardHeader } from "./CardHeader";
import { CardParts } from "./CardParts";
import { InlineToolPart } from "./InlineToolPart";
import { StaticTextPart } from "./TextPart";
import { StepPayloadBody } from "./StepPayloadBody";
import { IntegrityBody } from "./IntegrityCard";
import { TracePanel } from "./TracePanel";
import { t } from "../utils/i18n";

/** Extract the opencorvus sessionID encoded in agent-card ids. The writer
 *  builds them as `<stage>:session:<sid>` (services/tree-writer.ts::sessionCardID),
 *  so any card whose id matches that pattern can surface its session-scoped
 *  AgentTrace events. Returns undefined when the card isn't a session card
 *  (message bubbles, tool promotions, etc). */
function sessionIDFromCardID(id: string): string | undefined {
  const idx = id.indexOf(":session:");
  if (idx < 0) return undefined;
  const sid = id.slice(idx + ":session:".length);
  return sid || undefined;
}

/**
 * Unified recursive card primitive.
 *
 * Every conversation item — whether a goal group, a stage agent card,
 * a promoted tool call, or a plain message bubble — is rendered through
 * this component. Nesting is handled by recursion on `node.children`.
 *
 * Folding state lives in the unified `expandedCards` store. The
 * (status, statusAtSet) stale-override protocol is preserved: when
 * `node.status` transitions, any manual override is silently discarded
 * and the default expansion policy resumes.
 */
export function Card(props: { node: CardNode; depth: number }) {
  let articleRef: HTMLElement | undefined;
  const defaultExpanded = () => defaultExpandedForNode(props.node);
  const [stickyInlineSize, setStickyInlineSize] = createSignal<number | undefined>();

  const isStageCard = () =>
    props.node.kind === "agent" || props.node.kind === "phase" || props.node.kind === "step";

  const expanded = () =>
    cardExpanded(props.node.id, props.node.status, defaultExpanded());

  const shouldLockInlineSize = () =>
    (props.depth === 0 &&
      !(props.node.kind === "message" &&
        (props.node.role === "user" || props.node.role === "system"))) ||
    (props.node.kind === "tool" && expanded());

  const collapsible = () => {
    // User bubbles render as non-foldable bubbles.
    if (props.node.kind === "message" && props.node.role === "user") return false;
    return true;
  };

  const toggle = () => {
    toggleCard(props.node.id, props.node.status, defaultExpanded());
  };

  // Per-card AgentTrace toggle. Only meaningful for session cards (kind="agent")
  // whose id encodes a sessionID. Local signal — no need to persist across
  // reloads; the trace endpoint is cheap and idempotent.
  const traceSessionID = createMemo(() =>
    props.node.kind === "agent" ? sessionIDFromCardID(props.node.id) : undefined,
  );
  const directAgentSessionID = createMemo(() => {
    // kind="agent" cards encode the sessionID in their card id. kind="phase"
    // cards absorb their sub-agent session's parts into themselves and
    // therefore never produce a `kind="agent"` card — but the underlying
    // session still exists in the backend and accepts /reply, so we surface
    // the absorbed sessionID via `phaseSessionID` so the reply box renders
    // on phase cards (build / planner) the same as on standalone agent
    // cards (requirements / architect / design-analyst / delivery / ...).
    const sessionID =
      props.node.kind === "agent"
        ? traceSessionID()
        : props.node.kind === "phase"
          ? props.node.phaseSessionID
          : undefined;
    if (!sessionID) return undefined;
    if (sessionID === rootTaskSessionID()) return undefined;
    return sessionID;
  });
  const [traceOpen, setTraceOpen] = createSignal(false);
  const onTraceToggle = () => {
    if (!traceSessionID()) return;
    // Auto-expand the card when opening the trace panel — collapsed cards
    // hide their body, which is where the panel renders.
    if (!expanded()) toggleCard(props.node.id, props.node.status, defaultExpanded());
    setTraceOpen((v) => !v);
  };

  /**
   * Rewind handler — issues POST /task/:id/rewind and immediately prunes
   * the local card tree so the UI reflects the rollback without waiting
   * for the server's task.rewound SSE event to arrive. The backend also
   * emits that event so any other subscribers (sidebars, peers) stay in
   * sync. No full-refresh — we walk the store incrementally.
   */
  const onRewind = async (cursorTime: number, anchorID: string, opts: { resetWorktree: boolean }) => {
    const taskID = boardStore.selectedTaskID;
    if (!taskID) return;
    // Optimistic local prune — user feels instant feedback. If the HTTP
    // call fails the cards are gone until a syncTask() reload, which is
    // acceptable (worst case: user reloads). We avoid a full-refresh
    // because that was the source of the "user message → overlay 卡顿"
    // symptom the operator flagged.
    pruneCardsAfterCursor(cursorTime);
    // Pre-M3 this called fetch() with a relative URL (`/task/...`) which
    // worked under "/ui" but not under any other origin (e.g. Tauri).
    // Routing through apiRequest() also gives us the VS Code webview
    // path for free in M4.
    try {
      const resp = await apiRequest<unknown>(
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
      );
      if (!resp.ok) {
        console.error("rewind request failed", resp.status, resp.body);
      }
    } catch (err) {
      console.error("rewind request errored", err);
    }
  };

  const onAgentReply = async (sessionID: string, message: string) => {
    const taskID = boardStore.selectedTaskID;
    if (!taskID) return;
    await replyToAgentSession(taskID, sessionID, message);
  };

  const onAgentCancel = async (sessionID: string) => {
    const taskID = boardStore.selectedTaskID;
    if (!taskID) return;
    await cancelAgentSession(taskID, sessionID);
  };

  const toolCancelSessionID = () => {
    const part = toolPart();
    const sessionID = typeof part?.sessionID === "string" ? part.sessionID.trim() : "";
    if (!sessionID || sessionID === rootTaskSessionID()) return undefined;
    return sessionID;
  };

  // Tool-kind nodes render their body via InlineToolPart(mode="body"),
  // not via CardParts — header already summarises the tool call.
  const isTool = () => props.node.kind === "tool";
  const toolPart = () => props.node.toolPart;
  const bodyParts = createMemo(() => {
    const parts = props.node.parts ?? [];
    if (props.node.kind !== "phase" || parts.length === 0) return parts;
    const phaseRole = props.node.phaseSessionKind || props.node.stage || "";
    const first = parts[0];
    if (!phaseRole || first?.type !== "boundary") return parts;
    return normalizeAgentRole(String(first.role || "")) === normalizeAgentRole(phaseRole)
      ? parts.slice(1)
      : parts;
  });

  const articleStyle = createMemo<Record<string, string> | undefined>(() => {
    const style: Record<string, string> = {};
    const stickyWidth = stickyInlineSize();
    if (stickyWidth && shouldLockInlineSize()) {
      style["--card-sticky-inline-size"] = `${stickyWidth}px`;
    }
    return Object.keys(style).length > 0 ? style : undefined;
  });

  createEffect(() => {
    const article = articleRef;
    if (!article || !shouldLockInlineSize()) return;

    let frame = 0;
    const updateStickyInlineSize = () => {
      frame = 0;
      const nextWidth = Math.ceil(article.getBoundingClientRect().width);
      if (!Number.isFinite(nextWidth) || nextWidth <= 0) return;
      setStickyInlineSize((current) =>
        typeof current === "number" && current >= nextWidth ? current : nextWidth,
      );
    };

    const observer = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateStickyInlineSize);
    });

    observer.observe(article);
    updateStickyInlineSize();

    onCleanup(() => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    });
  });

  return (
    <article
      ref={articleRef}
      class="card"
      data-card-id={props.node.id}
      data-kind={props.node.kind}
      data-role={props.node.role || (props.node.stage ? roleOf(props.node.stage) : undefined)}
      data-stage={props.node.stage || undefined}
      data-status={props.node.status || "none"}
      data-depth={props.depth}
      style={articleStyle()}
      classList={{ "card--expanded": expanded(), "card--collapsed": !expanded() }}
    >
      <CardHeader
        node={props.node}
        expanded={expanded()}
        collapsible={collapsible()}
        onToggle={toggle}
        onRewind={onRewind}
        traceSessionID={traceSessionID()}
        traceOpen={traceOpen()}
        onTrace={traceSessionID() ? onTraceToggle : undefined}
        agentSessionID={directAgentSessionID() ?? toolCancelSessionID()}
        onAgentCancel={(directAgentSessionID() ?? toolCancelSessionID()) ? onAgentCancel : undefined}
      />
      <Show when={expanded()}>
        <div class="card__body">
          <Show when={traceOpen() && traceSessionID()}>
            <TracePanel
              sessionID={traceSessionID()!}
              isVisible={() => traceOpen() && expanded()}
              onClose={() => setTraceOpen(false)}
            />
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
            <StepPayloadBody
              payload={props.node.stepPayload}
              stepID={props.node.stepID!}
            />
          </Show>

          {/* Integrity verdict: renders the parsed IntegrityResult (verdict
              badge + summary + per-dimension pills + issues list +
              corrections diff) on the integrity agent card while still
              preserving the underlying reasoning/tool parts. */}
          <Show when={props.node.integrity}>
            <IntegrityBody integrity={props.node.integrity!} />
          </Show>

          {/* Generic parts */}
          <Show when={!isTool() && bodyParts().length > 0}>
            <CardParts parts={bodyParts()} depth={props.depth} />
          </Show>

          {/* Recursive children.
              Store-backed cards use `childIDs` — the renderer dereferences
              each id through the `cardTreeStore.cards` proxy so targeted
              writes to a single descendant don't re-run any intermediate
              memo. Transient cards (tool promotion in CardParts) still
              carry inline `children`; when both are set `childIDs` wins. */}
          <Show
            when={(props.node.childIDs?.length ?? 0) > 0}
            fallback={
              <Show when={(props.node.children?.length ?? 0) > 0}>
                <div class="card__children">
                  <For each={props.node.children}>
                    {(child) => <Card node={child} depth={props.depth + 1} />}
                  </For>
                </div>
              </Show>
            }
          >
            <div class="card__children">
              <For each={props.node.childIDs}>
                {(id) => (
                  <Show when={cardTreeStore.cards[id]}>
                    <Card node={cardTreeStore.cards[id]!} depth={props.depth + 1} />
                  </Show>
                )}
              </For>
            </div>
          </Show>

          {/* Inline reply box at the END of every direct-replyable agent
              session card. Always visible (no toggle) — replaces the
              previous CardHeader collapsible reply form so the input
              sits where the user expects: directly after the agent's
              latest output. */}
          <Show when={directAgentSessionID()}>
            <AgentSessionReplyBox
              onSend={(message) => onAgentReply(directAgentSessionID()!, message)}
            />
          </Show>

          <Show when={collapsible() && isStageCard()}>
            <div class="card__body-actions">
              <button
                type="button"
                class="card__collapse-toggle"
                onClick={toggle}
                title={t("card.collapse_title")}
                aria-label={t("card.collapse_title")}
              >
                <span class="card__collapse-toggle-icon" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
                <span class="card__collapse-toggle-label">{t("card.collapse")}</span>
              </button>
            </div>
          </Show>
        </div>
      </Show>
    </article>
  );
}
