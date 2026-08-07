// ABI means Application Binary Interface. JSON means JavaScript Object Notation.

import {
  inspectEngineArtifactEnvelope,
  readExactArtifact,
  tool,
  type ArtifactReadLocator,
  type EngineArtifactHost,
} from "@opencorvus-ai/plugin"
import {
  MIRROR_WATCH_EXPERT_VOTE_KEYS,
  MIRROR_WATCH_FEATURE_CODES,
  MIRROR_WATCH_VOTE_WEIGHTS,
} from "./expert-survey"
import type { MirrorWatchPersona } from "./persona-authority"

export interface MirrorWatchFeature {
  code: string
  title: string
}

type Persona = Pick<MirrorWatchPersona, "name" | "uid" | "tier" | "status" | "interaction_mode" | "top_dimension">

export interface MirrorWatchPersonaVote extends Persona {
  user: string
  type: "persona"
  usage_freq: string
  picks: string[]
  reason: string
}

const SEGMENT_ORDERS = {
  tier: ["S", "A", "B", "C", "D"],
  status: ["活跃", "预警", "沉睡"],
  interaction_mode: ["standard", "deep", "click", "concise"],
  usage_freq: ["daily", "weekly", "monthly", "rarely"],
} as const
type SegmentField = keyof typeof SEGMENT_ORDERS
const PERSONA_CONTRACT_KEYS = [
  "user",
  "name",
  "uid",
  "type",
  "tier",
  "status",
  "interaction_mode",
  "top_dimension",
  "usage_freq",
  "picks",
  "reason",
] as const

function fail(message: string): never {
  throw new Error(`Mirror Watch aggregation rejected: ${message}`)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`)
  return value as Record<string, unknown>
}

function parseJSON(text: string, label: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    return fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${label} must be a nonempty string`)
  if (value !== value.trim()) fail(`${label} must not contain leading or trailing whitespace`)
  return value
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const actual = Object.keys(value).sort()
  const canonical = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(canonical)) {
    fail(`${label} fields must be exactly ${canonical.join(", ")}; received ${actual.join(", ")}`)
  }
}

function unique(values: readonly string[], label: string) {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) fail(`${label} contains duplicate ${value}`)
    seen.add(value)
  }
}

function picks(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length !== MIRROR_WATCH_VOTE_WEIGHTS.length) {
    fail(`${label} must contain exactly three feature IDs`)
  }
  const result = value.map((item, index) => string(item, `${label}[${index}]`))
  unique(result, label)
  for (const [index, code] of result.entries()) {
    if (!MIRROR_WATCH_FEATURE_CODES.includes(code)) {
      fail(`${label}[${index}] must be one of ${MIRROR_WATCH_FEATURE_CODES.join(", ")}`)
    }
  }
  return result
}

function allowedSegment(value: string, field: SegmentField, label: string) {
  const declared = SEGMENT_ORDERS[field] as readonly string[]
  if (!declared.includes(value)) fail(`${label} must be one of ${declared.join(", ")}`)
  return value
}

function contractExample(lines: readonly string[], heading: string, nextHeading?: string) {
  const indexes = lines.flatMap((line, index) => (line === heading ? [index] : []))
  if (indexes.length !== 1) fail(`survey must contain exactly one ${heading} heading`)
  const start = indexes[0]! + 1
  const end = nextHeading ? lines.findIndex((line, index) => index >= start && line === nextHeading) : lines.length
  if (end < start) fail(`survey must place ${nextHeading} after ${heading}`)
  const fenced = lines.slice(start, end).join("\n").match(/^\s*```json\s*\n([\s\S]*?)\n```\s*$/)
  if (!fenced) fail(`${heading} must contain exactly one fenced JSON example and no other content`)
  return object(parseJSON(fenced[1]!, heading), heading)
}

