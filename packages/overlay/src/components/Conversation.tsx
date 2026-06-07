import { ErrorBoundary, Show, createMemo, onMount, onCleanup, createSignal, createEffect, on } from "solid-js";
import { Virtualizer, type CustomContainerComponentProps, type VirtualizerHandle } from "virtua/solid";
import { Card } from "./Card";
import { ChatBubble } from "./ChatBubble";
import { TaskProgressBar } from "./TaskProgressBar";
import { cardTreeStore } from "../store/card-tree";
import { boardStore,
  activeTaskID,
} from "../store/board";
import { t } from "../utils/i18n";
import { renderAsBubble } from "../utils/chat-bubble";
import { setupAutoScroll, type AutoScrollController } from "../utils/dom-utils";
import { StoreCardNode } from "./StoreCardNode";
import { canLoadOlderConversationHistory, loadOlderConversationHistory } from "../services/conversation";
import { conversationAgentStore } from "../store/conversation-agents";
import { listenConversationCardScroll, type ConversationCardScrollRequest } from "../services/conversation-scroll";
import { createAnimationFrameScheduler } from "../utils/animation-frame";

const VIRTUAL_OVERSCAN_ITEMS = 16;
const ESTIMATED_CARD_HEIGHT = 132;
const CARD_SCROLL_TARGET_MAX_FRAMES = 12;

function clipText(value: string, limit = 96): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function compactPath(value: string): string {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 4) return normalized;
  return `.../${parts.slice(-3).join("/")}`;
}

function taskStatusLabel(status: string): string {
  const normalized = String(status || "idle").trim() || "idle";
  const key = `task.status.${normalized}`;
  const translated = t(key);
  return translated === key ? normalized : translated;
}

function firstVisibleConversationAnchor(container: HTMLElement): { id: string; top: number } | null {
  const containerTop = container.getBoundingClientRect().top;
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(".conversation-virtual-item > [data-card-id]"));
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (rect.bottom <= containerTop) continue;
    const id = node.dataset.cardId || "";
    if (!id) continue;
    return { id, top: rect.top };
  }
  return null;
}

function restoreConversationAnchor(container: HTMLElement, anchor: { id: string; top: number } | null): void {
  if (!anchor) return;
  const node = container.querySelector<HTMLElement>(`.conversation-virtual-item > [data-card-id="${CSS.escape(anchor.id)}"]`);
  if (!node) return;
  container.scrollTop += node.getBoundingClientRect().top - anchor.top;
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function renderErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  return String(error || "Unknown render error")
}

function ConversationCardRenderFailure(props: { id: string; error: unknown }) {
  const message = () => clipText(renderErrorMessage(props.error), 180)
  return (
    <article
      class="card conversation-card-render-failure"
      data-card-id={props.id}
      data-kind="render-error"
      role="group"
      aria-label="Card render failed"
    >
      <div class="card__head">
        <div class="card__title">Card render failed</div>
        <div class="card__meta">{clipText(props.id, 64)}</div>
      </div>
      <div class="card__body">
        <div class="msg-tool-error">{message()}</div>
      </div>
    </article>
  )
}

function VirtualizedConversationItem(props: {
  id: string;
}) {
  return (
    <div class="conversation-virtual-item" data-virtual-card-id={props.id}>
      <ErrorBoundary fallback={(error) => <ConversationCardRenderFailure id={props.id} error={error} />}>
        <StoreCardNode id={props.id}>
          {(node) =>
            renderAsBubble(node)
              ? <ChatBubble node={node} depth={0} />
              : <Card node={node} depth={0} />
          }
        </StoreCardNode>
      </ErrorBoundary>
    </div>
  );
}

