// ── ChatComposer Component ──
// Solid.js port of renderChatComposer / renderChatAttachments / chatForm submit
// and related attachment/keyboard logic

import * as Select from "@kobalte/core/select"
import { createSignal, createMemo, createEffect, For, Show, onCleanup, onMount } from "solid-js"
import type { JSX } from "solid-js"
import { t, tArray } from "../utils/i18n"
import { ExecutorSelector } from "./ExecutorSelector"
import { nativeMessage } from "../services/app-dialog"
import { messageStore, setChatAttachments } from "../store/messages"
import {
  MAX_ATTACHMENT_SIZE,
  MAX_TOTAL_ATTACHMENT_SIZE,
  wouldExceedAggregateLimit,
} from "../services/chat-attach-limits"
import {
  canAcceptComposerAttachment,
  setComposerAttachmentInputEnabled,
} from "../services/composer-attachment-acceptance"
import { fileToDataUrl } from "../services/file-to-data-url"
import { Icon } from "./Icon"
import { AutoGrowTextarea } from "./primitives/AutoGrowTextarea"
import {
  clearComposerDraft,
  composerDraftText,
  normalizeComposerDraftKey,
  setComposerDraft,
} from "../services/composer-draft"

// ── Types ──

export interface ChatAttachment {
  mime: string
  url: string
  filename: string
}

export interface PromptProfileOption {
  id: string
  label: string
  description?: string
}

export interface ChatComposerProps {
  /**
   * Whether the composer should be interactive.
   */
  enabled: boolean
  /**
   * Whether a task is active (in-flight request or interruptable task status).
   * When true the send button becomes a stop button.
   */
  busy: boolean
  /**
   * Whether the busy request is being stopped (transitional state).
   */
  stopping?: boolean
  /** Called when the user submits a message. */
  onSubmit: (
    text: string,
    attachments: ChatAttachment[],
    webSearch: boolean,
    promptProfile: string,
  ) => void | Promise<void>
  /** Called when the user clicks the stop button while busy. */
  onStop?: () => void
  /**
   * One-shot suggestion to inject into the empty composer (used after a
   * task finishes — parent provides an LLM-generated follow-up). Written
   * into the textarea only when the current text is empty so we never
   * overwrite the user's in-progress input.
   */
  pendingSuggestion?: string
  /** Called once the pending suggestion has been applied (or intentionally
   *  dropped because the user was already typing). Parent should clear its
   *  signal to avoid re-applying the same suggestion. */
  onSuggestionConsumed?: () => void
  formID?: string
  textareaID?: string
  sendID?: string
  stopID?: string
  textareaDataUI?: string
  sendDataUI?: string
  /** Stable task/mission scoped key used to save and restore draft text. */
  draftKey?: string
  /** Optional single prompt hint for scoped composers such as Mission launch. */
  placeholder?: string
  promptProfiles: PromptProfileOption[]
  promptProfileID: string
  onPromptProfileChange: (profileID: string) => void
}

function PromptProfileSelectOptionItem(props: Select.SelectRootItemComponentProps<PromptProfileOption>): JSX.Element {
  const option = () => props.item.rawValue
  return (
    <Select.Item
      item={props.item}
      class="oc-select-option prompt-profile-select-option"
      data-profile-id={option().id}
      title={option().description ?? option().label}
    >
      <span class="oc-select-option-copy prompt-profile-select-option-copy">
        <Select.ItemLabel>{option().label}</Select.ItemLabel>
        <Show when={option().description}>{(description) => <small>{description()}</small>}</Show>
      </span>
      <Select.ItemIndicator class="oc-select-indicator">
        <Icon name="status-completed" size={12} />
      </Select.ItemIndicator>
    </Select.Item>
  )
}

// ── Constants ──

// MAX_ATTACHMENT_SIZE / MAX_TOTAL_ATTACHMENT_SIZE imported from
// services/chat-attach-limits (audit W2-V15) so the cap can be
// unit-tested without rendering the component.

const REQUEST_PERFORMANCE_WARNING_BYTES = 50 * 1024
const UTF8_ENCODER = new TextEncoder()

