import { afterEach, test, expect } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { AgentToolPool } from "../../src/agent/tool-pool-contract"
import { AgentRoleContract } from "../../src/agent/role-contract"
import { Config } from "../../src/config/config"
import { PermissionNext } from "../../src/permission/next"
import { SystemPrompt } from "../../src/session/system"
import { ToolRegistry } from "../../src/tool/registry"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import {
  WEBPAGE_EVIDENCE_ACCEPTANCE_TOOL_IDS,
  WEBPAGE_EVIDENCE_ANALYSIS_TOOL_IDS,
} from "../../src/frontend-design/tools/ids"
import { FRONTEND_DESIGN_STATIC_TOOL_IDS } from "../../src/frontend-design/static-tools"
import { VISUAL_QA_STATIC_TOOL_IDS } from "../../src/visual-qa/static-tools"
import { INTEGRITY_DECLARED_TOOL_IDS, INTEGRITY_PREVIEW_TOOL_IDS } from "../../src/integrity/static-tools"
import BUILD_CORE from "../../src/prompt/core/build-core.txt"
import VISUAL_QA_CORE from "../../src/prompt/core/visual-qa-core.txt"
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

function visibleToolIDs(agent: Agent.Info | undefined): Set<string> {
  return AgentToolPool.visibleToolIDs(agent?.tools)
}

test("skill-mountable role contracts expose the canonical skill tool", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      for (const role of AgentRoleContract.ids.filter((id) => AgentRoleContract.skillMountable(id))) {
        const agent = await Agent.get(role)
        expect(agent, `${role} should resolve as a native skill-mountable agent`).toBeDefined()
        expect(agent?.skill_mountable, `${role} must project skillMountable into Agent.Info`).toBe(true)
        expect(visibleToolIDs(agent).has("skill"), `${role} must expose the skill tool if it is mountable`).toBe(true)
      }
    },
  })
})

test("returns default native agents when no config", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await Agent.list()
      const names = agents.map((a) => a.name)
      expect(names).toContain("coding")
      expect(names).toContain("build")
      expect(names).toContain("visual-qa")
      expect(names).toContain("general")
      expect(names).toContain("explore")
      expect(names).toContain("deep-research")
      expect(names).not.toContain("research")
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
      const visible = visibleToolIDs(build)
      expect(visible.has("skill")).toBe(true)
      expect(visible.has("request_orchestrator_decision")).toBe(true)
      expect(visible.has("web_clone_prepare_context")).toBe(false)
      expect(visible.has("web_clone_generate_source_project")).toBe(false)

      const tools = await ToolRegistry.tools({ providerID: "", modelID: "" }, build)
      const ids = new Set(tools.map((tool) => tool.id))
      expect(ids.has("web_clone_prepare_context")).toBe(false)
      expect(ids.has("web_clone_source_audit")).toBe(false)
      expect(ids.has("web_clone_generate_source_project")).toBe(false)
      expect(ids.has("browser_preview_compare_scroll_slices")).toBe(true)
      expect(ids.has("browser_preview_layout_geometry")).toBe(true)
    },
  })
}, 30_000)

