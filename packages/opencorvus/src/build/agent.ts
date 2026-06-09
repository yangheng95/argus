/**
 * BuildAgent — phase 5-b-2 implementation of the `build` tool's agent body.
 *
 * Replaces the GoalPool + executor adapter path for coding work: instead of
 * delegating to an external coding executor (OpenCorvus / codex / claude-code),
 * build runs an in-process LLM via SessionPrompt with the broad coding
 * toolset (read / write / edit / bash / ...) and the build-core prompt.
 *
 * Lifecycle:
 *   1. AgentSemaphore.withSlot gates parallel agents per task. Orchestrator's
 *      parallel tool_calls fan out with this cap.
 *   2. Worktree.create under `<primary>/.opencorvus/runtime/`. Ownership
 *      marker is written via Ownership.Worktree.record so OS-level restart
 *      cleanup can reclaim it.
 *   3. SessionPrompt.prompt runs the build agent in a child session with
 *      the report_build_result terminal tool. The payload status is the
 *      discriminator; text output is ignored.
 *   4. Worktree lifetime is goal-scoped. Retryable failures preserve the
 *      same directory so the next agent can continue from real files,
 *      commits, or MERGING state.
 *
 * No DB state. No GoalPool. No lease. No coordinator_run_id. Post-phase-5
 * every run is anchored to the child session (UI / audit) and the result
 * flows back as a tool_result to the orchestrator.
 */

import z from "zod"
import fs from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"
import { git as runGit } from "@/util/git"
import { tool, type ToolSet } from "ai"
import { Log } from "@/util/log"
import { AgentRunError, runAgentSession } from "@/agent/runner"
import { Agent } from "@/agent/agent"
import { EffectiveConfig } from "@/config/effective"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { TaskRuntimeMaterializer } from "@/project/task-runtime-materializer"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { toolFailureCauseFromUnknown } from "@/session/tool-failure-cause"
import { Worktree } from "@/worktree"
import { gitCeilingEnvForWorktree } from "@/worktree/git-ceiling"
import { AgentSemaphore } from "@/engine/agent-semaphore"
import { Ownership } from "@/engine/ownership"
import { findActiveRunForTask, type TaskRow } from "@/engine/store"
import { EngineConfig } from "@/engine/config"
import { ExecutorRegistry } from "@/executor/registry"
import {
  record,
  structuredInput,
  type CodingEventInfo,
  type CodingProvider,
  type CodingProviderOptions,
} from "@/executor/contract"
import {
  extractExecutorSessionRef,
  persistExecutorSessionRef,
  readExecutorSessionRef,
  resolveNativeResumeRef,
} from "@/executor/session-ref"
import { Identifier } from "@/id/id"
import { Message } from "@/session/message"
import { MCPServe } from "@/mcp/serve"
import type { VisualSpec } from "@/frontend-design/types"
import type { WorkloadBrief } from "@/goal-workload-analyst/types"
import { renderVisualContractPromptSection } from "@/frontend-design/prompt-section"
import type { AssemblyOwnerEntry, ReferenceCoverageEntry, SourceCoverageEntry } from "@/architect/fidelity"
import type { FileDiff } from "@/snapshot/types"
import {
  BuildAgentContractError,
  BuildResultSchema,
  formatBuildResultSchemaError,
  validateBuildIntegrityRepairReport,
  type BuildContractGraphContext,
  type BuildFileChange,
  type BuildResult,
  type BuildTarget,
  type BuildTestResult,
} from "./types"
import { renderContractGraphForPrompt } from "@/architect/contract-graph"
import { withFactCheckRegistration } from "@/prompt/fragments/fact-check-registration"
import { AttachmentStore } from "@/storage/attachment-store"
import { renderUserRequestSection } from "@/intent/request-prompt"
import { abortableIterable, withStreamActivity } from "@/util/stream-activity"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { buildBuildAgentReport } from "./report"
import { InstructionPrompt } from "@/session/instruction"
import { renderBuildPromptOverlays } from "./prompt-context"
import { createBuildScreenshotTool } from "./screenshot-tool"

import BUILD_CORE from "@/prompt/core/build-core.txt"
import ENGINEERING_CRAFT from "@/prompt/core/engineering-craft.txt"

const log = Log.create({ service: "build-agent" })

export function createMergeBackSingleFlight<T extends { status: string }>(execute: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | undefined
  let merged: T | undefined
  return async () => {
    if (merged) return merged
    if (inFlight) return await inFlight
    inFlight = execute()
    try {
      const result = await inFlight
      if (result.status === "merged") merged = result
      return result
    } finally {
      if (!merged) inFlight = undefined
    }
  }
}

export type BuildReportSubmission =
  | { accepted: true; result: BuildResult; output: string }
  | { accepted: false; output: string }

export function evaluateBuildReportSubmission(input: {
  result: unknown
  mergedHead?: string
  ownsWorktree: boolean
  worktreeBranch?: string
}): BuildReportSubmission {
  const parsedResult = BuildResultSchema.safeParse(input.result)
  if (!parsedResult.success) {
    return {
      accepted: false,
      output:
        "REJECTED: build report did not match BuildResultSchema. " +
        `${formatBuildResultSchemaError(parsedResult.error)} ` +
        "Fix the payload and call report_build_result again.",
    }
  }

  const commit_ref = input.mergedHead
    ? input.mergedHead.slice(0, 12)
    : input.ownsWorktree && input.worktreeBranch
      ? ""
      : (parsedResult.data.commit_ref ?? "")

  return {
    accepted: true,
    result: { ...parsedResult.data, commit_ref },
    output: `RECORDED: build report status=${parsedResult.data.status}.`,
  }
}

export namespace BuildAgent {
  /**
   * Upstream context the build agent needs but cannot recover from `target`
   * alone. Composed by the caller (orchestrator's `build` tool) from DB
   * state — REQ-N list, design specs, architect contracts, dependency
   * goal output, and any prior-attempt retry feedback. Each section is
   * optional; the agent renders only the ones the caller fills in.
   *
   * Why a separate field instead of fattening `BuildTarget`: BuildTarget
   * is the Zod-validated tool-input schema the orchestrator hands the
   * LLM. Keeping it minimal avoids forcing the orchestrator to restate
   * the entire upstream context as JSON tool-call arguments. Context is
   * server-side composition that the build agent reads directly.
   */
  export interface BuildContext {
    /** REQ-N list produced by Requirements. Drives "what does the user
     *  actually want" beyond the goal's compressed acceptance_specs. */
    requirements?: Array<{
      id: string
      type: "explicit" | "implicit"
      description: string
      acceptance: string
      non_goals: string
      evidence_refs?: string[]
    }>
    /** Optional visual anchors from frontend_design. The frontend template is the
     *  authoritative contract; these rows only provide compact ids when present. */
    designSpecs?: VisualSpec[]
    /** Compact frontend_research webpage investigation plan rendered from the latest
     *  non-stale frontend_research_brief artifact. Build consumes it as coverage
     *  work packets before implementing webpage/UI replica surfaces. */
    frontendResearch?: string
    /** Full frontend-design frontend template and source manifest from the decision log.
     *  This names frontend_template, fillable_modules, visual_consistency_contract,
     *  ui_data_contract, review notes, completeness audit, reference artifacts,
     *  and evidence_source_manifest. */
    frontendDesign?: string
    /** Task-scoped Architect Contract Graph. Build receives graph contracts
     *  and dependency reasons by id; it must not infer dependency meaning from
     *  removed prose contract fields. */
    contractGraph?: BuildContractGraphContext
    /** Dependency goals listed in `target.depends_on`. The orchestrator gates
     *  dispatch on these having passed and merged, so their files SHOULD be
     *  in the worktree base. Keep this as a compact index; details live in
     *  the Architect Contract Graph and workload brief. */
    dependencies?: Array<{
      id: string
      title: string
      commit_ref?: string
    }>
    /** Pre-rendered "Persistent Integrity Findings" section composed by
     *  orchestrator from integrity_attempt artifacts, spec snapshot lineage,
     *  shared prompt capping/sanitization, and the shared root-history helper.
     *  Build renders it before retry guidance because workflow-gate findings
     *  outrank the orchestrator's hand-written summary. */
    integrityFeedback?: string
    /** First-class retry guidance from the orchestrator LLM for this
     *  specific attempt (passed via the `request` field on the `build`
     *  tool, which used to overwrite `target.objective` until the spec
     *  build-missing-terminal-signal-restore-2026-05-07.md §5.2 split).
     *  Distinct from retryFeedback: this is the current turn's direct
     *  instruction; retryFeedback is the auto-aggregated historical
     *  summary from decision_log phase=retry entries. When both exist,
     *  retryGuidance renders first because the orchestrator's just-now
     *  decision should be honoured before historical context. */
    retryGuidance?: string
    /** Pre-rendered "Prior Attempt Failed" section from the decision log's
     *  retry entries. Empty / undefined on the first attempt. The caller
     *  composes the markdown so this agent doesn't need DB access. */
    retryFeedback?: string
    /** Canonical acceptance rejection packet read directly from persisted
     *  verdict / manifest artifacts. Unlike retryFeedback, this is not an
     *  orchestrator-written summary and also exists for task-scope rework. */
    acceptanceFeedback?: string
    /** Task-wide fidelity contract derived from architect coverage rows. */
    fidelity?: {
      sourceCoverage?: SourceCoverageEntry[]
      referenceCoverage?: ReferenceCoverageEntry[]
      assemblyOwners?: AssemblyOwnerEntry[]
    }
    /** Compact sibling-goal collaboration index composed by the orchestrator.
     *  This intentionally excludes sibling objectives and acceptance specs so
     *  build prompts and context snapshots do not inline every goal contract. */
    collaborationGoals?: Array<{
      id: string
      title: string
      kind: string
      status: string
      owned_paths: string[]
      depends_on: string[]
    }>
    /** Pre-formatted multimodal file parts produced by upstream evidence —
     *  typically the previous attempt's rendered.png from acceptance visual
     *  evidence so the build LLM can see what it actually produced versus
     *  the user reference. Each entry's `url` MUST be the canonical
     *  `/attachment/<projectID>/<name>` URL; AttachmentStore is the single
     *  source that reads bytes and splices them into the user message after
     *  `task.attachments`. */
    retryAttachments?: Array<{ url: string; mime: string; filename?: string }>
    /** This goal's Goal Workload Analyst brief, injected only when it matches
     *  the active architect snapshot. Scopes the goal BEFORE implementation
     *  (anti premature-minimization): countable work surface, underestimation
     *  traps, verification inventory, and id/section pointers to read deeper.
     *  Cites references by id only — it never restates surfaces in prose
     *  (spec 2026-05-29-goal-workload-analyst §6B). */
    workloadBrief?: WorkloadBrief
  }

  export interface RunInput {
    /** The work target — either a scoped goal (pipeline workflow) or a
     *  free-form request (direct workflow). See build/types.ts. */
    target: BuildTarget
    /** The owning task row; drives AgentSemaphore limits + worktree
     *  metadata. The build agent does NOT read DB state itself — `task` is
     *  threaded in by the orchestrator's build tool wrapper. */
    task: TaskRow
    /** Upstream context (requirements, design specs, architect contracts,
     *  dependency siblings, retry feedback). The orchestrator composes
     *  this from DB before invoking BuildAgent.run; the agent renders the
     *  populated sections into the user prompt. Absent fields render to
     *  nothing (safe for the direct-build path that has no architect). */
    context?: BuildContext
    /** Parent session the child build session attaches under. Typically
     *  the orchestrator's own child session so overlay nesting stays
     *  intuitive. Optional: when absent the build session is top-level. */
    parentSessionID?: string
    /** Existing build session to continue for retry attempts. When set,
     *  BuildAgent appends the new user message to this session and replaces
     *  its runtime contract instead of creating a new build session. */
    existingSessionID?: string
    /** Explicit model override (provider / model). Skips `resolveAgentModel`. */
    model?: { providerID: string; modelID: string }
    /** Overrides the engine auto-iteration prompt mode for bounded one-pass callers. */
    autoIteration?: boolean
    /** False disables Model Context Protocol tools for bounded research-only callers. */
    includeMcpTools?: boolean
    /** True exposes only BuildAgent runtime tools for bounded special-purpose callers. */
    exactRuntimeTools?: boolean
    /** Extra runtime tools added to BuildAgent's terminal/report toolset for bounded callers. */
    additionalRuntimeTools?: ToolSet
    /** Additional per-run tool switches merged after the build defaults. */
    toolSwitches?: Record<string, boolean>
    signal?: AbortSignal
    /** Fires after the child build session exists, before model work starts.
     *  Goal builds return the newly opened logical goal_run_id so the runtime
     *  contract and the visible user message carry the same attempt identity. */
    onSessionCreated?: (
      sessionID: string,
      context: { worktreeDir?: string; worktreeBranch?: string; worktreeBaseRef?: string },
    ) => string | void | Promise<string | void>
    /** Optional pre-allocated worktree dir. When provided, the build agent
     *  uses it as-is and does NOT manage its lifecycle (caller owns cleanup).
     *  When absent the agent creates a managed worktree under
     *  `<primary>/.opencorvus/runtime/`. */
    workDir?: string
    /** Goal-scoped managed worktree recorded on engine_goal. Unlike workDir,
     *  this still participates in the build agent's merge_back protocol; the
     *  orchestrator owns lifetime, while BuildAgent owns publication. */
    managedWorktree?: {
      directory: string
      branch: string
      baseRef?: string | null
    }
  }

  export interface RunOutput {
    /** The terminal result the LLM emitted via report_build_result. */
    result: BuildResult
    /** The child "build" session created for this invocation. Callers may
     *  inspect its message stream for audit / UI. */
    sessionID: string
    /** The worktree directory used by this run. Absent when the caller
     *  supplied `workDir` (caller already has it). */
    worktreeDir?: string
    /** Branch checked out by worktreeDir. Present for build-managed worktrees. */
    worktreeBranch?: string
    /** Base commit captured when the goal worktree was first allocated. */
    worktreeBaseRef?: string
    /** Per-file diffs from worktree base → goal branch HEAD. Captured before
     *  cleanup so the orchestrator can persist a per-goal acceptance artifact
     *  the overlay's right-side panel reads via `findAcceptanceByGoalRun`.
     *  Empty / undefined when no merge-back happened (failed build, caller-
     *  owned worktree, or no commit_ref). */
    diffs?: FileDiff[]

