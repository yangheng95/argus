// ── AgentSessionReplyBox ──
// Inline textarea + send button rendered at the END of every agent
// session card. The user can reply directly to a sub-agent session
// without going through the main composer at the bottom of the overlay.
//
// Replaces the previous CardHeader collapsible toggle (a hidden button
// in the top-right of the card that expanded a form). Always visible at
// the bottom of the card body — matches the user's "末尾的文本回复框和
// 确认按钮" intent.
//
// Backend: POST /task/:taskID/session/:sessionID/reply via existing
// replyToAgentSession() in services/task.ts. The reply lands in the
// session's message stream and the orchestrator's loop picks it up on
// the next iteration (no FSM gate; rule 23).

import { createSignal, Show } from "solid-js";
import { t } from "../utils/i18n";

export interface AgentSessionReplyBoxProps {
  /** Send the message to the agent session. Resolves when the API
   *  request settles; throws on failure (caller can decide to surface). */
  onSend: (message: string) => Promise<void>;
}

export function AgentSessionReplyBox(props: AgentSessionReplyBoxProps) {
  const [text, setText] = createSignal("");
  const [sending, setSending] = createSignal(false);

  const canSend = () => !sending() && text().trim().length > 0;

  const submit = async (event: SubmitEvent | KeyboardEvent) => {
    event.preventDefault();
    if (!canSend()) return;
    const message = text().trim();
    setSending(true);
    try {
      await props.onSend(message);
      setText("");
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      class="card__agent-reply"
      onSubmit={submit}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <textarea
        class="card__agent-reply-input"
        value={text()}
        rows={2}
        placeholder={t("card.agent_reply_placeholder")}
        disabled={sending()}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit(event);
          }
        }}
      />
      <div class="card__agent-reply-actions">
        <button
          type="submit"
          class="card__agent-reply-send"
          disabled={!canSend()}
        >
          <Show
            when={!sending()}
            fallback={t("card.agent_reply_sending")}
          >
            {t("card.agent_reply_send")}
          </Show>
        </button>
      </div>
    </form>
  );
}
