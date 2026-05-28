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
 * ✓ Records REQ-N → goal traceability
 * ✓ Records fidelity coverage and assembly ownership
 * ✓ Resolves cross-goal interfaces into binding Decision Log contracts
 *
 * Constraints:
 * ✗ Cannot execute code / commands
 * ✗ Cannot write or modify user files
 * ✗ Cannot call other agents (integrity runs as a sibling via the
 *   orchestrator `integrity` tool — see integrity/team-agent.ts)
 * ✗ Cannot modify engine_requirement rows (those are owned by Requirements)
 *
 * Implementation: thin shell over `runAgentSession`. Agent-specific code
 * is the user-prompt constructor and the architect output tool kit; the
 * runner owns model resolution, session creation, system-prompt
 * composition (core + config.agent.architect.prompt_append append + skills),
 * stream-error capture, and abort signal propagation.
 */
import { runAgentSession } from "@/agent/runner"
import { withFactCheckRegistration } from "@/prompt/fragments/fact-check-registration"
import { createAgentContextTools } from "@/agent/context-tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { Log } from "@/util/log"
import type { VisualSpec } from "@/design-analyst/types"
import { renderVisualContractPromptSection } from "@/design-analyst/prompt-section"
import type { GoalContractFields } from "@/pipeline/types"
import type { DecisionLog } from "@/decision-log"
import { renderSpecsAsText } from "@/acceptance/types"
import type { ArchitectResult, ArchitectRetryContext, ParsedRequirement, RequirementsDecision } from "./types"
import { createArchitectOutputTools, type RegisteredGoal } from "./output-tools"
import { AttachmentStore } from "@/storage/attachment-store"
import { renderUserRequestSection } from "@/intent/request-prompt"

import ARCHITECT_CORE from "@/prompt/core/architect-core.txt"

