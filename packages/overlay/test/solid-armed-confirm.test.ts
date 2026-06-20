import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createRoot } from "solid-js"
import { useArmedConfirm } from "../src/solid/armed-confirm"

const TASK_LIST_SOURCE = join(import.meta.dir, "..", "src", "components", "TaskList.tsx")
const MISSION_LIST_SOURCE = join(import.meta.dir, "..", "src", "components", "MissionList.tsx")
const CODING_ASSISTANT_SESSION_LIST_SOURCE = join(
  import.meta.dir,
  "..",
  "src",
  "components",
  "CodingAssistantSessionList.tsx",
)
const ARMED_CONFIRM_BUTTON_SOURCE = join(import.meta.dir, "..", "src", "components", "ui", "ArmedConfirmButton.tsx")

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
  const taskListSource = readFileSync(TASK_LIST_SOURCE, "utf8")
  const missionListSource = readFileSync(MISSION_LIST_SOURCE, "utf8")
  const codingAssistantSessionListSource = readFileSync(CODING_ASSISTANT_SESSION_LIST_SOURCE, "utf8")
  const armedConfirmButtonSource = readFileSync(ARMED_CONFIRM_BUTTON_SOURCE, "utf8")

  test("destructive ledger actions route through ArmedConfirmButton", () => {
    expect(armedConfirmButtonSource).toContain('from "../../solid/armed-confirm"')
    expect(armedConfirmButtonSource).toContain("useArmedConfirm(local.confirmWindowMs)")
    expect(armedConfirmButtonSource).toContain('aria-pressed={confirm.armed() ? "true" : "false"}')
    expect(armedConfirmButtonSource).toContain("aria-describedby={confirm.armed() ? descriptionID() : undefined}")
    expect(armedConfirmButtonSource).toContain('role="status"')
    expect(armedConfirmButtonSource).toContain('aria-live="polite"')
    expect(armedConfirmButtonSource).toContain('data-confirm={confirm.armed() ? "true" : undefined}')

    for (const source of [taskListSource, missionListSource, codingAssistantSessionListSource]) {
      expect(source).toContain("ArmedConfirmButton")
      expect(source).not.toContain("../solid/armed-confirm")
      expect(source).not.toContain("useArmedConfirm(")
      expect(source).not.toContain("data-confirm={")
      expect(source).not.toContain("confirmDelete.confirm")
      expect(source).not.toContain("confirmCancel.confirm")
      expect(source).not.toContain("confirmAbort.confirm")
      expect(source).not.toContain("confirmStop.confirm")
    }
  })
})
