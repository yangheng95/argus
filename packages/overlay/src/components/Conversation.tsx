import { For, Index, Show, createMemo, onMount, onCleanup, createSignal, createEffect, on } from "solid-js";
import { Card } from "./Card";
import { ChatBubble } from "./ChatBubble";
import { TaskProgressBar } from "./TaskProgressBar";
import { cardTreeStore } from "../store/card-tree";
import { boardStore } from "../store/board";
import { t } from "../utils/i18n";
import { renderAsBubble } from "../utils/chat-bubble";
import { setupAutoScroll, type AutoScrollController } from "../utils/dom-utils";
import { StoreCardNode } from "./StoreCardNode";
import { canLoadOlderConversationHistory, loadOlderConversationHistory } from "../services/conversation";
import { conversationAgentStore } from "../store/conversation-agents";
import { listenConversationCardScroll, type ConversationCardScrollRequest } from "../services/conversation-scroll";
import { buildVirtualWindowLayout, computeVirtualWindowRange, virtualOffsetForIndex } from "../utils/virtual-window";

const VIRTUAL_OVERSCAN_PX = 1600;
const ESTIMATED_CARD_HEIGHT = 132;
const MIN_MEASURED_CARD_HEIGHT = 24;

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

function measuredBlockHeight(node: HTMLElement): number {
  const rect = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  const marginTop = Number.parseFloat(style.marginTop) || 0;
  const marginBottom = Number.parseFloat(style.marginBottom) || 0;
  return Math.max(MIN_MEASURED_CARD_HEIGHT, Math.ceil(rect.height + marginTop + marginBottom));
}

function VirtualizedConversationItem(props: {
  id: string;
  onMeasure: (id: string, node: HTMLElement) => void;
}) {
  let itemEl: HTMLDivElement | undefined;

  const measure = () => {
    if (!itemEl) return;
    props.onMeasure(props.id, itemEl);
  };

  onMount(() => {
    queueMicrotask(measure);
    const ro = new ResizeObserver(measure);
    if (itemEl) ro.observe(itemEl);
    onCleanup(() => ro.disconnect());
  });

  return (
    <div ref={itemEl} class="conversation-virtual-item" data-virtual-card-id={props.id}>
      <StoreCardNode id={props.id}>
        {(node) =>
          renderAsBubble(node)
            ? <ChatBubble node={node} depth={0} />
            : <Card node={node} depth={0} />
        }
      </StoreCardNode>
    </div>
  );
}

