import { describe, expect, test } from "bun:test"
import path from "path"
import { AgentToolPool } from "../../src/agent/tool-pool-contract"
import { Config } from "../../src/config/config"
import { PromptProfileResolver } from "../../src/expert-squad/prompt-profile-resolver"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { Instance } from "../../src/project/instance"
import { Skill } from "../../src/skill/skill"
import { PROJECT_EXPERT_SQUAD_ID, writeProjectExpertSquadPackage } from "../fixture/expert-squad"
import { tmpdir } from "../fixture/fixture"

const expectedSchedulerRoleBaseToolIDs = [
  "select_expert_squad",
  "skill",
  "question",
  "read_context",
  "query_failed_goals",
  "complete_task",
  "fail_task",
  "cancel_task",
  "retry_task",
  "wait",
  "inject_operator_message",
  "respond_agent_coordination",
  "cancel_subagent",
] as const

const builtInSchedulerExpectations = [
  {
    profileID: "frontend-replica",
    includes: ["frontend_research", "frontend_design", "visual_qa", "workload_analysis", "browser_preview", "bash"],
    excludes: ["deep_research", "fact_check"],
  },
  {
    profileID: "frontend-automation-debug",
    includes: [
      "frontend_research",
      "frontend_design",
      "visual_qa",
      "workload_analysis",
      "fact_check",
      "browser_preview",
      "bash",
    ],
    excludes: ["deep_research"],
  },
  {
    profileID: "frontend-innovate",
    includes: [
      "frontend_research",
      "frontend_design",
      "deep_research",
      "visual_qa",
      "workload_analysis",
      "fact_check",
      "browser_preview",
      "bash",
    ],
    excludes: [],
  },
  {
    profileID: "backend",
    includes: ["deep_research", "fact_check", "workload_analysis", "build", "bash"],
    excludes: ["frontend_design", "frontend_research", "visual_qa", "browser_preview"],
  },
  {
    profileID: "algorithm",
    includes: ["deep_research", "fact_check", "workload_analysis", "build", "bash"],
    excludes: ["frontend_design", "frontend_research", "visual_qa", "browser_preview"],
  },
] as const

