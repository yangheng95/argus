/**
 * Architect Agent — authoritative goal decomposer + cross-goal coordinator.
 *
 * Position in the pipeline: after Requirements (REQ-N list + foundational
 * decisions), before Dispatch. Called on every task — both as the first
 * decomposition pass and as the re-run mechanism when delivery feedback
 * says the goal set needs to change.
 *
 * Authority:
 * ✓ Produces the final goal set (add / modify / split / remove)
 * ✓ Registers per-goal and global metric specs
 * ✓ Registers challenge seeds for the Prosecutor
 * ✓ Records REQ-N → goal traceability
 * ✓ Resolves cross-goal interfaces into binding Decision Log contracts
 * ✓ Runs fidelity review against the original user request
 *
 * Constraints:
 * ✗ Cannot execute code / commands
 * ✗ Cannot write or modify user files
 * ✗ Cannot call other agents
 * ✗ Cannot modify engine_requirement rows (those are owned by Requirements)
 */
import { stepCountIs } from "ai"
import type { TextHooks } from "@/llm/api"
import { createPlannerTools } from "@/planner/tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { AgentRuntime } from "@/agent/runtime"
import { resolveAgentModel } from "@/agent/model"
import { EngineConfig } from "@/engine"
import { Config } from "@/config/config"
import type { VisualSpec } from "@/design-analyst/types"
import { renderVisualContractPromptSection } from "@/design-analyst/prompt-section"
import { buildMirrorToolsPromptSection } from "@/prompt/mirror-tools"
import { Instance } from "@/project/instance"
import type { GoalContractFields } from "@/pipeline/types"
import type { DecisionLog } from "@/decision-log"
import { renderSpecsAsText } from "@/acceptance/types"
import { reviewFidelity, applyFidelityCorrections } from "./fidelity"
import type {
  ArchitectContract,
  ArchitectDecisionKey,
  ArchitectResult,
  ArchitectRetryContext,
  ParsedRequirement,
  RequirementsDecision,
} from "./types"
import { createArchitectOutputTools, type RegisteredGoal } from "./output-tools"

import ARCHITECT_CORE from "@/prompt/core/architect-core.txt"

const log = Log.create({ service: "architect-agent" })

