import z from "zod"
import path from "path"
import { type TextHooks } from "@/llm/api"
import { resolveHeadlessLanguageModel, completeHeadlessText } from "@/llm/headless"
import { type ReplanContext } from "@/planner/agent"
import {
  GoalKind,
  GoalQaProfile,
  GoalInput,
} from "@/orchestrator/model"
import { type SpecDraft, type ArchitecturalLayer } from "@/spec/agent"
import { Log } from "@/util/log"

const log = Log.create({ service: "goal-service" })

const GoalQaProfileDraft = z.object({
  rule_selectors: z.array(z.string()),
  goal_check_prompt: z.string().optional(),
  spec_scope: z.literal("mapped_requirements"),
})

const GoalContractDraft = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  requirement_ids: z.array(z.string().min(1)).min(1),
  depends_on_goal_ids: z.array(z.string().min(1)),
  owned_paths: z.array(z.string().min(1)),
  done_definition: z.string().min(1),
  qa_profile: GoalQaProfileDraft,
  priority: z.enum(["blocking", "advisory"]),
  kind: GoalKind,
})

const GoalDraftSchema = z.object({
  summary: z.string().min(1),
  goals: z.array(GoalContractDraft).min(1),
})

export type GoalDraft = z.infer<typeof GoalDraftSchema>
type GoalContractDraftType = GoalDraft["goals"][number]
type GoalInputType = z.infer<typeof GoalInput>

type GoalCompileInput = {
  title: string
  request: string
  spec: SpecDraft
  sessionID?: string
  metadata?: Record<string, unknown>
  goalHints?: GoalInputType[]
  replanContext?: ReplanContext
  timeoutMs?: number
  signal?: AbortSignal
  stream?: TextHooks
  onStatus?: (summary: string) => void | Promise<void>
}

type GoalValidationScope = {
  requiredRequirementIDs?: Set<string>
}

export class GoalFailureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "GoalFailureError"
  }
}

function uniqueStrings(input: string[]) {
  return [...new Set(input.map((item) => item.trim()).filter(Boolean))]
}

function normalizedGoal(goal: GoalContractDraftType): GoalContractDraftType {
  return {
    ...goal,
    id: goal.id.trim(),
    title: goal.title.trim(),
    objective: goal.objective.trim(),
    requirement_ids: uniqueStrings(goal.requirement_ids),
    depends_on_goal_ids: uniqueStrings(goal.depends_on_goal_ids),
    owned_paths: uniqueStrings(goal.owned_paths),
    done_definition: goal.done_definition.trim(),
    qa_profile: {
      ...goal.qa_profile,
      rule_selectors: uniqueStrings(goal.qa_profile.rule_selectors),
      spec_scope: "mapped_requirements",
    },
  }
}

