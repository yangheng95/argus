import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { streamSSE } from "../../src/server/sse"

function timeout(ms: number) {
  return new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
  })
}

describe("server SSE abort lifecycle", () => {
  test("request signal abort reaches stream cleanup even when onAbort is registered later", async () => {
    let cleanupCount = 0
    let cleanupResolve!: () => void
    const cleanup = new Promise<void>((resolve) => {
      cleanupResolve = resolve
    })
    const app = new Hono()
    app.get("/events", (c) =>
      streamSSE(c, async (stream) => {
        await stream.writeSSE({ data: "connected" })
        await new Promise((resolve) => setTimeout(resolve, 50))
        await new Promise<void>((resolve) => {
          stream.onAbort(() => {
            cleanupCount += 1
            cleanupResolve()
            resolve()
          })
        })
      }),
    )
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: app.fetch,
    })
    const abort = new AbortController()
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/events`, { signal: abort.signal })
      expect(response.status).toBe(200)
      const reader = response.body?.getReader()
      if (!reader) throw new Error("missing response body reader")
      const first = await reader.read()
      expect(new TextDecoder().decode(first.value)).toContain("connected")
      abort.abort()
      await Promise.race([cleanup, timeout(2_000)])
      expect(cleanupCount).toBe(1)
    } finally {
      abort.abort()
      server.stop(true)
    }
  })
})
