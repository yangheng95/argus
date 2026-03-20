import { ExecutorRegistry } from "@/executor/registry"
import type { ExecutorNameInfo } from "@/executor/compat"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { PlannerOutput, parsePlannerOutput, type PlannerOutputType, type ReplanContext } from "./agent"
import { SpecDraftSchema, type SpecDraft } from "@/spec/agent"

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
    return SpecDraftSchema.parse(extractObject(result.output))
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
    return PlannerOutput.parse(parsePlannerOutput(result.output))
  }
}

function extractObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced?.[1]) return JSON.parse(sanitizeJSON(fenced[1]))
  const match = text.match(/\{[\s\S]*\}/)
  if (match?.[0]) return JSON.parse(sanitizeJSON(match[0]))
  throw new Error("executor spec output did not contain JSON")
}

/**
 * Sanitize common LLM JSON output issues:
 * - Unescaped backslashes (e.g., Windows paths: C:\Users)
 * - Real newlines inside JSON string values
 * - Markdown code fences inside string values (```javascript ... ```)
 */
function sanitizeJSON(raw: string): string {
  let result = ""
  let inString = false
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (!inString) {
      if (ch === '"') inString = true
      result += ch
      i++
      continue
    }
    // Inside a string
    if (ch === "\\") {
      const next = raw[i + 1]
      // Valid JSON escapes: " \ / b f n r t u
      if (next && '"\\\/bfnrtu'.includes(next)) {
        result += ch + next
        i += 2
        continue
      }
      // Invalid escape: double the backslash to make it valid
      result += "\\\\"
      i++
      continue
    }
    if (ch === '"') {
      inString = false
      result += ch
      i++
      continue
    }
    if (ch === "\n") {
      result += "\\n"
      i++
      continue
    }
    if (ch === "\r") {
      result += "\\r"
      i++
      continue
    }
    if (ch === "\t") {
      result += "\\t"
      i++
      continue
    }
    result += ch
    i++
  }
  return result
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
    "Return only one JSON object matching the requested schema.",
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
    "Return only JSON matching the planner schema.",
  ].filter(Boolean).join("\n\n")
}

const SPEC_SYSTEM = [
  "You are the executor-native spec stage for OpenCorvus.",
  "WARNING: This is a planning-only read-only session.",
  "You may inspect the codebase and documentation, but you must not modify files, apply patches, or run commands with side effects.",
  "Expand the task into a precise markdown specification.",
  "Return JSON only.",
].join("\n")

const PLAN_SYSTEM = [
  "You are the executor-native planning stage for OpenCorvus.",
  "WARNING: This is a planning-only read-only session.",
  "You may inspect the codebase and documentation, but you must not modify files, apply patches, or run commands with side effects.",
  "Produce a detailed implementation plan as JSON only.",
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
