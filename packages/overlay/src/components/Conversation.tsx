import { createSignal, createMemo, createEffect, For, Show, batch, onMount, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { MessageView } from "./MessageView";
import { AgentCard } from "./AgentCard";

// Agent stages that get their own cards
const AGENT_STAGES = new Set(["spec", "planner", "goal", "judge", "delivery"]);

function classifyMessage(msg: any): string {
  const agent = String(msg?.info?.agent || "").trim().toLowerCase();
  if (AGENT_STAGES.has(agent)) return agent;
  // Legacy: messages with agent="agent" from child sessions
  if (agent === "agent") {
    const rootSession =
      typeof (window as any).rootTaskSessionID === "function"
        ? (window as any).rootTaskSessionID()
        : "";
    const sessionID = typeof msg?.info?.sessionID === "string" ? msg.info.sessionID : "";
    if (rootSession && sessionID && sessionID !== rootSession) {
      return "agent";
    }
  }
  return "main";
}

// ── Store ──
// Legacy app.js will push data into this store via the bridge API.
const [store, setStore] = createStore({
  messages: [] as any[],
  agentEvents: [] as any[],
  showTranscriptDetails: false,
  agentStatus: null as any,
});

// ── Conversation Component ──
// Renders directly into the host container (e.g. #chatScroll).
// The host element already has the correct CSS classes; this component
// only renders children — no extra wrapper div.

export function Conversation(props: { container: HTMLElement }) {
  const [autoScroll, setAutoScroll] = createSignal(true);
  const el = props.container;

  // Derive classified items: main messages interleaved with agent cards, sorted by time
  const classified = createMemo(() => {
    const mainMessages: any[] = [];
    const agentChannels: Record<
      string,
      { stage: string; messages: any[]; startTime: number; endTime: number }
    > = {};

    for (const msg of store.messages) {
      const channel = classifyMessage(msg);
      if (channel === "main") {
        mainMessages.push(msg);
      } else {
        const sessionID = msg.info?.sessionID || "";
        const key = `${channel}:${sessionID}`;
        if (!agentChannels[key]) {
          agentChannels[key] = { stage: channel, messages: [], startTime: Infinity, endTime: 0 };
        }
        agentChannels[key].messages.push(msg);
        const created = msg.info?.time?.created || 0;
        if (created < agentChannels[key].startTime) agentChannels[key].startTime = created;
        const completed = msg.info?.time?.completed || created;
        if (completed > agentChannels[key].endTime) agentChannels[key].endTime = completed;
      }
    }

    // Group rounds per stage, sorted by time, to assign round numbers and status
    const stageRounds: Record<string, { key: string; channel: any }[]> = {};
    for (const [key, channel] of Object.entries(agentChannels)) {
      if (channel.messages.length === 0) continue;
      if (!stageRounds[channel.stage]) stageRounds[channel.stage] = [];
      stageRounds[channel.stage].push({ key, channel });
    }
    for (const rounds of Object.values(stageRounds)) {
      rounds.sort((a, b) => a.channel.startTime - b.channel.startTime);
    }

    // Build agent cards with status detection
    const agentCards: any[] = [];
    const allAgentEvents = Array.isArray(store.agentEvents) ? store.agentEvents : [];
    for (const [stage, rounds] of Object.entries(stageRounds)) {
      for (let i = 0; i < rounds.length; i++) {
        const { key, channel } = rounds[i];
        const isLastRound = i === rounds.length - 1;
        let status: string;
        if (!isLastRound) {
          status = "completed";
        } else {
          const stageEvents = allAgentEvents.filter(
            (e: any) =>
              String(e?.stage || "").toLowerCase() === stage &&
              (e.timestamp || 0) >= channel.startTime,
          );
          const isFinished = stageEvents.some(
            (e: any) =>
              e.kind === "status" && /finished|completed|done/i.test(e?.summary || ""),
          );
          const isError = stageEvents.some((e: any) => e.kind === "error") && !isFinished;
          status = isError ? "error" : isFinished ? "completed" : "running";
        }
        agentCards.push({
          key,
          stage,
          status,
          round: rounds.length > 1 ? i + 1 : 0,
          messages: channel.messages,
          startTime: channel.startTime === Infinity ? Date.now() : channel.startTime,
        });
      }
    }

    // Merge and sort by time
    const all = [
      ...mainMessages.map((m) => ({
        type: "message" as const,
        data: m,
        time: m.info?.time?.created || 0,
      })),
      ...agentCards.map((c) => ({
        type: "card" as const,
        data: c,
        time: c.startTime,
      })),
    ].sort((a, b) => a.time - b.time);

    return all;
  });

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
    classified().length;
    scrollToBottom();
  });

  const emptyText = () => {
    if (typeof (window as any).t === "function") {
      return (window as any).t("chat.empty");
    }
    return "No messages yet";
  };

  return (
    <>
      <Show when={classified().length === 0}>
        <div class="chat-empty">{emptyText()}</div>
      </Show>
      <For each={classified()}>
        {(item) => (
          <Show
            when={item.type === "message"}
            fallback={<AgentCard {...item.data} />}
          >
            <MessageView message={item.data} />
          </Show>
        )}
      </For>
    </>
  );
}

// ── Bridge API ──
// Legacy app.js calls this to push data into the Solid store.

export function createConversationBridge() {
  return {
    update(
      messages: any[],
      agentEvents: any[],
      options?: { showTranscriptDetails?: boolean; agentStatus?: any },
    ) {
      batch(() => {
        setStore("messages", reconcile(messages));
        setStore("agentEvents", reconcile(agentEvents));
        if (options?.showTranscriptDetails !== undefined)
          setStore("showTranscriptDetails", options.showTranscriptDetails);
        if (options?.agentStatus !== undefined) setStore("agentStatus", options.agentStatus);
      });
    },
    clear() {
      batch(() => {
        setStore("messages", []);
        setStore("agentEvents", []);
      });
    },
  };
}
