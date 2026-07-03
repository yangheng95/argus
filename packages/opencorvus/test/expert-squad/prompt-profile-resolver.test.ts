import { describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"
import { PromptProfileResolver } from "../../src/expert-squad/prompt-profile-resolver"
import { PROJECT_EXPERT_SQUAD_ID, writeProjectExpertSquadPackage } from "../fixture/expert-squad"
import { tmpdir } from "../fixture/fixture"

describe("PromptProfileResolver", () => {
  test("loads project package profiles into the catalog and composes package overlays", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path)
    const config = Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } })

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
      agents: {
        build: "project build overlay",
        orchestrator: "project orchestrator overlay",
      },
    })
    expect(Object.keys(profile ?? {}).sort()).toEqual(["agents", "built_in", "description", "editable", "id", "label"])

    await expect(
      PromptProfileResolver.composeAgentPrompt({
        projectDirectory: project.path,
        agentID: "build",
        base: "BASE",
        userAppend: "USER APPEND",
        config,
      }),
    ).resolves.toBe("BASE\n\nproject build overlay\n\nUSER APPEND")
  })

  test("rejects unknown project profile IDs with project context", async () => {
    await using project = await tmpdir({ git: true })
    const config = Config.Info.parse({ prompt_profile: { active: "missing-profile" } })

    await expect(PromptProfileResolver.list({ projectDirectory: project.path, config })).rejects.toThrow(
      /Unknown prompt profile "missing-profile"/,
    )
    await expect(
      PromptProfileResolver.assertKnownProfileID({ projectDirectory: project.path, profileID: "missing-profile" }),
    ).rejects.toThrow(/Unknown prompt profile "missing-profile"/)
  })

  test("rejects project packages that collide with built-in profile IDs", async () => {
    await using project = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(project.path, "frontend-replica")
    const config = Config.Info.parse({ prompt_profile: { active: "general" } })

    await expect(PromptProfileResolver.list({ projectDirectory: project.path, config })).rejects.toThrow(
      /collides with a built-in expert squad id/,
    )
  })
})