function VirtualizedConversationCards(props: {
  container: HTMLElement;
  pinnedCardID: () => string | null;
  onMeasuredContentChanged: () => void;
  onCardScrollRequest: () => void;
}) {
  let rootEl: HTMLDivElement | undefined;
  let raf = 0;
  let measureRaf = 0;
  const measuredHeights = new Map<string, number>();
  const pendingMeasurements = new Map<string, HTMLElement>();

  const [scrollTop, setScrollTop] = createSignal(props.container.scrollTop);
  const [viewportHeight, setViewportHeight] = createSignal(props.container.clientHeight);
  const [rootTop, setRootTop] = createSignal(0);
  const [measurementVersion, setMeasurementVersion] = createSignal(0);
  const [scrollPinID, setScrollPinID] = createSignal<string | null>(null);

  const order = createMemo(() => cardTreeStore.order.slice());
  const layout = createMemo(() => {
    const ids = order();
    measurementVersion();
    return buildVirtualWindowLayout({
      count: ids.length,
      estimatedItemSize: ESTIMATED_CARD_HEIGHT,
      getItemSize: (index) => measuredHeights.get(ids[index]),
    });
  });

  const syncMetrics = () => {
    raf = 0;
    const container = props.container;
    setScrollTop(container.scrollTop);
    setViewportHeight(container.clientHeight);
    if (!rootEl) {
      setRootTop(0);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const rootRect = rootEl.getBoundingClientRect();
    setRootTop(Math.max(0, container.scrollTop + rootRect.top - containerRect.top));
  };

  const scheduleSyncMetrics = () => {
    if (raf) return;
    raf = requestAnimationFrame(syncMetrics);
  };

  const range = createMemo(() => {
    const localScrollTop = Math.max(0, scrollTop() - rootTop());
    return computeVirtualWindowRange(layout(), {
      scrollTop: localScrollTop,
      viewportHeight: viewportHeight(),
      overscanPx: VIRTUAL_OVERSCAN_PX,
    });
  });

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

  const segments = createMemo(() => {
    const ids = order();
    const r = range();
    const rawRanges = [{ startIndex: r.startIndex, endIndex: r.endIndex }];
    const pinID = activePinID();
    if (pinID) {
      const topLevelID = topLevelIDForCard(pinID);
      const pinnedIndex = topLevelID ? ids.indexOf(topLevelID) : -1;
      if (pinnedIndex >= 0 && (pinnedIndex < r.startIndex || pinnedIndex >= r.endIndex)) {
        rawRanges.push({ startIndex: pinnedIndex, endIndex: pinnedIndex + 1 });
      }
    }
    rawRanges.sort((a, b) => a.startIndex - b.startIndex);
    const merged: Array<{ startIndex: number; endIndex: number }> = [];
    for (const item of rawRanges) {
      const previous = merged[merged.length - 1];
      if (previous && item.startIndex <= previous.endIndex) {
        previous.endIndex = Math.max(previous.endIndex, item.endIndex);
      } else {
        merged.push({ ...item });
      }
    }

    let previousOffset = 0;
    return merged.map((item) => {
      const startOffset = virtualOffsetForIndex(layout(), item.startIndex);
      const endOffset = virtualOffsetForIndex(layout(), item.endIndex);
      const segment = {
        key: `${item.startIndex}:${item.endIndex}`,
        paddingBefore: Math.max(0, startOffset - previousOffset),
        ids: ids.slice(item.startIndex, item.endIndex),
      };
      previousOffset = endOffset;
      return segment;
    });
  });

  const bottomPadding = createMemo(() => {
    const rendered = segments();
    if (rendered.length === 0) return 0;
    const last = rendered[rendered.length - 1];
    const ids = order();
    const lastID = last.ids[last.ids.length - 1];
    const lastIndex = lastID ? ids.indexOf(lastID) : -1;
    return Math.max(0, layout().totalSize - virtualOffsetForIndex(layout(), lastIndex + 1));
  });

  const flushMeasurements = () => {
    measureRaf = 0;
    let changed = false;
    for (const [id, node] of pendingMeasurements) {
      if (!node.isConnected) continue;
      const height = measuredBlockHeight(node);
      const previous = measuredHeights.get(id);
      if (previous !== undefined && Math.abs(previous - height) < 1) continue;
      measuredHeights.set(id, height);
      changed = true;
    }
    pendingMeasurements.clear();
    if (!changed) return;
    setMeasurementVersion((value) => value + 1);
    scheduleSyncMetrics();
    props.onMeasuredContentChanged();
  };

  const onMeasure = (id: string, node: HTMLElement) => {
    pendingMeasurements.set(id, node);
    if (measureRaf) return;
    measureRaf = requestAnimationFrame(flushMeasurements);
  };

  const scrollTargetElement = (request: ConversationCardScrollRequest): HTMLElement | null => {
    const escaped = CSS.escape(request.cardID);
    const card = props.container.querySelector<HTMLElement>(`[data-card-id="${escaped}"]`);
    if (!card || request.focus !== "header") return card;
    return card.querySelector<HTMLElement>(
      ":scope > .chat-bubble-shell > .chat-bubble > .chat-bubble__head, :scope > .card__head",
    ) || card;
  };

  const highlightCard = (cardID: string) => {
    const target = props.container.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(cardID)}"]`);
    if (!target) return;
    target.classList.add("conversation-agent-target--pulse");
    window.setTimeout(() => target.classList.remove("conversation-agent-target--pulse"), 1400);
  };

  const scrollCardIntoView = async (request: ConversationCardScrollRequest): Promise<boolean> => {
    const topLevelID = topLevelIDForCard(request.cardID);
    if (!topLevelID) return false;
    const index = order().indexOf(topLevelID);
    if (index < 0) return false;
    props.onCardScrollRequest();
    setScrollPinID(topLevelID);
    props.container.scrollTop = Math.max(0, rootTop() + virtualOffsetForIndex(layout(), index));
    syncMetrics();
    await waitForAnimationFrame();
    await waitForAnimationFrame();
    const target = scrollTargetElement(request);
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

  onMount(() => {
    syncMetrics();
    const container = props.container;
    container.addEventListener("scroll", scheduleSyncMetrics, { passive: true });
    const ro = new ResizeObserver(scheduleSyncMetrics);
    ro.observe(container);
    if (rootEl) ro.observe(rootEl);
    const stopCardScrollListener = listenConversationCardScroll(scrollCardIntoView);
    const onLayoutShiftSignal = () => {
      scheduleSyncMetrics();
      requestAnimationFrame(scheduleSyncMetrics);
    };
    container.addEventListener("click", onLayoutShiftSignal, { passive: true });
    container.addEventListener("transitionend", onLayoutShiftSignal, true);
    onCleanup(() => {
      container.removeEventListener("scroll", scheduleSyncMetrics);
      container.removeEventListener("click", onLayoutShiftSignal);
      container.removeEventListener("transitionend", onLayoutShiftSignal, true);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      if (measureRaf) cancelAnimationFrame(measureRaf);
      stopCardScrollListener();
    });
  });

  createEffect(() => {
    const liveIDs = new Set(order());
    for (const id of measuredHeights.keys()) {
      if (!liveIDs.has(id)) measuredHeights.delete(id);
    }
    scheduleSyncMetrics();
  });

  return (
    <div ref={rootEl} class="conversation-virtual-window" data-count={order().length}>
      <Index each={segments()}>
        {(segment) => (
          <>
            <Show when={segment().paddingBefore > 0}>
              <div
                class="conversation-virtual-spacer"
                style={{ height: `${segment().paddingBefore}px` }}
                aria-hidden="true"
              />
            </Show>
            <For each={segment().ids}>
              {(id) => <VirtualizedConversationItem id={id} onMeasure={onMeasure} />}
            </For>
          </>
        )}
      </Index>
      <Show when={bottomPadding() > 0}>
        <div
          class="conversation-virtual-spacer"
          style={{ height: `${bottomPadding()}px` }}
          aria-hidden="true"
        />
      </Show>
    </div>
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
  const currentTaskID = () => String(boardStore.selectedTaskID || boardStore.board?.task?.id || "");
  const taskContextItem = () => {
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
    const item = selectedTaskItem() || taskContextItem();
    return clipText(
      item?.task?.title
      || item?.overview?.headline
      || selectedBoardTask()?.title
      || currentTaskID(),
    );
  };
  const selectedTaskStatus = () => {
    const item = selectedTaskItem() || taskContextItem();
    if (item?._pending) return "active";
    return String(item?.task?.status || selectedBoardTask()?.status || "idle");
  };
  const selectedTaskDirectoryText = () => {
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
    // host (see main.tsx and TaskDetailOverlay). Keeping the passive
    // listener on that host preserves `.chat-scroll > .card` layout and
    // browser scroll performance without introducing a wrapper element.
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
      const taskID = currentTaskID();
      if (!canLoadOlderConversationHistory(taskID)) return;
      historyIntentUntil = 0;
      historyLoadInFlight = true;
      const anchor = firstVisibleConversationAnchor(el);
      void loadOlderConversationHistory(taskID)
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