const VALID_CATEGORIES = new Set<ArchitectDecisionKey>([
  "directory_blueprint", "interface_contract", "export_manifest",
  "shared_type", "naming_convention", "dependency_order",
])

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export namespace ArchitectAgent {
  export async function coordinate(input: {
    /**
     * Existing goals to seed the collector with. Empty list on the first
     * pass (Architect decomposes from scratch); non-empty on a re-run
     * (Architect refines against delivery feedback).
     */
    goals: GoalContractFields[]
    taskRequest: string
    taskTitle: string
    taskID?: string
    decisionLog: DecisionLog
    /** REQ-N list produced by Requirements. */
    requirements?: ParsedRequirement[]
    /** Runtime / framework / test decisions produced by Requirements. */
    requirementDecisions?: RequirementsDecision[]
    /** Advisory visual contract produced by design_analysis. */
    designSpecs?: VisualSpec[]
    /** Delivery feedback that triggered this re-run. Absent on first pass. */
    retryContext?: ArchitectRetryContext
    /** SessionID for fidelity event correlation. */
    sessionID?: string
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
  }): Promise<ArchitectResult> {
    return run(input)
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function run(input: {
  goals: GoalContractFields[]
  taskRequest: string
  taskTitle: string
  taskID?: string
  decisionLog: DecisionLog
  requirements?: ParsedRequirement[]
  requirementDecisions?: RequirementsDecision[]
  designSpecs?: VisualSpec[]
  retryContext?: ArchitectRetryContext
  sessionID?: string
  signal?: AbortSignal
  stream?: TextHooks
  onStatus?: (summary: string) => void | Promise<void>
}): Promise<ArchitectResult> {
  if (input.signal?.aborted) throw new Error("architect agent aborted")

  const orchCfg = await EngineConfig.get()
  const { max_steps: MAX_STEPS, timeout_ms: TIMEOUT_MS } = orchCfg.architect

  const model = await resolveAgentModel("architect", { taskID: input.taskID })

  if (input.signal?.aborted) throw new Error("architect agent aborted after model resolution")

  const seedGoals: RegisteredGoal[] = input.goals.map((g) => ({
    id: g.id,
    title: g.title,
    objective: g.objective,
    acceptance_specs: g.acceptance_specs,
    owned_paths: g.owned_paths,
    depends_on: g.depends_on,
    exports: g.exports,
    imports: g.imports,
    priority: g.priority,
    kind: (g.kind as RegisteredGoal["kind"]) ?? "feature",
    requirement_ids: g.requirement_ids,
  }))
  const outputToolKit = createArchitectOutputTools({ existingGoals: seedGoals })
  const plannerTools = await filterAgentTools(createPlannerTools(), "architect")
  const guard = toolGuard({ ...plannerTools, ...outputToolKit.tools })

  await input.onStatus?.("Architect agent: coordinating cross-goal contracts")

  const systemPrompt = await architectSystem()
  const userPrompt = buildUserPrompt(input)

  log.info("architect agent starting", {
    seedGoals: input.goals.length,
    requirements: input.requirements?.length ?? 0,
    decisions: input.requirementDecisions?.length ?? 0,
    retry: Boolean(input.retryContext),
    model: model.id,
  })

  const abortSignals: AbortSignal[] = [guard.signal]
  if (input.signal) abortSignals.push(input.signal)

  const passthroughHooks = {
    onChunk: input.stream?.onChunk,
    onError: input.stream?.onError,
    flush: async () => {},
    failures: { snapshot: () => ({ count: 0, items: [] as any[] }) },
  } as any
  const runResult = await AgentRuntime.run({
    agent: "architect",
    model,
    system: systemPrompt,
    messages: [{ role: "user" as const, content: userPrompt }],
    tools: guard.tools,
    stopWhen: stepCountIs(MAX_STEPS),
    cacheKey: input.taskID ? `task-${input.taskID}-architect` : undefined,
    sessionID: input.sessionID ?? "",
    taskID: input.taskID,
    stage: "architect",
    signal: AbortSignal.any(abortSignals),
    onStepFinish: guard.onStepFinish,
    hooks: passthroughHooks,
    policies: {
      progressTimeoutMs: TIMEOUT_MS,
      failurePolicy: "collect",
    },
  })
  const resultText = runResult.text
  const resultSteps = runResult.steps
  const resultFinishReason = runResult.finishReason
  const toolCallCount = runResult.toolCallCount

  log.info("architect agent finished", {
    steps: resultSteps.length,
    finishReason: resultFinishReason,
    textLength: (resultText?.trim() || "").length,
    toolCalls: toolCallCount,
  })

  const collector = outputToolKit.getCollector()

  if (!collector.finalized) {
    log.warn("architect agent: finalize_architect not called", {
      taskID: input.taskID,
      goalCount: collector.goals.length,
      finishReason: resultFinishReason,
    })
    throw new Error(
      "Architect agent did not call finalize_architect. " +
      "The model must register goals, metrics, seeds, traceability, and " +
      "contracts via tools, then call finalize_architect to validate. " +
      "Check the prompt and model behaviour.",
    )
  }

  if (collector.goals.length === 0) {
    throw new Error(
      "Architect finalized with zero goals — a task must have at least one goal.",
    )
  }

  // Fidelity gate — verify the final goal set covers the ORIGINAL user
  // request. Applies corrections in-place so the returned goals are the
  // accepted set. sessionID forwards into FidelityReviewCompleted so the
  // overlay nests the verdict card correctly.
  const goalsForFidelity: GoalContractFields[] = collector.goals.map((g) => ({
    id: g.id,
    title: g.title,
    objective: g.objective,
    acceptance_specs: g.acceptance_specs,
    owned_paths: g.owned_paths,
    depends_on: g.depends_on,
    exports: g.exports,
    imports: g.imports,
    priority: g.priority,
    kind: g.kind,
    requirement_ids: g.requirement_ids,
  }))
  const fidelity = await reviewFidelity({
    userRequest: input.taskRequest,
    taskTitle: input.taskTitle,
    goals: goalsForFidelity,
    requirements: input.requirements,
    requirementDecisions: input.requirementDecisions,
    designSpecs: input.designSpecs,
    decisionLog: input.decisionLog,
    signal: input.signal,
    taskID: input.taskID,
    parentSessionID: input.sessionID,
  })

  const finalGoals = fidelity.verdict === "needs_correction"
    ? applyFidelityCorrections(goalsForFidelity, fidelity)
    : goalsForFidelity

  // Decision Log seed — one entry per contract, tagged with goal scope.
  const contracts: ArchitectContract[] = collector.contracts.map((c) => ({
    category: c.category,
    title: c.title,
    spec: c.spec,
    goalIDs: c.goalIDs,
  }))
  for (const contract of contracts) {
    if (!VALID_CATEGORIES.has(contract.category)) continue
    // goalID dispatch:
    //   • Single-goal contract → tag with that goal so per-goal sub-agents
    //     reading `phasePromptSectionForGoal` see it.
    //   • Multi-goal contract → tag as task-scoped (omit goalID). Per-goal
    //     reads include `goal_id IS NULL` rows, so all goals see it.
    const tagAsGoalID = contract.goalIDs.length === 1 ? contract.goalIDs[0] : undefined
    input.decisionLog.append({
      goalID: tagAsGoalID,
      phase: "architect",
      key: contract.category,
      value: `## ${contract.title}\n${contract.spec}`,
      reason: `Architect consensus for goals: ${contract.goalIDs.join(", ") || "(task-wide)"}`,
    })
  }

  log.info("architect agent output", {
    goals: finalGoals.length,
    removed: collector.removed_goal_ids.length,
    goalMetrics: collector.goal_metric_specs.length,
    globalMetrics: collector.global_metric_specs.length,
    challengeSeeds: collector.challenge_seeds.length,
    traceability: collector.traceability.length,
    contracts: contracts.length,
    fidelityVerdict: fidelity.verdict,
  })

  return {
    goals: finalGoals,
    removedGoalIDs: collector.removed_goal_ids,
    goalMetricSpecs: collector.goal_metric_specs,
    globalMetricSpecs: collector.global_metric_specs,
    challengeSeeds: collector.challenge_seeds,
    traceability: collector.traceability,
    contracts,
    fidelity,
    summary: collector.summary || "Architect decomposition",
  }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildUserPrompt(input: {
  goals: GoalContractFields[]
  taskRequest: string
  taskTitle: string
  decisionLog: DecisionLog
  requirements?: ParsedRequirement[]
  requirementDecisions?: RequirementsDecision[]
  designSpecs?: VisualSpec[]
  retryContext?: ArchitectRetryContext
}): string {
  const sections: string[] = []

  sections.push(`# Task\n\nTitle: ${input.taskTitle}\n\nRequest:\n${input.taskRequest}`)
  sections.push(
    [
      "# Input Contract",
      "",
      "The task title and request above are the authoritative user input for this stage.",
      "If requirements, foundational decisions, retry context, or visual contract sections appear below, they are also authoritative.",
      "Do NOT search the workspace for shadow copies of the request or `.opencorvus/intent/*`.",
      "Architect runs before per-goal execution starts, so `.opencorvus/intent/*` is not part of this stage contract.",
    ].join("\n"),
  )

  if (input.designSpecs && input.designSpecs.length > 0) {
    sections.push(renderVisualContractPromptSection({
      specs: input.designSpecs,
      instructions: [
        "The following advisory visual constraints came from design_analysis.",
        "Use them when decomposing frontend goals, owned paths, interaction work, and fidelity coverage.",
      ],
    }))
  }

  if (input.requirements && input.requirements.length > 0) {
    const reqText = input.requirements
      .map((r) => `- **${r.id}** (${r.type}): ${r.description}`)
      .join("\n")
    sections.push(`# Requirements (${input.requirements.length})\n\n${reqText}`)
  }

  if (input.requirementDecisions && input.requirementDecisions.length > 0) {
    const decText = input.requirementDecisions
      .map((d) => `- **${d.key}** = ${d.value} — ${d.reason}`)
      .join("\n")
    sections.push(`# Foundational Decisions\n\n${decText}`)
  }

  if (input.retryContext) {
    const ctx = input.retryContext
    sections.push(
      [
        "# Re-run Context — previous goal set failed delivery",
        "",
        "The Architect is being re-invoked because delivery rejected the previous",
        "goal set. Refine: add, modify, split, or remove goals to address the",
        "failure rather than starting over.",
        "",
        "## Failure Analysis",
        `Classification: ${ctx.failureAnalysis.classification}`,
        `Summary: ${ctx.failureAnalysis.summary}`,
        `Root Cause: ${ctx.failureAnalysis.rootCause}`,
        `Strategy: ${ctx.failureAnalysis.suggestedStrategy}`,
        "",
        "## Approaches to AVOID",
        ...ctx.failureAnalysis.avoidApproaches.map((a) => `- ${a}`),
        "",
        "## Previous Goals",
        ...ctx.previousGoals.map(
          (g) => `- **${g.id}** (${g.title}): ${g.status} — ${g.evidence}`,
        ),
      ].join("\n"),
    )
  }

  // Seed goals — empty on first pass, populated on re-run so the Architect
  // can choose to modify/remove instead of re-registering from scratch.
  if (input.goals.length > 0) {
    const ARCHITECT_SPECS_CAP = 600
    const goalsText = input.goals.map((g) => {
      const specs = g.acceptance_specs ?? []
      const specsRaw = renderSpecsAsText(specs)
      const specsTrim = specsRaw.length > ARCHITECT_SPECS_CAP
        ? specsRaw.slice(0, ARCHITECT_SPECS_CAP) + `… (truncated; ${specs.length} specs total, full bodies in spec snapshot)`
        : specsRaw
      return [
        `## ${g.id}: ${g.title}`,
        `objective: ${g.objective}`,
        `acceptance_specs (${specs.length}):\n${specsTrim}`,
        `owned_paths: ${g.owned_paths.join(", ") || "(none)"}`,
        `exports: ${g.exports.join("; ") || "(none)"}`,
        `imports: ${g.imports.join("; ") || "(none)"}`,
        `depends_on: ${g.depends_on.join(", ") || "(none)"}`,
        `kind: ${g.kind}`,
      ].join("\n")
    }).join("\n\n")
    sections.push(`# Existing Goals (${input.goals.length})\n\n${goalsText}`)
  }

  const dlSection = input.decisionLog.toPromptSection()
  if (dlSection) sections.push(dlSection)

  try {
    const mirrorSection = buildMirrorToolsPromptSection({ cwd: Instance.directory })
    if (mirrorSection.trim().length > 0) sections.push(mirrorSection)
  } catch {
    // Instance not initialised — advisory section, skip.
  }

  sections.push(
    "Explore the codebase, then register (or refine) the final goal set — " +
    "including metric specs, challenge seeds, traceability, and cross-goal " +
    "contracts. Call finalize_architect when done; the validator will list " +
    "anything still missing.",
  )

  return sections.join("\n\n")
}

async function architectSystem(): Promise<string> {
  const config = await Config.get()
  const agentPrompt = (config.agent as Record<string, any> | undefined)?.architect?.prompt
  return typeof agentPrompt === "string" ? agentPrompt : ARCHITECT_CORE
}