describe("PromptProfileResolver", () => {
  test("loads project package profiles into the catalog and composes package overlays", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path)
    const config = Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } })

    const catalog = await PromptProfileResolver.list({
      projectDirectory: project.path,
      config,
      projectActive: PROJECT_EXPERT_SQUAD_ID,
      sessionActive: null,
    })
    const profile = catalog.profiles.find((entry) => entry.id === PROJECT_EXPERT_SQUAD_ID)

    expect(catalog.active).toBe(PROJECT_EXPERT_SQUAD_ID)
    expect(profile).toMatchObject({
      id: PROJECT_EXPERT_SQUAD_ID,
      label: "Project Replica",
      built_in: false,
      editable: false,
      agents: {
        build: "project build overlay",
        orchestrator: "project orchestrator overlay",
      },
    })
    expect(Object.keys(profile ?? {}).sort()).toEqual(["agents", "built_in", "description", "editable", "id", "label"])

    await expect(
      PromptProfileResolver.composeAgentPrompt({
        projectDirectory: project.path,
        agentID: "build",
        base: "BASE",
        userAppend: "USER APPEND",
        config,
      }),
    ).resolves.toBe("BASE\n\nproject build overlay\n\nUSER APPEND")
  })

  test("rejects unknown project profile IDs with project context", async () => {
    await using project = await tmpdir({ git: true })
    const config = Config.Info.parse({ prompt_profile: { active: "missing-profile" } })

    await expect(PromptProfileResolver.list({ projectDirectory: project.path, config })).rejects.toThrow(
      /Unknown prompt profile "missing-profile"/,
    )
    await expect(
      PromptProfileResolver.assertKnownProfileID({ projectDirectory: project.path, profileID: "missing-profile" }),
    ).rejects.toThrow(/Unknown prompt profile "missing-profile"/)
  })

  test("rejects project packages that collide with built-in profile IDs", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path, "frontend-replica")
    const config = Config.Info.parse({ prompt_profile: { active: "general" } })

    await expect(PromptProfileResolver.list({ projectDirectory: project.path, config })).rejects.toThrow(
      /collides with a built-in expert squad id/,
    )
  })

  test("resolves general scheduler capability to the explicit role-base tool set", async () => {
    const config = Config.Info.parse({ prompt_profile: { active: "general" } })
    const capability = await PromptProfileResolver.resolveSchedulerCapability({ config })

    expect(AgentToolPool.orchestratorSchedulerRoleBaseToolIDs()).toEqual([...expectedSchedulerRoleBaseToolIDs])
    expect(capability.promptProfileID).toBe("general")
    expect(capability.builtIn).toBe(true)
    expect(capability.builtInToolIDs).toEqual([...expectedSchedulerRoleBaseToolIDs])
    expect(capability.projectedWorkflowTools).toEqual([])
    expect(capability.includeMcpTools).toBe(false)
    expect(capability.projectionHash).toMatch(/^[a-f0-9]{64}$/)

    const { tools: rawTools } = createOrchestratorTools({
      taskID: "tsk_general_projection",
      agentSessionID: "ses_general_projection",
    })
    const projectedTools = PromptProfileResolver.projectOrchestratorTools(rawTools, capability)
    expect(Object.keys(projectedTools)).toEqual([...expectedSchedulerRoleBaseToolIDs])
    for (const hidden of [
      "build",
      "requirements",
      "architect",
      "frontend_design",
      "frontend_research",
      "visual_qa",
      "integrity",
      "deep_research",
      "fact_check",
      "workload_analysis",
      "analyze_intent",
      "explore",
      "add_goal",
      "modify_goal",
      "complete_goal",
      "delete_goal",
      "refine",
      "propose_task",
      "browser_preview",
      "bash",
    ]) {
      expect(Object.hasOwn(projectedTools, hidden), `general must not expose ${hidden}`).toBe(false)
    }
  })

  test("resolves every non-general built-in scheduler capability from manifest tool lists", async () => {
    const { tools: rawTools } = createOrchestratorTools({
      taskID: "tsk_builtin_projection",
      agentSessionID: "ses_builtin_projection",
    })

    for (const expectation of builtInSchedulerExpectations) {
      const capability = await PromptProfileResolver.resolveSchedulerCapability({
        config: Config.Info.parse({ prompt_profile: { active: expectation.profileID } }),
      })
      const projectedTools = PromptProfileResolver.projectOrchestratorTools(rawTools, capability)

      expect(capability.promptProfileID).toBe(expectation.profileID)
      expect(capability.builtIn).toBe(true)
      expect(capability.builtInToolIDs.slice(0, expectedSchedulerRoleBaseToolIDs.length)).toEqual([
        ...expectedSchedulerRoleBaseToolIDs,
      ])
      expect(Object.keys(projectedTools)).toEqual(capability.builtInToolIDs)
      for (const toolID of expectation.includes) {
        expect(capability.builtInToolIDs, `${expectation.profileID} should expose ${toolID}`).toContain(toolID)
        expect(Object.hasOwn(projectedTools, toolID), `${expectation.profileID} should project ${toolID}`).toBe(true)
      }
      for (const toolID of expectation.excludes) {
        expect(capability.builtInToolIDs, `${expectation.profileID} should not expose ${toolID}`).not.toContain(toolID)
        expect(Object.hasOwn(projectedTools, toolID), `${expectation.profileID} should not project ${toolID}`).toBe(
          false,
        )
      }
    }
  })

  test("resolves project package scheduler projection without activating package tool or MCP refs", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path)
    const capability = await PromptProfileResolver.resolveSchedulerCapability({
      projectDirectory: project.path,
      config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
    })

    expect(capability.builtIn).toBe(false)
    expect(capability.promptProfileID).toBe(PROJECT_EXPERT_SQUAD_ID)
    expect(capability.builtInToolIDs).toContain("build")
    expect(capability.builtInToolIDs).toContain("select_expert_squad")
    expect(capability.scheduler.package_tool_refs).toContain(`${PROJECT_EXPERT_SQUAD_ID}/orchestrator/source-evidence`)
    expect(capability.scheduler.package_mcp_server_refs).toContain(
      `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/package-browser`,
    )
    expect(capability.includeMcpTools).toBe(false)

    const { tools: rawTools } = createOrchestratorTools({
      taskID: "tsk_project_projection",
      agentSessionID: "ses_project_projection",
    })
    const projectedTools = PromptProfileResolver.projectOrchestratorTools(rawTools, capability)
    expect(Object.hasOwn(projectedTools, "build")).toBe(true)
    expect(Object.hasOwn(projectedTools, `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/source-evidence`)).toBe(false)
    expect(Object.hasOwn(projectedTools, "package-browser")).toBe(false)
  })

  test("resolves general skill projection to selector skills without unreferenced default ordinary skills", async () => {
    await using project = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".opencorvus", "skill", "unreferenced-default", "SKILL.md"),
          [
            "---",
            "name: unreferenced-default",
            "description: Default ordinary skill that must stay outside active projection.",
            "mounted_agents:",
            "  - build",
            "---",
            "",
            "# Unreferenced Default",
          ].join("\n"),
        )
      },
    })
    await writeProjectExpertSquadPackage(project.path)

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const projection = await PromptProfileResolver.resolveSkillProjection({
          projectDirectory: project.path,
          config: Config.Info.parse({ prompt_profile: { active: "general" } }),
          agentIDs: ["orchestrator", "build"],
        })

        expect(projection.activeProfile).toBe("general")
        expect(projection.projectedAgentIDs).toEqual(["orchestrator", "build"])
        expect(projection.selectorSkillNames).toEqual([
          "frontend-replica-expert-squad",
          "frontend-innovate-expert-squad",
          "frontend-automation-debug-expert-squad",
          `${PROJECT_EXPERT_SQUAD_ID}-expert-squad`,
        ])
        expect(projection.productionSkillNames).toEqual([])
        expect(projection.projectedSkillNames).toEqual(projection.skills.map((skill) => skill.name))
        expect(projection.projectedSkillNames).toContain(`${PROJECT_EXPERT_SQUAD_ID}-expert-squad`)
        expect(projection.projectedSkillNames).not.toContain("scheduler")
        expect(projection.projectedSkillNames).not.toContain("implementation")
        expect(projection.projectedSkillNames).not.toContain("unreferenced-default")
        expect(projection.skills.map((skill) => skill.name)).not.toContain("unreferenced-default")
      },
    })
  })

  test("rejects ordinary builtin skill collision with a project selector name", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path, "shadowed")

    await expect(
      PromptProfileResolver.resolveSkillProjection({
        projectDirectory: project.path,
        config: Config.Info.parse({ prompt_profile: { active: "general" } }),
        defaultSkills: [
          {
            name: "shadowed-expert-squad",
            description: "Ordinary builtin skill with a selector-shaped name.",
            platforms: [],
            builtin: true,
            location: "builtin://ordinary-shadow",
            content: "",
            priority: 0,
            required_tools: [],
            agents: [],
            mounted_agents: ["orchestrator"],
            duplicate_locations: [],
          },
        ],
        agentIDs: ["orchestrator"],
      }),
    ).rejects.toThrow("collides with an expert-squad selector skill name")
  })

  test("resolves active project package skill projection without registering package production skills globally", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path)

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const projection = await PromptProfileResolver.resolveSkillProjection({
          projectDirectory: project.path,
          config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
          agentIDs: ["orchestrator", "build"],
        })

        expect(projection.activeProfile).toBe(PROJECT_EXPERT_SQUAD_ID)
        expect(projection.projectedToolIDs).toContain("build")
        expect(projection.projectedAgentIDs).toEqual(["orchestrator", "build"])
        expect(projection.selectorSkillNames).toEqual([`${PROJECT_EXPERT_SQUAD_ID}-expert-squad`])
        expect(projection.productionSkillNames.sort()).toEqual(["implementation", "scheduler"])
        expect(projection.projectedSkillNames).toEqual(projection.skills.map((skill) => skill.name))
        expect(projection.projectedSkillNames).toEqual(
          expect.arrayContaining(["implementation", `${PROJECT_EXPERT_SQUAD_ID}-expert-squad`, "scheduler"]),
        )
        expect(projection.projectedSkillNames).not.toContain("source-evidence")
        expect(projection.projectedSkillNames).not.toContain("package-browser")
        expect(projection.skills.find((skill) => skill.name === "scheduler")?.mounted_agents).toEqual(["orchestrator"])
        expect(projection.skills.find((skill) => skill.name === "implementation")?.mounted_agents).toEqual(["build"])
        expect(projection.skills.map((skill) => skill.name)).not.toContain("source-evidence")
        expect(projection.skills.map((skill) => skill.name)).not.toContain("package-browser")
        expect((await Skill.all()).map((skill) => skill.name)).not.toContain("scheduler")
        expect((await Skill.all()).map((skill) => skill.name)).not.toContain("implementation")
      },
    })
  })

  test("resolves explicit default skill refs into the active package skill projection", async () => {
    await using project = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".opencorvus", "skill", "project-guidance", "SKILL.md"),
          [
            "---",
            "name: project-guidance",
            "description: Explicitly projected default skill.",
            "---",
            "",
            "# Project Guidance",
          ].join("\n"),
        )
        await Bun.write(
          path.join(dir, ".opencorvus", "skill", "unreferenced-default", "SKILL.md"),
          [
            "---",
            "name: unreferenced-default",
            "description: Default ordinary skill that is not projected.",
            "mounted_agents:",
            "  - build",
            "---",
            "",
            "# Unreferenced Default",
          ].join("\n"),
        )
      },
    })
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      buildDefaultSkillRefs: ["default/skill/project-guidance"],
    })

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const projection = await PromptProfileResolver.resolveSkillProjection({
          projectDirectory: project.path,
          config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
          agentIDs: ["orchestrator", "build"],
        })

        expect(projection.productionSkillNames).toEqual(expect.arrayContaining(["implementation", "project-guidance"]))
        expect(projection.projectedSkillNames).toContain("project-guidance")
        expect(projection.projectedSkillNames).not.toContain("unreferenced-default")
        expect(projection.skills.find((skill) => skill.name === "project-guidance")?.mounted_agents).toEqual(["build"])
      },
    })
  })

  test("fails visibly when a projected built-in Orchestrator tool has no raw implementation", async () => {
    const capability = await PromptProfileResolver.resolveSchedulerCapability({
      config: Config.Info.parse({ prompt_profile: { active: "general" } }),
    })
    const { tools } = createOrchestratorTools({
      taskID: "tsk_missing_projection",
      agentSessionID: "ses_missing_projection",
    })
    const rawTools: Record<string, (typeof tools)[keyof typeof tools]> = { ...tools }
    delete rawTools.skill

    expect(() => PromptProfileResolver.projectOrchestratorTools(rawTools, capability)).toThrow(
      /projects Orchestrator tool "skill"/,
    )
  })

})
