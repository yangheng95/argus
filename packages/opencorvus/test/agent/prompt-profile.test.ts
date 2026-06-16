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
})
