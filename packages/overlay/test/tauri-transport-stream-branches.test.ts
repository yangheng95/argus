import { afterEach, describe, expect, test } from "bun:test"
import { configure } from "../src/services/api"
import { createTauriTransport } from "../src/services/tauri-transport"

const originalFetch = globalThis.fetch
const originalEventSource = globalThis.EventSource

type Listener = (event?: MessageEvent) => void

class FakeEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2

  readonly url: string
  readyState = FakeEventSource.CONNECTING
  closed = false
  listeners = new Map<string, Listener[]>()

  constructor(url: string) {
    this.url = url
    createdSources.push(this)
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  close(): void {
    this.closed = true
    this.readyState = FakeEventSource.CLOSED
  }

  emit(type: string, data = ""): void {
    if (type === "open") this.readyState = FakeEventSource.OPEN
    const event = { data } as MessageEvent
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

const createdSources: FakeEventSource[] = []

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.EventSource = originalEventSource
  createdSources.length = 0
  configure({
    serverUrl: "http://127.0.0.1:7878",
    username: "opencorvus",
    password: "",
    directory: "",
  })
})

describe("tauri HostTransport stream branch coverage", () => {
  test("unauthenticated GET streams use native EventSource instead of fetch", () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = []
    globalThis.fetch = (async (input, init) => {
      fetchCalls.push([input, init])
      throw new Error("native EventSource branch must not fetch")
    }) as typeof fetch
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
    configure({ serverUrl: "http://overlay.test", password: "", directory: "" })

    const events: string[] = []
    const opens: string[] = []
    const closes: string[] = []
    const handle = createTauriTransport().openStream(
      { path: "task/tsk_stream/events", query: { after: "5" } },
      {
        onOpen: () => opens.push("open"),
        onEvent: (event) => events.push(event),
        onClose: (reason) => closes.push(reason ?? ""),
      },
    )

    expect(createdSources).toHaveLength(1)
    expect(createdSources[0]!.url).toBe("http://overlay.test/task/tsk_stream/events?after=5")
    expect(fetchCalls).toEqual([])

    createdSources[0]!.emit("open")
    createdSources[0]!.emit("message", '{"type":"task.updated"}')
    expect(opens).toEqual(["open"])
    expect(events).toEqual(['{"type":"task.updated"}'])

    handle.close()
    expect(createdSources[0]!.closed).toBe(true)
    expect(closes).toEqual(["client-close"])
  })

  test("authenticated GET streams use fetch SSE so Authorization headers are sent", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
    globalThis.fetch = (async (input, init) => {
      requests.push({ url: String(input), init })
      return sseResponse("data: first\n\ndata: second\n\n")
    }) as typeof fetch
    configure({ serverUrl: "http://overlay.test", username: "opencorvus", password: "secret", directory: "" })

    const events: string[] = []
    const opens: string[] = []
    const closed = new Promise<string>((resolve) => {
      createTauriTransport().openStream(
        { path: "task/tsk_stream/events", query: { after: "7" } },
        {
          onOpen: () => opens.push("open"),
          onEvent: (event) => events.push(event),
          onClose: (reason) => resolve(reason ?? ""),
        },
      )
    })

    await expect(closed).resolves.toBe("post-stream-done")
    expect(createdSources).toEqual([])
    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toBe("http://overlay.test/task/tsk_stream/events?after=7")
    expect(requests[0]!.init?.method).toBe("GET")
    expect((requests[0]!.init?.headers as Record<string, string>).Authorization).toBe("Basic b3BlbmNvcnZ1czpzZWNyZXQ=")
    expect(opens).toEqual(["open"])
    expect(events).toEqual(["first", "second"])
  })

  test("POST streams use fetch SSE with the JSON request body", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
    globalThis.fetch = (async (input, init) => {
      requests.push({ url: String(input), init })
      return sseResponse('data: {"kind":"accepted"}\n\n')
    }) as typeof fetch
    configure({ serverUrl: "http://overlay.test", password: "", directory: "" })

    const events: string[] = []
    const closed = new Promise<string>((resolve) => {
      createTauriTransport().openStream(
        {
          path: "panel/message/stream",
          method: "POST",
          body: { kind: "json", value: { taskID: "tsk_stream", text: "hello" } },
        },
        {
          onEvent: (event) => events.push(event),
          onClose: (reason) => resolve(reason ?? ""),
        },
      )
    })

    await expect(closed).resolves.toBe("post-stream-done")
    expect(createdSources).toEqual([])
    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toBe("http://overlay.test/panel/message/stream")
    expect(requests[0]!.init?.method).toBe("POST")
    expect((requests[0]!.init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json")
    expect(requests[0]!.init?.body).toBe(JSON.stringify({ taskID: "tsk_stream", text: "hello" }))
    expect(events).toEqual(['{"kind":"accepted"}'])
  })
})

function sseResponse(body: string): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body))
        controller.close()
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  )
}
