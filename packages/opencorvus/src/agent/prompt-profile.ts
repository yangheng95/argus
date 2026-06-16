import z from "zod"
import type { AgentRoleID } from "@/agent/role-contract"

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

type ConfigLike = {
  prompt_profile?: PromptProfileConfig
}

const userTargetSet = new Set<string>(USER_PROFILE_TARGETS)
const builtInOnlyTargetSet = new Set<string>(BUILT_IN_ONLY_PROFILE_TARGETS)
const allTargetSet = new Set<string>([...USER_PROFILE_TARGETS, ...BUILT_IN_ONLY_PROFILE_TARGETS])

const FRONTEND_AGENT_PROMPT =
  "Active prompt profile: frontend expert squad. Prioritize real UI behavior, source evidence, layout density, responsive states, accessibility primitives, screenshot-backed visual verification, and fixing the underlying implementation instead of describing expected visuals."

const BACKEND_AGENT_PROMPT =
  "Active prompt profile: backend expert squad. Prioritize API contracts, data ownership, persistence shape, concurrency, error surfaces, observability, integration tests, and root-cause fixes that keep behavior explicit and traceable."

const ALGORITHM_AGENT_PROMPT =
  "Active prompt profile: algorithm expert squad. Prioritize problem formulation, invariants, proof of correctness, complexity, edge cases, numerical precision, reproducible benchmarks, and adversarial tests."

const FRONTEND_ORCHESTRATOR_PROMPT =
  "Active prompt profile: frontend expert squad. Keep the same workflow, but route reasoning toward UI evidence, task-scoped preview targets, screenshots, interaction truth, and visual acceptance before delivery."

const BACKEND_ORCHESTRATOR_PROMPT =
  "Active prompt profile: backend expert squad. Keep the same workflow, but route reasoning toward contract boundaries, storage and state transitions, integration evidence, and operational failure modes."

const ALGORITHM_ORCHESTRATOR_PROMPT =
  "Active prompt profile: algorithm expert squad. Keep the same workflow, but route reasoning toward formal constraints, algorithm choice, benchmark evidence, correctness review, and pathological cases."

const FRONTEND_TARGETS: PromptProfileTargetID[] = [
  "requirements",
  "architect",
  "frontend-design",
  "frontend-research",
  "build",
  "visual-qa",
  "integrity",
]

const BACKEND_TARGETS: PromptProfileTargetID[] = [
  "requirements",
  "architect",
  "build",
  "integrity",
  "deep-research",
  "fact-check",
]

const ALGORITHM_TARGETS: PromptProfileTargetID[] = [
  "requirements",
  "architect",
  "build",
  "integrity",
  "deep-research",
  "fact-check",
]

function profileAgents(targets: PromptProfileTargetID[], prompt: string): Record<string, string> {
  return Object.fromEntries(targets.map((target) => [target, prompt]))
}

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
        ...profileAgents(FRONTEND_TARGETS, FRONTEND_AGENT_PROMPT),
        orchestrator: FRONTEND_ORCHESTRATOR_PROMPT,
      },
    },
    backend: {
      label: "Backend",
      description: "API, state, data, integration, and operational correctness focused expert squad.",
      agents: {
        ...profileAgents(BACKEND_TARGETS, BACKEND_AGENT_PROMPT),
        orchestrator: BACKEND_ORCHESTRATOR_PROMPT,
      },
    },
    algorithm: {
      label: "Algorithm",
      description: "Correctness, complexity, benchmark, and adversarial-case focused expert squad.",
      agents: {
        ...profileAgents(ALGORITHM_TARGETS, ALGORITHM_AGENT_PROMPT),
        orchestrator: ALGORITHM_ORCHESTRATOR_PROMPT,
      },
    },
  }

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

  export function list(config: ConfigLike) {
    const active = activeID(config)
    const profiles = Object.entries(catalog(config)).map(([id, profile]) => ({
      id,
      label: profile.label,
      description: profile.description,
      built_in: Object.hasOwn(builtIns, id),
    }))
    return { active, default: DEFAULT_PROMPT_PROFILE_ID, profiles }
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
