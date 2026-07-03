import { createHash } from "node:crypto"
import path from "node:path"
import matter from "gray-matter"
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
import { AgentToolPool } from "@/agent/tool-pool-contract"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { Skill } from "@/skill/skill"
import { Filesystem } from "@/util/filesystem"
import { AgentRoleContract, type OrchestratorWorkflowToolName } from "@/agent/role-contract"
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

  export interface SkillProjectionInput extends ProjectScope {
    config: ConfigLike
    defaultSkills?: Skill.Info[]
    agentIDs?: string[]
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
  type PackageWithCapability = BuiltInPackage | ExpertSquadRegistry.LoadedPackage
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

  async function packageForActiveProfile(input: SchedulerCapabilityInput): Promise<ActiveProfilePackage> {
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
  }): Skill.Info | undefined {
    const markdown = ExpertSquadRegistry.renderSelectorSkillMarkdown(input.pkg)
    if (!markdown) return undefined
    const parsed = matter(markdown)
    const name = selectorSkillName(input.pkg.id)
    const defaultSkill = input.defaultSkillsByName.get(name)
    const location = input.builtin && defaultSkill?.builtin ? defaultSkill.location : input.pkg.manifestPath
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

  async function selectorCatalog(projectDirectory: string | undefined): Promise<ExpertSquadRegistry.PackageCatalogEntry[]> {
    if (!projectDirectory) return []
    const entries = await ExpertSquadRegistry.discover(projectDirectory)
    for (const entry of entries) assertNoBuiltInCollision(entry.id)
    return entries
  }

  export async function resolveSkillProjection(input: SkillProjectionInput): Promise<ResolvedSkillProjection> {
    const [capability, active, defaultSkills, projectSelectors] = await Promise.all([
      resolveSchedulerCapability(input),
      packageForActiveProfile(input),
      input.defaultSkills ?? Skill.all(),
      selectorCatalog(input.projectDirectory),
    ])
    const defaultSkillsByName = new Map(defaultSkills.map((skill) => [skill.name, skill]))
    const builtInSelectorPackages = loadedBuiltInPackages.filter((pkg) => pkg.selector)
    const projectSelectorPackages = projectSelectors.filter((pkg) => pkg.selector)
    const builtInSelectorNames = new Set(builtInSelectorPackages.map((pkg) => selectorSkillName(pkg.id)))
    const allSelectorNames = new Set([
      ...builtInSelectorNames,
      ...projectSelectorPackages.map((pkg) => selectorSkillName(pkg.id)),
    ])
    assertNoSelectorCollision(defaultSkills, allSelectorNames, builtInSelectorNames)

    const projectedAgentIDs =
      active.profileID === DEFAULT_PROMPT_PROFILE_ID && input.agentIDs
        ? unique(input.agentIDs)
        : unique(["orchestrator", ...Object.keys(active.pkg.manifest.capability_projection.agents)])

    const projected = new Map<string, { skill: Skill.Info; source: SkillSourceKind }>()

    const selectorPackages =
      active.profileID === DEFAULT_PROMPT_PROFILE_ID
        ? [
            ...builtInSelectorPackages.map((pkg) => ({ pkg, builtin: true })),
            ...projectSelectorPackages.map((pkg) => ({
              pkg: {
                ...pkg,
                manifestPath: path.join(canonicalBase(input.projectDirectory!), pkg.id, ExpertSquadRegistry.MANIFEST),
              },
              builtin: false,
            })),
          ]
        : active.pkg.selector
          ? [{ pkg: active.pkg, builtin: active.builtIn }]
          : []
    const selectorSkills = selectorPackages
      .map((entry) =>
        selectorSkillFromPackage({
          pkg: entry.pkg,
          builtin: entry.builtin,
          defaultSkillsByName,
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
            projectedAgentIDs,
            selectorSkillNames,
            productionSkillNames: uniqueProductionSkillNames,
            projectedSkillNames,
            projectedSkillMounts,
          }),
        )
        .digest("hex"),
      projectedToolIDs: capability.builtInToolIDs,
      projectedAgentIDs,
      selectorSkillNames,
      productionSkillNames: uniqueProductionSkillNames,
      projectedSkillNames,
      skills: [...projected.values()].map((entry) => entry.skill),
    }
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
