import { describe, expect, test } from "bun:test"
import { createAgentContextTools } from "../../src/agent/context-tools"
import { filterAgentTools } from "../../src/agent/filter-tools"
import { Instance } from "../../src/project/instance"

const INSTANCE_STARTUP_TIMEOUT_MS = 60_000

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
  }, { timeout: INSTANCE_STARTUP_TIMEOUT_MS })

  // The shared set offers websearch, but each agent only receives it if its
  // tools.include opts in (filterAgentTools is the include gate). Decision
  // matrix locked 2026-05-19 after intent-analysis abused websearch ×8 at the
  // classification stage:
  //   requirements / architect  → keep  (durable greenfield tech decisions)
  //   frontend-design            → drop  (owns webpage evidence extraction; redundant)
  //   intent-analysis           → drop  (first cheap classifier; must not research)
  //   research                  → drop  (starts from source URLs with webfetch; search costs are avoided)
  //   frontend-research         → drop  (starts from source URLs and prepared evidence with webfetch; search costs are avoided)
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
    }, { timeout: INSTANCE_STARTUP_TIMEOUT_MS })
  }

  for (const agentName of ["frontend-design", "intent-analysis", "research", "frontend-research"] as const) {
    test(`${agentName} does NOT resolve websearch (research is not its job)`, async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const tools = await filterAgentTools(createAgentContextTools(), agentName)
          expect("websearch" in tools).toBe(false)
        },
      })
    }, { timeout: INSTANCE_STARTUP_TIMEOUT_MS })
  }

  for (const agentName of ["fact-check", "research", "frontend-research"] as const) {
    test(`${agentName} resolves webfetch through the read-only retrieval surface`, async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const tools = await filterAgentTools(createAgentContextTools(), agentName)
          expect("webfetch" in tools).toBe(true)
        },
      })
    }, { timeout: INSTANCE_STARTUP_TIMEOUT_MS })
  }

  test("frontend-research resolves direct read-only webpage investigation tools", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const tools = await filterAgentTools(createAgentContextTools(), "frontend-research")
        expect(Object.keys(tools).sort()).toEqual([
          "find_files",
          "list_directory",
          "memory_get",
          "memory_search",
          "read_file",
          "webfetch",
        ])
        expect("websearch" in tools).toBe(false)
        expect("search_code" in tools).toBe(false)
      },
    })
  }, { timeout: INSTANCE_STARTUP_TIMEOUT_MS })
})
