/**
 * DeliveryAgent — An independent-context agent that performs end-to-end
 * verification of the delivered application, including starting the server/client,
 * checking frontend rendering, and reporting any bugs discovered during verification.
 *
 * The DeliveryAgent is review-only. It can:
 * 1. Start the application (server, client, or both)
 * 2. Verify frontend rendering and runtime behavior
 * 3. Produce concrete rejection evidence for orchestrator retry/replan
 * 4. Make a final acceptance decision before publishing
 */
import { createDeliveryTools } from "./tools"
import { createDeliveryOutputTools } from "./output-tools"
import DELIVERY_CORE from "@/prompt/core/delivery-core.txt"
import { runAgentSessionWithRetry } from "@/agent/runner"
import { resolveAgentModel } from "@/agent/model"
import { Instance } from "@/project/instance"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { type TextHooks } from "@/llm/api"
import { deliveryUserPromptCharBudget, PromptBudget } from "@/llm/prompt-budget"
import { Config } from "@/config/config"
import { EngineConfig, clarificationTranscriptSection, operatorNotesSection } from "@/engine"
import { deriveUrlSignals, resolveStageSkills, type TaskSignals } from "@/engine/skill-inject"
import { Provider } from "@/provider/provider"
import { createDecisionLog } from "@/decision-log"
import type { GoalInfo, DeliveryInfo } from "@/delivery/checks"
import {
  DeliveryVerdict,
  type DeliveryEvidenceFacetType,
  FrontendCheck,
  StartupVerification,
  affectedGoalIDs,
  issuesFound,
  type DeliveryVerdictType,
} from "./verdict"

const log = Log.create({ service: "delivery-agent" })

export {
  DeliveryVerdict,
  FrontendCheck,
  StartupVerification,
  affectedGoalIDs,
  issuesFound,
  type DeliveryVerdictType,
}

// ---------------------------------------------------------------------------
// DeliveryAgent
// ---------------------------------------------------------------------------

type VerifyInput = {
  task: { id?: string; title: string; request: string; sessionID?: string; metadata?: Record<string, unknown>; design_specs?: Array<{ id: string; category: string; title: string; requirement: string; applies_to: string; severity: "must" | "should"; rationale?: string }> }
  goals: GoalInfo[]
  delivery: DeliveryInfo
  /** Visual-reference attachments already materialized under the attachment store.
   *  Delivery receives only a small inventory in the startup prompt. The image
   *  bytes are loaded on demand through the visual comparison tool. */
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string; intent?: string; source?: string }>
  /** Explicit model override (provider/model). Skips `resolveAgentModel`. */
  model?: { providerID: string; modelID: string }
  /** Legacy passthrough; not wired after the SessionPrompt migration. */
  stream?: TextHooks
  signal?: AbortSignal
  deliveryID?: string
}

