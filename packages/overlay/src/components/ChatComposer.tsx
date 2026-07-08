// ── ChatComposer Component ──
// Solid.js port of renderChatComposer / renderChatAttachments / chatForm submit
// and related attachment/keyboard logic

import { createSignal, createMemo, createEffect, For, Show, onCleanup, onMount } from "solid-js"
import type { JSX } from "solid-js"
import { t, tArray } from "../utils/i18n"
import { nativeMessage } from "../services/app-dialog"
import { formatErrorDetails, notifyError } from "../services/notify"
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
import { Button } from "./ui/Button"
import { SelectControl } from "./ui/SelectControl"
import {
  clampComposerTextareaHeight,
  composerTextareaResizeBounds,
  nextComposerTextareaKeyboardHeight,
} from "./composer-resizer"
import {
  clearComposerDraft,
  composerDraftText,
  normalizeComposerDraftKey,
  setComposerDraft,
} from "../services/composer-draft"
import type { ExpertSquadOption } from "../services/expert-squad"
import { currentUIScale } from "../utils/layout-tokens"
import { ComposerModelSelector } from "./ExecutorSelector"

// ── Types ──

export interface ChatAttachment {
  mime: string
  url: string
  filename: string
}

export type { ExpertSquadOption } from "../services/expert-squad"

export type ComposerMode = "mission" | "chat"

interface ComposerModeOption {
  id: ComposerMode
  label: string
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
    expertSquadID: string,
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
  expertSquads: ExpertSquadOption[]
  expertSquadID: string
  onExpertSquadChange: (expertSquadID: string) => void
  composerMode: ComposerMode
  onComposerModeChange: (mode: ComposerMode) => void
}

function composerDialogErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function showComposerMessage(
  owner: string,
  message: string,
  options: { title?: string; kind?: string; okLabel?: string } = {},
): void {
  void nativeMessage(message, options).catch((error) => {
    notifyError({
      id: `chat-composer:${owner}`,
      title: t("common.error"),
      message: composerDialogErrorMessage(error),
      details: formatErrorDetails(error),
    })
  })
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

const SUPPORTED_COMPOSER_FILE_ACCEPT = [
  "image/*",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
  "application/xml",
  "text/xml",
  "application/zip",
  "application/gzip",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".c",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".doc",
  ".docx",
  ".env",
  ".gif",
  ".go",
  ".gz",
  ".heic",
  ".heif",
  ".hpp",
  ".html",
  ".java",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".kt",
  ".log",
  ".md",
  ".markdown",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".ps1",
  ".py",
  ".rs",
  ".rtf",
  ".sh",
  ".sql",
  ".svg",
  ".tar",
  ".tgz",
  ".toml",
  ".ts",
  ".tsx",
  ".tsv",
  ".txt",
  ".webp",
  ".xls",
  ".xlsx",
  ".xml",
  ".yaml",
  ".yml",
  ".zip",
].join(",")

interface ComposerAttachmentLoadersProps {
  disabled: boolean
  attachmentCount: number
  onFiles: (files: readonly File[]) => void | Promise<void>
  onFolderFiles: (files: readonly File[]) => void | Promise<void>
}

function ComposerAttachmentLoaders(props: ComposerAttachmentLoadersProps): JSX.Element {
  let fileInputRef: HTMLInputElement | undefined
  let folderInputRef: HTMLInputElement | undefined

  function openFilePicker(event: MouseEvent): void {
    event.preventDefault()
    if (props.disabled) return
    fileInputRef?.click()
  }

  function openFolderPicker(event: MouseEvent): void {
    event.preventDefault()
    if (props.disabled) return
    folderInputRef?.click()
  }

  function bindFolderInput(input: HTMLInputElement): void {
    folderInputRef = input
    input.setAttribute("webkitdirectory", "")
  }

  function handleFileSelection(event: Event): void {
    const input = event.currentTarget as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ""
    if (files.length === 0) return
    void props.onFiles(files)
  }

  function handleFolderSelection(event: Event): void {
    const input = event.currentTarget as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ""
    if (files.length === 0) return
    void props.onFolderFiles(files)
  }

  return (
    <div class="composer-attachment-loaders" data-ui="composer-attachment-loaders">
      <input
        ref={fileInputRef}
        class="composer-attachment-input"
        data-ui="composer-file-input"
        type="file"
        multiple
        accept={SUPPORTED_COMPOSER_FILE_ACCEPT}
        disabled={props.disabled}
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleFileSelection}
      />
      <input
        ref={bindFolderInput}
        class="composer-attachment-input"
        data-ui="composer-folder-input"
        type="file"
        multiple
        disabled={props.disabled}
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleFolderSelection}
      />
      <Show when={props.attachmentCount > 0}>
        <span class="composer-attachment-loader-count" role="status" aria-live="polite">
          {t("chat.attachment_loader.count", { count: props.attachmentCount })}
        </span>
      </Show>
      <Button
        variant="ghost"
        size="icon"
        tone="neutral"
        type="button"
        class="composer-attachment-loader-trigger"
        data-ui="composer-file-loader-trigger"
        disabled={props.disabled}
        title={t("chat.attachment_loader.file_title")}
        aria-label={t("chat.attachment_loader.file_title")}
        onClick={openFilePicker}
      >
        <Icon name="attach" size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        tone="neutral"
        type="button"
        class="composer-attachment-loader-trigger"
        data-ui="composer-folder-loader-trigger"
        disabled={props.disabled}
        title={t("chat.attachment_loader.folder_title")}
        aria-label={t("chat.attachment_loader.folder_title")}
        onClick={openFolderPicker}
      >
        <Icon name="folder-open" size={14} />
      </Button>
    </div>
  )
}

