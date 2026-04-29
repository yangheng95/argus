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
  NativeCommand,
  RequestBody,
  ResponseKind,
  StreamHandle,
  StreamHandlers,
  StreamOpenRequest,
  TransportRequest,
  TransportResponse,
} from "./host-transport"
import { nativeUnsupported } from "./host-transport"

/**
 * Tauri window-handle accessor — the ONE place in the overlay that
 * touches `window.__TAURI__.window`. WindowControls.tsx calls this so
 * its Tauri-only window controls do not need their own `__TAURI__`
 * sniff (CLAUDE.md §二-8: single chokepoint). Returns null when the
 * Tauri runtime is not present, which the caller treats as "no
 * window controls available" — vscode webview is one such caller.
 */
export function getTauriWindowHandle(): any | null {
  if (typeof globalThis === "undefined") return null
  const w = (globalThis as any).window
  if (!w) return null
  const getCurrent = w.__TAURI__?.window?.getCurrentWindow
  if (typeof getCurrent !== "function") return null
  try {
    return getCurrent() ?? null
  } catch {
    return null
  }
}

/**
 * Wrapper for `window.__TAURI__.core.invoke`. This is now the SOLE
 * place in the entire overlay codebase that calls a Tauri invoke —
 * all business code goes through `host.native(...)` (CLAUDE.md §二-7,
 * §二-8). Throws if the runtime is missing so the caller surface
 * matches the vscode-transport's UnsupportedNativeCommandError.
 */
function invokeTauri(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const w = (typeof globalThis !== "undefined" ? (globalThis as any).window : undefined) as any
  const fn = w?.__TAURI__?.core?.invoke
  if (typeof fn !== "function") {
    throw new Error(`Tauri runtime unavailable for ${command}`)
  }
  return fn(command, args)
}

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

/**
 * POST-stream support: routes like /panel/message/stream send a JSON
 * body and stream the response as text/event-stream. EventSource cannot
 * do POST, so this path uses fetch + ReadableStream + manual SSE block
 * parsing. The Tauri WebView2 buffering issue does NOT apply here
 * because POST body upload triggers HTTP/1.1 (not HTTP/2), and our
 * server emits double-newline boundaries that flush per-block.
 */
function openPostStream(input: StreamOpenRequest, handlers: StreamHandlers): StreamHandle {
  const controller = new AbortController()
  const signal = input.signal
    ? mergeAbort(input.signal, controller.signal)
    : controller.signal
  let closed = false
  const url = buildUrl(input.path, input.query)
  const init: RequestInit = applyBody(
    {
      method: "POST",
      headers: {
        ...apiHeadersFromState(),
        ...(input.headers ?? {}),
      },
      signal,
    },
    input.body,
  )

  // Fire-and-forget: the close handle returns synchronously.
  void (async () => {
    let res: Response
    try {
      res = await fetch(url.toString(), init)
    } catch (err) {
      if (closed) return
      const error = err instanceof Error ? err : new Error(String(err))
      try { handlers.onError?.(error) } catch {}
      try { handlers.onClose?.("post-stream-fetch-error") } catch {}
      return
    }
    if (!res.ok || !res.body) {
      try { handlers.onError?.(new Error(`POST stream ${res.status}: ${res.statusText}`)) } catch {}
      try { handlers.onClose?.("post-stream-bad-response") } catch {}
      return
    }
    try { handlers.onOpen?.() } catch {}

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
        if (!data) continue
        try { handlers.onEvent(data) } catch {}
      }
    }

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          consume(decoder.decode(), true)
          break
        }
        consume(decoder.decode(value, { stream: true }))
      }
    } catch (err) {
      if (!closed) {
        const error = err instanceof Error ? err : new Error(String(err))
        try { handlers.onError?.(error) } catch {}
      }
    } finally {
      if (!closed) {
        closed = true
        try { handlers.onClose?.("post-stream-done") } catch {}
      }
    }
  })()

  return {
    close() {
      if (closed) return
      closed = true
      try { controller.abort() } catch {}
      try { handlers.onClose?.("client-close") } catch {}
    },
  }
}

function mergeAbort(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a
  if (b.aborted) return b
  const c = new AbortController()
  const onA = () => c.abort()
  const onB = () => c.abort()
  a.addEventListener("abort", onA, { once: true })
  b.addEventListener("abort", onB, { once: true })
  return c.signal
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
      const method = input.method ?? "GET"
      if (method === "POST") {
        return openPostStream(input, handlers)
      }
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
    async native(command: NativeCommand): Promise<unknown> {
      switch (command.kind) {
        case "open-url":
          return invokeTauri("overlay_open_url", { url: command.url })
        case "open-path":
          return invokeTauri("overlay_open_path", { path: command.path })
        case "settings.load":
          return invokeTauri("overlay_settings_load")
        case "settings.save":
          return invokeTauri("overlay_settings_save", { settings: command.payload })
        case "config.write-file":
          return invokeTauri("overlay_write_file", { path: command.path, content: command.content })
        case "server.info":
          return invokeTauri("overlay_server_info")
        case "server.restart":
          return invokeTauri("overlay_server_restart")
        case "devtools.toggle":
          return invokeTauri("overlay_toggle_devtools")
        case "tray.attention.set":
          return invokeTauri("overlay_attention_set", { active: command.active })
        case "workspace.pickDir":
          return invokeTauri("overlay_pick_dir", { start: command.start || undefined })
        case "workspace.pickFiles":
          return invokeTauri("overlay_pick_files", {
            start: command.start || undefined,
            multiple: command.multiple ?? true,
          })
        case "workspace.createDir":
          return invokeTauri("overlay_create_dir", { path: command.path })
        default: {
          // Exhaustiveness — TypeScript narrows `command` to `never` here.
          // If a new NativeCommand kind is added without a case above, the
          // type-checker rejects this default.
          const _exhaustive: never = command
          void _exhaustive
          return nativeUnsupported("tauri", command)
        }
      }
    },
  }
}
