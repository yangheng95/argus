import { describe, expect, test } from "bun:test"
import { runHookIsolated } from "../../src/plugin/isolate"
import { Log } from "../../src/util/log"

Log.init({ print: false })

/**
 * audit-2026-04-29 W2-V19. Plugin hooks run as 3rd-party code.
 * Pre-fix any throw in `Plugin.trigger` propagated up through the
 * caller's await — chat.params before the LLM call, shell.env
 * before tool exec, config during session bootstrap — and crashed
 * the entire lifecycle path. A single buggy plugin took down
 * sessions for everyone.
 *
 * Post-fix: every hook invocation goes through runHookIsolated,
 * which catches sync throws AND async rejections and logs loud
 * instead of propagating. Lock the contract here.
 */

describe("runHookIsolated (audit W2-V19)", () => {
  test("returns the hook's return value on success (sync)", async () => {
    const out = await runHookIsolated("test", () => 42, [])
    expect(out).toBe(42)
  })

  test("returns the hook's resolved value on success (async)", async () => {
    const out = await runHookIsolated("test", async () => "ok", [])
    expect(out).toBe("ok")
  })

  test("undefined / null hook returns undefined without invoking anything", async () => {
    const out1 = await runHookIsolated("test", undefined, [])
    expect(out1).toBeUndefined()
    const out2 = await runHookIsolated("test", null, [])
    expect(out2).toBeUndefined()
  })

  test("sync throw is isolated → returns undefined, does NOT propagate", async () => {
    const calls: any[] = []
    const fakeLog = ((msg: string, extra: any) => {
      calls.push({ msg, extra })
    }) as any
    const out = await runHookIsolated(
      "chat.params",
      () => {
        throw new Error("plugin bug")
      },
      [],
      fakeLog,
    )
    expect(out).toBeUndefined()
    expect(calls.length).toBe(1)
    expect(calls[0].extra.hook).toBe("chat.params")
    expect(calls[0].extra.error).toContain("plugin bug")
  })

  test("async rejection is isolated → returns undefined, does NOT propagate", async () => {
    const calls: any[] = []
    const fakeLog = ((msg: string, extra: any) => {
      calls.push({ msg, extra })
    }) as any
    const out = await runHookIsolated(
      "config",
      async () => {
        throw new Error("config blew up")
      },
      [],
      fakeLog,
    )
    expect(out).toBeUndefined()
    expect(calls.length).toBe(1)
    expect(calls[0].extra.hook).toBe("config")
    expect(calls[0].extra.error).toContain("config blew up")
  })

  test("non-Error throw is stringified safely (no second crash)", async () => {
    const calls: any[] = []
    const fakeLog = ((msg: string, extra: any) => {
      calls.push({ msg, extra })
    }) as any
    const out = await runHookIsolated(
      "event",
      () => {
        throw "string-thrown-not-an-Error"
      },
      [],
      fakeLog,
    )
    expect(out).toBeUndefined()
    expect(calls[0].extra.error).toBe("string-thrown-not-an-Error")
  })

  test("regression scenario — three hooks, middle one crashes, others still get a turn", async () => {
    // Production loop in plugin/index.ts iterates hooks and calls
    // runHookIsolated on each. A throw in hook #2 must not stop
    // hook #3 — that's the whole point of isolation.
    const order: number[] = []
    const calls: any[] = []
    const fakeLog = ((m: string, e: any) => {
      calls.push({ m, extra: e })
    }) as any
    const hooks = [
      () => {
        order.push(1)
      },
      () => {
        order.push(2)
        throw new Error("middle")
      },
      () => {
        order.push(3)
      },
    ]
    for (let i = 0; i < hooks.length; i++) {
      await runHookIsolated(`hook${i}`, hooks[i], [], fakeLog)
    }
    expect(order).toEqual([1, 2, 3])
    expect(calls.length).toBe(1)
    expect(calls[0].extra.hook).toBe("hook1")
  })

  test("hook arguments are forwarded as-is", async () => {
    const seen: any[] = []
    await runHookIsolated(
      "test",
      (a: number, b: string) => {
        seen.push([a, b])
      },
      [42, "x"],
    )
    expect(seen).toEqual([[42, "x"]])
  })
})
