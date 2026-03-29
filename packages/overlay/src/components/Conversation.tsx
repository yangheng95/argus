import { createSignal, createMemo, createEffect, Index, Show, onMount, onCleanup } from "solid-js";
import { MessageView } from "./MessageView";
import { AgentCard } from "./AgentCard";
import { t } from "../utils/i18n";
import { conversationMessages } from "../utils/conversation";

// ── Conversation Component ──
// Renders directly into the host container (e.g. #chatScroll).
// The host element already has the correct CSS classes; this component
// only renders children — no extra wrapper div.

export function Conversation(props: { container: HTMLElement }) {
  const [autoScroll, setAutoScroll] = createSignal(true);
  const el = props.container;

  const items = createMemo(() => conversationMessages());

 // Auto-scroll logic — attach to the host container
  function onScroll() {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAutoScroll(atBottom);
  }

  function scrollToBottom() {
    if (autoScroll()) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }

  onMount(() => {
    el.addEventListener("scroll", onScroll);
  });

  onCleanup(() => {
    el.removeEventListener("scroll", onScroll);
  });

 // Scroll when content changes
  createEffect(() => {
    items().length;
    scrollToBottom();
  });

  const emptyText = () => t("chat.empty");

  return (
    <>
      <Show when={items().length === 0}>
        <div class="chat-empty">{emptyText()}</div>
      </Show>
      <Index each={items()}>
        {(item) => (
          <Show
            when={!item()?._agentCard}
            fallback={
              <AgentCard
                cardID={item()._agentCardKey}
                stage={item()._agentStage}
                status={item()._agentStatus}
                round={item()._agentRound}
                messages={item()._agentMessages}
              />
            }
          >
            <MessageView message={item()} />
          </Show>
        )}
      </Index>
    </>
  );
}
