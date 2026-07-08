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

export const PROTOCOL_VERSION = 2 as const

// ── Attachment resource variants ──

export const SCREENSHOT_BROWSER_THUMBNAIL_VARIANT = "screenshot-browser-thumbnail" as const

// ── Conversation message part projection ──

export const CONVERSATION_DISPLAY_MESSAGE_PART_TYPES = [
  "text",
  "part-error",
  "reasoning",
  "tool",
  "patch",
  "file",
  "interaction-question",
  "interaction-permission",
  "subtask",
] as const

export const CONVERSATION_SEPARATOR_MESSAGE_PART_TYPES = ["boundary"] as const

export type ConversationDisplayMessagePartType = (typeof CONVERSATION_DISPLAY_MESSAGE_PART_TYPES)[number]
export type ConversationSeparatorMessagePartType = (typeof CONVERSATION_SEPARATOR_MESSAGE_PART_TYPES)[number]

export function isConversationDisplayMessagePartType(type: string): type is ConversationDisplayMessagePartType {
  return (CONVERSATION_DISPLAY_MESSAGE_PART_TYPES as readonly string[]).includes(type)
}

export function isConversationRenderableMessagePartType(
  type: string,
): type is ConversationDisplayMessagePartType | ConversationSeparatorMessagePartType {
  return (
    isConversationDisplayMessagePartType(type) ||
    (CONVERSATION_SEPARATOR_MESSAGE_PART_TYPES as readonly string[]).includes(type)
  )
}

// ── Server route directory policy ──

/**
 * Routes listed here are served before the project-directory middleware
 * or are intentionally global. They must not receive `?directory=`.
 */
export const PROJECT_DIRECTORY_BYPASS_PATHS = [
  "/doc",
  "/shutdown",
  "/restart",
  "/log",
  "/favicon.ico",
  "/global/tasks",
  "/mission",
] as const

export const PROJECT_DIRECTORY_BYPASS_PREFIXES = ["/global/", "/auth/", "/ui/", "/log/", "/attachment/"] as const
export const REQUEST_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
export type RequestMethod = (typeof REQUEST_METHODS)[number]

const TASK_ROUTE_ID_SEGMENT = "[^/]+"
const TASK_RECORD_READ_ROUTE = new RegExp(
  `^/task/${TASK_ROUTE_ID_SEGMENT}(?:/(?:status|bindings|progress|events|brief|board|transcript|operator-model-context|runs|interactions|conversation(?:/(?:history|events|session/${TASK_ROUTE_ID_SEGMENT}))?))?$`,
)
const TASK_ROOT_RECORD_ROUTE = new RegExp(`^/task/${TASK_ROUTE_ID_SEGMENT}$`)
const CHANNEL_ATTACHMENT_PUBLIC_ROUTE = /^\/channel\/attachment\/[^/]+$/

