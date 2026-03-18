import z from "zod"
import { type TextHooks } from "@/llm/api"
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

function validateGoalGraph(goalDraft: GoalDraft, spec: SpecDraft) {
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
      .filter((item) => (item.priority ?? "blocking") === "blocking")
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
      /(all|everything|entire|full app|whole system|project setup|bootstrap|infrastructure|foundation|base project|全量|全部|整体|基础设施|项目初始化|脚手架)/.test(text)
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
  | "setup"
  | "database"
  | "auth"
  | "middleware"
  | "diary"
  | "tag"
  | "timeline"
  | "integration"
  | "quality"
  | "verification"
  | "other"

type RequirementDraft = NonNullable<SpecDraft["requirements"]>[number]

const CATEGORY_RANK: Record<GoalCategory, number> = {
  setup: 10,
  database: 20,
  auth: 30,
  middleware: 40,
  tag: 50,
  diary: 60,
  timeline: 70,
  integration: 80,
  quality: 90,
  verification: 100,
  other: 110,
}

const CATEGORY_DEPENDENCIES: Record<Exclude<GoalCategory, "verification">, GoalCategory[]> = {
  setup: [],
  database: ["setup"],
  auth: ["setup", "database"],
  middleware: ["auth"],
  tag: ["database"],
  diary: ["database", "auth", "tag"],
  timeline: ["database", "auth", "diary", "tag"],
  integration: ["setup", "database", "auth", "middleware", "tag", "diary", "timeline"],
  quality: ["setup", "database", "auth", "middleware", "tag", "diary", "timeline", "integration"],
  other: ["setup", "database"],
}

function normalizeText(value: string) {
  return value.trim().toLowerCase()
}

function sanitizeId(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return slug || "goal"
}

function classifyRequirement(requirement: RequirementDraft): GoalCategory {
  const title = normalizeText(requirement.title)
  const body = normalizeText([
    requirement.title,
    requirement.description,
    ...(requirement.acceptance ?? []),
    ...(requirement.evidence_refs ?? []),
  ].join("\n"))

  if (/(test suite|tests?|verification|验收|测试|校验|验证)/.test(title)) return "verification"
  if (/(type safety|error handling|类型安全|错误处理)/.test(title)) return "quality"
  if (/(app entry|route organization|application entry|入口|路由组织)/.test(title)) return "integration"
  if (/(timeline|时间轴|筛选)/.test(title)) return "timeline"
  if (/(middleware|bearer token|auth middleware|中间件)/.test(title)) return "middleware"
  if (/(tag|标签)/.test(title)) return "tag"
  if (/(crud|diary|日记)/.test(title)) return "diary"
  if (/(auth|register|login|jwt|token|认证|注册|登录)/.test(title)) return "auth"
  if (/(schema|sqlite|database|migration|db\b|数据库|表结构)/.test(title)) return "database"
  if (/(setup|dependencies|project|config|配置|初始化|依赖)/.test(title)) return "setup"

  if (/(timeline|时间轴|筛选)/.test(body)) return "timeline"
  if (/(middleware|bearer token|中间件)/.test(body)) return "middleware"
  if (/(auth|register|login|jwt|token|认证|注册|登录)/.test(body)) return "auth"
  if (/(tag|标签)/.test(body) && !/(diary crud|日记 crud)/.test(body)) return "tag"
  if (/(schema|sqlite|database|migration|数据库|表结构)/.test(body)) return "database"
  if (/(project setup|dependencies|bun install|typecheck|项目配置|依赖)/.test(body)) return "setup"
  if (/(diary|日记)/.test(body)) return "diary"
  return "other"
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

function defaultOwnedPaths(category: GoalCategory) {
  switch (category) {
    case "setup":
      return ["package.json", "tsconfig.json"]
    case "database":
      return ["src/db/schema.ts", "src/db/index.ts"]
    case "auth":
      return ["src/routes/auth.ts", "src/services/auth.ts"]
    case "middleware":
      return ["src/middleware/auth.ts"]
    case "tag":
      return ["src/services/tag.ts"]
    case "diary":
      return ["src/routes/diaries.ts", "src/services/diary.ts"]
    case "timeline":
      return ["src/routes/timeline.ts", "src/services/diary.ts"]
    case "integration":
      return ["src/index.ts"]
    case "quality":
      return ["src/types/index.ts", "src/index.ts"]
    case "verification":
      return ["tests/", "src/"]
    default:
      return ["src/"]
  }
}

function goalKindForCategory(category: GoalCategory): z.infer<typeof GoalKind> {
  switch (category) {
    case "setup":
    case "database":
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

function ruleSelectorsForCategory(category: GoalCategory) {
  switch (category) {
    case "setup":
      return ["build"]
    case "verification":
      return ["test"]
    default:
      return ["build", "test"]
  }
}

async function compile(input: GoalCompileInput): Promise<GoalDraft> {
  const requirements = Array.isArray(input.spec.requirements) ? input.spec.requirements : []
  if (requirements.length < 1) throw new GoalFailureError("Goal decomposition requires at least one formulated requirement")

  await input.onStatus?.(`Goal compiler mapping ${requirements.length} requirements`)

  const records = requirements.map((requirement, index) => ({
    requirement,
    index,
    category: classifyRequirement(requirement),
    goalID: goalIdForRequirement(requirement, index),
  }))
  const ordered = [...records].sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] || a.index - b.index)
  const byCategory = new Map<GoalCategory, string[]>()
  for (const item of ordered) {
    const list = byCategory.get(item.category) ?? []
    list.push(item.goalID)
    byCategory.set(item.category, list)
  }
  const blockingNonVerification = ordered
    .filter((item) => (item.requirement.priority ?? "blocking") === "blocking" && item.category !== "verification")
    .map((item) => item.goalID)

  const priorByCategory = new Map<GoalCategory, string>()
  const goals = ordered.map(({ requirement, category, goalID }) => {
    const dependencies = new Set<string>()
    if (category === "verification") {
      for (const dependencyID of blockingNonVerification) {
        if (dependencyID !== goalID) dependencies.add(dependencyID)
      }
    } else {
      for (const dependencyCategory of CATEGORY_DEPENDENCIES[category]) {
        for (const dependencyID of byCategory.get(dependencyCategory) ?? []) {
          if (dependencyID !== goalID) dependencies.add(dependencyID)
        }
      }
    }
    const previousSameCategory = priorByCategory.get(category)
    if (previousSameCategory && previousSameCategory !== goalID) {
      dependencies.add(previousSameCategory)
    }
    priorByCategory.set(category, goalID)

    const ownedPaths = uniqueStrings([
      ...extractOwnedPaths(requirement),
      ...defaultOwnedPaths(category),
    ])
    const acceptance = requirement.acceptance.map((item) => item.trim()).filter(Boolean)

    return normalizedGoal({
      id: goalID,
      title: requirement.title.trim(),
      objective: requirement.description.trim() || `Implement requirement ${requirement.id}`,
      requirement_ids: [requirement.id],
      depends_on_goal_ids: [...dependencies],
      owned_paths: ownedPaths,
      done_definition: acceptance.join("; "),
      qa_profile: {
        rule_selectors: ruleSelectorsForCategory(category),
        goal_check_prompt: `Verify requirement ${requirement.id} (${requirement.title.trim()}) is fully satisfied.`,
        spec_scope: "mapped_requirements",
      },
      priority: requirement.priority ?? "blocking",
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
    return await compile(input)
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
