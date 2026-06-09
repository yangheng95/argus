/**
 * HostTransport — single cross-host abstraction for everything the
 * overlay UI needs to talk to: HTTP requests, server-sent events, and
 * native (host-specific) commands.
 *
 * Runtime implementations:
 *   - tauri-transport.ts: forwards to direct fetch / EventSource / Tauri
 *     invoke. Default for the desktop overlay window.
 *   - vscode-transport.ts: serializes everything to postMessage so the
 *     VS Code Extension Host can transparently inject Basic Auth into
 *     requests and bridge SSE through the extension boundary
 *     (plan-vscode-extension.md §5.2). Lands in M4.
 *   - browser mode: reuses tauri-transport HTTP/SSE and stores overlay
 *     settings in browser storage for standalone Vite development.
 *
 * Selection happens exactly once, at app boot, in `createHostTransport()`.
 * Business code MUST NOT reach for `window.__TAURI__` or
 * `acquireVsCodeApi` directly (plan §5.3): everything goes through this
 * interface. This is the single chokepoint that keeps the two hosts
 * from diverging into two-source business logic (CLAUDE.md §二-7).
 */

export type HostKind = "tauri" | "vscode" | "browser"

export const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 15_000

// ── Request / Response (HTTP) ──

export type RequestBody =
  | { kind: "none" }
  | { kind: "json"; value: unknown }
  | { kind: "text"; value: string }
  | { kind: "form"; value: FormData }
  | { kind: "binary"; value: Uint8Array; contentType?: string }

export type ResponseKind = "json" | "text" | "binary"

export interface TransportRequest {
  /**
   * Server-relative path, e.g. `task/abc/conversation`. Leading `/` is
   * stripped. NEVER include scheme/host — those are added by the
   * transport. The bridge in M4 rejects absolute URLs (plan §6.2).
   */
  path: string
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  query?: Record<string, string | number | boolean | undefined | null>
  /** Body. Defaults to no body. */
  body?: RequestBody
  /** Extra headers (Authorization is injected by the transport). */
  headers?: Record<string, string>
  /**
   * What format the caller wants back. JSON is the common case; binary
   * is for `fetchResourceAsObjectUrl` and similar; text is for SSE
   * fallbacks and rare byte-aware paths.
   */
  responseKind?: ResponseKind
  /** Optional abort signal. */
  signal?: AbortSignal
}

export interface TransportResponse<T = unknown> {
  status: number
  ok: boolean
  headers: Record<string, string>
  body: T
}

// ── Streaming (SSE) ──

export interface StreamOpenRequest {
  /** Same path semantics as TransportRequest.path. */
  path: string
  /**
   * Defaults to "GET" for classic SSE endpoints. Use "POST" with a
   * body for streaming-RPC routes like /panel/message/stream where
   * the request payload is sent as JSON and the response is an SSE
   * stream (text/event-stream over POST).
   */
  method?: "GET" | "POST"
  query?: Record<string, string | number | boolean | undefined | null>
  headers?: Record<string, string>
  /** Optional request body — only meaningful when method is "POST". */
  body?: RequestBody
  /** Optional abort signal for upstream cancellation. */
  signal?: AbortSignal
}

export interface StreamHandlers {
  onOpen?: () => void
  /** Each event's `data` field, decoded. The bridge (M4) batches these
   * into postMessage fan-out for the vscode transport (plan §19.2.3). */
  onEvent: (data: string) => void
  onError?: (err: Error) => void
  /** Fires on disconnect for any reason (server close, network, abort). */
  onClose?: (reason: string) => void
}

export interface StreamHandle {
  close(): void
}

// ── Native (host-specific) commands ──
//
// Discriminated union of every host-specific command the overlay
// expects. New commands MUST extend this union (CLAUDE.md §二-9, §11):
// adding an ad-hoc Tauri invoke without listing it here is a violation
// of the single-chokepoint contract. The vscode transport (M4 onward)
// implements only the subset that maps to VS Code APIs and throws
// UnsupportedNativeCommandError for anything that doesn't (plan §5.2).

export interface ServerInfo {
  url: string
  pid?: number
  port?: number
}

export type {
  NativeCommand,
  NativeCommandKind,
  ProjectEditorID,
} from "@opencorvus-ai/transport-protocol"
export { PROJECT_EDITOR_IDS } from "@opencorvus-ai/transport-protocol"

