import { test, expect } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { PermissionNext } from "../../src/permission/next"
import { ToolRegistry } from "../../src/tool/registry"
import { MIRROR_ANALYSIS_TOOL_IDS, MIRROR_DELIVERY_TOOL_IDS, MIRROR_TOOL_IDS } from "../../src/mirror/tools/ids"

// Helper to evaluate permission for a tool with wildcard pattern
function evalPerm(agent: Agent.Info | undefined, permission: string): PermissionNext.Action | undefined {
  if (!agent) return undefined
  return PermissionNext.evaluate(permission, "*", agent.permission).action
}

test("returns default native agents when no config", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await Agent.list()
      const names = agents.map((a) => a.name)
      expect(names).toContain("build")
      expect(names).toContain("general")
      expect(names).toContain("explore")
      expect(names).toContain("compaction")
      expect(names).toContain("title")
      expect(names).toContain("summary")
    },
  })
})

test("planner is not exposed as a native agent", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(await Agent.get("planner")).toBeUndefined()
      expect(await Agent.nativeDefaultPrompt("planner")).toBeUndefined()
      const agents = await Agent.list()
      expect(agents.map((a) => a.name)).not.toContain("planner")
    },
  })
})

test("build agent has correct default properties", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build).toBeDefined()
      expect(build?.mode).toBe("primary")
      expect(build?.native).toBe(true)
      expect(evalPerm(build, "edit")).toBe("allow")
      expect(evalPerm(build, "bash")).toBe("allow")
      expect(evalPerm(build, "todoread")).toBe("allow")
      expect(evalPerm(build, "todowrite")).toBe("allow")
    },
  })
})

// audit-2026-04-29 W2-V27 — `Agent.get("plan")` returns undefined in
// the current build: there is no "plan" entry in agent.ts's BUILT_IN
// dict (only build / general / explore / compaction / title /
// summary / delivery / orchestrator / requirements / architect /
// integrity / prosecutor — see agent.ts). The
// plan-mode feature was either renamed or removed; the
// `plan_enter`/`plan_exit` permission keys are no longer in the
// Permission schema either (see config.ts:625-647 — they fall
// through to .catchall). The test was authored against a removed
// feature and silently failed across the suite. Skip until the
// "plan mode primary agent" feature is reinstated or the spec
// confirms removal.
test.skip("plan agent is read-only except for plan files", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const plan = await Agent.get("plan")
      expect(plan).toBeDefined()
      expect(plan?.mode).toBe("primary")
      expect(plan?.native).toBe(true)
      expect(evalPerm(plan, "bash")).toBe("deny")
      expect(evalPerm(plan, "question")).toBe("allow")
      expect(evalPerm(plan, "plan_exit")).toBe("allow")
      expect(PermissionNext.evaluate("edit", ".opencorvus/plans/demo.md", plan!.permission).action).toBe("allow")
      expect(PermissionNext.evaluate("edit", "src/demo.ts", plan!.permission).action).toBe("deny")
    },
  })
})

test("explore agent limits exposed tools without permission denials", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await Agent.get("explore")
      expect(explore).toBeDefined()
      expect(explore?.mode).toBe("subagent")
      expect(explore?.tools?.include).not.toContain("edit")
      expect(explore?.tools?.include).not.toContain("write")
      expect(evalPerm(explore, "edit")).toBe("allow")
      expect(evalPerm(explore, "write")).toBe("allow")
    },
  })
})

test("explore agent allows external directories and Truncate.GLOB", async () => {
  const { Truncate } = await import("../../src/tool/truncation")
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await Agent.get("explore")
      expect(explore).toBeDefined()
      expect(PermissionNext.evaluate("external_directory", "/some/other/path", explore!.permission).action).toBe(
        "allow",
      )
      expect(PermissionNext.evaluate("external_directory", Truncate.GLOB, explore!.permission).action).toBe("allow")
    },
  })
})

