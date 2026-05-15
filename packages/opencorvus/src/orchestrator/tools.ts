/**
 * Orchestrator tools — AI SDK tool() definitions wrapping existing services.
 *
 * Created per-task via createOrchestratorTools({ taskID }).
 * The taskID is captured in the closure — no global registry needed.
 */
import { tool } from "ai"
import z from "zod"
import path from "node:path"
import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import { Session } from "@/session"
import { resolveAgentModel } from "@/agent/model"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { Database, eq, and, inArray, sql } from "@/storage/db"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { createDecisionLog } from "@/decision-log"
import { EngineService } from "@/task-api"
import { sessionGoalID } from "./task-event"
import { Publisher } from "@/engine/publisher"
import { EngineGit } from "@/engine/git"
import { git as runGit } from "@/util/git"
import { EngineMemoryBridge } from "@/engine/memory-bridge"
import { SubAgentProtocol } from "@/agent/sub-agent-protocol"
import { Event as EngineEvent } from "@/engine/model"
import { EngineProtocol } from "@/engine/protocol"
import { renderDesignAnalysisHandoffReference } from "@/design-analyst/handoff"
import { materializeMcpToolResult } from "@/mcp/materialize"
import { EngineArtifactTable, EngineGoalTable, EngineTaskTable } from "@/engine/engine.sql"
import {
  markDeliveryPublishing,
  finalizeDeliveryResult,
  supersedePriorActivePlansForTask,
  updateGoalWorkspace,
  updateGoalRun,
  updateGoalRunExecutorSessionStatus,
  updateEvaluationFromDeliveryVerdict,
} from "@/engine/persist"
import {
  findActivePlanForTask,
  findActiveRunForTask,
  findActiveSpecForTask,
  findDeliveryByRun,
  findEvaluationByRun,
  findGoal,
  findGoalRun,
  findLatestArchitectContractGraph,
  findLatestDeliveryVerdictArtifact,
  findLatestTipGoalRun,
  findPlan,
  getGoalRetryCount,
  listGoals,
  listGoalsForPlan,
  requireRun,
  requireTask,
  type TaskRow,
} from "@/engine/store"
import { describeTask, goalStatusByID, renderCollaborationClosure } from "@/engine/describe"
import { isLiveGoalRunStatus } from "@/engine/catalog"
import { GoalContractUpdateSchema } from "@/pipeline/goal-contract.schema"
import { updateRun, updateTask } from "@/engine/state"
import { deriveTaskStatus, isTaskQueued } from "@/engine/task-status"

import {
  createWorkflowState,
  findStepByTool,
  WorkflowRegistry,
  type WorkflowState,
  type MiniWorkflow,
} from "@/engine/workflow"
import { Question } from "@/question"
import { renderSpecsAsText, type AcceptanceSpec, type ContractAuditScorer } from "@/acceptance/types"
import { contractAuditRequired, runContractAudit, type ContractAuditCriteriaResult } from "@/acceptance/contract-audit"
import { isLiveRunStatus, isRunReadyForGoalDispatch, restartStagePlan, type RestartStage } from "./scheduler"
import { OrchestratorEventNote } from "./agent"
import { composeDeliveryRetryFeedback } from "./delivery-retry-feedback"
import {
  architectFidelityIssues,
  AssemblyOwnerEntrySchema,
  ReferenceCoverageEntrySchema,
  SourceCoverageEntrySchema,
  type ArchitectFidelityState,
} from "@/architect/fidelity"
import { contractGraphIRIndex } from "@/architect/contract-graph"
import type { GoalCorrection, IntegrityDimensionResult, IntegrityGraphCorrection, IntegrityResult, MissingGoal } from "@/integrity"
import { renderIntegrityMarkdown } from "@/integrity/render-markdown"

const log = Log.create({ service: "task-tools" })

async function runGoalContractAuditCriteria(input: {
  taskID: string
  goal: ReturnType<typeof findGoal>
  goalRunID?: string
  workDir: string
  task: TaskRow
}): Promise<ContractAuditCriteriaResult[]> {
  const goal = input.goal
  if (!goal) return []
  const acceptanceSpecs = (Array.isArray(goal.acceptance_specs) ? goal.acceptance_specs : []) as AcceptanceSpec[]
  const contractAuditSpecs = acceptanceSpecs.flatMap((spec) =>
    spec.scorers
      .filter((scorer): scorer is ContractAuditScorer => scorer.type === "contract_audit")
      .map((scorer) => ({ spec, scorer })),
  )
  if (contractAuditSpecs.length === 0) return []

  const graph = findLatestArchitectContractGraph(input.taskID)
  if (!graph) {
    return contractAuditSpecs.map(({ spec, scorer }) => ({
      name: `acceptance:${spec.id}:${scorer.name}`,
      label: `${spec.title} / ${scorer.name}`,
      family: "contract_audit",
      status: "failed",
      evidence: `goal=${goal.id}; contract_audit scorer references graph contracts but no architect_contract_graph artifact exists`,
      goal_id: goal.id,
      goal_run_id: input.goalRunID,
    }))
  }
  const graphContractIDs = new Set(graph.contracts.map((contract) => contract.id))
  const missingContractIDs = contractAuditSpecs.flatMap(({ scorer }) =>
    scorer.spec.contract_ids.filter((contractID) => !graphContractIDs.has(contractID)),
  )
  if (missingContractIDs.length > 0) {
    return contractAuditSpecs.map(({ spec, scorer }) => ({
      name: `acceptance:${spec.id}:${scorer.name}`,
      label: `${spec.title} / ${scorer.name}`,
      family: "contract_audit",
      status: "failed",
      evidence: `goal=${goal.id}; contract_audit references unknown graph contract ids: ${[...new Set(missingContractIDs)].join(", ")}`,
      goal_id: goal.id,
      goal_run_id: input.goalRunID,
    }))
  }

  const goalContract = {
    id: goal.id,
    kind: typeof goal.kind === "string" ? goal.kind : undefined,
    owned_paths: Array.isArray(goal.owned_paths) ? (goal.owned_paths as string[]) : [],
  }

  return contractAuditSpecs.map(({ spec, scorer }) => ({
    ...runContractAudit({
      workDir: input.workDir,
      index: contractGraphIRIndex(graph),
      goal: goalContract,
      spec,
      scorer,
    }),
    goal_id: goal.id,
    goal_run_id: input.goalRunID,
  }))
}

type IntegrityReviewOutcome =
  | {
      status: "blocked"
      headline: string
      pointer: string
    }
  | {
      status: "reviewed"
      specSnapshotID: string
      verdict: "pass" | "concerns" | "needs_correction"
      summary: string
      sessionID: string
      goalCount: number
      perDimension: Array<string>
      correctionsCount: number
      graphCorrectionsCount: number
      missingCount: number
      /** Full per-dimension breakdown including issues / corrections /
       *  missing_goals — kept on the outcome so every consumer (build tool
       *  return, renderIntegrityOutcome, recordIntegrityAttempt persistence,
       *  read_context, delivery upstream context) renders the same complete
       *  text instead of a count summary. The orchestrator LLM reads this
       *  markdown and decides modify_goal / build / architect / fail_task
       *  itself; nothing in code routes/supersedes from the outcome. */
      markdown: string
      dimensions: IntegrityDimensionResult[]
      corrections: GoalCorrection[]
      graphCorrections: IntegrityGraphCorrection[]
      missingGoals: MissingGoal[]
    }

// renderIntegrityMarkdown lives in @/integrity/render-markdown so it can be
// unit-tested without pulling the full orchestrator import graph; imported below.

// Post-build architecture review is task/spec scoped. Parallel Build tool
// calls can complete in the same orchestrator turn; without this single-flight
// latch they all create independent integrity sessions and duplicate retry
// actions for the same graph snapshot.
const integrityReviewSingleflight = new Map<string, Promise<IntegrityReviewOutcome>>()

const PersistedArchitectFidelitySchema = z.object({
  sourceCoverage: z.array(SourceCoverageEntrySchema).default([]),
  referenceCoverage: z.array(ReferenceCoverageEntrySchema).default([]),
  assemblyOwners: z.array(AssemblyOwnerEntrySchema).default([]),
})

function readPersistedArchitectFidelity(task: TaskRow): ArchitectFidelityState {
  const metadata =
    task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
      ? (task.metadata as Record<string, unknown>)
      : {}
  const raw = metadata.architect_fidelity
  const parsed = PersistedArchitectFidelitySchema.safeParse(raw)
  if (parsed.success) return parsed.data
  return {
    sourceCoverage: [],
    referenceCoverage: [],
    assemblyOwners: [],
  }
}

function visualReferenceSignals(task: TaskRow): string[] {
  const signals: string[] = []
  if (/https?:\/\/\S+/i.test(task.request)) signals.push("request_url")
  const metadata =
    task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
      ? (task.metadata as Record<string, unknown>)
      : {}
  if (typeof metadata.figma_url === "string" && metadata.figma_url.trim()) signals.push("figma_url")

  const materialAttachments = [
    ...(Array.isArray(task.attachments) ? (task.attachments as any[]) : []),
    ...(Array.isArray(task.system_artifacts) ? (task.system_artifacts as any[]) : []),
  ]
  for (const item of materialAttachments) {
    const mime = typeof item?.mime === "string" ? item.mime : ""
    const intent = typeof item?.intent === "string" ? item.intent : ""
    if (mime.startsWith("image/") || mime === "application/pdf" || intent === "visual_reference") {
      signals.push("visual_material")
      break
    }
  }
  return [...new Set(signals)]
}

function designAnalysisContractComplete(task: TaskRow): boolean {
  const entries = createDecisionLog(task.id).readByPhase("design_analysis")
  const keys = new Set(entries.map((entry) => entry.key))
  return [
    "product_spec",
    "frontend_spec",
    "visual_consistency_spec",
    "backend_spec",
    "prd_iteration_notes",
    "completeness_review",
    "evidence_source_manifest",
  ].every((key) => keys.has(key))
}

function renderEvidenceSourceManifest(input: {
  task: TaskRow
  liveUrls: readonly string[]
  figmaUrls: readonly string[]
  materialPaths: readonly string[]
  referenceArtifacts: readonly string[]
  materializedFiles?: readonly string[]
}): string {
  const lines: string[] = []
  lines.push("## PRD/SPEC Source Manifest")
  lines.push("Canonical PRD/SPEC file: .opencorvus/design-analysis/prd-spec.md")
  lines.push("Canonical source manifest file: .opencorvus/design-analysis/evidence-source-manifest.md")
  lines.push(
    "Canonical decision-log entries: phase=design_analysis keys product_spec, frontend_spec, visual_consistency_spec, backend_spec, prd_iteration_notes, completeness_review.",
  )
  lines.push("Optional visual anchors: task.design_specs, when present. They are secondary to visual_consistency_spec.")

  if (input.materializedFiles && input.materializedFiles.length > 0) {
    lines.push("")
    lines.push("### Materialized PRD/SPEC files")
    for (const item of [...new Set(input.materializedFiles)]) lines.push(`- ${item}`)
  }

  const requestUrls = [...new Set([...input.task.request.matchAll(/https?:\/\/\S+/gi)].map((m) => m[0]))]
  const urls = [...new Set([...requestUrls, ...input.liveUrls])]
  if (urls.length > 0) {
    lines.push("")
    lines.push("### Live URL sources")
    for (const item of urls) lines.push(`- ${item}`)
  }

  if (input.figmaUrls.length > 0) {
    lines.push("")
    lines.push("### Figma sources")
    for (const item of [...new Set(input.figmaUrls)]) lines.push(`- ${item}`)
  }

  if (input.materialPaths.length > 0) {
    lines.push("")
    lines.push("### Local material sources")
    for (const item of [...new Set(input.materialPaths)]) lines.push(`- ${item}`)
  }

  const renderArtifactRows = (title: string, artifacts: readonly unknown[]) => {
    if (artifacts.length === 0) return
    lines.push("")
    lines.push(`### ${title}`)
    artifacts.forEach((raw, index) => {
      const item = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
      const filename =
        typeof item.filename === "string" && item.filename.trim() ? item.filename : `attachment-${index + 1}`
      const mime = typeof item.mime === "string" && item.mime.trim() ? item.mime : "application/octet-stream"
      const source = typeof item.source === "string" && item.source.trim() ? ` source=${item.source}` : ""
      const intent = typeof item.intent === "string" && item.intent.trim() ? ` intent=${item.intent}` : ""
      const sha = typeof item.sha === "string" && item.sha.trim() ? ` sha=${item.sha}` : ""
      const url = typeof item.url === "string" && item.url.trim() ? ` url=${item.url}` : ""
      lines.push(`- ${filename} — ${mime}${source}${intent}${sha}${url}`)
    })
  }

  renderArtifactRows(
    "User/task attachments",
    Array.isArray(input.task.attachments) ? (input.task.attachments as unknown[]) : [],
  )
  renderArtifactRows(
    "Design-analysis materialized artifacts",
    Array.isArray(input.task.system_artifacts) ? (input.task.system_artifacts as unknown[]) : [],
  )

  if (input.referenceArtifacts.length > 0) {
    lines.push("")
    lines.push("### Mirror artifacts cited by design-analysis")
    for (const item of input.referenceArtifacts) lines.push(`- ${item}`)
  }

  return lines.join("\n")
}

function designAnalysisArtifactPaths(projectDir: string) {
  const relativeDir = ".opencorvus/design-analysis"
  return {
    relativeDir,
    prdRelative: `${relativeDir}/prd-spec.md`,
    manifestRelative: `${relativeDir}/evidence-source-manifest.md`,
    prdAbsolute: path.join(projectDir, ".opencorvus", "design-analysis", "prd-spec.md"),
    manifestAbsolute: path.join(projectDir, ".opencorvus", "design-analysis", "evidence-source-manifest.md"),
  }
}

function renderDesignAnalysisPrdSpecDocument(input: {
  analysis: {
    designSystem: string
    techStack: readonly string[]
    productSpec: string
    frontendSpec: string
    visualConsistencySpec: string
    backendSpec: string
    prdIterationNotes: readonly string[]
    completenessReview: string
    referenceArtifacts: readonly string[]
    openQuestions: readonly string[]
  }
  evidenceSourceManifest: string
}): string {
  const lines: string[] = []
  lines.push("# Design Analysis PRD/SPEC")
  lines.push("")
  lines.push("This file is the materialized design-analysis source for downstream agents.")
  lines.push("The decision log stores the same contract under phase=design_analysis.")
  lines.push("")
  lines.push("## Evidence Source Manifest")
  lines.push(input.evidenceSourceManifest.trim())
  lines.push("")
  lines.push("## Design System")
  lines.push(input.analysis.designSystem.trim() || "(not specified)")
  lines.push("")
  lines.push("## Recommended Stack")
  if (input.analysis.techStack.length > 0) {
    for (const item of input.analysis.techStack) lines.push(`- ${item}`)
  } else {
    lines.push("(not specified)")
  }
  lines.push("")
  lines.push("## Product Spec")
  lines.push(input.analysis.productSpec.trim())
  lines.push("")
  lines.push("## Frontend Spec")
  lines.push(input.analysis.frontendSpec.trim())
  lines.push("")
  lines.push("## Visual Consistency Spec")
  lines.push(input.analysis.visualConsistencySpec.trim())
  lines.push("")
  lines.push("## Backend Spec")
  lines.push(input.analysis.backendSpec.trim())
  lines.push("")
  lines.push("## PRD Iteration Notes")
  if (input.analysis.prdIterationNotes.length > 0) {
    input.analysis.prdIterationNotes.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.trim()}`)
    })
  } else {
    lines.push("(not specified)")
  }
  lines.push("")
  lines.push("## Completeness Review")
  lines.push(input.analysis.completenessReview.trim())
  lines.push("")
  lines.push("## Reference Artifacts")
  if (input.analysis.referenceArtifacts.length > 0) {
    for (const item of input.analysis.referenceArtifacts) lines.push(`- ${item}`)
  } else {
    lines.push("(not specified)")
  }
  lines.push("")
  lines.push("## Open Questions")
  if (input.analysis.openQuestions.length > 0) {
    for (const item of input.analysis.openQuestions) lines.push(`- ${item}`)
  } else {
    lines.push("(none)")
  }
  return lines.join("\n").trimEnd() + "\n"
}

async function writeDesignAnalysisArtifacts(input: {
  projectDir: string
  analysis: Parameters<typeof renderDesignAnalysisPrdSpecDocument>[0]["analysis"]
  evidenceSourceManifest: string
}): Promise<{ prdRelative: string; manifestRelative: string }> {
  const paths = designAnalysisArtifactPaths(input.projectDir)
  await fs.mkdir(path.dirname(paths.prdAbsolute), { recursive: true })
  await fs.writeFile(paths.manifestAbsolute, input.evidenceSourceManifest.trimEnd() + "\n", "utf8")
  await fs.writeFile(
    paths.prdAbsolute,
    renderDesignAnalysisPrdSpecDocument({
      analysis: input.analysis,
      evidenceSourceManifest: input.evidenceSourceManifest,
    }),
    "utf8",
  )
  return {
    prdRelative: paths.prdRelative,
    manifestRelative: paths.manifestRelative,
  }
}

function requireDesignAnalysisBefore(stage: string, task: TaskRow) {
  const signals = visualReferenceSignals(task)
  if (signals.length === 0 || designAnalysisContractComplete(task)) return undefined
  return SubAgentProtocol.yieldResult({
    headline: `${stage}: blocked — call design_analysis before any downstream stage for visual/reference tasks.`,
    summary:
      `This task has visual/reference inputs (${signals.join(", ")}), but the active design-analysis contract is incomplete. ` +
      "Run design_analysis first and require it to complete mirror extraction plus at least two PRD/SPEC review passes. " +
      "Downstream agents must consume decision_log phase=design_analysis, including visual_consistency_spec and evidence_source_manifest; they must not infer from the raw URL or attachments.",
    fields: [
      ["next_action", "design_analysis"],
      [
        "required_contract",
        "product_spec + frontend_spec + visual_consistency_spec + backend_spec + prd_iteration_notes + completeness_review + evidence_source_manifest",
      ],
    ],
    pointer: "design_analysis",
  })
}

function acceptanceSpecsToPromptLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((spec) => {
    if (typeof spec === "string") return spec
    try {
      return renderSpecsAsText([spec as AcceptanceSpec])
    } catch {
      return JSON.stringify(spec)
    }
  })
}

const GOAL_UPDATE_SCORER_TYPES = ["heuristic", "llm_judge", "prebuilt", "contract_audit"] as const

const goalUpdateAcceptanceGuidance = [
  'Legal acceptance scorer type values are "heuristic", "llm_judge", "prebuilt", and "contract_audit".',
  'Shell checks are heuristic scorers: { "type": "heuristic", "name": "...", "spec": { "kind": "shell", "cmd": "..." }, "expect": { "exit_code": 0 } }.',
  'Do not use scorer type "shell" or "script_ref"; those are spec.kind values under type="heuristic".',
].join(" ")

const ModifyGoalInputSchema = z
  .object({
    goalID: z.unknown().describe("Required string. The goal ID to modify."),
    updates: z
      .unknown()
      .describe(`Required object containing the goal fields to update; id is immutable. ${goalUpdateAcceptanceGuidance}`),
    reason: z.unknown().describe("Required string. Why you decided to modify this goal."),
  })
  .passthrough()

export function parseModifyGoalUpdates(input: unknown): { ok: true; updates: z.infer<typeof GoalContractUpdateSchema> } | {
  ok: false
  message: string
} {
  const parsed = GoalContractUpdateSchema.safeParse(input)
  if (parsed.success) return { ok: true, updates: parsed.data }
  return {
    ok: false,
    message: [
      "Error: modify_goal output did not match the goal update contract; database unchanged.",
      ...parsed.error.issues.slice(0, 8).map((issue) => {
        const pathLabel = issue.path.length > 0 ? `updates.${issue.path.join(".")}` : "updates"
        return `- ${pathLabel}: ${issue.message}`
      }),
      ...modifyGoalAcceptanceHints(input).map((hint) => `- ${hint}`),
      `Resubmit modify_goal with the corrected update shape. ${goalUpdateAcceptanceGuidance}`,
    ].join("\n"),
  }
}

function modifyGoalAcceptanceHints(input: unknown): string[] {
  const hints: string[] = []
  const specs = isObjectRecord(input) && Array.isArray(input.acceptance_specs) ? input.acceptance_specs : []
  for (const [specIndex, spec] of specs.entries()) {
    if (!isObjectRecord(spec) || !Array.isArray(spec.scorers)) continue
    for (const [scorerIndex, scorer] of spec.scorers.entries()) {
      if (!isObjectRecord(scorer) || typeof scorer.type !== "string") continue
      if ((GOAL_UPDATE_SCORER_TYPES as readonly string[]).includes(scorer.type)) continue
      const pathLabel = `updates.acceptance_specs.${specIndex}.scorers.${scorerIndex}.type`
      if (scorer.type === "shell") {
        hints.push(`${pathLabel}: "shell" is not a scorer type. Use type="heuristic" with spec.kind="shell".`)
      } else if (scorer.type === "script_ref") {
        hints.push(`${pathLabel}: "script_ref" is not a scorer type. Use type="heuristic" with spec.kind="script_ref".`)
      } else {
        hints.push(
          `${pathLabel}: "${scorer.type}" is not a scorer type. Legal values: ${GOAL_UPDATE_SCORER_TYPES.join(", ")}.`,
        )
      }
    }
  }
  return [...new Set(hints)]
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Returns the subset of `updates` whose value differs from the persisted
 * `goal` row. Used by `modify_goal` to filter out no-op updates so the
 * orchestrator LLM cannot trigger phase=retry decision_log feedback by
 * resubmitting the SAME contract — that pattern was misused as a side
 * channel when build failures had unrelated root causes (e.g. missing
 * terminal tool call), polluting the next attempt's retry feedback with
 * a generic "contract changed, re-read acceptance_specs" template that
 * had nothing to do with the actual failure.
 *
 * Compared via JSON serialization: arrays / strings / primitive unions
 * round-trip identically as long as both sides are already deserialized
 * to the same shape (the goal row from listGoals is, and Zod-validated
 * `updates` is). Spec build-missing-terminal-signal-restore-2026-05-07.md
 * §5.3.
 */
export function computeContractFieldChanges(
  updates: Record<string, unknown>,
  goal: Record<string, unknown>,
): Record<string, unknown> {
  const contractFields = [
    "title",
    "objective",
    "acceptance_specs",
    "owned_paths",
    "depends_on",
    "priority",
    "kind",
  ] as const
  const setValues: Record<string, unknown> = {}
  for (const f of contractFields) {
    const incoming = updates[f]
    if (incoming === undefined) continue
    const current = goal[f]
    if (JSON.stringify(incoming) === JSON.stringify(current)) continue
    setValues[f] = incoming
  }
  return setValues
}

export function validatePersistedArchitectFidelity(input: {
  task: TaskRow
  goals: Array<{ id: string; owned_paths?: string[] }>
  workDir?: string
  executionStarted?: boolean
}) {
  return architectFidelityIssues({
    goals: input.goals.map((goal) => ({ id: goal.id, owned_paths: goal.owned_paths ?? [] })),
    fidelity: readPersistedArchitectFidelity(input.task),
    designSpecs: Array.isArray(input.task.design_specs) ? (input.task.design_specs as any) : undefined,
    workDir: input.workDir ?? Instance.directory,
    requireSourceCoverage: input.executionStarted !== true,
    requireReferenceCoverage: (Array.isArray(input.task.design_specs) ? input.task.design_specs.length : 0) > 0,
  })
}

export async function composeLatestDeliveryFeedbackForBuild(input: {
  taskID: string
  goalID?: string
}): Promise<string | undefined> {
  const verdictArtifact = findLatestDeliveryVerdictArtifact(input.taskID)
  const verdictPayload = (verdictArtifact?.payload ?? {}) as Record<string, unknown>
  if (!verdictArtifact || verdictPayload.verdict !== "rejected") return undefined

  const rejectionDetails = Array.isArray(verdictPayload.rejection_details)
    ? (verdictPayload.rejection_details as Array<Record<string, unknown>>)
    : []
  const scopedDetails = input.goalID
    ? rejectionDetails.filter((detail) => detail.goal_id === input.goalID)
    : rejectionDetails

  const { deliveryManifestFailureDetails, findLatestDeliveryEvidenceManifest, formatDeliveryManifestFailureDetails } =
    await import("@/delivery/manifest")
  const deliveryID = verdictArtifact.delivery_id ?? undefined
  const manifest = deliveryID ? findLatestDeliveryEvidenceManifest({ deliveryID }) : undefined
  const manifestFailureDetails = manifest ? formatDeliveryManifestFailureDetails(manifest) : []
  const failedRuntimeFlowIds = new Set(manifest?.finalGate.failedRuntimeFlowIds ?? [])
  const failedReviewIds = new Set(manifest?.finalGate.failedReviewIds ?? [])
  const packet = {
    verdict_artifact_id: verdictArtifact.id,
    delivery_id: deliveryID,
    scope: input.goalID ? "goal" : "integrated_tree",
    goal_id: input.goalID,
    verdict: {
      verdict: verdictPayload.verdict,
      summary: typeof verdictPayload.summary === "string" ? verdictPayload.summary : "",
      rejection_details: scopedDetails,
      all_rejection_detail_count: rejectionDetails.length,
    },
    manifest: manifest
      ? {
          id: manifest.id,
          iteration: manifest.iteration,
          finalGate: manifest.finalGate,
          failureDetails: deliveryManifestFailureDetails(manifest),
          runtimeFlows: manifest.runtimeFlows.filter(
            (flow) => flow.status === "failed" || failedRuntimeFlowIds.has(flow.id),
          ),
          reviewEvidence: manifest.reviewEvidence.filter(
            (review) => review.status === "failed" || failedReviewIds.has(review.id),
          ),
        }
      : undefined,
  }

  return composeDeliveryRetryFeedback({
    iteration: typeof manifest?.iteration === "number" ? manifest.iteration : 0,
    verdict: String(verdictPayload.verdict),
    summary: typeof verdictPayload.summary === "string" ? verdictPayload.summary : "",
    manifestFailureDetails,
    ownDetails: scopedDetails.map((detail) => ({
      category: typeof detail.category === "string" ? detail.category : "unknown",
      error: typeof detail.error === "string" ? detail.error : JSON.stringify(detail),
      goal_id: typeof detail.goal_id === "string" ? detail.goal_id : undefined,
      check_id: typeof detail.check_id === "string" ? detail.check_id : undefined,
      file: typeof detail.file === "string" ? detail.file : undefined,
      suggestion: typeof detail.suggestion === "string" ? detail.suggestion : undefined,
      visual_spec_id: typeof detail.visual_spec_id === "string" ? detail.visual_spec_id : undefined,
    })),
    scope: input.goalID ? "goal" : "integrated_tree",
    rawFeedbackPacket: packet,
  })
}

async function loadLatestRenderedRetryAttachment(input: {
  taskID: string
  enabled: boolean
}): Promise<import("@/build/agent").BuildAgent.BuildContext["retryAttachments"]> {
  if (!input.enabled) return undefined
  try {
    const task = requireTask(input.taskID)
    const artifacts = Array.isArray(task.system_artifacts) ? task.system_artifacts : []
    const rendered = [...artifacts]
      .reverse()
      .find(
        (artifact) =>
          artifact?.intent === "rendered_output" &&
          typeof artifact.url === "string" &&
          typeof artifact.mime === "string" &&
          artifact.mime.startsWith("image/"),
      )
    if (!rendered) return undefined
    const { AttachmentStore } = await import("@/storage/attachment-store")
    const located = AttachmentStore.nameFromUrl(rendered.url)
    if (!located) {
      throw new Error(
        `rendered_output artifact has no resolvable attachment url: ${rendered.filename ?? rendered.sha ?? rendered.url}`,
      )
    }
    const abs = AttachmentStore.resolveAbsolute(located.projectID, located.name)
    if (!abs) {
      throw new Error(`rendered_output artifact ${located.projectID}/${located.name} is not resolvable on disk`)
    }
    return [
      {
        url: rendered.url,
        mime: rendered.mime,
        filename: "previous-attempt-rendered.png",
      },
    ]
  } catch (err) {
    log.warn("build retry: failed to load previous rendered screenshot attachment", {
      taskID: input.taskID,
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}

/**
 * Lightweight MIME guess from filename extension. Covers the design-material
 * spectrum: images (inlined multimodal), PDFs (multimodal), text / markdown /
 * JSON / CSS / YAML (reference-only, read via read_attachment). Falls back to
 * `application/octet-stream` so AttachmentStore.write still accepts the file
 * — the multimodal-vs-reference partition then decides how it's surfaced.
 */
function guessMimeFromFilename(filename: string): string {
  const ext = (filename.split(".").pop() || "").toLowerCase()
  const table: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    avif: "image/avif",
    heic: "image/heic",
    heif: "image/heif",
    pdf: "application/pdf",
    md: "text/markdown",
    markdown: "text/markdown",
    txt: "text/plain",
    log: "text/plain",
    json: "application/json",
    jsonc: "application/json",
    yaml: "text/yaml",
    yml: "text/yaml",
    css: "text/css",
    scss: "text/css",
    less: "text/css",
    html: "text/html",
    htm: "text/html",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
  }
  return table[ext] ?? "application/octet-stream"
}

const FIGMA_URL_PATTERN = /\bhttps?:\/\/(?:[\w-]+\.)?figma\.com\/(?:file|design|proto|board)\/[^\s)]+/i

function isFigmaUrl(value: string): boolean {
  return FIGMA_URL_PATTERN.test(value)
}

function parseFigmaMaterialUrl(value: string): { nodeID: string } {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch (err) {
    throw new Error(`invalid Figma URL for design_analysis MCP materialization: ${value}`, { cause: err })
  }
  if (!/(^|\.)figma\.com$/i.test(parsed.hostname)) {
    throw new Error(`design_analysis Figma MCP materialization expected a figma.com URL: ${value}`)
  }
  const node = parsed.searchParams.get("node-id")
  if (!node?.trim()) {
    throw new Error(`design_analysis Figma MCP materialization requires a node-id query parameter: ${value}`)
  }
  return { nodeID: node.replace(/-/g, ":") }
}

type FigmaMcpToolName = "get_design_context" | "get_screenshot" | "get_metadata" | "get_variable_defs"

async function resolveFigmaMcpToolKeys(): Promise<Record<FigmaMcpToolName, string>> {
  const { MCP } = await import("@/mcp")
  const tools = await MCP.serverTools()

  const pick = (name: FigmaMcpToolName): string => {
    const matches = tools.filter(
      (item) => item.name === name || item.key === `Figma_${name}` || item.key === `figma_${name}`,
    )
    if (matches.length === 0) {
      throw new Error(
        `Figma MCP tool missing: ${name}. Connect a Figma MCP server that exposes get_design_context, get_screenshot, get_metadata, and get_variable_defs.`,
      )
    }
    if (matches.length > 1) {
      throw new Error(`Ambiguous Figma MCP tool ${name}: ${matches.map((item) => item.key).join(", ")}`)
    }
    return matches[0]!.key
  }

  return {
    get_design_context: pick("get_design_context"),
    get_screenshot: pick("get_screenshot"),
    get_metadata: pick("get_metadata"),
    get_variable_defs: pick("get_variable_defs"),
  }
}

async function materializeFigmaMcpReference(input: {
  taskID: string
  projectID: string
  figmaUrl: string
}): Promise<number> {
  const { MCP } = await import("@/mcp")
  const tools = await resolveFigmaMcpToolKeys()
  const { nodeID } = parseFigmaMaterialUrl(input.figmaUrl)
  const nodeId = nodeID
  const common = {
    nodeId,
    clientLanguages: "typescript,html,css",
    clientFrameworks: "react,tailwindcss",
  }

  const [designContextRaw, screenshotRaw, metadataRaw, variableDefsRaw] = await Promise.all([
    MCP.callTool({
      key: tools.get_design_context,
      args: {
        ...common,
        artifactType: "WEB_PAGE_OR_APP_SCREEN",
        taskType: "CREATE_ARTIFACT",
      },
    }),
    MCP.callTool({
      key: tools.get_screenshot,
      args: { nodeId },
    }),
    MCP.callTool({
      key: tools.get_metadata,
      args: common,
    }),
    MCP.callTool({
      key: tools.get_variable_defs,
      args: common,
    }),
  ])

  const screenshot = await materializeMcpToolResult({
    projectID: input.projectID,
    result: screenshotRaw as any,
    imageFilename: `figma-${nodeID.replace(/[^a-zA-Z0-9]/g, "_")}.png`,
  })
  if (screenshot.attachments.length === 0) {
    throw new Error(`Figma MCP get_screenshot produced no image content for node ${nodeID}`)
  }
  for (const ref of screenshot.attachments) {
    await EngineService.appendTaskAttachment(input.taskID, {
      ...ref,
      intent: "visual_reference",
      source: "figma-mcp",
    })
  }

  const textArtifacts = [
    ["figma-design-context", designContextRaw],
    ["figma-metadata", metadataRaw],
    ["figma-variable-defs", variableDefsRaw],
  ] as const
  for (const [label, raw] of textArtifacts) {
    const materialized = await materializeMcpToolResult({
      projectID: input.projectID,
      result: raw as any,
    })
    if (!materialized.text.trim()) {
      throw new Error(`Figma MCP ${label} produced no text content for node ${nodeID}`)
    }
    const body = [
      `# ${label}`,
      ``,
      `- Source: ${input.figmaUrl}`,
      `- Node: ${nodeID}`,
      ``,
      materialized.text.trim(),
    ].join("\n")
    const ref = await (
      await import("@/storage/attachment-store")
    ).AttachmentStore.write(
      input.projectID,
      Buffer.from(body, "utf8"),
      "text/markdown",
      `${label}-${nodeID.replace(/[^a-zA-Z0-9]/g, "_")}.md`,
    )
    await EngineService.appendTaskSystemArtifact(input.taskID, {
      ...ref,
      intent: "design_reference",
      source: "figma-mcp",
    })
  }

  return 1
}