test("visual-qa agent is full-function build-grade with visual acceptance tools", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const visualQa = await Agent.get("visual-qa")
      expect(visualQa).toBeDefined()
      expect(visualQa?.mode).toBe("primary")
      expect(visualQa?.native).toBe(true)
      expect(visualQa?.hidden).toBe(true)
      expect(visualQa?.prompt).toBe(VISUAL_QA_CORE)
      expect(evalPerm(visualQa, "edit")).toBe("allow")
      expect(evalPerm(visualQa, "bash")).toBe("allow")
      expect(evalPerm(visualQa, "write")).toBe("allow")
      expect(evalPerm(visualQa, "webpage_render")).not.toBe("allow")
      expect(evalPerm(visualQa, "webpage_vision_judge")).not.toBe("allow")
      expect(evalPerm(visualQa, "browser_preview")).toBe("allow")
      expect(evalPerm(visualQa, "browser_preview_compare_scroll_slices")).toBe("allow")
      expect(evalPerm(visualQa, "browser_preview_layout_geometry")).toBe("allow")
      expect(evalPerm(visualQa, "webpage_extract")).toBe("deny")
      const visible = visibleToolIDs(visualQa)
      expect([...visible].sort()).toEqual([...VISUAL_QA_STATIC_TOOL_IDS].sort())
      expect(visible.has("webpage_extract")).toBe(false)
      expect(visible.has("browser_preview")).toBe(true)
      expect(visible.has("browser_preview_compare_scroll_slices")).toBe(true)
      expect(visible.has("browser_preview_layout_geometry")).toBe(true)
      expect(visible.has("webpage_render")).toBe(false)
      expect(visible.has("webpage_evaluate")).toBe(false)
      expect(visible.has("webpage_vision_judge")).toBe(false)
      expect(visible.has("skill")).toBe(true)

      const tools = await ToolRegistry.tools({ providerID: "", modelID: "" }, visualQa)
      const ids = new Set(tools.map((tool) => tool.id))
      expect(WEBPAGE_EVIDENCE_ACCEPTANCE_TOOL_IDS).toEqual([])
      for (const id of WEBPAGE_EVIDENCE_ANALYSIS_TOOL_IDS) expect(ids.has(id)).toBe(false)
      expect(ids.has("webpage_render")).toBe(false)
      expect(ids.has("webpage_evaluate")).toBe(false)
      expect(ids.has("webpage_vision_judge")).toBe(false)
      expect(ids.has("browser_preview_compare_scroll_slices")).toBe(true)
      expect(ids.has("browser_preview_layout_geometry")).toBe(true)
    },
  })
}, 30_000)

test("visual-qa webpage evidence analysis denial cannot be reopened by per-agent permission config", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        "visual-qa": {
          permission: {
            webpage_extract: "allow",
            webpage_runtime_state: "allow",
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const visualQa = await Agent.get("visual-qa")
      expect(visualQa).toBeDefined()
      expect(evalPerm(visualQa, "webpage_extract")).toBe("deny")
      expect(evalPerm(visualQa, "webpage_runtime_state")).toBe("deny")
      expect(evalPerm(visualQa, "webpage_render")).not.toBe("allow")

      const tools = await ToolRegistry.tools({ providerID: "", modelID: "" }, visualQa)
      const ids = new Set(tools.map((tool) => tool.id))
      expect(ids.has("webpage_extract")).toBe(false)
      expect(ids.has("webpage_runtime_state")).toBe(false)
      expect(ids.has("webpage_render")).toBe(false)
      expect(ids.has("skill")).toBe(true)
    },
  })
}, 30_000)

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
      expect(visibleToolIDs(coding).has("request_orchestrator_decision")).toBe(false)
    },
  })
})

test("right sidebar coding assistant is a hidden full-function primary agent", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.get("coding-assistant")
      expect(agent).toBeDefined()
      expect(agent?.mode).toBe("primary")
      expect(agent?.native).toBe(true)
      expect(agent?.hidden).toBe(true)
      expect(agent?.prompt).toBe(PROMPT_CODING)
      expect(await Agent.nativeDefaultPrompt("coding-assistant")).toBe(PROMPT_CODING)
      expect(evalPerm(agent, "edit")).toBe("allow")
      expect(evalPerm(agent, "bash")).toBe("allow")
      expect(evalPerm(agent, "skill")).toBe("allow")
      expect(evalPerm(agent, "todoread")).toBe("allow")
      expect(evalPerm(agent, "todowrite")).toBe("allow")
      expect(visibleToolIDs(agent).has("panel")).toBe(true)
      expect(visibleToolIDs(agent).has("request_orchestrator_decision")).toBe(false)

      const tools = await ToolRegistry.tools({ providerID: "", modelID: "" }, agent!)
      const ids = new Set(tools.map((tool) => tool.id))
      expect(ids.has("edit")).toBe(true)
      expect(ids.has("bash")).toBe(true)
      expect(ids.has("skill")).toBe(true)
      expect(ids.has("panel")).toBe(true)
    },
  })
}, 30_000)

