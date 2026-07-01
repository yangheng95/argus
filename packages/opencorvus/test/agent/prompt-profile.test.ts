import { describe, expect, test } from "bun:test"
import { PROMPT_PROFILE_ID_PATTERN, PromptProfile, PromptProfileIDSchema } from "../../src/agent/prompt-profile"
import { Config } from "../../src/config/config"

const requiredBuiltInTargetMatrix = {
  "frontend-replica": [
    "coding",
    "coding-assistant",
    "mission",
    "intent-analysis",
    "requirements",
    "architect",
    "frontend-design",
    "frontend-research",
    "build",
    "visual-qa",
    "integrity",
    "orchestrator",
  ],
  "frontend-innovate": [
    "coding",
    "coding-assistant",
    "general",
    "explore",
    "mission",
    "intent-analysis",
    "requirements",
    "architect",
    "frontend-design",
    "frontend-research",
    "build",
    "visual-qa",
    "deep-research",
    "fact-check",
    "goal-workload-analyst",
    "integrity",
    "orchestrator",
  ],
  backend: [
    "coding",
    "coding-assistant",
    "mission",
    "intent-analysis",
    "requirements",
    "architect",
    "build",
    "deep-research",
    "fact-check",
    "integrity",
    "orchestrator",
  ],
  algorithm: [
    "coding",
    "coding-assistant",
    "mission",
    "intent-analysis",
    "requirements",
    "architect",
    "build",
    "deep-research",
    "fact-check",
    "goal-workload-analyst",
    "integrity",
    "orchestrator",
  ],
  "frontend-automation-debug": [
    "coding",
    "coding-assistant",
    "mission",
    "intent-analysis",
    "requirements",
    "architect",
    "frontend-design",
    "frontend-research",
    "build",
    "visual-qa",
    "deep-research",
    "fact-check",
    "goal-workload-analyst",
    "integrity",
    "orchestrator",
    "general",
    "explore",
  ],
} as const

function expectConfigRejected(input: unknown, expectedMessage: string) {
  const parsed = Config.Info.safeParse(input)
  expect(parsed.success).toBe(false)
  if (!parsed.success) expect(JSON.stringify(parsed.error.issues)).toContain(expectedMessage)
}

