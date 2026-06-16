import { describe, expect, test } from "bun:test"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

const {
  createPromptProfileID,
  upsertPromptProfileConfig,
  deletePromptProfileConfig,
} = await import("../src/services/config")

describe("prompt profile config helpers", () => {
  test("createPromptProfileID slugifies labels and avoids collisions", () => {
    expect(createPromptProfileID(["frontend", "custom-squad"], "Custom Squad")).toBe("custom-squad-2")
    expect(createPromptProfileID([], "   ")).toBe("custom-squad")
  })

  test("upsertPromptProfileConfig writes custom profiles under prompt_profile.profiles only", () => {
    const config: Record<string, any> = {
      prompt_profile: {
        active: "frontend",
      },
      agent: {
        build: {
          prompt_append: "keep separate",
        },
      },
    }

    upsertPromptProfileConfig(
      config,
      {
        id: "custom-squad",
        label: "Custom Squad",
        description: "Project profile",
        agents: {
          build: "Custom build guidance.",
          explore: "   ",
        },
      },
      "frontend",
    )

    expect(config.prompt_profile).toEqual({
      active: "frontend",
      profiles: {
        "custom-squad": {
          label: "Custom Squad",
          description: "Project profile",
          agents: {
            build: "Custom build guidance.",
          },
        },
      },
    })
    expect(config.agent.build.prompt_append).toBe("keep separate")
  })

  test("deletePromptProfileConfig removes the custom profile and rewrites active explicitly when needed", () => {
    const config: Record<string, any> = {
      prompt_profile: {
        active: "custom-squad",
        profiles: {
          "custom-squad": {
            label: "Custom Squad",
            agents: {
              build: "Custom build guidance.",
            },
          },
          another: {
            label: "Another",
            agents: {},
          },
        },
      },
    }

    deletePromptProfileConfig(config, "custom-squad", "frontend", "frontend")

    expect(config.prompt_profile).toEqual({
      active: "frontend",
      profiles: {
        another: {
          label: "Another",
          agents: {},
        },
      },
    })
  })
})
