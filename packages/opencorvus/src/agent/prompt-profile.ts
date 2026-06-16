import z from "zod"
import { AgentRoleContract, type AgentRoleID } from "@/agent/role-contract"

export const DEFAULT_PROMPT_PROFILE_ID = "frontend"

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
    label: z.string().min(1),
    description: z.string().optional(),
    agents: z.record(z.string(), z.string()).default({}),
  })
  .strict()

export const PromptProfileConfigSchema = z
  .object({
    active: z.string().min(1).default(DEFAULT_PROMPT_PROFILE_ID),
    profiles: z.record(z.string(), PromptProfileDefinitionSchema).optional(),
  })
  .strict()
  .default({ active: DEFAULT_PROMPT_PROFILE_ID })

export const PromptProfileOverlaySchema = z
  .object({
    active: z.string().min(1).nullable().optional(),
  })
  .strict()

export type PromptProfileDefinition = z.output<typeof PromptProfileDefinitionSchema>
export type PromptProfileConfig = z.output<typeof PromptProfileConfigSchema>
export type PromptProfileOverlay = z.output<typeof PromptProfileOverlaySchema>

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
          "Treat layout structure, responsive behavior, interaction state, and visible regressions as first-class requirements. Prefer fixes that stay rooted in the existing component system and can be verified in the rendered UI.",
        "coding-assistant":
          "Keep direct assistant help concrete and UI-facing: component structure, styling deltas, interaction semantics, and visible regressions matter more than abstract discussion.",
        general:
          "For multi-step frontend work, keep the task anchored to real screens, state transitions, accessibility, and what the user can actually see and do.",
        explore:
          "When exploring a frontend task, extract component boundaries, styling conventions, state transitions, and prior visual evidence without mutating the workspace.",
        mission:
          "Coordinate frontend work around visible outcomes: the target surface, the interaction states that matter, and the evidence needed to prove the UI now behaves correctly.",
        "intent-analysis":
          "Disambiguate frontend requests into concrete screen changes, interaction flows, breakpoints, accessibility expectations, and any missing reference evidence.",
        requirements:
          "Extract source-backed frontend requirements: information architecture, component states, responsive rules, accessibility, and explicit visual acceptance conditions.",
        architect:
          "Turn frontend requirements into component boundaries, data-flow expectations, ownership lines, and a verification plan that maps back to the rendered surface.",
        "frontend-design":
          "Focus on visual structure, reference evidence, layout hierarchy, spacing rhythm, and the concrete UI deltas implementation must preserve.",
        "frontend-research":
          "Produce a source-backed frontend brief that clarifies the target surface, important interaction behavior, and the evidence downstream implementation must honor.",
        build:
          "Implement frontend changes by preserving real structure and behavior, then verify the result in the running UI instead of approximating the intended appearance.",
        "visual-qa":
          "Audit the rendered UI for layout, interaction, and state mismatches. Call out the concrete defect and keep review tied to visible evidence.",
        integrity:
          "Reject frontend delivery unless the requested surface, interaction behavior, and visual acceptance conditions are explicitly demonstrated.",
        orchestrator:
          "For frontend work, bias planning and retries toward visible UI outcomes, trustworthy reference evidence, and final visual acceptance rather than abstract completion.",
      },
    },
    backend: {
      label: "Backend",
      description: "API, state, data, integration, and operational correctness focused expert squad.",
      agents: {
        coding:
          "Bias direct coding work toward request and data contracts, ownership of state, persistence boundaries, observability, and deterministic failure handling.",
        "coding-assistant":
          "Keep backend help contract-driven and integration-aware. Make data flow, persistence effects, and error surfaces explicit.",
        general:
          "For backend tasks, reason from contracts, state transitions, persistence, concurrency, and runtime evidence instead of UI polish or loose brainstorming.",
        explore:
          "When exploring backend work, map routes, schemas, ownership boundaries, shared invariants, and failure paths with source citations.",
        mission:
          "Coordinate backend work around contract boundaries, storage changes, integration evidence, and operational failure modes.",
        "intent-analysis":
          "Disambiguate backend requests into APIs, state transitions, storage effects, concurrency concerns, migration policy, and observability gaps.",
        requirements:
          "Extract source-backed backend requirements around request and response contracts, storage semantics, lifecycle events, concurrency, and failure handling.",
        architect:
          "Turn backend requirements into route, schema, storage, ownership, and verification contracts that make integration boundaries explicit.",
        build:
          "Implement backend changes with deterministic state transitions, explicit contracts, and verification that exercises the real runtime path.",
        "deep-research":
          "Gather durable evidence for API behavior, library semantics, protocol constraints, migration limitations, and operational assumptions before implementation depends on them.",
        "fact-check":
          "Verify backend claims such as API behavior, version details, schema assumptions, and operational numbers against source evidence.",
        integrity:
          "Reject backend delivery unless contracts, state transitions, and integration behavior are demonstrated by the changed code and verification evidence.",
        orchestrator:
          "For backend work, bias planning and retries toward contract edges, storage effects, integration evidence, and operational failure modes.",
      },
    },
    algorithm: {
      label: "Algorithm",
      description: "Correctness, complexity, benchmark, and adversarial-case focused expert squad.",
      agents: {
        coding:
          "Bias direct coding work toward precise problem formulation, invariants, complexity, numerical behavior, and correctness that can be demonstrated.",
        "coding-assistant":
          "Prefer reasoning that makes invariants, edge cases, complexity tradeoffs, and reproducible verification steps explicit.",
        general:
          "For algorithm-heavy work, reason explicitly about invariants, asymptotic cost, adversarial cases, reproducibility, and proof obligations.",
        explore:
          "When exploring algorithm work, extract the exact current behavior, data shapes, hot paths, and benchmark hooks from source evidence.",
        mission:
          "Coordinate algorithm work around proof obligations, benchmark evidence, adversarial cases, and explicit correctness review.",
        "intent-analysis":
          "Disambiguate algorithm requests into formal objectives, constraints, success metrics, input bounds, precision requirements, and missing benchmark expectations.",
        requirements:
          "Extract algorithm requirements as explicit invariants, constraints, input ranges, correctness expectations, edge cases, and measurable performance targets.",
        architect:
          "Turn algorithm requirements into execution and verification contracts that make correctness review and complexity review explicit.",
        build:
          "Implement algorithm changes with invariant-preserving edits, benchmarkable tests, and concrete evidence for correctness and complexity claims.",
        "deep-research":
          "Gather durable evidence for formulas, external references, protocol constraints, numeric pitfalls, and benchmark methodology before implementation depends on them.",
        "fact-check":
          "Verify algorithm claims such as formulas, complexity statements, benchmark assumptions, and numeric limits against source evidence.",
        "goal-workload-analyst":
          "Stress-test the goal against hidden complexity, missing benchmark scope, and under-specified correctness obligations before execution begins.",
        integrity:
          "Reject algorithm delivery unless correctness, edge cases, and benchmark evidence are explicitly demonstrated rather than implied.",
        orchestrator:
          "For algorithm work, bias planning and retries toward formal constraints, adversarial coverage, benchmark evidence, and explicit correctness review.",
      },
    },
  }

  export const targets: PromptProfileTargetCatalogEntry[] = [...USER_PROFILE_TARGETS, ...BUILT_IN_ONLY_PROFILE_TARGETS].map(
    (targetID) => ({
      id: targetID,
      label: targetID,
      description:
        AgentRoleContract.all[targetID as AgentRoleID]?.description ??
        (builtInOnlyTargetSet.has(targetID)
          ? `Built-in runtime prompt target ${targetID}.`
          : `Prompt profile target ${targetID}.`),
      editable: userTargetSet.has(targetID) && !builtInOnlyTargetSet.has(targetID),
      built_in_only: builtInOnlyTargetSet.has(targetID),
    }),
  )

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
}
