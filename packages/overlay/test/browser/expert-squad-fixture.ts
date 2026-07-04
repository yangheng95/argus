export interface ExpertSquadFixture {
  id: string
  label: string
  description?: string
  built_in?: boolean
  editable?: boolean
  agents?: Record<string, string>
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

export function expertSquadOptionFixture(squad: ExpertSquadFixture) {
  const agents = squad.agents ?? {}
  const builtIn = squad.built_in ?? squad.id === "general"
  return {
    id: squad.id,
    label: squad.label,
    description: squad.description,
    built_in: builtIn,
    editable: squad.editable ?? false,
    agents,
    capability_profile_id: squad.id,
    projection_hash: `test-${squad.id}`,
    projected_agents: Object.keys(agents),
    capability_projection: {
      scheduler: emptyExpertSquadProjectionEntry(),
      agents: Object.fromEntries(Object.keys(agents).map((agent) => [agent, emptyExpertSquadProjectionEntry()])),
    },
    source: builtIn
      ? { kind: "built_in" }
      : {
          kind: "project_package",
          root: `D:/repo/.opencorvus/expert-squads/${squad.id}`,
          manifest_path: `D:/repo/.opencorvus/expert-squads/${squad.id}/expert-squad.jsonc`,
          readme_path: `D:/repo/.opencorvus/expert-squads/${squad.id}/README.md`,
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
  const active = input.active ?? "general"
  const squads =
    input.squads ??
    [
      {
        id: "general",
        label: "General",
        description: "General expert squad.",
      },
    ]
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
    squads: squads.map(expertSquadOptionFixture),
    active_skill_projection: {
      active_squad_id: active,
      capability_profile_id: active,
      built_in: active === "general",
      projection_hash: `test-${active}`,
      projected_tool_ids: [],
      projected_agent_ids: ["orchestrator"],
      selector_skill_names: [],
      production_skill_names: [],
      projected_skill_names: [],
      skills: [],
    },
  }
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
        description: "General expert squad.",
        built_in: true,
      },
      {
        id: "frontend-replica",
        label: "Frontend Replica",
        description: "Frontend Replica project expert squad.",
        built_in: false,
      },
    ],
  })
}