test("role contract metadata is projected onto registered agents", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const integrity = await Agent.get("integrity")
      const orchestrator = await Agent.get("orchestrator")
      const codingAssistant = await Agent.get("coding-assistant")

      expect(integrity?.archetype).toBe("worker")
      expect(integrity?.skill_mountable).toBe(true)
      expect(orchestrator?.archetype).toBe("host")
      expect(orchestrator?.skill_mountable).toBe(false)
      expect(codingAssistant?.archetype).toBe("worker")
      expect(codingAssistant?.skill_mountable).toBe(false)
    },
  })
})

test("custom default tool pool excludes task-scoped agent coordination", () => {
  expect(AgentToolPool.customDefault().global).not.toContain("request_orchestrator_decision")
})

test("all live task-owned worker roles expose the A2A request tool", () => {
  const liveTaskWorkerRoles = AgentRoleContract.ids.filter((role) => {
    const contract = AgentRoleContract.get(role)
    return (
      contract.archetype === "worker" &&
      contract.agentOwnedSessionKind &&
      contract.runtimeContractRequired &&
      contract.liveRuntimeContinuation
    )
  })

  expect(liveTaskWorkerRoles).toEqual([
    "build",
    "visual-qa",
    "explore",
    "requirements",
    "architect",
    "frontend-design",
    "intent-analysis",
    "integrity",
    "fact-check",
    "deep-research",
    "frontend-research",
    "goal-workload-analyst",
  ])
  for (const role of liveTaskWorkerRoles) {
    expect(AgentToolPool.hasTool(AgentToolPool.assignment(role), "request_orchestrator_decision")).toBe(true)
  }
})

test("explore agent limits exposed tools without permission denials", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await Agent.get("explore")
      expect(explore).toBeDefined()
      expect(explore?.mode).toBe("subagent")
      const visible = visibleToolIDs(explore)
      expect(visible.has("edit")).toBe(false)
      expect(visible.has("write")).toBe(false)
      expect(evalPerm(explore, "edit")).toBe("allow")
      expect(evalPerm(explore, "write")).toBe("allow")
      // BUG① regression: explore is a research subagent — webfetch alone
      // (fetch a known URL, bot-blocked on search/scholar) is not enough; it
      // must also resolve `websearch`.
      expect(visible.has("websearch")).toBe(true)
      expect(visible.has("webfetch")).toBe(true)
      expect(visible.has("request_orchestrator_decision")).toBe(true)
      const exploreTools = await ToolRegistry.tools({ providerID: "", modelID: "" }, explore)
      expect(exploreTools.map((t) => t.id)).toContain("websearch")
      expect(exploreTools.map((t) => t.id)).toContain("request_orchestrator_decision")
    },
  })
  // ToolRegistry.tools() does cold first-time init of every registered tool
  // (~25, several doing real I/O); on Windows the default 5 s flakes. Match
  // the 30 s headroom the other tool-resolution assertions in this file use.
}, 30_000)

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
      const visible = visibleToolIDs(general)
      expect(visible.has("task")).toBe(true)
      expect(visible.has("request_orchestrator_decision")).toBe(false)
      expect(visible.has("todoread")).toBe(false)
      expect(visible.has("todowrite")).toBe(false)
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
      const visible = visibleToolIDs(orchestrator)
      expect(visible.has(["steer", "subagent"].join("_"))).toBe(false)
      expect(visible.has("cancel_subagent")).toBe(true)
      expect(visible.has("propose_task")).toBe(true)
      expect(visible.has("add_goal")).toBe(true)
      expect(visible.has("select_expert_squad")).toBe(true)
      expect(visible.has("browser_preview")).toBe(true)
      expect(visible.has("wait")).toBe(true)
      expect(visible.has("panel")).toBe(false)
      expect(visible.has("task")).toBe(false)
      expect(visible.has("skill")).toBe(true)
      expect(visible.has("task_report")).toBe(false)
      expect(visible.has("memory")).toBe(false)

      const tools = await ToolRegistry.tools({ providerID: "", modelID: "" }, orchestrator)
      expect(tools.map((tool) => tool.id)).not.toContain("panel")
      expect(tools.map((tool) => tool.id)).not.toContain("task")
      expect(tools.map((tool) => tool.id)).toContain("skill")
      expect(tools.map((tool) => tool.id)).not.toContain("task_report")
      expect(tools.map((tool) => tool.id)).not.toContain("memory")
    },
  })
})

