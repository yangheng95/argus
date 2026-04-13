import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createPlannerTools } from "../../src/planner/tools"
import { Instance } from "../../src/project/instance"

describe("planner tools", () => {
  const original = process.env.OPENCORVUS_ENABLE_WEB_SEARCH
  beforeEach(() => {
    delete process.env.OPENCORVUS_ENABLE_WEB_SEARCH
  })
  afterEach(() => {
    if (original === undefined) delete process.env.OPENCORVUS_ENABLE_WEB_SEARCH
    else process.env.OPENCORVUS_ENABLE_WEB_SEARCH = original
  })

  test("web_search disabled by default (no env flag)", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const tools = createPlannerTools()
        expect("web_search" in tools).toBe(false)
      },
    })
  })

  test("web_search enabled when OPENCORVUS_ENABLE_WEB_SEARCH=1", async () => {
    process.env.OPENCORVUS_ENABLE_WEB_SEARCH = "1"
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const tools = createPlannerTools()
        expect("web_search" in tools).toBe(true)
      },
    })
  })
})
