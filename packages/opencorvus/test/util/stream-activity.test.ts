import { describe, expect, test } from "bun:test"
import { abortableIterable, withStreamActivity } from "@/util/stream-activity"

describe("withStreamActivity", () => {
  test("aborts own signal once idleMs elapses with no observe()", async () => {
    const monitor = withStreamActivity({ idleMs: 40, label: "test-idle" })
    expect(monitor.signal.aborted).toBe(false)
    await Bun.sleep(90)
    expect(monitor.signal.aborted).toBe(true)
    expect(monitor.timedOut()).toBe(true)
    expect(String(monitor.signal.reason)).toContain("stream idle")
    expect(String(monitor.signal.reason)).toContain("test-idle")
    monitor.dispose()
  })

  test("observe() resets the timer and keeps the signal live", async () => {
    const monitor = withStreamActivity({ idleMs: 80 })
    for (let i = 0; i < 5; i++) {
      await Bun.sleep(30)
      monitor.observe()
    }
    expect(monitor.signal.aborted).toBe(false)
    monitor.dispose()
  })

  test("propagates external abort without waiting for idle window", async () => {
    const external = new AbortController()
    const monitor = withStreamActivity({ idleMs: 60_000, signal: external.signal })
    external.abort(new Error("caller cancelled"))
    expect(monitor.signal.aborted).toBe(true)
    expect(monitor.timedOut()).toBe(false) // external cancel, not idle
    monitor.dispose()
  })

  test("can be aborted by the owning session cancel path", () => {
    const monitor = withStreamActivity({ idleMs: 60_000, label: "session-owned" })
    monitor.abort(new DOMException("session cancelled", "AbortError"))
    expect(monitor.signal.aborted).toBe(true)
    expect(monitor.timedOut()).toBe(false)
    expect((monitor.signal.reason as DOMException).message).toBe("session cancelled")
    monitor.dispose()
  })

  test("dispose() is idempotent and stops the timer", async () => {
    const monitor = withStreamActivity({ idleMs: 20 })
    monitor.dispose()
    monitor.dispose()
    await Bun.sleep(60)
    expect(monitor.signal.aborted).toBe(false)
  })

  test("rejects non-positive idleMs", () => {
    expect(() => withStreamActivity({ idleMs: 0 })).toThrow()
    expect(() => withStreamActivity({ idleMs: -1 })).toThrow()
    expect(() => withStreamActivity({ idleMs: Number.NaN })).toThrow()
  })
})

describe("abortableIterable", () => {
  // Mimics Bun fetch + AI SDK reader: reader.read() promise stays pending
  // forever on a stalled socket; closing the underlying signal does NOT
  // reject the read. Without abortableIterable, a `for await` over this
  // would hang forever even with the monitor's signal aborted.
  function stalledSource<T>(): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator]() {
        return {
          // Never resolves, never rejects — exactly the failure mode we hit.
          next: () => new Promise<IteratorResult<T>>(() => {}),
          return: async () => ({ value: undefined as any, done: true }) as IteratorResult<T>,
        }
      },
    }
  }

  test("breaks out of a stalled iterator when the signal aborts", async () => {
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(new DOMException("idle", "AbortError")), 30)
    const start = Date.now()
    let caught: unknown = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of abortableIterable(stalledSource<number>(), ctrl.signal)) {
        // unreachable
      }
    } catch (err) {
      caught = err
    }
    const elapsed = Date.now() - start
    expect(caught).toBeInstanceOf(DOMException)
    expect((caught as DOMException).name).toBe("AbortError")
    expect(elapsed).toBeLessThan(500)
  })

  test("yields values normally when the source progresses", async () => {
    async function* src() {
      yield 1
      yield 2
      yield 3
    }
    const ctrl = new AbortController()
    const out: number[] = []
    for await (const v of abortableIterable(src(), ctrl.signal)) out.push(v)
    expect(out).toEqual([1, 2, 3])
  })

  test("calls iter.return() to release upstream when aborted mid-stream", async () => {
    let returned = false
    const src: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        let i = 0
        return {
          next: async () => {
            if (i === 0) {
              i++
              return { value: 1, done: false }
            }
            return new Promise<IteratorResult<number>>(() => {})
          },
          return: async () => {
            returned = true
            return { value: undefined as any, done: true }
          },
        }
      },
    }
    const ctrl = new AbortController()
    const it = abortableIterable(src, ctrl.signal)
    const consumer = (async () => {
      try {
        for await (const _ of it) {
          /* drain first */
        }
      } catch {
        /* expected */
      }
    })()
    await Bun.sleep(20)
    ctrl.abort(new DOMException("idle", "AbortError"))
    await consumer
    expect(returned).toBe(true)
  })
})
