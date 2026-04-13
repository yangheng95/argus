// ── GatewaySidebarTail ──
// Inline daemon stream rendered inside the sidebar, directly above the
// composer. Shows the latest ~5 assistant replies + their task chips so
// the user gets feedback after sending. Keeps Gateway visible without
// stealing column space from the chat workspace.
//
// User input lives in the composer below this tail (per spec: "input
// box in the left column, doesn't occupy middle or right columns").
// All sends route through services/gateway.sendShared.

import { For, Show, createMemo } from "solid-js";
import { useGatewaySession, type GatewayMessage } from "../services/gateway";
import { selectTask } from "../services/task";

const TAIL_LIMIT = 5;

function partText(part: GatewayMessage["parts"][number]): string {
  if (part.type === "text" && typeof part.text === "string") return part.text;
  return "";
}

function taskRef(part: GatewayMessage["parts"][number]): string | undefined {
  const meta = part.metadata as Record<string, unknown> | undefined;
  const ref = meta?.task_ref;
  return typeof ref === "string" && ref ? ref : undefined;
}

function questionID(part: GatewayMessage["parts"][number]): string | undefined {
  const meta = part.metadata as Record<string, unknown> | undefined;
  const qid = meta?.question_id;
  return typeof qid === "string" && qid ? qid : undefined;
}

function messageText(msg: GatewayMessage): string {
  return msg.parts.map(partText).filter(Boolean).join("\n").trim();
}

function messageRefs(
  msg: GatewayMessage,
): Array<{ id: string; question?: string }> {
  const out: Array<{ id: string; question?: string }> = [];
  for (const p of msg.parts) {
    const ref = taskRef(p);
    if (ref) out.push({ id: ref, question: questionID(p) });
  }
  return out;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function GatewaySidebarTail() {
  const { messages } = useGatewaySession();

  const tail = createMemo(() => {
    const all = messages();
    return all.slice(Math.max(0, all.length - TAIL_LIMIT));
  });

  return (
    <div
      class="sidebar-gateway-tail-inner"
      role="region"
      aria-label="Gateway daemon"
    >
      <Show
        when={tail().length > 0}
        fallback={
          <div class="sidebar-gateway-tail-empty">暂无 Gateway 消息</div>
        }
      >
        <For each={tail()}>
          {(msg) => {
            const isUser = msg.info.role === "user";
            const text = messageText(msg);
            const refs = messageRefs(msg);
            const time = formatTime(msg.info.time.created);
            return (
              <div
                class="sidebar-gateway-tail-entry"
                data-role={isUser ? "user" : "assistant"}
              >
                <div class="sidebar-gateway-tail-meta">
                  <span class="sidebar-gateway-tail-time">{time}</span>
                  <span class="sidebar-gateway-tail-role">
                    {isUser ? "you" : "gateway"}
                  </span>
                  <For each={refs}>
                    {(ref) => (
                      <button
                        type="button"
                        class="sidebar-gateway-tail-chip"
                        onClick={() => void selectTask(ref.id)}
                        title="Open task in workspace"
                      >
                        <span aria-hidden="true">🗂</span>
                        <span>{ref.id.slice(0, 8)}</span>
                        <Show when={ref.question}>
                          <span class="sidebar-gateway-tail-chip-tag">?</span>
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
                <Show when={text}>
                  <div class="sidebar-gateway-tail-text" title={text}>
                    {text}
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </Show>
    </div>
  );
}