function VirtualizedConversationCards(props: {
  container: HTMLElement;
  pinnedCardID: () => string | null;
  onMeasuredContentChanged: () => void;
  onCardScrollRequest: () => void;
}) {
  let virtualizer: VirtualizerHandle | undefined;
  let rootEl: HTMLDivElement | undefined;
  const [scrollPinID, setScrollPinID] = createSignal<string | null>(null);

  const order = createMemo(() => cardTreeStore.order.slice());
  const activePinID = createMemo(() => props.pinnedCardID() || scrollPinID());

  const topLevelIDForCard = (cardID: string): string | undefined => {
    const ids = order();
    if (ids.includes(cardID)) return cardID;
    let current = cardID;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const parent = Object.values(cardTreeStore.cards).find((card) => card.childIDs?.includes(current));
      if (!parent) return undefined;
      if (ids.includes(parent.id)) return parent.id;
      current = parent.id;
    }
    return undefined;
  };

  const pinnedIndexes = createMemo(() => {
    const pinID = activePinID();
    if (!pinID) return [];
    const ids = order();
    const topLevelID = topLevelIDForCard(pinID);
    const pinnedIndex = topLevelID ? ids.indexOf(topLevelID) : -1;
    return pinnedIndex >= 0 ? [pinnedIndex] : [];
  });

  const scrollTargetElement = (request: ConversationCardScrollRequest): HTMLElement | null => {
    const escaped = CSS.escape(request.cardID);
    const card = props.container.querySelector<HTMLElement>(`[data-card-id="${escaped}"]`);
    if (!card || request.focus !== "header") return card;
    return card.querySelector<HTMLElement>(
      ":scope > .chat-bubble-shell > .chat-bubble > .chat-bubble__head, :scope > .card__head",
    ) || card;
  };

  const waitForScrollTargetElement = async (request: ConversationCardScrollRequest): Promise<HTMLElement | null> => {
    for (let frame = 0; frame < CARD_SCROLL_TARGET_MAX_FRAMES; frame += 1) {
      const target = scrollTargetElement(request);
      if (target) return target;
      await waitForAnimationFrame();
    }
    return scrollTargetElement(request);
  };

  const highlightCard = (cardID: string) => {
    const target = props.container.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(cardID)}"]`);
    if (!target) return;
    target.classList.add("conversation-agent-target--pulse");
    window.setTimeout(() => target.classList.remove("conversation-agent-target--pulse"), 1400);
  };

  const scrollCardIntoView = async (request: ConversationCardScrollRequest): Promise<boolean> => {
    if (!virtualizer) return false;
    const topLevelID = topLevelIDForCard(request.cardID);
    if (!topLevelID) return false;
    const index = order().indexOf(topLevelID);
    if (index < 0) return false;
    props.onCardScrollRequest();
    setScrollPinID(topLevelID);
    virtualizer.scrollToIndex(index, { align: request.block ?? "start" });
    const target = await waitForScrollTargetElement(request);
    if (!target) {
      setScrollPinID(null);
      return false;
    }
    target.scrollIntoView({
      behavior: request.behavior ?? "smooth",
      block: request.block ?? "start",
      inline: "nearest",
    });
    if (request.highlight) highlightCard(request.cardID);
    window.setTimeout(() => setScrollPinID(null), 600);
    return true;
  };

  const VirtualWindowShell = (shellProps: CustomContainerComponentProps) => {
    const setRef = (node: HTMLDivElement) => {
      rootEl = node;
      if (typeof shellProps.ref === "function") shellProps.ref(node);
    };
    return (
      <div
        ref={setRef}
        class="conversation-virtual-window"
        data-count={order().length}
        style={shellProps.style}
      >
        {shellProps.children}
      </div>
    );
  };

  onMount(() => {
    const measuredContentChangedOnFrame = createAnimationFrameScheduler(props.onMeasuredContentChanged);
    const ro = new ResizeObserver(measuredContentChangedOnFrame.schedule);
    ro.observe(props.container);
    queueMicrotask(() => {
      if (rootEl) ro.observe(rootEl);
    });
    const stopCardScrollListener = listenConversationCardScroll(scrollCardIntoView);
    const onLayoutShiftSignal = () => {
      measuredContentChangedOnFrame.schedule();
    };
    props.container.addEventListener("click", onLayoutShiftSignal, { passive: true });
    props.container.addEventListener("transitionend", onLayoutShiftSignal, true);
    onCleanup(() => {
      props.container.removeEventListener("click", onLayoutShiftSignal);
      props.container.removeEventListener("transitionend", onLayoutShiftSignal, true);
      ro.disconnect();
      measuredContentChangedOnFrame.cancel();
      stopCardScrollListener();
    });
  });

  return (
    <Virtualizer
      ref={(handle) => { virtualizer = handle; }}
      data={order()}
      scrollRef={props.container}
      overscan={VIRTUAL_OVERSCAN_ITEMS}
      itemSize={ESTIMATED_CARD_HEIGHT}
      keepMounted={pinnedIndexes()}
      as={VirtualWindowShell}
    >
      {(id) => <VirtualizedConversationItem id={id} />}
    </Virtualizer>
  );
}