function validateGoalGraph(goalDraft: GoalDraft, spec: SpecDraft, scope: GoalValidationScope = {}) {
  const requirements = Array.isArray(spec.requirements) ? spec.requirements : []
  if (requirements.length < 1) {
    throw new GoalFailureError("Goal decomposition requires at least one formulated requirement")
  }

  const requirementIDs = new Set(requirements.map((item) => item.id.trim()).filter(Boolean))
  if (requirementIDs.size !== requirements.length) {
    throw new GoalFailureError("Specification requirements contain duplicate or empty ids")
  }

  const goals = goalDraft.goals.map(normalizedGoal)
  const goalIDs = new Set<string>()
  for (const goal of goals) {
    if (goalIDs.has(goal.id)) {
      throw new GoalFailureError(`Goal graph contains duplicate goal id: ${goal.id}`)
    }
    goalIDs.add(goal.id)
    if (goal.requirement_ids.length < 1) {
      throw new GoalFailureError(`Goal ${goal.id} is missing mapped requirements`)
    }
    if (goal.kind !== "verification" && goal.owned_paths.length < 1) {
      throw new GoalFailureError(`Goal ${goal.id} must declare owned_paths`)
    }
    for (const requirementID of goal.requirement_ids) {
      if (!requirementIDs.has(requirementID)) {
        throw new GoalFailureError(`Goal ${goal.id} references unknown requirement id: ${requirementID}`)
      }
    }
    for (const dependencyID of goal.depends_on_goal_ids) {
      if (dependencyID === goal.id) {
        throw new GoalFailureError(`Goal ${goal.id} cannot depend on itself`)
      }
      if (!goalIDs.has(dependencyID) && !goals.some((item) => item.id === dependencyID)) {
        throw new GoalFailureError(`Goal ${goal.id} depends on unknown goal id: ${dependencyID}`)
      }
    }
  }

  const blockingRequirements = new Set(
    requirements
      .filter((item) =>
        (item.priority ?? "blocking") === "blocking"
        && (!scope.requiredRequirementIDs || scope.requiredRequirementIDs.has(item.id.trim()))
      )
      .map((item) => item.id.trim()),
  )
  const coveredBlockingRequirements = new Set(
    goals
      .filter((goal) => goal.priority === "blocking")
      .flatMap((goal) => goal.requirement_ids),
  )
  const missingBlocking = [...blockingRequirements].filter((id) => !coveredBlockingRequirements.has(id))
  if (missingBlocking.length > 0) {
    throw new GoalFailureError(`Blocking requirements are not covered by blocking goals: ${missingBlocking.join(", ")}`)
  }

  const blockingRequirementCount = blockingRequirements.size
  for (const goal of goals) {
    const text = `${goal.title} ${goal.objective} ${goal.done_definition}`.toLowerCase()
    const umbrella =
      /\b(everything|entire\s+(app|system|project|workflow|surface)|full\s+app|whole\s+(app|system|project)|all\s+(features|requirements|modules|routes|components|pages|workflows|checks|tests)|project setup|bootstrap|infrastructure|foundation|base project)\b|全量|全部|整体|基础设施|项目初始化|脚手架/.test(text)
    if (umbrella && goal.requirement_ids.length > 1) {
      throw new GoalFailureError(`Goal ${goal.id} is too broad and reads like an umbrella stage`)
    }
    if (blockingRequirementCount > 2 && goal.priority === "blocking" && goal.requirement_ids.length === blockingRequirementCount) {
      throw new GoalFailureError(`Goal ${goal.id} collapses the entire blocking workload into one stage`)
    }
  }

  const adjacency = new Map(goals.map((goal) => [goal.id, goal.depends_on_goal_ids]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (goalID: string) => {
    if (visited.has(goalID)) return
    if (visiting.has(goalID)) {
      throw new GoalFailureError(`Goal graph contains a cycle at ${goalID}`)
    }
    visiting.add(goalID)
    for (const dependencyID of adjacency.get(goalID) ?? []) visit(dependencyID)
    visiting.delete(goalID)
    visited.add(goalID)
  }
  for (const goal of goals) visit(goal.id)
}

type GoalCategory =
  | "bootstrap"    // project setup, config, tooling, package management
  | "data"         // data layer: models, schema, DB, migrations, repositories
  | "auth"         // authentication, authorization, sessions, identity
  | "middleware"   // cross-cutting concerns, middleware, guards, interceptors
  | "feature"      // business logic, domain-specific features (catch-all)
  | "integration"  // app wiring, routing, entry points, composition
  | "quality"      // type safety, error handling, linting, code quality
  | "verification" // automated tests, acceptance checks
  | "other"        // uncategorized

type RequirementDraft = NonNullable<SpecDraft["requirements"]>[number]

/**
 * Unified layer definition used by compile().
 * Can come from two sources:
 *  1. Spec blueprint (architectural_layers) — task-specific, authoritative.
 *  2. Generic GoalCategory table — used when spec provides no blueprint.
 *
 * This abstraction lets compile() work identically regardless of source,
 * eliminating the need for any code path duplication.
 */
type LayerDef = {
  id: string
  name: string  // human-readable name for objective generation
  rank: number
  depends_on: string[]
  kind: z.infer<typeof GoalKind>
  isVerification: boolean
  defaultRuleSelectors: (hasVerificationLayer: boolean) => string[]
}

/** Topological rank: foundational layers get low rank numbers. */
function topoRankLayers(layers: ArchitecturalLayer[]): Map<string, number> {
  const rankMap = new Map<string, number>()
  const inDegree = new Map(layers.map((l) => [l.id, l.depends_on.filter((d) => layers.some((x) => x.id === d)).length]))
  const queue = layers.filter((l) => (inDegree.get(l.id) ?? 0) === 0).map((l) => l.id)
  let rank = 10
  while (queue.length > 0) {
    const next = queue.shift()!
    rankMap.set(next, rank)
    rank += 10
    for (const layer of layers) {
      if (layer.depends_on.includes(next)) {
        const remaining = (inDegree.get(layer.id) ?? 0) - 1
        inDegree.set(layer.id, remaining)
        if (remaining === 0) queue.push(layer.id)
      }
    }
  }
  // Any layers left with cycles get max rank
  for (const layer of layers) {
    if (!rankMap.has(layer.id)) rankMap.set(layer.id, rank)
  }
  return rankMap
}

function kindFromLayerId(id: string, description: string): z.infer<typeof GoalKind> {
  const text = `${id} ${description}`.toLowerCase()
  if (/test|verif|spec|check|acceptance/.test(text)) return "verification"
  if (/setup|bootstrap|scaffold|init|config|package|build|tooling/.test(text)) return "bootstrap"
  if (/middleware|interceptor|guard|cors|rate.?limit|pipeline/.test(text)) return "integration"
  if (/wiring|routing|entry|compose|main|app\.ts|index\.ts/.test(text)) return "integration"
  if (/quality|lint|typecheck|type.?check|static.?analysis/.test(text)) return "system"
  return "feature"
}

function isVerificationLayer(id: string, description: string): boolean {
  return /test|verif|spec|check|acceptance/.test(`${id} ${description}`.toLowerCase())
}

/** Build LayerDef[] from a spec blueprint. Dependencies reflect actual architecture. */
function layersFromBlueprint(blueprint: ArchitecturalLayer[]): LayerDef[] {
  const rankMap = topoRankLayers(blueprint)
  const verificationIds = new Set(blueprint.filter((l) => isVerificationLayer(l.id, l.description)).map((l) => l.id))
  return blueprint.map((layer) => ({
    id: layer.id,
    name: layer.name,
    rank: rankMap.get(layer.id) ?? 100,
    depends_on: layer.depends_on,
    kind: kindFromLayerId(layer.id, layer.description),
    isVerification: verificationIds.has(layer.id),
    defaultRuleSelectors: (hasVerificationLayer: boolean) =>
      verificationIds.has(layer.id) ? ["test", "lint"] : hasVerificationLayer ? ["build"] : ["build", "test"],
  }))
}

/** Build LayerDef[] from the generic GoalCategory taxonomy. Used when spec has no blueprint. */
function layersFromCategories(): LayerDef[] {
  const CATEGORY_RANK: Record<GoalCategory, number> = {
    bootstrap: 10, data: 20, auth: 30, middleware: 40,
    feature: 50, integration: 70, quality: 80, verification: 90, other: 100,
  }
  const CATEGORY_DEPENDENCIES: Record<Exclude<GoalCategory, "verification">, GoalCategory[]> = {
    bootstrap: [], data: ["bootstrap"], auth: ["bootstrap", "data"],
    middleware: ["auth"], feature: ["data", "auth", "middleware"],
    integration: ["bootstrap", "data", "auth", "middleware", "feature"],
    quality: ["bootstrap"], other: ["bootstrap", "data"],
  }
  const CAT_KIND: Record<GoalCategory, z.infer<typeof GoalKind>> = {
    bootstrap: "bootstrap", data: "bootstrap", middleware: "integration",
    integration: "integration", verification: "verification", quality: "system",
    auth: "feature", feature: "feature", other: "feature",
  }
  const CAT_NAME: Record<GoalCategory, string> = {
    bootstrap: "Setup", data: "Data Layer", auth: "Auth", middleware: "Middleware",
    feature: "Feature", integration: "Integration", quality: "Quality", verification: "Tests", other: "Other",
  }
  const cats: GoalCategory[] = ["bootstrap", "data", "auth", "middleware", "feature", "integration", "quality", "verification", "other"]
  return cats.map((cat) => ({
    id: cat,
    name: CAT_NAME[cat],
    rank: CATEGORY_RANK[cat],
    depends_on: cat === "verification" ? [] : CATEGORY_DEPENDENCIES[cat],
    kind: CAT_KIND[cat],
    isVerification: cat === "verification",
    defaultRuleSelectors: (hasVerificationLayer: boolean) => {
      if (cat === "bootstrap" || cat === "quality") return ["build"]
      if (cat === "verification") return ["test", "lint"]
      return hasVerificationLayer ? ["build"] : ["build", "test"]
    },
  }))
}

function normalizeText(value: string) {
  return value.trim().toLowerCase()
}

function requirementSelectorMetadata(requirement: RequirementDraft) {
  const metadata =
    requirement.metadata && typeof requirement.metadata === "object" && !Array.isArray(requirement.metadata)
      ? requirement.metadata as Record<string, unknown>
      : undefined
  return Array.isArray(metadata?.check_selector)
    ? uniqueStrings(metadata.check_selector.filter((item): item is string => typeof item === "string" && item.trim().length > 0))
    : []
}

function sanitizeId(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return slug || "goal"
}

const VALID_GOAL_CATEGORIES = new Set<string>([
  "bootstrap", "data", "auth", "middleware", "feature", "integration", "quality", "verification", "other",
])

const CLASSIFY_CHUNK_SIZE = 10

function buildRequirementSnippet(req: RequirementDraft, index: number): string {
  const files = (req.evidence_refs ?? []).join(", ")
  const acceptance = (req.acceptance ?? []).join("; ")
  return [
    `[${index}] Title: "${req.title}"`,
    `    Description: ${req.description}`,
    files ? `    Files: ${files}` : "",
    acceptance ? `    Acceptance: ${acceptance}` : "",
  ].filter(Boolean).join("\n")
}

async function parseLLMLayerArray(
  text: string,
  validIds: Set<string>,
  expectedCount: number,
  context: string,
): Promise<string[]> {
  let parsed: unknown
  try {
    const jsonStart = text.indexOf("[")
    const jsonEnd = text.lastIndexOf("]")
    if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error("no JSON array found")
    parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1))
  } catch (cause) {
    throw new GoalFailureError(`Goal classifier (${context}) returned unparseable output: ${text}`, { cause })
  }
  if (!Array.isArray(parsed) || parsed.length !== expectedCount) {
    throw new GoalFailureError(
      `Goal classifier (${context}) returned ${Array.isArray(parsed) ? parsed.length : "non-array"} items for ${expectedCount} requirements`,
    )
  }
  return (parsed as unknown[]).map((raw, i) => {
    const value = String(raw).trim().toLowerCase()
    if (!validIds.has(value)) {
      throw new GoalFailureError(`Goal classifier (${context}) returned unknown id "${raw}" at index ${i}`)
    }
    return value
  })
}

