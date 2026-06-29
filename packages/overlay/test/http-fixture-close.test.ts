import { expect, test } from "bun:test"

import { startBrowserFixture } from "./browser/http-fixture.ts"

test("browser fixture close destroys active streaming HTTP connections", async () => {
  const server = await startBrowserFixture(() => {
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(":\n\n"))
        },
      }),
      {
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      },
    )
  })
  const controller = new AbortController()
  try {
    const response = await fetch(`${server.origin}/events`, { signal: controller.signal })
    expect(response.status).toBe(200)
    const started = Date.now()
    await server.close()
    expect(Date.now() - started).toBeLessThan(1_000)
  } finally {
    controller.abort()
  }
})
