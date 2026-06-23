import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import z from "zod"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { GlobalBus } from "../../src/bus/global"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { streamSSE } from "../../src/server/sse"
import { tmpdir } from "../fixture/fixture"
import { expectNoProcessErrors } from "../fixture/process-errors"

const SseTestEvent = BusEvent.define("sse.abort.test", z.object({ value: z.string() }))

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

  test("global event stream abort does not leak late writes", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: Server.App().fetch,
    })
    const abort = new AbortController()
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/global/event`, { signal: abort.signal })
      expect(response.status).toBe(200)
      const reader = response.body?.getReader()
      if (!reader) throw new Error("missing response body reader")
      const first = await reader.read()
      expect(new TextDecoder().decode(first.value)).toContain("server.connected")

      await expectNoProcessErrors(async () => {
        abort.abort()
        GlobalBus.emit("event", {
          directory: "test",
          payload: { type: SseTestEvent.type, properties: { value: "late-global" } },
        })
      })
    } finally {
      abort.abort()
      server.stop(true)
    }
  })

  test("project event stream abort does not leak late writes", async () => {
    await using tmp = await tmpdir({ git: true })
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: Server.App().fetch,
    })
    const abort = new AbortController()
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/event`, {
        signal: abort.signal,
        headers: {
          "x-opencorvus-directory": tmp.path,
        },
      })
      expect(response.status).toBe(200)
      const reader = response.body?.getReader()
      if (!reader) throw new Error("missing response body reader")
      const first = await reader.read()
      expect(new TextDecoder().decode(first.value)).toContain("server.connected")

      await expectNoProcessErrors(async () => {
        abort.abort()
        await Instance.provide({
          directory: tmp.path,
          fn: () => Bus.publish(SseTestEvent, { value: "late-project" }),
        })
      })
    } finally {
      abort.abort()
      server.stop(true)
      await Instance.disposeAll()
    }
  })
})