// ── Conversation Component ──
//
// Reads directly from `cardTreeStore`, the single reactive source of truth
// maintained by `services/tree-writer.ts`. Each top-level card id in
// `cardTreeStore.order` resolves to a CardNode via `cardTreeStore.cards[id]`;
// `<Card>` then walks the card's `childIDs` via the same proxy dereference,
// so targeted writes to any descendant update only that branch of the DOM.
// See specs/new-arch/07-panel-reactivity.md for the design rationale.

export function Conversation(props: { container: HTMLElement }) {
  const el = props.container;
  let scrollController: AutoScrollController | undefined;
  let historyLoadInFlight = false;
  let historyIntentUntil = 0;
  let touchStartY: number | null = null;

  const hasItems = () => cardTreeStore.order.length > 0;

  const [tracking, setTracking] = createSignal(true);
  const [historyAnchorPinID, setHistoryAnchorPinID] = createSignal<string | null>(null);
  const isSessionSource = () => boardStore.selectedSource?.kind === "session";
  const sessionBoard = () => (isSessionSource() ? (boardStore.board as any) : null);
  const currentTaskID = () => isSessionSource() ? "" : String(activeTaskID() || boardStore.board?.task?.id || "");
  const taskContextItem = () => {
    if (isSessionSource()) return null;
    const taskID = currentTaskID();
    const tasks = [...boardStore.tasks, ...boardStore.pendingTasks];
    if (taskID) {
      return tasks.find((item: any) => item?.task?.id === taskID || item?.id === taskID) || null;
    }
    return tasks[0] || null;
  };
  const taskContextID = () => {
    const item = taskContextItem();
    return currentTaskID() || String(item?.task?.id || item?.id || "");
  };
  const selectedTaskItem = () => {
    const taskID = currentTaskID();
    if (!taskID) return null;
    return (
      boardStore.tasks.find((item: any) => item?.task?.id === taskID)
      || boardStore.pendingTasks.find((item: any) => item?.task?.id === taskID || item?.id === taskID)
      || null
    );
  };
  const selectedBoardTask = () => boardStore.board?.task ?? null;
  const selectedTaskTitle = () => {
    if (isSessionSource()) {
      return clipText(sessionBoard()?.title || boardStore.selectedSource?.id || "");
    }
    const item = selectedTaskItem() || taskContextItem();
    return clipText(
      item?.task?.title
      || item?.overview?.headline
      || selectedBoardTask()?.title
      || currentTaskID(),
    );
  };
  const selectedTaskStatus = () => {
    if (isSessionSource()) return String(sessionBoard()?.status || "active");
    const item = selectedTaskItem() || taskContextItem();
    if (item?._pending) return "active";
    return String(item?.task?.status || selectedBoardTask()?.status || "idle");
  };
  const selectedTaskDirectoryText = () => {
    if (isSessionSource()) return compactPath(sessionBoard()?.directory || "");
    const item = selectedTaskItem() || taskContextItem();
    return compactPath(item?.task?.directory || selectedBoardTask()?.directory || "");
  };

  onMount(() => {
    const c = setupAutoScroll(el, {
      isTracking: tracking,
      onUserScrollUp: () => setTracking(false),
      onAtBottom: () => setTracking(true),
    });
    scrollController = c;
    // Conversation is rendered directly into an existing `.chat-scroll`
    // host (see main.tsx and TaskDetailOverlay). The host remains the
    // single scroll container while `virtua` owns only the virtualized
    // content window inside it.
    const markHistoryIntent = () => {
      historyIntentUntil = Date.now() + 700;
    };
    const hasHistoryIntent = () => Date.now() <= historyIntentUntil;
    const onHistoryWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) markHistoryIntent();
    };
    const onHistoryKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowUp" ||
        event.key === "PageUp" ||
        event.key === "Home"
      ) {
        markHistoryIntent();
      }
    };
    const onHistoryTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? null;
    };
    const onHistoryTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? null;
      if (touchStartY !== null && y !== null && y > touchStartY + 8) {
        markHistoryIntent();
      }
    };
    const onHistoryScroll = () => {
      if (historyLoadInFlight || el.scrollTop > 96 || !hasHistoryIntent()) return;
      const source = boardStore.selectedSource;
      if (!canLoadOlderConversationHistory(source)) return;
      historyIntentUntil = 0;
      historyLoadInFlight = true;
      const anchor = firstVisibleConversationAnchor(el);
      void loadOlderConversationHistory(source)
        .then((loaded) => {
          return new Promise<void>((resolve) => {
            if (loaded && anchor) setHistoryAnchorPinID(anchor.id);
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (loaded) restoreConversationAnchor(el, anchor);
                setHistoryAnchorPinID(null);
                resolve();
              });
            });
          });
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          console.error("[conversation] older history load failed", error);
        })
        .finally(() => {
          historyLoadInFlight = false;
        });
    };
    el.addEventListener("wheel", onHistoryWheel, { passive: true });
    el.addEventListener("keydown", onHistoryKeyDown);
    el.addEventListener("touchstart", onHistoryTouchStart, { passive: true });
    el.addEventListener("touchmove", onHistoryTouchMove, { passive: true });
    el.addEventListener("scroll", onHistoryScroll, { passive: true });
    onCleanup(() => {
      el.removeEventListener("wheel", onHistoryWheel);
      el.removeEventListener("keydown", onHistoryKeyDown);
      el.removeEventListener("touchstart", onHistoryTouchStart);
      el.removeEventListener("touchmove", onHistoryTouchMove);
      el.removeEventListener("scroll", onHistoryScroll);
      c.cleanup();
      scrollController = undefined;
    });
  });

  createEffect(on(
    () => cardTreeStore.treeEpoch,
    () => {
      if (cardTreeStore.treeReplacementScrollIntent === "preserve") {
        scrollController?.contentChanged();
        return;
      }
      setTracking(true);
      scrollController?.scrollToBottom();
    },
    { defer: true },
  ));

  createEffect(on(
    () => cardTreeStore.visibleVersion,
    () => {
      scrollController?.contentChanged();
    },
    { defer: true },
  ));

  createEffect(on(
    () => conversationAgentStore.records.length,
    () => {
      scrollController?.contentChanged();
    },
    { defer: true },
  ));

  const emptyText = () => t("chat.empty");

  return (
    <>
      <TaskProgressBar />
      <Show when={!hasItems() && taskContextID()}>
        <div class="chat-empty chat-empty--task" data-status={selectedTaskStatus()}>
          <div class="chat-empty-marker" aria-hidden="true">
            <svg class="chat-empty-icon" width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect x="7" y="8" width="26" height="20" rx="3.5" stroke="currentColor" stroke-width="1.6" />
              <path d="M13 15h14M13 20h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              <path d="M10 31h20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.72" />
            </svg>
          </div>
          <div class="chat-empty-copy">
            <span class="chat-empty-kicker">{emptyText()}</span>
            <strong class="chat-empty-title">{selectedTaskTitle()}</strong>
            <div class="chat-empty-meta">
              <span class="chat-empty-status" data-status={selectedTaskStatus()}>{taskStatusLabel(selectedTaskStatus())}</span>
              <Show when={selectedTaskDirectoryText()}>
                <span class="chat-empty-path">{selectedTaskDirectoryText()}</span>
              </Show>
            </div>
          </div>
        </div>
      </Show>
      <Show when={!hasItems() && !taskContextID()}>
        <div class="chat-empty">
          <svg class="chat-empty-icon" width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <rect x="4" y="5" width="32" height="22" rx="3.5" stroke="currentColor" stroke-width="1.6"/>
            <path d="M4 27l7-6h22l7 6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            <path d="M13 15h14M13 19.5h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <span class="chat-empty-text">{emptyText()}</span>
        </div>
      </Show>
      <VirtualizedConversationCards
        container={el}
        pinnedCardID={historyAnchorPinID}
        onMeasuredContentChanged={() => scrollController?.contentChanged()}
        onCardScrollRequest={() => setTracking(false)}
      />
    </>
  );
}