// The delivery agent emits a structured DeliveryVerdict with three typed
// surfaces (deferred_checks, rejection_details, the verdict itself). Each is
// already per-check-shaped — flatten all three into engine_task.criteria_results
// so the panel reflects what was actually verified, not just an aggregate bit.
async function sinkDeliveryVerdictToCriteria(
  taskID: string,
  verdict: import("@/delivery/agent").DeliveryVerdictType,
): Promise<void> {
  const checks: Array<{
    name: string
    status: "passed" | "failed" | "skipped" | "inconclusive"
    family: string
    evidence?: string
    label?: string
  }> = []

  for (const dc of verdict.deferred_checks) {
    checks.push({
      name: dc.name,
      status: dc.result === "advisory_failed" ? "failed" : dc.result,
      family: "delivery",
      evidence: dc.evidence,
    })
  }

  // rejection_details only exists on RejectedVerdict (discriminated union).
  // Accepted verdicts have nothing to flatten here.
  if (verdict.verdict === "rejected") {
    for (const rd of verdict.rejection_details) {
      const fileSuffix = rd.file ? ` @ ${rd.file}` : ""
      const suggestion = rd.suggestion ? ` → ${rd.suggestion}` : ""
      checks.push({
        name: `${rd.category}${fileSuffix}`,
        status: "failed",
        family: rd.category,
        evidence: `${rd.error}${suggestion}`,
      })
    }
  }

  checks.push({
    name: "delivery_verdict",
    status: verdict.verdict === "accepted" ? "passed" : "failed",
    family: "delivery",
    evidence: verdict.summary,
    label: "Delivery agent overall verdict",
  })

  await EngineService.upsertTaskCriteria(taskID, checks)
}

async function persistDeliveryVerificationThrow(input: {
  taskID: string
  runID?: string | null
  deliveryID: string
  error: string
  iteration: number
}): Promise<import("@/delivery/agent").DeliveryVerdictType> {
  const now = Date.now()
  const detail = `DeliveryService.verify threw before producing a verdict: ${input.error}`
  const verdict: import("@/delivery/agent").DeliveryVerdictType = {
    verdict: "rejected",
    summary: detail,
    startup_verification: {
      attempted: false,
      success: false,
      output: input.error,
    },
    deferred_checks: [
      {
        name: "delivery_verification",
        result: "failed",
        evidence: detail,
      },
    ],
    tool_call_evidence: [
      {
        tool: "DeliveryService.verify",
        passed: false,
        detail,
      },
    ],
    rejection_details: [
      {
        category: "runtime",
        error: detail,
        suggestion: "Repair the delivery verification path and run deliver again in the same task context.",
      },
    ],
  }
  Database.use((db) => {
    db.insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.taskID,
        run_id: input.runID ?? null,
        delivery_id: input.deliveryID,
        kind: "delivery_verification_threw",
        label: "delivery_verification_threw",
        payload: {
          error: input.error,
          iteration: input.iteration,
          verdict: "rejected",
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.taskID,
        run_id: input.runID ?? null,
        delivery_id: input.deliveryID,
        kind: "verdict",
        label: "delivery-agent-verdict",
        payload: verdict,
        time_created: now,
        time_updated: now,
      })
      .run()
  })
  await sinkDeliveryVerdictToCriteria(input.taskID, verdict)
  updateEvaluationFromDeliveryVerdict({
    deliveryID: input.deliveryID,
    verdict: "rejected",
    summary: verdict.summary,
    now,
  })
  return verdict
}

