import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createAgentContextTools } from "../../src/agent/context-tools"
import { Instance } from "../../src/project/instance"

describe("agent context tools", () => {
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
        const tools = createAgentContextTools()
        expect("web_search" in tools).toBe(false)
      },
    })
  })

  test("web_search enabled when OPENCORVUS_ENABLE_WEB_SEARCH=1", async () => {
    process.env.OPENCORVUS_ENABLE_WEB_SEARCH = "1"
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const tools = createAgentContextTools()
        expect("web_search" in tools).toBe(true)
      },
    })
  })
})
