import { createHash } from "node:crypto"
import { lstat, mkdir, readFile, realpath } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { tool } from "ai"
import matter from "gray-matter"
import z from "zod"
import type { ToolContext as PluginToolContext, ToolDefinition } from "@opencorvus-ai/plugin"
import {
  DEFAULT_PROMPT_PROFILE_ID,
  PromptProfile,
  PromptProfileCatalogSchema,
  PromptProfileIDSchema,
  type PromptProfileCatalog,
  type PromptProfileCatalogProfile,
  type PromptProfileConfig,
  type PromptProfileDefinition,
} from "@/agent/prompt-profile"
import { AgentRoleContract, type AgentRoleID } from "@/agent/role-contract"
import { AgentToolPool } from "@/agent/tool-pool-contract"
import { Config } from "@/config/config"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { Instance } from "@/project/instance"
import { runtimePackageRequire } from "@/runtime/package-require"
import { Skill } from "@/skill/skill"
import { Truncate } from "@/tool/truncation"
import { MCP } from "@/mcp"
import { materializeMcpToolResult } from "@/mcp/materialize"
import { Filesystem } from "@/util/filesystem"
import { EngineConfig } from "@/engine/config"
import {
  WorkflowRegistry,
  type MiniWorkflow,
  type OrchestratorWorkflowToolName,
  type SchedulerAgentWorkflowBinding,
} from "@/engine/workflow"
import { loadedBuiltInPackages } from "./builtin"
import {
  catalogProfileFromPackage as catalogProfileFromCapabilityPackage,
  defaultMcpPromptProviderName as defaultMcpPromptProviderNameFromRef,
  defaultMcpResourceProviderName as defaultMcpResourceProviderNameFromRef,
  defaultMcpToolProviderName as defaultMcpToolProviderNameFromRef,
  defaultToolNameFromRef as defaultToolNameFromCapabilityRef,
  packageMcpPromptProviderName as packageMcpPromptProviderNameFromRef,
  packageMcpResourceProviderName as packageMcpResourceProviderNameFromRef,
  packageMcpToolProviderName as packageMcpToolProviderNameFromRef,
  packageToolProviderName as packageToolProviderNameFromRef,
  projectionHash,
} from "./catalog-profile"
import { ExpertSquadRegistry } from "./registry"

type ConfigLike = {
  prompt_profile?: PromptProfileConfig
  mcp?: Config.Info["mcp"]
  assistant?: Config.Info["assistant"]
}

export namespace PromptProfileResolver {
  export interface ProjectScope {
    projectDirectory?: string
  }

  export interface CatalogInput extends ProjectScope {
    config: ConfigLike
    projectActive?: string
    sessionActive?: string | null
  }

  export interface PromptInput extends ProjectScope {
    agentID: string
    config: ConfigLike
  }

  export interface ComposeInput extends PromptInput {
    base: string
    userAppend?: string | null
  }

  export interface ProfileIDInput extends ProjectScope {
    profileID: string
    config: ConfigLike
  }

  export interface SchedulerCapabilityInput extends ProjectScope {
    config: ConfigLike
  }

  export interface ResolvedSchedulerCapability {
    promptProfileID: string
    expertSquadID: string
    capabilityProfileID: string
    builtIn: boolean
    projectionHash: string
    scheduler: ExpertSquadRegistry.Projection
    builtInToolIDs: string[]
    defaultToolRefs: string[]
    defaultToolProviderNames: string[]
    packageToolRefs: string[]
    packageToolProviderNames: string[]
    defaultMcpToolRefs: string[]
    defaultMcpToolProviderNames: string[]
    defaultMcpPromptRefs: string[]
    defaultMcpPromptProviderNames: string[]
    defaultMcpResourceRefs: string[]
    defaultMcpResourceProviderNames: string[]
    defaultMcpServers: Record<string, Config.Mcp>
    packageMcpToolRefs: string[]
    packageMcpToolProviderNames: string[]
    packageMcpPromptRefs: string[]
    packageMcpPromptProviderNames: string[]
    packageMcpResourceRefs: string[]
    packageMcpResourceProviderNames: string[]
    packageRoot?: string
    projectedWorkflowTools: OrchestratorWorkflowToolName[]
    workflowBindings: SchedulerAgentWorkflowBinding[]
    dynamicAttributes: ExpertSquadRegistry.Manifest["dynamic_attributes"]
    includeMcpTools: false
  }

  export interface WorkerCapabilityInput extends ProjectScope {
    config: ConfigLike
    agentID: AgentRoleID
  }

  export interface ResolvedWorkerCapability {
    promptProfileID: string
    expertSquadID: string
    capabilityProfileID: string
    agentID: AgentRoleID
    builtIn: boolean
    projectionHash: string
    projection: ExpertSquadRegistry.Projection
    builtInToolIDs: string[]
    defaultToolRefs: string[]
    defaultToolProviderNames: string[]
    packageToolRefs: string[]
    packageToolProviderNames: string[]
    defaultMcpToolRefs: string[]
    defaultMcpToolProviderNames: string[]
    defaultMcpPromptRefs: string[]
    defaultMcpPromptProviderNames: string[]
    defaultMcpResourceRefs: string[]
    defaultMcpResourceProviderNames: string[]
    defaultMcpServers: Record<string, Config.Mcp>
    packageMcpToolRefs: string[]
    packageMcpToolProviderNames: string[]
    packageMcpPromptRefs: string[]
    packageMcpPromptProviderNames: string[]
    packageMcpResourceRefs: string[]
    packageMcpResourceProviderNames: string[]
    packageRoot?: string
    workflowBindings: SchedulerAgentWorkflowBinding[]
    includeMcpTools: false
  }

  export interface FrontendDesignDynamicAttributes {
    requireDesignDirectionContract: boolean
  }

  export interface SkillProjectionInput extends ProjectScope {
    config: ConfigLike
    defaultSkills?: Skill.Info[]
    agentIDs?: string[]
    workflow?: MiniWorkflow
  }

  export interface ResolvedSkillProjection {
    activeProfile: string
    expertSquadID: string
    capabilityProfileID: string
    builtIn: boolean
    projectionHash: string
    projectedToolIDs: string[]
    projectedAgentIDs: string[]
    selectorSkillNames: string[]
    productionSkillNames: string[]
    projectedSkillNames: string[]
    skills: Skill.Info[]
  }

  type BuiltInPackage = (typeof loadedBuiltInPackages)[number]
  type PackageWithCapability =
    | BuiltInPackage
    | ExpertSquadRegistry.LoadedPackage
    | ExpertSquadRegistry.CatalogPackage
  type ActiveProfilePackage =
    | {
        profileID: string
        builtIn: true
        pkg: BuiltInPackage
      }
    | {
        profileID: string
        builtIn: false
        pkg: ExpertSquadRegistry.LoadedPackage
      }

  const builtInPackages = Object.fromEntries(loadedBuiltInPackages.map((pkg) => [pkg.id, pkg])) as Record<
    string,
    (typeof loadedBuiltInPackages)[number]
  >

  function canonicalBase(projectDirectory: string) {
    return path.join(ProjectRuntimePaths.projectConfigRoot(Filesystem.resolve(projectDirectory)), ExpertSquadRegistry.DIRECTORY)
  }

  function assertNoBuiltInCollision(profileID: string) {
    if (Object.hasOwn(PromptProfile.builtIns, profileID)) {
      throw new Error(`Project expert squad package id ${JSON.stringify(profileID)} collides with a built-in expert squad id.`)
    }
  }

  function packageLoadOptions(config: ConfigLike): Parameters<typeof ExpertSquadRegistry.loadPackage>[1] {
    return {
      workflowBindings: WorkflowRegistry.schedulerAgentWorkflowBindingsForEngineConfig(
        EngineConfig.fromAssistantConfig(config.assistant),
      ),
    }
  }

  async function discoverProjectPackages(projectDirectory: string): Promise<ExpertSquadRegistry.PackageCatalogEntry[]> {
    const entries = await ExpertSquadRegistry.discover(projectDirectory)
    for (const entry of entries) assertNoBuiltInCollision(entry.id)
    return entries
  }

  async function projectCatalogPackages(
    projectDirectory: string,
  ): Promise<Record<string, ExpertSquadRegistry.CatalogPackage>> {
    const result: Record<string, ExpertSquadRegistry.CatalogPackage> = {}
    for (const entry of await discoverProjectPackages(projectDirectory)) {
      const loaded = await ExpertSquadRegistry.loadCatalogPackage(path.join(canonicalBase(projectDirectory), entry.id))
      assertNoBuiltInCollision(loaded.id)
      result[loaded.id] = loaded
    }
    return result
  }

  async function loadProjectPackageByID(
    projectDirectory: string,
    profileID: string,
    options?: Parameters<typeof ExpertSquadRegistry.loadPackage>[1],
  ): Promise<ExpertSquadRegistry.LoadedPackage | undefined> {
    ExpertSquadRegistry.parseID(profileID)
    const packageRoot = path.join(canonicalBase(projectDirectory), profileID)
    const info = await lstat(packageRoot).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (!info) return undefined
    const loaded = await ExpertSquadRegistry.loadPackage(packageRoot, options)
    assertNoBuiltInCollision(loaded.id)
    return loaded
  }

  async function projectPromptProfiles(projectDirectory: string): Promise<Record<string, PromptProfileDefinition>> {
    return Object.fromEntries(
      Object.entries(await projectCatalogPackages(projectDirectory)).map(([id, loaded]) => [id, loaded.promptProfile]),
    )
  }

  export async function definitions(
    projectDirectory: string,
    _config?: ConfigLike,
  ): Promise<Record<string, PromptProfileDefinition>> {
    return {
      ...PromptProfile.builtIns,
      ...(await projectPromptProfiles(projectDirectory)),
    }
  }

  async function packageForActiveProfile(input: SchedulerCapabilityInput): Promise<ActiveProfilePackage> {
    const profileID = PromptProfile.activeID(input.config)
    const builtIn = builtInPackages[profileID]
    if (builtIn) {
      if (input.projectDirectory) {
        for (const entry of await ExpertSquadRegistry.discover(input.projectDirectory)) {
          if (entry.id === profileID) {
            throw new Error(`Project expert squad package id ${JSON.stringify(profileID)} collides with a built-in expert squad id.`)
          }
        }
      }
      return { profileID, builtIn: true, pkg: builtIn }
    }
    const projectPackage = input.projectDirectory
      ? await loadProjectPackageByID(input.projectDirectory, profileID, packageLoadOptions(input.config))
      : undefined
    if (projectPackage) return { profileID, builtIn: false, pkg: projectPackage }
    throw new Error(`Unknown prompt profile ${JSON.stringify(profileID)}`)
  }

