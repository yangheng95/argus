/**
 * BuildAgent — phase 5-b-2 implementation of the `build` tool's agent body.
 *
 * Replaces the GoalPool + executor adapter path for coding work: instead of
 * delegating to an external coding executor (MirrorCode / codex / claude-code),
 * build runs an in-process LLM via SessionPrompt with the broad coding
 * toolset (read / write / edit / bash / ...) and the build-core prompt.
 *
 * Lifecycle:
 *   1. BuildSemaphore.withSlot gates concurrency per-task. Orchestrator's
 *      parallel tool_calls fan out with this cap.
 *   2. Worktree.create under `<primary>/.opencorvus/worktrees/`. Ownership
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
import { runAgentSession } from "@/agent/runner"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { Worktree } from "@/worktree"
import { BuildSemaphore } from "@/engine/build-semaphore"
import { Ownership } from "@/engine/ownership"
import { findActiveRunForTask, type TaskRow } from "@/engine/store"
import { EngineConfig } from "@/engine/config"
import { ExecutorRegistry } from "@/executor/registry"
import { record, structuredInput, type CodingEventInfo, type CodingProvider, type CodingProviderOptions } from "@/executor/contract"
import { Identifier } from "@/id/id"
import { Message } from "@/session/message"
import { MCPServe } from "@/mcp/serve"
import type { VisualSpec } from "@/design-analyst/types"
import { renderVisualContractPromptSection } from "@/design-analyst/prompt-section"
import type {
  AssemblyOwnerEntry,
  ReferenceCoverageEntry,
  SourceCoverageEntry,
} from "@/architect/fidelity"
import type { FileDiff } from "@/snapshot/types"
import { BuildAgentContractError, BuildResultSchema, type BuildResult, type BuildTarget } from "./types"
import { AttachmentStore } from "@/storage/attachment-store"
import { withStreamActivity } from "@/util/stream-activity"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"

import BUILD_CORE from "@/prompt/core/build-core.txt"

const log = Log.create({ service: "build-agent" })

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
    requirements?: Array<{ id: string; type: "explicit" | "implicit"; description: string }>
    /** Visual contract from design_analysis (palette, typography, layout,
     *  components, interactions). Build implementations pulling on UI must
     *  honour the relevant subset. */
    designSpecs?: VisualSpec[]
    /** Cross-goal interface contracts the architect committed to the
     *  decision log. Build receives the complete set so every goal sees the
     *  same architectural consensus, with this goal only highlighted in
     *  rendering. */
    architectContracts?: Array<{
      category: string
      title: string
      spec: string
      goalIDs?: string[]
    }>
    /** Sibling goals listed in `target.depends_on`. The orchestrator gates
     *  dispatch on these having passed and merged, so their files SHOULD be
     *  in the worktree base — surfacing titles + objectives lets the build
     *  agent recognise what is already provided and verify it before
     *  consuming. */
    dependencies?: Array<{
      id: string
      title: string
      objective: string
      commit_ref?: string
    }>
    /** Pre-rendered "Prior Attempt Failed" section from the decision log's
     *  retry entries. Empty / undefined on the first attempt. The caller
     *  composes the markdown so this agent doesn't need DB access. */
    retryFeedback?: string
    /** Canonical delivery rejection packet read directly from persisted
     *  verdict / manifest artifacts. Unlike retryFeedback, this is not an
     *  orchestrator-written summary and also exists for task-scope rework. */
    deliveryFeedback?: string
    /** Task-wide fidelity contract derived from architect coverage rows. */
    fidelity?: {
      sourceCoverage?: SourceCoverageEntry[]
      referenceCoverage?: ReferenceCoverageEntry[]
      assemblyOwners?: AssemblyOwnerEntry[]
    }
    /** Full sibling-goal collaboration snapshot composed by the orchestrator
     *  from the describe layer. Build agents may edit shared files, but they
     *  must understand the current milestone and explain how each file change
     *  preserves the other goals' declared contracts. */
    collaborationGoals?: Array<{
      id: string
      title: string
      objective: string
      kind: string
      status: string
      acceptance_specs: string[]
      owned_paths: string[]
      depends_on: string[]
      exports: string[]
      imports: string[]
    }>
    /** Pre-formatted multimodal file parts produced by upstream evidence —
     *  typically the previous attempt's rendered.png from delivery's visual
     *  hard gate so the build LLM can see what it actually produced versus
     *  the user reference. Each entry's `url` MUST already be a data URL or
     *  resolvable; the build agent splices these directly into the user
     *  message after `task.attachments`. */
    retryAttachments?: Array<{ url: string; mime: string; filename?: string }>
  }

  export interface RunInput {
    /** The work target — either a scoped goal (pipeline workflow) or a
     *  free-form request (direct workflow). See build/types.ts. */
    target: BuildTarget
    /** The owning task row; drives BuildSemaphore limits + worktree
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
    /** Explicit model override (provider / model). Skips `resolveAgentModel`. */
    model?: { providerID: string; modelID: string }
    signal?: AbortSignal
    /** Fires as soon as the child build session exists, before model work starts.
     *  Orchestrator uses this to bind the already-open goal_run attempt to the
     *  real build session while the build is still in flight. */
    onSessionCreated?: (sessionID: string) => void | Promise<void>
    /** Fires after this invocation has acquired the per-task build semaphore,
     *  before worktree setup and before the child build session exists.
     *  Orchestrator creates the live goal_run here so semaphore waiters do
     *  not appear as running goals. */
    onSlotAcquired?: () => void | Promise<void>
    /** Optional pre-allocated worktree dir. When provided, the build agent
     *  uses it as-is and does NOT manage its lifecycle (caller owns cleanup).
     *  When absent the agent creates a managed worktree under
     *  `<primary>/.opencorvus/worktrees/`. */
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
     *  cleanup so the orchestrator can persist a per-goal delivery artifact
     *  the overlay's right-side panel reads via `findDeliveryByGoalRun`.
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
    executor: Exclude<TaskRow["executor"], "mirrorcode">
    baseSystem?: string
    skillPrompt?: string
  }) {
    const mcpPrompt = input.executor === "codex"
      ? MCPServe.codingExecutorPromptSection()
      : ""
    const system = [input.baseSystem ?? "", externalBuildSystemContract(input.executor), mcpPrompt, input.skillPrompt ?? ""]
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
    return BuildSemaphore.withSlot(input.task, async () => {
      await input.onSlotAcquired?.()
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
          sessionID: input.parentSessionID ?? "",
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
        const info = await Worktree.create({ name: `build-${targetLabel}`, reuseIfValid: true })
        worktreeDir = info.directory
        worktreeBranch = info.branch
        await Ownership.Worktree.record({
          primaryWorktreeDir: Instance.worktree,
          worktreeDir,
          taskID: input.task.id,
          sessionID: input.parentSessionID ?? "",
          runID: findActiveRunForTask(input.task.id)?.id,
          goalID: input.target.kind === "goal" ? input.target.id : undefined,
        })
        const result = await runGit(["rev-parse", "HEAD"], { cwd: worktreeDir, timeoutProfile: "fast" })
        baseRef = result.exitCode === 0 ? result.text().trim() || undefined : undefined
      }

      // Stage user-contract image attachments into `<worktree>/references/`
      // so the build agent can pass worktree-LOCAL relative paths to tools
      // whose sandbox checks reject paths outside the worktree (notably
      // `webpage_image_extract`'s `loadImage` sandbox check). Without this,
      // the agent had to discover the attachments dir via glob/ls and copy
      // each file by hand before each tool call — three retries observed
      // during the first claude-sonnet bench run before Sonnet figured out
      // the dance. The staging contract is owned by AttachmentStore (rule 22
      // — single source for "where staged attachments live"); this build
      // agent path just invokes it. Caller-owned worktrees (input.workDir)
      // skip — the caller is responsible for staging in that path.
      let stagedAttachments: AttachmentStore.StagedAttachment[] = []
      if (ownsWorktree && worktreeDir && Array.isArray(input.task.attachments) && input.task.attachments.length > 0) {
        try {
          stagedAttachments = await AttachmentStore.stageToWorktree(
            Instance.project.id,
            input.task.attachments as Array<{
              sha?: string
              url?: string
              mime?: string
              size?: number
              filename?: string
            }>,
            worktreeDir,
          )
          if (stagedAttachments.length > 0) {
            log.info("build agent: staged task attachments into worktree references/", {
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

      // Skill auto-load goes through the runner's system-prompt path
      // (rule 22: single-source skill injection lives on the system side
      // for every agent — auto-detected, never stuffed into user prompt).
      const { deriveUrlSignals } = await import("@/engine/skill-inject")
      const taskSignals: import("@/engine/skill-inject").TaskSignals = {
        has_attachment_image: Array.isArray(input.task.attachments)
          && input.task.attachments.some((a: any) => typeof a?.mime === "string" && a.mime.startsWith("image/")),
        ...deriveUrlSignals(input.task.request ?? ""),
        request_text: input.task.request ?? "",
      }

      const buildPromptText = () => buildUserPrompt(input.target, input.context)
      // Forward task.attachments (user's reference image, e.g. ainvest.png) as
      // multimodal user-message parts so the build LLM physically sees what to
      // clone — text design_specs alone don't carry pixel-level layout/colour
      // information, root cause of "engine accepts but visual fidelity 0.237"
      // (rule 4: root-cause not bandage).
      const taskAttachments = (Array.isArray(input.task.attachments)
        ? (input.task.attachments as Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>)
        : []
      ).filter((a) => typeof a?.url === "string" && typeof a?.mime === "string")
      const retryAttachments = (input.context?.retryAttachments ?? []).filter(
        (a) => typeof a?.url === "string" && typeof a?.mime === "string",
      ) as Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
      const allMultimodal = [...taskAttachments, ...retryAttachments]
      const buildUserPartsFn = allMultimodal.length > 0
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
            const enrichedText =
              text +
              AttachmentStore.renderStagedList(stagedAttachments) +
              AttachmentStore.renderAttachmentInventory(allMultimodal)
            return [{ type: "text" as const, text: enrichedText }, ...inline]
          }
        : undefined

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

      type BuildCollector = {
        result?: BuildResult
      }
      const buildCollector: BuildCollector = {}
      const createBuildReportTools = (): ToolSet => ({
        report_build_result: tool({
          description:
            "Finalize this build session with status='passed' or status='failed'. " +
            "The host accepts whichever you submit — it does NOT enforce that merge_back succeeded first, " +
            "and does NOT audit your files_changed[] against the actual git diff. " +
            "Both facts are returned to the orchestrator alongside your report (merge_back_status, actual_changed_files), " +
            "so the orchestrator LLM cross-checks honesty itself. " +
            "Be honest: if you didn't merge, report status='failed' with a concrete error. " +
            "If you legitimately reused a prior attempt's worktree without further edits, files_changed=[] is fine.",
          inputSchema: BuildResultSchema,
          execute: async (result) => {
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
            const commit_ref = mergedHead
              ? mergedHead.slice(0, 12)
              : (ownsWorktree && worktreeBranch ? "" : result.commit_ref ?? "")
            buildCollector.result = result.status === "passed"
              ? { ...result, commit_ref }
              : { ...result, commit_ref }
            return `PASS: build ${result.status} result recorded.`
          },
        }),
      })

      const buildToolKit: { tools: ToolSet; getCollector: () => BuildCollector } = ownsWorktree && worktreeBranch && worktreeDir
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
                execute: async () => {
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
                        outcome.primaryBranch + ".",
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
                },
              }),
              ...createBuildReportTools(),
            },
            getCollector: () => buildCollector,
          }
        : {
            // Caller-owned worktrees (input.workDir set) skip merge_back — the
            // caller manages publishing. The agent prompt is gated on the
            // tool's presence so the LLM does not invent the call.
            tools: createBuildReportTools(),
            getCollector: () => buildCollector,
          }

      let out: { session: { id: string }; structured?: unknown; collector?: BuildCollector } | undefined
      let parsed: ReturnType<typeof BuildResultSchema.safeParse> | undefined
      let diffs: FileDiff[] | undefined
      // Dispatch fork: executor === "mirrorcode" → in-process LLM via SessionPrompt
      // (the existing runAgentSession path with merge_back tool). Anything else
      // (claude-code, codex) → external CodingProvider; the provider edits files
      // in the worktree on its own, then BuildAgent runs merge_back itself
      // because the SDK has no way to call our merge_back tool.
      const executor = input.task.executor ?? "mirrorcode"
      try {
        if (executor === "mirrorcode") {
          out = await runAgentSession({
            kind: "build",
            core: BUILD_CORE,
            sessionTitle: buildSessionTitle(input.target),
            sessionDirectory: worktreeDir!,
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
            skillsStage: "build",
            skillTaskSignals: taskSignals,
            onSessionCreated: async (session) => {
              await input.onSessionCreated?.(session.id)
              return { dispose() {} }
            },
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
            worktreeDir: worktreeDir!,
            worktreeBranch,
            ownsWorktree,
            buildPromptText,
            taskSignals,
            signal: input.signal,
            onSessionCreated: input.onSessionCreated,
          })
          out = { session: { id: externalOut.sessionID }, structured: externalOut.structured }
          parsed = BuildResultSchema.safeParse(externalOut.structured)
          if (externalOut.mergedHead) mergedHead = externalOut.mergedHead
        }

        // Capture the goal's diff against its original baseRef while the
        // worktree's git dir is still healthy — overlay's per-goal delivery
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
        // The build session is contractually obligated to call
        // report_build_result with a schema-valid payload. When it doesn't,
        // the orchestrator gets a typed missing_terminal_report so the next
        // tool result is still well-formed (B8: merge_back_blocked is no
        // longer a separate throw — the host doesn't enforce
        // merge-before-passed; the orchestrator LLM reads the merge_back
        // facts in the build tool result and decides). Spec
        // architecture-rework-loosening-plan-2026-05-06.md (B8).
        if (executor === "mirrorcode") {
          throw new BuildAgentContractError(
            "missing_terminal_report",
            {
              sessionID: out?.session?.id,
              parseError: parsed?.error?.message,
              lastMergeBackOutcome,
            },
            `Build agent terminated without a valid report_build_result tool call: ${parsed?.error?.message ?? "(no parsed output)"}. ` +
              `The retained goal worktree is diagnostic evidence under .opencorvus/worktrees; the orchestrator LLM reads the build tool's merge_back / actual_changed_files facts and decides whether to retry, modify_goal, or fail_task.`,
          )
        }
        // External executors (codex / claude-code) host-synthesise the
        // BuildResult after the provider finishes; if the structured
        // output fails BuildResultSchema validation, that's a
        // provider-side bug — keep the generic Error throw so the
        // orchestrator's existing infra-error rethrow path surfaces it.
        throw new Error(
          `build agent: external executor structured output did not match BuildResultSchema: ${parsed?.error?.message ?? "(no parsed output)"}`,
        )
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

      // Translate the contribution diff (already collected for delivery
      // panel) into a compact host-truth files list. Render against the
      // contribution base, not baseRef..HEAD raw, so merge commits don't
      // attribute sibling-goal files to this build.
      const actualChangedFiles = diffs?.map((d) => ({
        path: d.file,
        status: (d.status === "added" || d.status === "deleted" || d.status === "modified")
          ? d.status
          : "modified" as const,
        additions: typeof (d as { additions?: number }).additions === "number"
          ? (d as { additions: number }).additions
          : 0,
        deletions: typeof (d as { deletions?: number }).deletions === "number"
          ? (d as { deletions: number }).deletions
          : 0,
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

function externalBuildSystemContract(executor: Exclude<TaskRow["executor"], "mirrorcode">): string {
  return [
    `You are the OpenCorvus external build executor running through ${executor}.`,
    "",
    "Your job is to implement the scoped build request in the current worktree, verify it, and commit the result on the worktree branch.",
    "",
    "Hard contract:",
    "- Treat the user prompt as a build contract, not as a chat request.",
    "- Read only the files needed to confirm dependencies and local patterns, then edit the files required by the milestone.",
    "- Explain every changed file in the final report; shared-file edits are valid only when they preserve sibling-goal contracts and are explicitly justified.",
    "- Do not perform broad inventories or spawn exploratory subagents unless a concrete missing dependency blocks implementation.",
    "- Keep reasoning, plans, prompt/rule details, and progress narration out of assistant text. Use tools to act.",
    "- When the prompt or staged references define a screenshot, mockup, or webpage target, those references are authoritative. Match them 1:1 as closely as the stack allows; do not substitute your own design or silently drop referenced assets.",
    "- Run the acceptance commands from the prompt before claiming success.",
    "- Write shell commands for the actual platform and shell; on Windows/PowerShell use PowerShell-native commands instead of unverified Unix-only helpers such as head, sed, or grep.",
    "- Commit changes with a concrete commit message before finishing.",
    "- If the dependency contract is missing, verification fails, or you cannot commit, finish with a concise failure summary and the exact blocker.",
    "- Do not call OpenCorvus-only tools such as report_build_result or merge_back; the host will publish and synthesize the terminal BuildResult after your process exits.",
  ].join("\n")
}

// ---------------------------------------------------------------------------
// External CodingProvider dispatch
// ---------------------------------------------------------------------------

function externalEventMeta(event: CodingEventInfo): Record<string, unknown> {
  return "meta" in event ? record(event.meta) ?? {} : {}
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
  const named = event.name
    || stringField(meta.tool_name)
    || stringField(meta.tool)
    || stringField(meta.name)
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
  const text = stringField(question.question)
    || stringField(question.message)
    || stringField(question.label)
    || "Additional input required"
  return `- ${header}: ${text}`
}

async function resolveExternalApproval(input: {
  provider: CodingProvider
  sessionID: string
  event: Extract<CodingEventInfo, { type: "approval_request" }>
}) {
  if (!input.provider.respond) throw new Error("external executor emitted an approval request but does not support respond()")
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
  if (!input.provider.respond) throw new Error("external executor emitted an input request but does not support respond()")
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
  const raw = event.questions?.length ? event.questions : [{
    id: event.id,
    header: "Input",
    question: "Additional input required",
    requested_schema: event.meta?.requested_schema,
  }]
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

function externalAnswerContent(
  event: Extract<CodingEventInfo, { type: "input_request" }>,
  answers: Question.Answer[],
) {
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
 * post-run path is identical for MirrorCode and external executors (rule 22:
 * single contract, multiple implementations).
 */
async function runWithExternalProvider(args: {
  executor: Exclude<TaskRow["executor"], "mirrorcode">
  target: BuildTarget
  taskID: string
  parentSessionID?: string
  worktreeDir: string
  worktreeBranch: string | undefined
  ownsWorktree: boolean
  buildPromptText: () => string
  taskSignals?: import("@/engine/skill-inject").TaskSignals
  signal?: AbortSignal
  onSessionCreated?: (sessionID: string) => void | Promise<void>
}): Promise<{ sessionID: string; structured: unknown; mergedHead?: string }> {
  // External-build dispatch boundary: surface terminal to the overlay when
  // the inner function returns (every return below structures failure as a
  // `failed` status rather than throwing) or throws. Mirrors agent/runner.ts
  // for the MirrorCode executor path; without this the build session card
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
  executor: Exclude<TaskRow["executor"], "mirrorcode">
  target: BuildTarget
  taskID: string
  parentSessionID?: string
  worktreeDir: string
  worktreeBranch: string | undefined
  ownsWorktree: boolean
  buildPromptText: () => string
  taskSignals?: import("@/engine/skill-inject").TaskSignals
  signal?: AbortSignal
  onSessionCreated?: (sessionID: string) => void | Promise<void>
}): Promise<{ sessionID: string; structured: unknown; mergedHead?: string }> {
  const { provider, options } = ExecutorRegistry.requireCoding(args.executor)

  const session = await Session.createNext({
    kind: "build",
    parentID: args.parentSessionID,
    goalID: args.target.kind === "goal" ? args.target.id : undefined,
    title: buildSessionTitle(args.target),
    directory: args.worktreeDir,
  })
  await args.onSessionCreated?.(session.id)

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
  const tools = new Map<string, {
    id: string
    name: string
    input: Record<string, unknown>
    metadata: Record<string, unknown>
    start: number
  }>()

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

  // Auto-detect build-stage skills for the same taskSignals the in-process
  // MirrorCode path uses, and append the skill bundle (stage invariant + matched
  // skill bodies, e.g. webpage-generate.md / image-generate.md) to the system
  // prompt forwarded to the external coding provider. Without this, claude-code
  // / codex never see the mirror SOP, the hard "no text-only fallback" rule, or
  // the `webpage_vision_judge` acceptance gate, and degrade to writing HTML by
  // hand from the visual contract alone (rule 22: single source of truth for
  // skill teaching is the skill file, NOT a stripped-down prompt section).
  const orchCfg = await EngineConfig.get()
  const buildSkillsCfg = (orchCfg as unknown as { build?: { skills?: string[] } }).build?.skills ?? []
  const { resolveStageSkills } = await import("@/engine/skill-inject")
  const resolvedSkills = await resolveStageSkills(buildSkillsCfg, "build", args.taskSignals)
  const baseSystem = resolveOption<string>(options.system)
  const composedSystem = BuildAgent.composeExternalCodingSystem({
    executor: args.executor,
    baseSystem,
    skillPrompt: resolvedSkills.prompt,
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
  const runInput = {
    sessionID: session.id,
    model: resolveOption(options.model),
    prompt,
    cwd: args.worktreeDir,
    system: composedSystem.system,
    maxTurns: resolveOption(options.maxTurns),
    tools: configuredTools,
    signal: gate.signal,
  }

  log.info("build agent (external) provider input ready", {
    executor: args.executor,
    executorModel: runInput.model ?? null,
    taskID: args.taskID,
    sessionID: session.id,
    toolCount: configuredTools?.length ?? 0,
    skillCount: resolvedSkills.skills.length,
    skillNames: resolvedSkills.skills.map((s) => s.name),
    requiredTools: resolvedSkills.requiredTools,
    mcpPromptInjected: composedSystem.mcpPromptInjected,
    systemChars: composedSystem.system?.length ?? 0,
  })

  try {
    for await (const event of provider.run(runInput)) {
      gate.observe()
      events.push(event)
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
          const partID = Identifier.ascending("part")
          const start = Date.now()
          const inputObj = externalToolInput(event.input)
          const metadata = externalToolMetadata(event)
          tools.set(event.id, { id: partID, name: event.name, input: inputObj, metadata, start })
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
                error: `${protocolError} Output preview: ${singleLineText(event.output)}`,
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
        case "usage":
          await appendExternalEventPart(event)
          break
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
        input: t.input,
        error: protocolError,
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
      structured: {
        status: "failed" as const,
        commit_ref: "",
        summary: `external executor ${args.executor} stopped before host merge_back: ${singleLineText(errored)}`,
        tests: [],
        error: errored,
      },
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
      structured: {
        status: "passed" as const,
        commit_ref: "",
        summary:
          doneOutput?.trim() ||
          `external executor ${args.executor} completed (${events.length} events, ${toolUseCount} tool-uses, ${textCharCount} chars)`,
        files_changed: [],
        tests: [],
      },
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
      structured: {
        status: "failed" as const,
        commit_ref: "",
        summary:
          `merge_back hit conflicts on ${args.worktreeBranch} → ${outcome.primaryBranch} ` +
          `(${outcome.conflictPaths.length} conflict${outcome.conflictPaths.length === 1 ? "" : "s"}): ${pathList}`,
        tests: [],
        error:
          `Merge left ${args.worktreeDir} in MERGING state against ${outcome.primaryBranch} ` +
          `(tip ${outcome.primaryTip.slice(0, 12)}); conflict paths: ${pathList}. ` +
          `Resolve markers in this same worktree, git add, and git commit before retrying.`,
      },
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
      structured: {
        status: "failed" as const,
        commit_ref: "",
        summary: `merge_back blocked for ${args.worktreeBranch}: ${outcome.reason}`,
        tests: [],
        error:
          `${outcome.reason}. Worktree preserved at ${outcome.worktreeDir}; ` +
          `the next attempt must resolve that repository state before retrying merge_back.`,
      },
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
      structured: {
        status: "failed" as const,
        commit_ref: "",
        summary: `merge_back returned status=infra_error for ${args.worktreeBranch}: ${outcome.reason}`,
        tests: [],
        error: outcome.reason,
      },
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
    structured: {
      status: "passed" as const,
      commit_ref: mergedHead.slice(0, 12),
      summary:
        doneOutput?.trim() ||
        `external executor ${args.executor} completed (${events.length} events, ${toolUseCount} tool-uses, ${textCharCount} chars)`,
      files_changed: [],
      tests: [],
    },
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
async function collectGoalContributionDiffs(worktreeDir: string, baseRef: string): Promise<FileDiff[]> {
  const contributionBase = await resolveGoalContributionBaseRef(worktreeDir, baseRef)
  return collectGoalDiffs(worktreeDir, contributionBase)
}

export async function resolveGoalContributionBaseRef(worktreeDir: string, baseRef: string): Promise<string> {
  const parentsResult = await runGit(["show", "--no-patch", "--pretty=%P", "HEAD"], {
    cwd: worktreeDir, timeoutProfile: "fast",
  })
  const parentsRaw = parentsResult.exitCode === 0 ? parentsResult.text().trim() : ""
  const parents = parentsRaw.split(/\s+/).filter(Boolean)
  return parents.length >= 2 ? parents[1]! : baseRef
}

/**
 * Collect per-file diffs for a ref range as `baseRef..HEAD`.
 * Returns FileDiff objects with full before/after blobs so the overlay's
 * goal-run delivery endpoint can serve diff previews without a separate
 * git read at click time. Mirrors the shape of `Snapshot.diffFull` so the
 * existing `viewDelivery` / overlay diff service consume the same schema
 * as the task-level delivery path.
 *
 * Filters out worktree scratch (`.opencorvus/`) so the panel doesn't list
 * worktree-internal files like ownership markers.
 */
async function collectGoalDiffs(worktreeDir: string, baseRef: string): Promise<FileDiff[]> {
  const headResult = await runGit(["rev-parse", "HEAD"], { cwd: worktreeDir, timeoutProfile: "fast" })
  const headRaw = headResult.exitCode === 0 ? headResult.text().trim() : ""
  if (!headRaw || headRaw === baseRef) return []

  const status = new Map<string, "added" | "deleted" | "modified">()
  const statusResult = await runGit(
    [
      "-c", "core.quotepath=false",
      "diff", "--no-ext-diff", "--name-status", "--no-renames",
      baseRef, headRaw, "--", ".",
    ],
    { cwd: worktreeDir, timeoutProfile: "default" },
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
    [
      "-c", "core.quotepath=false",
      "diff", "--no-ext-diff", "--no-renames", "--numstat",
      baseRef, headRaw, "--", ".",
    ],
    { cwd: worktreeDir, timeoutProfile: "default" },
  )
  const numstatOut = numstatResult.exitCode === 0 ? numstatResult.text().trim() : ""

  const result: FileDiff[] = []
  for (const line of numstatOut.split("\n")) {
    if (!line) continue
    const [additions, deletions, file] = line.split("\t")
    if (!file) continue
    if (file.startsWith(".opencorvus/") || file === ".opencorvus-meta.json") continue
    const isBinary = additions === "-" && deletions === "-"
    const before = isBinary
      ? ""
      : (await runGit(["show", `${baseRef}:${file}`], { cwd: worktreeDir, timeoutProfile: "default" })).text()
    const after = isBinary
      ? ""
      : (await runGit(["show", `${headRaw}:${file}`], { cwd: worktreeDir, timeoutProfile: "default" })).text()
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
    const slug = target.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32)
    return slug || target.id.slice(-8)
  }
  const slug = target.text.toLowerCase().slice(0, 32).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
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

export function buildUserPrompt(target: BuildTarget, context?: BuildAgent.BuildContext): string {
  if (target.kind === "goal") {
    const lines: string[] = []
    const dependencyIDs = new Set(target.depends_on)

    // ── Upstream context (rule 23): the goal contract is a compressed view;
    //    the build agent benefits from the original Requirements list and
    //    architect cross-goal contracts when implementing the goal. Each
    //    section is rendered only when the caller supplied it. ───────────
    const reqs = context?.requirements ?? []
    if (reqs.length > 0) {
      lines.push("## Requirements (from Requirements stage)")
      lines.push("")
      lines.push(
        "These are the user-facing requirements driving this task. Your goal's acceptance_specs are derived from a subset; consult the originals when an implementation choice is ambiguous.",
      )
      lines.push("")
      for (const r of reqs) {
        lines.push(`- **${r.id}** [${r.type}]: ${r.description}`)
      }
      lines.push("")
    }

    const contracts = context?.architectContracts ?? []
    if (contracts.length > 0) {
      lines.push("## Architect Contracts (cross-goal consensus, must honour)")
      lines.push("")
      lines.push(
        "The architect committed these interface contracts to the decision log. This is a budgeted view of the complete architecture consensus: current-goal, dependency, and task-wide contracts are expanded; sibling-only contracts are included compactly so you can preserve them without flooding the prompt.",
      )
      lines.push("")
      for (const c of contracts) {
        const goalIDs = c.goalIDs ?? []
        const relevant =
          goalIDs.length === 0 ||
          goalIDs.includes(target.id) ||
          goalIDs.some((goalID) => dependencyIDs.has(goalID))
        const scope = goalIDs.length === 0
          ? "(task-wide)"
          : goalIDs.includes(target.id)
            ? goalIDs.length === 1 ? "(this goal)" : `(includes this goal: ${goalIDs.join(", ")})`
            : goalIDs.some((goalID) => dependencyIDs.has(goalID))
              ? `(dependency contract: ${goalIDs.join(", ")})`
            : `(sibling contract: ${goalIDs.join(", ")})`
        lines.push(`### ${c.title} — ${c.category} ${scope}`)
        lines.push(relevant ? c.spec : compactLine(c.spec))
        lines.push("")
      }
    }

    const collaborationGoals = context?.collaborationGoals ?? []
    if (collaborationGoals.length > 0) {
      lines.push("## Collaboration State")
      lines.push("")
      lines.push(
        "These are the sibling goals in the shared milestone. `owned_paths` are responsibility paths, not a file sandbox: shared-file edits are allowed when they are necessary for the integrated deliverable, preserve the other goals' declared contracts, and are explained in `files_changed[]`.",
      )
      lines.push("")
      for (const goal of collaborationGoals) {
        const marker = goal.id === target.id ? " (this goal)" : ""
        const relevant = goal.id === target.id || dependencyIDs.has(goal.id)
        lines.push(`- **${goal.id}**${marker} [${goal.kind}, status=${goal.status}]: ${goal.title}`)
        if (goal.objective) lines.push(`  - objective: ${goal.objective}`)
        if (goal.acceptance_specs.length > 0 && relevant) {
          lines.push("  - acceptance_specs:")
          for (const spec of goal.acceptance_specs) lines.push(`    - ${spec}`)
        } else if (goal.acceptance_specs.length > 0) {
          lines.push(`  - acceptance_specs_summary: ${goal.acceptance_specs.map((spec) => compactLine(spec, 140)).join(" | ")}`)
        }
        if (goal.owned_paths.length > 0) lines.push(`  - responsibility_paths: ${goal.owned_paths.join(", ")}`)
        if (goal.depends_on.length > 0) lines.push(`  - depends_on: ${goal.depends_on.join(", ")}`)
        if (goal.exports.length > 0) lines.push(`  - exports: ${goal.exports.join("; ")}`)
        if (goal.imports.length > 0) lines.push(`  - imports: ${goal.imports.join("; ")}`)
      }
      lines.push("")
    }

    const deps = context?.dependencies ?? []
    if (deps.length > 0) {
      lines.push("## Dependencies (should be merged into your worktree base)")
      lines.push("")
      lines.push(
        "These goals are listed as prerequisites — the orchestrator is supposed to have waited for them to pass and merge before dispatching you, so their files SHOULD already exist in your base branch. Verify by reading them before you consume their exports. If a declared export is missing or the file is absent, do NOT re-implement it: call `report_build_result` with status='failed' and a concrete error naming the missing dependency so the orchestrator can fix the dispatch order.",
      )
      lines.push("")
      for (const d of deps) {
        const sha = d.commit_ref ? ` @ ${d.commit_ref}` : ""
        lines.push(`- **${d.id}** ${d.title}${sha}`)
        if (d.objective) lines.push(`  - Objective: ${d.objective}`)
      }
      lines.push("")
    }

    if (context?.designSpecs && context.designSpecs.length > 0) {
      lines.push(renderVisualContractPromptSection({
        specs: context.designSpecs,
        instructions: [
          "The visual contract below came from design_analysis. It is authoritative for the referenced UI/web target: restore the relevant subset 1:1 as closely as the stack allows.",
          "Implement the subset relevant to this goal's responsibility paths, UI surface, and interactions; ignore specs targeting unrelated regions.",
        ],
      }))
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

    if (context?.retryFeedback && context.retryFeedback.trim().length > 0) {
      lines.push(context.retryFeedback)
      lines.push("")
    }
    if (context?.deliveryFeedback && context.deliveryFeedback.trim().length > 0) {
      lines.push("## Canonical Delivery Rejection Feedback")
      lines.push("")
      lines.push(context.deliveryFeedback.trim())
      lines.push("")
    }

    // ── Goal contract ────────────────────────────────────────────────────
    lines.push(`# Goal: ${target.title}`)
    lines.push("")
    lines.push(`**Objective**: ${target.objective}`)
    if (target.acceptance_specs.length > 0) {
      lines.push("")
      lines.push("**Acceptance Specs** (every one MUST be observably satisfied before report_build_result status='passed'):")
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
    if (target.imports.length > 0) {
      lines.push("")
      lines.push(`**Imports**: ${target.imports.join(", ")}`)
    }
    if (target.exports.length > 0) {
      lines.push("")
      lines.push(`**Exports this goal must provide**: ${target.exports.join(", ")}`)
    }
    lines.push("")
    lines.push("**Reference Fidelity**: If this goal depends on screenshots, webpage captures, staged `references/` files, or visual contract specs, treat them as binding source material and reproduce the relevant surface 1:1. Do not approximate or redesign.")
    lines.push("")
    lines.push("**File Change Report**: Before reporting success, list every project file you changed in `files_changed[]` with a concrete summary and reason. The host compares this list to the git diff; unexplained or phantom files fail collaboration review.")
    lines.push("")
    lines.push("Orchestrator is asking build to implement this goal, verify it, and report the result.")
    return lines.join("\n")
  }
  const contextLines: string[] = []
  if (context?.retryFeedback && context.retryFeedback.trim().length > 0) {
    contextLines.push("## Prior Attempt Failed — Read This Before Implementing")
    contextLines.push("")
    contextLines.push(context.retryFeedback.trim())
    contextLines.push("")
  }
  if (context?.deliveryFeedback && context.deliveryFeedback.trim().length > 0) {
    contextLines.push("## Canonical Delivery Rejection Feedback")
    contextLines.push("")
    contextLines.push(context.deliveryFeedback.trim())
    contextLines.push("")
  }
  return [
    "# Delegation",
    "",
    "Orchestrator is asking build to implement this request, verify it, and report the result.",
    "If the request depends on screenshots, webpage references, uploaded visuals, or staged `references/` files, those references are authoritative and the implementation must restore them 1:1 rather than treating them as inspiration.",
    "",
    ...contextLines,
    "# Request",
    "",
    target.text,
    "",
    "# File Change Report",
    "",
    "Before reporting success, list every project file you changed in `files_changed[]` with a concrete summary and reason. The host compares this list to the git diff; unexplained or phantom files fail collaboration review.",
  ].join("\n")
}
