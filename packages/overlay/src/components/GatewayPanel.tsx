// ── GatewayPanel (Phase 6) ──
// The Gateway dialog is the daemon-layer chat surface that routes user
// intent into workflow tasks, build tasks, clarifications, etc.
//
// Renders the gateway session message stream (loaded via useGatewaySession)
// plus a single text input. Messages with `metadata.task_ref` get a
// clickable chip that pushes `#task/<id>` so the surrounding layout can
// open TaskDetailOverlay.

import { For, Show, createSignal } from "solid-js";
import { useGatewaySession, type GatewayMessage } from "../services/gateway";

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

function navigateToTask(id: string) {
  // Hash route: main.tsx watches `hashchange` and renders TaskDetailOverlay
  // when this fragment is set. Avoiding a full router for now keeps the
  // change reversible — clearing the hash returns to the Gateway view.
  window.location.hash = `task/${encodeURIComponent(id)}`;
}

export function GatewayPanel() {
  const { messages, busy, send } = useGatewaySession();
  const [draft, setDraft] = createSignal("");

  async function submit(e: Event) {
    e.preventDefault();
    const text = draft().trim();
    if (!text || busy()) return;
    setDraft("");
    await send(text);
  }

  return (
    <div class="gateway-panel" role="region" aria-label="Gateway dialog">
      <div class="gateway-stream" id="gatewayStream">
        <Show when={messages().length === 0}>
          <div class="gateway-empty">
            <div class="gateway-empty-title">Gateway 待命中</div>
            <div class="gateway-empty-hint">
              Tell me what to build, ask about a running task, or paste a screenshot to clone.
            </div>
          </div>
        </Show>
        <For each={messages()}>
          {(msg) => {
            const isUser = msg.info.role === "user";
            return (
              <div class={`gateway-msg gateway-msg-${isUser ? "user" : "assistant"}`}>
                <For each={msg.parts}>
                  {(part) => {
                    const text = partText(part);
                    const ref = taskRef(part);
                    const qid = questionID(part);
                    return (
                      <Show when={text || ref}>
                        <div class="gateway-msg-part">
                          <Show when={text}>
                            <pre class="gateway-msg-text">{text}</pre>
                          </Show>
                          <Show when={ref}>
                            <button
                              type="button"
                              class="gateway-task-chip"
                              onClick={() => navigateToTask(ref!)}
                              title="Open task details"
                            >
                              <span class="gateway-task-chip-icon" aria-hidden="true">🗂</span>
                              <span class="gateway-task-chip-id">{ref}</span>
                              <Show when={qid}>
                                <span class="gateway-task-chip-tag">awaiting reply</span>
                              </Show>
                            </button>
                          </Show>
                        </div>
                      </Show>
                    );
                  }}
                </For>
              </div>
            );
          }}
        </For>
      </div>
      <form class="gateway-composer" onSubmit={submit}>
        <textarea
          class="gateway-composer-input"
          placeholder="Send a message to Gateway…  (Shift+Enter for newline)"
          value={draft()}
          rows={2}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(e);
            }
          }}
          disabled={busy()}
        />
        <button
          type="submit"
          class="gateway-composer-submit"
          disabled={busy() || !draft().trim()}
        >
          {busy() ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
