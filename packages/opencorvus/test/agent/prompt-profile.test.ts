import { describe, expect, test } from "bun:test"
import {
  PROMPT_PROFILE_ID_PATTERN,
  PromptProfile,
  PromptProfileIDSchema,
  type PromptProfileDefinition,
} from "../../src/agent/prompt-profile"
import { Config } from "../../src/config/config"
import { PromptProfileResolver } from "../../src/expert-squad/prompt-profile-resolver"
import { REPOSITORY_ROOT } from "../fixture/expert-squad"

const requiredProjectTargetMatrix = {
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

function repositoryConfig(active: string) {
  return Config.Info.parse({ prompt_profile: { active } })
}

async function repositoryProfiles(): Promise<Record<string, PromptProfileDefinition>> {
  return PromptProfileResolver.definitions(REPOSITORY_ROOT)
}

async function repositoryProfile(id: string): Promise<PromptProfileDefinition> {
  const profile = (await repositoryProfiles())[id]
  expect(profile, id).toBeDefined()
  return profile!
}

async function repositoryOverlay(active: string, agentID: string): Promise<string> {
  const overlay = await PromptProfileResolver.overlayFor({
    projectDirectory: REPOSITORY_ROOT,
    agentID,
    config: repositoryConfig(active),
  })
  expect(overlay, `${active}.${agentID}`).toBeDefined()
  return overlay!
}

async function repositorySelectorSkillText(name: string): Promise<string> {
  const projection = await PromptProfileResolver.resolveSkillProjection({
    projectDirectory: REPOSITORY_ROOT,
    config: repositoryConfig("general"),
    defaultSkills: [],
  })
  const skill = projection.skills.find((item) => item.name === name)
  expect(skill, name).toBeDefined()
  return skill!.content
}

function allProfileText(profile: PromptProfileDefinition): string {
  return [profile.description, ...Object.values(profile.agents)].join("\n").toLowerCase()
}

describe("prompt profiles", () => {
  test("Config.Info materializes general as the explicit default profile", () => {
    const config = Config.Info.parse({})
    expect(config.prompt_profile.active).toBe("general")
    expect(PromptProfile.activeID(config)).toBe("general")
  })

  test("built-in prompt-profile source contains only the default scheduler profile", async () => {
    const config = Config.Info.parse({})
    expect(Object.keys(PromptProfile.builtIns)).toEqual(["general"])
    expect(PromptProfile.builtIns.general.agents).toEqual({})
    expect(PromptProfile.composeAgentPrompt({ agentID: "build", base: "BASE", config })).toBe("BASE")
    expect((await PromptProfileResolver.list({ config })).profiles.map((profile) => profile.id)).toEqual(["general"])
  })

  test("resolver composes package-backed project overlays from .opencorvus", async () => {
    const config = repositoryConfig("backend")
    const prompt = await PromptProfileResolver.composeAgentPrompt({
      projectDirectory: REPOSITORY_ROOT,
      agentID: "build",
      base: "BASE",
      userAppend: "USER_APPEND",
      config,
    })
    expect(prompt.startsWith("BASE\n\nCarry backend changes through to a verified behavior change")).toBe(true)
    expect(prompt).toContain("real route, service, storage, or integration path")
    expect(prompt.endsWith("\n\nUSER_APPEND")).toBe(true)
  })

  test("package-backed profiles expose direct target overlays without wrapper boilerplate", async () => {
    const profiles = await repositoryProfiles()
    expect(profiles["frontend-replica"].agents["frontend-design"]).toContain("source-backed replica contract")
    expect(profiles["frontend-replica"].agents.orchestrator).toContain("exact reference surface")
    expect(profiles.backend.agents["deep-research"]).toContain("API behavior")
    expect(profiles.algorithm.agents["goal-workload-analyst"]).toContain("hidden complexity")
    expect(profiles["frontend-automation-debug"].agents["visual-qa"]).toContain("screenshots")
    expect(profiles["frontend-replica"].agents.build).toContain("manifest/lockfile")
    expect(profiles["frontend-replica"].agents.build).toContain("rerun original checks")
    expect(profiles["frontend-replica"].agents.build).toContain("Do not satisfy source page height")
    expect(profiles["frontend-replica"].agents.build).toContain("browser_preview_reference_regions")
    expect(profiles["frontend-replica"].agents["visual-qa"]).toContain("Reject large blank filler bands")
    expect(profiles["frontend-replica"].agents.integrity).toContain("second evidence-backed implementation non-pass")
    expect(profiles["frontend-innovate"].agents["frontend-design"]).toContain("multiple named directions")
    expect(profiles["frontend-innovate"].agents.orchestrator).toContain("webpage or product UI tasks")
    expect(profiles["frontend-innovate"].agents.build).toContain("keyboard/focus behavior")
    expect(profiles["frontend-automation-debug"].agents.build).toContain("repair local deps")
    expect(profiles.algorithm.agents.orchestrator).not.toContain("Prioritize these tools")
    expect(profiles["frontend-replica"].agents.build).not.toContain("Active prompt profile:")
    expect(profiles["frontend-replica"].agents.orchestrator).not.toContain("bias planning and retries")
  })

  test("direct session agents receive project package overlays through the resolver", async () => {
    expect(await repositoryOverlay("frontend-replica", "coding")).toContain("desktop source information architecture")
    expect(await repositoryOverlay("frontend-replica", "coding-assistant")).toContain("replica questions")
    expect(await repositoryOverlay("frontend-replica", "mission")).toContain("target surface")
    expect(await repositoryOverlay("frontend-automation-debug", "coding")).toContain("browser-reproducible frontend failures")
    expect(await repositoryOverlay("frontend-automation-debug", "build")).toContain("focused automation")
    expect(await repositoryOverlay("frontend-innovate", "coding")).toContain("design-resource synthesis")
    expect(await repositoryOverlay("frontend-innovate", "frontend-design")).toContain(
      "implementation-ready product design handoff",
    )
    expect(await repositoryOverlay("frontend-innovate", "visual-qa")).toContain("selected-direction match")
  })

  test("frontend innovate expert squad uses concrete task surfaces instead of quality placeholders", async () => {
    const profile = await repositoryProfile("frontend-innovate")
    const profileText = allProfileText(profile)
    const skillText = (await repositorySelectorSkillText("frontend-innovate-expert-squad")).toLowerCase()
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
    expect(skillText).toContain("direction selection review")
    expect(skillText).toContain("design philosophy contract")
    expect(skillText).toContain("existing url redesign flow")
    expect(skillText).toContain("web content accessibility guidelines")

    for (const fragment of forbidden) {
      expect(profileText.includes(fragment), `frontend-innovate profile contains ${fragment}`).toBe(false)
      expect(skillText.includes(fragment), `frontend-innovate skill contains ${fragment}`).toBe(false)
    }
  })

  test("frontend replica expert squad uses source evidence instead of parity placeholders", async () => {
    const profile = await repositoryProfile("frontend-replica")
    const profileText = allProfileText(profile)
    const skillText = (await repositorySelectorSkillText("frontend-replica-expert-squad")).toLowerCase()
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
    expect(profileText).toContain("bounded evidence-backed acceptance")
    expect(skillText).toContain("source url/screenshot/dom evidence")
    expect(skillText).toContain("layout/style/data/interaction constraints")
    expect(skillText).toContain("acceptance attempt budget")
    expect(skillText).toContain("failure taxonomy")
    expect(skillText).toContain("visual qa and integrity feedback consumption")
    expect(skillText).toContain("second consecutive evidence-backed rendered-feedback non-pass")
    expect(skillText).toContain("blank filler geometry boundary")

    for (const fragment of forbidden) {
      expect(profileText.includes(fragment), `frontend-replica profile contains ${fragment}`).toBe(false)
      expect(skillText.includes(fragment), `frontend-replica skill contains ${fragment}`).toBe(false)
    }
  })

  test("frontend replica overlays carry source-to-target component-level discipline", async () => {
    const agents = (await repositoryProfile("frontend-replica")).agents
    const allReplicaText = Object.values(agents).join("\n")

    expect(agents.coding).toContain("target project primitives, business components, and code")
    expect(agents.requirements).toContain("Component Interaction Matrix coverage")
    expect(agents.architect).toContain("one accountable goal per meaningful component or region")
    expect(agents.architect).toContain("generally produce 10 or more source-component goals")
    expect(agents["frontend-design"]).toContain("source-backed replica contract")
    expect(agents["frontend-research"]).toContain("reference screenshots, source structure evidence, computed styles")
    expect(agents.build).toContain("one scoped component or region goal at a time")
    expect(agents.build).toContain("Reuse target project components and business code only where they preserve source parity")
    expect(agents.build).toContain("restore missing source-backed content/assets/interactions")
    expect(agents["visual-qa"]).toContain("source-token ownership")
    expect(agents["visual-qa"]).toContain("owning DOM/source module")
    expect(agents.integrity).toContain("component-per-goal request")
    expect(agents.orchestrator).toContain("one source component or meaningful region per goal")
    expect(agents.orchestrator).toContain("per-surface rendered-feedback ledger")
    expect(allReplicaText).not.toContain("TradingView")
    expect(allReplicaText).not.toContain("AInvest")
  })

  test("frontend replica requirements prompt carries webpage-generation coverage beyond responsive scope", async () => {
    const prompt = await PromptProfileResolver.composeAgentPrompt({
      projectDirectory: REPOSITORY_ROOT,
      agentID: "requirements",
      base: "BASE_REQUIREMENTS",
      config: repositoryConfig("frontend-replica"),
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

  test("target catalog covers every repository package overlay target", async () => {
    const targetIDs = new Set(PromptProfile.targets.map((target) => target.id))
    for (const profile of Object.values(await repositoryProfiles())) {
      for (const targetID of Object.keys(profile.agents)) {
        expect(targetIDs.has(targetID)).toBe(true)
      }
    }
    expect(PromptProfile.targets.find((target) => target.id === "coding-assistant")).toMatchObject({
      editable: true,
      built_in_only: false,
    })
  })

  test("repository catalog keeps only general as built-in while project packages cover required target matrices", async () => {
    expect(Object.keys(PromptProfile.builtIns)).toEqual(["general"])
    const profiles = await repositoryProfiles()
    expect(Object.keys(profiles)).toEqual([
      "general",
      "algorithm",
      "backend",
      "frontend-automation-debug",
      "frontend-innovate",
      "frontend-replica",
    ])
    const targetIDs = new Set(PromptProfile.targets.map((target) => target.id))

    for (const [profileID, requiredTargets] of Object.entries(requiredProjectTargetMatrix)) {
      const profile = profiles[profileID]
      expect(profile).toBeDefined()
      for (const targetID of requiredTargets) {
        expect(profile.agents[targetID]?.trim().length ?? 0).toBeGreaterThan(0)
      }
    }

    expect(new Set(Object.keys(profiles["frontend-automation-debug"].agents))).toEqual(targetIDs)
    for (const [profileID, profile] of Object.entries(profiles)) {
      for (const targetID of Object.keys(profile.agents)) {
        expect(targetIDs.has(targetID), `${profileID} references noncanonical target ${targetID}`).toBe(true)
      }
    }
  })

  test("package-backed overlays stay sharp, role-scoped, and free of workflow mechanics", async () => {
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

    for (const [profileID, profile] of Object.entries(await repositoryProfiles())) {
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

  test("profile catalog exposes built-in default and project package-backed definitions", async () => {
    const config = repositoryConfig("frontend-replica")
    const catalog = await PromptProfileResolver.list({ projectDirectory: REPOSITORY_ROOT, config })
    expect(catalog.project_active).toBe("frontend-replica")
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
    expect(catalog.profiles.find((profile) => profile.id === "general")).toMatchObject({
      id: "general",
      built_in: true,
      editable: false,
    })
    expect(catalog.profiles.find((profile) => profile.id === "frontend-replica")).toMatchObject({
      id: "frontend-replica",
      built_in: false,
      editable: false,
    })
    expect(catalog.profiles.map((profile) => profile.id)).toEqual([
      "general",
      "algorithm",
      "backend",
      "frontend-automation-debug",
      "frontend-innovate",
      "frontend-replica",
    ])
    expect(catalog.profiles.some((profile) => profile.id === "custom-squad")).toBe(false)
  })

  test("keeps profile existence out of Config.Info and rejects removed custom profile definitions", () => {
    const unknown = Config.Info.safeParse({ prompt_profile: { active: "missing" } })
    expect(unknown.success).toBe(true)
    if (unknown.success) expect(unknown.data.prompt_profile.active).toBe("missing")

    const customProfiles = Config.Info.safeParse({
      prompt_profile: {
        active: "frontend-replica",
        profiles: {
          "custom-squad": {
            label: "Custom Squad",
            agents: {
              build: "Custom build guidance.",
            },
          },
        },
      },
    })
    expect(customProfiles.success).toBe(false)
    if (!customProfiles.success) expect(JSON.stringify(customProfiles.error.issues)).toContain("profiles")
  })

  test("rejects malformed profile ids and old custom profile bodies", () => {
    expect(PROMPT_PROFILE_ID_PATTERN.source).not.toContain("?!")
    expect(PromptProfileIDSchema.safeParse("frontend-replica").success).toBe(true)
    expect(PromptProfileIDSchema.safeParse("custom-squad-2").success).toBe(true)

    for (const active of [
      "custom squad",
      " frontend ",
      "Backend!",
      "custom--squad",
      "custom-",
      "1custom",
      "custom_squad",
    ]) {
      expectConfigRejected({ prompt_profile: { active } }, "prompt profile id")
    }

    expectConfigRejected(
      {
        prompt_profile: {
          active: "frontend-replica",
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
      "profiles",
    )
  })

  test("session overlay schema pressure rejects malformed active profile ids before route lookup", () => {
    const malformed = Config.Overlay.safeParse({ prompt_profile: { active: "Backend!" } })
    expect(malformed.success).toBe(false)
    if (!malformed.success) expect(JSON.stringify(malformed.error.issues)).toContain("prompt profile id")

    const validSyntax = Config.Overlay.safeParse({ prompt_profile: { active: "custom-squad" } })
    expect(validSyntax.success).toBe(true)
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
