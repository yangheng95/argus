import { describe, expect, test } from "bun:test"
import { createAgentContextTools } from "../../src/agent/context-tools"
import { filterAgentTools } from "../../src/agent/filter-tools"
import { Instance } from "../../src/project/instance"
import { Memory } from "../../src/memory"
import { Agent } from "../../src/agent/agent"
import { ToolRegistry } from "../../src/tool/registry"
import { tmpdir } from "../fixture/fixture"

const INSTANCE_STARTUP_TIMEOUT_MS = 60_000

describe("agent context tools", () => {
  test("requires an active project identity instead of using a default project", () => {
    expect(() => createAgentContextTools()).toThrow()
  })

  test(
    "context extras do not shadow registry network tools",
    async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const tools = createAgentContextTools()
          expect("websearch" in tools).toBe(false)
          expect("webfetch" in tools).toBe(false)
          expect("web_search" in tools).toBe(false)
        },
      })
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )

  // The shared set offers websearch, but each agent only receives it if its
  // tools.include opts in (filterAgentTools is the include gate). Decision
  // matrix locked 2026-05-19 after intent-analysis abused websearch ×8 at the
  // classification stage:
  //   requirements / architect  → keep  (durable greenfield tech decisions)
  //   frontend-design            → drop  (owns webpage evidence extraction; redundant)
  //   intent-analysis           → drop  (first cheap classifier; must not research)
  //   deep-research             → drop  (starts from source URLs with webfetch; search costs are avoided)
  //   frontend-research         → drop  (host prepares rendered URL evidence before the session; no ad-hoc search)
  for (const agentName of ["requirements", "architect"] as const) {
    test(
      `${agentName} resolves websearch through the registry include whitelist`,
      async () => {
        await Instance.provide({
          directory: process.cwd(),
          fn: async () => {
            const agent = await Agent.get(agentName)
            const tools = await ToolRegistry.tools({ providerID: "openai", modelID: "gpt-5" }, agent)
            expect(tools.map((item) => item.id)).toContain("websearch")
            expect(tools.map((item) => item.id)).not.toContain("web_search")
          },
        })
      },
      { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
    )
  }

  for (const agentName of ["frontend-design", "intent-analysis", "deep-research", "frontend-research"] as const) {
    test(
      `${agentName} does NOT resolve registry websearch (deep research is not its job)`,
      async () => {
        await Instance.provide({
          directory: process.cwd(),
          fn: async () => {
            const agent = await Agent.get(agentName)
            const tools = await ToolRegistry.tools({ providerID: "openai", modelID: "gpt-5" }, agent)
            expect(tools.map((item) => item.id)).not.toContain("websearch")
          },
        })
      },
      { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
    )
  }

  for (const agentName of ["fact-check", "deep-research"] as const) {
    test(
      `${agentName} resolves webfetch through the registry include whitelist`,
      async () => {
        await Instance.provide({
          directory: process.cwd(),
          fn: async () => {
            const agent = await Agent.get(agentName)
            const tools = await ToolRegistry.tools({ providerID: "openai", modelID: "gpt-5" }, agent)
            expect(tools.map((item) => item.id)).toContain("webfetch")
          },
        })
      },
      { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
    )
  }

  test(
    "frontend-research resolves no retrieval tools because host prepares rendered webpage evidence",
    async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const tools = await filterAgentTools(createAgentContextTools(), "frontend-research")
          expect(Object.keys(tools).sort()).toEqual([])
          expect("websearch" in tools).toBe(false)
          expect("webfetch" in tools).toBe(false)
          expect("read_file" in tools).toBe(false)
          expect("search_code" in tools).toBe(false)
        },
      })
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )

  test(
    "memory tool backend errors are visible to the agent",
    async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const originalSearch = Memory.search
          const originalGetFileInProject = Memory.getFileInProject
          try {
            ;(Memory as typeof Memory & { search: typeof Memory.search }).search = () => {
              throw new Error("memory index unavailable")
            }
            ;(Memory as typeof Memory & { getFileInProject: typeof Memory.getFileInProject }).getFileInProject = () => {
              throw new Error("memory row read failed")
            }

            const tools = createAgentContextTools()
            await expect(
              (tools.memory_search as any).execute({ query: "architecture", scope: "all", max_results: 8 }),
            ).rejects.toThrow("memory index unavailable")
            await expect((tools.memory_get as any).execute({ file_id: "mem_missing" })).rejects.toThrow(
              "memory row read failed",
            )
          } finally {
            ;(Memory as typeof Memory & { search: typeof Memory.search }).search = originalSearch
            ;(Memory as typeof Memory & { getFileInProject: typeof Memory.getFileInProject }).getFileInProject =
              originalGetFileInProject
          }
        },
      })
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )

  test(
    "memory_get treats a missing file as a visible error",
    async () => {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const tools = createAgentContextTools()
          await expect((tools.memory_get as any).execute({ file_id: "mem_missing" })).rejects.toThrow(
            "Memory file mem_missing not found",
          )
        },
      })
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )

  test(
    "memory_get cannot read a memory file from another project",
    async () => {
      await using projectA = await tmpdir({ git: true })
      await using projectB = await tmpdir({ git: true })
      let projectBFileID = ""

      await Instance.provide({
        directory: projectB.path,
        fn: async () => {
          const captured = Memory.captureEpisode({
            title: "Project B private note",
            content: "## Private\n- Project B deployment secret should never appear in Project A context.",
            source: "manual",
            projectId: Instance.project.id,
            scope: "global",
          })
          projectBFileID = captured.episode.id
        },
      })

      await Instance.provide({
        directory: projectA.path,
        fn: async () => {
          const tools = createAgentContextTools()
          await expect((tools.memory_get as any).execute({ file_id: projectBFileID })).rejects.toThrow(
            `Memory file ${projectBFileID} not found`,
          )
        },
      })
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )
})
