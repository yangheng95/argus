import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createRoot } from "solid-js"
import { useArmedConfirm } from "../src/solid/armed-confirm"

const TASK_LIST_SOURCE = join(import.meta.dir, "..", "src", "components", "TaskList.tsx")

describe("useArmedConfirm — behaviour", () => {
  test("starts disarmed", () => {
    createRoot((dispose) => {
      const confirm = useArmedConfirm()
      expect(confirm.armed()).toBe(false)
      dispose()
    })
  })

  test("first confirm arms and does not commit", () => {
    createRoot((dispose) => {
      const confirm = useArmedConfirm()
      let commits = 0

      expect(confirm.confirm(() => commits++)).toBe(false)
      expect(confirm.armed()).toBe(true)
      expect(commits).toBe(0)
      dispose()
    })
  })

  test("second confirm commits and disarms", () => {
    createRoot((dispose) => {
      const confirm = useArmedConfirm()
      let commits = 0

      confirm.confirm(() => commits++)
      expect(confirm.confirm(() => commits++)).toBe(true)
      expect(confirm.armed()).toBe(false)
      expect(commits).toBe(1)
      dispose()
    })
  })

  test("confirm window expires automatically", async () => {
    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const confirm = useArmedConfirm(10)
        confirm.confirm(() => {})
        expect(confirm.armed()).toBe(true)
        setTimeout(() => {
          expect(confirm.armed()).toBe(false)
          dispose()
          resolve()
        }, 30)
      })
    })
  })
})

describe("useArmedConfirm — adoption", () => {
  const source = readFileSync(TASK_LIST_SOURCE, "utf8")

  test("TaskList uses the shared armed confirm hook for destructive row actions", () => {
    expect(source).toContain('from "../solid/armed-confirm"')
    expect(source).toContain("const confirmDelete = useArmedConfirm(CONFIRM_WINDOW_MS)")
    expect(source).toContain("const confirmCancel = useArmedConfirm(CONFIRM_WINDOW_MS)")
    expect(source).not.toContain("const [armed, setArmed] = createSignal(false)")
  })
})
