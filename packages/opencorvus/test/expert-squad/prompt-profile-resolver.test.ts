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

describe("PromptProfileResolver", () => {
  test("loads project package profiles into the catalog and composes package overlays", async () => {
    await using project = await tmpdir({ git: true })
    const schedulerPackageMcpServerRef = `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/package-browser`
    const schedulerPackageMcpPromptRef = `${schedulerPackageMcpServerRef}/prompt/inspect`
    const schedulerPackageMcpResourceRef = `${schedulerPackageMcpServerRef}/resource/dom`
    const buildDefaultMcpPromptRef = "default/mcp/package-browser/prompt/inspect"
    const buildDefaultMcpResourceRef = "default/mcp/package-browser/resource/dom"
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      schedulerPackageMcpServerRefs: [schedulerPackageMcpServerRef],
      schedulerPackageMcpPromptRefs: [schedulerPackageMcpPromptRef],
      schedulerPackageMcpResourceRefs: [schedulerPackageMcpResourceRef],
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
      capability_profile_id: PROJECT_EXPERT_SQUAD_ID,
      projected_agents: ["build"],
      agents: {
        build: "project build overlay",
        orchestrator: "project orchestrator overlay",
      },
    })
    expect(profile?.projection_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(profile?.capability_projection.scheduler.built_in_tool_ids).toContain("build")
    expect(profile?.capability_projection.scheduler.package_tool_refs).toEqual([
      `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/source-evidence`,
    ])
    expect(profile?.capability_projection.scheduler.package_mcp_prompt_refs).toEqual([schedulerPackageMcpPromptRef])
    expect(profile?.capability_projection.scheduler.package_mcp_resource_refs).toEqual([schedulerPackageMcpResourceRef])
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
      "editable",
      "id",
      "label",
      "projected_agents",
      "projection_hash",
    ])

    const buildPrompt = await PromptProfileResolver.composeAgentPrompt({
      projectDirectory: project.path,
      agentID: "build",
      base: "BASE",
      userAppend: "USER APPEND",
      config,
    })
    expect(buildPrompt).toContain("BASE\n\nproject build overlay\n\n## Projected MCP Context")
    expect(buildPrompt).toContain("package-mcp-prompt::")
    expect(buildPrompt).toContain("package-mcp-resource:")
    expect(buildPrompt.endsWith("USER APPEND")).toBe(true)

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

  test("rejects unknown project profile IDs with project context", async () => {
    await using project = await tmpdir({ git: true })
    const config = Config.Info.parse({ prompt_profile: { active: "missing-profile" } })

    await expect(PromptProfileResolver.list({ projectDirectory: project.path, config })).rejects.toThrow(
      /Unknown prompt profile "missing-profile"/,
    )
    await expect(
      PromptProfileResolver.assertKnownProfileID({ projectDirectory: project.path, profileID: "missing-profile", config }),
    ).rejects.toThrow(/Unknown prompt profile "missing-profile"/)
  })

  test("rejects project packages that collide with built-in profile IDs", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path, "general")
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

  test("non-general expert squads resolve only from project packages", async () => {
    for (const profileID of retiredStaticProfileIDs) {
      await expect(
        PromptProfileResolver.resolveSchedulerCapability({
          config: Config.Info.parse({ prompt_profile: { active: profileID } }),
        }),
      ).rejects.toThrow(`Unknown prompt profile "${profileID}"`)
    }

    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path, "frontend-replica")
    const capability = await PromptProfileResolver.resolveSchedulerCapability({
      projectDirectory: project.path,
      config: Config.Info.parse({ prompt_profile: { active: "frontend-replica" } }),
    })

    expect(capability.promptProfileID).toBe("frontend-replica")
    expect(capability.builtIn).toBe(false)
    expect(capability.builtInToolIDs).toContain("build")
    expect(capability.packageToolRefs).toContain("frontend-replica/orchestrator/source-evidence")
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

  test("projects active package MCP tools as scoped runtime providers without global MCP registration", async () => {
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
    const packageMcpProviderName = PromptProfileResolver.packageMcpToolProviderName(packageMcpToolRef)
    const capability = await PromptProfileResolver.resolveSchedulerCapability({
      projectDirectory: project.path,
      config: Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
    })

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
    expect(packageMcpResult.output).toContain("package-mcp-snapshot:active:")
    expect(packageMcpResult.metadata.package_mcp_tool_ref).toBe(packageMcpToolRef)
    expect(packageMcpResult.metadata.provider_tool_name).toBe(packageMcpProviderName)
  })

  test("projects scheduler default MCP tool refs from the effective config", async () => {
    await using project = await tmpdir({ git: true })
    const defaultMcpToolRef = "default/mcp/package-browser/tool/snapshot"
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      schedulerDefaultMcpToolRefs: [defaultMcpToolRef],
      schedulerPackageToolRefs: [],
    })
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
    expect(defaultMcpResult.output).toContain("package-mcp-snapshot:default:")
    expect(defaultMcpResult.metadata.default_mcp_tool_ref).toBe(defaultMcpToolRef)
    expect(defaultMcpResult.metadata.provider_tool_name).toBe(defaultMcpProviderName)
  })

  test("projects active package MCP prompts and resources as scoped runtime providers without global MCP registration", async () => {
    await using project = await tmpdir({ git: true })
    const packageMcpServerRef = `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/package-browser`
    const packageMcpPromptRef = `${packageMcpServerRef}/prompt/inspect`
    const packageMcpResourceRef = `${packageMcpServerRef}/resource/dom`
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      schedulerPackageMcpServerRefs: [packageMcpServerRef],
      schedulerPackageMcpPromptRefs: [packageMcpPromptRef],
      schedulerPackageMcpResourceRefs: [packageMcpResourceRef],
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
      },
      capability,
      { projectDirectory: project.path },
    )

    expect(Object.hasOwn(projectedTools, "read")).toBe(true)
    expect(Object.hasOwn(projectedTools, "complete_task")).toBe(false)
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

  test("projects active package worker MCP tools as scoped runtime providers without global MCP registration", async () => {
    await using project = await tmpdir({ git: true })
    const packageMcpServerRef = `${PROJECT_EXPERT_SQUAD_ID}/build/package-browser`
    const packageMcpToolRef = `${packageMcpServerRef}/tool/snapshot`
    await writeProjectExpertSquadPackage(project.path, PROJECT_EXPERT_SQUAD_ID, {
      buildPackageMcpServerRefs: [packageMcpServerRef],
      buildPackageMcpToolRefs: [packageMcpToolRef],
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

  test("general selector projection does not parse inactive package MCP definitions", async () => {
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

    const catalog = await PromptProfileResolver.list({
      projectDirectory: project.path,
      config: generalConfig,
      projectActive: "general",
      sessionActive: null,
    })
    expect(catalog.active).toBe("general")
    expect(catalog.profiles.find((profile) => profile.id === PROJECT_EXPERT_SQUAD_ID)).toMatchObject({
      built_in: false,
      capability_profile_id: PROJECT_EXPERT_SQUAD_ID,
      agents: { build: "project build overlay" },
    })

    const projection = await PromptProfileResolver.resolveSkillProjection({
      projectDirectory: project.path,
      config: generalConfig,
      defaultSkills: [],
      agentIDs: ["orchestrator"],
    })
    const selector = projection.skills.find((skill) => skill.name === `${PROJECT_EXPERT_SQUAD_ID}-expert-squad`)
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
        expect(projection.selectorSkillNames).toEqual([`${PROJECT_EXPERT_SQUAD_ID}-expert-squad`])
        expect(projection.productionSkillNames).toEqual([])
        expect(projection.projectedSkillNames).toEqual(projection.skills.map((skill) => skill.name))
        expect(projection.projectedSkillNames).toContain(`${PROJECT_EXPERT_SQUAD_ID}-expert-squad`)
        expect(projection.skills.find((skill) => skill.name === `${PROJECT_EXPERT_SQUAD_ID}-expert-squad`)?.content).toContain(
          "PROJECT_SELECTOR_FULL_INSTRUCTIONS",
        )
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
        expect(projection.projectedAgentIDs).toEqual(["orchestrator", "build"])
        expect(projection.selectorSkillNames).toEqual([`${PROJECT_EXPERT_SQUAD_ID}-expert-squad`])
        expect(projection.productionSkillNames.sort()).toEqual(["implementation", "scheduler"])
        expect(projection.projectedSkillNames).toEqual(projection.skills.map((skill) => skill.name))
        expect(projection.projectedSkillNames).toEqual(
          expect.arrayContaining(["implementation", `${PROJECT_EXPERT_SQUAD_ID}-expert-squad`, "scheduler"]),
        )
        expect(projection.skills.find((skill) => skill.name === `${PROJECT_EXPERT_SQUAD_ID}-expert-squad`)?.content).toContain(
          "PROJECT_SELECTOR_FULL_INSTRUCTIONS",
        )
        expect(projection.projectedSkillNames).not.toContain("source-evidence")
        expect(projection.projectedSkillNames).not.toContain("package-browser")
        expect(projection.skills.find((skill) => skill.name === "scheduler")?.mounted_agents).toEqual(["orchestrator"])
        expect(projection.skills.find((skill) => skill.name === "implementation")?.mounted_agents).toEqual(["build"])
        expect(projection.skills.map((skill) => skill.name)).not.toContain("source-evidence")
        expect(projection.skills.map((skill) => skill.name)).not.toContain("package-browser")
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

    const catalog = await PromptProfileResolver.list({
      projectDirectory: project.path,
      config,
      projectActive: PROJECT_EXPERT_SQUAD_ID,
      sessionActive: null,
    })
    const profile = catalog.profiles.find((entry) => entry.id === PROJECT_EXPERT_SQUAD_ID)
    expect(profile?.projected_agents).toEqual(["integrity"])
    expect(profile?.capability_projection.agents.integrity.built_in_tool_ids).toEqual([])
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

    await expect(
      PromptProfileResolver.projectOrchestratorTools(rawTools, capability, { workflow: pipelineWorkflow }),
    ).rejects.toThrow(
      /projects Orchestrator tool "skill"/,
    )
  })

})
