import { ExecutorRegistry } from "@/executor/registry"
import type { ExecutorNameInfo } from "@/executor/compat"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { PlannerOutput, parsePlannerOutput, type PlannerOutputType, type ReplanContext } from "./agent"
import { SpecDraftSchema, type SpecDraft } from "@/spec/agent"
import { parseSpecText } from "@/spec/parse-spec-text"

const log = Log.create({ service: "planner.executor" })

export namespace ExecutorPlanner {
  export function supports(executor: ExecutorNameInfo, stage: "spec" | "plan") {
    const adapter = ExecutorRegistry.require(executor)
    const capabilities = adapter.planningCapabilities?.()
    if (!capabilities) return false
    return capabilities[stage]
  }

  export async function spec(input: {
    executor: ExecutorNameInfo
    title: string
    request: string
    goals?: Array<{ description: string; criteria: string; priority?: "blocking" | "advisory" }>
    replanContext?: ReplanContext
    signal?: AbortSignal
  }): Promise<SpecDraft> {
    const adapter = ExecutorRegistry.require(input.executor)
    if (!adapter.generatePlanning || !supports(input.executor, "spec")) {
      throw new Error(`executor ${input.executor} does not support spec generation`)
    }
    log.warn("executor-native spec generation relies on prompt-level write prohibition", {
      executor: input.executor,
      stage: "spec",
    })
    const result = await adapter.generatePlanning({
      stage: "spec",
      cwd: workdir(),
      maxTurns: 4,
      system: SPEC_SYSTEM,
      prompt: specPrompt(input),
      signal: input.signal,
    })
    // Parse section tags from executor output, then validate with Zod
    const parsed = parseSpecText(result.output)
    return SpecDraftSchema.parse(parsed)
  }

  export async function plan(input: {
    executor: ExecutorNameInfo
    title: string
    request: string
    spec: SpecDraft
    goals?: Array<{ description: string; criteria: string; priority?: "blocking" | "advisory" }>
    replanContext?: ReplanContext
    signal?: AbortSignal
  }): Promise<PlannerOutputType> {
    const adapter = ExecutorRegistry.require(input.executor)
    if (!adapter.generatePlanning || !supports(input.executor, "plan")) {
      throw new Error(`executor ${input.executor} does not support plan generation`)
    }
    log.warn("executor-native plan generation relies on prompt-level write prohibition", {
      executor: input.executor,
      stage: "plan",
    })
    const result = await adapter.generatePlanning({
      stage: "plan",
      cwd: workdir(),
      maxTurns: 4,
      system: PLAN_SYSTEM,
      prompt: planPrompt(input),
      signal: input.signal,
    })
    // Parse section tags from executor output, then validate with Zod
    return PlannerOutput.parse(parsePlannerOutput(result.output))
  }
}

function specPrompt(input: {
  title: string
  request: string
  goals?: Array<{ description: string; criteria: string; priority?: "blocking" | "advisory" }>
  replanContext?: ReplanContext
}) {
  return [
    `Working directory: ${workdir()}`,
    `Title: ${input.title}`,
    `Request:\n${input.request}`,
    PLANNING_WARNING_PROMPT,
    input.goals?.length
      ? `Existing goals:\n${input.goals.map((item, index) => `${index + 1}. [${item.priority ?? "blocking"}] ${item.description}\nCriteria: ${item.criteria}`).join("\n\n")}`
      : "",
    input.replanContext
      ? [
          "Replan context:",
          `Previous summary: ${input.replanContext.previousSummary}`,
          `Failure summary: ${input.replanContext.failureAnalysis.summary}`,
          `Root cause: ${input.replanContext.failureAnalysis.rootCause}`,
          input.replanContext.failureAnalysis.avoidApproaches.length > 0
            ? `Avoid: ${input.replanContext.failureAnalysis.avoidApproaches.join("; ")}`
            : "",
        ].filter(Boolean).join("\n")
      : "",
    "Output your specification using <tag>...</tag> section format as described in the system prompt.",
  ].filter(Boolean).join("\n\n")
}

function planPrompt(input: {
  title: string
  request: string
  spec: SpecDraft
  goals?: Array<{ description: string; criteria: string; priority?: "blocking" | "advisory" }>
  replanContext?: ReplanContext
}) {
  return [
    `Working directory: ${workdir()}`,
    `Title: ${input.title}`,
    `Original request:\n${input.request}`,
    PLANNING_WARNING_PROMPT,
    `Authoritative specification:\n${input.spec.content}`,
    input.goals?.length
      ? `Operator goals:\n${input.goals.map((item, index) => `${index + 1}. [${item.priority ?? "blocking"}] ${item.description}\nCriteria: ${item.criteria}`).join("\n\n")}`
      : "",
    input.replanContext
      ? [
          "Replan context:",
          `Previous summary: ${input.replanContext.previousSummary}`,
          `Failure classification: ${input.replanContext.failureAnalysis.classification}`,
          `Failure summary: ${input.replanContext.failureAnalysis.summary}`,
          `Suggested strategy: ${input.replanContext.failureAnalysis.suggestedStrategy}`,
          input.replanContext.failureAnalysis.avoidApproaches.length > 0
            ? `Avoid: ${input.replanContext.failureAnalysis.avoidApproaches.join("; ")}`
            : "",
        ].filter(Boolean).join("\n")
      : "",
    "Output your plan using <tag>...</tag> section format as described in the system prompt.",
  ].filter(Boolean).join("\n\n")
}

const SPEC_SYSTEM = [
  "You are the executor-native spec stage for OpenCorvus.",
  "WARNING: This is a planning-only read-only session.",
  "You may inspect the codebase and documentation, but you must not modify files, apply patches, or run commands with side effects.",
  "Expand the task into a precise markdown specification.",
  "Output using section tags: <summary>, <scope>, <content>, <spec_items>, <assumptions>, <risks>, <evidence>, <unresolved>.",
  "Each section wrapped in <tag>content</tag>. List items use: - key: value format.",
].join("\n")

const PLAN_SYSTEM = [
  "You are the executor-native planning stage for OpenCorvus.",
  "WARNING: This is a planning-only read-only session.",
  "You may inspect the codebase and documentation, but you must not modify files, apply patches, or run commands with side effects.",
  "Produce a detailed implementation plan.",
  "Output using section tags: <summary>, <prd>, <goals>, <subtasks>, <risks>, <milestones>, <assumptions>.",
  "Each section wrapped in <tag>content</tag>. List items use: - key: value format.",
  "Every blocking goal must have concrete criteria and at least one relevant check_selector.",
].join("\n")

const PLANNING_WARNING_PROMPT = [
  "Planning safety rules:",
  "- Inspect only. Do not modify files, apply patches, or present code changes as already completed.",
  "- Do not run commands with side effects or operations that could change external state.",
  "- If a tool could write, patch, or mutate state, do not use it in this stage.",
].join("\n")

function workdir() {
  try {
    return Instance.directory
  } catch {
    return process.cwd()
  }
}