function assertSurveyContracts(source: string, lastFeatureOffset: number) {
  const lines = source.split(/\r?\n/)
  const expertHeading = "## 专家答卷契约"
  const personaHeading = "## 画像答卷契约"
  const expert = contractExample(lines, expertHeading, personaHeading)
  if (source.indexOf(expertHeading) <= lastFeatureOffset) {
    fail(`${expertHeading} must follow the ordered F01-F10 feature definitions`)
  }
  exactKeys(expert, MIRROR_WATCH_EXPERT_VOTE_KEYS, expertHeading)
  string(expert.name, `${expertHeading}.name`)
  if (expert.type !== "agent") fail(`${expertHeading}.type must equal agent`)
  string(expert.persona_source, `${expertHeading}.persona_source`)
  allowedSegment(string(expert.usage_freq, `${expertHeading}.usage_freq`), "usage_freq", `${expertHeading}.usage_freq`)
  picks(expert.picks, `${expertHeading}.picks`)
  string(expert.reason, `${expertHeading}.reason`)

  const persona = contractExample(lines, personaHeading)
  exactKeys(persona, PERSONA_CONTRACT_KEYS, personaHeading)
  for (const key of ["user", "name", "uid", "top_dimension", "reason"] as const) {
    string(persona[key], `${personaHeading}.${key}`)
  }
  if (persona.type !== "persona") fail(`${personaHeading}.type must equal persona`)
  for (const field of ["tier", "status", "interaction_mode", "usage_freq"] as const) {
    allowedSegment(string(persona[field], `${personaHeading}.${field}`), field, `${personaHeading}.${field}`)
  }
  picks(persona.picks, `${personaHeading}.picks`)
}

export function parseMirrorWatchSurveyFeatures(source: string): MirrorWatchFeature[] {
  const matches = Array.from(source.matchAll(/^#{2,4}\s+(F\d{2})[.\s、:：]+(.+?)\s*$/gm), (match) => ({
    code: match[1]!,
    title: match[2]!.trim(),
    sourceOffset: match.index,
  }))
  if (matches.length !== MIRROR_WATCH_FEATURE_CODES.length) {
    fail("survey must define exactly ten F01-F10 feature headings")
  }
  for (const [index, feature] of matches.entries()) {
    if (feature.code !== MIRROR_WATCH_FEATURE_CODES[index]) {
      fail(`survey feature ${index + 1} must be ${MIRROR_WATCH_FEATURE_CODES[index]}`)
    }
    string(feature.title, `survey.${feature.code}.title`)
  }
  unique(matches.map((feature) => feature.title), "survey feature titles")
  assertSurveyContracts(source, matches.at(-1)!.sourceOffset)
  return matches.map(({ code, title }) => ({ code, title }))
}

export function parseMirrorWatchPersonaVote(text: string, label: string): MirrorWatchPersonaVote {
  const row = object(parseJSON(text, label), label)
  exactKeys(row, PERSONA_CONTRACT_KEYS, label)
  if (string(row.type, `${label}.type`) !== "persona") fail(`${label}.type must be persona`)
  return {
    user: string(row.user, `${label}.user`),
    name: string(row.name, `${label}.name`),
    uid: string(row.uid, `${label}.uid`),
    type: "persona",
    tier: allowedSegment(string(row.tier, `${label}.tier`), "tier", `${label}.tier`),
    status: allowedSegment(string(row.status, `${label}.status`), "status", `${label}.status`),
    interaction_mode: allowedSegment(
      string(row.interaction_mode, `${label}.interaction_mode`),
      "interaction_mode",
      `${label}.interaction_mode`,
    ),
    top_dimension: string(row.top_dimension, `${label}.top_dimension`),
    usage_freq: allowedSegment(string(row.usage_freq, `${label}.usage_freq`), "usage_freq", `${label}.usage_freq`),
    picks: picks(row.picks, `${label}.picks`),
    reason: string(row.reason, `${label}.reason`),
  }
}

export function assertMirrorWatchPersonaVoteMatchesAuthority(
  vote: MirrorWatchPersonaVote,
  persona: Persona,
  label: string,
) {
  for (const key of ["name", "uid", "tier", "status", "interaction_mode", "top_dimension"] as const) {
    if (vote[key] !== persona[key]) fail(`${label}.${key} must equal the authoritative persona value`)
  }
  if (vote.user !== persona.name) fail(`${label}.user must equal the authoritative persona name`)
}

export const MIRROR_WATCH_RESEARCH_DELIVERY_ARTIFACT_TYPE = "mirror-watch/research-delivery"
export const MIRROR_WATCH_RESEARCH_DELIVERY_SCHEMA_VERSION = 1
export const MIRROR_WATCH_PERSONA_COHORT_ARTIFACT_TYPE = "mirror-watch/persona-survey-cohort"
export const MIRROR_WATCH_PERSONA_COHORT_SCHEMA_VERSION = 1

const nonempty = tool.schema.string().trim().min(1)
const featureCode = tool.schema.string().regex(/^F(?:0[1-9]|10)$/)

export const MirrorWatchResearchDeliveryPayloadSchema = tool.schema
  .object({
    survey_path: nonempty,
    features: tool.schema
      .array(
        tool.schema
          .object({
            code: featureCode,
            title: nonempty,
          })
          .strict(),
      )
      .length(10),
    resource_roles: tool.schema
      .object({
        recommendations: tool.schema.literal(0),
        gantt: tool.schema.literal(1),
        agent_survey: tool.schema.literal(2),
        human_survey: tool.schema.literal(3),
      })
      .strict(),
  })
  .strict()

