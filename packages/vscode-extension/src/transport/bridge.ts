import * as vscode from "vscode"
import * as http from "node:http"
import {
  PROTOCOL_VERSION,
  base64ToUint8,
  isWebviewMessage,
  uint8ToBase64,
  type ExtensionMessage,
  type RequestBodyEncoding,
  type RequestMethod,
  type ResponseBodyEncoding,
  type WebviewRequestMessage,
  type WebviewStreamOpenMessage,
} from "@opencorvus-ai/transport-protocol"
import type { SidecarHandle } from "../sidecar/manager"

/**
 * TransportBridge — extension-host side of the postMessage bridge.
 *
 * Receives WebviewMessage envelopes from a single VS Code webview,
 * forwards them to the managed sidecar with Basic Auth attached, and
 * pipes responses back to the webview as ExtensionMessage envelopes.
 *
 * Security boundary (plan-vscode-extension.md §6.2 / §7):
 *   - The sidecar token NEVER leaves the extension host. The webview
 *     does not know it; if the webview asks for an absolute URL or
 *     a `..` path, the bridge rejects with a 400 response.
 *   - localhost (127.0.0.1) only — bridge cannot proxy arbitrary
 *     external schemes.
 *
 * SSE batching (plan §19.2.3):
 *   - Stream events arriving from the sidecar are buffered for
 *     STREAM_BATCH_MS (16 ms by default) and flushed as a single
 *     ExtensionStreamEventMessage. Keeps webview React frame budget
 *     intact when the LLM emits hundreds of token chunks per second.
 *
 * Lifecycle:
 *   - One bridge per webview. dispose() closes all in-flight streams,
 *     unsubscribes the message listener, and releases the abort
 *     controllers.
 *   - The bridge does NOT re-spawn the sidecar; sidecar lifecycle is
 *     owned by extension.ts (plan §19.2.4).
 */

const STREAM_BATCH_MS = 16
const STREAM_BATCH_MAX = 256

interface ActiveStream {
  controller: AbortController
  buffer: string[]
  flushTimer: NodeJS.Timeout | null
}

export class TransportBridge {
  private readonly disposables: vscode.Disposable[] = []
  private readonly streams = new Map<string, ActiveStream>()
  private disposed = false

