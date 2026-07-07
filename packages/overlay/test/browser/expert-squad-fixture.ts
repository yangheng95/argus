import type { ExpertSquadCatalog } from "../../src/services/expert-squad"
import {
  defaultMcpToolProviderName,
  defaultToolProviderName,
  packageMcpToolProviderName,
  packageToolProviderName,
} from "../../../opencorvus/src/expert-squad/provider-names.ts"

type ProjectionEntry = ReturnType<typeof emptyExpertSquadProjectionEntry>
type ProjectionPatch = Partial<ProjectionEntry>

export interface ExpertSquadFixture {
  id: string
  label: string
  namespace?: string
  description?: string
  display_prefix?: string
  built_in?: boolean
  editable?: boolean
  virtual_agents?: Array<{
    base_role: string
    virtual_agent_id: string
    label: string
    description?: string
  }>
  capability_projection?: {
    scheduler?: ProjectionPatch
    agents?: Record<string, ProjectionPatch>
  }
}

export interface ExpertSquadCatalogFixtureInput {
  active?: string
  projectActive?: string
  sessionOverride?: string | null
  defaultSquad?: string
  activeSkillProjection?: ExpertSquadCatalog["active_skill_projection"]
  targets?: Array<{
    id: string
    label: string
    description?: string
    editable: boolean
    built_in_only: boolean
  }>
  squads?: ExpertSquadFixture[]
}

export function emptyExpertSquadProjectionEntry() {
  return {
    built_in_tool_ids: [],
    default_skill_refs: [],
    package_skill_refs: [],
    default_tool_refs: [],
    package_tool_refs: [],
    default_mcp_server_refs: [],
    package_mcp_server_refs: [],
    default_mcp_tool_refs: [],
    package_mcp_tool_refs: [],
    default_mcp_prompt_refs: [],
    package_mcp_prompt_refs: [],
    default_mcp_resource_refs: [],
    package_mcp_resource_refs: [],
  }
}

export function projectedPackageToolID(ref: string): string {
  return packageToolProviderName(ref)
}

export function projectedDefaultToolID(ref: string): string {
  return defaultToolProviderName(ref)
}

export function projectedDefaultMcpToolID(ref: string): string {
  return defaultMcpToolProviderName(ref)
}

export function projectedPackageMcpToolID(ref: string): string {
  return packageMcpToolProviderName(ref)
}

export function projectedToolIDs(...ids: string[]): string[] {
  for (const id of ids) {
    if (id.includes("/") || id.includes(".")) {
      throw new Error(`projected_tool_ids must use runtime tool IDs, not refs: ${id}`)
    }
    if (id === "exec_command") {
      throw new Error("projected_tool_ids must use canonical OpenCorvus tool IDs; exec_command is not canonical")
    }
  }
  return ids
}

function projectionEntryFromPatch(patch: ProjectionPatch | undefined): ProjectionEntry {
  const projection = {
    ...emptyExpertSquadProjectionEntry(),
    built_in_tool_ids: patch?.built_in_tool_ids ?? [],
    default_skill_refs: patch?.default_skill_refs ?? [],
    package_skill_refs: patch?.package_skill_refs ?? [],
    default_tool_refs: patch?.default_tool_refs ?? [],
    package_tool_refs: patch?.package_tool_refs ?? [],
    default_mcp_server_refs: patch?.default_mcp_server_refs ?? [],
    package_mcp_server_refs: patch?.package_mcp_server_refs ?? [],
    default_mcp_tool_refs: patch?.default_mcp_tool_refs ?? [],
    package_mcp_tool_refs: patch?.package_mcp_tool_refs ?? [],
    default_mcp_prompt_refs: patch?.default_mcp_prompt_refs ?? [],
    package_mcp_prompt_refs: patch?.package_mcp_prompt_refs ?? [],
    default_mcp_resource_refs: patch?.default_mcp_resource_refs ?? [],
    package_mcp_resource_refs: patch?.package_mcp_resource_refs ?? [],
  }
  assertProductionProjectionShape(projection)
  return projection
}

export function expertSquadProjectionEntryFixture(overrides: ProjectionPatch): ProjectionEntry {
  return projectionEntryFromPatch(overrides)
}

function assertProductionProjectionShape(projection: ProjectionEntry): void {
  if (projection.default_mcp_server_refs.length > 0) {
    throw new Error(
      "default_mcp_server_refs is not supported; use default_mcp_tool_refs, default_mcp_prompt_refs, or default_mcp_resource_refs",
    )
  }
  for (const serverRef of projection.package_mcp_server_refs) {
    const duplicateToolRef = projection.package_mcp_tool_refs.find((ref) => ref.startsWith(`${serverRef}/tool/`))
    if (duplicateToolRef) {
      throw new Error(`package MCP tool ref ${duplicateToolRef} is already mounted by package_mcp_server_refs`)
    }
    const duplicatePromptRef = projection.package_mcp_prompt_refs.find((ref) => ref.startsWith(`${serverRef}/prompt/`))
    if (duplicatePromptRef) {
      throw new Error(`package MCP prompt ref ${duplicatePromptRef} is already mounted by package_mcp_server_refs`)
    }
    const duplicateResourceRef = projection.package_mcp_resource_refs.find((ref) =>
      ref.startsWith(`${serverRef}/resource/`),
    )
    if (duplicateResourceRef) {
      throw new Error(`package MCP resource ref ${duplicateResourceRef} is already mounted by package_mcp_server_refs`)
    }
  }
}

