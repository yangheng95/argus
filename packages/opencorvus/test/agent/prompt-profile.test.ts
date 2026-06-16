import { describe, expect, test } from "bun:test"
import { PromptProfile } from "../../src/agent/prompt-profile"
import { Config } from "../../src/config/config"

describe("prompt profiles", () => {
  test("Config.Info materializes frontend as the explicit default profile", () => {
    const config = Config.Info.parse({})
    expect(config.prompt_profile.active).toBe("frontend")
    expect(PromptProfile.activeID(config)).toBe("frontend")
  })

  test("composer orders base, profile overlay, then user append", () => {
    const config = Config.Info.parse({ prompt_profile: { active: "backend" } })
    const prompt = PromptProfile.composeAgentPrompt({
      agentID: "build",
      base: "BASE",
      userAppend: "USER_APPEND",
      config,
    })
    expect(prompt.startsWith("BASE\n\nCarry backend changes through to a verified behavior change.")).toBe(true)
    expect(prompt.endsWith("\n\nUSER_APPEND")).toBe(true)
  })

  test("general profile preserves prompt text", () => {
    const config = Config.Info.parse({ prompt_profile: { active: "general" } })
    expect(PromptProfile.composeAgentPrompt({ agentID: "build", base: "BASE", config })).toBe("BASE")
  })

  test("built-in profiles expose direct target overlays without wrapper boilerplate", () => {
    expect(PromptProfile.builtIns.frontend.agents["frontend-design"]).toContain("visual structure")
    expect(PromptProfile.builtIns.frontend.agents["orchestrator"]).toContain("exact surface")
    expect(PromptProfile.builtIns.backend.agents["deep-research"]).toContain("API behavior")
    expect(PromptProfile.builtIns.algorithm.agents["goal-workload-analyst"]).toContain("hidden complexity")
    expect(PromptProfile.builtIns.algorithm.agents.orchestrator).not.toContain("Prioritize these tools")
    expect(PromptProfile.builtIns.frontend.agents.build).not.toContain("Active prompt profile:")
    expect(PromptProfile.builtIns.frontend.agents.mission).not.toContain("Coordinate frontend work")
    expect(PromptProfile.builtIns.frontend.agents.orchestrator).not.toContain("bias planning and retries")
  })

  test("direct session agents also receive scene-specific overlays", () => {
    const config = Config.Info.parse({ prompt_profile: { active: "frontend" } })
    expect(PromptProfile.overlayFor("coding", config)).toContain("responsive behavior")
    expect(PromptProfile.overlayFor("coding-assistant", config)).toContain("frontend questions")
    expect(PromptProfile.overlayFor("mission", config)).toContain("target surface")
  })

  test("profile catalog exposes target metadata and editable custom profile definitions", () => {
    const config = Config.Info.parse({
      prompt_profile: {
        active: "custom-squad",
        profiles: {
          "custom-squad": {
            label: "Custom Squad",
            description: "Project-defined prompt profile.",
            agents: {
              build: "Custom build guidance.",
            },
          },
        },
      },
    })
    const catalog = PromptProfile.list(config)
    expect(catalog.project_active).toBe("custom-squad")
    expect(catalog.session_active).toBe(null)
    expect(catalog.targets.find((target) => target.id === "build")).toMatchObject({
      id: "build",
      editable: true,
      built_in_only: false,
    })
    expect(catalog.targets.find((target) => target.id === "orchestrator")).toMatchObject({
      id: "orchestrator",
      editable: false,
      built_in_only: true,
    })
    expect(catalog.profiles.find((profile) => profile.id === "frontend")).toMatchObject({
      id: "frontend",
      built_in: true,
      editable: false,
    })
    expect(catalog.profiles.find((profile) => profile.id === "custom-squad")).toMatchObject({
      id: "custom-squad",
      built_in: false,
      editable: true,
      agents: {
        build: "Custom build guidance.",
      },
    })
  })

  test("rejects unknown active profiles and built-in-only user targets", () => {
    const unknown = Config.Info.safeParse({ prompt_profile: { active: "missing" } })
    expect(unknown.success).toBe(false)
    if (!unknown.success) expect(JSON.stringify(unknown.error.issues)).toContain("Unknown prompt profile")

    const builtInOnly = Config.Info.safeParse({
      prompt_profile: {
        active: "custom",
        profiles: {
          custom: {
            label: "Custom",
            agents: {
              orchestrator: "not allowed",
            },
          },
        },
      },
    })
    expect(builtInOnly.success).toBe(false)
    if (!builtInOnly.success) expect(JSON.stringify(builtInOnly.error.issues)).toContain("built-in-only")
  })

  test("session overlay rejects prompt edits for prompt-mode none agents", () => {
    const parsed = Config.Overlay.safeParse({
      agent: {
        orchestrator: { prompt: "not allowed" },
      },
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(JSON.stringify(parsed.error.issues)).toContain("not editable")
  })

  test("session overlay rejects inline prompt profile definitions", () => {
    const parsed = Config.Overlay.safeParse({
      prompt_profile: {
        active: "frontend",
        profiles: {
          custom: {
            label: "Nope",
            agents: {
              build: "not allowed",
            },
          },
        },
      },
    })
    expect(parsed.success).toBe(false)
  })
})