export namespace DeliveryAgent {
  export async function verify(input: VerifyInput): Promise<DeliveryVerdictType> {
    const deliveryCfg = (await EngineConfig.get()).delivery
    const model = input.model
      ? await Provider.getModel(input.model.providerID, input.model.modelID)
      : await resolveAgentModel("delivery", { taskID: input.task.id, sessionID: input.task.sessionID })
    const requiredEvidenceFacets = deriveRequiredEvidenceFacets(input)
    const textPrompt = buildUserPrompt(
      { ...input, attachments: input.attachments, requiredEvidenceFacets },
      { maxChars: deliveryUserPromptCharBudget(model) },
    )
    const taskSignals: TaskSignals = {
      has_attachment_image: (input.attachments ?? []).some((a) => (a.mime ?? "").startsWith("image/")),
      ...deriveUrlSignals(input.task.request ?? ""),
      request_text: input.task.request,
    }

    // Delivery's output tool kit needs `requiredTools` at registration time —
    // the submit_verdict tool rejects accepted verdicts when the declared
    // required tools were not called. Skill resolution happens here in the
    // agent body (not inside the runner) so the tool kit can bind against
    // the returned list; the composed system prompt is then handed to the
    // runner as `rawSystemPrompt` so the runner does not re-resolve the
    // same skill set (rule 22).
    const systemResolved = await deliveryAgentSystem(input)

    log.info("delivery agent starting", {
      title: input.task.title,
      goals: input.goals.length,
      changedFiles: input.delivery.changedFiles.length,
      config: deliveryCfg,
      requiredEvidenceFacets,
    })

    // Retry across attempts is owned by `runAgentSessionWithRetry` (rule 22 /
    // rule 24): each attempt mints a fresh tool kit + child session so the
    // submit_verdict collector and stateful review tools cannot bleed across
    // retries. The helper handles abort propagation, stream-error retry, and
    // exhausted-attempts surfacing — delivery only declares: how many
    // retries, how to mint a kit, and what counts as "complete".
    const out = await runAgentSessionWithRetry({
      kind: "delivery",
      core: systemResolved.prompt,
      rawSystemPrompt: true,
      sessionTitle: `Delivery: ${input.task.title}`,
      sessionDirectory: Instance.directory,
      parentSessionID: input.task.sessionID,
      taskID: input.task.id,
      model: { providerID: model.providerID, modelID: model.id },
      signal: input.signal,
      maxRetries: deliveryCfg.max_retries,
      toolKitFactory: () => {
        const reviewTools = createDeliveryTools({
          sessionID: input.task.sessionID,
          taskID: input.task.id,
          deliveryID: input.deliveryID,
          goals: input.goals,
          delivery: input.delivery,
          attachments: input.attachments,
        })
        const outputToolKit = createDeliveryOutputTools({
          requiredTools: systemResolved.requiredTools,
          requiredEvidenceFacets,
          manifestGate: input.delivery.manifestGate,
          hostGateFailures: input.delivery.hostGateFailures,
        })
        const guard = toolGuard({ ...reviewTools, ...outputToolKit.tools })
        return {
          tools: guard.tools as any,
          getCollector: () => outputToolKit.getCollector(),
        }
      },
      isComplete: (collector) => {
        if (collector.finalized && collector.verdict) return { ok: true }
        return {
          ok: false,
          reason: "delivery agent did not call submit_verdict before the step budget ran out",
        }
      },
      buildUserPrompt: () => textPrompt,
      buildUserParts: () => buildPromptParts(textPrompt),
    })

    const rawVerdict = out.collector.verdict
    if (!rawVerdict) {
      throw new Error("delivery: runAgentSessionWithRetry returned without a verdict")
    }
    const verdict = DeliveryVerdict.parse(rawVerdict)

    log.info("delivery agent output", {
      verdict: verdict.verdict,
      issuesFound: issuesFound(verdict).length,
      startupSuccess: verdict.startup_verification?.success,
      attempts: out.attempts,
    })

    return verdict
  }
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Build SessionPrompt-compatible message parts. Delivery starts text-only:
 * visual bytes are intentionally not inlined because screenshots can dominate
 * provider input length. The compare_visual_artifacts tool is the only path
 * that loads image bytes into the delivery session, and only when the agent
 * elects to inspect them.
 */
async function buildPromptParts(text: string) {
  const parts: Array<{ type: "text"; text: string }> = [{ type: "text", text }]
  return parts.map((p) => ({ ...p, id: Identifier.ascending("part") }))
}

function buildUserPrompt(
  input: {
    task: { id?: string; title: string; request: string; metadata?: Record<string, unknown>; design_specs?: Array<{ id: string; category: string; title: string; requirement: string; applies_to: string; severity: "must" | "should"; rationale?: string }> }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    attachments?: Array<{ sha: string; mime: string; filename?: string; intent?: string }>
    requiredEvidenceFacets?: DeliveryEvidenceFacetType[]
  },
  budgetInput?: { maxChars: number },
): string {
  const budget = new PromptBudget(budgetInput?.maxChars ?? 128_000)
  const sections: string[] = []
  const pushRequired = (section: string, text: string) => {
    sections.push(budget.addRequired(section, text))
  }
  const pushOptional = (section: string, text: string, maxChars: number) => {
    const rendered = budget.addOptional(section, text, { maxChars })
    if (rendered.trim().length > 0) sections.push(rendered)
  }

  pushRequired("# Delegation", "# Delegation\n\nOrchestrator is asking delivery to verify the integrated result and return an acceptance verdict.")

  pushRequired(
    "# Task",
    `# Task\n\nTitle: ${input.task.title}\n\nRequest:\n${input.task.request}`,
  )

  pushRequired("# Required Delivery Evidence Facets", renderRequiredEvidenceFacets(input.requiredEvidenceFacets ?? []))

  // Design Contract — keep only the compact checklist in the startup prompt.
  // Visual bytes and side-by-side review live behind compare_visual_artifacts.
  const designSpecs = input.task.design_specs ?? []
  if (designSpecs.length > 0) {
    const byCategory = new Map<string, typeof designSpecs>()
    const order = ["color", "typography", "spacing", "layout", "component", "interaction", "responsive"]
    for (const s of designSpecs) {
      const group = byCategory.get(s.category) ?? []
      group.push(s)
      byCategory.set(s.category, group)
    }
    const lines: string[] = []
    lines.push("# Design Contract")
    lines.push("")
    lines.push(
      "Design-analyst extracted these visual constraints. Treat them as gating. " +
      "When visual evidence is needed, call compare_visual_artifacts instead of relying on prompt context. " +
      "If a spec is unmet, use category='visual' and cite visual_spec_id.",
    )
    for (const cat of order) {
      const group = byCategory.get(cat)
      if (!group || group.length === 0) continue
      lines.push("")
      lines.push(`## ${cat}`)
      for (const s of group) {
        const rat = s.rationale ? ` — ${s.rationale}` : ""
        lines.push(`- \`${s.id}\` [${s.severity}] ${truncate(s.title, 160)}: ${truncate(s.requirement, 260)} @ ${truncate(s.applies_to, 120)}${truncate(rat, 180)}`)
      }
    }
    pushOptional("# Design Contract", lines.join("\n"), 6_000)
  }

  if (input.task.id) {
    const designAnalysis = createDecisionLog(input.task.id).phasePromptSection(
      "design_analysis",
      "Design Analysis PRD/SPEC Source",
    )
    if (designAnalysis.trim().length > 0) {
      pushOptional(
        "# Design Analysis PRD/SPEC Source",
        designAnalysis,
        10_000,
      )
    }
  }

  const images = (input.attachments ?? []).filter((a) => typeof a?.mime === "string" && a.mime.startsWith("image/"))
  if (images.length > 0) {
    const rendered = images.filter((a) => a.intent === "rendered_output")
    const references = images.filter((a) => a.intent !== "rendered_output")
    pushOptional(
      "# Visual Materials",
      `# Visual Materials\n\n` +
        `Image bytes are not attached to this startup prompt. Call compare_visual_artifacts when visual evidence is relevant.\n` +
        `rendered_outputs=${rendered.length}; references=${references.length}; total_images=${images.length}`,
      1_000,
    )
  }

  // Deterministic delivery gates now run before the LLM and persist a
  // DeliveryEvidenceManifest. The prompt below treats acceptance specs as the
  // semantic contract the agent reviews against; project command
  // execution and structural coverage are not self-credited by prose.

  // Operator notes — user messages sent during task execution
  if (input.task.id) {
    const clarifications = clarificationTranscriptSection(input.task.id)
    if (clarifications) pushOptional("# Clarification Transcript", clarifications, 4_000)
    const notes = operatorNotesSection(input.task.id)
    if (notes) pushOptional("# Operator Notes", notes, 4_000)
  }

  pushOptional(
    "# Goals",
    `# Goal Index\n\n` +
    `This is a compact index only. Call inspect_delivery_context with section='goals' before making goal-level attribution.\n\n` +
      input.goals
        .map(
          (g, i) =>
            `- ${i + 1}. \`${g.id}\` ${truncate(g.title, 180)} priority=${g.priority} acceptance_specs=${g.acceptance_spec_count ?? 0} acceptance_scenarios=${g.acceptance_scenarios?.length ?? 0} owned_paths=${g.owned_paths.slice(0, 8).join(", ") || "(none)"}`,
        )
        .join("\n"),
    12_000,
  )

  // Cap the changed-files list so a wide refactor (hundreds of touched files)
  // does not flood the prompt. The diff section below already shows up to 8
  // representative files; the full path list is reference material, not the
  // signal delivery reasons over.
  const CHANGED_FILES_PROMPT_CAP = 30
  const filesShown = input.delivery.changedFiles.slice(0, CHANGED_FILES_PROMPT_CAP)
  const filesOmitted = input.delivery.changedFiles.length - filesShown.length
  const filesHeader = filesOmitted > 0
    ? `Changed files (${input.delivery.changedFiles.length} total; first ${filesShown.length} listed, ${filesOmitted} omitted):`
    : `Changed files (${input.delivery.changedFiles.length}):`
  pushOptional(
    "# Delivery",
    `# Delivery\n\nSummary: ${input.delivery.summary}\n\n${filesHeader}\n` +
      filesShown.map((f) => `- ${f}`).join("\n") +
      `\n\nFor full diffs or executor claims, call inspect_delivery_context.`,
    5_000,
  )

  if (input.delivery.manifestGate) {
    const gate = input.delivery.manifestGate
    const gateLines = [
      `finalGate.status=${gate.status}`,
      `summary=${gate.summary}`,
      `failedCheckIds=${gate.failedCheckIds.join(", ") || "(none)"}`,
      `failedCoverageIds=${gate.failedCoverageIds.join(", ") || "(none)"}`,
      `failedRuntimeFlowIds=${gate.failedRuntimeFlowIds.join(", ") || "(none)"}`,
      `failedReviewIds=${gate.failedReviewIds.join(", ") || "(none)"}`,
    ]
    const detailLines = (input.delivery.manifestFailureDetails ?? []).slice(0, 10).map((item) => {
      const status = item.status ? ` status=${item.status}` : ""
      const exitCode = item.exitCode === undefined ? "" : ` exit=${item.exitCode}`
      const command = item.command ? ` command=${item.command}` : ""
      return `- [${item.kind}] ${item.id} ${item.name}${status}${exitCode}${command}: ${truncate(item.evidence, 300)}`
    })
    pushOptional(
      "# DeliveryEvidenceManifest Gate",
      `# DeliveryEvidenceManifest Gate\n\n` +
      gateLines.join("\n") +
      (detailLines.length > 0
        ? `\n\nFailure details:\n${detailLines.join("\n")}`
        : "") +
      (gate.status === "failed"
        ? `\n\nThe manifest gate failed on required delivery evidence: functional ` +
          `completion, configured checks, runtime flows, or project integrity review. ` +
          `You must submit verdict='rejected'. For each rejection_details ` +
          `entry, include goal_id only when the listed goal's owned_paths, files_changed, or ` +
          `report evidence identify it as responsible; otherwise leave the entry task-scoped ` +
          `and explain the project-level blocker.`
        : ""),
      8_000,
    )
  }

  if (input.delivery.hostGateFailures && input.delivery.hostGateFailures.length > 0) {
    const lines: string[] = []
    for (const failure of input.delivery.hostGateFailures) {
      lines.push(`## ${failure.kind}:${failure.id}`)
      lines.push(`Summary: ${failure.summary}`)
      if (failure.evidence.length > 0) {
        lines.push("Evidence:")
        for (const item of failure.evidence.slice(0, 3)) lines.push(`- ${truncate(item, 300)}`)
        if (failure.evidence.length > 3) lines.push(`- ... ${failure.evidence.length - 3} more evidence item(s); call inspect_delivery_context.`)
      }
      lines.push("")
    }
    pushOptional(
      "# Host Hard Gate Failures",
      `# Host Hard Gate Failures\n\n` +
      `These are deterministic host observations, not synthetic verdicts. They block acceptance, ` +
      `but attribution still belongs to your submit_verdict rejection_details. Do not drop any ` +
      `runtime or visual gate evidence when writing the rejected verdict.\n\n` +
      lines.join("\n").trim(),
      8_000,
    )
  }

  if (input.delivery.runtimeEvidenceFailures && input.delivery.runtimeEvidenceFailures.length > 0) {
    pushOptional(
      "# Runtime Evidence Failures",
      `# Runtime Evidence Failures\n\n` +
      `The host runtime probe found blocking runtime failures. Analyze them as delivery evidence ` +
      `and reject with concrete reproduction details unless you can prove the probe is invalid.\n\n` +
      input.delivery.runtimeEvidenceFailures.slice(0, 10).map((item) => `- ${truncate(item, 400)}`).join("\n"),
      5_000,
    )
  }

  if (input.delivery.visualMetricFailures && input.delivery.visualMetricFailures.length > 0) {
    pushOptional(
      "# Visual Metric Failures",
      `# Visual Metric Failures\n\n` +
      `The host visual metric found blocking visual failures. Use these as evidence, inspect the ` +
      `rendered output and reference yourself, and reject with concrete visual rejection_details ` +
      `unless you can prove the metric is invalid.\n\n` +
      input.delivery.visualMetricFailures.slice(0, 10).map((item) => `- ${truncate(item, 400)}`).join("\n"),
      5_000,
    )
  }

  if (input.delivery.goalReports?.length || input.delivery.diffs?.length) {
    pushOptional(
      "# Exploration Tools",
      "# Exploration Tools\n\n" +
        "Initial context is intentionally compact. Use inspect_delivery_context to fetch goals, upstream context, executor reports, diffs, manifest details, host failures, runtime failures, visual failures, or attachments only when needed.",
      1_500,
    )
  }

  pushRequired(
    "# Final Verification Instructions",
    "IMPORTANT: You MUST verify the application works end-to-end.\n" +
      "1. Inspect whether the delivered implementation actually satisfies the task and acceptance specs\n" +
      "2. Verify the applicable runtime, output, interface, data, or presentation surface requested by the task\n" +
      "3. If completion is already missing, reject with concrete evidence and skip broad auxiliary commands\n" +
      "4. Run build/typecheck/lint/test/configured verification only after completion checks have not failed\n" +
      "5. Attribute every rejection to the responsible goal when identifiable\n" +
      "6. Produce your semantic verdict for the host delivery arbiter without editing project files",
  )

  const notice = budget.renderNotice()
  if (notice) sections.push(notice)

  return sections.join("\n\n")
}

function renderRequiredEvidenceFacets(facets: DeliveryEvidenceFacetType[]): string {
  if (facets.length === 0) {
    return (
      "# Required Delivery Evidence Facets\n\n" +
      "The host did not classify this task as requiring startup, runtime, frontend, or visual evidence. " +
      "Do not fabricate startup_verification or frontend_check fields just to satisfy a fixed shape. " +
      "Verify the actual acceptance specs with appropriate code/test/config evidence and cite those calls in tool_call_evidence."
    )
  }
  const lines = facets.map((facet) => {
    switch (facet) {
      case "startup":
        return "- startup: start or invoke the delivered runnable surface from the repository root and report startup_verification."
      case "runtime":
        return "- runtime: exercise the public entry point or user workflow and cite observable output in tool_call_evidence."
      case "frontend":
        return "- frontend: verify rendered UI behavior and report frontend_check."
      case "visual":
        return "- visual: capture or inspect rendered visual output against the design/reference material and report frontend_check."
    }
  })
  return (
    "# Required Delivery Evidence Facets\n\n" +
    "The host classified these evidence facets as applicable. verdict='accepted' is rejected unless the matching evidence fields and tool_call_evidence are present:\n\n" +
    lines.join("\n")
  )
}

export function deriveRequiredEvidenceFacets(input: {
  task: { design_specs?: Array<unknown> }
  goals: Array<{ acceptance_scenarios?: unknown[] }>
  delivery: { changedFiles: string[] }
  attachments?: Array<{ mime?: string; intent?: string }>
}): DeliveryEvidenceFacetType[] {
  const facets = new Set<DeliveryEvidenceFacetType>()
  const files = input.delivery.changedFiles.map((file) => file.replaceAll("\\", "/"))
  const hasRuntimeScenario = input.goals.some((goal) => (goal.acceptance_scenarios?.length ?? 0) > 0)
  const hasImageReference = (input.attachments ?? []).some((a) => (a.mime ?? "").startsWith("image/"))
  const hasDesignSpecs = (input.task.design_specs ?? []).length > 0
  const touchesFrontend = files.some((file) =>
    /(^|\/)(src\/)?(app|pages|components)\//.test(file)
    || /\.(tsx|jsx|vue|svelte|astro|css|scss)$/.test(file)
    || /(^|\/)(index\.html|vite\.config\.|next\.config\.)/.test(file)
  )
  const touchesRuntime = files.some((file) =>
    /(^|\/)(api|routes|server|controllers|handlers|bin|cli)\//.test(file)
    || /(^|\/)app\/api\//.test(file)
    || /(server|routes|api|cli|main|index)\.[cm]?[jt]sx?$/.test(file)
    || /^package\.json$/.test(file)
  )

  if (hasRuntimeScenario || touchesRuntime || touchesFrontend) facets.add("runtime")
  if (touchesRuntime || touchesFrontend || hasRuntimeScenario) facets.add("startup")
  if (touchesFrontend || hasDesignSpecs || hasImageReference) facets.add("frontend")
  if (hasDesignSpecs || hasImageReference || touchesFrontend) facets.add("visual")

  return [...facets].sort()
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + "\n... (truncated)"
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const DELIVERY_AGENT_SYSTEM = DELIVERY_CORE

/** Single-source delivery system prompt.
 *
 * Composition (strict order, no bypass):
 *   1. DELIVERY_AGENT_SYSTEM — code-owned canonical core (role, phases, rules)
 *   2. config.agent.delivery.prompt — optional user append (MUST NOT replace)
 *   3. resolveStageSkills output — invariant section + matched skills
 *
 * Returns the composed prompt and the union of required_tools declared by
 * every matched skill so submit_verdict can enforce them. Task signals
 * (attachments, request URL) drive auto-detect alongside project files/deps. */
export async function deliveryAgentSystem(input?: VerifyInput): Promise<{ prompt: string; requiredTools: string[] }> {
  const config = await Config.get()
  const userAppend = (config.agent as Record<string, any> | undefined)?.delivery?.prompt
  const core = typeof userAppend === "string" && userAppend.trim().length > 0
    ? DELIVERY_AGENT_SYSTEM + "\n\n" + userAppend
    : DELIVERY_AGENT_SYSTEM
  const orchCfg = await EngineConfig.get()
  const taskSignals: TaskSignals | undefined = input
    ? {
        has_attachment_image: (input.attachments ?? []).some((a) => (a.mime ?? "").startsWith("image/")),
        ...deriveUrlSignals(input.task.request ?? ""),
        request_text: input.task.request,
      }
    : undefined
  const resolved = await resolveStageSkills(orchCfg.delivery.skills, "delivery", taskSignals)
  return { prompt: core + resolved.prompt, requiredTools: resolved.requiredTools }
}
