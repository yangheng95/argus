import { afterEach, test, expect } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config/config"
import { PermissionNext } from "../../src/permission/next"
import { SystemPrompt } from "../../src/session/system"
import { ToolRegistry } from "../../src/tool/registry"
import { MIRROR_ANALYSIS_TOOL_IDS, MIRROR_DELIVERY_TOOL_IDS, MIRROR_TOOL_IDS } from "../../src/mirror/tools/ids"
import BUILD_CORE from "../../src/prompt/core/build-core.txt"
import PROMPT_CODING from "../../src/agent/prompt/coding.txt"

afterEach(async () => {
  Config.global.reset()
  await Instance.disposeAll()
})

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
      expect(names).toContain("coding")
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
      expect(build?.hidden).toBe(true)
      expect(build?.prompt).toBe(BUILD_CORE)
      expect(evalPerm(build, "edit")).toBe("allow")
      expect(evalPerm(build, "bash")).toBe("allow")
      expect(evalPerm(build, "skill")).toBe("allow")
      expect(evalPerm(build, "todoread")).toBe("allow")
      expect(evalPerm(build, "todowrite")).toBe("allow")
      expect(build?.tools?.exclude).not.toContain("skill")
    },
  })
})

test("coding agent owns direct assistant prompt", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const coding = await Agent.get("coding")
      expect(coding).toBeDefined()
      expect(coding?.mode).toBe("primary")
      expect(coding?.native).toBe(true)
      expect(coding?.hidden).toBeUndefined()
      expect(coding?.prompt).toBe(PROMPT_CODING)
      expect(await Agent.nativeDefaultPrompt("coding")).toBe(PROMPT_CODING)
    },
  })
})

// audit-2026-04-29 W2-V27 — `Agent.get("plan")` returns undefined in
// the current build: there is no "plan" entry in agent.ts's BUILT_IN
// dict (only build / general / explore / compaction / title /
// summary / orchestrator / requirements / architect /
// integrity — see agent.ts). The
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
      // BUG① regression: explore is a research subagent — webfetch alone
      // (fetch a known URL, bot-blocked on search/scholar) is not enough; it
      // must also resolve `websearch`.
      expect(explore?.tools?.include).toContain("websearch")
      expect(explore?.tools?.include).toContain("webfetch")
      const exploreTools = await ToolRegistry.tools({ providerID: "", modelID: "" }, explore)
      expect(exploreTools.map((t) => t.id)).toContain("websearch")
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
      expect(orchestrator?.tools?.include).toContain("cancel_subagent")
      expect(orchestrator?.tools?.include).toContain("propose_task")
      expect(orchestrator?.tools?.include).not.toContain("panel")
      expect(orchestrator?.tools?.include).not.toContain("task")
      expect(orchestrator?.tools?.include).not.toContain("skill")
      expect(orchestrator?.tools?.include).not.toContain("task_report")
      expect(orchestrator?.tools?.include).not.toContain("memory")

      const tools = await ToolRegistry.tools({ providerID: "", modelID: "" }, orchestrator)
      expect(tools.map((tool) => tool.id)).not.toContain("panel")
      expect(tools.map((tool) => tool.id)).not.toContain("task")
      expect(tools.map((tool) => tool.id)).not.toContain("skill")
      expect(tools.map((tool) => tool.id)).not.toContain("task_report")
      expect(tools.map((tool) => tool.id)).not.toContain("memory")
    },
  })
})

test("orchestrator does not inherit generic skill policy", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".opencorvus", "skill", "tool-skill", "SKILL.md"),
        `---
name: tool-skill
description: Skill for system-prompt visibility tests.
---

# Tool Skill
`,
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orchestrator = await Agent.get("orchestrator")
      const requirements = await Agent.get("requirements")
      expect(orchestrator).toBeDefined()
      expect(requirements).toBeDefined()

      expect(await SystemPrompt.skills(orchestrator!)).toBeUndefined()
      expect(await SystemPrompt.skills(requirements!)).toContain("tool-skill")
    },
  })
})

test("skill policy follows the current resolved tool surface", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".opencorvus", "skill", "tool-skill", "SKILL.md"),
        `---
name: tool-skill
description: Skill for resolved-tool visibility tests.
---

# Tool Skill
`,
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const requirements = await Agent.get("requirements")
      expect(requirements).toBeDefined()

      expect(await SystemPrompt.skills(requirements!, { availableToolNames: ["read_file"] })).toBeUndefined()
      expect(await SystemPrompt.skills(requirements!, { availableToolNames: ["read_file", "skill"] })).toContain("tool-skill")
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
      expect(orchestrator?.prompt).toContain("only agent-side owner of engine task lifecycle decisions")
      expect(orchestrator?.prompt).toContain("use `propose_task`")
      expect(orchestrator?.prompt).not.toContain("Use the Task tool")
      expect(orchestrator?.prompt).not.toContain("Proactively use the Task tool")
    },
  })
})

