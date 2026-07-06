import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "node:fs/promises"
import { AgentToolPool } from "../../src/agent/tool-pool-contract"
import { Config } from "../../src/config/config"
import { PromptProfileResolver } from "../../src/expert-squad/prompt-profile-resolver"
import { MCP } from "../../src/mcp"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { Instance } from "../../src/project/instance"
import { Skill } from "../../src/skill/skill"
import { WorkflowRegistry, type OrchestratorWorkflowToolName } from "../../src/engine/workflow"
import {
  copyRepositoryExpertSquadPackage,
  PROJECT_EXPERT_SQUAD_ID,
  PROJECT_EXPERT_SQUAD_NAMESPACE,
  writeProjectExpertSquadPackage,
} from "../fixture/expert-squad"
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

const pipelineWorkflow = WorkflowRegistry.resolveSync("pipeline")!
const directWorkflow = WorkflowRegistry.resolveSync("direct")!

const retiredStaticProfileIDs = ["frontend-replica", "frontend-automation-debug", "frontend-innovate", "backend", "algorithm"] as const
const OPENTEST_EXPERT_SQUAD_ID = "opentest"
const VIRTUAL_RUNTIME_EXPERT_SQUAD_ID = "virtual-runtime"
const packageMcpServerPath = path.join(import.meta.dir, "../fixture/package-mcp-server.ts")

async function withPromptProfileResolverInactivityTimeout<T>(
  label: string,
  inactivityTimeoutMilliseconds: number,
  run: (activity: (step: string) => void) => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastActivity = "start"
  return await new Promise<T>((resolve, reject) => {
    const reset = (step: string) => {
      lastActivity = step
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        reject(new Error(`${label}: inactive for ${inactivityTimeoutMilliseconds}ms after ${lastActivity}`))
      }, inactivityTimeoutMilliseconds)
    }
    reset(lastActivity)
    run(reset).then(resolve, reject).finally(() => {
      if (timer) clearTimeout(timer)
    })
  })
}

function packageMcpDefinition(capabilities: { prompts?: string[]; resources?: string[] }) {
  return {
    type: "local" as const,
    command: [process.execPath, packageMcpServerPath],
    capabilities,
  }
}

async function composeSchedulerPromptWithPackageMcp(input: {
  projectPath: string
  promptName?: string
  resourceName?: string
}) {
  const packageMcpServerRef = `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/package-browser`
  await writeProjectExpertSquadPackage(input.projectPath, PROJECT_EXPERT_SQUAD_ID, {
    schedulerPackageMcpServerRefs: [packageMcpServerRef],
    packageMcpDefinition: packageMcpDefinition({
      ...(input.promptName ? { prompts: [input.promptName] } : {}),
      ...(input.resourceName ? { resources: [input.resourceName] } : {}),
    }),
  })

  return PromptProfileResolver.composeAgentPrompt({
    projectDirectory: input.projectPath,
    agentID: "orchestrator",
    base: "BASE",
    config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
  })
}

async function writeVirtualAgentRuntimePackage(projectRoot: string): Promise<string> {
  const packageRoot = path.join(
    projectRoot,
    ".opencorvus",
    "expert-squads",
    PROJECT_EXPERT_SQUAD_NAMESPACE,
    VIRTUAL_RUNTIME_EXPERT_SQUAD_ID,
  )
  const packageMcpServerRef = `${VIRTUAL_RUNTIME_EXPERT_SQUAD_ID}/build/package-browser`
  const files: Record<string, string> = {
    "README.md": "# Virtual Runtime\n",
    "selector.md": "# Virtual Runtime Selector\n",
    "agents/orchestrator/system.md": "virtual runtime orchestrator overlay",
    "virtual-agents/build/system.md": "virtual runtime build overlay",
    "virtual-agents/build/tools/virtual-evidence.ts": [
      'import { tool } from "@opencorvus-ai/plugin"',
      "",
      "export default tool({",
      '  description: "Virtual build evidence tool.",',
      "  args: {},",
      "  async execute(_args, context) {",
      "    return `virtual-evidence:${context.agent}:${context.directory}`",
      "  },",
      "})",
      "",
    ].join("\n"),
    "virtual-agents/build/mcp/package-browser.jsonc": JSON.stringify(
      packageMcpDefinition({ tools: ["snapshot"] }),
      null,
      2,
    ),
    "expert-squad.jsonc": JSON.stringify(
      {
        schema_version: 1,
        namespace: PROJECT_EXPERT_SQUAD_NAMESPACE,
        id: VIRTUAL_RUNTIME_EXPERT_SQUAD_ID,
        label: "Virtual Runtime",
        description: "Runtime package with virtual-agent resources.",
        version: "2026.07.06",
        readme: "README.md",
        selector: {
          summary: "Use for virtual-agent runtime path tests.",
          selection_guidance: `Call select_expert_squad with profile_id ${VIRTUAL_RUNTIME_EXPERT_SQUAD_ID}.`,
          instructions: "selector.md",
        },
        capability_projection: {
          scheduler: {
            role_base: true,
            built_in_tool_ids: ["select_expert_squad", "skill", "build"],
          },
          agents: {
            build: {
              role_base: true,
              package_tool_refs: [`${VIRTUAL_RUNTIME_EXPERT_SQUAD_ID}/build/virtual-evidence`],
              package_mcp_server_refs: [packageMcpServerRef],
            },
          },
        },
        agents: {
          orchestrator: {
            prompt: "agents/orchestrator/system.md",
          },
        },
        virtual_agents: {
          build: {
            id: "virtual-build",
            label: "Virtual Build",
            prompt: "virtual-agents/build/system.md",
          },
        },
      },
      null,
      2,
    ),
  }
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(packageRoot, relativePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }
  return packageRoot
}

