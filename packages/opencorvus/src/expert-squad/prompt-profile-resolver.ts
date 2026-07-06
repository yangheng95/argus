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
  PromptProfileIDSchema,
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
import { assertNoInlineBase64Payload } from "@/util/inline-base64"
import { EngineConfig } from "@/engine/config"
import {
  WorkflowRegistry,
  type MiniWorkflow,
  type OrchestratorWorkflowToolName,
  type SchedulerAgentWorkflowBinding,
} from "@/engine/workflow"
import { loadedBuiltInPackages } from "./builtin"
import {
  ExpertSquadCatalogSchema,
  type ExpertSquadCatalog,
  type ExpertSquadCatalogSummary,
} from "./catalog"
import {
  catalogProfileFromPackage as catalogProfileFromCapabilityPackage,
  catalogSummaryFromPackage as catalogSummaryFromCapabilityPackage,
  defaultMcpPromptProviderName as defaultMcpPromptProviderNameFromRef,
  defaultMcpResourceProviderName as defaultMcpResourceProviderNameFromRef,
  defaultMcpToolProviderName as defaultMcpToolProviderNameFromRef,
  defaultToolNameFromRef as defaultToolNameFromCapabilityRef,
  packageMcpPromptProviderName as packageMcpPromptProviderNameFromRef,
  packageMcpResourceProviderName as packageMcpResourceProviderNameFromRef,
  packageMcpToolProviderName as packageMcpToolProviderNameFromRef,
  packageToolProviderName as packageToolProviderNameFromRef,
  projectionHash,
  schedulerBuiltInToolIDsFromProjection,
  workerBuiltInToolIDsFromProjection,
} from "./catalog-profile"
import { ExpertSquadRegistry } from "./registry"
import { ExpertSquadPackageManager } from "./manager"

type ConfigLike = {
  prompt_profile?: PromptProfileConfig
  mcp?: Config.Info["mcp"]
  assistant?: Config.Info["assistant"]
}

export namespace PromptProfileResolver {
  export interface ProjectScope {
    projectDirectory?: string
  }

  export interface ExpertSquadCatalogInput {
    config: ConfigLike
    projectActive: string
    sessionOverride: string | null
    scope: {
      kind: "project" | "session"
      directory: string
      sessionID?: string
    }
    defaultSkills?: Skill.Info[]
    agentIDs?: string[]
    workflow?: MiniWorkflow
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

  export interface ResolvedVirtualAgent {
    baseRole: AgentRoleID
    virtualAgentID: string
    label: string
    description?: string
    expertSquadID: string
    promptProfileID: string
    projectionHash: string
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
    virtualAgent?: ResolvedVirtualAgent
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
    virtualAgents: ResolvedVirtualAgent[]
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
    await ExpertSquadPackageManager.releasePayloadPackages({ projectDirectory })
    const entries = await ExpertSquadRegistry.discover(projectDirectory)
    for (const entry of entries) assertNoBuiltInCollision(entry.id)
    return entries
  }

  async function projectCatalogPackages(
    projectDirectory: string,
    config?: ConfigLike,
  ): Promise<Record<string, ExpertSquadRegistry.LoadedPackage>> {
    const result: Record<string, ExpertSquadRegistry.LoadedPackage> = {}
    for (const entry of await discoverProjectPackages(projectDirectory)) {
      const loaded = await ExpertSquadRegistry.loadPackage(
        path.join(canonicalBase(projectDirectory), entry.id),
        config ? packageLoadOptions(config) : {},
      )
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
    let info = await lstat(packageRoot).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (!info) {
      await ExpertSquadPackageManager.releasePayloadPackages({ projectDirectory })
      info = await lstat(packageRoot).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      })
    }
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

  function normalizeRelative(value: string) {
    return value.split(path.sep).join("/")
  }

  function virtualAgentProjectionHash(input: {
    promptProfileID: string
    expertSquadID: string
    baseRole: AgentRoleID
    virtualAgent: ExpertSquadRegistry.VirtualAgentDefinition & { promptContent?: string }
    projection?: ExpertSquadRegistry.Projection
    resourceFingerprint?: unknown
  }) {
    return createHash("sha256").update(stable(input)).digest("hex")
  }

