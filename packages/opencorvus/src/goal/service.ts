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
import { type SpecDraft } from "@/spec/agent"
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

const CATEGORY_RANK: Record<GoalCategory, number> = {
  bootstrap: 10,
  data: 20,
  auth: 30,
  middleware: 40,
  feature: 50,
  integration: 70,
  quality: 80,
  verification: 90,
  other: 100,
}

const CATEGORY_DEPENDENCIES: Record<Exclude<GoalCategory, "verification">, GoalCategory[]> = {
  bootstrap: [],
  data: ["bootstrap"],
  auth: ["bootstrap", "data"],
  middleware: ["auth"],
  feature: ["data", "auth", "middleware"],
  integration: ["bootstrap", "data", "auth", "middleware", "feature"],
  quality: ["bootstrap"],
  other: ["bootstrap", "data"],
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

async function classifyRequirementsWithLLM(
  requirements: RequirementDraft[],
  input: Pick<GoalCompileInput, "sessionID" | "metadata">,
): Promise<GoalCategory[]> {
  // Fast path: authoritative check_selector metadata — no LLM needed
  const fastPaths = requirements.map((req): GoalCategory | null => {
    const selectors = requirementSelectorMetadata(req).map(normalizeText)
    if (selectors.length === 0) return null
    if (selectors.every((s) => s.includes("test"))) return "verification"
    if (selectors.every((s) => s.includes("build") || s.includes("lint") || s.includes("typecheck"))) return "quality"
    return null
  })

  const needsLLM = requirements
    .map((req, i) => ({ req, i }))
    .filter((_, i) => fastPaths[i] === null)

  const result: GoalCategory[] = fastPaths.map((cat) => cat ?? "feature")

  if (needsLLM.length === 0) return result

  const { model, language } = await resolveHeadlessLanguageModel({
    label: "goal-classify",
    metadata: input.metadata,
    sessionID: input.sessionID,
  })

  const reqList = needsLLM
    .map(({ req }, i) => {
      const files = (req.evidence_refs ?? []).join(", ")
      const acceptance = (req.acceptance ?? []).join("; ")
      return [
        `[${i}] Title: "${req.title}"`,
        `    Description: ${req.description}`,
        files ? `    Files: ${files}` : "",
        acceptance ? `    Acceptance: ${acceptance}` : "",
      ].filter(Boolean).join("\n")
    })
    .join("\n\n")

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
    maxOutputTokens: 300,
    sessionID: input.sessionID,
    timeoutMs: 30000,
  })

  let parsed: unknown
  try {
    const jsonStart = text.indexOf("[")
    const jsonEnd = text.lastIndexOf("]")
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      throw new Error("no JSON array found in output")
    }
    parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1))
  } catch (cause) {
    throw new GoalFailureError(`Goal classifier returned unparseable output: ${text}`, { cause })
  }

  if (!Array.isArray(parsed) || parsed.length !== needsLLM.length) {
    throw new GoalFailureError(
      `Goal classifier returned ${Array.isArray(parsed) ? parsed.length : "non-array"} categories for ${needsLLM.length} requirements`,
    )
  }

  for (let i = 0; i < needsLLM.length; i++) {
    const raw = String(parsed[i]).trim().toLowerCase()
    if (!VALID_GOAL_CATEGORIES.has(raw)) {
      throw new GoalFailureError(`Goal classifier returned unknown category "${parsed[i]}" for requirement "${needsLLM[i]!.req.title}"`)
    }
    result[needsLLM[i]!.i] = raw as GoalCategory
  }

  return result
}

