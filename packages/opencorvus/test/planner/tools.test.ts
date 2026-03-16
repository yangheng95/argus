import { describe, expect, test } from "bun:test"
import { createPlannerTools } from "../../src/planner/tools"
import { Instance } from "../../src/project/instance"

describe("planner tools", () => {
  test("omits web_search when explicitly disabled", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const tools = createPlannerTools(undefined, { recall: false, web: false })
        expect("web_search" in tools).toBe(false)
      },
    })
  })

  test("keeps web_search enabled by default", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const tools = createPlannerTools(undefined, { recall: false })
        expect("web_search" in tools).toBe(true)
      },
    })
  })
})