function projectionHasSurface(projection: ProjectionEntry): boolean {
  return Object.values(projection).some((items) => items.length > 0)
}

function squadHasCapabilitySurface(squad: ExpertSquadCatalog["squads"][number] | undefined): boolean {
  if (!squad) return false
  return (
    projectionHasSurface(squad.capability_projection.scheduler) ||
    Object.values(squad.capability_projection.agents).some(projectionHasSurface)
  )
}

function assertCompleteActiveSkillProjection(
  active: string,
  projection: ExpertSquadCatalog["active_skill_projection"] | undefined,
): ExpertSquadCatalog["active_skill_projection"] | undefined {
  if (projection === undefined) return undefined
  const required = [
    "active_squad_id",
    "capability_profile_id",
    "built_in",
    "projection_hash",
    "projected_tool_ids",
    "projected_agent_ids",
    "selector_skill_names",
    "production_skill_names",
    "projected_skill_names",
    "skills",
  ] as const
  for (const key of required) {
    if (!Object.hasOwn(projection, key)) {
      throw new Error(`activeSkillProjection.${key} is required for active expert squad ${active}`)
    }
  }
  if (projection.active_squad_id !== active) {
    throw new Error(`activeSkillProjection.active_squad_id must match active expert squad ${active}`)
  }
  if (projection.capability_profile_id !== active) {
    throw new Error(`activeSkillProjection.capability_profile_id must match active expert squad ${active}`)
  }
  if (typeof projection.built_in !== "boolean" || typeof projection.projection_hash !== "string") {
    throw new Error(`activeSkillProjection has invalid scalar fields for active expert squad ${active}`)
  }
  for (const key of [
    "projected_tool_ids",
    "projected_agent_ids",
    "selector_skill_names",
    "production_skill_names",
    "projected_skill_names",
    "skills",
  ] as const) {
    if (!Array.isArray(projection[key])) {
      throw new Error(`activeSkillProjection.${key} must be an array for active expert squad ${active}`)
    }
  }
  projectedToolIDs(...projection.projected_tool_ids)
  return projection
}

function projectPackageRoot(namespace: string, id: string): string {
  return `D:/repo/.opencorvus/expert-squads/${namespace}/${id}`
}

export function expertSquadOptionFixture(squad: ExpertSquadFixture) {
  const builtIn = squad.built_in ?? squad.id === "general"
  const displayLabel = squad.display_prefix ? `${squad.display_prefix}/${squad.label}` : squad.label
  const virtualAgents = squad.virtual_agents ?? []
  const capabilityProjectionAgents = squad.capability_projection?.agents ?? {}
  for (const agent of virtualAgents) {
    if (!Object.hasOwn(capabilityProjectionAgents, agent.base_role)) {
      throw new Error(`virtual_agents.${agent.base_role} requires capability_projection.agents.${agent.base_role}`)
    }
  }
  const projectionAgentRoles = Object.keys(capabilityProjectionAgents).sort()
  const namespace = squad.namespace ?? "project"
  const root = projectPackageRoot(namespace, squad.id)
  return {
    id: squad.id,
    label: squad.label,
    display_prefix: squad.display_prefix,
    display_label: displayLabel,
    description: squad.description,
    built_in: builtIn,
    editable: squad.editable ?? false,
    agents: {},
    capability_profile_id: squad.id,
    projection_hash: `test-${squad.id}`,
    projected_agents: projectionAgentRoles,
    virtual_agents: virtualAgents.map((agent) => ({
      base_role: agent.base_role,
      virtual_agent_id: agent.virtual_agent_id,
      label: agent.label,
      description: agent.description,
    })),
    capability_projection: {
      scheduler: projectionEntryFromPatch(squad.capability_projection?.scheduler),
      agents: Object.fromEntries(
        projectionAgentRoles.map((agent) => [
          agent,
          projectionEntryFromPatch(capabilityProjectionAgents[agent]),
        ]),
      ),
    },
    source: builtIn
      ? { kind: "built_in" }
      : {
          kind: "project_package",
          namespace,
          root,
          manifest_path: `${root}/expert-squad.jsonc`,
          readme_path: `${root}/README.md`,
        },
    readme: {
      path: "README.md",
      append_target: "orchestrator",
      content: `# ${squad.label}\n\n${squad.description ?? "Expert squad guidance."}`,
    },
    dynamic_attributes: {
      frontend_design: {
        require_design_direction_contract: false,
      },
    },
  }
}

