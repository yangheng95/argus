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
        <div class="chat-empty">{emptyText()}</div>
      </Show>
      <For each={tree()}>{(node) => <Card node={node} depth={0} />}</For>
    </>
  );
}
