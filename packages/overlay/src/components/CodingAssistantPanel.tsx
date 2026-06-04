import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import { getHostTransport, type StreamHandle } from "../services/host-transport"
import {
  createCodingAssistantSession,
  hydrateCodingAssistantTranscript,
  listCodingAssistantSessions,
  sendCodingAssistantPrompt,
  type CodingAssistantSession,
} from "../services/coding-assistant"
import { settingsStore } from "../store/settings"
import { t } from "../utils/i18n"
import { stamp } from "../utils/time"
import { Icon } from "./Icon"
import {
  applyAssistantSessionEvent,
  messageTime,
  normalizeMessage,
  partText,
  type AssistantMessage,
} from "../services/coding-assistant-transcript"

function RoleLabel(props: { message: AssistantMessage }) {
  const role = () => String(props.message.info.role ?? props.message.info.agent ?? "assistant")
  return <span class="assistant-message-role">{role() === "user" ? t("coding_assistant.user") : t("coding_assistant.assistant")}</span>
}

export function CodingAssistantPanel(props: { active: Accessor<boolean> }) {
  let stream: StreamHandle | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let loadEpoch = 0
  let textareaRef: HTMLTextAreaElement | undefined
  const [session, setSession] = createSignal<CodingAssistantSession | null>(null)
  const [messages, setMessages] = createSignal<AssistantMessage[]>([])
  const [draft, setDraft] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [submitting, setSubmitting] = createSignal(false)
  const [status, setStatus] = createSignal(t("coding_assistant.disconnected"))
  const [error, setError] = createSignal("")
  const canSend = createMemo(() => props.active() && !!session() && draft().trim().length > 0 && !submitting())

  function clearReconnect() {
    if (!reconnectTimer) return
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function closeStream() {
    stream?.close()
    stream = null
  }

  async function load() {
    const directory = settingsStore.directory.trim()
    const epoch = ++loadEpoch
    clearReconnect()
    closeStream()
    if (!props.active() || !directory) return
    setLoading(true)
    setError("")
    setStatus(t("coding_assistant.loading"))
    const alive = () => epoch === loadEpoch && props.active() && settingsStore.directory.trim() === directory
    try {
      const existing = await listCodingAssistantSessions(1)
      if (!alive()) return
      const next = existing[0] ?? await createCodingAssistantSession()
      if (!alive()) return
      setSession(next)
      const transcript = await hydrateCodingAssistantTranscript(next.id)
      if (!alive()) return
      setMessages(transcript.map(normalizeMessage).filter(Boolean) as AssistantMessage[])
      openStream(next.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus(t("coding_assistant.disconnected"))
    } finally {
      setLoading(false)
    }
  }

  async function reconnect(sessionID: string) {
    const directory = settingsStore.directory.trim()
    const epoch = ++loadEpoch
    clearReconnect()
    closeStream()
    if (!props.active() || !directory) return
    const alive = () =>
      epoch === loadEpoch &&
      props.active() &&
      settingsStore.directory.trim() === directory &&
      session()?.id === sessionID
    try {
      const transcript = await hydrateCodingAssistantTranscript(sessionID)
      if (!alive()) return
      setMessages(transcript.map(normalizeMessage).filter(Boolean) as AssistantMessage[])
      openStream(sessionID)
    } catch (err) {
      if (!alive()) return
      setError(err instanceof Error ? err.message : String(err))
      scheduleReconnect(sessionID)
    }
  }

  function scheduleReconnect(sessionID: string) {
    clearReconnect()
    if (!props.active()) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (!props.active() || session()?.id !== sessionID) return
      void reconnect(sessionID)
    }, 3_000)
  }

  function openStream(sessionID: string) {
    clearReconnect()
    closeStream()
    const transport = getHostTransport()
    const handle = transport.openStream(
      { path: `session/${encodeURIComponent(sessionID)}/events` },
      {
        onOpen: () => setStatus(t("coding_assistant.connected")),
        onError: (err) => {
          if (handle !== stream) return
          setStatus(t("coding_assistant.disconnected"))
          console.warn("[coding-assistant] stream error", err)
          handle.close()
          if (stream === handle) stream = null
          scheduleReconnect(sessionID)
        },
        onClose: (reason) => {
          if (handle !== stream) return
          stream = null
          if (reason === "client-close") return
          setStatus(t("coding_assistant.disconnected"))
          scheduleReconnect(sessionID)
        },
        onEvent: (data) => {
          let event: any
          try {
            event = JSON.parse(data)
          } catch {
            return
          }
          if (event.type === "session.connected" || event.type === "session.heartbeat") return
          const payload = event.payload && typeof event.payload === "object" ? event.payload : {}
          if (event.type === "session.status") {
            setStatus(String(payload.status ?? t("coding_assistant.connected")))
            return
          }
          if (
            event.type === "message.updated" ||
            event.type === "message.part.updated" ||
            event.type === "message.part.delta"
          ) {
            setMessages((items) => applyAssistantSessionEvent(items, { type: event.type, payload }))
            return
          }
          if (event.type === "session.error") {
            setError(String(payload.error?.message ?? payload.error ?? t("coding_assistant.failed")))
          }
        },
      },
    )
    stream = handle
  }

  async function submit() {
    const text = draft().trim()
    const current = session()
    if (!current || !text || submitting()) return
    setSubmitting(true)
    setError("")
    try {
      await sendCodingAssistantPrompt(current.id, text)
      setDraft("")
      textareaRef?.focus()
      setStatus(t("coding_assistant.queued"))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  createEffect(() => {
    const active = props.active()
    if (!settingsStore.directory.trim()) {
      loadEpoch += 1
      clearReconnect()
      closeStream()
      setSession(null)
      setMessages([])
      setStatus(t("coding_assistant.disconnected"))
      return
    }
    if (!active) {
      loadEpoch += 1
      clearReconnect()
      closeStream()
      return
    }
    void load()
  })
  onCleanup(() => {
    loadEpoch += 1
    clearReconnect()
    closeStream()
  })

  return (
    <section class="coding-assistant-panel" aria-label={t("coding_assistant.title")}>
      <header class="coding-assistant-header">
        <div class="coding-assistant-title">
          <Icon name="avatar-assistant" size={14} />
          <span>{t("coding_assistant.title")}</span>
        </div>
        <button
          class="coding-assistant-icon-button"
          type="button"
          title={t("common.refresh")}
          aria-label={t("common.refresh")}
          onClick={() => void load()}
        >
          <Icon name="refresh" size={13} />
        </button>
      </header>

      <div class="coding-assistant-status" data-state={error() ? "error" : status()}>
        <span>{error() || status()}</span>
        <Show when={session()}>
          <code>{session()!.id.slice(-10)}</code>
        </Show>
      </div>

      <div class="coding-assistant-transcript" aria-live="polite">
        <Show when={!loading() && messages().length === 0}>
          <div class="coding-assistant-empty">{t("coding_assistant.empty")}</div>
        </Show>
        <For each={messages()}>
          {(message) => (
            <article class="assistant-message" data-role={String(message.info.role ?? "assistant")}>
              <header class="assistant-message-header">
                <RoleLabel message={message} />
                <Show when={messageTime(message) > 0}>
                  <time>{stamp(messageTime(message))}</time>
                </Show>
              </header>
              <div class="assistant-message-parts">
                <For each={message.parts}>
                  {(part) => (
                    <pre class="assistant-message-part" data-part-type={String(part.type ?? "text")}>{partText(part)}</pre>
                  )}
                </For>
              </div>
            </article>
          )}
        </For>
      </div>

      <form class="coding-assistant-composer" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <textarea
          ref={textareaRef}
          value={draft()}
          aria-label={t("coding_assistant.placeholder")}
          placeholder={t("coding_assistant.placeholder")}
          disabled={!session() || loading()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <button class="coding-assistant-send" type="submit" disabled={!canSend()}>
          <Icon name={submitting() ? "status-queued" : "send"} size={14} />
          <span>{submitting() ? t("coding_assistant.sending") : t("coding_assistant.send")}</span>
        </button>
      </form>
    </section>
  )
}