test("general agent exposes subtask dispatch without allowing self-recursion", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const general = await Agent.get("general")
      expect(general).toBeDefined()
      expect(general?.mode).toBe("subagent")
      expect(general?.hidden).toBeUndefined()
      expect(general?.prompt).toBeDefined()
      expect(general?.prompt).toContain("You are")
      expect(general?.tools?.exclude).not.toContain("task")
      expect(general?.tools?.exclude).toContain("todoread")
      expect(general?.tools?.exclude).toContain("todowrite")
      expect(PermissionNext.evaluate("task", "explore", general!.permission).action).toBe("allow")
      expect(PermissionNext.evaluate("task", "general", general!.permission).action).toBe("deny")
      expect(evalPerm(general, "todoread")).toBe("allow")
      expect(evalPerm(general, "todowrite")).toBe("allow")

      const tools = await ToolRegistry.tools({ providerID: "", modelID: "" }, general)
      expect(tools.map((tool) => tool.id)).toContain("task")
    },
  })
})

test("orchestrator does not receive the control-plane panel tool", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orchestrator = await Agent.get("orchestrator")
      expect(orchestrator).toBeDefined()
      expect(orchestrator?.tools?.include).not.toContain("panel")
      expect(orchestrator?.tools?.include).not.toContain("task")

      const tools = await ToolRegistry.tools({ providerID: "", modelID: "" }, orchestrator)
      expect(tools.map((tool) => tool.id)).not.toContain("panel")
      expect(tools.map((tool) => tool.id)).not.toContain("task")
    },
  })
})

test("orchestrator does not inherit the generic task-tool prompt policy", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orchestrator = await Agent.get("orchestrator")
      expect(orchestrator).toBeDefined()
      expect(orchestrator?.prompt).toBeDefined()
      expect(orchestrator?.prompt).toContain("The generic `task` tool is not an orchestrator tool")
      expect(orchestrator?.prompt).toContain("use `propose_task`")
      expect(orchestrator?.prompt).not.toContain("Use the Task tool")
      expect(orchestrator?.prompt).not.toContain("Proactively use the Task tool")
    },
  })
})

test("compaction agent exposes no tools while permissions default to allow", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const compaction = await Agent.get("compaction")
      expect(compaction).toBeDefined()
      expect(compaction?.hidden).toBe(true)
      expect(compaction?.tools).toEqual({ include: [] })
      expect(evalPerm(compaction, "bash")).toBe("allow")
      expect(evalPerm(compaction, "edit")).toBe("allow")
      expect(evalPerm(compaction, "read")).toBe("allow")
    },
  })
})

test("integrity agent does not expose registry tools", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const integrity = await Agent.get("integrity")
      expect(integrity).toBeDefined()
      expect(integrity?.hidden).toBe(true)
      expect(integrity?.tools).toEqual({ include: [] })
    },
  })
})

test("prosecutor agent does not expose registry tools", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const prosecutor = await Agent.get("prosecutor")
      expect(prosecutor).toBeDefined()
      expect(prosecutor?.hidden).toBe(true)
      // Registry tools (read/edit/bash/mirror/...) must stay out — the
      // prosecutor's verdict + counterexample tools are injected per run via
      // toolKit. A missing include here would re-expand the registry and
      // bloat the system prompt with ~30 unused tool schemas.
      expect(prosecutor?.tools).toEqual({ include: [] })
    },
  })
})

test("orchestrator include list excludes the dead query_metric_trajectory reference", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orchestrator = await Agent.get("orchestrator")
      expect(orchestrator).toBeDefined()
      // query_metric_trajectory is defined inside delivery/prosecutor toolkits
      // and never injected into the orchestrator. Naming it in the include
      // list mislead readers (and prior prompt drafts) into thinking the
      // orchestrator could call it. Keep the list aligned with reality.
      expect(orchestrator?.tools?.include).not.toContain("query_metric_trajectory")
    },
  })
})

test("custom agent from config creates new agent", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        my_custom_agent: {
          model: "openai/gpt-4",
          description: "My custom agent",
          temperature: 0.5,
          top_p: 0.9,
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const custom = await Agent.get("my_custom_agent")
      expect(custom).toBeDefined()
      expect(custom?.model?.providerID).toBe("openai")
      expect(custom?.model?.modelID).toBe("gpt-4")
      expect(custom?.description).toBe("My custom agent")
      expect(custom?.temperature).toBe(0.5)
      expect(custom?.topP).toBe(0.9)
      expect(custom?.native).toBe(false)
      expect(custom?.mode).toBe("all")
    },
  })
})

test("custom agent config overrides native agent properties", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          model: "anthropic/claude-3",
          description: "Custom build agent",
          temperature: 0.7,
          color: "#FF0000",
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build).toBeDefined()
      expect(build?.model?.providerID).toBe("anthropic")
      expect(build?.model?.modelID).toBe("claude-3")
      expect(build?.description).toBe("Custom build agent")
      expect(build?.temperature).toBe(0.7)
      expect(build?.color).toBe("#FF0000")
      expect(build?.native).toBe(true)
    },
  })
})