const log = Log.create({ service: "architect-agent" })

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export namespace ArchitectAgent {
  type ExistingGoalInput = GoalContractFields & {
    order_index?: number
    retry_count?: number
  }

  export interface CoordinateInput {
    /** Existing goals to seed the collector with. Empty list on the first
     *  pass (Architect decomposes from scratch); non-empty on a re-run
     *  (Architect refines against delivery feedback). */
    goals: ExistingGoalInput[]
    taskRequest: string
    taskTitle: string
    taskID?: string
    decisionLog: DecisionLog
    /** REQ-N list produced by Requirements. */
    requirements?: ParsedRequirement[]
    /** Runtime / framework / test decisions produced by Requirements. */
    requirementDecisions?: RequirementsDecision[]
    /** Optional visual anchors produced by design_analysis. */
    designSpecs?: VisualSpec[]
    /** Authoritative PRD/SPEC entries produced by design_analysis. */
    designAnalysis?: string
    /** Delivery feedback that triggered this re-run. Absent on first pass. */
    retryContext?: ArchitectRetryContext
    /** Multimodal attachments the user uploaded with the task (images, PDFs,
     *  reference files). Surfaced into both the user-message text section
     *  and — for image / pdf / audio / video MIMEs — as inline file parts so
     *  the model can actually look at them while decomposing goals. */
    attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
    /** Parent session — a child "architect" session is created under it. */
    parentSessionID?: string
    model?: { providerID: string; modelID: string }
    signal?: AbortSignal
    onStatus?: (summary: string) => void | Promise<void>
    onSessionCreated?: (sessionID: string) => void
  }

  export async function coordinate(input: CoordinateInput): Promise<ArchitectResult & { sessionID: string }> {
    const seedGoals: RegisteredGoal[] = input.goals.map((g) => ({
      id: g.id,
      title: g.title,
      objective: g.objective,
      acceptance_specs: g.acceptance_specs,
      owned_paths: g.owned_paths,
      depends_on: g.depends_on,
      priority: g.priority,
      kind: (g.kind as RegisteredGoal["kind"]) ?? "feature",
      requirement_ids: g.requirement_ids,
    }))
    const outputToolKit = createArchitectOutputTools({
      existingGoals: seedGoals,
      designSpecs: input.designSpecs,
      requireReferenceCoverage: (input.designSpecs?.length ?? 0) > 0 || Boolean(input.designAnalysis?.trim()),
      referenceCoverageReasons: [
        ...((input.designSpecs?.length ?? 0) > 0 ? ["designSpecs are present"] : []),
        ...(input.designAnalysis?.trim() ? ["designAnalysis handoff is present"] : []),
      ],
      knownRequirementIDs: input.requirements?.map((requirement) => requirement.id),
    })
    const contextTools = await filterAgentTools(createAgentContextTools(), "architect", {
      taskID: input.taskID,
      sessionID: input.parentSessionID,
    })

    log.info("architect agent starting", {
      seedGoals: input.goals.length,
      requirements: input.requirements?.length ?? 0,
      decisions: input.requirementDecisions?.length ?? 0,
      retry: Boolean(input.retryContext),
    })

    const out = await runAgentSession({
      kind: "architect",
      core: withFactCheckRegistration(ARCHITECT_CORE),
      sessionTitle: `Architect: ${input.taskTitle}`,
      parentSessionID: input.parentSessionID,
      taskID: input.taskID,
      model: input.model,
      signal: input.signal,
      onStatus: input.onStatus ?? (() => {}),
      onSessionCreated: input.onSessionCreated
        ? (session) => {
            input.onSessionCreated!(session.id)
          }
        : undefined,
      toolKit: {
        tools: { ...contextTools, ...outputToolKit.tools },
        getCollector: () => outputToolKit.getCollector(),
        buildReport: () => outputToolKit.buildReport(),
      },
      buildUserPrompt: () => buildUserPrompt(input),
      buildUserParts: async () => {
        const text = buildUserPrompt(input)
        const enrichedText = text + AttachmentStore.renderAttachmentInventory(input.attachments)
        const inlineParts = await AttachmentStore.inlineFileParts(input.attachments)
        return [{ type: "text" as const, text: enrichedText }, ...inlineParts]
      },
      terminalTool: {
        toolName: "submit_architect",
        isSatisfied: (collector) => collector.finalized,
        // MUST use the toolKit's predicate (closes over workDir/designSpecs/
        // requireReferenceCoverage) so terminal-tool scoping never disagrees
        // with submit_architect's own validation. Passing the standalone
        // `isArchitectReadyToFinalize(collector)` here drops the workDir-
        // dependent fidelity check and traps the model in a retry loop:
        // predicate says "ready, only submit_architect exposed", tool says
        // "ISSUES, retry", model has no other tool to fix the underlying
        // state with → 鬼打墙. Rule 8 (single source).
        shouldExposeOnlyTerminalTool: () => outputToolKit.isReadyToFinalize(),
      },
    })

    log.info("architect agent finished", {
      sessionID: out.session.id,
      streamErrors: out.streamErrors.length,
    })

    const collector = outputToolKit.getCollector()

    if (!collector.finalized) {
      log.warn("architect agent: submit_architect not called", {
        taskID: input.taskID,
        goalCount: collector.goals.length,
        streamErrors: out.streamErrors.length,
      })
      throw new Error(
        "Architect agent did not call submit_architect. " +
          "The model must register goals, traceability, and " +
          "contract graph via tools, then call submit_architect to validate. " +
          "Check the prompt and model behaviour.",
      )
    }

    if (collector.goals.length < 2) {
      throw new Error(
        "Architect finalized with fewer than two goals — a task must be decomposed into at least two goals.",
      )
    }

    // Architect produces the goal set as facts. Integrity (multi-dimension
    // review) is a SEPARATE orchestrator-level step — architect does not
    // call it. Rule 22.
    const goals: GoalContractFields[] = collector.goals.map((g) => ({
      id: g.id,
      title: g.title,
      objective: g.objective,
      acceptance_specs: g.acceptance_specs,
      owned_paths: g.owned_paths,
      depends_on: g.depends_on,
      priority: g.priority,
      kind: g.kind,
      requirement_ids: g.requirement_ids,
    }))

    log.info("architect agent output", {
      goals: goals.length,
      removed: collector.removed_goal_ids.length,
      traceability: collector.traceability.length,
      sourceCoverage: collector.source_coverage.length,
      referenceCoverage: collector.reference_coverage.length,
      assemblyOwners: collector.assembly_owners.length,
      contracts: collector.contract_graph.contracts.length,
      dependencyContracts: collector.contract_graph.dependency_contracts.length,
    })

    return {
      goals,
      removedGoalIDs: collector.removed_goal_ids,
      traceability: collector.traceability,
      fidelity: {
        sourceCoverage: collector.source_coverage,
        referenceCoverage: collector.reference_coverage,
        assemblyOwners: collector.assembly_owners,
      },
      contractGraph: collector.contract_graph,
      validationFindings: collector.validation_findings,
      summary: collector.summary || "Architect decomposition",
      decompositionAnalysis: collector.decomposition_analysis,
      sessionID: out.session.id,
    }
  }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildUserPrompt(input: ArchitectAgent.CoordinateInput): string {
  const sections: string[] = []

  sections.push("# Delegation\n\nOrchestrator is asking architect to decompose this task into executable goals.")
  sections.push(renderUserRequestSection({
    heading: "# Task",
    title: input.taskTitle,
    request: input.taskRequest,
    taskID: input.taskID,
  }))
  sections.push(
    [
      "# Input Contract",
      "",
      "The task title and bounded request excerpt above are the prompt-visible user input for this stage.",
      "If requirements, foundational decisions, retry context, or visual contract sections appear below, they are also authoritative.",
      "When the excerpt is not enough, read or grep the exact request bundle path named above instead of relying on upstream summaries.",
    ].join("\n"),
  )

  if (input.designSpecs && input.designSpecs.length > 0) {
    sections.push(
      renderVisualContractPromptSection({
        specs: input.designSpecs,
        instructions: [
          "The following visual constraints came from design_analysis and are authoritative for the referenced surface.",
          "Use them when decomposing frontend goals, source/reference coverage, owned paths, interaction work, and integrity coverage.",
        ],
      }),
    )
  }

  if (input.designAnalysis && input.designAnalysis.trim().length > 0) {
    sections.push(input.designAnalysis)
  }

  if (input.requirements && input.requirements.length > 0) {
    const reqText = input.requirements.map((r) => {
      const lines = [`- **${r.id}** (${r.type}): ${r.description}`]
      if (r.acceptance.trim().length > 0) lines.push(`  Acceptance: ${r.acceptance}`)
      if (r.non_goals.trim().length > 0) lines.push(`  Non-goals: ${r.non_goals}`)
      return lines.join("\n")
    }).join("\n")
    sections.push(`# Requirements (${input.requirements.length})\n\n${reqText}`)
  }

  if (input.requirementDecisions && input.requirementDecisions.length > 0) {
    const decText = input.requirementDecisions.map((d) => `- **${d.key}** = ${d.value} — ${d.reason}`).join("\n")
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
        ...ctx.previousGoals.map((g) => `- **${g.id}** (${g.title}): ${g.status} — ${g.evidence}`),
      ].join("\n"),
    )
  }

  if (input.goals.length > 0) {
    const ARCHITECT_SPECS_CAP = 600
    const goalsText = input.goals
      .map((g) => {
        const specs = g.acceptance_specs ?? []
        const specsRaw = renderSpecsAsText(specs)
        const specsTrim =
          specsRaw.length > ARCHITECT_SPECS_CAP
            ? specsRaw.slice(0, ARCHITECT_SPECS_CAP) +
              `… (truncated; ${specs.length} specs total, full bodies in spec snapshot)`
            : specsRaw
        return [
          `## #G${(g.order_index ?? 0) + 1}V${(g.retry_count ?? 0) + 1} ${g.id}: ${g.title}`,
          `objective: ${g.objective}`,
          `acceptance_specs (${specs.length}):\n${specsTrim}`,
          `owned_paths: ${g.owned_paths.join(", ") || "(none)"}`,
          `depends_on: ${g.depends_on.join(", ") || "(none)"}`,
          `kind: ${g.kind}`,
        ].join("\n")
      })
      .join("\n\n")
    sections.push(`# Existing Goals (${input.goals.length})\n\n${goalsText}`)
  }

  const dlSection = input.decisionLog.toPromptSection()
  if (dlSection) sections.push(dlSection)

  sections.push(
    "Explore the codebase, then register (or refine) the final goal set — " +
      "including optional diagnostics, traceability, and the Architect Contract Graph. " +
      "Call submit_architect when done; the validator will list " +
      "anything still missing.",
  )

  return sections.join("\n\n")
}