test("orchestrator skill policy exposes only mounted expert-squad skills", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".opencorvus", "skill", "tool-skill", "SKILL.md"),
        `---
name: tool-skill
description: Skill for system-prompt visibility tests.
mounted_agents:
  - requirements
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

      expect(await SystemPrompt.skills(orchestrator!, { availableToolNames: ["skill"] })).toContain(
        "- none: No enabled skills are currently mounted for this agent in this turn.",
      )
      const orchestratorPrompt = await SystemPrompt.skills(orchestrator!, {
        availableToolNames: ["skill", "select_expert_squad"],
      })
      expect(orchestratorPrompt).toContain("frontend-replica-expert-squad")
      expect(orchestratorPrompt).toContain("frontend-automation-debug-expert-squad")
      expect(orchestratorPrompt).not.toContain("tool-skill")
      const prompt = await SystemPrompt.skills(requirements!)
      expect(prompt).toContain("### Mounted Skills")
      expect(prompt).toContain("already mounted for this agent in the current turn")
      expect(prompt).toContain("The `skill` tool can search mounted skills")
      expect(prompt).toContain("fuzzy-search mounted skill titles and SKILL.md contents")
      expect(prompt).toContain("Before planning or tool use")
      expect(prompt).toContain("tool-skill")
    },
  })
})

test("skill policy still advertises search when no enabled skills are mounted", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const requirements = await Agent.get("requirements")
      expect(requirements).toBeDefined()

      const prompt = await SystemPrompt.skills(requirements!, { availableToolNames: ["skill"] })
      expect(prompt).toContain("The `skill` tool can search mounted skills")
      expect(prompt).toContain("- none: No enabled skills are currently mounted for this agent in this turn.")
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
mounted_agents:
  - requirements
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

      expect(await SystemPrompt.skills(requirements!, { availableToolNames: ["read"] })).toBeUndefined()
      expect(await SystemPrompt.skills(requirements!, { availableToolNames: ["read", "skill"] })).toContain(
        "tool-skill",
      )
    },
  })
})

test("frontend agents expose skill loading without reopening retrieval tools", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".opencorvus", "skill", "frontend-skill", "SKILL.md"),
        `---
name: frontend-skill
description: Skill for frontend agent visibility tests.
mounted_agents:
  - frontend-design
  - frontend-research
---