describe("PromptProfileResolver", () => {
  test("loads project package profiles into the catalog", async () => {
    await using project = await tmpdir({ git: true })
    const schedulerPackageMcpServerRef = `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/package-browser`
    const schedulerPackageMcpPromptRef = `${schedulerPackageMcpServerRef}/prompt/inspect`
    const schedulerPackageMcpResourceRef = `${schedulerPackageMcpServerRef}/resource/dom`
    const buildDefaultMcpPromptRef = "default/mcp/package-browser/prompt/inspect"
    const buildDefaultMcpResourceRef = "default/mcp/package-browser/resource/dom"
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      schedulerPackageMcpServerRefs: [schedulerPackageMcpServerRef],
      buildDefaultMcpPromptRefs: [buildDefaultMcpPromptRef],
      buildDefaultMcpResourceRefs: [buildDefaultMcpResourceRef],
      packageMcpDefinition: {
        type: "local",
        command: [process.execPath, path.join(import.meta.dir, "../fixture/package-mcp-server.ts")],
        capabilities: {
          prompts: ["inspect"],
          resources: ["dom"],
        },
      },
    })
    const config = Config.Info.parse({
      prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID },
      mcp: {
        "package-browser": {
          type: "local",
          command: [process.execPath, path.join(import.meta.dir, "../fixture/package-mcp-server.ts")],
        },
      },
    })

    await expect(
      PromptProfileResolver.assertKnownProfileID({
        projectDirectory: project.path,
        profileID: PROJECT_EXPERT_SQUAD_ID,
        config,
      }),
    ).resolves.toBeUndefined()

    const catalog = await PromptProfileResolver.catalog({
      config,
      projectActive: PROJECT_EXPERT_SQUAD_ID,
      sessionOverride: null,
      scope: { kind: "project", directory: project.path },
      defaultSkills: [],
    })
    const profile = catalog.squads.find((entry) => entry.id === PROJECT_EXPERT_SQUAD_ID)

    expect(catalog.active.effective).toBe(PROJECT_EXPERT_SQUAD_ID)
    expect(profile).toMatchObject({
      id: PROJECT_EXPERT_SQUAD_ID,
      label: "Project Replica",
      display_label: "Project Replica",
      display_prefix: undefined,
      built_in: false,
      editable: false,
      capability_profile_id: PROJECT_EXPERT_SQUAD_ID,
      projected_agents: ["build", "general"],
      agents: {},
      virtual_agents: [],
    })
    expect(profile?.agents).not.toHaveProperty("build", "project build overlay")
    expect(profile?.projection_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(profile?.capability_projection.scheduler.built_in_tool_ids).toContain("build")
    expect(profile?.capability_projection.scheduler.package_tool_refs).toEqual([
      `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/source-evidence`,
    ])
    expect(profile?.capability_projection.scheduler.package_mcp_server_refs).toEqual([schedulerPackageMcpServerRef])
    expect(profile?.capability_projection.scheduler.package_mcp_prompt_refs).toEqual([])
    expect(profile?.capability_projection.scheduler.package_mcp_resource_refs).toEqual([])
    expect(profile?.capability_projection.agents.build.package_tool_refs).toEqual([
      `${PROJECT_EXPERT_SQUAD_ID}/build/build-evidence`,
    ])
    expect(profile?.capability_projection.agents.build.default_mcp_prompt_refs).toEqual([buildDefaultMcpPromptRef])
    expect(profile?.capability_projection.agents.build.default_mcp_resource_refs).toEqual([buildDefaultMcpResourceRef])
    expect(Object.keys(profile ?? {}).sort()).toEqual([
      "agents",
      "built_in",
      "capability_profile_id",
      "capability_projection",
      "description",
      "display_label",
      "display_prefix",
      "dynamic_attributes",
      "editable",
      "id",
      "label",
      "projected_agents",
      "projection_hash",
      "readme",
      "selector",
      "source",
      "version",
      "virtual_agents",
    ])

    const capability = await PromptProfileResolver.resolveSchedulerCapability({
      projectDirectory: project.path,
      config,
    })
    expect(capability.packageMcpPromptRefs).toEqual([schedulerPackageMcpPromptRef])
    expect(capability.packageMcpResourceRefs).toEqual([schedulerPackageMcpResourceRef])
  })

  test("composes project package build overlays with default MCP context", { timeout: 0 }, async () => {
    await withPromptProfileResolverInactivityTimeout("composes project package build overlays with default MCP context", 15_000, async (activity) => {
      await using project = await tmpdir({ git: true })
      activity("created temporary project")
      const buildDefaultMcpPromptRef = "default/mcp/package-browser/prompt/inspect"
      const buildDefaultMcpResourceRef = "default/mcp/package-browser/resource/dom"
      await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
        buildDefaultMcpPromptRefs: [buildDefaultMcpPromptRef],
        buildDefaultMcpResourceRefs: [buildDefaultMcpResourceRef],
      })
      activity("wrote project package")
      const config = Config.Info.parse({
        prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID },
        mcp: {
          "package-browser": {
            type: "local",
            command: [process.execPath, packageMcpServerPath],
          },
        },
      })

      const buildPrompt = await PromptProfileResolver.composeAgentPrompt({
        projectDirectory: project.path,
        agentID: "build",
        base: "BASE",
        userAppend: "USER APPEND",
        config,
      })
      activity("composed build prompt")
      expect(buildPrompt).toContain("BASE\n\nproject build overlay\n\n## Projected MCP Context")
      expect(buildPrompt).toContain("package-mcp-prompt::")
      expect(buildPrompt).toContain("package-mcp-resource:")
      expect(buildPrompt.endsWith("USER APPEND")).toBe(true)
    })
  })

  test("composes project package Orchestrator overlay with package MCP context", async () => {
    await using project = await tmpdir({ git: true })
    const schedulerPackageMcpServerRef = `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/package-browser`
    const schedulerPackageMcpPromptRef = `${schedulerPackageMcpServerRef}/prompt/inspect`
    const schedulerPackageMcpResourceRef = `${schedulerPackageMcpServerRef}/resource/dom`
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      schedulerPackageMcpServerRefs: [schedulerPackageMcpServerRef],
      packageMcpDefinition: packageMcpDefinition({
        prompts: ["inspect"],
        resources: ["dom"],
      }),
    })
    const config = Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } })

    const orchestratorPrompt = await PromptProfileResolver.composeAgentPrompt({
      projectDirectory: project.path,
      agentID: "orchestrator",
      base: "BASE",
      userAppend: "USER APPEND",
      config,
    })
    const normalizedOrchestratorPrompt = orchestratorPrompt.replace(/\\\\/g, "/")
    expect(normalizedOrchestratorPrompt).toContain(
      "BASE\n\n# Project Replica\n\nPROJECT_README_ORCHESTRATOR_APPEND_ONLY\n\nproject orchestrator overlay\n\n## Projected MCP Context",
    )
    expect(normalizedOrchestratorPrompt).toContain("package-mcp-prompt::")
    expect(normalizedOrchestratorPrompt).toContain("package-mcp-resource:")
    expect(normalizedOrchestratorPrompt).toContain("agents/orchestrator/mcp")
    expect(orchestratorPrompt.endsWith("USER APPEND")).toBe(true)

    const activeGeneralPrompt = await PromptProfileResolver.composeAgentPrompt({
      projectDirectory: project.path,
      agentID: "general",
      base: "BASE",
      userAppend: "USER APPEND",
      config,
    })
    expect(activeGeneralPrompt).toContain("BASE\n\nproject general overlay")
    expect(activeGeneralPrompt).not.toContain("PROJECT_README_ORCHESTRATOR_APPEND_ONLY")
    expect(activeGeneralPrompt.endsWith("USER APPEND")).toBe(true)

    const generalConfig = Config.Info.parse({ prompt_profile: { active: "general" } })
    const generalPrompt = await PromptProfileResolver.composeAgentPrompt({
      projectDirectory: project.path,
      agentID: "orchestrator",
      base: "BASE",
      config: generalConfig,
    })
    expect(generalPrompt).toContain("# General")
    expect(generalPrompt).not.toContain("# Project Replica")
    expect(generalPrompt).not.toContain("PROJECT_README_ORCHESTRATOR_APPEND_ONLY")
  })

  test("compose prompt preview omits active package context for workers outside the active projection", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path)
    const config = Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } })

    const prompt = await PromptProfileResolver.composeAgentPrompt({
      projectDirectory: project.path,
      agentID: "coding",
      base: "BASE",
      userAppend: "USER APPEND",
      config,
    })

    expect(prompt).toBe("BASE\n\nUSER APPEND")
    expect(prompt).not.toContain("PROJECT_README_ORCHESTRATOR_APPEND_ONLY")
    expect(prompt).not.toContain("project build overlay")
    expect(prompt).not.toContain("## Projected MCP Context")
  })

  test("rejects unknown project profile IDs with project context", async () => {
    await using project = await tmpdir({ git: true })
    const config = Config.Info.parse({ prompt_profile: { active: "missing-profile" } })

    await expect(
      PromptProfileResolver.catalog({
        config,
        projectActive: "missing-profile",
        sessionOverride: null,
        scope: { kind: "project", directory: project.path },
      }),
    ).rejects.toThrow(/Unknown prompt profile "missing-profile"/)
    await expect(
      PromptProfileResolver.assertKnownProfileID({ projectDirectory: project.path, profileID: "missing-profile", config }),
    ).rejects.toThrow(/Unknown prompt profile "missing-profile"/)
  })

  test("rejects project packages that collide with built-in profile IDs", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path, "general")
    const config = Config.Info.parse({ prompt_profile: { active: "general" } })

    await expect(
      PromptProfileResolver.catalog({
        config,
        projectActive: "general",
        sessionOverride: null,
        scope: { kind: "project", directory: project.path },
      }),
    ).rejects.toThrow(/collides with a built-in expert squad id/)
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
    const projectedTools = await PromptProfileResolver.projectOrchestratorTools(rawTools, capability, {
      workflow: pipelineWorkflow,
    })
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

  test("non-general expert squads require an explicitly installed project package", async () => {
    for (const profileID of retiredStaticProfileIDs) {
      await expect(
        PromptProfileResolver.resolveSchedulerCapability({
          config: Config.Info.parse({ prompt_profile: { active: profileID } }),
        }),
      ).rejects.toThrow(`Unknown prompt profile "${profileID}"`)
    }

    await using project = await tmpdir({ git: true })
    await expect(
      PromptProfileResolver.resolveSchedulerCapability({
        projectDirectory: project.path,
        config: Config.Info.parse({ prompt_profile: { active: "frontend-replica" } }),
      }),
    ).rejects.toThrow(`Unknown prompt profile "frontend-replica"`)
    await expect(
      fs.lstat(path.join(project.path, ".opencorvus", "expert-squads", "builtin", "frontend-replica")),
    ).rejects.toMatchObject({ code: "ENOENT" })

    await copyRepositoryExpertSquadPackage(project.path, "frontend-replica")
    const capability = await PromptProfileResolver.resolveSchedulerCapability({
      projectDirectory: project.path,
      config: Config.Info.parse({ prompt_profile: { active: "frontend-replica" } }),
    })

    expect(capability.promptProfileID).toBe("frontend-replica")
    expect(capability.builtIn).toBe(false)
    expect(capability.builtInToolIDs).toContain("build")
    expect(capability.packageToolRefs).toEqual([])
    await expect(
      fs.lstat(path.join(project.path, ".opencorvus", "expert-squads", "builtin", "frontend-replica")),
    ).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
  })

  test("resolves frontend design dynamic attributes from the active expert-squad manifest", async () => {
    const generalAttributes = await PromptProfileResolver.resolveFrontendDesignDynamicAttributes({
      config: Config.Info.parse({ prompt_profile: { active: "general" } }),
    })
    expect(generalAttributes.requireDesignDirectionContract).toBe(false)

    await using project = await tmpdir({ git: true })
    await copyRepositoryExpertSquadPackage(project.path, "frontend-innovate")
    const frontendInnovateAttributes = await PromptProfileResolver.resolveFrontendDesignDynamicAttributes({
      projectDirectory: project.path,
      config: Config.Info.parse({ prompt_profile: { active: "frontend-innovate" } }),
    })
    expect(frontendInnovateAttributes.requireDesignDirectionContract).toBe(true)
  })

  test("active workflow filters profile-declared workflow tools during scheduler projection", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path, "frontend-replica")
    const { tools: rawTools } = createOrchestratorTools({
      taskID: "tsk_direct_workflow_projection",
      agentSessionID: "ses_direct_workflow_projection",
    })
    const capability = await PromptProfileResolver.resolveSchedulerCapability({
      projectDirectory: project.path,
      config: Config.Info.parse({ prompt_profile: { active: "frontend-replica" } }),
    })

    const projectedTools = await PromptProfileResolver.projectOrchestratorTools(rawTools, capability, {
      projectDirectory: project.path,
      workflow: directWorkflow,
    })
    const projectedWorkflowTools = Object.keys(projectedTools)
      .filter((toolID): toolID is OrchestratorWorkflowToolName => WorkflowRegistry.isWorkflowToolName(toolID))
      .sort()
    const expectedWorkflowTools = capability.builtInToolIDs
      .filter((toolID) => WorkflowRegistry.isWorkflowToolName(toolID) && directWorkflow.steps.some((step) => step.tool === toolID))
      .sort()

    expect(projectedWorkflowTools).toEqual(expectedWorkflowTools)
    for (const hidden of [
      "requirements",
      "architect",
      "frontend_design",
      "frontend_research",
      "deep_research",
      "visual_qa",
      "workload_analysis",
      "integrity",
      "fact_check",
      "explore",
    ]) {
      expect(Object.hasOwn(projectedTools, hidden), `direct workflow must not expose ${hidden}`).toBe(false)
    }
    expect(Object.hasOwn(projectedTools, "select_expert_squad")).toBe(true)
    expect(Object.hasOwn(projectedTools, "build")).toBe(true)
    expect(Object.hasOwn(projectedTools, "browser_preview")).toBe(false)
    expect(Object.hasOwn(projectedTools, "bash")).toBe(false)
  })

  test("resolves active project package scheduler package tools without implicit MCP projection", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path)
    const packageToolRef = `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/source-evidence`
    const packageToolProviderName = PromptProfileResolver.packageToolProviderName(packageToolRef)
    const capability = await PromptProfileResolver.resolveSchedulerCapability({
      projectDirectory: project.path,
      config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
    })

    expect(capability.builtIn).toBe(false)
    expect(capability.promptProfileID).toBe(PROJECT_EXPERT_SQUAD_ID)
    expect(capability.builtInToolIDs).toContain("build")
    expect(capability.builtInToolIDs).toContain("select_expert_squad")
    expect(capability.packageToolRefs).toEqual([packageToolRef])
    expect(capability.packageToolProviderNames).toEqual([packageToolProviderName])
    expect(capability.packageMcpToolRefs).toEqual([])
    expect(capability.packageMcpToolProviderNames).toEqual([])
    expect(capability.scheduler.package_tool_refs).toContain(packageToolRef)
    expect(capability.includeMcpTools).toBe(false)

    const { tools: rawTools } = createOrchestratorTools({
      taskID: "tsk_project_projection",
      agentSessionID: "ses_project_projection",
    })
    const projectedTools = await PromptProfileResolver.projectOrchestratorTools(rawTools, capability, {
      projectDirectory: project.path,
      workflow: pipelineWorkflow,
    })
    expect(Object.hasOwn(projectedTools, "build")).toBe(true)
    expect(Object.hasOwn(projectedTools, packageToolProviderName)).toBe(true)
    expect(Object.hasOwn(projectedTools, `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/source-evidence`)).toBe(false)
    expect(Object.hasOwn(projectedTools, "source-evidence")).toBe(false)
    expect(Object.hasOwn(projectedTools, "build-evidence")).toBe(false)
    expect(Object.hasOwn(projectedTools, "package-browser")).toBe(false)
    const packageToolResult = await (projectedTools[packageToolProviderName] as any).execute(
      { label: "unit" },
      {
        toolCallId: "call_project_package_tool",
        opencorvus: {
          sessionID: "ses_project_projection",
          messageID: "msg_project_projection",
          toolCallID: "call_project_package_tool",
        },
      },
    )
    expect(packageToolResult.output).toContain(`source-evidence:orchestrator:unit:${project.path}`)
    expect(packageToolResult.metadata.package_tool_ref).toBe(packageToolRef)
    expect(packageToolResult.metadata.provider_tool_name).toBe(packageToolProviderName)
  })

  test("projects repository opentest selector, scheduler tools, and worker tools", async () => {
    await using project = await tmpdir({ git: true })
    const packageRoot = await copyRepositoryExpertSquadPackage(project.path, OPENTEST_EXPERT_SQUAD_ID)
    const testCaseRoot = path.join(project.path, "cases", "login")
    await fs.mkdir(testCaseRoot, { recursive: true })
    await fs.mkdir(path.join(project.path, ".opencorvus", "opentest", "runs", "batch-2026-07-06", "login-case"), { recursive: true })
    await fs.writeFile(
      path.join(testCaseRoot, "script.ts"),
      [
        "export const steps = [",
        "  async (ctx: { mark_point(params: { name: string; passed: boolean; error?: string }): Promise<void> }) => {",
        '    await ctx.mark_point({ name: "login accepts valid user", passed: true })',
        '    await ctx.mark_point({ name: "renders home", passed: true })',
        "  },",
        "]",
        "",
      ].join("\n"),
    )
    await fs.writeFile(
      path.join(testCaseRoot, "TEST.md"),
      [
        "---",
        "testName: Login regression",
        "description: Covers the primary login path",
        "status: active",
        "testPoints:",
        "  - name: login accepts valid user",
        "  - name: renders home",
        "---",
        "# Login regression",
        "",
      ].join("\n"),
    )
    await fs.writeFile(
      path.join(project.path, ".opencorvus", "opentest", "ctx.d.ts"),
      "interface Ctx { mark_point(params: { name: string; passed: boolean; error?: string }): Promise<void> }\n",
    )
    await fs.writeFile(path.join(project.path, ".opencorvus", "opentest", "runs.db"), "")
    await fs.writeFile(
      path.join(project.path, ".opencorvus", "opentest", "runs", "batch-2026-07-06", "login-case", "result.json"),
      JSON.stringify({ testPath: testCaseRoot, passed: true }, null, 2),
    )
    await fs.writeFile(path.join(project.path, ".opencorvus", "opentest", "acceptance.json"), '{"items":[]}\n')
    await fs.writeFile(
      path.join(project.path, "package.json"),
      JSON.stringify({ scripts: { test: "bun test", "test:e2e": "playwright test" } }, null, 2),
    )

    const generalProjection = await PromptProfileResolver.resolveSkillProjection({
      projectDirectory: project.path,
      config: Config.Info.parse({ prompt_profile: { active: "general" } }),
      defaultSkills: [],
      agentIDs: ["orchestrator"],
    })
    expect(generalProjection.selectorSkillNames).toContain("opentest-expert-squad")
    expect(generalProjection.skills.find((skill) => skill.name === "opentest-expert-squad")?.content).toContain(
      "WuJiang/OpenTest Expert Squad Selector",
    )

    const config = Config.Info.parse({ prompt_profile: { active: OPENTEST_EXPERT_SQUAD_ID } })
    const activeProjection = await PromptProfileResolver.resolveSkillProjection({
      projectDirectory: project.path,
      config,
      defaultSkills: [],
      agentIDs: ["orchestrator", "build", "integrity"],
    })
    expect(activeProjection.selectorSkillNames).toEqual(["opentest-expert-squad"])
    expect(activeProjection.productionSkillNames).toEqual(
      expect.arrayContaining(["opentest-workflow", "software-test-implementation", "software-test-review"]),
    )

    const protocolRef = `${OPENTEST_EXPERT_SQUAD_ID}/shared/opentest-protocol-engine`
    const protocolProviderName = PromptProfileResolver.packageToolProviderName(protocolRef)
    const schedulerCapability = await PromptProfileResolver.resolveSchedulerCapability({
      projectDirectory: project.path,
      config,
    })

    expect(schedulerCapability.promptProfileID).toBe(OPENTEST_EXPERT_SQUAD_ID)
    expect(schedulerCapability.builtInToolIDs).toEqual(
      expect.arrayContaining(["build", "integrity"]),
    )
    for (const unusedTool of ["requirements", "architect", "visual_qa", "fact_check"]) {
      expect(schedulerCapability.builtInToolIDs).not.toContain(unusedTool)
    }
    expect(schedulerCapability.packageToolRefs).toEqual([protocolRef])
    expect(schedulerCapability.packageToolProviderNames).toEqual([protocolProviderName])

    const { tools: rawTools } = createOrchestratorTools({
      taskID: "tsk_opentest_projection",
      agentSessionID: "ses_opentest_projection",
    })
    const schedulerTools = await PromptProfileResolver.projectOrchestratorTools(rawTools, schedulerCapability, {
      projectDirectory: project.path,
      workflow: pipelineWorkflow,
    })
    expect(Object.hasOwn(schedulerTools, "build")).toBe(true)
    expect(Object.hasOwn(schedulerTools, "integrity")).toBe(true)
    expect(Object.hasOwn(schedulerTools, "requirements")).toBe(false)
    expect(Object.hasOwn(schedulerTools, "architect")).toBe(false)
    expect(Object.hasOwn(schedulerTools, "visual_qa")).toBe(false)
    expect(Object.hasOwn(schedulerTools, "fact_check")).toBe(false)
    expect(Object.hasOwn(schedulerTools, protocolProviderName)).toBe(true)
    expect(Object.hasOwn(schedulerTools, protocolRef)).toBe(false)

    const contractResult = await (schedulerTools[protocolProviderName] as any).execute(
      {
        mode: "contract",
      },
      {
        toolCallId: "call_opentest_protocol",
        opencorvus: {
          sessionID: "ses_opentest_projection",
          messageID: "msg_opentest_projection",
          toolCallID: "call_opentest_protocol",
        },
      },
    )
    const contract = JSON.parse(contractResult.output) as {
      contract: {
        protocol: string
        script: {
          required_export: string
          mark_point_callee: string
        }
      }
    }
    expect(contract.contract.protocol).toBe("OpenTest")
    expect(contract.contract.script.required_export).toBe("steps")
    expect(contract.contract.script.mark_point_callee).toBe("ctx.mark_point")
    expect(contractResult.metadata.package_tool_ref).toBe(protocolRef)

    const buildCapability = await PromptProfileResolver.resolveWorkerCapability({
      projectDirectory: project.path,
      agentID: "build",
      config,
    })
    expect(buildCapability.packageToolRefs).toEqual([protocolRef])
    expect(buildCapability.virtualAgent).toMatchObject({
      baseRole: "build",
      virtualAgentID: "opentest-implementer",
      label: "OpenTest Implementer",
      expertSquadID: OPENTEST_EXPERT_SQUAD_ID,
    })

    const workerTools = await PromptProfileResolver.projectWorkerTools(
      { read: { kind: "dummy-read" } },
      buildCapability,
      { projectDirectory: project.path },
    )
    expect(Object.hasOwn(workerTools, "read")).toBe(true)
    expect(Object.hasOwn(workerTools, protocolProviderName)).toBe(true)
    expect(Object.hasOwn(workerTools, protocolRef)).toBe(false)

    const inventoryResult = await (workerTools[protocolProviderName] as any).execute(
      { mode: "inventory", root: ".", max_files: 400 },
      {
        toolCallId: "call_opentest_inventory",
        opencorvus: {
          sessionID: "ses_opentest_worker",
          messageID: "msg_opentest_worker",
          toolCallID: "call_opentest_inventory",
        },
      },
    )
    const inventory = JSON.parse(inventoryResult.output) as {
      test_cases: Array<{
        directory: string
        test_md: string
        script_ts: string | null
        context_contract: string | null
        acceptance: string | null
        run_database: string | null
        run_results: string[]
      }>
      context_files: string[]
      run_results: string[]
      run_databases: string[]
      acceptance_files: string[]
      package_scripts: Array<{ script: string; command: string }>
    }
    expect(inventory.test_cases).toContainEqual(
      expect.objectContaining({
        directory: "cases/login",
        test_md: "cases/login/TEST.md",
        script_ts: "cases/login/script.ts",
        context_contract: ".opencorvus/opentest/ctx.d.ts",
        acceptance: ".opencorvus/opentest/acceptance.json",
        run_database: ".opencorvus/opentest/runs.db",
        run_results: [".opencorvus/opentest/runs/batch-2026-07-06/login-case/result.json"],
      }),
    )
    expect(inventory.context_files).toContain(".opencorvus/opentest/ctx.d.ts")
    expect(inventory.run_results).toContain(".opencorvus/opentest/runs/batch-2026-07-06/login-case/result.json")
    expect(inventory.acceptance_files).toContain(".opencorvus/opentest/acceptance.json")
    expect(inventory.run_databases).toContain(".opencorvus/opentest/runs.db")
    expect(inventory.package_scripts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ script: "test", command: "bun test" }),
        expect.objectContaining({ script: "test:e2e", command: "playwright test" }),
      ]),
    )
    expect(inventoryResult.metadata.package_tool_ref).toBe(protocolRef)

    const validationResult = await (workerTools[protocolProviderName] as any).execute(
      { mode: "validate", test_directory: "cases/login" },
      {
        toolCallId: "call_opentest_validate",
        opencorvus: {
          sessionID: "ses_opentest_worker",
          messageID: "msg_opentest_worker",
          toolCallID: "call_opentest_validate",
        },
      },
    )
    const validation = JSON.parse(validationResult.output) as {
      valid: boolean
      test_points: string[]
      mark_points: string[]
      artifacts: { context_contract: string | null; acceptance: string | null; run_database: string | null; run_results: string[] }
    }
    expect(validation.valid).toBe(true)
    expect(validation.test_points).toEqual(["login accepts valid user", "renders home"])
    expect(validation.mark_points).toEqual(["login accepts valid user", "renders home"])
    expect(validation.artifacts.context_contract).toBe(".opencorvus/opentest/ctx.d.ts")
    expect(validation.artifacts.acceptance).toBe(".opencorvus/opentest/acceptance.json")
    expect(validation.artifacts.run_database).toBe(".opencorvus/opentest/runs.db")
    expect(validation.artifacts.run_results).toEqual([".opencorvus/opentest/runs/batch-2026-07-06/login-case/result.json"])
  })

  test("active virtual worker projection hash follows virtual prompt and package resource content", { timeout: 0 }, async () => {
    await withPromptProfileResolverInactivityTimeout("active virtual worker projection hash", 15_000, async (activity) => {
      await using project = await tmpdir({ git: true })
      activity("created temporary project")
      const packageRoot = await copyRepositoryExpertSquadPackage(project.path, OPENTEST_EXPERT_SQUAD_ID)
      activity("copied opentest package")
      const config = Config.Info.parse({ prompt_profile: { active: OPENTEST_EXPERT_SQUAD_ID } })

      const before = await PromptProfileResolver.resolveWorkerCapability({
        projectDirectory: project.path,
        agentID: "build",
        config,
      })
      activity("resolved initial worker capability")
      expect(before.virtualAgent?.virtualAgentID).toBe("opentest-implementer")
      const catalog = await PromptProfileResolver.catalog({
        config,
        projectActive: OPENTEST_EXPERT_SQUAD_ID,
        sessionOverride: null,
        scope: { kind: "project", directory: project.path },
        agentIDs: ["build", "integrity"],
        defaultSkills: [],
      })
      activity("resolved catalog")
      const skillProjection = await PromptProfileResolver.resolveSkillProjection({
        projectDirectory: project.path,
        agentIDs: ["build", "integrity"],
        config,
        defaultSkills: [],
      })
      activity("resolved skill projection")
      expect(catalog.active_agent_projection.agents.find((agent) => agent.base_role === "build")?.projection_hash).toBe(
        before.virtualAgent?.projectionHash,
      )
      expect(skillProjection.virtualAgents.find((agent) => agent.baseRole === "build")?.projectionHash).toBe(
        before.virtualAgent?.projectionHash,
      )

      await fs.writeFile(
        path.join(packageRoot, "virtual-agents", "build", "system.md"),
        `${before.virtualAgent?.label}\nChanged virtual prompt content.\n`,
      )
      activity("changed virtual prompt")
      const afterVirtualPrompt = await PromptProfileResolver.resolveWorkerCapability({
        projectDirectory: project.path,
        agentID: "build",
        config,
      })
      activity("resolved worker capability after virtual prompt change")
      expect(afterVirtualPrompt.projectionHash).not.toBe(before.projectionHash)
      expect(afterVirtualPrompt.virtualAgent?.projectionHash).not.toBe(before.virtualAgent?.projectionHash)

      await fs.writeFile(
        path.join(packageRoot, "virtual-agents", "build", "skills", "test-implementation", "SKILL.md"),
        "---\nname: software-test-implementation\n---\nChanged package skill content.\n",
      )
      activity("changed package skill")
      const afterSkill = await PromptProfileResolver.resolveWorkerCapability({
        projectDirectory: project.path,
        agentID: "build",
        config,
      })
      activity("resolved worker capability after package skill change")
      expect(afterSkill.projectionHash).not.toBe(afterVirtualPrompt.projectionHash)

      await fs.writeFile(
        path.join(packageRoot, "tools", "opentest-protocol-engine.ts"),
        "export default null\n// changed package tool source\n",
      )
      activity("changed package tool")
      const afterTool = await PromptProfileResolver.resolveWorkerCapability({
        projectDirectory: project.path,
        agentID: "build",
        config,
      })
      activity("resolved worker capability after package tool change")
      expect(afterTool.projectionHash).not.toBe(afterSkill.projectionHash)
    })
  })

  test("active skill projection hash follows projected package skill content and metadata", { timeout: 0 }, async () => {
    await withPromptProfileResolverInactivityTimeout("active skill projection hash", 15_000, async (activity) => {
      await using project = await tmpdir({ git: true })
      activity("created temporary project")
      const packageRoot = await copyRepositoryExpertSquadPackage(project.path, OPENTEST_EXPERT_SQUAD_ID)
      activity("copied opentest package")
      const config = Config.Info.parse({ prompt_profile: { active: OPENTEST_EXPERT_SQUAD_ID } })

      const before = await PromptProfileResolver.resolveSkillProjection({
        projectDirectory: project.path,
        agentIDs: ["build", "integrity"],
        config,
        defaultSkills: [],
      })
      activity("resolved initial skill projection")
      expect(before.projectedSkillNames).toContain("software-test-implementation")

      await fs.writeFile(
        path.join(packageRoot, "virtual-agents", "build", "skills", "test-implementation", "SKILL.md"),
        [
          "---",
          "name: software-test-implementation",
          "description: Changed projected package skill metadata.",
          "required_tools:",
          "  - bash",
          "---",
          "",
          "# Changed Software Test Implementation",
          "",
          "Changed projected package skill body.",
          "",
        ].join("\n"),
      )
      activity("changed projected package skill")

      const after = await PromptProfileResolver.resolveSkillProjection({
        projectDirectory: project.path,
        agentIDs: ["build", "integrity"],
        config,
        defaultSkills: [],
      })
      activity("resolved changed skill projection")
      expect(after.projectionHash).not.toBe(before.projectionHash)
      const changedSkill = after.skills.find((skill) => skill.name === "software-test-implementation")
      expect(changedSkill?.description).toBe("Changed projected package skill metadata.")
      expect(changedSkill?.required_tools).toEqual(["bash"])
      expect(changedSkill?.content).toContain("Changed projected package skill body.")
    })
  })

  test("projects scheduler default tool refs from the runtime tool map", async () => {
    await using project = await tmpdir({ git: true })
    const defaultToolRef = "default/tool/project-index"
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      schedulerDefaultToolRefs: [defaultToolRef],
      schedulerPackageToolRefs: [],
    })
    const capability = await PromptProfileResolver.resolveSchedulerCapability({
      projectDirectory: project.path,
      config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
    })

    expect(capability.defaultToolRefs).toEqual([defaultToolRef])
    expect(capability.defaultToolProviderNames).toEqual(["project-index"])

    const { tools: rawTools } = createOrchestratorTools({
      taskID: "tsk_default_tool_projection",
      agentSessionID: "ses_default_tool_projection",
    })
    const defaultTool = { kind: "default-tool" }
    const projectedTools = await PromptProfileResolver.projectOrchestratorTools(
      { ...rawTools, "project-index": defaultTool },
      capability,
      {
        projectDirectory: project.path,
        workflow: pipelineWorkflow,
      },
    )

    expect(projectedTools["project-index"]).toBe(defaultTool)
    expect(Object.hasOwn(projectedTools, PromptProfileResolver.packageToolProviderName(`${PROJECT_EXPERT_SQUAD_ID}/orchestrator/source-evidence`))).toBe(false)
  })

  test("projects active package MCP tools as scoped runtime providers without global MCP registration", { timeout: 0 }, async () => {
    await withPromptProfileResolverInactivityTimeout("projects active package MCP tools as scoped runtime providers", 15_000, async (activity) => {
      await using project = await tmpdir({ git: true })
      activity("created temporary project")
      const packageMcpServerRef = `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/package-browser`
      const packageMcpToolRef = `${packageMcpServerRef}/tool/snapshot`
      await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
        schedulerPackageMcpServerRefs: [packageMcpServerRef],
        packageMcpDefinition: {
          type: "local",
          command: [process.execPath, path.join(import.meta.dir, "../fixture/package-mcp-server.ts")],
          capabilities: { tools: ["snapshot"] },
        },
      })
      activity("wrote project package")
      const packageMcpProviderName = PromptProfileResolver.packageMcpToolProviderName(packageMcpToolRef)
      const capability = await PromptProfileResolver.resolveSchedulerCapability({
        projectDirectory: project.path,
        config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
      })
      activity("resolved scheduler capability")

      expect(capability.packageMcpToolRefs).toEqual([packageMcpToolRef])
      expect(capability.packageMcpToolProviderNames).toEqual([packageMcpProviderName])
      expect(capability.includeMcpTools).toBe(false)

      const { tools: rawTools } = createOrchestratorTools({
        taskID: "tsk_project_mcp_projection",
        agentSessionID: "ses_project_mcp_projection",
      })
      const projectedTools = await PromptProfileResolver.projectOrchestratorTools(rawTools, capability, {
        projectDirectory: project.path,
        workflow: pipelineWorkflow,
      })
      activity("projected orchestrator tools")

      expect(Object.hasOwn(projectedTools, packageMcpProviderName)).toBe(true)
      expect(Object.hasOwn(projectedTools, "package-browser_snapshot")).toBe(false)

      const packageMcpResult = await Instance.provide({
        directory: project.path,
        fn: () =>
          (projectedTools[packageMcpProviderName] as any).execute(
            { label: "active" },
            {
              toolCallId: "call_project_package_mcp_tool",
              opencorvus: {
                projectID: "prj_project_mcp_projection",
                sessionID: "ses_project_mcp_projection",
                messageID: "msg_project_mcp_projection",
                toolCallID: "call_project_package_mcp_tool",
              },
            },
          ),
      })
      activity("executed package MCP provider")
      expect(packageMcpResult.output).toContain("package-mcp-snapshot:active:")
      expect(packageMcpResult.metadata.package_mcp_tool_ref).toBe(packageMcpToolRef)
      expect(packageMcpResult.metadata.provider_tool_name).toBe(packageMcpProviderName)
    })
  })

  test("rejects duplicate package MCP projection through server and typed refs", async () => {
    await using project = await tmpdir({ git: true })
    const packageMcpServerRef = `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/package-browser`
    const packageMcpToolRef = `${packageMcpServerRef}/tool/snapshot`
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      schedulerPackageMcpServerRefs: [packageMcpServerRef],
      schedulerPackageMcpToolRefs: [packageMcpToolRef],
      packageMcpDefinition: {
        type: "local",
        command: [process.execPath, path.join(import.meta.dir, "../fixture/package-mcp-server.ts")],
        capabilities: { tools: ["snapshot"] },
      },
    })

    await expect(
      PromptProfileResolver.resolveSchedulerCapability({
        projectDirectory: project.path,
        config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
      }),
    ).rejects.toThrow(/already mounted by package_mcp_server_refs/)
  })

  test("projects scheduler default MCP tool refs from the effective config", { timeout: 0 }, async () => {
    await withPromptProfileResolverInactivityTimeout("projects scheduler default MCP tool refs from the effective config", 15_000, async (activity) => {
      await using project = await tmpdir({ git: true })
      activity("created temporary project")
      const defaultMcpToolRef = "default/mcp/package-browser/tool/snapshot"
      await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
        schedulerDefaultMcpToolRefs: [defaultMcpToolRef],
        schedulerPackageToolRefs: [],
      })
      activity("wrote project package")
      const defaultMcpProviderName = PromptProfileResolver.defaultMcpToolProviderName(defaultMcpToolRef)
      const capability = await PromptProfileResolver.resolveSchedulerCapability({
        projectDirectory: project.path,
        config: Config.Info.parse({
          prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID },
          mcp: {
            "package-browser": {
              type: "local",
              command: [process.execPath, path.join(import.meta.dir, "../fixture/package-mcp-server.ts")],
            },
          },
        }),
      })
      activity("resolved scheduler capability")

      expect(capability.defaultMcpToolRefs).toEqual([defaultMcpToolRef])
      expect(capability.defaultMcpToolProviderNames).toEqual([defaultMcpProviderName])

      const { tools: rawTools } = createOrchestratorTools({
        taskID: "tsk_default_mcp_projection",
        agentSessionID: "ses_default_mcp_projection",
      })
      const projectedTools = await PromptProfileResolver.projectOrchestratorTools(rawTools, capability, {
        projectDirectory: project.path,
        workflow: pipelineWorkflow,
      })
      activity("projected orchestrator tools")

      expect(Object.hasOwn(projectedTools, defaultMcpProviderName)).toBe(true)
      const defaultMcpResult = await Instance.provide({
        directory: project.path,
        fn: () =>
          (projectedTools[defaultMcpProviderName] as any).execute(
            { label: "default" },
            {
              toolCallId: "call_default_mcp_tool",
              opencorvus: {
                projectID: "prj_default_mcp_projection",
                sessionID: "ses_default_mcp_projection",
                messageID: "msg_default_mcp_projection",
                toolCallID: "call_default_mcp_tool",
              },
            },
          ),
      })
      activity("executed default MCP provider")
      expect(defaultMcpResult.output).toContain("package-mcp-snapshot:default:")
      expect(defaultMcpResult.metadata.default_mcp_tool_ref).toBe(defaultMcpToolRef)
      expect(defaultMcpResult.metadata.provider_tool_name).toBe(defaultMcpProviderName)
    })
  })

  test("projects active package MCP prompts and resources as scoped runtime providers", async () => {
    await using project = await tmpdir({ git: true })
    const packageMcpServerRef = `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/package-browser`
    const packageMcpPromptRef = `${packageMcpServerRef}/prompt/inspect`
    const packageMcpResourceRef = `${packageMcpServerRef}/resource/dom`
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      schedulerPackageMcpServerRefs: [packageMcpServerRef],
      packageMcpDefinition: {
        type: "local",
        command: [process.execPath, path.join(import.meta.dir, "../fixture/package-mcp-server.ts")],
        capabilities: {
          prompts: ["inspect"],
          resources: ["dom"],
        },
      },
    })
    const promptProviderName = PromptProfileResolver.packageMcpPromptProviderName(packageMcpPromptRef)
    const resourceProviderName = PromptProfileResolver.packageMcpResourceProviderName(packageMcpResourceRef)
    const capability = await PromptProfileResolver.resolveSchedulerCapability({
      projectDirectory: project.path,
      config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
    })

    expect(capability.packageMcpPromptRefs).toEqual([packageMcpPromptRef])
    expect(capability.packageMcpPromptProviderNames).toEqual([promptProviderName])
    expect(capability.packageMcpResourceRefs).toEqual([packageMcpResourceRef])
    expect(capability.packageMcpResourceProviderNames).toEqual([resourceProviderName])

    const projectedPrompts = await PromptProfileResolver.projectSchedulerMcpPrompts(capability, {
      projectDirectory: project.path,
    })
    const projectedResources = await PromptProfileResolver.projectSchedulerMcpResources(capability, {
      projectDirectory: project.path,
    })

    expect(projectedPrompts[promptProviderName]?.name).toBe("inspect")
    expect(projectedResources[resourceProviderName]?.name).toBe("dom")

    const promptResult = await projectedPrompts[promptProviderName]!.get({ label: "active" })
    const resourceResult = await projectedResources[resourceProviderName]!.read()
    const promptText = JSON.stringify(promptResult).replace(/\\\\/g, "/")
    const resourceText = JSON.stringify(resourceResult).replace(/\\\\/g, "/")

    expect(promptText).toContain("package-mcp-prompt:active:")
    expect(promptText).toContain("agents/orchestrator/mcp")
    expect(resourceText).toContain("package-mcp-resource:")
    expect(resourceText).toContain("agents/orchestrator/mcp")
  })

  test("composes active package MCP prompt and resource context", async () => {
    await using project = await tmpdir({ git: true })
    const packageMcpServerRef = `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/package-browser`
    const packageMcpPromptRef = `${packageMcpServerRef}/prompt/inspect`
    const packageMcpResourceRef = `${packageMcpServerRef}/resource/dom`
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      schedulerPackageMcpServerRefs: [packageMcpServerRef],
      packageMcpDefinition: packageMcpDefinition({
        prompts: ["inspect"],
        resources: ["dom"],
      }),
    })
    const promptProviderName = PromptProfileResolver.packageMcpPromptProviderName(packageMcpPromptRef)
    const resourceProviderName = PromptProfileResolver.packageMcpResourceProviderName(packageMcpResourceRef)

    const composedPrompt = await PromptProfileResolver.composeAgentPrompt({
      projectDirectory: project.path,
      agentID: "orchestrator",
      base: "BASE",
      config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
    })
    const normalizedComposedPrompt = composedPrompt.replace(/\\\\/g, "/")
    expect(normalizedComposedPrompt).toContain("## Projected MCP Context")
    expect(normalizedComposedPrompt).toContain(promptProviderName)
    expect(normalizedComposedPrompt).toContain(resourceProviderName)
    expect(normalizedComposedPrompt).toContain("package-mcp-prompt::")
    expect(normalizedComposedPrompt).toContain("package-mcp-resource:")
    expect(normalizedComposedPrompt).toContain("agents/orchestrator/mcp")
    expect(normalizedComposedPrompt).not.toContain("\"blob\"")
    expect(normalizedComposedPrompt).not.toContain("\"_meta\"")
  })

  test("keeps active package MCP prompts and resources out of global MCP registration", async () => {
    await using project = await tmpdir({ git: true })
    const packageMcpServerRef = `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/package-browser`
    const packageMcpPromptRef = `${packageMcpServerRef}/prompt/inspect`
    const packageMcpResourceRef = `${packageMcpServerRef}/resource/dom`
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      schedulerPackageMcpServerRefs: [packageMcpServerRef],
      packageMcpDefinition: packageMcpDefinition({
        prompts: ["inspect"],
        resources: ["dom"],
      }),
    })
    const promptProviderName = PromptProfileResolver.packageMcpPromptProviderName(packageMcpPromptRef)
    const resourceProviderName = PromptProfileResolver.packageMcpResourceProviderName(packageMcpResourceRef)

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        expect(Object.keys(await MCP.prompts())).not.toContain(promptProviderName)
        expect(Object.keys(await MCP.resources())).not.toContain(resourceProviderName)
        expect((await MCP.serverPrompts()).map((prompt) => prompt.key)).not.toContain(promptProviderName)
        expect((await MCP.serverResources()).map((resource) => resource.key)).not.toContain(resourceProviderName)
      },
    })
  })

  test("rejects projected package MCP prompt image content before prompt composition", async () => {
    await using project = await tmpdir({ git: true })
    const packageMcpServerRef = `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/package-browser`
    const packageMcpPromptRef = `${packageMcpServerRef}/prompt/image`
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      schedulerPackageMcpServerRefs: [packageMcpServerRef],
      packageMcpDefinition: {
        type: "local",
        command: [process.execPath, path.join(import.meta.dir, "../fixture/package-mcp-server.ts")],
        capabilities: {
          prompts: ["image"],
        },
      },
    })

    await expect(
      PromptProfileResolver.composeAgentPrompt({
        projectDirectory: project.path,
        agentID: "orchestrator",
        base: "BASE",
        config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
      }),
    ).rejects.toThrow(/MCP prompt .*image.*contains image content/)
  })

  test("rejects projected package MCP prompt audio content before prompt composition", async () => {
    await using project = await tmpdir({ git: true })

    await expect(
      composeSchedulerPromptWithPackageMcp({
        projectPath: project.path,
        promptName: "audio",
      }),
    ).rejects.toThrow(/MCP prompt .*audio.*contains audio content/)
  })

  test("projects safe package MCP resource_link metadata", async () => {
    await using project = await tmpdir({ git: true })

    const prompt = await composeSchedulerPromptWithPackageMcp({
      projectPath: project.path,
      promptName: "resource-link",
    })

    expect(prompt).toContain('"type": "resource_link"')
    expect(prompt).toContain('"description": "Safe linked metadata"')
    expect(prompt).toContain('"annotations"')
    expect(prompt).toContain('"icons"')
    expect(prompt).toContain('"src": "https://example.test/icon.png"')
    expect(prompt).not.toContain('"_meta"')
    expect(prompt).not.toContain("data:image/png;base64")
  })

  test("rejects projected package MCP _meta before prompt composition", async () => {
    await using project = await tmpdir({ git: true })

    await expect(
      composeSchedulerPromptWithPackageMcp({
        projectPath: project.path,
        promptName: "meta-text",
      }),
    ).rejects.toThrow(/MCP _meta/)
  })

  for (const vector of [
    {
      name: "required prompt text type",
      promptName: "text-number",
      error: /content\.text must be a string/,
    },
    {
      name: "required resource text type",
      resourceName: "dom-text-number",
      error: /contents\[0\]\.text must be a string/,
    },
    {
      name: "optional resource link description type",
      promptName: "resource-link-description-number",
      error: /content\.description must be a string/,
    },
    {
      name: "optional annotation lastModified type",
      promptName: "resource-link-annotation-last-modified-number",
      error: /content\.annotations\.lastModified must be a string/,
    },
    {
      name: "icon src type",
      promptName: "resource-link-icon-src-number",
      error: /content\.icons\[0\]\.src must be a string/,
    },
    {
      name: "prompt text unknown field",
      promptName: "text-extra-field",
      error: /content contains unsupported field "secret"/,
    },
    {
      name: "embedded resource unknown field",
      promptName: "resource-extra-field",
      error: /content\.resource contains unsupported field "secret"/,
    },
    {
      name: "resource read unknown field",
      resourceName: "dom-extra-field",
      error: /contents\[0\] contains unsupported field "secret"/,
    },
    {
      name: "annotation unknown field",
      promptName: "resource-link-annotation-extra-field",
      error: /content\.annotations contains unsupported field "secret"/,
    },
    {
      name: "icon unknown field",
      promptName: "resource-link-icon-extra-field",
      error: /content\.icons\[0\] contains unsupported field "secret"/,
    },
    {
      name: "unknown prompt content type",
      promptName: "video",
      error: /unsupported MCP content type "video"/,
    },
  ] satisfies readonly Array<{ name: string; promptName?: string; resourceName?: string; error: RegExp }>) {
    test(`rejects projected package MCP ${vector.name} before prompt composition`, async () => {
      await using project = await tmpdir({ git: true })

      await expect(
        composeSchedulerPromptWithPackageMcp({
          projectPath: project.path,
          promptName: vector.promptName,
          resourceName: vector.resourceName,
        }),
      ).rejects.toThrow(vector.error)
    })
  }

  test("rejects projected package MCP inline base64 text before prompt composition", async () => {
    await using project = await tmpdir({ git: true })

    await expect(
      composeSchedulerPromptWithPackageMcp({
        projectPath: project.path,
        promptName: "data-text",
      }),
    ).rejects.toThrow(/refusing inline base64 data URL/)
  })

  test("rejects projected package MCP inline base64 embedded resource text before prompt composition", async () => {
    await using project = await tmpdir({ git: true })

    await expect(
      composeSchedulerPromptWithPackageMcp({
        projectPath: project.path,
        promptName: "resource-data-text",
      }),
    ).rejects.toThrow(/refusing inline base64 data URL/)
  })

  test("rejects projected package MCP inline base64 resource_link fields before prompt composition", async () => {
    await using project = await tmpdir({ git: true })

    await expect(
      composeSchedulerPromptWithPackageMcp({
        projectPath: project.path,
        promptName: "resource-link-data-uri",
      }),
    ).rejects.toThrow(/refusing inline base64 data URL/)
  })

  test("rejects projected package MCP inline base64 optional resource_link metadata before prompt composition", async () => {
    await using project = await tmpdir({ git: true })

    await expect(
      composeSchedulerPromptWithPackageMcp({
        projectPath: project.path,
        promptName: "resource-link-description-data-uri",
      }),
    ).rejects.toThrow(/refusing inline base64 data URL/)
  })

  test("rejects projected package MCP resource blob content before prompt composition", async () => {
    await using project = await tmpdir({ git: true })
    const packageMcpServerRef = `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/package-browser`
    const packageMcpResourceRef = `${packageMcpServerRef}/resource/dom-binary`
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      schedulerPackageMcpServerRefs: [packageMcpServerRef],
      packageMcpDefinition: {
        type: "local",
        command: [process.execPath, path.join(import.meta.dir, "../fixture/package-mcp-server.ts")],
        capabilities: {
          resources: ["dom-binary"],
        },
      },
    })

    await expect(
      PromptProfileResolver.composeAgentPrompt({
        projectDirectory: project.path,
        agentID: "orchestrator",
        base: "BASE",
        config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
      }),
    ).rejects.toThrow(/MCP resource .*dom-binary.*binary blob content/)
  })

  test("rejects projected package MCP inline base64 resource text before prompt composition", async () => {
    await using project = await tmpdir({ git: true })

    await expect(
      composeSchedulerPromptWithPackageMcp({
        projectPath: project.path,
        resourceName: "dom-data-text",
      }),
    ).rejects.toThrow(/refusing inline base64 data URL/)
  })

  for (const vector of [
    {
      name: "prompt text",
      promptName: "raw-data-text",
    },
    {
      name: "embedded resource text",
      promptName: "resource-raw-data-text",
    },
    {
      name: "resource_link metadata",
      promptName: "resource-link-description-raw-data",
    },
    {
      name: "resource read text",
      resourceName: "dom-raw-data-text",
    },
  ] satisfies readonly Array<{ name: string; promptName?: string; resourceName?: string }>) {
    test(`rejects projected package MCP raw base64 ${vector.name} before prompt composition`, async () => {
      await using project = await tmpdir({ git: true })

      await expect(
        composeSchedulerPromptWithPackageMcp({
          projectPath: project.path,
          promptName: vector.promptName,
          resourceName: vector.resourceName,
        }),
      ).rejects.toThrow(/refusing raw base64 binary payload/)
    })
  }

  test("projects worker default MCP prompts and resources from the effective config", async () => {
    await using project = await tmpdir({ git: true })
    const defaultMcpPromptRef = "default/mcp/package-browser/prompt/inspect"
    const defaultMcpResourceRef = "default/mcp/package-browser/resource/dom"
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      buildDefaultMcpPromptRefs: [defaultMcpPromptRef],
      buildDefaultMcpResourceRefs: [defaultMcpResourceRef],
      buildPackageToolRefs: [],
    })
    const promptProviderName = PromptProfileResolver.defaultMcpPromptProviderName(defaultMcpPromptRef)
    const resourceProviderName = PromptProfileResolver.defaultMcpResourceProviderName(defaultMcpResourceRef)
    const config = Config.Info.parse({
      prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID },
      mcp: {
        "package-browser": {
          type: "local",
          command: [process.execPath, path.join(import.meta.dir, "../fixture/package-mcp-server.ts")],
        },
      },
    })
    const capability = await PromptProfileResolver.resolveWorkerCapability({
      projectDirectory: project.path,
      agentID: "build",
      config,
    })

    expect(capability.defaultMcpPromptRefs).toEqual([defaultMcpPromptRef])
    expect(capability.defaultMcpPromptProviderNames).toEqual([promptProviderName])
    expect(capability.defaultMcpResourceRefs).toEqual([defaultMcpResourceRef])
    expect(capability.defaultMcpResourceProviderNames).toEqual([resourceProviderName])

    const projectedPrompts = await PromptProfileResolver.projectWorkerMcpPrompts(capability, {
      projectDirectory: project.path,
    })
    const projectedResources = await PromptProfileResolver.projectWorkerMcpResources(capability, {
      projectDirectory: project.path,
    })

    expect(projectedPrompts[promptProviderName]?.name).toBe("inspect")
    expect(projectedResources[resourceProviderName]?.name).toBe("dom")

    const promptResult = await projectedPrompts[promptProviderName]!.get({ label: "worker" })
    const resourceResult = await projectedResources[resourceProviderName]!.read()
    const promptText = JSON.stringify(promptResult).replace(/\\\\/g, "/")
    const resourceText = JSON.stringify(resourceResult).replace(/\\\\/g, "/")
    const normalizedProjectPath = project.path.replace(/\\/g, "/")

    expect(promptText).toContain("package-mcp-prompt:worker:")
    expect(promptText).toContain(normalizedProjectPath)
    expect(resourceText).toContain("package-mcp-resource:")
    expect(resourceText).toContain(normalizedProjectPath)
  })

  test("composes worker default MCP prompt and resource context", async () => {
    await using project = await tmpdir({ git: true })
    const defaultMcpPromptRef = "default/mcp/package-browser/prompt/inspect"
    const defaultMcpResourceRef = "default/mcp/package-browser/resource/dom"
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      buildDefaultMcpPromptRefs: [defaultMcpPromptRef],
      buildDefaultMcpResourceRefs: [defaultMcpResourceRef],
      buildPackageToolRefs: [],
    })
    const promptProviderName = PromptProfileResolver.defaultMcpPromptProviderName(defaultMcpPromptRef)
    const resourceProviderName = PromptProfileResolver.defaultMcpResourceProviderName(defaultMcpResourceRef)
    const config = Config.Info.parse({
      prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID },
      mcp: {
        "package-browser": {
          type: "local",
          command: [process.execPath, packageMcpServerPath],
        },
      },
    })
    const normalizedProjectPath = project.path.replace(/\\/g, "/")

    const composedPrompt = await PromptProfileResolver.composeAgentPrompt({
      projectDirectory: project.path,
      agentID: "build",
      base: "BASE",
      config,
    })
    const normalizedComposedPrompt = composedPrompt.replace(/\\\\/g, "/")
    expect(normalizedComposedPrompt).toContain("BASE\n\nproject build overlay\n\n## Projected MCP Context")
    expect(normalizedComposedPrompt).toContain(promptProviderName)
    expect(normalizedComposedPrompt).toContain(resourceProviderName)
    expect(normalizedComposedPrompt).toContain("package-mcp-prompt::")
    expect(normalizedComposedPrompt).toContain("package-mcp-resource:")
    expect(normalizedComposedPrompt).toContain(normalizedProjectPath)
  })

  test("resolves active project package worker package tools from agent projection", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path)
    const packageToolRef = `${PROJECT_EXPERT_SQUAD_ID}/build/build-evidence`
    const packageToolProviderName = PromptProfileResolver.packageToolProviderName(packageToolRef)
    const capability = await PromptProfileResolver.resolveWorkerCapability({
      projectDirectory: project.path,
      agentID: "build",
      config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
    })

    expect(capability.promptProfileID).toBe(PROJECT_EXPERT_SQUAD_ID)
    expect(capability.agentID).toBe("build")
    expect(capability.builtInToolIDs).toContain("read")
    expect(capability.packageToolRefs).toEqual([packageToolRef])
    expect(capability.packageToolProviderNames).toEqual([packageToolProviderName])
    expect(capability.includeMcpTools).toBe(false)

    const projectedTools = await PromptProfileResolver.projectWorkerTools(
      {
        read: { kind: "dummy" },
        complete_task: { kind: "orchestrator-only" },
        unreferenced_sidecar: { kind: "ordinary-worker-extra" },
      },
      capability,
      { projectDirectory: project.path },
    )

    expect(Object.hasOwn(projectedTools, "read")).toBe(true)
    expect(Object.hasOwn(projectedTools, "complete_task")).toBe(false)
    expect(Object.hasOwn(projectedTools, "unreferenced_sidecar")).toBe(false)
    expect(Object.hasOwn(projectedTools, packageToolProviderName)).toBe(true)
    const packageToolResult = await (projectedTools[packageToolProviderName] as any).execute(
      {},
      {
        toolCallId: "call_project_worker_package_tool",
        opencorvus: {
          sessionID: "ses_project_worker_projection",
          messageID: "msg_project_worker_projection",
          toolCallID: "call_project_worker_package_tool",
        },
      },
    )
    expect(packageToolResult.output).toContain(`build-evidence:build:${project.path}`)
    expect(packageToolResult.metadata.package_tool_ref).toBe(packageToolRef)
    expect(packageToolResult.metadata.provider_tool_name).toBe(packageToolProviderName)
  })

  test("projects declared stage-owned worker tools without exposing undeclared sidecars", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path)
    const packageToolRef = `${PROJECT_EXPERT_SQUAD_ID}/build/build-evidence`
    const packageToolProviderName = PromptProfileResolver.packageToolProviderName(packageToolRef)
    const capability = await PromptProfileResolver.resolveWorkerCapability({
      projectDirectory: project.path,
      agentID: "build",
      config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
    })
    const reportTool = { kind: "stage-terminal" }
    const updateTool = { kind: "stage-update" }
    const sidecarTool = { kind: "ordinary-worker-extra" }

    const projectedTools = await PromptProfileResolver.projectWorkerTools(
      {
        read: { kind: "dummy" },
        report_build_result: reportTool,
        update_build_report: updateTool,
        unreferenced_sidecar: sidecarTool,
      },
      capability,
      {
        projectDirectory: project.path,
        stageOwnedToolIDs: ["report_build_result", "update_build_report"],
      },
    )

    expect(projectedTools.report_build_result).toBe(reportTool)
    expect(projectedTools.update_build_report).toBe(updateTool)
    expect(Object.hasOwn(projectedTools, "unreferenced_sidecar")).toBe(false)
    expect(Object.hasOwn(projectedTools, packageToolProviderName)).toBe(true)
  })

  test("rejects stage-owned worker tool declarations missing from the runtime map", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path)
    const capability = await PromptProfileResolver.resolveWorkerCapability({
      projectDirectory: project.path,
      agentID: "build",
      config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
    })

    await expect(
      PromptProfileResolver.projectWorkerTools({}, capability, {
        projectDirectory: project.path,
        stageOwnedToolIDs: ["submit_missing"],
      }),
    ).rejects.toThrow(/stage-owned worker tool "submit_missing" is not registered/)
  })

  test("projects frontend replica research and design stage-owned terminal tools from the real package", async () => {
    await using project = await tmpdir({ git: true })
    await copyRepositoryExpertSquadPackage(project.path, "frontend-replica")
    const config = Config.Info.parse({ prompt_profile: { active: "frontend-replica" } })

    const researchCapability = await PromptProfileResolver.resolveWorkerCapability({
      projectDirectory: project.path,
      agentID: "frontend-research",
      config,
    })
    const submitResearchBrief = { kind: "research-terminal" }
    const updateResearchScope = { kind: "research-update" }
    const researchProjectedTools = await PromptProfileResolver.projectWorkerTools(
      {
        submit_research_brief: submitResearchBrief,
        update_research_scope: updateResearchScope,
        unreferenced_sidecar: { kind: "ordinary-worker-extra" },
      },
      researchCapability,
      {
        projectDirectory: project.path,
        stageOwnedToolIDs: ["submit_research_brief", "update_research_scope"],
      },
    )

    expect(researchCapability.promptProfileID).toBe("frontend-replica")
    expect(researchCapability.agentID).toBe("frontend-research")
    expect(researchProjectedTools.submit_research_brief).toBe(submitResearchBrief)
    expect(researchProjectedTools.update_research_scope).toBe(updateResearchScope)
    expect(Object.hasOwn(researchProjectedTools, "unreferenced_sidecar")).toBe(false)

    const designCapability = await PromptProfileResolver.resolveWorkerCapability({
      projectDirectory: project.path,
      agentID: "frontend-design",
      config,
    })
    const submitFrontendTemplate = { kind: "design-terminal" }
    const updateFrontendBasics = { kind: "design-update" }
    const designProjectedTools = await PromptProfileResolver.projectWorkerTools(
      {
        read: { kind: "design-context" },
        submit_frontend_template: submitFrontendTemplate,
        update_frontend_basics: updateFrontendBasics,
        unreferenced_sidecar: { kind: "ordinary-worker-extra" },
      },
      designCapability,
      {
        projectDirectory: project.path,
        stageOwnedToolIDs: ["submit_frontend_template", "update_frontend_basics"],
      },
    )

    expect(designCapability.promptProfileID).toBe("frontend-replica")
    expect(designCapability.agentID).toBe("frontend-design")
    expect(Object.hasOwn(designProjectedTools, "read")).toBe(true)
    expect(designProjectedTools.submit_frontend_template).toBe(submitFrontendTemplate)
    expect(designProjectedTools.update_frontend_basics).toBe(updateFrontendBasics)
    expect(Object.hasOwn(designProjectedTools, "unreferenced_sidecar")).toBe(false)
  })

  test("projects worker default tool refs from the runtime tool map", async () => {
    await using project = await tmpdir({ git: true })
    const defaultToolRef = "default/tool/worker-index"
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      buildDefaultToolRefs: [defaultToolRef],
      buildPackageToolRefs: [],
    })
    const capability = await PromptProfileResolver.resolveWorkerCapability({
      projectDirectory: project.path,
      agentID: "build",
      config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
    })
    const defaultTool = { kind: "worker-default-tool" }

    const projectedTools = await PromptProfileResolver.projectWorkerTools(
      {
        read: { kind: "dummy" },
        "worker-index": defaultTool,
      },
      capability,
      { projectDirectory: project.path },
    )

    expect(capability.defaultToolRefs).toEqual([defaultToolRef])
    expect(projectedTools["worker-index"]).toBe(defaultTool)
    expect(Object.hasOwn(projectedTools, PromptProfileResolver.packageToolProviderName(`${PROJECT_EXPERT_SQUAD_ID}/build/build-evidence`))).toBe(false)
  })

  test("projects active package worker MCP tools as scoped runtime providers", async () => {
    await using project = await tmpdir({ git: true })
    const packageMcpServerRef = `${PROJECT_EXPERT_SQUAD_ID}/build/package-browser`
    const packageMcpToolRef = `${packageMcpServerRef}/tool/snapshot`
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      buildPackageMcpServerRefs: [packageMcpServerRef],
      packageMcpDefinition: {
        type: "local",
        command: [process.execPath, path.join(import.meta.dir, "../fixture/package-mcp-server.ts")],
        capabilities: { tools: ["snapshot"] },
      },
    })
    const packageMcpProviderName = PromptProfileResolver.packageMcpToolProviderName(packageMcpToolRef)
    const capability = await PromptProfileResolver.resolveWorkerCapability({
      projectDirectory: project.path,
      agentID: "build",
      config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
    })

    expect(capability.packageMcpToolRefs).toEqual([packageMcpToolRef])
    expect(capability.packageMcpToolProviderNames).toEqual([packageMcpProviderName])
    expect(capability.includeMcpTools).toBe(false)

    const projectedTools = await PromptProfileResolver.projectWorkerTools(
      {
        read: { kind: "dummy" },
        complete_task: { kind: "orchestrator-only" },
      },
      capability,
      { projectDirectory: project.path },
    )

    expect(Object.hasOwn(projectedTools, "read")).toBe(true)
    expect(Object.hasOwn(projectedTools, "complete_task")).toBe(false)
    expect(Object.hasOwn(projectedTools, packageMcpProviderName)).toBe(true)
    expect(Object.hasOwn(projectedTools, "package-browser_snapshot")).toBe(false)
  })

  test("projects virtual-agent package tools and MCP providers from the virtual-agent resource root", async () => {
    await using project = await tmpdir({ git: true })
    await writeVirtualAgentRuntimePackage(project.path)
    const packageToolRef = `${VIRTUAL_RUNTIME_EXPERT_SQUAD_ID}/build/virtual-evidence`
    const packageMcpToolRef = `${VIRTUAL_RUNTIME_EXPERT_SQUAD_ID}/build/package-browser/tool/snapshot`
    const packageToolProviderName = PromptProfileResolver.packageToolProviderName(packageToolRef)
    const packageMcpProviderName = PromptProfileResolver.packageMcpToolProviderName(packageMcpToolRef)

    const capability = await PromptProfileResolver.resolveWorkerCapability({
      projectDirectory: project.path,
      agentID: "build",
      config: Config.Info.parse({ prompt_profile: { active: VIRTUAL_RUNTIME_EXPERT_SQUAD_ID } }),
    })

    expect(capability.virtualAgent).toMatchObject({
      baseRole: "build",
      virtualAgentID: "virtual-build",
      expertSquadID: VIRTUAL_RUNTIME_EXPERT_SQUAD_ID,
    })
    expect(capability.packageToolRefs).toEqual([packageToolRef])
    expect(capability.packageMcpToolRefs).toEqual([packageMcpToolRef])

    const projectedTools = await PromptProfileResolver.projectWorkerTools(
      { read: { kind: "dummy" } },
      capability,
      { projectDirectory: project.path },
    )

    expect(Object.hasOwn(projectedTools, packageToolProviderName)).toBe(true)
    expect(Object.hasOwn(projectedTools, packageMcpProviderName)).toBe(true)
  })

  test("executes active package worker MCP tool providers in project scope", async () => {
    await using project = await tmpdir({ git: true })
    const packageMcpServerRef = `${PROJECT_EXPERT_SQUAD_ID}/build/package-browser`
    const packageMcpToolRef = `${packageMcpServerRef}/tool/snapshot`
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      buildPackageMcpServerRefs: [packageMcpServerRef],
      packageMcpDefinition: {
        type: "local",
        command: [process.execPath, packageMcpServerPath],
        capabilities: { tools: ["snapshot"] },
      },
    })
    const packageMcpProviderName = PromptProfileResolver.packageMcpToolProviderName(packageMcpToolRef)
    const capability = await PromptProfileResolver.resolveWorkerCapability({
      projectDirectory: project.path,
      agentID: "build",
      config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
    })
    const projectedTools = await PromptProfileResolver.projectWorkerTools(
      {
        read: { kind: "dummy" },
      },
      capability,
      { projectDirectory: project.path },
    )

    const packageMcpResult = await Instance.provide({
      directory: project.path,
      fn: () =>
        (projectedTools[packageMcpProviderName] as any).execute(
          { label: "worker" },
          {
            toolCallId: "call_project_worker_package_mcp_tool",
            opencorvus: {
              projectID: "prj_project_worker_mcp_projection",
              sessionID: "ses_project_worker_mcp_projection",
              messageID: "msg_project_worker_mcp_projection",
              toolCallID: "call_project_worker_package_mcp_tool",
            },
          },
        ),
    })
    expect(packageMcpResult.output).toContain("package-mcp-snapshot:worker:")
    expect(packageMcpResult.metadata.package_mcp_tool_ref).toBe(packageMcpToolRef)
    expect(packageMcpResult.metadata.provider_tool_name).toBe(packageMcpProviderName)
  })

  test("does not expose declared package tools until worker projection references them", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      buildPackageToolRefs: [],
    })
    const packageToolProviderName = PromptProfileResolver.packageToolProviderName(
      `${PROJECT_EXPERT_SQUAD_ID}/build/build-evidence`,
    )
    const capability = await PromptProfileResolver.resolveWorkerCapability({
      projectDirectory: project.path,
      agentID: "build",
      config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
    })

    const projectedTools = await PromptProfileResolver.projectWorkerTools({}, capability, {
      projectDirectory: project.path,
    })

    expect(capability.packageToolRefs).toEqual([])
    expect(Object.hasOwn(projectedTools, packageToolProviderName)).toBe(false)
    expect(Object.hasOwn(projectedTools, "build-evidence")).toBe(false)
  })

  test("keeps project package tools absent from general scheduler projection", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path)
    const packageToolProviderName = PromptProfileResolver.packageToolProviderName(
      `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/source-evidence`,
    )
    const capability = await PromptProfileResolver.resolveSchedulerCapability({
      projectDirectory: project.path,
      config: Config.Info.parse({ prompt_profile: { active: "general" } }),
    })
    const { tools: rawTools } = createOrchestratorTools({
      taskID: "tsk_general_with_project_package",
      agentSessionID: "ses_general_with_project_package",
    })

    const projectedTools = await PromptProfileResolver.projectOrchestratorTools(rawTools, capability, {
      projectDirectory: project.path,
      workflow: pipelineWorkflow,
    })

    expect(capability.packageToolRefs).toEqual([])
    expect(Object.hasOwn(projectedTools, packageToolProviderName)).toBe(false)
    expect(Object.hasOwn(projectedTools, "source-evidence")).toBe(false)
  })

  test("does not expose declared package tools until scheduler projection references them", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      schedulerPackageToolRefs: [],
    })
    const packageToolProviderName = PromptProfileResolver.packageToolProviderName(
      `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/source-evidence`,
    )
    const capability = await PromptProfileResolver.resolveSchedulerCapability({
      projectDirectory: project.path,
      config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
    })
    const { tools: rawTools } = createOrchestratorTools({
      taskID: "tsk_declared_not_projected",
      agentSessionID: "ses_declared_not_projected",
    })

    const projectedTools = await PromptProfileResolver.projectOrchestratorTools(rawTools, capability, {
      projectDirectory: project.path,
      workflow: pipelineWorkflow,
    })

    expect(capability.packageToolRefs).toEqual([])
    expect(Object.hasOwn(projectedTools, packageToolProviderName)).toBe(false)
  })

  test("does not import inactive package tool modules while another profile is active", async () => {
    await using project = await tmpdir({ git: true })
    const inactiveRoot = await writeProjectExpertSquadPackage(project.path)
    await Bun.write(
      path.join(inactiveRoot, "agents", "orchestrator", "tools", "source-evidence.ts"),
      'throw new Error("inactive package tool imported")',
    )
    const capability = await PromptProfileResolver.resolveSchedulerCapability({
      projectDirectory: project.path,
      config: Config.Info.parse({ prompt_profile: { active: "general" } }),
    })
    const { tools: rawTools } = createOrchestratorTools({
      taskID: "tsk_inactive_package_tool",
      agentSessionID: "ses_inactive_package_tool",
    })

    await expect(
      PromptProfileResolver.projectOrchestratorTools(rawTools, capability, {
        projectDirectory: project.path,
        workflow: pipelineWorkflow,
      }),
    ).resolves.toBeDefined()
  })

  test("general catalog and selector projection avoid inactive MCP parsing", async () => {
    await using project = await tmpdir({ git: true })
    const inactiveRoot = await writeProjectExpertSquadPackage(project.path)
    await Bun.write(path.join(inactiveRoot, "mcp", "broken.jsonc"), "{")
    const generalConfig = Config.Info.parse({ prompt_profile: { active: "general" } })

    await expect(
      PromptProfileResolver.assertKnownProfileID({
        projectDirectory: project.path,
        profileID: "general",
        config: generalConfig,
      }),
    ).resolves.toBeUndefined()

    const generalPrompt = await PromptProfileResolver.composeAgentPrompt({
      projectDirectory: project.path,
      agentID: "orchestrator",
      base: "BASE",
      config: generalConfig,
    })
    expect(generalPrompt).toContain("# General")
    expect(generalPrompt).not.toContain("PROJECT_README_ORCHESTRATOR_APPEND_ONLY")

    const catalog = await PromptProfileResolver.catalog({
      config: generalConfig,
      projectActive: "general",
      sessionOverride: null,
      scope: { kind: "project", directory: project.path },
      defaultSkills: [],
    })
    expect(catalog.squads.some((squad) => squad.id === PROJECT_EXPERT_SQUAD_ID)).toBe(true)

    const selectorProjection = await PromptProfileResolver.resolveSkillProjection({
      projectDirectory: project.path,
      config: generalConfig,
      defaultSkills: [],
      agentIDs: ["orchestrator"],
    })
    const selector = selectorProjection.skills.find((skill) => skill.name === `${PROJECT_EXPERT_SQUAD_ID}-expert-squad`)
    expect(selector?.content).toContain("PROJECT_SELECTOR_FULL_INSTRUCTIONS")
    expect(selector?.location).toBe(path.join(inactiveRoot, "selector.md"))

    await expect(
      PromptProfileResolver.resolveSchedulerCapability({
        projectDirectory: project.path,
        config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
      }),
    ).rejects.toThrow(/invalid JSONC/)
  })

  test("fails visibly when active package tool export is not a ToolDefinition", async () => {
    await using project = await tmpdir({ git: true })
    const packageRoot = await writeProjectExpertSquadPackage(project.path)
    await Bun.write(path.join(packageRoot, "agents", "orchestrator", "tools", "source-evidence.ts"), "export default {}")
    const capability = await PromptProfileResolver.resolveSchedulerCapability({
      projectDirectory: project.path,
      config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
    })
    const { tools: rawTools } = createOrchestratorTools({
      taskID: "tsk_invalid_package_tool",
      agentSessionID: "ses_invalid_package_tool",
    })

    await expect(
      PromptProfileResolver.projectOrchestratorTools(rawTools, capability, {
        projectDirectory: project.path,
        workflow: pipelineWorkflow,
      }),
    ).rejects.toThrow("must export default ToolDefinition")
  })

  test("resolves general skill projection to selector skills and ordinary installed skills", async () => {
    await using project = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".opencorvus", "skill", "unreferenced-default", "SKILL.md"),
          [
            "---",
            "name: unreferenced-default",
            "description: Default ordinary skill that remains in the system skill collection.",
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
        expect(projection.selectorSkillNames).toEqual([`${PROJECT_EXPERT_SQUAD_ID}-expert-squad`])
        expect(projection.productionSkillNames).toContain("unreferenced-default")
        expect(projection.projectedSkillNames).toEqual(projection.skills.map((skill) => skill.name))
        expect(projection.projectedSkillNames).toContain(`${PROJECT_EXPERT_SQUAD_ID}-expert-squad`)
        expect(projection.skills.find((skill) => skill.name === `${PROJECT_EXPERT_SQUAD_ID}-expert-squad`)?.content).toContain(
          "PROJECT_SELECTOR_FULL_INSTRUCTIONS",
        )
        expect(projection.projectedSkillNames).not.toContain("scheduler")
        expect(projection.projectedSkillNames).not.toContain("implementation")
        expect(projection.projectedSkillNames).toContain("unreferenced-default")
        expect(projection.skills.find((skill) => skill.name === "unreferenced-default")?.mounted_agents).toEqual(["build"])
      },
    })
  })

  test("projects selector skills only from explicitly installed project packages", async () => {
    await using project = await tmpdir({ git: true })

    const emptyProjection = await PromptProfileResolver.resolveSkillProjection({
      projectDirectory: project.path,
      config: Config.Info.parse({ prompt_profile: { active: "general" } }),
      defaultSkills: [],
      agentIDs: ["orchestrator"],
    })

    expect(emptyProjection.selectorSkillNames).not.toEqual(
      expect.arrayContaining([
        "frontend-automation-debug-expert-squad",
        "frontend-innovate-expert-squad",
        "frontend-replica-expert-squad",
        "opentest-expert-squad",
      ]),
    )
    await expect(
      fs.lstat(path.join(project.path, ".opencorvus", "expert-squads", "builtin", "frontend-replica")),
    ).rejects.toMatchObject({ code: "ENOENT" })

    await copyRepositoryExpertSquadPackage(project.path, "frontend-automation-debug")
    await copyRepositoryExpertSquadPackage(project.path, "frontend-innovate")
    await copyRepositoryExpertSquadPackage(project.path, "frontend-replica")
    await copyRepositoryExpertSquadPackage(project.path, "opentest")

    const projection = await PromptProfileResolver.resolveSkillProjection({
      projectDirectory: project.path,
      config: Config.Info.parse({ prompt_profile: { active: "general" } }),
      defaultSkills: [],
      agentIDs: ["orchestrator"],
    })

    expect(projection.selectorSkillNames).toEqual(
      expect.arrayContaining([
        "frontend-automation-debug-expert-squad",
        "frontend-innovate-expert-squad",
        "frontend-replica-expert-squad",
        "opentest-expert-squad",
      ]),
    )
    const frontendAutomationSelector = projection.skills.find((skill) => skill.name === "frontend-automation-debug-expert-squad")
    expect(frontendAutomationSelector?.content).toContain("## Expert Debug Contract")
    expect(frontendAutomationSelector?.content).toContain("observable symptom -> direct trigger")
    expect(frontendAutomationSelector?.content).toContain("Do not infer root cause from a task title")
    const frontendInnovateSelector = projection.skills.find((skill) => skill.name === "frontend-innovate-expert-squad")
    expect(frontendInnovateSelector?.content).toContain("## Expert Contract")
    expect(frontendInnovateSelector?.content).toContain("design-convergence model")
    expect(frontendInnovateSelector?.content).toContain("Do not accept a frontend innovation result")
    const frontendReplicaSelector = projection.skills.find((skill) => skill.name === "frontend-replica-expert-squad")
    expect(frontendReplicaSelector?.content).toContain("## Expert Contract")
    expect(frontendReplicaSelector?.content).toContain("source-to-render model")
    expect(frontendReplicaSelector?.content).toContain("Do not accept source-row prose")
    const opentestSelector = projection.skills.find((skill) => skill.name === "opentest-expert-squad")
    expect(opentestSelector?.content).toContain("## Expert Contract")
    expect(opentestSelector?.content).toContain("test-validity model")
    expect(opentestSelector?.content).toContain("Do not accept tests that were not run")
    expect(frontendReplicaSelector).toMatchObject({
      required_tools: ["select_expert_squad"],
      mounted_agents: ["orchestrator"],
      builtin: false,
      location: path.join(
        project.path,
        ".opencorvus",
        "expert-squads",
        "builtin",
        "frontend-replica",
        "selector.md",
      ),
    })
    const selectorFile = await fs.lstat(
      path.join(project.path, ".opencorvus", "expert-squads", "builtin", "frontend-replica", "selector.md"),
    )
    expect(selectorFile.isFile()).toBe(true)
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

  test("active project package skill projection ignores inactive selector catalog failures", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path)
    const inactiveRoot = await writeProjectExpertSquadPackage(project.path, "inactive-replica")
    await Bun.write(path.join(inactiveRoot, "selector.md"), " \n")

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const projection = await PromptProfileResolver.resolveSkillProjection({
          projectDirectory: project.path,
          config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
          agentIDs: ["orchestrator", "build"],
        })

        expect(projection.activeProfile).toBe(PROJECT_EXPERT_SQUAD_ID)
        expect(projection.selectorSkillNames).toEqual([`${PROJECT_EXPERT_SQUAD_ID}-expert-squad`])
        expect(projection.projectedSkillNames).toContain("scheduler")
        expect(projection.projectedSkillNames).not.toContain("inactive-replica-expert-squad")
      },
    })
  })

  test("active project package selector collision checks only projected selector skills", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path)
    await writeProjectExpertSquadPackage(project.path, "inactive-replica")

    await expect(
      PromptProfileResolver.resolveSkillProjection({
        projectDirectory: project.path,
        config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
        defaultSkills: [
          {
            name: "inactive-replica-expert-squad",
            description: "Ordinary builtin skill colliding only with an inactive project selector.",
            platforms: [],
            builtin: true,
            location: "builtin://ordinary-inactive-collision",
            content: "",
            priority: 0,
            required_tools: [],
            agents: [],
            mounted_agents: ["orchestrator"],
            duplicate_locations: [],
          },
        ],
        agentIDs: ["orchestrator", "build"],
      }),
    ).resolves.toMatchObject({
      activeProfile: PROJECT_EXPERT_SQUAD_ID,
      selectorSkillNames: [`${PROJECT_EXPERT_SQUAD_ID}-expert-squad`],
    })
  })

  test("resolves active project package skill projection without registering package production skills globally", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path)
    await Bun.write(
      path.join(
        project.path,
        ".opencorvus",
        "expert-squads",
        PROJECT_EXPERT_SQUAD_NAMESPACE,
        PROJECT_EXPERT_SQUAD_ID,
        "agents",
        "build",
        "skills",
        "package-review",
        "SKILL.md",
      ),
      "---\nname: package-review\ndescription: Directory-discovered package review skill.\n---\n",
    )
    await Bun.write(
      path.join(
        project.path,
        ".opencorvus",
        "expert-squads",
        PROJECT_EXPERT_SQUAD_NAMESPACE,
        PROJECT_EXPERT_SQUAD_ID,
        "skills",
        "shared-brief",
        "SKILL.md",
      ),
      "---\nname: shared-brief\ndescription: Shared package skill without an implied owner.\n---\n",
    )

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const projection = await PromptProfileResolver.resolveSkillProjection({
          projectDirectory: project.path,
          config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
          agentIDs: ["orchestrator", "build"],
        })

        expect(projection.activeProfile).toBe(PROJECT_EXPERT_SQUAD_ID)
        expect(projection.projectedToolIDs).not.toContain("build")
        expect(projection.projectedAgentIDs).toEqual(["orchestrator", "general", "build"])
        expect(projection.selectorSkillNames).toEqual([`${PROJECT_EXPERT_SQUAD_ID}-expert-squad`])
        expect(projection.productionSkillNames).toEqual(
          expect.arrayContaining(["implementation", "package-review", "scheduler"]),
        )
        expect(projection.projectedSkillNames).toEqual(projection.skills.map((skill) => skill.name))
        expect(projection.projectedSkillNames).toEqual(
          expect.arrayContaining([
            "implementation",
            "package-review",
            `${PROJECT_EXPERT_SQUAD_ID}-expert-squad`,
            "scheduler",
          ]),
        )
        expect(projection.skills.find((skill) => skill.name === `${PROJECT_EXPERT_SQUAD_ID}-expert-squad`)?.content).toContain(
          "PROJECT_SELECTOR_FULL_INSTRUCTIONS",
        )
        expect(projection.projectedSkillNames).not.toContain("source-evidence")
        expect(projection.projectedSkillNames).not.toContain("package-browser")
        expect(projection.projectedSkillNames).not.toContain("shared-brief")
        expect(projection.skills.find((skill) => skill.name === "scheduler")?.mounted_agents).toEqual(["orchestrator"])
        expect(projection.skills.find((skill) => skill.name === "implementation")?.mounted_agents).toEqual(["build"])
        expect(projection.skills.find((skill) => skill.name === "package-review")?.mounted_agents).toEqual(["build"])
        expect(projection.skills.map((skill) => skill.name)).not.toContain("source-evidence")
        expect(projection.skills.map((skill) => skill.name)).not.toContain("package-browser")
        expect(projection.skills.map((skill) => skill.name)).not.toContain("shared-brief")
        expect((await Skill.all()).map((skill) => skill.name)).not.toContain("scheduler")
        expect((await Skill.all()).map((skill) => skill.name)).not.toContain("implementation")

        const pipelineProjection = await PromptProfileResolver.resolveSkillProjection({
          projectDirectory: project.path,
          config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
          agentIDs: ["orchestrator", "build"],
          workflow: pipelineWorkflow,
        })
        expect(pipelineProjection.projectedToolIDs).toContain("build")
      },
    })
  })

  test("projects package shared skills only through explicit package skill refs", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path)
    const packageRoot = path.join(
      project.path,
      ".opencorvus",
      "expert-squads",
      PROJECT_EXPERT_SQUAD_NAMESPACE,
      PROJECT_EXPERT_SQUAD_ID,
    )
    await Bun.write(
      path.join(packageRoot, "skills", "shared-brief", "SKILL.md"),
      "---\nname: shared-brief\ndescription: Explicit shared package skill.\n---\n",
    )
    const manifestPath = path.join(packageRoot, "expert-squad.jsonc")
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
      capability_projection: {
        agents: {
          build: {
            package_skill_refs: string[]
          }
        }
      }
    }
    manifest.capability_projection.agents.build.package_skill_refs.push(
      `${PROJECT_EXPERT_SQUAD_ID}/shared/shared-brief`,
    )
    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2))

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const projection = await PromptProfileResolver.resolveSkillProjection({
          projectDirectory: project.path,
          config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
          agentIDs: ["orchestrator", "build"],
        })

        expect(projection.projectedSkillNames).toContain("shared-brief")
        expect(projection.productionSkillNames).toContain("shared-brief")
        expect(projection.skills.find((skill) => skill.name === "shared-brief")?.mounted_agents).toEqual(["build"])
      },
    })
  })

  test("scheduler capability projection uses active workflow role bindings", async () => {
    await using project = await tmpdir({
      git: true,
      config: {
        assistant: {
          workflows: [
            {
              id: "custom-owner-map",
              name: "Custom owner map",
              description: "Test workflow that binds build tool ownership to integrity.",
              steps: [
                {
                  id: "integrity-owned-build",
                  tool: "build",
                  agentRole: "integrity",
                  label: "Integrity-owned build",
                  hint: "Test only.",
                  scope: "goal",
                  skippable: false,
                  after: [],
                },
              ],
              goalLoopStepIDs: ["integrity-owned-build"],
            },
          ],
        },
      },
    })
    await writeProjectExpertSquadPackage(project.path)

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const config = Config.Info.parse({
          prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID },
          assistant: {
            workflows: [
              {
                id: "custom-owner-map",
                name: "Custom owner map",
                description: "Test workflow that binds build tool ownership to integrity.",
                steps: [
                  {
                    id: "integrity-owned-build",
                    tool: "build",
                    agentRole: "integrity",
                    label: "Integrity-owned build",
                    hint: "Test only.",
                    scope: "goal",
                    skippable: false,
                    after: [],
                  },
                ],
                goalLoopStepIDs: ["integrity-owned-build"],
              },
            ],
          },
        })
        await expect(
          PromptProfileResolver.resolveSchedulerCapability({
            projectDirectory: project.path,
            config,
          }),
        ).rejects.toThrow(/requires capability_projection\.agents\.integrity/)
      },
    })
  })

  test("catalog package validation uses active workflow role bindings", async () => {
    await using project = await tmpdir({ git: true })
    const packageRoot = await writeProjectExpertSquadPackage(project.path)
    const manifestPath = path.join(packageRoot, "expert-squad.jsonc")
    const manifest = await Bun.file(manifestPath).json()
    delete manifest.capability_projection.agents.build
    manifest.capability_projection.agents.integrity = { role_base: true }
    delete manifest.agents.build
    manifest.agents.integrity = { prompt: "agents/integrity/system.md" }
    await fs.rm(path.join(packageRoot, "agents", "build"), { recursive: true, force: true })
    await fs.mkdir(path.join(packageRoot, "agents", "integrity"), { recursive: true })
    await Bun.write(path.join(packageRoot, "agents", "integrity", "system.md"), "project integrity overlay")
    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2))

    const config = Config.Info.parse({
      prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID },
      assistant: {
        workflows: [
          {
            id: "custom-owner-map",
            name: "Custom owner map",
            description: "Test workflow that binds build tool ownership to integrity.",
            steps: [
              {
                id: "integrity-owned-build",
                tool: "build",
                agentRole: "integrity",
                label: "Integrity-owned build",
                hint: "Test only.",
                scope: "goal",
                skippable: false,
                after: [],
              },
            ],
            goalLoopStepIDs: ["integrity-owned-build"],
          },
        ],
      },
    })

    const catalog = await PromptProfileResolver.catalog({
      config,
      projectActive: PROJECT_EXPERT_SQUAD_ID,
      sessionOverride: null,
      scope: { kind: "project", directory: project.path },
      defaultSkills: [],
    })
    const profile = catalog.squads.find((entry) => entry.id === PROJECT_EXPERT_SQUAD_ID)
    expect(profile?.projected_agents).toEqual(["general", "integrity"])
    expect(profile?.capability_projection.agents.build).toBeUndefined()
    expect(profile?.capability_projection.agents.integrity.built_in_tool_ids).toEqual(
      [...AgentToolPool.visibleToolIDs(AgentToolPool.assignment("integrity"))],
    )
  })

  test("unions ordinary default skill mounts with explicit default skill refs", async () => {
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
            "description: Default ordinary skill projected from its own mounted_agents.",
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
        expect(projection.projectedSkillNames).toContain("unreferenced-default")
        expect(projection.skills.find((skill) => skill.name === "project-guidance")?.mounted_agents).toEqual(["build"])
        expect(projection.skills.find((skill) => skill.name === "unreferenced-default")?.mounted_agents).toEqual(["build"])
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

    await expect(
      PromptProfileResolver.projectOrchestratorTools(rawTools, capability, { workflow: pipelineWorkflow }),
    ).rejects.toThrow(
      /projects Orchestrator tool "skill"/,
    )
  })

})