    // ── Merge / diff facts surfaced for the orchestrator LLM ──────────
    // These are the build session's authoritative facts about what
    // actually happened, independent of what the LLM self-reported. The
    // build tool result formatter renders them inline so the orchestrator
    // LLM can cross-check the LLM's `files_changed[]` and `commit_ref`
    // against the host's ground truth and pick the next action itself
    // (CLAUDE.md rule 13 — no host-side state-machine on these values).

    /** Status of merge_back inside this run.
     *   - "merged"      — merge_back returned merged; primary HEAD advanced
     *   - "conflict"    — merge_back hit conflict, build session may or may
     *                     not have repaired it
     *   - "blocked"     — repository state prevented merge from starting
     *   - "infra_error" — host-level merge infrastructure error
     *   - "not_invoked" — agent never called merge_back (or it was not
     *                     in the toolset for caller-owned worktrees)
     */
    mergeBackStatus: "merged" | "conflict" | "blocked" | "infra_error" | "not_invoked"
    /** Last non-merged outcome text from merge_back, or undefined if the
     *  most recent invocation actually merged (or the tool was never
     *  invoked). Surfaced verbatim so the orchestrator LLM sees whatever
     *  the merge_back tool reported (conflict path list, blocked reason,
     *  etc.). */
    lastMergeBackOutcome?: string
    /** Primary HEAD commit (short SHA) once merge_back successfully
     *  published. Undefined when merge_back did not succeed in this run.
     *  Use this — not result.commit_ref — when persisting the goal's
     *  published commit reference. */
    publishedCommitRef?: string
    /** Worktree HEAD commit (short SHA) at the end of the run. Always
     *  present when a managed worktree exists. The orchestrator can
     *  compare against publishedCommitRef to see what was committed but
     *  not yet merged. */
    worktreeHead?: string
    /** Files that actually changed in this build's contribution range
     *  (worktreeBaseRef..HEAD, with merge-commit second-parent unwrap
     *  via resolveGoalContributionBaseRef). The host's ground truth that
     *  the orchestrator LLM can compare to result.files_changed. */
    actualChangedFiles?: Array<{
      path: string
      status: "added" | "modified" | "deleted"
      additions: number
      deletions: number
    }>
  }

  export function composeExternalCodingSystem(input: {
    executor: Exclude<TaskRow["executor"], "opencorvus">
    baseSystem?: string
    userAppend?: string
  }) {
    const mcpPrompt = input.executor === "codex" ? MCPServe.codingExecutorPromptSection() : ""
    const system = [
      input.baseSystem ?? "",
      externalBuildSystemContract(input.executor),
      input.userAppend ?? "",
      mcpPrompt,
    ]
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n\n")
    return {
      system: system.length > 0 ? system : undefined,
      mcpPromptInjected: mcpPrompt.length > 0,
    }
  }

