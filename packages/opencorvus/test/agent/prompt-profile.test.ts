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
    expect(prompt.startsWith("BASE\n\nActive prompt profile: backend expert squad.")).toBe(true)
    expect(prompt.endsWith("\n\nUSER_APPEND")).toBe(true)
  })

  test("general profile preserves prompt text", () => {
    const config = Config.Info.parse({ prompt_profile: { active: "general" } })
    expect(PromptProfile.composeAgentPrompt({ agentID: "build", base: "BASE", config })).toBe("BASE")
  })

  test("built-in profiles expose an explicit scenario agent/tool matrix", () => {
    expect(PromptProfile.builtInBlueprints.frontend.agents["frontend-design"]?.tools).toEqual(
      expect.arrayContaining(["webpage_extract", "webpage_render", "webpage_vision_judge"]),
    )
    expect(PromptProfile.builtInBlueprints.frontend.agents["visual-qa"]?.tools).toEqual(
      expect.arrayContaining(["browser_preview", "webpage_text_diff"]),
    )
    expect(PromptProfile.builtInBlueprints.backend.agents["deep-research"]?.tools).toEqual(
      expect.arrayContaining(["webfetch", "external_code_search"]),
    )
    expect(PromptProfile.builtInBlueprints.algorithm.agents["goal-workload-analyst"]?.tools).toEqual(
      expect.arrayContaining(["read_file", "search_code"]),
    )
    expect(PromptProfile.builtInBlueprints.algorithm.agents.orchestrator?.agents).toEqual(
      expect.arrayContaining(["workload_analysis", "fact_check", "integrity"]),
    )
  })

  test("direct session agents also receive scene-specific overlays", () => {
    const config = Config.Info.parse({ prompt_profile: { active: "frontend" } })
    expect(PromptProfile.overlayFor("coding", config)).toContain("Active prompt profile: frontend expert squad.")
    expect(PromptProfile.overlayFor("coding-assistant", config)).toContain("Prioritize these tools")
    expect(PromptProfile.overlayFor("mission", config)).toContain("frontend_design")
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
