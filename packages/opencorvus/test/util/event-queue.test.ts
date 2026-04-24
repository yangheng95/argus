import { describe, expect, test } from "bun:test"
import { createEventQueue } from "@/util/event-queue"

describe("createEventQueue", () => {
  test("yields pushed items in FIFO then ends on complete()", async () => {
    const q = createEventQueue<number>({ idleMs: 5000, label: "fifo" })
    q.push(1)
    q.push(2)
    q.push(3)
    q.complete()

    const out: number[] = []
    for await (const n of q.iterable) out.push(n)
    expect(out).toEqual([1, 2, 3])
  })

  test("aborts with AbortError when idleMs elapses with no push", async () => {
    const q = createEventQueue<string>({ idleMs: 40, label: "idle-test" })
    await expect(
      (async () => {
        for await (const _ of q.iterable) {
          /* noop */
        }
      })(),
    ).rejects.toThrow(/idle/i)
  })

  test("observe via push keeps the gate alive", async () => {
    const q = createEventQueue<number>({ idleMs: 80, label: "keepalive" })
    const collected: number[] = []
    const consumer = (async () => {
      for await (const n of q.iterable) {
        collected.push(n)
        if (collected.length >= 4) break
      }
    })()

    for (let i = 0; i < 4; i++) {
      await Bun.sleep(30)
      q.push(i)
    }
    await consumer
    expect(collected).toEqual([0, 1, 2, 3])
    q.complete()
  })

  test("external signal Error reason propagates as thrown error", async () => {
    const external = new AbortController()
    const q = createEventQueue<string>({ idleMs: 5000, signal: external.signal, label: "ext" })
    const consumer = (async () => {
      for await (const _ of q.iterable) {
        /* noop */
      }
    })()
    external.abort(new Error("caller cancelled"))
    await expect(consumer).rejects.toThrow("caller cancelled")
  })

  test("abort() throws provided reason through the consumer", async () => {
    const q = createEventQueue<string>({ idleMs: 5000, label: "hard-abort" })
    const consumer = (async () => {
      for await (const _ of q.iterable) {
        /* noop */
      }
    })()
    q.abort(new Error("poisoned"))
    await expect(consumer).rejects.toThrow("poisoned")
  })

  test("push after complete is a no-op", async () => {
    const q = createEventQueue<number>({ idleMs: 5000, label: "post-complete" })
    q.push(1)
    q.complete()
    q.push(2)
    const out: number[] = []
    for await (const n of q.iterable) out.push(n)
    expect(out).toEqual([1])
  })
})
