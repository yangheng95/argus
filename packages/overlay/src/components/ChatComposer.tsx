// ── ChatComposer Component ──
// Solid.js port of renderChatComposer / renderChatAttachments / chatForm submit
// and related attachment/keyboard logic

import { createSignal, createMemo, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import { t, tArray } from "../utils/i18n";
import { ExecutorSelector } from "./ExecutorSelector";
import { nativeMessage } from "../services/app-dialog";
import { messageStore, setChatAttachments } from "../store/messages";
import {
  MAX_ATTACHMENT_SIZE,
  MAX_TOTAL_ATTACHMENT_SIZE,
  wouldExceedAggregateLimit,
} from "../services/chat-attach-limits";
import { fileToDataUrl } from "../services/file-to-data-url";

// ── Types ──

export interface ChatAttachment {
  mime: string;
  url: string;
  filename: string;
}

export interface ChatComposerProps {
  /**
 * Whether the composer should be interactive.
 */
  enabled: boolean;
  /**
 * Whether a task is active (in-flight request or interruptable task status).
 * When true the send button becomes a stop button.
 */
  busy: boolean;
  /**
 * Whether the busy request is being stopped (transitional state).
 */
  stopping?: boolean;
  /** Called when the user submits a message. */
  onSubmit: (text: string, attachments: ChatAttachment[], webSearch: boolean) => void;
  /** Called when the user clicks the stop button while busy. */
  onStop?: () => void;
  /**
   * One-shot suggestion to inject into the empty composer (used after a
   * task finishes — parent provides an LLM-generated follow-up). Written
   * into the textarea only when the current text is empty so we never
   * overwrite the user's in-progress input.
   */
  pendingSuggestion?: string;
  /** Called once the pending suggestion has been applied (or intentionally
   *  dropped because the user was already typing). Parent should clear its
   *  signal to avoid re-applying the same suggestion. */
  onSuggestionConsumed?: () => void;
}

// ── Constants ──

// MAX_ATTACHMENT_SIZE / MAX_TOTAL_ATTACHMENT_SIZE imported from
// services/chat-attach-limits (audit W2-V15) so the cap can be
// unit-tested without rendering the component.

const FILE_ACCEPT = [
  "image/*",
  ".pdf",
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".xml",
  ".yaml",
  ".yml",
  ".log",
  ".ts",
  ".js",
  ".py",
  ".go",
  ".rs",
  ".c",
  ".cpp",
  ".h",
  ".java",
  ".rb",
  ".sh",
  ".bat",
  ".ps1",
  ".html",
  ".css",
  ".sql",
  ".toml",
].join(",");

// ── Helpers ──
//
// fileToDataUrl moved to services/file-to-data-url so the V18 catch
// pattern in addAttachment is unit-testable via a FileReader factory
// override (Bun test runner has no jsdom).

// ── Component ──

export function ChatComposer(props: ChatComposerProps) {
  let textareaRef!: HTMLTextAreaElement;
  let fileInputRef!: HTMLInputElement;
  let formRef!: HTMLFormElement;

  const [text, setText] = createSignal("");
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
  const attachments = () => messageStore.chatAttachments as ChatAttachment[];
  const setAttachments = (next: ChatAttachment[] | ((prev: ChatAttachment[]) => ChatAttachment[])) => {
    const nextValue = typeof next === "function"
      ? (next as (prev: ChatAttachment[]) => ChatAttachment[])(attachments())
      : next;
    setChatAttachments(nextValue);
  };
  const [dragover, setDragover] = createSignal(false);
  const [webSearch, setWebSearch] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const [hintText, setHintText] = createSignal("");

  const hasText = createMemo(() => text().trim().length > 0);
  const stopping = () => props.stopping === true;

  // ── Rotating placeholder ──
  // Cycles through a shuffled list of project-level examples while the
  // composer sits idle (empty + unfocused). One signal write per rotation;
  // no per-character typewriter. The previous 28–60ms typewriter loop wrote
  // 20–70 signal-driven DOM mutations per second the entire time the
  // composer was visible — Tauri's transparent WebView2 then alpha-blended
  // the desktop on every frame, dominating idle power draw on laptops.
  let rotateTimer: ReturnType<typeof setInterval> | undefined;
  let hintOrder: number[] = [];
  let hintCursor = 0;
  const ROTATE_MS = 7_000;

  function shuffleIndices(n: number): number[] {
    const arr = Array.from({ length: n }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function stopHint() {
    if (rotateTimer) {
      clearInterval(rotateTimer);
      rotateTimer = undefined;
    }
  }

  function startRotate(examples: string[]) {
    stopHint();
    if (examples.length === 0) {
      setHintText("");
      return;
    }
    if (hintOrder.length !== examples.length) {
      hintOrder = shuffleIndices(examples.length);
      hintCursor = 0;
    }
    setHintText(examples[hintOrder[hintCursor % hintOrder.length]!]!);
    if (examples.length === 1) return;
    rotateTimer = setInterval(() => {
      hintCursor = (hintCursor + 1) % hintOrder.length;
      setHintText(examples[hintOrder[hintCursor]!]!);
    }, ROTATE_MS);
  }

  const showHint = createMemo(
    () => props.enabled && !props.busy && !focused() && text().length === 0,
  );

  createEffect(() => {
    const examples = tArray("chat.placeholder_projects");
    if (showHint() && examples.length > 0) {
      startRotate(examples);
    } else {
      stopHint();
      setHintText("");
    }
  });

  // Pause rotation when the overlay window is hidden / minimized — the user
  // is not looking, and Tauri's WebView2 still wakes the JS event loop on
  // setInterval ticks. visibilitychange covers minimize / alt-tab on Windows.
  if (typeof document !== "undefined") {
    const onVisibility = () => {
      if (document.hidden) {
        stopHint();
      } else {
        const examples = tArray("chat.placeholder_projects");
        if (showHint() && examples.length > 0) startRotate(examples);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    onCleanup(() => document.removeEventListener("visibilitychange", onVisibility));
  }

  onCleanup(() => stopHint());

  // ── Pending suggestion injection ──
  // When the parent supplies a non-empty suggestion and the composer is
  // idle & empty, pre-fill the textarea so the user can tweak or send.
  // Either way, call onSuggestionConsumed so the parent clears its signal
  // and we don't re-apply on subsequent unrelated re-renders.
  createEffect(() => {
    const pending = props.pendingSuggestion?.trim();
    if (!pending) return;
    if (!props.enabled || props.busy) return;
    if (text().length === 0) {
      setText(pending);
      if (textareaRef) textareaRef.value = pending;
    }
    props.onSuggestionConsumed?.();
  });

 // ── Attachment handling ──

  async function addAttachment(file: File) {
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_SIZE) {
      console.warn("[ChatComposer] file too large:", file.name, file.size);
      const limitMb = (MAX_ATTACHMENT_SIZE / (1024 * 1024)).toFixed(0);
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      void nativeMessage(t("chat.attach_too_large", { name: file.name, size: sizeMb, limit: limitMb }), {
        title: t("chat.attach_too_large_title"),
      });
      return;
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
      url = await fileToDataUrl(file);
    } catch (err) {
      console.warn("[ChatComposer] FileReader failed for", file.name, err);
      void nativeMessage(t("chat.attach_read_failed", { name: file.name }), {
        title: t("chat.attach_too_large_title"),
      });
      return;
    }
    if (wouldExceedAggregateLimit(attachments(), url.length)) {
      console.warn("[ChatComposer] aggregate attachment size exceeded:", url.length);
      const limitMb = (MAX_TOTAL_ATTACHMENT_SIZE / (1024 * 1024)).toFixed(0);
      const sizeMb = (url.length / (1024 * 1024)).toFixed(1);
      // Reuse the per-file too-large i18n string so we don't churn
      // the locale catalogues for a single new copy line; the user
      // sees the same actionable message ("attachment too big") with
      // the aggregate numbers.
      void nativeMessage(t("chat.attach_too_large", { name: file.name, size: sizeMb, limit: limitMb }), {
        title: t("chat.attach_too_large_title"),
      });
      return;
    }
    setAttachments((prev) => [
      ...prev,
      { mime: file.type || "application/octet-stream", url, filename: file.name },
    ]);
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

 // ── Submit ──

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (props.busy) return;
    if (!props.enabled) return;
    const trimmed = text().trim();
    if (!trimmed) return;
    const sentAttachments = [...attachments()];
    setText("");
    setAttachments([]);
    setExpanded(false);
    if (textareaRef) textareaRef.value = "";
    props.onSubmit(trimmed, sentAttachments, webSearch());
  }

 // ── Keyboard: Enter to send, Shift+Enter for newline ──

  function handleKeyDown(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (props.busy) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!props.enabled) return;
      formRef?.requestSubmit();
    }
  }

 // ── File input change ──

  async function handleFileChange() {
    const files = fileInputRef?.files;
    if (!files) return;
    for (const file of files) await addAttachment(file);
    if (fileInputRef) fileInputRef.value = "";
  }

 // ── Drag-and-drop ──

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    setDragover(true);
  }

  function handleDragLeave(e: DragEvent) {
    if (!(formRef as HTMLElement).contains(e.relatedTarget as Node)) {
      setDragover(false);
    }
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragover(false);
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (const file of files) await addAttachment(file);
  }

 // ── Paste images ──

  async function handlePaste(e: ClipboardEvent) {
    const files = e.clipboardData?.files;
    if (!files || !files.length) return;
    e.preventDefault();
    for (const file of files) await addAttachment(file);
  }

 // ── Send/Stop button rendering (mirrors renderChatComposer SVG logic) ──

  const sendDisabled = createMemo(() => {
    if (props.busy) return stopping();
    return !props.enabled || !hasText();
  });

  // Surface WHY the send button is disabled in its title — operators
  // were left guessing whether grey meant "task busy", "no text yet", or
  // "permissions blocked". Order matches sendDisabled's predicate.
  const sendTitle = () => {
    if (props.busy) return t("chat.stop_title");
    if (!props.enabled) return t("chat.disabled_unavailable");
    if (!hasText()) return t("chat.disabled_empty");
    return t("chat.send_title");
  };
  const sendAriaLabel = () => (props.busy ? t("chat.stop_label") : t("chat.send_label"));
  const sendLabel = () => (props.busy ? t("chat.stop_label") : t("chat.send_label"));

  return (
    <form
      ref={formRef}
      id="chatForm"
      class="chat-input"
      data-dragover={dragover() ? "true" : undefined}
      onSubmit={handleSubmit}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Attachments strip */}
      <Show when={attachments().length > 0}>
        <div class="chat-attachments" id="chatAttachments">
          <For each={attachments()}>
            {(att, index) => (
              <div class="chat-attachment-item" title={att.filename}>
                <Show
                  when={att.mime.startsWith("image/")}
                  fallback={
                    <span class="chat-attachment-icon">
                      {att.filename?.split(".").pop()?.toUpperCase() || "FILE"}
                    </span>
                  }
                >
                  <img
                    class="chat-attachment-thumb"
                    src={att.url}
                    alt={att.filename}
                  />
                </Show>
                <span class="chat-attachment-name">{att.filename || "file"}</span>
                <button
                  type="button"
                  class="chat-attachment-remove"
                  aria-label="Remove"
                  onClick={() => removeAttachment(index())}
                >
                  &times;
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        id="chatFileInput"
        type="file"
        multiple
        accept={FILE_ACCEPT}
        hidden
        onChange={handleFileChange}
      />

      {/* Compose row: executor + textarea + actions + send */}
      <div class="chat-compose-row">
        <ExecutorSelector />

        <div class="chat-textarea-wrap" data-expanded={expanded() ? "true" : undefined}>
          <textarea
            ref={textareaRef}
            id="chatTextarea"
            class="chat-textarea"
            data-expanded={expanded() ? "true" : undefined}
            rows={2}
            disabled={!props.enabled}
            placeholder={props.enabled ? "" : t("chat.placeholder_disabled")}
            value={text()}
            onInput={(e) => {
              setText(e.currentTarget.value);
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

        {/* Actions: attach / web search / expand */}
        <div class="chat-actions-row" data-disabled={!props.enabled ? "true" : undefined}>
          <button
            type="button"
            id="btnChatAttach"
            class="chat-toolbar-btn"
            title={t("chat.attach_title")}
            aria-label={t("chat.attach_title")}
            onClick={() => fileInputRef?.click()}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M13.5 7.5l-5.8 5.8a3.2 3.2 0 01-4.5-4.5L9 3a2 2 0 012.8 2.8L6 11.6a.8.8 0 01-1.1-1.1L10.5 5"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            id="btnWebSearch"
            class="chat-toolbar-btn"
            data-active={webSearch() ? "true" : undefined}
            title={t("chat.web_search_title")}
            aria-label={t("chat.web_search_title")}
            aria-pressed={webSearch()}
            onClick={() => setWebSearch((v) => !v)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/>
              <path
                d="M8 1.5C8 1.5 5.5 4.5 5.5 8S8 14.5 8 14.5M8 1.5C8 1.5 10.5 4.5 10.5 8S8 14.5 8 14.5"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path d="M1.5 8h13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
          </button>
          <button
            type="button"
            class="chat-toolbar-btn"
            data-active={expanded() ? "true" : undefined}
            title={expanded() ? t("chat.collapse_title") : t("chat.expand_title")}
            aria-label={expanded() ? t("chat.collapse_title") : t("chat.expand_title")}
            aria-pressed={expanded()}
            onClick={() => setExpanded((v) => !v)}
          >
            <Show
              when={expanded()}
              fallback={
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              }
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </Show>
          </button>
        </div>

        {/* Send / Stop button */}
        <button
          id={props.busy ? "btnTaskInterrupt" : "chatSend"}
          class={`chat-send${props.busy ? " chat-interrupt" : ""}`}
          type={props.busy ? "button" : "submit"}
          data-mode={props.busy ? "stop" : "send"}
          disabled={sendDisabled()}
          title={sendTitle()}
          aria-label={sendAriaLabel()}
          onClick={(e) => {
            if (props.busy) {
              e.preventDefault();
              props.onStop?.();
            }
          }}
        >
          <span class="chat-send-icon" aria-hidden="true">
            <Show
              when={props.busy}
              fallback={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 8l10-5-3 5 3 5z" fill="currentColor" />
                </svg>
              }
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect
                  x="4.25"
                  y="4.25"
                  width="7.5"
                  height="7.5"
                  rx="1.2"
                  fill="currentColor"
                />
              </svg>
            </Show>
          </span>
          <span class="chat-send-label">{sendLabel()}</span>
        </button>
      </div>
    </form>
  );
}