function overlayLines(overlay: string): string[] {
  return overlay
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

describe("prompt profiles", () => {
  test("Config.Info materializes frontend-replica as the explicit default profile", () => {
    const config = Config.Info.parse({})
    expect(config.prompt_profile.active).toBe("frontend-replica")
    expect(PromptProfile.activeID(config)).toBe("frontend-replica")
  })

  test("composer orders base, profile overlay, then user append", () => {
    const config = Config.Info.parse({ prompt_profile: { active: "backend" } })
    const prompt = PromptProfile.composeAgentPrompt({
      agentID: "build",
      base: "BASE",
      userAppend: "USER_APPEND",
      config,
    })
    expect(prompt.startsWith("BASE\n\nCarry backend changes through to a verified behavior change")).toBe(true)
    expect(prompt).toContain("real route, service, storage, or integration path")
    expect(prompt.endsWith("\n\nUSER_APPEND")).toBe(true)
  })

  test("general profile preserves prompt text", () => {
    const config = Config.Info.parse({ prompt_profile: { active: "general" } })
    expect(PromptProfile.builtIns.general.agents).toEqual({})
    expect(PromptProfile.composeAgentPrompt({ agentID: "build", base: "BASE", config })).toBe("BASE")
  })

  test("built-in profiles expose direct target overlays without wrapper boilerplate", () => {
    expect(PromptProfile.builtIns["frontend-replica"].agents["frontend-design"]).toContain(
      "source-backed replica contract",
    )
    expect(PromptProfile.builtIns["frontend-replica"].agents["orchestrator"]).toContain("exact reference surface")
    expect(PromptProfile.builtIns.backend.agents["deep-research"]).toContain("API behavior")
    expect(PromptProfile.builtIns.algorithm.agents["goal-workload-analyst"]).toContain("hidden complexity")
    expect(PromptProfile.builtIns["frontend-automation-debug"].agents["visual-qa"]).toContain("screenshots")
    expect(PromptProfile.builtIns["frontend-replica"].agents.build).toContain("manifest/lockfile")
    expect(PromptProfile.builtIns["frontend-replica"].agents.build).toContain("rerun original checks")
    expect(PromptProfile.builtIns["frontend-replica"].agents.build).toContain("Do not satisfy source page height")
    expect(PromptProfile.builtIns["frontend-replica"].agents.build).toContain("height/min-height filler")
    expect(PromptProfile.builtIns["frontend-replica"].agents.build).toContain("browser_preview_reference_regions")
    expect(PromptProfile.builtIns["frontend-replica"].agents.build).toContain("browser_preview_compare_scroll_slices")
    expect(PromptProfile.builtIns["frontend-replica"].agents["visual-qa"]).toContain(
      "browser_preview_reference_regions",
    )
    expect(PromptProfile.builtIns["frontend-replica"].agents["visual-qa"]).toContain("Reject large blank filler bands")
    expect(PromptProfile.builtIns["frontend-replica"].agents["visual-qa"]).toContain(
      "browser_preview_compare_scroll_slices",
    )
    expect(PromptProfile.builtIns["frontend-innovate"].agents["frontend-design"]).toContain(
      "multiple named directions",
    )
    expect(PromptProfile.builtIns["frontend-innovate"].agents["frontend-design"]).toContain(
      "rejected generic draft traits",
    )
    expect(PromptProfile.builtIns["frontend-innovate"].agents.orchestrator).toContain("webpage or product UI tasks")
    expect(PromptProfile.builtIns["frontend-innovate"].agents.orchestrator).toContain(
      "existing URL redesign from aesthetic/professional/convenient goals",
    )
    expect(PromptProfile.builtIns["frontend-innovate"].agents.orchestrator).toContain(
      "Use Build brainstorm drafts only when the current operator explicitly asks",
    )
    expect(PromptProfile.builtIns["frontend-innovate"].agents.orchestrator).not.toContain(
      "multiple directions, parallel Build draft prototypes",
    )
    expect(PromptProfile.builtIns["frontend-innovate"].agents.build).toContain("brainstorming drafts")
    expect(PromptProfile.builtIns["frontend-innovate"].agents.build).toContain(
      "only when the current operator explicitly asks",
    )
    expect(PromptProfile.builtIns["frontend-innovate"].agents.integrity).toContain("rejected-traits review")
    expect(PromptProfile.builtIns["frontend-innovate"].agents["frontend-design"]).toContain(
      "user task, page job, information architecture",
    )
    expect(PromptProfile.builtIns["frontend-innovate"].agents.build).toContain("keyboard/focus behavior")
    expect(PromptProfile.builtIns["frontend-automation-debug"].agents.build).toContain("repair local deps")
    expect(PromptProfile.builtIns["frontend-automation-debug"].agents.build).toContain("rerun original command")
    expect(PromptProfile.builtIns.algorithm.agents.orchestrator).not.toContain("Prioritize these tools")
    expect(PromptProfile.builtIns["frontend-replica"].agents.build).not.toContain("Active prompt profile:")
    expect(PromptProfile.builtIns["frontend-replica"].agents.mission).not.toContain("Coordinate frontend work")
    expect(PromptProfile.builtIns["frontend-replica"].agents.orchestrator).not.toContain("bias planning and retries")
  })

  test("direct session agents also receive scene-specific overlays", () => {
    const config = Config.Info.parse({ prompt_profile: { active: "frontend-replica" } })
    expect(PromptProfile.overlayFor("coding", config)).toContain("desktop source information architecture")
    expect(PromptProfile.overlayFor("coding", config)).toContain("separate multi-end migration task")
    expect(PromptProfile.overlayFor("coding-assistant", config)).toContain("replica questions")
    expect(PromptProfile.overlayFor("mission", config)).toContain("target surface")
  })

  test("frontend automation debug profile reaches direct session agents and specialists", () => {
    const config = Config.Info.parse({ prompt_profile: { active: "frontend-automation-debug" } })
    expect(PromptProfile.overlayFor("coding", config)).toContain("browser-reproducible frontend failures")
    expect(PromptProfile.overlayFor("coding-assistant", config)).toContain("exact verification path")
    expect(PromptProfile.overlayFor("build", config)).toContain("focused automation")
    expect(PromptProfile.overlayFor("integrity", config)).toContain("targeted automation")
  })

  test("frontend innovate profile reaches direct session agents and specialists", () => {
    const config = Config.Info.parse({ prompt_profile: { active: "frontend-innovate" } })
    expect(PromptProfile.overlayFor("coding", config)).toContain("design-resource synthesis")
    expect(PromptProfile.overlayFor("coding-assistant", config)).toContain("competing directions")
    expect(PromptProfile.overlayFor("frontend-design", config)).toContain("implementation-ready product design handoff")
    expect(PromptProfile.overlayFor("frontend-design", config)).toContain("existing URL redesigns")
    expect(PromptProfile.overlayFor("visual-qa", config)).toContain("selected-direction match")
  })

  test("frontend innovate expert squad uses concrete task surfaces instead of quality placeholders", async () => {
    const profile = PromptProfile.builtIns["frontend-innovate"]
    const profileText = [profile.description, ...Object.values(profile.agents)].join("\n").toLowerCase()
    const skillText = (
      await Bun.file("packages/opencorvus/src/skill/builtin/frontend-innovate-expert-squad.md").text()
    ).toLowerCase()
    const forbidden = [
      "anti-slop",
      "enterprise polish",
      "enterprise-quality",
      "product-grade",
      "product-quality",
      "quality bar",
      "polished",
    ]

    expect(profileText).toContain("design-resource synthesis")
    expect(profileText).toContain("multiple named directions")
    expect(profileText).toContain("selected implementation handoff")
    expect(profileText).toContain("rendered evidence review")
    expect(profileText).toContain("accessibility/data constraints")
    expect(profileText).toContain("aesthetic, professional, and convenient")
    expect(profileText).toContain("source url evidence")
    expect(profileText).toContain("web content accessibility guidelines")
    expect(skillText).toContain("direction selection review")
    expect(skillText).toContain("design-resource synthesis")
    expect(skillText).toContain("rendered verification")
    expect(skillText).toContain("design philosophy contract")
    expect(skillText).toContain("existing url redesign flow")
    expect(skillText).toContain("web content accessibility guidelines")
    expect(skillText).toContain("popular claude code design skills and plugins")

    for (const fragment of forbidden) {
      expect(profileText.includes(fragment), `frontend-innovate profile contains ${fragment}`).toBe(false)
      expect(skillText.includes(fragment), `frontend-innovate skill contains ${fragment}`).toBe(false)
    }
  })

  test("frontend replica expert squad uses source evidence instead of parity placeholders", async () => {
    const profile = PromptProfile.builtIns["frontend-replica"]
    const profileText = [profile.description, ...Object.values(profile.agents)].join("\n").toLowerCase()
    const skillText = (
      await Bun.file("packages/opencorvus/src/skill/builtin/frontend-replica-expert-squad.md").text()
    ).toLowerCase()
    const forbidden = [
      "visual rhythm",
      "style rhythm",
      "visible parity",
      "broad page-wide impression",
      "visual acceptance",
      "vague page-wide",
    ]

    expect(profileText).toContain("source screenshot/dom/computed-style correspondence")
    expect(profileText).toContain("source region layout")
    expect(profileText).toContain("typography/spacing/color")
    expect(profileText).toContain("rendered screenshot proof")
    expect(profileText).toContain("rendered screenshots")
    expect(skillText).toContain("source url/screenshot/dom evidence")
    expect(skillText).toContain("layout/style/data/interaction constraints")
    expect(skillText).toContain("rendered screenshot and interaction evidence review")
    expect(skillText).toContain("blank filler geometry boundary")
    expect(skillText).toContain("source page height")
    expect(skillText).toContain("not implementation targets by themselves")
    expect(skillText).toContain("empty spacer bands")
    expect(skillText).toContain("blank margin/padding")
    expect(skillText).toContain("unrendered media slots")

    for (const fragment of forbidden) {
      expect(profileText.includes(fragment), `frontend-replica profile contains ${fragment}`).toBe(false)
      expect(skillText.includes(fragment), `frontend-replica skill contains ${fragment}`).toBe(false)
    }
  })

  test("frontend replica overlays carry source-to-target component-level discipline", () => {
    const agents = PromptProfile.builtIns["frontend-replica"].agents
    const allReplicaText = Object.values(agents).join("\n")

    expect(agents.coding).toContain("target project primitives, business components, and code")
    expect(agents.requirements).toContain("Component Interaction Matrix coverage")
    expect(agents.requirements).toContain("not as blank spacer or min-height acceptance")
    expect(agents.architect).toContain("one accountable goal per meaningful component or region")
    expect(agents.architect).toContain("empty CSS spacing")
    expect(agents["frontend-design"]).toContain("source-backed replica contract")
    expect(agents["frontend-design"]).toContain("target project reuse constraints")
    expect(agents["frontend-design"]).toContain("source geometry together with the visible content")
    expect(agents["frontend-research"]).toContain("reference screenshots, source structure evidence, computed styles")
    expect(agents.build).toContain("one scoped component or region goal at a time")
    expect(agents.build).toContain("Reuse target project components and business code only where they preserve source parity")
    expect(agents.build).toContain("Do not satisfy source page height")
    expect(agents.build).toContain("restore missing source-backed content/assets/interactions")
    expect(agents["visual-qa"]).toContain("source-token ownership")
    expect(agents["visual-qa"]).toContain("Reject large blank filler bands")
    expect(agents["visual-qa"]).toContain("owning DOM/source module")
    expect(agents.integrity).toContain("component-per-goal request")
    expect(agents.integrity).toContain("blank CSS space")
    expect(agents.orchestrator).toContain("component-per-goal request")
    expect(agents.orchestrator).toContain("not to padding blank page space")
    expect(allReplicaText).not.toContain("TradingView")
    expect(allReplicaText).not.toContain("AInvest")
  })

  test("frontend replica requirements prompt carries webpage-generation coverage beyond responsive scope", () => {
    const config = Config.Info.parse({ prompt_profile: { active: "frontend-replica" } })
    const prompt = PromptProfile.composeAgentPrompt({
      agentID: "requirements",
      base: "BASE_REQUIREMENTS",
      config,
    })

    expect(prompt).toContain("BASE_REQUIREMENTS")
    expect(prompt).toContain("source evidence binding")
    expect(prompt).toContain("region completeness")
    expect(prompt).toContain("visual style fidelity")
    expect(prompt).toContain("interaction semantics")
    expect(prompt).toContain("data/UI contracts")
    expect(prompt).toContain("accessibility semantics")
    expect(prompt).toContain("asset/media ownership")
    expect(prompt).toContain("runtime integration")
    expect(prompt).toContain("browser verification evidence")
    expect(prompt).toContain("desktop-class viewport layout/alignment requirements")
    expect(prompt).toContain("desktop-only")
  })

  test("target catalog covers every built-in overlay target", () => {
    const targetIDs = new Set(PromptProfile.targets.map((target) => target.id))
    for (const profile of Object.values(PromptProfile.builtIns)) {
      for (const targetID of Object.keys(profile.agents)) {
        expect(targetIDs.has(targetID)).toBe(true)
      }
    }
    expect(PromptProfile.targets.find((target) => target.id === "coding-assistant")).toMatchObject({
      editable: true,
      built_in_only: false,
    })
  })

  test("built-in registry pressure covers required target matrices without noncanonical targets", () => {
    expect(Object.keys(PromptProfile.builtIns)).toEqual([
      "general",
      "frontend-replica",
      "frontend-innovate",
      "backend",
      "algorithm",
      "frontend-automation-debug",
    ])
    const targetIDs = new Set(PromptProfile.targets.map((target) => target.id))
    expect(PromptProfile.targets).toHaveLength(targetIDs.size)

    for (const [profileID, requiredTargets] of Object.entries(requiredBuiltInTargetMatrix)) {
      const profile = PromptProfile.builtIns[profileID]
      expect(profile).toBeDefined()
      for (const targetID of requiredTargets) {
        expect(profile.agents[targetID]?.trim().length ?? 0).toBeGreaterThan(0)
      }
    }

    expect(new Set(Object.keys(PromptProfile.builtIns["frontend-automation-debug"].agents))).toEqual(targetIDs)

    for (const [profileID, profile] of Object.entries(PromptProfile.builtIns)) {
      for (const targetID of Object.keys(profile.agents)) {
        expect(targetIDs.has(targetID), `${profileID} references noncanonical target ${targetID}`).toBe(true)
      }
    }
  })

  test("built-in registry pressure keeps overlays sharp, role-scoped, and free of workflow mechanics", () => {
    const forbiddenFragments = [
      "active prompt profile",
      "anti-slop",
      "bias planning",
      "dispatch roster",
      "enterprise polish",
      "enterprise-quality",
      "fallback",
      "first action",
      "handoff graph",
      "host-side",
      "ownership lines",
      "profile_id",
      "product-grade",
      "product-quality",
      "prioritize these tools",
      "quality bar",
      "retry strategy",
      "select_expert_squad",
      "state machine",
      "tool inventory",
      "tool list",
      "workflow graph",
    ]
    const vagueFragments = ["operational assumptions", "reasoning stays", "workflow mechanics"]

    for (const [profileID, profile] of Object.entries(PromptProfile.builtIns)) {
      const seen = new Set<string>()
      for (const [targetID, overlay] of Object.entries(profile.agents)) {
        const normalized = overlay.trim().toLowerCase()
        const lines = overlayLines(overlay)
        expect(lines.length, `${profileID}.${targetID} must be multi-line expert guidance`).toBeGreaterThanOrEqual(3)
        expect(normalized.length, `${profileID}.${targetID} is too short to be actionable`).toBeGreaterThanOrEqual(220)
        expect(normalized.length, `${profileID}.${targetID} is too long for an overlay`).toBeLessThanOrEqual(1400)
        expect(seen.has(normalized), `${profileID}.${targetID} duplicates another target overlay`).toBe(false)
        seen.add(normalized)
        for (const fragment of [...forbiddenFragments, ...vagueFragments]) {
          expect(normalized.includes(fragment), `${profileID}.${targetID} contains ${fragment}`).toBe(false)
        }
      }
    }
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
    expect(catalog.profiles.find((profile) => profile.id === "frontend-replica")).toMatchObject({
      id: "frontend-replica",
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

  test("rejects malformed profile ids, blank labels, and blank target overlays", () => {
    expect(PROMPT_PROFILE_ID_PATTERN.source).not.toContain("?!")
    expect(PromptProfileIDSchema.safeParse("frontend-replica").success).toBe(true)
    expect(PromptProfileIDSchema.safeParse("custom-squad-2").success).toBe(true)

    for (const active of ["custom squad", " frontend ", "Backend!", "custom--squad", "custom-", "1custom", "custom_squad"]) {
      expectConfigRejected({ prompt_profile: { active } }, "prompt profile id")
    }

    const malformedProfileID = Config.Info.safeParse({
      prompt_profile: {
        active: "custom-squad",
        profiles: {
          "Custom Squad": {
            label: "Custom Squad",
            agents: {
              build: "Custom build guidance.",
            },
          },
        },
      },
    })
    expect(malformedProfileID.success).toBe(false)

    expectConfigRejected(
      {
        prompt_profile: {
          active: "custom-squad",
          profiles: {
            "custom-squad": {
              label: "   ",
              agents: {
                build: "Custom build guidance.",
              },
            },
          },
        },
      },
      "prompt profile label cannot be empty",
    )

    expectConfigRejected(
      {
        prompt_profile: {
          active: "custom-squad",
          profiles: {
            "custom-squad": {
              label: "Custom Squad",
              agents: {
                build: "   ",
              },
            },
          },
        },
      },
      "cannot be blank",
    )
  })

  test("session overlay schema pressure rejects malformed active profile ids before route lookup", () => {
    const malformed = Config.Overlay.safeParse({ prompt_profile: { active: "Backend!" } })
    expect(malformed.success).toBe(false)
    if (!malformed.success) expect(JSON.stringify(malformed.error.issues)).toContain("prompt profile id")

    const validSyntax = Config.Overlay.safeParse({ prompt_profile: { active: "custom-squad" } })
    expect(validSyntax.success).toBe(true)
  })

  test("parses only wrapped prompt-profile imports and rejects invalid imported profiles", () => {
    const imported = PromptProfile.parseImportPayload({
      prompt_profile: {
        active: "custom-squad",
        profiles: {
          "custom-squad": {
            label: "Custom Squad",
            description: "Project-defined overlays.",
            agents: {
              build: "Custom build guidance.",
              requirements: "Custom requirements guidance.",
            },
          },
        },
      },
    })
    expect(imported.prompt_profile.active).toBe("custom-squad")
    expect(imported.prompt_profile.profiles["custom-squad"].agents.build).toBe("Custom build guidance.")

    expect(() =>
      PromptProfile.parseImportPayload({
        profiles: {
          "custom-squad": {
            label: "Custom Squad",
            agents: { build: "Custom build guidance." },
          },
        },
      }),
    ).toThrow()
    expect(() =>
      PromptProfile.parseImportPayload({
        prompt_profile: {
          active: "missing-custom",
          profiles: {
            "custom-squad": {
              label: "Custom Squad",
              agents: { build: "Custom build guidance." },
            },
          },
        },
      }),
    ).toThrow("Unknown prompt profile")
    expect(() =>
      PromptProfile.parseImportPayload({
        prompt_profile: {
          profiles: {
            "frontend-replica": {
              label: "Frontend Replica Override",
              agents: { build: "Custom build guidance." },
            },
          },
        },
      }),
    ).toThrow("cannot override")
    expect(() =>
      PromptProfile.parseImportPayload({
        prompt_profile: {
          profiles: {
            "custom-squad": {
              label: "Custom Squad",
              agents: { unknown: "Custom guidance." },
            },
          },
        },
      }),
    ).toThrow("Unknown prompt profile target")
    expect(() =>
      PromptProfile.parseImportPayload({
        prompt_profile: {
          profiles: {
            "custom-squad": {
              label: "Custom Squad",
              agents: { orchestrator: "Custom guidance." },
            },
          },
        },
      }),
    ).toThrow("built-in-only")
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
        active: "frontend-replica",
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
