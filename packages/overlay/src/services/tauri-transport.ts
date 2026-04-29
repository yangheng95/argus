/**
 * tauri-transport — HostTransport implementation for the Tauri overlay
 * window. This is essentially the historical direct-fetch + EventSource
 * + Tauri invoke logic, refactored behind the HostTransport interface so
 * the overlay's services layer never sees the host details.
 *
 * Reads URL / auth state from `services/api.ts` to keep behaviour
 * identical to the pre-M3 codebase. The api module remains the single
 * configuration surface (configure(), getServerUrl(), apiHeaders()),
 * which lets settings panels keep working unchanged in M3.A.
 */

import {
  apiHeaders as apiHeadersFromState,
  apiUrl as apiUrlFromState,
} from "./api"
import type {
  HostTransport,
  RequestBody,
  ResponseKind,
  StreamHandle,
  StreamHandlers,
  StreamOpenRequest,
  TransportRequest,
  TransportResponse,
} from "./host-transport"

function buildUrl(path: string, query?: TransportRequest["query"]): URL {
  // apiUrl already handles serverUrl + ?directory= injection.
  const u = new URL(apiUrlFromState(path))
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue
      u.searchParams.set(k, String(v))
    }
  }
  return u
}

function applyBody(init: RequestInit, body?: RequestBody): RequestInit {
  if (!body || body.kind === "none") return init
  switch (body.kind) {
    case "json":
      return {
        ...init,
        body: JSON.stringify(body.value),
        headers: { "Content-Type": "application/json", ...(init.headers as Record<string, string> | undefined) },
      }
    case "text":
      return {
        ...init,
        body: body.value,
        headers: { "Content-Type": "text/plain;charset=utf-8", ...(init.headers as Record<string, string> | undefined) },
      }
    case "form":
      // FormData sets its own multipart Content-Type with boundary.
      return { ...init, body: body.value }
    case "binary":
      return {
        ...init,
        body: body.value as unknown as BodyInit,
        headers: {
          ...(body.contentType ? { "Content-Type": body.contentType } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
      }
  }
}

async function readResponse<T>(res: Response, kind: ResponseKind | undefined): Promise<T> {
  switch (kind) {
    case "text":
      return (await res.text()) as unknown as T
    case "binary": {
      const blob = await res.blob()
      const buf = new Uint8Array(await blob.arrayBuffer())
      return buf as unknown as T
    }
    case "json":
    case undefined: {
      // Empty 204/no-content bodies — return undefined so callers don't
      // hit JSON.parse on "".
      const text = await res.text()
      if (!text) return undefined as unknown as T
      return JSON.parse(text) as T
    }
  }
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}

export function createTauriTransport(): HostTransport {
  return {
    kind: "tauri",
    async request<T = unknown>(input: TransportRequest): Promise<TransportResponse<T>> {
      const url = buildUrl(input.path, input.query)
      const init: RequestInit = applyBody(
        {
          method: input.method ?? "GET",
          headers: { ...apiHeadersFromState(), ...(input.headers ?? {}) },
          signal: input.signal,
        },
        input.body,
      )
      const res = await fetch(url.toString(), init)
      const body = res.ok || input.responseKind === "binary"
        ? await readResponse<T>(res, input.responseKind)
        : (undefined as unknown as T)
      return {
        status: res.status,
        ok: res.ok,
        headers: headersToObject(res.headers),
        body,
      }
    },
    openStream(input: StreamOpenRequest, handlers: StreamHandlers): StreamHandle {
      // Native EventSource: WebView2 (Tauri's webview backend) is known
      // to buffer ReadableStream chunks from fetch(), so SSE must NOT
      // be polyfilled on top of fetch in this transport. The note in
      // services/sse.ts documents the original incident.
      const url = buildUrl(input.path, input.query)
      // EventSource cannot carry custom Authorization headers in the
      // browser — we rely on the same-origin cookie-less Basic Auth
      // path provided by the Tauri webview. The vscode transport will
      // re-introduce auth via the postMessage bridge in M4.
      const source = new EventSource(url.toString())
      let closed = false
      source.addEventListener("open", () => {
        try { handlers.onOpen?.() } catch {}
      })
      source.addEventListener("message", (e) => {
        try { handlers.onEvent((e as MessageEvent).data as string) } catch {}
      })
      source.addEventListener("error", () => {
        // EventSource fires error on every transient disconnect.
        // - readyState CONNECTING: browser is auto-reconnecting; surface
        //   the error so UI can show disconnected state but DON'T fire
        //   onClose (the stream may recover).
        // - readyState CLOSED: connection is permanently dead; fire
        //   onClose so the consumer can decide on its own reconnect
        //   policy (plan §5.5: transport doesn't own reconnect).
        try { handlers.onError?.(new Error("event-source error")) } catch {}
        if (source.readyState === EventSource.CLOSED && !closed) {
          closed = true
          try { handlers.onClose?.("event-source-closed") } catch {}
        }
      })
      return {
        close() {
          if (closed) return
          closed = true
          try { source.close() } catch {}
          try { handlers.onClose?.("client-close") } catch {}
        },
      }
    },
  }
}
