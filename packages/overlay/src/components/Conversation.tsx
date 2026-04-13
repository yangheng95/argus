import { createMemo, For, Show, onMount, onCleanup } from "solid-js";
import { Card } from "./Card";
import { toCardTree } from "../utils/card-tree";
import { t } from "../utils/i18n";
import { conversationMessages } from "../utils/conversation";
import { setupAutoScroll } from "../utils/dom-utils";

// ── Conversation Component ──
// Renders directly into the host container (e.g. #chatScroll).
// The host element already has the correct CSS classes; this component
// only renders children — no extra wrapper div.
//
// All conversation items route through a single unified <Card> primitive.
// The CardNode tree is built by toCardTree() from messageStore output;
// goal groups, agent stage cards, tool promotions and user / system
// message bubbles are all recursive CardNodes — no legacy branching.

export function Conversation(props: { container: HTMLElement }) {
  const el = props.container;

  const items = createMemo(() => conversationMessages());
  const tree = createMemo(() => toCardTree(items()));

  onMount(() => {
    const cleanup = setupAutoScroll(el);
    onCleanup(cleanup);
  });

  const emptyText = () => t("chat.empty");

  return (
    <>
      <Show when={items().length === 0}>
        <div class="chat-empty">
          <svg class="chat-empty-icon" width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <rect x="4" y="5" width="32" height="22" rx="3.5" stroke="currentColor" stroke-width="1.6"/>
            <path d="M4 27l7-6h22l7 6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            <path d="M13 15h14M13 19.5h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <span class="chat-empty-text">{emptyText()}</span>
        </div>
      </Show>
      <For each={tree()}>{(node) => <Card node={node} depth={0} />}</For>
    </>
  );
}
