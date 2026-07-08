import { describe, expect, test } from "bun:test"
import { withBrowserInactivityTimeout } from "../../script/benchmark/browser-inactivity"

type Handler = (payload: unknown) => void

class FakePage {
  readonly handlers = new Map<string, Set<Handler>>()

  on(event: string, handler: Handler): void {
    const handlers = this.handlers.get(event) ?? new Set<Handler>()
    handlers.add(handler)
    this.handlers.set(event, handlers)
  }

  off(event: string, handler: Handler): void {
    const handlers = this.handlers.get(event)
    if (!handlers) return
    handlers.delete(handler)
    if (handlers.size === 0) this.handlers.delete(event)
  }
}

describe("browser benchmark inactivity helper", () => {
  test("removes page activity listeners after each action", async () => {
    const page = new FakePage()

    await withBrowserInactivityTimeout(page as never, "first", 1_000, async () => "first")
    await withBrowserInactivityTimeout(page as never, "second", 1_000, async () => "second")

    expect([...page.handlers.entries()]).toEqual([])
  })
})