# Frontend Skill
`,
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      for (const name of ["frontend-design", "frontend-research"] as const) {
        const agent = await Agent.get(name)
        expect(agent).toBeDefined()
        expect(visibleToolIDs(agent).has("skill")).toBe(true)
        expect(await SystemPrompt.skills(agent!, { availableToolNames: ["skill"] })).toContain("frontend-skill")

        const tools = await ToolRegistry.tools({ providerID: "", modelID: "" }, agent!)
        const ids = tools.map((tool) => tool.id)
        expect(ids).toContain("skill")
      }

      const frontendResearch = await Agent.get("frontend-research")
      const frontendResearchTools = await ToolRegistry.tools({ providerID: "", modelID: "" }, frontendResearch!)
      const frontendResearchToolIDs = frontendResearchTools.map((tool) => tool.id)
      expect(frontendResearchToolIDs.sort()).toEqual(["request_orchestrator_decision", "skill"].sort())
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
        "read",
        "glob",
        "search_code",
        "list",
        "memory",
        "skill",
        "request_orchestrator_decision",
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
        const visible = visibleToolIDs(agent)
        expect([...visible].sort()).toEqual([...allowedWebResearch].sort())
        expect(visible.has("websearch")).toBe(true)
        for (const tool of forbidden) {
          expect(visible.has(tool)).toBe(false)
        }
      }

      // intent-analysis is the first cheap classification step. It must NOT
      // research — websearch ×8 at the intent stage was the observed
      // anti-pattern (2026-05-19). websearch is forbidden here.
      const intent = await Agent.get("intent-analysis")
      expect(intent).toBeDefined()
      const intentVisible = visibleToolIDs(intent)
      expect([...intentVisible].sort()).toEqual([...baseReadonly].sort())
      for (const tool of [...forbidden, "websearch"]) {
        expect(intentVisible.has(tool)).toBe(false)
      }

      // frontend-design owns webpage evidence extraction (URL/Figma/pixels); generic
      // websearch is redundant with that chain and risks score loops.
      const design = await Agent.get("frontend-design")
      const designVisible = visibleToolIDs(design)
      expect([...designVisible].sort()).toEqual([...FRONTEND_DESIGN_STATIC_TOOL_IDS].sort())
      expect(designVisible.has("url_screenshot")).toBe(true)
      expect(designVisible.has("webpage_render")).toBe(false)
      expect(designVisible.has("webpage_evaluate")).toBe(false)
      expect(designVisible.has("webpage_vision_judge")).toBe(false)
      expect(designVisible.has("skill")).toBe(true)
      expect(designVisible.has("websearch")).toBe(false)
      expect(designVisible.has("task")).toBe(false)

      const visualQa = await Agent.get("visual-qa")
      expect(visualQa).toBeDefined()
      const visualVisible = visibleToolIDs(visualQa)
      expect([...visualVisible].sort()).toEqual([...VISUAL_QA_STATIC_TOOL_IDS].sort())
      expect(visualVisible.has("skill")).toBe(true)
      expect(visualVisible.has("request_orchestrator_decision")).toBe(true)
      expect(visualVisible.has("browser_preview")).toBe(true)
      expect(visualVisible.has("browser_preview_compare_scroll_slices")).toBe(true)
      expect(visualVisible.has("browser_preview_layout_geometry")).toBe(true)
      expect(visualVisible.has("bash")).toBe(true)
      expect(visualVisible.has("webpage_render")).toBe(false)
      expect(visualVisible.has("webpage_evaluate")).toBe(false)
      expect(visualVisible.has("webpage_vision_judge")).toBe(false)
      expect(visualVisible.has("webpage_extract")).toBe(false)
      expect(visualVisible.has("webpage_analyze")).toBe(false)
      expect(visualVisible.has("websearch")).toBe(false)
      expect(visualVisible.has("task")).toBe(false)

      const deepResearch = await Agent.get("deep-research")
      expect(deepResearch).toBeDefined()
      const deepVisible = visibleToolIDs(deepResearch)
      expect([...deepVisible].sort()).toEqual(
        [
          "external_code_search",
          "glob",
          "list",
          "memory",
          "read",
          "request_orchestrator_decision",
          "search_code",
          "skill",
          "todoread",
          "todowrite",
          "webfetch",
        ].sort(),
      )
      expect(deepVisible.has("websearch")).toBe(false)
      for (const tool of [
        "bash",
        "edit",
        "write",
        "apply_patch",
        "task",
        "panel",
        "deliver",
        "build",
        "propose_task",
      ]) {
        expect(deepVisible.has(tool)).toBe(false)
      }

      const frontendResearch = await Agent.get("frontend-research")
      expect(frontendResearch).toBeDefined()
      const researchVisible = visibleToolIDs(frontendResearch)
      expect([...researchVisible].sort()).toEqual(["request_orchestrator_decision", "skill"].sort())
      expect(researchVisible.has("skill")).toBe(true)
      expect(researchVisible.has("request_orchestrator_decision")).toBe(true)
      expect(researchVisible.has("websearch")).toBe(false)
      expect(researchVisible.has("webfetch")).toBe(false)
      expect(researchVisible.has("read")).toBe(false)
      expect(researchVisible.has("search_code")).toBe(false)
      expect(researchVisible.has("task")).toBe(false)
      expect(researchVisible.has("build")).toBe(false)

      const integrity = await Agent.get("integrity")
      expect(integrity).toBeDefined()
      expect([...visibleToolIDs(integrity)].sort()).toEqual([...INTEGRITY_DECLARED_TOOL_IDS].sort())
      expect(await Agent.get("acceptance")).toBeUndefined()
    },
  })
})

test("deep-research agent tool config cannot reopen executor surfaces", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        "deep-research": {
          tools: { global: ["bash"] },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Agent.get("deep-research")).rejects.toThrow("config.agent.deep-research.tools is not supported")
    },
  })
})

test("fixed evidence agents cannot be disabled or tool-overridden", async () => {
  await using deepResearchTmp = await tmpdir({
    config: {
      agent: {
        "deep-research": { disable: true },
      },
    },
  })
  await Instance.provide({
    directory: deepResearchTmp.path,
    fn: async () => {
      await expect(Agent.get("deep-research")).rejects.toThrow("config.agent.deep-research.disable is not supported")
    },
  })

  await using factCheckTmp = await tmpdir({
    config: {
      agent: {
        "fact-check": { tools: { global: ["bash"] } },
      },
    },
  })
  await Instance.provide({
    directory: factCheckTmp.path,
    fn: async () => {
      await expect(Agent.get("fact-check")).rejects.toThrow("config.agent.fact-check.tools is not supported")
    },
  })

  await using frontendResearchTmp = await tmpdir({
    config: {
      agent: {
        "frontend-research": { tools: { global: ["bash"] } },
      },
    },
  })
  await Instance.provide({
    directory: frontendResearchTmp.path,
    fn: async () => {
      await expect(Agent.get("frontend-research")).rejects.toThrow(
        "config.agent.frontend-research.tools is not supported",
      )
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
      const visible = visibleToolIDs(orchestrator)
      for (const tool of [
        "propose_task",
        "complete_task",
        "fail_task",
        "cancel_task",
        "retry_task",
        "inject_operator_message",
        "cancel_subagent",
        "add_goal",
        "select_expert_squad",
        "wait",
        "skill",
      ]) {
        expect(visible.has(tool)).toBe(true)
      }
      expect(visible.has(["restart", "from", "stage"].join("_"))).toBe(false)
      expect(visible.has(["steer", "subagent"].join("_"))).toBe(false)
      expect(visible.has("integrity")).toBe(true)
      expect(visible.has("browser_preview")).toBe(true)
      expect(visible.has("deep_research")).toBe(true)
      expect(visible.has("research")).toBe(false)
      expect(visible.has("frontend_research")).toBe(true)
      expect(visible.has("deliver")).toBe(false)
      expect(visible.has("publish_acceptance")).toBe(false)
      expect(orchestrator?.prompt).toContain("propose_task")
    },
  })
})

test("task lifecycle tools are exposed only to the orchestrator scheduler", () => {
  const taskLifecycleTools = [
    "propose_task",
    "complete_task",
    "fail_task",
    "cancel_task",
    "retry_task",
    "inject_operator_message",
  ]

  for (const [role, assignment] of Object.entries(AgentToolPool.roleAssignments)) {
    const visible = AgentToolPool.visibleToolIDs(assignment)
    for (const tool of taskLifecycleTools) {
      expect(visible.has(tool), `${role} visibility for ${tool}`).toBe(role === "orchestrator")
    }
  }
})

test("orchestrator tool pool covers every self-built orchestrator tool", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orchestrator = await Agent.get("orchestrator")
      expect(orchestrator).toBeDefined()
      const visible = visibleToolIDs(orchestrator)
      const { tools } = createOrchestratorTools({
        taskID: "tsk_orchestrator_tool_surface_audit",
        agentSessionID: "ses_orchestrator_tool_surface_audit",
        signal: new AbortController().signal,
      })

      for (const toolName of Object.keys(tools)) {
        expect(visible.has(toolName), `${toolName} is implemented but hidden from the orchestrator agent`).toBe(true)
      }
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
      expect(compaction?.tools).toEqual({ global: [], private: [] })
      expect(evalPerm(compaction, "bash")).toBe("allow")
      expect(evalPerm(compaction, "edit")).toBe("allow")
      expect(evalPerm(compaction, "read")).toBe("allow")
    },
  })
})

test("integrity agent exposes the shared preview repair registry tools", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const integrity = await Agent.get("integrity")
      expect(integrity).toBeDefined()
      expect(integrity?.hidden).toBe(true)
      expect([...visibleToolIDs(integrity)].sort()).toEqual([...INTEGRITY_DECLARED_TOOL_IDS].sort())
      expect(visibleToolIDs(integrity).has("skill")).toBe(true)
      expect([...visibleToolIDs(integrity)]).toEqual(expect.arrayContaining([...INTEGRITY_PREVIEW_TOOL_IDS, "skill"]))
    },
  })
})

test("orchestrator tool pool excludes dead tool references", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orchestrator = await Agent.get("orchestrator")
      expect(orchestrator).toBeDefined()
      // Dead tool names in the pool contract mislead readers and prompt drafts
      // into thinking the orchestrator can call tools that are not mounted.
      expect(visibleToolIDs(orchestrator).has("retired_metric_probe")).toBe(false)
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
          skill_mountable: true,
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
      expect(custom?.skill_mountable).toBe(true)
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
  await expect(
    Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Agent.get("build")
      },
    }),
  ).rejects.toThrow("config.agent.build.name cannot rename the agent identity")
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
  await expect(
    Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Agent.get("build")
      },
    }),
  ).rejects.toThrow("config.agent.build.prompt is invalid for append-mode agents")
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

test("frontend-design advertises url_screenshot and omits webfetch", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const frontendDesign = await Agent.get("frontend-design")
      const visible = visibleToolIDs(frontendDesign)
      expect(visible.has("url_screenshot")).toBe(true)
      expect(visible.has("bash")).toBe(true)
      expect(visible.has("edit")).toBe(true)
      expect(visible.has("write")).toBe(true)
      expect(visible.has("apply_patch")).toBe(true)
      expect(visible.has("create_frontend_skeleton_project")).toBe(true)
      expect(visible.has("record_frontend_region_selection")).toBe(true)
      expect(visible.has("record_frontend_replacement_result")).toBe(true)
      expect(visible.has("web_clone_source_audit")).toBe(false)
      expect(visible.has("webpage_render")).toBe(false)
      expect(visible.has("webpage_evaluate")).toBe(false)
      expect(visible.has("webpage_vision_judge")).toBe(false)
      expect(visible.has("webfetch")).toBe(false)
      expect(visible.has("todoread")).toBe(false)
      expect(visible.has("todowrite")).toBe(false)

      const { createUrlScreenshotTool } = await import("../../src/frontend-design/url-screenshot-tool")
      expect(Object.keys(createUrlScreenshotTool())).toEqual(["url_screenshot"])
    },
  })
})

test("frontend-design statically declares webpage evidence and source refinement tools", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const frontendDesign = await Agent.get("frontend-design")
      expect(frontendDesign).toBeDefined()
      const designToolIds = visibleToolIDs(frontendDesign)
      expect([...designToolIds].sort()).toEqual([...FRONTEND_DESIGN_STATIC_TOOL_IDS].sort())
      for (const id of WEBPAGE_EVIDENCE_ANALYSIS_TOOL_IDS) {
        expect(designToolIds.has(id)).toBe(true)
      }
      for (const id of WEBPAGE_EVIDENCE_ACCEPTANCE_TOOL_IDS) {
        expect(designToolIds.has(id)).toBe(true)
      }
      expect(designToolIds.has("bash")).toBe(true)
      expect(designToolIds.has("edit")).toBe(true)
      expect(designToolIds.has("write")).toBe(true)
      expect(designToolIds.has("apply_patch")).toBe(true)
      expect(designToolIds.has("create_frontend_skeleton_project")).toBe(true)
      expect(designToolIds.has("record_frontend_region_selection")).toBe(true)
      expect(designToolIds.has("record_frontend_replacement_result")).toBe(true)
      expect(designToolIds.has("web_clone_source_audit")).toBe(false)
    },
  })
})

test("frontend-design rejects config-defined dynamic tool surface", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        "frontend-design": {
          tools: { global: ["read"] },
        },
      },
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Agent.get("frontend-design")).rejects.toThrow("config.agent.frontend-design.tools is not supported")
    },
  })
})

test("visual-qa rejects config-defined dynamic tool surface", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        "visual-qa": {
          tools: { global: ["read"] },
        },
      },
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Agent.get("visual-qa")).rejects.toThrow("config.agent.visual-qa.tools is not supported")
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

/**
 * Mission split contract.
 *
 * `mission` is a hidden primary agent — a full coordinator that reads and
 * analyses the project, plans, and dispatches squad/team work, but is NOT a
 * coding executor. The orchestrator-core comment block (see agent.ts) is the
 * historical reason a coordination agent must NOT hold bash/edit/write: such
 * an agent drifts into executing work itself instead of delegating. These
 * assertions guard that boundary.
 */
test("mission is hidden primary with the coordinator prompt", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const mission = await Agent.get("mission")
      expect(mission).toBeDefined()
      expect(mission?.mode).toBe("primary")
      expect(mission?.hidden).toBe(true)
      expect(mission?.native).toBe(true)
      expect(mission?.prompt).toContain("OpenCorvus Mission")
      // The old supervisor framing must be gone — Mission is a full
      // coordinator, not a "NOT an executor" dispatcher, and the gateway
      // naming is retired from the upper-level agent.
      expect(mission?.prompt).not.toContain("Gateway Master")
      expect(mission?.prompt).not.toContain("You are NOT an executor")
      // Worktree convention contract surfaced in the prompt — the four
      // mission files are part of Mission's persistence contract, not
      // free LLM choice.
      expect(mission?.prompt).toContain("frontier.md")
      expect(mission?.prompt).toContain("handoff.md")
      // Task granularity convention (prompt-only rule per CLAUDE.md rule 6.1).
      // Mission may fan out independent scopes, but dependent scopes must
      // queue instead of starting in parallel. The executor's architect already
      // decomposes a task into goals, so related frontier bullets still bundle.
      expect(mission?.prompt).toContain("TASK GRANULARITY")
      expect(mission?.prompt).toContain("Parallel dispatch is allowed only when")
      expect(mission?.prompt).toContain("no dependency on each other's output")
      expect(mission?.prompt).toContain("Dependent child work must stay queued")
      expect(mission?.prompt).toContain("double-decomposition")
      // Mission-created tasks must carry the user's real request forward,
      // not only Mission's compressed interpretation.
      expect(mission?.prompt).toContain("Set `create_task.title` to a short semantic name")
      expect(mission?.prompt).toContain("The host formats the final ledger title exactly as `Phase xx: <title>`")
      expect(mission?.prompt).toContain("If you omit `title`, task creation fails")
      expect(mission?.prompt).toContain("Every `create_task.request` MUST include an `Original user input` section")
      expect(mission?.prompt).toContain("Quote the task-relevant part(s) of the user's original message(s) verbatim")
      expect(mission?.prompt).toContain("downstream agents audit the real request instead of your summary")
    },
  })
})

test("mission's resolved tool surface is the coordinator set (read/analyse + dispatch, no execution)", async () => {
  // ToolRegistry.tools() does first-time tool-init on every registered
  // tool (~25 of them, several of which do real I/O on init), so this
  // assertion needs more headroom than the 5 s default. Matches the
  // pattern used by the explore/general assertions earlier in this file.
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const mission = await Agent.get("mission")
      const tools = await ToolRegistry.tools({ providerID: "", modelID: "" }, mission)
      const ids = tools.map((tool) => tool.id).sort()

      // Forward: read/analyse the project, research, carry state, dispatch.
      // (lsp is experimental/flag-gated in the registry, so it is part of the
      // include but does not resolve in the default test env — not asserted.)
      for (const allowed of [
        "read",
        "glob",
        "search_code",
        "mission_state",
        "panel",
        "webfetch",
        "websearch",
        "memory",
        "todoread",
        "todowrite",
        "question",
      ]) {
        expect(ids).toContain(allowed)
      }

      // Reverse: no EXECUTION tools, ever. If any of these fires, Mission
      // has acquired the ability to do work itself instead of delegating to
      // an orchestrator-led squad/team — re-read the orchestrator-core
      // comment block before "fixing".
      for (const forbidden of [
        "bash",
        "edit",
        "write",
        "apply_patch",
        "task",
        "task_report",
        "goal_report",
        "skill",
        "webpage_extract",
        "url_screenshot",
        "webpage_render",
        "webpage_evaluate",
      ]) {
        expect(ids).not.toContain(forbidden)
      }
    },
  })
}, 30_000)

test("Agent.defaultAgent() does NOT select mission even when only it is primary", async () => {
  // hidden:true keeps defaultAgent from ever returning it implicitly.
  // The Mission page wakes it through an explicit endpoint instead.
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const def = await Agent.defaultAgent()
      expect(def).not.toBe("mission")
    },
  })
})

test("operator cannot promote mission into the default-agent slot (hidden agents are rejected)", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "mission",
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Agent.defaultAgent()).rejects.toThrow(/hidden/)
    },
  })
})
