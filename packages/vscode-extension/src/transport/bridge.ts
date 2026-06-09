import * as vscode from "vscode"
import * as http from "node:http"
import {
  PROTOCOL_VERSION,
  base64ToUint8,
  isWebviewMessage,
  uint8ToBase64,
  type ExtensionMessage,
  type HostPermission,
  type NativeCommand,
  type RequestBodyEncoding,
  type RequestMethod,
  type ResponseBodyEncoding,
  type WebviewNativeRequestMessage,
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
// audit-2026-04-29 W2-P3 — byte ceiling on a single batch. Without
// this, a heavy reasoning-tool payload (single 30 KiB JSON event ×
// 256 events) could push 7.5 MiB through one postMessage call,
// blocking the webview main thread for 100-200 ms while it
// deserialises. 64 KiB is a balance between flush-frequency overhead
// and per-batch deserialisation cost.
const STREAM_BATCH_MAX_BYTES = 64 * 1024

interface ActiveStream {
  controller: AbortController
  buffer: string[]
  bufferBytes: number
  flushTimer: NodeJS.Timeout | null
}

/**
 * Per-id AbortController for in-flight `request` envelopes. The webview
 * sends `request.abort` when the caller's AbortSignal fires; without
 * this Map the upstream fetch keeps running (audit-2026-04-29 overlay F2).
 */
type ActiveRequest = AbortController

export class TransportBridge {
  private readonly disposables: vscode.Disposable[] = []
  private readonly streams = new Map<string, ActiveStream>()
  private readonly requests = new Map<string, ActiveRequest>()
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
    // audit-2026-04-29 W2-C8 — capture the current entries into local
    // arrays so a late-arriving `handleRequest` (which now re-checks
    // `disposed` after `requests.set`, but for safety in case future
    // code mutates the maps mid-dispose) doesn't slip through. The
    // re-check pass below runs once more after the main loop in case
    // a microtask between iteration and dispatch enqueued anything.
    // audit-2026-04-29 vscode-ext F10 — notify the webview that each
    // active stream is being closed so its store doesn't sit waiting
    // for events that never come.
    for (const [id, stream] of this.streams) {
      try {
        stream.controller.abort()
      } catch {}
      if (stream.flushTimer) clearTimeout(stream.flushTimer)
      try {
        // postMessage directly: bypassing `this.send` which now bails
        // when disposed (we just set disposed=true above).
        void this.webview.postMessage({
          protocol: PROTOCOL_VERSION,
          type: "stream.close",
          id,
          reason: "bridge-dispose",
        })
      } catch {}
    }
    this.streams.clear()
    // Same for in-flight requests: abort the fetch and reply once with
    // an error envelope so the webview's pending Promise rejects (the
    // transport-protocol F3 / overlay F1 lessons).
    for (const [id, controller] of this.requests) {
      try {
        controller.abort()
      } catch {}
      try {
        void this.webview.postMessage({
          protocol: PROTOCOL_VERSION,
          type: "response",
          id,
          ok: false,
          status: 0,
          headers: {},
          body: { kind: "error", message: "bridge disposed" },
        })
      } catch {}
    }
    this.requests.clear()
    while (this.disposables.length) {
      const d = this.disposables.pop()
      try {
        d?.dispose()
      } catch {}
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
      case "request.abort": {
        const controller = this.requests.get(raw.id)
        if (controller) {
          try {
            controller.abort()
          } catch {}
          this.requests.delete(raw.id)
        }
        return
      }
      case "native.request":
        await this.handleNativeRequest(raw)
        return
    }
  }

  private async handleNativeRequest(msg: WebviewNativeRequestMessage): Promise<void> {
    try {
      const value = await runVsCodeNativeCommand(msg.command)
      this.send({
        protocol: PROTOCOL_VERSION,
        type: "native.response",
        id: msg.id,
        ok: true,
        value,
      })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.send({
        protocol: PROTOCOL_VERSION,
        type: "native.response",
        id: msg.id,
        ok: false,
        error: { message: error.message, name: error.name },
      })
    }
  }

  private async handleRequest(msg: WebviewRequestMessage): Promise<void> {
    // audit-2026-04-29 W2-V4 — mirror the F5 stream-id duplicate guard
    // for request ids. Without it, a concurrent `request` envelope
    // with the same id silently overwrites the prior AbortController
    // and the original fetch leaks until completion.
    if (this.requests.has(msg.id)) {
      this.send({
        protocol: PROTOCOL_VERSION,
        type: "response",
        id: msg.id,
        ok: false,
        status: 409,
        headers: {},
        body: { kind: "error", message: `request id ${msg.id} is already in flight` },
      })
      return
    }
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

    // audit-2026-04-29 overlay F2 — track AbortController so
    // `request.abort` envelope can cancel the upstream fetch.
    const controller = new AbortController()
    this.requests.set(msg.id, controller)
    // audit-2026-04-29 W2-C8 — re-check `disposed` AFTER the set.
    // dispose() may have iterated `requests` and bailed before this
    // entry existed; without this re-check the upstream fetch runs
    // forever and the webview's pending Promise hangs (the
    // dispose-time error envelope was already broadcast for whatever
    // ids existed at the iteration moment).
    if (this.disposed) {
      controller.abort()
      this.requests.delete(msg.id)
      this.send({
        protocol: PROTOCOL_VERSION,
        type: "response",
        id: msg.id,
        ok: false,
        status: 0,
        headers: {},
        body: { kind: "error", message: "bridge disposed" },
      })
      return
    }
    init.signal = controller.signal

    let res: Response
    try {
      res = await fetch(url, init)
    } catch (err) {
      this.requests.delete(msg.id)
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
    try {
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
    } finally {
      this.requests.delete(msg.id)
    }
  }

  private async handleStreamOpen(msg: WebviewStreamOpenMessage): Promise<void> {
    // audit-2026-04-29 transport F5 — reject duplicate open: stream id
    // is supposed to be webview-unique, a collision means a contract
    // bug that would otherwise silently leak the prior controller's
    // upstream fetch by overwriting the Map entry.
    if (this.streams.has(msg.id)) {
      this.send({
        protocol: PROTOCOL_VERSION,
        type: "stream.error",
        id: msg.id,
        message: `stream id ${msg.id} is already open`,
      })
      return
    }
    const validation = validatePath(msg.path)
    if (!validation.ok) {
      // audit-2026-04-29 vscode-ext F1 — single envelope on validation
      // failure. Sending stream.close after stream.error for a stream
      // we never opened is a protocol violation: the webview's streams
      // Map has no entry for this id, so the close is a no-op there
      // but might confuse a future entry that reuses the id.
      this.send({
        protocol: PROTOCOL_VERSION,
        type: "stream.error",
        id: msg.id,
        message: validation.reason,
      })
      return
    }
    const url = buildUrl(this.sidecar.baseUrl, validation.path, msg.query)
    const controller = new AbortController()
    const stream: ActiveStream = {
      controller,
      buffer: [],
      bufferBytes: 0,
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
      buf = flush ? "" : blocks.pop() || ""
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
    stream.bufferBytes += data.length
    // audit-2026-04-29 W2-P3 — flush on EITHER event-count OR byte
    // ceiling, whichever comes first. A single 30 KiB reasoning blob
    // would otherwise sit in the buffer until the 16 ms timer fires
    // alongside up to 255 other events; that batch can balloon to
    // multi-MiB and stall the webview deserialiser.
    if (stream.buffer.length >= STREAM_BATCH_MAX || stream.bufferBytes >= STREAM_BATCH_MAX_BYTES) {
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
    stream.bufferBytes = 0
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
    try {
      stream.controller.abort()
    } catch {}
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

async function readResponseBody(
  res: Response,
  kind: WebviewRequestMessage["responseKind"],
): Promise<ResponseBodyEncoding> {
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
  h.forEach((v, k) => {
    out[k] = v
  })
  return out
}

async function runVsCodeNativeCommand(command: NativeCommand): Promise<unknown> {
  switch (command.kind) {
    case "open-url":
      return vscode.env.openExternal(vscode.Uri.parse(command.url))
    case "open-path":
      return vscode.env.openExternal(vscode.Uri.file(command.path))
    case "workspace.pickDir": {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: command.start ? vscode.Uri.file(command.start) : undefined,
      })
      return selected?.[0]?.fsPath ?? ""
    }
    case "workspace.pickFiles": {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: command.multiple ?? true,
        defaultUri: command.start ? vscode.Uri.file(command.start) : undefined,
      })
      return selected?.map((uri) => uri.fsPath) ?? []
    }
    case "workspace.openProjectEditor":
      if (command.editor !== "vscode") {
        throw new Error(`VS Code host cannot open project paths in ${command.editor}`)
      }
      return openProjectPathInVsCode(command.path)
    case "notification.permission":
    case "notification.requestPermission":
      return "granted" satisfies HostPermission
    case "notification.send":
      await vscode.window.showInformationMessage([command.title, command.body].filter(Boolean).join("\n"))
      return undefined
    default:
      throw new Error(`Native command "${command.kind}" is not available in the VS Code host.`)
  }
}

async function openProjectPathInVsCode(path: string): Promise<boolean> {
  const uri = vscode.Uri.file(path)
  try {
    const stat = await vscode.workspace.fs.stat(uri)
    if (stat.type === vscode.FileType.Directory) {
      await vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: true })
      return true
    }
  } catch {
    // Missing paths still flow to vscode.open so VS Code can surface
    // its own editor-level error with the exact target URI.
  }
  await vscode.commands.executeCommand("vscode.open", uri)
  return true
}

// Side-effect import suppression — keeps `http` import in case future
// changes need direct http handling. Strip if it remains unused.
void http
