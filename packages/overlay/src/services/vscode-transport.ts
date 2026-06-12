/**
 * vscode-transport — HostTransport implementation for the VS Code
 * webview host (plan-vscode-extension.md §5.2 / §19.3.3).
 *
 * Every request, resource fetch, and SSE stream goes through
 * `acquireVsCodeApi().postMessage(...)` to the extension host, which
 * forwards to the sidecar with Basic Auth attached. The webview NEVER
 * sees the sidecar URL or the bearer token (plan §7).
 *
 * Protocol envelope schema lives in @opencorvus-ai/transport-protocol
 * — single source of truth shared with the extension host. A protocol
 * version mismatch from the extension is fatal: the webview reloads
 * itself rather than running on a divergent schema (CLAUDE.md §一-7,
 * §二-7).
 */

import {
  PROTOCOL_VERSION,
  base64ToUint8,
  isExtensionMessage,
  uint8ToBase64,
  type ExtensionMessage,
  type RequestBodyEncoding,
  type RequestMethod,
  type ResponseBodyEncoding,
  type WebviewMessage,
} from "@opencorvus-ai/transport-protocol"
import { onAuthChange, queryWithDirectory } from "./api"
import type {
  HostTransport,
  NativeCommand,
  RequestBody,
  StreamHandle,
  StreamHandlers,
  StreamOpenRequest,
  TransportRequest,
  TransportResponse,
} from "./host-transport"
import { DEFAULT_REQUEST_TIMEOUT_MILLISECONDS, HOST_CAPABILITIES, nativeUnsupported } from "./host-transport"
import { publishHostTheme } from "./host-theme"
import { loadBrowserOverlaySettings, saveBrowserOverlaySettings } from "./overlay-settings-storage"

// ── VS Code API singleton ──

interface VsCodeApi {
  postMessage(message: unknown): void
  setState(state: unknown): void
  getState(): unknown
}

let _vscode: VsCodeApi | undefined

function acquireOnce(): VsCodeApi {
  if (_vscode) return _vscode
  // acquireVsCodeApi() can only be called once per webview lifetime
  // (VS Code throws on the second call). We cache the handle and
  // never re-acquire.
  const acquire = (globalThis as any).window?.acquireVsCodeApi
  if (typeof acquire !== "function") {
    throw new Error("vscode-transport: acquireVsCodeApi is not available — this webview was not loaded by VS Code.")
  }
  _vscode = acquire() as VsCodeApi
  return _vscode
}

// ── Pending state ──

interface Pending {
  resolve: (res: TransportResponse) => void
  reject: (err: Error) => void
  responseKind: TransportRequest["responseKind"]
  signal?: AbortSignal
  abortListener?: () => void
}

interface ActiveStream {
  handlers: StreamHandlers
  closed: boolean
  signal?: AbortSignal
  abortListener?: () => void
  forceClose?: () => void
}

const pending = new Map<string, Pending>()
const pendingNative = new Map<string, { resolve: (value: unknown) => void; reject: (err: Error) => void }>()
const streams = new Map<string, ActiveStream>()
const uiCommandHandlers = new Map<string, Set<(payload: unknown) => void>>()
let installed = false

// audit-2026-04-29 W2-V1 — auth-change drain. See tauri-transport.ts
// for the architectural rationale; this is the VSCode-side mirror.
// Streams here are POST-tunnelled to the extension host with
// Authorization injected at the bridge boundary, so an in-flight
// stream still won't pick up a new sidecar password until it tears
// down and reopens.
const activeStreamForceClose = new Set<() => void>()
let authChangeUnsubscribe: (() => void) | undefined

function ensureAuthChangeSubscribed(): void {
  if (authChangeUnsubscribe) return
  authChangeUnsubscribe = onAuthChange(() => {
    const snapshot = [...activeStreamForceClose]
    activeStreamForceClose.clear()
    for (const fn of snapshot) {
      try {
        fn()
      } catch {}
    }
  })
}

function installListener(): void {
  if (installed) return
  installed = true
  const w = (globalThis as any).window as Window
  w.addEventListener("message", (e: MessageEvent) => {
    // audit-2026-04-29 W2-V5 — outer try/catch so any throw escaping
    // handleIncoming (e.g. a polyfilled signal.removeEventListener,
    // a corrupt envelope, a third-party listener interfering) does
    // NOT bubble into the browser/webview event-loop, which would
    // leave the offending pending Promise unsettled forever. The
    // F3 fix wrapped only `decodeResponse`; this guard catches any
    // OTHER throw path inside handleIncoming.
    try {
      handleIncoming(e.data)
    } catch (err) {
      console.error("[vscode-transport] handleIncoming threw, dropping message", err)
    }
  })
}

