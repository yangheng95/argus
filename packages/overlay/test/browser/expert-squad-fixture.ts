import type { ExpertSquadCatalog } from "../../src/services/expert-squad"

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
    projection_hash?: string
    built_in_tool_ids?: string[]
    default_skill_refs?: string[]
    package_skill_refs?: string[]
    default_tool_refs?: string[]
    package_tool_refs?: string[]
    default_mcp_server_refs?: string[]
    package_mcp_server_refs?: string[]
    default_mcp_tool_refs?: string[]
    package_mcp_tool_refs?: string[]
    default_mcp_prompt_refs?: string[]
    package_mcp_prompt_refs?: string[]
    default_mcp_resource_refs?: string[]
    package_mcp_resource_refs?: string[]
  }>
}

export interface ExpertSquadCatalogFixtureInput {
  active?: string
  projectActive?: string
  sessionOverride?: string | null
  defaultSquad?: string
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

function projectionEntryFromVirtualAgent(agent: NonNullable<ExpertSquadFixture["virtual_agents"]>[number]) {
  return {
    ...emptyExpertSquadProjectionEntry(),
    built_in_tool_ids: agent.built_in_tool_ids ?? [],
    default_skill_refs: agent.default_skill_refs ?? [],
    package_skill_refs: agent.package_skill_refs ?? [],
    default_tool_refs: agent.default_tool_refs ?? [],
    package_tool_refs: agent.package_tool_refs ?? [],
    default_mcp_server_refs: agent.default_mcp_server_refs ?? [],
    package_mcp_server_refs: agent.package_mcp_server_refs ?? [],
    default_mcp_tool_refs: agent.default_mcp_tool_refs ?? [],
    package_mcp_tool_refs: agent.package_mcp_tool_refs ?? [],
    default_mcp_prompt_refs: agent.default_mcp_prompt_refs ?? [],
    package_mcp_prompt_refs: agent.package_mcp_prompt_refs ?? [],
    default_mcp_resource_refs: agent.default_mcp_resource_refs ?? [],
    package_mcp_resource_refs: agent.package_mcp_resource_refs ?? [],
  }
}

function projectPackageRoot(namespace: string, id: string): string {
  return `D:/repo/.opencorvus/expert-squads/${namespace}/${id}`
}

export function expertSquadOptionFixture(squad: ExpertSquadFixture) {
  const builtIn = squad.built_in ?? squad.id === "general"
  const displayLabel = squad.display_prefix ? `${squad.display_prefix}/${squad.label}` : squad.label
  const virtualAgents = squad.virtual_agents ?? []
  const virtualAgentsByRole = new Map(virtualAgents.map((agent) => [agent.base_role, agent]))
  const projectedAgentRoles = virtualAgents.map((agent) => agent.base_role).sort()
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
    projected_agents: projectedAgentRoles,
    virtual_agents: virtualAgents.map((agent) => ({
      base_role: agent.base_role,
      virtual_agent_id: agent.virtual_agent_id,
      label: agent.label,
      description: agent.description,
    })),
    capability_projection: {
      scheduler: emptyExpertSquadProjectionEntry(),
      agents: Object.fromEntries(
        projectedAgentRoles.map((agent) => [
          agent,
          virtualAgentsByRole.has(agent)
            ? projectionEntryFromVirtualAgent(virtualAgentsByRole.get(agent)!)
            : emptyExpertSquadProjectionEntry(),
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
  const allowedInputKeys = new Set(["active", "projectActive", "sessionOverride", "defaultSquad", "targets", "squads"])
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
  const activeFixture = squads.find((squad) => squad.id === active)
  const activeProjectedAgents = (activeFixture?.virtual_agents ?? []).map((agent) => ({
    base_role: agent.base_role,
    virtual_agent_id: agent.virtual_agent_id,
    label: agent.label,
    description: agent.description,
    projection_hash: agent.projection_hash ?? `test-${active}-${agent.base_role}`,
    built_in_tool_ids: agent.built_in_tool_ids ?? [],
    default_skill_refs: agent.default_skill_refs ?? [],
    package_skill_refs: agent.package_skill_refs ?? [],
    default_tool_refs: agent.default_tool_refs ?? [],
    package_tool_refs: agent.package_tool_refs ?? [],
    default_mcp_server_refs: agent.default_mcp_server_refs ?? [],
    package_mcp_server_refs: agent.package_mcp_server_refs ?? [],
    default_mcp_tool_refs: agent.default_mcp_tool_refs ?? [],
    package_mcp_tool_refs: agent.package_mcp_tool_refs ?? [],
    default_mcp_prompt_refs: agent.default_mcp_prompt_refs ?? [],
    package_mcp_prompt_refs: agent.package_mcp_prompt_refs ?? [],
    default_mcp_resource_refs: agent.default_mcp_resource_refs ?? [],
    package_mcp_resource_refs: agent.package_mcp_resource_refs ?? [],
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
    active_skill_projection: {
      active_squad_id: active,
      capability_profile_id: active,
      built_in: active === "general",
      projection_hash: `test-${active}`,
      projected_tool_ids: [],
      projected_agent_ids: activeProjectedAgents.map((agent) => agent.base_role),
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
