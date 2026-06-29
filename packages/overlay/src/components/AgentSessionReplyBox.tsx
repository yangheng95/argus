// ── AgentSessionReplyBox ──
// Inline textarea + steer button rendered at the END of an agent/session
// card. All callers route through one target-scoped operator steer API that
// persists a visible coordination request for the orchestrator to answer.
//
// Replaces the previous CardHeader collapsible toggle (a hidden button
// in the top-right of the card that expanded a form). Always visible at
// the bottom of the card body — matches the user's "末尾的文本回复框和
// 确认按钮" intent.
//
// Error handling: structural backend errors are visible diagnostics only. The
// operator steer route must not rewrite failed steer into task-root input or a
// direct child-session reply.

import { createSignal, Show } from "solid-js"
import { t } from "../utils/i18n"
import { Icon } from "./Icon"
import { AutoGrowTextarea } from "./primitives/AutoGrowTextarea"
import { Button } from "./ui/Button"

/** Backend NamedError names the operator steer route may surface. Kept here as a
 *  closed string union so the JSX branches stay exhaustive at the type
 *  level. If the backend adds a new name, TS will surface the missing
 *  branch via `(errorName satisfies undefined)` in the default arm. */
type ReplyErrorName =
  | "AgentSessionPendingCoordinationError"
  | "OperatorSteerTargetError"
  | "OperatorSteerWakeError"
  | "SessionRuntimeContractMissingError"

interface ReplyErrorInfo {
  name: ReplyErrorName | undefined
}

function pickErrorInfo(err: unknown): ReplyErrorInfo {
  if (!err || typeof err !== "object") return { name: undefined }
  // ApiError attaches the parsed JSON body verbatim. NamedError.toObject()
  // shape is `{ name: "...", data: {...} }` — read body.name when
  // available, falling back to top-level name on raw error objects.
  const body = (err as { body?: unknown }).body
  const fromBody =
    body && typeof body === "object" && typeof (body as { name?: unknown }).name === "string"
      ? (body as { name: string }).name
      : undefined
  const fromError = typeof (err as { name?: unknown }).name === "string" ? (err as { name: string }).name : undefined
  const candidate = fromBody ?? fromError
  let name: ReplyErrorName | undefined
  switch (candidate) {
    case "AgentSessionPendingCoordinationError":
    case "OperatorSteerTargetError":
    case "OperatorSteerWakeError":
    case "SessionRuntimeContractMissingError":
      name = candidate
      break
    default:
      name = undefined
  }
  return { name }
}

function messageForError(info: ReplyErrorInfo, fallback: string): string {
  switch (info.name) {
    case "SessionRuntimeContractMissingError":
      return t("card.agent_reply_contract_gone")
    case "OperatorSteerTargetError":
      return t("card.agent_reply_kind_not_allowed")
    case "AgentSessionPendingCoordinationError":
      return t("card.agent_reply_pending_coordination")
    case "OperatorSteerWakeError":
      return t("card.agent_reply_wake_failed")
    default:
      return fallback || t("card.agent_reply_failed")
  }
}

export interface AgentSessionReplyBoxProps {
  /** Send the message to the agent session. Resolves when the API
   *  request settles; throws on failure (caller can decide to surface). */
  onSend: (message: string) => Promise<void>
}

export function AgentSessionReplyBox(props: AgentSessionReplyBoxProps) {
  const [text, setText] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [error, setError] = createSignal<string>("")

  const canSend = () => !sending() && text().trim().length > 0

  const submit = async (event: SubmitEvent | KeyboardEvent) => {
    event.preventDefault()
    if (!canSend()) return
    const message = text().trim()
    setSending(true)
    setError("")
    try {
      await props.onSend(message)
      // Only clear the textarea on success — failed sends should keep
      // the operator's text so they don't have to retype after a retry.
      setText("")
    } catch (e) {
      const info = pickErrorInfo(e)
      const fallback = e instanceof Error ? e.message : String(e)
      setError(messageForError(info, fallback))
    } finally {
      setSending(false)
    }
  }

  return (
    <form
      class="card__agent-reply"
      onSubmit={submit}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <AutoGrowTextarea
        class="card__agent-reply-input"
        value={text()}
        rows={2}
        maxLines={2}
        placeholder={t("card.agent_reply_placeholder")}
        disabled={sending()}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            void submit(event)
          }
        }}
      />
      <Button
        type="submit"
        variant="solid"
        size="sm"
        tone="accent"
        data-ui="agent-reply-send"
        disabled={!canSend()}
        aria-label={sending() ? t("card.agent_reply_sending") : t("card.agent_reply_send")}
        title={sending() ? t("card.agent_reply_sending") : t("card.agent_reply_send")}
      >
        <Icon name="send" />
        <span>
          <Show when={!sending()} fallback={t("card.agent_reply_sending")}>
            {t("card.agent_reply_send")}
          </Show>
        </span>
      </Button>
      <Show when={error()}>
        <div class="card__agent-reply-error" role="alert">
          <span class="card__agent-reply-error-msg">{error()}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="danger"
            data-ui="agent-reply-error-dismiss"
            data-chrome="icon-action"
            onClick={() => setError("")}
            aria-label={t("common.clear")}
            title={t("common.clear")}
          >
            <Icon name="close" />
          </Button>
        </div>
      </Show>
    </form>
  )
}
