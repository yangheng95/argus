// ── ChatComposer Component ──
// Solid.js port of renderChatComposer / renderChatAttachments / chatForm submit
// and related attachment/keyboard logic

import { createSignal, createMemo, For, Show, onMount, onCleanup } from "solid-js";
import { t } from "../utils/i18n";

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
  onSubmit: (text: string, attachments: ChatAttachment[]) => void;
  /** Called when the user clicks the stop button while busy. */
  onStop?: () => void;
}

// ── Constants ──

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MiB

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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Component ──

export function ChatComposer(props: ChatComposerProps) {
  let textareaRef!: HTMLTextAreaElement;
  let fileInputRef!: HTMLInputElement;
  let formRef!: HTMLFormElement;

  const [text, setText] = createSignal("");
  const [attachments, setAttachments] = createSignal<ChatAttachment[]>([]);
  const [dragover, setDragover] = createSignal(false);

  const hasText = createMemo(() => text().trim().length > 0);
  const stopping = () => props.stopping === true;

 // ── Auto-resize textarea (

  function sizeTextarea() {
    if (!textareaRef) return;
    textareaRef.style.height = "auto";
    const style = getComputedStyle(document.documentElement);
    const min = Number.parseFloat(style.getPropertyValue("--ui-chat-min-height")) || 72;
    const max = Number.parseFloat(style.getPropertyValue("--ui-chat-max-height")) || 180;
    const h = Math.min(textareaRef.scrollHeight, max);
    textareaRef.style.height = `${Math.max(h, min)}px`;
  }

 // ── Attachment handling ──

  async function addAttachment(file: File) {
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_SIZE) {
 // Surface a notice; callers may hook into a global notification system.
 // For now we log and bail — the showLlmNotice here.
      console.warn("[ChatComposer] file too large:", file.name, file.size);
      return;
    }
    const url = await fileToDataUrl(file);
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
 // Clear state immediately (
    setText("");
    setAttachments([]);
 // Resize back to minimum
    if (textareaRef) {
      textareaRef.value = "";
      sizeTextarea();
    }
    props.onSubmit(trimmed, sentAttachments);
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

  const sendTitle = () => (props.busy ? t("chat.stop_title") : t("chat.send_title"));
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

      {/* Compose row */}
      <div class="chat-compose-row">
        <textarea
          ref={textareaRef}
          id="chatTextarea"
          class="chat-textarea"
          rows={2}
          disabled={!props.enabled}
          placeholder={props.enabled ? t("chat.placeholder") : t("chat.placeholder_disabled")}
          value={text()}
          onInput={(e) => {
            setText(e.currentTarget.value);
            sizeTextarea();
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <div class="chat-compose-actions">
          {/* Attach button */}
          <button
            type="button"
            id="btnChatAttach"
            class="chat-attach-btn"
            title={t("chat.attach_title")}
            aria-label={t("chat.attach_title")}
            onClick={() => fileInputRef?.click()}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M13.5 7.5l-5.8 5.8a3.2 3.2 0 01-4.5-4.5L9 3a2 2 0 012.8 2.8L6 11.6a.8.8 0 01-1.1-1.1L10.5 5"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>

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
      </div>

      {/* Compose meta (version/author + tip) */}
      <div class="chat-compose-meta">
        <div class="chat-compose-meta-left">
          <span class="chat-version" id="chatVersion"></span>
          <span class="chat-author">
            <a href="https://github.com/yangheng95/argus" target="_blank" rel="noopener">@yangheng95</a>
          </span>
        </div>
        <div class="chat-compose-tip">{t("chat.tip")}</div>
      </div>
    </form>
  );
}
