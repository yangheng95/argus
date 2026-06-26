import z from "zod"
import { AgentRoleContract, type AgentRoleID } from "@/agent/role-contract"

export const DEFAULT_PROMPT_PROFILE_ID = "frontend-replica"
export const PROMPT_PROFILE_ID_PATTERN = /^(?!.*--)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

export const PromptProfileIDSchema = z
  .string()
  .min(1, "prompt profile id cannot be empty.")
  .max(64, "prompt profile id must be at most 64 characters.")
  .regex(
    PROMPT_PROFILE_ID_PATTERN,
    "prompt profile id must use lowercase letters, digits, and single hyphens, and must start with a letter.",
  )
const USER_PROFILE_TARGETS = AgentRoleContract.promptProfileTargets("user")
const BUILT_IN_ONLY_PROFILE_TARGETS = AgentRoleContract.promptProfileTargets("builtin")
const ALL_PROFILE_TARGETS = AgentRoleContract.promptProfileTargets()

export type PromptProfileTargetID = AgentRoleID

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
const allTargetSet = new Set<string>(ALL_PROFILE_TARGETS)

export namespace PromptProfile {
  export const builtIns: Record<string, PromptProfileDefinition> = {
    general: {
      label: "General",
      description: "No domain-specific expert overlay.",
      agents: {},
    },
    "frontend-replica": {
      label: "Frontend Replica",
      description: "Reference parity, webpage replication, visual evidence, and design-system focused expert squad.",
      agents: {
        coding:
          "Prioritize desktop source information architecture, module order, density, states, and visible parity. Do not introduce tablet/mobile scope unless the operator asks for a separate multi-end migration task. Verify UI in the component system.",
        "coding-assistant":
          "Answer replica questions in terms of source structure, component mapping, style rhythm, interaction semantics, and visible parity that can be checked in the rendered UI.",
        general:
          "Anchor multi-step frontend replica work to reference screens, module order, state changes, accessibility, and user-visible behavior.",
        explore:
          "Map reference modules, component boundaries, styling conventions, state changes, and prior visual evidence from the source. Do not mutate the workspace.",
        mission:
          "Keep frontend replica work tied to the target surface, the source-backed structure, the interaction states that must work, and rendered evidence.",
        "intent-analysis":
          "Resolve replica requests into desktop source scope, module order, screen changes, interactions, and evidence gaps. Treat tablet/mobile template or old handoff wording as out of scope unless operator asks for separate multi-end migration.",
        requirements:
          "Write replica requirements as desktop observable truths: information architecture, module sequence, component states, and visual acceptance. Do not create tablet/mobile/non-desktop REQ rows from generic template, research, or handoff text.",
        architect:
          "Turn replica requirements into desktop component boundaries, data flow, ownership, and verification. Do not register tablet/mobile/non-desktop goals, acceptance specs, or build work without explicit current multi-end migration.",
        "frontend-design":
          "Extract a desktop source-backed replica contract: information architecture, module order, density, spacing, interactions, and preservation evidence. Mark non-desktop template language out of scope unless requested as separate migration.",
        "frontend-research":
          "Produce a desktop source-backed replica brief that separates confirmed facts from assumptions and defines target surfaces, key interactions, and evidence gaps. Do not publish tablet/mobile work packets for default replica tasks.",
        build:
          "Build approved desktop replica without source drift. If a goal asks tablet/mobile/non-desktop work without multi-end migration, report the scope defect instead of executing it. For deps, inspect manifest/lockfile and rerun original checks.",
        "visual-qa":
          "Audit rendered desktop replica surfaces for structure, spacing, interaction, and state mismatches. Do not require tablet/mobile screenshots for default replica tasks. Name concrete defects and tie review to visible evidence.",
        integrity:
          "Treat replica delivery as incomplete unless desktop source structure, requested surface, interactions, and visual acceptance are shown. Treat unrequested tablet/mobile expectations as out of scope.",
        orchestrator:
          "Keep replica decisions grounded in exact reference surface, source evidence, goal state, and acceptance. Do not route template-derived tablet/mobile text into requirements, goals, Build, or Visual QA unless separate migration is requested.",
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
    "frontend-automation-debug": {
      label: "Frontend Automation Debug",
      description:
        "Frontend automation, browser runtime debugging, visual regression, and reproducible evidence focused expert squad.",
      agents: {
        coding:
          "Prioritize browser-reproducible frontend failures, selectors, interaction timing, screenshots, and focused fixes that prove the rendered behavior now passes.",
        "coding-assistant":
          "Explain frontend automation debugging through observable UI behavior, selectors, fixtures, assertions, screenshots, and the exact verification path.",
        general:
          "Anchor multi-step frontend debug work to reproducible browser failures, controlled fixtures, interaction traces, regression scope, and rerunnable evidence.",
        explore:
          "Map frontend test structure, browser helpers, preview wiring, fixtures, selectors, and uncovered visible behavior from source evidence without mutating the workspace.",
        mission:
          "Keep frontend automation missions tied to acceptance criteria, reproducible UI failures, verification ownership, and evidence that proves the fix remains correct.",
        "intent-analysis":
          "Resolve frontend debug requests into browser state, reproduction steps, target layer, fixtures, selectors, missing evidence, and acceptance thresholds.",
        requirements:
          "Write frontend debug requirements as observable UI behavior, preconditions, assertions, negative cases, fixture data, and screenshot evidence.",
        architect:
          "Turn frontend debug requirements into verification boundaries across component, integration, runtime, and visual checks mapped to owned paths and failure modes.",
        "frontend-design":
          "Define handoff details that make automation precise: visible states, interaction outcomes, selectors, data contracts, breakpoints, and screenshot expectations.",
        "frontend-research":
          "Produce frontend investigation packets for automation: selectors, states, user flows, data dependencies, visual risks, and evidence gaps for each source page.",
        build:
          "Fix visible frontend failures with focused automation. If browser/preview/lint/typecheck/build stops before checker start, inspect manifest, .bin, package links, ports, and runners; repair local deps, rerun original command, then publish.",
        "visual-qa":
          "Audit rendered surfaces as executable checks: interactions, layout states, accessibility signals, and screenshots must support every acceptance claim.",
        "deep-research":
          "Research browser automation tools, framework semantics, environment constraints, and current documentation only when implementation depends on them.",
        "fact-check":
          "Check frontend automation claims against command results, browser behavior, version limits, documented semantics, and whether evidence supports them.",
        "goal-workload-analyst":
          "Challenge goals for missing frontend verification scope, oversized automation surfaces, fragile fixtures, hidden runtime dependencies, and unclear evidence.",
        integrity:
          "Treat frontend delivery as incomplete when changed behavior lacks targeted automation, reproduced failure evidence, screenshots, or residual-risk notes.",
        orchestrator:
          "Keep frontend debug decisions grounded in the exact visible failure, the narrowest responsible owner, and browser evidence that can be rerun.",
      },
    },
  }

  export const targets: PromptProfileTargetCatalogEntry[] = [...ALL_PROFILE_TARGETS].map((targetID) => ({
    id: targetID,
    label: targetID,
    description: AgentRoleContract.description(targetID),
    editable: AgentRoleContract.promptProfileTargetMode(targetID) === "user",
    built_in_only: AgentRoleContract.promptProfileTargetMode(targetID) === "builtin",
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
