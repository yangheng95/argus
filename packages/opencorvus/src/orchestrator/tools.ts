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
import type { AgentReport } from "@/agent/report"
import { FactCheckItemListSchema, type FactCheckReport } from "@/fact-check/schema"
import { resolveAgentModel, resolveAgentModelRef, resolveConfiguredModelRef } from "@/agent/model"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { Database, eq, and, inArray, sql } from "@/storage/db"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { EffectiveConfig } from "@/config/effective"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { Log } from "@/util/log"
import { Filesystem } from "@/util/filesystem"
import { createDecisionLog } from "@/decision-log"
import { EngineService } from "@/task-api"
import { EngineConfig } from "@/engine/config"
import {
  canReceiveDirectAgentSessionControl,
  BuildSessionDirectReplyError,
  SessionRuntimeContractMissingError,
  ReplyTargetEnvelopeMissingError,
  InvalidReplyTargetKindError,
} from "./direct-reply"
import { sessionGoalID, sessionRole, taskIDForSession } from "./task-event"
import { Publisher } from "@/engine/publisher"
import { EngineGit } from "@/engine/git"
import { git as runGit } from "@/util/git"
import { Shell } from "@/shell/shell"
import { DEFAULT_BASH_TIMEOUT_MS } from "@/shell/timeout"
import { ProcessSupervisor } from "@/shell/process-supervisor"
import { isHostKillingCommand } from "@/tool/bash"
import { BrowserPreviewTool, BrowserPreviewToolParameters } from "@/tool/browser-preview"
import { EngineMemoryBridge } from "@/engine/memory-bridge"
import { SubAgentProtocol } from "@/agent/sub-agent-protocol"
import { Event as EngineEvent, type TaskMessageTargetInput } from "@/engine/model"
import { EngineProtocol } from "@/engine/protocol"
import { abortChildExecutionForSession, abortGoalRunExecution } from "@/engine/execution-abort"
import { abortLiveOrchestratorToolOwnership } from "@/engine/writer"
import { renderFrontendDesignHandoffReference, frontendDesignArtifactPaths } from "@/frontend-design/handoff"
import { findNonStaleFrontendResearchBrief, renderFrontendResearchBriefPromptSection } from "@/research/prompt-section"
import { ensureLiveWebpageEvidence, primaryWebpageEvidenceArtifacts } from "./webpage-evidence"
import { VisualEvidenceBundleSchema, type VisualEvidenceBundle } from "@/acceptance/visual-evidence"
import { renderUserRequestSection } from "@/intent/request-prompt"
import {
  renderVisualQaBuildEvidenceContext,
  renderVisualQaFrontendDesignContext,
  renderVisualQaFrontendResearchContext,
  renderVisualQaIntegrityContext,
  renderVisualQaPriorReportContext,
} from "@/visual-qa/context"
import { materializeMcpToolResult } from "@/mcp/materialize"
import { EngineArtifactTable, EngineGoalTable, EngineTaskTable, type EngineArtifactKind } from "@/engine/engine.sql"
import {
  supersedePriorActivePlansForTask,
  appendGoalToActiveGraph,
  ensureBuildRetryFeedbackForGoal,
  persistTaskFrontendResearchBrief,
  persistTaskResearchBrief,
  updateGoalWorkspace,
  updateGoalRun,
} from "@/engine/persist"
import {
  findActivePlanForTask,
  findActiveRunForTask,
  findActiveSpecForTask,
  findDeliveriesForTask,
  findAcceptanceByRun,
  findEvaluationByRun,
  findGoal,
  findGoalRun,
  findRequirements,
  findLatestArchitectContractGraph,
  findLatestArchitectContractGraphArtifact,
  findLatestFrontendResearchBriefArtifact,
  findLatestGoalWorkloadArtifact,
  findLatestIntegrityAttemptArtifact,
  findLatestResearchBriefArtifact,
  findLatestAcceptanceVerdictArtifact,
  findLatestAcceptanceVerdictArtifactForAcceptance,
  findLatestIntegrityArtifactMissingStatus,
  findLatestTipGoalRun,
  findPlan,
  findRun,
  getGoalRetryCount,
  listGoals,
  listGoalsForPlan,
  listGoalRunsForTask,
  requireRun,
  requireTask,
  type ResearchBriefArtifactRow,
  type RunRow,
  type TaskRow,
} from "@/engine/store"
import { describeTask, goalStatusByID, renderCollaborationClosure } from "@/engine/describe"
import { isLiveGoalRunStatus } from "@/engine/catalog"
import { GoalContractFieldsSchema, GoalContractUpdateSchema } from "@/pipeline/goal-contract.schema"
import { blockActiveRunForTask, updateRun, updateTask } from "@/engine/state"
import { deriveTaskStatus, isTaskQueued, isTaskTerminal } from "@/engine/task-status"
import {
  assertNoLiveBuildOwnershipForGoal,
  completeOrchestratorToolOwnership,
  createOrchestratorToolOwnershipPayload,
  findLiveBuildOwnershipByGoal,
  findLiveBuildOwnershipByGoalRun,
  findLiveBuildOwnershipBySession,
  insertOrchestratorToolOwnershipArtifact,
  type OrchestratorToolOwnershipPayload,
  type OrchestratorToolOwnershipRow,
} from "@/engine/tool-ownership"
import { Ownership } from "@/engine/ownership"

import {
  createWorkflowState,
  findStepByTool,
  WorkflowRegistry,
  type WorkflowState,
  type MiniWorkflow,
} from "@/engine/workflow"
import { Question } from "@/question"
import { renderSpecsAsText, type AcceptanceSpec, type ContractAuditScorer } from "@/acceptance/types"
import {
  contractAuditBlocksBuild,
  contractAuditRequired,
  runContractAudit,
  type ContractAuditCriteriaResult,
} from "@/acceptance/contract-audit"
import { isLiveRunStatus, isRunReadyForGoalDispatch, restartStagePlan, type RestartStage } from "./scheduler"
import { composeAcceptanceRetryFeedback } from "./acceptance-retry-feedback"
import { parsedRequirementFromRow } from "@/requirements/row"
import {
  architectFidelityIssues,
  AssemblyOwnerEntrySchema,
  ReferenceCoverageEntrySchema,
  SourceCoverageEntrySchema,
  type ArchitectFidelityState,
} from "@/architect/fidelity"
import { contractGraphIRIndex, validateArchitectContractGraph } from "@/architect/contract-graph"
import type {
  IntegrityFinding,
  IntegrityRequiredRepair,
  IntegrityResult,
  IntegrityUnresolvedDisagreement,
} from "@/integrity"
import { renderIntegrityMarkdown } from "@/integrity/render-markdown"

export const ORCHESTRATOR_BASH_DEFAULT_TIMEOUT_MS = DEFAULT_BASH_TIMEOUT_MS
export const ORCHESTRATOR_BASH_MAX_TIMEOUT_MS = 10 * 60 * 1000

// Wait tool bounds. Floor is one second so the LLM cannot use it as a
// cheap busy-wait; ceiling matches bash so the longest deliberate idle
// pause is still bounded by the same operator-visible budget.
export const ORCHESTRATOR_WAIT_MIN_MS = 1_000
export const ORCHESTRATOR_WAIT_MAX_MS = 10 * 60 * 1000

const log = Log.create({ service: "task-tools" })

async function readLatestTaskVisualEvidenceBundle(input: {
  projectDir: string
  taskID: string
}): Promise<VisualEvidenceBundle[] | undefined> {
  const paths = ProjectRuntimePaths.frontendDesignPaths(input.projectDir, input.taskID)
  const bundlePath = path.join(paths.webpageEvidenceAbsolute, "visual-evidence-bundle.json")
  try {
    const parsed = VisualEvidenceBundleSchema.safeParse(JSON.parse(await fs.readFile(bundlePath, "utf8")))
    return parsed.success ? [parsed.data] : undefined
  } catch {
    return undefined
  }
}

async function appendResearchBriefContext(
  sections: string[],
  title: string,
  artifact: ResearchBriefArtifactRow | undefined,
  request: string,
) {
  if (!artifact) return
  const { researchBriefIsStale } = await import("@/research")
  const stale = researchBriefIsStale({ request, brief: artifact.payload })
  const brief = artifact.payload
  const subpageResearchTasks = brief.subpage_research_tasks ?? []
  sections.push(
    `\n## ${title}`,
    `- artifact: ${artifact.id}`,
    `- session: ${brief.metadata.research_session_id}`,
    `- stale: ${stale.stale ? "true" : "false"}`,
    stale.reasons.length > 0 ? `- stale_reasons: ${stale.reasons.join(", ")}` : "",
    `- sources: ${brief.evidence_index.length}`,
    `- facts: ${brief.facts.length}`,
    `- subpage_research_tasks: ${subpageResearchTasks.length}`,
    subpageResearchTasks.length > 0
      ? `- subpage_research_task_refs: ${subpageResearchTasks
          .slice(0, 5)
          .map((item) => `${item.id}=${item.url}`)
          .join("; ")}`
      : "",
    `- blocking_open_questions: ${brief.open_questions.filter((item) => item.blocking).length}`,
    `- bundle: ${brief.bundle.full_markdown_path}, ${brief.bundle.evidence_json_path}, ${brief.bundle.citation_map_path}`,
    `- summary: ${brief.summary.slice(0, 800)}`,
    `Research is advisory evidence only; it is not a workflow step or next-tool instruction.`,
  )
}

type OrchestratorToolExecutionContext = {
  orchestratorSessionID: string
  orchestratorMessageID: string
  toolCallID: string
  toolPartID: string
}

function requireOrchestratorToolExecutionContext(options: unknown, toolName: string): OrchestratorToolExecutionContext {
  const meta = (options as { opencorvus?: Record<string, unknown> } | undefined)?.opencorvus
  const orchestratorSessionID = typeof meta?.sessionID === "string" ? meta.sessionID : ""
  const orchestratorMessageID = typeof meta?.messageID === "string" ? meta.messageID : ""
  const toolCallID = typeof meta?.toolCallID === "string" ? meta.toolCallID : ""
  const toolPartID = typeof meta?.toolPartID === "string" ? meta.toolPartID : ""
  if (!orchestratorSessionID || !orchestratorMessageID || !toolCallID || !toolPartID) {
    throw new Error(
      `${toolName}: missing real tool execution identity; refusing to run because ownership cannot be tied to a persisted message/tool part.`,
    )
  }
  return { orchestratorSessionID, orchestratorMessageID, toolCallID, toolPartID }
}

/**
 * Orchestrator-side bash is a user-authorized single-command evidence surface.
 * Prompt-level rules carry the "when is this authorized" boundary. This schema
 * owns only command-shape safety: no empty command, shell chaining, pipelines,
 * redirection, command substitution, embedded newlines, or host-killing
 * patterns.
 */
export function validateOrchestratorBashCommand(command: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = command.trim()
  if (!trimmed) return { ok: false, reason: "empty command" }
  // Reject shell metacharacters that turn a single invocation into a
  // multi-step pipeline / redirect / subshell. Longer tokens first so the
  // reason string reports the most specific match.
  const dangerous: Array<[string, string]> = [
    ["&&", "chain (&&)"],
    ["||", "chain (||)"],
    ["$(", "command substitution ($(...))"],
    ["<(", "process substitution (<(...))"],
    [">(", "process substitution (>(...))"],
    [">>", "redirection (>>)"],
    ["|", "pipeline (|)"],
    [";", "command separator (;)"],
    ["&", "background / chain (&)"],
    [">", "redirection (>)"],
    ["<", "redirection / heredoc (<)"],
    ["`", "command substitution (backtick)"],
    ["\n", "newline command separator"],
    ["\r", "carriage-return command separator"],
  ]
  for (const [tok, why] of dangerous) {
    if (trimmed.includes(tok)) {
      return {
        ok: false,
        reason: `disallowed shell metacharacter ${why}. Orchestrator bash runs one command invocation only; dispatch the responsible agent instead of shell-chaining.`,
      }
    }
  }
  if (isHostKillingCommand(trimmed)) {
    return {
      ok: false,
      reason:
        "command matches host-process-killing pattern. Use a process-specific path (kill a PID you own); never name-killing.",
    }
  }
  return { ok: true }
}

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
      phase: "pre_build" | "post_build"
      verdict: "pass" | "concerns" | "needs_correction"
      summary: string
      sessionID: string
      goalCount: number
      perDimension: Array<string>
      reviewerCount: number
      findingsCount: number
      requiredRepairsCount: number
      unresolvedDisagreementsCount: number
      /** Full per-dimension breakdown including issues / corrections /
       *  missing_goals — kept on the outcome so every consumer (build tool
       *  return, renderIntegrityOutcome, recordIntegrityAttempt persistence,
       *  read_context, acceptance upstream context) renders the same complete
       *  text instead of a count summary. The orchestrator LLM reads this
       *  markdown and decides modify_goal / build / architect / fail_task
       *  itself; nothing in code routes/supersedes from the outcome. */
      markdown: string
      findings: IntegrityFinding[]
      requiredRepairs: IntegrityRequiredRepair[]
      unresolvedDisagreements: IntegrityUnresolvedDisagreement[]
      artifactMissing?: {
        sessionID: string
        error: string
      }
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

function renderEvidenceSourceManifest(input: {
  task: TaskRow
  liveUrls: readonly string[]
  figmaUrls: readonly string[]
  materialPaths: readonly string[]
  referenceArtifacts: readonly string[]
  mirrorArtifacts?: readonly string[]
  materializedFiles?: readonly string[]
}): string {
  const lines: string[] = []
  const paths = frontendDesignArtifactPaths(Instance.directory, input.task.id)
  lines.push("## frontend_design Public Report Source Manifest")
  lines.push(`Canonical frontend_design public report file: ${paths.templateRelative}`)
  lines.push(`Canonical source manifest file: ${paths.manifestRelative}`)
  lines.push(
    "Canonical decision-log entries: phase=frontend_design keys public_report, frontend_template, final_acceptance_mode, fillable_modules, component_reuse_plan, baseline_replacement_plan, quality_project_contract, frontend_project, material_inventory, visual_consistency_contract, ui_data_contract, template_iteration_notes, completeness_review, open_questions.",
  )
  lines.push(
    "Optional visual anchors: task.design_specs, when present. They are secondary to visual_consistency_contract.",
  )

  if (input.materializedFiles && input.materializedFiles.length > 0) {
    lines.push("")
    lines.push("### Materialized frontend_design report files")
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
    "frontend_design materialized artifacts",
    Array.isArray(input.task.system_artifacts) ? (input.task.system_artifacts as unknown[]) : [],
  )

  if (input.referenceArtifacts.length > 0) {
    lines.push("")
    lines.push("### Evidence artifacts cited by frontend_design")
    for (const item of input.referenceArtifacts) lines.push(`- ${item}`)
  }

  if (input.mirrorArtifacts && input.mirrorArtifacts.length > 0) {
    lines.push("")
    lines.push("### Host-prepared webpage clone artifacts")
    for (const item of [...new Set(input.mirrorArtifacts)]) lines.push(`- ${item}`)
  }

  return lines.join("\n")
}

function renderMaterializedFrontendDesignReport(input: {
  report: AgentReport
  evidenceSourceManifest: string
}): string {
  return (
    [
      "# Frontend Design Public Report",
      "",
      "This file is the materialized frontend_design terminal report for downstream agents.",
      "The report is the public readable handoff; the evidence manifest below names source files and images to read.",
      "",
      "## Evidence Source Manifest",
      input.evidenceSourceManifest.trim(),
      "",
      input.report.detail.trim(),
    ]
      .join("\n")
      .trimEnd() + "\n"
  )
}