export function normalizedServerRoutePath(routePath: string): string {
  const withoutQuery = String(routePath || "").split("?", 1)[0] || "/"
  const withSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`
  return withSlash.replace(/\/+$/, "") || "/"
}

function normalizedServerRouteMethod(method?: string): RequestMethod {
  const upper = String(method || "GET").toUpperCase()
  return (REQUEST_METHODS as readonly string[]).includes(upper) ? (upper as RequestMethod) : "GET"
}

export function routeRequiresProjectDirectory(routePath: string, method?: string): boolean {
  const pathOnly = normalizedServerRoutePath(routePath)
  const routeMethod = normalizedServerRouteMethod(method)
  if ((PROJECT_DIRECTORY_BYPASS_PATHS as readonly string[]).includes(pathOnly)) return false
  if (pathOnly === "/global" || pathOnly === "/auth" || pathOnly === "/ui") return false
  if (routeMethod === "GET" && TASK_RECORD_READ_ROUTE.test(pathOnly)) return false
  if (routeMethod === "DELETE" && TASK_ROOT_RECORD_ROUTE.test(pathOnly)) return false
  if (routeMethod === "GET" && CHANNEL_ATTACHMENT_PUBLIC_ROUTE.test(pathOnly)) return false
  return !(PROJECT_DIRECTORY_BYPASS_PREFIXES as readonly string[]).some((prefix) => pathOnly.startsWith(prefix))
}

// ── Webview → Extension ──

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

/**
 * Webview-initiated abort of a non-stream `request` envelope. Distinct
 * from `stream.close` because the extension host's request/response
 * handler does NOT live in the streams Map — sending stream.close for
 * a request id is a protocol violation that leaks the upstream fetch
 * (audit-2026-04-29 overlay F2). Bridge maps this to AbortController
 * on the in-flight fetch.
 */
export interface WebviewRequestAbortMessage {
  protocol: typeof PROTOCOL_VERSION
  type: "request.abort"
  id: string
}

// ── Host native commands ──

export const PROJECT_EDITOR_IDS = ["vscode", "pycharm", "webstorm", "intellij", "cursor"] as const

export type ProjectEditorID = (typeof PROJECT_EDITOR_IDS)[number]

export type HostPermission = "granted" | "denied" | "default" | "unsupported"

export interface BrowserPreviewNativeBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserPreviewNativeSelection {
  x: number
  y: number
  width: number
  height: number
  label: string
  tagName?: string
  selector?: string
  jsPath?: string
  domPath?: string
  textPreview?: string
  role?: string
  accessibleName?: string
  pageUrl?: string
  pageTitle?: string
  sourceHint?: string
  computedColor?: string
  computedFont?: string
  capturedAt?: number
}

/**
 * Discriminated result returned by `browserPreview.selection.take`.
 * - `kind: "waiting"` — no selection yet, keep polling.
 * - `kind: "captured"` — user clicked a node; host consumes `selection` and exits mode.
 * - `kind: "canceled"` — user pressed Escape in the native webview; host exits mode.
 */
export type BrowserPreviewNativeSelectionResult =
  | { kind: "waiting" }
  | { kind: "captured"; selection: BrowserPreviewNativeSelection }
  | { kind: "canceled" }

export const BROWSER_PREVIEW_NATIVE_NAVIGATION_ACTIONS = ["back", "forward", "reload"] as const
export type BrowserPreviewNativeNavigationAction = (typeof BROWSER_PREVIEW_NATIVE_NAVIGATION_ACTIONS)[number]

export type NativeCommand =
  | { kind: "open-url"; url: string }
  | { kind: "open-path"; path: string }
  | { kind: "browserPreview.sync"; url: string; bounds: BrowserPreviewNativeBounds }
  | { kind: "browserPreview.navigate"; action: BrowserPreviewNativeNavigationAction }
  | { kind: "browserPreview.close" }
  | { kind: "browserPreview.selection.setEnabled"; enabled: boolean }
  | { kind: "browserPreview.selection.take" }
  | { kind: "settings.load" }
  | { kind: "settings.save"; payload: unknown }
  | { kind: "config.write-file"; path: string; content: string }
  | { kind: "server.info" }
  | { kind: "server.restart" }
  | { kind: "devtools.toggle" }
  | { kind: "window.quit" }
  | { kind: "tray.attention.set"; active: boolean }
  | { kind: "badge.set"; count: number }
  | { kind: "workspace.pickDir"; start?: string }
  | { kind: "workspace.pickFiles"; start?: string; multiple?: boolean }
  | { kind: "workspace.openProjectEditor"; editor: ProjectEditorID; path: string }
  | { kind: "notification.permission" }
  | { kind: "notification.requestPermission" }
  | { kind: "notification.send"; title: string; body?: string; tag?: string }

export type NativeCommandKind = NativeCommand["kind"]

export interface WebviewNativeRequestMessage {
  protocol: typeof PROTOCOL_VERSION
  type: "native.request"
  id: string
  command: NativeCommand
}

export type WebviewMessage =
  | WebviewRequestMessage
  | WebviewStreamOpenMessage
  | WebviewStreamCloseMessage
  | WebviewRequestAbortMessage
  | WebviewNativeRequestMessage

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

export interface ExtensionNativeResponseMessage {
  protocol: typeof PROTOCOL_VERSION
  type: "native.response"
  id: string
  ok: boolean
  value?: unknown
  error?: { message: string; name?: string }
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

export type HostTheme = "light" | "vscode-dark"

export interface ExtensionHostThemeMessage {
  protocol: typeof PROTOCOL_VERSION
  type: "host:theme"
  theme: HostTheme
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
  | ExtensionNativeResponseMessage
  | ExtensionUiCommandMessage
  | ExtensionHostThemeMessage
  | ExtensionProtocolMismatchMessage

// ── Helpers ──

/** Whitelisted ExtensionMessage `type` values. Keep in sync with the
 *  `ExtensionMessage` discriminated union — adding a new variant means
 *  appending here too (audit-2026-04-29 transport F1). */
export const EXTENSION_MESSAGE_TYPES = [
  "response",
  "stream.event",
  "stream.error",
  "stream.close",
  "native.response",
  "ui-command",
  "host:theme",
] as const

/** Whitelisted WebviewMessage `type` values. */
export const WEBVIEW_MESSAGE_TYPES = [
  "request",
  "stream.open",
  "stream.close",
  "request.abort",
  "native.request",
] as const

/**
 * Type-narrowing predicate: does `m` look like a typed extension message?
 *
 * Asymmetric defence:
 *  - `protocol-mismatch` is the schema-evolution sentinel. It MUST carry
 *    `expected` + `received` as numbers (validated here) so injected
 *    `{type:"protocol-mismatch"}` can't trigger an open-loop reload
 *    (audit-2026-04-29 transport F2).
 *  - All other types must declare `protocol === PROTOCOL_VERSION` and
 *    have `type` in the whitelist (audit-2026-04-29 transport F1: a
 *    bare `{type:"__proto__"}` previously satisfied the predicate).
 */
export function isExtensionMessage(m: unknown): m is ExtensionMessage {
  if (!m || typeof m !== "object") return false
  const obj = m as Record<string, unknown>
  if (obj["type"] === "protocol-mismatch") {
    return typeof obj["expected"] === "number" && typeof obj["received"] === "number"
  }
  if (typeof obj["type"] !== "string") return false
  if (obj["protocol"] !== PROTOCOL_VERSION) return false
  return (EXTENSION_MESSAGE_TYPES as readonly string[]).includes(obj["type"])
}

export function isWebviewMessage(m: unknown): m is WebviewMessage {
  if (!m || typeof m !== "object") return false
  const obj = m as Record<string, unknown>
  if (obj["protocol"] !== PROTOCOL_VERSION) return false
  if (typeof obj["type"] !== "string") return false
  if (!(WEBVIEW_MESSAGE_TYPES as readonly string[]).includes(obj["type"])) return false
  // audit-2026-04-29 W2-V9 — for `request` and `stream.open` envelopes,
  // verify the HTTP method is in the canonical RequestMethod enum
  // (uppercase). Without this gate, a forged `{method: "post"}`
  // (lowercase) or `{method: "DELETE WITH SQL INJECTION"}` slips
  // through to the bridge's fetch() call. fetch() normalises common
  // verbs but is documented to be case-sensitive for non-standard
  // methods, and any string value at all is a contract violation
  // here — the schema is the only line of defence.
  if (obj["type"] === "request" || obj["type"] === "stream.open") {
    if (!(REQUEST_METHODS as readonly string[]).includes(obj["method"] as string)) return false
  }
  if (obj["type"] === "native.request") {
    if (typeof obj["id"] !== "string" || !isNativeCommand(obj["command"])) return false
  }
  return true
}

export function isNativeCommand(value: unknown): value is NativeCommand {
  if (!value || typeof value !== "object") return false
  const obj = value as Record<string, unknown>
  switch (obj["kind"]) {
    case "open-url":
      return typeof obj["url"] === "string"
    case "open-path":
      return typeof obj["path"] === "string"
    case "browserPreview.sync":
      return typeof obj["url"] === "string" && isBrowserPreviewNativeBounds(obj["bounds"])
    case "browserPreview.navigate":
      return (BROWSER_PREVIEW_NATIVE_NAVIGATION_ACTIONS as readonly string[]).includes(obj["action"] as string)
    case "browserPreview.close":
      return true
    case "browserPreview.selection.setEnabled":
      return typeof obj["enabled"] === "boolean"
    case "browserPreview.selection.take":
      return true
    case "settings.load":
      return true
    case "settings.save":
      return Object.prototype.hasOwnProperty.call(obj, "payload")
    case "config.write-file":
      return typeof obj["path"] === "string" && typeof obj["content"] === "string"
    case "server.info":
    case "server.restart":
    case "devtools.toggle":
    case "window.quit":
    case "notification.permission":
    case "notification.requestPermission":
      return true
    case "tray.attention.set":
      return typeof obj["active"] === "boolean"
    case "badge.set":
      return typeof obj["count"] === "number"
    case "workspace.pickDir":
      return obj["start"] === undefined || typeof obj["start"] === "string"
    case "workspace.pickFiles":
      return (
        (obj["start"] === undefined || typeof obj["start"] === "string") &&
        (obj["multiple"] === undefined || typeof obj["multiple"] === "boolean")
      )
    case "workspace.openProjectEditor":
      return (
        (PROJECT_EDITOR_IDS as readonly string[]).includes(obj["editor"] as string) && typeof obj["path"] === "string"
      )
    case "notification.send":
      return (
        typeof obj["title"] === "string" &&
        (obj["body"] === undefined || typeof obj["body"] === "string") &&
        (obj["tag"] === undefined || typeof obj["tag"] === "string")
      )
    default:
      return false
  }
}

function isBrowserPreviewNativeBounds(value: unknown): value is BrowserPreviewNativeBounds {
  if (!value || typeof value !== "object") return false
  const obj = value as Record<string, unknown>
  return (
    finiteNumber(obj["x"]) &&
    finiteNumber(obj["y"]) &&
    finiteNumber(obj["width"]) &&
    finiteNumber(obj["height"]) &&
    (obj["width"] as number) > 0 &&
    (obj["height"] as number) > 0
  )
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

// ── Body encoding helpers (Buffer-free; works in both webview + node) ──

/**
 * Browser-safe base64 encoder for binary payloads. Both the webview and
 * the extension host run on engines (V8 / Chromium) that ship Uint8Array
 * + btoa/atob. We avoid Buffer here so the same module loads cleanly in
 * both runtimes — no node-specific shim.
 */
export function uint8ToBase64(bytes: Uint8Array): string {
  // 8 KiB chunks: V8/Safari/Bun all accept this without "too many
  // arguments to function" (which fired around 65 535 in older
  // engines, 32 768 in some Safari builds — audit-2026-04-29
  // transport F4).
  let bin = ""
  const CHUNK = 0x2000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const sub = bytes.subarray(i, i + CHUNK)
    bin += String.fromCharCode(...sub)
  }
  // btoa is available in webview and in Node 16+.
  return btoa(bin)
}

/**
 * Decode a base64 string. Wraps the engine's `atob` so a
 * malformed payload surfaces a typed `Error` instead of a
 * platform-specific `InvalidCharacterError` that the consumer's
 * try/catch may not recognise (audit-2026-04-29 transport F4).
 */
export function base64ToUint8(b64: string): Uint8Array {
  let bin: string
  try {
    bin = atob(b64)
  } catch (err) {
    throw new Error(`base64ToUint8: invalid base64 payload (${err instanceof Error ? err.message : String(err)})`)
  }
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
