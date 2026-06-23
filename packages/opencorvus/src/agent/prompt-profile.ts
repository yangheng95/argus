import z from "zod"
import { AgentRoleContract, type AgentRoleID } from "@/agent/role-contract"

export const DEFAULT_PROMPT_PROFILE_ID = "frontend"
export const PROMPT_PROFILE_ID_PATTERN = /^(?!.*--)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

export const PromptProfileIDSchema = z
  .string()
  .min(1, "prompt profile id cannot be empty.")
  .max(64, "prompt profile id must be at most 64 characters.")
  .regex(
    PROMPT_PROFILE_ID_PATTERN,
    "prompt profile id must use lowercase letters, digits, and single hyphens, and must start with a letter.",
  )

const USER_PROFILE_TARGETS = [
  "coding",
  "coding-assistant",
  "build",
  "visual-qa",
  "general",
  "explore",
  "mission",
  "requirements",
  "architect",
  "frontend-design",
  "intent-analysis",
  "fact-check",
  "deep-research",
  "frontend-research",
  "goal-workload-analyst",
] as const

const BUILT_IN_ONLY_PROFILE_TARGETS = ["orchestrator", "integrity"] as const

export type PromptProfileTargetID =
  | (typeof USER_PROFILE_TARGETS)[number]
  | (typeof BUILT_IN_ONLY_PROFILE_TARGETS)[number]

export const PromptProfileDefinitionSchema = z
  .object({
    label: z.string().trim().min(1, "prompt profile label cannot be empty."),
    description: z.string().trim().min(1, "prompt profile description cannot be empty when provided.").optional(),
    agents: z
      .record(
        z.string(),
        z
          .string()
          .trim()
          .min(1, "prompt profile target overlay cannot be blank; omit the target when no overlay is needed."),
      )
      .default({}),
  })
  .strict()

export const PromptProfileConfigSchema = z
  .object({
    active: PromptProfileIDSchema.default(DEFAULT_PROMPT_PROFILE_ID),
    profiles: z.record(PromptProfileIDSchema, PromptProfileDefinitionSchema).optional(),
  })
  .strict()
  .default({ active: DEFAULT_PROMPT_PROFILE_ID })

export const PromptProfileOverlaySchema = z
  .object({
    active: PromptProfileIDSchema.nullable().optional(),
  })
  .strict()

export const PromptProfileImportSchema = z
  .object({
    prompt_profile: z
      .object({
        active: PromptProfileIDSchema.optional(),
        profiles: z
          .record(PromptProfileIDSchema, PromptProfileDefinitionSchema)
          .refine((profiles) => Object.keys(profiles).length > 0, {
            message: "prompt_profile.profiles must contain at least one custom profile.",
          }),
      })
      .strict(),
  })
  .strict()

export type PromptProfileDefinition = z.output<typeof PromptProfileDefinitionSchema>
export type PromptProfileConfig = z.output<typeof PromptProfileConfigSchema>
export type PromptProfileOverlay = z.output<typeof PromptProfileOverlaySchema>
export type PromptProfileImport = z.output<typeof PromptProfileImportSchema>

export const PromptProfileTargetCatalogEntrySchema = z
  .object({
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    editable: z.boolean(),
    built_in_only: z.boolean(),
  })
  .strict()

export const PromptProfileCatalogProfileSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    built_in: z.boolean(),
    editable: z.boolean(),
    agents: z.record(z.string(), z.string()),
  })
  .strict()

export const PromptProfileCatalogSchema = z
  .object({
    active: z.string(),
    project_active: z.string(),
    session_active: z.string().nullable(),
    default: z.string(),
    targets: z.array(PromptProfileTargetCatalogEntrySchema),
    profiles: z.array(PromptProfileCatalogProfileSchema),
  })
  .strict()

