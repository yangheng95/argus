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
      namespace: z.string(),
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
  display_prefix: z.string().optional(),
  display_label: z.string(),
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

export const ExpertSquadCatalogScopeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("project"),
      directory: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("session"),
      directory: z.string(),
      sessionID: z.string(),
    })
    .strict(),
])

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

export const ExpertSquadActiveAgentProjectionAgentSchema = z
  .object({
    base_role: z.string(),
    virtual_agent_id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    projection_hash: z.string(),
    built_in_tool_ids: z.array(z.string()),
    default_skill_refs: z.array(z.string()),
    package_skill_refs: z.array(z.string()),
    default_tool_refs: z.array(z.string()),
    package_tool_refs: z.array(z.string()),
    default_mcp_server_refs: z.array(z.string()),
    package_mcp_server_refs: z.array(z.string()),
    default_mcp_tool_refs: z.array(z.string()),
    package_mcp_tool_refs: z.array(z.string()),
    default_mcp_prompt_refs: z.array(z.string()),
    package_mcp_prompt_refs: z.array(z.string()),
    default_mcp_resource_refs: z.array(z.string()),
    package_mcp_resource_refs: z.array(z.string()),
  })
  .strict()

export const ExpertSquadActiveAgentProjectionSchema = z
  .object({
    source_expert_squad_id: z.string(),
    prompt_profile_active: z.string(),
    projection_hash: z.string(),
    agents: z.array(ExpertSquadActiveAgentProjectionAgentSchema),
  })
  .strict()

export const ExpertSquadCatalogSchema = z
  .object({
    active: ExpertSquadCatalogActiveSchema,
    default: z.string(),
    scope: ExpertSquadCatalogScopeSchema,
    targets: z.array(PromptProfileTargetCatalogEntrySchema),
    squads: z.array(ExpertSquadCatalogSummarySchema),
    active_agent_projection: ExpertSquadActiveAgentProjectionSchema,
    active_skill_projection: ExpertSquadActiveSkillProjectionSchema,
  })
  .strict()

export type ExpertSquadCatalogSummary = z.output<typeof ExpertSquadCatalogSummarySchema>
export type ExpertSquadCatalog = z.output<typeof ExpertSquadCatalogSchema>