test("native stage agent registry tool surfaces match role boundaries", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const baseReadonly = [
        "read_file",
        "find_files",
        "search_code",
        "list_directory",
        "memory_search",
        "memory_get",
        "skill",
        "todoread",
        "todowrite",
      ]
      const forbidden = [
        "bash",
        "edit",
        "write",
        "apply_patch",
        "task",
        "panel",
        "webfetch",
        "deliver",
        "build",
        "propose_task",
      ]

      // requirements / architect make durable technical decisions; on
      // greenfield they must verify current framework/library choices, so
      // they keep `websearch` (BUG① sibling — explore is the other research
      // surface). webfetch stays out — they search by query, they do not
      // fetch operator-supplied URLs.
      const webResearchStageAgents = ["requirements", "architect"] as const
      const allowedWebResearch = [...baseReadonly, "websearch"]
      for (const name of webResearchStageAgents) {
        const agent = await Agent.get(name)
        expect(agent).toBeDefined()
        expect(agent?.tools?.include?.sort()).toEqual([...allowedWebResearch].sort())
        expect(agent?.tools?.include).toContain("websearch")
        for (const tool of forbidden) {
          expect(agent?.tools?.include).not.toContain(tool)
        }
      }

      // intent-analysis is the first cheap classification step. It must NOT
      // research — websearch ×8 at the intent stage was the observed
      // anti-pattern (2026-05-19). websearch is forbidden here.
      const intent = await Agent.get("intent-analysis")
      expect(intent).toBeDefined()
      expect(intent?.tools?.include?.sort()).toEqual([...baseReadonly].sort())
      for (const tool of [...forbidden, "websearch"]) {
        expect(intent?.tools?.include).not.toContain(tool)
      }

      // design-analyst owns mirror extraction (URL/Figma/pixels); generic
      // websearch is redundant with that chain and risks score loops.
      const design = await Agent.get("design-analyst")
      expect(design?.tools?.include).toContain("url_screenshot")
      expect(design?.tools?.include).toContain("skill")
      expect(design?.tools?.include).not.toContain("websearch")
      expect(design?.tools?.include).not.toContain("webpage_render")
      expect(design?.tools?.include).not.toContain("task")

      const integrity = await Agent.get("integrity")
      expect(integrity).toBeDefined()
      expect(integrity?.tools?.include).toEqual([])
      expect(await Agent.get("delivery")).toBeUndefined()
    },
  })
})

test("orchestrator registry exposes lifecycle tools it teaches in prompt", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orchestrator = await Agent.get("orchestrator")
      expect(orchestrator).toBeDefined()
      const include = orchestrator?.tools?.include ?? []
      for (const tool of [
        "propose_task",
        "fail_task",
        "cancel_task",
        "retry_task",
        "restart_from_stage",
        "inject_operator_message",
        "recover_stale_build",
      ]) {
        expect(include).toContain(tool)
      }
      expect(include).toContain("integrity")
      expect(include).not.toContain("deliver")
      expect(include).not.toContain("publish_delivery")
      expect(orchestrator?.prompt).toContain("propose_task")
    },
  })
})

test("control agent is hidden and isolated from general subagent config", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        general: { disable: true },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(await Agent.get("general")).toBeUndefined()

      const control = await Agent.get("control")
      expect(control).toBeDefined()
      expect(control?.hidden).toBe(true)
      expect(control?.mode).toBe("primary")
      expect(control?.prompt).toContain("control-plane agent")

      const tools = await ToolRegistry.tools({ providerID: "", modelID: "" }, control)
      expect(tools.map((tool) => tool.id)).toEqual(["panel"])
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

test("orchestrator include list excludes the dead query_metric_trajectory reference", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orchestrator = await Agent.get("orchestrator")
      expect(orchestrator).toBeDefined()
      // query_metric_trajectory was defined inside delivery toolkits and never
      // injected into the orchestrator. Naming it in the include list misled
      // readers (and prior prompt drafts) into thinking the orchestrator
      // could call it. Keep the list aligned with reality.
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

test("agent name override is rejected because the config key is the identity", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: { name: "Builder" },
      },
    },
  })
  await expect(Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Agent.get("build")
    },
  })).rejects.toThrow("config.agent.build.name cannot rename the agent identity")
})

test("coding prompt can be overridden from config", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        coding: { prompt: "Custom system prompt" },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const coding = await Agent.get("coding")
      expect(coding?.prompt).toBe("Custom system prompt")
    },
  })
})

test("workflow build prompt is code-owned and only accepts prompt_append", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: { prompt_append: "Additional build instruction" },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build?.prompt).toBe(BUILD_CORE)
      expect(build?.options.prompt_append).toBeUndefined()
    },
  })
})

test("workflow build prompt rejects prompt override instead of ignoring it", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: { prompt: "Invalid replacement" },
      },
    },
  })
  await expect(Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Agent.get("build")
    },
  })).rejects.toThrow("config.agent.build.prompt is invalid for append-mode agents")
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

      for (const name of ["coding", "build", "general", "explore", "requirements", "architect", "integrity"]) {
        const agent = await Agent.get(name)
        expect(agent).toBeDefined()
        const tools = await ToolRegistry.tools({ providerID: "", modelID: "" }, agent)
        const toolIds = new Set(tools.map((tool) => tool.id))
        for (const id of MIRROR_TOOL_IDS) {
          expect(toolIds.has(id)).toBe(false)
        }
      }

      for (const name of ["coding", "build", "general", "explore", "compaction", "title"]) {
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

test("defaultAgent returns coding when no default_agent config", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.defaultAgent()
      expect(agent).toBe("coding")
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
        coding: { disable: true },
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
