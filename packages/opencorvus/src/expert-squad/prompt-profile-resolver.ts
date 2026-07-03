import { createHash } from "node:crypto"
import path from "node:path"
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
import { AgentRoleContract, type OrchestratorWorkflowToolName } from "@/agent/role-contract"
import { AgentToolPool } from "@/agent/tool-pool-contract"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { Filesystem } from "@/util/filesystem"
import { loadedBuiltInPackages } from "./builtin"
import { ExpertSquadRegistry } from "./registry"

type ConfigLike = {
  prompt_profile?: PromptProfileConfig
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
    projectedWorkflowTools: OrchestratorWorkflowToolName[]
    includeMcpTools: false
  }

  type PackageWithCapability = {
    id: string
    manifest: ExpertSquadRegistry.Manifest
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

  async function projectPackages(projectDirectory: string): Promise<Record<string, ExpertSquadRegistry.LoadedPackage>> {
    const result: Record<string, ExpertSquadRegistry.LoadedPackage> = {}
    for (const entry of await ExpertSquadRegistry.discover(projectDirectory)) {
      assertNoBuiltInCollision(entry.id)
      const loaded = await ExpertSquadRegistry.loadPackage(path.join(canonicalBase(projectDirectory), entry.id))
      assertNoBuiltInCollision(loaded.id)
      result[loaded.id] = loaded
    }
    return result
  }

  async function projectPromptProfiles(projectDirectory: string): Promise<Record<string, PromptProfileDefinition>> {
    return Object.fromEntries(
      Object.entries(await projectPackages(projectDirectory)).map(([id, loaded]) => [id, loaded.promptProfile]),
    )
  }

  export async function definitions(projectDirectory: string): Promise<Record<string, PromptProfileDefinition>> {
    return {
      ...PromptProfile.builtIns,
      ...(await projectPromptProfiles(projectDirectory)),
    }
  }

  async function definitionsForScope(projectDirectory?: string): Promise<Record<string, PromptProfileDefinition>> {
    if (!projectDirectory) return { ...PromptProfile.builtIns }
    return definitions(projectDirectory)
  }

  async function packageForActiveProfile(input: SchedulerCapabilityInput): Promise<{
    profileID: string
    builtIn: boolean
    pkg: PackageWithCapability
  }> {
    const profileID = PromptProfile.activeID(input.config)
    const builtIn = builtInPackages[profileID]
    const projectPackagesByID = input.projectDirectory ? await projectPackages(input.projectDirectory) : {}
    if (builtIn) {
      if (Object.hasOwn(projectPackagesByID, profileID)) {
        throw new Error(`Project expert squad package id ${JSON.stringify(profileID)} collides with a built-in expert squad id.`)
      }
      return { profileID, builtIn: true, pkg: builtIn }
    }
    const projectPackage = projectPackagesByID[profileID]
    if (projectPackage) return { profileID, builtIn: false, pkg: projectPackage }
    throw new Error(`Unknown prompt profile ${JSON.stringify(profileID)}`)
  }

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

  function projectionHash(input: { profileID: string; projection: ExpertSquadRegistry.Projection; toolIDs: string[] }) {
    return createHash("sha256").update(stable(input)).digest("hex")
  }

  function workflowToolIDs(toolIDs: readonly string[]): OrchestratorWorkflowToolName[] {
    const allowed = new Set<OrchestratorWorkflowToolName>()
    for (const role of AgentRoleContract.ids) {
      const workflowTool = AgentRoleContract.orchestratorWorkflowToolName(role)
      if (workflowTool) allowed.add(workflowTool)
    }
    return toolIDs.filter((toolID): toolID is OrchestratorWorkflowToolName =>
      allowed.has(toolID as OrchestratorWorkflowToolName),
    )
  }

  function roleForWorkflowTool(toolID: OrchestratorWorkflowToolName): string {
    for (const role of AgentRoleContract.ids) {
      if (AgentRoleContract.orchestratorWorkflowToolName(role) === toolID) return role
    }
    throw new Error(`Unknown Orchestrator workflow tool "${toolID}"`)
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

  export async function resolveSchedulerCapability(
    input: SchedulerCapabilityInput,
  ): Promise<ResolvedSchedulerCapability> {
    const active = await packageForActiveProfile(input)
    const scheduler = active.pkg.manifest.capability_projection.scheduler
    const builtInToolIDs = expandedSchedulerBuiltInToolIDs(scheduler)
    const projectedWorkflowTools = workflowToolIDs(builtInToolIDs)
    for (const workflowTool of projectedWorkflowTools) {
      const role = roleForWorkflowTool(workflowTool)
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
      projectionHash: projectionHash({ profileID: active.profileID, projection: scheduler, toolIDs: builtInToolIDs }),
      scheduler,
      builtInToolIDs,
      projectedWorkflowTools,
      includeMcpTools: false,
    }
  }

  export function projectOrchestratorTools<T>(
    tools: Record<string, T>,
    capability: ResolvedSchedulerCapability,
  ): Record<string, T> {
    const projected: Record<string, T> = {}
    for (const toolID of capability.builtInToolIDs) {
      if (!Object.hasOwn(tools, toolID)) {
        throw new Error(
          `Active expert squad ${JSON.stringify(capability.promptProfileID)} projects Orchestrator tool ${JSON.stringify(
            toolID,
          )}, but createOrchestratorTools did not build that tool.`,
        )
      }
      projected[toolID] = tools[toolID]
    }
    return projected
  }

  export async function overlayFor(input: PromptInput): Promise<string | undefined> {
    const active = PromptProfile.activeID(input.config)
    const profiles = await definitionsForScope(input.projectDirectory)
    const profile = profiles[active]
    if (!profile) {
      throw new Error(`Unknown prompt profile ${JSON.stringify(active)}`)
    }
    const prompt = profile.agents[input.agentID]
    return typeof prompt === "string" && prompt.trim().length > 0 ? prompt : undefined
  }

  export async function composeAgentPrompt(input: ComposeInput): Promise<string> {
    const profilePrompt = await overlayFor(input)
    return [input.base, profilePrompt, input.userAppend]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join("\n\n")
  }

  export async function assertKnownProfileID(input: ProfileIDInput): Promise<void> {
    PromptProfileIDSchema.parse(input.profileID)
    if (!Object.hasOwn(await definitionsForScope(input.projectDirectory), input.profileID)) {
      throw new Error(`Unknown prompt profile ${JSON.stringify(input.profileID)}`)
    }
  }

  export async function list(input: CatalogInput): Promise<PromptProfileCatalog> {
    const active = PromptProfile.activeID(input.config)
    const projectProfiles = input.projectDirectory ? await projectPromptProfiles(input.projectDirectory) : {}
    const profiles: PromptProfileCatalogProfile[] = [
      ...Object.entries(PromptProfile.builtIns).map(([id, profile]) => ({
        id,
        label: profile.label,
        description: profile.description,
        built_in: true,
        editable: false,
        agents: { ...(profile.agents ?? {}) },
      })),
      ...Object.entries(projectProfiles).map(([id, profile]) => ({
        id,
        label: profile.label,
        description: profile.description,
        built_in: false,
        editable: false,
        agents: { ...(profile.agents ?? {}) },
      })),
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