export type PromptProfileTargetCatalogEntry = z.output<typeof PromptProfileTargetCatalogEntrySchema>
export type PromptProfileCatalogProfile = z.output<typeof PromptProfileCatalogProfileSchema>
export type PromptProfileCatalog = z.output<typeof PromptProfileCatalogSchema>

type ConfigLike = {
  prompt_profile?: PromptProfileConfig
}

const userTargetSet = new Set<string>(USER_PROFILE_TARGETS)
const builtInOnlyTargetSet = new Set<string>(BUILT_IN_ONLY_PROFILE_TARGETS)
const allTargetSet = new Set<string>([...USER_PROFILE_TARGETS, ...BUILT_IN_ONLY_PROFILE_TARGETS])

export namespace PromptProfile {
  export const builtIns: Record<string, PromptProfileDefinition> = {
    general: {
      label: "General",
      description: "No domain-specific expert overlay.",
      agents: {},
    },
    frontend: {
      label: "Frontend",
      description: "UI, interaction, visual verification, and design-system focused expert squad.",
      agents: {
        coding:
          "Prioritize layout, responsive behavior, interaction state, and visible regressions. Keep fixes inside the existing component system and verify them in the rendered UI.",
        "coding-assistant":
          "Answer frontend questions in terms of component structure, style changes, interaction semantics, and visible regressions. Prefer guidance that can be checked in the rendered UI.",
        general:
          "Anchor multi-step frontend work to real screens, state changes, accessibility, and user-visible behavior.",
        explore:
          "Map component boundaries, styling conventions, state changes, and prior visual evidence from the source. Do not mutate the workspace.",
        mission:
          "Keep frontend work tied to the target surface, the interaction states that must work, and the evidence that shows the UI behaves correctly.",
        "intent-analysis":
          "Resolve frontend requests into concrete screen changes, interaction flows, breakpoints, accessibility expectations, and missing reference evidence.",
        requirements:
          "Write frontend requirements as observable truths: information architecture, component states, responsive rules, accessibility, and visual acceptance conditions.",
        architect:
          "Turn frontend requirements into component boundaries, data flow, ownership, and a verification plan tied to the rendered surface.",
        "frontend-design":
          "Focus on visual structure, reference evidence, layout hierarchy, spacing, alignment, and the UI changes implementation must preserve.",
        "frontend-research":
          "Produce a source-backed frontend brief that separates confirmed facts from assumptions and defines the target surface, key interaction behavior, and required evidence.",
        build:
          "Convert the approved frontend target into working code without drifting the requested structure or behavior. Finish at a verifiable UI result, not a partial code change.",
        "visual-qa":
          "Audit the rendered UI for layout, interaction, and state mismatches. Call out the concrete defect and keep review tied to visible evidence.",
        integrity:
          "Treat frontend delivery as incomplete unless the requested surface, interaction behavior, and visual acceptance conditions are demonstrated.",
        orchestrator:
          "Keep frontend decisions grounded in the exact surface being changed, trustworthy reference evidence, and explicit visual acceptance.",
      },
    },
    backend: {
      label: "Backend",
      description: "API, state, data, integration, and operational correctness focused expert squad.",
      agents: {
        coding:
          "Prioritize request and data contracts, state ownership, persistence boundaries, observability, and deterministic failure handling.",
        "coding-assistant":
          "Explain backend changes in terms of API shape, state ownership, persistence effects, and failure cases so the user can inspect what changed.",
        general: "Anchor backend work to contracts, state transitions, persistence, concurrency, and runtime evidence.",
        explore:
          "Map routes, schemas, ownership boundaries, shared invariants, and failure paths from the source. Cite evidence.",
        mission:
          "Keep backend work tied to contract boundaries, storage effects, integration behavior, and failure modes that must be verified.",
        "intent-analysis":
          "Resolve backend requests into contract changes, state transitions, persistence effects, concurrency concerns, migration policy, and observability gaps.",
        requirements:
          "Write backend requirements as enforceable behavior: accepted inputs, guaranteed outputs, state changes, failure semantics, and non-functional constraints.",
        architect:
          "Turn backend requirements into route, schema, storage, ownership, and verification contracts with explicit integration boundaries.",
        build:
          "Carry backend changes through to a verified behavior change. The work is done when the contract and state effects are demonstrated on the real runtime path.",
        "deep-research":
          "Expand unresolved backend facts before implementation depends on them. Gather source evidence for API behavior, library semantics, protocol constraints, migration limits, and runtime constraints.",
        "fact-check":
          "Check explicit backend assertions one by one. Verify API behavior, version details, schema assumptions, and claimed limits against source evidence.",
        integrity:
          "Treat backend delivery as incomplete unless contracts, state transitions, and integration behavior are demonstrated by code and verification evidence.",
        orchestrator:
          "Keep backend decisions grounded in the exact contract being changed, the state effects that matter, and the evidence required to accept the result.",
      },
    },
    algorithm: {
      label: "Algorithm",
      description: "Correctness, complexity, benchmark, and adversarial-case focused expert squad.",
      agents: {
        coding:
          "Prioritize precise problem framing, invariants, complexity, numerical behavior, and demonstrable correctness.",
        "coding-assistant":
          "Explain algorithm changes in terms of invariants, edge cases, complexity tradeoffs, and proof obligations reviewers can inspect.",
        general:
          "Anchor algorithm-heavy work to invariants, asymptotic cost, adversarial cases, reproducibility, and proof obligations.",
        explore: "Extract current behavior, data shapes, hot paths, and benchmark hooks from source evidence.",
        mission:
          "Keep algorithm work tied to correctness conditions, benchmark scope, adversarial cases, and the evidence needed to show the result is correct.",
        "intent-analysis":
          "Resolve algorithm requests into formal objectives, constraints, success metrics, input bounds, precision requirements, and missing benchmark expectations.",
        requirements:
          "Write algorithm requirements as proof targets: invariants, bounds, edge cases, acceptance metrics, and measurable performance obligations.",
        architect:
          "Turn algorithm requirements into execution constraints and verification rules that make correctness checks and complexity checks explicit.",
        build:
          "Carry algorithm changes through to demonstrated correctness. Finish with evidence that invariants hold and the claimed performance story is supported.",
        "deep-research":
          "Expand unresolved technical facts before implementation depends on them. Gather source evidence for formulas, reference methods, numeric constraints, and benchmark methodology.",
        "fact-check":
          "Check explicit algorithm assertions one by one. Verify formulas, complexity claims, numeric bounds, and benchmark conclusions against source evidence.",
        "goal-workload-analyst":
          "Challenge the goal for hidden complexity, missing benchmark scope, and unclear correctness requirements before execution begins.",
        integrity:
          "Treat algorithm delivery as incomplete unless correctness, edge cases, and benchmark evidence are demonstrated.",
        orchestrator:
          "Keep algorithm decisions grounded in the exact correctness claim, relevant constraints, and the evidence threshold required to accept the result.",
      },
    },
    testing: {
      label: "Testing",
      description: "Test design, regression coverage, reproducible evidence, and acceptance-risk focused expert squad.",
      agents: {
        coding:
          "Prioritize testable behavior, isolated failure modes, regression coverage, and reproducible verification. Finish changes with evidence that the behavior fails before and passes after.",
        "coding-assistant":
          "Explain testing work through observable behavior, test boundaries, fixtures, assertions, and regression risk. Prefer advice that names the verification path the user can run.",
        general:
          "Anchor multi-step testing work to explicit behavior claims, failure reproduction, controlled fixtures, regression scope, and evidence that can be rerun.",
        explore:
          "Map existing test structure, helpers, fixtures, owners, and uncovered behavior from source evidence. Identify where verification belongs without mutating the workspace.",
        mission:
          "Keep testing-focused missions tied to acceptance criteria, reproducible failure cases, verification ownership, and evidence that proves the delivered change stays correct.",
        "intent-analysis":
          "Resolve testing requests into behavior under test, failure reproduction, target layer, fixtures, assertions, missing evidence, and acceptance thresholds.",
        requirements:
          "Write testing requirements as observable behavior, preconditions, assertions, negative cases, data fixtures, and evidence required to accept the change.",
        architect:
          "Turn testing requirements into verification boundaries: unit, integration, runtime, and visual checks mapped to owned paths, contracts, and known failure modes.",
        "frontend-design":
          "Define frontend handoff details that make later tests precise: visible states, interaction outcomes, data contracts, breakpoints, and screenshot evidence expectations.",
        "frontend-research":
          "Produce frontend investigation packets that make tests actionable: selectors, states, user flows, data dependencies, visual risks, and evidence gaps for each source page.",
        build:
          "Convert the approved change into code plus focused verification. Add or update tests that expose the changed behavior and report exact commands and remaining risk.",
        "visual-qa":
          "Audit rendered surfaces as executable checks: interactions, layout states, accessibility signals, and screenshots must support any acceptance claim or defect report.",
        "deep-research":
          "Research testing tools, framework semantics, environment constraints, and current documentation only when implementation depends on them. Separate facts from assumptions.",
        "fact-check":
          "Check testing claims against sources: command results, library behavior, version limits, documented semantics, and whether stated evidence supports the claim.",
        "goal-workload-analyst":
          "Challenge goals for missing verification scope, oversized test surfaces, fragile fixtures, hidden runtime dependencies, and unclear acceptance evidence before execution begins.",
        integrity:
          "Treat delivery as incomplete when changed behavior lacks targeted tests, reproduced failure evidence, or clear residual-risk notes. Verify claims against code and recorded commands.",
        orchestrator:
          "Keep testing decisions grounded in the exact behavior under review, the narrowest responsible owner, and acceptance evidence that can be rerun before final completion.",
      },
    },
  }

