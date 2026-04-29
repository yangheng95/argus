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
import { nativeUnsupported } from "./host-transport"

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
    throw new Error(
      "vscode-transport: acquireVsCodeApi is not available — this webview was not loaded by VS Code.",
    )
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
}

const pending = new Map<string, Pending>()
const streams = new Map<string, ActiveStream>()
const uiCommandHandlers = new Map<string, Set<(payload: unknown) => void>>()
let installed = false

function installListener(): void {
  if (installed) return
  installed = true
  const w = (globalThis as any).window as Window
  w.addEventListener("message", (e: MessageEvent) => {
    handleIncoming(e.data)
  })
}

function handleIncoming(raw: unknown): void {
  if (!isExtensionMessage(raw)) return
  const msg = raw as ExtensionMessage
  if (msg.type === "protocol-mismatch") {
    // The extension host runs a different schema version. Reload the
    // webview to pick up the matching bundle. No compatibility shim
    // (plan §19.3.3).
    console.error(
      `[vscode-transport] protocol mismatch: expected ${msg.expected}, got ${msg.received}. Reloading webview.`,
    )
    try { (globalThis as any).window.location.reload() } catch {}
    return
  }
  switch (msg.type) {
    case "response": {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      cleanupAbort(p.signal, p.abortListener)
      p.resolve(decodeResponse(msg))
      return
    }
    case "stream.event": {
      const s = streams.get(msg.id)
      if (!s || s.closed) return
      for (const data of msg.events) {
        try { s.handlers.onEvent(data) } catch {}
      }
      return
    }
    case "stream.error": {
      const s = streams.get(msg.id)
      if (!s) return
      try { s.handlers.onError?.(new Error(msg.message)) } catch {}
      return
    }
    case "stream.close": {
      const s = streams.get(msg.id)
      if (!s) return
      streams.delete(msg.id)
      if (s.closed) return
      s.closed = true
      cleanupAbort(s.signal, s.abortListener)
      try { s.handlers.onClose?.(msg.reason) } catch {}
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
        try { handler(msg.payload) } catch (err) {
          console.error(`[vscode-transport] ui-command handler threw kind=${msg.kind}`, err)
        }
      }
      return
    }
  }
}

function cleanupAbort(signal: AbortSignal | undefined, listener: (() => void) | undefined): void {
  if (signal && listener) {
    signal.removeEventListener("abort", listener)
  }
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
    case "json": body = msg.body.value; break
    case "text": body = msg.body.value; break
    case "binary": body = base64ToUint8(msg.body.base64); break
    case "empty": body = undefined; break
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
  const vscode = acquireOnce()

  return {
    kind: "vscode",
    async request<T = unknown>(input: TransportRequest): Promise<TransportResponse<T>> {
      const id = newId()
      const method: RequestMethod = (input.method ?? "GET") as RequestMethod
      const responseKind = input.responseKind ?? "json"

      return new Promise<TransportResponse<T>>((resolve, reject) => {
        let abortListener: (() => void) | undefined
        if (input.signal) {
          if (input.signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"))
            return
          }
          abortListener = () => {
            const p = pending.get(id)
            if (!p) return
            pending.delete(id)
            reject(new DOMException("Aborted", "AbortError"))
            // Tell extension to abort (best-effort).
            try {
              vscode.postMessage(<WebviewMessage>{
                protocol: PROTOCOL_VERSION,
                type: "stream.close",
                id,
              })
            } catch {}
          }
          input.signal.addEventListener("abort", abortListener, { once: true })
        }
        pending.set(id, {
          resolve: resolve as (r: TransportResponse) => void,
          reject,
          responseKind,
          signal: input.signal ?? undefined,
          abortListener,
        })
        const msg: WebviewMessage = {
          protocol: PROTOCOL_VERSION,
          type: "request",
          id,
          method,
          path: input.path.replace(/^\/+/, ""),
          query: buildQuery(input.query),
          headers: input.headers ?? {},
          body: encodeBody(input.body),
          responseKind,
        }
        try {
          vscode.postMessage(msg)
        } catch (err) {
          pending.delete(id)
          cleanupAbort(input.signal, abortListener)
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
        cleanupAbort(active.signal, active.abortListener)
        try {
          vscode.postMessage(<WebviewMessage>{
            protocol: PROTOCOL_VERSION,
            type: "stream.close",
            id,
          })
        } catch {}
        try { handlers.onClose?.(reason) } catch {}
      }

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
        query: buildQuery(input.query),
        headers: input.headers ?? {},
        body: encodeBody(input.body),
      }
      try {
        vscode.postMessage(msg)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        queueMicrotask(() => {
          try { handlers.onError?.(error) } catch {}
          close("post-failure")
        })
      }

      return { close: () => close("client-close") }
    },
    async native(command: NativeCommand): Promise<unknown> {
      // Plan §5.2: reject every command until M5 wires the safe subset
      // (open-url, pickDir, pickFiles) through the extension host.
      return nativeUnsupported("vscode", command)
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
  streams.clear()
  uiCommandHandlers.clear()
  installed = false
  _vscode = undefined
}