function handleIncoming(raw: unknown): void {
  if (!isExtensionMessage(raw)) {
    // audit-2026-04-29 overlay F10 — surface contract drift instead
    // of dropping silently, so a bad upstream bundle is visible in
    // the webview console rather than producing mysterious hangs.
    if (raw && typeof raw === "object") {
      console.warn("[vscode-transport] dropping non-protocol message", (raw as { type?: unknown }).type)
    }
    return
  }
  const msg = raw as ExtensionMessage
  if (msg.type === "protocol-mismatch") {
    // audit-2026-04-29 transport F2 — bound the reload count so a bug
    // that always returns mismatch (e.g. webview bundle vs extension
    // bundle truly diverged and reload doesn't fetch a new copy)
    // doesn't loop forever burning CPU.
    if (shouldHonourProtocolMismatch(msg.expected, msg.received)) {
      console.error(
        `[vscode-transport] protocol mismatch: expected ${msg.expected}, got ${msg.received}. Reloading webview.`,
      )
      try {
        ;(globalThis as any).window.location.reload()
      } catch {}
    } else {
      console.error(
        `[vscode-transport] protocol mismatch reload budget exhausted (expected=${msg.expected}, received=${msg.received}). Halting; user must restart the webview.`,
      )
    }
    return
  }
  switch (msg.type) {
    case "response": {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      cleanupAbort(p.signal, p.abortListener)
      // audit-2026-04-29 transport F3 / overlay F1 — `decodeResponse`
      // throws on `body.kind === "error"`. If the throw escapes here,
      // the `window.message` listener swallows it and the pending
      // Promise never settles, hanging the caller's `await` forever.
      // Route the throw through `p.reject` so the contract holds.
      try {
        p.resolve(decodeResponse(msg))
      } catch (err) {
        p.reject(err instanceof Error ? err : new Error(String(err)))
      }
      return
    }
    case "stream.event": {
      const s = streams.get(msg.id)
      if (!s || s.closed) return
      for (const data of msg.events) {
        try {
          s.handlers.onEvent(data)
        } catch {}
      }
      return
    }
    case "stream.error": {
      const s = streams.get(msg.id)
      if (!s) return
      try {
        s.handlers.onError?.(new Error(msg.message))
      } catch {}
      return
    }
    case "stream.close": {
      const s = streams.get(msg.id)
      if (!s) return
      streams.delete(msg.id)
      if (s.forceClose) activeStreamForceClose.delete(s.forceClose)
      if (s.closed) return
      s.closed = true
      cleanupAbort(s.signal, s.abortListener)
      try {
        s.handlers.onClose?.(msg.reason)
      } catch {}
      return
    }
    case "native.response": {
      const p = pendingNative.get(msg.id)
      if (!p) return
      pendingNative.delete(msg.id)
      if (msg.ok) {
        p.resolve(msg.value)
        return
      }
      const err = new Error(msg.error?.message || "native command failed")
      if (msg.error?.name) err.name = msg.error.name
      p.reject(err)
      return
    }
    case "ui-command": {
      const handlers = uiCommandHandlers.get(msg.kind)
      if (!handlers || handlers.size === 0) {
        // Plan §一-7: never silently swallow. The extension sent a
        // ui-command we didn't subscribe to — log loudly so the
        // operator can see the contract drift.
        console.warn(`[vscode-transport] no subscriber for ui-command kind=${msg.kind}`)
        return
      }
      for (const handler of handlers) {
        try {
          handler(msg.payload)
        } catch (err) {
          console.error(`[vscode-transport] ui-command handler threw kind=${msg.kind}`, err)
        }
      }
      return
    }
    case "host:theme": {
      publishHostTheme(msg.theme)
      return
    }
  }
}

function cleanupAbort(signal: AbortSignal | undefined, listener: (() => void) | undefined): void {
  if (signal && listener) {
    signal.removeEventListener("abort", listener)
  }
}

// ── protocol-mismatch reload circuit breaker ──
//
// audit-2026-04-29 transport F2: a malicious or buggy upstream that
// always replies protocol-mismatch could spin the webview into a
// reload loop. Track recent mismatch reloads in sessionStorage so the
// counter survives `location.reload()` itself. Beyond MAX reloads
// inside WINDOW_MS we stop honouring the message and halt — the user
// has to dispose the panel.

