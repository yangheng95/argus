import z from "zod"
import {
  PromptProfileCatalogProfileSchema,
  PromptProfileTargetCatalogEntrySchema,
} from "@/agent/prompt-profile"

export const ExpertSquadCatalogSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("built_in"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("project_package"),
      root: z.string(),
      manifest_path: z.string(),
      readme_path: z.string(),
    })
    .strict(),
])

export const ExpertSquadCatalogReadmeSchema = z
  .object({
    path: z.literal("README.md"),
    append_target: z.literal("orchestrator"),
    content: z.string(),
  })
  .strict()

export const ExpertSquadCatalogSelectorSchema = z
  .object({
    ref: z.string(),
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    summary: z.string(),
    selection_guidance: z.string(),
    instructions_path: z.literal("selector.md"),
    instructions: z.string(),
  })
  .strict()

export const ExpertSquadCatalogSummarySchema = PromptProfileCatalogProfileSchema.extend({
  version: z.string().optional(),
  source: ExpertSquadCatalogSourceSchema,
  readme: ExpertSquadCatalogReadmeSchema,
  selector: ExpertSquadCatalogSelectorSchema.optional(),
  dynamic_attributes: z.record(z.string(), z.unknown()),
}).strict()

export const ExpertSquadCatalogActiveSchema = z
  .object({
    effective: z.string(),
    project: z.string(),
    session_override: z.string().nullable(),
  })
  .strict()

export const ExpertSquadCatalogScopeSchema = z
  .object({
    kind: z.enum(["project", "session"]),
    directory: z.string(),
    sessionID: z.string().optional(),
  })
  .strict()

export const ExpertSquadCatalogSkillSummarySchema = z
  .object({
    name: z.string(),
    description: z.string(),
    builtin: z.boolean(),
    location: z.string(),
    required_tools: z.array(z.string()),
    mounted_agents: z.array(z.string()),
  })
  .strict()

export const ExpertSquadActiveSkillProjectionSchema = z
  .object({
    active_squad_id: z.string(),
    capability_profile_id: z.string(),
    built_in: z.boolean(),
    projection_hash: z.string(),
    projected_tool_ids: z.array(z.string()),
    projected_agent_ids: z.array(z.string()),
    selector_skill_names: z.array(z.string()),
    production_skill_names: z.array(z.string()),
    projected_skill_names: z.array(z.string()),
    skills: z.array(ExpertSquadCatalogSkillSummarySchema),
  })
  .strict()

export const ExpertSquadCatalogSchema = z
  .object({
    active: ExpertSquadCatalogActiveSchema,
    default: z.string(),
    scope: ExpertSquadCatalogScopeSchema,
    targets: z.array(PromptProfileTargetCatalogEntrySchema),
    squads: z.array(ExpertSquadCatalogSummarySchema),
    active_skill_projection: ExpertSquadActiveSkillProjectionSchema,
  })
  .strict()

export type ExpertSquadCatalogSummary = z.output<typeof ExpertSquadCatalogSummarySchema>
export type ExpertSquadCatalog = z.output<typeof ExpertSquadCatalogSchema>