import { PROJECT_EDITOR_IDS } from "@opencorvus-ai/transport-protocol"
import type { NativeCommand, NativeCommandKind, ProjectEditorID } from "@opencorvus-ai/transport-protocol"

export type NativeCommandCapabilities = Readonly<Record<NativeCommandKind, boolean>>

export interface HostUiCapabilities {
  /** Whether the host exposes native window chrome controls to the overlay. */
  readonly windowControls: boolean
  /** Whether the overlay titlebar can initiate a native host-window drag. */
  readonly windowDrag: boolean
  /** Whether Ctrl/Cmd zoom shortcuts should be owned by the overlay. */
  readonly overlayZoomHotkeys: boolean
  /** Whether a missing workspace should be entered manually instead of through a host picker. */
  readonly manualWorkspacePathEntry: boolean
  /** Whether task-event desktop notifications must read host permission before sending. */
  readonly desktopNotificationsRequirePermission: boolean
  /** Project editors that this host can launch through workspace.openProjectEditor. */
  readonly projectEditors: readonly ProjectEditorID[]
}

export interface HostCapabilities {
  readonly nativeCommands: NativeCommandCapabilities
  readonly ui: HostUiCapabilities
}

const TAURI_NATIVE_COMMANDS: NativeCommandCapabilities = {
  "open-url": true,
  "open-path": true,
  "settings.load": true,
  "settings.save": true,
  "config.write-file": true,
  "server.info": true,
  "server.restart": true,
  "devtools.toggle": true,
  "window.quit": true,
  "tray.attention.set": true,
  "badge.set": true,
  "workspace.pickDir": true,
  "workspace.pickFiles": true,
  "workspace.openProjectEditor": true,
  "notification.permission": true,
  "notification.requestPermission": true,
  "notification.send": true,
}

const BROWSER_NATIVE_COMMANDS: NativeCommandCapabilities = {
  "open-url": false,
  "open-path": false,
  "settings.load": true,
  "settings.save": true,
  "config.write-file": false,
  "server.info": false,
  "server.restart": false,
  "devtools.toggle": false,
  "window.quit": false,
  "tray.attention.set": false,
  "badge.set": false,
  "workspace.pickDir": false,
  "workspace.pickFiles": false,
  "workspace.openProjectEditor": false,
  "notification.permission": true,
  "notification.requestPermission": true,
  "notification.send": true,
}

const VSCODE_NATIVE_COMMANDS: NativeCommandCapabilities = {
  "open-url": true,
  "open-path": true,
  "settings.load": true,
  "settings.save": true,
  "config.write-file": false,
  "server.info": false,
  "server.restart": false,
  "devtools.toggle": false,
  "window.quit": false,
  "tray.attention.set": false,
  "badge.set": false,
  "workspace.pickDir": true,
  "workspace.pickFiles": true,
  "workspace.openProjectEditor": true,
  "notification.permission": true,
  "notification.requestPermission": true,
  "notification.send": true,
}

export const HOST_CAPABILITIES: Readonly<Record<HostKind, HostCapabilities>> = {
  tauri: {
    nativeCommands: TAURI_NATIVE_COMMANDS,
    ui: {
      windowControls: true,
      windowDrag: true,
      overlayZoomHotkeys: true,
      manualWorkspacePathEntry: false,
      desktopNotificationsRequirePermission: false,
      projectEditors: PROJECT_EDITOR_IDS,
    },
  },
  browser: {
    nativeCommands: BROWSER_NATIVE_COMMANDS,
    ui: {
      windowControls: false,
      windowDrag: false,
      overlayZoomHotkeys: false,
      manualWorkspacePathEntry: true,
      desktopNotificationsRequirePermission: true,
      projectEditors: [],
    },
  },
  vscode: {
    nativeCommands: VSCODE_NATIVE_COMMANDS,
    ui: {
      windowControls: false,
      windowDrag: false,
      overlayZoomHotkeys: false,
      manualWorkspacePathEntry: true,
      desktopNotificationsRequirePermission: false,
      projectEditors: ["vscode"],
    },
  },
} as const

