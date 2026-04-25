import { For, Show, onMount, onCleanup, createSignal } from "solid-js";
import { Card } from "./Card";
import { cardTreeStore } from "../store/card-tree";
import { boardStore } from "../store/board";
import { t } from "../utils/i18n";
import { setupAutoScroll } from "../utils/dom-utils";
import { TracePanel } from "./TracePanel";

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

  const hasItems = () => cardTreeStore.order.length > 0;

  const [tracking, setTracking] = createSignal(true);
  // Panel-level "Show all session trace" toggle. Renders a TracePanel scoped
  // to the currently selected task, aggregating every session's events in
  // chronological order. Sits above the card list so it doesn't disrupt the
  // conversation flow when closed.
  const [taskTraceOpen, setTaskTraceOpen] = createSignal(false);
  const currentTaskID = () => String(boardStore.selectedTaskID || "");

  onMount(() => {
    const c = setupAutoScroll(el, {
      isTracking: tracking,
      onUserScrollUp: () => setTracking(false),
    });
    const resumeTracking = () => {
      if (tracking()) return;
      const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
      if (distanceFromBottom <= 8) {
        setTracking(true);
      }
    };
    el.addEventListener("scroll", resumeTracking, { passive: true });
    onCleanup(() => {
      el.removeEventListener("scroll", resumeTracking);
      c.cleanup();
    });
  });

  const emptyText = () => t("chat.empty");

  return (
    <>
      <Show when={hasItems() && currentTaskID()}>
        <div class="conversation-trace-bar">
          <button
            type="button"
            class="conversation-trace-toggle"
            classList={{ "conversation-trace-toggle--open": taskTraceOpen() }}
            aria-pressed={taskTraceOpen()}
            onClick={() => setTaskTraceOpen((v) => !v)}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4" stroke="currentColor" stroke-width="1.5" fill="none" />
              <path d="M10 10l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
            <span>{taskTraceOpen() ? "Hide all session trace" : "Show all session trace"}</span>
          </button>
        </div>
        <Show when={taskTraceOpen()}>
          <TracePanel
            taskID={currentTaskID()}
            onClose={() => setTaskTraceOpen(false)}
          />
        </Show>
      </Show>
      <Show when={!hasItems()}>
        <div class="chat-empty">
          <svg class="chat-empty-icon" width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <rect x="4" y="5" width="32" height="22" rx="3.5" stroke="currentColor" stroke-width="1.6"/>
            <path d="M4 27l7-6h22l7 6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            <path d="M13 15h14M13 19.5h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <span class="chat-empty-text">{emptyText()}</span>
        </div>
      </Show>
      <For each={cardTreeStore.order}>
        {(id) => (
          <Show when={cardTreeStore.cards[id]}>
            <Card node={cardTreeStore.cards[id]!} depth={0} />
          </Show>
        )}
      </For>
    </>
  );
}