  /**
   * Run the build agent against a target. The returned promise resolves
   * with a BuildResult regardless of whether the agent's own verdict was
   * passed or failed; thrown errors are reserved for infrastructure faults
   * (model unavailable, worktree creation failed, session stream error).
   */
  export async function run(input: RunInput): Promise<RunOutput> {
    return AgentSemaphore.withSlot(input.task, async () => {
      const autoIteration = input.autoIteration ?? (await EngineConfig.get()).auto_iteration === true
      // ── Worktree acquisition ─────────────────────────────────────────────
      // Happens OUTSIDE runAgentSession because the worktree is the
      // session's working directory — the runner needs it resolved before
      // it calls Session.createNext. `workDir` means a caller-owned directory
      // that opts out of merge_back. `managedWorktree` is goal-owned state
      // supplied by the orchestrator and still uses merge_back.
      if (input.workDir && input.managedWorktree) {
        throw new Error("BuildAgent.run: workDir and managedWorktree are mutually exclusive")
      }
      const ownsWorktree = !input.workDir
      let worktreeDir = input.managedWorktree?.directory ?? input.workDir
      let worktreeBranch: string | undefined
      const buildSessionID = input.existingSessionID ?? Identifier.descending("session")
      // Worktree HEAD commit at creation time. Equals primary HEAD because
      // Worktree.create branches off it; we capture the SHA so post-build
      // diff extraction can compute baseRef..HEAD inside the worktree
      // without depending on git merge-base (which fails after merge-back
      // when ff-only collapses both refs to the same tip).
      let baseRef: string | undefined
      if (input.managedWorktree) {
        const managedDir = input.managedWorktree.directory
        worktreeDir = managedDir
        worktreeBranch = input.managedWorktree.branch
        await Ownership.Worktree.record({
          primaryWorktreeDir: Instance.worktree,
          worktreeDir: managedDir,
          taskID: input.task.id,
          sessionID: buildSessionID,
          runID: findActiveRunForTask(input.task.id)?.id,
          goalID: input.target.kind === "goal" ? input.target.id : undefined,
        })
        baseRef = input.managedWorktree.baseRef ?? undefined
        if (!baseRef) {
          const result = await runGit(["rev-parse", "HEAD"], { cwd: managedDir, timeoutProfile: "fast" })
          baseRef = result.exitCode === 0 ? result.text().trim() || undefined : undefined
        }
      } else if (ownsWorktree) {
        const targetLabel = labelFromTarget(input.target)
        // `reuseIfValid: true` lets a re-attempted build pick up a preserved
        // worktree when the prior session wrote commits but never completed
        // the merge_back contract. Invalid trees are reclaimed by
        // Worktree.create before a fresh tree is created, so corrupt git
        // state is never reused silently.
        const info = await Worktree.create({
          name: `build-${targetLabel}`,
          reuseIfValid: true,
          taskID: input.task.id,
          sessionID: buildSessionID,
        })
        worktreeDir = info.directory
        worktreeBranch = info.branch
        await Ownership.Worktree.record({
          primaryWorktreeDir: Instance.worktree,
          worktreeDir,
          taskID: input.task.id,
          sessionID: buildSessionID,
          runID: findActiveRunForTask(input.task.id)?.id,
          goalID: input.target.kind === "goal" ? input.target.id : undefined,
        })
        const result = await runGit(["rev-parse", "HEAD"], { cwd: worktreeDir, timeoutProfile: "fast" })
        baseRef = result.exitCode === 0 ? result.text().trim() || undefined : undefined
      }

      if (!worktreeDir) {
        throw new Error("BuildAgent.run: worktree directory was not resolved")
      }

      if (ownsWorktree) {
        await TaskRuntimeMaterializer.materializeFrontendDesign({
          projectDir: Instance.project.worktree,
          taskID: input.task.id,
          worktreeDir,
        }).catch((error) => {
          throw new Error(
            `BuildAgent.run: failed to materialize task runtime artifacts in ${worktreeDir}: ` +
              `${error instanceof Error ? error.message : String(error)}`,
            { cause: error instanceof Error ? error : undefined },
          )
        })
      }

      const buildSession = input.existingSessionID
        ? await Session.get(input.existingSessionID)
        : await Session.createNext({
            id: buildSessionID,
            kind: "build",
            parentID: input.parentSessionID,
            goalID: input.target.kind === "goal" ? input.target.id : undefined,
            title: buildSessionTitle(input.target),
            directory: worktreeDir,
          })
      if (buildSession.kind !== "build") {
        throw new Error(
          `BuildAgent.run: existing session ${buildSession.id} has kind=${buildSession.kind}, expected build`,
        )
      }
      if ((buildSession.goalID ?? undefined) !== (input.target.kind === "goal" ? input.target.id : undefined)) {
        throw new Error(
          `BuildAgent.run: existing session ${buildSession.id} has goalID=${buildSession.goalID ?? "<unset>"}, expected ${input.target.kind === "goal" ? input.target.id : "<unset>"}`,
        )
      }
      if (buildSession.directory !== worktreeDir) {
        throw new Error(
          `BuildAgent.run: existing session ${buildSession.id} has directory=${buildSession.directory}, expected ${worktreeDir}`,
        )
      }
      const openedGoalRunID = await input.onSessionCreated?.(buildSession.id, {
        worktreeDir,
        worktreeBranch,
        worktreeBaseRef: baseRef,
      })
      const runtimeGoalRunID = typeof openedGoalRunID === "string" ? openedGoalRunID : undefined

      const buildReferenceAttachments = collectBuildReferenceAttachments(input.task)

      // Stage authoritative visual/reference attachments into `<worktree>/references/`
      // so the build agent can pass worktree-LOCAL relative paths to tools
      // whose sandbox checks reject paths outside the worktree. The staging
      // contract is owned by AttachmentStore (rule 22
      // — single source for "where staged attachments live"); this build
      // agent path just invokes it. Caller-owned worktrees (input.workDir)
      // skip — the caller is responsible for staging in that path.
      let stagedAttachments: AttachmentStore.StagedAttachment[] = []
      if (ownsWorktree && worktreeDir && buildReferenceAttachments.length > 0) {
        try {
          stagedAttachments = await AttachmentStore.stageToWorktree(
            Instance.project.id,
            buildReferenceAttachments,
            worktreeDir,
          )
          if (stagedAttachments.length > 0) {
            log.info("build agent: staged reference attachments into worktree references/", {
              taskID: input.task.id,
              count: stagedAttachments.length,
              worktreeDir,
            })
          }
        } catch (err) {
          // Hard fail (rule 1) — without staging the build agent is back to
          // the discover-and-cp dance and downstream tool calls will fail
          // sandbox checks. Surface so the orchestrator marks the build as
          // failed instead of silently degrading.
          throw new Error(
            `build agent: failed to stage task attachments into worktree references/ — ${err instanceof Error ? err.message : String(err)}`,
            { cause: err instanceof Error ? err : undefined },
          )
        }
      }

      const buildPromptText = () =>
        input.existingSessionID
          ? buildRetryFeedbackPrompt(input.target, input.context, input.task.id)
          : buildUserPrompt(input.target, input.context, input.task.id)
      const requiredIntegrityFingerprints = integrityBlockingFingerprintsFromFeedback(input.context?.integrityFeedback)
      // Forward the same authoritative references named in the
      // frontend-design evidence manifest as multimodal user-message parts so
      // the build LLM physically sees what to clone. This includes user
      // attachments and frontend-design materialized visual artifacts
      // (system_artifacts intent=visual_reference), not acceptance retry renders.
      const taskAttachments = buildReferenceAttachments
      const retryAttachments = (input.context?.retryAttachments ?? []).filter(
        (a) => typeof a?.url === "string" && typeof a?.mime === "string",
      ) as Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
      const allMultimodal = [...taskAttachments, ...retryAttachments]
      const buildUserPartsFn =
        allMultimodal.length > 0
          ? async () => {
              const text = buildPromptText()
              const inline = await AttachmentStore.inlineFileParts(allMultimodal)
              // Three layers of context for attachments, each with a different
              // role and required to coexist (rule 22 — staging doesn't
              // replace inlining; inlining doesn't replace listing):
              //   1. inline file parts → the LLM physically sees the pixels
              //   2. renderStagedList → tells the LLM the worktree-local path
              //      so it can pass them to sandbox-checked tools
              //   3. renderAttachmentInventory → textual ledger of EVERY
              //      attachment (multimodal + reference-only) so the LLM
              //      anchors its reasoning to "I have these files"
              //
              // Plus an UNCONDITIONAL contract preamble (only when this dispatch
              // actually carries multimodal references): the static system
              // prompt's reference-fidelity language is conditional ("If the
              // prompt depends on screenshots…"), and models routinely judge
              // their way out of the condition. The preamble eliminates that
              // judgement: when this branch runs, attachments demonstrably
              // exist; restoration is therefore not optional. Filenames are
              // listed so the model cannot pretend "no specific image was named".
              const visualContractPreamble = renderVisualContractPreamble(allMultimodal, {
                mode: "inlined",
              })
              const enrichedText =
                visualContractPreamble +
                text +
                AttachmentStore.renderStagedList(stagedAttachments) +
                AttachmentStore.renderAttachmentInventory(allMultimodal)
              return [{ type: "text" as const, text: enrichedText }, ...inline]
            }
          : undefined
      // External coding providers (codex / claude-code) get only a single
      // text prompt — no multimodal file parts, no attachment inventory.
      // The visual contract has to ride on the prompt itself, with the
      // "staged-only" wording so the LLM is told it must `read` the
      // worktree's references/<filename> on disk (not pretend it saw
      // pixels in the message). Mirrors the opencorvus path so external
      // executors stop free-styling away from screenshots they were given.
      const buildExternalPromptText =
        allMultimodal.length > 0
          ? () =>
              renderVisualContractPreamble(allMultimodal, { mode: "staged-only" }) +
              buildPromptText() +
              AttachmentStore.renderStagedList(stagedAttachments) +
              AttachmentStore.renderAttachmentInventory(allMultimodal)
          : buildPromptText

      // Tracks whether `merge_back` ever returned `merged` for this build
      // session. The post-run guard below uses it to reject "agent claimed
      // passed but never published to primary" — the agent owns merge in the
      //切法-A design, so a missed/failed merge_back call must demote the
      // verdict. Captured in closure so the tool's execute() and the
      // post-run code share state without a side-channel.
      let mergedHead: string | undefined
      // Latest non-merged outcome from the merge_back tool. The post-run
      // guard appends this to the demoted-error string so callers (overlay,
      // evaluator, log scrapers) can see the *real* reason — conflict paths,
      // infrastructure error, etc. — instead of the generic "merge_back was
      // not called" placeholder.
      let lastMergeBackOutcome: string | undefined
      const executeMergeBack = createMergeBackSingleFlight(async () => {
        const outcome = await Worktree.mergeSafely({
          branch: worktreeBranch!,
          worktreeDir: worktreeDir!,
        })
        if (outcome.status === "merged") {
          mergedHead = outcome.primaryHead
          return {
            status: "merged" as const,
            primary_head: outcome.primaryHead,
            primary_branch: outcome.primaryBranch,
            ...(outcome.primaryRecoveryCommit ? { primary_recovery_commit: outcome.primaryRecoveryCommit } : {}),
          }
        }
        if (outcome.status === "conflict") {
          lastMergeBackOutcome =
            `conflict on ${outcome.primaryBranch} (tip ${outcome.primaryTip.slice(0, 12)}); ` +
            `paths: ${outcome.conflictPaths.join(", ")}`
          return {
            status: "conflict" as const,
            primary_branch: outcome.primaryBranch,
            primary_tip: outcome.primaryTip,
            conflict_paths: outcome.conflictPaths,
            hint:
              "Worktree is in MERGING state with conflict markers in " +
              "the listed paths. Edit each path to resolve the markers, " +
              "git add <path>, then `git commit` to finalize the merge. " +
              "Then call merge_back again to ff-publish into " +
              outcome.primaryBranch +
              ".",
          }
        }
        if (outcome.status === "blocked") {
          lastMergeBackOutcome = `blocked on ${outcome.branch}: ${outcome.reason}`
          return {
            status: "blocked" as const,
            reason: outcome.reason,
            branch: outcome.branch,
            worktree_dir: outcome.worktreeDir,
            ...(outcome.dirtyPaths ? { dirty_paths: outcome.dirtyPaths } : {}),
            ...(outcome.mergeHead ? { merge_head: true } : {}),
          }
        }
        lastMergeBackOutcome = `infra_error on ${outcome.branch}: ${outcome.reason}`
        return {
          status: "infra_error" as const,
          reason: outcome.reason,
          branch: outcome.branch,
          ...(outcome.stderr ? { stderr: outcome.stderr } : {}),
        }
      })

      type BuildCollector = {
        result?: BuildResult
      }
      const buildCollector: BuildCollector = {}
      const buildBuildReport = () => buildBuildAgentReport(buildCollector)
      const createBuildRuntimeTools = (): ToolSet => ({
        screenshot: createBuildScreenshotTool({
          projectID: Instance.project.id,
          projectDir: Instance.project.worktree,
          taskID: input.task.id,
        }),
        ...(input.additionalRuntimeTools ?? {}),
        report_build_result: tool({
          description:
            "Finalize this build session with status='passed' or status='failed'. " +
            "The host accepts whichever you submit — it does NOT enforce that merge_back succeeded first, " +
            "and does NOT audit your files_changed[] against the actual git diff. " +
            "Both facts are returned to the orchestrator alongside your report (merge_back_status, actual_changed_files), " +
            "so the orchestrator LLM cross-checks honesty itself. " +
            "Be honest: if you changed project files but didn't merge, report status='failed' with a concrete error. " +
            "If integrity feedback gave you blocking fingerprints, include repair_report and list every fingerprint exactly once as repaired or unrepaired. " +
            "Include contract_restatement with the detailed req/goal you actually handled, and followup_workload_guidance warning later agents what work surface still needs deeper workload investigation. " +
            "If you legitimately reused a prior attempt's worktree without further edits, or the scoped implementation was already satisfied with a clean worktree, status='passed' with files_changed=[] is fine.",
          inputSchema: BuildResultSchema,
          execute: async (result) => {
            const evaluated = evaluateBuildReportSubmission({
              result,
              mergedHead,
              ownsWorktree,
              worktreeBranch,
            })
            if (!evaluated.accepted) return evaluated.output
            // No host-side enforcement of merge_back-before-passed and no
            // diff-coverage audit. Both facts are surfaced separately on
            // RunOutput (mergeBackStatus / actualChangedFiles) and rendered
            // in the orchestrator-facing build tool result. CLAUDE.md
            // rule 13 — orchestrator LLM, not host code, decides whether
            // to trust this self-report. Spec
            // architecture-rework-loosening-plan-2026-05-06.md (B3 + B4 + B19).
            //
            // commit_ref policy: in managed worktree mode, only the merged
            // primary HEAD is a valid published commit. If merge_back hasn't
            // succeeded, we drop the LLM's self-reported value rather than
            // store a worktree tip that nothing downstream can verify
            // (rule 8 single source — the host knows the truth, not the LLM).
            buildCollector.result = evaluated.result
            return evaluated.output
          },
        }),
      })

      const buildToolKit: {
        tools: ToolSet
        getCollector: () => BuildCollector
        buildReport: () => ReturnType<typeof buildBuildReport>
      } =
        ownsWorktree && worktreeBranch && worktreeDir
          ? {
              tools: {
                merge_back: tool({
                  description:
                    "Publish your goal branch's commits onto the project's primary " +
                    "worktree branch. Runs `git merge <primary>` inside this " +
                    "worktree, then `git merge --ff-only` on the primary worktree, " +
                    "atomically under a host-side lock so concurrent goals do not " +
                    "race each other.\n\n" +
                    "Call this AFTER you have committed all your changes and your " +
                    "verification passed, and BEFORE calling report_build_result with status='passed'. It " +
                    "is the LAST git-affecting action of the session.\n\n" +
                    "Returns one of:\n" +
                    "  • {status:'merged', primary_head, primary_branch} — done; emit " +
                    "    report_build_result with status='passed'.\n" +
                    "  • {status:'conflict', primary_branch, primary_tip, " +
                    "    conflict_paths[]} — the merge hit textual conflicts. Your " +
                    "    worktree is now IN MERGING state: each path in conflict_paths " +
                    "    has `<<<<<<<`/`=======`/`>>>>>>>` markers in place. Edit each " +
                    "    path to remove the markers (keep both intentions where " +
                    "    possible; respect owned_paths), `git add <path>`, then once " +
                    "    all paths are resolved `git commit` — that finalizes the " +
                    "    merge. Call merge_back again to ff-publish into primary.\n" +
                    "  • {status:'blocked', reason, dirty_paths?, merge_head?} — repository state " +
                    "    prevents merge from starting; fix that exact state in this worktree.\n" +
                    "  • {status:'infra_error', reason} — infrastructure problem; report it " +
                    "    via report_build_result with status='failed'.",
                  inputSchema: z.object({}),
                  execute: executeMergeBack,
                }),
                ...createBuildRuntimeTools(),
              },
              getCollector: () => buildCollector,
              buildReport: buildBuildReport,
            }
          : {
              // Caller-owned worktrees (input.workDir set) skip merge_back — the
              // caller manages publishing. The agent prompt is gated on the
              // tool's presence so the LLM does not invent the call.
              tools: createBuildRuntimeTools(),
              getCollector: () => buildCollector,
              buildReport: buildBuildReport,
            }

      let out: { session: { id: string }; structured?: unknown; collector?: BuildCollector } | undefined
      let parsed: ReturnType<typeof BuildResultSchema.safeParse> | undefined
      let diffs: FileDiff[] | undefined
      // Dispatch fork: executor === "opencorvus" → in-process LLM via SessionPrompt
      // (the existing runAgentSession path with merge_back tool). Anything else
      // (claude-code, codex) → external CodingProvider; the provider edits files
      // in the worktree on its own, then BuildAgent runs merge_back itself
      // because the SDK has no way to call our merge_back tool.
      const executor = input.task.executor ?? "opencorvus"
      try {
        if (executor === "opencorvus") {
          out = await runAgentSession({
            kind: "build",
            core: withFactCheckRegistration(composeBuildCore(autoIteration)),
            sessionTitle: buildSessionTitle(input.target),
            sessionDirectory: worktreeDir!,
            existingSessionID: buildSession.id,
            parentSessionID: input.parentSessionID,
            // Goal-scoped builds need goalID on the session row so the
            // protocol bridge stamps it onto every part event; without it
            // the overlay's tree-writer cannot route the session card to
            // the goal's build phase and the parts orphan as a top-level
            // "构建" card. Direct-shape builds pass kind="task" → undefined.
            goalID: input.target.kind === "goal" ? input.target.id : undefined,
            taskID: input.task.id,
            model: input.model,
            signal: input.signal,
            toolKit: buildToolKit,
            buildUserPrompt: buildPromptText,
            buildUserParts: buildUserPartsFn,
            runtimeContract: {
              goalRunID: runtimeGoalRunID,
              attemptID: runtimeGoalRunID,
              contractKind: "stage-attempt",
              includeMcpTools: input.includeMcpTools,
              exactTools: input.exactRuntimeTools,
            },
            toolSwitches: input.toolSwitches,
            terminalTool: {
              toolName: "report_build_result",
              isSatisfied: (collector) => Boolean(collector.result),
              // Never restrict the toolset to just the terminal tool. Even
              // after merge_back succeeds the LLM might want to revise tests
              // or commit additional fixes; forcing a terminal-only scope is
              // host-side flow control (CLAUDE.md rule 13). The LLM decides
              // when it's done by calling report_build_result of its own
              // accord. Spec architecture-rework-loosening-plan-2026-05-06.md (B5).
              shouldExposeOnlyTerminalTool: () => false,
              // No recovery loop. Auto-retrying with a synthetic user prompt
              // when the LLM forgets to call report_build_result is a host-
              // side fallback (rule 7) that masks LLM failures with three
              // hard-coded turns (rule 13). When the agent doesn't terminate
              // properly, throw missing_terminal_report and let the
              // orchestrator LLM decide whether to retry the whole build or
              // change strategy. Spec ...md (B10).
            },
          })
          const report = buildToolKit.getCollector()
          out = { ...out, collector: report }
          parsed = BuildResultSchema.safeParse(report.result)
        } else {
          const externalOut = await runWithExternalProvider({
            executor,
            target: input.target,
            taskID: input.task.id,
            parentSessionID: input.parentSessionID,
            existingSessionID: buildSession.id,
            resumeExistingProviderSession: !!input.existingSessionID,
            worktreeDir: worktreeDir!,
            worktreeBranch,
            ownsWorktree,
            buildPromptText: buildExternalPromptText,
            signal: input.signal,
          })
          out = { session: { id: externalOut.sessionID }, structured: externalOut.structured }
          parsed = BuildResultSchema.safeParse(externalOut.structured)
          if (externalOut.mergedHead) mergedHead = externalOut.mergedHead
        }

        // Capture the goal's diff against its original baseRef while the
        // worktree's git dir is still healthy — overlay's per-goal acceptance
        // panel reads this; the orchestrator-facing tool result also renders
        // it as actual_changed_files. Always collect when the worktree
        // exists, regardless of status: the orchestrator LLM benefits from
        // seeing what the failed build *did* touch before failing, not just
        // when it claimed passed.
        if (ownsWorktree && worktreeDir && baseRef && parsed.success) {
          diffs = await collectGoalContributionDiffs(worktreeDir, baseRef).catch((err) => {
            log.warn("build agent: collectGoalDiffs failed — overlay panel will show empty file list", {
              taskID: input.task.id,
              error: err instanceof Error ? err.message : String(err),
            })
            return undefined
          })
        }
        // No host-side coverage audit. The orchestrator-facing tool result
        // surfaces both the LLM's self-reported files_changed and the host's
        // actual_changed_files (from `diffs`); the orchestrator LLM
        // cross-checks them and decides if the report is honest. CLAUDE.md
        // rule 13. Spec architecture-rework-loosening-plan-2026-05-06.md (B6).
      } catch (err) {
        // B8 compliance: when the opencorvus build session ends without
        // calling report_build_result, runAgentSession throws an
        // AgentRunError carrying Message.TerminalToolMissingError as
        // cause. Convert to a typed BuildAgentContractError so the
        // orchestrator's catch path (orchestrator/tools.ts) can recognise
        // it and write a phase=retry decision_log entry with the correct
        // failure-mode-specific guidance — instead of letting the LLM
        // mis-route through modify_goal and pollute the retry channel
        // with a generic "contract changed, re-read acceptance_specs"
        // template (root cause of tsk_e0033e523001flSn0onlHh4Urh's 5x
        // identical-prompt failure loop). Other AgentRunError shapes
        // (provider 4xx/5xx, abort, schema rejection) re-throw unchanged
        // — they have their own orchestrator-side handling. Spec
        // build-missing-terminal-signal-restore-2026-05-07.md §5.1.
        const contractErr = convertMissingTerminalToolError(err, {
          sessionID: out?.session?.id,
          lastMergeBackOutcome: lastMergeBackOutcome ?? null,
        })
        if (contractErr) throw contractErr
        throw err
      } finally {
        // Managed worktrees always preserve until the orchestrator cleans
        // them up (rule 22 — orchestrator owns cleanup; build agent does
        // not unilaterally delete). The earlier preserveWorktreeForRetry
        // boolean gated by mergedHead/mergeBackBlockedReport was a
        // host-side state machine; deleted in favour of "always preserve
        // when the worktree is goal-managed". Spec
        // architecture-rework-loosening-plan-2026-05-06.md (B9).
        if (ownsWorktree && worktreeDir) {
          log.info("build agent: preserving worktree — orchestrator owns cleanup", {
            taskID: input.task.id,
            worktreeDir,
            worktreeBranch,
            mergedHead: mergedHead ? mergedHead.slice(0, 12) : null,
          })
        }
      }

      if (!parsed || !parsed.success) {
        // External executors (codex / claude-code) host-synthesise the
        // BuildResult after the provider finishes; if the structured
        // output fails BuildResultSchema validation, that's a
        // provider-side bug — keep the generic Error throw so the
        // orchestrator's existing infra-error rethrow path surfaces it.
        // The opencorvus missing-terminal branch was previously here but
        // was unreachable: runAgentSession throws AgentRunError before
        // parsed is computed, so control never reached this block. The
        // opencorvus signal now flows through the catch block above.
        // Spec build-missing-terminal-signal-restore-2026-05-07.md §5.1.
        throw new Error(
          `build agent: ${executor === "opencorvus" ? "opencorvus report_build_result" : "external executor structured output"} did not match BuildResultSchema: ${
            parsed?.error ? formatBuildResultSchemaError(parsed.error) : "(no parsed output)"
          }`,
        )
      }
      const integrityRepairContractError = validateBuildIntegrityRepairReport(
        parsed.data,
        requiredIntegrityFingerprints,
      )
      if (integrityRepairContractError) {
        throw new Error(`build agent: integrity repair_report contract failed: ${integrityRepairContractError}`)
      }

      // commit_ref policy: in managed worktree mode, only the merged primary
      // HEAD is a valid published commit. If the LLM reported passed without
      // merge_back, the commit_ref is cleared so downstream readers don't
      // mistake a worktree tip for a published commit. The merge_back facts
      // (RunOutput.mergeBackStatus / publishedCommitRef) carry the truth.
      // No status flip — the orchestrator LLM reads both and decides.
      // CLAUDE.md rule 8/13. Spec ...md (B7 + B19).
      if (mergedHead && parsed.data.status === "passed") {
        parsed = {
          success: true as const,
          data: { ...parsed.data, commit_ref: mergedHead.slice(0, 12) },
        }
      } else if (ownsWorktree && worktreeBranch && parsed.data.status === "passed" && !mergedHead) {
        parsed = {
          success: true as const,
          data: { ...parsed.data, commit_ref: "" },
        }
      }

      log.info("build agent finished", {
        taskID: input.task.id,
        sessionID: out.session.id,
        status: parsed.data.status,
        commit_ref: parsed.data.commit_ref,
        testCount: parsed.data.tests.length,
        worktreeBranch,
        merged: Boolean(mergedHead),
      })

      // Merge-back fact summary for the orchestrator. mergeBackStatus is
      // derived from the same in-closure variables the prior guards used —
      // mergedHead set ⇒ "merged"; otherwise the lastMergeBackOutcome text
      // pattern indicates which stage failed. "not_invoked" covers both
      // caller-owned worktrees (no merge_back tool) and managed worktrees
      // where the agent never called the tool.
      const mergeBackStatus: RunOutput["mergeBackStatus"] = mergedHead
        ? "merged"
        : lastMergeBackOutcome
          ? lastMergeBackOutcome.startsWith("conflict")
            ? "conflict"
            : lastMergeBackOutcome.startsWith("blocked")
              ? "blocked"
              : lastMergeBackOutcome.startsWith("infra_error")
                ? "infra_error"
                : "not_invoked"
          : "not_invoked"

      // Worktree HEAD captured for the orchestrator independent of merge.
      let worktreeHead: string | undefined
      if (worktreeDir) {
        const result = await runGit(["rev-parse", "HEAD"], { cwd: worktreeDir, timeoutProfile: "fast" })
        const head = result.exitCode === 0 ? result.text().trim() : ""
        if (head) worktreeHead = head.slice(0, 12)
      }

      // Translate the contribution diff (already collected for acceptance
      // panel) into a compact host-truth files list. Render against the
      // contribution base, not baseRef..HEAD raw, so merge commits don't
      // attribute sibling-goal files to this build.
      const actualChangedFiles = diffs?.map((d) => ({
        path: d.file,
        status:
          d.status === "added" || d.status === "deleted" || d.status === "modified" ? d.status : ("modified" as const),
        additions:
          typeof (d as { additions?: number }).additions === "number" ? (d as { additions: number }).additions : 0,
        deletions:
          typeof (d as { deletions?: number }).deletions === "number" ? (d as { deletions: number }).deletions : 0,
      }))

      return {
        result: parsed.data,
        sessionID: out.session.id,
        worktreeDir: ownsWorktree ? worktreeDir : undefined,
        worktreeBranch: ownsWorktree ? worktreeBranch : undefined,
        worktreeBaseRef: ownsWorktree ? baseRef : undefined,
        diffs,
        mergeBackStatus,
        lastMergeBackOutcome,
        publishedCommitRef: mergedHead ? mergedHead.slice(0, 12) : undefined,
        worktreeHead,
        actualChangedFiles,
      }
    })
  }
}