function chooseAttachmentFilename(original: string | undefined, mime: string): string {
  if (original && SAFE_FILENAME_RE.test(original)) return original
  const ext = PASTE_EXT_BY_MIME[mime] ?? (mime.split("/")[1] ?? "bin").replace(/[^A-Za-z0-9]/g, "")
  // Stamp lets the operator distinguish multiple pastes within one
  // composer session at a glance — sha-style handles all blur together.
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").replace(/\..+/, "")
  return `pasted-${stamp}.${ext || "bin"}`
}

function safeFolderAttachmentSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._\-一-鿿 ]+/g, " ").replace(/\s+/g, " ").trim()
}

function folderAttachmentFilename(file: File, mime: string): string | undefined {
  const relativePath = file.webkitRelativePath.trim()
  if (!relativePath) return undefined
  const segments = relativePath
    .split(/[\\/]+/)
    .map((segment) => safeFolderAttachmentSegment(segment))
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  if (segments.length === 0) return undefined
  return chooseAttachmentFilename(segments.join(" - "), mime)
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
  const [textareaResizeHeight, setTextareaResizeHeight] = createSignal<number | null>(null)
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
  // composer was visible, which dominated idle WebView composition cost on
  // laptops for a purely decorative affordance.
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

  async function addAttachment(file: File, displayName?: string) {
    if (!canAcceptComposerAttachment()) return
    if (!file) return
    const sourceName = displayName || file.name
    if (file.size > MAX_ATTACHMENT_SIZE) {
      console.warn("[ChatComposer] file too large:", sourceName, file.size)
      const limitMb = (MAX_ATTACHMENT_SIZE / (1024 * 1024)).toFixed(0)
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1)
      showComposerMessage(
        "attachment-too-large",
        t("chat.attach_too_large", { name: sourceName, size: sizeMb, limit: limitMb }),
        {
          title: t("chat.attach_too_large_title"),
        },
      )
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
      console.warn("[ChatComposer] FileReader failed for", sourceName, err)
      showComposerMessage("attachment-read-failed", t("chat.attach_read_failed", { name: sourceName }), {
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
      showComposerMessage(
        "attachment-total-too-large",
        t("chat.attach_too_large", { name: sourceName, size: sizeMb, limit: limitMb }),
        {
          title: t("chat.attach_too_large_title"),
        },
      )
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
    const filename = chooseAttachmentFilename(sourceName, mime)
    setAttachments((prev) => [...prev, { mime, url, filename }])
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  async function addFiles(files: readonly File[]): Promise<void> {
    for (const file of files) await addAttachment(file)
  }

  async function addFolderFiles(files: readonly File[]): Promise<void> {
    for (const file of files) {
      const mime = file.type || "application/octet-stream"
      const filename = folderAttachmentFilename(file, mime)
      if (!filename) {
        showComposerMessage("attachment-folder-path-missing", t("chat.attach_folder_path_missing", { name: file.name }), {
          title: t("chat.attach_folder_path_missing_title"),
        })
        continue
      }
      await addAttachment(file, filename)
    }
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
      await props.onSubmit(trimmed, sentAttachments, false, props.expertSquadID)
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
      showComposerMessage("send-failed", t("chat.send_failed", { error: submitErrorMessage(error) }), {
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

  function textareaResizeBounds() {
    return composerTextareaResizeBounds(currentUIScale())
  }

  function currentTextareaResizeHeight(): number {
    const bounds = textareaResizeBounds()
    const height = textareaResizeHeight()
    return clampComposerTextareaHeight(height ?? bounds.min, bounds)
  }

  function applyTextareaResizeHeight(height: number) {
    if (!formRef) return
    const nextHeight = clampComposerTextareaHeight(height, textareaResizeBounds())
    setTextareaResizeHeight(nextHeight)
    formRef.style.setProperty("--chat-textarea-height", `${nextHeight}px`)
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
    applyTextareaResizeHeight(resizeSession.startHeight + resizeSession.startY - e.clientY)
  }

  function handleResizePointerEnd(e: PointerEvent) {
    if (!resizeSession || resizeSession.pointerID !== e.pointerId) return
    const handle = e.currentTarget as HTMLElement
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
    resizeSession = undefined
  }

  function handleResizeKeyDown(e: KeyboardEvent) {
    const nextHeight = nextComposerTextareaKeyboardHeight(currentTextareaResizeHeight(), e.key, textareaResizeBounds())
    if (nextHeight === undefined) return
    e.preventDefault()
    applyTextareaResizeHeight(nextHeight)
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
  const selectedExpertSquad = createMemo(() => {
    return props.expertSquads.find((squad) => squad.id === props.expertSquadID) ?? null
  })
  const expertSquadLabel = createMemo(() => {
    return selectedExpertSquad()?.display_label ?? props.expertSquadID
  })
  const expertSquadDisabled = createMemo(() => props.expertSquads.length === 0 || !props.enabled || props.busy)
  const composerModeOptions = createMemo<ComposerModeOption[]>(() => [
    { id: "chat", label: t("work_ledger.kind.chat") },
    { id: "mission", label: t("work_ledger.kind.mission") },
  ])
  const selectedComposerMode = createMemo(() => {
    return composerModeOptions().find((option) => option.id === props.composerMode) ?? composerModeOptions()[0]!
  })

  function selectExpertSquad(squad: ExpertSquadOption | null): void {
    if (!squad || squad.id === props.expertSquadID) return
    props.onExpertSquadChange(squad.id)
  }

  function selectComposerMode(option: ComposerModeOption | null): void {
    if (!option || option.id === props.composerMode) return
    props.onComposerModeChange(option.id)
  }

  return (
    <div class="chat-composer-stack">
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
                <Button
                  variant="ghost"
                  size="icon"
                  tone="neutral"
                  type="button"
                  data-ui="chat-attachment-remove"
                  data-chrome="icon-action"
                  aria-label={t("chat.attachment.remove")}
                  onClick={() => removeAttachment(index())}
                >
                  <Icon name="close" size={12} />
                </Button>
              </div>
            )}
          </For>
        </div>
      </Show>

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
        <div
          class="chat-resize-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-controls={props.textareaID ?? "chatTextarea"}
          aria-label={t("chat.resize_handle")}
          aria-valuemin={Math.round(textareaResizeBounds().min)}
          aria-valuemax={Math.round(textareaResizeBounds().max)}
          aria-valuenow={currentTextareaResizeHeight()}
          tabIndex={0}
          title={t("chat.resize_handle")}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          onPointerCancel={handleResizePointerEnd}
          onKeyDown={handleResizeKeyDown}
        />

        {/* Compose row: textarea only; all actions live in the bottom toolbar. */}
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
        </div>

        <Show when={showLargeRequestWarning()}>
          <div class="chat-input-warning" role="status" aria-live="polite">
            <Icon name="info-circle" size={13} />
            <span>{t("chat.large_input_warning")}</span>
          </div>
        </Show>

        {/* Compose meta. The drag/resize tip is now a
         * native title on the textarea — appears only on hover so the row
         * stays clean. */}
        <div class="chat-compose-meta">
          <div class="chat-compose-meta-left">
            <SelectControl<ComposerModeOption>
              class="composer-mode-select-wrap"
              options={composerModeOptions()}
              value={selectedComposerMode()}
              onChange={selectComposerMode}
              optionValue="id"
              optionTextValue={(option) => option.label}
              disabled={!props.enabled || props.busy}
              disallowEmptySelection
              gutter={4}
              sameWidth={false}
              triggerClass="composer-mode-select-trigger"
              triggerDataUI="composer-mode-selector"
              triggerTitle={t("work_ledger.mode_selector_title")}
              ariaLabel={t("work_ledger.mode_selector_title")}
              contentClass="composer-mode-select-content"
              listboxClass="composer-mode-select-listbox"
              optionClass="composer-mode-select-option"
              optionCopyClass="composer-mode-select-option-copy"
              iconClass="composer-mode-select-caret"
              icon={null}
              optionData={(option) => ({
                "data-composer-mode": option.id,
                title: option.label,
              })}
              renderValue={() => (
                <span class="composer-mode-select-copy">
                  <span class="composer-mode-select-label">{t("work_ledger.mode_selector_label")}</span>
                  <span class="composer-mode-select-value">{selectedComposerMode().label}</span>
                </span>
              )}
              renderOptionLabel={(option) => option.label}
            />
            <SelectControl<ExpertSquadOption>
              class="expert-squad-select-wrap"
              options={props.expertSquads}
              value={selectedExpertSquad()}
              onChange={selectExpertSquad}
              optionValue="id"
              optionTextValue={(option) => option.display_label}
              disabled={expertSquadDisabled()}
              disallowEmptySelection
              gutter={4}
              sameWidth={false}
              triggerClass="expert-squad-select-trigger"
              triggerDataUI="expert-squad-selector"
              triggerTitle={t("expert_squad.selector_title")}
              ariaLabel={t("expert_squad.selector_title")}
              contentClass="expert-squad-select-content"
              listboxClass="expert-squad-select-listbox"
              optionClass="expert-squad-select-option"
              optionCopyClass="expert-squad-select-option-copy"
              iconClass="expert-squad-select-caret"
              icon={null}
              optionData={(option) => ({
                "data-squad-id": option.id,
                title: option.description ?? option.display_label,
              })}
              renderValue={() => (
                <span class="expert-squad-select-copy">
                  <span class="expert-squad-select-label">{t("expert_squad.selector_label")}</span>
                  <span class="expert-squad-select-value">{expertSquadLabel()}</span>
                </span>
              )}
              renderOptionLabel={(option) => option.display_label}
              renderOptionDescription={(option) => option.description}
            />
            <ComposerModelSelector />
          </div>
          <div class="chat-compose-meta-right">
            <ComposerAttachmentLoaders
              disabled={!canAcceptComposerAttachment()}
              attachmentCount={attachments().length}
              onFiles={addFiles}
              onFolderFiles={addFolderFiles}
            />
            {/* Send / Stop button */}
            <Button
              id={props.busy ? (props.stopID ?? "btnTaskInterrupt") : (props.sendID ?? "chatSend")}
              variant="solid"
              size="md"
              tone={props.busy ? "danger" : "accent"}
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
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