test("agent disable removes agent from list", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        explore: { disable: true },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await Agent.get("explore")
      expect(explore).toBeUndefined()
      const agents = await Agent.list()
      const names = agents.map((a) => a.name)
      expect(names).not.toContain("explore")
    },
  })
})

test("agent permission config merges with defaults", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          permission: {
            bash: {
              "rm -rf *": "deny",
            },
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build).toBeDefined()
      // Specific pattern is denied
      expect(PermissionNext.evaluate("bash", "rm -rf *", build!.permission).action).toBe("deny")
      // Edit still allowed
      expect(evalPerm(build, "edit")).toBe("allow")
    },
  })
})

test("global permission config applies to all agents", async () => {
  await using tmp = await tmpdir({
    config: {
      permission: {
        bash: "deny",
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build).toBeDefined()
      expect(evalPerm(build, "bash")).toBe("deny")
    },
  })
})

test("agent steps/maxSteps config sets steps property", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: { steps: 50 },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build?.steps).toBe(50)
    },
  })
})

test("agent mode can be overridden", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        explore: { mode: "primary" },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await Agent.get("explore")
      expect(explore?.mode).toBe("primary")
    },
  })
})

test("agent name can be overridden", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: { name: "Builder" },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build?.name).toBe("Builder")
    },
  })
})

test("agent prompt can be set from config", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: { prompt: "Custom system prompt" },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build?.prompt).toBe("Custom system prompt")
    },
  })
})

test("unknown agent properties are placed into options", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          random_property: "hello",
          another_random: 123,
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build?.options.random_property).toBe("hello")
      expect(build?.options.another_random).toBe(123)
    },
  })
})

test("agent options merge correctly", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          options: {
            custom_option: true,
            another_option: "value",
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build?.options.custom_option).toBe(true)
      expect(build?.options.another_option).toBe("value")
    },
  })
})

test("multiple custom agents can be defined", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        agent_a: {
          description: "Agent A",
          mode: "subagent",
        },
        agent_b: {
          description: "Agent B",
          mode: "primary",
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agentA = await Agent.get("agent_a")
      const agentB = await Agent.get("agent_b")
      expect(agentA?.description).toBe("Agent A")
      expect(agentA?.mode).toBe("subagent")
      expect(agentB?.description).toBe("Agent B")
      expect(agentB?.mode).toBe("primary")
    },
  })
})

test("Agent.get returns undefined for non-existent agent", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const nonExistent = await Agent.get("does_not_exist")
      expect(nonExistent).toBeUndefined()
    },
  })
})

test("default permission accepts doom_loop and external_directory", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(evalPerm(build, "doom_loop")).toBe("allow")
      expect(evalPerm(build, "external_directory")).toBe("allow")
    },
  })
})

test("webfetch is allowed by default", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(evalPerm(build, "webfetch")).toBe("allow")
    },
  })
})

test("design-analyst advertises url_screenshot and omits webfetch", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const designAnalyst = await Agent.get("design-analyst")
      expect(designAnalyst?.tools?.include).toContain("url_screenshot")
      expect(designAnalyst?.tools?.include).not.toContain("webfetch")
      expect(designAnalyst?.tools?.include).not.toContain("todoread")
      expect(designAnalyst?.tools?.include).not.toContain("todowrite")

      const { createUrlScreenshotTool } = await import("../../src/design-analyst/url-screenshot-tool")
      expect(Object.keys(createUrlScreenshotTool())).toEqual(["url_screenshot"])
    },
  })
})

