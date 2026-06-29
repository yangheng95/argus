// ── AgentSessionReplyBox ──
// Inline textarea + steer button rendered at the END of an agent/session
// card. Most cards reply directly to a sub-agent session; build cards route
// through task-level operator guidance because build runtime ownership is
// managed by the orchestrator/build attempt lifecycle.
//
// Replaces the previous CardHeader collapsible toggle (a hidden button
// in the top-right of the card that expanded a form). Always visible at
// the bottom of the card body — matches the user's "末尾的文本回复框和
// 确认按钮" intent.
//
// Backend routing is supplied by the caller. Non-build cards use
// POST /task/:taskID/session/:sessionID/reply via replyToAgentSession().
// Build cards use POST /task/:taskID/message via sendTaskOperatorMessage().
//
// Error handling: structural backend errors are visible diagnostics only. The
// reply route must not rewrite a failed direct reply into task-root input.

import { createSignal, Show } from "solid-js"
import { t } from "../utils/i18n"
import { Icon } from "./Icon"
import { AutoGrowTextarea } from "./primitives/AutoGrowTextarea"
import { Button } from "./ui/Button"

/** Backend NamedError names the reply route may surface. Mirrored from
 *  packages/opencorvus/src/orchestrator/direct-reply.ts — kept here as a
 *  closed string union so the JSX branches stay exhaustive at the type
 *  level. If the backend adds a new name, TS will surface the missing
 *  branch via `(errorName satisfies undefined)` in the default arm. */
type ReplyErrorName =
  | "InvalidReplyTargetKindError"
  | "BuildSessionDirectReplyError"
  | "ReplyTargetEnvelopeMissingError"
  | "AgentSessionPendingCoordinationError"
  | "AgentSessionAttachmentReferenceError"
  | "SessionRuntimeContractMissingError"

interface ReplyErrorInfo {
  name: ReplyErrorName | undefined
  /** NamedError body data — currently only BuildSessionDirectReplyError
   *  carries fields the overlay branches on (sessionKind, envelopeAgent
   *  to pick the hybrid-specific copy when sessionKind !== "build" but
   *  envelopeAgent === "build"). Other errors don't need this yet. */
  data: Record<string, unknown> | undefined
}

function pickErrorInfo(err: unknown): ReplyErrorInfo {
  if (!err || typeof err !== "object") return { name: undefined, data: undefined }
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
  const rawData = body && typeof body === "object" ? (body as { data?: unknown }).data : undefined
  const data =
    rawData && typeof rawData === "object" && !Array.isArray(rawData) ? (rawData as Record<string, unknown>) : undefined
  let name: ReplyErrorName | undefined
  switch (candidate) {
    case "InvalidReplyTargetKindError":
    case "BuildSessionDirectReplyError":
    case "ReplyTargetEnvelopeMissingError":
    case "AgentSessionPendingCoordinationError":
    case "AgentSessionAttachmentReferenceError":
    case "SessionRuntimeContractMissingError":
      name = candidate
      break
    default:
      name = undefined
  }
  return { name, data }
}

function messageForError(info: ReplyErrorInfo, fallback: string): string {
  switch (info.name) {
    case "SessionRuntimeContractMissingError":
      return t("card.agent_reply_contract_gone")
    case "InvalidReplyTargetKindError":
      return t("card.agent_reply_kind_not_allowed")
    case "BuildSessionDirectReplyError": {
      // Hybrid case (session.kind !== "build" but envelope.agent ===
      // "build") gets its own copy: the SESSION is fine, but its last
      // envelope is tagged to resume under the build agent. Generic
      // "kind not allowed" would be misleading because the session.kind
      // IS in the reply whitelist. Falls back to kind_not_allowed when
      // backend data is malformed. codex review round 2 — minor.
      const sessionKind = typeof info.data?.sessionKind === "string" ? info.data.sessionKind : ""
      const envelopeAgent = typeof info.data?.envelopeAgent === "string" ? info.data.envelopeAgent : ""
      if (sessionKind && sessionKind !== "build" && envelopeAgent === "build") {
        return t("card.agent_reply_build_envelope")
      }
      return t("card.agent_reply_kind_not_allowed")
    }
    case "ReplyTargetEnvelopeMissingError":
      return t("card.agent_reply_envelope_missing")
    case "AgentSessionPendingCoordinationError":
      return t("card.agent_reply_pending_coordination")
    case "AgentSessionAttachmentReferenceError":
      return t("card.agent_reply_attachment_reference")
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
