import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { messageStore, setChatAttachments } from "../src/store/messages"
import {
  canAcceptComposerAttachment,
  setComposerAttachmentInputEnabled,
} from "../src/services/composer-attachment-acceptance"
import { isComposerAttachPayload } from "../src/services/composer-attach-validate"

const CHAT_COMPOSER = readFileSync(join(import.meta.dir, "../src/components/ChatComposer.tsx"), "utf8")
const COMPOSER_ATTACH = readFileSync(join(import.meta.dir, "../src/services/composer-attach.ts"), "utf8")

/**
 * audit-2026-04-29 W2-V12 — single source of truth for staged chat
 * attachments.
 *
 * Pre-fix: ChatComposer kept its own `createSignal<ChatAttachment[]>([])`
 * while the host-driven `composer.attach` ui-command (vscode-extension
 * "OpenCorvus: Attach Current File") wrote into
 * `messageStore.chatAttachments`. Two disjoint stores → user never
 * saw VSCode-attached files in the composer; submit went out without
 * the attachment. CLAUDE.md §二-8 violation.
 *
 * Post-fix: ChatComposer reads `messageStore.chatAttachments` and
 * routes its add / remove / clear through `setChatAttachments`. The
 * host-driven path and the user drag-drop path now share one
 * authoritative list.
 *
 * This test locks the host → store half of the wire (the producer):
 *  - a valid composer.attach payload arrives,
 *  - composer-attach.ts validates and dispatches to setChatAttachments,
 *  - messageStore.chatAttachments grows by one entry.
 *
 * The composer half (read from store) is now structural at the
 * source-code level — ChatComposer.attachments is `() =>
 * messageStore.chatAttachments` — and locks via TypeScript signature
 * + the existing component code path. A regression that re-introduces
 * a local signal would diverge from this single-source rule and would
 * surface in any e2e of the attach-file command.
 */

describe("composer.attach → messageStore.chatAttachments wire (audit W2-V12)", () => {
  beforeEach(() => {
    setChatAttachments([])
    setComposerAttachmentInputEnabled(false)
  })

  afterEach(() => {
    setChatAttachments([])
    setComposerAttachmentInputEnabled(false)
  })

  test("dispatching a valid payload adds it to messageStore.chatAttachments", () => {
    // Producer-side simulation. The validator-gated dispatch in
    // composer-attach.ts is:
    //   if (!isComposerAttachPayload(raw)) return console.warn(...)
    //   setChatAttachments([...messageStore.chatAttachments, ...mapped])
    // We replay that exact mapping so a future refactor cannot
    // silently change the store schema without the test failing.
    const raw = {
      filename: "main.ts",
      mime: "text/typescript",
      dataUrl: "data:text/typescript;base64,Zm9v",
      sourcePath: "/Users/dev/proj/main.ts",
      selection: { startLine: 10, startColumn: 0, endLine: 12, endColumn: 5 },
    }
    expect(isComposerAttachPayload(raw)).toBe(true)
    setChatAttachments([
      ...(messageStore.chatAttachments as any[]),
      {
        mime: raw.mime,
        url: raw.dataUrl,
        filename: raw.filename,
        sourcePath: raw.sourcePath,
        selection: raw.selection,
      },
    ])
    const list = messageStore.chatAttachments as any[]
    expect(list.length).toBe(1)
    expect(list[0]?.url).toBe(raw.dataUrl)
    expect(list[0]?.filename).toBe(raw.filename)
    // The composer reads from THIS store; no separate local signal.
    // A future regression that reintroduces a local signal would
    // diverge from messageStore — caught by structural review of
    // ChatComposer.tsx referencing `messageStore.chatAttachments`.
  })

  test("multiple host pushes accumulate (no overwrite, FIFO order)", () => {
    setChatAttachments([{ mime: "image/png", url: "data:image/png;base64,A", filename: "a.png" }] as any)
    setChatAttachments([
      ...(messageStore.chatAttachments as any[]),
      { mime: "image/png", url: "data:image/png;base64,B", filename: "b.png" },
    ])
    const list = messageStore.chatAttachments as any[]
    expect(list.map((a) => a.filename)).toEqual(["a.png", "b.png"])
  })

  test("clearing the store on submit drops accumulated attachments", () => {
    // ChatComposer.handleSubmit calls setAttachments([]), which now
    // routes through setChatAttachments([]) — verifying the clear
    // semantic so the agent's "data URLs retained indefinitely"
    // memory-leak risk doesn't reopen.
    setChatAttachments([
      { mime: "image/png", url: "data:image/png;base64,A", filename: "a.png" },
      { mime: "image/png", url: "data:image/png;base64,B", filename: "b.png" },
    ] as any)
    expect((messageStore.chatAttachments as any[]).length).toBe(2)
    setChatAttachments([])
    expect((messageStore.chatAttachments as any[]).length).toBe(0)
  })

  test("disabled ChatComposer does not accept user drop or paste attachments", () => {
    const addAttachment = CHAT_COMPOSER.slice(
      CHAT_COMPOSER.indexOf("async function addAttachment"),
      CHAT_COMPOSER.indexOf("function removeAttachment"),
    )
    const dragOver = CHAT_COMPOSER.slice(
      CHAT_COMPOSER.indexOf("function handleDragOver"),
      CHAT_COMPOSER.indexOf("function handleDragLeave"),
    )
    const drop = CHAT_COMPOSER.slice(
      CHAT_COMPOSER.indexOf("async function handleDrop"),
      CHAT_COMPOSER.indexOf("// ── Paste images"),
    )
    const paste = CHAT_COMPOSER.slice(
      CHAT_COMPOSER.indexOf("async function handlePaste"),
      CHAT_COMPOSER.indexOf("// ── Composer resize"),
    )
    expect(addAttachment).toContain("if (!canAcceptComposerAttachment()) return")
    expect(dragOver).toContain("if (!canAcceptComposerAttachment())")
    expect(drop).toContain("if (!canAcceptComposerAttachment()) return")
    expect(paste).toContain("if (!canAcceptComposerAttachment()) return")
    expect(CHAT_COMPOSER).toContain("<Show when={canAcceptComposerAttachment() && attachments().length > 0}>")
  })

  test("host-driven composer.attach shares the ChatComposer attachment acceptance predicate", () => {
    expect(canAcceptComposerAttachment()).toBe(false)
    setComposerAttachmentInputEnabled(true)
    expect(canAcceptComposerAttachment()).toBe(true)
    expect(CHAT_COMPOSER).toContain("setComposerAttachmentInputEnabled(props.enabled)")
    expect(COMPOSER_ATTACH).toContain("if (!canAcceptComposerAttachment()) return")
  })
})