function integrityBlockingFingerprintsFromFeedback(feedback: string | undefined): string[] {
  if (!feedback || feedback.trim().length === 0) return []
  const sectionStart = feedback.indexOf("Blocking fingerprints:")
  const source = sectionStart >= 0 ? feedback.slice(sectionStart) : feedback
  return [...new Set(source.match(/\bif_[a-f0-9]{16}\b/g) ?? [])].sort()
}

function externalBuildSystemContract(executor: Exclude<TaskRow["executor"], "opencorvus">): string {
  return [
    `You are the OpenCorvus external build executor running through ${executor}.`,
    "",
    "Your job is to implement the scoped build request in the current worktree, verify it, and commit the result on the worktree branch.",
    "",
    "Hard contract:",
    "- Treat the user prompt as a build contract, not as a chat request.",
    "- Read the files needed to confirm dependencies, local patterns, and implementation evidence, then edit the files required by the milestone.",
    "- For ports, migrations, rewrites, clones, parity fixes, or component translations, complete source/target investigation is implementation work: inspect every relevant source file/class, public property, event, data/API hook, styling rule, context-menu/right-click behavior, tests/examples, and existing target convention before writing.",
    "- Explain every changed file in the final report; shared-file edits are valid only when they preserve sibling-goal contracts and are explicitly justified.",
    "- In the final report, restate the detailed req/goal contract you actually handled and warn subsequent agents where to dig deeper for workload, hidden surfaces, evidence, and re-sizing risk.",
    "- Do not perform unrelated broad inventories or spawn exploratory subagents; keep investigation scoped to the source and target surfaces needed to implement the build contract.",
    "- If required source evidence is absent or incomplete, finish with a concise failure summary naming the missing evidence instead of inventing behavior or substituting guesses.",
    "- Keep reasoning, plans, prompt/rule details, and progress narration out of assistant text. Use tools to act.",
    "- Follow task-specific overlays in the user prompt when they are present. They are rendered from decision-log context and handoff artifacts for this attempt.",
    "- Run the acceptance commands from the prompt before claiming success.",
    "- Write shell commands for the actual platform and shell; on Windows/PowerShell use PowerShell-native commands instead of unverified Unix-only helpers such as head, sed, or grep.",
    "- On Windows, start Playwright only through Node Package Manager (`npm`), never through `bun`; Bun-started Playwright has a severe connection-timeout bug on Windows.",
    "- For any frontend project, each file-changing pass must open the task preview or task-scoped browser evidence route after edits and inspect the changed region plus surrounding layout context: parent container, adjacent components, spacing, typography, color, responsive framing, and local visual style.",
    "- Commit changes with a concrete commit message before finishing.",
    "- If the dependency contract is missing, verification fails, or you cannot commit, finish with a concise failure summary and the exact blocker.",
    "- Do not call OpenCorvus-only tools such as report_build_result or merge_back; the host will publish and synthesize the terminal BuildResult after your process exits.",
  ].join("\n")
}

// ---------------------------------------------------------------------------
// External CodingProvider dispatch
// ---------------------------------------------------------------------------

