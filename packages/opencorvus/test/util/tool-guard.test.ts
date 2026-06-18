import { describe, expect, test } from "bun:test"
import { toolGuard } from "../../src/util/tool-guard"

describe("toolGuard", () => {
  test("does not hide repeated tool failures behind a host circuit breaker", async () => {
    let calls = 0
    const originalErrors: string[] = []
    const observedErrors: string[] = []
    const { tools } = toolGuard({
      failing_tool: {
        execute: async () => {
          calls += 1
          const message = `original failure ${calls}`
          originalErrors.push(message)
          throw new Error(message)
        },
      },
    })

    for (let i = 0; i < 35; i += 1) {
      try {
        await tools.failing_tool.execute({}, {})
      } catch (err) {
        observedErrors.push(err instanceof Error ? err.message : String(err))
      }
    }

    expect(calls).toBe(35)
    expect(observedErrors).toEqual(originalErrors)
    expect(observedErrors.some((message) => message.includes("circuit-open"))).toBe(false)
  })
})