  export const targets: PromptProfileTargetCatalogEntry[] = [
    ...USER_PROFILE_TARGETS,
    ...BUILT_IN_ONLY_PROFILE_TARGETS,
  ].map((targetID) => ({
    id: targetID,
    label: targetID,
    description:
      AgentRoleContract.all[targetID as AgentRoleID]?.description ??
      (builtInOnlyTargetSet.has(targetID)
        ? `Built-in runtime prompt target ${targetID}.`
        : `Prompt profile target ${targetID}.`),
    editable: userTargetSet.has(targetID) && !builtInOnlyTargetSet.has(targetID),
    built_in_only: builtInOnlyTargetSet.has(targetID),
  }))

  export function catalog(config: ConfigLike): Record<string, PromptProfileDefinition> {
    return {
      ...builtIns,
      ...(config.prompt_profile?.profiles ?? {}),
    }
  }

  export function activeID(config: ConfigLike): string {
    if (!config.prompt_profile?.active) {
      throw new Error("Config prompt_profile.active is not materialized.")
    }
    return config.prompt_profile.active
  }

  export function overlayFor(agentID: string, config: ConfigLike): string | undefined {
    const profiles = catalog(config)
    const active = activeID(config)
    const profile = profiles[active]
    if (!profile) {
      throw new Error(`Unknown prompt profile ${JSON.stringify(active)}`)
    }
    const prompt = profile.agents[agentID]
    return typeof prompt === "string" && prompt.trim().length > 0 ? prompt : undefined
  }

