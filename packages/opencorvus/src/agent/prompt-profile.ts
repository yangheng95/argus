import z from "zod"
import { AgentRoleContract, type AgentRoleID } from "@/agent/role-contract"
import { builtInPromptProfiles } from "@/expert-squad/builtin"

export const DEFAULT_PROMPT_PROFILE_ID = "general"
export const PROMPT_PROFILE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

export const PromptProfileIDSchema = z
  .string()
  .min(1, "prompt profile id cannot be empty.")
  .max(64, "prompt profile id must be at most 64 characters.")
  .regex(
    PROMPT_PROFILE_ID_PATTERN,
    "prompt profile id must use lowercase letters, digits, and single hyphens, and must start with a letter.",
  )
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
  })
  .strict()
  .default({ active: DEFAULT_PROMPT_PROFILE_ID })

export const PromptProfileOverlaySchema = z
  .object({
    active: PromptProfileIDSchema.nullable().optional(),
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

const allTargetSet = new Set<string>(ALL_PROFILE_TARGETS)

export namespace PromptProfile {
  export const builtIns: Record<string, PromptProfileDefinition> = builtInPromptProfiles

  export const targets: PromptProfileTargetCatalogEntry[] = [...ALL_PROFILE_TARGETS].map((targetID) => ({
    id: targetID,
    label: targetID,
    description: AgentRoleContract.description(targetID),
    editable: AgentRoleContract.promptProfileTargetMode(targetID) === "user",
    built_in_only: AgentRoleContract.promptProfileTargetMode(targetID) === "builtin",
  }))

  export function catalog(_config: ConfigLike): Record<string, PromptProfileDefinition> {
    return builtIns
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
    const knownProfiles = catalog(config)
    if (!Object.hasOwn(knownProfiles, profileConfig.active)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, "active"],
        message: `Unknown prompt profile ${JSON.stringify(profileConfig.active)}.`,
      })
    }
  }

  export function assertKnownAgentTarget(agentID: AgentRoleID | string): void {
    if (!allTargetSet.has(agentID)) {
      throw new Error(`Unknown prompt profile target ${JSON.stringify(agentID)}`)
    }
  }

}