  function packageRefParts(pkgID: string, ref: string): { owner: string; name: string } {
    const prefix = `${pkgID}/`
    if (!ref.startsWith(prefix)) throw new Error(`Package ref ${JSON.stringify(ref)} must be namespaced by ${pkgID}`)
    const parts = ref.slice(prefix.length).split("/")
    const owner = parts.shift()
    if (!owner || parts.length === 0) throw new Error(`Package ref ${JSON.stringify(ref)} is incomplete`)
    return { owner, name: parts.join("/") }
  }

  function packageSkillDigestPath(pkg: ExpertSquadRegistry.LoadedPackage, ref: string) {
    const { owner, name } = packageRefParts(pkg.id, ref)
    return owner === "shared"
      ? path.join(pkg.root, "skills", name, "SKILL.md")
      : path.join(pkg.root, "agents", owner, "skills", name, "SKILL.md")
  }

  async function packageTextFileDigest(paths: string[], ref: string): Promise<{ ref: string; path: string; sha256: string }> {
    let lastMissing: NodeJS.ErrnoException | undefined
    for (const file of paths) {
      const text = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          lastMissing = error
          return undefined
        }
        throw error
      })
      if (typeof text === "string") {
        return {
          ref,
          path: normalizeRelative(file),
          sha256: createHash("sha256").update(text).digest("hex"),
        }
      }
    }
    throw new Error(`Projected package ref ${JSON.stringify(ref)} has no readable source file`, { cause: lastMissing })
  }

  function packageToolCandidatePaths(pkg: ExpertSquadRegistry.LoadedPackage, ref: string) {
    const { owner, name } = packageRefParts(pkg.id, ref)
    const base =
      owner === "shared"
        ? path.join(pkg.root, "tools", name)
        : path.join(pkg.root, "agents", owner, "tools", name)
    return [`${base}.ts`, `${base}.js`]
  }

  function packageMcpServerRefFromTypedRef(ref: string): string {
    for (const marker of ["/tool/", "/prompt/", "/resource/"]) {
      const index = ref.lastIndexOf(marker)
      if (index >= 0) return ref.slice(0, index)
    }
    return ref
  }

  function packageMcpCandidatePaths(pkg: ExpertSquadRegistry.LoadedPackage, ref: string) {
    const serverRef = packageMcpServerRefFromTypedRef(ref)
    const { owner, name } = packageRefParts(pkg.id, serverRef)
    const base =
      owner === "shared"
        ? path.join(pkg.root, "mcp", name)
        : path.join(pkg.root, "agents", owner, "mcp", name)
    return [`${base}.jsonc`, `${base}.json`]
  }

  async function projectedPackageResourceFingerprint(input: {
    active: ActiveProfilePackage
    projection: ExpertSquadRegistry.Projection
    virtualAgent?: ExpertSquadRegistry.VirtualAgentDefinition & { promptContent?: string }
    includeReadme?: boolean
    includeSelector?: boolean
  }) {
    const staticFingerprint = {
      ...(input.includeReadme ? { readme_sha256: createHash("sha256").update(input.active.pkg.readmeContent).digest("hex") } : {}),
      ...(input.includeSelector && input.active.pkg.selectorInstructions
        ? {
            selector_sha256: createHash("sha256").update(input.active.pkg.selectorInstructions).digest("hex"),
          }
        : {}),
      ...(input.virtualAgent
        ? {
            virtual_agent: {
              id: input.virtualAgent.id,
              label: input.virtualAgent.label,
              description: input.virtualAgent.description,
              prompt: input.virtualAgent.prompt,
              prompt_sha256: createHash("sha256").update(input.virtualAgent.promptContent ?? "").digest("hex"),
            },
          }
        : {}),
    }
    if (input.active.builtIn) return staticFingerprint
    const loadedPackage = input.active.pkg
    const skillDigests = await Promise.all(
      [...input.projection.package_skill_refs]
        .sort((left, right) => left.localeCompare(right))
        .map((ref) => packageTextFileDigest([packageSkillDigestPath(loadedPackage, ref)], ref)),
    )
    const toolDigests = await Promise.all(
      [...input.projection.package_tool_refs]
        .sort((left, right) => left.localeCompare(right))
        .map((ref) => packageTextFileDigest(packageToolCandidatePaths(loadedPackage, ref), ref)),
    )
    const mcpRefs = new Set<string>([
      ...input.projection.package_mcp_server_refs,
      ...input.projection.package_mcp_tool_refs.map(packageMcpServerRefFromTypedRef),
      ...input.projection.package_mcp_prompt_refs.map(packageMcpServerRefFromTypedRef),
      ...input.projection.package_mcp_resource_refs.map(packageMcpServerRefFromTypedRef),
    ])
    const mcpDigests = await Promise.all(
      [...mcpRefs]
        .sort((left, right) => left.localeCompare(right))
        .map((ref) => packageTextFileDigest(packageMcpCandidatePaths(loadedPackage, ref), ref)),
    )
    return {
      ...staticFingerprint,
      package_skill_digests: skillDigests,
      package_tool_digests: toolDigests,
      package_mcp_digests: mcpDigests,
    }
  }

  function virtualAgentForRole(input: {
    active: ActiveProfilePackage
    role: AgentRoleID
    resourceFingerprint?: unknown
  }): ResolvedVirtualAgent | undefined {
    const virtualAgent = input.active.pkg.promptProfile.virtualAgents[input.role]
    if (!virtualAgent) return undefined
    return {
      baseRole: input.role,
      virtualAgentID: virtualAgent.id,
      label: virtualAgent.label,
      ...(virtualAgent.description ? { description: virtualAgent.description } : {}),
      expertSquadID: input.active.pkg.id,
      promptProfileID: input.active.profileID,
      projectionHash: virtualAgentProjectionHash({
        promptProfileID: input.active.profileID,
        expertSquadID: input.active.pkg.id,
        baseRole: input.role,
        virtualAgent,
        projection: input.active.pkg.manifest.capability_projection.agents[input.role],
        resourceFingerprint: input.resourceFingerprint,
      }),
    }
  }

  function activeVirtualAgents(active: ActiveProfilePackage): ResolvedVirtualAgent[] {
    return Object.keys(active.pkg.promptProfile.virtualAgents)
      .sort()
      .map((role) => {
        if (!AgentRoleContract.isRoleID(role)) {
          throw new Error(`Active expert squad ${active.profileID} has invalid virtual agent base role ${JSON.stringify(role)}`)
        }
        const projected = virtualAgentForRole({ active, role })
        if (!projected) throw new Error(`Active expert squad ${active.profileID} lost virtual agent projection for ${role}`)
        return projected
      })
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

  function catalogSummaryFromPackage(input: {
    id: string
    pkg: PackageWithCapability
    builtIn: boolean
  }): ExpertSquadCatalogSummary {
    return catalogSummaryFromCapabilityPackage({
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
    return schedulerBuiltInToolIDsFromProjection(projection)
  }

  function expandedWorkerBuiltInToolIDs(
    agentID: AgentRoleID,
    projection: ExpertSquadRegistry.Projection,
  ): string[] {
    return workerBuiltInToolIDsFromProjection(agentID, projection)
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
    const resourceFingerprint = await projectedPackageResourceFingerprint({
      active,
      projection: scheduler,
      includeReadme: true,
      includeSelector: true,
    })
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
        resourceFingerprint,
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
    const rawVirtualAgent = active.pkg.promptProfile.virtualAgents[input.agentID]
    const resourceFingerprint = await projectedPackageResourceFingerprint({
      active,
      projection,
      virtualAgent: rawVirtualAgent,
      includeReadme: input.agentID === "orchestrator",
    })
    const virtualAgent = virtualAgentForRole({ active, role: input.agentID, resourceFingerprint })
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
        resourceFingerprint,
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
      ...(virtualAgent ? { virtualAgent } : {}),
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
    getProjectionPayload(args?: Record<string, string>): Promise<MCP.ProjectionPromptPayload>
  }

  export interface ProjectedMcpResource extends MCP.ResourceInfo {
    ref: string
    providerName: string
    sourcePath?: string
    read(): Promise<MCP.ReadResourceResult>
    readProjectionPayload(): Promise<MCP.ProjectionResourcePayload>
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
      getProjectionPayload: (args?: Record<string, string>) =>
        MCP.getScopedPromptProjectionPayload({
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
      readProjectionPayload: () =>
        MCP.readScopedResourceProjectionPayload({
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
      getProjectionPayload: (args?: Record<string, string>) =>
        MCP.getScopedPromptProjectionPayload({
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
      readProjectionPayload: () =>
        MCP.readScopedResourceProjectionPayload({
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

  type SanitizedMcpPromptProjection = {
    description?: string
    messages: Array<{
      role: string
      content:
        | { type: "text"; text: string; annotations?: SanitizedMcpAnnotations }
        | { type: "resource_text"; uri?: string; mimeType?: string; text: string }
        | {
            type: "resource_link"
            uri: string
            name?: string
            title?: string
            description?: string
            mimeType?: string
            annotations?: SanitizedMcpAnnotations
            icons?: SanitizedMcpIcon[]
          }
    }>
  }

  type SanitizedMcpResourceProjection = {
    contents: Array<{ uri: string; mimeType?: string; text: string }>
  }

  type SanitizedMcpAnnotations = {
    audience?: Array<"user" | "assistant">
    priority?: number
    lastModified?: string
  }

  type SanitizedMcpIcon = {
    src: string
    mimeType?: string
    sizes?: string[]
    theme?: "light" | "dark"
  }

  function stringifySanitizedMcpProjectionPayload(payload: unknown, context: string): string {
    const text = JSON.stringify(payload, null, 2)
    if (typeof text !== "string") throw new Error(`${context} returned no JSON-serializable payload.`)
    return text
  }

  function requireMcpProjectionRecord(value: unknown, context: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${context} returned an invalid MCP projection payload.`)
    }
    const record = value as Record<string, unknown>
    if (Object.hasOwn(record, "_meta")) {
      throw new Error(`${context} returned MCP _meta; projected context accepts text and link metadata only.`)
    }
    return record
  }

  function requireMcpProjectionString(value: unknown, context: string): string {
    if (typeof value !== "string") throw new Error(`${context} must be a string.`)
    assertNoInlineBase64Payload(value, context)
    return value
  }

  function optionalMcpProjectionString(value: unknown, context: string): string | undefined {
    if (value === undefined) return undefined
    if (typeof value !== "string") throw new Error(`${context} must be a string.`)
    assertNoInlineBase64Payload(value, context)
    return value
  }

  function requireMcpProjectionArray(value: unknown, context: string): unknown[] {
    if (!Array.isArray(value)) throw new Error(`${context} must be an array.`)
    return value
  }

  function assertMcpProjectionFields(
    record: Record<string, unknown>,
    allowedFields: readonly string[],
    context: string,
  ): void {
    const allowed = new Set(allowedFields)
    for (const field of Object.keys(record)) {
      if (!allowed.has(field)) throw new Error(`${context} contains unsupported field ${JSON.stringify(field)}.`)
    }
  }

  function optionalMcpProjectionAnnotations(value: unknown, context: string): SanitizedMcpAnnotations | undefined {
    if (value === undefined) return undefined
    const record = requireMcpProjectionRecord(value, context)
    assertMcpProjectionFields(record, ["audience", "priority", "lastModified"], context)
    const annotations: SanitizedMcpAnnotations = {}
    if (record.audience !== undefined) {
      const audience = requireMcpProjectionArray(record.audience, `${context}.audience`).map((item, index) => {
        const role = requireMcpProjectionString(item, `${context}.audience[${index}]`)
        if (role !== "user" && role !== "assistant") {
          throw new Error(`${context}.audience[${index}] must be user or assistant.`)
        }
        return role
      })
      annotations.audience = audience
    }
    if (record.priority !== undefined) {
      if (typeof record.priority !== "number" || !Number.isFinite(record.priority) || record.priority < 0 || record.priority > 1) {
        throw new Error(`${context}.priority must be a finite number from 0 to 1.`)
      }
      annotations.priority = record.priority
    }
    const lastModified = optionalMcpProjectionString(record.lastModified, `${context}.lastModified`)
    if (lastModified !== undefined) annotations.lastModified = lastModified
    return annotations
  }

  function optionalMcpProjectionIcons(value: unknown, context: string): SanitizedMcpIcon[] | undefined {
    if (value === undefined) return undefined
    return requireMcpProjectionArray(value, context).map((item, index) => {
      const iconContext = `${context}[${index}]`
      const record = requireMcpProjectionRecord(item, iconContext)
      assertMcpProjectionFields(record, ["src", "mimeType", "sizes", "theme"], iconContext)
      const icon: SanitizedMcpIcon = {
        src: requireMcpProjectionString(record.src, `${iconContext}.src`),
      }
      const mimeType = optionalMcpProjectionString(record.mimeType, `${iconContext}.mimeType`)
      if (mimeType !== undefined) icon.mimeType = mimeType
      if (record.sizes !== undefined) {
        icon.sizes = requireMcpProjectionArray(record.sizes, `${iconContext}.sizes`).map((size, sizeIndex) =>
          requireMcpProjectionString(size, `${iconContext}.sizes[${sizeIndex}]`),
        )
      }
      const theme = optionalMcpProjectionString(record.theme, `${iconContext}.theme`)
      if (theme !== undefined) {
        if (theme !== "light" && theme !== "dark") throw new Error(`${iconContext}.theme must be light or dark.`)
        icon.theme = theme
      }
      return icon
    })
  }

  function sanitizeMcpPromptContent(content: unknown, context: string): SanitizedMcpPromptProjection["messages"][number]["content"] {
    const record = requireMcpProjectionRecord(content, context)
    const type = requireMcpProjectionString(record.type, `${context}.type`)
    if (type === "text") {
      assertMcpProjectionFields(record, ["type", "text", "annotations"], context)
      const annotations = optionalMcpProjectionAnnotations(record.annotations, `${context}.annotations`)
      return {
        type,
        text: requireMcpProjectionString(record.text, `${context}.text`),
        ...(annotations !== undefined ? { annotations } : {}),
      }
    }
    if (type === "resource") {
      assertMcpProjectionFields(record, ["type", "resource"], context)
      const resource = requireMcpProjectionRecord(record.resource, `${context}.resource`)
      if (Object.hasOwn(resource, "blob")) {
        throw new Error(`${context}.resource contains binary blob content; projected context accepts text only.`)
      }
      assertMcpProjectionFields(resource, ["uri", "mimeType", "text"], `${context}.resource`)
      return {
        type: "resource_text",
        uri: optionalMcpProjectionString(resource.uri, `${context}.resource.uri`),
        mimeType: optionalMcpProjectionString(resource.mimeType, `${context}.resource.mimeType`),
        text: requireMcpProjectionString(resource.text, `${context}.resource.text`),
      }
    }
    if (type === "resource_link") {
      assertMcpProjectionFields(
        record,
        ["type", "uri", "name", "title", "description", "mimeType", "annotations", "icons"],
        context,
      )
      const annotations = optionalMcpProjectionAnnotations(record.annotations, `${context}.annotations`)
      const icons = optionalMcpProjectionIcons(record.icons, `${context}.icons`)
      return {
        type,
        uri: requireMcpProjectionString(record.uri, `${context}.uri`),
        name: optionalMcpProjectionString(record.name, `${context}.name`),
        title: optionalMcpProjectionString(record.title, `${context}.title`),
        description: optionalMcpProjectionString(record.description, `${context}.description`),
        mimeType: optionalMcpProjectionString(record.mimeType, `${context}.mimeType`),
        ...(annotations !== undefined ? { annotations } : {}),
        ...(icons !== undefined ? { icons } : {}),
      }
    }
    if (type === "image" || type === "audio") {
      throw new Error(`${context} contains ${type} content; projected context accepts text and link metadata only.`)
    }
    throw new Error(`${context} contains unsupported MCP content type ${JSON.stringify(type)}.`)
  }

  function sanitizeMcpPromptProjectionPayload(payload: unknown, context: string): SanitizedMcpPromptProjection {
    const record = requireMcpProjectionRecord(payload, context)
    assertMcpProjectionFields(record, ["description", "messages"], context)
    return {
      description: optionalMcpProjectionString(record.description, `${context}.description`),
      messages: requireMcpProjectionArray(record.messages, `${context}.messages`).map((message, index) => {
        const messageContext = `${context}.messages[${index}]`
        const messageRecord = requireMcpProjectionRecord(message, messageContext)
        assertMcpProjectionFields(messageRecord, ["role", "content"], messageContext)
        return {
          role: requireMcpProjectionString(messageRecord.role, `${messageContext}.role`),
          content: sanitizeMcpPromptContent(messageRecord.content, `${messageContext}.content`),
        }
      }),
    }
  }

  function sanitizeMcpResourceProjectionPayload(payload: unknown, context: string): SanitizedMcpResourceProjection {
    const record = requireMcpProjectionRecord(payload, context)
    assertMcpProjectionFields(record, ["contents"], context)
    return {
      contents: requireMcpProjectionArray(record.contents, `${context}.contents`).map((content, index) => {
        const contentContext = `${context}.contents[${index}]`
        const contentRecord = requireMcpProjectionRecord(content, contentContext)
        if (Object.hasOwn(contentRecord, "blob")) {
          throw new Error(`${contentContext} contains binary blob content; projected context accepts text only.`)
        }
        assertMcpProjectionFields(contentRecord, ["uri", "mimeType", "text"], contentContext)
        return {
          uri: requireMcpProjectionString(contentRecord.uri, `${contentContext}.uri`),
          mimeType: optionalMcpProjectionString(contentRecord.mimeType, `${contentContext}.mimeType`),
          text: requireMcpProjectionString(contentRecord.text, `${contentContext}.text`),
        }
      }),
    }
  }

  function renderMcpProjectionBlock(input: {
    kind: "prompt" | "resource"
    providerName: string
    ref: string
    sourcePath?: string
    payload: unknown
  }): string {
    const context = `MCP ${input.kind} ${input.ref}`
    const payload =
      input.kind === "prompt"
        ? sanitizeMcpPromptProjectionPayload(input.payload, context)
        : sanitizeMcpResourceProjectionPayload(input.payload, context)
    return [
      `### MCP ${input.kind}: ${input.providerName}`,
      "",
      `ref: ${input.ref}`,
      ...(input.sourcePath ? [`source: ${input.sourcePath}`] : []),
      "",
      "```json",
      stringifySanitizedMcpProjectionPayload(payload, context),
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
          payload: await prompt.getProjectionPayload({}),
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
          payload: await resource.readProjectionPayload(),
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
    const active = await packageForActiveProfile(input)
    if (!Object.hasOwn(active.pkg.manifest.capability_projection.agents, input.agentID)) return undefined
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
    input: {
      projectDirectory?: string
      toolDirectory?: string
      signal?: AbortSignal
      stageOwnedToolIDs?: Iterable<string>
    } = {},
  ): Promise<Record<string, T>> {
    const projected: Record<string, T> = {}
    const builtInToolIDs = new Set(capability.builtInToolIDs)
    const defaultToolProviderNames = new Set(capability.defaultToolProviderNames)
    for (const [toolID, item] of Object.entries(tools)) {
      if (defaultToolProviderNames.has(toolID)) continue
      if (!builtInToolIDs.has(toolID)) continue
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
    for (const toolID of input.stageOwnedToolIDs ?? []) {
      if (!Object.hasOwn(tools, toolID)) {
        throw new Error(
          `Active expert squad ${JSON.stringify(
            capability.promptProfileID,
          )} ${capability.agentID} stage-owned worker tool ${JSON.stringify(toolID)} is not registered in the runtime map.`,
        )
      }
      const stageOwnedTool = tools[toolID]!
      if (Object.hasOwn(projected, toolID)) {
        if (projected[toolID] === stageOwnedTool) continue
        throw new Error(
          `Active expert squad ${JSON.stringify(
            capability.promptProfileID,
          )} ${capability.agentID} stage-owned worker tool ${JSON.stringify(toolID)} collides with a projected tool.`,
        )
      }
      projected[toolID] = stageOwnedTool
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

  function packageSkillRefParts(pkg: ExpertSquadRegistry.LoadedPackage, ref: string): { owner: string; parts: string[] } {
    const prefix = `${pkg.id}/`
    if (!ref.startsWith(prefix)) throw new Error(`Package skill ref ${JSON.stringify(ref)} is not namespaced by ${pkg.id}`)
    const parts = ref.slice(prefix.length).split("/")
    const owner = parts.shift()
    if (!owner || parts.length === 0) throw new Error(`Invalid package skill ref ${JSON.stringify(ref)}`)
    return { owner, parts }
  }

  function packageSkillPath(pkg: ExpertSquadRegistry.LoadedPackage, ref: string): string {
    const { owner, parts } = packageSkillRefParts(pkg, ref)
    const base = owner === "shared" ? path.join(pkg.root, "skills") : path.join(pkg.root, "agents", owner, "skills")
    return path.join(base, ...parts, "SKILL.md")
  }

  async function packageSkillFromRef(
    pkg: ExpertSquadRegistry.LoadedPackage,
    ref: string,
    mountedAgents: string[],
  ): Promise<Skill.Info> {
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
      mounted_agents: unique(mountedAgents),
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

  function projectedAgentIDsFromSkills(skills: readonly Skill.Info[]): string[] {
    return unique(skills.flatMap((skill) => skill.mounted_agents))
  }

  function skillProjectionAgentIDs(
    activeProfileID: string,
    capabilityAgentIDs: readonly string[],
    skills: readonly Skill.Info[],
  ): string[] {
    if (activeProfileID === DEFAULT_PROMPT_PROFILE_ID) return unique(capabilityAgentIDs)
    return unique([...capabilityAgentIDs, ...projectedAgentIDsFromSkills(skills)])
  }

  async function selectorCatalog(projectDirectory: string | undefined): Promise<ProjectSelectorPackage[]> {
    if (!projectDirectory) return []
    const base = canonicalBase(projectDirectory)
    const selectors: ProjectSelectorPackage[] = []
    for (const entry of await discoverProjectPackages(projectDirectory)) {
      assertNoBuiltInCollision(entry.id)
      if (!entry.selector) continue
      const packageRoot = path.join(base, entry.id)
      selectors.push({
        pkg: entry,
        location: path.join(packageRoot, "selector.md"),
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
      const projectSelectorPackages = await selectorCatalog(input.projectDirectory)
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

    for (const skill of defaultSkills) {
      addProjectedSkill(
        projected,
        {
          ...skill,
          mounted_agents: unique(skill.mounted_agents),
        },
        "default",
      )
    }

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
    const packageSkillMounts = new Map<string, Set<string>>()
    if (!active.builtIn) {
      for (const ref of active.pkg.packageSkillRefs) {
        const { owner } = packageSkillRefParts(active.pkg, ref)
        if (owner === "shared") continue
        const mounts = packageSkillMounts.get(ref) ?? new Set<string>()
        mounts.add(owner)
        packageSkillMounts.set(ref, mounts)
      }
    }
    for (const [role, projection] of roleProjections) {
      for (const ref of projection.default_skill_refs) {
        const name = defaultSkillNameFromRef(ref)
        const skill = defaultSkillsByName.get(name)
        if (!skill) throw new Error(`Active expert squad ${active.profileID} projects missing default skill ${ref}.`)
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
          const mounts = packageSkillMounts.get(ref) ?? new Set<string>()
          mounts.add(role)
          packageSkillMounts.set(ref, mounts)
        }
      }
    }
    if (!active.builtIn) {
      for (const [ref, mounts] of [...packageSkillMounts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        const skill = await packageSkillFromRef(active.pkg, ref, [...mounts])
        addProjectedSkill(projected, skill, "package")
      }
    }

    const selectorSkillNames = selectorSkills.map((skill) => skill.name)
    const projectedSkills = [...projected.values()].map((entry) => entry.skill)
    const skillSurfaceAgentIDs = skillProjectionAgentIDs(active.profileID, projectedAgentIDs, projectedSkills)
    const virtualAgents = activeVirtualAgents(active).filter((virtualAgent) =>
      skillSurfaceAgentIDs.includes(virtualAgent.baseRole),
    )
    const uniqueProductionSkillNames = [...projected.entries()]
      .filter(([, entry]) => entry.source !== "selector")
      .map(([name]) => name)
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
            projectedAgentIDs: skillSurfaceAgentIDs,
            virtualAgents,
            selectorSkillNames,
            productionSkillNames: uniqueProductionSkillNames,
            projectedSkillNames,
            projectedSkillMounts,
          }),
        )
        .digest("hex"),
      projectedToolIDs,
      projectedAgentIDs: skillSurfaceAgentIDs,
      virtualAgents,
      selectorSkillNames,
      productionSkillNames: uniqueProductionSkillNames,
      projectedSkillNames,
      skills: projectedSkills,
    }
  }

  export async function overlayFor(input: PromptInput): Promise<string | undefined> {
    const active = await packageForActiveProfile(input)
    const profile = active.pkg.promptProfile
    const virtualPrompt = profile.virtualAgents[input.agentID]?.promptContent
    if (typeof virtualPrompt === "string" && virtualPrompt.trim().length > 0) return virtualPrompt
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

  function activeAgentProjection(input: {
    active: ActiveProfilePackage
    promptProfileActive: string
  }): ExpertSquadCatalog["active_agent_projection"] {
    const agents = activeVirtualAgents(input.active).map((virtualAgent) => {
      const projection = input.active.pkg.manifest.capability_projection.agents[virtualAgent.baseRole]
      if (!projection) {
        throw new Error(
          `Active expert squad ${input.active.profileID} virtual_agents.${virtualAgent.baseRole} requires capability_projection.agents.${virtualAgent.baseRole}`,
        )
      }
      return {
        base_role: virtualAgent.baseRole,
        virtual_agent_id: virtualAgent.virtualAgentID,
        label: virtualAgent.label,
        ...(virtualAgent.description ? { description: virtualAgent.description } : {}),
        projection_hash: virtualAgent.projectionHash,
        package_skill_refs: projection.package_skill_refs,
        package_tool_refs: projection.package_tool_refs,
        package_mcp_server_refs: projection.package_mcp_server_refs,
      }
    })
    return {
      source_expert_squad_id: input.active.pkg.id,
      prompt_profile_active: input.promptProfileActive,
      projection_hash: createHash("sha256")
        .update(
          stable({
            sourceExpertSquadID: input.active.pkg.id,
            promptProfileActive: input.promptProfileActive,
            agents,
          }),
        )
        .digest("hex"),
      agents,
    }
  }

  export async function catalog(input: ExpertSquadCatalogInput): Promise<ExpertSquadCatalog> {
    const active = PromptProfile.activeID(input.config)
    const projectDirectory = input.scope.directory
    const projectPackagesByID = await projectCatalogPackages(projectDirectory, input.config)
    const squads: ExpertSquadCatalogSummary[] = [
      ...Object.entries(builtInPackages).map(([id, pkg]) =>
        catalogSummaryFromPackage({
          id,
          pkg,
          builtIn: true,
        }),
      ),
      ...Object.entries(projectPackagesByID).map(([id, pkg]) =>
        catalogSummaryFromPackage({
          id,
          pkg,
          builtIn: false,
        }),
      ),
    ]
    if (!squads.some((squad) => squad.id === active)) {
      throw new Error(`Unknown prompt profile ${JSON.stringify(active)}`)
    }
    const activePackage = await packageForActiveProfile({
      projectDirectory,
      config: input.config,
    })
    const skillProjectionInput: SkillProjectionInput = {
      projectDirectory,
      config: input.config,
      defaultSkills: input.defaultSkills,
      agentIDs: input.agentIDs,
      workflow: input.workflow,
    }
    const skillProjection =
      input.defaultSkills === undefined
        ? await Instance.provide({
            directory: projectDirectory,
            fn: () => resolveSkillProjection(skillProjectionInput),
          })
        : await resolveSkillProjection(skillProjectionInput)
    return ExpertSquadCatalogSchema.parse({
      active: {
        effective: active,
        project: input.projectActive,
        session_override: input.sessionOverride,
      },
      default: DEFAULT_PROMPT_PROFILE_ID,
      scope: input.scope,
      targets: PromptProfile.targets,
      squads,
      active_agent_projection: activeAgentProjection({
        active: activePackage,
        promptProfileActive: active,
      }),
      active_skill_projection: {
        active_squad_id: skillProjection.expertSquadID,
        capability_profile_id: skillProjection.capabilityProfileID,
        built_in: skillProjection.builtIn,
        projection_hash: skillProjection.projectionHash,
        projected_tool_ids: skillProjection.projectedToolIDs,
        projected_agent_ids: skillProjection.projectedAgentIDs,
        selector_skill_names: skillProjection.selectorSkillNames,
        production_skill_names: skillProjection.productionSkillNames,
        projected_skill_names: skillProjection.projectedSkillNames,
        skills: skillProjection.skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          builtin: skill.builtin ?? false,
          location: skill.location,
          required_tools: skill.required_tools,
          mounted_agents: skill.mounted_agents,
        })),
      },
    })
  }
}