  constructor(
    private readonly webview: vscode.Webview,
    private readonly sidecar: SidecarHandle,
    private readonly log: (line: string) => void = () => {},
  ) {
    this.disposables.push(
      this.webview.onDidReceiveMessage((message) => {
        void this.onMessage(message)
      }),
    )
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const [id, stream] of this.streams) {
      try { stream.controller.abort() } catch {}
      if (stream.flushTimer) clearTimeout(stream.flushTimer)
      void id
    }
    this.streams.clear()
    while (this.disposables.length) {
      const d = this.disposables.pop()
      try { d?.dispose() } catch {}
    }
  }

  private async onMessage(raw: unknown): Promise<void> {
    if (!isWebviewMessage(raw)) {
      // Either malformed or from a different protocol version. The
      // webview can't reload itself based on a malformed message it
      // sent, but a version mismatch in our direction warrants a
      // synthetic protocol-mismatch reply.
      const obj = raw as { protocol?: number } | null
      if (obj && typeof obj.protocol === "number" && obj.protocol !== PROTOCOL_VERSION) {
        this.send({
          type: "protocol-mismatch",
          expected: PROTOCOL_VERSION,
          received: obj.protocol,
        })
      }
      return
    }

    if (this.disposed) return

    switch (raw.type) {
      case "request":
        await this.handleRequest(raw)
        return
      case "stream.open":
        await this.handleStreamOpen(raw)
        return
      case "stream.close":
        this.handleStreamClose(raw.id, "client-close")
        return
    }
  }

  private async handleRequest(msg: WebviewRequestMessage): Promise<void> {
    const validation = validatePath(msg.path)
    if (!validation.ok) {
      this.send({
        protocol: PROTOCOL_VERSION,
        type: "response",
        id: msg.id,
        ok: false,
        status: 400,
        headers: {},
        body: { kind: "error", message: validation.reason },
      })
      return
    }
    const url = buildUrl(this.sidecar.baseUrl, validation.path, msg.query)
    const init = this.buildRequestInit(msg.method, msg.headers, msg.body)

    let res: Response
    try {
      res = await fetch(url, init)
    } catch (err) {
      this.send({
        protocol: PROTOCOL_VERSION,
        type: "response",
        id: msg.id,
        ok: false,
        status: 0,
        headers: {},
        body: { kind: "error", message: err instanceof Error ? err.message : String(err) },
      })
      return
    }
    const body = await readResponseBody(res, msg.responseKind)
    const headers = headersToObject(res.headers)
    this.send({
      protocol: PROTOCOL_VERSION,
      type: "response",
      id: msg.id,
      ok: res.ok,
      status: res.status,
      headers,
      body,
    })
  }

  private async handleStreamOpen(msg: WebviewStreamOpenMessage): Promise<void> {
    const validation = validatePath(msg.path)
    if (!validation.ok) {
      this.send({
        protocol: PROTOCOL_VERSION,
        type: "stream.error",
        id: msg.id,
        message: validation.reason,
      })
      this.send({
        protocol: PROTOCOL_VERSION,
        type: "stream.close",
        id: msg.id,
        reason: "invalid-path",
      })
      return
    }
    const url = buildUrl(this.sidecar.baseUrl, validation.path, msg.query)
    const controller = new AbortController()
    const stream: ActiveStream = {
      controller,
      buffer: [],
      flushTimer: null,
    }
    this.streams.set(msg.id, stream)

    const init = this.buildRequestInit(msg.method, msg.headers, msg.body)
    init.signal = controller.signal
    init.headers = {
      ...(init.headers as Record<string, string>),
      Accept: "text/event-stream",
    }

    void this.driveStream(msg.id, url, init)
  }

  private async driveStream(id: string, url: string, init: RequestInit): Promise<void> {
    let res: Response
    try {
      res = await fetch(url, init)
    } catch (err) {
      if (this.streams.get(id)?.controller.signal.aborted) {
        this.handleStreamClose(id, "client-aborted")
        return
      }
      this.send({
        protocol: PROTOCOL_VERSION,
        type: "stream.error",
        id,
        message: err instanceof Error ? err.message : String(err),
      })
      this.handleStreamClose(id, "fetch-error")
      return
    }
    if (!res.ok || !res.body) {
      this.send({
        protocol: PROTOCOL_VERSION,
        type: "stream.error",
        id,
        message: `stream ${res.status}: ${res.statusText}`,
      })
      this.handleStreamClose(id, "bad-response")
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    const consume = (chunk: string, flush = false) => {
      buf += chunk
      const blocks = buf.split(/\r?\n\r?\n/)
      buf = flush ? "" : (blocks.pop() || "")
      for (const block of blocks) {
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n")
        if (data) this.queueStreamEvent(id, data)
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          consume(decoder.decode(), true)
          break
        }
        consume(decoder.decode(value, { stream: true }))
      }
    } catch (err) {
      if (!this.streams.get(id)?.controller.signal.aborted) {
        this.send({
          protocol: PROTOCOL_VERSION,
          type: "stream.error",
          id,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    } finally {
      this.handleStreamClose(id, "upstream-end")
    }
  }

  private queueStreamEvent(id: string, data: string): void {
    const stream = this.streams.get(id)
    if (!stream) return
    stream.buffer.push(data)
    if (stream.buffer.length >= STREAM_BATCH_MAX) {
      this.flushStream(id)
      return
    }
    if (stream.flushTimer) return
    stream.flushTimer = setTimeout(() => {
      this.flushStream(id)
    }, STREAM_BATCH_MS)
    if (typeof stream.flushTimer.unref === "function") stream.flushTimer.unref()
  }

  private flushStream(id: string): void {
    const stream = this.streams.get(id)
    if (!stream) return
    if (stream.flushTimer) {
      clearTimeout(stream.flushTimer)
      stream.flushTimer = null
    }
    if (stream.buffer.length === 0) return
    const events = stream.buffer.splice(0)
    this.send({
      protocol: PROTOCOL_VERSION,
      type: "stream.event",
      id,
      events,
    })
  }

  private handleStreamClose(id: string, reason: string): void {
    const stream = this.streams.get(id)
    if (!stream) return
    this.streams.delete(id)
    if (stream.flushTimer) clearTimeout(stream.flushTimer)
    if (stream.buffer.length > 0) {
      // Flush any remaining events before announcing close so the
      // webview doesn't lose tail data.
      const events = stream.buffer.splice(0)
      this.send({
        protocol: PROTOCOL_VERSION,
        type: "stream.event",
        id,
        events,
      })
    }
    try { stream.controller.abort() } catch {}
    this.send({
      protocol: PROTOCOL_VERSION,
      type: "stream.close",
      id,
      reason,
    })
  }

  private buildRequestInit(
    method: RequestMethod,
    headers: Record<string, string>,
    body: RequestBodyEncoding,
  ): RequestInit {
    const init: RequestInit = {
      method,
      headers: {
        ...headers,
        Authorization: `Basic ${Buffer.from(`${this.sidecar.username}:${this.sidecar.token}`).toString("base64")}`,
      },
    }
    switch (body.kind) {
      case "none":
        return init
      case "json":
        return {
          ...init,
          headers: { ...(init.headers as Record<string, string>), "Content-Type": "application/json" },
          body: JSON.stringify(body.value),
        }
      case "text":
        return {
          ...init,
          headers: { ...(init.headers as Record<string, string>), "Content-Type": "text/plain;charset=utf-8" },
          body: body.value,
        }
      case "form": {
        const fd = new URLSearchParams(body.entries)
        return {
          ...init,
          headers: {
            ...(init.headers as Record<string, string>),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: fd.toString(),
        }
      }
      case "binary": {
        // Node 18+ fetch accepts Uint8Array directly. The cast keeps
        // typescript happy without pulling in lib.dom.
        const bytes = base64ToUint8(body.base64)
        return {
          ...init,
          headers: {
            ...(init.headers as Record<string, string>),
            ...(body.contentType ? { "Content-Type": body.contentType } : {}),
          },
          body: bytes as unknown as RequestInit["body"],
        }
      }
    }
  }

  private send(message: ExtensionMessage): void {
    if (this.disposed) return
    void this.webview.postMessage(message)
  }
}

// ── Helpers (exported for unit tests) ──

export function validatePath(raw: string): { ok: true; path: string } | { ok: false; reason: string } {
  if (!raw || raw.length === 0) return { ok: false, reason: "empty path" }
  if (/^https?:\/\//i.test(raw) || raw.startsWith("//")) {
    return { ok: false, reason: "absolute URL not permitted" }
  }
  if (raw.includes("\0")) {
    return { ok: false, reason: "null byte in path" }
  }
  if (raw.includes("\\")) {
    return { ok: false, reason: "backslash in path" }
  }
  // Light traversal check: any `..` segment is rejected. Splitting on
  // both leading-slash variants keeps this readable for both
  // "task/../foo" and "/task/../foo" inputs.
  const segments = raw.replace(/^\/+/, "").split("/")
  if (segments.some((s) => s === "..")) {
    return { ok: false, reason: ".. traversal not permitted" }
  }
  return { ok: true, path: raw.replace(/^\/+/, "") }
}

export function buildUrl(baseUrl: string, path: string, query: Record<string, string>): string {
  const u = new URL(`${baseUrl.replace(/\/+$/, "")}/${path}`)
  for (const [k, v] of Object.entries(query)) {
    u.searchParams.set(k, v)
  }
  return u.toString()
}

async function readResponseBody(res: Response, kind: WebviewRequestMessage["responseKind"]): Promise<ResponseBodyEncoding> {
  if (!res.ok && kind !== "binary") {
    const text = await res.text().catch(() => "")
    return { kind: "text", value: text }
  }
  switch (kind) {
    case "binary": {
      const buf = new Uint8Array(await res.arrayBuffer())
      return { kind: "binary", base64: uint8ToBase64(buf) }
    }
    case "text": {
      const text = await res.text()
      return { kind: "text", value: text }
    }
    case "json":
    default: {
      const text = await res.text()
      if (!text) return { kind: "empty" }
      try {
        return { kind: "json", value: JSON.parse(text) }
      } catch {
        // Server promised JSON but didn't deliver — surface as text so
        // the webview can show the raw body in error messages instead
        // of swallowing it.
        return { kind: "text", value: text }
      }
    }
  }
}

function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  h.forEach((v, k) => { out[k] = v })
  return out
}

// Side-effect import suppression — keeps `http` import in case future
// changes need direct http handling. Strip if it remains unused.
void http
