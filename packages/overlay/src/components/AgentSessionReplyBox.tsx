// ── AgentSessionReplyBox ──
// Inline textarea + steer button rendered at the END of every agent
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
//
// Error handling: the backend returns structured NamedError objects
// (see orchestrator/direct-reply.ts) that the API layer surfaces as
// ApiError with `body.name`. We read that name to decide between a
// transient retry banner (generic failures) and a permanent disabled
// state (SessionRuntimeContractMissingError 410 — the session is
// structurally unable to accept further messages until a re-dispatch).
// Pre-fix every failure mode collapsed onto HTTP 500 and showed the
// same generic banner, so the user could not tell when retrying was
// pointless.

import { createSignal, Show } from "solid-js";
import { t } from "../utils/i18n";
import { Icon } from "./Icon";

/** Backend NamedError names the reply route may surface. Mirrored from
 *  packages/opencorvus/src/orchestrator/direct-reply.ts — kept here as a
 *  closed string union so the JSX branches stay exhaustive at the type
 *  level. If the backend adds a new name, TS will surface the missing
 *  branch via `(errorName satisfies undefined)` in the default arm. */
type ReplyErrorName =
  | "InvalidReplyTargetKindError"
  | "BuildSessionDirectReplyError"
  | "ReplyTargetEnvelopeMissingError"
  | "SessionRuntimeContractMissingError";

function pickErrorName(err: unknown): ReplyErrorName | undefined {
  if (!err || typeof err !== "object") return undefined;
  // ApiError attaches the parsed JSON body verbatim. NamedError.toObject()
  // shape is `{ name: "...", data: {...} }` — read body.name when
  // available, falling back to top-level name on raw error objects.
  const body = (err as { body?: unknown }).body;
  const fromBody = body && typeof body === "object" && typeof (body as { name?: unknown }).name === "string"
    ? (body as { name: string }).name
    : undefined;
  const fromError = typeof (err as { name?: unknown }).name === "string"
    ? (err as { name: string }).name
    : undefined;
  const candidate = fromBody ?? fromError;
  switch (candidate) {
    case "InvalidReplyTargetKindError":
    case "BuildSessionDirectReplyError":
    case "ReplyTargetEnvelopeMissingError":
    case "SessionRuntimeContractMissingError":
      return candidate;
    default:
      return undefined;
  }
}

function messageForError(name: ReplyErrorName | undefined, fallback: string): string {
  switch (name) {
    case "SessionRuntimeContractMissingError":
      return t("card.agent_reply_contract_gone");
    case "InvalidReplyTargetKindError":
    case "BuildSessionDirectReplyError":
      return t("card.agent_reply_kind_not_allowed");
    case "ReplyTargetEnvelopeMissingError":
      return t("card.agent_reply_envelope_missing");
    default:
      return fallback || t("card.agent_reply_failed");
  }
}

/** Names that are permanent for the current session — retrying will hit
 *  the same wall until either the session is re-dispatched or the server
 *  state shifts. The reply box switches to a disabled "session inactive"
 *  affordance so the user does not bang on Steer pointlessly. */
function isTerminalError(name: ReplyErrorName | undefined): boolean {
  switch (name) {
    case "SessionRuntimeContractMissingError":
    case "InvalidReplyTargetKindError":
    case "BuildSessionDirectReplyError":
      return true;
    case "ReplyTargetEnvelopeMissingError":
    case undefined:
      return false;
  }
}

export interface AgentSessionReplyBoxProps {
  /** Send the message to the agent session. Resolves when the API
   *  request settles; throws on failure (caller can decide to surface). */
  onSend: (message: string) => Promise<void>;
}

export function AgentSessionReplyBox(props: AgentSessionReplyBoxProps) {
  const [text, setText] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal<string>("");
  const [terminalError, setTerminalError] = createSignal<ReplyErrorName | undefined>(undefined);

  const canSend = () => !sending() && !terminalError() && text().trim().length > 0;

  const submit = async (event: SubmitEvent | KeyboardEvent) => {
    event.preventDefault();
    if (!canSend()) return;
    const message = text().trim();
    setSending(true);
    setError("");
    try {
      await props.onSend(message);
      // Only clear the textarea on success — failed sends should keep
      // the operator's text so they don't have to retype after a retry.
      setText("");
    } catch (e) {
      const name = pickErrorName(e);
      const fallback = e instanceof Error ? e.message : String(e);
      setError(messageForError(name, fallback));
      if (isTerminalError(name)) setTerminalError(name);
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      class="card__agent-reply"
      classList={{ "card__agent-reply--disabled": !!terminalError() }}
      onSubmit={submit}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <textarea
        class="card__agent-reply-input"
        value={text()}
        rows={2}
        placeholder={t("card.agent_reply_placeholder")}
        disabled={sending() || !!terminalError()}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit(event);
          }
        }}
      />
      <button
        type="submit"
        class="card__agent-reply-send"
        disabled={!canSend()}
        aria-label={sending() ? t("card.agent_reply_sending") : t("card.agent_reply_send")}
        title={sending() ? t("card.agent_reply_sending") : t("card.agent_reply_send")}
      >
        <Icon name="send" />
        <span>
          <Show
            when={!sending()}
            fallback={t("card.agent_reply_sending")}
          >
            {t("card.agent_reply_send")}
          </Show>
        </span>
      </button>
      <Show when={error()}>
        <div
          class="card__agent-reply-error"
          classList={{ "card__agent-reply-error--terminal": !!terminalError() }}
          role="alert"
        >
          <span class="card__agent-reply-error-msg">{error()}</span>
          <Show when={!terminalError()}>
            <button
              type="button"
              class="card__agent-reply-error-dismiss"
              onClick={() => setError("")}
              aria-label={t("common.clear")}
              title={t("common.clear")}
            >
              <Icon name="close" />
            </button>
          </Show>
        </div>
      </Show>
    </form>
  );
}