function externalEventMeta(event: CodingEventInfo): Record<string, unknown> {
  return "meta" in event ? (record(event.meta) ?? {}) : {}
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function externalToolMetadata(event: CodingEventInfo): Record<string, unknown> {
  const meta = externalEventMeta(event)
  return Object.keys(meta).length > 0 ? meta : {}
}

function externalToolInput(input: unknown): Record<string, unknown> {
  const parsed = structuredInput(input)
  if (typeof input === "string" && parsed.value === input) return { raw: input }
  return parsed
}

function externalToolResultName(event: Extract<CodingEventInfo, { type: "tool_result" }>): string {
  const meta = externalEventMeta(event)
  const named = event.name || stringField(meta.tool_name) || stringField(meta.tool) || stringField(meta.name)
  if (named) return named
  const itemType = stringField(meta.item_type)
  if (itemType === "commandExecution") return "Bash"
  if (itemType === "fileChange") return "FileEdit"
  if (itemType === "mcpToolCall") return "MCP"
  return "tool_result_without_matching_call"
}

function externalToolResultInput(event: Extract<CodingEventInfo, { type: "tool_result" }>): Record<string, unknown> {
  if (event.input !== undefined) return externalToolInput(event.input)
  const meta = externalEventMeta(event)
  const command = stringField(meta.command)
  if (command) return { command }
  if (meta.arguments !== undefined) return externalToolInput(meta.arguments)
  if (meta.input !== undefined) return externalToolInput(meta.input)
  return {}
}

function externalQuestionLine(question: Record<string, unknown>): string {
  const header = stringField(question.header) || stringField(question.id) || "Question"
  const text =
    stringField(question.question) ||
    stringField(question.message) ||
    stringField(question.label) ||
    "Additional input required"
  return `- ${header}: ${text}`
}

async function resolveExternalApproval(input: {
  provider: CodingProvider
  sessionID: string
  event: Extract<CodingEventInfo, { type: "approval_request" }>
}) {
  if (!input.provider.respond)
    throw new Error("external executor emitted an approval request but does not support respond()")
  const permission = input.event.approval || "external_executor"
  const pattern = input.event.message?.trim() || permission
  try {
    await PermissionNext.ask({
      sessionID: input.sessionID,
      permission,
      patterns: [pattern],
      metadata: input.event.meta ?? {},
      always: [pattern],
      ruleset: [{ permission, pattern: "*", action: "ask" }],
    })
    await input.provider.respond({
      sessionID: input.sessionID,
      requestID: input.event.id,
      kind: "approval",
      response: { decision: "accept" },
    })
  } catch (error) {
    await input.provider.respond({
      sessionID: input.sessionID,
      requestID: input.event.id,
      kind: "approval",
      response: {
        decision: "decline",
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

async function resolveExternalInput(input: {
  provider: CodingProvider
  executor: "codex" | "claude-code"
  sessionID: string
  event: Extract<CodingEventInfo, { type: "input_request" }>
}) {
  if (!input.provider.respond)
    throw new Error("external executor emitted an input request but does not support respond()")
  const result = await Question.askAndFormat({
    sessionID: input.sessionID,
    questions: externalQuestions(input.event),
  })
  if (!result.answers) {
    await input.provider.respond({
      sessionID: input.sessionID,
      requestID: input.event.id,
      kind: "input",
      error: {
        code: -32000,
        message: "Rejected by operator",
      },
    })
    return
  }

  const content = externalAnswerContent(input.event, result.answers)
  await input.provider.respond({
    sessionID: input.sessionID,
    requestID: input.event.id,
    kind: "input",
    response: inputResponse(input.executor, input.event, content),
  })
}

function externalQuestions(event: Extract<CodingEventInfo, { type: "input_request" }>): Question.Info[] {
  const raw = event.questions?.length
    ? event.questions
    : [
        {
          id: event.id,
          header: "Input",
          question: "Additional input required",
          requested_schema: event.meta?.requested_schema,
        },
      ]
  return raw.map((item, index) => {
    // Codex 0.125 elicitations (e.g. mcp_tool_call_approval) carry the choice
    // set inline as `options: [{label,description}, ...]`. Older protocols
    // (and ACP-style elicitations) put choices under a JSON-Schema enum at
    // `requested_schema.properties.*.enum`. The bypass flag does NOT cover
    // these elicitations as of codex-cli 0.125, so the host MUST surface a
    // real options list — otherwise the auto-reply machinery falls back to
    // free text, codex treats it as Cancel, the MCP tool never produces a
    // tool_result, and the build agent fails with "tool_call ... ended
    // without a matching tool_result". Inline options take precedence.
    const options = inlineOptions(item).length > 0 ? inlineOptions(item) : requestedSchemaOptions(item)
    return {
      header: stringField(item.header) || stringField(item.id) || `Input ${index + 1}`,
      question: stringField(item.question) || stringField(item.message) || "Additional input required",
      options,
      custom: options.length === 0,
    }
  })
}

function inlineOptions(question: Record<string, unknown>): Question.Option[] {
  const list = Array.isArray(question.options) ? question.options : []
  return list.flatMap((entry) => {
    if (typeof entry === "string" && entry) return [{ label: entry, description: entry }]
    const next = record(entry)
    if (!next) return []
    const label = stringField(next.label) || stringField(next.value) || stringField(next.id)
    if (!label) return []
    const description = stringField(next.description) || stringField(next.detail) || label
    return [{ label, description }]
  })
}

function requestedSchemaOptions(question: Record<string, unknown>): Question.Option[] {
  const schema = record(question.requested_schema) ?? record(question.requestedSchema)
  const properties = record(schema?.properties)
  if (!properties) return []
  const enums = Object.values(properties).flatMap((value) => {
    const next = record(value)
    return Array.isArray(next?.enum) ? next.enum.filter((item): item is string => typeof item === "string") : []
  })
  return [...new Set(enums)].map((label) => ({
    label,
    description: label,
  }))
}

function externalAnswerContent(event: Extract<CodingEventInfo, { type: "input_request" }>, answers: Question.Answer[]) {
  const keys = externalInputKeys(event)
  return Object.fromEntries(keys.map((key, index) => [key, (answers[index] ?? answers[0] ?? []).join(", ")]))
}

function externalInputKeys(event: Extract<CodingEventInfo, { type: "input_request" }>) {
  const schemaKeys = [
    ...requestedSchemaKeys(event.meta?.requested_schema),
    ...requestedSchemaKeys(event.meta?.requestedSchema),
  ]
  if (schemaKeys.length > 0) return schemaKeys
  const ids = (event.questions ?? [])
    .map((item) => stringField(item.id) || stringField(item.header))
    .filter((item): item is string => !!item)
  return ids.length > 0 ? ids : [event.id]
}

function requestedSchemaKeys(schemaInput: unknown) {
  const schema = record(schemaInput)
  const properties = record(schema?.properties)
  return properties ? Object.keys(properties) : []
}

function inputResponse(
  executor: "codex" | "claude-code",
  event: Extract<CodingEventInfo, { type: "input_request" }>,
  content: Record<string, string>,
) {
  if (executor === "claude-code") return { content }
  const adapter = stringField(event.meta?.adapter)
  if (adapter === "request_user_input" || event.meta?.requested_schema || event.meta?.requestedSchema) {
    return content
  }
  return { answers: Object.fromEntries(Object.entries(content).map(([key, value]) => [key, { answers: [value] }])) }
}

function singleLineText(value: string, limit = 220): string {
  const text = value.replace(/\s+/g, " ").trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

/**
 * Recognise an `AgentRunError` whose `cause` is a `Message.TerminalToolMissingError`
 * and convert it to a typed `BuildAgentContractError("missing_terminal_report")`
 * carrying a retry hint that names the actual failure mode.
 *
 * Returns null when the error is not a missing-terminal failure — the caller
 * MUST re-throw the original error in that case (provider 4xx/5xx, abort,
 * schema rejection all have their own orchestrator-side handling).
 *
 * The retry hint deliberately tells the next attempt:
 *   - read what's already in the worktree (prior attempts wrote files)
 *   - verify per acceptance_specs
 *   - complete via the standard terminal report tool, not turn-final prose
 *
 * This is the failure-mode-specific replacement for the generic
 * `modify_goal`-style "contract changed, re-read acceptance_specs" template
 * that orchestrator LLMs were defaulting to before this fix — that template
 * is correct for contract-change retries but misleads the next build agent
 * when the actual failure was missing the terminal tool call. Spec
 * build-missing-terminal-signal-restore-2026-05-07.md §5.1.
 */
export function convertMissingTerminalToolError(
  err: unknown,
  diagnostics: { sessionID?: string; lastMergeBackOutcome?: string | null },
): BuildAgentContractError | null {
  if (!(err instanceof AgentRunError)) return null
  const cause = err.cause
  if (!Message.TerminalToolMissingError.isInstance(cause as Error | undefined)) return null
  return new BuildAgentContractError(
    "missing_terminal_report",
    {
      sessionID: diagnostics.sessionID,
      lastMergeBackOutcome: diagnostics.lastMergeBackOutcome ?? null,
    },
    // Retry hint deliberately describes the failure fact and points
    // back at the standard build-agent contract instead of restating
    // prompt instructions inline (rule 8 single source — the protocol
    // text lives in BUILD_CORE; visible-brief hygiene forbids worker
    // agent source files from duplicating it).
    "Previous build session ended with finish=stop without producing the terminal " +
      "build report. Files already written to the goal worktree by prior attempt(s); " +
      "this turn MUST read/glob what is there and complete the build per the " +
      "standard build-agent contract (structured terminal report, not turn-final prose).",
  )
}

export function externalToolProtocolErrorMessage(input: {
  executor: string
  kind: "unmatched_result" | "unclosed_call"
  callID: string
  toolName?: string
}): string {
  const toolPart = input.toolName ? ` for ${input.toolName}` : ""
  if (input.kind === "unmatched_result") {
    return (
      `External executor protocol error (${input.executor}): tool_result id="${input.callID}"${toolPart} ` +
      "arrived without a prior tool_call; refusing to run host merge_back because tool telemetry is misaligned."
    )
  }
  return (
    `External executor protocol error (${input.executor}): tool_call id="${input.callID}"${toolPart} ` +
    "ended without a matching tool_result; refusing to run host merge_back because tool telemetry is incomplete."
  )
}

export function renderBuildAutoIterationMode(autoIteration: boolean): string {
  return [
    "## Auto Iteration Mode",
    autoIteration
      ? "- assistant.auto_iteration=true: after verification failures, continue focused repair attempts, including assigned dependency, toolchain, port, script, test, and worktree merge repairs, until every acceptance spec is satisfied or a concrete blocker remains."
      : '- assistant.auto_iteration=false: make one focused repair/verification pass, including any explicitly assigned stuck-state repair in this worktree, then report the exact remaining owner/action blocker through report_build_result(status="failed") if failures remain.',
  ].join("\n")
}

/** Single composition point for the Build session core: role/mechanism core +
 * the shared engineering-craft fragment + the dynamic auto-iteration mode.
 * Exported so the composition (and the single-source craft injection) is
 * directly assertable instead of grepping the call site (rule 9). */
export function composeBuildCore(autoIteration: boolean): string {
  return [BUILD_CORE, ENGINEERING_CRAFT, renderBuildAutoIterationMode(autoIteration)].join("\n\n")
}

/**
 * Project an external-executor `usage` event onto the active assistant
 * message row in place. External executors emit cumulative totals
 * (claude-agent at `result`; codex-app-server at each
 * `thread/tokenUsage/updated`), so the latest event wins — no
 * accumulation here, the executor already accumulated. Exported so the
 * mapping is unit-testable without spinning up a full external build.
 */
export function applyExternalUsageToAssistantMessage(
  assistantMessage: Message.Assistant,
  event: Extract<CodingEventInfo, { type: "usage" }>,
): void {
  if (typeof event.costUSD === "number" && Number.isFinite(event.costUSD)) {
    assistantMessage.cost = event.costUSD
  }
  if (event.inputTokens != null || event.outputTokens != null || event.totalTokens != null) {
    const input = event.inputTokens ?? assistantMessage.tokens.input
    const output = event.outputTokens ?? assistantMessage.tokens.output
    assistantMessage.tokens = {
      input,
      output,
      reasoning: assistantMessage.tokens.reasoning,
      total: event.totalTokens ?? input + output,
      cache: assistantMessage.tokens.cache,
    }
  }
}

export function externalEventPartText(event: CodingEventInfo, executor: string): string | undefined {
  // Progress events are intentionally NOT rendered as user-visible parts:
  // claude-code + codex both emit a stream of fine-grained "Phase: X" /
  // "Summary: Y" pings that bury the actual conversation under noise.
  // The events still flow through the events[] array (so logs/diagnostics
  // see them) — only the chat-card materialisation is dropped. Codex app-
  // server plan/diff deltas are model narration / previews, not a stable
  // build result channel; concrete actions already surface through tool
  // parts. Approval/input/error remain visible because those carry operator
  // decisions or blockers.
  if (event.type === "plan_delta") {
    return undefined
  }
  if (event.type === "diff_delta") {
    return undefined
  }
  if (event.type === "approval_request") {
    const lines = [`**${executor} approval request**`, "", `Approval: ${event.approval}`]
    if (event.message?.trim()) lines.push(`Message: ${event.message.trim()}`)
    return lines.join("\n")
  }
  if (event.type === "input_request") {
    const questions = (event.questions ?? []).map(externalQuestionLine)
    return [`**${executor} input request**`, "", ...questions].join("\n")
  }
  if (event.type === "usage") {
    // Token-meter pings flood the chat card with no operator-actionable
    // information (cost surfaces in run-level metrics already). Keep them in
    // events[] for diagnostics but do NOT materialise as a chat part.
    return undefined
  }
  if (event.type === "error") {
    return `**${executor} error**\n\n${event.message}`
  }
  return undefined
}

/**
 * Run the build by dispatching to a registered external CodingProvider
 * (claude-code SDK, codex CLI). The provider edits files inside `worktreeDir`
 * on its own; BuildAgent runs `merge_back` here because the SDK has no way
 * to call our merge tool from inside a sandboxed coding session.
 *
 * The provider's event stream is consumed until "done" or "error". Every
 * user-visible event is persisted as normal Session parts so overlay realtime
 * and hydrate paths share the same rendering model.
 *
 * Returns a synthesized `BuildResult` matching `BuildResultSchema` so the
 * post-run path is identical for OpenCorvus and external executors (rule 22:
 * single contract, multiple implementations).
 */
/**
 * External BuildResult factory — single source for the
 * `runWithExternalProviderImpl` return literals.
 *
 * Per specs/fact-check-agent-2026-05-25.md §6.1.3 (codex round 3/4):
 * external executors (codex / claude-code) do not participate in the
 * fact-check registration protocol — their structured output never carries
 * `fact_check_items`. We always emit `[]` here so the BuildResult contract
 * passes schema validation. This is NOT a runtime fallback ("if missing
 * inject default") which would be a rule 7 violation — it is a single
 * construction site that **always** sets the field at build time, just
 * like every other BuildResult field.
 *
 * Use these factories at every external-executor return point; do NOT
 * inline `fact_check_items: []` at individual `structured:` literals
 * (rule 8 single source).
 */
function makeExternalPassedBuildResult(input: {
  commit_ref: string
  summary: string
  files_changed: BuildFileChange[]
  tests: BuildTestResult[]
}) {
  return {
    status: "passed" as const,
    ...input,
    contract_restatement:
      "External executor completed against the persisted build prompt contract. Inspect the build user prompt, goal/request section, and changed files for the detailed req/goal scope.",
    followup_workload_guidance:
      "For follow-up agents: do not estimate remaining work from this synthesized summary alone. Read the build prompt, workload brief, diffs, verification evidence, and any unresolved executor events before planning more implementation.",
    fact_check_items: [],
  }
}

function makeExternalFailedBuildResult(input: {
  commit_ref: string
  summary: string
  tests: BuildTestResult[]
  error: string
  files_changed?: BuildFileChange[]
}) {
  return {
    status: "failed" as const,
    commit_ref: input.commit_ref,
    summary: input.summary,
    tests: input.tests,
    error: input.error,
    files_changed: input.files_changed ?? [],
    contract_restatement:
      "External executor failed while working against the persisted build prompt contract. Inspect the build user prompt, goal/request section, and failure evidence for the detailed req/goal scope.",
    followup_workload_guidance:
      "For follow-up agents: treat this failed external run as a workload-underestimation risk. Re-read the build prompt, workload brief, source evidence, failed merge or verification output, and consider workload_analysis / Architect re-sizing before another implementation pass.",
    fact_check_items: [],
  }
}

async function runWithExternalProvider(args: {
  executor: Exclude<TaskRow["executor"], "opencorvus">
  target: BuildTarget
  taskID: string
  parentSessionID?: string
  existingSessionID: string
  resumeExistingProviderSession: boolean
  worktreeDir: string
  worktreeBranch: string | undefined
  ownsWorktree: boolean
  buildPromptText: () => string
  signal?: AbortSignal
}): Promise<{ sessionID: string; structured: unknown; mergedHead?: string }> {
  // External-build dispatch boundary: surface terminal to the overlay when
  // the inner function returns (every return below structures failure as a
  // `failed` status rather than throwing) or throws. Mirrors agent/runner.ts
  // for the OpenCorvus executor path; without this the build session card
  // stays at idle (no checkmark) once the external provider stops streaming.
  // Idempotent: a later actor close just rewrites the same terminal status.
  let result: Awaited<ReturnType<typeof runWithExternalProviderImpl>>
  try {
    result = await runWithExternalProviderImpl(args)
  } catch (err) {
    // Inner threw before producing a sessionID — we don't know which session
    // to terminate. Actor close paths still cover this.
    throw err
  }
  const parsed = BuildResultSchema.safeParse(result.structured)
  if (parsed.success && parsed.data.status === "failed") {
    SessionStatus.set(result.sessionID, {
      type: "terminal",
      reason: "error",
      error: parsed.data.error,
    })
  } else {
    SessionStatus.set(result.sessionID, { type: "terminal", reason: "completed" })
  }
  return result
}

async function runWithExternalProviderImpl(args: {
  executor: Exclude<TaskRow["executor"], "opencorvus">
  target: BuildTarget
  taskID: string
  parentSessionID?: string
  existingSessionID: string
  resumeExistingProviderSession: boolean
  worktreeDir: string
  worktreeBranch: string | undefined
  ownsWorktree: boolean
  buildPromptText: () => string
  signal?: AbortSignal
}): Promise<{ sessionID: string; structured: unknown; mergedHead?: string }> {
  const { provider, options } = ExecutorRegistry.requireCoding(args.executor)

  const session = await Session.get(args.existingSessionID)
  if (session.kind !== "build") {
    throw new Error(`runWithExternalProvider: existing session ${session.id} has kind=${session.kind}, expected build`)
  }
  if ((session.goalID ?? undefined) !== (args.target.kind === "goal" ? args.target.id : undefined)) {
    throw new Error(
      `runWithExternalProvider: existing session ${session.id} has goalID=${session.goalID ?? "<unset>"}, expected ${args.target.kind === "goal" ? args.target.id : "<unset>"}`,
    )
  }
  if (session.directory !== args.worktreeDir) {
    throw new Error(
      `runWithExternalProvider: existing session ${session.id} has directory=${session.directory}, expected ${args.worktreeDir}`,
    )
  }

  log.info("build agent (external) starting", {
    executor: args.executor,
    taskID: args.taskID,
    sessionID: session.id,
    worktreeDir: args.worktreeDir,
  })

  // Create the user-message row first (carries the build prompt) so the
  // assistant's reply has a parent to thread under and overlay's tree-writer
  // can render the goal-build card with the prompt header.
  const promptText = args.buildPromptText()
  const userMessageID = Identifier.ascending("message")
  const userMessage: Message.User = {
    id: userMessageID,
    sessionID: session.id,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: args.executor, modelID: args.executor },
  }
  await Session.updateMessage(userMessage)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    sessionID: session.id,
    messageID: userMessageID,
    type: "text",
    text: promptText,
    kind: "user_content",
    source: "user",
  })

  const assistantMessageID = Identifier.ascending("message")
  const assistantMessage: Message.Assistant = {
    id: assistantMessageID,
    sessionID: session.id,
    role: "assistant",
    time: { created: Date.now() },
    parentID: userMessageID,
    modelID: args.executor,
    providerID: args.executor,
    agent: "build",
    path: { cwd: args.worktreeDir, root: Instance.worktree },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  await Session.updateMessage(assistantMessage)
  if (!args.resumeExistingProviderSession) {
    await persistExecutorSessionRef({
      sessionID: session.id,
      provider: args.executor,
    })
  }

  const prompt = promptText
  const events: CodingEventInfo[] = []
  let toolUseCount = 0
  let textCharCount = 0
  let doneOutput: string | undefined
  let errored: string | undefined
  const protocolErrors: string[] = []

  // Live tool tracker — external assistant narration is intentionally not
  // materialized as build-card parts. The visible build card is for concrete
  // tool activity, operator decisions, errors, and host terminal outcome.
  const tools = new Map<
    string,
    {
      id: string
      name: string
      input: Record<string, unknown>
      raw: string
      metadata: Record<string, unknown>
      start: number
    }
  >()

  const appendExternalEventPart = async (event: CodingEventInfo) => {
    const text = externalEventPartText(event, args.executor)
    if (!text) return
    await Session.updatePart({
      id: Identifier.ascending("part"),
      sessionID: session.id,
      messageID: assistantMessageID,
      type: "text",
      text,
      kind: "control",
      source: "system",
      metadata: {
        executor: args.executor,
        eventType: event.type,
        meta: externalEventMeta(event),
      },
    })
  }

  const orchCfg = await EngineConfig.get()
  const config = await EffectiveConfig.effective({ taskID: args.taskID, sessionID: args.existingSessionID })
  const buildAgent = await Agent.get("build", { config })
  const userAppend = buildAgent?.promptAppend
  const baseSystem = resolveOption<string>(options.system)
  const projectInstructions = await InstructionPrompt.system()
  const systemWithAutoIteration = [
    baseSystem,
    renderBuildAutoIterationMode(orchCfg.auto_iteration === true),
    ...projectInstructions,
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n\n")
  const composedSystem = BuildAgent.composeExternalCodingSystem({
    executor: args.executor,
    baseSystem: systemWithAutoIteration,
    userAppend,
  })

  const configuredTools = resolveOption(options.tools)
  // Per-build idle gate. The external executor's `provider.run` yields events
  // by streaming over its own subprocess stdio; if the LLM-side connection
  // stalls (e.g. the 2026-04-27 codex benchmark caught a build subprocess
  // sitting silent for 47+ minutes with sessions=[]), the for-await loop
  // would wait forever because `args.signal` only fires on caller cancel,
  // not on stream inactivity. Compose `args.signal` with a fresh
  // `withStreamActivity` watchdog (idleMs = activity.executor_events_idle_ms,
  // the layer reserved for external executor event queues per
  // engine/config.ts §86) and feed `gate.signal` to the provider so codex /
  // claude-code subprocesses receive the abort the same way they receive
  // a caller cancel — no new error surface, the existing catch maps the
  // AbortError to `errored` and the build returns status=failed.
  const idleMs = orchCfg.activity.executor_events_idle_ms
  const gate = withStreamActivity({
    idleMs,
    signal: args.signal,
    label: `build-agent-external:${args.executor}:${session.id}`,
  })
  const unregisterActivityGate = SessionStatus.registerActivityGate(session.id, gate)
  const runInput = {
    sessionID: session.id,
    model: resolveOption(options.model),
    prompt,
    taskID: args.taskID,
    logicalSessionID: session.id,
    runtimeDir: ProjectRuntimePaths.sessionRoot(Instance.directory, args.taskID, session.id),
    worktreeDir: args.worktreeDir,
    cwd: args.worktreeDir,
    system: composedSystem.system,
    maxTurns: resolveOption(options.maxTurns),
    tools: configuredTools,
    signal: gate.signal,
  }
  const providerInput = args.resumeExistingProviderSession
    ? {
        ...runInput,
        sessionID: resolveNativeResumeRef(args.executor, await readExecutorSessionRef(session.id)),
      }
    : runInput

  log.info("build agent (external) provider input ready", {
    executor: args.executor,
    executorModel: providerInput.model ?? null,
    taskID: args.taskID,
    sessionID: session.id,
    providerSessionID: providerInput.sessionID,
    resume: args.resumeExistingProviderSession,
    toolCount: configuredTools?.length ?? 0,
    mcpPromptInjected: composedSystem.mcpPromptInjected,
    systemChars: composedSystem.system?.length ?? 0,
  })

  try {
    const stream = args.resumeExistingProviderSession ? provider.resume(providerInput) : provider.run(providerInput)
    for await (const event of abortableIterable(stream, gate.signal)) {
      gate.observe()
      events.push(event)
      const sessionRef = extractExecutorSessionRef(event)
      if (sessionRef) {
        await persistExecutorSessionRef({
          sessionID: session.id,
          provider: args.executor,
          ref: sessionRef,
        }).catch((error) => {
          log.warn("build agent (external): persist executor session ref failed", {
            executor: args.executor,
            taskID: args.taskID,
            sessionID: session.id,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }
      switch (event.type) {
        case "text_delta": {
          textCharCount += event.text.length
          break
        }
        case "reasoning_delta": {
          break
        }
        case "tool_call": {
          toolUseCount += 1
          const existing = tools.get(event.id)
          const partID = existing?.id ?? Identifier.ascending("part")
          const start = existing?.start ?? Date.now()
          const inputObj = externalToolInput(event.input)
          const metadata = { ...(existing?.metadata ?? {}), ...externalToolMetadata(event) }
          tools.set(event.id, {
            id: partID,
            name: event.name,
            input: inputObj,
            raw: existing?.raw ?? "",
            metadata,
            start,
          })
          await Session.updatePart({
            id: partID,
            sessionID: session.id,
            messageID: assistantMessageID,
            type: "tool",
            tool: event.name,
            callID: event.id,
            state: {
              status: "running",
              input: inputObj,
              metadata,
              time: { start },
            },
            metadata,
          })
          break
        }
        case "tool_delta": {
          const existing = tools.get(event.id)
          const partID = existing?.id ?? Identifier.ascending("part")
          const start = existing?.start ?? Date.now()
          const name = event.name ?? existing?.name ?? "tool"
          const raw = (existing?.raw ?? "") + event.delta
          const metadata = { ...(existing?.metadata ?? {}), ...externalToolMetadata(event) }
          if (!existing) {
            tools.set(event.id, { id: partID, name, input: {}, raw, metadata, start })
            await Session.updatePart({
              id: partID,
              sessionID: session.id,
              messageID: assistantMessageID,
              type: "tool",
              tool: name,
              callID: event.id,
              state: {
                status: "running",
                input: {},
                metadata,
                time: { start },
              },
              metadata,
            })
          } else {
            tools.set(event.id, { ...existing, name, raw, metadata })
          }
          await Session.updatePartDelta({
            sessionID: session.id,
            messageID: assistantMessageID,
            partID,
            field: "raw",
            delta: event.delta,
          })
          break
        }
        case "tool_result": {
          const t = tools.get(event.id)
          const end = Date.now()
          const name = t?.name ?? externalToolResultName(event)
          const input = t?.input ?? externalToolResultInput(event)
          const metadata = { ...(t?.metadata ?? {}), ...externalToolMetadata(event) }
          if (!t) {
            const protocolError = externalToolProtocolErrorMessage({
              executor: args.executor,
              kind: "unmatched_result",
              callID: event.id,
              toolName: name,
            })
            protocolErrors.push(protocolError)
            await Session.updatePart({
              id: Identifier.ascending("part"),
              sessionID: session.id,
              messageID: assistantMessageID,
              type: "tool",
              tool: name,
              callID: event.id,
              state: {
                status: "error",
                input,
                failure: toolFailureCauseFromUnknown({
                  error: `${protocolError} Output preview: ${singleLineText(event.output)}`,
                  originSite: "build.agent.executor-unmatched-result",
                  classification: "processor-contract",
                  kind: "processor-lost-parts",
                  data: { callID: event.id, toolName: name },
                }),
                metadata: {
                  ...metadata,
                  protocol_error: "unmatched_tool_result",
                  output: event.output,
                },
                time: { start: end, end },
              },
              metadata: {
                ...metadata,
                protocol_error: "unmatched_tool_result",
              },
            })
            errored = protocolError
            break
          }
          await Session.updatePart({
            id: t.id,
            sessionID: session.id,
            messageID: assistantMessageID,
            type: "tool",
            tool: name,
            callID: event.id,
            state: {
              status: "completed",
              input,
              output: event.output,
              title: name,
              metadata,
              time: { start: t?.start ?? end, end },
            },
            metadata,
          })
          tools.delete(event.id)
          break
        }
        case "progress":
        case "plan_delta":
        case "diff_delta":
          await appendExternalEventPart(event)
          break
        case "usage": {
          applyExternalUsageToAssistantMessage(assistantMessage, event)
          await Session.updateMessage(assistantMessage)
          break
        }
        case "approval_request":
          await appendExternalEventPart(event)
          await resolveExternalApproval({ provider, sessionID: session.id, event })
          break
        case "input_request":
          await appendExternalEventPart(event)
          await resolveExternalInput({ provider, executor: args.executor, sessionID: session.id, event })
          break
        case "done":
          doneOutput = event.output ?? undefined
          break
        case "error":
          await appendExternalEventPart(event)
          errored = event.message
          break
      }
      if (errored || event.type === "done" || event.type === "error") break
    }
  } catch (err) {
    errored = err instanceof Error ? err.message : String(err)
  } finally {
    unregisterActivityGate()
    gate.dispose()
  }

  // Finalize any open tool parts so overlay sees the closing state.
  for (const [callID, t] of tools) {
    const end = Date.now()
    const protocolError = externalToolProtocolErrorMessage({
      executor: args.executor,
      kind: "unclosed_call",
      callID,
      toolName: t.name,
    })
    protocolErrors.push(protocolError)
    await Session.updatePart({
      id: t.id,
      sessionID: session.id,
      messageID: assistantMessageID,
      type: "tool",
      tool: t.name,
      callID,
      state: {
        status: "error",
        input: Object.keys(t.input).length > 0 ? t.input : externalToolInput(t.raw),
        failure: toolFailureCauseFromUnknown({
          error: protocolError,
          originSite: "build.agent.executor-unmatched-call",
          classification: "processor-contract",
          kind: "processor-lost-parts",
          data: { callID, toolName: t.name },
        }),
        metadata: t.metadata,
        time: { start: t.start, end },
      },
      metadata: t.metadata,
    })
  }
  if (!errored && protocolErrors.length > 0) errored = protocolErrors.join("\n")
  await Session.updateMessage({ ...assistantMessage, time: { ...assistantMessage.time, completed: Date.now() } })

  if (errored) {
    log.warn("build agent (external) errored before merge", {
      executor: args.executor,
      taskID: args.taskID,
      sessionID: session.id,
      error: errored,
    })
    return {
      sessionID: session.id,
      structured: makeExternalFailedBuildResult({
        commit_ref: "",
        summary: `external executor ${args.executor} stopped before host merge_back: ${singleLineText(errored)}`,
        tests: [],
        error: errored,
      }),
    }
  }

  // External provider finished without error; BuildAgent owns merge_back.
  if (!args.ownsWorktree || !args.worktreeBranch) {
    // Caller-owned worktree: skip merge here, caller will publish.
    // files_changed=[] is now legal (B1); the orchestrator-facing build
    // tool result surfaces the host's actual_changed_files separately,
    // so a synthesized placeholder file entry is redundant misinformation.
    // Spec architecture-rework-loosening-plan-2026-05-06.md (B18).
    return {
      sessionID: session.id,
      structured: makeExternalPassedBuildResult({
        commit_ref: "",
        summary:
          doneOutput?.trim() ||
          `external executor ${args.executor} completed (${events.length} events, ${toolUseCount} tool-uses, ${textCharCount} chars)`,
        files_changed: [],
        tests: [],
      }),
    }
  }

  let mergedHead: string | undefined
  const mergeCallID = Identifier.ascending("call")
  const mergePartID = Identifier.ascending("part")
  const mergeStarted = Date.now()
  const mergeInput = {
    branch: args.worktreeBranch,
    worktreeDir: args.worktreeDir,
    executor: args.executor,
  }
  const mergeMetadata = {
    source: "host",
    executor: args.executor,
    operation: "merge_back",
  }
  await Session.updatePart({
    id: mergePartID,
    sessionID: session.id,
    messageID: assistantMessageID,
    type: "tool",
    tool: "merge_back",
    callID: mergeCallID,
    state: {
      status: "running",
      input: mergeInput,
      title: `publishing ${args.worktreeBranch}`,
      metadata: mergeMetadata,
      time: { start: mergeStarted },
    },
    metadata: mergeMetadata,
  })
  const completeMergePart = async (output: unknown, title: string) => {
    await Session.updatePart({
      id: mergePartID,
      sessionID: session.id,
      messageID: assistantMessageID,
      type: "tool",
      tool: "merge_back",
      callID: mergeCallID,
      state: {
        status: "completed",
        input: mergeInput,
        output: JSON.stringify(output, null, 2),
        title,
        metadata: mergeMetadata,
        time: { start: mergeStarted, end: Date.now() },
      },
      metadata: mergeMetadata,
    })
  }

  const outcome = await Worktree.mergeSafely({
    branch: args.worktreeBranch,
    worktreeDir: args.worktreeDir,
  })
  if (outcome.status === "merged") {
    mergedHead = outcome.primaryHead
    const output = {
      status: "merged" as const,
      primary_head: outcome.primaryHead,
      primary_branch: outcome.primaryBranch,
      ...(outcome.primaryRecoveryCommit ? { primary_recovery_commit: outcome.primaryRecoveryCommit } : {}),
    }
    await completeMergePart(output, `merged ${outcome.primaryBranch}@${outcome.primaryHead.slice(0, 12)}`)
  } else if (outcome.status === "conflict") {
    const pathList = outcome.conflictPaths.join(", ")
    const output = {
      status: "conflict" as const,
      primary_branch: outcome.primaryBranch,
      primary_tip: outcome.primaryTip,
      conflict_paths: outcome.conflictPaths,
      hint:
        "Worktree is preserved in MERGING state. The next agent attempt must edit the listed paths, " +
        "git add them, git commit to finalize the merge, then retry merge_back.",
    }
    await completeMergePart(output, `conflict ${args.worktreeBranch} -> ${outcome.primaryBranch}`)
    return {
      sessionID: session.id,
      structured: makeExternalFailedBuildResult({
        commit_ref: "",
        summary:
          `merge_back hit conflicts on ${args.worktreeBranch} → ${outcome.primaryBranch} ` +
          `(${outcome.conflictPaths.length} conflict${outcome.conflictPaths.length === 1 ? "" : "s"}): ${pathList}`,
        tests: [],
        error:
          `Merge left ${args.worktreeDir} in MERGING state against ${outcome.primaryBranch} ` +
          `(tip ${outcome.primaryTip.slice(0, 12)}); conflict paths: ${pathList}. ` +
          `Resolve markers in this same worktree, git add, and git commit before retrying.`,
      }),
    }
  } else if (outcome.status === "blocked") {
    const output = {
      status: "blocked" as const,
      reason: outcome.reason,
      branch: outcome.branch,
      worktree_dir: outcome.worktreeDir,
      ...(outcome.dirtyPaths ? { dirty_paths: outcome.dirtyPaths } : {}),
      ...(outcome.mergeHead ? { merge_head: true } : {}),
    }
    await completeMergePart(output, `blocked ${args.worktreeBranch}`)
    return {
      sessionID: session.id,
      structured: makeExternalFailedBuildResult({
        commit_ref: "",
        summary: `merge_back blocked for ${args.worktreeBranch}: ${outcome.reason}`,
        tests: [],
        error:
          `${outcome.reason}. Worktree preserved at ${outcome.worktreeDir}; ` +
          `the next attempt must resolve that repository state before retrying merge_back.`,
      }),
    }
  } else {
    const output = {
      status: "infra_error" as const,
      reason: outcome.reason,
      branch: outcome.branch,
      ...(outcome.stderr ? { stderr: outcome.stderr } : {}),
    }
    await completeMergePart(output, `infra_error ${args.worktreeBranch}`)
    return {
      sessionID: session.id,
      structured: makeExternalFailedBuildResult({
        commit_ref: "",
        summary: `merge_back returned status=infra_error for ${args.worktreeBranch}: ${outcome.reason}`,
        tests: [],
        error: outcome.reason,
      }),
    }
  }

  // External executors don't go through report_build_result, so we cannot
  // get the LLM's per-file explanations. Empty files_changed is honest
  // (B1 makes it legal); the orchestrator-facing build tool result still
  // shows the host's actual_changed_files (computed from baseRef..HEAD)
  // alongside this report, so the orchestrator LLM has the truth without
  // the synthesized placeholder. Spec ...md (B18).
  return {
    sessionID: session.id,
    structured: makeExternalPassedBuildResult({
      commit_ref: mergedHead.slice(0, 12),
      summary:
        doneOutput?.trim() ||
        `external executor ${args.executor} completed (${events.length} events, ${toolUseCount} tool-uses, ${textCharCount} chars)`,
      files_changed: [],
      tests: [],
    }),
    mergedHead,
  }
}

function resolveOption<T>(input: T | (() => T | undefined) | undefined): T | undefined {
  if (typeof input === "function") return (input as () => T | undefined)()
  return input
}

// ---------------------------------------------------------------------------
// Diff collection
// ---------------------------------------------------------------------------

/**
 * Collect per-file diffs for the goal's own contribution.
 *
 * When merge_back reconciles a stale goal branch with an already-advanced
 * primary branch, git produces a merge commit whose second parent is the
 * primary tip that was merged in. Auditing `baseRef..HEAD` after that point
 * falsely attributes sibling-goal files to this build session. The correct
 * collaboration boundary is the contribution this goal adds on top of that
 * merged primary tip: `HEAD^2..HEAD` for merge commits produced by
 * Worktree.mergeSafely, and `baseRef..HEAD` when no integration merge was
 * needed.
 */
export async function collectGoalContributionDiffs(worktreeDir: string, baseRef: string): Promise<FileDiff[]> {
  const contributionBase = await resolveGoalContributionBaseRef(worktreeDir, baseRef)
  return collectGoalDiffs(worktreeDir, contributionBase)
}

export async function resolveGoalContributionBaseRef(worktreeDir: string, baseRef: string): Promise<string> {
  const env = gitCeilingEnvForWorktree(worktreeDir)
  const parentsResult = await runGit(["show", "--no-patch", "--pretty=%P", "HEAD"], {
    cwd: worktreeDir,
    env,
    timeoutProfile: "fast",
  })
  const parentsRaw = parentsResult.exitCode === 0 ? parentsResult.text().trim() : ""
  const parents = parentsRaw.split(/\s+/).filter(Boolean)
  return parents.length >= 2 ? parents[1]! : baseRef
}

/**
 * Collect per-file diffs for a ref range as `baseRef..HEAD`.
 * Returns FileDiff objects with full before/after blobs so the overlay's
 * goal-run acceptance endpoint can serve diff previews without a separate
 * git read at click time. Mirrors the shape of `Snapshot.diffFull` so the
 * existing `viewAcceptance` / overlay diff service consume the same schema
 * as the task-level acceptance path.
 *
 * Filters out worktree scratch (`.opencorvus/`) so the panel doesn't list
 * worktree-internal files like ownership markers.
 */
async function collectGoalDiffs(worktreeDir: string, baseRef: string): Promise<FileDiff[]> {
  const env = gitCeilingEnvForWorktree(worktreeDir)
  const headResult = await runGit(["rev-parse", "HEAD"], { cwd: worktreeDir, env, timeoutProfile: "fast" })
  const headRaw = headResult.exitCode === 0 ? headResult.text().trim() : ""
  if (!headRaw || headRaw === baseRef) return []

  const status = new Map<string, "added" | "deleted" | "modified">()
  const statusResult = await runGit(
    [
      "-c",
      "core.quotepath=false",
      "diff",
      "--no-ext-diff",
      "--name-status",
      "--no-renames",
      baseRef,
      headRaw,
      "--",
      ".",
    ],
    { cwd: worktreeDir, env, timeoutProfile: "default" },
  )
  const statusOut = statusResult.exitCode === 0 ? statusResult.text().trim() : ""
  for (const line of statusOut.split("\n")) {
    if (!line) continue
    const [code, file] = line.split("\t")
    if (!code || !file) continue
    const kind = code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified"
    status.set(file, kind)
  }

  const numstatResult = await runGit(
    ["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--no-renames", "--numstat", baseRef, headRaw, "--", "."],
    { cwd: worktreeDir, env, timeoutProfile: "default" },
  )
  const numstatOut = numstatResult.exitCode === 0 ? numstatResult.text().trim() : ""

  const result: FileDiff[] = []
  for (const line of numstatOut.split("\n")) {
    if (!line) continue
    const [additions, deletions, file] = line.split("\t")
    if (!file) continue
    if (ProjectRuntimePaths.isInternalRuntimeRelativePath(file)) continue
    if (ProjectRuntimePaths.isEvidenceInputRelativePath(file)) continue
    const isBinary = additions === "-" && deletions === "-"
    const before = isBinary
      ? ""
      : (await runGit(["show", `${baseRef}:${file}`], { cwd: worktreeDir, env, timeoutProfile: "default" })).text()
    const after = isBinary
      ? ""
      : (await runGit(["show", `${headRaw}:${file}`], { cwd: worktreeDir, env, timeoutProfile: "default" })).text()
    const added = isBinary ? 0 : parseInt(additions, 10)
    const removed = isBinary ? 0 : parseInt(deletions, 10)
    result.push({
      file,
      before,
      after,
      additions: Number.isFinite(added) ? added : 0,
      deletions: Number.isFinite(removed) ? removed : 0,
      status: status.get(file) ?? "modified",
    })
  }
  return result
}

// ---------------------------------------------------------------------------
// Prompt / label helpers
// ---------------------------------------------------------------------------

function labelFromTarget(target: BuildTarget): string {
  if (target.kind === "goal") {
    const slug = target.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32)
    return slug || target.id.slice(-8)
  }
  const slug = target.text
    .toLowerCase()
    .slice(0, 32)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "request"
}

function buildSessionTitle(target: BuildTarget): string {
  if (target.kind === "goal") return `Build: ${target.title}`
  const snippet = target.text.slice(0, 60).replace(/\s+/g, " ").trim()
  return `Build: ${snippet}${target.text.length > 60 ? "…" : ""}`
}

function compactLine(value: string, max = 320): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max)}…`
}

function renderGoalWorkloadBriefSection(wlBrief: WorkloadBrief | undefined): string {
  if (!wlBrief) return ""
  const inv = wlBrief.execution_inventory
  const lines: string[] = []
  lines.push("## Goal Workload Brief — scope this BEFORE you implement")
  lines.push("")
  lines.push(
    "Read this first. It is the goal-local workload inventory; do not bury it under the full upstream spec or stop at the obvious components.",
  )
  if (wlBrief.why_not_smaller.length > 0) {
    lines.push("")
    lines.push("Why it is not smaller:")
    for (const w of wlBrief.why_not_smaller) lines.push(`- ${w}`)
  }
  if (wlBrief.underestimation_traps.length > 0) {
    lines.push("")
    lines.push("Underestimation traps:")
    for (const t of wlBrief.underestimation_traps) lines.push(`- ${t}`)
  }
  lines.push("")
  lines.push(
    `Work surface (all required): ${inv.surfaces} surfaces / ${inv.states} states / ${inv.data_contracts} data contracts / ${inv.verification_points} verification points`,
  )
  if (wlBrief.verification_inventory.length > 0) {
    lines.push("")
    lines.push("Verify before reporting pass:")
    for (const v of wlBrief.verification_inventory) lines.push(`- ${v}`)
  }
  const refs = wlBrief.references
  const readDeeper: string[] = []
  if (refs.contract_ids.length > 0) readDeeper.push(`architect contracts ${refs.contract_ids.join(", ")}`)
  if (refs.reference_coverage_ids.length > 0)
    readDeeper.push(`reference coverage ${refs.reference_coverage_ids.join(", ")}`)
  if (refs.prd_sections.length > 0) readDeeper.push(`frontend-template.md sections ${refs.prd_sections.join(", ")}`)
  if (readDeeper.length > 0) {
    lines.push("")
    lines.push(`Read deeper (do not skim): ${readDeeper.join(" · ")}`)
  }
  return lines.join("\n")
}

function renderBuildRequirementsSection(
  reqs: NonNullable<BuildAgent.BuildContext["requirements"]>,
  options: { directRequest?: boolean } = {},
): string {
  if (reqs.length === 0) return ""
  const lines: string[] = []
  lines.push("## Requirements / PRD Coverage Contract")
  lines.push("")
  lines.push(
    "Read this before editing. These active REQ-N rows are the implementation contract derived from the user's request and upstream PRD evidence. For this build attempt, map each requirement that touches your goal/request to concrete files, behavior, UI surfaces, data, styles, interactions, and verification evidence before reporting success.",
  )
  lines.push(
    "Do not treat PRD/research/design material as optional background. If a requirement, evidence_ref, or acceptance line is unclear, missing from the worktree, or contradicted by available source/design evidence, fail with the concrete blocker or repair the assigned source; do not silently implement a simpler interpretation.",
  )
  lines.push(
    "For UI/webpage work, read the PRD/frontend_design material and any frontend_research investigation packets in page chunks before editing: identify the component kind for each chunk, verify the referenced evidence, then implement the matching component and content. All visible content must be componentized and fed by props, data modules, fixtures, or API adapters instead of hardcoded directly into page wrappers, generated SVG, or one-off JSX literals. Charts, maps, heatmaps, geographic visualizations, tables/grids, tabs, menus, modals, forms, and carousels must remain real components with data/state/interaction contracts. Do not replace a chart/map/heatmap with a flat SVG/image/decorative vector unless verified PRD/design evidence says it is static decoration.",
  )
  lines.push(
    "Respect the source-authority split: PRD/frontend_design contracts define user-facing semantics for global layout intent, component functions, content/data, states, and interactions; skeleton/source-dom/source IR evidence defines implementation facts such as source ids, region geometry, source-ir/style-profile.json, CSS, assets, browser state snapshots, and pixel consistency. Frontend_research packets are coverage and investigation prompts, not a separate fact source. When sources conflict, preserve the PRD/component/design contract and use source evidence to repair measured style/layout/assets.",
  )
  if (options.directRequest) {
    lines.push(
      "This direct build path still must honor the active requirements when they are present; the raw request text is not permission to bypass the persisted PRD/REQ contract.",
    )
  }
  lines.push("")
  for (const r of reqs) {
    lines.push(`- **${r.id}** [${r.type}]: ${r.description}`)
    if (r.acceptance.trim().length > 0) lines.push(`  Acceptance: ${r.acceptance}`)
    if (r.non_goals.trim().length > 0) lines.push(`  Non-goals: ${r.non_goals}`)
    const evidenceRefs = r.evidence_refs ?? []
    if (evidenceRefs.length > 0) lines.push(`  Evidence refs: ${evidenceRefs.join(", ")}`)
  }
  lines.push("")
  return lines.join("\n")
}

type BuildReferenceAttachment = {
  sha?: string
  url: string
  mime: string
  size?: number
  filename?: string
  intent?: string
  source?: string
}

function collectBuildReferenceAttachments(task: TaskRow): BuildReferenceAttachment[] {
  const taskAttachments = Array.isArray(task.attachments)
    ? (task.attachments as Array<Partial<BuildReferenceAttachment>>)
    : []
  const designArtifacts = (
    Array.isArray(task.system_artifacts) ? (task.system_artifacts as Array<Partial<BuildReferenceAttachment>>) : []
  ).filter((item) => item.intent === "visual_reference")

  const seen = new Set<string>()
  const merged: BuildReferenceAttachment[] = []
  for (const item of [...taskAttachments, ...designArtifacts]) {
    if (typeof item?.url !== "string" || typeof item?.mime !== "string") continue
    const key = item.sha ?? item.url
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({ ...item, url: item.url, mime: item.mime })
  }
  return merged
}

/**
 * Render an UNCONDITIONAL visual-contract preamble, prepended to the build
 * agent's user prompt whenever this dispatch carries multimodal references
 * (image / pdf / etc.). The static system prompt's reference-fidelity
 * language is conditional ("If the prompt depends on screenshots…"); models
 * frequently judge their way out of the condition and treat references as
 * inspiration. The preamble removes the judgement call: when this branch
 * runs, attachments demonstrably exist; restoration is therefore not
 * optional. Filenames are listed so the model cannot pretend "no specific
 * image was named". Only image/pdf-shaped MIMEs are listed — text/JSON
 * attachments take a different prompt path (read_attachment / inline).
 *
 * `mode`:
 *   - `"inlined"` (opencorvus in-process build): file parts are inlined in
 *     the user message above this text. Tell the LLM it can look at them
 *     directly and fail loudly if it can't.
 *   - `"staged-only"` (external coding providers — codex, claude-code):
 *     no inline file parts in the protocol; the bytes only exist on disk
 *     in the goal worktree's `references/` directory. Tell the LLM where
 *     to read them and require it to actually open them before claiming
 *     the visual is done.
 */
export type VisualContractMode = "inlined" | "staged-only"

export function renderVisualContractPreamble(
  attachments: ReadonlyArray<{ mime: string; filename?: string; size?: number; sha?: string }>,
  options: { mode?: VisualContractMode } = {},
): string {
  if (attachments.length === 0) return ""
  const visual = attachments.filter(
    (a) => typeof a?.mime === "string" && (a.mime.startsWith("image/") || a.mime === "application/pdf"),
  )
  if (visual.length === 0) return ""
  const mode = options.mode ?? "inlined"
  const sourceLine =
    mode === "inlined"
      ? "The file(s) below are inlined above as multimodal parts AND staged on disk under `references/`."
      : "The file(s) below are staged on disk under `references/<filename>`. Your runtime cannot inline them as multimodal message parts — you MUST open each one through the project's read tool / image-viewing tool before producing UI code."
  const lines: string[] = [
    "## Visual Reference Contract (binding for this dispatch)",
    "",
    sourceLine,
    "They are the authoritative visual target for this dispatch — restore their pixels 1:1 within stack constraints.",
    'NOT inspiration. NOT optional. Restoring something that "looks vaguely similar" is a verified failure, not partial credit.',
    "",
    'Reference each file by its `references/<filename>` relative path in the code you emit (`<img src="references/foo.png">`, `<image href="references/foo.png">`, `./references/foo.png` for file reads). When the deliverable\'s runtime needs a different layout, copy the file into the asset directory with a real `write` / `bash` step — the source bytes still come from `references/`. Never inline a staged asset as `data:<mime>;base64,...` (or any other base64 / hex-encoded form) inside generated SVG, HTML, JSON, PowerShell, shell scripts, or any other emitted artifact. That regression mirrors the `InlineBase64InPartError` the session write-path already rejects and will fail verification just the same.',
    "",
  ]
  for (const att of visual) {
    const name = att.filename ?? att.sha ?? "(unnamed attachment)"
    const size = typeof att.size === "number" ? ` — ${att.size} bytes` : ""
    lines.push(`- ${name} (${att.mime}${size})`)
  }
  lines.push("")
  if (mode === "inlined") {
    lines.push(
      "If you cannot read the pixels from the inlined file part (model is not",
      "vision-capable, decode failure, etc.), fail this goal via",
      "`report_build_result` with a concrete blocker that names the file —",
      "do NOT guess from filename or surrounding prose and proceed.",
    )
  } else {
    lines.push(
      "If you cannot read the staged file (missing on disk, unreadable, your",
      "tools cannot ingest its MIME), fail this goal via `report_build_result`",
      "with a concrete blocker that names the file — do NOT guess from filename",
      "or surrounding prose and proceed.",
    )
  }
  lines.push("", "")
  return lines.join("\n")
}

function renderBuildTerminalReportContract(): string {
  return [
    "## Terminal Report Contract",
    "",
    "When you call `report_build_result`, include:",
    "- `contract_restatement`: a detailed restatement of the effective req/goal contract you handled, including the user request or goal objective, relevant acceptance specs, requirement ids, important source evidence, and scoped non-goals.",
    "- `followup_workload_guidance`: an explicit note for subsequent agents about where task complexity may still be hidden, what evidence must be read deeper, and whether workload_analysis or Architect re-sizing should be revisited before more implementation.",
    "",
    "Do not shrink the report to the files you happened to touch. Weak follow-up models must be able to recover the real work surface from your terminal report without re-underestimating it.",
  ].join("\n")
}

export function buildUserPrompt(target: BuildTarget, context?: BuildAgent.BuildContext, taskID?: string): string {
  if (target.kind === "goal") {
    const lines: string[] = []
    const dependencyIDs = new Set(target.depends_on)

    const workloadSection = renderGoalWorkloadBriefSection(context?.workloadBrief)
    if (workloadSection.trim().length > 0) {
      lines.push(workloadSection)
      lines.push("")
    }

    // ── Upstream context (rule 23): the goal contract is a compressed view;
    //    the build agent benefits from the original Requirements list and
    //    architect cross-goal contracts when implementing the goal. Each
    //    section is rendered only when the caller supplied it. ───────────
    const reqs = context?.requirements ?? []
    if (reqs.length > 0) {
      lines.push(renderBuildRequirementsSection(reqs))
    }

    if (context?.contractGraph) {
      lines.push(renderContractGraphForPrompt(context.contractGraph, target.id))
      lines.push("")
    }

    const collaborationGoals = context?.collaborationGoals ?? []
    if (collaborationGoals.length > 0) {
      lines.push("## Collaboration State")
      lines.push("")
      lines.push(
        "Sibling-goal overview only. Full sibling objectives and acceptance specs are intentionally not inlined here; use the Contract Graph, dependency section, and workload brief to stay scoped. `owned_paths` are responsibility paths, not a file sandbox: shared-file edits are allowed when necessary for the integrated deliverable, preserve the Architect Contract Graph, and are explained in `files_changed[]`.",
      )
      lines.push("")
      for (const goal of collaborationGoals) {
        const marker = goal.id === target.id ? " (this goal)" : ""
        lines.push(`- **${goal.id}**${marker} [${goal.kind}, status=${goal.status}]: ${goal.title}`)
        if (goal.owned_paths.length > 0) lines.push(`  - responsibility_paths: ${goal.owned_paths.join(", ")}`)
        if (goal.depends_on.length > 0) lines.push(`  - depends_on: ${goal.depends_on.join(", ")}`)
      }
      lines.push("")
    }

    const deps = context?.dependencies ?? []
    if (deps.length > 0) {
      lines.push("## Dependencies (should be merged into your worktree base)")
      lines.push("")
      lines.push(
        "These goals are listed as prerequisites — the orchestrator is supposed to have waited for them to pass and merge before dispatching you, so their files SHOULD already exist in your base branch. Verify by reading the files named by the Contract Graph before consuming a dependency. If a graph contract is missing or the file is absent, do NOT re-implement it: call `report_build_result` with status='failed' and a concrete error naming the missing dependency so the orchestrator can fix the graph or dispatch order.",
      )
      lines.push("")
      for (const d of deps) {
        const sha = d.commit_ref ? ` @ ${d.commit_ref}` : ""
        lines.push(`- **${d.id}** ${d.title}${sha}`)
      }
      lines.push("")
    }

    const overlays = renderBuildPromptOverlays(
      context ? { ...context, acceptanceFeedback: undefined, taskID } : undefined,
    )
    if (overlays.sections.length > 0) {
      lines.push("## Task-Specific Build Overlays")
      lines.push("")
      lines.push(`Rendered overlays: ${overlays.ids.join(", ")}`)
      lines.push("")
      lines.push(overlays.sections.join("\n\n"))
      lines.push("")
    }

    if (context?.designSpecs && context.designSpecs.length > 0) {
      lines.push(
        renderVisualContractPromptSection({
          specs: context.designSpecs,
          instructions: [
            "The optional visual anchors below came from frontend_design. The frontend template above remains authoritative for the referenced UI/web target: restore the relevant subset 1:1 as closely as the stack allows.",
            "Use the subset relevant to this goal's responsibility paths, UI surface, and interactions; ignore anchors targeting unrelated regions.",
          ],
        }),
      )
      lines.push("")
    }

    const sourceCoverage = context?.fidelity?.sourceCoverage ?? []
    if (sourceCoverage.length > 0) {
      lines.push("## Source Coverage Contract")
      lines.push("")
      lines.push(
        "These existing source surfaces are part of the task-wide architect fidelity contract. Respect the declared action instead of silently bypassing or re-inventing the local implementation, even when a row primarily belongs to a sibling goal.",
      )
      lines.push("")
      for (const row of sourceCoverage) {
        lines.push(`- **${row.id}** [${row.action}] paths=${row.paths.join(", ")} — ${row.rationale}`)
      }
      lines.push("")
    }

    const referenceCoverage = context?.fidelity?.referenceCoverage ?? []
    if (referenceCoverage.length > 0) {
      lines.push("## Reference Coverage Contract")
      lines.push("")
      lines.push(
        "These reference surfaces are authoritative for the whole milestone. Restore them 1:1 and cover the named visual specs; do not reinterpret or redesign them. If a reference belongs to a sibling goal, preserve compatibility with that surface instead of drifting away from it.",
      )
      lines.push("")
      for (const row of referenceCoverage) {
        const specIDs = row.visual_spec_ids.length > 0 ? ` visual_specs=${row.visual_spec_ids.join(", ")}` : ""
        lines.push(`- **${row.id}** surface=${row.surface}${specIDs} — ${row.expectation}`)
      }
      lines.push("")
    }

    const assemblyOwners = context?.fidelity?.assemblyOwners ?? []
    if (assemblyOwners.length > 0) {
      lines.push("## Assembly Ownership")
      lines.push("")
      lines.push(
        "These are the shared assembly surfaces and their final owners. If another goal owns a stitched surface, do not expand your edits into it; if you own it, close the integration loop intentionally.",
      )
      lines.push("")
      for (const row of assemblyOwners) {
        lines.push(`- surface=${row.surface} owner=${row.goal_id} — ${row.rationale}`)
      }
      lines.push("")
    }

    if (context?.retryGuidance && context.retryGuidance.trim().length > 0) {
      lines.push("## Retry Guidance From Orchestrator")
      lines.push("")
      lines.push(context.retryGuidance.trim())
      lines.push("")
    }
    if (context?.retryFeedback && context.retryFeedback.trim().length > 0) {
      lines.push(context.retryFeedback)
      lines.push("")
    }
    const acceptanceOverlay = renderBuildPromptOverlays({ acceptanceFeedback: context?.acceptanceFeedback, taskID })
    if (acceptanceOverlay.sections.length > 0) {
      lines.push(acceptanceOverlay.sections.join("\n\n"))
      lines.push("")
    }
    // Goal contract.
    lines.push(`# Goal: ${target.title}`)
    lines.push("")
    lines.push(`**Objective**: ${target.objective}`)
    if (target.acceptance_specs.length > 0) {
      lines.push("")
      lines.push(
        "**Acceptance Specs** (every one MUST be observably satisfied before report_build_result status='passed'):",
      )
      for (const spec of target.acceptance_specs) lines.push(`- ${spec}`)
    }
    if (target.owned_paths.length > 0) {
      lines.push("")
      lines.push(`**Responsibility Paths** (review focus, not a file sandbox): ${target.owned_paths.join(", ")}`)
    }
    if (target.depends_on.length > 0) {
      lines.push("")
      lines.push(
        `**Depends on**: ${target.depends_on.join(", ")} — those goals are merged into your worktree base branch already.`,
      )
    }
    lines.push("")
    lines.push(
      "**Reference Fidelity**: If this goal depends on supplied reference artifacts or task-specific overlays, treat them as binding source material for the relevant surface. Do not approximate, redesign, or invent missing evidence.",
    )
    lines.push("")
    lines.push(
      "**File Change Report**: Before reporting success, list every project file you changed in `files_changed[]` with a concrete summary and reason. The host compares this list to the git diff; unexplained or phantom files fail collaboration review.",
    )
    lines.push("")
    lines.push(renderBuildTerminalReportContract())
    lines.push("")
    lines.push("Orchestrator is asking build to implement this goal, verify it, and report the result.")
    return lines.join("\n")
  }
  const contextLines: string[] = []
  const reqs = context?.requirements ?? []
  if (reqs.length > 0) {
    contextLines.push(renderBuildRequirementsSection(reqs, { directRequest: true }))
  }
  const overlays = renderBuildPromptOverlays(
    context ? { ...context, acceptanceFeedback: undefined, taskID } : undefined,
  )
  if (overlays.sections.length > 0) {
    contextLines.push("## Task-Specific Build Overlays")
    contextLines.push("")
    contextLines.push(`Rendered overlays: ${overlays.ids.join(", ")}`)
    contextLines.push("")
    contextLines.push(overlays.sections.join("\n\n"))
    contextLines.push("")
  }
  if (context?.retryGuidance && context.retryGuidance.trim().length > 0) {
    contextLines.push("## Retry Guidance From Orchestrator")
    contextLines.push("")
    contextLines.push(context.retryGuidance.trim())
    contextLines.push("")
  }
  if (context?.retryFeedback && context.retryFeedback.trim().length > 0) {
    contextLines.push("## Prior Attempt Failed — Read This Before Implementing")
    contextLines.push("")
    contextLines.push(context.retryFeedback.trim())
    contextLines.push("")
  }
  const acceptanceOverlay = renderBuildPromptOverlays({ acceptanceFeedback: context?.acceptanceFeedback, taskID })
  if (acceptanceOverlay.sections.length > 0) {
    contextLines.push(acceptanceOverlay.sections.join("\n\n"))
    contextLines.push("")
  }
  if (context?.designSpecs && context.designSpecs.length > 0) {
    contextLines.push(
      renderVisualContractPromptSection({
        specs: context.designSpecs,
        instructions: [
          "The visual contract below came from frontend_design. It is authoritative for this direct build request.",
          "Use the decision-log evidence_source_manifest and staged references for any source file/image named by the frontend template.",
        ],
      }),
    )
    contextLines.push("")
  }
  return [
    "# Delegation",
    "",
    "Orchestrator is asking build to implement this request, verify it, and report the result.",
    "Use task-specific build overlays and supplied artifacts when present; do not import scenario policy that this request did not supply.",
    "If the request is a port, migration, rewrite, clone, parity restoration, or component translation, complete investigation of the named source surface and existing target conventions is required implementation work before writing.",
    "This direct request path is for implementation, rework, and concrete deliverables such as investigation reports, Product Requirements Documents (PRDs), research briefs, audits, or documentation updates. If the prompt is only ad-hoc exploration and asks for no deliverable or behavior change, fail through the terminal build report with a concrete error that says Build is the wrong stage.",
    "",
    ...contextLines,
    renderUserRequestSection({ heading: "# Request", request: target.text, taskID }),
    "",
    "# File Change Report",
    "",
    "Before reporting success, list every project file you changed in `files_changed[]` with a concrete summary and reason. The host compares this list to the git diff; unexplained or phantom files fail collaboration review.",
    "",
    renderBuildTerminalReportContract(),
  ].join("\n")
}

export function buildRetryFeedbackPrompt(
  target: BuildTarget,
  context?: BuildAgent.BuildContext,
  taskID?: string,
): string {
  const lines: string[] = [
    "# Build Retry Feedback",
    "",
    "Continue this same build session. Do not restart from the full original prompt; use the existing conversation and files in this worktree as context.",
    "",
  ]
  if (target.kind === "goal") {
    lines.push(`Goal: ${target.id} — ${target.title}`)
  } else {
    lines.push("Target: direct build request")
  }
  lines.push("")
  const overlays = renderBuildPromptOverlays(
    context ? { ...context, acceptanceFeedback: undefined, taskID } : undefined,
  )
  if (overlays.sections.length > 0) {
    lines.push("## Task-Specific Build Overlays")
    lines.push("")
    lines.push(`Rendered overlays: ${overlays.ids.join(", ")}`)
    lines.push("")
    lines.push(overlays.sections.join("\n\n"))
    lines.push("")
  }
  if (context?.retryGuidance && context.retryGuidance.trim().length > 0) {
    lines.push("## Current Orchestrator Feedback")
    lines.push("")
    lines.push(context.retryGuidance.trim())
    lines.push("")
  }
  if (context?.retryFeedback && context.retryFeedback.trim().length > 0) {
    lines.push("## Prior Attempt Failure Facts")
    lines.push("")
    lines.push(context.retryFeedback.trim())
    lines.push("")
  }
  const acceptanceOverlay = renderBuildPromptOverlays({ acceptanceFeedback: context?.acceptanceFeedback, taskID })
  if (acceptanceOverlay.sections.length > 0) {
    lines.push(acceptanceOverlay.sections.join("\n\n"))
    lines.push("")
  }
  if (
    overlays.sections.length === 0 &&
    (!context?.retryGuidance || context.retryGuidance.trim().length === 0) &&
    (!context?.retryFeedback || context.retryFeedback.trim().length === 0)
  ) {
    lines.push("## Required Fix")
    lines.push("")
    lines.push(
      "The previous build attempt did not pass. Inspect the current worktree state, identify the concrete blocker, fix it in place, verify, and report the result.",
    )
    lines.push("")
  }
  lines.push("## Instructions")
  lines.push("")
  lines.push("- Edit the existing worktree in place.")
  lines.push("- Preserve all prior upstream contracts already present in this conversation.")
  lines.push("- Run the relevant verification commands before reporting success.")
  lines.push(
    "- Restate the detailed req/goal contract and warn follow-up agents where workload may still be underestimated.",
  )
  lines.push("- Finish by calling report_build_result with the current attempt result.")
  return lines.join("\n")
}