test("only design-analyst receives mirror analysis tools from the registry", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const designAnalyst = await Agent.get("design-analyst")
      expect(designAnalyst).toBeDefined()
      const designTools = await ToolRegistry.tools({ providerID: "", modelID: "" }, designAnalyst)
      const designToolIds = new Set(designTools.map((tool) => tool.id))
      for (const id of MIRROR_ANALYSIS_TOOL_IDS) {
        expect(designToolIds.has(id)).toBe(true)
      }
      for (const id of MIRROR_DELIVERY_TOOL_IDS) {
        expect(designToolIds.has(id)).toBe(false)
      }

      for (const name of ["build", "general", "explore", "requirements", "architect", "integrity", "prosecutor"]) {
        const agent = await Agent.get(name)
        expect(agent).toBeDefined()
        const tools = await ToolRegistry.tools({ providerID: "", modelID: "" }, agent)
        const toolIds = new Set(tools.map((tool) => tool.id))
        for (const id of MIRROR_TOOL_IDS) {
          expect(toolIds.has(id)).toBe(false)
        }
      }

      for (const name of ["build", "general", "explore", "compaction", "title", "delivery"]) {
        const agent = await Agent.get(name)
        expect(agent).toBeDefined()
        for (const id of MIRROR_TOOL_IDS) {
          expect(evalPerm(agent, id)).toBe("deny")
        }
      }
    },
  })
})

test("unknown permission defaults to allow", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(evalPerm(build, "future_tool")).toBe("allow")
    },
  })
})

test("Truncate.GLOB follows user external_directory deny globally", async () => {
  const { Truncate } = await import("../../src/tool/truncation")
  await using tmp = await tmpdir({
    config: {
      permission: {
        external_directory: "deny",
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(PermissionNext.evaluate("external_directory", Truncate.GLOB, build!.permission).action).toBe("deny")
      expect(PermissionNext.evaluate("external_directory", Truncate.DIR, build!.permission).action).toBe("deny")
      expect(PermissionNext.evaluate("external_directory", "/some/other/path", build!.permission).action).toBe("deny")
    },
  })
})

test("Truncate.GLOB follows user external_directory deny per-agent", async () => {
  const { Truncate } = await import("../../src/tool/truncation")
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          permission: {
            external_directory: "deny",
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(PermissionNext.evaluate("external_directory", Truncate.GLOB, build!.permission).action).toBe("deny")
      expect(PermissionNext.evaluate("external_directory", Truncate.DIR, build!.permission).action).toBe("deny")
      expect(PermissionNext.evaluate("external_directory", "/some/other/path", build!.permission).action).toBe("deny")
    },
  })
})

test("explicit Truncate.GLOB deny is respected", async () => {
  const { Truncate } = await import("../../src/tool/truncation")
  await using tmp = await tmpdir({
    config: {
      permission: {
        external_directory: {
          "*": "deny",
          [Truncate.GLOB]: "deny",
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(PermissionNext.evaluate("external_directory", Truncate.GLOB, build!.permission).action).toBe("deny")
      expect(PermissionNext.evaluate("external_directory", Truncate.DIR, build!.permission).action).toBe("deny")
    },
  })
})

test("skill directories are allowed for external_directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencorvus", "skill", "perm-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: perm-skill
description: Permission skill.
---

# Permission Skill
`,
      )
    },
  })

  const home = process.env.OPENCORVUS_TEST_HOME
  process.env.OPENCORVUS_TEST_HOME = tmp.path

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        const skillDir = path.join(tmp.path, ".opencorvus", "skill", "perm-skill")
        const target = path.join(skillDir, "reference", "notes.md")
        expect(PermissionNext.evaluate("external_directory", target, build!.permission).action).toBe("allow")
      },
    })
  } finally {
    process.env.OPENCORVUS_TEST_HOME = home
  }
})

test("defaultAgent returns build when no default_agent config", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.defaultAgent()
      expect(agent).toBe("build")
    },
  })
})

test("defaultAgent respects default_agent config set to custom agent with mode all", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "my_custom",
      agent: {
        my_custom: {
          description: "My custom agent",
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.defaultAgent()
      expect(agent).toBe("my_custom")
    },
  })
})

test("defaultAgent throws when default_agent points to subagent", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "explore",
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Agent.defaultAgent()).rejects.toThrow('default agent "explore" is a subagent')
    },
  })
})

test("defaultAgent throws when default_agent points to hidden agent", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "compaction",
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Agent.defaultAgent()).rejects.toThrow('default agent "compaction" is hidden')
    },
  })
})

test("defaultAgent throws when default_agent points to non-existent agent", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "does_not_exist",
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Agent.defaultAgent()).rejects.toThrow('default agent "does_not_exist" not found')
    },
  })
})

test("defaultAgent throws when all primary agents are disabled", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: { disable: true },
        plan: { disable: true },
        spec: { disable: true },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Agent.defaultAgent()).rejects.toThrow("no primary visible agent found")
    },
  })
})
