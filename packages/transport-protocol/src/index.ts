/**
 * postMessage envelope schema shared by the VS Code extension host
 * (packages/vscode-extension) and the overlay webview
 * (packages/overlay). Single source of truth — both sides import this
 * module so they cannot drift (CLAUDE.md §二-7, §二-8;
 * plan-vscode-extension.md §19.3.3).
 *
 * Versioning rule: bump PROTOCOL_VERSION whenever a message shape
 * changes. The receiver MUST reject mismatched versions and force a
 * webview reload (no compatibility shim — plan §19.3.3).
 */

export const PROTOCOL_VERSION = 1 as const

// ── Webview → Extension ──

export type RequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export type RequestBodyEncoding =
  | { kind: "none" }
  | { kind: "json"; value: unknown }
  | { kind: "text"; value: string }
  | { kind: "form"; entries: Array<[string, string]> }
  | { kind: "binary"; base64: string; contentType?: string }

export type ResponseKind = "json" | "text" | "binary"

export interface WebviewRequestMessage {
  protocol: typeof PROTOCOL_VERSION
  type: "request"
  /** Correlates to the matching ExtensionResponseMessage. */
  id: string
  method: RequestMethod
  /** Server-relative path. The extension host bridge rejects absolute
   *  URLs and `..` traversal (plan §6.2). */
  path: string
  query: Record<string, string>
  headers: Record<string, string>
  body: RequestBodyEncoding
  responseKind: ResponseKind
}

export interface WebviewStreamOpenMessage {
  protocol: typeof PROTOCOL_VERSION
  type: "stream.open"
  /** Stable per-stream identifier. The webview generates this; the
   *  extension uses it to fan out subsequent stream events back. */
  id: string
  method: RequestMethod
  path: string
  query: Record<string, string>
  headers: Record<string, string>
  /** Optional body for POST-stream patterns like /panel/message/stream. */
  body: RequestBodyEncoding
}

export interface WebviewStreamCloseMessage {
  protocol: typeof PROTOCOL_VERSION
  type: "stream.close"
  id: string
}

export type WebviewMessage =
  | WebviewRequestMessage
  | WebviewStreamOpenMessage
  | WebviewStreamCloseMessage

// ── Extension → Webview ──

export interface ExtensionResponseMessage {
  protocol: typeof PROTOCOL_VERSION
  type: "response"
  id: string
  ok: boolean
  status: number
  headers: Record<string, string>
  body: ResponseBodyEncoding
}

export type ResponseBodyEncoding =
  | { kind: "json"; value: unknown }
  | { kind: "text"; value: string }
  | { kind: "binary"; base64: string }
  | { kind: "empty" }
  | { kind: "error"; message: string; name?: string }

export interface ExtensionStreamEventMessage {
  protocol: typeof PROTOCOL_VERSION
  type: "stream.event"
  id: string
  /** SSE `data:` lines, joined and decoded. Multiple events may arrive
   *  in one batch (plan §19.2.3) — UI store should treat each entry
   *  independently. */
  events: string[]
}

export interface ExtensionStreamErrorMessage {
  protocol: typeof PROTOCOL_VERSION
  type: "stream.error"
  id: string
  message: string
}

export interface ExtensionStreamCloseMessage {
  protocol: typeof PROTOCOL_VERSION
  type: "stream.close"
  id: string
  reason: string
}

/**
 * Extension → Webview command. Used for host-driven UI mutations that
 * are not request/response and not stream-shaped — e.g. "attach the
 * current editor file as a draft attachment in the composer"
 * (plan-vscode-extension.md §19.2.6).
 *
 * The webview MUST treat ui-commands as visible UI hints, never as a
 * substitute for a user message (CLAUDE.md §一-15: no synthetic /
 * hidden / audience-split messages).
 *
 * `kind` is an open-ended discriminator so adding a new command does
 * not require bumping PROTOCOL_VERSION; receivers ignore unknown
 * kinds. Adding a new `kind` IS still a contract change between the
 * extension and the overlay; do it in one PR with both subscribers
 * updated.
 */
export interface ExtensionUiCommandMessage {
  protocol: typeof PROTOCOL_VERSION
  type: "ui-command"
  kind: string
  payload: unknown
}

/**
 * Concrete payload for `kind: "composer.attach"`. The webview pushes
 * this onto its existing chat-attachments store so the file becomes a
 * pending attachment in the composer; the user must still hit "send"
 * to actually submit (plan §19.2.6, CLAUDE.md §一-15).
 */
export interface ComposerAttachPayload {
  filename: string
  mime: string
  /** Inline data URL, e.g. `data:text/plain;base64,...`. */
  dataUrl: string
  /** Absolute filesystem path inside the workspace (informational). */
  sourcePath: string
  /** Active editor selection at the time of attach, 0-indexed lines. */
  selection?: {
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
  }
}

export interface ExtensionProtocolMismatchMessage {
  /**
   * Sentinel for "you and I disagree on the schema — reload". Sent
   * outside the typed envelope so old clients still understand it.
   */
  type: "protocol-mismatch"
  expected: number
  received: number
}

export type ExtensionMessage =
  | ExtensionResponseMessage
  | ExtensionStreamEventMessage
  | ExtensionStreamErrorMessage
  | ExtensionStreamCloseMessage
  | ExtensionUiCommandMessage
  | ExtensionProtocolMismatchMessage

// ── Helpers ──

/** Type-narrowing predicate: does `m` look like a typed extension message? */
export function isExtensionMessage(m: unknown): m is ExtensionMessage {
  if (!m || typeof m !== "object") return false
  const obj = m as Record<string, unknown>
  if (obj["type"] === "protocol-mismatch") return true
  if (typeof obj["type"] !== "string") return false
  if (obj["protocol"] !== PROTOCOL_VERSION) return false
  return true
}

export function isWebviewMessage(m: unknown): m is WebviewMessage {
  if (!m || typeof m !== "object") return false
  const obj = m as Record<string, unknown>
  if (obj["protocol"] !== PROTOCOL_VERSION) return false
  if (typeof obj["type"] !== "string") return false
  return ["request", "stream.open", "stream.close"].includes(obj["type"] as string)
}

// ── Body encoding helpers (Buffer-free; works in both webview + node) ──

/**
 * Browser-safe base64 encoder for binary payloads. Both the webview and
 * the extension host run on engines (V8 / Chromium) that ship Uint8Array
 * + btoa/atob. We avoid Buffer here so the same module loads cleanly in
 * both runtimes — no node-specific shim.
 */
export function uint8ToBase64(bytes: Uint8Array): string {
  let bin = ""
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const sub = bytes.subarray(i, i + CHUNK)
    bin += String.fromCharCode(...sub)
  }
  // btoa is available in webview and in Node 16+.
  return btoa(bin)
}

export function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