const RELOAD_COUNTER_KEY = "__opencorvus_pm_reloads"
const RELOAD_MAX = 3
const RELOAD_WINDOW_MS = 30_000

// audit-2026-04-29 W2-V2 — memory-backed counter as a primary
// defence so the circuit breaker still works when sessionStorage is
// unavailable (sandboxed webview, privacy mode, quota exceeded). On a
// real reload the in-memory counter resets, but the sessionStorage
// counter persists, so they reinforce each other; if BOTH are
// unavailable the breaker cannot survive a reload — that's the
// best-effort floor, but at least within a single page lifetime
// repeated mismatches are now bounded.
const memReloadHistory: number[] = []

function shouldHonourProtocolMismatch(_expected: number, _received: number): boolean {
  const cutoff = Date.now() - RELOAD_WINDOW_MS
  // 1. In-memory counter — always available, always consulted.
  while (memReloadHistory.length && memReloadHistory[0]! < cutoff) {
    memReloadHistory.shift()
  }
  if (memReloadHistory.length >= RELOAD_MAX) return false
  // 2. sessionStorage counter — best-effort, survives reload.
  let storage: Storage | undefined
  try {
    storage = (globalThis as any).window?.sessionStorage as Storage | undefined
  } catch {}
  let history: number[] = []
  if (storage) {
    try {
      const raw = storage.getItem(RELOAD_COUNTER_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) history = parsed.filter((t) => typeof t === "number" && t > cutoff)
      }
    } catch {
      history = []
    }
    if (history.length >= RELOAD_MAX) return false
  }
  // 3. Honour, then bump both counters.
  const now = Date.now()
  memReloadHistory.push(now)
  history.push(now)
  if (storage) {
    try {
      storage.setItem(RELOAD_COUNTER_KEY, JSON.stringify(history))
    } catch {}
  }
  return true
}

// ── Encoding ──

function encodeBody(body: RequestBody | undefined): RequestBodyEncoding {
  if (!body || body.kind === "none") return { kind: "none" }
  switch (body.kind) {
    case "json":
      return { kind: "json", value: body.value }
    case "text":
      return { kind: "text", value: body.value }
    case "form": {
      const entries: Array<[string, string]> = []
      body.value.forEach((v, k) => {
        entries.push([k, typeof v === "string" ? v : ""])
      })
      return { kind: "form", entries }
    }
    case "binary":
      return { kind: "binary", base64: uint8ToBase64(body.value), contentType: body.contentType }
  }
}

function decodeResponse<T>(msg: {
  status: number
  ok: boolean
  headers: Record<string, string>
  body: ResponseBodyEncoding
}): TransportResponse<T> {
  let body: unknown
  switch (msg.body.kind) {
    case "json":
      body = msg.body.value
      break
    case "text":
      body = msg.body.value
      break
    case "binary":
      body = base64ToUint8(msg.body.base64)
      break
    case "empty":
      body = undefined
      break
    case "error":
      // Encoded error body — surface directly so caller's catch can read
      // the error name (plan §1: "明确失败").
      throw new Error(msg.body.message)
  }
  return {
    status: msg.status,
    ok: msg.ok,
    headers: msg.headers,
    body: body as T,
  }
}

function buildQuery(query: TransportRequest["query"]): Record<string, string> {
  const out: Record<string, string> = {}
  if (!query) return out
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue
    out[k] = String(v)
  }
  return out
}

