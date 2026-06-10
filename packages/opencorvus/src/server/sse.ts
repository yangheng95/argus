import type { Context } from "hono"
import { streamSSE as honoStreamSSE, type SSEStreamingApi } from "hono/streaming"

type StreamSSECallback = (stream: SSEStreamingApi) => Promise<void>
type StreamSSEErrorHandler = (error: Error, stream: SSEStreamingApi) => Promise<void>
type AbortListener = () => void | Promise<void>

// SSE means Server-Sent Events; this wrapper is the only server-side SSE primitive.
function attachRequestAbort(c: Context, stream: SSEStreamingApi) {
  const signal = c.req.raw.signal
  const originalOnAbort = stream.onAbort.bind(stream) as (listener: AbortListener) => void

  stream.onAbort = ((listener: AbortListener) => {
    originalOnAbort(listener)
    if (stream.aborted || signal.aborted) {
      void listener()
    }
  }) as typeof stream.onAbort

  const abort = () => {
    stream.abort()
  }

  if (signal.aborted) {
    abort()
    return () => {}
  }

  signal.addEventListener("abort", abort, { once: true })
  return () => signal.removeEventListener("abort", abort)
}

export function streamSSE(c: Context, cb: StreamSSECallback, onError?: StreamSSEErrorHandler): Response {
  return honoStreamSSE(
    c,
    async (stream) => {
      const detach = attachRequestAbort(c, stream)
      try {
        await cb(stream)
      } finally {
        detach()
      }
    },
    onError,
  )
}
