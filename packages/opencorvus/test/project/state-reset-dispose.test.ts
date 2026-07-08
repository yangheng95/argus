import { describe, expect, test } from "bun:test"
import { State } from "../../src/project/state"

describe("project State reset disposal", () => {
  test("reset disposes the dropped entry instead of only deleting the cache index", async () => {
    const disposed: string[] = []
    let key = "project-a"
    const state = State.create(
      () => key,
      () => ({ id: key }),
      async (entry) => {
        disposed.push(entry.id)
      },
    )

    expect(state()).toEqual({ id: "project-a" })
    await state.reset()

    expect(disposed).toEqual(["project-a"])
    expect(state()).toEqual({ id: "project-a" })
  })

  test("reset waits for pending async state without a disposer before removing the entry", async () => {
    let release!: () => void
    const ready = new Promise<void>((resolve) => {
      release = resolve
    })
    let key = "project-reset-pending"
    const state = State.create(
      () => key,
      async () => {
        await ready
        return { id: key }
      },
    )

    const first = state()
    let finished = false
    const reset = state.reset().then(() => {
      finished = true
    })
    await Promise.resolve()

    expect(finished).toBe(false)
    release()
    await reset
    await expect(first).resolves.toEqual({ id: "project-reset-pending" })
    expect(state()).not.toBe(first)
  })

  test("reset rejects and keeps the entry when disposal fails", async () => {
    let fail = true
    let key = "project-reset-failure"
    const state = State.create(
      () => key,
      () => ({ id: key }),
      async () => {
        if (fail) throw new Error("dispose failed")
      },
    )

    const first = state()
    await expect(state.reset()).rejects.toThrow("dispose failed")
    expect(state()).toBe(first)

    fail = false
    await state.reset()
    expect(state()).not.toBe(first)
  })

  test("resetAll disposes entries for every project key", async () => {
    const disposed: string[] = []
    let key = "project-a"
    const state = State.create(
      () => key,
      () => ({ id: key }),
      async (entry) => {
        disposed.push(entry.id)
      },
    )

    state()
    key = "project-b"
    state()

    await state.resetAll()

    expect(disposed.sort()).toEqual(["project-a", "project-b"])
  })

  test("dispose rejects and keeps failed entries for retry", async () => {
    let fail = true
    const key = "project-dispose-failure"
    const state = State.create(
      () => key,
      () => ({ id: key }),
      async () => {
        if (fail) throw new Error("dispose failed")
      },
    )

    const first = state()
    await expect(State.dispose(key)).rejects.toThrow("dispose failed")
    expect(state()).toBe(first)

    fail = false
    await State.dispose(key)
    expect(state()).not.toBe(first)
  })

  test("dispose waits for pending async state without a disposer before removing the entry", async () => {
    let release!: () => void
    const ready = new Promise<void>((resolve) => {
      release = resolve
    })
    const key = "project-dispose-pending"
    const state = State.create(
      () => key,
      async () => {
        await ready
        return { id: key }
      },
    )

    const first = state()
    let finished = false
    const dispose = State.dispose(key).then(() => {
      finished = true
    })
    await Promise.resolve()

    expect(finished).toBe(false)
    release()
    await dispose
    await expect(first).resolves.toEqual({ id: "project-dispose-pending" })
    expect(state()).not.toBe(first)
  })
})