/**
 * Classify requirements using the spec blueprint's architectural layers.
 * Each requirement is assigned to one layer_id from the blueprint.
 * The classification is chunked to avoid LLM count-drift on large inputs.
 */
async function classifyRequirementsWithLayers(
  requirements: RequirementDraft[],
  blueprint: ArchitecturalLayer[],
  input: Pick<GoalCompileInput, "sessionID" | "metadata">,
): Promise<string[]> {
  const validLayerIds = new Set(blueprint.map((l) => l.id))
  const layerList = blueprint.map((l) => `- ${l.id}: ${l.name} — ${l.description}`).join("\n")

  // Fast path: authoritative check_selector metadata — no LLM needed.
  // When a requirement already carries explicit selectors, the LLM classification
  // only affects clustering/ordering (default rule_selectors are overridden anyway).
  // Assigning a reasonable default avoids an unnecessary LLM round-trip.
  const verificationLayerId = blueprint.find((l) => isVerificationLayer(l.id, l.description))?.id
  const defaultLayerId = blueprint.find((l) => !isVerificationLayer(l.id, l.description))?.id ?? blueprint[0]?.id
  const fastPaths = requirements.map((req): string | null => {
    const selectors = requirementSelectorMetadata(req).map(normalizeText)
    if (selectors.length === 0) return null
    if (selectors.every((s) => s.includes("test")) && verificationLayerId) return verificationLayerId
    return defaultLayerId ?? null
  })

  const needsLLM = requirements.map((req, i) => ({ req, i })).filter((_, i) => fastPaths[i] === null)
  const result: string[] = fastPaths.map((p, i) => p ?? blueprint[blueprint.length - 1]!.id)

  if (needsLLM.length === 0) return result

  const { model, language } = await resolveHeadlessLanguageModel({
    label: "goal-classify",
    metadata: input.metadata,
    sessionID: input.sessionID,
  })

  for (let offset = 0; offset < needsLLM.length; offset += CLASSIFY_CHUNK_SIZE) {
    const chunk = needsLLM.slice(offset, offset + CLASSIFY_CHUNK_SIZE)
    const reqList = chunk.map(({ req }, j) => buildRequirementSnippet(req, j)).join("\n\n")
    const prompt = `Assign each requirement to exactly one architectural layer from this list:
${layerList}

Requirements:
${reqList}

Reply with a JSON array of layer IDs in the same order as the requirements.
Example: ["${blueprint[0]?.id ?? "layer_id"}", "${blueprint[1]?.id ?? "layer_id"}"]
Output ONLY the JSON array, no other text.`

    const { text } = await completeHeadlessText({
      label: "goal-classify",
      model,
      language,
      prompt,
      system: "You assign software requirements to architectural layers. Output only a JSON array of layer IDs.",
      tools: {},
      maxOutputTokens: 1024,
      sessionID: input.sessionID,
      timeoutMs: 120000,
    })

    const values = await parseLLMLayerArray(text, validLayerIds, chunk.length, `layer chunk ${offset / CLASSIFY_CHUNK_SIZE + 1}`)
    for (let j = 0; j < chunk.length; j++) {
      result[chunk[j]!.i] = values[j]!
    }
  }

  return result
}