function goalIdForRequirement(requirement: RequirementDraft, index: number) {
  const source = requirement.id.trim().replace(/^req[_-]?/i, "") || `requirement_${index + 1}`
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

function clusterSurfacePaths(category: GoalCategory, explicitOwnedPaths: string[]) {
  const explicit = codeSurfacePaths(explicitOwnedPaths)
  const fallback = codeSurfacePaths(defaultOwnedPaths(category))
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

function clusterableCategory(category: GoalCategory) {
  return category === "other" || category === "quality" || category === "verification" || category === "feature"
}

function clusterKeyForRecord(input: {
  category: GoalCategory
  goalID: string
  clusterOwnedPaths: string[]
}) {
  if (!clusterableCategory(input.category) || input.clusterOwnedPaths.length === 0) return input.goalID
  return `${input.category}\u0000${[...input.clusterOwnedPaths].sort().join("|")}`
}

function clusterTitle(input: {
  category: GoalCategory
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
  category: GoalCategory
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
    : `${input.category} requirements`
  return `Implement the grouped contract for ${scope}: ${descriptions.join("; ")}`
}

function defaultOwnedPaths(category: GoalCategory) {
  switch (category) {
    case "bootstrap":
      return ["package.json"]
    case "integration":
      return ["src/"]
    case "quality":
      return ["src/"]
    case "verification":
      return ["tests/", "src/"]
    default:
      return ["src/"]
  }
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
    throw new GoalFailureError("Goal recompile requires unresolved goal scope from the previous plan")
  }

  const seeds = hintedGoalSeeds(goalDraft.goals, hints, input.replanContext)
  if (seeds.size === 0) {
    throw new GoalFailureError("Goal recompile could not resolve the unresolved goal scope")
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

function goalKindForCategory(category: GoalCategory): z.infer<typeof GoalKind> {
  switch (category) {
    case "bootstrap":
    case "data":
      return "bootstrap"
    case "middleware":
    case "integration":
      return "integration"
    case "verification":
      return "verification"
    case "quality":
      return "system"
    default:
      return "feature"
  }
}

function ruleSelectorsForCategory(
  category: GoalCategory,
  options?: {
    hasVerificationCluster?: boolean
  },
) {
  if (category === "bootstrap" || category === "quality") return ["build"]
  if (category === "verification") return ["test"]
  return options?.hasVerificationCluster ? ["build"] : ["build", "test"]
}

function explicitRuleSelectors(requirement: RequirementDraft) {
  return requirementSelectorMetadata(requirement)
}

async function compile(input: GoalCompileInput): Promise<GoalDraft> {
  const requirements = Array.isArray(input.spec.requirements) ? input.spec.requirements : []
  if (requirements.length < 1) throw new GoalFailureError("Goal decomposition requires at least one formulated requirement")

  await input.onStatus?.(`Goal compiler classifying ${requirements.length} requirements`)
  const categories = await classifyRequirementsWithLLM(requirements, input)

  await input.onStatus?.(`Goal compiler mapping ${requirements.length} requirements`)

  const records = requirements.map((requirement, index) => {
    const category = categories[index]!
    const explicitOwnedPaths = uniqueStrings(extractOwnedPaths(requirement))
    return {
      requirement,
      index,
      category,
      goalID: goalIdForRequirement(requirement, index),
      explicitOwnedPaths,
      clusterOwnedPaths: clusterSurfacePaths(category, explicitOwnedPaths),
    }
  })
  const ordered = [...records].sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] || a.index - b.index)
  const clusters = [] as Array<{
    id: string
    category: GoalCategory
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
        category: item.category,
        records: [item],
      })
      continue
    }
    clusters[index]!.records.push(item)
  }
  const byCategory = new Map<GoalCategory, string[]>()
  for (const cluster of clusters) {
    const list = byCategory.get(cluster.category) ?? []
    list.push(cluster.id)
    byCategory.set(cluster.category, list)
  }
  const blockingNonVerification = clusters
    .filter((cluster) =>
      cluster.category !== "verification"
      && cluster.records.some((item) => (item.requirement.priority ?? "blocking") === "blocking")
    )
    .map((cluster) => cluster.id)
  const hasVerificationCluster = clusters.some((cluster) => cluster.category === "verification")

  const priorByCategory = new Map<GoalCategory, string>()
  const goals = clusters.map((cluster) => {
    const { category } = cluster
    const dependencies = new Set<string>()
    if (category === "verification") {
      for (const dependencyID of blockingNonVerification) {
        if (dependencyID !== cluster.id) dependencies.add(dependencyID)
      }
    } else {
      for (const dependencyCategory of CATEGORY_DEPENDENCIES[category]) {
        for (const dependencyID of byCategory.get(dependencyCategory) ?? []) {
          if (dependencyID !== cluster.id) dependencies.add(dependencyID)
        }
      }
    }
    const previousSameCategory = priorByCategory.get(category)
    if (previousSameCategory && previousSameCategory !== cluster.id) {
      dependencies.add(previousSameCategory)
    }
    priorByCategory.set(category, cluster.id)

    const ownedPaths = uniqueStrings([
      ...cluster.records.flatMap((item) => item.explicitOwnedPaths),
      ...defaultOwnedPaths(category),
    ])
    const acceptance = uniqueStrings(cluster.records.flatMap((item) => item.requirement.acceptance.map((value) => value.trim()).filter(Boolean)))
    const selectors = uniqueStrings(cluster.records.flatMap((item) => explicitRuleSelectors(item.requirement)))
    const primary = cluster.records[0]!
    const requirementIDs = cluster.records.map((item) => item.requirement.id)
    const priority = cluster.records.some((item) => (item.requirement.priority ?? "blocking") === "blocking") ? "blocking" as const : "advisory" as const
    const title = clusterTitle(cluster)
    const objective = clusterObjective(cluster)

    return normalizedGoal({
      id: cluster.id,
      title,
      objective,
      requirement_ids: requirementIDs,
      depends_on_goal_ids: [...dependencies],
      owned_paths: ownedPaths,
      done_definition: acceptance.join("; "),
      qa_profile: {
        rule_selectors: selectors.length > 0 ? selectors : ruleSelectorsForCategory(category, { hasVerificationCluster }),
        goal_check_prompt: `Verify requirements ${requirementIDs.join(", ")} (${cluster.records.map((item) => item.requirement.title.trim()).join("; ")}) are fully satisfied.`,
        spec_scope: "mapped_requirements",
      },
      priority,
      kind: goalKindForCategory(category),
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