// Re-export the stateful-tool registry (defined in a dependency-free module
// so `session/message.ts` can import it without creating a circular graph
// through `@/session`). Surfacing it from this module keeps it visible to
// developers reading tool definitions.
export { STATEFUL_SNAPSHOT_TOOL_NAMES, type StatefulSnapshotToolName } from "./stateful-tool-names"

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createOrchestratorTools(input: {
  taskID: string
  agentSessionID: string
  signal?: AbortSignal
  workflow?: import("@/engine/workflow").MiniWorkflow
  workflowState?: import("@/engine/workflow").WorkflowState
  operatorMessage?: {
    text: string
    attachmentSummary?: string
  }
}) {
  const { taskID } = input

  // Some tools intentionally end the current orchestrator turn. Do not abort
  // the provider stream from inside the tool body itself — that races the AI
  // SDK's tool-result persistence and makes a successful tool look interrupted.
  // Instead record a deferred stop reason here and let the caller abort after
  // the current step has finished cleanly.
  const stopAfterDispatch = new AbortController()
  let pendingStopReason: string | undefined

  function requestStopAfterCurrentStep(reason: string) {
    if (!pendingStopReason) pendingStopReason = reason
  }

  function finalizeDeferredStop(): string | undefined {
    if (!pendingStopReason) return undefined
    const reason = pendingStopReason
    pendingStopReason = undefined
    if (!stopAfterDispatch.signal.aborted) {
      stopAfterDispatch.abort(reason)
    }
    return reason
  }

  async function cleanupTerminalGoalWorkspaces(reason: string): Promise<number> {
    const { cleanupGoalWorkspaceForGoal } = await import("@/engine/writer")
    let cleaned = 0
    const errors: string[] = []
    for (const goal of listGoals(taskID)) {
      try {
        if (await cleanupGoalWorkspaceForGoal(goal.id)) cleaned += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`${goal.id}: ${message}`)
      }
    }
    if (errors.length > 0) {
      const message = `${reason}: failed to clean ${errors.length} goal worktree(s): ${errors.join("; ")}`
      log.error("goal workspace terminal cleanup failed", { taskID, reason, errors })
      throw new Error(message)
    }
    return cleaned
  }

  async function cleanupCompletedGoalWorkspace(goalID: string, goalRunID: string): Promise<string> {
    const { cleanupGoalWorkspaceForGoal } = await import("@/engine/writer")
    try {
      const cleaned = await cleanupGoalWorkspaceForGoal(goalID)
      if (cleaned) {
        updateGoalRun(goalRunID, { workspace_dir: null })
      }
      return cleaned ? "goal worktree cleaned after successful merge" : "goal worktree already absent"
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn("goal workspace cleanup after success failed", { taskID, goalID, error: message })
      return `goal worktree cleanup failed: ${message}`
    }
  }

  async function publishGateReworkResult(input: {
    deliveryID: string
    runID: string
    summary: string
    source: "deliver_auto_publish" | "publish_delivery"
  }) {
    const detail =
      `Publish gate blocked delivery ${input.deliveryID}: ${input.summary}. ` +
      `This is a rework signal, not a terminal task failure. The orchestrator must fix the ` +
      `workspace/export mismatch, then run deliver again.`
    try {
      const { createDecisionLog } = await import("@/decision-log")
      createDecisionLog(taskID).append({
        phase: "delivery",
        key: `publish_gate_rework_${Date.now()}`,
        value: detail,
        reason: input.source,
      })
    } catch {
      /* best effort */
    }
    return SubAgentProtocol.yieldResult({
      headline:
        `Publish gate blocked delivery, but task remains active for rework. ` +
        `Fix the workspace/export mismatch and re-run deliver.`,
      fields: [
        ["delivery_id", input.deliveryID],
        ["run_id", input.runID],
        ["publish_gate", input.summary],
        [
          "next",
          "inspect declared changed files vs exported workspace; build/restart_from_stage as needed; then deliver again",
        ],
      ],
      pointer: `delivery ${input.deliveryID}; publish gate failure is rework feedback`,
    })
  }

  function activeGoalChoices(limit = 16) {
    const activePlan = findActivePlanForTask(taskID)
    if (!activePlan) return ""
    const goals = listGoalsForPlan(activePlan)
    return goals
      .slice(0, limit)
      .map((goal, index) => `G${index + 1}=${goal.id} (${goal.title})`)
      .join("; ")
  }

  function parseGoalOrdinal(reference: string): number | undefined {
    const match = reference.trim().match(/^(?:#|g)?(\d+)$/i)
    if (!match) return undefined
    const value = Number.parseInt(match[1]!, 10)
    return Number.isSafeInteger(value) && value > 0 ? value : undefined
  }

  function resolveGoalReferenceForBuild(
    reference: string,
  ): { ok: true; goalID: string } | { ok: false; message: string } {
    const raw = reference.trim()
    if (!raw) {
      return {
        ok: false,
        message: "build: empty goalID. Use a durable engine_goal.id or an active-plan ordinal such as G12.",
      }
    }

    const exact = findGoal(raw)
    if (exact) {
      if (exact.task_id !== taskID) {
        return {
          ok: false,
          message:
            `build: goal reference "${raw}" belongs to another task. ` +
            `Re-read this task's collaboration_closure and use one of: ${activeGoalChoices() || "(no active goals)"}.`,
        }
      }
      return { ok: true, goalID: exact.id }
    }

    const ordinal = parseGoalOrdinal(raw)
    if (ordinal !== undefined) {
      const activePlan = findActivePlanForTask(taskID)
      if (!activePlan) {
        return {
          ok: false,
          message:
            `build: ordinal goal reference "${raw}" requires an active plan. ` +
            `Use a durable engine_goal.id from collaboration_closure instead.`,
        }
      }
      const goals = listGoalsForPlan(activePlan)
      const goal = goals[ordinal - 1]
      if (!goal) {
        return {
          ok: false,
          message:
            `build: ordinal goal reference "${raw}" is outside the active plan range ` +
            `(1-${goals.length}). Use one of: ${activeGoalChoices() || "(no active goals)"}.`,
        }
      }
      return { ok: true, goalID: goal.id }
    }

    return {
      ok: false,
      message:
        `build: goal reference "${raw}" did not match a durable engine_goal.id or active-plan ordinal. ` +
        `Re-read collaboration_closure and use one of: ${activeGoalChoices() || "(no active goals)"}.`,
    }
  }

  function missingResolvedGoalMessage(goalID: string) {
    return (
      `build: resolved goal ${goalID} no longer exists in this task's active goal graph. ` +
      `Re-read collaboration_closure and dispatch a current goal id; do not re-run architect unless the goal contract itself is wrong.`
    )
  }

  async function switchExplicitBuildTaskToDirectWorkflow(attachedGoalID?: string): Promise<void> {
    if (attachedGoalID) return
    if (!input.workflowState) return
    if (input.workflow?.id !== "pipeline") return

    const task = requireTask(taskID)
    if (task.kind !== "build") return
    if (findActivePlanForTask(task.id) || findActiveRunForTask(task.id)) return
    if (listGoals(taskID).length > 0) return

    const direct = WorkflowRegistry.resolveSync("direct")
    if (!direct) return

    const nextState = createWorkflowState(direct)
    input.workflow = direct
    input.workflowState = nextState

    // Phase-6-f-3-bis-b: workflow selection is no longer persisted on
    // engine_task. Explicit kind=build tasks resolve to the direct workflow
    // on each wake, so this in-memory switch only keeps the current prompt
    // and overlay event aligned when a custom default started as pipeline.
    void task
    EngineProtocol.emit(EngineEvent.WorkflowSelected, {
      taskID,
      workflowID: direct.id,
      workflowName: direct.name,
      summary: `Workflow "${direct.name}" selected`,
    })
  }

  // ── Workflow step tracking — event-emit only (rule 23) ──
  //
  // History: trackStepStart/Complete used to mutate ws.taskSteps[].status
  // and walk ws.currentStepID forward — a coded FSM. Step status is now
  // projected from artifacts (workflow.ts::projectTaskSteps reads decision
  // log / spec snapshot / goals / runs / deliveries), so the cells were
  // pure duplication. Both functions are now thin event emitters: overlay
  // still gets live `running` / `completed` / `failed` transitions via
  // WorkflowStepUpdated, but no parallel state is maintained server-side.

  async function trackStepStart(toolName: string, goalID?: string): Promise<void> {
    if (!input.workflow) return
    const step = findStepByTool(input.workflow, toolName)
    if (!step) return
    try {
      EngineProtocol.emit(EngineEvent.WorkflowStepUpdated, {
        taskID,
        stepID: step.id,
        goalID,
        status: "running",
        summary: `Step "${step.label}" started`,
      })
    } catch {
      /* best effort */
    }
  }

  async function trackStepComplete(toolName: string, goalID?: string, failed = false): Promise<void> {
    if (!input.workflow) return
    const step = findStepByTool(input.workflow, toolName)
    if (!step) return
    const status = failed ? ("failed" as const) : ("completed" as const)
    try {
      EngineProtocol.emit(EngineEvent.WorkflowStepUpdated, {
        taskID,
        stepID: step.id,
        goalID,
        status,
        summary: `Step "${step.label}" ${status}`,
      })
    } catch {
      /* best effort */
    }
  }

  async function createExecutionRunRecord() {
    const task = requireTask(taskID)
    const dbGoals = listGoals(taskID)
    if (dbGoals.length === 0) return { error: "No goals found. Run requirements first." } as const
    const activeSpec = findActiveSpecForTask(taskID)
    if (!activeSpec) {
      return { error: "No active spec snapshot found. Run architect before creating an execution run." } as const
    }

    const now = Date.now()
    const executor = task.executor
    const sessionID = task.session_id!
    const planID = Identifier.ascending("plan")
    const { EnginePlanVersionTable, EnginePlanNodeTable, EngineGoalTable } = await import("@/engine/engine.sql")

    Database.transaction((db) => {
      // Single-active-plan invariant: retire every prior active plan for this
      // task before inserting the new one. Without this, restart_from_stage
      // (executor) → second createExecutionRunRecord call would leave two rows
      // with status='active' / version=1; findActivePlanForTask's
      // `ORDER BY version DESC LIMIT 1` then returns whichever rowid wins the
      // tie (typically the older row, whose goals were re-pointed to the new
      // plan), and the board loads zero goals.
      supersedePriorActivePlansForTask(db, { taskID, now })
      db.insert(EnginePlanVersionTable)
        .values({
          id: planID,
          task_id: taskID,
          spec_snapshot_id: activeSpec.id,
          version: 1,
          status: "active",
          summary: `${dbGoals.length} goals`,
          prompt: task.request,
          metadata: {},
          time_created: now,
          time_updated: now,
        })
        .run()

      const goalToPlanNode = new Map<string, string>()
      const planNodeIDs: string[] = []
      for (const goal of dbGoals) {
        const pnID = Identifier.ascending("plan_node")
        planNodeIDs.push(pnID)
        goalToPlanNode.set(goal.id, pnID)
      }

      for (const [index, goal] of dbGoals.entries()) {
        const resolvedDeps = (goal.depends_on ?? []).flatMap((depGoalID: string) => {
          const pnID = goalToPlanNode.get(depGoalID)
          if (!pnID) {
            log.warn("create_run: goal.depends_on references unknown goal ID — dropping", {
              goalID: goal.id,
              goalTitle: goal.title,
              unknownDep: depGoalID,
            })
          }
          return pnID ? [pnID] : []
        })

        db.insert(EnginePlanNodeTable)
          .values({
            id: planNodeIDs[index],
            task_id: taskID,
            plan_version_id: planID,
            kind: "goal",
            goal_id: goal.id,
            title: goal.title,
            brief: renderSpecsAsText((goal.acceptance_specs ?? []) as AcceptanceSpec[]),
            depends_on_ids: resolvedDeps.length > 0 ? resolvedDeps : undefined,
            order_index: index,
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
      }

      for (const goal of dbGoals) {
        db.update(EngineGoalTable)
          .set({ plan_version_id: planID, time_updated: now })
          .where(eq(EngineGoalTable.id, goal.id))
          .run()
      }
    })

    const { createRun } = await import("@/engine/writer")
    const created = createRun({
      taskID,
      planVersionID: planID,
      sessionID,
      executor,
      status: "queued",
      phase: "dispatch",
      summary: `create_run: ${dbGoals.length} goals queued`,
      now,
    })
    const runID = created.id

    await updateTask(
      requireTask(taskID),
      {
        status: "active",
      },
      `create_run: planID=${planID} runID=${runID}`,
    )

    return { runID, planID, goalsCount: dbGoals.length } as const
  }

  async function ensureDispatchableRunForSingleGoal() {
    let task = requireTask(taskID)
    let createdRun = false
    let activatedRun = false

    if (!findActiveRunForTask(task.id)) {
      const created = await createExecutionRunRecord()
      if ("error" in created) return { error: created.error } as const
      createdRun = true
      task = requireTask(taskID)
    }

    let run = findActiveRunForTask(task.id)
    if (!run || !run.plan_version_id || !isLiveRunStatus(run.status)) {
      const created = await createExecutionRunRecord()
      if ("error" in created) return { error: created.error } as const
      createdRun = true
      task = requireTask(taskID)
      run = requireRun(created.runID)
    }

    const planVersionID = run.plan_version_id
    if (!planVersionID) {
      return { error: `Run ${run.id} has no plan_version_id. Create a fresh run before dispatching goals.` } as const
    }

    let plan = findPlan(planVersionID)
    if (!plan) {
      return { error: `No plan found for run ${run.id}. Create a fresh run before dispatching goals.` } as const
    }

    if (run.status === "queued") {
      await updateTask(task, { status: "active", error: null }, "Execution submitted")
      await updateRun(run, { status: "running" }, "Execution submitted")
      activatedRun = true
      task = requireTask(taskID)
      run = requireRun(run.id)
      plan = findPlan(planVersionID) ?? plan
    }

    if (!isRunReadyForGoalDispatch({ status: run.status, planVersionID: run.plan_version_id })) {
      return {
        error: `Run ${run.id} is ${run.status}. Only accepted/running/blocked runs may dispatch goals. Create a fresh run if this one is terminal.`,
      } as const
    }

    return { task, run, plan, createdRun, activatedRun } as const
  }

  async function ensureTaskLevelBuildRun() {
    const task = requireTask(taskID)
    const existing = findActiveRunForTask(task.id)
    if (existing && isLiveRunStatus(existing.status)) return existing

    const { createRun } = await import("@/engine/writer")
    const now = Date.now()
    const created = createRun({
      taskID,
      planVersionID: null,
      sessionID: task.session_id ?? null,
      executor: task.executor,
      status: "running",
      phase: "execute",
      summary: "direct build run created",
      now,
    })
    await updateTask(
      requireTask(taskID),
      {
        status: "active",
        error: null,
      },
      `direct_build_run: runID=${created.id}`,
    )
    return created
  }

  /** ensureGoalInWorkflow was the workflow_state.goalSteps pre-allocator. The
   *  shadow table is gone — goal step status is derived from engine_goal_run
   *  at read time. This remains as a no-op for callers still referencing it;
   *  those call sites will be removed as the architecture settles. */
  function ensureGoalInWorkflow(_goalID: string, _goalTitle: string): void {
    // intentional no-op: see workflow.ts::projectGoalSteps
  }

  // Architecture review findings are actionable feedback: the review itself does not rewrite requirements or goals, and the orchestrator chooses the next repair lane from durable decision-log context.
  function renderIntegrityOutcome(outcome: IntegrityReviewOutcome) {
    if (outcome.status === "blocked") {
      return SubAgentProtocol.yieldResult({
        headline: outcome.headline,
        pointer: outcome.pointer,
      })
    }
    if (outcome.status === "reviewed") {
      const headline =
        outcome.verdict === "pass"
          ? `Integrity verdict: pass — ${outcome.perDimension.join(", ")}. ` +
            `Review is advisory; orchestrator decides next step (deliver / build per goal / architect / fail_task).`
          : `Integrity verdict: ${outcome.verdict} — ${outcome.perDimension.join(", ")}. ` +
            `Review is advisory: nothing in code supersedes goals, opens new attempts, or mutates the graph based on this verdict. ` +
            `Read the full markdown below and choose modify_goal / build({goalID}) / architect / deliver / fail_task explicitly.`
      return SubAgentProtocol.yieldResult({
        headline,
        fields: [
          ["goal_count", String(outcome.goalCount)],
          ["spec_snapshot_id", outcome.specSnapshotID],
          ["per_dimension", outcome.perDimension],
          ["corrections_count", String(outcome.correctionsCount)],
          ["graph_corrections_count", String(outcome.graphCorrectionsCount)],
          ["missing_count", String(outcome.missingCount)],
          ["summary", outcome.summary],
          // Full review text — every issue, every correction proposal,
          // every missing-goal proposal, with goal_ids preserved.
          ["review_markdown", outcome.markdown],
        ],
        pointer: `integrity session ${outcome.sessionID}`,
      })
    }
    throw new Error(`Unknown integrity outcome: ${(outcome as { status?: string }).status ?? "unknown"}`)
  }

  async function runIntegrityReview(): Promise<IntegrityReviewOutcome> {
    const task = requireTask(taskID)
    const activeSpec = findActiveSpecForTask(task.id)
    if (!activeSpec) {
      return {
        status: "blocked",
        headline: "integrity: no active spec snapshot — call `architect` first.",
        pointer: `task ${taskID}`,
      }
    }
    const dbGoals = listGoals(taskID).filter((g) => g.spec_snapshot_id === activeSpec.id)
    if (dbGoals.length === 0) {
      return {
        status: "blocked",
        headline: "integrity: no goals on the active spec snapshot — call `architect` first.",
        pointer: `spec ${activeSpec.id}`,
      }
    }

    const singleflightKey = `${task.id}:${activeSpec.id}`
    const inflight = integrityReviewSingleflight.get(singleflightKey)
    if (inflight) return inflight

    const reviewPromise = runIntegrityReviewOnce({ task, activeSpec, dbGoals })
    integrityReviewSingleflight.set(singleflightKey, reviewPromise)
    try {
      return await reviewPromise
    } finally {
      if (integrityReviewSingleflight.get(singleflightKey) === reviewPromise) {
        integrityReviewSingleflight.delete(singleflightKey)
      }
    }
  }

  async function runIntegrityReviewOnce(ctx: {
    task: TaskRow
    activeSpec: NonNullable<ReturnType<typeof findActiveSpecForTask>>
    dbGoals: ReturnType<typeof listGoals>
  }): Promise<IntegrityReviewOutcome> {
    const { task, activeSpec, dbGoals } = ctx

    const { findRequirements } = await import("@/engine/store")
    const reqRows = findRequirements(activeSpec.id)
    const requirements = reqRows.map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>
      const sourceID = typeof meta.source_requirement_id === "string" ? meta.source_requirement_id : r.id
      return {
        id: sourceID,
        type: (r.priority === "advisory" ? "implicit" : "explicit") as "explicit" | "implicit",
        description: r.description,
      }
    })
    const decisionLog = createDecisionLog(taskID)
    const requirementDecisions = decisionLog.readByPhase("requirements").map((d) => ({
      key: d.key,
      value: d.value,
      reason: d.reason,
    }))

    const goalsForReview = dbGoals.map((g) => ({
      id: g.id,
      title: g.title,
      objective: g.objective,
      acceptance_specs: (typeof g.acceptance_specs === "string"
        ? JSON.parse(g.acceptance_specs)
        : (g.acceptance_specs ?? [])) as AcceptanceSpec[],
      owned_paths: typeof g.owned_paths === "string" ? JSON.parse(g.owned_paths) : (g.owned_paths ?? []),
      depends_on: typeof g.depends_on === "string" ? JSON.parse(g.depends_on) : (g.depends_on ?? []),
      priority: g.priority as "blocking" | "advisory",
      kind: g.kind,
      requirement_ids:
        typeof g.requirement_ids === "string" ? JSON.parse(g.requirement_ids) : (g.requirement_ids ?? []),
    }))

    const { reviewIntegrity, computeRequirementStatusSnapshot } = await import("@/integrity")
    // Project REQ status from DB BEFORE the review fires. The host does not
    // pre-compute completion verdicts (rule 6.1) — it only lays out raw
    // claiming-goal × tip-run × per-spec evidence; the LLM walks it inside
    // the prompt. An empty snapshot (pre-build, or no REQs at all) is the
    // signal that the prompt's Requirement Status Snapshot section should
    // not render — handled in buildIntegrityPrompt.
    const requirementStatus = computeRequirementStatusSnapshot({
      taskID,
      specSnapshotID: activeSpec.id,
    })
    // Phase classification: post_build iff at least one claiming goal has a
    // tip run whose status is TERMINAL (`completed | failed | aborted`). A
    // queued / running / blocked tip means the build is still in flight —
    // its evidence is incomplete and integrity has nothing real to judge
    // beyond the structural decomposition. Treating in-flight runs as
    // post_build would let the delivery freshness gate accept attempts that
    // were taken mid-build, which is what codex review §6.4 #8 flagged.
    // Per @/engine/catalog GOAL_RUN_STATUS_CATALOG: completed = terminal,
    // failed/aborted = retriable, everything else = live.
    const TERMINAL_RUN_STATUSES = new Set<string>(["completed", "failed", "aborted"])
    const phase: "pre_build" | "post_build" = requirementStatus.some((r) =>
      r.claimingGoals.some((g) => TERMINAL_RUN_STATUSES.has(g.runStatus)),
    )
      ? "post_build"
      : "pre_build"
    const contractGraph = findLatestArchitectContractGraph(taskID)
    if (!contractGraph) {
      throw new Error(
        `Cannot run integrity review for task ${taskID}: missing architect_contract_graph artifact. ` +
          `Run Architect again so graph contracts and dependency reasons are available.`,
      )
    }

    const verdict = await reviewIntegrity({
      userRequest: task.request,
      taskTitle: task.title,
      goals: goalsForReview,
      requirements,
      requirementDecisions,
      requirementStatus,
      designSpecs: Array.isArray(task.design_specs) ? (task.design_specs as any) : undefined,
      contractGraph,
      decisionLog,
      attachments: Array.isArray(task.attachments) ? (task.attachments as any) : undefined,
      signal: input.signal,
      taskID,
      parentSessionID: input.agentSessionID,
    })

    const perDimensionRollup = verdict.dimensions.map((d) => ({ id: d.id, verdict: d.verdict }))
    const perDimensionLabels = verdict.dimensions.map((d) => `${d.id}=${d.verdict}`)
    const { recordIntegrityAttempt } = await import("@/engine/persist")

    const markdown = renderIntegrityMarkdown({ verdict, sessionID: verdict.sessionID })
    try {
      recordIntegrityAttempt({
        taskID,
        sessionID: verdict.sessionID,
        specSnapshotID: activeSpec.id,
        verdict: verdict.verdict,
        phase,
        perDimension: perDimensionRollup,
        issuesCount: verdict.issues.length,
        correctionsCount: verdict.corrections.length + verdict.graphCorrections.length,
        missingCount: verdict.missingGoals.length,
        reason: verdict.summary,
        reviewMarkdown: markdown,
        corrections: verdict.corrections.map((c) => ({
          action: c.action,
          goalID: c.goalID,
          reason: c.reason,
            updates: c.updates as Record<string, unknown> | undefined,
          })),
        graphCorrections: verdict.graphCorrections,
        missingGoals: verdict.missingGoals,
      })
    } catch (err) {
      log.error("integrity: recordIntegrityAttempt failed", {
        taskID,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    // Append a compact decision_log row so the orchestrator's read_context
    // automatically surfaces the accumulated review history (latest 20
    // entries, ≤ 600 chars per value). The full review_markdown stays in
    // engine_artifact for one-shot fidelity; this row is the cumulative
    // signal the orchestrator LLM needs to spot recurring issues across
    // multiple post-build reviews — same issues reappearing means the
    // current goal graph cannot absorb them and architect re-run / fail_task
    // becomes the cheaper repair (per orchestrator-core.txt's repair ladder).
    try {
      const dimSummary = verdict.dimensions
        .map(
          (d) =>
            `${d.id}:${d.verdict}(${d.issues.length}i/${d.corrections.length}c/${d.graphCorrections.length}gc/${d.missingGoals.length}m)`,
        )
        .join(", ")
      const topIssues = verdict.issues
        .slice(0, 5)
        .map((i) => `[${i.type}] ${i.description}`)
        .join("; ")
      const issueTail = verdict.issues.length > 5 ? ` (+${verdict.issues.length - 5} more in engine_artifact)` : ""
      const value =
        `verdict=${verdict.verdict} | dims=${dimSummary} | counts=${verdict.issues.length}i/${verdict.corrections.length}c/${verdict.graphCorrections.length}gc/${verdict.missingGoals.length}m` +
        (verdict.summary ? ` | summary=${verdict.summary}` : "") +
        (topIssues ? ` | top: ${topIssues}${issueTail}` : "")
      decisionLog.append({
        phase: "review",
        key: `review_${verdict.verdict}_${verdict.sessionID}`,
        value,
        reason: "post-build architecture_review",
      })
    } catch (err) {
      log.warn("integrity: decision_log review append failed (non-fatal)", {
        taskID,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return {
      status: "reviewed",
      specSnapshotID: activeSpec.id,
      verdict: verdict.verdict,
      summary: verdict.summary,
      sessionID: verdict.sessionID,
      goalCount: goalsForReview.length,
      correctionsCount: verdict.corrections.length,
      graphCorrectionsCount: verdict.graphCorrections.length,
      missingCount: verdict.missingGoals.length,
      perDimension: perDimensionLabels.map(
        (label, index) => `${label}(${verdict.dimensions[index]?.issues.length ?? 0}issues)`,
      ),
      markdown,
      dimensions: verdict.dimensions,
      corrections: verdict.corrections,
      graphCorrections: verdict.graphCorrections,
      missingGoals: verdict.missingGoals,
    }
  }

  // (removed) postBuildReviewReworkGoalIDs / dependentGoalClosure /
  // openArchitectureReviewRework / architecture_review_rework — these were the auto-supersede +
  // auto-startNewAttempt + dependent-cascade chain that violated
  // CLAUDE.md rule 13 (no state-machine flow control). The orchestrator LLM
  // now reads the full review markdown returned in the build tool result
  // and chooses modify_goal / build({goalID}) / architect / fail_task /
  // deliver itself. spec architecture-rework-loosening-plan-2026-05-06.md
  // (B12 / B13 / B14).

  async function restartTaskFromStage(stage: RestartStage, reason: string) {
    const task = requireTask(taskID)
    const activePlanAtStart = findActivePlanForTask(task.id)
    const activeSpecAtStart = findActiveSpecForTask(task.id)
    const plan = restartStagePlan(stage, Boolean(activePlanAtStart))
    const now = Date.now()
    const runError = `restart_from_stage(${stage}): ${reason}`
    const { EngineGoalTable, EnginePlanVersionTable, EngineSpecSnapshotTable } = await import("@/engine/engine.sql")
    const { abortLiveExecutionForTask, createRun } = await import("@/engine/writer")

    const aborted = await abortLiveExecutionForTask({
      taskID,
      reason: runError,
      includeGoalRuns: plan.retireGoalRuns,
    })
    const retiredGoalRuns = aborted.goalRuns
    const retiredRuns = aborted.runs

    let resetGoals = 0
    let deletedGoals = 0
    let freshRun: { id: string } | null = null

    if (plan.resetGoalStatuses) {
      const { resetTaskGoalsToPending } = await import("@/engine/persist")
      const result = resetTaskGoalsToPending({
        taskID,
        reason: runError,
        now,
      })
      resetGoals = result.total
    }

    Database.transaction((db) => {
      if (plan.deleteGoals) {
        const rows = db
          .select({ id: EngineGoalTable.id })
          .from(EngineGoalTable)
          .where(eq(EngineGoalTable.task_id, taskID))
          .all()
        deletedGoals = rows.length
        if (deletedGoals > 0) {
          db.delete(EngineGoalTable).where(eq(EngineGoalTable.task_id, taskID)).run()
        }
      }

      if (plan.clearPlan) {
        // Single-active-plan invariant: retire every active plan for this
        // task, not just the row findActivePlanForTask returned. If a prior
        // bug left multiple rows with status='active', narrowing supersede
        // to one id would leave the others lingering and reproduce the
        // empty-board symptom on the next read.
        supersedePriorActivePlansForTask(db, { taskID, now })
      }

      if (plan.clearSpec && activeSpecAtStart) {
        db.update(EngineSpecSnapshotTable)
          .set({ status: "superseded", time_updated: now })
          .where(eq(EngineSpecSnapshotTable.id, activeSpecAtStart.id))
          .run()
      }
    })

    if (plan.queueFreshRun && activePlanAtStart) {
      const executor = task.executor
      freshRun = createRun({
        taskID,
        planVersionID: activePlanAtStart.id,
        sessionID: task.session_id ?? null,
        executor,
        status: "queued",
        phase: "dispatch",
        metadata: { restart_stage: stage },
        summary: `restart_from_stage(${stage}): fresh run queued`,
        now,
      })
    }

    const currentTask = requireTask(taskID)
    await updateTask(
      currentTask,
      {
        status: "active",
        error: null,
      },
      `restart_from_stage(${stage})`,
    )
    const freshRunID = freshRun?.id ?? null

    const detail = [
      deletedGoals > 0 ? `${deletedGoals} goal(s) deleted` : null,
      resetGoals > 0 ? `${resetGoals} goal(s) reset to pending` : null,
      retiredGoalRuns > 0 ? `${retiredGoalRuns} goal_run(s) aborted` : null,
      retiredRuns > 0 ? `${retiredRuns} run(s) aborted` : null,
      freshRunID ? `fresh queued run=${freshRunID}` : null,
    ]
      .filter(Boolean)
      .join(", ")

    return `Task restarted from ${stage}. Reason: ${reason}. ${detail || "State cleared."} NEXT: ${plan.nextAction}${freshRunID ? `(${freshRunID})` : ""}.`
  }

  // Agents that need to ask the user a question do so directly via
  // `Question.ask`. Workflow steps never pause for input here.

  const tools = {
    requirements: tool({
      description:
        "OPTIONAL stage agent. Parse the user's task into REQ-N requirements plus " +
        "foundational technical decisions (runtime, framework, test strategy, " +
        "package_manager, communication_protocol). Goal decomposition / metric specs / " +
        "challenge seeds / traceability / cross-goal contracts are all produced by " +
        "the Architect — do NOT expect them from this step.\n\n" +
        "USE WHEN: the work is multi-file with implicit acceptance criteria, OR you " +
        "intend to call `architect` next (architect needs the REQ-N rows), OR " +
        "foundational decisions are ambiguous and the build agent would otherwise " +
        "guess.\n" +
        "SKIP WHEN: trivial direct edit (single-file bug fix, typo / config tweak); " +
        "build agent can run against the user's text alone and `deliver` has enough " +
        "signal in the request to verify. For visual/reference tasks, design_analysis is a hard prerequisite: " +
        "do not call requirements until design_analysis has persisted PRD/SPEC review entries.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to analyze requirements"),
      }),
      execute: async () => {
        let task = requireTask(taskID)
        log.info("requirements guard check", { taskID, hasSpec: !!findActiveSpecForTask(task.id) })
        // Rule 23: no status gate. LLM may choose to re-parse requirements
        // (supersedes the prior spec and inserts a new v1 snapshot).

        const designGate = requireDesignAnalysisBefore("requirements", task)
        if (designGate) return designGate

        await trackStepStart("requirements")
        task = await updateTask(task, { status: "active" }, "Requirements analysis started")
        // Single session per sub-agent (rule 22). RequirementsAgent.run
        // creates the runner session internally; the orchestrator captures
        // its id via onSessionCreated so SSE completion events attribute
        // to the same session the overlay already shows. The previous
        // wrapper session here was a second card with no content, just to
        // give the catch block an id to emit on — replaced by `runnerSessionID`
        // captured below.
        let runnerSessionID: string | undefined
        try {
          const { RequirementsAgent } = await import("@/requirements")
          const { createDecisionLog } = await import("@/decision-log")
          const decisionLog = createDecisionLog(taskID)
          const designAnalysis = renderDesignAnalysisHandoffReference(taskID)

          // Stage-level retry was removed in step 5/7 (rule 8 — single
          // source). Transient LLM-call failures are now retried inside
          // withLLMActivity per the LLMActivityPolicy on the processor's
          // session. A stage-level "rerun the whole agent from scratch"
          // wrapper on top duplicated the responsibility and silently
          // turned activity-level retry budgets into multiplied attempts
          // (a 5-retry policy under a 2-retry stage wrapper meant up to
          // 18 actual provider hits per logical requirements run).
          const result = await RequirementsAgent.run({
            title: task.title,
            request: task.request,
            attachments: Array.isArray(task.attachments) ? (task.attachments as any) : undefined,
            designSpecs: Array.isArray(task.design_specs) ? (task.design_specs as any) : undefined,
            designAnalysis: designAnalysis.trim().length > 0 ? designAnalysis : undefined,
            taskID,
            parentSessionID: input.agentSessionID,
            signal: input.signal,
            decisionLog,
            onStatus: () => {},
            onSessionCreated: (id) => {
              runnerSessionID = id
            },
          })
          if (result.requirements.length === 0) {
            // Same contract the old RequirementsService enforced: an empty
            // REQ-N list means requirements did not converge. Surface it as
            // a hard error so the orchestrator can re-run / fail the task.
            throw new Error("requirements agent produced no REQ-N entries")
          }

          // Persist spec snapshot v1 (requirements + decisions only; the
          // Architect produces v2 with goals/traceability/contracts).
          const { insertRequirements } = await import("@/engine/persist")
          const { EngineSpecSnapshotTable } = await import("@/engine/engine.sql")
          const now = Date.now()
          const specSnapshotID = Identifier.ascending("spec")

          const specContent = [
            `# ${task.title}`,
            "",
            result.summary,
            "",
            "## Requirements",
            ...result.requirements.map((r) => `- **${r.id}** [${r.type}]: ${r.description}`),
            "",
            "## Decisions",
            ...result.decisions.map((d) => `- **${d.key}** = ${d.value} — ${d.reason}`),
          ].join("\n")

          try {
            Database.transaction((db) => {
              // Phase-6-f-5: maintain the "at most one non-superseded spec per
              // task" invariant explicitly. Previously this was tracked via
              // task.active_spec_version_id; now findActiveSpecForTask derives
              // from spec.status != 'superseded', so writers must supersede
              // prior specs before inserting a new one.
              db.update(EngineSpecSnapshotTable)
                .set({ status: "superseded", time_updated: now })
                .where(
                  and(
                    eq(EngineSpecSnapshotTable.task_id, taskID),
                    sql`${EngineSpecSnapshotTable.status} != 'superseded'`,
                  ),
                )
                .run()
              db.insert(EngineSpecSnapshotTable)
                .values({
                  id: specSnapshotID,
                  task_id: taskID,
                  version: 1,
                  status: "ready",
                  summary: result.summary,
                  content: specContent,
                  scope: result.requirements.map((r) => r.description).join("; "),
                  time_created: now,
                  time_updated: now,
                })
                .run()

              if (result.requirements.length > 0) {
                insertRequirements(db, {
                  taskID,
                  specSnapshotID,
                  requirements: result.requirements.map((r) => ({
                    id: r.id,
                    title: r.description,
                    description: r.description,
                    acceptance: [] as string[],
                    evidence_refs: [] as string[],
                    priority: r.type === "explicit" ? ("blocking" as const) : ("advisory" as const),
                  })),
                  now,
                })
              }

              db.update(EngineTaskTable)
                .set({
                  time_updated: now,
                })
                .where(eq(EngineTaskTable.id, taskID))
                .run()
              Database.effect(() =>
                EngineProtocol.emit(
                  EngineEvent.TaskUpdated,
                  { taskID, status: deriveTaskStatus(task), summary: "Requirements parsed" },
                  { source: "orchestrator.requirements" },
                ),
              )
            })
          } catch (dbErr) {
            log.error("requirements: failed to persist to DB", {
              taskID,
              error: dbErr instanceof Error ? dbErr.message : String(dbErr),
              stack: dbErr instanceof Error ? dbErr.stack : undefined,
            })
            throw dbErr
          }
          await trackStepComplete("requirements")

          // Card terminal status flows through session.status from
          // session/prompt.ts; counts on the Panel are derived from
          // boardStore. No phase-completed bus event needed.

          return SubAgentProtocol.yieldResult({
            headline: `SUCCESS: ${result.requirements.length} requirements, ${result.decisions.length} decisions parsed. NEXT: call architect to decompose into goals.`,
            summary: result.summary,
            fields: [
              ["decisions", result.decisions.map((d) => `${d.key}=${d.value}`)],
              ["requirements", String(result.requirements.length)],
            ],
            pointer: `read_context scope=decisions (spec ${specSnapshotID})`,
          })
        } catch (err) {
          // Card terminal flows through session.status (the runner session's
          // actor close path emits {type:"terminal", reason:"error"}); the
          // error message itself surfaces via the thrown error in the
          // orchestrator's tool result. No phase-completed bus event needed.
          //
          // Workflow.step.requirements must flip to `failed` (not stay
          // `running` forever) so the overlay shows the failure and the
          // operator can see WHICH stage broke. trackStepComplete is best-
          // effort (it swallows its own errors) so wrapping it in try/catch
          // here is intentional belt-and-braces (rule 1 / rule 7).
          try {
            await trackStepComplete("requirements", undefined, true)
          } catch (trackErr) {
            log.warn("requirements: trackStepComplete(failed) emit failed", {
              taskID,
              error: trackErr instanceof Error ? trackErr.message : String(trackErr),
            })
          }
          // P4 (rule 4 — same systemic shape as analyze_intent / design_analysis
          // catch paths): write decision_log so downstream agents see WHY
          // requirements failed instead of silently inheriting an empty
          // requirements set. Without this the abort surfaces only as a
          // thrown tool result the orchestrator may swallow during recovery.
          try {
            const { createDecisionLog } = await import("@/decision-log")
            const reason = err instanceof Error ? err.message : String(err)
            createDecisionLog(taskID).append({
              phase: "requirements",
              key: "abort_requirements_failed",
              value: `Requirements stage aborted: ${reason.slice(0, 400)}`,
              reason: "requirements_threw",
            })
          } catch (logErr) {
            log.warn("requirements: decision_log write failed (non-fatal)", {
              taskID,
              error: logErr instanceof Error ? logErr.message : String(logErr),
            })
          }
          throw err
        } finally {
          // No caller-level guard: the pre-migration runtime enforces progress/absolute timeouts.
        }
      },
    }),

    // -----------------------------------------------------------------------
    // Design Analysis — visual reference analysis before decomposition
    // -----------------------------------------------------------------------

    design_analysis: tool({
      description: [
        "Analyze visual/webpage references (images, URLs, Figma, materials) to produce a mirror-grounded PRD/SPEC with a visual-consistency contract.",
        "Call this BEFORE every other downstream agent when the task involves frontend/UI development AND:",
        "  - Image attachments are provided (screenshots, mockups, design files)",
        "  - The request mentions a URL to replicate or analyze",
        "  - The request explicitly asks for layout/design analysis",
        "",
        "The design-analysis agent must iterate the PRD/SPEC at least twice before handoff.",
        "The full PRD/SPEC plus visual_consistency_spec and iteration/completeness review is persisted",
        "into the decision log from the same design-analysis run. Optional task.design_specs rows may exist as anchors, but the",
        "decision-log PRD/SPEC is authoritative. The decision log also includes evidence_source_manifest,",
        "which names the source files, images, URLs, materialized artifacts, and mirror artifacts downstream stages can read so they",
        "consume one source of truth instead of re-running mirror extraction.",
        "",
        "SKIP this step when:",
        "  - No visual references are available",
        "  - The task is purely backend/API/infrastructure",
        "  - The request already contains detailed design specifications",
      ].join("\n"),
      inputSchema: z.object({
        reason: z.string().describe("Why design analysis is needed for this task"),
        url: z.string().optional().describe("Deprecated — use `urls`. Single URL for back-compat; merged into `urls`."),
        urls: z
          .array(z.string())
          .optional()
          .describe(
            "Any number of design-reference URLs: live pages, design-tool share links " +
              "(Sketch Cloud / Adobe XD / Framer / InVision / Zeplin / Penpot), docs, etc. " +
              "Non-Figma URLs are available to design-analyst for mirror extraction and may also be materialized " +
              "as screenshot references. Figma URLs use the connected Figma MCP path. Do not route URL/page extraction to build.",
          ),
        figma_url: z
          .string()
          .optional()
          .describe(
            "Figma file URL materialized through the connected Figma MCP server (figma.com/file/... or figma.com/design/...). " +
              "Requires Figma MCP tools get_design_context, get_screenshot, get_metadata, and get_variable_defs.",
          ),
        materials: z
          .array(z.string())
          .optional()
          .describe(
            "Local design-material paths (relative to project root, or absolute under it). " +
              "Supported: images, PDFs, markdown/text style guides, design-tokens JSON, CSS. " +
              "Each is read from disk and materialized into the attachment store as a visual_reference " +
              "so it flows through the same multimodal / read_attachment pipeline as user uploads.",
          ),
      }),
      execute: async ({ reason, url, urls, figma_url, materials }) => {
        const task = requireTask(taskID)

        // Guard: skip if no visual input available. Figma URL counts as visual.
        const hasAttachments = Array.isArray(task.attachments) && task.attachments.length > 0
        // Auto-detect: any `figma.com` URL passed via `url` / `urls` is
        // treated as a Figma URL (uses Figma MCP instead of screenshot).
        const meta = (task.metadata as Record<string, unknown> | null) ?? {}
        const metaFigma = typeof meta.figma_url === "string" ? meta.figma_url : undefined
        const inputUrls = [...(url ? [url] : []), ...(Array.isArray(urls) ? urls : [])].filter(
          (u) => typeof u === "string" && u.length > 0,
        )
        const figmaUrls = [
          ...(figma_url ? [figma_url] : []),
          ...(metaFigma ? [metaFigma] : []),
          ...inputUrls.filter((u) => isFigmaUrl(u)),
        ]
        const liveUrls = inputUrls.filter((u) => !isFigmaUrl(u))
        const materialPaths = Array.isArray(materials)
          ? materials.filter((m) => typeof m === "string" && m.length > 0)
          : []
        if (!hasAttachments && liveUrls.length === 0 && figmaUrls.length === 0 && materialPaths.length === 0) {
          // P4: decision_log entry before throw so downstream stage agents
          // (architect / build) see the abort cause via TaskContext.snapshot
          // and upstream-context.ts. Without this, the abort surfaces only
          // as a stderr WARN and design_specs stays undefined with no
          // explanation in any prompt (audit §11.3 / L3).
          try {
            const { createDecisionLog } = await import("@/decision-log")
            createDecisionLog(taskID).append({
              phase: "design_analysis",
              key: "abort_no_visual_input",
              value:
                "Design analysis aborted before agent call: caller provided no visual reference (no attachments, no url, no figma_url, no materials).",
              reason: "no_visual_input_provided",
            })
          } catch (logErr) {
            log.warn("design_analysis: decision_log write failed (non-fatal)", {
              taskID,
              error: logErr instanceof Error ? logErr.message : String(logErr),
            })
          }
          throw new Error(
            "Design analysis requires at least one real visual reference: image attachment, URL, Figma URL, or local material path.",
          )
        }

        await trackStepStart("design_analysis")

        log.info("design_analysis: starting", {
          taskID,
          hasAttachments,
          liveUrlCount: liveUrls.length,
          figmaUrlCount: figmaUrls.length,
          materialCount: materialPaths.length,
          reason,
        })

        // Reference materialization: every external design source (Figma
        // frame, URL-screenshot, local file) gets pulled, written to
        // AttachmentStore, and registered on the task. Two destination
        // columns:
        //   • Figma MCP references → attachments (figma URL is part of the
        //     user contract — the user pointed us at it).
        //   • URL screenshots / local materials → system_artifacts (we
        //     captured them ourselves to feed design-analyst; not user
        //     intent — keeping them out of attachments prevents requirements
        //     from treating system-generated PNGs as user input).
        //
        // design-analyst combines both columns when assembling its visual
        // input. The deliver-time visual diff also reads both. Requirements
        // reads only attachments — it must see user intent, not internal
        // captures.
        const { AttachmentStore } = await import("@/storage/attachment-store")
        const fsMod = await import("node:fs/promises")
        const pathMod = await import("node:path")

        // Track how many external sources actually produced visual bytes. If
        // every URL screenshot and local material fails to
        // materialize AND the task had no pre-existing attachments, we must
        // abort before calling design-analyst — otherwise the agent runs
        // blind, registers nothing, and the orchestrator hangs waiting for
        // a design spec that cannot exist. See benchmark run on
        // usage-replica-vague: assistant hallucinated ./image-N.png paths,
        // all 3 ENOENT'd, design-analyst still ran for 45s producing
        // nothing, and the pipeline stalled on the empty verdict.
        let materializedCount = 0

        // --- Figma MCP references --------------------------------------------
        for (const figmaUrl of figmaUrls) {
          materializedCount += await materializeFigmaMcpReference({
            taskID,
            projectID: Instance.project.id,
            figmaUrl,
          })
          log.info("design_analysis: figma MCP reference materialized", {
            taskID,
            figmaUrl,
          })
        }

        // --- Generic URL screenshots -----------------------------------------
        // Any non-Figma URL is rendered in Chromium so design-tool
        // share links (Sketch Cloud, Adobe XD, Framer, InVision, Zeplin, …)
        // and plain live pages contribute pixel references, not just markup.
        //
        // P0-A: 每张 reference PNG 都必须通过 captureReferenceManifest + gate。
        // 伪造 / 空白 / 阈值不达标的图直接抛 CaptureGateError，向上冒泡让
        // design_analysis 失败——禁止"网页访问不到就退回 visual contract 文本"
        // （spec rule 1）。浏览器/网络异常（非 gate violation）仍 warn+continue
        // 因为那是外部资源问题不是 reference 真实性问题。
        for (const liveUrl of liveUrls) {
          try {
            const { captureReferenceManifest, enforceCaptureGate, summarizeCaptureViolations, CaptureGateError } =
              await import("@/design-analyst/capture-gate")
            const osMod = await import("node:os")
            const outDir = pathMod.join(
              osMod.tmpdir(),
              "opencorvus-capture",
              `${taskID}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            )
            const capture = await captureReferenceManifest({ url: liveUrl, outDir })
            const gate = enforceCaptureGate(capture.manifest)
            if (!gate.ok) {
              // 真实性闸拒收 ⇒ task 级失败；调用方通过 CaptureGateError 区分于普通抓图错误。
              throw new CaptureGateError(
                `reference authenticity gate rejected ${liveUrl}: ${summarizeCaptureViolations(gate.violations)}`,
                "gate",
              )
            }
            const hostname = (() => {
              try {
                return new URL(capture.manifest.url).hostname
              } catch {
                return "url"
              }
            })()
            const slug = hostname.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60) || "url"
            const ref = await AttachmentStore.write(
              Instance.project.id,
              capture.screenshotPng,
              "image/png",
              `url-${slug}-${Date.now()}.png`,
            )
            await EngineService.appendTaskSystemArtifact(taskID, {
              ...ref,
              intent: "visual_reference",
              source: "url-screenshot",
            })
            log.info("design_analysis: url screenshot materialized (gate passed)", {
              taskID,
              url: liveUrl,
              sha: ref.sha,
              size: ref.size,
              non_white: capture.manifest.non_white_pixel_ratio,
              unique_colors: capture.manifest.unique_color_count,
            })
            materializedCount++
          } catch (shotErr) {
            const { CaptureGateError } = await import("@/design-analyst/capture-gate")
            if (shotErr instanceof CaptureGateError && shotErr.stage === "gate") {
              // 真实性闸拒收：向上抛，让 design_analysis 工具调用整体 fail。
              throw shotErr
            }
            log.warn("design_analysis: url screenshot failed (non-gate)", {
              taskID,
              url: liveUrl,
              stage: shotErr instanceof CaptureGateError ? shotErr.stage : "unknown",
              error: shotErr instanceof Error ? shotErr.message : String(shotErr),
            })
          }
        }

        // --- Local material files --------------------------------------------
        // Paths are resolved against the project root and must stay inside
        // it — refusing traversal matches the codebase-tools boundary rule.
        const projectRoot = Instance.project.worktree
        for (const rawPath of materialPaths) {
          try {
            const abs = pathMod.isAbsolute(rawPath)
              ? pathMod.normalize(rawPath)
              : pathMod.normalize(pathMod.resolve(projectRoot, rawPath))
            if (!abs.startsWith(pathMod.normalize(projectRoot))) {
              log.warn("design_analysis: material path escapes project root — skipped", {
                taskID,
                rawPath,
                projectRoot,
              })
              continue
            }
            const bytes = await fsMod.readFile(abs)
            const filename = pathMod.basename(abs)
            const mime = guessMimeFromFilename(filename)
            const ref = await AttachmentStore.write(Instance.project.id, bytes, mime, filename)
            await EngineService.appendTaskSystemArtifact(taskID, {
              ...ref,
              intent: "visual_reference",
              source: "material",
            })
            log.info("design_analysis: material materialized", {
              taskID,
              path: rawPath,
              sha: ref.sha,
              size: ref.size,
              mime,
            })
            materializedCount++
          } catch (matErr) {
            log.warn("design_analysis: material materialization failed", {
              taskID,
              path: rawPath,
              error: matErr instanceof Error ? matErr.message : String(matErr),
            })
          }
        }

        // Refresh task to pick up any newly-attached references. design-analyst
        // sees the union of user attachments (figma + user uploads) and
        // system_artifacts (URL screenshots + materials we just captured).
        const enrichedTask = requireTask(taskID)
        const designVisuals = [
          ...(Array.isArray(enrichedTask.attachments) ? (enrichedTask.attachments as any[]) : []),
          ...(Array.isArray(enrichedTask.system_artifacts) ? (enrichedTask.system_artifacts as any[]) : []),
        ]
        const enrichedHasAttachments = designVisuals.length > 0

        // Fail-fast if design_analysis was invoked on the strength of URLs /
        // materials but every source failed to materialize. Running
        // design-analyst blind produces zero output tools, which the caller
        // turns into "Design analysis failed" — we surface the real root
        // cause (no usable visual input) back to the orchestrator instead
        // of letting the downstream agent run for 45s and emit nothing.
        if (!enrichedHasAttachments && materializedCount === 0) {
          await trackStepComplete("design_analysis", undefined, true)
          const providedCount = liveUrls.length + figmaUrls.length + materialPaths.length
          const message =
            `Design analysis aborted: all ${providedCount} provided visual source(s) ` +
            `failed to materialize (URLs unreachable, Figma fetch failed, or local material ` +
            `paths did not exist). Check that the paths/URLs in the 'materials' / 'url' / ` +
            `'urls' / 'figma_url' arguments actually exist. If no real visual reference is ` +
            `available, skip design_analysis and call requirements directly.`
          log.warn("design_analysis: no visual input materialized — aborting before agent call", {
            taskID,
            liveUrlCount: liveUrls.length,
            figmaUrlCount: figmaUrls.length,
            materialCount: materialPaths.length,
          })
          // P4: write decision_log so downstream agents see "design analysis
          // was attempted but produced no visual context" rather than
          // running blind on designSpecs=undefined (audit §11.3 / L3, bench
          // tsk_dde13a67c001sbz6y2Qe0at8Fc:1729).
          try {
            const { createDecisionLog } = await import("@/decision-log")
            createDecisionLog(taskID).append({
              phase: "design_analysis",
              key: "abort_materialization_failed",
              value:
                `Design analysis aborted before agent call: all ${providedCount} provided visual ` +
                `source(s) (live=${liveUrls.length}, figma=${figmaUrls.length}, materials=${materialPaths.length}) ` +
                `failed to materialize.`,
              reason: "materialization_failed_all_sources",
            })
          } catch (logErr) {
            log.warn("design_analysis: decision_log write failed (non-fatal)", {
              taskID,
              error: logErr instanceof Error ? logErr.message : String(logErr),
            })
          }
          throw new Error(message)
        }

        // Single session per sub-agent (rule 22). DesignAnalystAgent.analyze
        // creates the runner session internally; the orchestrator captures
        // its id via onSessionCreated for downstream emit attribution.
        let runnerSessionID: string | undefined
        try {
          const { DesignAnalystAgent } = await import("@/design-analyst")

          const analysis = await DesignAnalystAgent.analyze({
            title: task.title,
            request: task.request,
            // Single-source visual input: every URL / Figma frame / local
            // material the orchestrator resolved has already been turned
            // into a PNG in `designVisuals`. Prefer those pixels; design-analyst
            // does not use webfetch, though it may capture an additional live
            // webpage screenshot with its dedicated `url_screenshot` tool.
            attachments: enrichedHasAttachments ? designVisuals : undefined,
            taskID,
            parentSessionID: input.agentSessionID,
            signal: input.signal,
            onStatus: () => {},
            onSessionCreated: (id) => {
              runnerSessionID = id
            },
          })

          // Persist optional visual anchors on task.design_specs (dedicated
          // JSON column, not metadata). The binding contract is the PRD/SPEC
          // persisted into the Decision Log below; empty anchors are valid.
          const freshTask = requireTask(taskID)
          await updateTask(
            freshTask,
            { design_specs: analysis.specs },
            `Design PRD/SPEC stored (optional visual anchors: ${analysis.specs.length})`,
          )

          await trackStepComplete("design_analysis")

          const countByCategory = analysis.specs.reduce<Record<string, number>>((acc, s) => {
            acc[s.category] = (acc[s.category] ?? 0) + 1
            return acc
          }, {})
          const taskAfterDesignSpecs = requireTask(taskID)
          const materializedDesignFiles = designAnalysisArtifactPaths(Instance.directory)
          const evidenceSourceManifest = renderEvidenceSourceManifest({
            task: taskAfterDesignSpecs,
            liveUrls,
            figmaUrls,
            materialPaths,
            referenceArtifacts: analysis.referenceArtifacts,
            materializedFiles: [materializedDesignFiles.prdRelative, materializedDesignFiles.manifestRelative],
          })
          const writtenDesignArtifacts = await writeDesignAnalysisArtifacts({
            projectDir: Instance.directory,
            analysis: {
              designSystem: analysis.designSystem,
              techStack: analysis.techStack,
              productSpec: analysis.productSpec,
              frontendSpec: analysis.frontendSpec,
              visualConsistencySpec: analysis.visualConsistencySpec,
              backendSpec: analysis.backendSpec,
              prdIterationNotes: analysis.prdIterationNotes,
              completenessReview: analysis.completenessReview,
              referenceArtifacts: analysis.referenceArtifacts,
              openQuestions: analysis.openQuestions,
            },
            evidenceSourceManifest,
          })

          const { createDecisionLog } = await import("@/decision-log")
          const decisionLog = createDecisionLog(taskID)
          decisionLog.append({
            phase: "design_analysis",
            key: "visual_contract_summary",
            value:
              `Optional visual anchors: ${analysis.specs.length}. ` +
              `Color ${countByCategory.color ?? 0}, typography ${countByCategory.typography ?? 0}, ` +
              `spacing ${countByCategory.spacing ?? 0}, layout ${countByCategory.layout ?? 0}, ` +
              `component ${countByCategory.component ?? 0}, interaction ${countByCategory.interaction ?? 0}, ` +
              `responsive ${countByCategory.responsive ?? 0}.`,
            reason: "Design-analyst optional anchor summary; the PRD/SPEC entries are authoritative.",
          })
          if (analysis.designSystem.trim()) {
            decisionLog.append({
              phase: "design_analysis",
              key: "design_system",
              value: analysis.designSystem,
              reason: "Design-analyst identified the dominant design system / visual language.",
            })
          }
          if (analysis.techStack.length > 0) {
            decisionLog.append({
              phase: "design_analysis",
              key: "recommended_stack",
              value: analysis.techStack.join(", "),
              reason:
                "Design-analyst's implementation stack hints grounded in the PRD/SPEC and observed reference behavior.",
            })
          }
          decisionLog.append({
            phase: "design_analysis",
            key: "product_spec",
            value: analysis.productSpec,
            reason: "Mirror-grounded PRD/SPEC produced before requirements decomposition.",
          })
          decisionLog.append({
            phase: "design_analysis",
            key: "frontend_spec",
            value: analysis.frontendSpec,
            reason: "Frontend implementation specification derived from visual evidence and mirror artifacts.",
          })
          decisionLog.append({
            phase: "design_analysis",
            key: "visual_consistency_spec",
            value: analysis.visualConsistencySpec,
            reason: "Primary visual-fidelity contract for downstream implementation and delivery review.",
          })
          decisionLog.append({
            phase: "design_analysis",
            key: "backend_spec",
            value: analysis.backendSpec,
            reason: "Backend/API contract needed to reproduce observed page behavior; unknowns remain explicit.",
          })
          decisionLog.append({
            phase: "design_analysis",
            key: "prd_iteration_notes",
            value: analysis.prdIterationNotes.join("\n"),
            reason: "Design-analysis review passes completed before downstream handoff.",
          })
          decisionLog.append({
            phase: "design_analysis",
            key: "completeness_review",
            value: analysis.completenessReview,
            reason: "Final design-analysis completeness audit for requirements, architect, and build.",
          })
          decisionLog.append({
            phase: "design_analysis",
            key: "evidence_source_manifest",
            value: evidenceSourceManifest,
            reason:
              "Source manifest naming the PRD/SPEC origin, task files, materialized images, and mirror artifacts downstream agents can read.",
          })
          if (analysis.referenceArtifacts.length > 0) {
            decisionLog.append({
              phase: "design_analysis",
              key: "reference_artifacts",
              value: analysis.referenceArtifacts.join("\n"),
              reason: "Evidence artifacts used by design-analysis.",
            })
          }
          if (analysis.openQuestions.length > 0) {
            decisionLog.append({
              phase: "design_analysis",
              key: "open_questions",
              value: analysis.openQuestions.join("\n"),
              reason: "Facts design-analysis could not observe and downstream agents must not hallucinate.",
            })
          }

          log.info("design_analysis: complete", {
            taskID,
            total: analysis.specs.length,
            byCategory: countByCategory,
          })

          // Card terminal status flows through session.status; counts on
          // the Panel come from boardStore. No phase-completed bus event.

          return SubAgentProtocol.yieldResult({
            headline:
              "SUCCESS: Mirror-grounded PRD/SPEC and visual_consistency_spec persisted in decision log. " +
              "NEXT: call requirements for functional decomposition.",
            fields: [
              ["optional_visual_anchors", String(analysis.specs.length)],
              ["color", String(countByCategory.color ?? 0)],
              ["typography", String(countByCategory.typography ?? 0)],
              ["spacing", String(countByCategory.spacing ?? 0)],
              ["layout", String(countByCategory.layout ?? 0)],
              ["component", String(countByCategory.component ?? 0)],
              ["interaction", String(countByCategory.interaction ?? 0)],
              ["responsive", String(countByCategory.responsive ?? 0)],
              ["design_system", analysis.designSystem],
              ["recommended_stack", analysis.techStack],
              ["prd_review_passes", String(analysis.prdIterationNotes.length)],
              ["reference_artifacts", String(analysis.referenceArtifacts.length)],
              ["source_manifest", "decision_log:design_analysis/evidence_source_manifest"],
              ["prd_spec_file", writtenDesignArtifacts.prdRelative],
              ["source_manifest_file", writtenDesignArtifacts.manifestRelative],
              ["open_questions", String(analysis.openQuestions.length)],
            ],
            pointer: "decision_log phase=design_analysis",
          })
        } catch (err) {
          await trackStepComplete("design_analysis", undefined, true)
          const msg = err instanceof Error ? err.message : String(err)
          log.error("design_analysis: failed", { taskID, error: msg })
          throw err instanceof Error ? err : new Error(msg)
        }
      },
    }),

    // -----------------------------------------------------------------------
    // Cross-goal coordination — Architect Agent
    // -----------------------------------------------------------------------

    architect: tool({
      description:
        "OPTIONAL stage agent. Decompose the task into goals. The Architect reads the " +
        "REQ-N list + foundational decisions produced by requirements, explores the " +
        "codebase, and registers the final goal set (metric specs, challenge seeds, " +
        "traceability, cross-goal contracts).\n\n" +
        "USE WHEN: the work fans into multiple parallel goals (independent " +
        "owned_paths, cross-goal contracts), OR you need explicit acceptance specs " +
        "per goal so per-goal builds and `deliver` have something concrete to verify " +
        "against. Requires a `requirements` spec snapshot to run against — call " +
        "`requirements` first.\n" +
        "SKIP WHEN: the work fits one goal (the build agent's own todo list is " +
        "enough); every fix lives inside one file or one symbol's call sites.\n" +
        "Re-run on delivery rejection or explicit structural restart when evidence " +
        "points at structural / coverage problems. During an active run, do not " +
        "re-run architect merely to widen owned_paths or bless ordinary shared-file " +
        "edits; build sessions may edit outside responsibility paths when needed " +
        "and must explain every touched file in files_changed[]. For contract-level " +
        "point fixes prefer `modify_goal`. For visual/reference tasks, design_analysis is a hard prerequisite " +
        "before architect even if requirements already exist.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to run architect"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        const designGate = requireDesignAnalysisBefore("architect", task)
        if (designGate) return designGate
        const activeSpec = findActiveSpecForTask(task.id)
        if (!activeSpec) {
          return SubAgentProtocol.yieldResult({
            headline: "architect: no active requirements spec snapshot — call `requirements` first.",
            summary:
              "Architect decomposition requires the durable REQ-N requirements snapshot. " +
              "No architect session was started because the prior spec has been cleared or has not been created.",
            fields: [["next_action", "requirements"]],
            pointer: "read_context scope=decisions",
          })
        }
        const existingGoals = listGoals(taskID)

        await trackStepStart("architect")

        // Single session per sub-agent (rule 22). ArchitectAgent.coordinate
        // creates the runner session internally.
        let runnerSessionID: string | undefined
        try {
          const { createDecisionLog } = await import("@/decision-log")
          const decisionLog = createDecisionLog(taskID)

          // Load Requirements output straight from the DB so the Architect
          // sees the same REQ-N list the overlay does. Decisions come from
          // the decision log phase=requirements section the Requirements
          // agent already seeded.
          const { findRequirements } = await import("@/engine/store")
          const reqRows = findRequirements(activeSpec.id)
          const requirements = reqRows.map((r) => {
            const meta = (r.metadata ?? {}) as Record<string, unknown>
            const sourceID = typeof meta.source_requirement_id === "string" ? meta.source_requirement_id : r.id
            return {
              id: sourceID,
              type: (r.priority === "advisory" ? "implicit" : "explicit") as "explicit" | "implicit",
              description: r.description,
            }
          })
          const requirementDecisions = decisionLog.readByPhase("requirements").map((d) => ({
            key: d.key,
            value: d.value,
            reason: d.reason,
          }))
          const designAnalysis = renderDesignAnalysisHandoffReference(taskID)

          const { ArchitectAgent } = await import("@/architect/agent")
          const { copyRequirementsToSpecSnapshot, persistArchitectContractGraph, upsertGoalsFromArchitect } =
            await import("@/engine/persist")
          const { remapArchitectContractGraphGoalIDs, renderContractGraphForPrompt } = await import(
            "@/architect/contract-graph"
          )
          const { EngineSpecSnapshotTable } = await import("@/engine/engine.sql")

          const result = await ArchitectAgent.coordinate({
            goals: existingGoals.map((g) => ({
              id: g.id,
              title: g.title,
              objective: g.objective,
              acceptance_specs: (typeof g.acceptance_specs === "string"
                ? JSON.parse(g.acceptance_specs)
                : (g.acceptance_specs ?? [])) as AcceptanceSpec[],
              owned_paths: typeof g.owned_paths === "string" ? JSON.parse(g.owned_paths) : (g.owned_paths ?? []),
              depends_on: typeof g.depends_on === "string" ? JSON.parse(g.depends_on) : (g.depends_on ?? []),
              priority: g.priority as "blocking" | "advisory",
              kind: g.kind,
              requirement_ids:
                typeof g.requirement_ids === "string" ? JSON.parse(g.requirement_ids) : (g.requirement_ids ?? []),
              order_index: g.order_index,
              // Phase E (2026-05-05): retry_count derived from artifact tip.
              retry_count: getGoalRetryCount(g.id),
            })),
            taskRequest: task.request,
            taskTitle: task.title,
            taskID,
            decisionLog,
            requirements,
            requirementDecisions,
            designSpecs: Array.isArray(task.design_specs) ? (task.design_specs as any) : undefined,
            designAnalysis: designAnalysis.trim().length > 0 ? designAnalysis : undefined,
            attachments: Array.isArray(task.attachments) ? (task.attachments as any) : undefined,
            signal: input.signal,
            parentSessionID: input.agentSessionID,
            onStatus: () => {},
            onSessionCreated: (id) => {
              runnerSessionID = id
            },
          })

          // Single-pass persist. Architect's goal set is the authoritative
          // planning contract. Architecture review is feedback for the next
          // build prompt, not a second writer that mutates this graph.
          const newSpecSnapshotID = Identifier.ascending("spec")
          const priorSpecSnapshotID = findActiveSpecForTask(task.id)?.id
          const reqLines = requirements.map((r) => `- **${r.id}** [${r.type}]: ${r.description}`)
          const decisionLines = requirementDecisions.map((d) => `- **${d.key}** = ${d.value} — ${d.reason}`)
          const goalLines = result.goals.map((g) => `- **${g.id}** (${g.kind}, ${g.priority}): ${g.title}`)
          const traceLines = result.traceability.map((t) => `- ${t.requirementID} → ${t.goalIDs.join(", ")}`)
          const sourceCoverageLines = result.fidelity.sourceCoverage.map(
            (row) =>
              `- **${row.id}** [${row.action}] paths=${row.paths.join(", ")} goals=${row.goal_ids.join(", ")} — ${row.rationale}`,
          )
          const referenceCoverageLines = result.fidelity.referenceCoverage.map((row) => {
            const specIDs = row.visual_spec_ids.length > 0 ? ` visual_specs=${row.visual_spec_ids.join(", ")}` : ""
            return `- **${row.id}** surface=${row.surface} goals=${row.goal_ids.join(", ")}${specIDs} — ${row.expectation}`
          })
          const assemblyOwnerLines = result.fidelity.assemblyOwners.map(
            (row) => `- surface=${row.surface} owner=${row.goal_id} — ${row.rationale}`,
          )
          let persisted: Array<{ id: string; title: string; llmID: string }> = []
          let llmToDBID = new Map<string, string>()
          let deletedIDs: string[] = []
          try {
            Database.transaction((db) => {
              const now = Date.now()
              db.insert(EngineSpecSnapshotTable)
                .values({
                  id: newSpecSnapshotID,
                  task_id: taskID,
                  version: 2,
                  status: "ready",
                  summary: result.summary,
                  content: `${task.title}\n\n${result.summary}\n\n${result.decompositionAnalysis}`,
                  scope: requirements.map((r) => r.description).join("; "),
                  time_created: now,
                  time_updated: now,
                })
                .run()

              if (priorSpecSnapshotID) {
                copyRequirementsToSpecSnapshot(db, {
                  taskID,
                  fromSpecSnapshotID: priorSpecSnapshotID,
                  toSpecSnapshotID: newSpecSnapshotID,
                  now,
                })

                db.update(EngineSpecSnapshotTable)
                  .set({ status: "superseded", time_updated: now })
                  .where(eq(EngineSpecSnapshotTable.id, priorSpecSnapshotID))
                  .run()
              }

              const out = upsertGoalsFromArchitect(db, {
                taskID,
                specSnapshotID: newSpecSnapshotID,
                architectGoals: result.goals.map((g) => ({
                  llmID: g.id,
                  title: g.title,
                  objective: g.objective,
                  acceptance_specs: g.acceptance_specs,
                  owned_paths: g.owned_paths,
                  depends_on: g.depends_on,
                  kind: g.kind,
                  requirement_ids: g.requirement_ids,
                  priority: g.priority,
                  source: g.requirement_ids.length > 0 ? ("spec" as const) : ("system" as const),
                })),
                removedLLMIDs: result.removedGoalIDs,
                now,
              })
              persisted = out.persisted
              llmToDBID = out.llmToDBID
              deletedIDs = out.deletedIDs

              const mappedContractGraph = remapArchitectContractGraphGoalIDs(
                result.contractGraph,
                (goalID) =>
                  llmToDBID.get(goalID) ?? (existingGoals.some((goal) => goal.id === goalID) ? goalID : undefined),
              )
              persistArchitectContractGraph(db, {
                taskID,
                graph: mappedContractGraph,
                now,
              })

              const mappedArchitectFidelity = {
                sourceCoverage: result.fidelity.sourceCoverage.map((row) => ({
                  ...row,
                  goal_ids: row.goal_ids.map((goalID) => llmToDBID.get(goalID) ?? goalID),
                })),
                referenceCoverage: result.fidelity.referenceCoverage.map((row) => ({
                  ...row,
                  goal_ids: row.goal_ids.map((goalID) => llmToDBID.get(goalID) ?? goalID),
                })),
                assemblyOwners: result.fidelity.assemblyOwners.map((row) => ({
                  ...row,
                  goal_id: llmToDBID.get(row.goal_id) ?? row.goal_id,
                })),
              }

              const mappedGoalLines = result.goals.map((g) => {
                const goalID = llmToDBID.get(g.id) ?? g.id
                return `- **${goalID}** (${g.kind}, ${g.priority}): ${g.title}`
              })
              const mappedTraceLines = result.traceability.map((t) =>
                `- ${t.requirementID} → ${t.goalIDs.map((goalID) => llmToDBID.get(goalID) ?? goalID).join(", ")}`,
              )
              const mappedSourceCoverageLines = mappedArchitectFidelity.sourceCoverage.map(
                (row) =>
                  `- **${row.id}** [${row.action}] paths=${row.paths.join(", ")} goals=${row.goal_ids.join(", ")} — ${row.rationale}`,
              )
              const mappedReferenceCoverageLines = mappedArchitectFidelity.referenceCoverage.map((row) => {
                const specIDs = row.visual_spec_ids.length > 0 ? ` visual_specs=${row.visual_spec_ids.join(", ")}` : ""
                return `- **${row.id}** surface=${row.surface} goals=${row.goal_ids.join(", ")}${specIDs} — ${row.expectation}`
              })
              const mappedAssemblyOwnerLines = mappedArchitectFidelity.assemblyOwners.map(
                (row) => `- surface=${row.surface} owner=${row.goal_id} — ${row.rationale}`,
              )
              const mappedContractLines = renderContractGraphForPrompt(mappedContractGraph).split("\n")
              const mappedSpecContent = [
                `# ${task.title}`,
                "",
                result.summary,
                "",
                "## Decomposition Analysis",
                result.decompositionAnalysis,
                "",
                "## Requirements",
                ...(reqLines.length > 0 ? reqLines : ["_(none — Requirements produced an empty REQ-N list)_"]),
                "",
                "## Decisions",
                ...(decisionLines.length > 0 ? decisionLines : ["_(none)_"]),
                "",
                "## Goals",
                ...(mappedGoalLines.length > 0 ? mappedGoalLines : ["_(none)_"]),
                "",
                "## Traceability",
                ...(mappedTraceLines.length > 0 ? mappedTraceLines : ["_(none)_"]),
                "",
                "## Source Coverage",
                ...(mappedSourceCoverageLines.length > 0 ? mappedSourceCoverageLines : ["_(none)_"]),
                "",
                "## Reference Coverage",
                ...(mappedReferenceCoverageLines.length > 0 ? mappedReferenceCoverageLines : ["_(none)_"]),
                "",
                "## Assembly Ownership",
                ...(mappedAssemblyOwnerLines.length > 0 ? mappedAssemblyOwnerLines : ["_(none)_"]),
                "",
                "## Architect Contracts",
                ...(mappedContractLines.length > 0 ? mappedContractLines : ["_(none)_"]),
              ].join("\n")
              db.update(EngineSpecSnapshotTable)
                .set({ content: mappedSpecContent, time_updated: now })
                .where(eq(EngineSpecSnapshotTable.id, newSpecSnapshotID))
                .run()
              const taskMetadata =
                task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
                  ? (task.metadata as Record<string, unknown>)
                  : {}

              db.update(EngineTaskTable)
                .set({
                  metadata: {
                    ...taskMetadata,
                    architect_fidelity: mappedArchitectFidelity,
                  },
                  time_updated: now,
                })
                .where(eq(EngineTaskTable.id, taskID))
                .run()

              Database.effect(() =>
                EngineProtocol.emit(
                  EngineEvent.TaskUpdated,
                  { taskID, status: deriveTaskStatus(task), summary: "Goals decomposed by Architect" },
                  { source: "orchestrator.architect" },
                ),
              )
            })
          } catch (dbErr) {
            log.error("architect: failed to persist goals to DB", {
              taskID,
              error: dbErr instanceof Error ? dbErr.message : String(dbErr),
              stack: dbErr instanceof Error ? dbErr.stack : undefined,
            })
            throw dbErr
          }

          for (const g of persisted) ensureGoalInWorkflow(g.id, g.title)

          await trackStepComplete("architect")

          const summary = SubAgentProtocol.yieldResult({
            headline:
              `Architect decomposition complete: ${persisted.length} goals, ${result.contractGraph.contracts.length} contracts.` +
              (deletedIDs.length > 0 ? ` Removed ${deletedIDs.length} prior goal(s).` : "") +
              ` NEXT: dispatch eligible per-goal \`build({ goalID })\`; read each build report and worktree facts, then decide modify_goal / build / architect / deliver / fail_task explicitly (no auto-routing).`,
            summary: result.summary,
            fields: [
              ["goals", persisted.map((g) => `${g.id} ${g.title}`)],
              [
                "contract_graph",
                `${result.contractGraph.contracts.length} contracts / ${result.contractGraph.dependency_contracts.length} dependency reasons`,
              ],
              ["spec_snapshot_id", newSpecSnapshotID],
            ],
            pointer: `read_context scope=decisions (spec ${newSpecSnapshotID})`,
          })

          return summary
        } catch (err) {
          // Same shape as requirements catch above (rule 4 — failure
          // surfacing is uniform across stage agents). Without this the
          // workflow.step.architect stays "running" forever in the overlay
          // when ArchitectAgent.coordinate throws (LLM hard error,
          // structured-output miss, persistence error).
          try {
            await trackStepComplete("architect", undefined, true)
          } catch (trackErr) {
            log.warn("architect: trackStepComplete(failed) emit failed", {
              taskID,
              error: trackErr instanceof Error ? trackErr.message : String(trackErr),
            })
          }
          try {
            const { createDecisionLog } = await import("@/decision-log")
            const reason = err instanceof Error ? err.message : String(err)
            createDecisionLog(taskID).append({
              phase: "architect",
              key: "abort_architect_failed",
              value: `Architect stage aborted: ${reason.slice(0, 400)}`,
              reason: "architect_threw",
            })
          } catch (logErr) {
            log.warn("architect: decision_log write failed (non-fatal)", {
              taskID,
              error: logErr instanceof Error ? logErr.message : String(logErr),
            })
          }
          throw err
        }
      },
    }),

    // -----------------------------------------------------------------------
    // Integrity / Architecture review — advisory review of the current graph.
    //
    // Lifted out of architect/agent.ts (audit 2026-04-25): per the agent
    // boundary rule (agents do not call agents; only the orchestrator
    // routes messages between agents), the integrity reviewer must be a
    // sibling of architect at the orchestrator level, not a nested call
    // inside architect's run(). This tool reads the persisted goal set,
    // invokes the reviewer, and records findings only. It never rewrites
    // requirements or goals; a non-pass post-build review routes rework to
    // the affected goal IDs named by review issues/corrections so Build
    // consumes the feedback in the next prompt.
    // -----------------------------------------------------------------------

    integrity: tool({
      description:
        "OPTIONAL architecture-review agent. Multi-dimension review of the active " +
        "architect graph along four " +
        "axes: requirement_fidelity (REQ-N keyed coverage + system completion when " +
        "post-build evidence is available), technical_feasibility (contract graph / " +
        "owned_paths / dep graph viability + user-deliverable tier walk), " +
        "hallucination (ungrounded REQs / specs / contracts), solution_quality " +
        "(granularity, acceptance-spec strength, ownership, ordering). Returns a " +
        "per-dimension verdict (pass / concerns / needs_correction) plus an aggregate " +
        "(worst-of) AND the full per-dimension issue / correction / missing-goal text " +
        "as a markdown block. Findings are persisted as evidence only: this review " +
        "never rewrites requirements, never upserts goals, and the host never " +
        "auto-supersedes attempts or auto-routes findings — you read the markdown " +
        "and choose modify_goal / build({goalID}) / architect / deliver / fail_task " +
        "explicitly. Each goal build automatically records its build report and runs " +
        "this review after the report; the review's findings are returned inline in " +
        "the build tool result for you to act on.\n\n" +
        "USE WHEN: architect just produced a non-trivial goal graph (≥3 goals, OR " +
        "cross-goal contracts, OR foundational decisions architect derived rather " +
        "than user-stated), OR a Build / Delivery result needs architecture feedback. " +
        "Build already invokes the post-build review for goal builds.\n" +
        "SKIP WHEN: architect produced exactly one goal whose contract trivially " +
        "matches the user request, OR you already ran integrity for this spec " +
        "snapshot and have no new signal. Requires architect goals on the active " +
        "spec snapshot.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to run integrity review"),
      }),
      execute: async () => {
        const designGate = requireDesignAnalysisBefore("integrity", requireTask(taskID))
        if (designGate) return designGate
        return renderIntegrityOutcome(await runIntegrityReview())
      },
    }),

    // -----------------------------------------------------------------------
    // Prosecute — orchestrator-driven adversarial probe.
    //
    // Lifted out of the deliver tool (audit 2026-04-25): the prosecutor
    // (kind: "evaluator") was previously called inside `deliver` between
    // metric execution and snapshot writing. Per the agent boundary rule
    // it must be the orchestrator that decides when to run the adversarial
    // pass and consumes its yield. The orchestrator now drives the order
    // explicitly: deliver → prosecute → publish_delivery / next iteration.
    // -----------------------------------------------------------------------

    prosecute: tool({
      description:
        "Run the adversarial Prosecutor against the most recent delivery " +
        "iteration: file concrete counterexamples for failure modes the " +
        "delivery agent missed, or propose at most one diagnostic challenge " +
        "metric per iteration (capped at 3 per task). Call AFTER every " +
        "`deliver` invocation and BEFORE `publish_delivery` so the iteration " +
        "snapshot reflects the adversarial pass. Side-effects land in DB " +
        "(engine_counterexample, engine_metric_spec) and feed the next " +
        "deliver iteration's trajectory query.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to run the prosecutor now"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        const designGate = requireDesignAnalysisBefore("prosecute", task)
        if (designGate) return designGate
        // Stateless / unconditional — physical preconditions only (a delivery
        // row to prosecute against). The "No active run" message was a
        // state-machine cache gate; same lazy-bootstrap as deliver/publish.
        let run = findActiveRunForTask(taskID)
        if (!run && listGoals(taskID).length > 0) {
          const ensured = await ensureDispatchableRunForSingleGoal()
          if (!("error" in ensured)) run = ensured.run
        }
        const delivery = run ? findDeliveryByRun(run.id) : undefined
        if (!delivery) {
          return SubAgentProtocol.yieldResult({
            headline: "prosecute: no delivery row to prosecute against — call `deliver` first to produce one.",
            pointer: run ? `run ${run.id}` : `task ${taskID}`,
          })
        }
        const { EngineArtifactTable } = await import("@/engine/engine.sql")
        const { desc } = await import("@/storage/db")
        const verdictArtifact = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(and(eq(EngineArtifactTable.delivery_id, delivery.id), eq(EngineArtifactTable.kind, "verdict")))
            .orderBy(desc(EngineArtifactTable.time_created))
            .limit(1)
            .get(),
        )
        if (!verdictArtifact) {
          return SubAgentProtocol.yieldResult({
            headline: "prosecute: no delivery verdict artifact — call `deliver` first.",
            pointer: `delivery ${delivery.id}`,
          })
        }
        const verdict = verdictArtifact.payload as unknown as import("@/delivery/agent").DeliveryVerdictType

        const { readIterationHistory } = await import("@/metrics/store")
        const priorIterations = readIterationHistory(taskID)
        // The deliver tool advances the iteration counter when it writes the
        // snapshot. Prosecute targets the most recently written snapshot —
        // i.e. the LAST entry in the trajectory.
        const iteration = Math.max(0, priorIterations.length - 1)

        const { runProsecutor } = await import("@/prosecutor")
        const pRes = await runProsecutor({
          task: {
            id: task.id,
            title: task.title,
            request: task.request,
            sessionID: input.agentSessionID,
          },
          iteration,
          defenderVerdict: verdict,
          architectSeeds: [],
          signal: input.signal,
        })

        log.info("prosecute: done", {
          taskID,
          iteration,
          filed: pRes.counterexamples_filed,
          proposed: pRes.challenges_proposed,
          resolved: pRes.counterexamples_resolved,
        })

        try {
          const { recordProsecutorAttempt } = await import("@/engine/persist")
          recordProsecutorAttempt({
            taskID,
            deliveryID: delivery.id,
            sessionID: input.agentSessionID,
            iteration,
            counterexamplesFiled: pRes.counterexamples_filed,
            challengesProposed: pRes.challenges_proposed,
            counterexamplesResolved: pRes.counterexamples_resolved,
            rationale: pRes.rationale,
          })
        } catch (err) {
          log.error("prosecute: recordProsecutorAttempt failed", {
            taskID,
            error: err instanceof Error ? err.message : String(err),
          })
        }

        return SubAgentProtocol.yieldResult({
          headline:
            `Prosecutor iter ${iteration}: filed ${pRes.counterexamples_filed} counterexample(s), ` +
            `proposed ${pRes.challenges_proposed} challenge(s), resolved ${pRes.counterexamples_resolved}. ` +
            `NEXT: ${verdict.verdict === "accepted" ? "call `publish_delivery`" : "address feedback then call `build`/`deliver` again"}.`,
          summary: pRes.rationale,
          fields: [
            ["iteration", String(iteration)],
            ["delivery_verdict", verdict.verdict],
          ],
          pointer: `delivery ${delivery.id}`,
        })
      },
    }),

    // -----------------------------------------------------------------------
    // Analyze intent — post-design disambiguation for visual/reference tasks.
    //
    // Lifted out of an unused free-floating IntentAnalysisAgent.analyze
    // module (audit 2026-04-25). The agent runs at the very front of the
    // pipeline (before requirements / architect) to reconstruct the user's
    // real intent from a typically-terse request, the surrounding work
    // record (decision log + prior delivery feedback when re-entering a
    // task), and a read-only tour of the repository. Visual/reference tasks
    // are gated through design_analysis first so intent analysis reads the
    // same PRD/SPEC source as every downstream stage.
    // -----------------------------------------------------------------------

    analyze_intent: tool({
      description:
        "OPTIONAL stage agent. Reconstruct the user's real intent from a (typically " +
        "terse) request. Reads the request, the existing work record on this task " +
        "(decision log, prior delivery rejections, refine notes when present), and " +
        "uses read-only codebase tools (read/find/search/list) to ground complexity " +
        "and scope estimates in the repo's actual shape. Output: an " +
        "IntentAnalysisResult (intent class, complexity band, extracted slots, " +
        "missing-info keys, blocker / nice clarifications, overall confidence, " +
        "one-sentence summary). For visual/reference tasks, this tool is blocked " +
        "until design_analysis has produced the PRD/SPEC contract and source manifest.\n\n" +
        "USE WHEN: terse request, ambiguous scope, multiple plausible intent classes " +
        "(feature vs refactor vs bug-fix), the user's intent might silently mislead " +
        "downstream stages, OR re-entering after operator_message / refine / " +
        "restart_from_stage that may have shifted scope. If it returns blocker " +
        "clarifications, call `question` with them BEFORE spending budget on " +
        "requirements / architect / build.\n" +
        "SKIP WHEN: the request is already explicit (concrete file path + concrete " +
        "change), OR a previous analyze_intent on this task is still valid, OR the " +
        "work is a clear single-edit fix where downstream agents have nothing to " +
        "misread.",
      inputSchema: z.object({
        reason: z
          .string()
          .optional()
          .describe("Why you decided to run intent analysis (first-wake / re-entry / scope change)"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        const designBlock = requireDesignAnalysisBefore("analyze_intent", task)
        if (designBlock) return designBlock
        await trackStepStart("analyze_intent")
        let out
        try {
          const { IntentAnalysisAgent } = await import("@/intent-analysis/agent")
          out = await IntentAnalysisAgent.analyze({
            request: task.request,
            title: task.title,
            taskID,
            attachments: Array.isArray(task.attachments) ? (task.attachments as any) : undefined,
            parentSessionID: input.agentSessionID,
            signal: input.signal,
            onStatus: () => {},
          })
        } catch (err) {
          await trackStepComplete("analyze_intent", undefined, true)
          // P4 (rule 4 systemic — bundles intent_analysis abort with
          // design_analysis abort, both audit L7 + L3 same shape): write
          // decision_log so downstream agents see "intent analysis was
          // attempted but failed" instead of silently inheriting an empty
          // intent classification. The success path already writes (lines
          // 1722-1763 below); this commit closes the abort gap.
          try {
            const { createDecisionLog } = await import("@/decision-log")
            const reason = err instanceof Error ? err.message : String(err)
            createDecisionLog(taskID).append({
              phase: "intent_analysis",
              key: "abort_intent_analysis_failed",
              value: `Intent analysis aborted: ${reason.slice(0, 400)}`,
              reason: "intent_analysis_threw",
            })
          } catch (logErr) {
            log.warn("analyze_intent: decision_log write failed (non-fatal)", {
              taskID,
              error: logErr instanceof Error ? logErr.message : String(logErr),
            })
          }
          throw err
        }
        const r = out.result
        const blockers = r.clarifications.filter((c) => c.priority === "blocker")
        const nices = r.clarifications.filter((c) => c.priority === "nice")

        // Persist intent reading into the Decision Log so downstream agents
        // (requirements / architect / integrity / build) see the upstream
        // scope_boundary / complexity / slots / clarifications via the
        // TaskContext.snapshot block. Without this the agent runs but its
        // output never reaches any downstream prompt — pure token waste.
        // Same pattern as design_analysis (rule 22, single source).
        const { createDecisionLog } = await import("@/decision-log")
        const decisionLog = createDecisionLog(taskID)
        decisionLog.append({
          phase: "intent_analysis",
          key: "intent_summary",
          value: `${r.intent_class} / ${r.complexity} / confidence=${r.confidence.toFixed(2)}. ${r.summary}`,
          reason: "Intent-analysis terminal classification for downstream stage agents.",
        })
        if (r.extracted_slots.length > 0) {
          decisionLog.append({
            phase: "intent_analysis",
            key: "intent_slots",
            value: r.extracted_slots.map((s) => `${s.key}=${s.value} (conf=${s.confidence.toFixed(2)})`).join("; "),
            reason:
              "Slots extracted from the user request — downstream REQ-N + goal decomposition should reflect these explicitly.",
          })
        }
        if (r.missing_info.length > 0) {
          decisionLog.append({
            phase: "intent_analysis",
            key: "intent_missing_info",
            value: r.missing_info.join(", "),
            reason:
              "Information judged missing from the request — downstream agents must infer from repo / decisions or flag explicitly.",
          })
        }
        if (blockers.length > 0) {
          decisionLog.append({
            phase: "intent_analysis",
            key: "intent_blocker_clarifications",
            value: blockers.map((c) => c.question).join(" | "),
            reason:
              "Blocker clarifications — orchestrator already surfaced or auto-resolved; downstream should not re-ask.",
          })
        }
        if (nices.length > 0) {
          decisionLog.append({
            phase: "intent_analysis",
            key: "intent_nice_clarifications",
            value: nices.map((c) => c.question).join(" | "),
            reason:
              "Nice-to-have clarifications — downstream picks the most reasonable answer if a decision hinges on one.",
          })
        }

        await trackStepComplete("analyze_intent")

        return SubAgentProtocol.yieldResult({
          headline:
            `Intent: ${r.intent_class} / complexity=${r.complexity} / confidence=${r.confidence.toFixed(2)}. ` +
            (blockers.length > 0
              ? `${blockers.length} blocker clarification(s) — call \`question\` BEFORE \`requirements\`.`
              : `NEXT: call \`requirements\` (or \`design_analysis\` first if visual references exist).`),
          summary: r.summary,
          fields: [
            ["slots", r.extracted_slots.map((s) => `${s.key}=${s.value}`)],
            ["missing_info", r.missing_info],
            ["blocker_questions", blockers.map((c) => c.question)],
            ["nice_questions", nices.map((c) => c.question)],
          ],
          pointer: `intent session ${out.sessionID}; decision log keys: intent_summary${r.extracted_slots.length > 0 ? " + intent_slots" : ""}${r.missing_info.length > 0 ? " + intent_missing_info" : ""}${blockers.length > 0 ? " + intent_blocker_clarifications" : ""}${nices.length > 0 ? " + intent_nice_clarifications" : ""}`,
        })
      },
    }),

    // -----------------------------------------------------------------------
    // Per-goal tools — Orchestrator decides when to call each
    // -----------------------------------------------------------------------

    modify_goal: tool({
      description:
        "Modify an existing goal's contract. Use when eval feedback suggests " +
        "acceptance_specs need refinement, or owned_paths need adjustment. " +
        "If the submitted shape is invalid, the tool returns a correction " +
        "diagnostic and leaves the database unchanged.",
      inputSchema: ModifyGoalInputSchema,
      execute: async (input) => {
        if (!isObjectRecord(input) || typeof input.goalID !== "string" || input.goalID.trim().length === 0) {
          return 'Error: modify_goal requires a non-empty string "goalID"; database unchanged.'
        }
        const goalID = input.goalID
        const parsedUpdates = parseModifyGoalUpdates(input.updates)
        if (!parsedUpdates.ok) return parsedUpdates.message
        const updates = parsedUpdates.updates
        requireTask(taskID)
        const dbGoals = listGoals(taskID)
        const goal = dbGoals.find((g) => g.id === goalID)
        if (!goal) return `Goal ${goalID} not found.`

        // Deep-equality no-op detection (rule 2 + rule 7) via the
        // computeContractFieldChanges helper: only fields whose submitted
        // value actually differs from the persisted value are counted as
        // changed. The orchestrator LLM was previously using modify_goal
        // as a side-channel to trigger phase=retry feedback when build
        // attempts failed for unrelated reasons (e.g. missing terminal
        // tool call) — passing the SAME acceptance_specs back in still
        // wrote a "Goal contract changed... re-read acceptance_specs"
        // entry into the decision log, polluting the next build agent's
        // prior-attempt context. Spec
        // build-missing-terminal-signal-restore-2026-05-07.md §5.3 +
        // tsk_e0033e523001flSn0onlHh4Urh's 4-attempt loop.
        const setValues = computeContractFieldChanges(
          updates as Record<string, unknown>,
          goal as unknown as Record<string, unknown>,
        )

        const changed = Object.keys(setValues)
        const contractChanged = changed.length > 0
        const statusReset =
          contractChanged && (goalStatusByID(goal.id) === "passed" || goalStatusByID(goal.id) === "failed")

        if (contractChanged) {
          setValues.time_updated = Date.now()
          const { EngineGoalTable } = await import("@/engine/engine.sql")
          Database.use((db) => {
            db.update(EngineGoalTable)
              .set(setValues as any)
              .where(eq(EngineGoalTable.id, goalID))
              .run()
          })
        }

        let abortedRuns = 0
        let supersededTipID: string | undefined
        if (statusReset) {
          const { listGoalRunsForTask } = await import("@/engine/store")
          const { startNewAttempt } = await import("@/engine/persist")
          const { LIVE_GOAL_RUN_STATUSES } = await import("@/engine/catalog")
          // 1. Abort only LIVE goal_runs (queued/accepted/planning/running/
          //    evaluating/blocked). `completed` is never reset — its
          //    verification evidence is load-bearing, and the parent goal
          //    should not regress from passed → pending via a
          //    completed→aborted flip. The new attempt (step 2) supersedes
          //    the tip so dispatchability kicks in; GoalPool is the
          //    authoritative creator of the new goal_run.
          const toAbort = listGoalRunsForTask(taskID).filter(
            (row) => row.goal_id === goalID && LIVE_GOAL_RUN_STATUSES.includes(row.status),
          )
          for (const row of toAbort) {
            updateGoalRun(row.id, { status: "aborted", error: "contract modified" })
          }
          abortedRuns = toAbort.length
          // 2. Open a new attempt under reason=modify_contract. Internally:
          //    supersedes any terminal tip → deriveGoalStatus projects
          //    pending → loop routes through pool.submit → pool.dispatchGoal
          //    → fresh goal_run under the new contract. Idempotent if the
          //    tip is already superseded. Emits GoalAttemptOpened so the
          //    overlay / decision-log observe the boundary.
          const result = startNewAttempt({
            goalID,
            reason: "modify_contract",
            feedback: {
              value:
                `Goal contract changed by modify_goal. Fields updated: ${changed.join(", ")}. ` +
                `The prior attempt ran against an outdated contract — re-read acceptance_specs, ` +
                `owned_paths, the Architect Contract Graph, and the dependency context before re-implementing. ` +
                `Do not assume prior code satisfies the new contract.`,
              reason: `modify_goal: ${changed.length} contract field(s) updated (${changed.join(", ")})`,
            },
          })
          supersededTipID = result.supersededTipID
        }

        const resetSuffix = statusReset
          ? ` (status reset: ${goalStatusByID(goal.id)} → pending via goal_run chain)`
          : ""
        const abortSuffix = abortedRuns > 0 ? `, ${abortedRuns} prior goal_run(s) marked aborted` : ""
        const supersedeSuffix = supersededTipID ? `, tip ${supersededTipID} superseded` : ""

        // When a contract change triggered status reset, the prior attempt's
        // worktree is stale (built against the old contract). Cleanup so the
        // next build starts from a fresh primary checkout and doesn't carry
        // forward the old tree's state. Cleanup failure is surfaced so the
        // DB pointer remains available for diagnosis.
        let cleanupSuffix = ""
        if (statusReset) {
          const { cleanupGoalWorkspaceForGoal } = await import("@/engine/writer")
          const cleaned = await cleanupGoalWorkspaceForGoal(goalID)
          if (cleaned) cleanupSuffix = ", stale worktree cleaned"
        }

        return `Goal ${goalID} modified: ${changed.join(", ") || "(no changes)"}${resetSuffix}${abortSuffix}${supersedeSuffix}${cleanupSuffix}`
      },
    }),

    query_failed_goals: tool({
      description:
        "Query all currently failed goals with their latest delivery info. Returns one block per failed goal (acceptance_specs truncated, only latest run). Use BEFORE re-running build on a failed goal to understand per-goal failure reasons.",
      inputSchema: z.object({}),
      execute: async () => {
        const dbGoals = listGoals(taskID)
        const failed = dbGoals.filter((g) => goalStatusByID(g.id) === "failed")
        if (failed.length === 0) return "No failed goals."
        const { listGoalRunsForTask, findDeliveryByGoalRun } = await import("@/engine/store")
        const goalRuns = listGoalRunsForTask(taskID)
        const sections: string[] = [`## Failed Goals (${failed.length})`]
        const ACCEPTANCE_SPEC_CAP = 300
        const DELIVERY_FILES_CAP = 10
        for (const goal of failed) {
          const label = `#G${goal.order_index + 1}V${getGoalRetryCount(goal.id) + 1}`
          sections.push(`\n### ${label} ${goal.id}: ${goal.title}`)
          sections.push(
            `- acceptance_specs:\n${renderSpecsAsText((goal.acceptance_specs ?? []) as AcceptanceSpec[]).slice(0, ACCEPTANCE_SPEC_CAP)}`,
          )
          if (goal.owned_paths?.length) sections.push(`- owned_paths: ${goal.owned_paths.join(", ")}`)
          // listGoalRunsForTask is desc by time_created; first match is latest.
          const latestGr = goalRuns.find((gr) => gr.goal_id === goal.id)
          if (latestGr) {
            const delivery = findDeliveryByGoalRun(latestGr.id)
            if (delivery) {
              sections.push(`- delivery summary: ${delivery.summary}`)
              const diffs = (delivery.result as any)?.diffs as Array<{ file: string }> | undefined
              if (diffs?.length) {
                const shown = diffs
                  .slice(0, DELIVERY_FILES_CAP)
                  .map((f) => f.file)
                  .join(", ")
                const more = diffs.length > DELIVERY_FILES_CAP ? ` (+${diffs.length - DELIVERY_FILES_CAP} more)` : ""
                sections.push(`- delivery files: ${shown}${more}`)
              }
            } else {
              sections.push(`- delivery: none`)
            }
            sections.push(`- goal_run status: ${latestGr.status}`)
            sections.push(`- current implementation version: ${label}`)
            if (latestGr.error) {
              sections.push(`- goal_run error: ${latestGr.error}`)
              if (
                latestGr.error.includes("report_build_result") ||
                latestGr.error.includes("missing_terminal_report")
              ) {
                sections.push(
                  `- recovery hint: the build session should first stay alive and add report_build_result(files_changed[]) in-place. If same-session recovery already exhausted, retry this goal with explicit report_build_result(files_changed[]) instructions. ` +
                    `Any retained files under .opencorvus/worktrees are diagnostic worktree evidence, not primary workspace pollution; ` +
                    `do not restart_from_stage solely because those diagnostic files exist.`,
                )
              }
            }
          } else {
            sections.push(`- no goal_run found`)
          }
        }
        const result = sections.join("\n")
        SubAgentProtocol.report(result, "tool:query_failed_goals")
        return result
      },
    }),

    read_context: tool({
      description:
        "Read current task context: goal states, delivery verdicts, Decision Log, delivery summaries, integrity/prosecutor attempts. Use this to gather information before making decisions. Returns only the latest state per goal / per spec snapshot / per delivery — historical entries older than the latest are omitted to keep prompts bounded.",
      inputSchema: z.object({
        scope: z
          .enum(["goals", "evaluations", "decisions", "deliveries", "all"])
          .default("all")
          .describe("What to read"),
      }),
      execute: async ({ scope }) => {
        const task = requireTask(taskID)
        const sections: string[] = []
        // Source-level caps on read_context output. Rationale: this tool is
        // called every orchestrator turn; tool results live forever in session
        // history. Unbounded accumulation (every historical eval, every run's
        // delivery, every decision) was the dominant contributor to the
        // orchestrator session growing from ~10K to 125K tokens across 16 turns.
        // Caps below preserve the LATEST state per goal rather than history.
        const DECISIONS_LIMIT = 20
        const EVAL_CHECK_EVIDENCE_CAP = 200

        if (scope === "goals" || scope === "all") {
          const desc = await describeTask(taskID)
          const closureLines = renderCollaborationClosure(desc.collaboration_closure, desc.goals)
          if (closureLines.length > 0) {
            sections.push(closureLines.join("\n"))
          }
          const goals = listGoals(taskID)
          sections.push(`## Goals (${goals.length})`)
          for (const g of goals) {
            const label = `#G${g.order_index + 1}V${getGoalRetryCount(g.id) + 1}`
            sections.push(`- [${goalStatusByID(g.id)}] ${label} ${g.id}: ${g.title} [${g.priority}]`)
            sections.push(`  objective: ${g.objective.slice(0, 200)}`)
            sections.push(
              `  acceptance_specs:\n${renderSpecsAsText((g.acceptance_specs ?? []) as AcceptanceSpec[]).slice(0, 400)}`,
            )
            if (g.owned_paths?.length) sections.push(`  owned_paths: ${g.owned_paths.join(", ")}`)
            if (g.depends_on?.length) sections.push(`  depends_on: ${g.depends_on.join(", ")}`)
          }
        }

        if (scope === "evaluations" || scope === "all") {
          const { findEvaluationsByTask, listGoalRunsForTask } = await import("@/engine/store")
          const evals = findEvaluationsByTask(taskID) // desc by time_created
          if (evals.length > 0) {
            // Dedup to latest eval per underlying goal. Multiple evals for
            // the same goal across retries only clutter — the latest verdict
            // is what drives next decisions. goal_run_id → goal_id lookup
            // avoids a SQL join by walking the task's goal_runs once.
            const runToGoal = new Map<string, string>()
            for (const gr of listGoalRunsForTask(taskID)) runToGoal.set(gr.id, gr.goal_id)
            const seenGoals = new Set<string>()
            const latestPerGoal: typeof evals = []
            for (const e of evals) {
              const goalID = e.goal_run_id ? runToGoal.get(e.goal_run_id) : undefined
              const key = goalID ?? `__run:${e.goal_run_id ?? e.id}`
              if (seenGoals.has(key)) continue
              seenGoals.add(key)
              latestPerGoal.push(e)
            }
            const omitted = evals.length - latestPerGoal.length
            const header =
              omitted > 0
                ? `\n## Evaluations (latest ${latestPerGoal.length} of ${evals.length}; ${omitted} superseded omitted)`
                : `\n## Evaluations (${latestPerGoal.length})`
            sections.push(header)
            for (const e of latestPerGoal) {
              sections.push(`- [${e.verdict}] ${e.summary}`)
              const checks = e.checks as Array<{ name: string; status: string; evidence?: string }> | undefined
              if (checks) {
                for (const c of checks.slice(0, 5)) {
                  const evidence = c.evidence ? c.evidence.slice(0, EVAL_CHECK_EVIDENCE_CAP) : ""
                  sections.push(`  - ${c.name}: ${c.status}${evidence ? ` — ${evidence}` : ""}`)
                }
              }
            }
          }
        }

        if (scope === "decisions" || scope === "all") {
          const { createDecisionLog } = await import("@/decision-log")
          const log = createDecisionLog(taskID)
          // Architecture review history gets its own section with its own
          // budget. Reviews fire frequently (one per goal build at the
          // most), so without isolation they would crowd architect /
          // requirements / intent decisions out of the latest-N window.
          // Surface the latest 5 review summaries — enough to spot a
          // recurring issue across consecutive reviews (the cumulative
          // signal that drives architect re-run / fail_task per
          // orchestrator-core.txt's repair ladder).
          const reviewSection = log.phasePromptSection("review", "Architecture review history", { limit: 5 })
          if (reviewSection) sections.push(`\n${reviewSection}`)
          const section = log.toPromptSection({
            limit: DECISIONS_LIMIT,
            excludePhases: ["review"],
          })
          if (section) sections.push(`\n${section}`)
        }

        if (scope === "deliveries" || scope === "all") {
          const { listGoalRunsForTask, findDeliveryByGoalRun } = await import("@/engine/store")
          const goalRuns = listGoalRunsForTask(taskID) // desc by time_created
          // Keep only the latest delivery per goal. Previous runs' deliveries
          // are historical noise once superseded; the orchestrator decides from
          // current state, not delivery history.
          const seenGoals = new Set<string>()
          const deliveries: Array<{
            goalRunID: string
            goalID: string
            status: string
            delivery: ReturnType<typeof findDeliveryByGoalRun>
          }> = []
          for (const gr of goalRuns) {
            if (seenGoals.has(gr.goal_id)) continue
            const delivery = findDeliveryByGoalRun(gr.id)
            if (!delivery) continue
            seenGoals.add(gr.goal_id)
            deliveries.push({ goalRunID: gr.id, goalID: gr.goal_id, status: gr.status, delivery })
          }
          if (deliveries.length > 0) {
            sections.push(`\n## Deliveries (${deliveries.length} — latest per goal)`)
            for (const d of deliveries) {
              const diffs = (d.delivery!.result as any)?.diffs as Array<{ file: string }> | undefined
              sections.push(`- goal_run ${d.goalRunID} [${d.status}]: ${d.delivery!.summary}`)
              if (diffs?.length) sections.push(`  files: ${diffs.map((f) => f.file).join(", ")}`)
            }
          }
        }

        if (scope === "all") {
          // Integrity / prosecutor attempts: surface the FACT that these stages
          // ran for the current spec snapshot / delivery. Without this the
          // orchestrator-LLM cannot tell "integrity returned pass (no goal
          // change)" from "integrity never called" — same death-loop shape that
          // commit 7acb5f17f addressed for build via begin/finalizeBuildAttempt.
          const { EngineArtifactTable } = await import("@/engine/engine.sql")
          const { desc } = await import("@/storage/db")
          const activeSpec = findActiveSpecForTask(taskID)
          if (activeSpec) {
            const integrityRow = Database.use((db) =>
              db
                .select()
                .from(EngineArtifactTable)
                .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "integrity_attempt")))
                .orderBy(desc(EngineArtifactTable.time_created))
                .limit(1)
                .get(),
            )
            if (integrityRow) {
              const p = (integrityRow.payload ?? {}) as Record<string, unknown>
              const matchesSnapshot = p.spec_snapshot_id === activeSpec.id
              const perDim = Array.isArray(p.per_dimension)
                ? (p.per_dimension as Array<{ id: string; verdict: string }>)
                    .map((d) => `${d.id}=${d.verdict}`)
                    .join(", ")
                : ""
              const reviewMarkdown = typeof p.review_markdown === "string" ? p.review_markdown : ""
              sections.push(
                `\n## Integrity (latest)`,
                `- verdict: ${String(p.verdict ?? "unknown")}` +
                  (perDim ? ` — per-dimension: ${perDim}` : "") +
                  ` — issues=${Number(p.issues_count ?? 0)} corrections=${Number(p.corrections_count ?? 0)} missing=${Number(p.missing_count ?? 0)}` +
                  (matchesSnapshot
                    ? " (current spec snapshot)"
                    : " (STALE — newer spec snapshot exists; re-run integrity)"),
              )
              // Surface the full review markdown (issues + corrections +
              // missing-goal proposals) so the orchestrator LLM can act on
              // the same evidence it had at review time, not a count.
              // Architecture review is advisory: the orchestrator decides
              // modify_goal / build / architect / deliver / fail_task
              // explicitly based on this text.
              if (reviewMarkdown) sections.push("", reviewMarkdown)
            }
          }
          const lastDeliveryRow = Database.use((db) =>
            db
              .select()
              .from(EngineArtifactTable)
              .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "delivery")))
              .orderBy(desc(EngineArtifactTable.time_created))
              .limit(1)
              .get(),
          )
          const lastDeliveryID: string | null = lastDeliveryRow?.delivery_id ?? null
          if (lastDeliveryID) {
            const prosecutorRow = Database.use((db) =>
              db
                .select()
                .from(EngineArtifactTable)
                .where(
                  and(
                    eq(EngineArtifactTable.task_id, taskID),
                    eq(EngineArtifactTable.kind, "prosecutor_attempt"),
                    eq(EngineArtifactTable.delivery_id, lastDeliveryID),
                  ),
                )
                .orderBy(desc(EngineArtifactTable.time_created))
                .limit(1)
                .get(),
            )
            if (prosecutorRow) {
              const p = (prosecutorRow.payload ?? {}) as Record<string, unknown>
              sections.push(
                `\n## Prosecutor (latest, delivery ${lastDeliveryID})`,
                `- iteration=${Number(p.iteration ?? 0)}` +
                  ` filed=${Number(p.counterexamples_filed ?? 0)}` +
                  ` proposed=${Number(p.challenges_proposed ?? 0)}` +
                  ` resolved=${Number(p.counterexamples_resolved ?? 0)}`,
              )
            } else {
              sections.push(
                `\n## Prosecutor (latest, delivery ${lastDeliveryID})`,
                `- not run for this delivery — call \`prosecute\` after \`deliver\` and before \`publish_delivery\`.`,
              )
            }
          }
        }

        const result = sections.length > 0 ? sections.join("\n") : "No context available yet."
        // Telemetry: read_context is structurally bounded by the per-section
        // caps above, but if a future change blows through the budget the
        // protocol layer surfaces it instead of letting it slip silently.
        SubAgentProtocol.report(result, "tool:read_context")
        return result
      },
    }),

    fail_task: tool({
      description: "Mark the task as failed. Use when the task cannot be completed.",
      inputSchema: z.object({
        error: z.string().describe("Why the task failed"),
      }),
      execute: async ({ error }) => {
        const task = requireTask(taskID)
        await updateTask(task, { status: "failed", error, time_completed: Date.now() }, `Failed: ${error}`)

        // Task is dead — every goal's worktree is now garbage. Clean
        // proactively here rather than waiting for the engine/writer
        // task-terminal sweep so disk usage drops at the moment of
        // decision (rule 22: orchestrator owns worktree lifecycle).
        const cleaned = await cleanupTerminalGoalWorkspaces("fail_task")
        return `Task ${taskID} failed: ${error}${cleaned > 0 ? ` (${cleaned} goal worktree(s) cleaned)` : ""}`
      },
    }),

    cancel_task: tool({
      description:
        "Cancel the task immediately. Use when the user explicitly asks to stop or abandon the current work.",
      inputSchema: z.object({
        reason: z.string().describe("Why you are cancelling the task"),
      }),
      execute: async ({ reason }) => {
        await EngineService.cancelTask(taskID)
        return `Task ${taskID} cancelled. Reason: ${reason}`
      },
    }),

    retry_task: tool({
      description: "Retry the same task when the operator wants a fresh scheduling pass from the latest evidence.",
      inputSchema: z.object({
        reason: z.string().describe("Why you are retrying the task"),
      }),
      execute: async ({ reason }) => {
        await EngineService.retryTask(taskID)
        return `Task ${taskID} retried. Reason: ${reason}`
      },
    }),

    inject_operator_message: tool({
      description:
        "Forward the latest operator message into the currently running executor session. Use only when the task should continue under the same active execution, not when strategy must change.",
      inputSchema: z.object({
        reason: z.string().describe("Why this operator message should be injected into the current execution"),
      }),
      execute: async ({ reason }) => {
        const latest = input.operatorMessage?.text?.trim()
        if (!latest) {
          return "No operator message is available on this trigger."
        }
        const payload = input.operatorMessage?.attachmentSummary
          ? `${latest}\n\n${input.operatorMessage.attachmentSummary}`
          : latest
        const result = await EngineService.injectMessage(taskID, payload)
        return `Operator message injected. Reason: ${reason}. resumed=${result.resumed} status=${result.status}`
      },
    }),

    steer_subagent: tool({
      description:
        "Send a scoped steering message to a child agent session and wake that session. " +
        "Use this before retrying a sub-agent that appears idle/timed out: ask for current status, partial findings, and whether it can continue.",
      inputSchema: z.object({
        session_id: z.string().min(1).describe("Child agent session id to steer"),
        message: z.string().min(1).describe("Natural-language steering/status-check message for that sub-agent"),
        reason: z.string().describe("Why this sub-agent must be contacted before retrying"),
      }),
      execute: async ({ session_id, message, reason }) => {
        const result = await EngineService.replyAgentSession(taskID, session_id, { message })
        return `Steered sub-agent session ${result.session_id}. message=${result.message_id}. Reason: ${reason}`
      },
    }),

    restart_from_stage: tool({
      description:
        "Restart the task from a specific stage. Use when the current approach is fundamentally wrong, the user requests a restart, or you need to redo requirements/plan from scratch. `plan` fully regenerates the goal decomposition while keeping requirements intact — use it after repeated per-goal retry has failed to converge.",
      inputSchema: z.object({
        stage: z
          .enum(["requirements", "plan", "executor"])
          .describe(
            "`requirements`: re-elicit requirements; deletes spec + plan + goals. " +
              "`plan`: keep requirements; delete plan + goals so the architect fully re-decomposes from scratch. " +
              "`executor`: keep requirements + plan + goals; reset goal statuses so the executor re-runs each goal.",
          ),
        reason: z.string().describe("Why restarting from this stage"),
      }),
      execute: async ({ stage, reason }) => restartTaskFromStage(stage, reason),
    }),

    deliver: tool({
      description:
        "FINAL acceptance gate — call ONLY after every dispatchable goal is terminal (passed/failed) and no eligible wave remains uncalled. Aggregates goal deliveries and runs DeliveryAgent for build/test/startup verification. NEVER call while goals are pending/dispatched/running, NEVER call as a progress check, NEVER call before any build has produced material in direct mode. Always read_context first to verify the goal graph is fully resolved.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to deliver now"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        const designGate = requireDesignAnalysisBefore("deliver", task)
        if (designGate) return designGate

        // Stateless / unconditional deliver (rule 23): every task ends through
        // this agent regardless of upstream state. No "execute goals first"
        // gate. Delivery persistence is run-scoped: goal tasks can create a
        // dispatchable run from the goal graph, while direct task-level builds
        // must have created their run in `build`.
        let activeRun = findActiveRunForTask(task.id)
        if (!activeRun && listGoals(taskID).length > 0) {
          const ensured = await ensureDispatchableRunForSingleGoal()
          if ("error" in ensured) return `deliver: cannot ensure coordinator run — ${ensured.error}`
          activeRun = ensured.run
        }
        if (!activeRun) {
          return "deliver: no coordinator run exists for this task. Run build first so delivery can bind evidence to the build run."
        }
        const run = activeRun

        await trackStepStart("deliver")

        const goals = listGoals(taskID)

        // Aggregate per-goal deliveries by task. Every valid delivery has a
        // coordinator run; goal_run_attempt rows also carry that run_id.
        const { listGoalRunsForTask, findDeliveryByGoalRun } = await import("@/engine/store")
        const goalRuns = listGoalRunsForTask(task.id)
        const allDiffs: Array<{ file: string; diff?: string; [key: string]: unknown }> = []
        const seenFiles = new Set<string>()
        const summaries: string[] = []
        const aggregatedGoalReports: Array<{ goalTitle: string; report: import("@/delivery/checks").GoalReportClaim }> =
          []
        for (const gr of goalRuns) {
          const d = findDeliveryByGoalRun(gr.id)
          if (!d) continue
          if (d.summary) summaries.push(d.summary)
          const result = d.result as {
            diffs?: Array<{ file: string; diff?: string; [key: string]: unknown }>
            report?: import("@/delivery/checks").GoalReportClaim
          } | null
          if (result?.report) {
            const goalRow = gr.goal_id
              ? Database.use((db) => db.select().from(EngineGoalTable).where(eq(EngineGoalTable.id, gr.goal_id!)).get())
              : undefined
            aggregatedGoalReports.push({
              goalTitle: goalRow?.title ?? gr.goal_id ?? gr.id,
              report: result.report,
            })
          }
          if (!result?.diffs) continue
          for (const diff of result.diffs) {
            if (!seenFiles.has(diff.file)) {
              seenFiles.add(diff.file)
              allDiffs.push(diff)
            }
          }
        }

        // Direct-workflow material collection: when the task is explicit
        // kind=build (build → deliver, no per-goal dispatch), there are zero
        // goal_runs and therefore zero aggregated diffs — but the build
        // agent still wrote files to the main worktree. Without material
        // here the delivery agent sees an empty workspace and rubber-stamps
        // "accepted", which defeats the "build mode also undergoes delivery
        // acceptance" contract. Read the working-tree diff directly so the
        // delivery agent judges the actual changes.
        if (allDiffs.length === 0 && goalRuns.length === 0) {
          try {
            const cwd = Instance.directory
            const statusResult = await runGit(["status", "--porcelain=v1", "-uall"], { cwd, timeoutProfile: "default" })
            const statusLines = statusResult.stdout
              .toString()
              .split("\n")
              .filter((line) => line.trim().length > 0)
            for (const raw of statusLines) {
              // Porcelain format: "XY file" (X=index status, Y=worktree status). Extract the path.
              const file = raw
                .slice(3)
                .trim()
                .replace(/^"(.+)"$/, "$1")
              if (!file || seenFiles.has(file)) continue
              let diff = ""
              const diffResult = await runGit(["diff", "HEAD", "--", file], { cwd, timeoutProfile: "default" })
              if (diffResult.exitCode === 0) diff = diffResult.stdout.toString()
              if (!diff) {
                // New / untracked — read raw contents so the delivery agent
                // has real bytes instead of an empty diff.
                const fs = await import("node:fs/promises")
                const path = await import("node:path")
                const full = path.join(cwd, file)
                const content = await fs.readFile(full, "utf8").catch(() => "")
                if (content) diff = `New file:\n${content}`
              }
              seenFiles.add(file)
              allDiffs.push({ file, diff })
            }
            if (allDiffs.length > 0) {
              summaries.push(`Direct build produced ${allDiffs.length} changed file(s) in the main worktree.`)
              log.info("deliver: direct-mode diff captured from main worktree", {
                taskID,
                fileCount: allDiffs.length,
              })
            } else {
              log.warn("deliver: direct mode with no per-goal deliveries AND empty working tree", {
                taskID,
                cwd,
              })
            }
          } catch (err) {
            log.warn("deliver: direct-mode diff capture failed (non-fatal)", {
              taskID,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        const allGoals = listGoals(taskID)
        const activeSpecSnapshot = findActiveSpecForTask(taskID)
        const goalInfos = allGoals.map((g) => {
          const acceptanceSpecs = (g.acceptance_specs ?? []) as AcceptanceSpec[]
          const latestGoalRun = findLatestTipGoalRun(g.id)
          return {
            id: g.id,
            latest_goal_run_id: latestGoalRun?.id,
            title: g.title,
            description: g.objective,
            criteria: renderSpecsAsText(acceptanceSpecs),
            priority: g.priority as "blocking" | "advisory",
            acceptance_spec_count: acceptanceSpecs.length,
            acceptance_scenarios: acceptanceSpecs.filter((spec) => !!spec.scenario),
            acceptance_specs: acceptanceSpecs,
            requirement_ids: Array.isArray(g.requirement_ids) ? (g.requirement_ids as string[]) : [],
            depends_on: Array.isArray(g.depends_on) ? (g.depends_on as string[]) : [],
            owned_paths: Array.isArray(g.owned_paths) ? (g.owned_paths as string[]) : [],
          }
        })

        // Persist aggregated delivery — task-scoped variant, which is the
        // only path that creates the `scope='delivery'` evaluation row the
        // delivery-agent later settles via updateEvaluationFromDeliveryVerdict.
        const { persistTaskDelivery } = await import("@/engine/persist")
        const deliveryID = Identifier.ascending("delivery")
        persistTaskDelivery({
          task,
          run,
          deliveryID,
          delivery: {
            summary: summaries.length > 0 ? summaries.join("\n") : "Aggregated delivery",
            diffs: allDiffs,
          },
          now: Date.now(),
        })

        // Run DeliveryAgent to verify build/test/startup
        const deliveryInfo: import("@/delivery/checks").DeliveryInfo = {
          summary: summaries.join("\n"),
          changedFiles: allDiffs.map((d) => d.file),
          diffs: allDiffs.map((d) => ({ file: d.file, diff: d.diff })),
          goalReports: aggregatedGoalReports,
        }

        // Render the merged delivery output to a screenshot and register it
        // as a task attachment with intent="rendered_output". The delivery
        // agent consumes both the reference image(s) AND this rendered PNG
        // as multimodal attachments, and produces actionable spatial
        // feedback ("sidebar 20px wider than reference, primary color too
        // dark, hero CTA missing") that the executor can act on during
        // rework. No SSIM gate: a single similarity number told the
        // executor "different" but never "different where" — the metric
        // also made delivery lazy, rubber-stamping "visual_diff passed"
        // without really comparing. Rendering lives here rather than in
        // per-goal evaluator because only the merged worktree represents
        // the final artifact users see.
        let renderedAttachment:
          | {
              sha: string
              url: string
              mime: string
              size: number
              filename?: string
              intent: "rendered_output"
              source: "runtime_capture"
            }
          | undefined
        // P0-0.B — for any task that ships visual references (user attachments
        // or design-analysis screenshots), rendering the merged worktree to a
        // PNG is a HARD prerequisite, not a best-effort. Failure to render a
        // visual deliverable means the delivery agent can never see what was
        // built — judging only against the reference is the exact "LLM only
        // sees reference" downgrade path the spec forbids (rule 1, no
        // fallback). We surface the failure as a structured reject signal and
        // skip the agent run entirely.
        let renderFailure: { kind: "no_live_preview" | "render_threw"; detail: string } | undefined
        try {
          const liveTask = requireTask(taskID)
          // Visual references for sizing the render viewport: union of user
          // attachments (figma/user-upload) and system_artifacts (URL
          // screenshots). The previous rendered_output (if any) is excluded —
          // the new render is what sets the comparison baseline this round.
          const visualPool = [
            ...(Array.isArray(liveTask.attachments) ? (liveTask.attachments as any[]) : []),
            ...(Array.isArray(liveTask.system_artifacts) ? (liveTask.system_artifacts as any[]) : []),
          ].filter((a) => a?.intent !== "rendered_output")
          const tagged = visualPool.filter((a) => a?.intent === "visual_reference" && typeof a?.url === "string")
          const imageAttachments =
            tagged.length > 0
              ? tagged
              : visualPool.filter(
                  (a) => typeof a?.mime === "string" && a.mime.startsWith("image/") && typeof a?.url === "string",
                )
          if (imageAttachments.length > 0) {
            const { captureRuntimePage } = await import("@/delivery/runtime-capture")
            const { ManagedPreviewStartError, startManagedPreview } = await import("@/preview/managed")
            const { AttachmentStore } = await import("@/storage/attachment-store")
            let preview:
              | {
                  projectRoot: string
                  session: {
                    status: string
                    url?: string
                    reason?: string
                  }
                }
              | undefined
            try {
              preview = await startManagedPreview({
                taskID,
                workspaceDir: Instance.directory,
                changedFiles: allDiffs.map((diff) => diff.file),
                metadata: liveTask.metadata as Record<string, unknown> | undefined,
              })
            } catch (error) {
              if (error instanceof ManagedPreviewStartError) {
                renderFailure = {
                  kind: "no_live_preview",
                  detail: error.evidence.join(" | "),
                }
              } else {
                throw error
              }
            }
            if (!preview) {
              // renderFailure already recorded above.
            } else if (preview.session.status !== "ready" || !preview.session.url) {
              renderFailure = {
                kind: "no_live_preview",
                detail:
                  `merged worktree at ${preview.projectRoot} has no live preview URL — ` +
                  `visual deliverable cannot be rendered; status=${preview.session.status} ` +
                  `reason=${preview.session.reason ?? "none"}`,
              }
            } else {
              // Pick the first image attachment to size the viewport. All
              // references are later shown to the delivery LLM multimodally
              // so the choice here is purely about matching the rendered
              // viewport to the primary reference's native size.
              const ref = imageAttachments[0]
              const located = AttachmentStore.nameFromUrl(String(ref.url))
              const refPath = located ? AttachmentStore.resolveAbsolute(located.projectID, located.name) : undefined
              if (!refPath) {
                log.warn("deliver: reference attachment could not be resolved — rendering at default viewport", {
                  taskID,
                  url: ref.url,
                })
              }
              const visualOut = path.join(Instance.directory, ".opencorvus", "visual-diff")
              const rendered = await captureRuntimePage({
                url: preview.session.url,
                outDir: visualOut,
                referenceForViewport: refPath,
                viewport_width: refPath ? undefined : 1440,
                viewport_height: refPath ? undefined : 900,
                fileLabel: "rendered",
              })
              if (!rendered.captured) throw new Error(rendered.capture_error.message)
              // Persist the rendered screenshot to the attachment store so
              // the delivery agent's multimodal prompt can inline it the
              // same way it inlines user-provided references.
              const bytes = await (await import("node:fs/promises")).readFile(rendered.path)
              const written = await AttachmentStore.write(liveTask.project_id, bytes, "image/png", "rendered.png")
              renderedAttachment = {
                sha: written.sha,
                url: written.url,
                mime: written.mime,
                size: written.size,
                filename: written.filename,
                intent: "rendered_output",
                source: "runtime_capture",
              }
              // System-generated visual evidence — lives in system_artifacts,
              // not the user-contract attachments column. Replace-by-intent so
              // reruns don't accumulate stale rendered PNGs.
              await EngineService.replaceTaskSystemArtifactByIntent(taskID, "rendered_output", renderedAttachment)
              log.info("deliver: rendered merged worktree", {
                taskID,
                renderedPath: rendered.path,
                size: rendered.size,
                sha: renderedAttachment.sha,
              })
            }
          }
        } catch (renderErr) {
          renderFailure = {
            kind: "render_threw",
            detail: renderErr instanceof Error ? renderErr.message : String(renderErr),
          }
        }

        if (renderFailure) {
          deliveryInfo.runtimeEvidenceFailures = [`[render] ${renderFailure.kind}: ${renderFailure.detail}`]
          log.warn("deliver: render prerequisite failed — routing through delivery agent", {
            taskID,
            kind: renderFailure.kind,
          })
        }

        // Single session per sub-agent (rule 22). DeliveryService.verify
        // creates the runner session internally under the orchestrator parent.
        try {
          const { DeliveryService } = await import("@/delivery/service")
          const { DeliveryVerdict } = await import("@/delivery/agent")
          // Re-read the task row to pick up references materialized during
          // design_analysis. Delivery sees BOTH columns: user-contract
          // attachments (figma frames, user uploads) AND system_artifacts
          // (URL screenshots from design_analysis, plus the just-rendered
          // PNG of the merged worktree). The visual-comparison loop needs
          // both to diff "what we built" against "what the user asked for".
          const taskForDelivery = requireTask(taskID)
          type AttachmentRef = {
            sha: string
            url: string
            mime: string
            size: number
            filename?: string
            intent?: string
            source?: string
          }
          const deliveryAttachments = [
            ...(Array.isArray(taskForDelivery.attachments) ? (taskForDelivery.attachments as AttachmentRef[]) : []),
            ...(Array.isArray(taskForDelivery.system_artifacts)
              ? (taskForDelivery.system_artifacts as AttachmentRef[])
              : []),
          ].filter((a) => typeof a?.mime === "string" && a.mime.startsWith("image/") && typeof a?.url === "string")

          // Compute current iteration up-front so DeliveryService.verify can
          // namespace its deterministic-gate rejection card by iteration. The
          // metrics block below recomputes the same thing for its own use; both
          // read from the same readIterationHistory source so the value is
          // identical (no double-source — metrics still owns the snapshot
          // write, this just shares the read).
          const { readIterationHistory: readIterHistForVerify } = await import("@/metrics/store")
          const deliverIteration = readIterHistForVerify(taskID).length

          // Short-circuit: if the per-goal evaluator already flagged strict
          // checks as failed, the delivery LLM cannot rescue the outcome —
          // the post-hoc hard gate below would force-reject anyway. Skipping
          // Delivery agent runs unconditionally — no pre-flight evaluator gate,
          // no strict-check short-circuit, no post-hoc verdict override. The
          // agent reads acceptance_specs as INFORMATION and verifies them
          // itself (Phase 2 / 2.5 in DELIVERY_AGENT_SYSTEM), including per-goal
          // subagent dispatch for adversarial review at scale.
          const verdict: import("@/delivery/agent").DeliveryVerdictType = await DeliveryService.verify({
            task: {
              id: task.id,
              title: task.title,
              request: task.request,
              sessionID: task.session_id ?? undefined,
              metadata: task.metadata ?? undefined,
              design_specs: Array.isArray(task.design_specs) ? (task.design_specs as any) : undefined,
            },
            goals: goalInfos,
            delivery: deliveryInfo,
            attachments: deliveryAttachments,
            signal: input.signal,
            iteration: deliverIteration,
            parentSessionID: input.agentSessionID,
            runID: run?.id,
            deliveryID,
            specSnapshotID: activeSpecSnapshot?.id,
            criteriaResults: Array.isArray(task.criteria_results) ? (task.criteria_results as any) : [],
          })

          // Persist verdict as artifact
          const { EngineArtifactTable } = await import("@/engine/engine.sql")
          const verdictArtifactId = Identifier.ascending("artifact")
          Database.use((db) =>
            db
              .insert(EngineArtifactTable)
              .values({
                id: verdictArtifactId,
                task_id: taskID,
                run_id: run?.id ?? null,
                delivery_id: deliveryID,
                kind: "verdict",
                label: "delivery-agent-verdict",
                payload: verdict,
                time_created: Date.now(),
                time_updated: Date.now(),
              })
              .run(),
          )

          // Sink delivery agent's structured verdict into engine_task.criteria_results.
          // The verdict carries three distinct typed surfaces — flatten them into the
          // unified criteria stream so the overlay's Quality Gates panel reflects what
          // the agent actually verified, not just a single pass/fail bit.
          await sinkDeliveryVerdictToCriteria(taskID, verdict)

          const passedCount = goals.filter((g) => goalStatusByID(g.id) === "passed").length
          const failedCount = goals.filter((g) => goalStatusByID(g.id) === "failed").length
          // ── Run metric executor + record trajectory snapshot ───────────
          // The delivery agent's verdict is the AUTHORITATIVE decision. The
          // old deterministic Arbiter (`metrics/arbiter.ts::arbitrate`) that
          // used to re-derive accept/continue/stalled/abort from snapshot
          // counts was a coded FSM (CLAUDE.md rule 23) — it silently
          // overrode the agent's verdict and caused the benchmark deadlock
          // on skipped metrics. The snapshot is still written for
          // observability (LLM reads it via query_metric_trajectory).
          const { executeMetrics } = await import("@/metrics/executor")
          const { computeIterationSnapshot } = await import("@/metrics/score")
          const {
            readCounterexamplesForTask,
            readIterationHistory,
            readPreviousAggregateScore,
            readResultsForIteration,
            readSpecsForTask,
            writeIterationSnapshot,
          } = await import("@/metrics/store")

          const priorIterations = readIterationHistory(taskID)
          const iteration = priorIterations.length
          await executeMetrics({
            task_id: taskID,
            iteration,
            delivery: {
              summary: verdict.summary,
              changed_files: Array.isArray((deliveryInfo as any)?.changed_files)
                ? ((deliveryInfo as any).changed_files as string[])
                : undefined,
              requirement_text: task.request,
            },
          })

          // Prosecutor is no longer invoked here (audit 2026-04-25). The
          // adversarial pass is a sibling agent call driven by the
          // orchestrator via the `prosecute` tool, which the orchestrator
          // calls AFTER `deliver` returns. Counterexamples filed in the
          // prosecute step land before the next deliver iteration's
          // trajectory query reads them, which is the only ordering
          // requirement; the iteration snapshot below is recomputed by the
          // next `deliver` run without needing the prosecutor's output to
          // be present in this snapshot.
          const specs = readSpecsForTask(taskID)
          const currentResults = readResultsForIteration(taskID, iteration)
          const previousResults = iteration > 0 ? readResultsForIteration(taskID, iteration - 1) : []
          const counterexamples = readCounterexamplesForTask(taskID)
          const previousAggregateScore = readPreviousAggregateScore(taskID, iteration)
          const snapshot = computeIterationSnapshot({
            task_id: taskID,
            iteration,
            specs,
            currentResults,
            previousResults,
            counterexamples,
            previousAggregateScore,
          })
          // Project agent verdict onto the legacy snapshot column so prompts
          // that already cite "arbiter_verdict" (delivery/tools, prosecutor,
          // orchestrator summary) keep rendering without churn. accepted →
          // "accept"; anything else → "continue" (rework).
          const projectedVerdict = verdict.verdict === "accepted" ? ("accept" as const) : ("continue" as const)
          writeIterationSnapshot({ ...snapshot, arbiter_verdict: projectedVerdict })
          log.info("deliver: agent verdict recorded", {
            taskID,
            iteration,
            agentVerdict: verdict.verdict,
            aggregate_score: snapshot.aggregate_score.toFixed(3),
            blocking_unmet: snapshot.blocking_unmet_count,
          })

          // P0-C.1 — anchor every delivery picky-loop iteration in git so
          // (a) the LKG rollback (P0-C.4) has commits to reset to, (b) the
          // publisher computes changedFiles from git history (P0-C.3), and
          // (c) `git log --grep="delivery round"` reads the round timeline.
          // Allow-empty so a "no edits this round" verdict still anchors.
          log.info("deliver: round commit START", { taskID, iteration })
          const roundCommitTask = requireTask(taskID)
          log.info("deliver: round commit, requireTask done", { taskID })
          const roundCommitVerdict = {
            verdict: verdict.verdict,
            summary: verdict.summary,
            rejection_count: verdict.verdict === "rejected" ? verdict.rejection_details.length : 0,
          }
          log.info("deliver: round commit, verdict shape built", {
            taskID,
            verdict: roundCommitVerdict.verdict,
            rejection_count: roundCommitVerdict.rejection_count,
          })
          const roundCommit = await EngineGit.commitDeliveryRound({
            task: roundCommitTask,
            iteration,
            verdict: roundCommitVerdict,
            declaredChangedFiles: deliveryInfo.changedFiles,
          })
          log.info("deliver: round commit", {
            taskID,
            iteration,
            mode: roundCommit.mode,
            commit: roundCommit.commit,
            error: roundCommit.error,
          })

          // P0-C.4 — Last-Known-Good rollback. Compute the visual score for
          // this round, compare against task.metadata.git.delivery_lkg, and
          // either advance the LKG anchor (improvement) or reset --hard back
          // to it (regression past tolerance). Skipped silently for tasks
          // that have no rendered_output + reference pair (lib/api projects
          // do not have a meaningful visual score). Score / outcome flow
          // into the verdict artifact + decision log so Stream G's replay
          // reads them without a separate table.
          let lkgOutcome: import("@/engine/git").LKGOutcome | undefined
          let lkgMetric: import("@/delivery/visual-metric").VisualMetricResult | undefined
          let lkgRenderedPath: string | undefined
          try {
            const taskAfterRound = requireTask(taskID)
            const renderedRef = (taskAfterRound.system_artifacts ?? []).find(
              (a: any) => a?.intent === "rendered_output" && typeof a?.url === "string",
            ) as { url: string } | undefined
            const referencePool = [
              ...((taskAfterRound.attachments ?? []) as any[]),
              ...((taskAfterRound.system_artifacts ?? []) as any[]),
            ].filter(
              (a) =>
                a?.intent !== "rendered_output" &&
                typeof a?.mime === "string" &&
                a.mime.startsWith("image/") &&
                typeof a?.url === "string",
            )
            const tagged = referencePool.filter((a) => a?.intent === "visual_reference")
            const referenceRef = (tagged[0] ?? referencePool[0]) as { url: string } | undefined

            if (renderedRef && referenceRef) {
              if (!roundCommit.commit) {
                throw new Error("deliver: LKG isolated evaluation requires a round commit sha")
              }
              const { evaluateLKGInIsolatedWorktree } = await import("@/delivery/lkg-isolated-eval")
              const lkg = await evaluateLKGInIsolatedWorktree({
                task: taskAfterRound,
                iteration,
                roundCommitSha: roundCommit.commit,
                renderedRefUrl: renderedRef.url,
                referenceRefUrl: referenceRef.url,
              })
              lkgMetric = lkg.metric
              lkgRenderedPath = lkg.renderedArtifactPath
              lkgOutcome = lkg.outcome
              log.info("deliver: LKG outcome", {
                taskID,
                iteration,
                kind: lkg.outcome.kind,
                score: lkg.metric.score.toFixed(3),
                best_score: "previous" in lkg.outcome ? lkg.outcome.previous.best_score.toFixed(3) : undefined,
                evaluatedSha: lkg.evaluatedSha,
                renderedArtifact: lkg.renderedArtifactPath,
                rolledBackTo: "rolledBackTo" in lkg.outcome ? lkg.outcome.rolledBackTo : undefined,
                activeSiblings: "activeSiblings" in lkg.outcome ? lkg.outcome.activeSiblings : undefined,
              })
              try {
                const { createDecisionLog } = await import("@/decision-log")
                const rolledBackTo = "rolledBackTo" in lkg.outcome ? lkg.outcome.rolledBackTo : undefined
                const activeSiblings = "activeSiblings" in lkg.outcome ? lkg.outcome.activeSiblings : undefined
                createDecisionLog(taskID).append({
                  phase: "delivery",
                  key: lkg.outcome.kind === "blocked_by_siblings"
                    ? `delivery_lkg_blocked_${iteration}`
                    : `delivery_lkg_${iteration}`,
                  value:
                    `score=${lkg.metric.score.toFixed(3)} outcome=${lkg.outcome.kind} ` +
                    `evaluated_sha=${lkg.evaluatedSha} rendered_artifact=${lkg.renderedArtifactPath}` +
                    (rolledBackTo ? ` rolled_back_to=${rolledBackTo}` : "") +
                    (activeSiblings ? ` active_siblings=${JSON.stringify(activeSiblings)}` : ""),
                  reason: lkg.outcome.kind === "blocked_by_siblings"
                    ? "reset skipped due to concurrent sibling goals"
                    : rolledBackTo ? `rollback_to=${rolledBackTo}` : "",
                })
              } catch {
                /* best effort */
              }
            }
          } catch (lkgErr) {
            // Rollback failure is structural — surface loudly but do NOT
            // silently swallow it. The next iteration would compound the bad
            // state. Log error and continue: verdict still records the
            // (untrustworthy) state, and the orchestrator LLM sees the
            // rollback failure in the decision log on its next turn.
            log.error("deliver: LKG evaluation/rollback failed", {
              taskID,
              iteration,
              error: lkgErr instanceof Error ? lkgErr.message : String(lkgErr),
            })
            try {
              const { createDecisionLog } = await import("@/decision-log")
              createDecisionLog(taskID).append({
                phase: "delivery",
                key: `delivery_lkg_failed_${iteration}`,
                value: lkgErr instanceof Error ? lkgErr.message : String(lkgErr),
                reason: "lkg_evaluation_threw",
              })
            } catch {
              /* best effort */
            }
          }

          // Phase-6-c: engine_delivery_round was an observability side-channel
          // (writer: this site; reader: script/delivery/replay.ts). Per
          // specs/new-arch/16-unified-teardown.md §7-6-c + rule 22 (禁双源),
          // picky-loop verdict signal lives in decision_log + artifact stream
          // (`changed_file` / `report` / `verdict` kinds), so the parallel
          // delivery_round table was removed. Rolled-back / regressed outcomes
          // still get surfaced via the decision log appended above.
          if (
            verdict.verdict === "accepted" &&
            (lkgOutcome?.kind === "regressed" || lkgOutcome?.kind === "blocked_by_siblings")
          ) {
            await trackStepComplete("deliver", undefined, true)
            const detail = lkgOutcome.kind === "regressed"
              ? `rolled_back_to=${lkgOutcome.rolledBackTo}`
              : `active_siblings=${lkgOutcome.activeSiblings.join(",")}`
            return (
              `Delivery agent accepted, but isolated LKG evaluation detected ${lkgOutcome.kind}; ` +
              `${detail}; score=${lkgMetric?.score.toFixed(3) ?? "n/a"}; ` +
              `rendered_artifact=${lkgRenderedPath ?? "n/a"}. Current primary HEAD was not reset or published.`
            )
          }

          if (verdict.verdict === "accepted") {
            await trackStepComplete("deliver")
            log.info("deliver: agent accepted, auto-publishing", { taskID, runID: run?.id ?? null, deliveryID })
            // Auto-publish: delivery agent accepted → immediately complete task.
            // No second LLM turn needed — avoids infinite loop where LLM ends turn
            // without calling publish_delivery.
            //
            // Stateless deliver path (run-less tasks): if no coordinator run
            // exists, there is no Publisher pipeline to drive — the task has
            // no goals/plan to merge. The verdict is already recorded above;
            // surface the accept to the LLM so it can fail-task or complete
            // by other means. This path is rare (most tasks now lazy-create
            // a run via build), but covered for unconditional deliver intent.
            if (!run) {
              return `Delivery verified and ACCEPTED, but no coordinator run exists for this task — nothing for Publisher to merge. Verdict artifact ${verdictArtifactId} recorded; call modify_goal/build to materialise a goal-bearing run if you need to publish a deliverable.`
            }
            try {
              const delivery = findDeliveryByRun(run.id)
              if (!delivery) return `Delivery verified and ACCEPTED but no delivery record found.`
              const verdictArtifact = Database.use((db) =>
                db.select().from(EngineArtifactTable).where(eq(EngineArtifactTable.id, verdictArtifactId)).get(),
              )
              // No host gate veto on an LLM-accepted delivery. If the agent
              // says accepted, we publish — the gate is informational. The
              // previous `finalGate.status !== "passed"` check returned a
              // tool-result string that didn't change run state; the
              // orchestrator's next turn would just call deliver again on
              // the same code → infinite loop on coverage gaps that
              // re-running cannot fix. Per CLAUDE.md rule 7 (no dual
              // accept paths) and rule 13 (LLM owns the decision).
              markDeliveryPublishing(delivery.id, Date.now())
              const PUBLISH_TIMEOUT_MS = 60_000
              const currentTask = requireTask(taskID)
              const publishResult = await Promise.race([
                Publisher.deliver({ task: currentTask, run, delivery }),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error("Publisher.deliver() timeout")), PUBLISH_TIMEOUT_MS),
                ),
              ])
              const completed = Date.now()
              finalizeDeliveryResult({
                deliveryId: delivery.id,
                taskId: taskID,
                runId: run.id,
                delivery,
                result: publishResult,
                now: completed,
              })
              if (publishResult.status === "delivered") {
                const current = requireTask(taskID)
                const currentPlan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
                const published = findDeliveryByRun(run.id) ?? delivery
                const verdictPayload = verdictArtifact?.payload as
                  | (import("@/delivery/agent").DeliveryVerdictType & { verdict: "accepted" | "rejected" })
                  | null
                if (verdictPayload?.verdict) {
                  // The persisted verdict carries rejection_details for
                  // rejected verdicts; derive the issues list here so the
                  // schema stays single-source-of-truth (rule 22).
                  const issues =
                    verdictPayload.verdict === "rejected" ? verdictPayload.rejection_details.map((d) => d.error) : []
                  updateEvaluationFromDeliveryVerdict({
                    deliveryID: delivery.id,
                    verdict: verdictPayload.verdict,
                    summary: verdictPayload.summary ?? "Delivery agent verification",
                    // Record agent-reported issues as structured failed-check
                    // rows for operator-facing drill-down. Convergence lives
                    // in engine_iteration, not these rows.
                    checks: issues.map((evidence, i) => ({
                      name: `issue-${i + 1}`,
                      status: "failed" as const,
                      evidence,
                      scorer_kind: "delivery_verdict" as const,
                    })),
                    now: completed,
                  })
                }
                const finalized = await EngineGit.complete(current, currentPlan, published)
                if (finalized.error) {
                  await updateTask(
                    current,
                    { status: "failed", error: finalized.error, time_completed: completed },
                    finalized.error,
                  )
                  return `Git finalization failed: ${finalized.error}`
                }
                const cleanedGoalWorkspaces = await cleanupTerminalGoalWorkspaces("deliver auto-publish")
                // Ensure task is in "active" before completing (recovery may have reset to "queued")
                const preComplete = requireTask(taskID)
                if (isTaskQueued(preComplete)) {
                  await updateTask(preComplete, { status: "active" }, "Activating for completion")
                }
                const readyTask = requireTask(taskID)
                await updateTask(
                  readyTask,
                  { status: "completed", error: null, time_completed: completed },
                  "Task completed",
                )
                const { Plugin } = await import("@/plugin")
                await Plugin.trigger(
                  "delivery.ready",
                  { taskID, runID: run.id, deliveryID: delivery.id },
                  { actions: [] },
                ).catch((err) => log.warn("plugin 'delivery.ready' trigger failed (non-fatal)", { error: String(err) }))
                Promise.race([
                  EngineMemoryBridge.flushTaskLearnings({
                    task: currentTask,
                    run,
                    delivery,
                    evaluation: findEvaluationByRun(run.id),
                    plan: currentPlan,
                  }),
                  new Promise<void>((_, reject) =>
                    setTimeout(() => reject(new Error("flushTaskLearnings timeout (30s)")), 30_000),
                  ),
                ]).catch((err) => log.warn("failed to flush task learnings", { error: String(err) }))
                const cleanupNote =
                  cleanedGoalWorkspaces > 0 ? ` ${cleanedGoalWorkspaces} goal worktree(s) cleaned.` : ""
                return `Delivery published and task completed successfully.${cleanupNote} You can call refine to analyze the project and suggest improvements for the next iteration.`
              }
              return publishGateReworkResult({
                deliveryID: delivery.id,
                runID: run.id,
                summary: publishResult.summary,
                source: "deliver_auto_publish",
              })
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              log.error("deliver: auto-publish failed", {
                taskID,
                error: msg,
                stack: err instanceof Error ? err.stack : undefined,
              })
              return `Delivery verified and ACCEPTED but publish failed: ${msg}. Call publish_delivery to retry.`
            }
          }
          await trackStepComplete("deliver", undefined, true)

          // Schema invariant: at this point `verdict.verdict === "rejected"`,
          // so `rejection_details` is the discriminated-union branch with
          // `.min(1)` non-empty. Entries with `goal_id` are goal-scope; entries
          // without `goal_id` are task-scope and must not reopen every goal.
          const { affectedGoalIDs, issuesFound } = await import("@/delivery/verdict")
          const rejectionAffectedGoalIDs = affectedGoalIDs(verdict)
          const rejectionIssues = issuesFound(verdict)

          // Persist the delivery-agent's advisory verdict into the evaluation
          // row for operator-facing drill-down. Convergence lives in
          // engine_iteration — this row is for audit only.
          updateEvaluationFromDeliveryVerdict({
            deliveryID,
            verdict: verdict.verdict,
            summary: verdict.summary,
            checks: rejectionIssues.map((evidence, i) => ({
              name: `issue-${i + 1}`,
              status: "failed" as const,
              evidence,
              scorer_kind: "delivery_verdict" as const,
            })),
            now: Date.now(),
          })

          // Agent verdict is "rejected" — open a fresh attempt only for goals
          // the delivery brain explicitly attributed the rejection to. The orchestrator's
          // next turn reads engine_iteration + the verdict artifact and
          // chooses strategy (modify_goal / build retry / restart_from_stage / fail_task);
          // the old deterministic "stalled/abort" branches were an FSM over
          // metric counts (CLAUDE.md rule 23) and are gone — give-up decisions
          // belong to the orchestrator LLM.
          //
          // engine_iteration + the verdict artifact persisted above are the
          // canonical source of truth for the rejection details — the
          // orchestrator reads them via query_metric_trajectory and the
          // task loop watermarks the verdict artifact to synthesize a
          // rejection wake note for the next orchestrator decision.
          // No task.metadata signal.
          const { startNewAttempt } = await import("@/engine/persist")
          // Attribution is the delivery brain's job. Task-scope rejections
          // deliberately carry no `goal_id`; they wake the orchestrator with
          // manifest evidence instead of falling back to blanket reset.
          const goalByID = new Map(goals.map((g) => [g.id, g]))
          const unknownAffected: string[] = []
          const toReset: typeof goals = []
          for (const gid of rejectionAffectedGoalIDs) {
            const g = goalByID.get(gid)
            if (!g) {
              unknownAffected.push(gid)
              continue
            }
            toReset.push(g)
          }
          if (unknownAffected.length > 0) {
            // Delivery agent cited a goal id that is not in this task's goal
            // set. Surface loud — either the agent hallucinated an id, or the
            // prompt forgot to list a real goal. Either way the rejection is
            // not actionable as-is; fail the delivery so the orchestrator
            // re-runs instead of silently dropping those ids.
            throw new Error(
              `Delivery verdict cites unknown goal_ids in rejection_details: ${unknownAffected.join(", ")}. ` +
                `Known goals for this task: ${[...goalByID.keys()].join(", ") || "(none)"}.`,
            )
          }

          const {
            findLatestDeliveryEvidenceManifest,
            findDeliveryEvidenceManifestHistory,
            formatDeliveryManifestFailureDetails,
            repeatedDeliveryFailureSignatures,
          } = await import("@/delivery/manifest")
          const currentManifest = findLatestDeliveryEvidenceManifest({ deliveryID })
          const manifestFailureDetails = currentManifest ? formatDeliveryManifestFailureDetails(currentManifest) : []
          const priorManifests = currentManifest?.taskId
            ? findDeliveryEvidenceManifestHistory({
                taskID: currentManifest.taskId,
                beforeTime: currentManifest.timeCreated,
                limit: 5,
              })
            : []
          const repeatedFailure = currentManifest
            ? repeatedDeliveryFailureSignatures({
                current: currentManifest,
                history: priorManifests,
              })
            : { repeated: false, signatures: [] }
          if (repeatedFailure.repeated) {
            log.info("deliver: repeated failure signatures — refusing identical delivery_rework", {
              taskID,
              iteration,
              signatures: repeatedFailure.signatures.length,
            })
            const { countPriorRepeatedDeliveryFailureSignals } = await import("@/delivery/manifest")
            const priorSignalCount = countPriorRepeatedDeliveryFailureSignals(
              createDecisionLog(taskID).readByPhase("delivery"),
            )
            createDecisionLog(taskID).append({
              phase: "delivery",
              key: `delivery_repeated_failure_signature_${iteration}`,
              value: `Repeated delivery failure signatures: ${repeatedFailure.signatures.join(" | ")}`,
              reason:
                "Current DeliveryEvidenceManifest repeats the prior manifest failure set; the orchestrator must change strategy, ask the operator, or fail_task from evidence instead of blindly repeating the same rework.",
            })
            await trackStepComplete("deliver", undefined, true)
            return SubAgentProtocol.yieldResult({
              headline: `Delivery rejected with repeated failure signatures (iteration=${iteration}). No host rule restarted the plan; choose the next strategy from the manifest evidence.`,
              fields: [
                ["failure_signatures", repeatedFailure.signatures],
                ["manifest_failures", manifestFailureDetails],
                ["iteration", String(iteration)],
                ["prior_repeated_signals", String(priorSignalCount)],
                ["agent_summary", verdict.summary],
              ],
              pointer: `verdict artifact ${verdictArtifactId}; repeated manifest failures require an orchestrator decision`,
            })
          }
          if (toReset.length === 0) {
            createDecisionLog(taskID).append({
              phase: "delivery",
              key: `delivery_task_scope_rejection_${iteration}`,
              value: verdict.summary,
              reason:
                "Delivery rejected at task scope: no rejection_details entry carried a concrete goal_id, " +
                "so no goal attempt was reopened. The orchestrator must fix the integrated deliverable " +
                "with build({ request }) or change strategy before calling deliver again.",
            })
            log.info("deliver: task-scope rejection processed without goal reset", {
              taskID,
              iteration,
              issues: rejectionIssues.length,
              affected_goal_ids: rejectionAffectedGoalIDs,
            })
            await trackStepComplete("deliver", undefined, true)
            return SubAgentProtocol.yieldResult({
              headline:
                `Delivery rejected at task scope — iteration ${iteration}; no goal attempts were reopened. ` +
                `No host rule restarted the plan; choose build({ request }), architect, question, or fail_task from the evidence.`,
              fields: [
                ["issues_found", rejectionIssues],
                ["manifest_failures", manifestFailureDetails],
                ["iteration", String(iteration)],
                ["agent_summary", verdict.summary],
              ],
              pointer: currentManifest
                ? `verdict artifact ${verdictArtifactId}; manifest ${currentManifest.id}; task-scope rejection requires an orchestrator decision`
                : `verdict artifact ${verdictArtifactId}; task-scope rejection requires an orchestrator decision`,
            })
          }
          // Per-goal rejection slice: the delivery agent already attributed
          // each rejection_details[] entry to a specific goal_id; feed that
          // subset (plus the task-level summary) into startNewAttempt so the
          // executor's next prompt shows exactly what this goal must fix.
          // Without this, delivery_rework reworks ran against an unchanged
          // prompt (the root cause we're fixing here).
          for (const g of toReset) {
            const ownDetails = verdict.rejection_details.filter((d) => d.goal_id === g.id)
            const value = composeDeliveryRetryFeedback({
              iteration,
              verdict: verdict.verdict,
              summary: verdict.summary,
              manifestFailureDetails,
              ownDetails,
            })
            const reason = `Delivery rejection; ${rejectionIssues.length} issue(s): ${rejectionIssues.slice(0, 3).join("; ")}`
            startNewAttempt({
              goalID: g.id,
              reason: "delivery_rework",
              feedback: { value, reason },
            })
          }

          try {
            const { createDecisionLog } = await import("@/decision-log")
            const decisionLog = createDecisionLog(taskID)
            decisionLog.append({
              phase: "delivery",
              key: `delivery_rejection_${iteration}`,
              value: verdict.summary,
              reason: rejectionIssues.join("; "),
            })
          } catch {
            /* best effort */
          }

          log.info("deliver: rejection processed", {
            taskID,
            iteration,
            issues: rejectionIssues.length,
            reset_goals: toReset.length,
            affected_goal_ids: rejectionAffectedGoalIDs,
          })

          requestStopAfterCurrentStep("delivery_rework")
          {
            const { dispatchTaskLoop } = await import("@/engine/queue")
            void dispatchTaskLoop({
              taskID,
              event: {
                note: OrchestratorEventNote.deliveryRework({
                  reason: "agent_verdict_rejected",
                  iteration,
                  summary: verdict.summary,
                  affectedGoalCount: toReset.length,
                }),
              },
            })
          }
          return SubAgentProtocol.yieldResult({
            headline: `Delivery rejected — iteration ${iteration}, agent_verdict=${verdict.verdict}, assistant must re-plan`,
            fields: [
              ["issues_found", rejectionIssues],
              ["manifest_failures", manifestFailureDetails],
              ["iteration", String(iteration)],
              ["agent_summary", verdict.summary],
            ],
            pointer: currentManifest
              ? `verdict artifact ${verdictArtifactId}; manifest ${currentManifest.id}; use manifest_failures above before deciding the next tool`
              : `verdict artifact ${verdictArtifactId}; call query_metric_trajectory for full trajectory`,
          })
        } catch (err) {
          await trackStepComplete("deliver", undefined, true)

          const msg = err instanceof Error ? err.message : String(err)
          log.error("deliver: verification failed", { taskID, error: msg })
          // Delivery verification threw — infrastructure fault (network /
          // parse-retry exhaustion / tool crash). Write a snapshot for
          // trajectory visibility; do NOT run any deterministic arbiter
          // here. The old `decisionErr.verdict === "abort" | "stalled"`
          // branch was a metric-count state machine and is retired.
          const { computeIterationSnapshot: computeSnapshotErr } = await import("@/metrics/score")
          const {
            readCounterexamplesForTask: readCeErr,
            readIterationHistory: readHistErr,
            readPreviousAggregateScore: readPrevErr,
            readResultsForIteration: readResErr,
            readSpecsForTask: readSpecsErr,
            writeIterationSnapshot: writeSnapshotErr,
          } = await import("@/metrics/store")
          const priorItersErr = readHistErr(taskID)
          const iterationErr = priorItersErr.length
          const snapshotErr = computeSnapshotErr({
            task_id: taskID,
            iteration: iterationErr,
            specs: readSpecsErr(taskID),
            currentResults: readResErr(taskID, iterationErr),
            previousResults: iterationErr > 0 ? readResErr(taskID, iterationErr - 1) : [],
            counterexamples: readCeErr(taskID),
            previousAggregateScore: readPrevErr(taskID, iterationErr),
          })
          writeSnapshotErr({ ...snapshotErr, arbiter_verdict: "continue" })

          // A throw carries no per-goal attribution. Record the failure in
          // the decision log and keep the task active so the orchestrator can
          // either fix the delivery tool path or change strategy in the same
          // task context.
          try {
            const { createDecisionLog } = await import("@/decision-log")
            const decisionLog = createDecisionLog(taskID)
            decisionLog.append({
              phase: "delivery",
              key: `delivery_verification_threw_${iterationErr}`,
              value: `Delivery agent threw: ${msg}`,
              reason: `infrastructure fault (no verdict produced); iteration ${iterationErr}`,
            })
          } catch {
            /* best effort */
          }
          await persistDeliveryVerificationThrow({
            taskID,
            runID: run?.id,
            deliveryID,
            error: msg,
            iteration: iterationErr,
          })

          return (
            `Delivery verification threw and was persisted as a structured rejection: ${msg}. ` +
            `Iteration ${iterationErr}. No goals were reset — the throw is an ` +
            `infrastructure fault and carries no per-goal attribution. Read the ` +
            `delivery_verification_threw artifact, the delivery-agent-verdict artifact, ` +
            `and decision log entry delivery_verification_threw_${iterationErr}; then ` +
            `continue in this task context: repair the delivery tool path if it is broken, ` +
            `build({ goalID }) on a suspect goal, or modify_goal if the contract looks wrong.`
          )
        }
      },
    }),

    publish_delivery: tool({
      description:
        "Publish the accepted delivery to git and mark the task as completed. " +
        "You decide when it is safe to publish — the describe layer shows every goal's " +
        "`is_terminal_ok` / `is_terminal_fail` / `needs_redispatch` flags and the latest " +
        "delivery verdict. If a blocking goal is failing you must fix it first; no tool " +
        "gate blocks a knowingly-incomplete publish, the decision is yours.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Confirmation that both verifications passed"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        const designGate = requireDesignAnalysisBefore("publish_delivery", task)
        if (designGate) return designGate

        // Stateless / unconditional — same intent as `deliver`. publish_delivery
        // has TWO physical preconditions (delivery row exists; verdict artifact
        // exists) — those stay because "you cannot publish what was never built
        // / never verified" is a physical fact, not a state-machine cache. The
        // "No active run" gate WAS state-machine-ish; lazy-bootstrap a run if
        // one is missing (the deliver call that produced the verdict already
        // does this, so in practice it always exists at this point).
        let run = findActiveRunForTask(task.id)
        if (!run && listGoals(task.id).length > 0) {
          const ensured = await ensureDispatchableRunForSingleGoal()
          if (!("error" in ensured)) run = ensured.run
        }
        if (!run)
          return "publish_delivery: no coordinator run for this task — call build (with a goal) or deliver first to materialise one."

        const delivery = findDeliveryByRun(run.id)
        if (!delivery) return "No delivery found."

        // Require delivery to exist before publishing
        const { EngineArtifactTable } = await import("@/engine/engine.sql")
        const verdictArtifact = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(and(eq(EngineArtifactTable.run_id, run.id), eq(EngineArtifactTable.label, "delivery-agent-verdict")))
            .limit(1)
            .get(),
        )
        if (!verdictArtifact) return "Delivery not verified. Run deliver first to aggregate and verify goal deliveries."
        const verdictPayload = verdictArtifact.payload as
          | (import("@/delivery/agent").DeliveryVerdictType & { verdict: "accepted" | "rejected" })
          | null
        if (verdictPayload?.verdict !== "accepted") {
          return "Delivery verdict is not accepted; publish blocked until deliver verifies the current output."
        }
        const { findLatestDeliveryEvidenceManifest } = await import("@/delivery/manifest")
        const manifest = findLatestDeliveryEvidenceManifest({ deliveryID: delivery.id })
        if (!manifest) {
          return "Delivery evidence manifest is missing; publish blocked until deliver reruns the project gates."
        }
        if (manifest.finalGate.status !== "passed") {
          return `Delivery evidence manifest gate is ${manifest.finalGate.status}: ${manifest.finalGate.summary}`
        }

        markDeliveryPublishing(delivery.id, Date.now())

        const PUBLISH_TIMEOUT_MS = 60_000
        let result: Awaited<ReturnType<typeof Publisher.deliver>>
        try {
          result = await Promise.race([
            Publisher.deliver({ task, run, delivery }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Publisher.deliver() timeout")), PUBLISH_TIMEOUT_MS),
            ),
          ])
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error("publish_delivery failed", { taskID: task.id, runID: run.id, error: msg })
          return `Publish failed: ${msg}. Decide whether to retry or fail the task.`
        }

        const completed = Date.now()
        finalizeDeliveryResult({
          deliveryId: delivery.id,
          taskId: task.id,
          runId: run.id,
          delivery,
          result,
          now: completed,
        })

        if (result.status === "delivered") {
          const current = requireTask(task.id)
          const currentPlan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
          const published = findDeliveryByRun(run.id) ?? delivery

          // Update the evaluation row persistTaskDelivery() created for this
          // delivery. 1:1 task-delivery↔evaluation invariant: the row always
          // exists here (per-goal deliveries never touch this path).
          // No `checks` argument: the `deliver` tool already wrote the full
          // structured check set; updateEvaluationFromDeliveryVerdict
          // preserves existing checks when none are supplied.
          if (verdictPayload?.verdict) {
            updateEvaluationFromDeliveryVerdict({
              deliveryID: delivery.id,
              verdict: verdictPayload.verdict,
              summary: verdictPayload.summary ?? "Delivery agent verification",
              now: completed,
            })
          }

          const finalized = await EngineGit.complete(current, currentPlan, published)
          if (finalized.error) {
            await updateTask(
              current,
              { status: "failed", error: finalized.error, time_completed: completed },
              finalized.error,
            )
            return `Git finalization failed: ${finalized.error}`
          }
          const cleanedGoalWorkspaces = await cleanupTerminalGoalWorkspaces("publish_delivery")
          const cleanupNote = cleanedGoalWorkspaces > 0 ? ` ${cleanedGoalWorkspaces} goal worktree(s) cleaned.` : ""
          await updateTask(
            finalized.task,
            { status: "completed", error: null, time_completed: completed },
            "Task completed",
          )
          const { Plugin } = await import("@/plugin")
          await Plugin.trigger(
            "delivery.ready",
            { taskID: task.id, runID: run.id, deliveryID: delivery.id },
            { actions: [] },
          ).catch(() => undefined)
          // Flush task learnings to memory (fire-and-forget). Bound by a
          // 30s timeout so a stuck Memory.write or LLM-backed digestor
          // can't keep the bun event loop busy after the task itself
          // finished publishing — observed leak when the parent process
          // was killed force-style and these orphan promises kept
          // running.
          const evaluation = findEvaluationByRun(run.id)
          Promise.race([
            EngineMemoryBridge.flushTaskLearnings({ task, run, delivery, evaluation, plan: currentPlan }),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error("flushTaskLearnings timeout (30s)")), 30_000),
            ),
          ]).catch((err) => log.warn("failed to flush task learnings", { error: String(err) }))

          // Auto-launch the deliverable if the delivery agent recorded a
          // launch command. `launch_command` exists only on AcceptedVerdict
          // (the discriminated-union accepted branch); a published delivery
          // is always accepted, but the verdict could nominally be malformed
          // — narrow defensively without coercion.
          const launchCmd = verdictPayload?.verdict === "accepted" ? verdictPayload.launch_command : undefined
          if (launchCmd) {
            try {
              const { Shell } = await import("@/shell/shell")
              const { Filesystem } = await import("@/util/filesystem")
              const projectDir = Filesystem.resolve(Instance.directory)
              const launched = await Shell.launch(launchCmd, { cwd: projectDir })
              const addrNote = launched.address ? ` — running at ${launched.address}` : ` (PID ${launched.pid})`
              log.info("deliverable launched", { pid: launched.pid, address: launched.address, command: launchCmd })
              return `Delivery published and task completed successfully.${cleanupNote} Deliverable launched${addrNote}.`
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              log.warn("auto-launch failed after publish", { error: msg, command: launchCmd })
              return `Delivery published and task completed successfully.${cleanupNote} Auto-launch failed: ${msg}. Launch manually with: ${launchCmd}`
            }
          }

          return `Delivery published and task completed successfully.${cleanupNote} You can call refine to analyze the project and suggest improvements for the next iteration.`
        }

        return publishGateReworkResult({
          deliveryID: delivery.id,
          runID: run.id,
          summary: result.summary,
          source: "publish_delivery",
        })
      },
    }),

    refine: tool({
      description: [
        "Explore the completed project, analyze what was built, and suggest improvements for the next iteration.",
        "Use after task completion (or user re-trigger) to start a new development cycle.",
        "Reads all goal deliveries, explores the codebase, and produces structured suggestions.",
        "After receiving suggestions, surface them in your reply for the user.",
      ].join("\n"),
      inputSchema: z.object({
        focus: z
          .enum(["features", "quality", "tests", "performance", "all"])
          .default("all")
          .describe("What aspect to focus the analysis on"),
        reason: z.string().optional().describe("Why you decided to refine"),
      }),
      execute: async ({ focus }) => {
        await trackStepStart("refine")
        const task = requireTask(taskID)

        // Gather delivery context
        const goals = listGoals(taskID)
        const { listGoalRunsForTask, findDeliveryByGoalRun } = await import("@/engine/store")
        const goalRuns = listGoalRunsForTask(taskID)

        const goalSummaries: string[] = []
        const allChangedFiles: string[] = []
        for (const goal of goals) {
          const gr = goalRuns.find((r) => r.goal_id === goal.id)
          const delivery = gr ? findDeliveryByGoalRun(gr.id) : undefined
          const files = (delivery?.result as any)?.diffs?.map((d: any) => d.file) ?? []
          allChangedFiles.push(...files)
          goalSummaries.push(
            `- [${goalStatusByID(goal.id)}] ${goal.title}: ${renderSpecsAsText((goal.acceptance_specs ?? []) as AcceptanceSpec[]).slice(0, 300)}`,
          )
          if (files.length > 0) goalSummaries.push(`  files: ${files.join(", ")}`)
        }

        // Read Decision Log for architectural context. Refine runs once per
        // task (not per turn), but an unbounded decision log can still push
        // this prompt past the model context; cap matches read_context.
        const { createDecisionLog } = await import("@/decision-log")
        const decisionLog = createDecisionLog(taskID)
        const decisionSection = decisionLog.toPromptSection({ limit: 30 }) ?? ""

        // Run refine analysis via SessionPrompt. No tools, plain text
        // generation driven by system + user prompts; the child session
        // persists transcript for the overlay.
        const model = await resolveAgentModel("orchestrator", { taskID })

        const refineSession = await Session.createNext({
          kind: "assistant",
          parentID: input.agentSessionID,
          title: `Refine: ${task.title}`,
          directory: Instance.directory,
        })

        const systemPrompt = [
          "You are a project analyst reviewing a completed software project.",
          "Analyze the delivered code and suggest concrete improvements for the next iteration.",
          "",
          "Output a JSON object with this structure:",
          "{",
          '  "summary": "one paragraph assessment of current project state",',
          '  "suggestions": [',
          "    {",
          '      "category": "feature|quality|test|performance|refactor",',
          '      "title": "short title",',
          '      "description": "what to do and why",',
          '      "priority": "high|medium|low",',
          '      "effort": "small|medium|large"',
          "    }",
          "  ]",
          "}",
          "",
          `Focus: ${focus}`,
          "Respond in the same language as the original task request.",
          "Return ONLY the JSON object, no markdown fences.",
        ].join("\n")

        const userPrompt = [
          `## Original Task`,
          task.request.slice(0, 2000),
          "",
          `## Completed Goals (${goals.length})`,
          ...goalSummaries,
          "",
          `## Changed Files (${allChangedFiles.length})`,
          allChangedFiles.join(", "),
          "",
          decisionSection,
        ].join("\n")

        let finalMessage: Awaited<ReturnType<typeof SessionPrompt.prompt>>
        try {
          finalMessage = await SessionPrompt.prompt({
            sessionID: refineSession.id,
            model: { providerID: model.providerID, modelID: model.api.id },
            agent: "general",
            system: systemPrompt,
            systemMode: "complete",
            parts: [{ type: "text", text: userPrompt, id: Identifier.ascending("part") }],
          })
        } catch (err) {
          // Refine dispatch boundary — surface terminal to overlay so the
          // refine card flips out of `running` when this single dispatch
          // ends, mirroring agent/runner.ts.
          SessionStatus.set(refineSession.id, {
            type: "terminal",
            reason: "error",
            error: err instanceof Error ? err.message : String(err),
          })
          throw err
        }
        SessionStatus.set(refineSession.id, { type: "terminal", reason: "completed" })
        const resultText = (finalMessage?.parts ?? [])
          .filter((p) => p.type === "text" && typeof (p as any).text === "string")
          .map((p) => (p as any).text as string)
          .join("\n\n")

        await trackStepComplete("refine")

        // Parse the structured suggestions. Refine's contract with the LLM
        // is a JSON object {summary, suggestions[]}; anything else is an
        // upstream model failure. Returning the raw prose here was a silent
        // fallback that piped unbounded text into the orchestrator session —
        // forbidden per project rules. Throwing surfaces the failure so the
        // orchestrator can retry or fail_task based on its own policy.
        let parsed: { summary?: unknown; suggestions?: unknown }
        try {
          parsed = JSON.parse(resultText.trim())
        } catch (parseErr) {
          const preview = resultText.slice(0, 200)
          throw new Error(
            `refine: LLM did not return valid JSON for {summary, suggestions}. ` +
              `Parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}. ` +
              `Output preview: ${preview}${resultText.length > 200 ? "…" : ""}`,
          )
        }
        if (!Array.isArray(parsed.suggestions)) {
          throw new Error(
            `refine: LLM output missing or invalid "suggestions" array (got ${typeof parsed.suggestions}).`,
          )
        }
        const suggestions = parsed.suggestions as Array<{
          priority?: string
          title?: string
          category?: string
          effort?: string
          description?: string
        }>
        const summaryRaw = typeof parsed.summary === "string" ? parsed.summary : ""
        const suggestionLines = suggestions.map(
          (s) =>
            `[${s.priority ?? "?"}] ${s.title ?? "(untitled)"} (${s.category ?? "?"}, ${s.effort ?? "?"}): ${s.description ?? ""}`,
        )
        return SubAgentProtocol.yieldResult({
          headline:
            "Project Analysis complete. To start the next iteration: surface these suggestions to the user " +
            "and let them pick which to roll into a new task.",
          summary: summaryRaw,
          fields: [["suggestions", suggestionLines]],
          pointer: "refine session id (full LLM output) — narrow focus param and re-run to see filtered subsets",
        })
      },
    }),

    question: tool({
      description:
        "Ask the user one or more clarification questions and block until they answer. " +
        "The questions appear in the task's InteractionPanel (with option buttons + free-text input). " +
        "Use SPARINGLY — only when you genuinely cannot proceed without a human decision. " +
        "Valid triggers: (1) incoming request is too vague for requirements decomposition, " +
        "(2) mid-execute missing critical info (tech stack, data source, conflicting goals), " +
        "(3) pre-deliver you have multiple viable approaches and need the user to pick, " +
        "(4) post-refine suggestions — let the user select which improvements to roll in. " +
        "Each question may provide options for click-selection; omit options for free-text. " +
        "Set multiple=true to allow multi-select. Returns the answers in the same order as questions. " +
        "Timeout: 5 minutes; rejected questions throw an error you must handle.",
      inputSchema: z.object({
        questions: z
          .array(
            z.object({
              question: z.string().describe("The complete question text to show the user."),
              header: z.string().describe("Short label (≤30 chars) used as a chip/title."),
              options: z
                .array(
                  z.object({
                    label: z.string().describe("Display text (1-5 words)."),
                    description: z.string().describe("Explanation of this choice."),
                  }),
                )
                .default([])
                .describe("Click-selectable options. Leave empty for free-text-only answers."),
              multiple: z.boolean().optional().describe("Allow multi-select (default false)."),
              custom: z.boolean().optional().describe("Allow a custom typed answer (default true)."),
            }),
          )
          .min(1)
          .max(4)
          .describe("1-4 questions to ask in a single turn."),
        reason: z.string().optional().describe("Why you're asking (short, shown in logs — not to the user)."),
      }),
      execute: async ({ questions, reason }) => {
        log.info("question", { taskID, count: questions.length, reason })
        const { output } = await Question.askAndFormat({
          sessionID: input.agentSessionID,
          questions: questions.map((q) => ({
            question: q.question,
            header: q.header,
            options: q.options ?? [],
            multiple: q.multiple,
            custom: q.custom,
          })),
        })
        return output
      },
    }),

    propose_task: tool({
      description:
        "Offer the user one polished follow-up task candidate that improves or completes the current/previous request. " +
        "This is the orchestrator's ONLY new-engine-task creation path: it first asks the user to confirm, then creates " +
        "a new task only if the user selects `创建任务`. Do not use this for normal workflow progress, do not use it " +
        "instead of build/deliver on the current task, and do not call generic `task` or control-plane `panel`.",
      inputSchema: z.object({
        title: z.string().min(1).describe("Concise title for the proposed new task."),
        request: z
          .string()
          .min(1)
          .describe(
            "Complete, self-contained request for the proposed new task. Include the relation to the current task when relevant.",
          ),
        reason: z
          .string()
          .min(1)
          .describe("Why this should be offered as a separate follow-up task instead of changing the current task."),
        priority: z.enum(["critical", "high", "normal", "low"]).default("normal"),
        queue: z
          .boolean()
          .default(false)
          .describe("Set true when this confirmed follow-up task should wait in the directory queue; set false when it may start as soon as the same directory is idle."),
        kind: z.enum(["workflow", "build"]).default("workflow"),
      }),
      execute: async ({ title, request, reason, priority, queue, kind }) => {
        const task = requireTask(taskID)
        log.info("propose_task confirmation requested", { taskID, title, priority, kind })
        const { output, answers } = await Question.askAndFormat({
          sessionID: input.agentSessionID,
          questions: [
            {
              header: "新任务",
              question: `是否创建这个新任务？\n\n${title}\n\n${request}`,
              options: [
                {
                  label: "创建任务",
                  description: "确认后立即提交为一个新的任务。",
                },
                {
                  label: "不创建",
                  description: "保留当前任务，不提交新的任务。",
                },
              ],
              multiple: false,
              custom: false,
            },
          ],
        })
        const selected = answers?.[0]?.[0]
        if (selected !== "创建任务") {
          return SubAgentProtocol.yieldResult({
            headline: "Follow-up task proposal was not created.",
            summary: output,
            fields: [
              ["proposal", title],
              ["reason", reason],
              ["selection", selected ?? "dismissed"],
            ],
            pointer: `current task ${taskID}; no new task was created`,
          })
        }
        const requestID =
          "orchestrator-proposed-task:" +
          taskID +
          ":" +
          createHash("sha256").update(`${title}\0${request}`).digest("hex").slice(0, 16)
        const newTaskID = await EngineService.createTask({
          requestID,
          title,
          request,
          priority,
          queue,
          kind,
          executor: task.executor,
          source: "orchestrator:propose_task",
          metadata: {
            origin: "orchestrator_proposed_task",
            parent_task_id: taskID,
            proposal_reason: reason,
          },
        })
        createDecisionLog(taskID).append({
          phase: "orchestrator",
          key: `proposed_task_${Date.now()}`,
          value: `Created follow-up task ${newTaskID}: ${title}\n\nReason: ${reason}`,
          reason: "propose_task_confirmed",
        })
        return SubAgentProtocol.yieldResult({
          headline: "Follow-up task created after user confirmation.",
          fields: [
            ["new_task_id", newTaskID],
            ["title", title],
            ["kind", kind],
            ["priority", priority],
            ["queue", queue === true ? "true" : "false"],
            ["parent_task_id", taskID],
          ],
          pointer: `new task ${newTaskID}; parent task ${taskID}`,
        })
      },
    }),

    build: tool({
      description:
        "Implementation dispatcher. Runs the build agent (read / write / edit / bash) in-process to apply " +
        "one scoped change. Two valid shapes exist. `build({ goalID })` is the normal workflow " +
        "shape after architect has registered goals; on retry/rework, populate `request` with " +
        "concrete guidance for the next attempt — the goal contract (objective / acceptance_specs / " +
        "owned_paths) is preserved untouched and your `request` is rendered as a separate " +
        "'Retry Guidance From Orchestrator' section ahead of historical retry feedback, so filling it " +
        "never costs you any architect-committed contract. `build({ request, directBuildIntent })` without goalID is a task-level " +
        "direct build. It is supported for explicit `kind=build` tasks, whole-task rework after delivery " +
        "rejection, and operator/orchestrator decisions to bypass goal decomposition for a scoped workflow " +
        "task. For fresh `kind=workflow` tasks, requirements → architect → per-goal build remains the " +
        "recommended path. Fresh workflow direct builds must declare directBuildIntent='modify_files'. " +
        "directBuildIntent='inspect_only' is not a workflow execution path; use analyze_intent / requirements / " +
        "architect and then per-goal build instead. " +
        "After build returns, you MUST call `deliver` next: build does NOT auto-complete the task; the only " +
        "way to mark a task accepted is through delivery's adversarial verification. Build → deliver loops " +
        "until Arbiter accepts (or hits stalled/abort). On rejection, call build again with " +
        "the rejection feedback in the prompt, then deliver again. " +
        "DO NOT USE FOR: multi-file features, UI replication from designs, anything with explicit acceptance " +
        "criteria, cross-module refactors, new subsystems — those go through requirements → architect → " +
        "per-goal build → deliver (the pipeline workflow). For visual/reference tasks, design_analysis must " +
        "already have produced PRD/SPEC review entries, especially visual_consistency_spec, before any build dispatch.",
      inputSchema: z.object({
        request: z
          .string()
          .optional()
          .describe(
            "For per-goal builds: optional retry/rework guidance for THIS attempt, rendered as a separate 'Retry Guidance From Orchestrator' section in the build prompt. Does NOT replace the goal's objective / acceptance_specs / owned_paths — populate freely whenever you have concrete advice for the next attempt (e.g. 'previous attempt did not call report_build_result before turn end; this attempt MUST call it after verification'). For task-level direct builds (no goalID): required; include the user's request plus concise rejected delivery details the build agent must address.",
          ),
        reason: z
          .string()
          .describe(
            "One sentence explaining why this build is valid now: explicit kind=build, per-goal pipeline execution, post-delivery whole-task rework, or a conscious direct-build decision for this workflow task.",
          ),
        goalID: z
          .string()
          .optional()
          .describe(
            "Optional goal id this build is scoped to. Set when build is invoked as a per-goal worker inside the pipeline workflow. Omit for task-level direct builds.",
          ),
        directBuildIntent: z
          .enum(["modify_files", "inspect_only"])
          .optional()
          .describe(
            "Required for task-level direct builds on kind=workflow tasks. Use modify_files only when the direct build is expected to change project files. Use inspect_only when the requested work is read-only exploration / investigation / analysis; workflow tasks reject that path so the orchestrator must use stage agents instead.",
          ),
      }),
      execute: async ({ request = "", reason, goalID, directBuildIntent }) => {
        const task = requireTask(taskID)
        const requestText = request.trim()
        log.info("build tool invoked", {
          taskID,
          reason,
          requestLen: request.length,
          goalID: goalID || "",
          directBuildIntent: directBuildIntent ?? "",
        })

        const designGate = requireDesignAnalysisBefore("build", task)
        if (designGate) return designGate

        // Inherit goalID from the parent agent session if one isn't explicitly
        // passed — this nests the build card under the originating goal in the
        // overlay instead of floating at the conversation root.
        const inheritedGoalID = sessionGoalID(input.agentSessionID)
        const goalReference = goalID || inheritedGoalID
        const resolvedGoalReference = goalReference ? resolveGoalReferenceForBuild(goalReference) : undefined
        if (resolvedGoalReference && !resolvedGoalReference.ok) return resolvedGoalReference.message
        const attachedGoalID = resolvedGoalReference?.goalID
        const isTaskLevelBuild = !attachedGoalID

        if (isTaskLevelBuild) {
          if (requestText.length === 0) {
            return `build: rejected task-level build. request is required when build is not scoped to a goal.`
          }
          if (task.kind === "workflow") {
            if (!directBuildIntent) {
              return (
                `build: rejected task-level workflow build. directBuildIntent is required when build is not scoped ` +
                `to a goal; use directBuildIntent="modify_files" only for a scoped direct implementation. ` +
                `For read-only exploration / investigation / analysis, call analyze_intent / requirements / ` +
                `architect and then build({ goalID }) instead.`
              )
            }
            if (directBuildIntent === "inspect_only") {
              return (
                `build: rejected inspect-only task-level workflow build. Workflow exploration belongs in the ` +
                `stage-agent path (analyze_intent / requirements / architect) so the task gets durable ` +
                `requirements, acceptance specs, and per-goal build contracts before execution.`
              )
            }
          }
          await switchExplicitBuildTaskToDirectWorkflow(attachedGoalID)
          await trackStepStart("build")
        }

        // Phase 5-c: delegate to BuildAgent.run. It owns the child session
        // (kind=build), creates an isolated worktree (parallel-safe for
        // multi-goal fan-out), gates concurrency via BuildSemaphore, and
        // returns a structured BuildResult the orchestrator can judge.
        //
        // For goalID path, build the structured BuildTarget from the DB row
        // so the agent receives acceptance_specs / owned_paths / depends_on
        // directly. For pure request path, the LLM-supplied `request` is
        // the user message.
        //
        // Coordinator Run lazy-create: build is the dispatcher, so every
        // implementation build owns the run that later anchors delivery
        // evidence. Goal-scoped builds create a dispatchable run from the
        // active goal graph; task-level direct builds create a run without a
        // plan_version_id because there is intentionally no goal graph.
        if (attachedGoalID) {
          const { findGoal } = await import("@/engine/store")
          const goal = findGoal(attachedGoalID)
          if (!goal) {
            if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
            return missingResolvedGoalMessage(attachedGoalID)
          }
          const activeSpec = findActiveSpecForTask(taskID)
          if (!activeSpec) {
            if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
            return `build: goal ${attachedGoalID} has no active spec snapshot. Re-run requirements/architect before dispatching build.`
          }
          if (goal.spec_snapshot_id !== activeSpec.id) {
            if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
            return (
              `build: goal ${attachedGoalID} belongs to superseded spec ${goal.spec_snapshot_id ?? "null"} ` +
              `while active spec is ${activeSpec.id}. Re-read the active goal graph before dispatching build.`
            )
          }
          const dependencyBlockers = (Array.isArray(goal.depends_on) ? (goal.depends_on as string[]) : [])
            .map((depID) => ({ depID, status: goalStatusByID(depID) }))
            .filter((dep) => dep.status !== "passed")
          if (dependencyBlockers.length > 0) {
            if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
            return (
              `build: goal ${attachedGoalID} is blocked by unfinished dependencies: ` +
              dependencyBlockers.map((dep) => `${dep.depID}=${dep.status}`).join(", ") +
              `. Re-read collaboration_closure and dispatch only goals whose dependencies are passed.`
            )
          }
        }

        let coordinatorRunID: string | undefined
        if (attachedGoalID) {
          const ensured = await ensureDispatchableRunForSingleGoal()
          if ("error" in ensured) {
            if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
            return `build: cannot ensure coordinator run for goal ${attachedGoalID} — ${ensured.error}`
          }
          coordinatorRunID = ensured.run.id
        } else {
          const ensured = await ensureTaskLevelBuildRun()
          coordinatorRunID = ensured.id
        }

        try {
          const { BuildAgent, collectGoalContributionDiffs } = await import("@/build/agent")
          const { Worktree } = await import("@/worktree")
          let target: import("@/build/types").BuildTarget
          let context: import("@/build/agent").BuildAgent.BuildContext | undefined
          let managedWorktree: import("@/build/agent").BuildAgent.RunInput["managedWorktree"] | undefined
          if (attachedGoalID) {
            const { findGoal, findRequirements, listGoals, findGoalLatestWorkspace } = await import("@/engine/store")
            const goal = findGoal(attachedGoalID)
            if (!goal) {
              if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
              return missingResolvedGoalMessage(attachedGoalID)
            }
            const activeSpec = findActiveSpecForTask(taskID)
            if (!activeSpec) {
              if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
              return `build: goal ${attachedGoalID} has no active spec snapshot. Re-run requirements/architect before dispatching build.`
            }
            if (goal.spec_snapshot_id !== activeSpec.id) {
              if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
              return (
                `build: goal ${attachedGoalID} belongs to superseded spec ${goal.spec_snapshot_id ?? "null"} ` +
                `while active spec is ${activeSpec.id}. Re-read the active goal graph before dispatching build.`
              )
            }
            // Phase B (2026-05-05): persistent worktree pointer comes from
            // the latest goal_run_attempt artifact, not engine_goal columns.
            // findGoalLatestWorkspace returns the triple from the newest
            // payload — null when no attempt has run yet OR when terminal
            // cleanup nulled the pointer.
            const recorded = findGoalLatestWorkspace(attachedGoalID)
            const recordedWorkspaceDir = recorded.directory?.trim() ?? ""
            const recordedWorkspaceBranch = recorded.branch?.trim() ?? ""
            const recordedWorkspaceBaseRef = recorded.baseRef ?? null
            if (recordedWorkspaceDir || recordedWorkspaceBranch) {
              if (!recordedWorkspaceDir || !recordedWorkspaceBranch) {
                return (
                  `build: goal ${attachedGoalID} has inconsistent workspace metadata ` +
                  `(workspace_dir=${recordedWorkspaceDir || "null"}, ` +
                  `workspace_branch=${recordedWorkspaceBranch || "null"}). ` +
                  `This is a structural error; clean or reset the goal workspace explicitly.`
                )
              }
              const valid = await Worktree.isValid(recordedWorkspaceDir)
              if (!valid.valid) {
                const recovered = await Worktree.recoverRecorded({
                  directory: recordedWorkspaceDir,
                  branch: recordedWorkspaceBranch,
                })
                if (recovered.status !== "recovered") {
                  return (
                    `build: recorded workspace for goal ${attachedGoalID} is invalid: ` +
                    `${recordedWorkspaceDir} (${valid.reason ?? "unknown reason"}). ` +
                    `Automatic reattach failed: ${recovered.reason}. Preserve that directory and fix or reset the goal workspace explicitly.`
                  )
                }
                managedWorktree = {
                  directory: recovered.directory,
                  branch: recovered.branch,
                  baseRef: recordedWorkspaceBaseRef,
                }
                // Phase G (2026-05-05): the recovered pointer rides the new
                // attempt artifact via beginBuildAttempt below — no extra
                // updateGoalWorkspace write needed. The previous explicit
                // call routed through the synthetic-runID createGoalRun
                // branch when a tip happened to be missing; both branches
                // are now redundant since beginBuildAttempt always carries
                // the workspace triple.
                log.warn("reattached invalid goal workspace before build", {
                  goalID: goal.id,
                  reason: valid.reason ?? "unknown reason",
                  workspaceDir: recovered.directory,
                  workspaceBranch: recovered.branch,
                })
              }
              if (!managedWorktree) {
                managedWorktree = {
                  directory: recordedWorkspaceDir,
                  branch: recordedWorkspaceBranch,
                  baseRef: recordedWorkspaceBaseRef,
                }
              }
            } else {
              const info = await Worktree.create({
                name: `goal-${goal.id.slice(-8)}`,
              })
              managedWorktree = {
                directory: info.directory,
                branch: info.branch,
                baseRef: null,
              }
              // Phase G (2026-05-05): see comment above. The freshly created
              // worktree's pointer flows into the first goal_run_attempt
              // artifact via beginBuildAttempt — the prior pre-attempt
              // updateGoalWorkspace call hit the no-tip synthetic-runID
              // branch and was a no-op once the artifact landed.
            }
            const taskFidelity = readPersistedArchitectFidelity(task)
            const dependsOn = Array.isArray(goal.depends_on) ? (goal.depends_on as string[]) : []
            target = {
              kind: "goal",
              id: goal.id,
              title: goal.title,
              // Always sourced from goal.objective. The previous
              // "requestText overrides goal.objective" behaviour silently
              // discarded the architect-committed objective when the
              // orchestrator LLM filled `request` for retry guidance —
              // which is why the LLM never filled it (rule preservation
              // beat retry signal). requestText now flows into
              // context.retryGuidance instead, leaving the architect
              // contract intact. Spec
              // build-missing-terminal-signal-restore-2026-05-07.md §5.2.
              objective: goal.objective,
              acceptance_specs: acceptanceSpecsToPromptLines(goal.acceptance_specs),
              owned_paths: Array.isArray(goal.owned_paths) ? (goal.owned_paths as string[]) : [],
              depends_on: dependsOn,
            }

            // ── Compose upstream context for the goal-path build (rule 23):
            //    requirements + architect contracts + dependency siblings +
            //    design specs + retry feedback. Each query is independent so
            //    a missing source (e.g. no active spec) gracefully degrades
            //    the corresponding section to undefined; the prompt renderer
            //    only emits the populated ones. ──────────────────────────
            const activeSpecForContext = findActiveSpecForTask(task.id)
            const reqRows = activeSpecForContext ? findRequirements(activeSpecForContext.id) : []
            const requirements = reqRows.map((r) => {
              const meta = (r.metadata ?? {}) as Record<string, unknown>
              const sourceID = typeof meta.source_requirement_id === "string" ? meta.source_requirement_id : r.id
              return {
                id: sourceID,
                type: (r.priority === "advisory" ? "implicit" : "explicit") as "explicit" | "implicit",
                description: r.description,
              }
            })

            const { createDecisionLog } = await import("@/decision-log")
            const decisionLog = createDecisionLog(taskID)
            const contractGraph = findLatestArchitectContractGraph(taskID)
            if (!contractGraph) {
              throw new Error(
                `Cannot build goal ${goal.id}: missing architect_contract_graph artifact for task ${taskID}. ` +
                  "Re-run architect so dependency reasons and graph contracts are available before build.",
              )
            }

            const siblingGoals = listGoals(taskID)
            const dependencies =
              dependsOn.length > 0
                ? siblingGoals
                    .filter((g) => dependsOn.includes(g.id))
                    .map((g) => ({
                      id: g.id,
                      title: g.title,
                      objective: g.objective,
                    }))
                : []
            const collaborationGoals = siblingGoals.map((g) => ({
              id: g.id,
              title: g.title,
              objective: g.objective,
              kind: g.kind,
              status: goalStatusByID(g.id),
              acceptance_specs: acceptanceSpecsToPromptLines(g.acceptance_specs),
              owned_paths: Array.isArray(g.owned_paths) ? (g.owned_paths as string[]) : [],
              depends_on: Array.isArray(g.depends_on) ? (g.depends_on as string[]) : [],
            }))

            const designSpecs = Array.isArray(task.design_specs) ? (task.design_specs as any) : undefined
            const designAnalysis = renderDesignAnalysisHandoffReference(taskID)

            // Retry feedback from decision log (per-goal "retry" entries the
            // orchestrator wrote on prior delivery rejection).
            const retryEntries = decisionLog.readByPhase("retry").filter((e) => e.goalID === goal.id)
            const retryFeedback =
              retryEntries.length > 0
                ? [
                    "## Prior Attempt Failed — Read This Before Implementing",
                    "",
                    "The previous attempt was rejected. The worktree still has those files; edit in place rather than start from scratch unless the failure forces a structural rewrite.",
                    "",
                    "### Coordinator Root-Cause + Delivery Rejection",
                    ...retryEntries.map((e) => `- ${e.value}${e.reason ? ` — _why: ${e.reason}_` : ""}`),
                    "",
                    "### Required For This Retry",
                    "- Address each rejection above before changing anything else.",
                    "- Do NOT repeat an approach that was already tried and rejected.",
                    "- If the fix touches a shared file, explain the collaboration impact in files_changed[] instead of hiding the cross-goal dependency.",
                  ].join("\n")
                : undefined
            const deliveryFeedback = await composeLatestDeliveryFeedbackForBuild({
              taskID,
              goalID: goal.id,
            })

            // Visual feedback closure-loop: when delivery rejected on visual
            // grounds, attach the previous rendered.png so the build LLM
            // physically compares its output to the user reference instead of
            // re-painting from text alone. The path is the same one the
            // delivery service writes via runtime-evidence.
            const retryAttachments = await loadLatestRenderedRetryAttachment({
              taskID,
              enabled: retryEntries.length > 0 || Boolean(deliveryFeedback),
            })

            // Phase B (2026-05-07): the orchestrator LLM's `request` text
            // now flows into context.retryGuidance instead of replacing
            // target.objective. Empty string means no current-turn
            // guidance; the renderer drops the section.
            // Spec build-missing-terminal-signal-restore-2026-05-07.md §5.2.
            context = {
              requirements: requirements.length > 0 ? requirements : undefined,
              contractGraph,
              dependencies: dependencies.length > 0 ? dependencies : undefined,
              collaborationGoals,
              designSpecs,
              designAnalysis: designAnalysis.trim().length > 0 ? designAnalysis : undefined,
              fidelity: taskFidelity,
              retryGuidance: requestText.length > 0 ? requestText : undefined,
              retryFeedback,
              deliveryFeedback,
              retryAttachments,
            }
          } else {
            // Task-level direct build: target.text carries the request
            // verbatim (it IS the work), so retryGuidance does not apply
            // to this branch — there's no separate goal contract for the
            // request to "supplement".
            target = { kind: "request", text: requestText }
            const deliveryFeedback = await composeLatestDeliveryFeedbackForBuild({ taskID })
            const retryAttachments = await loadLatestRenderedRetryAttachment({
              taskID,
              enabled: Boolean(deliveryFeedback),
            })
            const designSpecs = Array.isArray(task.design_specs) ? (task.design_specs as any) : undefined
            const designAnalysis = renderDesignAnalysisHandoffReference(taskID)
            context =
              deliveryFeedback || retryAttachments || designSpecs || designAnalysis.trim().length > 0
                ? {
                    designSpecs,
                    designAnalysis: designAnalysis.trim().length > 0 ? designAnalysis : undefined,
                    deliveryFeedback,
                    retryAttachments,
                  }
                : undefined
          }

          // Open the goal_run only after BuildAgent.run has acquired the
          // per-task build semaphore. Opening it earlier makes queued
          // semaphore waiters look like running goals even though no build
          // session exists yet, breaking the collaboration closure signal.
          // Goal-path only — direct/request builds have no goal row to attach
          // an attempt to.
          let goalRunID: string | undefined
          const openGoalRunAfterBuildSlot = async () => {
            if (!attachedGoalID || goalRunID) return
            try {
              const { beginBuildAttempt } = await import("@/engine/persist")
              goalRunID = beginBuildAttempt({
                taskID,
                goalID: attachedGoalID,
                runID: coordinatorRunID,
                workspaceDir: managedWorktree?.directory,
                // Phase G (2026-05-05): full workspace triple rides the
                // attempt artifact. Pre-fix the orchestrator pre-wrote
                // engine_goal columns then dropped to a synthetic-runID
                // queued artifact when no tip existed; both paths are gone
                // now — single source is the new attempt artifact.
                workspaceBranch: managedWorktree?.branch ?? null,
                workspaceBaseRef: managedWorktree?.baseRef ?? null,
              })
            } catch (beginErr) {
              // A failure here is structural — overlay won't get the
              // running card and finalizeBuildAttempt has nothing to
              // update. Surface and let the dispatch fail rather than
              // silently degrade to the old "appear at completion" UX.
              log.error("build: beginBuildAttempt failed", {
                taskID,
                goalID: attachedGoalID,
                error: beginErr instanceof Error ? beginErr.message : String(beginErr),
              })
              throw beginErr
            }
          }

          // BuildAgent.run reserves thrown errors for infrastructure faults
          // (model unavailable, worktree creation failed, session stream
          // error — the G4 TLS-mid-stream class). Before this try/finally,
          // a thrown error skipped finalizeBuildAttempt entirely, leaving
          // the goal_run in attempt-running forever (see incident report
          // tsk_ddc529dfd0011ajJTgBqdlroyk G4 in
          // specs/new-arch/2026-04-30-llm-activity-redesign.md). Step 4
          // closes that gap by ALWAYS finalising the goal_run when one
          // was opened, with status derived from the BuildAgent outcome
          // or, on throw, from the underlying error class.
          let buildOutcome:
            | { kind: "ok"; result: Awaited<ReturnType<typeof BuildAgent.run>> }
            | { kind: "throw"; error: unknown }
          let goalWorkspaceCleanup: string | undefined
          try {
            const ok = await BuildAgent.run({
              target,
              task,
              context,
              parentSessionID: input.agentSessionID,
              signal: input.signal,
              managedWorktree,
              onSlotAcquired: openGoalRunAfterBuildSlot,
              onSessionCreated: async (sessionID) => {
                if (!goalRunID) return
                const { updateGoalRun } = await import("@/engine/persist")
                updateGoalRun(goalRunID, { session_id: sessionID })
              },
            })
            buildOutcome = { kind: "ok", result: ok }
          } catch (runErr) {
            // P2: typed BuildAgentContractError converts to a schema-valid
            // failed BuildResult and routes through the normal failed path
            // (NOT rethrow). Preserves the retry-budget contract: the
            // orchestrator's tool result reads as a normal failed build,
            // decision_log gets the contract-violation diagnostics, and
            // generic infra errors keep their existing rethrow shape.
            const { BuildAgentContractError } = await import("@/build/types")
            if (runErr instanceof BuildAgentContractError) {
              // Collect host-side worktree facts on the failure path so the
              // orchestrator LLM sees what the build session actually
              // produced (file changes, HEAD) before deciding next step
              // (build retry / modify_goal / fail_task).
              // Without these facts the build tool result's "Worktree facts"
              // block renders all-undefined, leaving the LLM blind to whether
              // the missing-terminal failure happened with substantial work
              // already on disk vs an empty worktree. Spec
              // build-missing-terminal-review-downgrade-2026-05-07.md §5.2.
              let collectedDiffs: import("@/snapshot/types").FileDiff[] | undefined
              let collectedHead: string | undefined
              let collectedActualChangedFiles:
                | NonNullable<Awaited<ReturnType<typeof BuildAgent.run>>["actualChangedFiles"]>
                | undefined
              if (managedWorktree?.directory) {
                try {
                  const headResult = await runGit(["rev-parse", "HEAD"], {
                    cwd: managedWorktree.directory,
                    timeoutProfile: "fast",
                  })
                  if (headResult.exitCode === 0) {
                    const head = headResult.text().trim()
                    if (head) collectedHead = head.slice(0, 12)
                  }
                } catch (gitErr) {
                  log.warn("build catch: rev-parse HEAD failed (non-fatal)", {
                    taskID,
                    goalID: attachedGoalID,
                    error: gitErr instanceof Error ? gitErr.message : String(gitErr),
                  })
                }
                if (managedWorktree.baseRef) {
                  try {
                    const fetched = await collectGoalContributionDiffs(
                      managedWorktree.directory,
                      managedWorktree.baseRef,
                    )
                    collectedDiffs = fetched
                    collectedActualChangedFiles = fetched.map((d) => ({
                      path: d.file,
                      status: (d.status ?? "modified") as "added" | "modified" | "deleted",
                      additions: d.additions,
                      deletions: d.deletions,
                    }))
                  } catch (diffErr) {
                    log.warn("build catch: collectGoalContributionDiffs failed (non-fatal)", {
                      taskID,
                      goalID: attachedGoalID,
                      error: diffErr instanceof Error ? diffErr.message : String(diffErr),
                    })
                  }
                }
              }
              const synthFailed: Awaited<ReturnType<typeof BuildAgent.run>>["result"] = {
                status: "failed",
                summary: `Build agent contract violation (${runErr.code}): ${runErr.message.slice(0, 200)}`,
                tests: [],
                files_changed: [],
                error: runErr.message,
              }
              buildOutcome = {
                kind: "ok",
                result: {
                  result: synthFailed,
                  sessionID: runErr.diagnostics.sessionID ?? "",
                  worktreeDir: managedWorktree?.directory,
                  worktreeBranch: managedWorktree?.branch,
                  worktreeBaseRef: managedWorktree?.baseRef,
                  diffs: collectedDiffs,
                  // BuildAgentContractError fires before the agent reached the
                  // post-merge fact collection, so we surface whatever the
                  // tool last reported (or "not_invoked" when nothing).
                  mergeBackStatus: "not_invoked",
                  lastMergeBackOutcome: runErr.diagnostics.lastMergeBackOutcome ?? undefined,
                  publishedCommitRef: undefined,
                  worktreeHead: collectedHead,
                  actualChangedFiles: collectedActualChangedFiles,
                } as Awaited<ReturnType<typeof BuildAgent.run>>,
              }
              // Drop a phase=retry decision_log entry so the next attempt's
              // prompt receives the structured contract diagnostic instead
              // of just "tool failed". Single source: decision_log; the
              // orchestrator already reads phase=retry filtered by goalID.
              //
              // value carries the LLM-facing recovery hint (rendered into
              // the next build prompt's "Prior Attempt Failed" section by
              // the retryFeedback composer). Use BuildAgentContractError's
              // message directly (single source per rule 8 — the hint text
              // is owned by build/agent.ts:convertMissingTerminalToolError).
              // reason carries the audit metadata.
              // Spec build-missing-terminal-signal-restore-2026-05-07.md §5.1.
              if (attachedGoalID) {
                try {
                  const { createDecisionLog } = await import("@/decision-log")
                  createDecisionLog(taskID).append({
                    phase: "retry",
                    goalID: attachedGoalID,
                    key: "build_agent_contract_violation",
                    value: runErr.message,
                    reason: `build_agent_contract_violation: code=${runErr.code}; sessionID=${runErr.diagnostics.sessionID ?? "?"}`,
                  })
                } catch (logErr) {
                  log.warn("build: failed to record contract-violation decision_log entry (non-fatal)", {
                    taskID,
                    goalID: attachedGoalID,
                    error: logErr instanceof Error ? logErr.message : String(logErr),
                  })
                }
              }
            } else {
              buildOutcome = { kind: "throw", error: runErr }
            }
          }

          if (buildOutcome.kind === "ok") {
            const { worktreeDir, worktreeBranch, worktreeBaseRef } = buildOutcome.result
            const currentGoalRun = goalRunID ? findGoalRun(goalRunID) : undefined
            if (
              attachedGoalID &&
              worktreeDir &&
              worktreeBranch &&
              (!currentGoalRun || isLiveGoalRunStatus(currentGoalRun.status))
            ) {
              updateGoalWorkspace({
                goalID: attachedGoalID,
                workspaceDir: worktreeDir,
                workspaceBranch: worktreeBranch,
                workspaceBaseRef: worktreeBaseRef,
              })
            }
            if (attachedGoalID && worktreeDir && (!currentGoalRun || isLiveGoalRunStatus(currentGoalRun.status))) {
              const contractAuditCriteria = await runGoalContractAuditCriteria({
                taskID,
                goal: findGoal(attachedGoalID),
                goalRunID,
                workDir: worktreeDir,
                task,
              })
              if (contractAuditCriteria.length > 0) {
                await EngineService.upsertTaskCriteria(taskID, contractAuditCriteria)
                const failedEssential = contractAuditCriteria.filter((criteria) => {
                  if (criteria.status === "passed") return false
                  const goalRow = findGoal(attachedGoalID)
                  const specs = (
                    Array.isArray(goalRow?.acceptance_specs) ? goalRow.acceptance_specs : []
                  ) as AcceptanceSpec[]
                  return specs.some((spec) =>
                    spec.scorers.some(
                      (scorer) =>
                        scorer.type === "contract_audit" &&
                        contractAuditRequired(spec, scorer) &&
                        `acceptance:${spec.id}:${scorer.name}` === criteria.name,
                    ),
                  )
                })
                if (failedEssential.length > 0 && buildOutcome.result.result.status === "passed") {
                  buildOutcome.result.result = {
                    ...buildOutcome.result.result,
                    status: "failed",
                    error: `contract_audit failed:\n${failedEssential.map((criteria) => criteria.evidence).join("\n")}`,
                    summary: `${buildOutcome.result.result.summary}\n\nContract audit failed before goal finalization.`,
                  }
                }
              }
            }
          }

          // Finalize the goal_run opened above. updateGoalRun writes a new
          // append-only artifact with the terminal status + time_completed,
          // and finalizeBuildAttempt also lays down the per-goal delivery
          // artifact when the build passed with concrete diffs (overlay's
          // right-side Files panel reads it via findDeliveryByGoalRun).
          // For the throw branch we synthesise a failed finalisation from
          // the underlying error message — diffs/commit/summary are absent
          // by definition, but the goal_run row reaches a clean terminal
          // state instead of orphaning at attempt-running.
          let goalRunInvalidatedLine = ""
          let goalRunInvalidated = false
          if (attachedGoalID && goalRunID) {
            try {
              const { finalizeBuildAttempt } = await import("@/engine/persist")
              const currentGoalRun = findGoalRun(goalRunID)
              if (currentGoalRun && !isLiveGoalRunStatus(currentGoalRun.status)) {
                goalRunInvalidated = true
                goalRunInvalidatedLine =
                  `\n- build_result_ignored: goal_run ${goalRunID} is already ${currentGoalRun.status}; ` +
                  `the attempt was invalidated before this build report returned.`
                log.warn("build: ignoring stale build result for invalidated goal_run", {
                  taskID,
                  goalID: attachedGoalID,
                  goalRunID,
                  status: currentGoalRun.status,
                })
              } else if (buildOutcome.kind === "ok") {
                const { result, sessionID, worktreeDir, worktreeBranch, worktreeBaseRef, diffs } = buildOutcome.result
                finalizeBuildAttempt({
                  goalRunID,
                  taskID,
                  goalID: attachedGoalID,
                  runID: coordinatorRunID,
                  status: result.status === "passed" ? "completed" : "failed",
                  commitRef: result.commit_ref,
                  workspaceDir: worktreeDir,
                  // Phase B (2026-05-05): the build outcome carries branch +
                  // baseRef alongside the directory. Persist them on the
                  // attempt artifact so the next dispatch / cleanup / board
                  // view reads the full triple from one source.
                  workspaceBranch: worktreeBranch,
                  workspaceBaseRef: worktreeBaseRef ?? undefined,
                  error: result.status === "failed" ? result.error : undefined,
                  diffs,
                  fileChanges: result.files_changed,
                  summary: result.summary,
                })
                // Backfill session_id on the goal_run now that BuildAgent.run
                // has assigned one. Routing keys on goalID, but downstream
                // tracing (orphan detection, audit) expects session_id on the
                // tip artifact. updateGoalRun's append model handles this.
                if (sessionID) {
                  const { updateGoalRun } = await import("@/engine/persist")
                  updateGoalRun(goalRunID, { session_id: sessionID })
                }
                if (result.status === "passed") {
                  goalWorkspaceCleanup = await cleanupCompletedGoalWorkspace(attachedGoalID, goalRunID)
                }
              } else {
                const errMsg =
                  buildOutcome.error instanceof Error
                    ? `${buildOutcome.error.name}: ${buildOutcome.error.message}`
                    : String(buildOutcome.error)
                finalizeBuildAttempt({
                  goalRunID,
                  taskID,
                  goalID: attachedGoalID,
                  runID: coordinatorRunID,
                  status: "failed",
                  workspaceDir: managedWorktree?.directory,
                  workspaceBranch: managedWorktree?.branch,
                  workspaceBaseRef: managedWorktree?.baseRef ?? undefined,
                  error: errMsg,
                  summary: `BuildAgent.run threw before producing a verdict: ${errMsg.slice(0, 240)}`,
                })
              }
            } catch (persistErr) {
              // Failing to record the attempt does NOT abort the build —
              // the LLM still gets the tool_result text. Log loudly so
              // it's visible during benchmarks; if persists are silently
              // dropped the orchestrator will see the goal as still pending
              // on its next wake and decide what to do.
              log.error("build: finalizeBuildAttempt failed", {
                taskID,
                goalID: attachedGoalID,
                error: persistErr instanceof Error ? persistErr.message : String(persistErr),
              })
            }
          }

          // If BuildAgent.run threw, surface the original error to the caller
          // AFTER the goal_run is finalised. The throw shape is preserved so
          // the orchestrator's existing tool-error / wake-loop logic isn't
          // disturbed — only the persistent state was previously orphaned.
          if (buildOutcome.kind === "throw") {
            throw buildOutcome.error
          }
          const { result, sessionID, worktreeDir } = buildOutcome.result
          // diffs is captured by the surrounding scope's destructure for the
          // ok-branch report rendering below; pull it back out for clarity.
          const diffs = buildOutcome.result.diffs
          // Host-truth merge / diff facts (B20). Surfaced inline in the
          // tool result so the orchestrator LLM can cross-check the LLM's
          // self-reported `files_changed[]` and `commit_ref` against what
          // actually happened. Spec architecture-rework-loosening-plan-2026-05-06.md.
          // Defaults preserve sane rendering for older test fixtures whose
          // mocked BuildAgent.RunOutput predates these fields.
          const mergeBackStatus = buildOutcome.result.mergeBackStatus ?? "not_invoked"
          const lastMergeBackOutcome = buildOutcome.result.lastMergeBackOutcome
          const publishedCommitRef = buildOutcome.result.publishedCommitRef
          const worktreeHead = buildOutcome.result.worktreeHead
          const actualChangedFiles = buildOutcome.result.actualChangedFiles ?? []
          // Architecture review is no longer triggered automatically per
          // build. Per-goal automatic review fired N times for N goals,
          // each looking at one goal's worktree in isolation, and crowded
          // the orchestrator's prompt with redundant entries. Build reports
          // are recorded as decision-log evidence; standalone integrity is
          // reserved for task-end or suspicion-triggered system-integrity
          // review, not routine wave-level review.
          if (attachedGoalID && !goalRunInvalidated) {
            const buildReportForReview = {
              status: result.status,
              summary: result.summary,
              files_changed: result.files_changed,
              tests: result.tests,
              error: result.status === "failed" ? result.error : undefined,
              commit_ref: result.commit_ref,
            }
            try {
              const decisionLog = createDecisionLog(taskID)
              decisionLog.append({
                phase: "build",
                goalID: attachedGoalID,
                key: "build_report_for_architecture_review",
                value: JSON.stringify(buildReportForReview),
                reason: "post_build_architecture_review_input",
              })
            } catch (logErr) {
              log.warn("build: build report decision_log append failed (non-fatal)", {
                taskID,
                goalID: attachedGoalID,
                error: logErr instanceof Error ? logErr.message : String(logErr),
              })
            }
          }

          if (isTaskLevelBuild) await trackStepComplete("build")

          // Build session terminal flows through session.status when
          // BuildAgent.run's underlying actor closes. The structured build
          // report below is the orchestrator-facing tool result.

          // Build does NOT mark the task complete — deliver must accept.
          // Return the structured payload so the orchestrator can judge
          // whether build actually addressed the prior rejection before
          // re-dispatching (avoids the build/deliver death spiral).
          const testLines =
            result.tests.length > 0
              ? result.tests
                  .map((t) => `  - ${t.passed ? "✓" : "✗"} ${t.name}${t.detail ? `: ${t.detail}` : ""}`)
                  .join("\n")
              : "  (none reported)"
          const fileLines =
            result.files_changed.length > 0
              ? result.files_changed.map((f) => `  - ${f.path}: ${f.summary} — ${f.reason}`).join("\n")
              : "  (none reported)"
          const commitLine = result.commit_ref ? `- commit_ref: ${result.commit_ref}` : "- commit_ref: (none)"
          const errorLine = result.status === "failed" ? `\n- error: ${result.error}` : ""
          const worktreeLine = worktreeDir ? `\n- worktreeDir: ${worktreeDir}` : ""
          const cleanupLine = goalWorkspaceCleanup ? `\n- cleanup: ${goalWorkspaceCleanup}` : ""
          // Host-truth merge / diff fact block (B21). LLM may self-report
          // commit_ref / files_changed[] in `result`; below is what actually
          // happened in the worktree from the host's perspective. The
          // orchestrator LLM cross-checks both and decides next.
          const mergeBackLine =
            `- merge_back_status: ${mergeBackStatus}` +
            (lastMergeBackOutcome ? ` (last_outcome: ${lastMergeBackOutcome})` : "")
          const publishedLine = publishedCommitRef
            ? `- published_commit_ref: ${publishedCommitRef} (primary HEAD after merge_back)`
            : `- published_commit_ref: (none — merge_back did not publish)`
          const worktreeHeadLine = worktreeHead ? `- worktree_head: ${worktreeHead}` : ""
          const actualFilesLines =
            actualChangedFiles.length > 0
              ? actualChangedFiles
                  .map((f) => `  - [${f.status}] ${f.path} (+${f.additions}/-${f.deletions})`)
                  .join("\n")
              : "  (no changes detected against contribution base)"
          const factBlock =
            `\n\n### Worktree facts (host ground truth)\n` +
            `${mergeBackLine}\n` +
            `${publishedLine}\n` +
            (worktreeHeadLine ? `${worktreeHeadLine}\n` : "") +
            `- actual_changed_files (vs contribution base):\n${actualFilesLines}`

          return (
            `Build agent finished (status=${result.status}, session ${sessionID}).\n\n` +
            `### Build report\n` +
            `- summary: ${result.summary}\n` +
            `- files_changed:\n${fileLines}\n` +
            `${commitLine}${errorLine}${worktreeLine}${cleanupLine}${goalRunInvalidatedLine}\n` +
            `- tests:\n${testLines}` +
            `${factBlock}\n\n` +
            `### Next step\n` +
            `Read the build report and the worktree facts above. Cross-check the LLM's files_changed/commit_ref against the worktree facts; if they disagree, factor that into your next call. ` +
            `When the current eligible wave reaches terminal state, choose deliver / build({goalID}) / modify_goal / architect / fail_task / restart_from_stage from the build evidence and task context. ` +
            `call \`integrity\` only when the integrated evidence raises a real question about requirement mining or system integrity; it is not a routine wave-level step.`
          )
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error("build tool failed", { taskID, error: msg })
          if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
          // Build itself failed (LLM error, tool guard fault, worktree
          // creation failed, etc.) — distinct from deliver-rejection.
          // Surface the error so the orchestrator decides (retry / fail_task).
          // Card terminal flows through session.status from the build
          // agent's actor close path.
          throw err
        }
      },
    }),
  }

  // Phase 5-g: the deprecated dispatch tools (dispatch_goal / exec_goal /
  // submit_execution / retry_goal / create_run) that the 5-c filter hid
  // from the LLM are now fully deleted. Build is the single dispatch tool.
  return {
    tools,
    stopSignal: stopAfterDispatch.signal,
    finalizeDeferredStop,
  }
}