function newId(): string {
  // crypto.randomUUID is available in webview contexts (Chromium 92+).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// ── Transport ──

export function createVsCodeTransport(): HostTransport {
  installListener()
  ensureAuthChangeSubscribed()
  const vscode = acquireOnce()

  return {
    kind: "vscode",
    capabilities: HOST_CAPABILITIES.vscode,
    async request<T = unknown>(input: TransportRequest): Promise<TransportResponse<T>> {
      const id = newId()
      const method: RequestMethod = (input.method ?? "GET") as RequestMethod
      const responseKind = input.responseKind ?? "json"
      const signal = input.signal ?? AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MILLISECONDS)

      return new Promise<TransportResponse<T>>((resolve, reject) => {
        let abortListener: (() => void) | undefined
        if (signal) {
          if (signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"))
            return
          }
          abortListener = () => {
            const p = pending.get(id)
            if (!p) return
            pending.delete(id)
            reject(new DOMException("Aborted", "AbortError"))
            // audit-2026-04-29 overlay F2 — request abort previously
            // sent `stream.close`, but request ids never appear in
            // the bridge's streams Map, so the upstream fetch kept
            // running (auth-bearing! resource leak). Use the
            // dedicated `request.abort` envelope.
            try {
              vscode.postMessage(<WebviewMessage>{
                protocol: PROTOCOL_VERSION,
                type: "request.abort",
                id,
              })
            } catch {}
          }
          signal.addEventListener("abort", abortListener, { once: true })
        }
        pending.set(id, {
          resolve: resolve as (r: TransportResponse) => void,
          reject,
          responseKind,
          signal,
          abortListener,
        })
        const msg: WebviewMessage = {
          protocol: PROTOCOL_VERSION,
          type: "request",
          id,
          method,
          path: input.path.replace(/^\/+/, ""),
          query: buildQuery(queryWithDirectory(input.path, input.query, method)),
          headers: input.headers ?? {},
          body: encodeBody(input.body),
          responseKind,
        }
        try {
          vscode.postMessage(msg)
        } catch (err) {
          pending.delete(id)
          cleanupAbort(signal, abortListener)
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
    },
    openStream(input: StreamOpenRequest, handlers: StreamHandlers): StreamHandle {
      const id = newId()
      const method: RequestMethod = (input.method ?? "GET") as RequestMethod
      const active: ActiveStream = {
        handlers,
        closed: false,
        signal: input.signal ?? undefined,
      }
      streams.set(id, active)

      const close = (reason: string) => {
        if (active.closed) return
        active.closed = true
        streams.delete(id)
        activeStreamForceClose.delete(forceClose)
        cleanupAbort(active.signal, active.abortListener)
        try {
          vscode.postMessage(<WebviewMessage>{
            protocol: PROTOCOL_VERSION,
            type: "stream.close",
            id,
          })
        } catch {}
        try {
          handlers.onClose?.(reason)
        } catch {}
      }
      const forceClose = () => close("auth-changed")
      active.forceClose = forceClose
      activeStreamForceClose.add(forceClose)

      if (active.signal) {
        if (active.signal.aborted) {
          // Defer to keep StreamHandle.close shape parallel.
          queueMicrotask(() => close("aborted"))
          return { close: () => close("client-close") }
        }
        active.abortListener = () => close("aborted")
        active.signal.addEventListener("abort", active.abortListener, { once: true })
      }

      const msg: WebviewMessage = {
        protocol: PROTOCOL_VERSION,
        type: "stream.open",
        id,
        method,
        path: input.path.replace(/^\/+/, ""),
        query: buildQuery(queryWithDirectory(input.path, input.query, method)),
        headers: input.headers ?? {},
        body: encodeBody(input.body),
      }
      try {
        vscode.postMessage(msg)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        queueMicrotask(() => {
          try {
            handlers.onError?.(error)
          } catch {}
          close("post-failure")
        })
      }

      return { close: () => close("client-close") }
    },
    async native(command: NativeCommand): Promise<unknown> {
      switch (command.kind) {
        case "settings.load":
          return loadBrowserOverlaySettings()
        case "settings.save":
          return saveBrowserOverlaySettings(command.payload as Record<string, unknown>)
        default:
          if (!HOST_CAPABILITIES.vscode.nativeCommands[command.kind]) {
            return nativeUnsupported("vscode", command)
          }
          return new Promise((resolve, reject) => {
            const id = newId()
            pendingNative.set(id, { resolve, reject })
            try {
              vscode.postMessage(<WebviewMessage>{
                protocol: PROTOCOL_VERSION,
                type: "native.request",
                id,
                command,
              })
            } catch (err) {
              pendingNative.delete(id)
              reject(err instanceof Error ? err : new Error(String(err)))
            }
          })
      }
    },
    subscribeUiCommand(kind, handler) {
      let bucket = uiCommandHandlers.get(kind)
      if (!bucket) {
        bucket = new Set()
        uiCommandHandlers.set(kind, bucket)
      }
      bucket.add(handler)
      return {
        unsubscribe() {
          const set = uiCommandHandlers.get(kind)
          if (!set) return
          set.delete(handler)
          if (set.size === 0) uiCommandHandlers.delete(kind)
        },
      }
    },
  }
}

/** Test seam — clears in-memory pending/stream maps. */
export function __resetVsCodeTransportForTest(): void {
  pending.clear()
  pendingNative.clear()
  streams.clear()
  uiCommandHandlers.clear()
  activeStreamForceClose.clear()
  if (authChangeUnsubscribe) {
    try {
      authChangeUnsubscribe()
    } catch {}
    authChangeUnsubscribe = undefined
  }
  installed = false
  _vscode = undefined
}