// ── Helpers ──
//
// fileToDataUrl moved to services/file-to-data-url so the V18 catch
// pattern in addAttachment is unit-testable via a FileReader factory
// override (Bun test runner has no jsdom).

// Names that propagate from drop / paste / file-picker into the
// orchestrator's attachment inventory must be:
//   - non-empty (paste hands us "" on Chromium)
//   - shell-safe (no path separators, no metacharacters) — server-side
//     `displayFilename` replaces unsafe names with a generated display name
//     that stays readable to sub-agents
// Mirrors the SAFE_FILENAME_RE rule in
// `opencorvus/src/storage/attachment-store.ts`. Keeping the regex
// duplicated here (the server-side helper is not bundled into the
// overlay) is the lesser evil; the alternative is shipping the server
// rule through the SDK just for one literal.
const SAFE_FILENAME_RE = /^[A-Za-z0-9._\-一-鿿 ]+$/
const PASTE_EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "text/plain": "txt",
}
function chooseAttachmentFilename(original: string | undefined, mime: string): string {
  if (original && SAFE_FILENAME_RE.test(original)) return original
  const ext = PASTE_EXT_BY_MIME[mime] ?? (mime.split("/")[1] ?? "bin").replace(/[^A-Za-z0-9]/g, "")
  // Stamp lets the operator distinguish multiple pastes within one
  // composer session at a glance — sha-style handles all blur together.
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").replace(/\..+/, "")
  return `pasted-${stamp}.${ext || "bin"}`
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength
}

// ── Component ──

