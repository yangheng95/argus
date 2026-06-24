import { describe, expect, test } from "bun:test"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

const {
  createPromptProfileID,
  upsertPromptProfileConfig,
  deletePromptProfileConfig,
  parsePromptProfileImportPayload,
  importPromptProfileConfig,
} = await import("../src/services/config")

const catalog = {
  active: "frontend-replica",
  project_active: "frontend-replica",
  session_active: null,
  default: "frontend-replica",
  targets: [
    { id: "build", label: "Build", editable: true, built_in_only: false },
    { id: "requirements", label: "Requirements", editable: true, built_in_only: false },
    { id: "orchestrator", label: "Orchestrator", editable: false, built_in_only: true },
  ],
  profiles: [
    { id: "frontend-replica", label: "Frontend Replica", built_in: true, editable: false, agents: {} },
    {
      id: "frontend-automation-debug",
      label: "Frontend Automation Debug",
      built_in: true,
      editable: false,
      agents: {},
    },
    { id: "existing-squad", label: "Existing Squad", built_in: false, editable: true, agents: {} },
  ],
}

describe("prompt profile config helpers", () => {
  test("createPromptProfileID slugifies labels and avoids collisions", () => {
    expect(createPromptProfileID(["frontend-replica", "custom-squad"], "Custom Squad")).toBe("custom-squad-2")
    expect(createPromptProfileID([], "   ")).toBe("custom-squad")
  })

  test("upsertPromptProfileConfig writes custom profiles under prompt_profile.profiles only", () => {
    const config: Record<string, any> = {
      prompt_profile: {
        active: "frontend-replica",
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
      "frontend-replica",
    )

    expect(config.prompt_profile).toEqual({
      active: "frontend-replica",
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

    deletePromptProfileConfig(config, "custom-squad", "frontend-replica", "frontend-replica")

    expect(config.prompt_profile).toEqual({
      active: "frontend-replica",
      profiles: {
        another: {
          label: "Another",
          agents: {},
        },
      },
    })
  })

  test("parsePromptProfileImportPayload accepts only wrapped prompt-profile imports", () => {
    const preview = parsePromptProfileImportPayload({
      prompt_profile: {
        active: "custom-squad",
        profiles: {
          "custom-squad": {
            label: "Custom Squad",
            description: "Project overlays",
            agents: {
              build: "Custom build guidance.",
              requirements: "Custom requirements guidance.",
            },
          },
        },
      },
    })

    expect(preview).toEqual({
      active: "custom-squad",
      profiles: [
        {
          id: "custom-squad",
          label: "Custom Squad",
          description: "Project overlays",
          agents: {
            build: "Custom build guidance.",
            requirements: "Custom requirements guidance.",
          },
        },
      ],
    })

    expect(() =>
      parsePromptProfileImportPayload({
        profiles: {
          "custom-squad": {
            label: "Custom Squad",
            agents: { build: "Custom build guidance." },
          },
        },
      }),
    ).toThrow("prompt_profile")
    expect(() =>
      parsePromptProfileImportPayload({
        prompt_profile: {
          profiles: {
            "custom-squad": {
              label: "Custom Squad",
              agents: { build: "   " },
            },
          },
        },
      }),
    ).toThrow("cannot be empty")
    expect(() =>
      parsePromptProfileImportPayload({
        prompt_profile: {
          active: " custom-squad ",
          profiles: {
            "custom-squad": {
              label: "Custom Squad",
              agents: { build: "Custom build guidance." },
            },
          },
        },
      }),
    ).toThrow("lowercase kebab-case")
    expect(() =>
      parsePromptProfileImportPayload({
        prompt_profile: {
          profiles: {
            "Custom Squad": {
              label: "Custom Squad",
              agents: { build: "Custom build guidance." },
            },
          },
        },
      }),
    ).toThrow("lowercase kebab-case")
  })

  test("importPromptProfileConfig merges custom profiles without touching legacy prompt fields", () => {
    const config: Record<string, any> = {
      prompt_profile: {
        active: "frontend-replica",
        profiles: {},
      },
      agent: {
        build: {
          prompt_append: "legacy append stays separate",
        },
      },
      prompt: {
        core_header: "legacy prompt stays separate",
      },
    }

    importPromptProfileConfig(
      config,
      {
        active: "custom-squad",
        profiles: [
          {
            id: "custom-squad",
            label: "Custom Squad",
            description: "Project overlays",
            agents: {
              build: "Custom build guidance.",
              requirements: "Custom requirements guidance.",
            },
          },
        ],
      },
      catalog,
    )

    expect(config.prompt_profile).toEqual({
      active: "custom-squad",
      profiles: {
        "custom-squad": {
          label: "Custom Squad",
          description: "Project overlays",
          agents: {
            build: "Custom build guidance.",
            requirements: "Custom requirements guidance.",
          },
        },
      },
    })
    expect(config.agent.build.prompt_append).toBe("legacy append stays separate")
    expect(config.prompt.core_header).toBe("legacy prompt stays separate")
  })

  test("importPromptProfileConfig rejects existing profiles, unknown targets, and built-in-only targets", () => {
    expect(() =>
      importPromptProfileConfig(
        {},
        {
          profiles: [
            {
              id: "frontend-automation-debug",
              label: "Frontend Automation Debug Override",
              agents: { build: "Custom build guidance." },
            },
          ],
        },
        catalog,
      ),
    ).toThrow("built-in")
    expect(() =>
      importPromptProfileConfig(
        {},
        {
          profiles: [
            {
              id: "existing-squad",
              label: "Existing Squad",
              agents: { build: "Custom build guidance." },
            },
          ],
        },
        catalog,
      ),
    ).toThrow("already exists")
    expect(() =>
      importPromptProfileConfig(
        {},
        {
          profiles: [
            {
              id: "custom-squad",
              label: "Custom Squad",
              agents: { unknown: "Custom guidance." },
            },
          ],
        },
        catalog,
      ),
    ).toThrow("Unknown prompt profile target")
    expect(() =>
      importPromptProfileConfig(
        {},
        {
          profiles: [
            {
              id: "custom-squad",
              label: "Custom Squad",
              agents: { orchestrator: "Custom guidance." },
            },
          ],
        },
        catalog,
      ),
    ).toThrow("built-in-only")
    expect(() =>
      importPromptProfileConfig(
        {},
        {
          profiles: [
            {
              id: "custom-squad",
              label: "Custom Squad",
              agents: { build: "   " },
            },
          ],
        },
        catalog,
      ),
    ).toThrow("cannot be empty")
  })
})
