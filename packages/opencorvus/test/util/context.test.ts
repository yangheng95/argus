import { describe, expect, test } from "bun:test"
import { Context } from "../../src/util/context"

describe("util.Context.tryUse (Phase 0)", () => {
  test("tryUse returns undefined outside any provide() scope", () => {
    const c = Context.create<{ id: string }>("ctx-a")
    expect(c.tryUse()).toBeUndefined()
  })

  test("tryUse returns the active value inside provide()", () => {
    const c = Context.create<{ id: string }>("ctx-b")
    const seen = c.provide({ id: "s1" }, () => c.tryUse())
    expect(seen).toEqual({ id: "s1" })
  })

  test("tryUse does not throw where use() would (CLI / control plane path)", () => {
    const c = Context.create<{ id: string }>("ctx-c")
    expect(() => c.use()).toThrow(Context.NotFound)
    expect(() => c.tryUse()).not.toThrow()
  })

  test("nested provide: innermost value wins, restores after exit", () => {
    const c = Context.create<{ id: string }>("ctx-d")
    const trail: Array<string | undefined> = []
    c.provide({ id: "outer" }, () => {
      trail.push(c.tryUse()?.id)
      c.provide({ id: "inner" }, () => {
        trail.push(c.tryUse()?.id)
      })
      trail.push(c.tryUse()?.id)
    })
    trail.push(c.tryUse()?.id)
    expect(trail).toEqual(["outer", "inner", "outer", undefined])
  })

  test("async work inside provide keeps the context", async () => {
    const c = Context.create<{ id: string }>("ctx-e")
    const got = await c.provide({ id: "async" }, async () => {
      await new Promise((r) => setTimeout(r, 1))
      return c.tryUse()?.id
    })
    expect(got).toBe("async")
  })
})