  export const packageToolProviderName = packageToolProviderNameFromRef
  export const packageMcpToolProviderName = packageMcpToolProviderNameFromRef
  export const packageMcpPromptProviderName = packageMcpPromptProviderNameFromRef
  export const packageMcpResourceProviderName = packageMcpResourceProviderNameFromRef
  export const defaultMcpToolProviderName = defaultMcpToolProviderNameFromRef
  export const defaultMcpPromptProviderName = defaultMcpPromptProviderNameFromRef
  export const defaultMcpResourceProviderName = defaultMcpResourceProviderNameFromRef
  const defaultToolNameFromRef = defaultToolNameFromCapabilityRef

  function stable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
    if (value && typeof value === "object") {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
        .join(",")}}`
    }
    return JSON.stringify(value)
  }

  function catalogProfileFromPackage(input: {
    id: string
    pkg: PackageWithCapability
    builtIn: boolean
  }): PromptProfileCatalogProfile {
    return catalogProfileFromCapabilityPackage({
      ...input,
      builtInToolIDs: expandedSchedulerBuiltInToolIDs(input.pkg.manifest.capability_projection.scheduler),
    })
  }

  type McpCapabilityKind = "tool" | "prompt" | "resource"

  function defaultMcpTypedPartsFromRef(
    ref: string,
    expectedKind?: McpCapabilityKind,
  ): { serverName: string; kind: McpCapabilityKind; itemName: string } {
    const match = /^default\/mcp\/([^/\\]+)\/(tool|prompt|resource)\/([^/\\]+)$/.exec(ref)
    if (!match) throw new Error(`Invalid default MCP ref ${JSON.stringify(ref)}`)
    const kind = match[2]! as McpCapabilityKind
    if (expectedKind && kind !== expectedKind) {
      throw new Error(`Invalid default MCP ${expectedKind} ref ${JSON.stringify(ref)}`)
    }
    return { serverName: match[1]!, kind, itemName: match[3]! }
  }

  function defaultMcpToolPartsFromRef(ref: string): { serverName: string; toolName: string } {
    const { serverName, itemName } = defaultMcpTypedPartsFromRef(ref, "tool")
    return { serverName, toolName: itemName }
  }

  function defaultMcpPromptPartsFromRef(ref: string): { serverName: string; promptName: string } {
    const { serverName, itemName } = defaultMcpTypedPartsFromRef(ref, "prompt")
    return { serverName, promptName: itemName }
  }

  function defaultMcpResourcePartsFromRef(ref: string): { serverName: string; resourceName: string } {
    const { serverName, itemName } = defaultMcpTypedPartsFromRef(ref, "resource")
    return { serverName, resourceName: itemName }
  }

  function defaultMcpServersForRefs(config: ConfigLike, refs: readonly string[]): Record<string, Config.Mcp> {
    const result: Record<string, Config.Mcp> = {}
    for (const ref of refs) {
      const { serverName } = defaultMcpTypedPartsFromRef(ref)
      const server = config.mcp?.[serverName]
      if (!server) throw new Error(`Active expert squad projects missing default MCP server default/mcp/${serverName}.`)
      result[serverName] = Config.Mcp.parse(server)
    }
    return result
  }

  function workflowToolRoleMap(
    toolIDs: readonly string[],
    config: ConfigLike,
  ): Map<OrchestratorWorkflowToolName, AgentRoleID> {
    const declared = new Map<OrchestratorWorkflowToolName, AgentRoleID>()
    for (const binding of WorkflowRegistry.schedulerAgentWorkflowBindingsForEngineConfig(
      EngineConfig.fromAssistantConfig(config.assistant),
    )) {
      declared.set(binding.workflow_tool_name, binding.stage)
    }
    const result = new Map<OrchestratorWorkflowToolName, AgentRoleID>()
    for (const toolID of toolIDs) {
      if (!WorkflowRegistry.isWorkflowToolName(toolID)) continue
      const role = declared.get(toolID as OrchestratorWorkflowToolName)
      if (role) result.set(toolID as OrchestratorWorkflowToolName, role)
    }
    return result
  }

  function activeProjectedSchedulerToolIDs(
    capability: ResolvedSchedulerCapability,
    workflow: MiniWorkflow | undefined,
  ): string[] {
    const workflowToolNames = workflow ? new Set(workflow.steps.map((step) => step.tool)) : undefined
    return capability.builtInToolIDs.filter((toolID) => {
      if (!WorkflowRegistry.isWorkflowToolName(toolID)) return true
      return Boolean(workflowToolNames?.has(toolID as OrchestratorWorkflowToolName))
    })
  }

  function expandedSchedulerBuiltInToolIDs(projection: ExpertSquadRegistry.Projection): string[] {
    const toolIDs = new Set<string>()
    if (projection.role_base) {
      for (const toolID of AgentToolPool.orchestratorSchedulerRoleBaseToolIDs()) toolIDs.add(toolID)
    }
    for (const toolID of projection.built_in_tool_ids) toolIDs.add(toolID)

    const canonicalToolIDs = AgentToolPool.canonicalToolIDs()
    for (const toolID of toolIDs) {
      if (!canonicalToolIDs.has(toolID)) {
        throw new Error(`Orchestrator scheduler role base projects unknown built-in tool "${toolID}"`)
      }
    }
    return [...toolIDs]
  }

  function expandedWorkerBuiltInToolIDs(
    agentID: AgentRoleID,
    projection: ExpertSquadRegistry.Projection,
  ): string[] {
    const toolIDs = new Set<string>()
    if (projection.role_base) {
      for (const toolID of AgentToolPool.visibleToolIDs(AgentToolPool.assignment(agentID))) toolIDs.add(toolID)
    }
    for (const toolID of projection.built_in_tool_ids) toolIDs.add(toolID)

    const canonicalToolIDs = AgentToolPool.canonicalToolIDs()
    for (const toolID of toolIDs) {
      if (!canonicalToolIDs.has(toolID)) {
        throw new Error(`Worker ${agentID} projects unknown built-in tool "${toolID}"`)
      }
    }
    return [...toolIDs]
  }

  export async function resolveSchedulerCapability(
    input: SchedulerCapabilityInput,
  ): Promise<ResolvedSchedulerCapability> {
    const loadOptions = packageLoadOptions(input.config)
    const active = await packageForActiveProfile(input)
    const scheduler = active.pkg.manifest.capability_projection.scheduler
    const builtInToolIDs = expandedSchedulerBuiltInToolIDs(scheduler)
    const defaultToolRefs = scheduler.default_tool_refs
    const defaultToolProviderNames = defaultToolRefs.map(defaultToolNameFromRef)
    const packageToolRefs = active.builtIn ? [] : scheduler.package_tool_refs
    const packageToolProviderNames = packageToolRefs.map(packageToolProviderName)
    const defaultMcpToolRefs = scheduler.default_mcp_tool_refs
    const defaultMcpToolProviderNames = defaultMcpToolRefs.map(defaultMcpToolProviderName)
    const defaultMcpPromptRefs = scheduler.default_mcp_prompt_refs
    const defaultMcpPromptProviderNames = defaultMcpPromptRefs.map(defaultMcpPromptProviderName)
    const defaultMcpResourceRefs = scheduler.default_mcp_resource_refs
    const defaultMcpResourceProviderNames = defaultMcpResourceRefs.map(defaultMcpResourceProviderName)
    const defaultMcpServers = defaultMcpServersForRefs(input.config, [
      ...defaultMcpToolRefs,
      ...defaultMcpPromptRefs,
      ...defaultMcpResourceRefs,
    ])
    const packageMcpToolRefs = active.builtIn ? [] : scheduler.package_mcp_tool_refs
    const packageMcpToolProviderNames = packageMcpToolRefs.map(packageMcpToolProviderName)
    const packageMcpPromptRefs = active.builtIn ? [] : scheduler.package_mcp_prompt_refs
    const packageMcpPromptProviderNames = packageMcpPromptRefs.map(packageMcpPromptProviderName)
    const packageMcpResourceRefs = active.builtIn ? [] : scheduler.package_mcp_resource_refs
    const packageMcpResourceProviderNames = packageMcpResourceRefs.map(packageMcpResourceProviderName)
    const projectedWorkflowToolRoles = workflowToolRoleMap(builtInToolIDs, input.config)
    const projectedWorkflowTools = [...projectedWorkflowToolRoles.keys()]
    for (const [workflowTool, role] of projectedWorkflowToolRoles) {
      if (!active.pkg.manifest.capability_projection.agents[role]) {
        throw new Error(
          `capability_projection.scheduler.${workflowTool} requires capability_projection.agents.${role}`,
        )
      }
    }
    return {
      promptProfileID: active.profileID,
      expertSquadID: active.pkg.id,
      capabilityProfileID: active.pkg.id,
      builtIn: active.builtIn,
      projectionHash: projectionHash({
        profileID: active.profileID,
        projection: scheduler,
        toolIDs: [
          ...builtInToolIDs,
          ...defaultToolProviderNames,
          ...packageToolProviderNames,
          ...defaultMcpToolProviderNames,
          ...packageMcpToolProviderNames,
        ],
        dynamicAttributes: active.pkg.manifest.dynamic_attributes,
      }),
      scheduler,
      builtInToolIDs,
      defaultToolRefs,
      defaultToolProviderNames,
      packageToolRefs,
      packageToolProviderNames,
      defaultMcpToolRefs,
      defaultMcpToolProviderNames,
      defaultMcpPromptRefs,
      defaultMcpPromptProviderNames,
      defaultMcpResourceRefs,
      defaultMcpResourceProviderNames,
      defaultMcpServers,
      packageMcpToolRefs,
      packageMcpToolProviderNames,
      packageMcpPromptRefs,
      packageMcpPromptProviderNames,
      packageMcpResourceRefs,
      packageMcpResourceProviderNames,
      packageRoot: active.builtIn ? undefined : active.pkg.root,
      projectedWorkflowTools,
      workflowBindings: [...(loadOptions?.workflowBindings ?? [])],
      dynamicAttributes: active.pkg.manifest.dynamic_attributes,
      includeMcpTools: false,
    }
  }

  export async function resolveFrontendDesignDynamicAttributes(
    input: SchedulerCapabilityInput,
  ): Promise<FrontendDesignDynamicAttributes> {
    const active = await packageForActiveProfile(input)
    return {
      requireDesignDirectionContract:
        active.pkg.manifest.dynamic_attributes.frontend_design.require_design_direction_contract,
    }
  }

  export async function resolveWorkerCapability(input: WorkerCapabilityInput): Promise<ResolvedWorkerCapability> {
    const loadOptions = packageLoadOptions(input.config)
    const active = await packageForActiveProfile(input)
    const projection = active.pkg.manifest.capability_projection.agents[input.agentID]
    if (!projection) {
      throw new Error(
        `Active expert squad ${JSON.stringify(active.profileID)} does not define capability_projection.agents.${input.agentID}`,
      )
    }
    const builtInToolIDs = expandedWorkerBuiltInToolIDs(input.agentID, projection)
    const defaultToolRefs = projection.default_tool_refs
    const defaultToolProviderNames = defaultToolRefs.map(defaultToolNameFromRef)
    const packageToolRefs = active.builtIn ? [] : projection.package_tool_refs
    const packageToolProviderNames = packageToolRefs.map(packageToolProviderName)
    const defaultMcpToolRefs = projection.default_mcp_tool_refs
    const defaultMcpToolProviderNames = defaultMcpToolRefs.map(defaultMcpToolProviderName)
    const defaultMcpPromptRefs = projection.default_mcp_prompt_refs
    const defaultMcpPromptProviderNames = defaultMcpPromptRefs.map(defaultMcpPromptProviderName)
    const defaultMcpResourceRefs = projection.default_mcp_resource_refs
    const defaultMcpResourceProviderNames = defaultMcpResourceRefs.map(defaultMcpResourceProviderName)
    const defaultMcpServers = defaultMcpServersForRefs(input.config, [
      ...defaultMcpToolRefs,
      ...defaultMcpPromptRefs,
      ...defaultMcpResourceRefs,
    ])
    const packageMcpToolRefs = active.builtIn ? [] : projection.package_mcp_tool_refs
    const packageMcpToolProviderNames = packageMcpToolRefs.map(packageMcpToolProviderName)
    const packageMcpPromptRefs = active.builtIn ? [] : projection.package_mcp_prompt_refs
    const packageMcpPromptProviderNames = packageMcpPromptRefs.map(packageMcpPromptProviderName)
    const packageMcpResourceRefs = active.builtIn ? [] : projection.package_mcp_resource_refs
    const packageMcpResourceProviderNames = packageMcpResourceRefs.map(packageMcpResourceProviderName)
    return {
      promptProfileID: active.profileID,
      expertSquadID: active.pkg.id,
      capabilityProfileID: active.pkg.id,
      agentID: input.agentID,
      builtIn: active.builtIn,
      projectionHash: projectionHash({
        profileID: active.profileID,
        projection,
        toolIDs: [
          ...builtInToolIDs,
          ...defaultToolProviderNames,
          ...packageToolProviderNames,
          ...defaultMcpToolProviderNames,
          ...packageMcpToolProviderNames,
        ],
        dynamicAttributes: active.pkg.manifest.dynamic_attributes,
      }),
      projection,
      builtInToolIDs,
      defaultToolRefs,
      defaultToolProviderNames,
      packageToolRefs,
      packageToolProviderNames,
      defaultMcpToolRefs,
      defaultMcpToolProviderNames,
      defaultMcpPromptRefs,
      defaultMcpPromptProviderNames,
      defaultMcpResourceRefs,
      defaultMcpResourceProviderNames,
      defaultMcpServers,
      packageMcpToolRefs,
      packageMcpToolProviderNames,
      packageMcpPromptRefs,
      packageMcpPromptProviderNames,
      packageMcpResourceRefs,
      packageMcpResourceProviderNames,
      packageRoot: active.builtIn ? undefined : active.pkg.root,
      workflowBindings: [...(loadOptions?.workflowBindings ?? [])],
      includeMcpTools: false,
    }
  }

  type AiSdkExecutionOptions = {
    abortSignal?: AbortSignal
    opencorvus?: {
      projectID?: unknown
      sessionID?: unknown
      messageID?: unknown
      toolCallID?: unknown
    }
  }

  function requirePackageToolExecutionContext(options: unknown, toolName: string) {
    const meta = (options as AiSdkExecutionOptions | undefined)?.opencorvus
    const sessionID = typeof meta?.sessionID === "string" ? meta.sessionID : ""
    const messageID = typeof meta?.messageID === "string" ? meta.messageID : ""
    const toolCallID = typeof meta?.toolCallID === "string" ? meta.toolCallID : undefined
    if (!sessionID || !messageID) {
      throw new Error(
        `${toolName}: missing real tool execution identity; refusing to run because ownership cannot be tied to a persisted message.`,
      )
    }
    return { sessionID, messageID, toolCallID }
  }

  function packageToolPath(pkg: Pick<ExpertSquadRegistry.LoadedPackage, "id" | "root" | "packageToolRefs">, ref: string): string {
    if (!pkg.packageToolRefs.has(ref)) {
      throw new Error(`Active expert squad ${pkg.id} projects missing package tool ${ref}.`)
    }
    const prefix = `${pkg.id}/`
    if (!ref.startsWith(prefix)) throw new Error(`Package tool ref ${JSON.stringify(ref)} is not namespaced by ${pkg.id}`)
    const parts = ref.slice(prefix.length).split("/")
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error(`Invalid package tool ref ${JSON.stringify(ref)}`)
    const [owner, toolID] = parts
    const base = owner === "shared" ? path.join(pkg.root, "tools") : path.join(pkg.root, "agents", owner, "tools")
    return path.join(base, `${toolID}.ts`)
  }

  async function resolvePackageToolFile(
    pkg: Pick<ExpertSquadRegistry.LoadedPackage, "id" | "root" | "packageToolRefs">,
    ref: string,
  ) {
    const tsPath = packageToolPath(pkg, ref)
    const candidates = [tsPath, tsPath.replace(/\.ts$/, ".js")]
    for (const candidate of candidates) {
      const info = await lstat(candidate).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      })
      if (!info) continue
      if (info.isSymbolicLink()) throw new Error(`Package tool ${ref}: symbolic links are not allowed`)
      if (!info.isFile()) throw new Error(`Package tool ${ref}: expected file`)
      const [realRoot, realTarget] = await Promise.all([realpath(pkg.root), realpath(candidate)])
      if (!Filesystem.contains(realRoot, realTarget)) {
        throw new Error(`Package tool ${ref}: path escapes expert squad package root`)
      }
      return candidate
    }
    throw new Error(`Active expert squad ${pkg.id} projects missing package tool ${ref}.`)
  }

  function isToolDefinition(value: unknown): value is ToolDefinition {
    if (!value || typeof value !== "object") return false
    const candidate = value as Partial<ToolDefinition>
    return (
      typeof candidate.description === "string" &&
      Boolean(candidate.args) &&
      typeof candidate.args === "object" &&
      !Array.isArray(candidate.args) &&
      typeof candidate.execute === "function"
    )
  }

  async function bundlePackageTool(sourcePath: string, ref: string): Promise<string> {
    if (typeof Bun === "undefined") {
      throw new Error(`Package tool ${ref}: Bun runtime is required to compile expert-squad package tools.`)
    }
    const source = await readFile(sourcePath, "utf8")
    const runtimePluginPath = runtimePackageRequire().resolve("@opencorvus-ai/plugin")
    const cacheKey = createHash("sha256")
      .update(sourcePath)
      .update("\0")
      .update(source)
      .update("\0")
      .update(runtimePluginPath)
      .digest("hex")
    const outdir = path.join(os.tmpdir(), "opencorvus-expert-squad-package-tools")
    await mkdir(outdir, { recursive: true })
    const result = await Bun.build({
      entrypoints: [sourcePath],
      outdir,
      naming: `${cacheKey}.mjs`,
      target: "bun",
      format: "esm",
      packages: "bundle",
      plugins: [
        {
          name: "opencorvus-package-tool-runtime-abi",
          setup(build) {
            build.onResolve({ filter: /^@opencorvus-ai\/plugin$/ }, () => ({ path: runtimePluginPath }))
          },
        },
      ],
    })
    if (!result.success) {
      const detail = result.logs.map((item) => item.message).join("; ")
      throw new Error(`Package tool ${ref}: failed to compile ${sourcePath}: ${detail}`)
    }
    const output = result.outputs.at(0)
    if (!output?.path) throw new Error(`Package tool ${ref}: compile succeeded without a written output path.`)
    return output.path
  }

  async function importPackageToolDefinition(sourcePath: string, ref: string): Promise<ToolDefinition> {
    const bundledPath = await bundlePackageTool(sourcePath, ref)
    const imported = (await import(pathToFileURL(bundledPath).href)) as { default?: unknown }
    if (!isToolDefinition(imported.default)) {
      throw new Error(`Package tool ${ref} must export default ToolDefinition from @opencorvus-ai/plugin.`)
    }
    return imported.default
  }

  async function packageToolFromDefinition(input: {
    pkg: Pick<ExpertSquadRegistry.LoadedPackage, "id" | "root" | "packageToolRefs">
    ref: string
    providerName: string
    agentID: AgentRoleID
    projectDirectory: string
    toolDirectory?: string
    signal?: AbortSignal
  }) {
    const sourcePath = await resolvePackageToolFile(input.pkg, input.ref)
    const definition = await importPackageToolDefinition(sourcePath, input.ref)
    return tool({
      description: definition.description,
      inputSchema: z.object(definition.args),
      async execute(args, options) {
        const identity = requirePackageToolExecutionContext(options, input.providerName)
        const abort =
          (options as AiSdkExecutionOptions | undefined)?.abortSignal ?? input.signal ?? new AbortController().signal
        const pluginContext: PluginToolContext = {
          sessionID: identity.sessionID,
          messageID: identity.messageID,
          agent: input.agentID,
          directory: input.toolDirectory ?? input.projectDirectory,
          worktree: input.toolDirectory ?? input.projectDirectory,
          abort,
          metadata: () => {},
          ask: async () => {
            throw new Error(`Package tool ${input.ref} cannot request permissions in ${input.agentID} projection.`)
          },
        }
        const result = await definition.execute(args as never, pluginContext)
        if (typeof result !== "string") throw new Error(`Package tool ${input.ref} returned non-string output.`)
        const truncated = await Truncate.output(result, { sessionID: identity.sessionID })
        return {
          title: "",
          output: truncated.content,
          metadata: {
            package_tool_ref: input.ref,
            expert_squad_id: input.pkg.id,
            provider_tool_name: input.providerName,
            source_path: sourcePath,
            truncated: truncated.truncated,
            ...(truncated.truncated ? { outputPath: truncated.outputPath } : {}),
          },
        }
      },
    })
  }

  async function schedulerPackageTools<T>(
    capability: ResolvedSchedulerCapability,
    input: { projectDirectory?: string; signal?: AbortSignal } = {},
  ): Promise<Record<string, T>> {
    if (capability.builtIn || capability.packageToolRefs.length === 0) return {}
    if (!capability.packageRoot) throw new Error(`Active expert squad ${capability.promptProfileID} has no package root.`)
    if (!input.projectDirectory) {
      throw new Error(
        `Active expert squad ${capability.promptProfileID} projects package tools, but no project directory was supplied.`,
      )
    }
    const pkg = await ExpertSquadRegistry.loadPackage(capability.packageRoot, {
      workflowBindings: capability.workflowBindings,
    })
    if (pkg.id !== capability.expertSquadID) {
      throw new Error(`Active expert squad package root resolved to ${pkg.id}, expected ${capability.expertSquadID}.`)
    }
    const result: Record<string, T> = {}
    const seenRefs = new Set<string>()
    for (let index = 0; index < capability.packageToolRefs.length; index++) {
      const ref = capability.packageToolRefs[index]!
      if (seenRefs.has(ref)) throw new Error(`Active expert squad ${capability.promptProfileID} repeats package tool ${ref}.`)
      seenRefs.add(ref)
      const providerName = capability.packageToolProviderNames[index] ?? packageToolProviderName(ref)
      if (Object.hasOwn(result, providerName)) {
        throw new Error(`Package tool provider name collision for ${ref}: ${providerName}`)
      }
      result[providerName] = (await packageToolFromDefinition({
        pkg,
        ref,
        providerName,
        agentID: "orchestrator",
        projectDirectory: input.projectDirectory,
        signal: input.signal,
      })) as T
    }
    return result
  }

  async function workerPackageTools<T>(
    capability: ResolvedWorkerCapability,
    input: { projectDirectory?: string; toolDirectory?: string; signal?: AbortSignal } = {},
  ): Promise<Record<string, T>> {
    if (capability.builtIn || capability.packageToolRefs.length === 0) return {}
    if (!capability.packageRoot) throw new Error(`Active expert squad ${capability.promptProfileID} has no package root.`)
    if (!input.projectDirectory) {
      throw new Error(
        `Active expert squad ${capability.promptProfileID} projects worker package tools, but no project directory was supplied.`,
      )
    }
    const pkg = await ExpertSquadRegistry.loadPackage(capability.packageRoot, {
      workflowBindings: capability.workflowBindings,
    })
    if (pkg.id !== capability.expertSquadID) {
      throw new Error(`Active expert squad package root resolved to ${pkg.id}, expected ${capability.expertSquadID}.`)
    }
    const result: Record<string, T> = {}
    const seenRefs = new Set<string>()
    for (let index = 0; index < capability.packageToolRefs.length; index++) {
      const ref = capability.packageToolRefs[index]!
      if (seenRefs.has(ref)) throw new Error(`Active expert squad ${capability.promptProfileID} repeats package tool ${ref}.`)
      seenRefs.add(ref)
      const providerName = capability.packageToolProviderNames[index] ?? packageToolProviderName(ref)
      if (Object.hasOwn(result, providerName)) {
        throw new Error(`Package tool provider name collision for ${ref}: ${providerName}`)
      }
      result[providerName] = (await packageToolFromDefinition({
        pkg,
        ref,
        providerName,
        agentID: capability.agentID,
        projectDirectory: input.projectDirectory,
        toolDirectory: input.toolDirectory,
        signal: input.signal,
      })) as T
    }
    return result
  }

  function packageMcpServerRefFromToolRef(ref: string): string {
    return packageMcpTypedPartsFromRef(ref, "tool").serverRef
  }

  function packageMcpToolNameFromRef(ref: string): string {
    return packageMcpTypedPartsFromRef(ref, "tool").itemName
  }

  function packageMcpServerRefFromPromptRef(ref: string): string {
    return packageMcpTypedPartsFromRef(ref, "prompt").serverRef
  }

  function packageMcpPromptNameFromRef(ref: string): string {
    return packageMcpTypedPartsFromRef(ref, "prompt").itemName
  }

  function packageMcpServerRefFromResourceRef(ref: string): string {
    return packageMcpTypedPartsFromRef(ref, "resource").serverRef
  }

  function packageMcpResourceNameFromRef(ref: string): string {
    return packageMcpTypedPartsFromRef(ref, "resource").itemName
  }

  function packageMcpTypedPartsFromRef(
    ref: string,
    kind: McpCapabilityKind,
  ): { serverRef: string; itemName: string } {
    const marker = `/${kind}/`
    const index = ref.lastIndexOf(marker)
    if (index < 0) throw new Error(`Invalid package MCP ${kind} ref ${JSON.stringify(ref)}`)
    const itemName = ref.slice(index + marker.length)
    if (!itemName || /[/\\]/.test(itemName)) throw new Error(`Invalid package MCP ${kind} ref ${JSON.stringify(ref)}`)
    return { serverRef: ref.slice(0, index), itemName }
  }

  function packageMcpServerPath(
    pkg: Pick<ExpertSquadRegistry.LoadedPackage, "id" | "root" | "packageMcpServerRefs">,
    serverRef: string,
  ): string {
    if (!pkg.packageMcpServerRefs.has(serverRef)) {
      throw new Error(`Active expert squad ${pkg.id} projects missing package MCP server ${serverRef}.`)
    }
    const prefix = `${pkg.id}/`
    if (!serverRef.startsWith(prefix)) {
      throw new Error(`Package MCP server ref ${JSON.stringify(serverRef)} is not namespaced by ${pkg.id}`)
    }
    const parts = serverRef.slice(prefix.length).split("/")
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`Invalid package MCP server ref ${JSON.stringify(serverRef)}`)
    }
    const [owner, serverID] = parts
    const base = owner === "shared" ? path.join(pkg.root, "mcp") : path.join(pkg.root, "agents", owner, "mcp")
    return path.join(base, `${serverID}.jsonc`)
  }

  async function resolvePackageMcpDefinitionFile(
    pkg: Pick<ExpertSquadRegistry.LoadedPackage, "id" | "root" | "packageMcpServerRefs">,
    serverRef: string,
  ) {
    const jsoncPath = packageMcpServerPath(pkg, serverRef)
    const candidates = [jsoncPath, jsoncPath.replace(/\.jsonc$/, ".json")]
    for (const candidate of candidates) {
      const info = await lstat(candidate).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      })
      if (!info) continue
      if (info.isSymbolicLink()) throw new Error(`Package MCP server ${serverRef}: symbolic links are not allowed`)
      if (!info.isFile()) throw new Error(`Package MCP server ${serverRef}: expected file`)
      const [realRoot, realTarget] = await Promise.all([realpath(pkg.root), realpath(candidate)])
      if (!Filesystem.contains(realRoot, realTarget)) {
        throw new Error(`Package MCP server ${serverRef}: path escapes expert squad package root`)
      }
      return candidate
    }
    throw new Error(`Active expert squad ${pkg.id} projects missing package MCP server ${serverRef}.`)
  }

  function mcpConfigFromDefinition(definition: ExpertSquadRegistry.McpDefinition): Config.Mcp {
    const { capabilities: _capabilities, ...config } = definition
    return Config.Mcp.parse(config)
  }

  export interface ProjectedMcpPrompt extends MCP.PromptInfo {
    ref: string
    providerName: string
    sourcePath?: string
    get(args?: Record<string, string>): Promise<MCP.GetPromptResult>
  }

  export interface ProjectedMcpResource extends MCP.ResourceInfo {
    ref: string
    providerName: string
    sourcePath?: string
    read(): Promise<MCP.ReadResourceResult>
  }

  async function defaultMcpPromptFromConfig(input: {
    ref: string
    providerName: string
    mcpServers: Record<string, Config.Mcp>
    cwd: string
  }): Promise<ProjectedMcpPrompt> {
    const { serverName, promptName } = defaultMcpPromptPartsFromRef(input.ref)
    const mcp = input.mcpServers[serverName]
    if (!mcp) throw new Error(`Active expert squad projects missing default MCP server default/mcp/${serverName}.`)
    const info = await MCP.scopedPromptInfo({
      key: input.providerName,
      mcp,
      promptName,
      cwd: input.cwd,
    })
    return {
      ...info,
      ref: input.ref,
      providerName: input.providerName,
      get: (args?: Record<string, string>) =>
        MCP.getScopedPrompt({
          key: input.providerName,
          mcp,
          promptName,
          cwd: input.cwd,
          args,
        }),
    }
  }

  async function defaultMcpResourceFromConfig(input: {
    ref: string
    providerName: string
    mcpServers: Record<string, Config.Mcp>
    cwd: string
  }): Promise<ProjectedMcpResource> {
    const { serverName, resourceName } = defaultMcpResourcePartsFromRef(input.ref)
    const mcp = input.mcpServers[serverName]
    if (!mcp) throw new Error(`Active expert squad projects missing default MCP server default/mcp/${serverName}.`)
    const info = await MCP.scopedResourceInfo({
      key: input.providerName,
      mcp,
      resourceName,
      cwd: input.cwd,
    })
    return {
      ...info,
      ref: input.ref,
      providerName: input.providerName,
      read: () =>
        MCP.readScopedResource({
          key: input.providerName,
          mcp,
          resourceName,
          cwd: input.cwd,
        }),
    }
  }

  async function packageMcpPromptFromDefinition(input: {
    pkg: Pick<
      ExpertSquadRegistry.LoadedPackage,
      "id" | "root" | "packageMcpServerRefs" | "packageMcpPromptRefs"
    >
    ref: string
    providerName: string
  }): Promise<ProjectedMcpPrompt> {
    if (!input.pkg.packageMcpPromptRefs.has(input.ref)) {
      throw new Error(`Active expert squad ${input.pkg.id} projects missing package MCP prompt ${input.ref}.`)
    }
    const serverRef = packageMcpServerRefFromPromptRef(input.ref)
    const promptName = packageMcpPromptNameFromRef(input.ref)
    const sourcePath = await resolvePackageMcpDefinitionFile(input.pkg, serverRef)
    const definition = ExpertSquadRegistry.parseMcpDefinitionText(await readFile(sourcePath, "utf8"), sourcePath)
    const mcp = mcpConfigFromDefinition(definition)
    const cwd = path.dirname(sourcePath)
    const info = await MCP.scopedPromptInfo({
      key: input.providerName,
      mcp,
      promptName,
      cwd,
    })
    return {
      ...info,
      ref: input.ref,
      providerName: input.providerName,
      sourcePath,
      get: (args?: Record<string, string>) =>
        MCP.getScopedPrompt({
          key: input.providerName,
          mcp,
          promptName,
          cwd,
          args,
        }),
    }
  }

  async function packageMcpResourceFromDefinition(input: {
    pkg: Pick<
      ExpertSquadRegistry.LoadedPackage,
      "id" | "root" | "packageMcpServerRefs" | "packageMcpResourceRefs"
    >
    ref: string
    providerName: string
  }): Promise<ProjectedMcpResource> {
    if (!input.pkg.packageMcpResourceRefs.has(input.ref)) {
      throw new Error(`Active expert squad ${input.pkg.id} projects missing package MCP resource ${input.ref}.`)
    }
    const serverRef = packageMcpServerRefFromResourceRef(input.ref)
    const resourceName = packageMcpResourceNameFromRef(input.ref)
    const sourcePath = await resolvePackageMcpDefinitionFile(input.pkg, serverRef)
    const definition = ExpertSquadRegistry.parseMcpDefinitionText(await readFile(sourcePath, "utf8"), sourcePath)
    const mcp = mcpConfigFromDefinition(definition)
    const cwd = path.dirname(sourcePath)
    const info = await MCP.scopedResourceInfo({
      key: input.providerName,
      mcp,
      resourceName,
      cwd,
    })
    return {
      ...info,
      ref: input.ref,
      providerName: input.providerName,
      sourcePath,
      read: () =>
        MCP.readScopedResource({
          key: input.providerName,
          mcp,
          resourceName,
          cwd,
        }),
    }
  }

  async function packageMcpToolFromDefinition(input: {
    pkg: Pick<
      ExpertSquadRegistry.LoadedPackage,
      "id" | "root" | "packageMcpServerRefs" | "packageMcpToolRefs"
    >
    ref: string
    providerName: string
  }) {
    if (!input.pkg.packageMcpToolRefs.has(input.ref)) {
      throw new Error(`Active expert squad ${input.pkg.id} projects missing package MCP tool ${input.ref}.`)
    }
    const serverRef = packageMcpServerRefFromToolRef(input.ref)
    const toolName = packageMcpToolNameFromRef(input.ref)
    const sourcePath = await resolvePackageMcpDefinitionFile(input.pkg, serverRef)
    const definition = ExpertSquadRegistry.parseMcpDefinitionText(await readFile(sourcePath, "utf8"), sourcePath)
    const rawTool = await MCP.scopedTool({
      key: input.providerName,
      mcp: mcpConfigFromDefinition(definition),
      toolName,
      cwd: path.dirname(sourcePath),
    })
    const execute = (rawTool as { execute?: (args: unknown, options?: unknown) => unknown }).execute
    if (typeof execute !== "function") throw new Error(`Package MCP tool ${input.ref} is not executable.`)
    return {
      ...(rawTool as object),
      async execute(args: unknown, options: unknown) {
        const identity = requirePackageToolExecutionContext(options, input.providerName)
        const result = (await execute(args, options)) as Awaited<ReturnType<typeof MCP.callScopedTool>>
        const meta = (options as AiSdkExecutionOptions | undefined)?.opencorvus
        const projectID = typeof meta?.projectID === "string" ? meta.projectID : Instance.project.id
        const materialized = await materializeMcpToolResult({
          projectID,
          result,
        })
        const truncated = await Truncate.output(materialized.text, { sessionID: identity.sessionID })
        return {
          title: "",
          output: truncated.content,
          metadata: {
            ...materialized.metadata,
            package_mcp_tool_ref: input.ref,
            expert_squad_id: input.pkg.id,
            provider_tool_name: input.providerName,
            source_path: sourcePath,
            truncated: truncated.truncated,
            ...(truncated.truncated ? { outputPath: truncated.outputPath } : {}),
          },
          attachments: materialized.attachments,
          content: result.content,
        }
      },
    }
  }

  function defaultToolsFromRuntimeMap<T>(input: {
    tools: Record<string, T>
    refs: readonly string[]
    providerNames: readonly string[]
    context: string
  }): Record<string, T> {
    const result: Record<string, T> = {}
    const seenRefs = new Set<string>()
    for (let index = 0; index < input.refs.length; index++) {
      const ref = input.refs[index]!
      if (seenRefs.has(ref)) throw new Error(`${input.context} repeats default tool ${ref}.`)
      seenRefs.add(ref)
      const providerName = input.providerNames[index] ?? defaultToolNameFromRef(ref)
      if (Object.hasOwn(result, providerName)) {
        throw new Error(`${input.context} default tool provider name collision for ${ref}: ${providerName}`)
      }
      if (!Object.hasOwn(input.tools, providerName)) {
        throw new Error(`${input.context} projects default tool ${ref}, but runtime tool ${providerName} is not available.`)
      }
      result[providerName] = input.tools[providerName]!
    }
    return result
  }

  async function defaultMcpToolFromConfig(input: {
    ref: string
    providerName: string
    mcpServers: Record<string, Config.Mcp>
    cwd: string
  }) {
    const { serverName, toolName } = defaultMcpToolPartsFromRef(input.ref)
    const mcp = input.mcpServers[serverName]
    if (!mcp) throw new Error(`Active expert squad projects missing default MCP server default/mcp/${serverName}.`)
    const rawTool = await MCP.scopedTool({
      key: input.providerName,
      mcp,
      toolName,
      cwd: input.cwd,
    })
    const execute = (rawTool as { execute?: (args: unknown, options?: unknown) => unknown }).execute
    if (typeof execute !== "function") throw new Error(`Default MCP tool ${input.ref} is not executable.`)
    return {
      ...(rawTool as object),
      async execute(args: unknown, options: unknown) {
        const identity = requirePackageToolExecutionContext(options, input.providerName)
        const result = (await execute(args, options)) as Awaited<ReturnType<typeof MCP.callScopedTool>>
        const meta = (options as AiSdkExecutionOptions | undefined)?.opencorvus
        const projectID = typeof meta?.projectID === "string" ? meta.projectID : Instance.project.id
        const materialized = await materializeMcpToolResult({
          projectID,
          result,
        })
        const truncated = await Truncate.output(materialized.text, { sessionID: identity.sessionID })
        return {
          title: "",
          output: truncated.content,
          metadata: {
            ...materialized.metadata,
            default_mcp_tool_ref: input.ref,
            default_mcp_server: serverName,
            provider_tool_name: input.providerName,
            truncated: truncated.truncated,
            ...(truncated.truncated ? { outputPath: truncated.outputPath } : {}),
          },
          attachments: materialized.attachments,
          content: result.content,
        }
      },
    }
  }

  async function defaultMcpTools<T>(input: {
    refs: readonly string[]
    providerNames: readonly string[]
    mcpServers: Record<string, Config.Mcp>
    cwd: string
    context: string
  }): Promise<Record<string, T>> {
    const result: Record<string, T> = {}
    const seenRefs = new Set<string>()
    for (let index = 0; index < input.refs.length; index++) {
      const ref = input.refs[index]!
      if (seenRefs.has(ref)) throw new Error(`${input.context} repeats default MCP tool ${ref}.`)
      seenRefs.add(ref)
      const providerName = input.providerNames[index] ?? defaultMcpToolProviderName(ref)
      if (Object.hasOwn(result, providerName)) {
        throw new Error(`${input.context} default MCP tool provider name collision for ${ref}: ${providerName}`)
      }
      result[providerName] = (await defaultMcpToolFromConfig({
        ref,
        providerName,
        mcpServers: input.mcpServers,
        cwd: input.cwd,
      })) as T
    }
    return result
  }

  async function defaultMcpPrompts(input: {
    refs: readonly string[]
    providerNames: readonly string[]
    mcpServers: Record<string, Config.Mcp>
    cwd: string
    context: string
  }): Promise<Record<string, ProjectedMcpPrompt>> {
    const result: Record<string, ProjectedMcpPrompt> = {}
    const seenRefs = new Set<string>()
    for (let index = 0; index < input.refs.length; index++) {
      const ref = input.refs[index]!
      if (seenRefs.has(ref)) throw new Error(`${input.context} repeats default MCP prompt ${ref}.`)
      seenRefs.add(ref)
      const providerName = input.providerNames[index] ?? defaultMcpPromptProviderName(ref)
      if (Object.hasOwn(result, providerName)) {
        throw new Error(`${input.context} default MCP prompt provider name collision for ${ref}: ${providerName}`)
      }
      result[providerName] = await defaultMcpPromptFromConfig({
        ref,
        providerName,
        mcpServers: input.mcpServers,
        cwd: input.cwd,
      })
    }
    return result
  }

  async function defaultMcpResources(input: {
    refs: readonly string[]
    providerNames: readonly string[]
    mcpServers: Record<string, Config.Mcp>
    cwd: string
    context: string
  }): Promise<Record<string, ProjectedMcpResource>> {
    const result: Record<string, ProjectedMcpResource> = {}
    const seenRefs = new Set<string>()
    for (let index = 0; index < input.refs.length; index++) {
      const ref = input.refs[index]!
      if (seenRefs.has(ref)) throw new Error(`${input.context} repeats default MCP resource ${ref}.`)
      seenRefs.add(ref)
      const providerName = input.providerNames[index] ?? defaultMcpResourceProviderName(ref)
      if (Object.hasOwn(result, providerName)) {
        throw new Error(`${input.context} default MCP resource provider name collision for ${ref}: ${providerName}`)
      }
      result[providerName] = await defaultMcpResourceFromConfig({
        ref,
        providerName,
        mcpServers: input.mcpServers,
        cwd: input.cwd,
      })
    }
    return result
  }

  type PackageMcpProjectionCapability = {
    builtIn: boolean
    promptProfileID: string
    expertSquadID: string
    packageRoot?: string
    workflowBindings: SchedulerAgentWorkflowBinding[]
  }

  async function loadActivePackageForMcpProjection(
    capability: PackageMcpProjectionCapability,
    input: { projectDirectory?: string },
    context: string,
  ) {
    if (!capability.packageRoot) throw new Error(`Active expert squad ${capability.promptProfileID} has no package root.`)
    if (!input.projectDirectory) {
      throw new Error(
        `Active expert squad ${capability.promptProfileID} projects ${context}, but no project directory was supplied.`,
      )
    }
    const pkg = await ExpertSquadRegistry.loadPackage(capability.packageRoot, {
      workflowBindings: capability.workflowBindings,
    })
    if (pkg.id !== capability.expertSquadID) {
      throw new Error(`Active expert squad package root resolved to ${pkg.id}, expected ${capability.expertSquadID}.`)
    }
    return pkg
  }

  async function packageMcpPrompts(input: {
    capability: PackageMcpProjectionCapability
    refs: readonly string[]
    providerNames: readonly string[]
    projectDirectory?: string
    context: string
  }): Promise<Record<string, ProjectedMcpPrompt>> {
    if (input.capability.builtIn || input.refs.length === 0) return {}
    const pkg = await loadActivePackageForMcpProjection(input.capability, input, input.context)
    const result: Record<string, ProjectedMcpPrompt> = {}
    const seenRefs = new Set<string>()
    for (let index = 0; index < input.refs.length; index++) {
      const ref = input.refs[index]!
      if (seenRefs.has(ref)) throw new Error(`Active expert squad ${input.capability.promptProfileID} repeats ${input.context} ${ref}.`)
      seenRefs.add(ref)
      const providerName = input.providerNames[index] ?? packageMcpPromptProviderName(ref)
      if (Object.hasOwn(result, providerName)) {
        throw new Error(`Package MCP prompt provider name collision for ${ref}: ${providerName}`)
      }
      result[providerName] = await packageMcpPromptFromDefinition({
        pkg,
        ref,
        providerName,
      })
    }
    return result
  }

  async function packageMcpResources(input: {
    capability: PackageMcpProjectionCapability
    refs: readonly string[]
    providerNames: readonly string[]
    projectDirectory?: string
    context: string
  }): Promise<Record<string, ProjectedMcpResource>> {
    if (input.capability.builtIn || input.refs.length === 0) return {}
    const pkg = await loadActivePackageForMcpProjection(input.capability, input, input.context)
    const result: Record<string, ProjectedMcpResource> = {}
    const seenRefs = new Set<string>()
    for (let index = 0; index < input.refs.length; index++) {
      const ref = input.refs[index]!
      if (seenRefs.has(ref)) throw new Error(`Active expert squad ${input.capability.promptProfileID} repeats ${input.context} ${ref}.`)
      seenRefs.add(ref)
      const providerName = input.providerNames[index] ?? packageMcpResourceProviderName(ref)
      if (Object.hasOwn(result, providerName)) {
        throw new Error(`Package MCP resource provider name collision for ${ref}: ${providerName}`)
      }
      result[providerName] = await packageMcpResourceFromDefinition({
        pkg,
        ref,
        providerName,
      })
    }
    return result
  }

  async function schedulerPackageMcpTools<T>(
    capability: ResolvedSchedulerCapability,
    input: { projectDirectory?: string } = {},
  ): Promise<Record<string, T>> {
    if (capability.builtIn || capability.packageMcpToolRefs.length === 0) return {}
    if (!capability.packageRoot) throw new Error(`Active expert squad ${capability.promptProfileID} has no package root.`)
    if (!input.projectDirectory) {
      throw new Error(
        `Active expert squad ${capability.promptProfileID} projects package MCP tools, but no project directory was supplied.`,
      )
    }
    const pkg = await ExpertSquadRegistry.loadPackage(capability.packageRoot, {
      workflowBindings: capability.workflowBindings,
    })
    if (pkg.id !== capability.expertSquadID) {
      throw new Error(`Active expert squad package root resolved to ${pkg.id}, expected ${capability.expertSquadID}.`)
    }
    const result: Record<string, T> = {}
    const seenRefs = new Set<string>()
    for (let index = 0; index < capability.packageMcpToolRefs.length; index++) {
      const ref = capability.packageMcpToolRefs[index]!
      if (seenRefs.has(ref)) {
        throw new Error(`Active expert squad ${capability.promptProfileID} repeats package MCP tool ${ref}.`)
      }
      seenRefs.add(ref)
      const providerName = capability.packageMcpToolProviderNames[index] ?? packageMcpToolProviderName(ref)
      if (Object.hasOwn(result, providerName)) {
        throw new Error(`Package MCP tool provider name collision for ${ref}: ${providerName}`)
      }
      result[providerName] = (await packageMcpToolFromDefinition({
        pkg,
        ref,
        providerName,
      })) as T
    }
    return result
  }

  async function workerPackageMcpTools<T>(
    capability: ResolvedWorkerCapability,
    input: { projectDirectory?: string } = {},
  ): Promise<Record<string, T>> {
    if (capability.builtIn || capability.packageMcpToolRefs.length === 0) return {}
    if (!capability.packageRoot) throw new Error(`Active expert squad ${capability.promptProfileID} has no package root.`)
    if (!input.projectDirectory) {
      throw new Error(
        `Active expert squad ${capability.promptProfileID} projects worker package MCP tools, but no project directory was supplied.`,
      )
    }
    const pkg = await ExpertSquadRegistry.loadPackage(capability.packageRoot, {
      workflowBindings: capability.workflowBindings,
    })
    if (pkg.id !== capability.expertSquadID) {
      throw new Error(`Active expert squad package root resolved to ${pkg.id}, expected ${capability.expertSquadID}.`)
    }
    const result: Record<string, T> = {}
    const seenRefs = new Set<string>()
    for (let index = 0; index < capability.packageMcpToolRefs.length; index++) {
      const ref = capability.packageMcpToolRefs[index]!
      if (seenRefs.has(ref)) {
        throw new Error(`Active expert squad ${capability.promptProfileID} repeats package MCP tool ${ref}.`)
      }
      seenRefs.add(ref)
      const providerName = capability.packageMcpToolProviderNames[index] ?? packageMcpToolProviderName(ref)
      if (Object.hasOwn(result, providerName)) {
        throw new Error(`Package MCP tool provider name collision for ${ref}: ${providerName}`)
      }
      result[providerName] = (await packageMcpToolFromDefinition({
        pkg,
        ref,
        providerName,
      })) as T
    }
    return result
  }

  function mergeMcpProjectionMap<T>(
    defaults: Record<string, T>,
    packageItems: Record<string, T>,
    context: string,
    kind: string,
  ): Record<string, T> {
    const projected: Record<string, T> = { ...defaults }
    for (const [providerName, item] of Object.entries(packageItems)) {
      if (Object.hasOwn(projected, providerName)) {
        throw new Error(`${context} package MCP ${kind} provider name ${JSON.stringify(providerName)} collides with a default MCP ${kind}.`)
      }
      projected[providerName] = item
    }
    return projected
  }

  export async function projectSchedulerMcpPrompts(
    capability: ResolvedSchedulerCapability,
    input: { projectDirectory?: string } = {},
  ): Promise<Record<string, ProjectedMcpPrompt>> {
    if (capability.defaultMcpPromptRefs.length > 0 && !input.projectDirectory) {
      throw new Error(
        `Active expert squad ${capability.promptProfileID} projects default MCP prompts, but no project directory was supplied.`,
      )
    }
    const context = `Active expert squad ${JSON.stringify(capability.promptProfileID)}`
    const defaults =
      capability.defaultMcpPromptRefs.length > 0
        ? await defaultMcpPrompts({
            refs: capability.defaultMcpPromptRefs,
            providerNames: capability.defaultMcpPromptProviderNames,
            mcpServers: capability.defaultMcpServers,
            cwd: input.projectDirectory!,
            context,
          })
        : {}
    const packageItems = await packageMcpPrompts({
      capability,
      refs: capability.packageMcpPromptRefs,
      providerNames: capability.packageMcpPromptProviderNames,
      projectDirectory: input.projectDirectory,
      context: "package MCP prompts",
    })
    return mergeMcpProjectionMap(defaults, packageItems, context, "prompt")
  }

  export async function projectWorkerMcpPrompts(
    capability: ResolvedWorkerCapability,
    input: { projectDirectory?: string; toolDirectory?: string } = {},
  ): Promise<Record<string, ProjectedMcpPrompt>> {
    if (capability.defaultMcpPromptRefs.length > 0 && !input.projectDirectory) {
      throw new Error(
        `Active expert squad ${capability.promptProfileID} projects worker default MCP prompts, but no project directory was supplied.`,
      )
    }
    const context = `Active expert squad ${JSON.stringify(capability.promptProfileID)} ${capability.agentID}`
    const defaults =
      capability.defaultMcpPromptRefs.length > 0
        ? await defaultMcpPrompts({
            refs: capability.defaultMcpPromptRefs,
            providerNames: capability.defaultMcpPromptProviderNames,
            mcpServers: capability.defaultMcpServers,
            cwd: input.toolDirectory ?? input.projectDirectory!,
            context,
          })
        : {}
    const packageItems = await packageMcpPrompts({
      capability,
      refs: capability.packageMcpPromptRefs,
      providerNames: capability.packageMcpPromptProviderNames,
      projectDirectory: input.projectDirectory,
      context: "worker package MCP prompts",
    })
    return mergeMcpProjectionMap(defaults, packageItems, context, "prompt")
  }

  export async function projectSchedulerMcpResources(
    capability: ResolvedSchedulerCapability,
    input: { projectDirectory?: string } = {},
  ): Promise<Record<string, ProjectedMcpResource>> {
    if (capability.defaultMcpResourceRefs.length > 0 && !input.projectDirectory) {
      throw new Error(
        `Active expert squad ${capability.promptProfileID} projects default MCP resources, but no project directory was supplied.`,
      )
    }
    const context = `Active expert squad ${JSON.stringify(capability.promptProfileID)}`
    const defaults =
      capability.defaultMcpResourceRefs.length > 0
        ? await defaultMcpResources({
            refs: capability.defaultMcpResourceRefs,
            providerNames: capability.defaultMcpResourceProviderNames,
            mcpServers: capability.defaultMcpServers,
            cwd: input.projectDirectory!,
            context,
          })
        : {}
    const packageItems = await packageMcpResources({
      capability,
      refs: capability.packageMcpResourceRefs,
      providerNames: capability.packageMcpResourceProviderNames,
      projectDirectory: input.projectDirectory,
      context: "package MCP resources",
    })
    return mergeMcpProjectionMap(defaults, packageItems, context, "resource")
  }

  export async function projectWorkerMcpResources(
    capability: ResolvedWorkerCapability,
    input: { projectDirectory?: string; toolDirectory?: string } = {},
  ): Promise<Record<string, ProjectedMcpResource>> {
    if (capability.defaultMcpResourceRefs.length > 0 && !input.projectDirectory) {
      throw new Error(
        `Active expert squad ${capability.promptProfileID} projects worker default MCP resources, but no project directory was supplied.`,
      )
    }
    const context = `Active expert squad ${JSON.stringify(capability.promptProfileID)} ${capability.agentID}`
    const defaults =
      capability.defaultMcpResourceRefs.length > 0
        ? await defaultMcpResources({
            refs: capability.defaultMcpResourceRefs,
            providerNames: capability.defaultMcpResourceProviderNames,
            mcpServers: capability.defaultMcpServers,
            cwd: input.toolDirectory ?? input.projectDirectory!,
            context,
          })
        : {}
    const packageItems = await packageMcpResources({
      capability,
      refs: capability.packageMcpResourceRefs,
      providerNames: capability.packageMcpResourceProviderNames,
      projectDirectory: input.projectDirectory,
      context: "worker package MCP resources",
    })
    return mergeMcpProjectionMap(defaults, packageItems, context, "resource")
  }

  function stringifyMcpProjectionPayload(payload: unknown, context: string): string {
    const text = JSON.stringify(payload, null, 2)
    if (typeof text !== "string") throw new Error(`${context} returned no JSON-serializable payload.`)
    return text
  }

  function renderMcpProjectionBlock(input: {
    kind: "prompt" | "resource"
    providerName: string
    ref: string
    sourcePath?: string
    payload: unknown
  }): string {
    return [
      `### MCP ${input.kind}: ${input.providerName}`,
      "",
      `ref: ${input.ref}`,
      ...(input.sourcePath ? [`source: ${input.sourcePath}`] : []),
      "",
      "```json",
      stringifyMcpProjectionPayload(input.payload, `MCP ${input.kind} ${input.ref}`),
      "```",
    ].join("\n")
  }

  async function renderProjectedMcpContext(input: {
    prompts: Record<string, ProjectedMcpPrompt>
    resources: Record<string, ProjectedMcpResource>
  }): Promise<string | undefined> {
    const promptEntries = Object.entries(input.prompts)
    const resourceEntries = Object.entries(input.resources)
    if (promptEntries.length === 0 && resourceEntries.length === 0) return undefined
    const promptBlocks = await Promise.all(
      promptEntries.map(async ([providerName, prompt]) =>
        renderMcpProjectionBlock({
          kind: "prompt",
          providerName,
          ref: prompt.ref,
          sourcePath: prompt.sourcePath,
          payload: await prompt.get({}),
        }),
      ),
    )
    const resourceBlocks = await Promise.all(
      resourceEntries.map(async ([providerName, resource]) =>
        renderMcpProjectionBlock({
          kind: "resource",
          providerName,
          ref: resource.ref,
          sourcePath: resource.sourcePath,
          payload: await resource.read(),
        }),
      ),
    )
    return [
      "## Projected MCP Context",
      "",
      "These MCP prompts and resources are explicitly projected by the active expert-squad capability for this agent. They are loaded from the active/default scoped MCP definitions only.",
      "",
      ...promptBlocks,
      ...resourceBlocks,
    ].join("\n\n")
  }

  async function activeMcpPromptContext(input: PromptInput): Promise<string | undefined> {
    if (input.agentID === "orchestrator") {
      const capability = await resolveSchedulerCapability(input)
      return renderProjectedMcpContext({
        prompts: await projectSchedulerMcpPrompts(capability, { projectDirectory: input.projectDirectory }),
        resources: await projectSchedulerMcpResources(capability, { projectDirectory: input.projectDirectory }),
      })
    }
    if (!AgentRoleContract.isRoleID(input.agentID)) return undefined
    const capability = await resolveWorkerCapability({
      projectDirectory: input.projectDirectory,
      config: input.config,
      agentID: input.agentID,
    })
    return renderProjectedMcpContext({
      prompts: await projectWorkerMcpPrompts(capability, { projectDirectory: input.projectDirectory }),
      resources: await projectWorkerMcpResources(capability, { projectDirectory: input.projectDirectory }),
    })
  }

  export async function projectOrchestratorTools<T>(
    tools: Record<string, T>,
    capability: ResolvedSchedulerCapability,
    input: { projectDirectory?: string; signal?: AbortSignal; workflow: MiniWorkflow },
  ): Promise<Record<string, T>> {
    const projected: Record<string, T> = {}
    const workflowToolNames = new Set(input.workflow.steps.map((step) => step.tool))
    for (const toolID of capability.builtInToolIDs) {
      if (WorkflowRegistry.isWorkflowToolName(toolID) && !workflowToolNames.has(toolID)) continue
      if (!Object.hasOwn(tools, toolID)) {
        throw new Error(
          `Active expert squad ${JSON.stringify(capability.promptProfileID)} projects Orchestrator tool ${JSON.stringify(
            toolID,
          )}, but createOrchestratorTools did not build that tool.`,
        )
      }
      projected[toolID] = tools[toolID]
    }
    const defaultTools = defaultToolsFromRuntimeMap<T>({
      tools,
      refs: capability.defaultToolRefs,
      providerNames: capability.defaultToolProviderNames,
      context: `Active expert squad ${JSON.stringify(capability.promptProfileID)}`,
    })
    for (const [providerName, defaultTool] of Object.entries(defaultTools)) {
      if (Object.hasOwn(projected, providerName)) {
        throw new Error(
          `Active expert squad ${JSON.stringify(
            capability.promptProfileID,
          )} default tool provider name ${JSON.stringify(providerName)} collides with an existing Orchestrator tool.`,
        )
      }
      projected[providerName] = defaultTool
    }
    const packageTools = await schedulerPackageTools<T>(capability, input)
    for (const [providerName, packageTool] of Object.entries(packageTools)) {
      if (Object.hasOwn(projected, providerName) || Object.hasOwn(tools, providerName)) {
        throw new Error(
          `Active expert squad ${JSON.stringify(
            capability.promptProfileID,
          )} package tool provider name ${JSON.stringify(providerName)} collides with an existing Orchestrator tool.`,
        )
      }
      projected[providerName] = packageTool
    }
    if (capability.defaultMcpToolRefs.length > 0) {
      if (!input.projectDirectory) {
        throw new Error(
          `Active expert squad ${capability.promptProfileID} projects default MCP tools, but no project directory was supplied.`,
        )
      }
      const defaultMcpRuntimeTools = await defaultMcpTools<T>({
        refs: capability.defaultMcpToolRefs,
        providerNames: capability.defaultMcpToolProviderNames,
        mcpServers: capability.defaultMcpServers,
        cwd: input.projectDirectory,
        context: `Active expert squad ${JSON.stringify(capability.promptProfileID)}`,
      })
      for (const [providerName, defaultMcpTool] of Object.entries(defaultMcpRuntimeTools)) {
        if (Object.hasOwn(projected, providerName) || Object.hasOwn(tools, providerName)) {
          throw new Error(
            `Active expert squad ${JSON.stringify(
              capability.promptProfileID,
            )} default MCP tool provider name ${JSON.stringify(providerName)} collides with an existing Orchestrator tool.`,
          )
        }
        projected[providerName] = defaultMcpTool
      }
    }
    const packageMcpTools = await schedulerPackageMcpTools<T>(capability, input)
    for (const [providerName, packageMcpTool] of Object.entries(packageMcpTools)) {
      if (Object.hasOwn(projected, providerName) || Object.hasOwn(tools, providerName)) {
        throw new Error(
          `Active expert squad ${JSON.stringify(
            capability.promptProfileID,
          )} package MCP tool provider name ${JSON.stringify(providerName)} collides with an existing Orchestrator tool.`,
        )
      }
      projected[providerName] = packageMcpTool
    }
    return projected
  }

  export async function projectWorkerTools<T>(
    tools: Record<string, T>,
    capability: ResolvedWorkerCapability,
    input: { projectDirectory?: string; toolDirectory?: string; signal?: AbortSignal } = {},
  ): Promise<Record<string, T>> {
    const projected: Record<string, T> = {}
    const builtInToolIDs = new Set(capability.builtInToolIDs)
    const defaultToolProviderNames = new Set(capability.defaultToolProviderNames)
    const canonicalToolIDs = AgentToolPool.canonicalToolIDs()
    for (const [toolID, item] of Object.entries(tools)) {
      if (defaultToolProviderNames.has(toolID)) continue
      if (canonicalToolIDs.has(toolID) && !builtInToolIDs.has(toolID)) continue
      projected[toolID] = item
    }

    const defaultTools = defaultToolsFromRuntimeMap<T>({
      tools,
      refs: capability.defaultToolRefs,
      providerNames: capability.defaultToolProviderNames,
      context: `Active expert squad ${JSON.stringify(capability.promptProfileID)} ${capability.agentID}`,
    })
    for (const [providerName, defaultTool] of Object.entries(defaultTools)) {
      if (Object.hasOwn(projected, providerName)) {
        throw new Error(
          `Active expert squad ${JSON.stringify(
            capability.promptProfileID,
          )} default tool provider name ${JSON.stringify(providerName)} collides with an existing ${capability.agentID} tool.`,
        )
      }
      projected[providerName] = defaultTool
    }
    const packageTools = await workerPackageTools<T>(capability, input)
    for (const [providerName, packageTool] of Object.entries(packageTools)) {
      if (Object.hasOwn(projected, providerName) || Object.hasOwn(tools, providerName)) {
        throw new Error(
          `Active expert squad ${JSON.stringify(
            capability.promptProfileID,
          )} package tool provider name ${JSON.stringify(providerName)} collides with an existing ${capability.agentID} tool.`,
        )
      }
      projected[providerName] = packageTool
    }
    if (capability.defaultMcpToolRefs.length > 0) {
      if (!input.projectDirectory) {
        throw new Error(
          `Active expert squad ${capability.promptProfileID} projects worker default MCP tools, but no project directory was supplied.`,
        )
      }
      const defaultMcpRuntimeTools = await defaultMcpTools<T>({
        refs: capability.defaultMcpToolRefs,
        providerNames: capability.defaultMcpToolProviderNames,
        mcpServers: capability.defaultMcpServers,
        cwd: input.toolDirectory ?? input.projectDirectory,
        context: `Active expert squad ${JSON.stringify(capability.promptProfileID)} ${capability.agentID}`,
      })
      for (const [providerName, defaultMcpTool] of Object.entries(defaultMcpRuntimeTools)) {
        if (Object.hasOwn(projected, providerName) || Object.hasOwn(tools, providerName)) {
          throw new Error(
            `Active expert squad ${JSON.stringify(
              capability.promptProfileID,
            )} default MCP tool provider name ${JSON.stringify(providerName)} collides with an existing ${capability.agentID} tool.`,
          )
        }
        projected[providerName] = defaultMcpTool
      }
    }
    const packageMcpTools = await workerPackageMcpTools<T>(capability, input)
    for (const [providerName, packageMcpTool] of Object.entries(packageMcpTools)) {
      if (Object.hasOwn(projected, providerName) || Object.hasOwn(tools, providerName)) {
        throw new Error(
          `Active expert squad ${JSON.stringify(
            capability.promptProfileID,
          )} package MCP tool provider name ${JSON.stringify(providerName)} collides with an existing ${capability.agentID} tool.`,
        )
      }
      projected[providerName] = packageMcpTool
    }
    return projected
  }

  function unique(input: Iterable<string>): string[] {
    return [...new Set(input)]
  }

  function selectorSkillName(id: string): string {
    return `${id}-expert-squad`
  }

  function selectorSkillFromPackage(input: {
    pkg: Pick<ExpertSquadRegistry.PackageCatalogEntry, "id" | "label" | "description" | "selector"> & {
      selectorInstructions?: string
      manifestPath?: string
    }
    builtin: boolean
    defaultSkillsByName: Map<string, Skill.Info>
    location?: string
  }): Skill.Info | undefined {
    const markdown = ExpertSquadRegistry.renderSelectorSkillMarkdown(input.pkg)
    if (!markdown) return undefined
    const parsed = matter(markdown)
    const name = selectorSkillName(input.pkg.id)
    const defaultSkill = input.defaultSkillsByName.get(name)
    const location = input.builtin && defaultSkill?.builtin ? defaultSkill.location : input.location ?? input.pkg.manifestPath
    if (!location) {
      throw new Error(`Expert squad selector ${JSON.stringify(name)} has no canonical location.`)
    }
    return {
      name,
      description: `Orchestrator skill for ${input.pkg.label} tasks. ${input.pkg.selector!.summary}`,
      platforms: [],
      builtin: input.builtin,
      location,
      content: parsed.content,
      priority: 90,
      required_tools: ["select_expert_squad"],
      agents: ["orchestrator"],
      mounted_agents: ["orchestrator"],
      duplicate_locations: [],
    }
  }

  function assertNoSelectorCollision(
    defaultSkills: Skill.Info[],
    selectorNames: Set<string>,
    builtInSelectorNames: Set<string>,
  ) {
    for (const skill of defaultSkills) {
      if (!selectorNames.has(skill.name)) continue
      if (skill.builtin && builtInSelectorNames.has(skill.name)) continue
      throw new Error(
        `Skill ${JSON.stringify(skill.name)} collides with an expert-squad selector skill name. Rename the ordinary skill or the expert squad id.`,
      )
    }
  }

  function defaultSkillNameFromRef(ref: string): string {
    const prefix = "default/skill/"
    if (!ref.startsWith(prefix)) throw new Error(`Invalid default skill ref ${JSON.stringify(ref)}`)
    return ref.slice(prefix.length)
  }

  function packageSkillPath(pkg: ExpertSquadRegistry.LoadedPackage, ref: string): string {
    const prefix = `${pkg.id}/`
    if (!ref.startsWith(prefix)) throw new Error(`Package skill ref ${JSON.stringify(ref)} is not namespaced by ${pkg.id}`)
    const parts = ref.slice(prefix.length).split("/")
    const owner = parts.shift()
    if (!owner || parts.length === 0) throw new Error(`Invalid package skill ref ${JSON.stringify(ref)}`)
    const base = owner === "shared" ? path.join(pkg.root, "skills") : path.join(pkg.root, "agents", owner, "skills")
    return path.join(base, ...parts, "SKILL.md")
  }

  async function packageSkillFromRef(pkg: ExpertSquadRegistry.LoadedPackage, ref: string, role: string): Promise<Skill.Info> {
    const location = packageSkillPath(pkg, ref)
    const parsed = matter(await Filesystem.readText(location))
    if (Object.hasOwn(parsed.data, "mounted_agents") || Object.hasOwn(parsed.data, "agents")) {
      throw new Error(
        `Package skill ${ref} must not declare agents or mounted_agents; active expert-squad projection owns visibility.`,
      )
    }
    const info = Skill.Info.pick({
      name: true,
      description: true,
      platforms: true,
      auto_detect: true,
      priority: true,
      required_tools: true,
      expires_at: true,
    }).parse(parsed.data)
    return {
      name: info.name,
      description: info.description,
      platforms: info.platforms,
      builtin: false,
      location,
      content: parsed.content,
      auto_detect: info.auto_detect,
      priority: info.priority,
      required_tools: info.required_tools,
      agents: [],
      mounted_agents: [role],
      expires_at: info.expires_at,
      duplicate_locations: [],
    }
  }

  type SkillSourceKind = "default" | "package" | "selector"
  type ProjectSelectorPackage = {
    pkg: ExpertSquadRegistry.PackageCatalogEntry
    location: string
  }

  function addProjectedSkill(
    byName: Map<string, { skill: Skill.Info; source: SkillSourceKind }>,
    skill: Skill.Info,
    source: SkillSourceKind,
  ) {
    const existing = byName.get(skill.name)
    if (!existing) {
      byName.set(skill.name, { skill, source })
      return
    }
    if (existing.source === "default" && source === "default" && existing.skill.location === skill.location) {
      existing.skill.mounted_agents = unique([...existing.skill.mounted_agents, ...skill.mounted_agents])
      return
    }
    throw new Error(
      `Projected skill name ${JSON.stringify(skill.name)} collides between ${existing.source} and ${source} skill sources.`,
    )
  }

  async function selectorCatalog(projectDirectory: string | undefined): Promise<ProjectSelectorPackage[]> {
    if (!projectDirectory) return []
    const base = canonicalBase(projectDirectory)
    const selectors: ProjectSelectorPackage[] = []
    for (const entry of await ExpertSquadRegistry.discover(projectDirectory)) {
      assertNoBuiltInCollision(entry.id)
      const packageRoot = path.join(base, entry.id)
      selectors.push({
        pkg: entry,
        location: path.join(packageRoot, entry.selectorInstructions ? "selector.md" : ExpertSquadRegistry.MANIFEST),
      })
    }
    return selectors
  }

  export async function resolveSkillProjection(input: SkillProjectionInput): Promise<ResolvedSkillProjection> {
    const [capability, active, defaultSkills] = await Promise.all([
      resolveSchedulerCapability(input),
      packageForActiveProfile(input),
      input.defaultSkills ?? Skill.all(),
    ])
    const defaultSkillsByName = new Map(defaultSkills.map((skill) => [skill.name, skill]))

    const projectedAgentIDs =
      active.profileID === DEFAULT_PROMPT_PROFILE_ID && input.agentIDs
        ? unique(input.agentIDs)
        : unique(["orchestrator", ...Object.keys(active.pkg.manifest.capability_projection.agents)])

    const projected = new Map<string, { skill: Skill.Info; source: SkillSourceKind }>()

    const selectorPackages: Array<{
      pkg: Parameters<typeof selectorSkillFromPackage>[0]["pkg"]
      builtin: boolean
      location?: string
    }> = []
    if (active.profileID === DEFAULT_PROMPT_PROFILE_ID) {
      const builtInSelectorPackages = loadedBuiltInPackages.filter((pkg) => pkg.selector)
      const projectSelectorPackages = (await selectorCatalog(input.projectDirectory)).filter((entry) => entry.pkg.selector)
      selectorPackages.push(
        ...builtInSelectorPackages.map((pkg) => ({ pkg, builtin: true, location: undefined })),
        ...projectSelectorPackages.map((entry) => ({
          pkg: entry.pkg,
          builtin: false,
          location: entry.location,
        })),
      )
    } else if (active.pkg.selector) {
      selectorPackages.push({ pkg: active.pkg, builtin: active.builtIn, location: undefined })
    }
    const projectedSelectorNames = new Set(selectorPackages.map((entry) => selectorSkillName(entry.pkg.id)))
    const builtInSelectorNames = new Set(
      selectorPackages.filter((entry) => entry.builtin).map((entry) => selectorSkillName(entry.pkg.id)),
    )
    assertNoSelectorCollision(defaultSkills, projectedSelectorNames, builtInSelectorNames)
    const selectorSkills = selectorPackages
      .map((entry) =>
        selectorSkillFromPackage({
          pkg: entry.pkg,
          builtin: entry.builtin,
          defaultSkillsByName,
          location: entry.location,
        }),
      )
      .filter((skill): skill is Skill.Info => Boolean(skill))
    for (const skill of selectorSkills) addProjectedSkill(projected, skill, "selector")

    const roleProjections = new Map<string, ExpertSquadRegistry.Projection>([
      ["orchestrator", active.pkg.manifest.capability_projection.scheduler],
      ...Object.entries(active.pkg.manifest.capability_projection.agents),
    ])
    const productionSkillNames: string[] = []
    for (const [role, projection] of roleProjections) {
      for (const ref of projection.default_skill_refs) {
        const name = defaultSkillNameFromRef(ref)
        const skill = defaultSkillsByName.get(name)
        if (!skill) throw new Error(`Active expert squad ${active.profileID} projects missing default skill ${ref}.`)
        productionSkillNames.push(name)
        addProjectedSkill(
          projected,
          {
            ...skill,
            mounted_agents: [role],
          },
          "default",
        )
      }
      if (!active.builtIn) {
        for (const ref of projection.package_skill_refs) {
          const skill = await packageSkillFromRef(active.pkg, ref, role)
          productionSkillNames.push(skill.name)
          addProjectedSkill(projected, skill, "package")
        }
      }
    }

    const selectorSkillNames = selectorSkills.map((skill) => skill.name)
    const uniqueProductionSkillNames = unique(productionSkillNames)
    const projectedSkillNames = [...projected.keys()]
    const projectedToolIDs = activeProjectedSchedulerToolIDs(capability, input.workflow)
    const projectedSkillMounts = Object.fromEntries(
      [...projected.entries()].map(([name, entry]) => [
        name,
        {
          source: entry.source,
          mounted_agents: entry.skill.mounted_agents,
        },
      ]),
    )
    return {
      activeProfile: capability.promptProfileID,
      expertSquadID: capability.expertSquadID,
      capabilityProfileID: capability.capabilityProfileID,
      builtIn: capability.builtIn,
      projectionHash: createHash("sha256")
        .update(
          stable({
            schedulerProjectionHash: capability.projectionHash,
            projectedToolIDs,
            workflowID: input.workflow?.id,
            projectedAgentIDs,
            selectorSkillNames,
            productionSkillNames: uniqueProductionSkillNames,
            projectedSkillNames,
            projectedSkillMounts,
          }),
        )
        .digest("hex"),
      projectedToolIDs,
      projectedAgentIDs,
      selectorSkillNames,
      productionSkillNames: uniqueProductionSkillNames,
      projectedSkillNames,
      skills: [...projected.values()].map((entry) => entry.skill),
    }
  }

  export async function overlayFor(input: PromptInput): Promise<string | undefined> {
    const active = await packageForActiveProfile(input)
    const profile = active.pkg.promptProfile
    const prompt = profile.agents[input.agentID]
    return typeof prompt === "string" && prompt.trim().length > 0 ? prompt : undefined
  }

  async function activeOrchestratorReadme(input: PromptInput): Promise<string | undefined> {
    if (input.agentID !== "orchestrator") return undefined
    const active = await packageForActiveProfile(input)
    const readme = active.pkg.readmeContent.trim()
    return readme.length > 0 ? readme : undefined
  }

  export async function composeAgentPrompt(input: ComposeInput): Promise<string> {
    const [readme, profilePrompt, mcpContext] = await Promise.all([
      activeOrchestratorReadme(input),
      overlayFor(input),
      activeMcpPromptContext(input),
    ])
    return [input.base, readme, profilePrompt, mcpContext, input.userAppend]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join("\n\n")
  }

  export async function assertKnownProfileID(input: ProfileIDInput): Promise<void> {
    PromptProfileIDSchema.parse(input.profileID)
    if (Object.hasOwn(builtInPackages, input.profileID)) {
      if (input.projectDirectory) {
        for (const entry of await ExpertSquadRegistry.discover(input.projectDirectory)) {
          if (entry.id === input.profileID) {
            throw new Error(`Project expert squad package id ${JSON.stringify(input.profileID)} collides with a built-in expert squad id.`)
          }
        }
      }
      return
    }
    if (
      input.projectDirectory &&
      (await loadProjectPackageByID(input.projectDirectory, input.profileID, packageLoadOptions(input.config)))
    ) {
      return
    }
    throw new Error(`Unknown prompt profile ${JSON.stringify(input.profileID)}`)
  }

  export async function list(input: CatalogInput): Promise<PromptProfileCatalog> {
    const active = PromptProfile.activeID(input.config)
    const projectPackagesByID = input.projectDirectory
      ? await projectCatalogPackages(input.projectDirectory)
      : {}
    const profiles: PromptProfileCatalogProfile[] = [
      ...Object.entries(builtInPackages).map(([id, pkg]) =>
        catalogProfileFromCapabilityPackage({
          id,
          pkg,
          builtIn: true,
          builtInToolIDs: expandedSchedulerBuiltInToolIDs(pkg.manifest.capability_projection.scheduler),
        }),
      ),
      ...Object.entries(projectPackagesByID).map(([id, pkg]) =>
        catalogProfileFromCapabilityPackage({
          id,
          pkg,
          builtIn: false,
          builtInToolIDs: expandedSchedulerBuiltInToolIDs(pkg.manifest.capability_projection.scheduler),
        }),
      ),
    ]
    if (!profiles.some((profile) => profile.id === active)) {
      throw new Error(`Unknown prompt profile ${JSON.stringify(active)}`)
    }
    return PromptProfileCatalogSchema.parse({
      active,
      project_active: input.projectActive ?? active,
      session_active: input.sessionActive ?? null,
      default: DEFAULT_PROMPT_PROFILE_ID,
      targets: PromptProfile.targets,
      profiles,
    })
  }
}