export function ChatComposer(props: ChatComposerProps) {
  let textareaRef!: HTMLTextAreaElement
  let formRef!: HTMLFormElement

  const [text, setText] = createSignal("")
  let loadedDraftKey: string | null = null
  // audit-2026-04-29 W2-V12 — single source of truth for staged
  // chat attachments lives in `messageStore.chatAttachments`. The
  // composer used to keep its own local signal, which meant
  // host-driven `composer.attach` ui-commands (the "OpenCorvus:
  // Attach Current File" path from vscode-extension's
  // attach-file.ts) wrote into the store but the composer rendered
  // its disjoint local copy — the user never saw the attachment
  // and submitted without it. CLAUDE.md §二-8 forbids dual sources;
  // collapse to the store and route every add/remove/clear through
  // setChatAttachments.
  const attachments = () => messageStore.chatAttachments as ChatAttachment[]
  const setAttachments = (next: ChatAttachment[] | ((prev: ChatAttachment[]) => ChatAttachment[])) => {
    const nextValue =
      typeof next === "function" ? (next as (prev: ChatAttachment[]) => ChatAttachment[])(attachments()) : next
    setChatAttachments(nextValue)
  }
  const [dragover, setDragover] = createSignal(false)
  const [focused, setFocused] = createSignal(false)
  const [hintText, setHintText] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)
  let resizeSession: { pointerID: number; startY: number; startHeight: number } | undefined

  const hasText = createMemo(() => text().trim().length > 0)
  const showLargeRequestWarning = createMemo(() => utf8ByteLength(text()) > REQUEST_PERFORMANCE_WARNING_BYTES)
  const stopping = () => props.stopping === true

  createEffect(() => {
    setComposerAttachmentInputEnabled(props.enabled)
  })
  onCleanup(() => setComposerAttachmentInputEnabled(false))

  function writeText(next: string): void {
    setText(next)
    if (textareaRef && textareaRef.value !== next) textareaRef.value = next
  }

  function writeDraftText(next: string): void {
    writeText(next)
    const key = normalizeComposerDraftKey(props.draftKey)
    if (key) setComposerDraft(key, next)
  }

  createEffect(() => {
    const key = normalizeComposerDraftKey(props.draftKey)
    if (loadedDraftKey === key) return
    loadedDraftKey = key
    writeText(key ? composerDraftText(key) : "")
  })

  // ── Rotating placeholder ──
  // Cycles through a shuffled list of project-level examples while the
  // composer sits idle (empty + unfocused). One signal write per rotation;
  // no per-character typewriter. The previous 28–60ms typewriter loop wrote
  // 20–70 signal-driven DOM mutations per second the entire time the
  // composer was visible — Tauri's transparent WebView2 then alpha-blended
  // the desktop on every frame, dominating idle power draw on laptops.
  let rotateTimer: ReturnType<typeof setInterval> | undefined
  let hintOrder: number[] = []
  let hintCursor = 0
  const ROTATE_MS = 7_000

  function shuffleIndices(n: number): number[] {
    const arr = Array.from({ length: n }, (_, i) => i)
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }

  function stopHint() {
    if (rotateTimer) {
      clearInterval(rotateTimer)
      rotateTimer = undefined
    }
  }

  function startRotate(examples: string[]) {
    stopHint()
    if (examples.length === 0) {
      setHintText("")
      return
    }
    if (hintOrder.length !== examples.length) {
      hintOrder = shuffleIndices(examples.length)
      hintCursor = 0
    }
    setHintText(examples[hintOrder[hintCursor % hintOrder.length]!]!)
    if (examples.length === 1) return
    rotateTimer = setInterval(() => {
      hintCursor = (hintCursor + 1) % hintOrder.length
      setHintText(examples[hintOrder[hintCursor]!]!)
    }, ROTATE_MS)
  }

  const showHint = createMemo(() => props.enabled && !props.busy && !focused() && text().length === 0)

  createEffect(() => {
    const scopedPlaceholder = props.placeholder?.trim()
    const examples = scopedPlaceholder ? [scopedPlaceholder] : tArray("chat.placeholder_projects")
    if (showHint() && examples.length > 0) {
      startRotate(examples)
    } else {
      stopHint()
      setHintText("")
    }
  })

  // Pause rotation when the overlay window is hidden / minimized — the user
  // is not looking, and Tauri's WebView2 still wakes the JS event loop on
  // setInterval ticks. visibilitychange covers minimize / alt-tab on Windows.
  if (typeof document !== "undefined") {
    const onVisibility = () => {
      if (document.hidden) {
        stopHint()
      } else {
        const scopedPlaceholder = props.placeholder?.trim()
        const examples = scopedPlaceholder ? [scopedPlaceholder] : tArray("chat.placeholder_projects")
        if (showHint() && examples.length > 0) startRotate(examples)
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    onCleanup(() => document.removeEventListener("visibilitychange", onVisibility))
  }

  onCleanup(() => stopHint())

  // ── Pending suggestion injection ──
  // When the parent supplies a non-empty suggestion and the composer is
  // idle & still in default state (empty OR just the routing prefix),
  // pre-fill the textarea so the user can tweak or send. Either way, call
  // onSuggestionConsumed so the parent clears its signal and we don't
  // re-apply on subsequent unrelated re-renders.
  createEffect(() => {
    const pending = props.pendingSuggestion?.trim()
    if (!pending) return
    if (!props.enabled || props.busy) return
    if (text().length === 0) {
      writeDraftText(pending)
    }
    props.onSuggestionConsumed?.()
  })

  // ── Auto-grow textarea ──
  // Content-driven height (capped, then scroll) is owned by the shared
  // <AutoGrowTextarea> primitive. The drag handle below still sets
  // `--chat-textarea-height` as a min-height floor on the wrap, so manual
  // resize remains a hard floor while the primitive handles content height.

  onMount(() => {
    if (!textareaRef) return
    // Park the caret at the start of the input. Click-focus uses the click
    // position, so this only matters for keyboard-driven focus.
    try {
      textareaRef.setSelectionRange(0, 0)
    } catch {
      /* ignore — selection APIs throw on detached elements in some hosts */
    }
  })

  // ── Attachment handling ──

  async function addAttachment(file: File) {
    if (!canAcceptComposerAttachment()) return
    if (!file) return
    if (file.size > MAX_ATTACHMENT_SIZE) {
      console.warn("[ChatComposer] file too large:", file.name, file.size)
      const limitMb = (MAX_ATTACHMENT_SIZE / (1024 * 1024)).toFixed(0)
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1)
      void nativeMessage(t("chat.attach_too_large", { name: file.name, size: sizeMb, limit: limitMb }), {
        title: t("chat.attach_too_large_title"),
      })
      return
    }
    // audit-2026-04-29 W2-V18 — pre-fix the FileReader reject
    // (file deleted mid-read, EACCES on the OS handle, browser-
    // imposed quota error) propagated as a throw out of
    // `fileToDataUrl`. The drop/paste/file-input loop callers all
    // run `for (file of files) await addAttachment(file)`, so a
    // single failing file ABORTED the loop; subsequent files in
    // the same drag never got processed and the user saw no
    // error. Catch here so the loop continues with the next
    // file, and surface an actionable toast naming the file that
    // failed.
    let url: string
    try {
      url = await fileToDataUrl(file)
    } catch (err) {
      console.warn("[ChatComposer] FileReader failed for", file.name, err)
      void nativeMessage(t("chat.attach_read_failed", { name: file.name }), {
        title: t("chat.attach_too_large_title"),
      })
      return
    }
    if (wouldExceedAggregateLimit(attachments(), url.length)) {
      console.warn("[ChatComposer] aggregate attachment size exceeded:", url.length)
      const limitMb = (MAX_TOTAL_ATTACHMENT_SIZE / (1024 * 1024)).toFixed(0)
      const sizeMb = (url.length / (1024 * 1024)).toFixed(1)
      // Reuse the per-file too-large i18n string so we don't churn
      // the locale catalogues for a single new copy line; the user
      // sees the same actionable message ("attachment too big") with
      // the aggregate numbers.
      void nativeMessage(t("chat.attach_too_large", { name: file.name, size: sizeMb, limit: limitMb }), {
        title: t("chat.attach_too_large_title"),
      })
      return
    }
    // Clipboard paste hands us a synthesized File whose `name` is often
    // empty (Chromium) or an opaque "image.png" with no clue what was
    // copied. Empty/unsafe names propagate to the orchestrator inventory
    // and then surface to sub-agents as a 64-char sha — the operator
    // saw e.g. `529bae80…970.png` instead of "the image I pasted".
    // Fix at the single client-side seam (drop / paste / picker all flow
    // here per rule 9) so every downstream consumer gets a stable,
    // human-readable handle.
    const mime = file.type || "application/octet-stream"
    const filename = chooseAttachmentFilename(file.name, mime)
    setAttachments((prev) => [...prev, { mime, url, filename }])
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  // ── Submit ──

  function submitErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message
    return String(error)
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (props.busy) return
    if (submitting()) return
    if (!props.enabled) return
    const trimmed = text().trim()
    if (!trimmed) return
    const sentAttachments = [...attachments()]
    const submittedDraftKey = props.draftKey
    setSubmitting(true)
    try {
      await props.onSubmit(trimmed, sentAttachments, false, props.promptProfileID)
      setText("")
      clearComposerDraft(submittedDraftKey)
      setAttachments([])
      if (textareaRef) {
        textareaRef.value = ""
        try {
          textareaRef.setSelectionRange(0, 0)
        } catch {
          /* selection APIs may throw if the element has been detached */
        }
      }
    } catch (error) {
      console.error("[ChatComposer] submit failed", error)
      void nativeMessage(t("chat.send_failed", { error: submitErrorMessage(error) }), {
        title: t("chat.send_failed_title"),
        kind: "error",
      })
    } finally {
      setSubmitting(false)
    }
  }

  // ── Keyboard: Enter to send, Shift+Enter for newline ──

  function handleKeyDown(e: KeyboardEvent) {
    if (e.isComposing) return
    if (props.busy) return
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (!props.enabled) return
      formRef?.requestSubmit()
    }
  }

  // ── Drag-and-drop ──

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    if (!canAcceptComposerAttachment()) {
      setDragover(false)
      return
    }
    setDragover(true)
  }

  function handleDragLeave(e: DragEvent) {
    if (!(formRef as HTMLElement).contains(e.relatedTarget as Node)) {
      setDragover(false)
    }
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragover(false)
    if (!canAcceptComposerAttachment()) return
    const files = e.dataTransfer?.files
    if (!files) return
    for (const file of files) await addAttachment(file)
  }

  // ── Paste images ──

  async function handlePaste(e: ClipboardEvent) {
    const files = e.clipboardData?.files
    if (!files || !files.length) return
    e.preventDefault()
    if (!canAcceptComposerAttachment()) return
    for (const file of files) await addAttachment(file)
  }

  // ── Composer resize ──

  function currentUIScale(): number {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")
    const value = Number.parseFloat(raw)
    return Number.isFinite(value) && value > 0 ? value : 1
  }

  function handleResizePointerDown(e: PointerEvent) {
    if (e.button !== 0 || !textareaRef) return
    const handle = e.currentTarget as HTMLElement
    resizeSession = {
      pointerID: e.pointerId,
      startY: e.clientY,
      startHeight: textareaRef.getBoundingClientRect().height,
    }
    handle.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  function handleResizePointerMove(e: PointerEvent) {
    if (!resizeSession || resizeSession.pointerID !== e.pointerId || !formRef) return
    const scale = currentUIScale()
    const minHeight = 62 * scale
    const maxHeight = 260 * scale
    const nextHeight = Math.min(
      maxHeight,
      Math.max(minHeight, resizeSession.startHeight + resizeSession.startY - e.clientY),
    )
    formRef.style.setProperty("--chat-textarea-height", `${Math.round(nextHeight)}px`)
  }

  function handleResizePointerEnd(e: PointerEvent) {
    if (!resizeSession || resizeSession.pointerID !== e.pointerId) return
    const handle = e.currentTarget as HTMLElement
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
    resizeSession = undefined
  }

  // ── Send/Stop button rendering (mirrors renderChatComposer SVG logic) ──

  const sendDisabled = createMemo(() => {
    if (props.busy) return stopping()
    return submitting() || !props.enabled || !hasText()
  })

  // Surface WHY the send button is disabled in its title — operators
  // were left guessing whether grey meant "task busy", "no text yet", or
  // "permissions blocked". Order matches sendDisabled's predicate.
  const sendTitle = () => {
    if (props.busy) return t("chat.stop_title")
    if (!props.enabled) return t("chat.disabled_unavailable")
    if (!hasText()) return t("chat.disabled_empty")
    return t("chat.send_title")
  }
  const sendAriaLabel = () => (props.busy ? t("chat.stop_label") : t("chat.send_label"))
  const sendLabel = () => (props.busy ? t("chat.stop_label") : t("chat.send_label"))
  const selectedPromptProfile = createMemo(() => {
    return props.promptProfiles.find((profile) => profile.id === props.promptProfileID) ?? null
  })
  const promptProfileLabel = createMemo(() => {
    return selectedPromptProfile()?.label ?? props.promptProfileID
  })
  const promptProfileDisabled = createMemo(() => props.promptProfiles.length === 0 || !props.enabled || props.busy)

  function selectPromptProfile(profile: PromptProfileOption | null): void {
    if (!profile || profile.id === props.promptProfileID) return
    props.onPromptProfileChange(profile.id)
  }

  return (
    <form
      ref={formRef}
      id={props.formID ?? "chatForm"}
      class="chat-input"
      data-dragover={dragover() ? "true" : undefined}
      onSubmit={handleSubmit}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Attachments strip */}
      <Show when={canAcceptComposerAttachment() && attachments().length > 0}>
        <div class="chat-attachments" id="chatAttachments">
          <For each={attachments()}>
            {(att, index) => (
              <div class="chat-attachment-item" title={att.filename}>
                <Show
                  when={att.mime.startsWith("image/")}
                  fallback={
                    <span class="chat-attachment-icon">{att.filename?.split(".").pop()?.toUpperCase() || "FILE"}</span>
                  }
                >
                  <img class="chat-attachment-thumb" src={att.url} alt={att.filename} />
                </Show>
                <span class="chat-attachment-name">{att.filename || "file"}</span>
                <button
                  type="button"
                  class="chat-attachment-remove"
                  data-chrome="icon-action"
                  aria-label={t("chat.attachment.remove")}
                  onClick={() => removeAttachment(index())}
                >
                  &times;
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div
        class="chat-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("chat.resize_handle")}
        title={t("chat.resize_handle")}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd}
        onPointerCancel={handleResizePointerEnd}
      />

      {/* Compose row: textarea + send */}
      <div class="chat-compose-row">
        <div class="chat-textarea-wrap" title={t("chat.tip")}>
          <AutoGrowTextarea
            ref={(el) => {
              textareaRef = el
            }}
            id={props.textareaID ?? "chatTextarea"}
            class="chat-textarea"
            rows={2}
            disabled={!props.enabled}
            placeholder={props.enabled ? "" : t("chat.placeholder_disabled")}
            title={t("chat.tip")}
            value={text()}
            data-ui={props.textareaDataUI}
            onInput={(e) => {
              writeDraftText(e.currentTarget.value)
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />
          <Show when={showHint()}>
            <div class="chat-placeholder-float" aria-hidden="true">
              <span class="chat-placeholder-text">{hintText()}</span>
              <span class="chat-placeholder-caret" />
            </div>
          </Show>
        </div>

        {/* Send / Stop button */}
        <button
          id={props.busy ? (props.stopID ?? "btnTaskInterrupt") : (props.sendID ?? "chatSend")}
          class="chat-send"
          type={props.busy ? "button" : "submit"}
          data-ui={props.sendDataUI}
          data-busy={props.busy ? "true" : undefined}
          data-mode={props.busy ? "stop" : "send"}
          disabled={sendDisabled()}
          title={sendTitle()}
          aria-label={sendAriaLabel()}
          onClick={(e) => {
            if (props.busy) {
              e.preventDefault()
              props.onStop?.()
            }
          }}
        >
          <span class="chat-send-icon" aria-hidden="true">
            <Show when={props.busy} fallback={<Icon name="send" />}>
              <Icon name="stop" />
            </Show>
          </span>
          <span class="chat-send-label">{sendLabel()}</span>
        </button>
      </div>

      <Show when={showLargeRequestWarning()}>
        <div class="chat-input-warning" role="status" aria-live="polite">
          <Icon name="info-circle" size={13} />
          <span>{t("chat.large_input_warning")}</span>
        </div>
      </Show>

      {/* Compose meta (executor selector). The drag/resize tip is now a
       * native title on the textarea — appears only on hover so the row
       * stays clean. */}
      <div class="chat-compose-meta">
        <div class="chat-compose-meta-left">
          <Select.Root<PromptProfileOption>
            class="prompt-profile-select-wrap"
            options={props.promptProfiles}
            optionValue="id"
            optionTextValue="label"
            value={selectedPromptProfile()}
            onChange={selectPromptProfile}
            itemComponent={PromptProfileSelectOptionItem}
            disabled={promptProfileDisabled()}
            disallowEmptySelection
            gutter={4}
            sameWidth
          >
            <Select.Trigger
              class="oc-select-trigger prompt-profile-select-trigger"
              data-ui="prompt-profile-selector"
              aria-label={t("prompt_profile.selector_title")}
              title={t("prompt_profile.selector_title")}
            >
              <span class="prompt-profile-select-copy">
                <span class="prompt-profile-select-label">{t("prompt_profile.selector_label")}</span>
                <span class="prompt-profile-select-value">{promptProfileLabel()}</span>
              </span>
              <Select.Icon class="prompt-profile-select-caret">
                <Icon name="caret-down" size={9} />
              </Select.Icon>
            </Select.Trigger>
            <Select.HiddenSelect aria-label={t("prompt_profile.selector_title")} />
            <Select.Portal>
              <Select.Content class="oc-select-content prompt-profile-select-content">
                <Select.Listbox class="oc-select-listbox prompt-profile-select-listbox" />
              </Select.Content>
            </Select.Portal>
          </Select.Root>
          <ExecutorSelector />
        </div>
      </div>
    </form>
  )
}