/**
 * Classify requirements using the generic 9-category taxonomy.
 * Used when the spec provides no blueprint (simple single-feature tasks).
 * Chunked to prevent LLM count-drift on larger inputs.
 */
async function classifyRequirementsWithLLM(
  requirements: RequirementDraft[],
  input: Pick<GoalCompileInput, "sessionID" | "metadata">,
): Promise<GoalCategory[]> {
  // Fast path: authoritative check_selector metadata — no LLM needed.
  // When a requirement already carries explicit selectors, the LLM classification
  // only affects clustering/ordering (default rule_selectors are overridden anyway).
  // Assigning a reasonable default avoids an unnecessary LLM round-trip.
  const fastPaths = requirements.map((req): GoalCategory | null => {
    const selectors = requirementSelectorMetadata(req).map(normalizeText)
    if (selectors.length === 0) return null
    if (selectors.every((s) => s.includes("test"))) return "verification"
    if (selectors.every((s) => s.includes("build") || s.includes("lint") || s.includes("typecheck"))) return "quality"
    return "feature"
  })

  const needsLLM = requirements.map((req, i) => ({ req, i })).filter((_, i) => fastPaths[i] === null)
  const result: GoalCategory[] = fastPaths.map((cat) => cat ?? "feature")

  if (needsLLM.length === 0) return result

  const { model, language } = await resolveHeadlessLanguageModel({
    label: "goal-classify",
    metadata: input.metadata,
    sessionID: input.sessionID,
  })

  for (let offset = 0; offset < needsLLM.length; offset += CLASSIFY_CHUNK_SIZE) {
    const chunk = needsLLM.slice(offset, offset + CLASSIFY_CHUNK_SIZE)
    const reqList = chunk.map(({ req }, j) => buildRequirementSnippet(req, j)).join("\n\n")
    const prompt = `Classify each software requirement into exactly one category from this list:
- bootstrap: project setup, config files, dependency installation, build tooling initialization
- data: data models, database schema, migrations, ORM entities, repositories
- auth: authentication, authorization, sessions, identity, login/logout/register
- middleware: HTTP middleware, guards, interceptors, CORS, rate limiting
- feature: business logic, domain features, API endpoints, UI components (catch-all for domain work)
- integration: app wiring, routing configuration, entry points, module composition
- quality: type checking, linting, static analysis, code quality tooling
- verification: automated tests, test suites, E2E, acceptance checks
- other: doesn't fit any above

Requirements:
${reqList}

Reply with a JSON array of category names in the same order as the requirements.
Example: ["bootstrap", "feature", "verification"]
Output ONLY the JSON array, no other text.`

    const { text } = await completeHeadlessText({
      label: "goal-classify",
      model,
      language,
      prompt,
      system: "You classify software requirements into architectural categories. Output only a JSON array.",
      tools: {},
      maxOutputTokens: 1024,
      sessionID: input.sessionID,
      timeoutMs: 120000,
    })

    const values = await parseLLMLayerArray(text, VALID_GOAL_CATEGORIES, chunk.length, `category chunk ${offset / CLASSIFY_CHUNK_SIZE + 1}`)
    for (let j = 0; j < chunk.length; j++) {
      result[chunk[j]!.i] = values[j]! as GoalCategory
    }
  }

  return result
}

