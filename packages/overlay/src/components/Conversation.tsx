import { For, Show, onMount, onCleanup, createSignal } from "solid-js";
import { Card } from "./Card";
import { cardTreeStore } from "../store/card-tree";
import { t } from "../utils/i18n";
import { setupAutoScroll } from "../utils/dom-utils";

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