export const MirrorWatchPersonaVoteSchema = tool.schema
  .object({
    user: nonempty,
    name: nonempty,
    uid: nonempty,
    type: tool.schema.literal("persona"),
    tier: tool.schema.enum(["S", "A", "B", "C", "D"]),
    status: tool.schema.enum(["活跃", "预警", "沉睡"]),
    interaction_mode: tool.schema.enum(["standard", "deep", "click", "concise"]),
    top_dimension: nonempty,
    usage_freq: tool.schema.enum(["daily", "weekly", "monthly", "rarely"]),
    picks: tool.schema.array(featureCode).length(3),
    reason: nonempty,
  })
  .strict()

export const MirrorWatchPersonaCohortPayloadSchema = tool.schema
  .object({
    persona_count: tool.schema.number().int().positive(),
    identities: tool.schema.array(tool.schema.object({ name: nonempty, uid: nonempty }).strict()).min(1),
    votes: tool.schema.array(MirrorWatchPersonaVoteSchema).min(1),
    resource_roles: tool.schema
      .array(
        tool.schema
          .object({
            name: nonempty,
            resource_index: tool.schema.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()

export type MirrorWatchResearchDeliveryPayload = {
  survey_path: string
  features: MirrorWatchFeature[]
  resource_roles: {
    recommendations: 0
    gantt: 1
    agent_survey: 2
    human_survey: 3
  }
}

export type MirrorWatchPersonaCohortPayload = {
  persona_count: number
  identities: Array<{ name: string; uid: string }>
  votes: MirrorWatchPersonaVote[]
  resource_roles: Array<{ name: string; resource_index: number }>
}

export function parseMirrorWatchResearchDeliveryPayload(
  value: unknown,
): MirrorWatchResearchDeliveryPayload {
  return MirrorWatchResearchDeliveryPayloadSchema.parse(value)
}

export function parseMirrorWatchPersonaCohortPayload(value: unknown): MirrorWatchPersonaCohortPayload {
  const payload = MirrorWatchPersonaCohortPayloadSchema.parse(value)
  const votes = payload.votes.map((vote, index) =>
    parseMirrorWatchPersonaVote(JSON.stringify(vote), `persona cohort Artifact vote[${index}]`),
  )
  if (
    payload.persona_count !== payload.identities.length ||
    payload.persona_count !== votes.length ||
    payload.persona_count !== payload.resource_roles.length
  ) {
    throw new Error(
      `persona cohort Artifact counts must agree: persona_count=${payload.persona_count}, identities=${payload.identities.length}, votes=${votes.length}, resource_roles=${payload.resource_roles.length}`,
    )
  }
  const identities = [...payload.identities].sort((left, right) => left.name.localeCompare(right.name))
  const orderedVotes = [...votes].sort((left, right) => left.name.localeCompare(right.name))
  for (const [index, vote] of orderedVotes.entries()) {
    const identity = identities[index]
    if (!identity || identity.name !== vote.name || identity.uid !== vote.uid) {
      throw new Error(`persona cohort Artifact identity[${index}] must equal its vote name and UID`)
    }
  }
  const roles = [...payload.resource_roles].sort((left, right) => left.resource_index - right.resource_index)
  for (const [index, role] of roles.entries()) {
    if (role.resource_index !== index) {
      throw new Error("persona cohort Artifact resource_roles must reference every resource index exactly once")
    }
    if (!votes.some((vote) => vote.name === role.name)) {
      throw new Error(`persona cohort Artifact resource role ${role.name} has no matching vote`)
    }
  }
  return {
    ...payload,
    votes,
  }
}

export async function readMirrorWatchEngineArtifact(input: {
  host: Pick<EngineArtifactHost, "read">
  locator: ArtifactReadLocator
  artifactType: string
  schemaVersion: number
  producerOwnerKind: "projected-scheduler" | "projected-worker"
  producerAgentID: string
}) {
  if (input.locator.source !== "engine_artifact") {
    throw new Error(`${input.artifactType} predecessor must be an exact Engine Artifact locator`)
  }
  const exact = await readExactArtifact(input.host, input.locator)
  return {
    exact,
    envelope: inspectEngineArtifactEnvelope(exact, {
      artifactType: input.artifactType,
      schemaVersion: input.schemaVersion,
      producer: {
        ownerKind: input.producerOwnerKind,
        expertSquadID: "mirror-watch",
        agentID: input.producerAgentID,
      },
    }),
  }
}
