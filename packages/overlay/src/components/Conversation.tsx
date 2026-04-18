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

  const [tracking, setTracking] = createSignal(false);
  let controller: { scrollToBottom: () => void } | undefined;

  onMount(() => {
    const c = setupAutoScroll(el, {
      isTracking: tracking,
      onUserScrollUp: () => setTracking(false),
    });
    controller = c;
    onCleanup(c.cleanup);
  });

  function toggleTracking() {
    if (tracking()) {
      setTracking(false);
    } else {
      setTracking(true);
      controller?.scrollToBottom();
    }
  }

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
      <Show when={hasItems()}>
        <button
          type="button"
          class="chat-follow-toggle"
          classList={{ "is-active": tracking() }}
          onClick={toggleTracking}
          title={tracking() ? t("chat.follow.on_title") : t("chat.follow.off_title")}
          aria-pressed={tracking()}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="chat-follow-label">
            {tracking() ? t("chat.follow.on") : t("chat.follow.off")}
          </span>
        </button>
      </Show>
    </>
  );
}