async function writeFrontendDesignArtifacts(input: {
  projectDir: string
  taskID: string
  report: AgentReport
  evidenceSourceManifest: string
}): Promise<{ templateRelative: string; manifestRelative: string }> {
  const paths = frontendDesignArtifactPaths(input.projectDir, input.taskID)
  await Filesystem.writeAtomic(paths.manifestAbsolute, input.evidenceSourceManifest.trimEnd() + "\n")
  await Filesystem.writeAtomic(
    paths.templateAbsolute,
    renderMaterializedFrontendDesignReport({
      report: input.report,
      evidenceSourceManifest: input.evidenceSourceManifest,
    }),
  )
  return {
    templateRelative: paths.templateRelative,
    manifestRelative: paths.manifestRelative,
  }
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

const ModifyGoalInputSchema = z.object({
  goalID: z.string().min(1).describe("The goal ID to modify."),
  updates: GoalContractUpdateSchema,
  reason: z.string().min(1).describe("Why you decided to modify this goal."),
})

const AddGoalInputSchema = z.object({
  goal: GoalContractFieldsSchema.omit({ id: true }),
  reason: z
    .string()
    .min(1)
    .describe("Evidence that this new goal comes from the latest operator instruction or current task findings."),
})

const FrontendDesignReasonField = z.string().describe("Why frontend design is needed for this task")
const FrontendDesignLegacyUrlField = z
  .string()
  .optional()
  .describe("Deprecated — use `urls`. Single URL for back-compat; merged into `urls`.")
const FrontendDesignUrlsField = z
  .array(z.string())
  .optional()
  .describe(
    "Any number of design-reference URLs: live pages, design-tool share links " +
      "(Sketch Cloud / Adobe XD / Framer / InVision / Zeplin / Penpot), docs, etc. " +
      "Non-Figma URLs are available to frontend-design for webpage evidence extraction and may also be materialized " +
      "as screenshot references. Figma URLs use the connected Figma MCP path. Do not route URL/page extraction to build.",
  )
const FrontendDesignFigmaUrlField = z
  .string()
  .optional()
  .describe(
    "Figma file URL materialized through the connected Figma MCP server (figma.com/file/... or figma.com/design/...). " +
      "Requires Figma MCP tools get_design_context, get_screenshot, get_metadata, and get_variable_defs.",
  )
const FrontendDesignMaterialsField = z
  .array(z.string())
  .optional()
  .describe(
    "Local design-material paths (relative to project root, or absolute under it). " +
      "Supported: images, PDFs, markdown/text style guides, design-tokens JSON, CSS. " +
      "Each is read from disk and materialized into the attachment store as a visual_reference " +
      "so it flows through the same multimodal / read_attachment pipeline as user uploads.",
  )

const FrontendDesignInputSchema = z
  .object({})
  .extend({ reason: FrontendDesignReasonField })
  .extend({ url: FrontendDesignLegacyUrlField })
  .extend({ urls: FrontendDesignUrlsField })
  .extend({ figma_url: FrontendDesignFigmaUrlField })
  .extend({ materials: FrontendDesignMaterialsField })

const FrontendResearchReasonField = z
  .string()
  .min(1)
  .describe("Why frontend webpage investigation packets are useful for this task.")
const FrontendResearchSourceUrlsField = z
  .array(z.string().min(1))
  .min(1)
  .describe(
    "Source page URLs the frontend-research agent must partition into investigation work packets from prepared evidence.",
  )
const FrontendResearchFocusField = z
  .string()
  .optional()
  .describe("Optional narrow focus for the frontend-research agent.")

const FrontendResearchInputSchema = z
  .object({})
  .extend({ reason: FrontendResearchReasonField })
  .extend({ source_urls: FrontendResearchSourceUrlsField })
  .extend({ focus: FrontendResearchFocusField })

const VisualQaInputSchema = z.object({
  reason: z
    .string()
    .min(1)
    .describe("Why dedicated frontend visual GUI fidelity and functional testing is useful now."),
  focus: z.string().optional().describe("Optional narrowed region/state/viewport focus for visual QA."),
  app_url: z
    .string()
    .optional()
    .describe("Known preview URL to inspect. Omit when the agent should discover/start preview from scripts."),
  preview_command: z
    .string()
    .optional()
    .describe(
      "Suggested project command to start the real preview target. Use Node for Playwright/browser automation on Windows.",
    ),
})

function resolveSteerTarget(input: { taskID: string; sessionID?: string; goalID?: string }): {
  sessionID: string
  source: string
  goalRunID?: string
} {
  if (input.goalID) {
    const goal = findGoal(input.goalID)
    if (!goal || goal.task_id !== input.taskID) {
      throw new Error(`goal ${input.goalID} does not belong to task ${input.taskID}`)
    }
    const goalRun = findLatestTipGoalRun(input.goalID)
    if (!goalRun) {
      throw new Error(`goal ${input.goalID} has no goal_run yet; dispatch build before steering it.`)
    }
    if (!goalRun.session_id) {
      throw new Error(
        `goal ${input.goalID} latest goal_run ${goalRun.id} has no child session_id yet; wait for the build session to start or finalize the stale attempt before steering it.`,
      )
    }
    return {
      sessionID: goalRun.session_id,
      source: `${input.goalID} -> goal_run ${goalRun.id} -> session ${goalRun.session_id}`,
      goalRunID: goalRun.id,
    }
  }

  if (!input.sessionID) {
    throw new Error("steer_subagent requires either session_id or goal_id")
  }

  const goalRun = findGoalRun(input.sessionID)
  if (!goalRun || goalRun.task_id !== input.taskID) {
    const byChildSession = listGoalRunsForTask(input.taskID).find((row) => row.session_id === input.sessionID)
    return {
      sessionID: input.sessionID,
      source: input.sessionID,
      goalRunID: byChildSession?.id,
    }
  }
  if (!goalRun.session_id) {
    throw new Error(
      `goal_run ${input.sessionID} has no child session_id yet; wait for the build session to start or finalize the stale attempt before steering it.`,
    )
  }
  return {
    sessionID: goalRun.session_id,
    source: `${input.sessionID} -> session ${goalRun.session_id}`,
    goalRunID: goalRun.id,
  }
}

function assertDirectReplySessionOwnership(input: { taskID: string; sessionID: string }): { kind: string } {
  const owningTask = taskIDForSession(input.sessionID)
  if (owningTask !== input.taskID) {
    throw new Error(`Session ${input.sessionID} does not belong to task ${input.taskID}`)
  }
  const kind = sessionRole(input.sessionID)
  if (!kind) {
    throw new Error(`Session ${input.sessionID} has no task agent kind`)
  }
  if (!canReceiveDirectAgentSessionControl(kind)) {
    throw new Error(`Session ${input.sessionID} has kind "${kind}" and cannot receive direct agent control`)
  }
  return { kind }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function cancelLiveOwnedBuild(input: {
  taskID: string
  sessionID: string
  goalRunID?: string
  owner: OrchestratorToolOwnershipRow
  reason: string
  reasonPrefix?: string
  originSite?: string
  metadata?: Record<string, unknown>
}) {
  const cancelReason = `${input.reasonPrefix ?? "cancel_subagent"}: ${input.reason}`
  const goalRunID = input.goalRunID ?? input.owner.payload.goal_run_id
  const before = goalRunID ? findGoalRun(goalRunID) : undefined
  const aborted = await abortLiveOrchestratorToolOwnership({
    taskID: input.taskID,
    ownerships: [input.owner],
    reason: cancelReason,
    originSite: input.originSite ?? "orchestrator.tools.cancel-subagent-live-build",
    metadata: input.metadata ?? { cancelled_live_build: true },
  })
  let goalFact = ""
  if (goalRunID) {
    const goalRun = findGoalRun(goalRunID)
    if (goalRun && (aborted.goalRuns > 0 || before?.status !== goalRun.status)) {
      goalFact = ` goal_run ${goalRun.id} aborted.`
    } else if (goalRun) {
      goalFact = ` goal_run ${goalRun.id} was already terminal (${goalRun.status}); ownership closed.`
    }
  }
  return goalFact
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
    "requirement_ids",
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

export async function composeLatestAcceptanceFeedbackForBuild(input: {
  taskID: string
  goalID?: string
}): Promise<string | undefined> {
  const verdictArtifact = findLatestAcceptanceVerdictArtifact(input.taskID)
  const verdictPayload = (verdictArtifact?.payload ?? {}) as Record<string, unknown>
  if (!verdictArtifact || verdictPayload.verdict !== "rejected") return undefined

  const rejectionDetails = Array.isArray(verdictPayload.rejection_details)
    ? (verdictPayload.rejection_details as Array<Record<string, unknown>>)
    : []
  const scopedDetails = input.goalID
    ? rejectionDetails.filter((detail) => detail.goal_id === input.goalID)
    : rejectionDetails

  const {
    acceptanceManifestFailureDetails,
    findLatestAcceptanceEvidenceManifest,
    formatAcceptanceManifestFailureDetails,
  } = await import("@/acceptance/manifest")
  const acceptanceID = verdictArtifact.acceptance_id ?? undefined
  const manifest = acceptanceID ? findLatestAcceptanceEvidenceManifest({ acceptanceID }) : undefined
  const manifestFailureDetails = manifest ? formatAcceptanceManifestFailureDetails(manifest) : []
  const failedReviewIds = new Set(manifest?.finalGate.failedReviewIds ?? [])
  const packet = {
    verdict_artifact_id: verdictArtifact.id,
    acceptance_id: acceptanceID,
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
          failureDetails: acceptanceManifestFailureDetails(manifest),
          reviewEvidence: manifest.reviewEvidence.filter(
            (review) => review.status === "failed" || failedReviewIds.has(review.id),
          ),
        }
      : undefined,
  }

  return composeAcceptanceRetryFeedback({
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

async function composeIntegrityFeedbackMarkdownForBuild(input: {
  taskID: string
  activeSpecSnapshotID?: string
}): Promise<string | undefined> {
  if (!input.activeSpecSnapshotID) return undefined
  const { buildSpecSnapshotLineage } = await import("@/integrity/replay-context")
  const { composeIntegrityFeedbackForBuild } = await import("@/integrity/build-feedback")
  const { getSharedIntegrityPromptBudget } = await import("@/integrity/shared-prompt")
  const lineage = buildSpecSnapshotLineage({
    taskID: input.taskID,
    activeSpecSnapshotID: input.activeSpecSnapshotID,
  })
  return composeIntegrityFeedbackForBuild({
    taskID: input.taskID,
    specSnapshotLineage: lineage,
    promptBudget: getSharedIntegrityPromptBudget(),
    runtimeMarkdownDir: ProjectRuntimePaths.taskAbsolute(Instance.project.worktree, input.taskID, "integrity-feedback"),
  })?.promptMarkdown
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
    throw new Error(`invalid Figma URL for frontend_design MCP materialization: ${value}`, { cause: err })
  }
  if (!/(^|\.)figma\.com$/i.test(parsed.hostname)) {
    throw new Error(`frontend_design Figma MCP materialization expected a figma.com URL: ${value}`)
  }
  const node = parsed.searchParams.get("node-id")
  if (!node?.trim()) {
    throw new Error(`frontend_design Figma MCP materialization requires a node-id query parameter: ${value}`)
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

// Re-export the stateful-tool registry (defined in a dependency-free module
// so `session/message.ts` can import it without creating a circular graph
// through `@/session`). Surfacing it from this module keeps it visible to
// developers reading tool definitions.
export { STATEFUL_SNAPSHOT_TOOL_NAMES, type StatefulSnapshotToolName } from "./stateful-tool-names"

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * Synthesize a `FactCheckReport` for tool-error / aborted / scope-mismatch
 * paths where the LLM never returned a valid report.  Single construction
 * site so every error path persists a schema-valid artifact (rule 8 single
 * source; codex impl review §1).  The synthetic report carries the snapshot
 * scope (so the idempotency lookup still works) plus one `unresolved` entry
 * naming the host-side reason — read_context surfaces this verbatim.
 *
 * **Verdict is unconditionally `inconclusive`** — tool failure / cancel /
 * scope-mismatch is by definition "we could not verify", which is exactly
 * what inconclusive means.  This is NOT the same category as
 * `deriveFactCheckVerdict()`'s decision tree, which assumes a SUCCESSFUL
 * agent run: that tree's `items_total === 0 → clean` boundary fires when
 * a worker registered zero claims AND the agent ran cleanly through
 * verification.  Here the agent never operated, so the items_total=0
 * boundary doesn't apply — a tool-error artifact must never be marked
 * clean (codex impl review round 3 §B-1; round 2 §B-1 backstory).
 *
 * Severity on the unresolved entry is `minor` — tool failure says
 * "could not verify", not "the worker is wrong".  Blocking severity
 * would trigger `needs_orchestrator_action`, which is reserved for
 * cases where the agent SUCCESSFULLY found something wrong.
 */
function synthesizeToolErrorReport(input: {
  snap: { messageID?: string; contentHash?: string }
  args: { target_session_id: string; target_agent: string; fact_check_items: unknown[] }
  reason: string
}): FactCheckReport {
  const itemsTotal = input.args.fact_check_items.length
  return {
    scope: {
      target_session_id: input.args.target_session_id,
      target_agent: input.args.target_agent,
      target_message_id: input.snap.messageID ?? "",
      target_message_content_hash: input.snap.contentHash ?? "",
      items_total: itemsTotal,
      items_inspected: 0,
    },
    verified: [],
    corrected: [],
    unresolved: [
      {
        claim: input.reason.slice(0, 600),
        why_unresolved: "tool_failed" as const,
        severity: "minor" as const,
      },
    ],
    overall_verdict: "inconclusive",
  }
}

/**
 * Render a FactCheckReport as orchestrator-facing markdown.  Single-file
 * inline because the orchestrator yield is a string; the agent's own
 * markdown renderer at fact-check/tools.ts uses a different shape.
 */
function renderFactCheckReport(report: FactCheckReport): string {
  const sections: string[] = []
  sections.push(
    `**scope**: target_session=\`${report.scope.target_session_id}\` agent=\`${report.scope.target_agent}\` ` +
      `items=${report.scope.items_inspected}/${report.scope.items_total}`,
  )
  if (report.verified.length > 0) {
    sections.push(
      `### Verified (${report.verified.length})\n` +
        report.verified
          .map(
            (v, i) =>
              `${i + 1}. ${v.claim}\n` +
              v.evidence.map((e) => `   - [${e.kind}] ${e.pointer}: ${e.excerpt.slice(0, 240)}`).join("\n"),
          )
          .join("\n\n"),
    )
  }
  if (report.corrected.length > 0) {
    sections.push(
      `### Corrected (${report.corrected.length})\n` +
        report.corrected
          .map(
            (c, i) =>
              `${i + 1}. [${c.severity}] ${c.claim}\n` +
              `   → **${c.correction}**\n` +
              `   recommended_action: \`${c.recommended_action}\`\n` +
              c.evidence.map((e) => `   - [${e.kind}] ${e.pointer}: ${e.excerpt.slice(0, 240)}`).join("\n"),
          )
          .join("\n\n"),
    )
  }
  if (report.unresolved.length > 0) {
    sections.push(
      `### Unresolved (${report.unresolved.length})\n` +
        report.unresolved.map((u, i) => `${i + 1}. [${u.severity}, ${u.why_unresolved}] ${u.claim}`).join("\n"),
    )
  }
  return sections.join("\n\n")
}

export function createOrchestratorTools(input: {
  taskID: string
  agentSessionID: string
  signal?: AbortSignal
  workflow?: import("@/engine/workflow").MiniWorkflow
  workflowState?: import("@/engine/workflow").WorkflowState
  operatorMessage?: {
    text: string
    attachmentSummary?: string
    source?: string
    target?: TaskMessageTargetInput
    messageID?: string
  }
}) {
  const { taskID } = input

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

  async function publishGateArtifactResult(input: {
    acceptanceID: string
    runID: string
    summary: string
    source: "publish_acceptance"
  }) {
    const detail =
      `Publish gate blocked acceptance ${input.acceptanceID}: ${input.summary}. ` +
      `This is an artifact/export failure, not a acceptance verdict. Task lifecycle is unchanged; ` +
      `integrity is the workflow completion authority.`
    try {
      const { createDecisionLog } = await import("@/decision-log")
      createDecisionLog(taskID).append({
        phase: "acceptance",
        key: `publish_gate_rework_${Date.now()}`,
        value: detail,
        reason: input.source,
      })
    } catch {
      /* best effort */
    }
    return SubAgentProtocol.yieldResult({
      headline: `Publish gate blocked acceptance artifact export. Task lifecycle is unchanged.`,
      fields: [
        ["acceptance_id", input.acceptanceID],
        ["run_id", input.runID],
        ["publish_gate", input.summary],
        [
          "next",
          "inspect declared changed files vs exported workspace; artifact export needs a separate non-gate tool",
        ],
      ],
      pointer: `acceptance ${input.acceptanceID}; publish gate failure is post-acceptance export feedback`,
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
    if (isTaskTerminal(task)) {
      return {
        error: `Task ${task.id} is ${deriveTaskStatus(task)}. Terminal tasks cannot create build runs from a wake or tool-result continuation; use retry_task or restart_from_stage for an explicit restart.`,
      } as const
    }

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

  async function ensureTaskLevelBuildRun(): Promise<{ readonly run: RunRow } | { readonly error: string }> {
    const task = requireTask(taskID)
    if (isTaskTerminal(task)) {
      return {
        error: `Task ${task.id} is ${deriveTaskStatus(task)}. Terminal tasks cannot create build runs from a wake or tool-result continuation; use retry_task or restart_from_stage for an explicit restart.`,
      } as const
    }
    const existing = findActiveRunForTask(task.id)
    if (existing && isLiveRunStatus(existing.status)) return { run: existing } as const

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
    return { run: created } as const
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
      const headline = outcome.artifactMissing
        ? `Integrity session completed but status=artifact_missing — durable integrity_attempt persistence failed. ` +
          `Do not treat an older artifact as the current verdict until recovery or explicit user confirmation.`
        : outcome.verdict === "pass" && outcome.phase === "post_build"
          ? `Integrity verdict: pass — ${outcome.perDimension.join(", ")}. ` +
            `Integrity is the workflow gate; task completed.`
          : outcome.verdict === "pass"
            ? `Integrity verdict: pass — ${outcome.perDimension.join(", ")}. ` +
              `Pre-build integrity passed, but task is not complete until post-build integrity passes after terminal build evidence exists.`
            : `Integrity verdict: ${outcome.verdict} — ${outcome.perDimension.join(", ")}. ` +
              `Task is not accepted. Nothing in code supersedes goals, opens new attempts, or mutates the graph based on this verdict. ` +
              `Read the full markdown below and choose modify_goal / build({goalID}) / architect / fail_task explicitly.`
      return SubAgentProtocol.yieldResult({
        headline,
        fields: [
          ["goal_count", String(outcome.goalCount)],
          ["spec_snapshot_id", outcome.specSnapshotID],
          ["phase", outcome.phase],
          ["reviewer_count", String(outcome.reviewerCount)],
          ["findings_count", String(outcome.findingsCount)],
          ["required_repairs_count", String(outcome.requiredRepairsCount)],
          ["unresolved_disagreements_count", String(outcome.unresolvedDisagreementsCount)],
          ...(outcome.artifactMissing
            ? ([["artifact_persistence_status", `artifact_missing: ${outcome.artifactMissing.error}`]] as Array<
                [string, string]
              >)
            : []),
          ["summary", outcome.summary],
          // Full review text — every issue, every correction proposal,
          // every missing-goal proposal, with goal_ids preserved.
          ["team_report_markdown", outcome.markdown],
        ],
        pointer: `integrity session ${outcome.sessionID}`,
      })
    }
    throw new Error(`Unknown integrity outcome: ${(outcome as { status?: string }).status ?? "unknown"}`)
  }

  async function runIntegrityReview(toolExecution: OrchestratorToolExecutionContext): Promise<IntegrityReviewOutcome> {
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

    const reviewPromise = runIntegrityReviewOnce({ task, activeSpec, dbGoals, toolExecution })
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
    toolExecution: OrchestratorToolExecutionContext
  }): Promise<IntegrityReviewOutcome> {
    const { task, activeSpec, dbGoals, toolExecution } = ctx

    const { findDeliveriesForTask, findRequirements, listGoalRunsForTask } = await import("@/engine/store")
    const reqRows = findRequirements(activeSpec.id)
    const requirements = reqRows.map(parsedRequirementFromRow)
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
    const deliveriesForAcceptance = findDeliveriesForTask(taskID)
    const acceptanceChangedFiles = Array.from(
      new Set(
        deliveriesForAcceptance.flatMap((acceptance) => {
          const result = acceptance.result as
            | { changed_files?: string[]; changedFiles?: string[]; diffs?: Array<{ file?: string }> }
            | null
            | undefined
          return [
            ...(Array.isArray(result?.changed_files) ? result.changed_files : []),
            ...(Array.isArray(result?.changedFiles) ? result.changedFiles : []),
            ...(Array.isArray(result?.diffs)
              ? result.diffs.map((diff) => diff.file).filter((file): file is string => typeof file === "string")
              : []),
          ]
        }),
      ),
    )
    const acceptanceDiffs = deliveriesForAcceptance.flatMap((acceptance) => {
      const result = acceptance.result as
        | {
            diffs?: Array<{
              file: string
              diff?: string
              before?: string
              after?: string
              additions?: number
              deletions?: number
              status?: string
            }>
          }
        | null
        | undefined
      return Array.isArray(result?.diffs) ? result.diffs : []
    })
    const acceptanceSummary =
      deliveriesForAcceptance.length > 0
        ? deliveriesForAcceptance
            .map((acceptance) => acceptance.summary)
            .filter(Boolean)
            .join("\n")
        : "No acceptance artifact rows were found; review the requirement status snapshot and repository directly."

    const {
      reviewIntegrity,
      computeRequirementStatusSnapshot,
      buildIntegrityReplayContext,
      buildSpecSnapshotLineage,
      buildIntegrityRootHistory,
      persistentRootSummary,
    } = await import("@/integrity")
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
    // post_build would let the acceptance freshness gate accept attempts that
    // were taken mid-build, which is what codex review §6.4 #8 flagged.
    // Per @/engine/catalog GOAL_RUN_STATUS_CATALOG: completed = terminal,
    // failed/aborted = retriable, everything else = live.
    const TERMINAL_RUN_STATUSES = new Set<string>(["completed", "failed", "aborted"])
    const phase: "pre_build" | "post_build" = requirementStatus.some((r) =>
      r.claimingGoals.some((g) => TERMINAL_RUN_STATUSES.has(g.runStatus)),
    )
      ? "post_build"
      : "pre_build"
    const lineage = buildSpecSnapshotLineage({
      taskID,
      activeSpecSnapshotID: activeSpec.id,
    })
    const replayContext = buildIntegrityReplayContext({
      taskID,
      lineage,
      phase,
      goals: goalsForReview,
      requirements,
      buildRecords: deliveriesForAcceptance,
      goalRuns: listGoalRunsForTask(taskID),
    })
    const frontendDesignContract = decisionLog
      .readByPhase("frontend_design")
      .map((entry) => `## ${entry.key}\nreason: ${entry.reason}\n\n${entry.value}`)
      .join("\n\n")
    const visualQaContract = decisionLog
      .readByPhase("visual_qa")
      .map((entry) => `## ${entry.key}\nreason: ${entry.reason}\n\n${entry.value}`)
      .join("\n\n")
    const visualEvidence = await readLatestTaskVisualEvidenceBundle({ projectDir: Instance.directory, taskID })

    let activeOwnership: OrchestratorToolOwnershipPayload | undefined
    let ownershipClosed = false
    const closeIntegrityOwnership = (outcome: "completed" | "failed" | "cancelled", error?: string) => {
      if (!activeOwnership || ownershipClosed) return
      ownershipClosed = true
      completeOrchestratorToolOwnership({
        taskID,
        ownershipID: activeOwnership.ownership_id,
        outcome,
        error,
      })
    }

    let verdict: Awaited<ReturnType<typeof reviewIntegrity>>
    try {
      verdict = await reviewIntegrity({
        userRequest: task.request,
        taskTitle: task.title,
        goals: goalsForReview,
        requirements,
        requirementDecisions,
        requirementStatus,
        attachments: Array.isArray(task.attachments) ? (task.attachments as any) : undefined,
        acceptance: {
          summary: acceptanceSummary,
          changedFiles: acceptanceChangedFiles,
          diffs: acceptanceDiffs,
        },
        frontendDesign: frontendDesignContract,
        visualQa: visualQaContract,
        visualEvidence,
        replayContext,
        signal: input.signal,
        taskID,
        task,
        parentSessionID: input.agentSessionID,
        onSessionCreated: (sessionID) => {
          if (activeOwnership) return
          const ownershipPayload = createOrchestratorToolOwnershipPayload({
            taskID,
            orchestratorSessionID: toolExecution.orchestratorSessionID,
            orchestratorMessageID: toolExecution.orchestratorMessageID,
            toolCallID: toolExecution.toolCallID,
            toolPartID: toolExecution.toolPartID,
            childSessionID: sessionID,
            toolName: "integrity",
            scope: "task",
          })
          insertOrchestratorToolOwnershipArtifact({
            taskID,
            runID: findActiveRunForTask(taskID)?.id ?? null,
            goalRunID: null,
            label: "tool-ownership-start",
            payload: ownershipPayload,
          })
          activeOwnership = ownershipPayload
        },
      })
      closeIntegrityOwnership("completed")
    } catch (err) {
      closeIntegrityOwnership("failed", err instanceof Error ? err.message : String(err))
      throw err
    }

    const { recordIntegrityAttempt } = await import("@/engine/persist")

    const markdown = renderIntegrityMarkdown({ verdict, sessionID: verdict.sessionID })
    let artifactMissing: { sessionID: string; error: string } | undefined
    let persistentRootsValue = "persistent_roots=[]"
    let artifactPersisted = false
    try {
      recordIntegrityAttempt({
        taskID,
        sessionID: verdict.sessionID,
        lineage,
        verdict: verdict.verdict,
        phase,
        reviewers: verdict.reviewers,
        findingsCount: verdict.findings.length,
        requiredRepairsCount: verdict.requiredRepairs.length,
        unresolvedDisagreementsCount: verdict.unresolvedDisagreements.length,
        reason: verdict.summary,
        teamReportMarkdown: markdown,
        findings: verdict.findings,
        rounds: verdict.rounds,
        requiredRepairs: verdict.requiredRepairs,
        unresolvedDisagreements: verdict.unresolvedDisagreements,
      })
      artifactPersisted = true
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      artifactMissing = {
        sessionID: verdict.sessionID,
        error,
      }
      SessionStatus.markArtifactMissing(verdict.sessionID, error)
      await persistIntegrityArtifactMissingStatus({
        taskID,
        sessionID: verdict.sessionID,
        parentSessionID: input.agentSessionID,
        error,
      })
      log.error("integrity: recordIntegrityAttempt failed", {
        taskID,
        error,
      })
    }
    if (artifactPersisted) {
      try {
        persistentRootsValue = persistentRootSummary(
          buildIntegrityRootHistory({ taskID, specSnapshotLineage: lineage }),
        )
      } catch (err) {
        log.warn("integrity: persistent root summary failed (non-fatal)", {
          taskID,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    // Append a compact decision_log row so the orchestrator's read_context
    // automatically surfaces the accumulated review history (latest 20
    // entries, ≤ 600 chars per value). The full review_markdown stays in
    // engine_artifact for one-shot fidelity; this row is the cumulative
    // signal the orchestrator LLM needs to spot recurring issues across
    // multiple post-build reviews — same issues reappearing means the
    // current goal graph cannot absorb them and architect re-run / fail_task
    // becomes the cheaper repair (per orchestrator-core.txt's repair ladder).
    if (!artifactMissing) {
      try {
        const topIssues = verdict.findings
          .slice(0, 5)
          .map((i) => `[${i.severity}] ${i.title}: ${i.description}`)
          .join("; ")
        const issueTail =
          verdict.findings.length > 5 ? ` (+${verdict.findings.length - 5} more in engine_artifact)` : ""
        const value =
          `verdict=${verdict.verdict} | reviewers=${verdict.reviewers.length} | findings=${verdict.findings.length} | required_repairs=${verdict.requiredRepairs.length} | unresolved=${verdict.unresolvedDisagreements.length}` +
          ` | ${persistentRootsValue}` +
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
    }
    return {
      status: "reviewed",
      specSnapshotID: activeSpec.id,
      phase,
      verdict: verdict.verdict,
      summary: verdict.summary,
      sessionID: verdict.sessionID,
      goalCount: goalsForReview.length,
      perDimension: [`reviewers=${verdict.reviewers.length}`, `findings=${verdict.findings.length}`],
      reviewerCount: verdict.reviewers.length,
      findingsCount: verdict.findings.length,
      requiredRepairsCount: verdict.requiredRepairs.length,
      unresolvedDisagreementsCount: verdict.unresolvedDisagreements.length,
      markdown,
      findings: verdict.findings,
      requiredRepairs: verdict.requiredRepairs,
      unresolvedDisagreements: verdict.unresolvedDisagreements,
      artifactMissing,
    }
  }

  async function persistIntegrityArtifactMissingStatus(input: {
    taskID: string
    sessionID: string
    parentSessionID: string
    error: string
  }) {
    try {
      const { ProtocolStore } = await import("@/protocol/store")
      await ProtocolStore.appendEvent({
        kind: "event",
        type: "session.status",
        aggregate: "task",
        aggregate_id: input.taskID,
        task_id: input.taskID,
        run_id: null,
        goal_run_id: null,
        session_id: input.sessionID,
        interaction_id: null,
        stream_id: null,
        source: "integrity.artifact_missing",
        target: null,
        correlation_id: null,
        causation_id: null,
        reply_to: null,
        emitted_at: Date.now(),
        payload: {
          sessionID: input.sessionID,
          status: {
            type: "terminal",
            reason: "artifact_missing",
            error: input.error,
          },
          channel: "integrity",
          resolvedRole: "integrity",
          parentSessionID: input.parentSessionID,
        },
      })
    } catch (err) {
      log.warn("integrity: artifact_missing status persist failed", {
        taskID: input.taskID,
        sessionID: input.sessionID,
        error: err instanceof Error ? err.message : String(err),
      })
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
    const { EnginePlanVersionTable, EngineSpecSnapshotTable } = await import("@/engine/engine.sql")
    const { abortLiveExecutionForTask, createRun } = await import("@/engine/writer")
    const { deleteTaskGoals } = await import("@/engine/persist")

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
        deletedGoals = deleteTaskGoals(db, taskID).deletedGoals
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

    return `Task restarted from ${stage}. Reason: ${reason}. ${detail || "State cleared."} Candidate continuation fact: ${plan.nextAction}${freshRunID ? `(${freshRunID})` : ""}.`
  }

  // Agents that need to ask the user a question do so directly via
  // `Question.ask`. Workflow steps never pause for input here.

  const tools = {
    requirements: tool({
      description:
        "OPTIONAL stage agent. Parse the user's task into REQ-N requirements plus " +
        "foundational technical decisions (runtime, framework, test strategy, " +
        "package_manager, communication_protocol). Goal decomposition, " +
        "acceptance_specs, traceability, source/reference coverage, and cross-goal " +
        "contracts are all produced by the Architect — do NOT expect them from " +
        "this step.\n\n" +
        "USE WHEN: the work is multi-file with implicit acceptance criteria, OR you " +
        "intend to call `architect` next (architect needs the REQ-N rows), OR " +
        "foundational decisions are ambiguous and the build agent would otherwise " +
        "guess.\n" +
        "SKIP WHEN: a previous `requirements` result already succeeded and the active " +
        "spec snapshot still matches the current user scope; call `architect` next. " +
        'Only rerun after an operator scope change, `restart_from_stage("requirements")`, ' +
        "or concrete evidence that the active REQ snapshot is invalid.\n" +
        "SKIP WHEN: trivial direct edit (single-file bug fix, typo / config tweak); " +
        "build agent can run against the user's text alone and `deliver` has enough " +
        "signal in the request to verify. Frontend evidence tools are available candidates when the full task context " +
        "needs visual/reference material for requirements analysis.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to analyze requirements"),
      }),
      execute: async () => {
        let task = requireTask(taskID)
        log.info("requirements guard check", { taskID, hasSpec: !!findActiveSpecForTask(task.id) })
        // Rule 23: no host-side status gate. Tool selection is governed by
        // the orchestrator prompt/tool contract; reruns supersede the prior
        // spec and insert a new v1 snapshot only when task evidence justifies it.

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
        const decisionLog = createDecisionLog(taskID)
        const maturityScopePendingBeforeID = decisionLog.readByKey("maturity_scope_pending")?.id
        try {
          const { RequirementsAgent } = await import("@/requirements")
          const frontendDesign = renderFrontendDesignHandoffReference(taskID)

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
            frontendDesign: frontendDesign.trim().length > 0 ? frontendDesign : undefined,
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
            ...result.requirements.map(
              (r) =>
                `- **${r.id}** [${r.type}]: ${r.description} Acceptance: ${r.acceptance} Non-goals: ${r.non_goals} Evidence: ${r.evidence_refs.join(", ") || "(none)"}`,
            ),
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
                    acceptance: [r.acceptance],
                    evidence_refs: r.evidence_refs,
                    non_goals: [r.non_goals],
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
            headline: `SUCCESS: ${result.requirements.length} requirements, ${result.decisions.length} decisions parsed. Architect decomposition is now available if the full task context still needs a goal graph.`,
            summary: result.summary,
            fields: [
              ["decisions", result.decisions.map((d) => `${d.key}=${d.value}`)],
              ["requirements", String(result.requirements.length)],
            ],
            pointer: `read_context scope=decisions (spec ${specSnapshotID})`,
          })
        } catch (err) {
          const maturityScopeDecision = decisionLog.readByKey("maturity_scope_pending")
          if (maturityScopeDecision && maturityScopeDecision.id !== maturityScopePendingBeforeID) {
            const { output } = await Question.askAndFormat({
              sessionID: input.agentSessionID,
              questions: [
                {
                  header: "Maturity scope",
                  question: [
                    "The Requirements agent found an ambiguous maturity / quality word and stopped before finalizing requirements.",
                    `Recorded assumption: ${maturityScopeDecision.value}`,
                    `Reason: ${maturityScopeDecision.reason}`,
                    "Please define the maturity boundary so the requirements can be finalized without leaving later integrity review open-ended.",
                  ].join("\n\n"),
                  options: [
                    {
                      label: "Use assumption",
                      description: "Proceed with the recorded bounded interpretation.",
                    },
                    {
                      label: "Narrow scope",
                      description: "Limit maturity expectations to the explicitly requested behavior.",
                    },
                  ],
                  multiple: false,
                  custom: true,
                },
              ],
            })
            return SubAgentProtocol.yieldResult({
              headline: "requirements: maturity scope clarification requested.",
              summary: output,
              fields: [
                ["decision", "maturity_scope_pending"],
                ["recorded_assumption", maturityScopeDecision.value],
                ["reason", maturityScopeDecision.reason],
              ],
              pointer: "question lane; answered clarification will be included in the next requirements prompt",
            })
          }
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
          // P4 (rule 4 — same systemic shape as analyze_intent / frontend_design
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
    // Frontend Design — visual reference analysis before decomposition
    // -----------------------------------------------------------------------

    frontend_design: tool({
      description: [
        "Analyze visual/webpage references (images, URLs, Figma, materials) to produce a webpage-evidence-grounded frontend implementation template with fillable modules, component/material inventories, and visual/data contracts.",
        "Single-shot task-scope handoff producer: dispatch once for the relevant visual scope, persist the handoff, then send later repair/refinement through downstream agents that consume the handoff. Do not use frontend_design as a repeated repair, retry, or implementation iteration tool after its public report/evidence manifest exists.",
        "Use when you decide the requested deliverable needs frontend/UI implementation, webpage/app replication, or visual parity evidence AND:",
        "  - Image attachments are provided (screenshots, mockups, design files)",
        "  - The request mentions a URL as a visual reference to clone, implement, reproduce, or refine",
        "  - The request explicitly asks for layout/frontend design as implementation input",
        "",
        "The frontend-design agent must follow assistant.auto_iteration: one bounded frontend template review pass when disabled, at least two review passes when enabled.",
        "The full frontend template plus visual_consistency_contract and iteration/completeness review is persisted",
        "into the decision log from the same frontend-design run. Optional task.design_specs rows may exist as anchors, but the",
        "decision-log frontend template is authoritative. The decision log also includes evidence_source_manifest,",
        "which names the source files, images, URLs, materialized artifacts, webpage evidence artifacts, and task-runtime web-clone-source package downstream stages can read so they",
        "consume one source of truth instead of re-running webpage extraction.",
        "",
        "SKIP this step when:",
        "  - No visual references are available",
        "  - The task is purely backend/API/infrastructure",
        "  - You decide the URL is only PRD/SPEC/report source material and does not need frontend implementation-template evidence",
        "  - The request already contains detailed design specifications AND has no URL, screenshot/image, Figma/design-file, webpage-replica, or other visual reference that needs webpage-evidence/web-clone-source evidence for implementation",
      ].join("\n"),
      inputSchema: FrontendDesignInputSchema,
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
              phase: "frontend_design",
              key: "abort_no_visual_input",
              value:
                "frontend_design aborted before agent call: caller provided no visual reference (no attachments, no url, no figma_url, no materials).",
              reason: "no_visual_input_provided",
            })
          } catch (logErr) {
            log.warn("frontend_design: decision_log write failed (non-fatal)", {
              taskID,
              error: logErr instanceof Error ? logErr.message : String(logErr),
            })
          }
          throw new Error(
            "frontend_design requires at least one real visual reference: image attachment, URL, Figma URL, or local material path.",
          )
        }

        await trackStepStart("frontend_design")
        let frontendDesignStepClosed = false
        const closeFrontendDesignStep = async (failed = false) => {
          if (frontendDesignStepClosed) return
          frontendDesignStepClosed = true
          await trackStepComplete("frontend_design", undefined, failed)
        }

        log.info("frontend_design: starting", {
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
        //     captured them ourselves to feed frontend-design; not user
        //     intent — keeping them out of attachments prevents requirements
        //     from treating system-generated PNGs as user input).
        //
        // frontend-design combines both columns when assembling its visual
        // input. The deliver-time visual diff also reads both. Requirements
        // reads only attachments — it must see user intent, not internal
        // captures.
        const { AttachmentStore } = await import("@/storage/attachment-store")
        const fsMod = await import("node:fs/promises")
        const pathMod = await import("node:path")

        // Track how many external sources actually produced visual bytes. If
        // every URL screenshot and local material fails to
        // materialize AND the task had no pre-existing attachments, we must
        // abort before calling frontend-design — otherwise the agent runs
        // blind, registers nothing, and the orchestrator hangs waiting for
        // a frontend template that cannot exist. See benchmark run on
        // usage-replica-vague: assistant hallucinated ./image-N.png paths,
        // all 3 ENOENT'd, frontend-design still ran for 45s producing
        // nothing, and the pipeline stalled on the empty verdict.
        let materializedCount = 0
        const materializationFailures: Array<{
          source: "url" | "material"
          target: string
          stage: string
          error: string
        }> = []

        // --- Figma MCP references --------------------------------------------
        for (const figmaUrl of figmaUrls) {
          try {
            materializedCount += await materializeFigmaMcpReference({
              taskID,
              projectID: Instance.project.id,
              figmaUrl,
            })
            log.info("frontend_design: figma MCP reference materialized", {
              taskID,
              figmaUrl,
            })
          } catch (figmaErr) {
            await closeFrontendDesignStep(true)
            throw figmaErr
          }
        }

        // --- Generic URL screenshots -----------------------------------------
        // Any non-Figma URL is rendered in Chromium so design-tool
        // share links (Sketch Cloud, Adobe XD, Framer, InVision, Zeplin, …)
        // and plain live pages contribute pixel references, not just markup.
        //
        // URL captures are evidence materialization, not acceptance gates.
        // Browser/navigation/screenshot failures are recorded; pixel-density
        // heuristics are diagnostics attached to the materialized reference.
        for (const liveUrl of liveUrls) {
          try {
            const {
              captureReferenceManifest,
              assessCaptureDiagnostics,
              summarizeCaptureDiagnostics,
              CaptureReferenceError,
            } = await import("@/frontend-design/capture-gate")
            const osMod = await import("node:os")
            const outDir = pathMod.join(
              osMod.tmpdir(),
              "opencorvus-capture",
              `${Identifier.shortPath(taskID)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            )
            const capture = await captureReferenceManifest({ url: liveUrl, outDir })
            const diagnostics = assessCaptureDiagnostics(capture.manifest)
            const diagnosticSummary = diagnostics.length > 0 ? summarizeCaptureDiagnostics(diagnostics) : "none"
            const hostname = (() => {
              try {
                return new URL(capture.manifest.url).hostname
              } catch {
                return "url"
              }
            })()
            const slug = hostname.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60) || "url"
            const ref = await AttachmentStore.write(
              task.project_id,
              capture.screenshotPng,
              "image/png",
              `url-${slug}-${Date.now()}.png`,
            )
            await EngineService.appendTaskSystemArtifact(taskID, {
              ...ref,
              intent: "visual_reference",
              source: "url-screenshot",
            })
            log.info("frontend_design: url screenshot materialized", {
              taskID,
              url: liveUrl,
              sha: ref.sha,
              size: ref.size,
              non_white: capture.manifest.non_white_pixel_ratio,
              unique_colors: capture.manifest.unique_color_count,
              diagnostics: diagnosticSummary,
            })
            materializedCount++
          } catch (shotErr) {
            const { CaptureReferenceError } = await import("@/frontend-design/capture-gate")
            const stage = shotErr instanceof CaptureReferenceError ? shotErr.stage : "unknown"
            const error = shotErr instanceof Error ? shotErr.message : String(shotErr)
            materializationFailures.push({
              source: "url",
              target: liveUrl,
              stage,
              error,
            })
            log.warn("frontend_design: url screenshot capture failed", {
              taskID,
              url: liveUrl,
              stage,
              error,
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
              materializationFailures.push({
                source: "material",
                target: rawPath,
                stage: "path",
                error: `resolved path escapes project root: ${abs}`,
              })
              log.warn("frontend_design: material path escapes project root — skipped", {
                taskID,
                rawPath,
                projectRoot,
              })
              continue
            }
            const bytes = await fsMod.readFile(abs)
            const filename = pathMod.basename(abs)
            const mime = guessMimeFromFilename(filename)
            const ref = await AttachmentStore.write(task.project_id, bytes, mime, filename)
            await EngineService.appendTaskSystemArtifact(taskID, {
              ...ref,
              intent: "visual_reference",
              source: "material",
            })
            log.info("frontend_design: material materialized", {
              taskID,
              path: rawPath,
              sha: ref.sha,
              size: ref.size,
              mime,
            })
            materializedCount++
          } catch (matErr) {
            materializationFailures.push({
              source: "material",
              target: rawPath,
              stage: "read",
              error: matErr instanceof Error ? matErr.message : String(matErr),
            })
            log.warn("frontend_design: material materialization failed", {
              taskID,
              path: rawPath,
              error: matErr instanceof Error ? matErr.message : String(matErr),
            })
          }
        }

        let preparedWebpageEvidenceArtifacts: string[] = []
        let preparedWebpageEvidenceStatus: string | undefined
        if (liveUrls.length > 0) {
          try {
            const evidence = await ensureLiveWebpageEvidence({
              projectDir: Instance.project.worktree,
              worktreeDir: Instance.directory,
              taskID,
              urls: liveUrls,
              signal: input.signal,
            })
            preparedWebpageEvidenceArtifacts =
              evidence.artifacts.length > 0 ? evidence.artifacts : primaryWebpageEvidenceArtifacts(taskID)
            preparedWebpageEvidenceStatus = evidence.status
            log.info("frontend_design: live webpage evidence prepared", {
              taskID,
              url: evidence.url,
              status: evidence.status,
              evidenceDir: evidence.evidenceDir,
              artifacts: preparedWebpageEvidenceArtifacts.length,
            })
            if (evidence.status !== "skipped") {
              try {
                const { createDecisionLog } = await import("@/decision-log")
                createDecisionLog(taskID).append({
                  phase: "frontend_design",
                  key: "webpage_evidence",
                  value:
                    `Host-prepared live webpage evidence for ${evidence.url} (${evidence.status}).\n` +
                    preparedWebpageEvidenceArtifacts.map((item) => `- ${item}`).join("\n"),
                  reason:
                    "Live webpage clone evidence is prepared deterministically before frontend template synthesis so downstream agents consume source skeleton/IR instead of relying on screenshot-only prose.",
                })
              } catch (logErr) {
                log.warn("frontend_design: decision_log write failed (non-fatal)", {
                  taskID,
                  error: logErr instanceof Error ? logErr.message : String(logErr),
                })
              }
            }
          } catch (evidenceErr) {
            const error = evidenceErr instanceof Error ? evidenceErr.message : String(evidenceErr)
            try {
              const { createDecisionLog } = await import("@/decision-log")
              createDecisionLog(taskID).append({
                phase: "frontend_design",
                key: "abort_webpage_evidence_failed",
                value: `Live webpage evidence generation failed before frontend template synthesis: ${error}`,
                reason:
                  "A live webpage clone task cannot be grounded by prose alone; extraction/compile/analyze must succeed or surface the real acquisition failure.",
              })
            } catch (logErr) {
              log.warn("frontend_design: decision_log write failed (non-fatal)", {
                taskID,
                error: logErr instanceof Error ? logErr.message : String(logErr),
              })
            }
            await closeFrontendDesignStep(true)
            throw evidenceErr instanceof Error ? evidenceErr : new Error(error)
          }
        }

        // Refresh task to pick up any newly-attached references. frontend-design
        // sees the union of user attachments (figma + user uploads) and
        // system_artifacts (URL screenshots + materials we just captured).
        const enrichedTask = requireTask(taskID)
        const designVisuals = [
          ...(Array.isArray(enrichedTask.attachments) ? (enrichedTask.attachments as any[]) : []),
          ...(Array.isArray(enrichedTask.system_artifacts) ? (enrichedTask.system_artifacts as any[]) : []),
        ]
        const enrichedHasAttachments = designVisuals.length > 0

        // Fail-fast if frontend_design was invoked on the strength of URLs /
        // materials but every source failed to materialize. Running
        // frontend-design blind produces zero output tools, which the caller
        // turns into "frontend_design failed" — we surface the real root
        // cause (no usable visual input) back to the orchestrator instead
        // of letting the downstream agent run for 45s and emit nothing.
        if (!enrichedHasAttachments && materializedCount === 0 && preparedWebpageEvidenceArtifacts.length === 0) {
          await closeFrontendDesignStep(true)
          const providedCount = liveUrls.length + figmaUrls.length + materialPaths.length
          const failureDetail =
            materializationFailures.length > 0
              ? " Materialization errors: " +
                materializationFailures
                  .map((failure) => `${failure.source}:${failure.target} [${failure.stage}] ${failure.error}`)
                  .join("; ")
              : ""
          const message =
            `frontend_design aborted: all ${providedCount} provided visual source(s) ` +
            `failed to materialize (URLs unreachable, Figma fetch failed, or local material ` +
            `paths did not exist). Check that the paths/URLs in the 'materials' / 'url' / ` +
            `'urls' / 'figma_url' arguments actually exist, then retry frontend_design ` +
            `with real visual evidence or ask the user for usable reference material.` +
            failureDetail
          log.warn("frontend_design: no visual input materialized — aborting before agent call", {
            taskID,
            liveUrlCount: liveUrls.length,
            figmaUrlCount: figmaUrls.length,
            materialCount: materialPaths.length,
            materializationFailures,
          })
          // P4: write decision_log so downstream agents see "frontend design
          // was attempted but produced no visual context" rather than
          // running blind on designSpecs=undefined (audit §11.3 / L3, bench
          // tsk_dde13a67c001sbz6y2Qe0at8Fc:1729).
          try {
            const { createDecisionLog } = await import("@/decision-log")
            createDecisionLog(taskID).append({
              phase: "frontend_design",
              key: "abort_materialization_failed",
              value:
                `frontend_design aborted before agent call: all ${providedCount} provided visual ` +
                `source(s) (live=${liveUrls.length}, figma=${figmaUrls.length}, materials=${materialPaths.length}) ` +
                `failed to materialize.${failureDetail}`,
              reason: "materialization_failed_all_sources",
            })
          } catch (logErr) {
            log.warn("frontend_design: decision_log write failed (non-fatal)", {
              taskID,
              error: logErr instanceof Error ? logErr.message : String(logErr),
            })
          }
          await closeFrontendDesignStep(true)
          throw new Error(message)
        }

        // Single session per sub-agent (rule 22). FrontendDesignAgent.analyze
        // creates the runner session internally; the orchestrator captures
        // its id via onSessionCreated for downstream emit attribution.
        let runnerSessionID: string | undefined
        try {
          const { FrontendDesignAgent } = await import("@/frontend-design")

          const analysis = await FrontendDesignAgent.analyze({
            title: task.title,
            request: task.request,
            // Single-source visual input: every URL / Figma frame / local
            // material the orchestrator resolved has already been turned
            // into a PNG in `designVisuals`. Prefer those pixels; frontend-design
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
          // JSON column, not metadata). The binding contract is the frontend template
          // persisted into the Decision Log below; empty anchors are valid.
          const freshTask = requireTask(taskID)
          await updateTask(
            freshTask,
            { design_specs: analysis.specs },
            preparedWebpageEvidenceArtifacts.length > 0
              ? `Design frontend template stored (webpage clone artifacts: ${preparedWebpageEvidenceArtifacts.length}, optional visual anchors: ${analysis.specs.length})`
              : `Design frontend template stored (optional visual anchors: ${analysis.specs.length})`,
          )

          await closeFrontendDesignStep()

          const countByCategory = analysis.specs.reduce<Record<string, number>>((acc, s) => {
            acc[s.category] = (acc[s.category] ?? 0) + 1
            return acc
          }, {})
          const taskAfterDesignSpecs = requireTask(taskID)
          const materializedDesignFiles = frontendDesignArtifactPaths(Instance.directory, taskID)
          const evidenceSourceManifest = renderEvidenceSourceManifest({
            task: taskAfterDesignSpecs,
            liveUrls,
            figmaUrls,
            materialPaths,
            referenceArtifacts: analysis.referenceArtifacts,
            mirrorArtifacts: preparedWebpageEvidenceArtifacts,
            materializedFiles: [materializedDesignFiles.templateRelative, materializedDesignFiles.manifestRelative],
          })
          const writtenDesignArtifacts = await writeFrontendDesignArtifacts({
            projectDir: Instance.directory,
            taskID,
            report: analysis.report,
            evidenceSourceManifest,
          })

          const { createDecisionLog } = await import("@/decision-log")
          const decisionLog = createDecisionLog(taskID)
          decisionLog.append({
            phase: "frontend_design",
            key: "public_report",
            value: analysis.report.detail,
            reason:
              "Frontend-design terminal report; public readable handoff for Requirements, Architect, Build, and Acceptance.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "visual_contract_summary",
            value:
              `Optional visual anchors: ${analysis.specs.length}. ` +
              `Color ${countByCategory.color ?? 0}, typography ${countByCategory.typography ?? 0}, ` +
              `spacing ${countByCategory.spacing ?? 0}, layout ${countByCategory.layout ?? 0}, ` +
              `component ${countByCategory.component ?? 0}, interaction ${countByCategory.interaction ?? 0}, ` +
              `responsive ${countByCategory.responsive ?? 0}.`,
            reason: "Frontend-design optional anchor summary; the frontend template entries are authoritative.",
          })
          if (analysis.designSystem.trim()) {
            decisionLog.append({
              phase: "frontend_design",
              key: "design_system",
              value: analysis.designSystem,
              reason: "Frontend-design identified the dominant design system / visual language.",
            })
          }
          if (analysis.techStack.length > 0) {
            decisionLog.append({
              phase: "frontend_design",
              key: "recommended_stack",
              value: analysis.techStack.join(", "),
              reason:
                "Frontend-design's implementation stack hints grounded in the frontend template and observed reference behavior.",
            })
          }
          decisionLog.append({
            phase: "frontend_design",
            key: "frontend_template",
            value: analysis.frontendTemplate,
            reason: "Webpage-evidence-grounded frontend replica scope produced before requirements decomposition.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "final_acceptance_mode",
            value: analysis.finalAcceptanceMode ?? "visual_baseline_allowed",
            reason:
              "Whether downstream Build may keep the visual baseline or must replace requested surfaces with maintainable semantic components/data/API bindings.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "fillable_modules",
            value: analysis.fillableModules,
            reason:
              "Fillable module and slot plan derived from visual evidence, webpage evidence artifacts, and the task-runtime web-clone-source package.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "component_inventory",
            value: analysis.componentInventory,
            reason:
              "Legacy compatibility field only; downstream agents should read public_report, reuse constraints, quality_project_contract, completeness_review, and source artifacts instead of treating this as a component checklist.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "component_reuse_plan",
            value: JSON.stringify(analysis.componentReusePlan ?? [], null, 2),
            reason: "Structured reuse/library/fallback plan for each component family in the frontend template.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "baseline_replacement_plan",
            value: JSON.stringify(analysis.baselineReplacementPlan ?? [], null, 2),
            reason:
              "Generated-baseline deletion/replacement checklist that tells Build which skeleton regions must be replaced, deleted, or temporarily deferred and which existing/mature components own each boundary.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "quality_project_contract",
            value: analysis.qualityProjectContract,
            reason:
              "High-quality maintainable frontend project contract; raw extracted baseline is not the delivered project.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "material_inventory",
            value: analysis.materialInventory,
            reason: "Material and asset inventory required to fill the frontend template.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "frontend_project",
            value: [
              `status: ${analysis.frontendProject.status}`,
              `role: ${analysis.frontendProject.role}`,
              `project_root: ${analysis.frontendProject.project_root}`,
              `source_package: ${analysis.frontendProject.source_package}`,
              `generation_tool: ${analysis.frontendProject.generation_tool}`,
              `entrypoints: ${analysis.frontendProject.entrypoints.join(", ")}`,
              ...analysis.frontendProject.notes.map((note) => `note: ${note}`),
            ].join("\n"),
            reason: "Concrete frontend-design skeleton/project baseline for downstream Build refinement.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "visual_consistency_contract",
            value: analysis.visualConsistencyContract,
            reason: "Primary visual-fidelity contract for downstream implementation and acceptance review.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "ui_data_contract",
            value: analysis.uiDataContract,
            reason: "UI data contract needed to reproduce observed page behavior; unknowns remain explicit.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "template_iteration_notes",
            value: analysis.templateIterationNotes.join("\n"),
            reason: "Frontend template review passes completed before downstream handoff.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "completeness_review",
            value: analysis.completenessReview,
            reason: "Final frontend-design completeness audit for requirements, architect, and build.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "evidence_source_manifest",
            value: evidenceSourceManifest,
            reason:
              "Source manifest naming the frontend template origin, task files, materialized images, webpage evidence artifacts, and task-runtime web-clone-source package downstream agents can read.",
          })
          if (analysis.referenceArtifacts.length > 0) {
            decisionLog.append({
              phase: "frontend_design",
              key: "reference_artifacts",
              value: analysis.referenceArtifacts.join("\n"),
              reason: "Evidence artifacts used by frontend-design.",
            })
          }
          if (analysis.openQuestions.length > 0) {
            decisionLog.append({
              phase: "frontend_design",
              key: "open_questions",
              value: analysis.openQuestions.join("\n"),
              reason: "Facts frontend-design could not observe and downstream agents must not hallucinate.",
            })
          }

          log.info("frontend_design: complete", {
            taskID,
            total: analysis.specs.length,
            byCategory: countByCategory,
          })

          // Card terminal status flows through session.status; counts on
          // the Panel come from boardStore. No phase-completed bus event.

          return SubAgentProtocol.yieldResult({
            headline:
              "SUCCESS: frontend_design public report, visual_consistency_contract, and evidence manifest persisted. " +
              "Downstream agents can now read the public report before requirements, architecture, build, or acceptance work.",
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
              ["template_review_passes", String(analysis.templateIterationNotes.length)],
              ["reference_artifacts", String(analysis.referenceArtifacts.length)],
              ["frontend_project_status", analysis.frontendProject.status],
              ["frontend_project_root", analysis.frontendProject.project_root],
              ["webpage_evidence", preparedWebpageEvidenceStatus ?? "none"],
              ["webpage_clone_artifacts", String(preparedWebpageEvidenceArtifacts.length)],
              ["source_manifest", "decision_log:frontend_design/evidence_source_manifest"],
              ["frontend_template_file", writtenDesignArtifacts.templateRelative],
              ["source_manifest_file", writtenDesignArtifacts.manifestRelative],
              ["open_questions", String(analysis.openQuestions.length)],
            ],
            pointer: "decision_log phase=frontend_design",
          })
        } catch (err) {
          await closeFrontendDesignStep(true)
          const msg = err instanceof Error ? err.message : String(err)
          log.error("frontend_design: failed", { taskID, error: msg })
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
        "codebase, and registers the final goal set with acceptance_specs, " +
        "traceability, source/reference coverage, and cross-goal contracts.\n\n" +
        "USE WHEN: the work fans into multiple parallel goals (independent " +
        "owned_paths, cross-goal contracts), OR you need explicit acceptance specs " +
        "per goal so per-goal builds and `integrity` have something concrete to verify " +
        "against. Requires a `requirements` spec snapshot to run against — call " +
        "`requirements` first.\n" +
        "SKIP WHEN: the work fits one goal (the build agent's own todo list is " +
        "enough); every fix lives inside one file or one symbol's call sites.\n" +
        "Re-run on integrity non-pass or explicit structural restart when evidence " +
        "points at structural / coverage problems. During an active run, do not " +
        "re-run architect merely to widen owned_paths or bless ordinary shared-file " +
        "edits; build sessions may edit outside responsibility paths when needed " +
        "and must explain every touched file in files_changed[]. For contract-level " +
        "point fixes prefer `modify_goal`. Frontend evidence tools are available candidates when the full task context " +
        "needs visual/reference material for architecture.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to run architect"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
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
          const requirements = reqRows.map(parsedRequirementFromRow)
          const requirementDecisions = decisionLog.readByPhase("requirements").map((d) => ({
            key: d.key,
            value: d.value,
            reason: d.reason,
          }))
          const frontendDesign = renderFrontendDesignHandoffReference(taskID)
          // Goal Workload Analyst sizing feedback (advisory). On the first
          // architect pass this is undefined (no analyst has run yet); on a
          // re-dispatch it carries the analyst's per-goal briefs so architect
          // can act on decomposition_concern. Architect re-decomposes, so all
          // briefs are acceptable input — no snapshot filter here.
          const workloadArtifact = findLatestGoalWorkloadArtifact(taskID)

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
            frontendDesign: frontendDesign.trim().length > 0 ? frontendDesign : undefined,
            workloadBriefs: workloadArtifact?.briefs,
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
          const reqLines = requirements.map(
            (r) =>
              `- **${r.id}** [${r.type}]: ${r.description} Acceptance: ${r.acceptance} Non-goals: ${r.non_goals} Evidence: ${r.evidence_refs.join(", ") || "(none)"}`,
          )
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
              const mappedTraceLines = result.traceability.map(
                (t) =>
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
              ` Eligible per-goal builds are now visible; read each build report and worktree facts, then decide modify_goal / build / architect / integrity / fail_task explicitly from current evidence.`,
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
    // Goal Workload Analyst — independent, read-only goal-sizing reviewer.
    //
    // Runs after architect, before per-goal build (advisory, not a gate). It
    // deep-reads the full frontend template (inlined into its prompt) plus the architect
    // goal graph and, per goal, produces a compact brief: countable work
    // surface + why_not_smaller + underestimation_traps + verification_inventory
    // + a decomposition_concern when a goal is too large / under-specified for
    // one autonomous build. It only references existing surfaces/contracts by
    // id — it never re-decomposes goals (that is architect's job). The brief is
    // persisted as a single task-level `goal_workload` artifact (latest-wins,
    // staleness-bound to the active spec snapshot). Concern findings feed an
    // architect re-size; the brief feeds build against premature minimization.
    // Failure surfacing mirrors the architect tool's catch.
    // -----------------------------------------------------------------------

    workload_analysis: tool({
      description:
        "OPTIONAL read-only stage agent. After architect, before per-goal build, the Goal Workload " +
        "Analyst deep-reads the FULL frontend template + the architect goal graph and produces a per-goal " +
        "workload brief: countable work surface, why-it-is-not-smaller, underestimation traps, a " +
        "verification inventory, and a `decomposition_concern` when a goal is too large or " +
        "under-specified for one autonomous build. It is an independent sizing reviewer with no " +
        "implementation bias — it never writes code and never creates / modifies / splits goals.\n\n" +
        "USE WHEN: architect just produced a multi-goal graph and you want an independent check that " +
        "no goal is oversized before dispatching builds, OR you want each build to receive an " +
        "anti-underestimation brief. Requires architect goals on the active spec snapshot.\n" +
        "SKIP WHEN: the goal set is trivial (one obvious goal). Advisory — the workflow can proceed " +
        "without it.\n" +
        "AFTER it returns: goals flagged with `decomposition_concern` are evidence for an architect " +
        "re-size — prefer `modify_goal` for single-field fixes, re-enter `architect` only for genuinely " +
        "new structure (a split). Briefs feed the next per-goal `build` automatically.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to run workload analysis"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        const activeSpec = findActiveSpecForTask(task.id)
        if (!activeSpec) {
          return SubAgentProtocol.yieldResult({
            headline: "workload_analysis: no active spec — call requirements/architect first.",
            fields: [["next_action", "architect"]],
            pointer: "read_context scope=decisions",
          })
        }
        const goals = listGoals(taskID)
        if (goals.length === 0) {
          return SubAgentProtocol.yieldResult({
            headline: "workload_analysis: no goals on the active spec — call architect first.",
            summary:
              "The Goal Workload Analyst sizes an existing goal graph. No architect goals exist yet, " +
              "so there is nothing to analyze.",
            fields: [["next_action", "architect"]],
            pointer: "read_context scope=decisions",
          })
        }

        await trackStepStart("workload_analysis")
        let runnerSessionID: string | undefined
        try {
          const { findRequirements } = await import("@/engine/store")
          const requirements = findRequirements(activeSpec.id).map(parsedRequirementFromRow)
          const frontendDesign = renderFrontendDesignHandoffReference(taskID)
          const contractGraph = findLatestArchitectContractGraph(taskID)

          // referenceCoverage: architect persists `architect_fidelity` into task
          // metadata with referenceCoverage rows {id, surface, visual_spec_ids,
          // expectation, goal_ids}. Map to the analyst's input shape when present;
          // it is optional, so a missing / malformed shape degrades to undefined
          // rather than inventing rows.
          let referenceCoverage:
            | Array<{ id: string; surface: string; visual_spec_ids: string[]; expectation: string }>
            | undefined
          const taskMetadata =
            task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
              ? (task.metadata as Record<string, unknown>)
              : {}
          const fidelity = taskMetadata.architect_fidelity as
            | { referenceCoverage?: Array<Record<string, unknown>> }
            | undefined
          if (fidelity && Array.isArray(fidelity.referenceCoverage)) {
            referenceCoverage = fidelity.referenceCoverage.map((row) => ({
              id: String(row.id ?? ""),
              surface: String(row.surface ?? ""),
              visual_spec_ids: Array.isArray(row.visual_spec_ids) ? (row.visual_spec_ids as string[]) : [],
              expectation: String(row.expectation ?? ""),
            }))
          }

          // prdFullText: inline the materialized template when it exists (the analyst
          // is the one agent whose whole job is to digest it). Optional —
          // wrapped so a missing / unreadable file falls back to the handoff
          // reference the prompt already renders.
          let prdFullText: string | undefined
          try {
            const templatePath = frontendDesignArtifactPaths(Instance.directory, taskID).templateAbsolute
            const nodeFs = await import("node:fs")
            prdFullText = nodeFs.existsSync(templatePath) ? nodeFs.readFileSync(templatePath, "utf8") : undefined
          } catch (prdErr) {
            log.warn("workload_analysis: template inline read failed (non-fatal)", {
              taskID,
              error: prdErr instanceof Error ? prdErr.message : String(prdErr),
            })
          }

          const { GoalWorkloadAnalystAgent } = await import("@/goal-workload-analyst")
          const result = await GoalWorkloadAnalystAgent.analyze({
            taskTitle: task.title,
            goals: goals.map((g) => ({
              id: g.id,
              title: g.title,
              objective: g.objective,
              acceptance_specs: acceptanceSpecsToPromptLines(g.acceptance_specs),
              owned_paths: Array.isArray(g.owned_paths) ? (g.owned_paths as string[]) : [],
              depends_on: Array.isArray(g.depends_on) ? (g.depends_on as string[]) : [],
              kind: g.kind,
              requirement_ids: Array.isArray(g.requirement_ids) ? (g.requirement_ids as string[]) : [],
            })),
            contractGraph: contractGraph ?? undefined,
            referenceCoverage,
            requirements: requirements.length > 0 ? requirements : undefined,
            prdFullText,
            frontendDesign: frontendDesign.trim().length > 0 ? frontendDesign : undefined,
            specSnapshotID: activeSpec.id,
            taskID,
            parentSessionID: input.agentSessionID,
            signal: input.signal,
            onSessionCreated: (id) => {
              runnerSessionID = id
            },
          })

          const { persistGoalWorkload } = await import("@/engine/persist")
          Database.use((db) =>
            persistGoalWorkload(db, {
              taskID,
              specSnapshotID: activeSpec.id,
              briefs: result.briefs,
              summary: result.summary,
              now: Date.now(),
            }),
          )

          await trackStepComplete("workload_analysis")

          const flagged = result.briefs.filter((b) => b.decomposition_concern?.trim()).map((b) => b.goal_id)
          return SubAgentProtocol.yieldResult({
            headline:
              `Workload analysis complete: ${result.briefs.length} goals analyzed, ${flagged.length} flagged with decomposition_concern. ` +
              "For flagged goals consider Architect re-sizing (modify_goal for single-field fixes / architect for a split); " +
              "otherwise dispatch per-goal build — each build now carries its workload brief.",
            summary: result.summary,
            fields: [
              ["goals_flagged", flagged],
              ["spec_snapshot_id", activeSpec.id],
            ],
            pointer: "read_context scope=decisions",
          })
        } catch (err) {
          // Same shape as the architect tool's catch (rule 4 — failure
          // surfacing is uniform across stage agents): mark the workflow step
          // failed and record the abort in the decision log so the operator
          // can see WHICH stage broke, then rethrow.
          try {
            await trackStepComplete("workload_analysis", undefined, true)
          } catch (trackErr) {
            log.warn("workload_analysis: trackStepComplete(failed) emit failed", {
              taskID,
              error: trackErr instanceof Error ? trackErr.message : String(trackErr),
            })
          }
          try {
            const { createDecisionLog } = await import("@/decision-log")
            const reason = err instanceof Error ? err.message : String(err)
            createDecisionLog(taskID).append({
              phase: "architect",
              key: "abort_workload_analysis_failed",
              value: `Workload analysis stage aborted: ${reason.slice(0, 400)}`,
              reason: "workload_analysis_threw",
            })
          } catch (logErr) {
            log.warn("workload_analysis: decision_log write failed (non-fatal)", {
              taskID,
              error: logErr instanceof Error ? logErr.message : String(logErr),
            })
          }
          throw err
        }
      },
    }),

    // -----------------------------------------------------------------------
    // Visual QA — dedicated frontend GUI fidelity and function testing and repair
    // -----------------------------------------------------------------------

    visual_qa: tool({
      description:
        "Dedicated post-goal-batch frontend visual GUI fidelity and functional testing agent. GUI means Graphical User Interface. " +
        "Use once after each terminal frontend goal batch as peer post-build review evidence before the next goal batch: desktop/mobile screenshots, " +
        "interaction-state checks, visual comparison, console/network review, or direct repair of visual or functional defects. " +
        "It consumes task-scoped frontend_design/build evidence plus any prior integrity evidence and repairs coarse-to-fine: component truth and visible functionality first, layout/composition second, micro-style polish last. " +
        "It reviews from a professional design QA perspective, lists production_blockers when the product cannot ship, and does not use a fixed similarity score as the only verdict. " +
        "It may use skills, bash/edit/write/apply_patch, and webpage_render/evaluate/text_diff/vision_judge. " +
        "It does NOT acquire new webpage clone evidence and is NOT the final acceptance gate; integrity remains final. Visual QA and integrity are peer review agents; visual_qa does not replace integrity and is not integrity's workflow prerequisite.",
      inputSchema: VisualQaInputSchema,
      execute: async ({ reason, focus, app_url, preview_command }) => {
        const task = requireTask(taskID)
        await trackStepStart("visual_qa")
        let closed = false
        const close = async (failed = false) => {
          if (closed) return
          closed = true
          await trackStepComplete("visual_qa", undefined, failed)
        }

        const decisionLog = createDecisionLog(taskID)
        const frontendDesign = renderVisualQaFrontendDesignContext(decisionLog.readByPhase("frontend_design"))
        const frontendResearch = renderVisualQaFrontendResearchContext(
          findNonStaleFrontendResearchBrief({
            taskID,
            request: task.request,
          }),
        )
        const buildEvidence = renderVisualQaBuildEvidenceContext(findDeliveriesForTask(taskID))
        const priorVisualQa = renderVisualQaPriorReportContext(decisionLog.readByPhase("visual_qa"))
        const activeSpec = findActiveSpecForTask(taskID)
        const integrityContext = renderVisualQaIntegrityContext(
          activeSpec
            ? findLatestIntegrityAttemptArtifact({
                taskID,
                specSnapshotID: activeSpec.id,
                phase: "post_build",
              })
            : undefined,
        )

        try {
          const { VisualQaAgent } = await import("@/visual-qa")
          const result = await VisualQaAgent.analyze({
            taskTitle: task.title,
            taskRequest: task.request,
            reason,
            focus,
            appUrl: app_url,
            previewCommand: preview_command,
            frontendDesign,
            frontendResearch,
            integrityContext,
            buildEvidence,
            priorVisualQa,
            taskID,
            parentSessionID: input.agentSessionID,
            signal: input.signal,
          })

          decisionLog.append({
            phase: "visual_qa",
            key: `report_${Date.now()}`,
            value: JSON.stringify(result.report, null, 2),
            reason: `Dedicated frontend GUI and functional QA report from session ${result.sessionID}`,
          })
          decisionLog.append({
            phase: "visual_qa",
            key: "latest_summary",
            value: [
              `accepted=${result.report.accepted}`,
              `summary=${result.report.summary}`,
              `coverage=${result.report.coverage.length}`,
              `findings=${result.report.findings.length}`,
              `production_blockers=${result.report.production_blockers.length}`,
              `evidence=${result.report.evidence.length}`,
              `changed_files=${result.report.changed_files.join(", ") || "(none)"}`,
            ].join("\n"),
            reason: "Latest structured visual QA summary for read_context and integrity review.",
          })

          await close()
          return SubAgentProtocol.yieldResult({
            headline: `visual_qa complete: accepted=${result.report.accepted}`,
            summary: result.report.summary,
            fields: [
              ["session", result.sessionID],
              ["accepted", String(result.report.accepted)],
              ["coverage", String(result.report.coverage.length)],
              ["findings", String(result.report.findings.length)],
              ["production_blockers", String(result.report.production_blockers.length)],
              ["evidence", String(result.report.evidence.length)],
              ["repairs", String(result.report.repairs.length)],
              ["changed_files", result.report.changed_files.join(", ") || "(none)"],
              ["open_questions", String(result.report.open_questions.length)],
            ],
            pointer: "decision_log phase=visual_qa",
          })
        } catch (err) {
          await close(true)
          const msg = err instanceof Error ? err.message : String(err)
          log.error("visual_qa: failed", { taskID, error: msg })
          try {
            decisionLog.append({
              phase: "visual_qa",
              key: "abort_visual_qa_failed",
              value: `Visual QA stage aborted: ${msg.slice(0, 400)}`,
              reason: "visual_qa_threw",
            })
          } catch (logErr) {
            log.warn("visual_qa: decision_log write failed (non-fatal)", {
              taskID,
              error: logErr instanceof Error ? logErr.message : String(logErr),
            })
          }
          throw err instanceof Error ? err : new Error(msg)
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
        "FINAL workflow gate. Independent adversarial integrity supervisor review of the active " +
        "architect graph and delivered system. The supervisor creates task-specific reviewer " +
        "sessions, reviewers freely inspect/test within read-only evidence tools, and the final " +
        "output is a consensus team report with findings, evidence, required repairs, and unresolved " +
        "disagreements. A post-build pass verdict completes the task. Non-pass findings " +
        "are persisted as evidence only: this review never rewrites requirements, " +
        "never upserts goals, and the host never auto-supersedes attempts or " +
        "auto-routes findings — you read the markdown and choose modify_goal / " +
        "build({goalID}) / architect / fail_task explicitly. Goal builds record " +
        "build reports as review input.\n\n" +
        "USE WHEN: architect just produced a non-trivial goal graph (≥3 goals, OR " +
        "cross-goal contracts, OR foundational decisions architect derived rather " +
        "than user-stated), OR build evidence needs architecture feedback. " +
        "Build reports are already recorded as review input for goal builds.\n" +
        "SKIP WHEN: architect produced exactly one goal whose contract trivially " +
        "matches the user request, OR you already ran integrity for this spec " +
        "snapshot and have no new signal. Requires architect goals on the active " +
        "spec snapshot.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to run integrity review"),
      }),
      execute: async (_input, options) => {
        const toolExecution = requireOrchestratorToolExecutionContext(options, "integrity")
        const outcome = await runIntegrityReview(toolExecution)
        if (outcome.status === "reviewed" && outcome.artifactMissing && outcome.phase === "post_build") {
          await blockActiveRunForTask(taskID, {
            blockingReason: "integrity artifact_missing",
            error: outcome.artifactMissing.error,
            summary: "Run blocked by missing integrity attempt artifact",
          })
        } else if (outcome.status === "reviewed" && outcome.verdict === "pass" && outcome.phase === "post_build") {
          const task = requireTask(taskID)
          const completed = Date.now()
          const activeRun = findActiveRunForTask(taskID)
          if (activeRun) {
            await updateRun(
              activeRun,
              {
                status: "completed",
                blocking_reason: null,
                error: null,
                time_completed: completed,
              },
              "Run completed by passing integrity gate",
            )
          }
          await updateTask(
            task,
            { status: "completed", error: null, time_completed: completed },
            "Task completed by passing integrity gate",
          )
        } else if (outcome.status === "reviewed" && outcome.phase === "post_build") {
          await blockActiveRunForTask(taskID, {
            blockingReason: `integrity verdict ${outcome.verdict}`,
            error: outcome.summary,
            summary: "Run blocked by non-pass integrity gate",
          })
        }
        return renderIntegrityOutcome(outcome)
      },
    }),

    // -----------------------------------------------------------------------
    // Fact-check — verifies factual claims registered by a worker agent's
    // terminal report.  Specs: specs/fact-check-agent-2026-05-25.md §4.3.
    //
    // Trigger rule (rule 13 — you, the orchestrator LLM, decide):
    //   You MAY call fact_check after integrity verdict = pass when
    //   the upstream worker's terminal report has fact_check_items.length > 0
    //   OR the worker's narrative makes load-bearing factual claims about
    //   external systems.  The tool dedupes automatically across repeats;
    //   if the target session is still streaming, the tool will reject —
    //   retry after it finishes.
    // -----------------------------------------------------------------------

    fact_check: tool({
      description:
        "Verify factual claims a worker agent registered in its terminal report. " +
        "Use when (1) integrity verdict=pass AND (2) the worker's terminal report has " +
        "non-empty fact_check_items OR makes load-bearing factual claims about external " +
        "systems (APIs, library versions, third-party protocols, numbers, paths). " +
        "The tool dedupes automatically across repeated calls — you do NOT need to " +
        "track 'already checked'.  If the target session is still streaming, the tool " +
        "will reject; retry after it finishes.\n" +
        "DO NOT call for trivial / opinion / preference outputs, or when integrity " +
        "verdict ≠ pass.\n" +
        "After fact_check returns:\n" +
        "- verdict=clean → proceed.\n" +
        "- verdict=minor_corrections → quote corrections in your next user-facing " +
        "message, proceed.\n" +
        "- verdict=needs_orchestrator_action → invoke modify_goal / restart_from_stage / " +
        "fail_task per the corrected[i].recommended_action.\n" +
        "- verdict=inconclusive → retry fact_check or proceed with a caveat note.",
      inputSchema: z.object({
        target_session_id: z.string().describe("Session id of the worker whose terminal report you want fact-checked."),
        target_agent: z
          .string()
          .describe(
            "Worker agent name: build / requirements / architect / frontend-design / intent-analysis / integrity.",
          ),
        fact_check_items: FactCheckItemListSchema.describe(
          "Copy of the fact_check_items[] array from the worker's terminal report. " +
            "Empty array is allowed only when you also explain `reason` why fact-check is " +
            "still useful (e.g., load-bearing prose claims the worker didn't register).",
        ),
        reason: z.string().min(10).describe("Why you decided to dispatch fact-check on this worker output."),
      }),
      execute: async (args) => {
        const task = requireTask(taskID)
        await trackStepStart("fact_check")
        const { FactCheckAgent } = await import("@/fact-check")
        const { findFactCheckAttempt, recordFactCheckAttempt } = await import("@/fact-check/persist")
        const { Session } = await import("@/session")

        // Step 1: snapshot — also acts as the terminal-state precondition.
        const snap = await Session.snapshotLatestAssistant(args.target_session_id)
        if (!snap.finished) {
          return (
            `fact_check rejected: target session is not in a terminal state ` +
            `(reason=${snap.reason ?? "unknown"}). Retry after the worker finishes streaming.`
          )
        }
        if (!snap.messageID || !snap.contentHash) {
          return (
            "fact_check rejected: target session has no terminal assistant message. " +
            "Confirm you passed the correct target_session_id."
          )
        }

        // Step 2: idempotency cache.
        const cached = findFactCheckAttempt({
          invokedByOrchestratorSessionID: input.agentSessionID,
          targetSessionID: args.target_session_id,
          targetMessageID: snap.messageID,
          targetMessageContentHash: snap.contentHash,
        })
        if (cached) {
          return (
            `fact_check (cached, no LLM work) — verdict=\`${cached.payload.report.overall_verdict}\`\n\n` +
            renderFactCheckReport(cached.payload.report)
          )
        }

        // Step 3: run agent.
        const timeStarted = Date.now()
        try {
          const result = await FactCheckAgent.run({
            targetSessionID: args.target_session_id,
            targetAgent: args.target_agent,
            targetMessageID: snap.messageID,
            targetMessageContentHash: snap.contentHash,
            factCheckItems: args.fact_check_items,
            reason: args.reason,
            orchestratorSessionID: input.agentSessionID,
            taskID: task.id,
            signal: input.signal,
            // No onSessionCreated hook needed at this layer — the runner
            // creates the child session under parentSessionID for overlay
            // nesting automatically.
          })
          // Step 3a: scope consistency check (codex impl review §3).  The
          // LLM populates report.scope itself; we must assert it matches
          // the snapshot the host took so a wrong scope cannot poison the
          // idempotency cache or read_context downstream.  Mismatch is
          // a contract violation, not a soft warning — return tool error
          // and persist outcome=tool_error so the orchestrator knows to
          // retry (rule 7: no silent fallback).
          const scope = result.report.scope
          const scopeMismatch =
            scope.target_session_id !== args.target_session_id ||
            scope.target_agent !== args.target_agent ||
            scope.target_message_id !== snap.messageID ||
            scope.target_message_content_hash !== snap.contentHash
          if (scopeMismatch) {
            const synthetic = synthesizeToolErrorReport({
              snap,
              args,
              reason:
                `fact-check returned a report.scope inconsistent with the host snapshot ` +
                `(expected target_session=${args.target_session_id} agent=${args.target_agent} ` +
                `message_id=${snap.messageID}; got session=${scope.target_session_id} ` +
                `agent=${scope.target_agent} message_id=${scope.target_message_id})`,
            })
            recordFactCheckAttempt({
              taskID: task.id,
              factCheckSessionID: result.sessionID,
              targetSessionID: args.target_session_id,
              targetAgent: args.target_agent,
              targetMessageID: snap.messageID,
              targetMessageContentHash: snap.contentHash,
              invokedByOrchestratorSessionID: input.agentSessionID,
              report: synthetic,
              timeStarted,
              outcome: "tool_error",
            })
            return `fact_check tool_error: ${synthetic.unresolved[0].claim}`
          }
          recordFactCheckAttempt({
            taskID: task.id,
            factCheckSessionID: result.sessionID,
            targetSessionID: args.target_session_id,
            targetAgent: args.target_agent,
            targetMessageID: snap.messageID,
            targetMessageContentHash: snap.contentHash,
            invokedByOrchestratorSessionID: input.agentSessionID,
            report: result.report,
            timeStarted,
            outcome: result.outcome,
          })
          // Surface a one-line summary in decision_log so integrity replay
          // and read_context can mention "fact-check verdict was X" without
          // having to parse the full artifact (spec §6.1.2 step 7).
          try {
            const { createDecisionLog } = await import("@/decision-log")
            createDecisionLog(task.id).append({
              phase: "fact_check",
              key: `fact_check:${args.target_session_id}:${snap.messageID}`,
              value:
                `verdict=${result.report.overall_verdict} ` +
                `verified=${result.report.verified.length} ` +
                `corrected=${result.report.corrected.length} ` +
                `unresolved=${result.report.unresolved.length}`,
              reason: `fact-check on ${args.target_agent} (${args.reason.slice(0, 200)})`,
            })
          } catch (logErr) {
            log.warn("fact_check: decision_log write failed (non-fatal)", {
              taskID: task.id,
              error: logErr instanceof Error ? logErr.message : String(logErr),
            })
          }
          return (
            `fact_check completed — verdict=\`${result.report.overall_verdict}\`\n\n` +
            renderFactCheckReport(result.report)
          )
        } catch (err) {
          // codex impl review §1: persist tool_error / aborted artifacts
          // too. Without this the `outcome` enum would be half-dead and
          // the orchestrator couldn't see that fact-check tried and
          // failed (vs never ran).
          //
          // codex impl review round 4 §findings-1: do NOT swallow persist
          // errors here. The happy/scope-mismatch paths let
          // recordFactCheckAttempt throw; the error-outcome path must
          // behave identically. A persist failure with a swallowed log
          // would return a "fact_check tool_error: …" string claiming
          // the artifact exists when it does not, poisoning read_context
          // / integrity replay (rule 7: no silent fallback).
          const outcome: "aborted" | "tool_error" = input.signal?.aborted ? "aborted" : "tool_error"
          const errMessage = err instanceof Error ? err.message : String(err)
          const synthetic = synthesizeToolErrorReport({
            snap,
            args,
            reason: `fact-check ${outcome}: ${errMessage}`,
          })
          recordFactCheckAttempt({
            taskID: task.id,
            // No child session id available — the run threw before
            // returning a session reference.  Mark explicitly so
            // listFactCheckAttempts consumers can distinguish.
            factCheckSessionID: `(no-session:${outcome})`,
            targetSessionID: args.target_session_id,
            targetAgent: args.target_agent,
            targetMessageID: snap.messageID,
            targetMessageContentHash: snap.contentHash,
            invokedByOrchestratorSessionID: input.agentSessionID,
            report: synthetic,
            timeStarted,
            outcome,
          })
          return `fact_check ${outcome}: ${errMessage}`
        }
      },
    }),

    // -----------------------------------------------------------------------
    // Analyze intent — request disambiguation for ambiguous tasks.
    //
    // Lifted out of an unused free-floating IntentAnalysisAgent.analyze
    // module (audit 2026-04-25). The agent runs at the very front of the
    // pipeline (before requirements / architect) to reconstruct the user's
    // real intent from a typically-terse request, the surrounding work
    // record (decision log + prior acceptance feedback when re-entering a
    // task), and a read-only tour of the repository.
    // -----------------------------------------------------------------------

    analyze_intent: tool({
      description:
        "OPTIONAL stage agent. Reconstruct the user's real intent from a (typically " +
        "terse) request. Reads the request, the existing work record on this task " +
        "(decision log, prior acceptance rejections, refine notes when present), and " +
        "uses read-only codebase tools (read/find/search/list) to ground complexity " +
        "and scope estimates in the repo's actual shape. Output: an " +
        "IntentAnalysisResult (intent class, complexity band, extracted slots, " +
        "missing-info keys, blocker / nice clarifications, overall confidence, " +
        "one-sentence summary).\n\n" +
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
          // frontend_design abort, both audit L7 + L3 same shape): write
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
        // Same pattern as frontend_design (rule 22, single source).
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
              : `Requirements and frontend_design are available candidate tools when the full task context needs them.`),
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

    frontend_research: tool({
      description:
        "OPTIONAL webpage/UI investigation publisher. Single-shot task-scope brief producer: dispatch once for the relevant webpage investigation scope, persist the brief, then send later repair/refinement through downstream agents that consume the brief. Do not use frontend_research as a repeated crawler, repair, retry, or implementation iteration tool after its frontend_research_brief exists. When source URLs are supplied, the host prepares rendered webpage evidence before the frontend-research session; the agent then partitions that evidence into source-backed work packets for page functions, visual layout, style checks, interactions, content/data inventory, responsive behavior, fidelity acceptance, and risks. It persists a frontend_research_brief/webpage_contract artifact built from small registration tools, not a giant terminal payload. It is NOT the frontend implementation template owner, NOT requirements, NOT architect, NOT build, NOT a route selector, and NOT final PRD/SPEC/report acceptance.",
      inputSchema: FrontendResearchInputSchema,
      execute: async ({ reason, source_urls, focus }) => {
        const task = requireTask(taskID)
        await trackStepStart("frontend_research")
        let runnerSessionID: string | undefined
        try {
          const { FrontendResearchAgent } = await import("@/frontend-research")
          const result = await FrontendResearchAgent.run({
            title: task.title,
            request: task.request,
            targetDeliverable: "implementation_input",
            sourceUrls: source_urls,
            focus,
            reason,
            taskID,
            parentSessionID: input.agentSessionID,
            signal: input.signal,
            onStatus: () => {},
            onSessionCreated: (id) => {
              runnerSessionID = id
            },
          })
          const artifactID = persistTaskFrontendResearchBrief({
            taskID,
            brief: result.brief,
          })
          await trackStepComplete("frontend_research")
          const blocking = result.brief.open_questions.filter((item) => item.blocking)
          const subpageTasks = result.brief.subpage_research_tasks
          const contract = result.brief.webpage_contract
          return SubAgentProtocol.yieldResult({
            headline: "Frontend research brief persisted as webpage investigation division.",
            summary: result.brief.summary,
            fields: [
              ["session", result.sessionID],
              ["artifact_id", artifactID],
              ["sources", String(result.brief.evidence_index.length)],
              ["facts", String(result.brief.facts.length)],
              ["webpage_contract", contract ? contract.source_url : "missing"],
              ["functional_surfaces", String(contract?.functional_surfaces.length ?? 0)],
              ["visual_layout", String(contract?.visual_layout.length ?? 0)],
              ["style_requirements", String(contract?.style_requirements.length ?? 0)],
              [
                "subpage_research_tasks",
                subpageTasks.map((item) => `${item.id}: ${item.url} | ${item.suggested_focus}`),
              ],
              ["blocking_open_questions", blocking.map((item) => `${item.id}: ${item.question}`)],
              ["bundle_paths", Object.values(result.brief.bundle)],
            ],
            pointer:
              `frontend_research_brief artifact ${artifactID}; downstream agents read it as webpage investigation work packets. ` +
              "This result is evidence only; choose the next tool from full task context.",
          })
        } catch (err) {
          try {
            await trackStepComplete("frontend_research", undefined, true)
          } catch (trackErr) {
            log.warn("frontend_research: trackStepComplete(failed) emit failed", {
              taskID,
              error: trackErr instanceof Error ? trackErr.message : String(trackErr),
            })
          }
          const msg = err instanceof Error ? err.message : String(err)
          if (runnerSessionID) {
            SessionStatus.set(runnerSessionID, { type: "terminal", reason: "error", error: msg })
          }
          log.error("frontend_research tool failed", { taskID, error: msg })
          return SubAgentProtocol.yieldResult({
            headline: "Frontend research failed before producing an artifact.",
            summary: msg,
            fields: [
              ["session", runnerSessionID ?? "not-created"],
              ["status", "failed"],
              ["source_urls", source_urls],
              ["focus", focus?.trim() ? focus : "none"],
              ["artifact_id", "none"],
            ],
            pointer: runnerSessionID
              ? `frontend-research session ${runnerSessionID}; inspect session error status for details`
              : "frontend_research failed before child session creation; inspect orchestrator logs and workflow step failure",
          })
        }
      },
    }),

    deep_research: tool({
      description:
        "OPTIONAL deep evidence side-tool agent. Use when the task depends on multi-source external facts, current documentation, competitor/industry/API research, source maps, or PRD/SPEC/report source material that should become a durable citation bundle. For supplied webpage URLs that need functional/visual frontend analysis, `frontend_research` is a separate candidate; for implementation-template/source handoff, `frontend_design` is a separate candidate. The result is a compact research_brief artifact plus bundle paths and may include subpage_research_tasks for independent follow-up deep research. It is NOT a workflow step, NOT a route selector, NOT requirements, NOT architect, NOT build, and NOT a acceptance path.",
      inputSchema: z.object({
        reason: z.string().min(1).describe("Why evidence research is needed for this task."),
        target_deliverable: z
          .enum(["prd", "spec", "research_report", "implementation_input", "mixed"])
          .optional()
          .describe("The likely document/input shape being researched."),
        source_urls: z
          .array(z.string().min(1))
          .default([])
          .describe("Known source URLs the research agent must webfetch before any broader discovery."),
        focus: z.string().optional().describe("Optional narrow focus for the research agent."),
      }),
      execute: async ({ reason, target_deliverable, source_urls, focus }) => {
        const task = requireTask(taskID)
        let runnerSessionID: string | undefined
        try {
          const { DeepResearchAgent } = await import("@/research")
          const result = await DeepResearchAgent.run({
            title: task.title,
            request: task.request,
            targetDeliverable: target_deliverable,
            sourceUrls: source_urls,
            focus,
            reason,
            taskID,
            parentSessionID: input.agentSessionID,
            signal: input.signal,
            onStatus: () => {},
            onSessionCreated: (id) => {
              runnerSessionID = id
            },
          })
          const artifactID = persistTaskResearchBrief({
            taskID,
            brief: result.brief,
          })
          const blocking = result.brief.open_questions.filter((item) => item.blocking)
          const subpageTasks = result.brief.subpage_research_tasks
          return SubAgentProtocol.yieldResult({
            headline: "Deep research brief persisted as advisory evidence.",
            summary: result.brief.summary,
            fields: [
              ["session", result.sessionID],
              ["artifact_id", artifactID],
              ["sources", String(result.brief.evidence_index.length)],
              ["facts", String(result.brief.facts.length)],
              [
                "subpage_research_tasks",
                subpageTasks.map((item) => `${item.id}: ${item.url} | ${item.suggested_focus}`),
              ],
              ["blocking_open_questions", blocking.map((item) => `${item.id}: ${item.question}`)],
              ["bundle_paths", Object.values(result.brief.bundle)],
            ],
            pointer:
              `research_brief artifact ${artifactID}; read_context scope=all surfaces stale status and bundle paths. ` +
              "This result is evidence only; choose the next tool from full task context.",
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (runnerSessionID) {
            SessionStatus.set(runnerSessionID, { type: "terminal", reason: "error", error: msg })
          }
          log.error("deep_research tool failed", { taskID, error: msg })
          throw err
        }
      },
    }),

    explore: tool({
      description:
        "Read-only repository investigation dispatcher. Runs the registered explore subagent as an explicit " +
        "orchestrator tool so workflow investigation does not get routed through build. Use this for focused " +
        "file, symbol, architecture, or dependency facts needed before requirements or implementation. The " +
        "result is returned to this orchestrator turn and persisted to phase=explore decision log plus an " +
        "exploration artifact for later wakes. Do not use for implementation or file edits.",
      inputSchema: z.object({
        question: z
          .string()
          .min(1)
          .describe("The focused repository question the explore subagent must answer with file/symbol evidence."),
        reason: z.string().optional().describe("Why this repository investigation is needed before the next stage."),
      }),
      execute: async ({ question, reason }) => {
        const task = requireTask(taskID)
        const model = await resolveAgentModelRef("explore", { taskID, sessionID: input.agentSessionID })
        const exploreSession = await Session.createNext({
          kind: "explore",
          parentID: input.agentSessionID,
          title: `Explore: ${question.slice(0, 80)}`,
          directory: Instance.directory,
        })
        const promptLines = [
          "# Repository Investigation",
          "",
          "You are the Explore subagent. Answer the focused repository question using read-only repository evidence.",
          "Do not modify files, run write-oriented commands, create reports on disk, or delegate to another agent.",
          "Return concrete findings as plain text in your final assistant turn — exact file paths, symbols, and tool evidence.",
          "Tool calls (memory.save and any other tool) are a side channel the orchestrator does NOT read back; only your last assistant turn's text is delivered.",
          "After your tools have returned, continuing tool-result echoes are the same task continuing — not new user requests, not system pings. Keep working until you have emitted your text answer, then stop.",
          "",
          `## Task`,
          task.title,
          "",
          renderUserRequestSection({ heading: "## Original Request", request: task.request, taskID }),
          "",
        ]
        if (reason && reason.trim().length > 0) {
          promptLines.push("## Reason", reason.trim(), "")
        }
        promptLines.push("## Question", question.trim())
        const prompt = promptLines.join("\n")

        let finalMessage: Awaited<ReturnType<typeof SessionPrompt.prompt>>
        try {
          finalMessage = await SessionPrompt.prompt({
            sessionID: exploreSession.id,
            model,
            agent: "explore",
            tools: {
              bash: false,
              edit: false,
              write: false,
              task: false,
              todowrite: false,
              todoread: false,
            },
            parts: [{ type: "text", text: prompt, id: Identifier.ascending("part") }],
          })
        } catch (err) {
          SessionStatus.set(exploreSession.id, {
            type: "terminal",
            reason: "error",
            error: err instanceof Error ? err.message : String(err),
          })
          throw err
        }
        SessionStatus.set(exploreSession.id, { type: "terminal", reason: "completed" })
        const resultText = (finalMessage?.parts ?? [])
          .filter((part) => part.type === "text" && typeof (part as any).text === "string")
          .map((part) => (part as any).text as string)
          .join("\n\n")
          .trim()
        if (resultText.length === 0) {
          throw new Error(`explore: subagent returned no text result (sessionID=${exploreSession.id})`)
        }

        const now = Date.now()
        const decisionLog = createDecisionLog(taskID)
        decisionLog.append({
          phase: "explore",
          key: `repo_investigation_${exploreSession.id}`,
          value: resultText,
          reason: reason?.trim() || question.trim(),
        })
        Database.use((db) => {
          db.insert(EngineArtifactTable)
            .values({
              id: Identifier.ascending("artifact"),
              task_id: taskID,
              kind: "exploration",
              label: "explore",
              payload: {
                question: question.trim(),
                reason: reason?.trim() || null,
                session_id: exploreSession.id,
                result: resultText,
              },
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        return SubAgentProtocol.yieldResult({
          headline: "Explore complete. Repository findings were persisted under phase=explore.",
          summary: resultText,
          fields: [
            ["session", exploreSession.id],
            ["question", question.trim()],
          ],
          pointer: `read_context scope=decisions; decision_log phase=explore key=repo_investigation_${exploreSession.id}`,
        })
      },
    }),

    // -----------------------------------------------------------------------
    // Per-goal tools — Orchestrator decides when to call each
    // -----------------------------------------------------------------------

    add_goal: tool({
      description:
        "Append one new executable goal to the current workflow graph when the latest operator message " +
        "or current task evidence adds a concrete in-scope surface that is not covered by any existing goal. " +
        "Use this instead of `modify_goal` when the work is a new capability/surface, and instead of " +
        "`architect` when the existing graph boundary is still valid and only one well-scoped goal is missing. " +
        "Do not use for broad re-decomposition, vague scope expansion, or follow-up work outside the current " +
        "task contract — use `architect`, `question`, or `propose_task` from evidence in those cases. " +
        "After this returns, dispatch `build({ goalID })` when dependencies are satisfied.",
      inputSchema: AddGoalInputSchema,
      execute: async ({ goal, reason }) => {
        const task = requireTask(taskID)
        if (isTaskTerminal(task)) {
          return (
            `add_goal: rejected because task ${taskID} is ${deriveTaskStatus(task)}. ` +
            `A terminal task must first be reactivated by a real operator message or explicit retry/restart.`
          )
        }
        if (task.kind !== "workflow") {
          return `add_goal: rejected because task ${taskID} is kind=${task.kind}; direct build tasks do not own a workflow goal graph.`
        }
        const activeSpec = findActiveSpecForTask(taskID)
        if (!activeSpec) {
          return "add_goal: no active requirements/architect spec snapshot. Run requirements and architect before appending goals."
        }
        const activePlan = findActivePlanForTask(taskID)
        const knownGoalIDs = new Set(listGoals(taskID).map((row) => row.id))
        const unknownDeps = (goal.depends_on ?? []).filter((dep) => !knownGoalIDs.has(dep))
        if (unknownDeps.length > 0) {
          return (
            `add_goal: rejected because depends_on references unknown goal id(s): ${unknownDeps.join(", ")}. ` +
            `Use durable engine_goal.id values from read_context scope=goals.`
          )
        }

        const now = Date.now()
        const durableGoalID = Identifier.ascending("goal")
        const added = Database.transaction((db) =>
          appendGoalToActiveGraph(db, {
            taskID,
            specSnapshotID: activeSpec.id,
            planVersionID: activePlan?.id ?? null,
            goal: {
              goalID: durableGoalID,
              title: goal.title,
              objective: goal.objective,
              acceptance_specs: (goal.acceptance_specs as AcceptanceSpec[]).map((spec) => ({
                ...spec,
                goal_id: durableGoalID,
              })),
              owned_paths: goal.owned_paths,
              depends_on: goal.depends_on,
              kind: goal.kind,
              requirement_ids: goal.requirement_ids,
              priority: goal.priority,
              source: "system",
              metadata: {
                add_goal_reason: reason,
                operator_instruction_goal: true,
              },
            },
            now,
          }),
        )

        createDecisionLog(taskID).append({
          phase: "orchestrator",
          key: `added_goal_${added.id}`,
          value:
            `Added goal ${added.id}: ${goal.title}\n\n` +
            `Reason: ${reason}\n\n` +
            `Objective: ${goal.objective}\n\n` +
            `Dependencies: ${(goal.depends_on ?? []).join(", ") || "(none)"}`,
          reason: "add_goal",
        })
        EngineProtocol.emit(
          EngineEvent.TaskUpdated,
          {
            taskID,
            status: deriveTaskStatus(requireTask(taskID)),
            summary: `Goal ${added.id} added by Orchestrator`,
          },
          { source: "orchestrator.add_goal" },
        )

        return SubAgentProtocol.yieldResult({
          headline: `Goal added: ${added.id} ${goal.title}`,
          fields: [
            ["goal_id", added.id],
            ["order", `G${added.orderIndex + 1}`],
            ["spec_snapshot_id", activeSpec.id],
            ["plan_version_id", activePlan?.id ?? "(no active plan yet)"],
            ["plan_node_id", added.planNodeID ?? "(no active plan node yet)"],
            ["depends_on", (goal.depends_on ?? []).join(", ") || "(none)"],
          ],
          pointer: `read_context scope=goals; then build({ goalID: "${added.id}" }) when dependencies are passed`,
        })
      },
    }),

    modify_goal: tool({
      description:
        "Modify an existing goal's contract only to clarify or tighten acceptance for a surface already owned " +
        "by that goal. Use when eval or integrity history shows acceptance_specs need refinement, or owned_paths " +
        "need adjustment, without adding a new capability, new surface, or broader task scope. Scope expansion " +
        "must route through propose_task or question instead. The submitted shape is schema-validated before execution.",
      inputSchema: ModifyGoalInputSchema,
      execute: async (input) => {
        if (!isObjectRecord(input) || typeof input.goalID !== "string" || input.goalID.trim().length === 0) {
          return 'Error: modify_goal requires a non-empty string "goalID"; database unchanged.'
        }
        const goalID = input.goalID
        const updates = input.updates
        requireTask(taskID)
        const dbGoals = listGoals(taskID)
        const goal = dbGoals.find((g) => g.id === goalID)
        if (!goal) return `Goal ${goalID} not found.`
        const liveOwner = findLiveBuildOwnershipByGoal({ taskID, goalID })
        if (liveOwner) {
          return (
            `Error: modify_goal refused because goal ${goalID} is currently owned by live build tool ` +
            `${liveOwner.payload.tool_part_id} (session ${liveOwner.payload.child_session_id}, ownership ${liveOwner.ownershipID}). ` +
            `Wait for that build result before changing the goal contract.`
          )
        }

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
        "Query all currently failed goals with their latest acceptance info. Returns one block per failed goal (acceptance_specs truncated, only latest run). Use BEFORE re-running build on a failed goal to understand per-goal failure reasons.",
      inputSchema: z.object({}),
      execute: async () => {
        const dbGoals = listGoals(taskID)
        const failed = dbGoals.filter((g) => goalStatusByID(g.id) === "failed")
        if (failed.length === 0) return "No failed goals."
        const { listGoalRunsForTask, findAcceptanceByGoalRun } = await import("@/engine/store")
        const goalRuns = listGoalRunsForTask(taskID)
        const sections: string[] = [`## Failed Goals (${failed.length})`]
        const ACCEPTANCE_SPEC_CAP = 300
        const ACCEPTANCE_FILES_CAP = 10
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
            const acceptance = findAcceptanceByGoalRun(latestGr.id)
            if (acceptance) {
              sections.push(`- acceptance summary: ${acceptance.summary}`)
              const diffs = (acceptance.result as any)?.diffs as Array<{ file: string }> | undefined
              if (diffs?.length) {
                const shown = diffs
                  .slice(0, ACCEPTANCE_FILES_CAP)
                  .map((f) => f.file)
                  .join(", ")
                const more =
                  diffs.length > ACCEPTANCE_FILES_CAP ? ` (+${diffs.length - ACCEPTANCE_FILES_CAP} more)` : ""
                sections.push(`- acceptance files: ${shown}${more}`)
              }
            } else {
              sections.push(`- acceptance: none`)
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
                  `- terminal report hint: retry this goal with explicit report_build_result(files_changed[]) instructions. ` +
                    `Any retained files under .opencorvus/runtime are diagnostic worktree evidence, not primary workspace pollution; ` +
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
        "Read current task context: goal states, acceptance verdicts, Decision Log, acceptance summaries, integrity attempts, and integrity root history. Use this to gather information before making decisions. Goal/eval/acceptance sections return latest state; integrity_history renders fact-only cross-round integrity attempt history for the spec snapshot lineage.",
      inputSchema: z.object({
        scope: z
          .enum(["goals", "evaluations", "decisions", "deliveries", "integrity_history", "all"])
          .default("all")
          .describe("What to read"),
      }),
      execute: async ({ scope }) => {
        const task = requireTask(taskID)
        const sections: string[] = []
        const autoIteration = (await EngineConfig.get()).auto_iteration === true
        // Source-level caps on read_context output. Rationale: this tool is
        // called every orchestrator turn; tool results live forever in session
        // history. Unbounded accumulation (every historical eval, every run's
        // acceptance, every decision) was the dominant contributor to the
        // orchestrator session growing from ~10K to 125K tokens across 16 turns.
        // Caps below preserve the LATEST state per goal rather than history.
        // The decision-log cap is the shared DECISION_LOG_PROMPT_LIMIT (single
        // source — see decision-log/index.ts), consumed at the call site below.
        const EVAL_CHECK_EVIDENCE_CAP = 200

        if (scope === "goals" || scope === "all") {
          const desc = await describeTask(taskID)
          const closureLines = renderCollaborationClosure(desc.collaboration_closure, desc.goals, { autoIteration })
          if (closureLines.length > 0) {
            sections.push(closureLines.join("\n"))
          }
          const goals = listGoals(taskID)
          sections.push(`## Goals (${goals.length})`)
          for (const g of goals) {
            const label = `#G${g.order_index + 1}V${getGoalRetryCount(g.id) + 1}`
            sections.push(`- [${goalStatusByID(g.id)}] ${label} ${g.id}: ${g.title} [${g.priority}]`)
            sections.push(`  objective: ${g.objective.slice(0, 200)}`)
            sections.push(`  requirement_ids: ${(g.requirement_ids ?? []).join(", ") || "(none)"}`)
            sections.push(
              `  acceptance_specs:\n${renderSpecsAsText((g.acceptance_specs ?? []) as AcceptanceSpec[]).slice(0, 400)}`,
            )
            const latestGoalRun = findLatestTipGoalRun(g.id)
            if (latestGoalRun) {
              sections.push(`  latest_goal_run_id: ${latestGoalRun.id}`)
              sections.push(`  latest_goal_run_status: ${latestGoalRun.status}`)
              if (latestGoalRun.session_id) {
                sections.push(`  latest_goal_session_id: ${latestGoalRun.session_id}`)
              }
            }
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

        if (scope === "evaluations" || scope === "integrity_history" || scope === "all") {
          const activeSpec = findActiveSpecForTask(taskID)
          const { buildSpecSnapshotLineage, buildIntegrityRootHistory, renderIntegrityRootHistoryBlock } = await import(
            "@/integrity"
          )
          const { findLatestIntegrityArtifactMissingStatus } = await import("@/engine/store")
          const missingStatus = findLatestIntegrityArtifactMissingStatus(taskID)
          if (missingStatus) {
            sections.push(
              `\n## Integrity artifact status`,
              `- session: ${missingStatus.sessionID}`,
              `- status: artifact_missing`,
              `- recorded_at: ${new Date(missingStatus.emittedAt).toISOString()}`,
              `- detail: the completed integrity session has no durable integrity_attempt artifact yet; the prior artifact is not the current result.`,
              missingStatus.error ? `- error: ${missingStatus.error}` : "",
            )
          }
          if (activeSpec) {
            const lineage = buildSpecSnapshotLineage({
              taskID,
              activeSpecSnapshotID: activeSpec.id,
            })
            const history = buildIntegrityRootHistory({
              taskID,
              specSnapshotLineage: lineage,
            })
            if (history.totalAttempts > 0) {
              const latest = history.attempts.at(-1)
              if (scope === "all" && latest) {
                const teamReportMarkdown = latest.teamReportMarkdown ?? ""
                sections.push(
                  `\n## Integrity (latest)`,
                  `- verdict: ${latest.verdict ?? "unknown"} — issues=${latest.blockingFindings.length} corrections=${latest.requiredRepairs.length} missing=${latest.unresolvedDisagreements.length} (spec snapshot lineage)`,
                )
                if (teamReportMarkdown) sections.push("", teamReportMarkdown)
              }
              sections.push(`\n${renderIntegrityRootHistoryBlock(history)}`)
            }
          }
        }

        if (scope === "decisions" || scope === "all") {
          const { createDecisionLog, DECISION_LOG_PROMPT_LIMIT } = await import("@/decision-log")
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
            limit: DECISION_LOG_PROMPT_LIMIT,
            excludePhases: ["review"],
          })
          if (section) sections.push(`\n${section}`)
        }

        if (scope === "all") {
          await appendResearchBriefContext(
            sections,
            "Deep Research Brief",
            findLatestResearchBriefArtifact(taskID),
            task.request,
          )
          await appendResearchBriefContext(
            sections,
            "Frontend Research Brief",
            findLatestFrontendResearchBriefArtifact(taskID),
            task.request,
          )

          // Fact-check attempts (one-line per row) — specs/fact-check-agent-2026-05-25.md
          // §6.1.2 step 7. Integrity replay reads this same artifact stream
          // via listFactCheckAttempts; surfacing summaries in read_context
          // gives the orchestrator LLM a quick "what was already verified"
          // view without re-dispatching fact_check.  Bounded: latest 5 per
          // task to mirror the review-history cap.
          const { listFactCheckAttempts } = await import("@/fact-check/persist")
          const fcRows = listFactCheckAttempts(taskID)
          if (fcRows.length > 0) {
            const latest = fcRows.slice(0, 5)
            const omitted = fcRows.length - latest.length
            const header =
              omitted > 0
                ? `\n## Fact-check attempts (latest ${latest.length} of ${fcRows.length}; ${omitted} older omitted)`
                : `\n## Fact-check attempts (${latest.length})`
            sections.push(header)
            for (const row of latest) {
              const r = row.payload.report
              sections.push(
                `- [${r.overall_verdict}] target=\`${row.payload.target_agent}\` ` +
                  `session=\`${row.payload.target_session_id.slice(0, 16)}…\` ` +
                  `verified=${r.verified.length} corrected=${r.corrected.length} ` +
                  `unresolved=${r.unresolved.length} ` +
                  `(${row.payload.outcome})`,
              )
            }
          }
        }

        if (scope === "deliveries" || scope === "all") {
          const { listGoalRunsForTask, findAcceptanceByGoalRun } = await import("@/engine/store")
          const goalRuns = listGoalRunsForTask(taskID) // desc by time_created
          // Keep only the latest acceptance per goal. Previous runs' deliveries
          // are historical noise once superseded; the orchestrator decides from
          // current state, not acceptance history.
          const seenGoals = new Set<string>()
          const deliveries: Array<{
            goalRunID: string
            goalID: string
            status: string
            acceptance: ReturnType<typeof findAcceptanceByGoalRun>
          }> = []
          for (const gr of goalRuns) {
            if (seenGoals.has(gr.goal_id)) continue
            const acceptance = findAcceptanceByGoalRun(gr.id)
            if (!acceptance) continue
            seenGoals.add(gr.goal_id)
            deliveries.push({ goalRunID: gr.id, goalID: gr.goal_id, status: gr.status, acceptance })
          }
          if (deliveries.length > 0) {
            sections.push(`\n## Deliveries (${deliveries.length} — latest per goal)`)
            for (const d of deliveries) {
              const diffs = (d.acceptance!.result as any)?.diffs as Array<{ file: string }> | undefined
              sections.push(`- goal_run ${d.goalRunID} [${d.status}]: ${d.acceptance!.summary}`)
              if (diffs?.length) sections.push(`  files: ${diffs.map((f) => f.file).join(", ")}`)
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
      description:
        "Terminal task lifecycle decision: mark the task as failed when no responsible same-task repair remains for evidence the orchestrator can see. " +
        "Typical triggers: (a) integrity history shows >= 3 consecutive rounds with the same persistent blocking root AND modify_goal / architect / question have already been tried inside this task for the same root; " +
        "(b) a hard external blocker the repository cannot supply, such as missing credentials the user already declined to provide or unavailable hardware. " +
        "Not for: a single non-pass integrity round, a transient build error, or a guess that the task is hopeless without integrity evidence. " +
        "Pair with a concrete history excerpt in the error field, including the persistent-root label from read_context Integrity history.",
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
        const { interruptTaskLoop } = await import("@/orchestrator/loop")
        interruptTaskLoop(taskID, "task failed")
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
        "Read the latest already-recorded operator message for this orchestrator wake. This does not create another task message and does not resume a child executor/build session; use build({ goalID, request }) for build retry/continuation.",
      inputSchema: z.object({
        reason: z.string().describe("Why this operator message should be injected into the current execution"),
      }),
      execute: async ({ reason }) => {
        const message = input.operatorMessage
        if (!message) {
          return "No operator message is available on this trigger."
        }
        const latest = message.text.trim()
        if (!latest) {
          return "No operator message is available on this trigger."
        }
        const lines = [
          `Operator message is already recorded on the task root session. Reason: ${reason}.`,
          message.source ? `source=${message.source}` : "",
          message.messageID ? `messageID=${message.messageID}` : "",
          message.target
            ? `target=${JSON.stringify({
                kind: message.target.kind,
                sessionID: message.target.sessionID,
                ...(message.target.goalID ? { goalID: message.target.goalID } : {}),
              })}`
            : "",
          "",
          latest,
          message.attachmentSummary ? `\n${message.attachmentSummary}` : "",
        ].filter((line) => line.length > 0)
        return lines.join("\n")
      },
    }),

    steer_subagent: tool({
      description:
        "Send a scoped steering message to a child agent session and wake that session, OR — for a live-owned build child — return a read-only activity snapshot (status, last_activity_at, age_ms, ownership). " +
        "Build sessions cannot accept injected steering; the snapshot lets you decide between waiting and cancel_subagent mode='recover_stale'. " +
        "You may pass session_id directly, goal_id for the latest live attempt, or a live goal_run_id via session_id for backward compatibility.",
      inputSchema: z
        .object({
          session_id: z
            .string()
            .min(1)
            .optional()
            .describe(
              "Child agent session id to steer. Backward-compatible: also accepts the live goal_run_id reported by read_context.",
            ),
          goal_id: z
            .string()
            .min(1)
            .optional()
            .describe("Goal id to steer. Host resolves it to the latest live goal_run and child session."),
          message: z.string().min(1).describe("Natural-language steering/status-check message for that sub-agent"),
          reason: z.string().describe("Why this sub-agent must be contacted before retrying"),
        })
        .refine((value) => !!value.session_id || !!value.goal_id, {
          message: "steer_subagent requires either session_id or goal_id",
          path: ["session_id"],
        }),
      execute: async ({ session_id, goal_id, message, reason }) => {
        const target = resolveSteerTarget({
          taskID,
          sessionID: session_id,
          goalID: goal_id,
        })
        const { kind } = assertDirectReplySessionOwnership({
          taskID,
          sessionID: target.sessionID,
        })
        if (kind === "build") {
          const liveOwner =
            (target.goalRunID ? findLiveBuildOwnershipByGoalRun({ taskID, goalRunID: target.goalRunID }) : undefined) ??
            findLiveBuildOwnershipBySession({ taskID, sessionID: target.sessionID })
          if (liveOwner) {
            const status = SessionStatus.get(target.sessionID)
            const activity = SessionStatus.getActivity(target.sessionID)
            const lastActivityAt = activity?.last_activity_at
            const ageMs = typeof lastActivityAt === "number" ? Math.max(0, Date.now() - lastActivityAt) : "n/a"
            return [
              `Activity snapshot for live-owned build child session ${target.sessionID}:`,
              `  child_session_id=${target.sessionID}`,
              `  status=${status.type}`,
              `  last_activity_at=${lastActivityAt ?? "n/a"}`,
              `  age_ms=${ageMs}`,
              `  owner_tool_part=${liveOwner.payload.tool_part_id}`,
              `  owner_ownership=${liveOwner.ownershipID}`,
              `  goal_run=${target.goalRunID ?? liveOwner.payload.goal_run_id ?? "n/a"}`,
              `Reason recorded: ${reason}`,
              'Note: build sessions cannot accept injected steering messages. To act on this snapshot, either keep waiting, or if age_ms is large AND status indicates no progress, call cancel_subagent with mode="recover_stale".',
            ].join("\n")
          }
          return (
            `Error: steer_subagent cannot generically steer build session ${target.sessionID}.` +
            " Use build({ goalID, request }) for a fresh stage-attempt runtime contract instead." +
            ` Reason received: ${reason}`
          )
        }
        // The reply route turns these conditions into NamedError that
        // ApiError would surface as 4xx/410 to overlay. Inside the
        // orchestrator's own tool call the same errors throw as
        // execution errors and the AI SDK would relay them as opaque
        // tool failures — denying the model the actionable guidance
        // the build-kind branch above already gives. Catch the named
        // subclasses we know about and return human-readable next-step
        // text instead, matching the build-kind branch's contract.
        // codex review round 2 — minor.
        try {
          const result = await EngineService.replyAgentSession(taskID, target.sessionID, { message })
          return `Steered sub-agent session ${result.session_id}. source=${target.source}. message=${result.message_id}. Reason: ${reason}`
        } catch (err) {
          if (BuildSessionDirectReplyError.isInstance(err)) {
            return (
              `Error: steer_subagent refused to inject into session ${target.sessionID}: ${err.data.message}` +
              ` Use build({ goalID, request }) for a fresh stage-attempt runtime contract instead.` +
              ` Reason received: ${reason}`
            )
          }
          if (SessionRuntimeContractMissingError.isInstance(err)) {
            return (
              `Error: steer_subagent could not reach session ${target.sessionID} — ${err.data.message}` +
              ` The session's in-memory runtime contract is no longer present (reason=${err.data.reason}).` +
              ` Re-dispatch the parent goal/stage to reinstate the runtime contract before attempting to steer again.` +
              ` Reason received: ${reason}`
            )
          }
          if (ReplyTargetEnvelopeMissingError.isInstance(err)) {
            return (
              `Error: steer_subagent could not reach session ${target.sessionID} — ${err.data.message}` +
              ` Wait for the agent to issue its first turn before attempting to steer it.` +
              ` Reason received: ${reason}`
            )
          }
          if (InvalidReplyTargetKindError.isInstance(err)) {
            return (
              `Error: steer_subagent refused session ${target.sessionID}: ${err.data.message}` +
              ` Reason received: ${reason}`
            )
          }
          throw err
        }
      },
    }),

    cancel_subagent: tool({
      description:
        "Abort a specific child agent session, or recover a stale live-owned build via mode='recover_stale'. " +
        "This is the session-level resume rung: cancel the child, then explicitly re-dispatch the SAME goal or stage under the SAME contract before escalating to modify_goal or restart_from_stage. " +
        "You may pass session_id directly, goal_id for the latest live attempt, goal_run_id, or a live goal_run_id via session_id for backward compatibility.",
      inputSchema: z
        .object({
          session_id: z
            .string()
            .min(1)
            .optional()
            .describe(
              "Child agent session id to cancel. Backward-compatible: also accepts the live goal_run_id reported by read_context.",
            ),
          goal_id: z
            .string()
            .min(1)
            .optional()
            .describe("Goal id whose latest live child session should be cancelled."),
          goal_run_id: z
            .string()
            .min(1)
            .optional()
            .describe("Live goal_run id whose child session should be cancelled."),
          mode: z
            .enum(["cancel", "recover_stale"])
            .optional()
            .describe(
              "Use 'cancel' for explicit cancellation. Use 'recover_stale' only when evidence shows a live-owned build is no longer executing; this refuses streaming/retry sessions.",
            ),
          reason: z
            .string()
            .describe("Why this child session must be cancelled before re-dispatching the same stage/goal"),
        })
        .refine((value) => !!value.session_id || !!value.goal_id || !!value.goal_run_id, {
          message: "cancel_subagent requires session_id, goal_id, or goal_run_id",
          path: ["session_id"],
        }),
      execute: async ({ session_id, goal_id, goal_run_id, mode, reason }) => {
        const target = resolveSteerTarget({
          taskID,
          sessionID: goal_run_id ?? session_id,
          goalID: goal_id,
        })
        const { kind } = assertDirectReplySessionOwnership({
          taskID,
          sessionID: target.sessionID,
        })

        const liveOwner =
          (target.goalRunID ? findLiveBuildOwnershipByGoalRun({ taskID, goalRunID: target.goalRunID }) : undefined) ??
          findLiveBuildOwnershipBySession({ taskID, sessionID: target.sessionID })
        const staleRecovery = mode === "recover_stale"
        if (staleRecovery && kind !== "build") {
          return `Error: cancel_subagent mode='recover_stale' only handles build sessions; ${target.sessionID} has kind=${kind}.`
        }
        if (staleRecovery && kind === "build" && !liveOwner) {
          return `No live build ownership found for ${target.source}; nothing to recover.`
        }
        if (kind === "build" && liveOwner) {
          if (staleRecovery) {
            const currentStatus = SessionStatus.get(target.sessionID)
            if (currentStatus.type === "streaming" || currentStatus.type === "retry") {
              return (
                `Error: cancel_subagent refused stale recovery because build session ${target.sessionID} is ${currentStatus.type}. ` +
                "Wait for it to settle or use mode='cancel' for explicit operator cancellation."
              )
            }
          }
          const goalFact = await cancelLiveOwnedBuild({
            taskID,
            sessionID: target.sessionID,
            goalRunID: target.goalRunID,
            owner: liveOwner,
            reason,
            originSite: staleRecovery
              ? "orchestrator.tools.cancel-subagent-stale-recovery"
              : "orchestrator.tools.cancel-subagent-live-build",
            metadata: staleRecovery ? { stale_recovery: true } : { cancelled_live_build: true },
          })
          return (
            `${staleRecovery ? "Recovered stale live-owned build" : "Cancelled live-owned build session"} ${target.sessionID} (kind=${kind}). ` +
            `source=${target.source}. ownership=${liveOwner.ownershipID}. Reason: ${reason}.` +
            goalFact +
            " If you still need work from it, re-dispatch the same stage/goal under the same contract explicitly."
          )
        }

        const aborted = target.goalRunID
          ? await abortGoalRunExecution({
              taskID,
              goalRunID: target.goalRunID,
              reason: `cancel_subagent: ${reason}`,
            })
          : await abortChildExecutionForSession({
              taskID,
              sessionID: target.sessionID,
              reason: `cancel_subagent: ${reason}`,
            })
        const abortedFact =
          aborted.goalRunAborted || aborted.executorAbortAttempted
            ? ` goal_run ${target.goalRunID ?? "(unknown)"} ${aborted.goalRunAborted ? "aborted" : "unchanged"}` +
              `${aborted.executorAbortAttempted ? `; executor_abort=${aborted.executorAbortSucceeded ? "ok" : "failed"}` : ""}.`
            : ""

        return (
          `Cancelled sub-agent session ${target.sessionID} (kind=${kind}). ` +
          `source=${target.source}. Reason: ${reason}.` +
          `${abortedFact} If you still need work from it, re-dispatch the same stage/goal under the same contract explicitly.`
        )
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

        // Gather acceptance context
        const goals = listGoals(taskID)
        const { listGoalRunsForTask, findAcceptanceByGoalRun } = await import("@/engine/store")
        const goalRuns = listGoalRunsForTask(taskID)

        const goalSummaries: string[] = []
        const allChangedFiles: string[] = []
        for (const goal of goals) {
          const gr = goalRuns.find((r) => r.goal_id === goal.id)
          const acceptance = gr ? findAcceptanceByGoalRun(gr.id) : undefined
          const files = (acceptance?.result as any)?.diffs?.map((d: any) => d.file) ?? []
          allChangedFiles.push(...files)
          goalSummaries.push(
            `- [${goalStatusByID(goal.id)}] ${goal.title}: ${renderSpecsAsText((goal.acceptance_specs ?? []) as AcceptanceSpec[]).slice(0, 300)}`,
          )
          if (files.length > 0) goalSummaries.push(`  files: ${files.join(", ")}`)
        }

        // Read Decision Log for architectural context. Refine runs once per
        // task (not per turn), but an unbounded decision log can still push
        // this prompt past the model context; cap is the shared
        // DECISION_LOG_PROMPT_LIMIT (single source — previously a divergent
        // literal 30, a rule-8 double-source). Refine is a rework step, so it
        // intentionally keeps `phase:"review"` — prior verdicts are its repair
        // signal, unlike the integrity reviewer which must stay independent.
        const { createDecisionLog, DECISION_LOG_PROMPT_LIMIT } = await import("@/decision-log")
        const decisionLog = createDecisionLog(taskID)
        const decisionSection = decisionLog.toPromptSection({ limit: DECISION_LOG_PROMPT_LIMIT }) ?? ""

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
        const RefineResultSchema = z.object({
          summary: z.string(),
          suggestions: z.array(
            z.object({
              category: z.enum(["feature", "quality", "test", "performance", "refactor"]),
              title: z.string(),
              description: z.string(),
              priority: z.enum(["high", "medium", "low"]),
              effort: z.enum(["small", "medium", "large"]),
            }),
          ),
        })

        const systemPrompt = [
          "You are a project analyst reviewing a completed software project.",
          "Analyze the delivered code and suggest concrete improvements for the next iteration.",
          "Use the required StructuredOutput schema for the final assessment and suggestions.",
          "",
          `Focus: ${focus}`,
          "Respond in the same language as the original task request.",
        ].join("\n")

        const userPrompt = [
          `## Original Task`,
          renderUserRequestSection({ heading: "## Original Task Request", request: task.request, taskID }),
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
            format: {
              type: "json_schema",
              schema: z.toJSONSchema(RefineResultSchema) as Record<string, any>,
              retryCount: 1,
            },
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
        const parsed =
          finalMessage.info.role === "assistant" && finalMessage.info.structured
            ? RefineResultSchema.safeParse(finalMessage.info.structured)
            : { success: false as const, error: new Error("refine session ended without StructuredOutput") }
        if (!parsed.success) {
          const error = parsed.error instanceof z.ZodError ? z.prettifyError(parsed.error) : parsed.error.message
          SessionStatus.set(refineSession.id, { type: "terminal", reason: "error", error })
          throw new Error(`refine: LLM did not return schema-valid StructuredOutput. ${error}`)
        }

        await trackStepComplete("refine")
        SessionStatus.set(refineSession.id, { type: "terminal", reason: "completed" })

        const suggestions = parsed.data.suggestions
        const summaryRaw = parsed.data.summary
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
        "Create one polished inheriting follow-up task candidate that improves or completes the current/previous request. " +
        "This is the orchestrator's ONLY new-engine-task creation path: it follows `experimental.confirm_proposed_tasks`, " +
        "creating directly by default and asking the user first only when that policy is enabled. Do not use this for normal workflow progress, do not use it " +
        "instead of build/integrity on the current task, and do not call generic `task` or control-plane `panel`. " +
        "Create at most one follow-up task per orchestrator turn; wait for the created task to be recorded and for a later wake before proposing another. " +
        "Use propose_task when execution evidence, artifact state, integrity history, or the obvious product path shows separate inheriting work: supplemental features, deeper implementation detail, quality hardening, tests, docs, operations, performance, or project-improvement suggestions. " +
        "It is also the right path when reviewers keep demanding a capability the original user request never authorised, and adding it inside the current task would expand scope beyond what the user agreed to.",
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
          .describe(
            "Evidence-backed reason this should inherit from the current task as separate follow-up work instead of changing the current task.",
          ),
        priority: z.enum(["critical", "high", "normal", "low"]).default("normal"),
        queue: z
          .boolean()
          .default(false)
          .describe(
            "Set true when this follow-up task should wait in the directory queue; set false when it should start immediately and bypass the directory queue.",
          ),
        kind: z.enum(["workflow", "build"]).default("workflow"),
      }),
      execute: async ({ title, request, reason, priority, queue, kind }) => {
        const task = requireTask(taskID)
        const cfg = await EffectiveConfig.effective({ taskID, sessionID: input.agentSessionID })
        const requireConfirmation = cfg.experimental?.confirm_proposed_tasks === true
        log.info("propose_task requested", { taskID, title, priority, kind, requireConfirmation })
        if (requireConfirmation) {
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
        }
        const requestID =
          "orchestrator-proposed-task:" +
          taskID +
          ":" +
          createHash("sha256").update(`${title}\0${request}`).digest("hex").slice(0, 16)
        const inheritedModel = await resolveConfiguredModelRef({ taskID, sessionID: input.agentSessionID })
        const newTaskID = await EngineService.createTask({
          requestID,
          title,
          request,
          priority,
          queue,
          kind,
          executor: task.executor,
          model: `${inheritedModel.providerID}/${inheritedModel.modelID}`,
          source: "orchestrator:propose_task",
          metadata: {
            origin: "orchestrator_proposed_task",
            parent_task_id: taskID,
            inheritance: "orchestrator_follow_up",
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
          headline: requireConfirmation
            ? "Follow-up task created after user confirmation."
            : "Follow-up task created without user confirmation.",
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
        "concrete guidance for the next attempt - the goal contract (objective / acceptance_specs / " +
        "owned_paths) is preserved untouched and your `request` is rendered as a separate " +
        "'Retry Guidance From Orchestrator' section ahead of historical retry feedback, so filling it " +
        "never costs you any architect-committed contract. For a context-wedged per-goal retry, set " +
        "`freshContext: true` to start a new build session; restate every useful prior lesson in `request` " +
        "because the new session will not inherit old reasoning or tool calls. `build({ request, directBuildIntent })` without goalID is a task-level " +
        "direct implementation build. It is supported for explicit `kind=build` tasks, whole-task rework after " +
        "acceptance rejection, and rare operator/orchestrator decisions to bypass goal decomposition for a scoped " +
        "workflow implementation task. It also owns same-task stuck-state repairs that require file edits: " +
        "dependency materialization, package metadata/scripts, local dependency wiring, Playwright/browser " +
        "configuration, dynamic port selection, runtime/tool configuration, product fixes proven by verification, " +
        "and unfinished MERGING state inside a goal worktree. It is not a repository investigation tool. For " +
        "fresh `kind=workflow` tasks, requirements → architect → per-goal build remains the recommended path " +
        "when the request needs durable requirements, goal contracts, or decomposition. Fresh workflow direct " +
        "builds must declare directBuildIntent='modify_files' for scoped implementation. Repository investigation " +
        "belongs to analyze_intent, requirements, or the registered explore subagent surface; do not route that work " +
        "through build. " +
        "After build returns, read the build report and current goal/run state. Build does NOT auto-complete " +
        "workflow tasks. The final workflow gate is `integrity`, and it is valid only after all blocking builds " +
        "are terminal. Non-pass integrity returns session-bound review evidence to this same reasoning turn; " +
        "choose the next action from that evidence. If read_context surfaces integrity status=artifact_missing, " +
        "recover that artifact or get explicit user confirmation before continuing from stale integrity data. " +
        "DO NOT USE FOR: multi-file features, UI replication from designs, anything with explicit acceptance " +
        "criteria, cross-module refactors, new subsystems — those go through requirements → architect → " +
        "per-goal build → integrity (the pipeline workflow). Frontend evidence tools are available candidates " +
        "when the full task context needs visual/reference material for build dispatch.",
      inputSchema: z.object({
        request: z
          .string()
          .optional()
          .describe(
            "For per-goal builds: optional retry/rework guidance for THIS attempt, rendered as a separate 'Retry Guidance From Orchestrator' section in the build prompt. Does NOT replace the goal's objective / acceptance_specs / owned_paths — populate freely whenever you have concrete advice for the next attempt, including dependency materialization, worktree MERGING resolution, package/script/toolchain fixes, port selection, or product behavior fixes proven by verification. For task-level direct builds (no goalID): required; include the user's request plus concise rejected acceptance details the build agent must address.",
          ),
        reason: z
          .string()
          .describe(
            "One sentence explaining why this build is valid now: explicit kind=build, per-goal pipeline execution, post-acceptance whole-task rework, or a conscious direct-build decision for this workflow task.",
          ),
        goalID: z
          .string()
          .optional()
          .describe(
            "Optional goal id this build is scoped to. Set when build is invoked as a per-goal worker inside the pipeline workflow. Omit for task-level direct builds.",
          ),
        directBuildIntent: z
          .literal("modify_files")
          .optional()
          .describe(
            "Required for task-level direct builds on kind=workflow tasks. The only valid direct intent is modify_files: a scoped implementation/rework build. Build is not a repository investigation endpoint.",
          ),
        freshContext: z
          .boolean()
          .optional()
          .describe(
            "Optional escape hatch for context-wedged per-goal retries. When true AND `goalID` is set, " +
              "skip the prior goal_run.session_id reuse and dispatch this build into a brand-new build session " +
              "with zero accumulated context. Use ONLY after a same-context retry approach is demonstrably " +
              "stuck - typical evidence: (a) the goal has already failed >=2 times on this contract with the " +
              "same root error class and `read_context` shows the build session near or over its context cap; " +
              "(b) `compaction` returned `nothing-to-compress` or `post-compaction-still-over`; (c) the prior " +
              "session_id is unrecoverable (deletion / DB lineage gap). Burns the prior session's reasoning " +
              "history - the goal contract (objective / acceptance_specs / owned_paths) is preserved by the " +
              "engine_goal row, and you MUST restate every concrete lesson the prior attempts produced inside " +
              "`request`, because the new session will not see them. Has no effect on task-level direct builds " +
              "(no goalID); the host ignores it in that path.",
          ),
        userConfirmedStaleIntegrityData: z
          .boolean()
          .optional()
          .describe(
            "Set true only after the user explicitly confirmed continuing while the latest completed integrity session is status=artifact_missing and its durable integrity_attempt artifact could not be recovered.",
          ),
      }),
      execute: async (
        { request = "", reason, goalID, directBuildIntent, freshContext = false, userConfirmedStaleIntegrityData },
        options,
      ) => {
        const toolExecution = requireOrchestratorToolExecutionContext(options, "build")
        const task = requireTask(taskID)
        if (isTaskTerminal(task)) {
          return (
            `build: rejected because task ${taskID} is ${deriveTaskStatus(task)}. ` +
            `This is a wake/tool-result continuation, not an explicit restart request. ` +
            `No build run was created; use retry_task or restart_from_stage only when the operator explicitly wants to reopen the task.`
          )
        }
        const requestText = request.trim()
        const declaredDirectBuildIntent = directBuildIntent as string | undefined
        log.info("build tool invoked", {
          taskID,
          reason,
          requestLen: request.length,
          goalID: goalID || "",
          directBuildIntent: declaredDirectBuildIntent ?? "",
          freshContext,
        })

        const missingIntegrityArtifact = findLatestIntegrityArtifactMissingStatus(taskID)
        if (missingIntegrityArtifact && userConfirmedStaleIntegrityData !== true) {
          return (
            `build: blocked by integrity artifact_missing for session ${missingIntegrityArtifact.sessionID}. ` +
            `A completed integrity session has no durable integrity_attempt artifact yet, so the previous artifact is not current data. ` +
            `Recover the artifact or ask the user whether to continue from stale integrity data; then set userConfirmedStaleIntegrityData=true only after that explicit confirmation.`
          )
        }

        // Inherit goalID from the parent agent session if one isn't explicitly
        // passed — this nests the build card under the originating goal in the
        // overlay instead of floating at the conversation root.
        const inheritedGoalID = sessionGoalID(input.agentSessionID)
        const goalReference = goalID || inheritedGoalID
        const resolvedGoalReference = goalReference ? resolveGoalReferenceForBuild(goalReference) : undefined
        if (resolvedGoalReference && !resolvedGoalReference.ok) return resolvedGoalReference.message
        const attachedGoalID = resolvedGoalReference?.goalID
        const isTaskLevelBuild = !attachedGoalID
        if (freshContext && isTaskLevelBuild) {
          log.info("build freshContext ignored for task-level build", {
            taskID,
            reason,
            directBuildIntent: declaredDirectBuildIntent ?? "",
          })
        }
        if (attachedGoalID) {
          assertNoLiveBuildOwnershipForGoal({
            taskID,
            goalID: attachedGoalID,
            action: "build",
          })
        }

        if (isTaskLevelBuild) {
          if (requestText.length === 0) {
            return `build: rejected task-level build. request is required when build is not scoped to a goal.`
          }
          if (declaredDirectBuildIntent && declaredDirectBuildIntent !== "modify_files") {
            return (
              `build: rejected task-level build. directBuildIntent="${declaredDirectBuildIntent}" is not supported; ` +
              `build is implementation-only. Repository investigation belongs to analyze_intent, requirements, or explore.`
            )
          }
          if (task.kind === "workflow") {
            if (!declaredDirectBuildIntent) {
              return (
                `build: rejected task-level workflow build. directBuildIntent is required when build is not scoped ` +
                `to a goal; use directBuildIntent="modify_files" for scoped direct implementation. ` +
                `Repository investigation belongs in analyze_intent, requirements, or explore.`
              )
            }
          }
          await switchExplicitBuildTaskToDirectWorkflow(attachedGoalID)
          await trackStepStart("build")
        }

        // Phase 5-c: delegate to BuildAgent.run. It owns the child session
        // (kind=build), creates an isolated worktree (parallel-safe for
        // multi-goal fan-out), gates concurrency via AgentSemaphore, and
        // returns a structured BuildResult the orchestrator can judge.
        //
        // For goalID path, build the structured BuildTarget from the DB row
        // so the agent receives acceptance_specs / owned_paths / depends_on
        // directly. For pure request path, the LLM-supplied `request` is
        // the user message.
        //
        // Coordinator Run lazy-create: build is the dispatcher, so every
        // implementation build owns the run that later anchors acceptance
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
          if ("error" in ensured) {
            if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
            return `build: cannot ensure task-level run — ${ensured.error}`
          }
          coordinatorRunID = ensured.run.id
        }

        let activeOwnership: OrchestratorToolOwnershipPayload | undefined
        let ownershipClosed = false
        const closeBuildOwnership = (outcome: "completed" | "failed" | "cancelled", error?: string) => {
          if (!activeOwnership || ownershipClosed) return
          ownershipClosed = true
          completeOrchestratorToolOwnership({
            taskID,
            ownershipID: activeOwnership.ownership_id,
            outcome,
            error,
          })
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
            const contractGraph = findLatestArchitectContractGraph(taskID)
            if (!contractGraph) {
              throw new Error(
                `Cannot build goal ${goal.id}: missing architect_contract_graph artifact for task ${taskID}. ` +
                  "Re-run architect so dependency reasons and graph contracts are available before build.",
              )
            }

            const siblingGoals = listGoals(taskID)
            const contractAuditUnknownContractFindings = validateArchitectContractGraph({
              goals: siblingGoals.map((g) => ({
                id: g.id,
                depends_on: g.depends_on as string[],
                acceptance_specs: g.acceptance_specs as AcceptanceSpec[],
              })),
              graph: contractGraph,
            }).filter((finding) => finding.code === "contract_audit_unknown_contract")
            if (contractAuditUnknownContractFindings.length > 0) {
              throw new Error(
                `Cannot build goal ${goal.id}: architect contract_audit references unknown graph contract ids. ` +
                  `${contractAuditUnknownContractFindings.map((finding) => finding.message).join(" ")} ` +
                  "Re-run architect so contract_audit.contract_ids are copied from registered graph contract ids.",
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
                taskID,
                goalID: goal.id,
                runID: coordinatorRunID ?? taskID,
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
            const requirements = reqRows.map(parsedRequirementFromRow)

            const { createDecisionLog } = await import("@/decision-log")
            const decisionLog = createDecisionLog(taskID)
            const dependencies =
              dependsOn.length > 0
                ? siblingGoals
                    .filter((g) => dependsOn.includes(g.id))
                    .map((g) => ({
                      id: g.id,
                      title: g.title,
                    }))
                : []
            const collaborationGoals = siblingGoals.map((g) => ({
              id: g.id,
              title: g.title,
              kind: g.kind,
              status: goalStatusByID(g.id),
              owned_paths: Array.isArray(g.owned_paths) ? (g.owned_paths as string[]) : [],
              depends_on: Array.isArray(g.depends_on) ? (g.depends_on as string[]) : [],
            }))

            const designSpecs = Array.isArray(task.design_specs) ? (task.design_specs as any) : undefined
            const frontendDesign = renderFrontendDesignHandoffReference(taskID)
            const frontendResearch = renderFrontendResearchBriefPromptSection({
              taskID,
              request: task.request,
            })

            // Retry feedback from decision log. Materialize the terminal
            // build-attempt facts before reading so this new session receives
            // the previous failure context in its first prompt.
            ensureBuildRetryFeedbackForGoal({
              taskID,
              goalID: goal.id,
              source: "orchestrator.build.prompt_context",
            })
            const retryEntries = decisionLog.readByPhase("retry").filter((e) => e.goalID === goal.id)
            const retryFeedback =
              retryEntries.length > 0
                ? [
                    "## Prior Attempt Failed — Read This Before Implementing",
                    "",
                    "The previous attempt was rejected. The worktree still has those files; edit in place rather than start from scratch unless the failure forces a structural rewrite.",
                    "",
                    "### Coordinator Root-Cause + Acceptance Rejection",
                    ...retryEntries.map((e) => `- ${e.value}${e.reason ? ` — _why: ${e.reason}_` : ""}`),
                    "",
                    "### Required For This Retry",
                    "- Address each rejection above before changing anything else.",
                    "- Do NOT repeat an approach that was already tried and rejected.",
                    "- If the fix touches a shared file, explain the collaboration impact in files_changed[] instead of hiding the cross-goal dependency.",
                  ].join("\n")
                : undefined
            const acceptanceFeedback = await composeLatestAcceptanceFeedbackForBuild({
              taskID,
              goalID: goal.id,
            })
            const integrityFeedback = await composeIntegrityFeedbackMarkdownForBuild({
              taskID,
              activeSpecSnapshotID: activeSpecForContext?.id,
            })

            // Visual feedback closure-loop: when acceptance rejected on visual
            // grounds, attach the previous rendered.png so the build LLM
            // physically compares its output to the user reference instead of
            // re-painting from text alone.
            const retryAttachments = await loadLatestRenderedRetryAttachment({
              taskID,
              enabled: retryEntries.length > 0 || Boolean(acceptanceFeedback),
            })

            // Goal Workload Analyst brief for this goal (spec §6B). Injected
            // only when the latest workload artifact targets the active
            // architect snapshot — a stale brief (architect re-ran after the
            // analysis) is dropped so build never scopes against superseded
            // counts. Matched by g.id (the canonical post-persistence goal id).
            const wlArtifact = findLatestGoalWorkloadArtifact(taskID)
            const workloadBrief =
              wlArtifact && activeSpecForContext && wlArtifact.spec_snapshot_id === activeSpecForContext.id
                ? wlArtifact.briefs.find((b) => b.goal_id === goal.id)
                : undefined

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
              frontendResearch: frontendResearch.trim().length > 0 ? frontendResearch : undefined,
              frontendDesign: frontendDesign.trim().length > 0 ? frontendDesign : undefined,
              fidelity: taskFidelity,
              retryGuidance: requestText.length > 0 ? requestText : undefined,
              integrityFeedback,
              retryFeedback,
              acceptanceFeedback,
              retryAttachments,
              workloadBrief,
            }
          } else {
            // Task-level direct build: target.text carries the request
            // verbatim (it IS the work), so retryGuidance does not apply
            // to this branch — there's no separate goal contract for the
            // request to "supplement".
            target = { kind: "request", text: requestText }
            const acceptanceFeedback = await composeLatestAcceptanceFeedbackForBuild({ taskID })
            const activeSpecForContext = findActiveSpecForTask(taskID)
            const integrityFeedback = await composeIntegrityFeedbackMarkdownForBuild({
              taskID,
              activeSpecSnapshotID: activeSpecForContext?.id,
            })
            const retryAttachments = await loadLatestRenderedRetryAttachment({
              taskID,
              enabled: Boolean(acceptanceFeedback),
            })
            const designSpecs = Array.isArray(task.design_specs) ? (task.design_specs as any) : undefined
            const frontendDesign = renderFrontendDesignHandoffReference(taskID)
            const frontendResearch = renderFrontendResearchBriefPromptSection({
              taskID,
              request: task.request,
            })
            const reqRows = activeSpecForContext ? findRequirements(activeSpecForContext.id) : []
            const requirements = reqRows.map(parsedRequirementFromRow)
            context =
              integrityFeedback ||
              acceptanceFeedback ||
              retryAttachments ||
              designSpecs ||
              frontendResearch.trim().length > 0 ||
              requirements.length > 0 ||
              frontendDesign.trim().length > 0
                ? {
                    requirements: requirements.length > 0 ? requirements : undefined,
                    designSpecs,
                    frontendResearch: frontendResearch.trim().length > 0 ? frontendResearch : undefined,
                    frontendDesign: frontendDesign.trim().length > 0 ? frontendDesign : undefined,
                    integrityFeedback,
                    acceptanceFeedback,
                    retryAttachments,
                  }
                : undefined
          }

          const priorGoalRunForRetry = attachedGoalID ? findLatestTipGoalRun(attachedGoalID) : undefined
          const freshGoalContext = freshContext && !!attachedGoalID
          const existingBuildSessionID =
            !freshGoalContext &&
            priorGoalRunForRetry &&
            !isLiveGoalRunStatus(priorGoalRunForRetry.status) &&
            priorGoalRunForRetry.session_id
              ? priorGoalRunForRetry.session_id
              : undefined
          if (
            freshGoalContext &&
            priorGoalRunForRetry?.session_id &&
            !isLiveGoalRunStatus(priorGoalRunForRetry.status)
          ) {
            const priorSessionID = priorGoalRunForRetry.session_id
            const priorMarker = (await Ownership.Worktree.list(Instance.worktree)).find(
              ({ marker }) => marker.taskID === taskID && marker.sessionID === priorSessionID,
            )
            if (priorMarker) {
              await Ownership.Worktree.clear({
                primaryWorktreeDir: Instance.worktree,
                worktreeDir: priorMarker.marker.cwd,
              })
              log.info("build freshContext cleared abandoned prior worktree ownership", {
                taskID,
                goalID: attachedGoalID,
                priorGoalRunID: priorGoalRunForRetry.id,
                priorSessionID,
                worktreeDir: priorMarker.marker.cwd,
              })
            } else {
              log.info("build freshContext found no prior worktree ownership marker to clear", {
                taskID,
                goalID: attachedGoalID,
                priorGoalRunID: priorGoalRunForRetry.id,
                priorSessionID,
              })
            }
          }
          if (
            attachedGoalID &&
            !freshGoalContext &&
            priorGoalRunForRetry &&
            !isLiveGoalRunStatus(priorGoalRunForRetry.status) &&
            !priorGoalRunForRetry.session_id
          ) {
            throw new Error(
              `build: goal ${attachedGoalID} prior terminal goal_run ${priorGoalRunForRetry.id} has no session_id; same-session retry cannot continue`,
            )
          }

          // Open the goal_run after BuildAgent has created or reopened the
          // concrete build session. The first artifact must already contain
          // session_id so retry has exactly one session identity source.
          let goalRunID: string | undefined
          const buildSessionContractArtifactForAttempt = (input: { sessionID: string; goalRunID: string }) => {
            if (!attachedGoalID || target.kind !== "goal") return undefined
            const now = Date.now()
            const artifactID = Identifier.ascending("artifact")
            const activePlan = findActivePlanForTask(taskID)
            const graphArtifact = findLatestArchitectContractGraphArtifact(taskID)
            const goalRow = findGoal(attachedGoalID)
            const sourceArtifactIDs = [activePlan?.spec_snapshot_id, activePlan?.id, graphArtifact?.id].filter(
              (item): item is string => typeof item === "string" && item.length > 0,
            )
            const payload = {
              session_id: input.sessionID,
              task_id: taskID,
              goal_id: attachedGoalID,
              goal_run_id: input.goalRunID,
              spec_snapshot_id: activePlan?.spec_snapshot_id ?? null,
              plan_version_id: activePlan?.id ?? null,
              goal_contract_snapshot: {
                title: target.title,
                kind: target.kind,
                objective: target.objective,
                owned_paths: target.owned_paths,
                depends_on: target.depends_on,
                requirement_ids: Array.isArray(goalRow?.requirement_ids) ? goalRow.requirement_ids : [],
                acceptance_specs: target.acceptance_specs,
              },
              collaboration_goals_snapshot: context?.collaborationGoals ?? [],
              requirements_snapshot: context?.requirements ?? [],
              source_artifact_ids: sourceArtifactIDs,
              digest: createHash("sha256")
                .update(
                  JSON.stringify({
                    goal: target,
                    collaborationGoals: context?.collaborationGoals ?? [],
                    requirements: context?.requirements ?? [],
                    sourceArtifactIDs,
                  }),
                )
                .digest("hex"),
            }
            return {
              id: artifactID,
              kind: "build_session_contract" as const,
              label: "build-session-contract",
              runID: coordinatorRunID ?? null,
              goalRunID: input.goalRunID,
              payload,
            }
          }
          const openGoalRunForBuildSession = async (
            sessionID: string,
            buildSessionContext: { worktreeDir?: string; worktreeBranch?: string; worktreeBaseRef?: string },
          ) => {
            if (!attachedGoalID) {
              if (activeOwnership) return
              const ownershipPayload = createOrchestratorToolOwnershipPayload({
                taskID,
                orchestratorSessionID: toolExecution.orchestratorSessionID,
                orchestratorMessageID: toolExecution.orchestratorMessageID,
                toolCallID: toolExecution.toolCallID,
                toolPartID: toolExecution.toolPartID,
                childSessionID: sessionID,
                scope: "task",
              })
              insertOrchestratorToolOwnershipArtifact({
                taskID,
                runID: coordinatorRunID ?? null,
                goalRunID: null,
                label: "tool-ownership-start",
                payload: ownershipPayload,
              })
              activeOwnership = ownershipPayload
              return
            }
            if (goalRunID) return
            try {
              const { beginBuildAttempt } = await import("@/engine/persist")
              goalRunID = beginBuildAttempt({
                taskID,
                goalID: attachedGoalID,
                runID: coordinatorRunID,
                sessionID,
                workspaceDir: buildSessionContext.worktreeDir ?? managedWorktree?.directory,
                // Phase G (2026-05-05): full workspace triple rides the
                // attempt artifact. Pre-fix the orchestrator pre-wrote
                // engine_goal columns then dropped to a synthetic-runID
                // queued artifact when no tip existed; both paths are gone
                // now — single source is the new attempt artifact.
                workspaceBranch: buildSessionContext.worktreeBranch ?? managedWorktree?.branch ?? null,
                workspaceBaseRef: buildSessionContext.worktreeBaseRef ?? managedWorktree?.baseRef ?? null,
                extraArtifacts: ({ goalRunID }) => {
                  const artifacts: Array<{
                    id: string
                    kind: EngineArtifactKind
                    label: string
                    payload: Record<string, unknown>
                    runID?: string | null
                    goalRunID?: string | null
                  }> = []
                  const contract = buildSessionContractArtifactForAttempt({ sessionID, goalRunID })
                  if (contract) artifacts.push(contract)
                  const ownershipPayload = createOrchestratorToolOwnershipPayload({
                    taskID,
                    orchestratorSessionID: toolExecution.orchestratorSessionID,
                    orchestratorMessageID: toolExecution.orchestratorMessageID,
                    toolCallID: toolExecution.toolCallID,
                    toolPartID: toolExecution.toolPartID,
                    childSessionID: sessionID,
                    scope: "goal",
                    goalID: attachedGoalID,
                    goalRunID,
                  })
                  activeOwnership = ownershipPayload
                  artifacts.push({
                    id: Identifier.ascending("artifact"),
                    kind: "orchestrator_tool_ownership",
                    label: "tool-ownership-start",
                    runID: coordinatorRunID ?? null,
                    goalRunID,
                    payload: ownershipPayload,
                  })
                  return artifacts
                },
              })
              return goalRunID
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
              existingSessionID: existingBuildSessionID,
              signal: input.signal,
              managedWorktree,
              onSessionCreated: openGoalRunForBuildSession,
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
                // Host-synthesised BuildResult on contract violation: the LLM
                // never reached its terminal tool, so it has no chance to
                // populate fact_check_items. Empty array is the honest
                // construction-site default (specs/fact-check-agent-...md
                // §6.1.3 — same rationale as external executor factory).
                fact_check_items: [],
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
                  if (!contractAuditBlocksBuild(criteria.status)) return false
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
          // and finalizeBuildAttempt also lays down the per-goal acceptance
          // artifact when the build passed with concrete diffs (overlay's
          // right-side Files panel reads it via findAcceptanceByGoalRun).
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
                const { result, worktreeDir, worktreeBranch, worktreeBaseRef, diffs } = buildOutcome.result
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
            closeBuildOwnership(
              "failed",
              buildOutcome.error instanceof Error ? buildOutcome.error.message : String(buildOutcome.error),
            )
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
              repair_report: result.repair_report,
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

          // Build does NOT mark workflow tasks complete. The final gate is a
          // post-build integrity session after all blocking build evidence is
          // terminal. Return the structured payload so the orchestrator can
          // judge the next explicit action.
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
          const repairReportLines = result.repair_report
            ? [
                `  repaired_findings=${result.repair_report.repaired_findings.length}`,
                ...result.repair_report.repaired_findings.map(
                  (item) =>
                    `  - repaired ${item.finding_id} ${item.fingerprint}: files=${item.changed_files.join(", ")}; verification=${item.verification_commands
                      .map(
                        (command) =>
                          `${command.passed ? "passed" : "failed"} ${command.command}${command.detail ? ` (${command.detail})` : ""}`,
                      )
                      .join(" | ")}`,
                ),
                `  unrepaired_findings=${result.repair_report.unrepaired_findings.length}`,
                ...result.repair_report.unrepaired_findings.map(
                  (item) => `  - unrepaired ${item.finding_id} ${item.fingerprint}: ${item.reason}`,
                ),
                result.repair_report.unrelated_changes.length > 0
                  ? `  unrelated_changes=${result.repair_report.unrelated_changes.join(", ")}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n")
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

          closeBuildOwnership(
            result.status === "passed" ? "completed" : "failed",
            result.status === "failed" ? result.error : undefined,
          )

          return (
            `Build agent finished (status=${result.status}, session ${sessionID}).\n\n` +
            `### Build report\n` +
            `- summary: ${result.summary}\n` +
            `- files_changed:\n${fileLines}\n` +
            `${commitLine}${errorLine}${worktreeLine}${cleanupLine}${goalRunInvalidatedLine}\n` +
            `- repair_report:\n${repairReportLines}\n` +
            `- tests:\n${testLines}` +
            `${factBlock}\n\n` +
            `### Next step\n` +
            `Read the build report and the worktree facts above. Cross-check the LLM's files_changed/commit_ref against the worktree facts; if they disagree, factor that into your next call. ` +
            `When the current eligible wave reaches terminal state, choose visual_qa / build({goalID}) / modify_goal / architect / fail_task / restart_from_stage from the build evidence and task context; route product, dependency, git-worktree, port, and toolchain blockers to the responsible same-task owner instead of passively waiting. ` +
            `For frontend/browser-visible work, run \`visual_qa\` once for the terminal goal batch as peer post-build review evidence before the next build wave. ` +
            `Call \`integrity\` as the final workflow gate after all blocking builds are terminal; visual_qa and integrity are peer review agents, not replacements for each other. Before final acceptance, use integrity earlier only when integrated evidence raises a real question about requirement mining or system integrity.`
          )
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error("build tool failed", { taskID, error: msg })
          closeBuildOwnership("failed", msg)
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

    browser_preview: tool({
      description:
        "Explicitly start a long-lived frontend preview service for this task and save the resulting task-scoped browser preview target. Use this when orchestrator needs the right-side Preview panel or downstream visual evidence to point at a real running app. This is the only tool path that may infer preview URLs from service startup output; ordinary command output does not update preview targets.",
      inputSchema: BrowserPreviewToolParameters,
      execute: async (params, options) => {
        const meta = requireOrchestratorToolExecutionContext(options, "browser_preview")
        const initialized = await BrowserPreviewTool.init()
        const abort =
          (options as { abortSignal?: AbortSignal } | undefined)?.abortSignal ??
          input.signal ??
          new AbortController().signal
        const result = await initialized.execute(params, {
          sessionID: meta.orchestratorSessionID,
          messageID: meta.orchestratorMessageID,
          callID: meta.toolCallID,
          agent: "orchestrator",
          abort,
          messages: [],
          extra: { taskID },
          metadata: () => {},
          ask: async () => {},
        })
        return result.output
      },
    }),

    bash: tool({
      description:
        "User-authorized single-command shell evidence. Runs ONE command " +
        "against the project root only when the latest user/operator request " +
        "explicitly asks for command output or directly requires one command " +
        "result. The schema rejects pipeline / redirect / command substitution, " +
        "embedded newlines, and process-killing patterns. This is NOT a code " +
        "editor, NOT an autonomous test runner, NOT a repository inspector for " +
        "general investigation, NOT a research tool, and NOT a shortcut around " +
        "requirements / architect / build / integrity. The system prompt " +
        "carries authorization scope; this schema carries command-shape " +
        "restrictions.",
      inputSchema: z.object({
        command: z
          .string()
          .min(1)
          .superRefine((cmd, ctx) => {
            const result = validateOrchestratorBashCommand(cmd)
            if (!result.ok) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.reason })
            }
          })
          .describe(
            "Single command invocation. Must contain no " +
              "pipeline (|), command separator (; / && / ||), background (&), " +
              "redirection (> / <), command substitution ($() / backticks), or " +
              "process-killing pattern. Examples: `git status`, `npm test`, " +
              "`node --version`, `ls packages/opencorvus`.",
          ),
        description: z
          .string()
          .min(1)
          .describe("Concise 5-15 word statement of the user-authorized command evidence you are collecting."),
        timeout: z
          .number()
          .int()
          .positive()
          .max(ORCHESTRATOR_BASH_MAX_TIMEOUT_MS)
          .optional()
          .describe(
            `Timeout in ms. Default ${ORCHESTRATOR_BASH_DEFAULT_TIMEOUT_MS}. Hard ceiling ${ORCHESTRATOR_BASH_MAX_TIMEOUT_MS}.`,
          ),
      }),
      execute: async ({ command, description, timeout }) => {
        // Schema-level refine already rejected pipeline / kill
        // shapes, but re-validate defensively so a future schema regression
        // does not turn into silent shell exposure.
        const validation = validateOrchestratorBashCommand(command)
        if (!validation.ok) {
          log.info("orchestrator bash refused", { taskID, command, reason: validation.reason })
          return `bash refused: ${validation.reason}`
        }
        const cwd = Instance.directory
        const ms = timeout ?? ORCHESTRATOR_BASH_DEFAULT_TIMEOUT_MS
        const shell = await Shell.acceptable()
        const supervisor = await ProcessSupervisor.spawnShell({
          command,
          shell,
          cwd,
          env: { ...process.env },
        })
        let output = ""
        const append = (chunk: Buffer | string) => {
          output += typeof chunk === "string" ? chunk : chunk.toString()
        }
        supervisor.stdout?.on("data", append)
        supervisor.stderr?.on("data", append)

        let timedOut = false
        const terminate = () => supervisor.terminate()
        const timer = setTimeout(() => {
          timedOut = true
          void terminate()
        }, ms)

        const onAbort = () => {
          void terminate()
        }
        input.signal?.addEventListener("abort", onAbort, { once: true })

        let exitCode: number | null = null
        try {
          exitCode = await supervisor.exited
        } catch {
          exitCode = null
        } finally {
          clearTimeout(timer)
          input.signal?.removeEventListener("abort", onAbort)
          await supervisor.dispose()
        }

        const MAX_OUTPUT = 30_000
        const clipped =
          output.length > MAX_OUTPUT
            ? output.slice(0, MAX_OUTPUT) +
              `\n\n[truncated ${output.length - MAX_OUTPUT} bytes — bash is single-shot repair, not a debugger; if you need more output route through a sub-agent]`
            : output
        const trailer = timedOut ? `\n\n[command terminated after ${ms}ms timeout]` : ""
        log.info("orchestrator bash executed", {
          taskID,
          command,
          exit: exitCode,
          timedOut,
          outputBytes: output.length,
        })
        return `purpose=${description}; exit=${exitCode ?? "?"}; cmd=${command}\n\n${clipped}${trailer}`
      },
    }),

    wait: tool({
      description:
        "One-shot deliberate pause. Yields the current orchestrator turn for the " +
        "stated number of milliseconds before returning, so a NAMED external event " +
        "the repository cannot itself trigger (CI run still propagating, dev-server " +
        "warming up, remote queue draining, operator's manual setup the user just " +
        "described) has time to settle before your NEXT tool call. " +
        "USE WHEN: task evidence shows there is nothing dispatchable RIGHT NOW, AND " +
        "the unblocking event is concretely external (not 'maybe a goal will finish' " +
        "— that wakes you naturally on completion). " +
        "NOT a polling primitive — never chain wait calls to re-inspect state on a " +
        "fixed cadence. The orchestrator wakes on real external triggers (operator " +
        "message, ownership recovery, scheduler tick); a second wait in the same turn " +
        "is the signal you should have called `question` or `fail_task` instead. " +
        "NOT a substitute for `question` (operator input required), `fail_task` " +
        "(no responsible same-task repair), or `read_context` (refreshing task " +
        "evidence — that is a tool call, not a pause). " +
        "After wait returns, re-read evidence with `read_context` before deciding " +
        "the next dispatch.",
      inputSchema: z.object({
        duration_ms: z
          .number()
          .int()
          .min(ORCHESTRATOR_WAIT_MIN_MS)
          .max(ORCHESTRATOR_WAIT_MAX_MS)
          .describe(
            `Pause length in milliseconds. Minimum ${ORCHESTRATOR_WAIT_MIN_MS}, ` +
              `maximum ${ORCHESTRATOR_WAIT_MAX_MS}. Pick the smallest duration that ` +
              `gives the named external event a real chance to occur.`,
          ),
        reason: z
          .string()
          .min(1)
          .describe(
            "Concrete external event you are waiting for and why no in-task " +
              "dispatch is responsible until it lands. Recorded in the decision log " +
              "so the next wake can audit the deliberate pause.",
          ),
      }),
      execute: async ({ duration_ms, reason }) => {
        const startedAt = Date.now()
        try {
          createDecisionLog(taskID).append({
            phase: "orchestrator",
            key: `wait_${startedAt}`,
            value: `wait ${duration_ms}ms`,
            reason,
          })
        } catch (error) {
          log.warn("wait decision log append failed", {
            taskID,
            error: error instanceof Error ? error.message : String(error),
          })
        }

        let aborted = false
        await new Promise<void>((resolve) => {
          if (input.signal?.aborted) {
            aborted = true
            resolve()
            return
          }
          const onAbort = () => {
            aborted = true
            clearTimeout(timer)
            resolve()
          }
          const timer = setTimeout(() => {
            input.signal?.removeEventListener("abort", onAbort)
            resolve()
          }, duration_ms)
          input.signal?.addEventListener("abort", onAbort, { once: true })
        })

        const elapsed = Date.now() - startedAt
        log.info("orchestrator wait completed", {
          taskID,
          requestedMs: duration_ms,
          elapsedMs: elapsed,
          aborted,
        })
        if (aborted) {
          return `wait aborted after ${elapsed}ms (requested ${duration_ms}ms). Reason: ${reason}`
        }
        return (
          `Waited ${elapsed}ms (requested ${duration_ms}ms). Reason: ${reason}. ` +
          `Re-read task evidence with read_context before your next dispatch — ` +
          `the world may have changed during the pause.`
        )
      },
    }),
  }

  // Phase 5-g: the deprecated dispatch tools (dispatch_goal / exec_goal /
  // submit_execution / retry_goal / create_run) that the 5-c filter hid
  // from the LLM are now fully deleted. Build is the single dispatch tool.
  return {
    tools,
  }
}