  export function composeAgentPrompt(input: {
    agentID: string
    base: string
    userAppend?: string | null
    config: ConfigLike
  }): string {
    const profilePrompt = overlayFor(input.agentID, input.config)
    return [input.base, profilePrompt, input.userAppend]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join("\n\n")
  }

  export function list(
    config: ConfigLike,
    opts: {
      projectActive?: string
      sessionActive?: string | null
    } = {},
  ) {
    const active = activeID(config)
    const profiles = Object.entries(catalog(config)).map(([id, profile]) => ({
      id,
      label: profile.label,
      description: profile.description,
      built_in: Object.hasOwn(builtIns, id),
      editable: !Object.hasOwn(builtIns, id),
      agents: { ...(profile.agents ?? {}) },
    }))
    return PromptProfileCatalogSchema.parse({
      active,
      project_active: opts.projectActive ?? active,
      session_active: opts.sessionActive ?? null,
      default: DEFAULT_PROMPT_PROFILE_ID,
      targets,
      profiles,
    })
  }

  export function assertKnownProfileID(profileID: string, config: ConfigLike): void {
    if (!Object.hasOwn(catalog(config), profileID)) {
      throw new Error(`Unknown prompt profile ${JSON.stringify(profileID)}`)
    }
  }

  export function validateConfig(
    config: ConfigLike,
    ctx: z.RefinementCtx,
    path: Array<string | number> = ["prompt_profile"],
  ) {
    const profileConfig = config.prompt_profile
    if (!profileConfig) return
    const configuredProfiles = profileConfig.profiles ?? {}
    for (const id of Object.keys(configuredProfiles)) {
      if (Object.hasOwn(builtIns, id)) {
        ctx.addIssue({
          code: "custom",
          path: [...path, "profiles", id],
          message: `prompt_profile.profiles.${id} cannot override a built-in prompt profile.`,
        })
      }
    }
    const knownProfiles = catalog(config)
    if (!Object.hasOwn(knownProfiles, profileConfig.active)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, "active"],
        message: `Unknown prompt profile ${JSON.stringify(profileConfig.active)}.`,
      })
    }
    for (const [profileID, profile] of Object.entries(configuredProfiles)) {
      for (const target of Object.keys(profile.agents ?? {})) {
        if (!allTargetSet.has(target)) {
          ctx.addIssue({
            code: "custom",
            path: [...path, "profiles", profileID, "agents", target],
            message: `Unknown prompt profile target ${JSON.stringify(target)}.`,
          })
          continue
        }
        if (!userTargetSet.has(target) || builtInOnlyTargetSet.has(target)) {
          ctx.addIssue({
            code: "custom",
            path: [...path, "profiles", profileID, "agents", target],
            message: `prompt profile target ${target} is built-in-only and cannot be configured by project profiles.`,
          })
        }
      }
    }
  }

  export function assertKnownAgentTarget(agentID: AgentRoleID | string): void {
    if (!allTargetSet.has(agentID)) {
      throw new Error(`Unknown prompt profile target ${JSON.stringify(agentID)}`)
    }
  }

  export function parseImportPayload(payload: unknown): PromptProfileImport {
    const parsed = PromptProfileImportSchema.parse(payload)
    const profileConfig = parsed.prompt_profile
    for (const id of Object.keys(profileConfig.profiles)) {
      if (Object.hasOwn(builtIns, id)) {
        throw new Error(`prompt_profile.profiles.${id} cannot override a built-in prompt profile.`)
      }
    }
    const knownProfiles = new Set([...Object.keys(builtIns), ...Object.keys(profileConfig.profiles)])
    if (profileConfig.active && !knownProfiles.has(profileConfig.active)) {
      throw new Error(`Unknown prompt profile ${JSON.stringify(profileConfig.active)}.`)
    }
    for (const [profileID, profile] of Object.entries(profileConfig.profiles)) {
      for (const target of Object.keys(profile.agents ?? {})) {
        if (!allTargetSet.has(target)) {
          throw new Error(`Unknown prompt profile target ${JSON.stringify(target)}.`)
        }
        if (!userTargetSet.has(target) || builtInOnlyTargetSet.has(target)) {
          throw new Error(
            `prompt profile target ${target} is built-in-only and cannot be configured by project profiles.`,
          )
        }
      }
    }
    return parsed
  }
}
