import { createMemo, Index, Show, onMount, onCleanup } from "solid-js";
import { MessageView } from "./MessageView";
import { AgentCard } from "./AgentCard";
import { ExecutorGoalGroup } from "./ExecutorGoalGroup";
import { t } from "../utils/i18n";
import { conversationMessages } from "../utils/conversation";
import { setupAutoScroll } from "../utils/dom-utils";

// ── Conversation Component ──
// Renders directly into the host container (e.g. #chatScroll).
// The host element already has the correct CSS classes; this component
// only renders children — no extra wrapper div.

export function Conversation(props: { container: HTMLElement }) {
  const el = props.container;

  const items = createMemo(() => conversationMessages());

  // Auto-scroll: tracks to bottom, pauses when user scrolls up, resumes at bottom
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
      <Index each={items()}>
        {(item) => (
          <Show
            when={item()?._agentGoalGroup}
            fallback={
              <Show
                when={item()?._agentCard && (item()._agentMessages || []).length > 0}
                fallback={<MessageView message={item()} />}
              >
                <AgentCard
                  cardID={item()._agentCardKey}
                  stage={item()._agentStage}
                  status={item()._agentStatus}
                  messages={item()._agentMessages || []}
                  round={item()._agentRound || 0}
                />
              </Show>
            }
          >
            <ExecutorGoalGroup
              cardID={item()._agentCardKey}
              goalTitle={item()._agentGoalTitle}
              goalDescription={item()._agentGoalDescription}
              goalSteps={item()._agentGoalSteps}
              architect={item()._agentArchitect}
              goalStatus={item()._agentGoalStatus}
              status={item()._agentStatus}
              internalCards={item()._agentInternalCards}
            />
          </Show>
        )}
      </Index>
    </>
  );
}
