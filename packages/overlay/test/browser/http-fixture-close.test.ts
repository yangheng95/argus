import assert from "node:assert/strict"
import test from "node:test"

import { startBrowserFixture } from "./http-fixture.ts"

test("browser fixture close destroys active streaming HTTP connections", async () => {
  const server = await startBrowserFixture(() => {
    return new Response(":\n\n", {
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    })
  })
  const controller = new AbortController()
  try {
    const response = await fetch(`${server.origin}/events`, { signal: controller.signal })
    assert.equal(response.status, 200)
    const started = Date.now()
    await server.close()
    assert.ok(Date.now() - started < 1_000, "fixture close should not wait for the event-stream idle timeout")
  } finally {
    controller.abort()
  }
})
