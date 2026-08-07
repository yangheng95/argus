// ID means Identifier. JSON means JavaScript Object Notation.
// SHA-256 means Secure Hash Algorithm 256-bit.
// UID means User Identifier.

import { tool } from "@opencorvus-ai/plugin"

export const MIRROR_WATCH_PERSONA_AUTHORITY_ARTIFACT_TYPE = "mirror-watch/persona-authority"
export const MIRROR_WATCH_PERSONA_AUTHORITY_SCHEMA_VERSION = 1

const NonemptyStringSchema = tool.schema
  .string()
  .min(1)
  .refine((value) => value === value.trim(), {
    message: "must not contain leading or trailing whitespace",
  })
const FiniteNonnegativeNumberSchema = tool.schema.number().finite().nonnegative()
const FiniteNonnegativeIntegerSchema = FiniteNonnegativeNumberSchema.int()
const DimensionSchema = tool.schema
  .object({
    name: NonemptyStringSchema,
    cn: NonemptyStringSchema,
    count: FiniteNonnegativeIntegerSchema,
  })
  .strict()
const PersonaSchema = tool.schema
  .object({
    id: NonemptyStringSchema,
    uid: NonemptyStringSchema,
    name: NonemptyStringSchema,
    tier: tool.schema.enum(["S", "A", "B", "C", "D"]),
    status: tool.schema.enum(["活跃", "预警", "沉睡"]),
    total_questions: FiniteNonnegativeIntegerSchema,
    active_days: FiniteNonnegativeIntegerSchema,
    daily_questions: FiniteNonnegativeNumberSchema,
    avg_len: FiniteNonnegativeIntegerSchema,
    recent_31d: FiniteNonnegativeIntegerSchema,
    total_tags: FiniteNonnegativeIntegerSchema,
    stat_ratio: FiniteNonnegativeIntegerSchema,
    abstract_ratio: FiniteNonnegativeIntegerSchema,
    inactive_days: FiniteNonnegativeIntegerSchema,
    dimensions: tool.schema.array(DimensionSchema).min(1),
    top_dimension: NonemptyStringSchema,
    interaction_mode: tool.schema.enum(["standard", "deep", "click", "concise"]),
    capability: tool.schema.record(NonemptyStringSchema, FiniteNonnegativeNumberSchema),
    seed: tool.schema.null(),
    has_avatar: tool.schema.boolean(),
  })
  .strict()
  .superRefine((persona, context) => {
    if (persona.id !== persona.name) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "must equal name",
      })
    }
    if (persona.stat_ratio + persona.abstract_ratio !== 100) {
      context.addIssue({
        code: "custom",
        path: ["stat_ratio"],
        message: "stat_ratio and abstract_ratio must total 100",
      })
    }
    const dimensionNames = new Set<string>()
    const dimensionChineseNames = new Set<string>()
    persona.dimensions.forEach((dimension, index) => {
      if (dimensionNames.has(dimension.name)) {
        context.addIssue({
          code: "custom",
          path: ["dimensions", index, "name"],
          message: "dimension names must be unique within one persona",
        })
      }
      if (dimensionChineseNames.has(dimension.cn)) {
        context.addIssue({
          code: "custom",
          path: ["dimensions", index, "cn"],
          message: "dimension Chinese names must be unique within one persona",
        })
      }
      dimensionNames.add(dimension.name)
      dimensionChineseNames.add(dimension.cn)
    })
    if (!dimensionNames.has(persona.top_dimension)) {
      context.addIssue({
        code: "custom",
        path: ["top_dimension"],
        message: "must name one declared dimension",
      })
    }
  })

export const MirrorWatchPersonaAuthoritySchema = tool.schema
  .array(PersonaSchema)
  .min(1)
  .superRefine((personas, context) => {
    const identityFields = ["id", "uid", "name"] as const
    for (const field of identityFields) {
      const seen = new Set<string>()
      personas.forEach((persona, index) => {
        if (seen.has(persona[field])) {
          context.addIssue({
            code: "custom",
            path: [index, field],
            message: `persona ${field} values must be unique`,
          })
        }
        seen.add(persona[field])
      })
    }
  })

export const MirrorWatchPersonaAuthorityPayloadSchema = tool.schema
  .object({
    authority_sha256: tool.schema.string().regex(/^[a-f0-9]{64}$/),
    persona_count: tool.schema.number().int().positive(),
    personas: MirrorWatchPersonaAuthoritySchema,
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.persona_count !== payload.personas.length) {
      context.addIssue({
        code: "custom",
        path: ["persona_count"],
        message: "must equal personas.length",
      })
    }
  })

function authoritySchemaError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "root"}: ${issue.message}`)
    .join("; ")
}

export function parseMirrorWatchPersonaAuthority(text: string) {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Mirror Watch persona authority rejected: invalid JSON: ${detail}`)
  }
  const parsed = MirrorWatchPersonaAuthoritySchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`Mirror Watch persona authority rejected: ${authoritySchemaError(parsed.error)}`)
  }
  return parsed.data
}

export type MirrorWatchPersona = ReturnType<typeof parseMirrorWatchPersonaAuthority>[number]

export function parseMirrorWatchPersonaAuthorityPayload(value: unknown) {
  const parsed = MirrorWatchPersonaAuthorityPayloadSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`Mirror Watch persona authority payload rejected: ${authoritySchemaError(parsed.error)}`)
  }
  return parsed.data
}

export type MirrorWatchPersonaAuthorityPayload = ReturnType<typeof parseMirrorWatchPersonaAuthorityPayload>
