import { describe, expect, test } from "bun:test"
import { createAgentContextTools } from "../../src/agent/context-tools"
import { filterAgentTools } from "../../src/agent/filter-tools"
import { Instance } from "../../src/project/instance"

describe("agent context tools", () => {
  test("websearch is offered by default — no env switch", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const tools = createAgentContextTools()
        expect("websearch" in tools).toBe(true)
        // Regression: the underscore name and the dead OPENCORVUS_ENABLE_WEB_SEARCH
        // gate are retired (rule 7/8/10 — single source, no dead switch).
        expect("web_search" in tools).toBe(false)
      },
    })
  })

  // BUG② regression: even with the shared set offering websearch, each stage
  // agent only receives it because its tools.include opts in. filterAgentTools
  // is the include gate that previously (silently) stripped it.
  for (const agentName of ["requirements", "architect", "design-analyst", "intent-analysis"] as const) {
    test(`${agentName} resolves websearch through its include whitelist`, async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const tools = await filterAgentTools(createAgentContextTools(), agentName)
          expect("websearch" in tools).toBe(true)
          expect("web_search" in tools).toBe(false)
        },
      })
    })
  }
})
