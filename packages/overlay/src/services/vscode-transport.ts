/**
 * vscode-transport — HostTransport implementation for the VS Code
 * webview host. M3.A intentionally ships this as a stub that throws on
 * every call so any accidental load in a real webview surfaces a
 * concrete, actionable error.
 *
 * The real implementation lands in M4
 * (plan-vscode-extension.md §5.2 / §19.2.3 / §19.3.3):
 *  - acquireVsCodeApi() once
 *  - postMessage envelopes for request / stream.open / stream.event
 *  - extension-host bridge injects Basic Auth, normalises path, and
 *    routes streams to a single sidecar SSE per channel
 *  - protocol version negotiation rejects mismatched webview/extension
 *    builds (no fallback compatibility shim)
 */

import type {
  HostTransport,
  StreamHandle,
  StreamHandlers,
  StreamOpenRequest,
  TransportRequest,
} from "./host-transport"

export function createVsCodeTransport(): HostTransport {
  return {
    kind: "vscode",
    async request<T = unknown>(_input: TransportRequest): Promise<never> {
      throw new Error(
        "vscode-transport.request() is not wired yet — lands in M4 (plan §5.2). " +
          "M3.A ships only the tauri path so the overlay's services layer can be " +
          "rerouted through HostTransport without changing host behaviour.",
      )
      // T is unused at runtime; the signature is kept to match the interface.
      void (null as unknown as T)
    },
    openStream(_input: StreamOpenRequest, handlers: StreamHandlers): StreamHandle {
      const err = new Error(
        "vscode-transport.openStream() is not wired yet — lands in M4 (plan §5.5).",
      )
      // Surface the error synchronously through the handler chain so
      // callers don't need a separate "init failed" code path.
      queueMicrotask(() => {
        try { handlers.onError?.(err) } catch {}
        try { handlers.onClose?.("vscode-transport-stub") } catch {}
      })
      return { close() {} }
    },
  }
}