export function expertSquadCatalogFixture(input: ExpertSquadCatalogFixtureInput = {}) {
  const allowedInputKeys = new Set([
    "active",
    "projectActive",
    "sessionOverride",
    "defaultSquad",
    "activeSkillProjection",
    "targets",
    "squads",
  ])
  for (const key of Object.keys(input)) {
    if (!allowedInputKeys.has(key)) {
      throw new Error(`expertSquadCatalogFixture received unsupported field ${JSON.stringify(key)}`)
    }
  }
  const active = input.active ?? "general"
  const squads =
    input.squads ??
    [
      {
        id: "general",
        label: "General",
        display_prefix: "Builtin",
        description: "General expert squad.",
      },
    ]
  const squadOptions = squads.map(expertSquadOptionFixture)
  const activeOption = squadOptions.find((squad) => squad.id === active)
  const activeSkillProjection = assertCompleteActiveSkillProjection(active, input.activeSkillProjection)
  if (squadHasCapabilitySurface(activeOption) && !activeSkillProjection) {
    throw new Error(
      `activeSkillProjection must be supplied for active expert squad ${active} because production active_skill_projection is resolver output`,
    )
  }
  const activeFixture = squads.find((squad) => squad.id === active)
  const activeVirtualAgents = activeFixture?.virtual_agents ?? []
  const activeCapabilityAgents = activeOption?.capability_projection.agents ?? {}
  const activeProjectedAgents = activeVirtualAgents.map((agent) => ({
    base_role: agent.base_role,
    virtual_agent_id: agent.virtual_agent_id,
    label: agent.label,
    description: agent.description,
    projection_hash: `test-${active}-${agent.base_role}`,
    built_in_tool_ids: activeCapabilityAgents[agent.base_role]?.built_in_tool_ids ?? [],
    default_skill_refs: activeCapabilityAgents[agent.base_role]?.default_skill_refs ?? [],
    package_skill_refs: activeCapabilityAgents[agent.base_role]?.package_skill_refs ?? [],
    default_tool_refs: activeCapabilityAgents[agent.base_role]?.default_tool_refs ?? [],
    package_tool_refs: activeCapabilityAgents[agent.base_role]?.package_tool_refs ?? [],
    default_mcp_server_refs: activeCapabilityAgents[agent.base_role]?.default_mcp_server_refs ?? [],
    package_mcp_server_refs: activeCapabilityAgents[agent.base_role]?.package_mcp_server_refs ?? [],
    default_mcp_tool_refs: activeCapabilityAgents[agent.base_role]?.default_mcp_tool_refs ?? [],
    package_mcp_tool_refs: activeCapabilityAgents[agent.base_role]?.package_mcp_tool_refs ?? [],
    default_mcp_prompt_refs: activeCapabilityAgents[agent.base_role]?.default_mcp_prompt_refs ?? [],
    package_mcp_prompt_refs: activeCapabilityAgents[agent.base_role]?.package_mcp_prompt_refs ?? [],
    default_mcp_resource_refs: activeCapabilityAgents[agent.base_role]?.default_mcp_resource_refs ?? [],
    package_mcp_resource_refs: activeCapabilityAgents[agent.base_role]?.package_mcp_resource_refs ?? [],
  }))
  return {
    active: {
      effective: active,
      project: input.projectActive ?? active,
      session_override: input.sessionOverride ?? null,
    },
    default: input.defaultSquad ?? "general",
    scope: {
      kind: input.sessionOverride === undefined ? "project" : "session",
      directory: "D:/repo",
      ...(input.sessionOverride === undefined ? {} : { sessionID: "ses_root" }),
    },
    targets: input.targets ?? [],
    squads: squadOptions,
    active_agent_projection: {
      source_expert_squad_id: active,
      prompt_profile_active: active,
      projection_hash: `test-${active}`,
      agents: activeProjectedAgents,
    },
    active_skill_projection: activeSkillProjection ?? {
      active_squad_id: active,
      capability_profile_id: active,
      built_in: active === "general",
      projection_hash: `test-${active}`,
      projected_tool_ids: [],
      projected_agent_ids: [],
      selector_skill_names: [],
      production_skill_names: [],
      projected_skill_names: [],
      skills: [],
    },
  } satisfies ExpertSquadCatalog
}

export function generalExpertSquadCatalog() {
  return expertSquadCatalogFixture()
}

export function frontendReplicaExpertSquadCatalog() {
  return expertSquadCatalogFixture({
    active: "frontend-replica",
    projectActive: "frontend-replica",
    squads: [
      {
        id: "general",
        label: "General",
        display_prefix: "Builtin",
        description: "General expert squad.",
        built_in: true,
      },
      {
        id: "frontend-replica",
        label: "Frontend Replica",
        display_prefix: "Builtin",
        description: "Frontend Replica project expert squad.",
        built_in: false,
      },
    ],
  })
}
