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
})
