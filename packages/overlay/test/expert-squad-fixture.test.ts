import { describe, expect, test } from "bun:test"

import {
  expertSquadCatalogFixture,
  projectedPackageToolID,
  projectedToolIDs,
} from "./browser/expert-squad-fixture"

describe("expert squad catalog fixture", () => {
  test("rejects virtual agents without a matching capability projection", () => {
    expect(() =>
      expertSquadCatalogFixture({
        active: "frontend-replica",
        squads: [
          { id: "general", label: "General", built_in: true },
          {
            id: "frontend-replica",
            label: "Frontend Replica",
            built_in: false,
            virtual_agents: [
              {
                base_role: "build",
                virtual_agent_id: "frontend-replica-builder",
                label: "Frontend Replica Builder",
              },
            ],
          },
        ],
      }),
    ).toThrow("virtual_agents.build requires capability_projection.agents.build")
  })

  test("keeps virtual agent identity separate from the active skill projection payload", () => {
    const packageToolRef = "frontend-replica/build/visual-qa"
    const packageToolID = projectedPackageToolID(packageToolRef)
    const catalog = expertSquadCatalogFixture({
      active: "frontend-replica",
      squads: [
        { id: "general", label: "General", built_in: true },
        {
          id: "frontend-replica",
          label: "Frontend Replica",
          built_in: false,
          virtual_agents: [
            {
              base_role: "build",
              virtual_agent_id: "frontend-replica-builder",
              label: "Frontend Replica Builder",
            },
          ],
          capability_projection: {
            agents: {
              build: {
                package_skill_refs: ["frontend-replica/build/implementation"],
                package_tool_refs: [packageToolRef],
              },
            },
          },
        },
      ],
      activeSkillProjection: {
        active_squad_id: "frontend-replica",
        capability_profile_id: "frontend-replica",
        built_in: false,
        projection_hash: "test-frontend-replica",
        projected_agent_ids: ["orchestrator", "build"],
        projected_tool_ids: projectedToolIDs(packageToolID),
        selector_skill_names: [],
        production_skill_names: ["frontend-replica-build"],
        projected_skill_names: ["frontend-replica-build"],
        skills: [],
      },
    })

    expect(catalog.active_agent_projection.agents).toHaveLength(1)
    expect(catalog.active_agent_projection.agents[0]?.package_tool_refs).toEqual([packageToolRef])
    expect(catalog.active_skill_projection.projected_tool_ids).toEqual([packageToolID])
  })

  test("requires complete active skill projection payload for active capability surfaces", () => {
    expect(() =>
      expertSquadCatalogFixture({
        active: "frontend-replica",
        squads: [
          { id: "general", label: "General", built_in: true },
          {
            id: "frontend-replica",
            label: "Frontend Replica",
            built_in: false,
            capability_projection: {
              scheduler: {
                package_tool_refs: ["frontend-replica/orchestrator/source-evidence"],
              },
            },
          },
        ],
        activeSkillProjection: {} as never,
      }),
    ).toThrow()
  })

  test("rejects ref-shaped active projected tool IDs", () => {
    expect(() =>
      expertSquadCatalogFixture({
        active: "frontend-replica",
        squads: [
          { id: "general", label: "General", built_in: true },
          {
            id: "frontend-replica",
            label: "Frontend Replica",
            built_in: false,
            capability_projection: {
              scheduler: {
                package_tool_refs: ["frontend-replica/orchestrator/source-evidence"],
              },
            },
          },
        ],
        activeSkillProjection: {
          active_squad_id: "frontend-replica",
          capability_profile_id: "frontend-replica",
          built_in: false,
          projection_hash: "test-frontend-replica",
          projected_tool_ids: ["frontend-replica/orchestrator/source-evidence"],
          projected_agent_ids: ["orchestrator"],
          selector_skill_names: [],
          production_skill_names: [],
          projected_skill_names: [],
          skills: [],
        },
      }),
    ).toThrow("projected_tool_ids must use runtime tool IDs")
  })

  test("rejects production-invalid MCP server projection shapes", () => {
    expect(() =>
      expertSquadCatalogFixture({
        active: "frontend-replica",
        squads: [
          { id: "general", label: "General", built_in: true },
          {
            id: "frontend-replica",
            label: "Frontend Replica",
            built_in: false,
            capability_projection: {
              scheduler: {
                default_mcp_server_refs: ["default/mcp/browser"],
              },
            },
          },
        ],
      }),
    ).toThrow("default_mcp_server_refs is not supported")

    expect(() =>
      expertSquadCatalogFixture({
        active: "frontend-replica",
        squads: [
          { id: "general", label: "General", built_in: true },
          {
            id: "frontend-replica",
            label: "Frontend Replica",
            built_in: false,
            capability_projection: {
              scheduler: {
                package_mcp_server_refs: ["frontend-replica/orchestrator/browser"],
                package_mcp_tool_refs: ["frontend-replica/orchestrator/browser/tool/snapshot"],
              },
            },
          },
        ],
      }),
    ).toThrow("already mounted by package_mcp_server_refs")
  })
})
