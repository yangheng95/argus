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

  // The shared set offers websearch, but each agent only receives it if its
  // tools.include opts in (filterAgentTools is the include gate). Decision
  // matrix locked 2026-05-19 after intent-analysis abused websearch ×8 at the
  // classification stage:
  //   requirements / architect  → keep  (durable greenfield tech decisions)
  //   frontend-design            → drop  (owns mirror extraction; redundant)
  //   intent-analysis           → drop  (first cheap classifier; must not research)
  for (const agentName of ["requirements", "architect"] as const) {
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

  for (const agentName of ["frontend-design", "intent-analysis"] as const) {
    test(`${agentName} does NOT resolve websearch (research is not its job)`, async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const tools = await filterAgentTools(createAgentContextTools(), agentName)
          expect("websearch" in tools).toBe(false)
        },
      })
    })
  }
})