export class UnsupportedNativeCommandError extends Error {
  override readonly name: string = "UnsupportedNativeCommandError"
  constructor(
    public readonly host: HostKind,
    public readonly command: NativeCommand,
  ) {
    super(`Native command "${command.kind}" is not available in host "${host}".`)
  }
}

// ── Host-driven UI commands ──

/**
 * Host → webview UI command. The host (extension / Tauri) pushes a
 * payload that should mutate visible UI state; e.g. "stage this file
 * as a composer attachment" (plan §19.2.6). Subscribers are the
 * overlay's UI stores; the transport routes by `kind`.
 *
 * Payloads are typed at the call site (the overlay subscriber casts
 * to its expected shape based on `kind`) — adding a new kind is a
 * coordinated change between the host and the subscriber, not a
 * transport-level breaking change.
 */
export type UiCommandHandler = (payload: unknown) => void
export interface UiCommandSubscription {
  unsubscribe(): void
}

// ── The interface ──

export interface HostTransport {
  readonly kind: HostKind
  readonly capabilities: HostCapabilities
  /**
   * Issue a single HTTP request. The transport handles Authorization
   * header injection, base-URL resolution, and (in vscode mode) the
   * postMessage round-trip.
   */
  request<T = unknown>(input: TransportRequest): Promise<TransportResponse<T>>
  /**
   * Open a streaming connection. The handle's `close()` aborts cleanly.
   * Streams do NOT auto-reconnect (plan §5.5): UI store decides on
   * reconnect policy and presents a visible disconnected state.
   */
  openStream(input: StreamOpenRequest, handlers: StreamHandlers): StreamHandle
  /**
   * Run a host-specific native command. Tauri transport maps each
   * command to its underlying Tauri invoke. VS Code transport throws
   * UnsupportedNativeCommandError for any command that cannot be
   * expressed via the VS Code API (plan §5.2: no silent no-op).
   */
  native(command: NativeCommand): Promise<unknown>
  /**
   * Subscribe to a host-driven UI command (e.g. "composer.attach").
   * Tauri transport currently has no UI command source — it returns a
   * no-op subscription. VS Code transport routes `ui-command` envelopes
   * by `kind` to the registered handler.
   */
  subscribeUiCommand(kind: string, handler: UiCommandHandler): UiCommandSubscription
}

/**
 * Type-narrowing helper: `nativeUnsupported(this.kind, cmd)` is the
 * canonical way for a transport to reject a command. Keeping it as a
 * helper keeps the throw site visibly intentional in code review.
 */
export function nativeUnsupported(host: HostKind, command: NativeCommand): never {
  throw new UnsupportedNativeCommandError(host, command)
}

// ── Factory ──

// Eager imports: both transport modules are small (no Tauri/VSCode SDK
// pulled in at runtime — they only feature-detect window-level globals).
// Eager + lazy cache keeps the factory synchronous, which matters for
// services/api.ts: its module top-level code runs `getHostTransport()`
// indirectly during early imports and can't await dynamic-import.
import { createTauriTransport } from "./tauri-transport"
import { createVsCodeTransport } from "./vscode-transport"

let _instance: HostTransport | undefined

/**
 * Detect which host we run in, instantiate the right transport, and
 * cache it for the rest of the app's lifetime. This is the ONLY
 * function in the overlay that's allowed to read `window.__TAURI__` or
 * call `acquireVsCodeApi()`. Every other module asks `getHostTransport()`.
 */
export function createHostTransport(): HostTransport {
  if (_instance) return _instance
  if (typeof globalThis !== "undefined" && (globalThis as any).window) {
    const w = (globalThis as any).window as any
    if (typeof w.__TAURI__ !== "undefined") {
      _instance = createTauriTransport()
      return _instance
    }
    if (typeof w.acquireVsCodeApi === "function") {
      _instance = createVsCodeTransport()
      return _instance
    }
  }
  // Browser-only dev mode (running overlay against `bun run dev`):
  // reuse the Tauri HTTP/SSE implementation, but expose browser-local
  // native settings so persistence still has one host-owned source.
  _instance = createTauriTransport("browser")
  return _instance
}

export function getHostTransport(): HostTransport {
  return _instance ?? createHostTransport()
}

/** Test seam — never call this from production code. */
export function __setHostTransportForTest(t: HostTransport | undefined): void {
  _instance = t
}