function goalIdForRequirement(requirement: RequirementDraft, index: number) {
  const stripped = requirement.id.trim().replace(/^req[_-]?/i, "")
  // Always append the positional index so that distinct requirements can never
  // produce the same goal id even if their ids normalize to the same slug.
  const source = stripped ? `${stripped}_${index}` : `requirement_${index + 1}`
  return `goal_${sanitizeId(source)}`
}

function extractOwnedPaths(requirement: RequirementDraft) {
  const knownFiles = new Set(["package.json", "tsconfig.json", "bunfig.toml"])
  const pathPattern = /(?:[a-zA-Z0-9._-]+\/)+[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+/g
  const tokens = [
    requirement.title,
    requirement.description,
    ...requirement.acceptance,
    ...requirement.evidence_refs,
  ]
  const paths = new Set<string>()
  for (const token of tokens) {
    for (const match of token.matchAll(pathPattern)) {
      paths.add(match[0]!)
    }
    for (const item of token.split(/[;,]/).map((part) => part.trim().replace(/^["'`]+|["'`]+$/g, ""))) {
      if (knownFiles.has(item)) paths.add(item)
    }
  }
  return [...paths]
}

function normalizeOwnedPath(value: string) {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\\/g, "/")
}

function isAmbientEvidencePath(value: string) {
  const normalized = normalizeOwnedPath(value).toLowerCase()
  return normalized === "package.json"
    || normalized === "tsconfig.json"
    || normalized === "bunfig.toml"
    || normalized === "bun.lock"
    || normalized === "package-lock.json"
    || normalized === "pnpm-lock.yaml"
    || normalized === "yarn.lock"
    || normalized === "readme.md"
    || normalized.endsWith("/readme.md")
}

function codeSurfacePaths(paths: string[]) {
  const normalized = uniqueStrings(paths.map(normalizeOwnedPath).filter(Boolean))
  if (normalized.length <= 1) return normalized
  const nonAmbient = normalized.filter((item) => !isAmbientEvidencePath(item))
  const codeLike = nonAmbient.filter((item) =>
    /^(src|app|lib|server|client|test|tests)\//i.test(item)
    || /\.(ts|tsx|js|jsx|mts|cts|css|scss|html|mdx|vue|svelte|py|go|rs|java|kt|swift|rb|php|cs|sql)$/i.test(item),
  )
  if (codeLike.length > 0) return codeLike
  if (nonAmbient.length > 0) return nonAmbient
  return normalized
}

function clusterSurfacePaths(layerDef: LayerDef, explicitOwnedPaths: string[]) {
  const explicit = codeSurfacePaths(explicitOwnedPaths)
  const fallback = codeSurfacePaths(defaultOwnedPaths(layerDef))
  if (explicit.length === 0) return fallback
  const fallbackRoots = fallback
    .filter((item) => item.endsWith("/"))
    .sort((a, b) => a.length - b.length)
  if (fallbackRoots.length > 0) {
    const matchingRoots = fallbackRoots.filter((root) =>
      explicit.every((item) => item === root || item.startsWith(root)),
    )
    if (matchingRoots.length > 0) return [matchingRoots[0]!]
  }
  return explicit
}

function clusterableCategory(layerDef: LayerDef) {
  return layerDef.kind === "feature" || layerDef.kind === "verification" || layerDef.kind === "system"
}

function clusterKeyForRecord(input: {
  layerDef: LayerDef
  goalID: string
  clusterOwnedPaths: string[]
}) {
  if (!clusterableCategory(input.layerDef) || input.clusterOwnedPaths.length === 0) return input.goalID
  return `${input.layerDef.id}\u0000${[...input.clusterOwnedPaths].sort().join("|")}`
}

function clusterTitle(input: {
  layerDef: LayerDef
  records: Array<{
    requirement: RequirementDraft
    explicitOwnedPaths: string[]
    clusterOwnedPaths: string[]
  }>
}) {
  if (input.records.length === 1) return input.records[0]!.requirement.title.trim()
  const explicitFiles = uniqueStrings(
    input.records.flatMap((record) =>
      record.explicitOwnedPaths.filter((item) => /\.[a-z0-9]+$/i.test(item)),
    ),
  )
  if (explicitFiles.length > 0) {
    const primaryFile = explicitFiles[0]!
    return `${path.basename(primaryFile, path.extname(primaryFile))} implementation`
  }
  const explicitPaths = uniqueStrings(input.records.flatMap((record) => record.clusterOwnedPaths))
  if (explicitPaths.length > 0) {
    const primary = explicitPaths[0]!
    return `${path.basename(primary, path.extname(primary))} implementation`
  }
  return input.records[0]!.requirement.title.trim()
}

function clusterObjective(input: {
  layerDef: LayerDef
  records: Array<{
    requirement: RequirementDraft
    clusterOwnedPaths: string[]
  }>
}) {
  if (input.records.length === 1) {
    return input.records[0]!.requirement.description.trim() || `Implement requirement ${input.records[0]!.requirement.id}`
  }
  const descriptions = input.records
    .map((record) => record.requirement.description.trim() || record.requirement.title.trim())
    .filter(Boolean)
  const explicitPaths = uniqueStrings(input.records.flatMap((record) => record.clusterOwnedPaths))
  const scope = explicitPaths.length > 0
    ? `the shared surface ${explicitPaths.join(", ")}`
    : `${input.layerDef.name} layer`
  return `Implement the grouped ${scope} contract: ${descriptions.join("; ")}`
}

function defaultOwnedPaths(layerDef: LayerDef) {
  if (layerDef.kind === "bootstrap") return ["package.json"]
  if (layerDef.isVerification) return ["tests/", "src/"]
  return ["src/"]
}

function metadataRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringsFromUnknown(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : [])
    : []
}

function normalizedTextKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function hintedGoalSeeds(goals: GoalContractDraftType[], hints: GoalInputType[], replanContext?: ReplanContext) {
  const bySourceGoalID = new Map(goals.map((goal) => [goal.id, goal.id]))
  const byRequirementID = new Map<string, string[]>()
  const byText = new Map<string, string[]>()

  for (const goal of goals) {
    for (const requirementID of goal.requirement_ids) {
      const list = byRequirementID.get(requirementID) ?? []
      list.push(goal.id)
      byRequirementID.set(requirementID, list)
    }
    for (const candidate of [goal.id, goal.title, goal.objective]) {
      const key = normalizedTextKey(candidate)
      if (!key) continue
      const list = byText.get(key) ?? []
      list.push(goal.id)
      byText.set(key, list)
    }
  }

  const seeds = new Set<string>()
  for (const hint of hints) {
    const metadata = metadataRecord(hint.metadata)
    const hintedSourceGoalID = typeof metadata?.source_goal_id === "string" ? metadata.source_goal_id.trim() : ""
    if (hintedSourceGoalID && bySourceGoalID.has(hintedSourceGoalID)) {
      seeds.add(hintedSourceGoalID)
      continue
    }
    const requirementIDs = uniqueStrings([
      ...stringsFromUnknown(hint.requirement_ids),
      ...stringsFromUnknown(metadata?.source_requirement_ids),
    ])
    for (const requirementID of requirementIDs) {
      for (const goalID of byRequirementID.get(requirementID) ?? []) seeds.add(goalID)
    }
    for (const candidate of [hint.title, hint.description, hint.objective]) {
      if (!candidate?.trim()) continue
      for (const goalID of byText.get(normalizedTextKey(candidate)) ?? []) seeds.add(goalID)
    }
  }

  if (seeds.size > 0) return seeds

  const unresolved = (replanContext?.previousGoalStatuses ?? [])
    .filter((goal) => goal.status !== "passed")
    .flatMap((goal) => [goal.description])
  for (const description of unresolved) {
    for (const goalID of byText.get(normalizedTextKey(description)) ?? []) seeds.add(goalID)
  }
  return seeds
}

function scopedGoalDraft(goalDraft: GoalDraft, input: GoalCompileInput): GoalDraft {
  if (!input.replanContext) return goalDraft
  const hints = Array.isArray(input.goalHints) ? input.goalHints : []
  if (hints.length === 0) {
    log.warn("goal recompile has replanContext but no goal hints, running all goals")
    return goalDraft
  }

  const seeds = hintedGoalSeeds(goalDraft.goals, hints, input.replanContext)
  if (seeds.size === 0) {
    // Text-based matching failed. Fall back to requirement_ids: skip goals whose
    // requirements were ALL covered by passed goals in the previous run.
    const passedRequirementIDs = new Set(
      (input.replanContext.previousGoalStatuses ?? [])
        .filter((g) => g.status === "passed" && Array.isArray(g.requirement_ids))
        .flatMap((g) => g.requirement_ids!),
    )
    if (passedRequirementIDs.size > 0) {
      const unresolvedGoals = goalDraft.goals.filter((goal) =>
        !goal.requirement_ids.every((id) => passedRequirementIDs.has(id)),
      )
      if (unresolvedGoals.length > 0 && unresolvedGoals.length < goalDraft.goals.length) {
        log.info("goal recompile scoped by requirement_ids", {
          passedReqs: passedRequirementIDs.size,
          totalGoals: goalDraft.goals.length,
          scopedGoals: unresolvedGoals.length,
        })
        const includedIDs = new Set(unresolvedGoals.map((g) => g.id))
        const scoped = {
          summary: `${unresolvedGoals.length} scoped goals (${goalDraft.goals.length - unresolvedGoals.length} skipped — requirements already passed)`,
          goals: unresolvedGoals.map((goal) => ({
            ...goal,
            depends_on_goal_ids: goal.depends_on_goal_ids.filter((id) => includedIDs.has(id)),
          })),
        } satisfies GoalDraft
        const requiredRequirementIDs = new Set(unresolvedGoals.flatMap((g) => g.requirement_ids))
        validateGoalGraph(scoped, input.spec, { requiredRequirementIDs })
        return scoped
      }
    }
    log.warn("goal recompile could not resolve unresolved scope from previous plan, running all goals", {
      hintCount: hints.length,
      newGoalCount: goalDraft.goals.length,
      passedReqs: passedRequirementIDs.size,
    })
    return goalDraft
  }
  if (seeds.size >= goalDraft.goals.length) return goalDraft

  const downstream = new Map<string, string[]>()
  for (const goal of goalDraft.goals) {
    for (const dependencyID of goal.depends_on_goal_ids) {
      const list = downstream.get(dependencyID) ?? []
      list.push(goal.id)
      downstream.set(dependencyID, list)
    }
  }

  const included = new Set<string>()
  const queue = [...seeds]
  while (queue.length > 0) {
    const next = queue.shift()!
    if (included.has(next)) continue
    included.add(next)
    for (const goalID of downstream.get(next) ?? []) queue.push(goalID)
  }

  const goals = goalDraft.goals
    .filter((goal) => included.has(goal.id))
    .map((goal) => ({
      ...goal,
      depends_on_goal_ids: goal.depends_on_goal_ids.filter((dependencyID) => included.has(dependencyID)),
    }))
  const requiredRequirementIDs = new Set(goals.flatMap((goal) => goal.requirement_ids))
  const scoped = {
    summary: `${goals.length} scoped goals recompiled from ${requiredRequirementIDs.size} requirements`,
    goals,
  } satisfies GoalDraft
  validateGoalGraph(scoped, input.spec, { requiredRequirementIDs })
  return scoped
}

function explicitRuleSelectors(requirement: RequirementDraft) {
  return requirementSelectorMetadata(requirement)
}

async function compile(input: GoalCompileInput): Promise<GoalDraft> {
  const requirements = Array.isArray(input.spec.requirements) ? input.spec.requirements : []
  if (requirements.length < 1) throw new GoalFailureError("Goal decomposition requires at least one formulated requirement")

  // Spec blueprint (≥2 layers) is authoritative; fall back to generic taxonomy.
  const blueprint = Array.isArray(input.spec.architectural_layers) && input.spec.architectural_layers.length >= 2
    ? input.spec.architectural_layers
    : undefined
  const layers = blueprint ? layersFromBlueprint(blueprint) : layersFromCategories()
  const layerDefMap = new Map(layers.map((l) => [l.id, l]))
  const fallbackLayer = layers[layers.length - 1]!

  await input.onStatus?.(`Goal compiler classifying ${requirements.length} requirements`)
  const layerIds = blueprint
    ? await classifyRequirementsWithLayers(requirements, blueprint, input)
    : await classifyRequirementsWithLLM(requirements, input)

  await input.onStatus?.(`Goal compiler mapping ${requirements.length} requirements`)

  const records = requirements.map((requirement, index) => {
    const layerDef = layerDefMap.get(layerIds[index]!) ?? fallbackLayer
    const explicitOwnedPaths = uniqueStrings(extractOwnedPaths(requirement))
    return {
      requirement,
      index,
      layerDef,
      goalID: goalIdForRequirement(requirement, index),
      explicitOwnedPaths,
      clusterOwnedPaths: clusterSurfacePaths(layerDef, explicitOwnedPaths),
    }
  })
  const ordered = [...records].sort((a, b) => a.layerDef.rank - b.layerDef.rank || a.index - b.index)
  const clusters = [] as Array<{
    id: string
    layerDef: LayerDef
    records: typeof ordered
  }>
  const clusterIndexByKey = new Map<string, number>()
  for (const item of ordered) {
    const key = clusterKeyForRecord(item)
    const index = clusterIndexByKey.get(key)
    if (index === undefined) {
      clusterIndexByKey.set(key, clusters.length)
      clusters.push({
        id: item.goalID,
        layerDef: item.layerDef,
        records: [item],
      })
      continue
    }
    clusters[index]!.records.push(item)
  }
  // Split oversized clusters: when a single cluster has >3 requirements,
  // each requirement becomes its own goal to maintain granularity.
  const MAX_REQUIREMENTS_PER_GOAL = 3
  const expanded: typeof clusters = []
  for (const cluster of clusters) {
    if (cluster.records.length <= MAX_REQUIREMENTS_PER_GOAL) {
      expanded.push(cluster)
    } else {
      for (const record of cluster.records) {
        expanded.push({
          id: record.goalID,
          layerDef: cluster.layerDef,
          records: [record],
        })
      }
    }
  }
  clusters.length = 0
  clusters.push(...expanded)

  const byLayerId = new Map<string, string[]>()
  for (const cluster of clusters) {
    const list = byLayerId.get(cluster.layerDef.id) ?? []
    list.push(cluster.id)
    byLayerId.set(cluster.layerDef.id, list)
  }
  const blockingNonVerification = clusters
    .filter((cluster) =>
      !cluster.layerDef.isVerification
      && cluster.records.some((item) => (item.requirement.priority ?? "blocking") === "blocking")
    )
    .map((cluster) => cluster.id)
  const hasVerificationCluster = clusters.some((cluster) => cluster.layerDef.isVerification)

  const priorByLayerId = new Map<string, string>()
  const goals = clusters.map((cluster) => {
    const { layerDef } = cluster
    const dependencies = new Set<string>()
    if (layerDef.isVerification) {
      for (const dependencyID of blockingNonVerification) {
        if (dependencyID !== cluster.id) dependencies.add(dependencyID)
      }
    } else {
      for (const dependsOnId of layerDef.depends_on) {
        for (const dependencyID of byLayerId.get(dependsOnId) ?? []) {
          if (dependencyID !== cluster.id) dependencies.add(dependencyID)
        }
      }
    }
    const previousSameLayer = priorByLayerId.get(layerDef.id)
    if (previousSameLayer && previousSameLayer !== cluster.id) {
      dependencies.add(previousSameLayer)
    }
    priorByLayerId.set(layerDef.id, cluster.id)

    const ownedPaths = uniqueStrings([
      ...cluster.records.flatMap((item) => item.explicitOwnedPaths),
      ...defaultOwnedPaths(layerDef),
    ])
    const acceptance = uniqueStrings(cluster.records.flatMap((item) => item.requirement.acceptance.map((value) => value.trim()).filter(Boolean)))
    const selectors = uniqueStrings(cluster.records.flatMap((item) => explicitRuleSelectors(item.requirement)))
    const requirementIDs = cluster.records.map((item) => item.requirement.id)
    const priority = cluster.records.some((item) => (item.requirement.priority ?? "blocking") === "blocking") ? "blocking" as const : "advisory" as const
    const title = clusterTitle(cluster)
    const objective = clusterObjective(cluster)
    // acceptance is guaranteed non-empty: RequirementSchema enforces .min(1)
    // and spec normalization always falls back to [description].
    const doneDefinition = acceptance.join("; ")

    return normalizedGoal({
      id: cluster.id,
      title,
      objective,
      requirement_ids: requirementIDs,
      depends_on_goal_ids: [...dependencies],
      owned_paths: ownedPaths,
      done_definition: doneDefinition,
      qa_profile: {
        rule_selectors: selectors.length > 0 ? selectors : layerDef.defaultRuleSelectors(hasVerificationCluster),
        goal_check_prompt: `Verify requirements ${requirementIDs.join(", ")} (${cluster.records.map((item) => item.requirement.title.trim()).join("; ")}) are fully satisfied.`,
        spec_scope: "mapped_requirements",
      },
      priority,
      kind: layerDef.kind,
    })
  })

  const draft = {
    summary: `${goals.length} deterministic goals compiled from ${requirements.length} requirements`,
    goals,
  } satisfies GoalDraft
  validateGoalGraph(draft, input.spec)
  log.info("goal compiler produced deterministic goal graph", {
    requirements: requirements.length,
    goals: goals.length,
    blueprint: blueprint ? "spec-blueprint" : "generic-taxonomy",
  })
  return draft
}

async function run(input: GoalCompileInput) {
  try {
    const goalDraft = await compile(input)
    return scopedGoalDraft(goalDraft, input)
  } catch (error) {
    if (error instanceof GoalFailureError) throw error
    throw new GoalFailureError("goal stage failed", { cause: error })
  }
}

export function goalInputsFromDraft(goalDraft: GoalDraft): GoalInputType[] {
  return goalDraft.goals.map((goal) => ({
    description: goal.title,
    criteria: `Objective: ${goal.objective}\nDone definition: ${goal.done_definition}`,
    priority: goal.priority,
    source: "spec",
    title: goal.title,
    objective: goal.objective,
    requirement_ids: goal.requirement_ids,
    depends_on_goal_ids: goal.depends_on_goal_ids,
    owned_paths: goal.owned_paths,
    done_definition: goal.done_definition,
    qa_profile: GoalQaProfile.parse({
      rule_selectors: goal.qa_profile.rule_selectors,
      goal_check_prompt: goal.qa_profile.goal_check_prompt,
      spec_scope: "mapped_requirements",
    }),
    kind: goal.kind,
    metadata: {
      title: goal.title,
      objective: goal.objective,
      requirement_ids: goal.requirement_ids,
      depends_on_goal_ids: goal.depends_on_goal_ids,
      owned_paths: goal.owned_paths,
      done_definition: goal.done_definition,
      qa_profile: {
        rule_selectors: goal.qa_profile.rule_selectors,
        ...(goal.qa_profile.goal_check_prompt ? { goal_check_prompt: goal.qa_profile.goal_check_prompt } : {}),
        spec_scope: "mapped_requirements",
      },
      kind: goal.kind,
      check_selector: goal.qa_profile.rule_selectors,
      source_goal_id: goal.id,
    },
  }))
}

export namespace HeadlessGoalService {
  export async function initial(input: GoalCompileInput) {
    return run(input)
  }

  export async function recompile(input: GoalCompileInput) {
    return run(input)
  }
}

export { HeadlessGoalService as GoalService }
